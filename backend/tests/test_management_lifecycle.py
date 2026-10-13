"""Management Completeness A1: Integration tests for Event, Tier, and Check-In Point updates."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


@pytest.mark.asyncio
async def test_authorized_event_update(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Event Update Org")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

    # 1. Successful update of name, location, description, and dates
    now = datetime.now(timezone.utc)
    new_starts = (now + timedelta(days=10)).isoformat()
    new_ends = (now + timedelta(days=12)).isoformat()

    update_resp = await client.patch(
        f"/api/events/{event_id}",
        json={
            "name": "Updated Medical Congress 2027",
            "location": "Shiraz University Auditorium",
            "description": "Updated detailed congress description",
            "starts_at": new_starts,
            "ends_at": new_ends,
        },
        headers=bearer(organizer),
    )
    assert update_resp.status_code == 200
    data = update_resp.json()
    assert data["name"] == "Updated Medical Congress 2027"
    assert data["location"] == "Shiraz University Auditorium"
    assert data["description"] == "Updated detailed congress description"
    # Slug remains completely unchanged
    assert data["slug"] == EVENT["slug"]

    # Verify GET returns updated data
    get_resp = await client.get(f"/api/events/{event_id}", headers=bearer(organizer))
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Updated Medical Congress 2027"


@pytest.mark.asyncio
async def test_event_update_rejects_invalid_dates(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Date Validation Org")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

    now = datetime.now(timezone.utc)
    # starts_at is after ends_at
    bad_starts = (now + timedelta(days=15)).isoformat()
    bad_ends = (now + timedelta(days=10)).isoformat()

    resp = await client.patch(
        f"/api/events/{event_id}",
        json={"starts_at": bad_starts, "ends_at": bad_ends},
        headers=bearer(organizer),
    )
    assert resp.status_code == 400
    assert "ends_at must be after starts_at" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_cross_tenant_event_update_rejected(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Org")
    intruder = await provision_organizer(client, "Intruder Org")
    event_id = await create_event(client, owner)

    resp = await client.patch(
        f"/api/events/{event_id}",
        json={"name": "Hacked Name"},
        headers=bearer(intruder),
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ticket_tier_update_and_quota_constraint(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Tier Update Org")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

    # Create tier with quota 10
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General Admission", quota=10),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Register 3 attendees under this tier
    for i in range(3):
        _, token = await register_user(client, f"attendee_{i}@example.com")
        res = await client.post(
            f"/api/events/{event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 201

    # Attempt to reduce quota to 2 (below 3 confirmed tickets) -> must be rejected (HTTP 400)
    bad_quota_resp = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{tier_id}",
        json={"quota": 2},
        headers=bearer(organizer),
    )
    assert bad_quota_resp.status_code == 400
    assert "Quota cannot be reduced below current confirmed registrations (3)" in bad_quota_resp.json()["detail"]

    # Increasing quota to 25 -> succeeds
    good_quota_resp = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{tier_id}",
        json={"name": "General Pass (Expanded)", "quota": 25, "description": "Expanded quota tier"},
        headers=bearer(organizer),
    )
    assert good_quota_resp.status_code == 200
    assert good_quota_resp.json()["quota"] == 25
    assert good_quota_resp.json()["name"] == "General Pass (Expanded)"


@pytest.mark.asyncio
async def test_closing_and_reopening_ticket_tier(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Tier Open Close Org")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Limited Workshop", quota=5),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Register 1 attendee
    _, token1 = await register_user(client, "registered_before_close@example.com")
    t1_res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token1}"},
    )
    assert t1_res.status_code == 201

    # Close tier (is_open = False)
    close_resp = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{tier_id}",
        json={"is_open": False},
        headers=bearer(organizer),
    )
    assert close_resp.status_code == 200
    assert close_resp.json()["is_open"] is False

    # Verify closed tier is STILL VISIBLE on the public page with is_open=False and reserved_count=1
    pub_page_closed = (await client.get(f"/api/public/events/{EVENT['slug']}")).json()
    closed_tier_pub = next(t for t in pub_page_closed["ticket_tiers"] if t["id"] == tier_id)
    assert closed_tier_pub["is_open"] is False
    assert closed_tier_pub["reserved_count"] == 1
    assert closed_tier_pub["quota"] == 5

    # Attempt new registration -> rejected as closed (HTTP 400)
    _, token2 = await register_user(client, "blocked_during_close@example.com")
    blocked_res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert blocked_res.status_code == 400
    assert "closed for registration" in blocked_res.json()["detail"]
    # Verify existing ticket remains 100% active
    t1_list = await client.get("/api/attendees/me/tickets", headers={"Authorization": f"Bearer {token1}"})
    assert t1_list.status_code == 200
    assert t1_list.json()[0]["status"] == "active"

    # Reopen tier (is_open = True) -> registration succeeds again
    reopen_resp = await client.patch(
        f"/api/events/{event_id}/ticket-tiers/{tier_id}",
        json={"is_open": True},
        headers=bearer(organizer),
    )
    assert reopen_resp.status_code == 200
    assert reopen_resp.json()["is_open"] is True

    # Verify reopened tier is visible as open on public page
    pub_page_open = (await client.get(f"/api/public/events/{EVENT['slug']}")).json()
    open_tier_pub = next(t for t in pub_page_open["ticket_tiers"] if t["id"] == tier_id)
    assert open_tier_pub["is_open"] is True
    assert open_tier_pub["reserved_count"] == 1

    t2_res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token2}"},
    )
    assert t2_res.status_code == 201


@pytest.mark.asyncio
async def test_checkin_point_updates_and_policy_safety(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Point Update Org")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)

    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="VIP", quota=20),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Create check-in point (initially MULTI_ENTRY, 0 scans)
    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate Alpha", "location": "Floor 1", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]

    # 1. Update metadata and policy when 0 scans exist -> succeeds
    update1 = await client.patch(
        f"/api/events/{event_id}/checkin-points/{point_id}",
        json={
            "name": "Gate Alpha VIP",
            "location": "Floor 2 Mezzanine",
            "policy_type": "TIER_RESTRICTED",
            "allowed_tier_ids": [tier_id],
        },
        headers=bearer(organizer),
    )
    assert update1.status_code == 200
    assert update1.json()["name"] == "Gate Alpha VIP"
    assert update1.json()["location"] == "Floor 2 Mezzanine"
    assert update1.json()["policy_type"] == "TIER_RESTRICTED"
    assert update1.json()["allowed_tier_ids"] == [tier_id]

    # 2. Reject foreign tier ID from non-existent/other event
    foreign_tier_resp = await client.patch(
        f"/api/events/{event_id}/checkin-points/{point_id}",
        json={"allowed_tier_ids": [str(uuid.uuid4())]},
        headers=bearer(organizer),
    )
    assert foreign_tier_resp.status_code == 400
    assert "does not belong to this event" in foreign_tier_resp.json()["detail"]

    # 3. Mint token and record a scan
    tok_resp = await client.post(f"/api/checkin-points/{point_id}/token", headers=bearer(organizer))
    scanner_tok = tok_resp.json()["scanner_token"]

    _, att_tok = await register_user(client, "scanned_person@example.com")
    ticket = (await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {att_tok}"},
    )).json()

    now_iso = datetime.now(timezone.utc).isoformat()
    scan_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": ticket["qr_secret"], "scanned_at": now_iso}]},
        headers={"Authorization": f"Bearer {scanner_tok}"},
    )
    assert scan_res.status_code == 200
    assert scan_res.json()["results"][0]["status"] == "ADMITTED"

    # 4. Attempt to change policy_type now that scans exist -> BLOCKED with 409 Conflict!
    policy_change_attempt = await client.patch(
        f"/api/events/{event_id}/checkin-points/{point_id}",
        json={"policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    assert policy_change_attempt.status_code == 409
    assert "existing scan history" in policy_change_attempt.json()["detail"]

    # 5. Metadata change (name, location) still succeeds even with scans!
    meta_update = await client.patch(
        f"/api/events/{event_id}/checkin-points/{point_id}",
        json={"name": "Gate Alpha VIP (Renamed)", "location": "Floor 2 North"},
        headers=bearer(organizer),
    )
    assert meta_update.status_code == 200
    assert meta_update.json()["name"] == "Gate Alpha VIP (Renamed)"
    assert meta_update.json()["policy_type"] == "TIER_RESTRICTED"  # Preserved!
