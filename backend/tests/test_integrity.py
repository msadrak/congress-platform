"""Data integrity (migration 0021): constraints PostgreSQL enforces, same-event foreign keys, delete rules,
race-safe inserts, walk-in idempotency, the desk search's check-in counts and the database pool settings.

Races are made deterministic: a separate connection writes the conflicting row and keeps its transaction open,
the request is started and blocks on that row's unique index entry, and only then the connection commits.
"""

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import Coroutine, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncpg
import pytest
from alembic.script import ScriptDirectory
from httpx import AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.main import create_app
from tests.conftest import BACKEND_DIR, TEST_URL, _truncate_all, alembic_config, make_test_settings
from tests.helpers import bearer, desk_sign_in, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event as create_draft_event, tier
from tests.test_tickets import register_user

PLAIN_URL = TEST_URL.replace("+asyncpg", "")
INSERT_LEAD = (
    "INSERT INTO leads(id,event_id,booth_id,ticket_id,captured_by_user_id,rating,tags,notes,created_at,updated_at) "
    "VALUES($1,$2,$3,$4,$5,$6,'[]','',now(),now())"
)
INSERT_CHECKIN = (
    "INSERT INTO checkins(id,checkin_point_id,ticket_id,qr_secret,policy_type,status,scanned_at) "
    "VALUES($1,$2,$3,$4,$5,$6,now())"
)
INSERT_USER = "INSERT INTO users(id,mobile,full_name,organization,title) VALUES($1,$2,'Signed Up','','')"


async def connect() -> asyncpg.Connection:
    return await asyncpg.connect(PLAIN_URL)


async def scalar(sql: str, *args: Any) -> Any:
    conn = await connect()
    try:
        return await conn.fetchval(sql, *args)
    finally:
        await conn.close()


async def create_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    """A new event with its page published, so attendees can reserve tickets."""
    event_id = await create_draft_event(client, organizer)
    await publish_page(client, organizer, event_id)
    return event_id


async def second_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    response = await client.post(
        "/api/events", json={**EVENT, "slug": f"event-b-{uuid.uuid4().hex[:6]}"}, headers=bearer(organizer)
    )
    assert response.status_code == 201, response.text
    event_id: str = response.json()["id"]
    await publish_page(client, organizer, event_id)
    return event_id


async def add_tier(client: AsyncClient, organizer: dict[str, str], event_id: str, quota: int = 100) -> str:
    response = await client.post(
        f"/api/events/{event_id}/ticket-tiers", json=tier(quota=quota), headers=bearer(organizer)
    )
    assert response.status_code == 201, response.text
    tier_id: str = response.json()["id"]
    return tier_id


async def reserve(client: AsyncClient, event_id: str, tier_id: str, mobile: str) -> dict[str, Any]:
    """A ticket of a new signed-in attendee with this mobile."""
    _, token = await register_user(client, mobile, f"Attendee {mobile[-4:]}")
    response = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    ticket: dict[str, Any] = response.json()
    return ticket


async def add_booth(client: AsyncClient, organizer: dict[str, str], event_id: str) -> str:
    response = await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))
    assert response.status_code == 201, response.text
    booth_id: str = response.json()["id"]
    return booth_id


async def add_point(client: AsyncClient, organizer: dict[str, str], event_id: str, name: str = "Gate") -> uuid.UUID:
    response = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": name}, headers=bearer(organizer)
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def user_id_of(mobile: str) -> uuid.UUID:
    user_id: uuid.UUID = await scalar("SELECT id FROM users WHERE mobile=$1", mobile)
    return user_id


async def behind_uncommitted(
    statements: list[tuple[str, tuple[Any, ...]]], request: Coroutine[Any, Any, Response]
) -> Response:
    """Run `statements` in an open transaction, start `request`, wait until it waits for a lock (the unique index
    entry those statements hold), then commit: the request meets a row a concurrent request just committed."""
    writer, watcher = await connect(), await connect()
    try:
        transaction = writer.transaction()
        await transaction.start()
        for sql, args in statements:
            await writer.execute(sql, *args)
        task = asyncio.create_task(request)
        for _ in range(200):
            if task.done():
                break
            waiting = await watcher.fetchval(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
            if waiting:
                break
            await asyncio.sleep(0.05)
        assert not task.done(), f"the request did not reach the contended insert: {task.result().text}"
        await transaction.commit()
        return await task
    finally:
        await writer.close()
        await watcher.close()


# --- Constraints ---------------------------------------------------------------------------------------------


async def test_check_constraints_reject_bad_rows(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Integrity Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id, quota=5)
    ticket = await reserve(client, event_id, tier_id, "09121100001")
    booth_id = await add_booth(client, organizer, event_id)
    point_id = await add_point(client, organizer, event_id)
    ticket_id, attendee = uuid.UUID(ticket["id"]), await user_id_of("09121100001")

    conn = await connect()
    try:
        for reserved in (-1, 6):
            with pytest.raises(asyncpg.CheckViolationError, match="ck_ticket_tiers_reserved_count"):
                await conn.execute("UPDATE ticket_tiers SET reserved_count=$1 WHERE id=$2", reserved, uuid.UUID(tier_id))
        await conn.execute("UPDATE ticket_tiers SET reserved_count=5 WHERE id=$1", uuid.UUID(tier_id))  # == quota

        with pytest.raises(asyncpg.CheckViolationError, match="ck_checkin_points_policy_type"):
            await conn.execute("UPDATE checkin_points SET policy_type='VIP_ONLY' WHERE id=$1", point_id)
        for capacity in (0, -3):
            with pytest.raises(asyncpg.CheckViolationError, match="ck_checkin_points_max_capacity"):
                await conn.execute("UPDATE checkin_points SET max_capacity=$1 WHERE id=$2", capacity, point_id)

        with pytest.raises(asyncpg.CheckViolationError, match="ck_checkins_status"):
            await conn.execute(INSERT_CHECKIN, uuid.uuid4(), point_id, ticket_id, "x", "MULTI_ENTRY", "MAYBE")
        with pytest.raises(asyncpg.CheckViolationError, match="ck_checkins_policy_type"):
            await conn.execute(INSERT_CHECKIN, uuid.uuid4(), point_id, ticket_id, "x", "ANY", "ADMITTED")

        with pytest.raises(asyncpg.CheckViolationError, match="ck_leads_rating"):
            await conn.execute(
                INSERT_LEAD, uuid.uuid4(), uuid.UUID(event_id), uuid.UUID(booth_id), ticket_id, attendee, "LUKEWARM"
            )
    finally:
        await conn.close()


async def test_a_check_in_point_capacity_must_be_positive(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Capacity Org")
    event_id = await create_event(client, organizer)
    url = f"/api/events/{event_id}/checkin-points"
    capped = {"name": "Workshop", "policy_type": "CAPACITY_CAPPED"}
    assert (await client.post(url, json={**capped, "max_capacity": 0}, headers=bearer(organizer))).status_code == 422
    point = await client.post(url, json={**capped, "max_capacity": 3}, headers=bearer(organizer))
    assert point.status_code == 201, point.text
    updated = await client.patch(f"{url}/{point.json()['id']}", json={"max_capacity": -1}, headers=bearer(organizer))
    assert updated.status_code == 422


async def test_a_ticket_cannot_hold_another_events_tier(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Tier Org")
    event_a = await create_event(client, organizer)
    event_b = await second_event(client, organizer)
    ticket = await reserve(client, event_a, await add_tier(client, organizer, event_a), "09121100002")
    tier_b = await add_tier(client, organizer, event_b)

    conn = await connect()
    try:
        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_tickets_tier_same_event"):
            await conn.execute(
                "UPDATE tickets SET ticket_tier_id=$1 WHERE id=$2", uuid.UUID(tier_b), uuid.UUID(ticket["id"])
            )
    finally:
        await conn.close()


async def test_a_leads_booth_and_ticket_belong_to_the_same_event(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Lead Org")
    event_a = await create_event(client, organizer)
    event_b = await second_event(client, organizer)
    ticket = await reserve(client, event_a, await add_tier(client, organizer, event_a), "09121100003")
    booth_b = uuid.UUID(await add_booth(client, organizer, event_b))
    staff, ticket_id = await user_id_of("09121100003"), uuid.UUID(ticket["id"])

    conn = await connect()
    try:
        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_leads_booth_same_event"):
            await conn.execute(INSERT_LEAD, uuid.uuid4(), uuid.UUID(event_a), booth_b, ticket_id, staff, "WARM")
        with pytest.raises(asyncpg.ForeignKeyViolationError, match="fk_leads_ticket_same_event"):
            await conn.execute(INSERT_LEAD, uuid.uuid4(), uuid.UUID(event_b), booth_b, ticket_id, staff, "WARM")
    finally:
        await conn.close()


async def test_an_events_configuration_cascades_and_its_tickets_restrict_deletion(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Delete Org")
    empty = await create_event(client, organizer)
    await add_tier(client, organizer, empty)
    point_id = await add_point(client, organizer, empty)
    booth_id = await add_booth(client, organizer, empty)
    staff = await client.post(
        f"/api/events/{empty}/booths/{booth_id}/staff", json={"mobile": "09121100004"}, headers=bearer(organizer)
    )
    assert staff.status_code == 201, staff.text
    _, attendee_token = await register_user(client, "09121100005")
    bookmark = await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth_id}", headers={"Authorization": f"Bearer {attendee_token}"}
    )
    assert bookmark.status_code == 201, bookmark.text
    operator = await client.post(
        f"/api/events/{empty}/desk/operators",
        json={"mobile": "09121100006", "operator_name": "Desk"},
        headers=bearer(organizer),
    )
    assert operator.status_code == 201, operator.text

    busy = await second_event(client, organizer)
    await reserve(client, busy, await add_tier(client, organizer, busy), "09121100007")

    conn = await connect()
    try:
        await conn.execute(
            "INSERT INTO scanner_devices(id,checkin_point_id,event_id) VALUES($1,$2,$3)",
            uuid.uuid4(), point_id, uuid.UUID(empty),
        )
        await conn.execute("DELETE FROM events WHERE id=$1", uuid.UUID(empty))
        for table in ("ticket_tiers", "checkin_points", "scanner_devices", "booths", "desk_operators"):
            assert await conn.fetchval(f"SELECT count(*) FROM {table} WHERE event_id=$1", uuid.UUID(empty)) == 0, table
        assert await conn.fetchval("SELECT count(*) FROM booth_staff") == 0
        assert await conn.fetchval("SELECT count(*) FROM booth_bookmarks") == 0

        with pytest.raises(asyncpg.ForeignKeyViolationError):
            await conn.execute("DELETE FROM events WHERE id=$1", uuid.UUID(busy))
    finally:
        await conn.close()


# --- Races ---------------------------------------------------------------------------------------------------


async def test_a_desk_ticket_race_answers_409_and_returns_the_seat(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Race Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    other_ticket = await reserve(client, event_id, tier_id, "09121100010")
    await register_user(client, "09121100011", "Racer")
    racer = await user_id_of("09121100011")

    # A concurrent registration gives the racer a ticket (here: the other ticket's row, moved to the racer).
    response = await behind_uncommitted(
        [("UPDATE tickets SET user_id=$1 WHERE id=$2", (racer, uuid.UUID(other_ticket["id"])))],
        client.post(
            f"/api/events/{event_id}/desk-registrations",
            json={"full_name": "Racer", "mobile": "09121100011", "ticket_tier_id": tier_id},
            headers=bearer(organizer),
        ),
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "ALREADY_REGISTERED"
    assert await scalar("SELECT reserved_count FROM ticket_tiers WHERE id=$1", uuid.UUID(tier_id)) == 1
    assert await scalar("SELECT count(*) FROM tickets WHERE event_id=$1", uuid.UUID(event_id)) == 1


async def test_two_staff_scanning_the_same_badge_at_once_share_one_lead(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Lead Race Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    booth_id = await add_booth(client, organizer, event_id)
    _, staff_token = await register_user(client, "09121100012", "Staff One")
    await register_user(client, "09121100013", "Staff Two")
    for mobile in ("09121100012", "09121100013"):
        assigned = await client.post(
            f"/api/events/{event_id}/booths/{booth_id}/staff", json={"mobile": mobile}, headers=bearer(organizer)
        )
        assert assigned.status_code == 201, assigned.text
    ticket = await reserve(client, event_id, tier_id, "09121100014")
    other_staff = await user_id_of("09121100013")
    lead = (uuid.uuid4(), uuid.UUID(event_id), uuid.UUID(booth_id), uuid.UUID(ticket["id"]), other_staff, "WARM")

    response = await behind_uncommitted(
        [(INSERT_LEAD, lead)],
        client.post(
            f"/api/booths/{booth_id}/leads/scan",
            json={"qr_secret": ticket["qr_secret"], "rating": "HOT"},
            headers={"Authorization": f"Bearer {staff_token}"},
        ),
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(lead[0])
    assert response.json()["rating"] == "HOT"
    assert await scalar("SELECT count(*) FROM leads WHERE booth_id=$1", uuid.UUID(booth_id)) == 1


async def test_a_concurrent_bookmark_keeps_one_bookmark(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Bookmark Org")
    event_id = await create_event(client, organizer)
    booth_id = await add_booth(client, organizer, event_id)
    _, token = await register_user(client, "09121100015")
    user_id = await user_id_of("09121100015")
    insert = "INSERT INTO booth_bookmarks(id,user_id,booth_id) VALUES($1,$2,$3)"

    response = await behind_uncommitted(
        [(insert, (uuid.uuid4(), user_id, uuid.UUID(booth_id)))],
        client.post(f"/api/attendees/me/bookmarks/booths/{booth_id}", headers={"Authorization": f"Bearer {token}"}),
    )
    assert response.status_code == 200, response.text
    assert response.json()["bookmarked"] is True
    assert await scalar("SELECT count(*) FROM booth_bookmarks WHERE user_id=$1", user_id) == 1


async def test_adding_a_desk_operator_while_their_account_is_being_created(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Operator Race Org")
    event_id = await create_event(client, organizer)
    mobile = "09121100016"

    response = await behind_uncommitted(
        [(INSERT_USER, (uuid.uuid4(), mobile))],
        client.post(
            f"/api/events/{event_id}/desk/operators",
            json={"mobile": mobile, "operator_name": "Reception"},
            headers=bearer(organizer),
        ),
    )
    assert response.status_code == 201, response.text
    assert response.json()["user_id"] == str(await user_id_of(mobile))
    assert await scalar("SELECT count(*) FROM users WHERE mobile=$1", mobile) == 1


async def test_adding_the_same_desk_operator_twice_at_once_answers_409(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Operator Twice Org")
    event_id = await create_event(client, organizer)
    await register_user(client, "09121100017")
    user_id = await user_id_of("09121100017")

    response = await behind_uncommitted(
        [(
            "INSERT INTO desk_operators(id,event_id,user_id,operator_name) VALUES($1,$2,$3,'First')",
            (uuid.uuid4(), uuid.UUID(event_id), user_id),
        )],
        client.post(
            f"/api/events/{event_id}/desk/operators",
            json={"mobile": "09121100017", "operator_name": "Second"},
            headers=bearer(organizer),
        ),
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "OPERATOR_ALREADY_ASSIGNED"


async def test_assigning_booth_staff_races_are_idempotent(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Staff Race Org")
    event_id = await create_event(client, organizer)
    booth_id = await add_booth(client, organizer, event_id)
    staff_url = f"/api/events/{event_id}/booths/{booth_id}/staff"
    new_mobile = "09121100018"

    created_account = await behind_uncommitted(
        [(INSERT_USER, (uuid.uuid4(), new_mobile))],
        client.post(staff_url, json={"mobile": new_mobile, "full_name": "Rep"}, headers=bearer(organizer)),
    )
    assert created_account.status_code == 201, created_account.text
    assert await scalar("SELECT count(*) FROM users WHERE mobile=$1", new_mobile) == 1

    await register_user(client, "09121100019")
    user_id, staff_id = await user_id_of("09121100019"), uuid.uuid4()
    assigned = await behind_uncommitted(
        [("INSERT INTO booth_staff(id,booth_id,user_id) VALUES($1,$2,$3)", (staff_id, uuid.UUID(booth_id), user_id))],
        client.post(staff_url, json={"mobile": "09121100019"}, headers=bearer(organizer)),
    )
    assert assigned.status_code == 201, assigned.text
    assert assigned.json()["id"] == str(staff_id)
    assert await scalar("SELECT count(*) FROM booth_staff WHERE booth_id=$1", uuid.UUID(booth_id)) == 2


# --- Walk-in idempotency -------------------------------------------------------------------------------------


async def test_a_retried_walk_in_returns_the_original_ticket_and_creates_nothing(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Idempotent Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    url = f"/api/events/{event_id}/desk-registrations"
    body = {"full_name": "Walk-in Without Mobile", "organization": "Clinic", "ticket_tier_id": tier_id}
    headers = {**bearer(organizer), "Idempotency-Key": str(uuid.uuid4())}

    first = await client.post(url, json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert "Idempotent-Replayed" not in first.headers
    users_before = await scalar("SELECT count(*) FROM users")

    replay = await client.post(url, json=body, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert replay.json() == first.json()
    assert await scalar("SELECT count(*) FROM tickets WHERE event_id=$1", uuid.UUID(event_id)) == 1
    assert await scalar("SELECT count(*) FROM users") == users_before
    assert await scalar("SELECT reserved_count FROM ticket_tiers WHERE id=$1", uuid.UUID(tier_id)) == 1

    # The same key for a different registration is refused; a new key is a new registration.
    reused = await client.post(url, json={**body, "full_name": "Someone Else"}, headers=headers)
    assert reused.status_code == 409
    assert reused.json()["code"] == "IDEMPOTENCY_KEY_REUSED"
    fresh = await client.post(url, json=body, headers={**bearer(organizer), "Idempotency-Key": str(uuid.uuid4())})
    assert fresh.status_code == 201
    assert fresh.json()["ticket_id"] != first.json()["ticket_id"]


async def test_simultaneous_walk_in_retries_with_one_key_create_one_ticket(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Idempotent Race Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    assignment = {"mobile": "09121100020", "operator_name": "Reception"}
    added = await client.post(f"/api/events/{event_id}/desk/operators", json=assignment, headers=bearer(organizer))
    assert added.status_code == 201, added.text
    login = await desk_sign_in(client, event_id, assignment["mobile"])
    assert login.status_code == 200, login.text
    url = f"/api/events/{event_id}/desk-registrations"
    headers = {"Authorization": f"Bearer {login.json()['access_token']}", "Idempotency-Key": "walk-in-1"}
    body = {"full_name": "Double Click", "ticket_tier_id": tier_id}

    responses = await asyncio.gather(*(client.post(url, json=body, headers=headers) for _ in range(3)))
    assert [r.status_code for r in responses] == [201, 201, 201], [r.text for r in responses]
    assert len({r.json()["ticket_id"] for r in responses}) == 1
    assert await scalar("SELECT count(*) FROM tickets WHERE event_id=$1", uuid.UUID(event_id)) == 1

    # The key is scoped to the desk actor: the organizer using the same key registers separately.
    organizer_post = await client.post(url, json=body, headers={**bearer(organizer), "Idempotency-Key": "walk-in-1"})
    assert organizer_post.status_code == 201
    assert organizer_post.json()["ticket_id"] != responses[0].json()["ticket_id"]


async def test_an_expired_idempotency_key_is_forgotten(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Expiry Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    url = f"/api/events/{event_id}/desk-registrations"
    headers = {**bearer(organizer), "Idempotency-Key": "old-key"}
    body = {"full_name": "Yesterday", "ticket_tier_id": tier_id}
    first = await client.post(url, json=body, headers=headers)
    assert first.status_code == 201

    await scalar("UPDATE desk_idempotency_keys SET expires_at = now() - interval '1 second'")
    again = await client.post(url, json=body, headers=headers)
    assert again.status_code == 201
    assert again.json()["ticket_id"] != first.json()["ticket_id"]
    assert "Idempotent-Replayed" not in again.headers


async def test_an_idempotency_key_must_be_printable_ascii(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Key Shape Org")
    event_id = await create_event(client, organizer)
    tier_id = await add_tier(client, organizer, event_id)
    response = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Guest", "ticket_tier_id": tier_id},
        headers={**bearer(organizer), "Idempotency-Key": "x" * 129},
    )
    assert response.status_code == 422
    assert await scalar("SELECT count(*) FROM tickets") == 0


# --- Desk search ---------------------------------------------------------------------------------------------


async def test_desk_search_counts_only_this_events_admissions(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Search Org")
    event_a = await create_event(client, organizer)
    event_b = await second_event(client, organizer)
    ticket = await reserve(client, event_a, await add_tier(client, organizer, event_a), "09121100021")
    point_a, point_b = await add_point(client, organizer, event_a, "A"), await add_point(client, organizer, event_b, "B")

    conn = await connect()
    try:
        ticket_id, secret = uuid.UUID(ticket["id"]), ticket["qr_secret"]
        await conn.execute(INSERT_CHECKIN, uuid.uuid4(), point_a, ticket_id, secret, "MULTI_ENTRY", "ADMITTED")
        await conn.execute(INSERT_CHECKIN, uuid.uuid4(), point_a, ticket_id, secret, "MULTI_ENTRY", "REJECTED")
        # An admission recorded against this ticket at another event's point is not this event's check-in.
        await conn.execute(INSERT_CHECKIN, uuid.uuid4(), point_b, ticket_id, secret, "MULTI_ENTRY", "ADMITTED")
    finally:
        await conn.close()

    found = await client.get(f"/api/events/{event_a}/attendees", headers=bearer(organizer))
    assert found.status_code == 200, found.text
    assert [(item["ticket_id"], item["checkin_count"]) for item in found.json()] == [(ticket["id"], 1)]


# --- Database pool -------------------------------------------------------------------------------------------


async def test_pool_settings_and_statement_timeout_are_applied(tmp_path: Path) -> None:
    settings = make_test_settings(tmp_path).model_copy(
        update={
            "db_pool_size": 3,
            "db_max_overflow": 2,
            "db_pool_timeout_seconds": 4.5,
            "db_pool_pre_ping": True,
            "db_statement_timeout_ms": 200,
        }
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        pool = app.state.sessionmaker.kw["bind"].pool
        assert (pool.size(), pool._max_overflow, pool._timeout, pool._pre_ping) == (3, 2, 4.5, True)
        async with app.state.sessionmaker() as session:
            assert await session.scalar(text("SHOW statement_timeout")) == "200ms"
            with pytest.raises(DBAPIError, match="statement timeout"):
                await session.execute(text("SELECT pg_sleep(2)"))


def test_pool_defaults_are_bounded(tmp_path: Path) -> None:
    settings = make_test_settings(tmp_path)
    assert (settings.db_pool_size, settings.db_max_overflow, settings.db_pool_timeout_seconds) == (10, 10, 10.0)
    assert settings.db_pool_pre_ping is True
    assert settings.db_statement_timeout_ms == 15_000


# --- Migration -----------------------------------------------------------------------------------------------


def alembic(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args], cwd=BACKEND_DIR,
        env={**os.environ, "CONGRESS_DATABASE_URL": TEST_URL}, capture_output=True, text=True,
    )


async def insert_row(conn: asyncpg.Connection, table: str, values: dict[str, Any]) -> None:
    """Insert, filling every other required text column of the (older) schema with ''."""
    required = await conn.fetch(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 "
        "AND is_nullable='NO' AND column_default IS NULL AND data_type IN ('character varying', 'text')",
        table,
    )
    row = {**{r["column_name"]: "" for r in required}, **values}
    placeholders = ", ".join(f"${i}" for i in range(1, len(row) + 1))
    await conn.execute(f"INSERT INTO {table}({', '.join(row)}) VALUES({placeholders})", *row.values())


@pytest.fixture
def before_0021() -> Iterator[None]:
    """The database one revision before 0021 (whatever that revision is once the chain is merged)."""
    asyncio.run(_truncate_all())
    down = ScriptDirectory.from_config(alembic_config()).get_revision("0021").down_revision
    assert isinstance(down, str)
    result = alembic("downgrade", down)
    assert result.returncode == 0, result.stdout + result.stderr
    try:
        yield
    finally:
        asyncio.run(_truncate_all())
        result = alembic("upgrade", "head")
        assert result.returncode == 0, result.stdout + result.stderr


def test_the_migration_refuses_violating_rows_and_backfills_lead_events(before_0021: None) -> None:
    organizer_id, event_id, tier_id, booth_id = (uuid.uuid4() for _ in range(4))
    attendee, ticket_id, lead_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    async def seed() -> None:
        conn = await connect()
        try:
            starts = datetime(2027, 4, 10, tzinfo=timezone.utc)
            await insert_row(conn, "organizers", {"id": organizer_id, "name": "M", "api_key_hash": uuid.uuid4().hex})
            await insert_row(conn, "events", {
                "id": event_id, "organizer_id": organizer_id, "name": "M", "slug": f"m-{uuid.uuid4().hex[:8]}",
                "starts_at": starts, "ends_at": starts + timedelta(days=1),
            })
            # Over-reserved: refused by ck_ticket_tiers_reserved_count.
            await insert_row(conn, "ticket_tiers", {
                "id": tier_id, "event_id": event_id, "name": "T", "quota": 1, "reserved_count": 2, "is_open": True,
            })
            await insert_row(conn, "users", {"id": attendee, "mobile": "09121100099", "full_name": "A"})
            await insert_row(conn, "tickets", {
                "id": ticket_id, "event_id": event_id, "ticket_tier_id": tier_id, "user_id": attendee, "status": "active",
            })
            await insert_row(conn, "booths", {"id": booth_id, "event_id": event_id, "name": "B", "slug": "b"})
            await insert_row(conn, "leads", {
                "id": lead_id, "booth_id": booth_id, "ticket_id": ticket_id, "captured_by_user_id": attendee,
                "rating": "HOT", "tags": "[]",
            })
        finally:
            await conn.close()

    asyncio.run(seed())
    refused = alembic("upgrade", "0021")
    assert refused.returncode != 0
    assert "Migration 0021 refused" in refused.stderr
    assert f"(ck_ticket_tiers_reserved_count): {tier_id}" in refused.stderr

    asyncio.run(scalar("UPDATE ticket_tiers SET quota = 2 WHERE id=$1", tier_id))
    upgraded = alembic("upgrade", "0021")
    assert upgraded.returncode == 0, upgraded.stdout + upgraded.stderr
    assert asyncio.run(scalar("SELECT event_id FROM leads WHERE id=$1", lead_id)) == event_id
