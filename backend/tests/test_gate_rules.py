"""Gate rules (ADR 0004/0010, migration 0025): admission windows, occupancy with entry and exit scans, the tier
filter on every policy, required points, session doors and their attendance, device heartbeats, point archive.

The rule scenarios shared with the web scanner's local engine live in `fixtures/gate_parity.json`."""

import csv
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select, update

from app.models import AuditEvent, CheckIn, ScannerDevice
from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_scanner_correctness import open_gate
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user

PARITY = json.loads((Path(__file__).parent / "fixtures" / "gate_parity.json").read_text(encoding="utf-8"))


class Congress:
    """An event with General and VIP tiers; check-in points and attendees are added by the tests."""

    def __init__(self, client: AsyncClient, organizer: dict[str, str], event_id: str, tiers: dict[str, str]) -> None:
        self.client, self.organizer, self.event_id, self.tiers = client, organizer, event_id, tiers

    @property
    def auth(self) -> dict[str, str]:
        return bearer(self.organizer)

    async def point(self, expect: int = 201, **body: Any) -> dict[str, Any]:
        resp = await self.client.post(
            f"/api/events/{self.event_id}/checkin-points", json={"name": "Gate", **body}, headers=self.auth
        )
        assert resp.status_code == expect, resp.text
        result: dict[str, Any] = resp.json()
        return result

    async def patch_point(self, point_id: str, **body: Any) -> Any:
        return await self.client.patch(
            f"/api/events/{self.event_id}/checkin-points/{point_id}", json=body, headers=self.auth
        )

    async def attendee(self, tier_name: str = "General", name: str = "Test Attendee") -> dict[str, Any]:
        _, token = await register_user(self.client, f"0936{uuid.uuid4().int % 10**7:07d}", name)
        resp = await self.client.post(
            f"/api/events/{self.event_id}/tickets/reserve",
            json={"ticket_tier_id": self.tiers[tier_name]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201, resp.text
        return dict(resp.json())

    async def scan(
        self, point_id: str, ticket: dict[str, Any], at: str | None = None, direction: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "scan_id": str(uuid.uuid4()),
            "qr_secret": ticket["qr_secret"],
            "scanned_at": at or datetime.now(timezone.utc).isoformat(),
        }
        if direction:
            body["direction"] = direction
        resp = await self.client.post(f"/api/checkin-points/{point_id}/scan", json=body, headers=headers or self.auth)
        assert resp.status_code == 200, resp.text
        result: dict[str, Any] = resp.json()
        return result

    async def manifest(self, point_id: str, since: str | None = None) -> dict[str, Any]:
        resp = await self.client.get(
            f"/api/checkin-points/{point_id}/manifest", params={"since": since} if since else None, headers=self.auth
        )
        assert resp.status_code == 200, resp.text
        result: dict[str, Any] = resp.json()
        return result

    async def device(self, point_id: str) -> dict[str, str]:
        minted = await self.client.post(
            f"/api/checkin-points/{point_id}/token", json={"device_name": "Door A"}, headers=self.auth
        )
        assert minted.status_code == 201, minted.text
        return {"Authorization": f"Bearer {minted.json()['scanner_token']}", "device_id": minted.json()["device_id"]}


async def congress(client: AsyncClient, name: str = "Gate Rules Org") -> Congress:
    organizer = await provision_organizer(client, name)
    created = await client.post(
        "/api/events", json={**EVENT, "slug": f"rules-{uuid.uuid4().hex[:6]}"}, headers=bearer(organizer)
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    tiers: dict[str, str] = {}
    for tier_name in ("General", "VIP"):
        made = await client.post(
            f"/api/events/{event_id}/ticket-tiers", json=tier(name=tier_name, quota=100), headers=bearer(organizer)
        )
        tiers[tier_name] = made.json()["id"]
    await publish_page(client, organizer, event_id)
    return Congress(client, organizer, event_id, tiers)


def verdict(result: dict[str, Any]) -> str:
    return str(result["status"] if result["status"] == "ADMITTED" else result["rejection_reason"])


# --- Client/server parity scenarios --------------------------------------------------------------------------


async def test_parity_scenarios_are_decided_by_the_server_as_the_fixture_says(client: AsyncClient) -> None:
    assert PARITY["timezone"] == "Asia/Tehran"  # the events' default zone
    for scenario in PARITY["scenarios"]:
        c = await congress(client, f"Parity {scenario['name'][:40]}")
        spec = scenario["point"]
        body: dict[str, Any] = {
            key: spec[key] for key in ("policy_type", "reset_window", "tracks_occupancy", "max_capacity") if key in spec
        }
        body["allowed_tier_ids"] = [c.tiers[name] for name in spec.get("allowed_tiers", [])]
        parent_id = None
        if spec.get("requires_parent"):
            parent_id = (await c.point(name="Entrance"))["id"]
            body["requires_point_id"] = parent_id
        point_id = (await c.point(**body))["id"]
        tickets = {key: await c.attendee(tier_name) for key, tier_name in scenario["tickets"].items()}
        start = datetime.fromisoformat(scenario["start"].replace("Z", "+00:00"))
        for index, step in enumerate(scenario["steps"]):
            at = step.get("at") or (start + timedelta(minutes=index)).isoformat()
            if step.get("parent"):
                assert parent_id is not None
                assert verdict(await c.scan(parent_id, tickets[step["ticket"]], at)) == "ADMITTED"
                continue
            result = await c.scan(point_id, tickets[step["ticket"]], at, step.get("direction"))
            assert verdict(result) == step["expect"], (scenario["name"], index, result)
            assert result["direction"] == step.get("direction", "IN")


# --- Admission windows ---------------------------------------------------------------------------------------


async def test_day_window_follows_the_event_time_zone_and_is_stored_per_scan(client: AsyncClient, app: FastAPI) -> None:
    c = await congress(client)
    point = await c.point(name="Lunch", policy_type="SINGLE_USE", reset_window="DAY")
    assert point["reset_window"] == "DAY"
    ticket = await c.attendee()
    # 23:59 and 00:01 in Tehran (UTC+03:30) fall on the same UTC date: a UTC window would refuse the second meal.
    assert verdict(await c.scan(point["id"], ticket, "2025-11-10T20:29:00Z")) == "ADMITTED"
    assert verdict(await c.scan(point["id"], ticket, "2025-11-10T20:29:40Z")) == "ALREADY_ADMITTED"
    assert verdict(await c.scan(point["id"], ticket, "2025-11-10T20:31:00Z")) == "ADMITTED"
    async with app.state.sessionmaker() as session:
        rows = (await session.execute(
            select(CheckIn.admission_window, CheckIn.status).order_by(CheckIn.scanned_at)
        )).all()
    assert [tuple(r) for r in rows] == [
        ("2025-11-10", "ADMITTED"), ("2025-11-10", "REJECTED"), ("2025-11-11", "ADMITTED")
    ]

    manifest = await c.manifest(point["id"])
    assert manifest["event_timezone"] == "Asia/Tehran"
    today = manifest["admission_window"]
    assert len(today) == 10 and today != "2025-11-11"  # the current Tehran date
    [entry] = manifest["tickets"]
    # Yesterday's meal does not count today; the device compares the window itself after midnight.
    assert entry["last_admitted_window"] == "2025-11-11"
    assert entry["is_admitted"] is False
    assert entry["admission_count"] == 2

    # Today's meal: admitted once, and the manifest says so.
    assert verdict(await c.scan(point["id"], ticket)) == "ADMITTED"
    [entry] = (await c.manifest(point["id"]))["tickets"]
    assert entry["is_admitted"] is True and entry["last_admitted_window"] == today


async def test_event_window_point_stores_the_event_window(client: AsyncClient, app: FastAPI) -> None:
    c = await congress(client)
    point = await c.point(policy_type="SINGLE_USE")
    assert point["reset_window"] == "EVENT"
    ticket = await c.attendee()
    await c.scan(point["id"], ticket)
    manifest = await c.manifest(point["id"])
    assert manifest["admission_window"] == "event"
    assert manifest["tickets"][0]["last_admitted_window"] == "event"
    async with app.state.sessionmaker() as session:
        assert await session.scalar(select(CheckIn.admission_window)) == "event"


async def test_delta_across_a_day_boundary_is_a_full_manifest(client: AsyncClient) -> None:
    c = await congress(client)
    point = await c.point(policy_type="SINGLE_USE", reset_window="DAY")
    await c.attendee()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    # Every admission of yesterday is void today: a delta could not say so, the full manifest does.
    manifest = await c.manifest(point["id"], since=yesterday)
    assert manifest["is_delta"] is False and len(manifest["tickets"]) == 1
    recent = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    assert (await c.manifest(point["id"], since=recent))["is_delta"] is True


async def test_rules_lock_once_scans_exist(client: AsyncClient) -> None:
    c = await congress(client)
    point = await c.point(policy_type="SINGLE_USE")
    assert (await c.patch_point(point["id"], reset_window="DAY")).status_code == 200
    await c.scan(point["id"], await c.attendee())
    changes = ({"reset_window": "EVENT"}, {"policy_type": "MULTI_ENTRY"}, {"policy_type": "MULTI_ENTRY", "tracks_occupancy": True})
    for change in changes:
        locked = await c.patch_point(point["id"], **change)
        assert locked.status_code == 409, locked.text
        assert locked.json()["code"] == "CHECKIN_POINT_POLICY_LOCKED"
    # Saving the same values (what the edit form sends) is not a change.
    same = await c.patch_point(point["id"], name="Lunch", reset_window="DAY", policy_type="SINGLE_USE")
    assert same.status_code == 200, same.text


# --- Occupancy -----------------------------------------------------------------------------------------------


async def test_occupancy_counts_people_inside_and_rejects_strangers_leaving(client: AsyncClient, app: FastAPI) -> None:
    c = await congress(client)
    hall = await c.point(name="Hall", policy_type="CAPACITY_CAPPED", max_capacity=2, tracks_occupancy=True)
    a, b, d = await c.attendee(), await c.attendee(), await c.attendee()
    assert verdict(await c.scan(hall["id"], a)) == "ADMITTED"
    assert verdict(await c.scan(hall["id"], a)) == "ADMITTED"  # re-entry while inside: not counted twice
    assert verdict(await c.scan(hall["id"], b)) == "ADMITTED"
    assert verdict(await c.scan(hall["id"], d)) == "CAPACITY_REACHED"
    out = await c.scan(hall["id"], a, direction="OUT")
    assert (out["status"], out["direction"]) == ("ADMITTED", "OUT")
    assert verdict(await c.scan(hall["id"], a, direction="OUT")) == "NOT_INSIDE"
    assert verdict(await c.scan(hall["id"], d)) == "ADMITTED"

    manifest = await c.manifest(hall["id"])
    assert manifest["occupancy"] == 2
    inside = {t["ticket_id"]: t["is_inside"] for t in manifest["tickets"]}
    assert inside == {a["id"]: False, b["id"]: True, d["id"]: True}
    assert all(t["presence_at"] for t in manifest["tickets"])

    analytics = await client.get(f"/api/events/{c.event_id}/analytics/attendance", headers=c.auth)
    [gate] = analytics.json()["gate_breakdown"]
    assert gate["occupancy"] == 2
    assert gate["admissions"] == 4  # entries only; exits are not admissions
    assert gate["total_rejected"] == 2
    async with app.state.sessionmaker() as session:
        directions = (await session.scalars(select(CheckIn.direction).order_by(CheckIn.scanned_at))).all()
    assert directions.count("OUT") == 2


async def test_occupancy_needs_a_policy_that_admits_more_than_once(client: AsyncClient) -> None:
    c = await congress(client)
    refused = await c.point(expect=422, policy_type="SINGLE_USE", tracks_occupancy=True)
    assert refused["code"] == "OCCUPANCY_POLICY_UNSUPPORTED"
    point = await c.point(policy_type="MULTI_ENTRY", tracks_occupancy=True)
    manifest = await c.manifest(point["id"])
    assert manifest["occupancy"] == 0 and manifest["checkin_point"]["tracks_occupancy"] is True
    plain = await c.point(policy_type="MULTI_ENTRY")
    assert (await c.manifest(plain["id"]))["occupancy"] is None


async def test_offline_exit_synced_late_does_not_override_a_later_entry(client: AsyncClient) -> None:
    c = await congress(client)
    hall = await c.point(policy_type="MULTI_ENTRY", tracks_occupancy=True)
    a = await c.attendee()
    now = datetime.now(timezone.utc)
    await c.scan(hall["id"], a, (now - timedelta(minutes=30)).isoformat())
    await c.scan(hall["id"], a, (now - timedelta(minutes=5)).isoformat())  # back in at another door
    # A door that was offline uploads the exit it saw in between: accepted, but the later entry stands.
    late = await c.scan(hall["id"], a, (now - timedelta(minutes=20)).isoformat(), "OUT")
    assert verdict(late) == "ADMITTED"
    manifest = await c.manifest(hall["id"])
    assert manifest["occupancy"] == 1 and manifest["tickets"][0]["is_inside"] is True


# --- Tier filter with any policy ------------------------------------------------------------------------------


async def test_tier_filter_applies_to_every_policy_and_scopes_the_manifest(client: AsyncClient) -> None:
    c = await congress(client)
    vip_lunch = await c.point(policy_type="SINGLE_USE", allowed_tier_ids=[c.tiers["VIP"]])
    general, vip = await c.attendee("General"), await c.attendee("VIP")
    assert [t["ticket_id"] for t in (await c.manifest(vip_lunch["id"]))["tickets"]] == [vip["id"]]
    assert verdict(await c.scan(vip_lunch["id"], general)) == "TIER_NOT_ALLOWED"
    assert verdict(await c.scan(vip_lunch["id"], vip)) == "ADMITTED"
    assert verdict(await c.scan(vip_lunch["id"], vip)) == "ALREADY_ADMITTED"

    capped = await c.point(policy_type="CAPACITY_CAPPED", max_capacity=5, allowed_tier_ids=[c.tiers["General"]])
    assert verdict(await c.scan(capped["id"], vip)) == "TIER_NOT_ALLOWED"
    assert verdict(await c.scan(capped["id"], general)) == "ADMITTED"


# --- Required points (hierarchy) ------------------------------------------------------------------------------


async def test_required_point_must_admit_first_and_the_manifest_follows_it(client: AsyncClient) -> None:
    c = await congress(client)
    entrance = await c.point(name="Entrance")
    hall = await c.point(name="Hall A", requires_point_id=entrance["id"])
    assert hall["requires_point_id"] == entrance["id"]
    ticket = await c.attendee()
    first = await c.manifest(hall["id"])
    assert first["tickets"][0]["prerequisite_met"] is False
    assert verdict(await c.scan(hall["id"], ticket)) == "REQUIRED_POINT_NOT_VISITED"

    await c.scan(entrance["id"], ticket)
    delta = await c.manifest(hall["id"], since=first["cursor"])
    assert delta["is_delta"] is True
    assert [(t["ticket_id"], t["prerequisite_met"]) for t in delta["tickets"]] == [(ticket["id"], True)]
    assert verdict(await c.scan(hall["id"], ticket)) == "ADMITTED"
    # A point without a requirement reports every prerequisite as met.
    assert (await c.manifest(entrance["id"]))["tickets"][0]["prerequisite_met"] is True


async def test_required_point_is_validated_on_write(client: AsyncClient) -> None:
    c = await congress(client)
    other = await congress(client, "Other Org")
    foreign = await other.point(name="Foreign")
    a = await c.point(name="A")
    b = await c.point(name="B", requires_point_id=a["id"])
    for target, value in ((a, a["id"]), (a, b["id"]), (a, foreign["id"]), (a, str(uuid.uuid4()))):
        refused = await c.patch_point(target["id"], requires_point_id=value)
        assert refused.status_code == 422, refused.text
        assert refused.json()["code"] == "REQUIRED_POINT_INVALID"
    assert (await c.point(expect=422, name="C", requires_point_id=foreign["id"]))["code"] == "REQUIRED_POINT_INVALID"
    cleared = await c.patch_point(b["id"], requires_point_id=None)
    assert cleared.status_code == 200 and cleared.json()["requires_point_id"] is None


# --- Session doors and attendance -----------------------------------------------------------------------------


async def _session(c: Congress, title: str = "Keynote") -> dict[str, Any]:
    resp = await c.client.post(
        f"/api/events/{c.event_id}/sessions",
        json={"title": title, "starts_at": "2027-04-10T09:00:00Z", "ends_at": "2027-04-10T10:00:00Z"},
        headers=c.auth,
    )
    assert resp.status_code == 201, resp.text
    result: dict[str, Any] = resp.json()
    return result


async def test_session_attendance_report_and_csv(client: AsyncClient, app: FastAPI) -> None:
    c = await congress(client)
    keynote = await _session(c)
    door = await c.point(name="Keynote door", session_id=keynote["id"], tracks_occupancy=True)
    assert door["session_id"] == keynote["id"]
    elsewhere = await c.point(name="Lobby")
    ana = await c.attendee("VIP", name="=HYPERLINK(\"http://x\")")
    bob = await c.attendee("General", name="Bob Example")
    await c.attendee("General", name="Never Came")
    # Scans are in the past (a device time ahead of the server is not trusted); the session itself is in 2027.
    await c.scan(door["id"], ana, "2025-11-10T08:55:00Z")
    await c.scan(door["id"], ana, "2025-11-10T09:30:00Z", "OUT")
    await c.scan(door["id"], ana, "2025-11-10T09:35:00Z")
    await c.scan(door["id"], bob, "2025-11-10T09:05:00Z")
    await c.scan(elsewhere["id"], bob, "2025-11-10T09:06:00Z")

    url = f"/api/events/{c.event_id}/sessions/{keynote['id']}/attendance"
    report = (await client.get(url, headers=c.auth)).json()
    assert report["session_id"] == keynote["id"] and report["timezone"] == "Asia/Tehran"
    assert [p["id"] for p in report["points"]] == [door["id"]]
    assert report["unique_attendees"] == 2 and report["admissions"] == 3 and report["inside"] == 2
    rows = {r["ticket_id"]: r for r in report["attendees"]}
    assert set(rows) == {ana["id"], bob["id"]}
    assert rows[ana["id"]]["admissions"] == 2 and rows[ana["id"]]["exits"] == 1
    assert rows[ana["id"]]["first_admission_at"].startswith("2025-11-10T12:25:00+03:30")

    csv_resp = await client.get(f"{url}-csv", headers=c.auth)
    assert csv_resp.status_code == 200, csv_resp.text
    assert csv_resp.headers["content-type"].startswith("text/csv")
    text = csv_resp.content.decode("utf-8")
    assert text.startswith("﻿")
    table = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    assert table[0][:3] == ["Ticket ID", "Attendee Name", "Attendee Mobile"]
    assert "First Admission (Asia/Tehran)" in table[0]
    names = {row[1] for row in table[1:]}
    assert names == {"'=HYPERLINK(\"http://x\")", "Bob Example"}
    async with app.state.sessionmaker() as session:
        actions = (await session.scalars(select(AuditEvent.action).where(AuditEvent.action == "export.download"))).all()
    assert actions == ["export.download"]

    other = await congress(client, "Session Other Org")
    foreign_session = await _session(other)
    refused = await c.point(expect=422, name="Bad door", session_id=foreign_session["id"])
    assert refused["code"] == "CHECKIN_SESSION_INVALID"
    missing = await client.get(f"/api/events/{c.event_id}/sessions/{foreign_session['id']}/attendance", headers=c.auth)
    assert missing.status_code == 404 and missing.json()["code"] == "SESSION_NOT_FOUND"


# --- Device dashboard -----------------------------------------------------------------------------------------


async def test_heartbeat_and_manifest_fetch_update_the_device_list(client: AsyncClient, app: FastAPI) -> None:
    c = await congress(client)
    point = await c.point()
    device = await c.device(point["id"])
    scanner = {"Authorization": device["Authorization"]}
    device_id = uuid.UUID(device["device_id"])

    long_ago = datetime.now(timezone.utc) - timedelta(minutes=30)
    async with app.state.sessionmaker() as session:
        await session.execute(update(ScannerDevice).where(ScannerDevice.id == device_id).values(last_seen_at=long_ago))
        await session.commit()
    [listed] = (await client.get(f"/api/checkin-points/{point['id']}/devices", headers=c.auth)).json()
    assert listed["stale"] is True

    fetched = await client.get(f"/api/checkin-points/{point['id']}/manifest", headers=scanner)
    assert fetched.status_code == 200
    [listed] = (await client.get(f"/api/checkin-points/{point['id']}/devices", headers=c.auth)).json()
    assert listed["stale"] is False
    assert datetime.fromisoformat(listed["last_seen_at"]) > long_ago + timedelta(minutes=25)

    beat = await client.post(
        f"/api/checkin-points/{point['id']}/devices/self/heartbeat",
        json={"unsynced_count": 7, "app_version": "web/2"},
        headers=scanner,
    )
    assert beat.status_code == 200, beat.text
    assert beat.json()["unsynced_count"] == 7
    [listed] = (await client.get(f"/api/checkin-points/{point['id']}/devices", headers=c.auth)).json()
    assert (listed["unsynced_count"], listed["app_version"]) == (7, "web/2")
    assert listed["last_heartbeat_at"] is not None

    # Only a paired device reports for itself.
    as_organizer = await client.post(
        f"/api/checkin-points/{point['id']}/devices/self/heartbeat", json={"unsynced_count": 0}, headers=c.auth
    )
    assert as_organizer.status_code == 403
    await client.post(f"/api/checkin-points/{point['id']}/devices/{device_id}/revoke", headers=c.auth)
    revoked = await client.post(
        f"/api/checkin-points/{point['id']}/devices/self/heartbeat", json={"unsynced_count": 0}, headers=scanner
    )
    assert revoked.status_code == 401
    [listed] = (await client.get(f"/api/checkin-points/{point['id']}/devices", headers=c.auth)).json()
    assert listed["stale"] is False  # a revoked device is not "stale", it is revoked


# --- Archive and delete ---------------------------------------------------------------------------------------


async def test_point_with_scans_is_archived_not_deleted(client: AsyncClient) -> None:
    gate = await open_gate(client, {"policy_type": "MULTI_ENTRY"})
    base = f"/api/events/{gate.event_id}/checkin-points/{gate.point_id}"
    ticket = await gate.attendee()
    [admitted] = await gate.batch({"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"],
                                    "scanned_at": datetime.now(timezone.utc).isoformat()})
    assert admitted["status"] == "ADMITTED"

    refused = await client.delete(base, headers=bearer(gate.organizer))
    assert refused.status_code == 409 and refused.json()["code"] == "CHECKIN_POINT_HAS_SCANS"

    archived = await client.post(f"{base}/archive", headers=bearer(gate.organizer))
    assert archived.status_code == 200 and archived.json()["archived_at"] is not None
    blocked = await client.get(f"/api/checkin-points/{gate.point_id}/manifest", headers=gate.auth)
    assert blocked.status_code == 403 and blocked.json()["code"] == "CHECKIN_POINT_ARCHIVED"
    single = await gate.scan({"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"],
                              "scanned_at": datetime.now(timezone.utc).isoformat()})
    assert single.status_code == 403
    pairing = await client.post(f"/api/checkin-points/{gate.point_id}/token", headers=bearer(gate.organizer))
    assert pairing.status_code == 409 and pairing.json()["code"] == "CHECKIN_POINT_ARCHIVED"
    # Scans recorded before the archive still upload; later ones are refused.
    before = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    [late, after] = await gate.batch(
        {"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"], "scanned_at": before},
        {"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"],
         "scanned_at": datetime.now(timezone.utc).isoformat()},
    )
    assert late["status"] == "ADMITTED"
    assert (after["status"], after["rejection_reason"]) == ("REJECTED", "POINT_ARCHIVED")

    listed = (await client.get(f"/api/events/{gate.event_id}/checkin-points", headers=bearer(gate.organizer))).json()
    assert [p["archived_at"] is not None for p in listed] == [True]
    analytics = await client.get(f"/api/events/{gate.event_id}/analytics/attendance", headers=bearer(gate.organizer))
    assert [g["point_id"] for g in analytics.json()["gate_breakdown"]] == [gate.point_id]

    restored = await client.post(f"{base}/unarchive", headers=bearer(gate.organizer))
    assert restored.status_code == 200 and restored.json()["archived_at"] is None
    assert (await client.get(f"/api/checkin-points/{gate.point_id}/manifest", headers=gate.auth)).status_code == 200


async def test_point_without_scans_is_deleted_unless_another_requires_it(client: AsyncClient) -> None:
    c = await congress(client)
    entrance = await c.point(name="Entrance")
    hall = await c.point(name="Hall", requires_point_id=entrance["id"])
    await c.device(hall["id"])
    base = f"/api/events/{c.event_id}/checkin-points"
    required = await client.delete(f"{base}/{entrance['id']}", headers=c.auth)
    assert required.status_code == 409 and required.json()["code"] == "CHECKIN_POINT_REQUIRED_BY_OTHER"
    assert (await client.delete(f"{base}/{hall['id']}", headers=c.auth)).status_code == 204
    assert (await client.delete(f"{base}/{entrance['id']}", headers=c.auth)).status_code == 204
    assert (await client.get(base, headers=c.auth)).json() == []
    assert (await client.delete(f"{base}/{entrance['id']}", headers=c.auth)).status_code == 404
