"""The analytics dashboard aggregates in PostgreSQL: its cost must not grow with Python-side row loading.

5,000 tickets and 20,000 scans are seeded directly (the scan route would take minutes) and the dashboard
and both CSV exports are read through HTTP, timing each request and counting the SQL statements it issues.
"""

import secrets
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import event as sa_event
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncEngine

from app.models import CheckIn, CheckInPoint, Ticket, TicketTier, User
from tests.helpers import bearer, provision_organizer
from tests.test_ticket_tiers import create_event

TICKETS = 5_000
SCANS = 20_000
# Generous for a shared Docker host; the old Python-side loop was well past this at this size.
DASHBOARD_SECONDS = 3.0
CSV_SECONDS = 10.0
MAX_DASHBOARD_STATEMENTS = 10


@contextmanager
def counted_statements(app: FastAPI) -> Iterator[list[str]]:
    engine: AsyncEngine = app.state.sessionmaker.kw["bind"]
    statements: list[str] = []

    def record(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        statements.append(statement)

    sa_event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        sa_event.remove(engine.sync_engine, "before_cursor_execute", record)


async def seed(app: FastAPI, event_id: uuid.UUID) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Two tiers, four gates (one SINGLE_USE lunch), 5,000 tickets, 20,000 scans over three days."""
    tier_ids = [uuid.uuid4(), uuid.uuid4()]
    point_ids = [uuid.uuid4() for _ in range(4)]
    policies = ["MULTI_ENTRY", "MULTI_ENTRY", "MULTI_ENTRY", "SINGLE_USE"]
    users = [{"id": uuid.uuid4(), "mobile": None, "full_name": f"Attendee {i}"} for i in range(TICKETS)]
    tickets = [
        {
            "id": uuid.uuid4(),
            "event_id": event_id,
            "ticket_tier_id": tier_ids[i % 2],
            "user_id": user["id"],
            "attendee_full_name": user["full_name"],
            "status": "cancelled" if i % 50 == 0 else "active",
        }
        for i, user in enumerate(users)
    ]
    start = datetime(2027, 4, 10, 5, 0, tzinfo=UTC)
    scans: list[dict[str, Any]] = []
    for i in range(SCANS):
        ticket = tickets[i % TICKETS]
        # Each ticket is scanned four times, once at every gate, so lunch (SINGLE_USE, at most one admission
        # per ticket: uq_checkin_single_use_admitted) admits every ticket once; every tenth ticket is refused
        # at the other gates.
        gate = (i + i // TICKETS) % 4
        admitted = gate == 3 or i % 10 != 0
        scans.append(
            {
                "id": uuid.uuid4(),
                "checkin_point_id": point_ids[gate],
                "ticket_id": ticket["id"],
                "qr_secret": secrets.token_hex(8),
                "policy_type": policies[gate],
                "status": "ADMITTED" if admitted else "REJECTED",
                "rejection_reason": None if admitted else "ALREADY_ADMITTED",
                "scanned_at": start + timedelta(minutes=(i * 13) % (3 * 24 * 60)),
            }
        )
    async with app.state.sessionmaker() as session:
        await session.execute(
            insert(TicketTier),
            [{"id": t, "event_id": event_id, "name": f"Tier {n}", "quota": TICKETS} for n, t in enumerate(tier_ids)],
        )
        await session.execute(
            insert(CheckInPoint),
            [
                {"id": p, "event_id": event_id, "name": f"Gate {n}", "policy_type": policies[n], "allowed_tier_ids": []}
                for n, p in enumerate(point_ids)
            ],
        )
        await session.execute(insert(User), users)
        await session.execute(insert(Ticket), tickets)
        for chunk in range(0, SCANS, 5_000):
            await session.execute(insert(CheckIn), scans[chunk : chunk + 5_000])
        await session.commit()
    return tier_ids, point_ids


async def test_dashboard_and_exports_stay_bounded_at_congress_scale(app: FastAPI, client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Scale Co")
    event_id = await create_event(client, organizer)
    tier_ids, point_ids = await seed(app, uuid.UUID(event_id))

    url = f"/api/events/{event_id}/analytics/attendance"
    with counted_statements(app) as statements:
        started = time.perf_counter()
        response = await client.get(url, headers=bearer(organizer))
        elapsed = time.perf_counter() - started
    assert response.status_code == 200, response.text
    data = response.json()
    print(f"\ndashboard: {elapsed:.3f}s, {len(statements)} statements")
    assert elapsed < DASHBOARD_SECONDS
    assert len(statements) <= MAX_DASHBOARD_STATEMENTS

    assert data["total_scans"] == SCANS
    assert data["total_tickets"] == TICKETS - TICKETS // 50
    assert {s["status"]: s["count"] for s in data["tickets_by_status"]} == {
        "active": TICKETS - TICKETS // 50,
        "cancelled": TICKETS // 50,
    }
    assert sum(g["total_admitted"] + g["total_rejected"] for g in data["gate_breakdown"]) == SCANS
    assert sum(b["count"] for b in data["hourly_scans"]) == SCANS
    assert data["catering_metrics"][0]["meals_served"] == TICKETS
    assert data["unique_admitted"] == TICKETS
    assert len(data["days"]) >= 3

    # Filters keep the statement count bounded too.
    with counted_statements(app) as statements:
        filtered = await client.get(
            url,
            params={"point_id": str(point_ids[0]), "ticket_tier_id": str(tier_ids[0]), "day": "2027-04-11"},
            headers=bearer(organizer),
        )
    assert filtered.status_code == 200, filtered.text
    assert len(statements) <= MAX_DASHBOARD_STATEMENTS

    for path, rows in (("export-csv", SCANS), ("registrations-csv", TICKETS)):
        started = time.perf_counter()
        exported = await client.get(f"/api/events/{event_id}/analytics/{path}", headers=bearer(organizer))
        elapsed = time.perf_counter() - started
        assert exported.status_code == 200, exported.text
        print(f"{path}: {elapsed:.3f}s, {len(exported.content)} bytes")
        assert elapsed < CSV_SECONDS
        assert exported.content.decode("utf-8-sig").count("\r\n") == rows + 1
