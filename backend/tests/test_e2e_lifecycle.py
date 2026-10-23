"""Phase 8 Critical Audit: Complete Multi-Tenant Congress Lifecycle Test.

Validates all 6 user roles across the entire platform lifecycle:
1. Multi-Tenant Organizers & Strict Cross-Tenant Isolation
2. Event Configuration (Tiers, Quotas, Policies, Booths, Staff)
3. Attendee Registration, Quota Exhaustion, Duplicates, Bookmarking, Peer Networking & vCards
4. Exhibitor Lead Capture, Qualification, CSV Export (UTF-8 BOM), and Cross-Booth 403 Isolation
5. Front Desk Live Attendee Search and Rapid Walk-In Pass Minting
6. Gate Scanner Multi-Policy Enforcement (MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED)
7. Offline Batch Scan Sync with Persistent UUIDs and Cross-Point Replay Protection (Issue #20)
8. Real-Time Analytics and Hardened Attendance CSV Export
"""

import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient

from tests.conftest import ADMIN_TOKEN
from tests.helpers import publish_page, sign_in


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_full_congress_multi_tenant_lifecycle(client: AsyncClient) -> None:
    # -------------------------------------------------------------------------
    # STEP 1: Multi-Tenant Setup & Cross-Organizer Isolation
    # -------------------------------------------------------------------------
    suffix = str(uuid.uuid4())[:8]
    org_a_resp = await client.post(
        "/api/organizers",
        headers={"X-Admin-Token": ADMIN_TOKEN},
        json={"name": f"Tehran Congress Society {suffix}"},
    )
    assert org_a_resp.status_code == 201
    key_a = org_a_resp.json()["api_key"]

    org_b_resp = await client.post(
        "/api/organizers",
        headers={"X-Admin-Token": ADMIN_TOKEN},
        json={"name": f"Isfahan Medical Union {suffix}"},
    )
    assert org_b_resp.status_code == 201
    key_b = org_b_resp.json()["api_key"]

    # Organizer A creates Event A
    evt_a_resp = await client.post(
        "/api/events",
        headers=bearer(key_a),
        json={
            "name": "Tehran Medical Congress 2026",
            "slug": f"tmc-{suffix}",
            "location": "Tehran International Summit Hall",
            "description": "Annual Medical Informatics and AI in Healthcare",
            "starts_at": "2030-11-01T08:00:00Z",
            "ends_at": "2030-11-03T18:00:00Z",
        },
    )
    assert evt_a_resp.status_code == 201
    evt_a_id = evt_a_resp.json()["id"]
    # Attendees can reserve once the congress page is published.
    await publish_page(client, {"api_key": key_a}, evt_a_id)

    # Cross-tenant isolation check: Organizer B attempts to read Event A -> 404 Not Found
    leak_check = await client.get(f"/api/events/{evt_a_id}", headers=bearer(key_b))
    assert leak_check.status_code == 404

    # -------------------------------------------------------------------------
    # STEP 2: Event Configuration (Tiers, Points, Booths, Staff)
    # -------------------------------------------------------------------------
    tier_gen_resp = await client.post(
        f"/api/events/{evt_a_id}/ticket-tiers",
        headers=bearer(key_a),
        json={"name": "General Admission", "description": "Full access", "quota": 100},
    )
    assert tier_gen_resp.status_code == 201
    tier_gen_id = tier_gen_resp.json()["id"]

    tier_vip_resp = await client.post(
        f"/api/events/{evt_a_id}/ticket-tiers",
        headers=bearer(key_a),
        json={"name": "VIP Faculty", "description": "Faculty pass", "quota": 2},
    )
    assert tier_vip_resp.status_code == 201
    tier_vip_id = tier_vip_resp.json()["id"]

    # 4 Check-In Points covering all admission policies
    pt_main_resp = await client.post(
        f"/api/events/{evt_a_id}/checkin-points",
        headers=bearer(key_a),
        json={"name": "Main Entrance", "location": "Gate A", "policy_type": "MULTI_ENTRY"},
    )
    assert pt_main_resp.status_code == 201
    pt_main_id = pt_main_resp.json()["id"]

    pt_lunch_resp = await client.post(
        f"/api/events/{evt_a_id}/checkin-points",
        headers=bearer(key_a),
        json={"name": "Gala Lunch", "location": "Dining Hall", "policy_type": "SINGLE_USE"},
    )
    assert pt_lunch_resp.status_code == 201
    pt_lunch_id = pt_lunch_resp.json()["id"]

    pt_work_resp = await client.post(
        f"/api/events/{evt_a_id}/checkin-points",
        headers=bearer(key_a),
        json={
            "name": "VIP Workshop",
            "location": "Room 101",
            "policy_type": "TIER_RESTRICTED",
            "allowed_tier_ids": [tier_vip_id],
        },
    )
    assert pt_work_resp.status_code == 201
    pt_work_id = pt_work_resp.json()["id"]

    pt_cap_resp = await client.post(
        f"/api/events/{evt_a_id}/checkin-points",
        headers=bearer(key_a),
        json={
            "name": "Amphitheater",
            "location": "Auditorium",
            "policy_type": "CAPACITY_CAPPED",
            "max_capacity": 2,
        },
    )
    assert pt_cap_resp.status_code == 201
    pt_cap_id = pt_cap_resp.json()["id"]

    # Booths and Staff
    booth_1_resp = await client.post(
        f"/api/events/{evt_a_id}/booths",
        headers=bearer(key_a),
        json={"name": "Sina Robotics", "slug": f"sina-{suffix}", "location": "B-01"},
    )
    assert booth_1_resp.status_code == 201
    booth_1_id = booth_1_resp.json()["id"]

    booth_2_resp = await client.post(
        f"/api/events/{evt_a_id}/booths",
        headers=bearer(key_a),
        json={"name": "Pars Pharma", "slug": f"pars-{suffix}", "location": "B-02"},
    )
    assert booth_2_resp.status_code == 201
    booth_2_id = booth_2_resp.json()["id"]

    # Register staff user and assign to Booth 1
    staff_mobile = "09371000001"
    _, staff_jwt = await sign_in(client, staff_mobile, "Engineer Alavi", "Sina Robotics", "Exhibition Lead")

    staff_assign_resp = await client.post(
        f"/api/events/{evt_a_id}/booths/{booth_1_id}/staff",
        headers=bearer(key_a),
        json={"mobile": staff_mobile},
    )
    assert staff_assign_resp.status_code == 201

    # -------------------------------------------------------------------------
    # STEP 3: Attendee Workflows (Registration, Quotas, Networking, vCard)
    # -------------------------------------------------------------------------
    _, u1_tok = await sign_in(client, "09371000002", "Dr. Reza", "Tehran Uni", "Professor")
    _, u2_tok = await sign_in(client, "09371000003", "Dr. Sara", "Sharif Uni", "Researcher")
    _, u3_tok = await sign_in(client, "09371000004", "Dr. Omid", "Amirkabir", "Student")
    # u1 and u2 reserve VIP tickets
    t1_resp = await client.post(f"/api/events/{evt_a_id}/tickets/reserve", headers=bearer(u1_tok), json={"ticket_tier_id": str(tier_vip_id)})
    assert t1_resp.status_code == 201

    t2_resp = await client.post(f"/api/events/{evt_a_id}/tickets/reserve", headers=bearer(u2_tok), json={"ticket_tier_id": str(tier_vip_id)})
    assert t2_resp.status_code == 201

    # u3 attempts to reserve VIP ticket -> Quota Exhausted! (HTTP 410 Gone)
    vip_exhausted = await client.post(f"/api/events/{evt_a_id}/tickets/reserve", headers=bearer(u3_tok), json={"ticket_tier_id": str(tier_vip_id)})
    assert vip_exhausted.status_code == 410

    # u3 reserves General tier -> 201 Created
    t3_resp = await client.post(f"/api/events/{evt_a_id}/tickets/reserve", headers=bearer(u3_tok), json={"ticket_tier_id": str(tier_gen_id)})
    assert t3_resp.status_code == 201

    # Duplicate reservation check: u1 attempts to reserve another ticket for Event A -> 409 Conflict
    dup_check = await client.post(f"/api/events/{evt_a_id}/tickets/reserve", headers=bearer(u1_tok), json={"ticket_tier_id": str(tier_gen_id)})
    assert dup_check.status_code == 409
    u1_passes = (await client.get("/api/attendees/me/tickets", headers=bearer(u1_tok))).json()
    u1_secret = u1_passes[0]["qr_secret"]

    u2_passes = (await client.get("/api/attendees/me/tickets", headers=bearer(u2_tok))).json()
    u2_secret = u2_passes[0]["qr_secret"]

    u3_passes = (await client.get("/api/attendees/me/tickets", headers=bearer(u3_tok))).json()
    u3_secret = u3_passes[0]["qr_secret"]
    # Bookmark booth
    bm_resp = await client.post(f"/api/attendees/me/bookmarks/booths/{booth_1_id}", headers=bearer(u1_tok))
    assert bm_resp.status_code in (200, 201)

    # Peer Networking: u1 scans u2's badge
    conn_resp = await client.post(
        "/api/attendees/me/network/scan",
        headers=bearer(u1_tok),
        json={"qr_secret": u2_secret, "private_notes": "Met at keynote"},
    )
    assert conn_resp.status_code in (200, 201)
    conn_id = conn_resp.json()["id"]

    # Export vCard
    vcard_resp = await client.get(f"/api/attendees/me/network/{conn_id}/vcard", headers=bearer(u1_tok))
    assert vcard_resp.status_code == 200
    assert "BEGIN:VCARD" in vcard_resp.text

    # -------------------------------------------------------------------------
    # STEP 4: Exhibitor Workflows (Lead Capture, Qualification, CSV, 403 Isolation)
    # -------------------------------------------------------------------------
    lead_scan = await client.post(
        f"/api/booths/{booth_1_id}/leads/scan",
        headers=bearer(staff_jwt),
        json={"qr_secret": u1_secret, "rating": "HOT", "tags": ["robotic-surgeon"], "notes": "Interested in DaVinci alternative"},
    )
    assert lead_scan.status_code in (200, 201)
    lead_id = lead_scan.json()["id"]

    # Update lead rating and notes
    lead_patch = await client.patch(
        f"/api/booths/{booth_1_id}/leads/{lead_id}",
        headers=bearer(staff_jwt),
        json={"rating": "WARM", "notes": "Follow up next Monday"},
    )
    assert lead_patch.status_code == 200
    assert lead_patch.json()["rating"] == "WARM"

    # Export leads CSV (verify UTF-8 BOM)
    leads_csv = await client.get(f"/api/booths/{booth_1_id}/leads/export-csv", headers=bearer(staff_jwt))
    assert leads_csv.status_code == 200
    assert leads_csv.content.startswith(b"\xef\xbb\xbf")
    assert "Dr. Reza" in leads_csv.text

    # Cross-booth isolation check: Staff 1 attempts to access Booth 2 leads -> 403 Forbidden
    booth_leak = await client.get(f"/api/booths/{booth_2_id}/leads", headers=bearer(staff_jwt))
    assert booth_leak.status_code == 403

    # -------------------------------------------------------------------------
    # STEP 5: Front Desk Workflows (Search, Walk-In Pass Minting)
    # -------------------------------------------------------------------------
    search_resp = await client.get(f"/api/events/{evt_a_id}/attendees?q=Reza", headers=bearer(key_a))
    assert search_resp.status_code == 200
    attendees_found = search_resp.json()
    assert any(a["attendee_name"] == "Dr. Reza" for a in attendees_found)

    walkin_resp = await client.post(
        f"/api/events/{evt_a_id}/desk-registrations",
        headers=bearer(key_a),
        json={"mobile": "09371000005", "full_name": "Maryam Walkin", "ticket_tier_id": str(tier_gen_id)},
    )
    assert walkin_resp.status_code == 201
    walkin_data = walkin_resp.json()
    assert walkin_data["attendee_name"] == "Maryam Walkin"

    # -------------------------------------------------------------------------
    # STEP 6: Gate Scanner & Multi-Policy Enforcement
    # -------------------------------------------------------------------------
    main_tok_resp = await client.post(f"/api/checkin-points/{pt_main_id}/token", headers=bearer(key_a))
    assert main_tok_resp.status_code in (200, 201)
    main_scanner_tok = main_tok_resp.json()["scanner_token"]

    lunch_tok_resp = await client.post(f"/api/checkin-points/{pt_lunch_id}/token", headers=bearer(key_a))
    assert lunch_tok_resp.status_code in (200, 201)
    lunch_scanner_tok = lunch_tok_resp.json()["scanner_token"]

    work_tok_resp = await client.post(f"/api/checkin-points/{pt_work_id}/token", headers=bearer(key_a))
    assert work_tok_resp.status_code in (200, 201)
    work_scanner_tok = work_tok_resp.json()["scanner_token"]

    cap_tok_resp = await client.post(f"/api/checkin-points/{pt_cap_id}/token", headers=bearer(key_a))
    assert cap_tok_resp.status_code in (200, 201)
    cap_scanner_tok = cap_tok_resp.json()["scanner_token"]
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. MULTI_ENTRY scan: u1 admitted twice
    s1_resp = await client.post(
        f"/api/checkin-points/{pt_main_id}/scans/batch",
        headers=bearer(main_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert s1_resp.status_code == 200
    assert s1_resp.json()["results"][0]["status"] == "ADMITTED"

    s2_resp = await client.post(
        f"/api/checkin-points/{pt_main_id}/scans/batch",
        headers=bearer(main_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert s2_resp.status_code == 200
    assert s2_resp.json()["results"][0]["status"] == "ADMITTED"

    # 2. SINGLE_USE scan: u1 admitted once, rejected second time
    l1_resp = await client.post(
        f"/api/checkin-points/{pt_lunch_id}/scans/batch",
        headers=bearer(lunch_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert l1_resp.status_code == 200
    assert l1_resp.json()["results"][0]["status"] == "ADMITTED"

    l2_resp = await client.post(
        f"/api/checkin-points/{pt_lunch_id}/scans/batch",
        headers=bearer(lunch_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert l2_resp.status_code == 200
    assert l2_resp.json()["results"][0]["status"] == "REJECTED"
    assert l2_resp.json()["results"][0]["rejection_reason"] == "ALREADY_ADMITTED"

    # 3. TIER_RESTRICTED scan: VIP admitted, General rejected
    w1_resp = await client.post(
        f"/api/checkin-points/{pt_work_id}/scans/batch",
        headers=bearer(work_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert w1_resp.status_code == 200
    assert w1_resp.json()["results"][0]["status"] == "ADMITTED"

    w2_resp = await client.post(
        f"/api/checkin-points/{pt_work_id}/scans/batch",
        headers=bearer(work_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u3_secret, "scanned_at": now_iso}]},
    )
    assert w2_resp.status_code == 200
    assert w2_resp.json()["results"][0]["status"] == "REJECTED"
    assert w2_resp.json()["results"][0]["rejection_reason"] == "TIER_NOT_ALLOWED"

    # 4. CAPACITY_CAPPED scan (limit=2): u1, u2 admitted, u3 rejected
    c1_resp = await client.post(
        f"/api/checkin-points/{pt_cap_id}/scans/batch",
        headers=bearer(cap_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert c1_resp.status_code == 200
    assert c1_resp.json()["results"][0]["status"] == "ADMITTED"

    c2_resp = await client.post(
        f"/api/checkin-points/{pt_cap_id}/scans/batch",
        headers=bearer(cap_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u2_secret, "scanned_at": now_iso}]},
    )
    assert c2_resp.status_code == 200
    assert c2_resp.json()["results"][0]["status"] == "ADMITTED"

    c3_resp = await client.post(
        f"/api/checkin-points/{pt_cap_id}/scans/batch",
        headers=bearer(cap_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u3_secret, "scanned_at": now_iso}]},
    )
    assert c3_resp.status_code == 200
    assert c3_resp.json()["results"][0]["status"] == "REJECTED"
    assert c3_resp.json()["results"][0]["rejection_reason"] == "CAPACITY_REACHED"

    # -------------------------------------------------------------------------
    # STEP 7: Offline Batch Sync & Issue #20 Replay Protection
    # -------------------------------------------------------------------------
    scan_uuid = str(uuid.uuid4())
    batch_resp = await client.post(
        f"/api/checkin-points/{pt_main_id}/scans/batch",
        headers=bearer(main_scanner_tok),
        json={"scans": [{"scan_id": scan_uuid, "qr_secret": u3_secret, "scanned_at": now_iso}]},
    )
    assert batch_resp.status_code == 200
    results = batch_resp.json()["results"]
    assert len(results) == 1
    assert results[0]["scan_id"] == scan_uuid
    assert results[0]["status"] == "ADMITTED"

    # Replaying scan_uuid at lunch point must be rejected with SCAN_ID_CONFLICT
    replay_resp = await client.post(
        f"/api/checkin-points/{pt_lunch_id}/scans/batch",
        headers=bearer(lunch_scanner_tok),
        json={"scans": [{"scan_id": scan_uuid, "qr_secret": u2_secret, "scanned_at": now_iso}]},
    )
    assert replay_resp.status_code == 200
    assert replay_resp.json()["results"][0]["rejection_reason"] == "SCAN_ID_CONFLICT"

    # -------------------------------------------------------------------------
    # STEP 7.5: Device Revocation & Unauthorized Block (Step 16 of Pilot)
    # -------------------------------------------------------------------------
    main_device_id = main_tok_resp.json()["device_id"]
    revoke_resp = await client.post(
        f"/api/checkin-points/{pt_main_id}/devices/{main_device_id}/revoke",
        headers=bearer(key_a),
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["is_revoked"] is True

    # Subsequent scan with revoked token fails with 401 Unauthorized
    revoked_scan = await client.post(
        f"/api/checkin-points/{pt_main_id}/scans/batch",
        headers=bearer(main_scanner_tok),
        json={"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": u1_secret, "scanned_at": now_iso}]},
    )
    assert revoked_scan.status_code == 401

    # -------------------------------------------------------------------------
    # STEP 8: Real-Time Analytics & Hardened CSV Export
    # -------------------------------------------------------------------------
    analytics_resp = await client.get(f"/api/events/{evt_a_id}/analytics/attendance", headers=bearer(key_a))
    assert analytics_resp.status_code == 200
    analytics_data = analytics_resp.json()
    assert analytics_data["total_tickets"] >= 4
    assert analytics_data["unique_admitted"] >= 2
    assert len(analytics_data["gate_breakdown"]) >= 4
    att_csv_resp = await client.get(f"/api/events/{evt_a_id}/analytics/export-csv", headers=bearer(key_a))
    assert att_csv_resp.status_code == 200
    assert att_csv_resp.content.startswith(b"\xef\xbb\xbf")  # UTF-8 BOM
    assert "Dr. Reza" in att_csv_resp.text
    assert "MULTI_ENTRY" in att_csv_resp.text
