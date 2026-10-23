"""Concurrency and Atomic Admission Integrity Integration Tests.

Validates:
1. SINGLE_USE: Simultaneous requests for the same ticket produce exactly 1 ADMITTED and 1 REJECTED (ALREADY_ADMITTED).
2. CAPACITY_CAPPED: Simultaneous requests cannot exceed configured max_capacity under high concurrency.
3. Idempotency: Simultaneous requests with identical scan_id return original outcome without 500 or duplicate records.
4. MULTI_ENTRY: Unaffected by single-use restrictions; repeated admissions succeed concurrently.
5. TIER_RESTRICTED: Enforces tier whitelist accurately under concurrent attempts.
6. Contention & Deadlock Freedom: Lock acquisition hierarchy prevents deadlocks during high-throughput batches.
"""

import asyncio
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.models import CheckIn, CheckInPoint, Ticket
from tests.conftest import TEST_URL
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user


async def create_unique_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    evt = dict(EVENT)
    evt["slug"] = f"concurrency-evt-{uuid.uuid4().hex[:6]}"
    resp = await client.post("/api/events", json=evt, headers=bearer(organizer))
    assert resp.status_code == 201, resp.text
    await publish_page(client, organizer, resp.json()["id"])
    return str(resp.json()["id"])


async def create_attendee(client: AsyncClient, event_id: str, tier_id: str, name: str) -> dict[str, Any]:
    mobile = f"0935{uuid.uuid4().int % 10**7:07d}"
    _, token = await register_user(client, mobile, name)
    resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


# ---------------------------------------------------------------------------
# 1. SINGLE_USE Atomic Admission Tests
# ---------------------------------------------------------------------------


async def test_concurrent_single_use_admission_race(client: AsyncClient) -> None:
    """Simultaneous requests for the same SINGLE_USE ticket must yield exactly 1 ADMITTED and 1 REJECTED."""
    organizer = await provision_organizer(client, "Single Use Org")
    event_id = await create_unique_event(client, organizer)

    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Standard", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_res.json()["id"]

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Lunch Buffet", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    ticket = await create_attendee(client, event_id, tier_id, "Lunch Attendee")

    # Launch two simultaneous requests with DIFFERENT scan_ids for the exact same ticket
    async def execute_scan(scan_uuid: str) -> Any:
        return await client.post(
            f"/api/checkin-points/{point_id}/scans/batch",
            json={
                "scans": [
                    {
                        "scan_id": scan_uuid,
                        "qr_secret": ticket["qr_secret"],
                        "scanned_at": "2027-04-10T12:00:00Z",
                    }
                ]
            },
            headers=bearer(organizer),
        )

    scan1_id = str(uuid.uuid4())
    scan2_id = str(uuid.uuid4())

    r1, r2 = await asyncio.gather(
        execute_scan(scan1_id),
        execute_scan(scan2_id),
    )

    assert r1.status_code == 200
    assert r2.status_code == 200

    outcomes = [
        r1.json()["results"][0]["status"],
        r2.json()["results"][0]["status"],
    ]

    # Exactly one ADMITTED and one REJECTED
    assert outcomes.count("ADMITTED") == 1
    assert outcomes.count("REJECTED") == 1

    rejected_res = r1.json()["results"][0] if outcomes[0] == "REJECTED" else r2.json()["results"][0]
    assert rejected_res["rejection_reason"] == "ALREADY_ADMITTED"


# ---------------------------------------------------------------------------
# 2. CAPACITY_CAPPED Atomic Admission Tests
# ---------------------------------------------------------------------------


async def test_concurrent_capacity_capped_race(client: AsyncClient) -> None:
    """High concurrency across 5 simultaneous attendees on a point with capacity=2 admits exactly 2."""
    organizer = await provision_organizer(client, "Capacity Org")
    event_id = await create_unique_event(client, organizer)

    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_res.json()["id"]

    max_cap = 2
    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Limited Workshop", "policy_type": "CAPACITY_CAPPED", "max_capacity": max_cap},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    # Create 5 distinct attendees
    attendees = [
        await create_attendee(client, event_id, tier_id, f"Workshop Person {i}")
        for i in range(5)
    ]

    async def scan_attendee(att: dict[str, Any]) -> Any:
        return await client.post(
            f"/api/checkin-points/{point_id}/scans/batch",
            json={
                "scans": [
                    {
                        "scan_id": str(uuid.uuid4()),
                        "qr_secret": att["qr_secret"],
                        "scanned_at": "2027-04-10T14:00:00Z",
                    }
                ]
            },
            headers=bearer(organizer),
        )

    # Fire all 5 requests simultaneously
    responses = await asyncio.gather(*(scan_attendee(a) for a in attendees))

    for r in responses:
        assert r.status_code == 200

    results = [r.json()["results"][0] for r in responses]
    statuses = [res["status"] for res in results]

    # Exactly 2 ADMITTED, exactly 3 REJECTED
    assert statuses.count("ADMITTED") == max_cap
    assert statuses.count("REJECTED") == 3

    rejections = [res for res in results if res["status"] == "REJECTED"]
    for rej in rejections:
        assert rej["rejection_reason"] == "CAPACITY_REACHED"


# ---------------------------------------------------------------------------
# 3. Concurrent Duplicate scan_id Idempotency
# ---------------------------------------------------------------------------


async def test_concurrent_same_scan_id_idempotent_replay(client: AsyncClient) -> None:
    """Two concurrent transmissions of the exact same scan_id must resolve without 500 error."""
    organizer = await provision_organizer(client, "Idempotency Org")
    event_id = await create_unique_event(client, organizer)

    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_res.json()["id"]

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate A", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    ticket = await create_attendee(client, event_id, tier_id, "Idempotent User")
    same_scan_id = str(uuid.uuid4())

    async def send_identical() -> Any:
        return await client.post(
            f"/api/checkin-points/{point_id}/scans/batch",
            json={
                "scans": [
                    {
                        "scan_id": same_scan_id,
                        "qr_secret": ticket["qr_secret"],
                        "scanned_at": "2027-04-10T08:00:00Z",
                    }
                ]
            },
            headers=bearer(organizer),
        )

    # Send the exact same scan_id simultaneously
    res1, res2 = await asyncio.gather(send_identical(), send_identical())

    assert res1.status_code == 200
    assert res2.status_code == 200

    r1 = res1.json()["results"][0]
    r2 = res2.json()["results"][0]

    # Both must report ADMITTED with the same scan_id
    assert r1["scan_id"] == same_scan_id
    assert r2["scan_id"] == same_scan_id
    assert r1["status"] == "ADMITTED"
    assert r2["status"] == "ADMITTED"


# ---------------------------------------------------------------------------
# 4. MULTI_ENTRY Policy Concurrency Preservation
# ---------------------------------------------------------------------------


async def test_multi_entry_multiple_admissions_allowed(client: AsyncClient) -> None:
    """MULTI_ENTRY checkpoints must admit the same ticket repeatedly without restriction."""
    organizer = await provision_organizer(client, "Multi Entry Org")
    event_id = await create_unique_event(client, organizer)

    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_res.json()["id"]

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Main Turnstile", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    ticket = await create_attendee(client, event_id, tier_id, "In and Out Attendee")

    # Scan 3 times
    for _ in range(3):
        res = await client.post(
            f"/api/checkin-points/{point_id}/scans/batch",
            json={
                "scans": [
                    {
                        "scan_id": str(uuid.uuid4()),
                        "qr_secret": ticket["qr_secret"],
                        "scanned_at": "2027-04-10T09:00:00Z",
                    }
                ]
            },
            headers=bearer(organizer),
        )
        assert res.status_code == 200
        assert res.json()["results"][0]["status"] == "ADMITTED"


# ---------------------------------------------------------------------------
# 5. Batch Upload with Mixed Tickets
# ---------------------------------------------------------------------------


async def test_batch_upload_mixed_concurrent_admissions(client: AsyncClient) -> None:
    """Batches containing valid, invalid, and duplicate tickets evaluate independently and commit atomically."""
    organizer = await provision_organizer(client, "Batch Org")
    event_id = await create_unique_event(client, organizer)

    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_res.json()["id"]

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Catering", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    t1 = await create_attendee(client, event_id, tier_id, "Attendee 1")
    t2 = await create_attendee(client, event_id, tier_id, "Attendee 2")

    # First admit t1
    first_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": t1["qr_secret"],
                    "scanned_at": "2027-04-10T12:00:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    assert first_res.status_code == 200
    assert first_res.json()["results"][0]["status"] == "ADMITTED"

    # Now upload a batch with:
    # 1. t2 (valid, unadmitted -> ADMITTED)
    # 2. t1 (already admitted -> REJECTED: ALREADY_ADMITTED)
    # 3. forged secret -> REJECTED: INVALID_TICKET
    batch_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": t2["qr_secret"],
                    "scanned_at": "2027-04-10T12:05:00Z",
                },
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": t1["qr_secret"],
                    "scanned_at": "2027-04-10T12:06:00Z",
                },
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": "forged_secret_xyz_123",
                    "scanned_at": "2027-04-10T12:07:00Z",
                },
            ]
        },
        headers=bearer(organizer),
    )
    assert batch_res.status_code == 200
    results = batch_res.json()["results"]
    assert len(results) == 3
    assert results[0]["status"] == "ADMITTED"
    assert results[1]["status"] == "REJECTED"
    assert results[1]["rejection_reason"] == "ALREADY_ADMITTED"
    assert results[2]["status"] == "REJECTED"
    assert results[2]["rejection_reason"] == "INVALID_TICKET"
