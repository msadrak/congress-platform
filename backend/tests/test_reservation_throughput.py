"""Reservation throughput and correctness under concurrency (PERF-1).

Every reservation of a tier updates the same `ticket_tiers` row. The conditional `reserved_count + 1` runs last,
just before commit, so the row lock is held only for the commit and not while the ticket, its QR, short link and
SMS are written: a reservation stalled in that work must not hold up the other reservations of the tier. The
increment is still the one atomic gate, so the last places are never oversold.
"""

import asyncio
import uuid
from typing import Any

import asyncpg
from fastapi import FastAPI
from httpx import AsyncClient

from tests.conftest import TEST_URL
from tests.helpers import bearer, sign_in
from tests.test_participants import auth, congress, reserved_count
from tests.test_ticket_tiers import tier


def reserve(client: AsyncClient, event_id: str, tier_id: str, token: str) -> Any:
    return client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token))


async def connect() -> asyncpg.Connection:
    return await asyncpg.connect(TEST_URL.replace("postgresql+asyncpg://", "postgresql://"))


async def attendees(client: AsyncClient, count: int, prefix: str) -> list[tuple[str, str]]:
    """(user id, token) for `count` new signed-in attendees."""
    signed = [await sign_in(client, f"{prefix}{i:04d}", f"Attendee {i}") for i in range(count)]
    return [(str(user["id"]), token) for user, token in signed]


async def wait_until_blocked(conn: asyncpg.Connection, timeout: float = 10.0) -> None:
    """Return once some other backend of the test database waits for a lock."""
    for _ in range(int(timeout / 0.05)):
        waiting = await conn.fetchval(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
            "AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'"
        )
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("the reservation never waited for the held lock")


async def test_a_stalled_reservation_does_not_hold_up_the_tier(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, tier_id = await congress(client)
    (slow_id, slow_token), (_, fast_token) = await attendees(client, 2, "0912131")

    # Hold the first attendee's account row: inserting their ticket (foreign key check) waits for it, so their
    # reservation stalls in the middle of its writes.
    blocker = await connect()
    try:
        transaction = blocker.transaction()
        await transaction.start()
        await blocker.execute("SELECT 1 FROM users WHERE id = $1 FOR UPDATE", uuid.UUID(slow_id))
        slow = asyncio.create_task(reserve(client, event_id, tier_id, slow_token))
        observer = await connect()
        try:
            await wait_until_blocked(observer)
        finally:
            await observer.close()
        # Another attendee reserves the same tier meanwhile: it must not wait for the stalled one.
        fast = await asyncio.wait_for(reserve(client, event_id, tier_id, fast_token), timeout=5)
        assert fast.status_code == 201, fast.text
        await transaction.rollback()
        assert (await asyncio.wait_for(slow, timeout=10)).status_code == 201
    finally:
        await blocker.close()
    assert await reserved_count(app, tier_id) == 2


async def test_concurrent_reservations_never_oversell_the_last_places(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, _ = await congress(client)
    created = await client.post(
        f"/api/events/{event_id}/ticket-tiers", json=tier(name="Last Seats", quota=5), headers=bearer(organizer)
    )
    tier_id = created.json()["id"]
    people = await attendees(client, 22, "0912132")
    for _, token in people[:2]:  # two places already taken: three left for twenty contenders
        assert (await reserve(client, event_id, tier_id, token)).status_code == 201

    responses = await asyncio.gather(*(reserve(client, event_id, tier_id, token) for _, token in people[2:]))

    statuses = sorted(r.status_code for r in responses)
    assert statuses == [201] * 3 + [410] * 17, [r.text for r in responses]
    assert {r.json()["code"] for r in responses if r.status_code == 410} == {"TIER_SOLD_OUT"}
    assert await reserved_count(app, tier_id) == 5
    conn = await connect()
    try:
        tier_uuid = uuid.UUID(tier_id)
        tickets = await conn.fetchval("SELECT count(*) FROM tickets WHERE ticket_tier_id = $1", tier_uuid)
        assert tickets == 5
        # A refused reservation leaves nothing behind: no pass, short link or confirmation SMS.
        orphans = await conn.fetchrow(
            "SELECT (SELECT count(*) FROM entity_qrs q WHERE q.entity_type = 'attendee_ticket' "
            "        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id = q.entity_id)) AS qrs, "
            "       (SELECT count(*) FROM short_links WHERE event_id = $1) AS links, "
            "       (SELECT count(*) FROM sms_messages WHERE event_id = $1 AND kind = 'ticket_confirmation') AS sms",
            uuid.UUID(event_id),
        )
        assert dict(orphans) == {"qrs": 0, "links": 5, "sms": 5}
    finally:
        await conn.close()


async def test_concurrent_reservations_by_one_attendee_take_one_place(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, tier_id = await congress(client)
    [(_, token)] = await attendees(client, 1, "0912133")

    responses = await asyncio.gather(*(reserve(client, event_id, tier_id, token) for _ in range(6)))

    assert sorted(r.status_code for r in responses) == [201] + [409] * 5, [r.text for r in responses]
    assert {r.json()["code"] for r in responses if r.status_code == 409} == {"ALREADY_REGISTERED"}
    assert await reserved_count(app, tier_id) == 1


async def test_a_tier_closed_or_missing_is_refused_before_anything_is_written(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    [(_, token)] = await attendees(client, 1, "0912134")
    _, other_event, other_tier = await congress(client, organizer)

    missing = await reserve(client, event_id, str(uuid.uuid4()), token)
    foreign = await reserve(client, event_id, other_tier, token)
    closed_tier = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{tier_id}", json={"is_open": False}, headers=bearer(organizer)
    )
    assert closed_tier.status_code == 200, closed_tier.text
    closed = await reserve(client, event_id, tier_id, token)

    assert (missing.status_code, missing.json()["code"]) == (404, "TIER_NOT_FOUND")
    assert (foreign.status_code, foreign.json()["code"]) == (404, "TIER_NOT_FOUND")
    assert (closed.status_code, closed.json()["code"]) == (400, "TIER_CLOSED")
    conn = await connect()
    try:
        assert await conn.fetchval("SELECT count(*) FROM tickets WHERE event_id = $1", uuid.UUID(event_id)) == 0
    finally:
        await conn.close()
    assert other_event != event_id
