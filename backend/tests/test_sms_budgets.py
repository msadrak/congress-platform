"""SMS cost and abuse budgets: sign-in codes keep a share of the platform cap, attendees cannot loop
cancel/register to send texts, organizers have an hourly allowance of notices, and concurrent re-registrations
take one place."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import create_app
from app.models import SmsMessage
from app.sms.gateway import HOURLY_CAP_REACHED, SmsGateway
from tests.conftest import _truncate_all, make_test_settings
from tests.helpers import bearer
from tests.test_participants import auth, congress, register, reserved_count


@asynccontextmanager
async def app_with(media_root: Path, **overrides: Any) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    await _truncate_all()
    app = create_app(make_test_settings(media_root).model_copy(update=overrides))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield app, http


async def queued(app: FastAPI, mobile: str, kind: str) -> int:
    async with app.state.sessionmaker() as session:
        count = await session.scalar(
            select(func.count()).select_from(SmsMessage).where(SmsMessage.mobile == mobile, SmsMessage.kind == kind)
        )
    return int(count or 0)


def reserve(client: AsyncClient, event_id: str, tier_id: str, token: str) -> Any:
    return client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token))


def self_cancel(client: AsyncClient, ticket_id: str, token: str) -> Any:
    return client.post(f"/api/attendees/me/tickets/{ticket_id}/cancel", headers=auth(token))


# --- sign-in codes keep a share of the platform cap ---------------------------------------------------------


async def test_notices_stop_short_of_the_hourly_cap_so_sign_in_codes_still_go_out(media_root: Path) -> None:
    async with app_with(media_root, sms_hourly_cap=10, sms_otp_reserve_percent=20) as (app, client):
        gateway: SmsGateway = app.state.sms
        notices = [
            await gateway.send_text(f"0912000{i:04d}", "notice", kind="ticket_confirmation") for i in range(9)
        ]
        assert [r.ok for r in notices] == [True] * 8 + [False]
        assert notices[-1].error == HOURLY_CAP_REACHED and notices[-1].retryable

        codes = [
            await client.post("/api/auth/otp/request", json={"mobile": f"0935000{i:04d}"}) for i in range(3)
        ]
        assert [r.status_code for r in codes] == [202, 202, 503]
        assert codes[-1].json()["code"] == "SMS_HOURLY_CAP_REACHED"


# --- attendees cannot loop cancel / register to send texts --------------------------------------------------


async def test_an_attendee_cannot_loop_cancel_and_register_to_send_texts(media_root: Path) -> None:
    async with app_with(media_root, sms_notices_per_ticket_per_day=4) as (app, client):
        _, event_id, tier_id = await congress(client)
        mobile = "09121240001"
        token, ticket = await register(client, event_id, tier_id, mobile, "Looping Larry")

        steps = []
        for _ in range(2):
            steps.append((await self_cancel(client, ticket["id"], token)).status_code)
            steps.append((await reserve(client, event_id, tier_id, token)).status_code)
        assert steps == [200, 201, 200, 201]

        # Over the budget, cancelling still works (the place must be freed) but sends no text...
        assert (await self_cancel(client, ticket["id"], token)).status_code == 200
        # ...and registering again is refused until the budget frees up.
        refused = await reserve(client, event_id, tier_id, token)
        assert refused.status_code == 429, refused.text
        assert refused.json()["code"] == "TICKET_CHANGES_RATE_LIMITED"
        assert int(refused.headers["Retry-After"]) > 0

        assert await queued(app, mobile, "ticket_cancelled") == 2
        assert await queued(app, mobile, "ticket_confirmation") == 3  # the first registration and two more
        assert await reserved_count(app, tier_id) == 0


async def test_an_attendees_notices_are_limited_across_congresses(media_root: Path) -> None:
    async with app_with(media_root, sms_notices_per_attendee_per_hour=2) as (app, client):
        organizer, first_event, first_tier = await congress(client)
        _, second_event, second_tier = await congress(client, organizer)
        mobile = "09121240002"
        token, first = await register(client, first_event, first_tier, mobile, "Busy Bee")
        second = (await reserve(client, second_event, second_tier, token)).json()

        assert (await self_cancel(client, first["id"], token)).status_code == 200
        assert (await self_cancel(client, second["id"], token)).status_code == 200
        refused = await reserve(client, first_event, first_tier, token)

        assert refused.status_code == 429 and refused.json()["code"] == "TICKET_CHANGES_RATE_LIMITED"
        assert await queued(app, mobile, "ticket_cancelled") == 2


# --- organizers have an hourly allowance of notices ---------------------------------------------------------


async def test_organizer_notices_are_capped_per_hour_and_the_change_waits(media_root: Path) -> None:
    async with app_with(media_root, sms_notices_per_organizer_per_hour=2) as (app, client):
        organizer, event_id, tier_id = await congress(client)
        tickets = [
            (await register(client, event_id, tier_id, f"0912125000{i}", f"Person {i}"))[1] for i in range(4)
        ]
        base = f"/api/events/{event_id}/participants"

        cancelled = await client.post(f"{base}/{tickets[0]['id']}/cancel", json={}, headers=bearer(organizer))
        reissued = await client.post(f"{base}/{tickets[1]['id']}/reissue", json={}, headers=bearer(organizer))
        refused = await client.post(f"{base}/{tickets[2]['id']}/cancel", json={}, headers=bearer(organizer))
        transfer = await client.post(
            f"{base}/{tickets[3]['id']}/transfer", json={"mobile": "09121250099", "full_name": "New Holder"},
            headers=bearer(organizer),
        )

        assert (cancelled.status_code, reissued.status_code) == (200, 200)
        assert refused.status_code == 429 and refused.json()["code"] == "SMS_NOTICE_LIMIT_REACHED"
        assert transfer.status_code == 429 and transfer.json()["code"] == "SMS_NOTICE_LIMIT_REACHED"
        # Refused changes did not happen at all.
        detail = (await client.get(f"{base}/{tickets[2]['id']}", headers=bearer(organizer))).json()
        assert detail["status"] == "active"
        assert await queued(app, "0912125000" + "2", "ticket_cancelled") == 0
        # The same change without a notice is not limited.
        silent = await client.post(f"{base}/{tickets[2]['id']}/cancel", json={"notify": False}, headers=bearer(organizer))
        assert silent.status_code == 200
        # Another organizer has its own allowance.
        other, other_event, other_tier = await congress(client)
        _, theirs = await register(client, other_event, other_tier, "09121250100", "Elsewhere")
        assert (
            await client.post(
                f"/api/events/{other_event}/participants/{theirs['id']}/cancel", json={}, headers=bearer(other)
            )
        ).status_code == 200


# --- concurrent re-registrations ---------------------------------------------------------------------------


async def test_concurrent_registrations_after_a_cancellation_take_one_place(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121240010", "Double Tap")
    cancel = f"/api/events/{event_id}/participants/{ticket['id']}/cancel"
    assert (await client.post(cancel, json={"notify": False}, headers=bearer(organizer))).status_code == 200
    assert await reserved_count(app, tier_id) == 0

    responses = await asyncio.gather(*(reserve(client, event_id, tier_id, token) for _ in range(5)))

    assert sorted(r.status_code for r in responses) == [201, 409, 409, 409, 409], [r.text for r in responses]
    assert {r.json()["code"] for r in responses if r.status_code == 409} == {"ALREADY_REGISTERED"}
    assert await reserved_count(app, tier_id) == 1
    assert uuid.UUID(next(r.json()["id"] for r in responses if r.status_code == 201)) == uuid.UUID(ticket["id"])
