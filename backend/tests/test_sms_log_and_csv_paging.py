"""The organizer's SMS log pages backwards past its first page (`before` = the last message seen), and the
participants CSV is streamed rather than built in memory."""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from httpx import AsyncClient

from app.models import SmsMessage
from tests.helpers import bearer, provision_organizer
from tests.test_event_lifecycle import make_event
from tests.test_participants import congress, register


async def add_messages(app: FastAPI, event_id: str, count: int) -> list[str]:
    """`count` log rows; pairs share a timestamp so the page boundary must break ties by id."""
    start = datetime(2027, 1, 1, tzinfo=timezone.utc)
    rows = [
        SmsMessage(
            id=uuid.uuid4(), kind="ticket_resend", mobile="09121239000", body=f"m{i}", status="sent",
            event_id=uuid.UUID(event_id), created_at=start + timedelta(minutes=i // 2),
        )
        for i in range(count)
    ]
    async with app.state.sessionmaker() as session:
        session.add_all(rows)
        await session.commit()
    return [str(r.id) for r in rows]


async def test_the_sms_log_pages_back_through_every_message_once(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    ids = await add_messages(app, event["id"], 7)
    url = f"/api/events/{event['id']}/sms/messages"

    first = await client.get(url, params={"limit": 3}, headers=bearer(organizer))
    assert first.status_code == 200 and len(first.json()) == 3
    seen = [m["id"] for m in first.json()]
    for _ in range(len(ids)):
        page = await client.get(url, params={"limit": 3, "before": seen[-1]}, headers=bearer(organizer))
        assert page.status_code == 200, page.text
        seen += [m["id"] for m in page.json()]
        if len(page.json()) < 3:
            break

    assert sorted(seen) == sorted(ids) and len(seen) == len(set(seen))
    created = [m["created_at"] for m in (await client.get(url, headers=bearer(organizer))).json()]
    assert created == sorted(created, reverse=True)


async def test_a_cursor_from_another_event_is_refused(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    other = await make_event(client, organizer)
    foreign = (await add_messages(app, other["id"], 1))[0]

    refused = await client.get(
        f"/api/events/{event['id']}/sms/messages", params={"before": foreign}, headers=bearer(organizer)
    )

    assert (refused.status_code, refused.json()["code"]) == (400, "CURSOR_INVALID")


async def test_the_participants_csv_is_streamed(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    await register(client, event_id, tier_id, "09121239101", "=cmd|' /C calc'!A0", "Org", "Title")

    resp = await client.get(f"/api/events/{event_id}/participants/export-csv", headers=bearer(organizer))

    assert resp.status_code == 200
    assert "content-length" not in resp.headers  # streamed in chunks, not one buffered body
    assert resp.text.startswith("﻿Ticket ID,Full Name,Mobile")
    assert "'=cmd" in resp.text and "09121239101" in resp.text
