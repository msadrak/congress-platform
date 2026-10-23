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
from app.sms.outbox import MAX_ATTEMPTS, deliver_due
from app.sms.gateway import SmsGateway
from app.sms.provider import RecordingProvider, SmsResult
from tests.conftest import _truncate_all, make_test_settings
from tests.helpers import bearer, pass_link, provision_organizer, publish_page, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

MOBILE = "09121112233"


async def reserve(client: AsyncClient, mobile: str = MOBILE, name: str = "Dr. Neda Karimi") -> str:
    organizer = await provision_organizer(client, "SMS Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
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
    await publish_page(client, organizer, event_id)
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
