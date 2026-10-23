import hashlib
import uuid
from typing import Any
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def create_attendee_with_ticket(
    client: AsyncClient, event_id: str, tier_id: str, mobile: str, name: str
) -> dict[str, Any]:
    _, token = await register_user(client, mobile, name)
    resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())  # contains "qr_secret", "id", "ticket_tier_id", etc.


async def test_organizer_configures_checkin_points_with_admission_policies(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="VIP", quota=50),
        headers=bearer(organizer),
    )
    vip_tier_id = tier_resp.json()["id"]

    # 1. Main Entrance (MULTI_ENTRY)
    p1 = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={
            "name": "Main Gate Turnstile",
            "location": "Ground Floor",
            "policy_type": "MULTI_ENTRY",
        },
        headers=bearer(organizer),
    )
    assert p1.status_code == 201
    assert p1.json()["name"] == "Main Gate Turnstile"
    assert p1.json()["policy_type"] == "MULTI_ENTRY"

    # 2. Dining Hall (SINGLE_USE)
    p2 = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={
            "name": "Lunch Catering Hall",
            "location": "Level 2 Dining Area",
            "policy_type": "SINGLE_USE",
        },
        headers=bearer(organizer),
    )
    assert p2.status_code == 201
    assert p2.json()["policy_type"] == "SINGLE_USE"

    # 3. VIP Lounge (TIER_RESTRICTED)
    p3 = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={
            "name": "VIP Lounge Entrance",
            "location": "Mezzanine Floor",
            "policy_type": "TIER_RESTRICTED",
            "allowed_tier_ids": [vip_tier_id],
        },
        headers=bearer(organizer),
    )
    assert p3.status_code == 201
    assert p3.json()["allowed_tier_ids"] == [vip_tier_id]

    # List all check-in points
    listed = await client.get(
        f"/api/events/{event_id}/checkin-points", headers=bearer(organizer)
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 3


async def test_compact_manifest_snapshot_returns_valid_tickets_and_status(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Create check-in point
    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate 1", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]

    # Issue tickets to 2 attendees
    t1 = await create_attendee_with_ticket(
        client, event_id, tier_id, "09121000021", "Attendee One"
    )
    t2 = await create_attendee_with_ticket(
        client, event_id, tier_id, "09121000022", "Attendee Two"
    )

    # Fetch manifest with authorized organizer credentials
    manifest_resp = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=bearer(organizer)
    )
    assert manifest_resp.status_code == 200
    manifest = manifest_resp.json()
    assert manifest["checkin_point"]["id"] == point_id
    assert manifest["checkin_point"]["policy_type"] == "SINGLE_USE"

    # The manifest carries sha256("<event_id>:<secret>"), never the raw QR secret.
    def qr_hash(secret: str) -> str:
        return hashlib.sha256(f"{event_id}:{secret}".encode()).hexdigest()

    hashes = {item["qr_hash"]: item for item in manifest["tickets"]}
    assert qr_hash(t1["qr_secret"]) in hashes
    assert qr_hash(t2["qr_secret"]) in hashes
    assert hashes[qr_hash(t1["qr_secret"])]["attendee_name"] == "Attendee One"
    assert hashes[qr_hash(t1["qr_secret"])]["is_admitted"] is False
    assert "qr_secret" not in manifest["tickets"][0]
    # Data minimization check: PII (mobile) is not leaked in offline manifest
    assert "attendee_mobile" not in manifest["tickets"][0]

async def test_single_use_admission_policy_enforcement(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Catering Lunch", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]

    ticket = await create_attendee_with_ticket(
        client, event_id, tier_id, "09121000023", "Lunch Eater"
    )

    # Scan 1: First scan at lunch -> ADMITTED
    scan1_id = str(uuid.uuid4())
    res1 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan1_id,
                    "qr_secret": ticket["qr_secret"],
                    "scanned_at": "2027-04-10T12:30:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    assert res1.status_code == 200
    r1 = res1.json()["results"][0]
    assert r1["status"] == "ADMITTED"
    assert r1["rejection_reason"] is None
    assert r1["attendee_name"] == "Lunch Eater"

    # Scan 2: Second scan with new scan_id at same lunch gate -> REJECTED (ALREADY_ADMITTED)
    scan2_id = str(uuid.uuid4())
    res2 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan2_id,
                    "qr_secret": ticket["qr_secret"],
                    "scanned_at": "2027-04-10T12:45:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    assert res2.status_code == 200
    r2 = res2.json()["results"][0]
    assert r2["status"] == "REJECTED"
    assert r2["rejection_reason"] == "ALREADY_ADMITTED"


async def test_tier_restricted_admission_policy_enforcement(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    gen_tier = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    vip_tier = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="VIP", quota=50),
        headers=bearer(organizer),
    )

    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={
            "name": "VIP Hall Entrance",
            "policy_type": "TIER_RESTRICTED",
            "allowed_tier_ids": [vip_tier.json()["id"]],
        },
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]

    gen_ticket = await create_attendee_with_ticket(
        client, event_id, gen_tier.json()["id"], "09121000024", "General User"
    )
    vip_ticket = await create_attendee_with_ticket(
        client, event_id, vip_tier.json()["id"], "09121000007", "VIP User"
    )

    # General ticket scanned at VIP gate -> REJECTED
    batch_resp = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": gen_ticket["qr_secret"],
                    "scanned_at": "2027-04-10T10:00:00Z",
                },
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": vip_ticket["qr_secret"],
                    "scanned_at": "2027-04-10T10:01:00Z",
                },
            ]
        },
        headers=bearer(organizer),
    )
    assert batch_resp.status_code == 200
    results = batch_resp.json()["results"]
    assert results[0]["status"] == "REJECTED"
    assert results[0]["rejection_reason"] == "TIER_NOT_ALLOWED"
    assert results[1]["status"] == "ADMITTED"


async def test_invalid_qr_secret_is_rejected(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]

    res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": "forged_random_secret_xyz",
                    "scanned_at": "2027-04-10T09:00:00Z",
                }
            ]
        },
        headers=bearer(organizer),
    )
    assert res.status_code == 200
    r = res.json()["results"][0]
    assert r["status"] == "REJECTED"
    assert r["rejection_reason"] == "INVALID_TICKET"


async def test_idempotent_batch_replay_with_identical_scan_id(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Standard", quota=100),
        headers=bearer(organizer),
    )
    point_resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Entrance", "policy_type": "SINGLE_USE"},
        headers=bearer(organizer),
    )
    point_id = point_resp.json()["id"]
    ticket = await create_attendee_with_ticket(
        client, event_id, tier_resp.json()["id"], "09121000025", "Replay User"
    )

    scan_id = str(uuid.uuid4())
    payload = {
        "scans": [
            {
                "scan_id": scan_id,
                "qr_secret": ticket["qr_secret"],
                "scanned_at": "2027-04-10T08:30:00Z",
            }
        ]
    }

    # First transmission
    res1 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json=payload,
        headers=bearer(organizer),
    )
    assert res1.status_code == 200
    assert res1.json()["results"][0]["status"] == "ADMITTED"

    # Network retry (re-sending identical payload with same scan_id)
    res2 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json=payload,
        headers=bearer(organizer),
    )
    # Returns the exact original result without rejecting as double scan
    assert res2.json()["results"][0]["status"] == "ADMITTED"


async def test_scanner_endpoint_authentication_and_authorization_controls(
    client: AsyncClient,
) -> None:
    org1 = await provision_organizer(client, "Organizer One")
    org2 = await provision_organizer(client, "Organizer Two")

    event1_id = await create_event(client, org1)
    event2_payload = dict(EVENT)
    event2_payload["slug"] = f"event-two-{uuid.uuid4().hex[:6]}"
    res_e2 = await client.post("/api/events", json=event2_payload, headers=bearer(org2))
    assert res_e2.status_code == 201
    event2_id = res_e2.json()["id"]

    tier1_resp = await client.post(
        f"/api/events/{event1_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(org1),
    )
    point1_resp = await client.post(
        f"/api/events/{event1_id}/checkin-points",
        json={"name": "Gate 1", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org1),
    )
    point1_id = point1_resp.json()["id"]

    point1_b_resp = await client.post(
        f"/api/events/{event1_id}/checkin-points",
        json={"name": "Gate 1B", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org1),
    )
    point1_b_id = point1_b_resp.json()["id"]

    point2_resp = await client.post(
        f"/api/events/{event2_id}/checkin-points",
        json={"name": "Foreign Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org2),
    )
    point2_id = point2_resp.json()["id"]

    t1 = await create_attendee_with_ticket(
        client, event1_id, tier1_resp.json()["id"], "09121000026", "Attendee 1"
    )

    scan_payload = {
        "scans": [
            {
                "scan_id": str(uuid.uuid4()),
                "qr_secret": t1["qr_secret"],
                "scanned_at": "2027-04-10T09:00:00Z",
            }
        ]
    }

    # 1. Unauthenticated manifest access is rejected (401)
    unauth_manifest = await client.get(f"/api/checkin-points/{point1_id}/manifest")
    assert unauth_manifest.status_code == 401

    # 2. Unauthenticated batch scan ingestion is rejected (401)
    unauth_batch = await client.post(
        f"/api/checkin-points/{point1_id}/scans/batch", json=scan_payload
    )
    assert unauth_batch.status_code == 401

    # 3. Invalid credentials rejected (401)
    bad_manifest = await client.get(
        f"/api/checkin-points/{point1_id}/manifest",
        headers={"Authorization": "Bearer invalid_garbage_token"},
    )
    assert bad_manifest.status_code == 401

    bad_batch = await client.post(
        f"/api/checkin-points/{point1_id}/scans/batch",
        json=scan_payload,
        headers={"Authorization": "Bearer invalid_garbage_token"},
    )
    assert bad_batch.status_code == 401

    # 4. Standard attendee token (non-scanner role) rejected (403)
    _, attendee_token = await register_user(
        client, f"0936{uuid.uuid4().int % 10**7:07d}", "Plain Attendee"
    )
    attendee_manifest = await client.get(
        f"/api/checkin-points/{point1_id}/manifest",
        headers={"Authorization": f"Bearer {attendee_token}"},
    )
    assert attendee_manifest.status_code == 403

    # 5. Organizer issues scanner token for Point 1
    token_resp = await client.post(
        f"/api/checkin-points/{point1_id}/token",
        headers=bearer(org1),
    )
    assert token_resp.status_code == 201
    scanner_token = token_resp.json()["scanner_token"]
    assert scanner_token

    # 6. Legitimate scanner token access to manifest and batch scan (200)
    scanner_headers = {"Authorization": f"Bearer {scanner_token}"}
    ok_manifest = await client.get(
        f"/api/checkin-points/{point1_id}/manifest", headers=scanner_headers
    )
    assert ok_manifest.status_code == 200
    manifest_data = ok_manifest.json()
    assert manifest_data["checkin_point"]["id"] == point1_id
    assert len(manifest_data["tickets"]) >= 1
    # Verify attendee_mobile is minimized / not leaked
    assert "attendee_mobile" not in manifest_data["tickets"][0]

    ok_batch = await client.post(
        f"/api/checkin-points/{point1_id}/scans/batch",
        json=scan_payload,
        headers=scanner_headers,
    )
    assert ok_batch.status_code == 200
    assert ok_batch.json()["results"][0]["status"] == "ADMITTED"

    # 7. Cross-point token access rejected (403)
    # Scanner token for Point 1 used on Point 1B
    cross_point_manifest = await client.get(
        f"/api/checkin-points/{point1_b_id}/manifest", headers=scanner_headers
    )
    assert cross_point_manifest.status_code == 403

    cross_point_batch = await client.post(
        f"/api/checkin-points/{point1_b_id}/scans/batch",
        json=scan_payload,
        headers=scanner_headers,
    )
    assert cross_point_batch.status_code == 403

    # 8. Cross-event / cross-tenant token access rejected (403)
    # Scanner token for Point 1 (Event 1) used on Point 2 (Event 2)
    cross_event_manifest = await client.get(
        f"/api/checkin-points/{point2_id}/manifest", headers=scanner_headers
    )
    assert cross_event_manifest.status_code == 403

    # 9. Cross-tenant organizer access masked (404)
    foreign_org_manifest = await client.get(
        f"/api/checkin-points/{point1_id}/manifest", headers=bearer(org2)
    )
    assert foreign_org_manifest.status_code == 404

    foreign_org_batch = await client.post(
        f"/api/checkin-points/{point1_id}/scans/batch",
        json=scan_payload,
        headers=bearer(org2),
    )
    assert foreign_org_batch.status_code == 404
