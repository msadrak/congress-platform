"""Ticket confirmation SMS: queued with the ticket, delivered in the background, retried safely."""

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.main import create_app
from app.models import SmsMessage
from app.sms.outbox import LEASE, MAX_ATTEMPTS, deliver_due
from app.sms.gateway import NOT_CONFIGURED, SmsGateway
from app.sms.provider import RecordingProvider, SmsResult
from tests.conftest import _truncate_all, make_test_settings
from tests.helpers import bearer, pass_link, provision_organizer, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

MOBILE = "09121112233"


async def reserve(client: AsyncClient, mobile: str = MOBILE, name: str = "Dr. Neda Karimi") -> str:
    organizer = await provision_organizer(client, "SMS Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    _, token = await sign_in(client, mobile, name)
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert reserved.status_code == 201, reserved.text
    ticket_id: str = reserved.json()["id"]
    return ticket_id


async def confirmations(app: FastAPI) -> list[SmsMessage]:
    async with app.state.sessionmaker() as session:
        return list(
            (await session.scalars(select(SmsMessage).where(SmsMessage.kind == "ticket_confirmation"))).all()
        )


def recorder(app: FastAPI) -> RecordingProvider:
    gateway: SmsGateway = app.state.sms
    return gateway.recorder


async def test_reservation_queues_a_confirmation_with_the_pass_link(app: FastAPI, client: AsyncClient) -> None:
    ticket_id = await reserve(client)

    (queued,) = await confirmations(app)
    assert queued.status == "pending" and str(queued.ticket_id) == ticket_id
    assert queued.body == (
        f"Dr. Neda Karimi عزیز، ثبت‌نام شما در «{EVENT['name']}» تأیید شد.\n"
        f"کارت ورود: {await pass_link(app, ticket_id)}"
    )
    assert queued.event_id is not None
    assert recorder(app).sent_to(MOBILE)[-1].kind == "otp"  # only the sign-in code so far

    assert await deliver_due(app.state.sessionmaker, app.state.sms) == 1
    (sent,) = await confirmations(app)
    assert (sent.status, sent.attempts) == ("sent", 1) and sent.sent_at is not None
    delivered = recorder(app).sent_to(MOBILE)[-1]
    assert (delivered.kind, delivered.text, delivered.code) == ("ticket_confirmation", queued.body, None)
    assert await deliver_due(app.state.sessionmaker, app.state.sms) == 0


async def test_a_ticket_is_confirmed_at_most_once(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client)
    (queued,) = await confirmations(app)
    async with app.state.sessionmaker() as session:
        session.add(
            SmsMessage(kind="ticket_confirmation", mobile=MOBILE, body="x", ticket_id=queued.ticket_id, status="pending")
        )
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_retryable_failures_back_off_then_give_up(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client)
    provider = recorder(app)
    now = datetime.now(timezone.utc)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        provider.queued_results.append(SmsResult(ok=False, error="HTTP_503", retryable=True))
        assert await deliver_due(app.state.sessionmaker, provider, now=now) == 1
        (message,) = await confirmations(app)
        assert message.attempts == attempt and message.last_error == "HTTP_503"
        if attempt < MAX_ATTEMPTS:
            assert message.status == "pending"
            assert message.send_after == now + timedelta(seconds=min(60 * 2 ** (attempt - 1), 3600))
            # Not due again until the backoff has passed.
            assert await deliver_due(app.state.sessionmaker, provider, now=now) == 0
            now = message.send_after
    assert message.status == "failed"


async def test_a_timed_out_send_is_never_repeated(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client)
    recorder(app).queued_results.append(SmsResult(ok=False, error="TIMEOUT", unknown=True))
    await deliver_due(app.state.sessionmaker, app.state.sms)
    (message,) = await confirmations(app)
    assert message.status == "unknown"
    later = datetime.now(timezone.utc) + timedelta(days=1)
    assert await deliver_due(app.state.sessionmaker, app.state.sms, now=later) == 0


async def test_walk_ins_are_confirmed_only_when_they_give_a_number(app: FastAPI, client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Walk-in SMS Co")
    event_id = await create_event(client, organizer)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    for body in ({"full_name": "No Number"}, {"full_name": "Has Number", "mobile": "۰۹۳۵ ۱۲۳ ۴۵۶۷"}):
        walk_in = await client.post(
            f"/api/events/{event_id}/desk-registrations",
            json={**body, "ticket_tier_id": tier_id},
            headers=bearer(organizer),
        )
        assert walk_in.status_code == 201, walk_in.text

    (queued,) = await confirmations(app)
    assert queued.mobile == "09351234567"
    assert queued.body is not None and queued.body.startswith("Has Number عزیز")

    # The walk-in can now sign in with that number and finds the pass.
    _, token = await sign_in(client, "09351234567")
    passes = await client.get("/api/attendees/me/tickets", headers={"Authorization": f"Bearer {token}"})
    assert [p["attendee_name"] for p in passes.json()] == ["Has Number"]


async def test_long_names_are_shortened_in_the_message(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client, name="Professor " + "Very Long Family Name " * 5)
    (queued,) = await confirmations(app)
    assert queued.body is not None
    name = queued.body.split(" عزیز")[0]
    assert len(name) == 60 and name.endswith("…")


async def test_the_background_task_delivers_without_being_asked(media_root: Path) -> None:
    await _truncate_all()
    settings = make_test_settings(media_root).model_copy(
        update={"sms_outbox_enabled": True, "sms_outbox_poll_seconds": 0.05}
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await reserve(client)
            for _ in range(100):
                messages = await confirmations(app)
                if messages and messages[0].status == "sent":
                    break
                await asyncio.sleep(0.05)
            assert [m.status for m in messages] == ["sent"]


async def test_an_unconfigured_gateway_does_not_use_up_attempts(app: FastAPI, client: AsyncClient) -> None:
    """Hours without an sms.ir key must not permanently fail the confirmations waiting for it."""
    await reserve(client)
    provider = recorder(app)
    now = datetime.now(timezone.utc)
    for _ in range(MAX_ATTEMPTS + 3):
        provider.queued_results.append(SmsResult(ok=False, error=NOT_CONFIGURED, retryable=True))
        assert await deliver_due(app.state.sessionmaker, provider, now=now) == 1
        (message,) = await confirmations(app)
        assert (message.status, message.attempts, message.last_error) == ("pending", 0, NOT_CONFIGURED)
        assert message.send_after is not None and message.send_after > now
        now = message.send_after
    assert await deliver_due(app.state.sessionmaker, provider, now=now) == 1
    (message,) = await confirmations(app)
    assert (message.status, message.attempts) == ("sent", 1)


async def test_messages_are_sent_with_no_transaction_or_lock_held(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client)
    engine = app.state.sessionmaker.kw["bind"]
    seen: list[object] = []
    provider = recorder(app)
    send = provider.send_text

    async def watching(mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        seen.append(engine.pool.checkedout())
        async with app.state.sessionmaker() as session:
            # Another process can read (and would skip) the claimed row without waiting for a lock.
            row = await session.scalar(select(SmsMessage).where(SmsMessage.kind == kind).with_for_update(nowait=True))
            assert row is not None
            seen.append((row.status, row.lease_until is not None))
            await session.rollback()
        return await send(mobile, text, kind=kind, code=code)

    provider.send_text = watching  # type: ignore[method-assign]
    assert await deliver_due(app.state.sessionmaker, provider) == 1
    assert seen == [0, ("sending", True)]
    (message,) = await confirmations(app)
    assert (message.status, message.lease_until) == ("sent", None)


async def test_a_pass_that_dies_mid_batch_never_repeats_what_it_sent(app: FastAPI, client: AsyncClient) -> None:
    await reserve(client)
    (first,) = await confirmations(app)
    async with app.state.sessionmaker() as session:
        session.add(SmsMessage(kind="ticket_confirmation", mobile="09351234567", body="second", event_id=first.event_id,
                               status="pending", send_after=first.send_after - timedelta(seconds=1)))
        await session.commit()
    provider = recorder(app)
    send = provider.send_text
    calls = 0

    async def dies_on_the_second(mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("the process died")
        return await send(mobile, text, kind=kind, code=code)

    provider.send_text = dies_on_the_second  # type: ignore[method-assign]
    with pytest.raises(RuntimeError):
        await deliver_due(app.state.sessionmaker, provider)
    provider.send_text = send  # type: ignore[method-assign]
    statuses = sorted(m.status for m in await confirmations(app))
    assert statuses == ["sending", "sent"]

    # Until the lease runs out the claimed message is left alone; then it is unknown, never resent.
    assert await deliver_due(app.state.sessionmaker, provider) == 0
    later = datetime.now(timezone.utc) + LEASE + timedelta(seconds=1)
    assert await deliver_due(app.state.sessionmaker, provider, now=later) == 0
    messages = {m.status: m for m in await confirmations(app)}
    assert set(messages) == {"sent", "unknown"} and messages["unknown"].last_error == "LEASE_EXPIRED"
    assert len([m for m in provider.messages if m.kind == "ticket_confirmation"]) == 1


async def test_platform_caps_hold_queued_messages_without_using_attempts(media_root: Path) -> None:
    await _truncate_all()
    app = create_app(make_test_settings(media_root).model_copy(update={"sms_hourly_cap": 3}))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await reserve(client)  # the sign-in code is the first of the three
            await sign_in(client, "09351234567")  # and this one the second
            await sign_in(client, "09361234567")  # the third: the cap is reached
            assert await deliver_due(app.state.sessionmaker, app.state.sms) == 1
            (message,) = await confirmations(app)
            assert (message.status, message.attempts, message.last_error) == ("pending", 0, "HOURLY_CAP_REACHED")
