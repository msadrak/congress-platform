"""Pass short links live until 30 days after the event ends (ADR 0015): moving the event's end moves their expiry
too, in the same change, but never to before now; revoked links stay revoked."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import ShortLink
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_event_lifecycle import make_event, make_tier, patch_event, reserve

LIFETIME = timedelta(days=30)


async def links(app: FastAPI, event_id: str) -> list[ShortLink]:
    async with app.state.sessionmaker() as session:
        rows = await session.scalars(
            select(ShortLink).where(ShortLink.event_id == uuid.UUID(event_id)).order_by(ShortLink.created_at)
        )
        return list(rows)


async def test_moving_the_event_end_moves_the_link_expiry(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    tier = await make_tier(client, organizer, event["id"])
    await publish_page(client, organizer, event["id"])
    assert (await reserve(client, event["id"], tier["id"], "09121238001")).status_code == 201
    cancelled = await reserve(client, event["id"], tier["id"], "09121238002")
    await client.post(
        f"/api/events/{event['id']}/participants/{cancelled.json()['id']}/cancel", json={}, headers=bearer(organizer)
    )
    [active, revoked] = await links(app, event["id"])
    assert active.revoked_at is None and revoked.revoked_at is not None
    revoked_expiry = revoked.expires_at

    later = datetime.fromisoformat(event["ends_at"]) + timedelta(days=10)
    assert (await patch_event(client, organizer, event["id"], ends_at=later.isoformat())).status_code == 200
    [active, revoked] = await links(app, event["id"])
    assert active.expires_at == later + LIFETIME
    assert revoked.expires_at == revoked_expiry

    earlier = later - timedelta(days=5)
    assert (await patch_event(client, organizer, event["id"], ends_at=earlier.isoformat())).status_code == 200
    assert (await links(app, event["id"]))[0].expires_at == earlier + LIFETIME

    # Moved far into the past: the link expires now, never retroactively.
    before = datetime.now(timezone.utc)
    moved = await patch_event(
        client, organizer, event["id"], starts_at="2000-01-01T08:00:00Z", ends_at="2000-01-02T08:00:00Z"
    )
    assert moved.status_code == 200, moved.text
    expiry = (await links(app, event["id"]))[0].expires_at
    assert before <= expiry <= datetime.now(timezone.utc)

    # Renaming the event leaves the expiry alone.
    assert (await patch_event(client, organizer, event["id"], name="Renamed")).status_code == 200
    assert (await links(app, event["id"]))[0].expires_at == expiry
