"""Comprehensive security regression test suite for Scanner Authentication and Hardening.

Covers:
1. P1-JWT-DEFAULT: Startup and configuration validation for secure JWT secrets.
2. Unauthenticated access prevention on manifest and batch ingestion endpoints.
3. Invalid, malformed, and expired scanner credential rejection.
4. Attender and attacker JWT masquerade prevention (403 Forbidden / 401 Unauthorized).
5. Cross-point and cross-event scanner token isolation (403 Forbidden).
6. Cross-tenant Organizer API key isolation (404 Not Found).
7. Per-device scanner token issuance, device tracking, and data minimization.
8. Per-device token revocation enforcement (immediate 401 Unauthorized upon revocation).
"""

import uuid
from datetime import timedelta, timezone
from typing import Any

import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.config import DISALLOWED_JWT_SECRETS, Settings
from app.security import create_access_token, create_scanner_token
from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


# ---------------------------------------------------------------------------
# 1. Configuration & Startup Hardening Tests (P1-JWT-DEFAULT)
# ---------------------------------------------------------------------------


def test_missing_jwt_secret_fails_configuration() -> None:
    """Settings must reject missing or empty jwt_secret."""
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            platform_admin_token="admin-token",
            jwt_secret="",
        )


def test_short_jwt_secret_fails_configuration() -> None:
    """Settings must reject secrets shorter than 32 characters (256 bits)."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            platform_admin_token="admin-token",
            jwt_secret="too-short-secret-under-32-chars",
        )
    assert "at least 32 characters" in str(exc_info.value)


@pytest.mark.parametrize("insecure_secret", list(DISALLOWED_JWT_SECRETS))
def test_insecure_default_jwt_secret_fails_configuration(insecure_secret: str) -> None:
    """Settings must strictly reject known development or placeholder secrets."""
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            platform_admin_token="admin-token",
            jwt_secret=insecure_secret,
        )
    assert "cannot use an insecure default" in str(exc_info.value)


def test_valid_secure_jwt_secret_succeeds_configuration() -> None:
    """Settings must accept a compliant, random 32+ character secret."""
    valid_secret = "a" * 32
    settings = Settings(
        database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
        platform_admin_token="admin-token",
        jwt_secret=valid_secret,
    )
    assert settings.jwt_secret == valid_secret


# ---------------------------------------------------------------------------
# 2. Integration Security Tests for Scanner Authentication & Revocation
# ---------------------------------------------------------------------------


async def test_unauthenticated_scanner_access_rejected(client: AsyncClient) -> None:
    """Manifest download and batch scan submission without credentials return 401."""
    fake_point_id = str(uuid.uuid4())

    manifest_res = await client.get(f"/api/checkin-points/{fake_point_id}/manifest")
    assert manifest_res.status_code == 401
    assert "Bearer" in manifest_res.headers.get("WWW-Authenticate", "")

    batch_res = await client.post(
        f"/api/checkin-points/{fake_point_id}/scans/batch",
        json={"scans": []},
    )
    assert batch_res.status_code == 401


async def test_invalid_and_malformed_scanner_tokens_rejected(client: AsyncClient) -> None:
    """Malformed or invalid signature bearer tokens return 401."""
    organizer = await provision_organizer(client, "Malformed Org")
    event_id = await create_event(client, organizer)
    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    res = await client.get(
        f"/api/checkin-points/{point_id}/manifest",
        headers={"Authorization": "Bearer not-a-valid-jwt-token"},
    )
    assert res.status_code == 401

    res_batch = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": []},
        headers={"Authorization": "Bearer not-a-valid-jwt-token"},
    )
    assert res_batch.status_code == 401


async def test_attendee_jwt_cannot_access_scanner_endpoints(client: AsyncClient) -> None:
    """Regular attendee JWT tokens without 'scanner' scope return 403 Forbidden."""
    organizer = await provision_organizer(client, "Security Org")
    event_id = await create_event(client, organizer)

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    _, attendee_token = await register_user(client, "attendee@sec.com", "Att User")

    res = await client.get(
        f"/api/checkin-points/{point_id}/manifest",
        headers={"Authorization": f"Bearer {attendee_token}"},
    )
    assert res.status_code == 403
    assert "Insufficient permissions" in res.json().get("detail", "")

    batch_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": []},
        headers={"Authorization": f"Bearer {attendee_token}"},
    )
    assert batch_res.status_code == 403


async def test_cross_point_and_cross_event_token_abuse_rejected(client: AsyncClient) -> None:
    """Scanner token minted for Point 1 cannot access Point 2 or Event 2 (403 Forbidden)."""
    org1 = await provision_organizer(client, "Org 1")
    org2 = await provision_organizer(client, "Org 2")

    event1 = await create_event(client, org1)
    event2_payload = dict(EVENT)
    event2_payload["slug"] = f"event-two-{uuid.uuid4().hex[:6]}"
    res2 = await client.post("/api/events", json=event2_payload, headers=bearer(org2))
    assert res2.status_code == 201
    event2 = res2.json()["id"]
    p1_res = await client.post(
        f"/api/events/{event1}/checkin-points",
        json={"name": "Gate 1", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org1),
    )
    point1_id = p1_res.json()["id"]

    p1_sibling_res = await client.post(
        f"/api/events/{event1}/checkin-points",
        json={"name": "Gate 1B", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org1),
    )
    point1_sibling_id = p1_sibling_res.json()["id"]

    p2_res = await client.post(
        f"/api/events/{event2}/checkin-points",
        json={"name": "Gate 2", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org2),
    )
    point2_id = p2_res.json()["id"]

    # Issue token for Point 1
    token_res = await client.post(
        f"/api/checkin-points/{point1_id}/token",
        json={"device_name": "Volunteer Handheld 1"},
        headers=bearer(org1),
    )
    assert token_res.status_code == 201
    point1_token = token_res.json()["scanner_token"]

    # Cross-point on same event -> 403 Forbidden
    res_cross_point = await client.get(
        f"/api/checkin-points/{point1_sibling_id}/manifest",
        headers={"Authorization": f"Bearer {point1_token}"},
    )
    assert res_cross_point.status_code == 403

    # Cross-event on different organizer -> 403 Forbidden
    res_cross_event = await client.get(
        f"/api/checkin-points/{point2_id}/manifest",
        headers={"Authorization": f"Bearer {point1_token}"},
    )
    assert res_cross_event.status_code == 403


async def test_cross_tenant_organizer_access_returns_404(client: AsyncClient) -> None:
    """Organizer B using their API key to access Organizer A's point gets 404 (masked)."""
    org1 = await provision_organizer(client, "Tenant A")
    org2 = await provision_organizer(client, "Tenant B")

    event1 = await create_event(client, org1)

    p1_res = await client.post(
        f"/api/events/{event1}/checkin-points",
        json={"name": "Gate A", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org1),
    )
    point1_id = p1_res.json()["id"]

    res = await client.get(
        f"/api/checkin-points/{point1_id}/manifest",
        headers=bearer(org2),
    )
    assert res.status_code == 404


async def test_per_device_token_issuance_and_revocation_lifecycle(
    client: AsyncClient,
) -> None:
    """Test full device lifecycle: issuance, verification, listing, and immediate revocation."""
    organizer = await provision_organizer(client, "Lifecycle Org")
    event_id = await create_event(client, organizer)

    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Main Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point_res.json()["id"]

    # 1. Issue device token
    issue_res = await client.post(
        f"/api/checkin-points/{point_id}/token",
        json={"device_name": "Gate Tablet 1"},
        headers=bearer(organizer),
    )
    assert issue_res.status_code == 201
    device_data = issue_res.json()
    device_id = device_data["device_id"]
    scanner_token = device_data["scanner_token"]
    assert device_id
    assert scanner_token

    scanner_auth = {"Authorization": f"Bearer {scanner_token}"}

    # 2. Legitimate access works (200 OK)
    manifest_ok = await client.get(
        f"/api/checkin-points/{point_id}/manifest",
        headers=scanner_auth,
    )
    assert manifest_ok.status_code == 200

    # 3. Device appears in devices list
    devices_list_res = await client.get(
        f"/api/checkin-points/{point_id}/devices",
        headers=bearer(organizer),
    )
    assert devices_list_res.status_code == 200
    devices = devices_list_res.json()
    assert len(devices) >= 1
    target_device = next(d for d in devices if d["id"] == device_id)
    assert target_device["device_name"] == "Gate Tablet 1"
    assert target_device["is_revoked"] is False

    # 4. Revoke device
    revoke_res = await client.post(
        f"/api/checkin-points/{point_id}/devices/{device_id}/revoke",
        headers=bearer(organizer),
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["is_revoked"] is True

    # 5. Token is immediately rejected with 401 Unauthorized
    manifest_after_revoke = await client.get(
        f"/api/checkin-points/{point_id}/manifest",
        headers=scanner_auth,
    )
    assert manifest_after_revoke.status_code == 401
    assert "revoked" in manifest_after_revoke.json().get("detail", "").lower()

    batch_after_revoke = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": []},
        headers=scanner_auth,
    )
    assert batch_after_revoke.status_code == 401
    assert "revoked" in batch_after_revoke.json().get("detail", "").lower()


async def test_scanner_can_revoke_only_its_own_device_token(
    client: AsyncClient,
) -> None:
    """A scanner may revoke itself; organizer revocation remains separately authorized."""
    organizer = await provision_organizer(client, "Self Revoke Org")
    event_id = await create_unique_test_event(client, organizer)
    point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Self Revoke Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    assert point_res.status_code == 201
    point_id = str(point_res.json()["id"])

    other_point_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Other Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    assert other_point_res.status_code == 201
    other_point_id = str(other_point_res.json()["id"])

    issue_res = await client.post(
        f"/api/checkin-points/{point_id}/token",
        json={"device_name": "Self Revoke Tablet"},
        headers=bearer(organizer),
    )
    assert issue_res.status_code == 201
    scanner_token = issue_res.json()["scanner_token"]
    scanner_auth = {"Authorization": f"Bearer {scanner_token}"}
    revoke_path = f"/api/checkin-points/{point_id}/devices/self/revoke"

    # The operation requires the scanner credential and cannot revoke an arbitrary ID.
    assert (await client.post(revoke_path)).status_code == 401
    assert (await client.post(revoke_path, headers=bearer(organizer))).status_code == 401
    wrong_point_revoke = await client.post(
        f"/api/checkin-points/{other_point_id}/devices/self/revoke",
        headers=scanner_auth,
    )
    assert wrong_point_revoke.status_code == 403
    assert (
        await client.get(
            f"/api/checkin-points/{point_id}/manifest", headers=scanner_auth
        )
    ).status_code == 200
    revoke_res = await client.post(revoke_path, headers=scanner_auth)
    assert revoke_res.status_code == 200, revoke_res.text
    assert revoke_res.json()["is_revoked"] is True

    # Revocation takes effect for both manifest and scan ingestion immediately.
    manifest_res = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=scanner_auth
    )
    batch_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={"scans": []},
        headers=scanner_auth,
    )
    assert manifest_res.status_code == 401
    assert batch_res.status_code == 401

    # The organizer's independent emergency-revoke path remains available.
    second_res = await client.post(
        f"/api/checkin-points/{point_id}/token",
        json={"device_name": "Organizer Revocation Tablet"},
        headers=bearer(organizer),
    )
    assert second_res.status_code == 201
    second = second_res.json()
    organizer_revoke = await client.post(
        f"/api/checkin-points/{point_id}/devices/{second['device_id']}/revoke",
        headers=bearer(organizer),
    )
    assert organizer_revoke.status_code == 200
    assert organizer_revoke.json()["is_revoked"] is True


# ---------------------------------------------------------------------------
# 3. Issue #20 Regression Tests: Scoped Idempotency & Confidentiality
# ---------------------------------------------------------------------------

async def create_unique_test_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    evt = dict(EVENT)
    evt["slug"] = f"scanner-sec-{uuid.uuid4().hex[:8]}"
    resp = await client.post("/api/events", json=evt, headers=bearer(organizer))
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def create_test_attendee_ticket(
    client: AsyncClient, event_id: str, tier_id: str, email: str, name: str
) -> dict[str, Any]:
    """Helper to register user and mint a free ticket."""
    _, token = await register_user(client, email, name)
    resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


async def test_issue_20_same_point_idempotent_replay_preserves_result(
    client: AsyncClient,
) -> None:
    """Same-point retry with identical scan_id and qr_secret remains idempotent."""
    org = await provision_organizer(client, "Same Point Org")
    event_id = await create_unique_test_event(client, org)
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Regular", quota=100),
        headers=bearer(org),
    )
    p_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate 1", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org),
    )
    point_id = p_res.json()["id"]
    tkt = await create_test_attendee_ticket(
        client, event_id, tier_res.json()["id"], "same_point@test.org", "Alice Same"
    )

    scan_id = str(uuid.uuid4())
    payload = {
        "scans": [
            {
                "scan_id": scan_id,
                "qr_secret": tkt["qr_secret"],
                "scanned_at": "2027-04-10T10:00:00Z",
            }
        ]
    }

    # Initial scan -> ADMITTED
    r1 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json=payload,
        headers=bearer(org),
    )
    assert r1.status_code == 200
    res1 = r1.json()["results"][0]
    assert res1["status"] == "ADMITTED"
    assert res1["attendee_name"] == "Alice Same"

    # Legitimate same-point replay -> Idempotent ADMITTED
    r2 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json=payload,
        headers=bearer(org),
    )
    assert r2.status_code == 200
    res2 = r2.json()["results"][0]
    assert res2["status"] == "ADMITTED"
    assert res2["attendee_name"] == "Alice Same"
    assert res2["scan_id"] == scan_id


async def test_issue_20_cross_point_same_event_replay_rejected_without_data_leak(
    client: AsyncClient,
) -> None:
    """Reusing scan_id across different check-in points within the same event is rejected without data leak."""
    org = await provision_organizer(client, "Cross Point Org")
    event_id = await create_unique_test_event(client, org)
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Regular", quota=100),
        headers=bearer(org),
    )

    # Point 1 (Gate A) and Point 2 (Gate B)
    p1_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate A", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org),
    )
    p2_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate B", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org),
    )
    point1_id = p1_res.json()["id"]
    point2_id = p2_res.json()["id"]

    tkt = await create_test_attendee_ticket(
        client, event_id, tier_res.json()["id"], "gate_a@test.org", "Bob GateA"
    )
    scan_id = str(uuid.uuid4())

    # 1. Accepted at Gate A
    r1 = await client.post(
        f"/api/checkin-points/{point1_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": tkt["qr_secret"],
                    "scanned_at": "2027-04-10T10:00:00Z",
                }
            ]
        },
        headers=bearer(org),
    )
    assert r1.status_code == 200
    assert r1.json()["results"][0]["status"] == "ADMITTED"

    # 2. Replayed at Gate B -> MUST BE REJECTED with SCAN_ID_CONFLICT and no attendee data
    r2 = await client.post(
        f"/api/checkin-points/{point2_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": tkt["qr_secret"],
                    "scanned_at": "2027-04-10T10:05:00Z",
                }
            ]
        },
        headers=bearer(org),
    )
    assert r2.status_code == 200
    res2 = r2.json()["results"][0]
    assert res2["status"] == "REJECTED"
    assert res2["rejection_reason"] == "SCAN_ID_CONFLICT"
    assert res2["attendee_name"] is None
    assert res2["ticket_tier_name"] is None


async def test_issue_20_cross_tenant_replay_rejected_without_data_leak(
    client: AsyncClient,
) -> None:
    """Replaying Tenant A's scan_id through Tenant B's scanner point is rejected without disclosing Tenant A's data."""
    org_a = await provision_organizer(client, "Tenant Alpha")
    org_b = await provision_organizer(client, "Tenant Beta")

    event_a = await create_unique_test_event(client, org_a)
    event_b = await create_unique_test_event(client, org_b)

    tier_a = await client.post(
        f"/api/events/{event_a}/ticket-tiers",
        json=tier(name="Alpha Tier", quota=50),
        headers=bearer(org_a),
    )
    tier_b = await client.post(
        f"/api/events/{event_b}/ticket-tiers",
        json=tier(name="Beta Tier", quota=50),
        headers=bearer(org_b),
    )

    p_a = await client.post(
        f"/api/events/{event_a}/checkin-points",
        json={"name": "Alpha Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org_a),
    )
    p_b = await client.post(
        f"/api/events/{event_b}/checkin-points",
        json={"name": "Beta Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org_b),
    )
    point_a_id = p_a.json()["id"]
    point_b_id = p_b.json()["id"]

    # Attendee on Tenant A
    tkt_a = await create_test_attendee_ticket(
        client, event_a, tier_a.json()["id"], "alpha_user@alpha.org", "Dr. Alpha Secret"
    )
    scan_id = str(uuid.uuid4())

    # 1. Ingested legitimately at Tenant A
    r_a = await client.post(
        f"/api/checkin-points/{point_a_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": tkt_a["qr_secret"],
                    "scanned_at": "2027-04-10T10:00:00Z",
                }
            ]
        },
        headers=bearer(org_a),
    )
    assert r_a.status_code == 200
    assert r_a.json()["results"][0]["status"] == "ADMITTED"
    assert r_a.json()["results"][0]["attendee_name"] == "Dr. Alpha Secret"

    # Issue scanner token for Tenant B's point
    tok_b_res = await client.post(
        f"/api/checkin-points/{point_b_id}/token",
        json={"device_name": "Beta Scanner Gun"},
        headers=bearer(org_b),
    )
    beta_scanner_token = tok_b_res.json()["scanner_token"]

    # 2. Tenant B attempts to replay scan_id with dummy or probe secret
    r_b = await client.post(
        f"/api/checkin-points/{point_b_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": "PROBE_UNKNOWN_SECRET_12345",
                    "scanned_at": "2027-04-10T10:05:00Z",
                }
            ]
        },
        headers={"Authorization": f"Bearer {beta_scanner_token}"},
    )
    assert r_b.status_code == 200
    res_b = r_b.json()["results"][0]

    # Crucial security assertions:
    # Status must be REJECTED, reason SCAN_ID_CONFLICT, no attendee identity disclosed,
    # and no foreign QR secret returned!
    assert res_b["status"] == "REJECTED"
    assert res_b["rejection_reason"] == "SCAN_ID_CONFLICT"
    assert res_b["attendee_name"] is None
    assert res_b["ticket_tier_name"] is None
    assert res_b["qr_secret"] == "PROBE_UNKNOWN_SECRET_12345"
    assert res_b["qr_secret"] != tkt_a["qr_secret"]


async def test_issue_20_mismatched_qr_secret_same_scan_id_rejected(
    client: AsyncClient,
) -> None:
    """Sending same scan_id with a different QR secret at the same point is rejected as conflict."""
    org = await provision_organizer(client, "Mismatch Org")
    event_id = await create_unique_test_event(client, org)
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Regular", quota=100),
        headers=bearer(org),
    )
    p_res = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(org),
    )
    point_id = p_res.json()["id"]
    tkt = await create_test_attendee_ticket(
        client, event_id, tier_res.json()["id"], "mismatch@test.org", "Mismatch User"
    )
    scan_id = str(uuid.uuid4())

    # 1. First scan admitted
    r1 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": tkt["qr_secret"],
                    "scanned_at": "2027-04-10T10:00:00Z",
                }
            ]
        },
        headers=bearer(org),
    )
    assert r1.status_code == 200
    assert r1.json()["results"][0]["status"] == "ADMITTED"

    # 2. Replaying same scan_id with different QR secret
    r2 = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": scan_id,
                    "qr_secret": "DIFFERENT_QR_SECRET_TAMPERED",
                    "scanned_at": "2027-04-10T10:05:00Z",
                }
            ]
        },
        headers=bearer(org),
    )
    assert r2.status_code == 200
    res2 = r2.json()["results"][0]
    assert res2["status"] == "REJECTED"
    assert res2["rejection_reason"] == "SCAN_ID_CONFLICT"
    assert res2["attendee_name"] is None
