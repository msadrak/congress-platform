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
