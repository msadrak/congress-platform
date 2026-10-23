"""Gate scanner correctness: device verdicts, the online single-scan endpoint, manifest deltas and hashing,
tier-restricted point rules and batch limits (ADR 0009/0010)."""

import asyncio
import hashlib
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import event, select, update

from app.models import CheckIn, Ticket
from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _qr_hash(event_id: str, secret: str) -> str:
    return hashlib.sha256(f"{event_id}:{secret}".encode()).hexdigest()


class Gate:
    """An event with tiers, one check-in point and a paired scanner device."""

    def __init__(self, client: AsyncClient, organizer: dict[str, str], event_id: str,
                 tiers: dict[str, str], point_id: str, token: str) -> None:
        self.client, self.organizer, self.event_id = client, organizer, event_id
        self.tiers, self.point_id, self.token = tiers, point_id, token

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def attendee(self, tier_name: str = "General") -> dict[str, Any]:
        _, token = await register_user(client=self.client, mobile=f"0935{uuid.uuid4().int % 10**7:07d}")
        resp = await self.client.post(
            f"/api/events/{self.event_id}/tickets/reserve",
            json={"ticket_tier_id": self.tiers[tier_name]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201, resp.text
        return dict(resp.json())

    async def batch(self, *scans: dict[str, Any]) -> list[dict[str, Any]]:
        resp = await self.client.post(
            f"/api/checkin-points/{self.point_id}/scans/batch", json={"scans": list(scans)}, headers=self.auth
        )
        assert resp.status_code == 200, resp.text
        results: list[dict[str, Any]] = resp.json()["results"]
        return results

    async def scan(self, scan: dict[str, Any]) -> Any:
        return await self.client.post(f"/api/checkin-points/{self.point_id}/scan", json=scan, headers=self.auth)

    async def manifest(self, since: str | None = None) -> dict[str, Any]:
        resp = await self.client.get(
            f"/api/checkin-points/{self.point_id}/manifest",
            params={"since": since} if since else None,
            headers=self.auth,
        )
        assert resp.status_code == 200, resp.text
        body: dict[str, Any] = resp.json()
        return body


async def open_gate(client: AsyncClient, point: dict[str, Any]) -> Gate:
    organizer = await provision_organizer(client, "Gate Correctness Org")
    created = await client.post(
        "/api/events", json={**EVENT, "slug": f"gate-{uuid.uuid4().hex[:6]}"}, headers=bearer(organizer)
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    tiers: dict[str, str] = {}
    for name in ("General", "VIP"):
        made = await client.post(
            f"/api/events/{event_id}/ticket-tiers", json=tier(name=name, quota=100), headers=bearer(organizer)
        )
        tiers[name] = made.json()["id"]
    if point.get("policy_type") == "TIER_RESTRICTED":
        point = {**point, "allowed_tier_ids": [tiers["VIP"]]}
    made_point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", **point}, headers=bearer(organizer)
    )
    assert made_point.status_code == 201, made_point.text
    point_id = made_point.json()["id"]
    minted = await client.post(f"/api/checkin-points/{point_id}/token", headers=bearer(organizer))
    assert minted.status_code == 201, minted.text
    return Gate(client, organizer, event_id, tiers, point_id, minted.json()["scanner_token"])


def scan_of(ticket: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"], "scanned_at": _now(), **extra}


# --- 1. A scan the device rejected stays rejected ------------------------------------------------------


async def test_device_rejected_scan_is_recorded_as_rejection_and_never_admits(
    client: AsyncClient, app: FastAPI
) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    ticket = await gate.attendee()

    [result] = await gate.batch(
        scan_of(ticket, client_verdict="REJECTED", client_rejection_reason="NOT_IN_LOCAL_MANIFEST")
    )
    assert result["status"] == "REJECTED"
    assert result["rejection_reason"] == "LOCAL_REJECTED:NOT_IN_LOCAL_MANIFEST"
    assert result["attendee_name"] is not None  # linked to the ticket for the audit trail

    # Nothing was admitted: the manifest still shows the ticket unused, and a real scan admits it.
    manifest = await gate.manifest()
    assert [t["is_admitted"] for t in manifest["tickets"]] == [False]
    [admitted] = await gate.batch(scan_of(ticket))
    assert admitted["status"] == "ADMITTED"

    async with app.state.sessionmaker() as session:
        rows = (await session.scalars(select(CheckIn).order_by(CheckIn.synced_at))).all()
    assert [(r.status, r.client_verdict) for r in rows] == [("REJECTED", "REJECTED"), ("ADMITTED", None)]


async def test_scan_without_a_device_verdict_is_evaluated_as_before(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    ticket = await gate.attendee()
    [result] = await gate.batch(scan_of(ticket))
    assert result["status"] == "ADMITTED"


async def test_provisional_device_verdict_is_still_decided_by_the_server(
    client: AsyncClient, app: FastAPI
) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    ticket = await gate.attendee()
    first, second = await gate.batch(
        scan_of(ticket, client_verdict="PROVISIONAL"), scan_of(ticket, client_verdict="PROVISIONAL")
    )
    assert (first["status"], second["status"]) == ("ADMITTED", "REJECTED")
    assert second["rejection_reason"] == "ALREADY_ADMITTED"
    async with app.state.sessionmaker() as session:
        verdicts = set(await session.scalars(select(CheckIn.client_verdict)))
    assert verdicts == {"PROVISIONAL"}


# --- 3. Server-authoritative single scan -----------------------------------------------------------------


async def test_single_scan_endpoint_decides_and_is_idempotent_with_the_batch(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    ticket = await gate.attendee()
    scan = scan_of(ticket)

    first = await gate.scan(scan)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "ADMITTED"
    assert first.json()["attendee_name"]

    # The scanner timed out and queued the same scan_id offline (with its own provisional verdict).
    [replayed] = await gate.batch({**scan, "client_verdict": "REJECTED", "client_rejection_reason": "X"})
    assert replayed["status"] == "ADMITTED"
    assert replayed["scan_id"] == scan["scan_id"]

    again = await gate.scan(scan_of(ticket))
    assert again.json()["status"] == "REJECTED"
    assert again.json()["rejection_reason"] == "ALREADY_ADMITTED"


async def test_concurrent_single_scans_of_one_single_use_ticket_admit_once(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    ticket = await gate.attendee()
    responses = await asyncio.gather(
        gate.scan(scan_of(ticket)), gate.scan(scan_of(ticket)), gate.batch(scan_of(ticket))
    )
    statuses = [responses[0].json()["status"], responses[1].json()["status"], responses[2][0]["status"]]
    assert sorted(statuses) == ["ADMITTED", "REJECTED", "REJECTED"]


async def test_single_scan_capacity_is_enforced(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "CAPACITY_CAPPED", "max_capacity": 1})
    first, second = await gate.attendee(), await gate.attendee()
    assert (await gate.scan(scan_of(first))).json()["status"] == "ADMITTED"
    rejected = (await gate.scan(scan_of(second))).json()
    assert (rejected["status"], rejected["rejection_reason"]) == ("REJECTED", "CAPACITY_REACHED")


# --- 4/5. Manifest: hashed secrets, tier restriction, deltas ---------------------------------------------


async def test_manifest_carries_hashed_secrets_only(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    ticket = await gate.attendee()
    manifest = await gate.manifest()
    [entry] = manifest["tickets"]
    assert "qr_secret" not in entry
    assert ticket["qr_secret"] not in str(manifest)
    assert entry["qr_hash"] == _qr_hash(gate.event_id, ticket["qr_secret"])
    assert manifest["is_delta"] is False
    assert manifest["cursor"]


async def test_tier_restricted_manifest_only_lists_allowed_tiers(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "TIER_RESTRICTED"})
    vip, general = await gate.attendee("VIP"), await gate.attendee("General")
    hashes = {t["qr_hash"] for t in (await gate.manifest())["tickets"]}
    assert hashes == {_qr_hash(gate.event_id, vip["qr_secret"])}
    [rejected] = await gate.batch(scan_of(general))
    assert rejected["rejection_reason"] == "TIER_NOT_ALLOWED"


async def test_manifest_delta_returns_new_tickets_admissions_and_removals(
    client: AsyncClient, app: FastAPI
) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    early, cancelled = await gate.attendee(), await gate.attendee()
    full = await gate.manifest()
    assert len(full["tickets"]) == 2

    # Unchanged since the cursor: the overlap window may repeat recent tickets, but nothing is removed.
    quiet = await gate.manifest(since=full["cursor"])
    assert quiet["is_delta"] is True
    assert quiet["removed_qr_hashes"] == []

    walk_in = await gate.attendee()  # issued after the scanner was paired
    await gate.batch(scan_of(early))  # admitted at this single-use point
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(Ticket).where(Ticket.id == uuid.UUID(cancelled["id"])).values(status="cancelled")
        )
        await session.commit()

    delta = await gate.manifest(since=full["cursor"])
    assert delta["is_delta"] is True
    by_hash = {t["qr_hash"]: t for t in delta["tickets"]}
    assert _qr_hash(gate.event_id, walk_in["qr_secret"]) in by_hash
    assert by_hash[_qr_hash(gate.event_id, early["qr_secret"])]["is_admitted"] is True
    assert _qr_hash(gate.event_id, cancelled["qr_secret"]) not in by_hash
    assert delta["removed_qr_hashes"] == [_qr_hash(gate.event_id, cancelled["qr_secret"])]
    assert delta["cursor"] >= full["cursor"]


async def test_manifest_delta_window_excludes_old_unchanged_tickets(client: AsyncClient, app: FastAPI) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    old = await gate.attendee()
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(Ticket)
            .where(Ticket.id == uuid.UUID(old["id"]))
            .values(created_at=datetime.now(timezone.utc) - timedelta(hours=2))
        )
        await session.commit()
    cursor = (await gate.manifest())["cursor"]
    new = await gate.attendee()
    delta = await gate.manifest(since=cursor)
    assert [t["qr_hash"] for t in delta["tickets"]] == [_qr_hash(gate.event_id, new["qr_secret"])]


async def test_unusable_manifest_cursor_returns_the_full_manifest(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    await gate.attendee()
    for cursor in ("not-a-date", "2020-01-01T00:00:00", (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()):
        manifest = await gate.manifest(since=cursor)
        assert manifest["is_delta"] is False
        assert len(manifest["tickets"]) == 1


# --- 8. Tier-restricted points need tiers -----------------------------------------------------------------


async def test_tier_restricted_point_without_tiers_is_refused(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    url = f"/api/events/{gate.event_id}/checkin-points"
    created = await client.post(
        url, json={"name": "VIP", "policy_type": "TIER_RESTRICTED"}, headers=bearer(gate.organizer)
    )
    assert created.status_code == 422, created.text

    switched = await client.patch(
        f"{url}/{gate.point_id}", json={"policy_type": "TIER_RESTRICTED"}, headers=bearer(gate.organizer)
    )
    assert switched.status_code == 422, switched.text

    vip_point = await client.post(
        url,
        json={"name": "VIP", "policy_type": "TIER_RESTRICTED", "allowed_tier_ids": [gate.tiers["VIP"]]},
        headers=bearer(gate.organizer),
    )
    assert vip_point.status_code == 201
    cleared = await client.patch(
        f"{url}/{vip_point.json()['id']}", json={"allowed_tier_ids": []}, headers=bearer(gate.organizer)
    )
    assert cleared.status_code == 422, cleared.text


# --- 9. Batch limits and device clocks ---------------------------------------------------------------------


async def test_batch_is_limited_to_200_scans(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    scans = [{"scan_id": str(uuid.uuid4()), "qr_secret": "nope", "scanned_at": _now()} for _ in range(201)]
    resp = await client.post(
        f"/api/checkin-points/{gate.point_id}/scans/batch", json={"scans": scans}, headers=gate.auth
    )
    assert resp.status_code == 422
    accepted = await gate.batch(*scans[:200])
    assert len(accepted) == 200


async def test_scan_time_must_carry_a_timezone(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    ticket = await gate.attendee()
    resp = await gate.scan({**scan_of(ticket), "scanned_at": "2026-10-22T10:00:00"})
    assert resp.status_code == 422


async def test_scan_from_a_fast_device_clock_is_recorded_at_receive_time_and_flagged(
    client: AsyncClient, app: FastAPI
) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    ticket = await gate.attendee()
    claimed = datetime.now(timezone.utc) + timedelta(hours=3)
    slightly_fast = datetime.now(timezone.utc) + timedelta(minutes=2)
    skewed, fine = await gate.batch(
        scan_of(ticket, scanned_at=claimed.isoformat()), scan_of(ticket, scanned_at=slightly_fast.isoformat())
    )
    assert (skewed["status"], skewed["clock_skew"]) == ("ADMITTED", True)
    assert fine["clock_skew"] is False

    async with app.state.sessionmaker() as session:
        row = await session.get(CheckIn, uuid.UUID(skewed["scan_id"]))
    assert row is not None
    assert row.clock_skew is True
    assert row.client_scanned_at == claimed
    assert row.scanned_at < claimed - timedelta(hours=2)


# --- 10. One query per batch for its tickets -----------------------------------------------------------------


@contextmanager
def count_statements(app: FastAPI) -> Iterator[list[str]]:
    engine = app.state.sessionmaker.kw["bind"].sync_engine
    statements: list[str] = []

    def record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def test_batch_queries_do_not_grow_with_its_size(client: AsyncClient, app: FastAPI) -> None:
    gate = await open_gate(client, {"policy_type": "SINGLE_USE"})
    tickets = [await gate.attendee() for _ in range(6)]

    with count_statements(app) as small:
        await gate.batch(scan_of(tickets[0]))
    with count_statements(app) as large:
        await gate.batch(*(scan_of(t) for t in tickets[1:]))

    lookups = [s for s in large if "FROM entity_qrs" in s]
    assert len(lookups) == 1
    # Each new scan costs its own savepoint + INSERT; everything else is per batch.
    per_scan = 3  # SAVEPOINT, INSERT, RELEASE SAVEPOINT
    assert len(large) - len(small) <= per_scan * (len(tickets) - 2)
