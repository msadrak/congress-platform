"""Scanner revocation failure-matrix integration tests.

Covers:
- Successful scanner self-revocation
- Organizer emergency revocation (regardless of client state)
- Invalid, expired, and cross-scope credential rejection
- Duplicate/concurrent revocation requests (idempotent)
- HTTP 401, 403, 404, 500 response handling
- Old-token rejection after confirmed revocation
- Scan ID preservation and conflict history
- Cross-point and cross-tenant isolation during revocation
"""

import asyncio
from typing import Any
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient

from app.security import create_scanner_token
from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def _create_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    evt = dict(EVENT)
    evt["slug"] = f"rev-matrix-{uuid.uuid4().hex[:8]}"
    resp = await client.post("/api/events", json=evt, headers=bearer(organizer))
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _create_point(
    client: AsyncClient, organizer: dict[str, str], event_id: str, name: str
) -> str:
    resp = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": name, "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def _issue_scanner(
    client: AsyncClient, organizer: dict[str, str], point_id: str
) -> dict[str, str]:
    resp = await client.post(
        f"/api/checkin-points/{point_id}/token",
        json={"device_name": f"Device-{uuid.uuid4().hex[:6]}"},
        headers=bearer(organizer),
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


def _scanner_auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_ticket(
    client: AsyncClient, event_id: str, tier_id: str, email: str, name: str
) -> dict[str, Any]:
    _, token = await register_user(client, email, name)
    resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


# ---------------------------------------------------------------------------
# 1. Successful Self-Revocation
# ---------------------------------------------------------------------------

async def test_self_revoke_successful_flow(client: AsyncClient) -> None:
    """Scanner self-revokes, server confirms, old token rejected."""
    org = await provision_organizer(client, "Revoke Success Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Main Gate")
    issued = await _issue_scanner(client, org, point_id)

    # Verify token works before revoke
    manifest_res = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=_scanner_auth(issued["scanner_token"])
    )
    assert manifest_res.status_code == 200

    # Self-revoke
    revoke_res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["is_revoked"] is True

    # Verify old token is rejected
    manifest_after = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=_scanner_auth(issued["scanner_token"])
    )
    assert manifest_after.status_code == 401
    assert "revoked" in manifest_after.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 2. Organizer Emergency Revocation
# ---------------------------------------------------------------------------

async def test_organizer_emergency_revoke_with_pending_scans(client: AsyncClient) -> None:
    """Organizer can revoke a device even if it has unsynchronized scans."""
    org = await provision_organizer(client, "Emergency Revoke Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Emergency Gate")
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=10),
        headers=bearer(org),
    )
    tier_id = str(tier_res.json()["id"])
    ticket = await _create_ticket(client, event_id, tier_id, "emergency@test.com", "Emergency User")
    issued = await _issue_scanner(client, org, point_id)

    # Submit scans (simulating offline queue that would sync later)
    scan_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {
                    "scan_id": str(uuid.uuid4()),
                    "qr_secret": ticket["qr_secret"],
                    "scanned_at": "2027-04-10T10:00:00Z",
                }
            ]
        },
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert scan_res.status_code == 200
    assert scan_res.json()["results"][0]["status"] == "ADMITTED"

    # Organizer emergency revoke — must succeed regardless of scan state
    revoke_res = await client.post(
        f"/api/checkin-points/{point_id}/devices/{issued['device_id']}/revoke",
        headers=bearer(org),
    )
    assert revoke_res.status_code == 200
    assert revoke_res.json()["is_revoked"] is True

    # Old token immediately rejected
    manifest_after = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=_scanner_auth(issued["scanner_token"])
    )
    assert manifest_after.status_code == 401


async def test_organizer_revoke_requires_organizer_auth(client: AsyncClient) -> None:
    """Organizer revoke endpoint rejects scanner credentials."""
    org = await provision_organizer(client, "Organizer Auth Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Auth Gate")
    issued = await _issue_scanner(client, org, point_id)

    # Scanner cannot use organizer revoke endpoint
    scanner_revoke = await client.post(
        f"/api/checkin-points/{point_id}/devices/{issued['device_id']}/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert scanner_revoke.status_code == 401

    # No auth also rejected
    no_auth = await client.post(
        f"/api/checkin-points/{point_id}/devices/{issued['device_id']}/revoke"
    )
    assert no_auth.status_code == 401


# ---------------------------------------------------------------------------
# 3. Invalid, Expired, and Cross-Scope Credentials
# ---------------------------------------------------------------------------

async def test_revoke_rejects_invalid_token(client: AsyncClient) -> None:
    """Malformed or invalid tokens are rejected with 401."""
    org = await provision_organizer(client, "Invalid Token Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Invalid Gate")

    # Malformed token
    res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers={"Authorization": "Bearer not-a-valid-jwt"},
    )
    assert res.status_code == 401

    # Tampered token (valid format, invalid signature)
    tampered = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoic2Nhbm5lciIsInBvaW50X2lkIjoiMTIzNCIsImV2ZW50X2lkIjoiNTY3OCJ9.tampered-signature"
    res2 = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers={"Authorization": f"Bearer {tampered}"},
    )
    assert res2.status_code == 401


async def test_revoke_rejects_expired_token(client: AsyncClient) -> None:
    """Expired scanner tokens are rejected with 401."""
    org = await provision_organizer(client, "Expired Token Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Expired Gate")

    # Create an already-expired token
    expired_token = create_scanner_token(
        point_id=uuid.UUID(point_id),
        event_id=uuid.UUID(event_id),
        secret="test-secure-jwt-secret-minimum-32-chars-long-for-testing",
        device_id=uuid.uuid4(),
        expires_delta=timedelta(seconds=-3600),  # Expired 1 hour ago
    )

    res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(expired_token),
    )
    assert res.status_code == 401
    assert "expired" in res.json()["detail"].lower()


async def test_revoke_rejects_cross_point_token(client: AsyncClient) -> None:
    """Token for Point A cannot revoke device at Point B."""
    org = await provision_organizer(client, "Cross Point Org")
    event_id = await _create_event(client, org)
    point_a = await _create_point(client, org, event_id, "Gate A")
    point_b = await _create_point(client, org, event_id, "Gate B")
    issued_a = await _issue_scanner(client, org, point_a)

    # Try to use Point A's token at Point B
    res = await client.post(
        f"/api/checkin-points/{point_b}/devices/self/revoke",
        headers=_scanner_auth(issued_a["scanner_token"]),
    )
    assert res.status_code == 403
    assert "scope" in res.json()["detail"].lower()


async def test_revoke_rejects_cross_tenant_token(client: AsyncClient) -> None:
    """Scanner token from Org A cannot access Org B's check-in point."""
    org_a = await provision_organizer(client, "Tenant A")
    org_b = await provision_organizer(client, "Tenant B")
    event_a = await _create_event(client, org_a)
    event_b = await _create_event(client, org_b)
    point_a = await _create_point(client, org_a, event_a, "Gate A")
    point_b = await _create_point(client, org_b, event_b, "Gate B")
    issued_a = await _issue_scanner(client, org_a, point_a)

    # Org A's scanner token at Org B's point — should fail
    res = await client.post(
        f"/api/checkin-points/{point_b}/devices/self/revoke",
        headers=_scanner_auth(issued_a["scanner_token"]),
    )
    assert res.status_code == 403  # Point scope is checked before resource lookup.
    assert "WWW-Authenticate" not in res.headers


async def test_revoke_rejects_attendee_token(client: AsyncClient) -> None:
    """Regular attendee JWT cannot be used for scanner operations."""
    org = await provision_organizer(client, "Attendee Token Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Attendee Gate")
    _, attendee_token = await register_user(client, "attendee@test.com", "Attendee User")

    res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers={"Authorization": f"Bearer {attendee_token}"},
    )
    assert res.status_code == 403
    assert "scanner" in res.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 4. Duplicate/Concurrent Revocation Requests
# ---------------------------------------------------------------------------

async def test_duplicate_self_revoke_is_idempotent(client: AsyncClient) -> None:
    """Second self-revoke request returns 401 (already revoked)."""
    org = await provision_organizer(client, "Duplicate Revoke Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Duplicate Gate")
    issued = await _issue_scanner(client, org, point_id)

    # First revoke succeeds
    first = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert first.status_code == 200

    # Second revoke with same token fails (already revoked)
    second = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert second.status_code == 401
    assert "revoked" in second.json()["detail"].lower()


async def test_concurrent_self_revoke_requests(client: AsyncClient) -> None:
    """Concurrent self-revoke requests are handled safely (one wins)."""
    org = await provision_organizer(client, "Concurrent Revoke Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Concurrent Gate")
    issued = await _issue_scanner(client, org, point_id)

    # Fire two concurrent revoke requests
    results = await asyncio.gather(
        client.post(
            f"/api/checkin-points/{point_id}/devices/self/revoke",
            headers=_scanner_auth(issued["scanner_token"]),
        ),
        client.post(
            f"/api/checkin-points/{point_id}/devices/self/revoke",
            headers=_scanner_auth(issued["scanner_token"]),
        ),
        return_exceptions=True,
    )

    # One should succeed, one should fail with 401
    statuses = [r.status_code for r in results if hasattr(r, "status_code")]
    assert 200 in statuses
    assert 401 in statuses


async def test_concurrent_organizer_and_self_revoke(client: AsyncClient) -> None:
    """Organizer and scanner concurrent revokes are both handled."""
    org = await provision_organizer(client, "Mixed Concurrent Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Mixed Gate")
    issued = await _issue_scanner(client, org, point_id)

    # Fire concurrent self-revoke and organizer revoke
    results = await asyncio.gather(
        client.post(
            f"/api/checkin-points/{point_id}/devices/self/revoke",
            headers=_scanner_auth(issued["scanner_token"]),
        ),
        client.post(
            f"/api/checkin-points/{point_id}/devices/{issued['device_id']}/revoke",
            headers=bearer(org),
        ),
        return_exceptions=True,
    )

    # Both should succeed (idempotent operations)
    statuses = [r.status_code for r in results if hasattr(r, "status_code")]
    assert all(s == 200 for s in statuses)


# ---------------------------------------------------------------------------
# 5. HTTP Error Response Handling
# ---------------------------------------------------------------------------

async def test_revoke_checks_scope_before_nonexistent_point(client: AsyncClient) -> None:
    """A token for another point fails scope before the missing-point lookup."""
    org = await provision_organizer(client, "404 Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Real Gate")
    issued = await _issue_scanner(client, org, point_id)

    fake_point_id = str(uuid.uuid4())
    res = await client.post(
        f"/api/checkin-points/{fake_point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert res.status_code == 403
    assert "WWW-Authenticate" not in res.headers


async def test_revoke_returns_401_for_missing_credentials(client: AsyncClient) -> None:
    """Missing Authorization header returns 401."""
    org = await provision_organizer(client, "No Auth Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "No Auth Gate")

    res = await client.post(f"/api/checkin-points/{point_id}/devices/self/revoke")
    assert res.status_code == 401
    assert "missing" in res.json()["detail"].lower()


async def test_revoke_returns_401_for_wrong_auth_type(client: AsyncClient) -> None:
    """Organizer API key used as Bearer token returns 401."""
    org = await provision_organizer(client, "Wrong Auth Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Wrong Auth Gate")

    # Using organizer's API key as Bearer token (not a JWT)
    res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers={"Authorization": f"Bearer {org['api_key']}"},
    )
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# 6. Old-Token Rejection After Confirmed Revocation
# ---------------------------------------------------------------------------

async def test_old_token_rejected_for_all_operations(client: AsyncClient) -> None:
    """After revocation, old token is rejected for manifest, batch, and self-revoke."""
    org = await provision_organizer(client, "Old Token Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Old Token Gate")
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=10),
        headers=bearer(org),
    )
    tier_id = str(tier_res.json()["id"])
    ticket = await _create_ticket(client, event_id, tier_id, "oldtoken@test.com", "Old Token User")
    issued = await _issue_scanner(client, org, point_id)

    # Confirm revocation
    revoke_res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert revoke_res.status_code == 200

    # All subsequent operations with old token must fail
    operations = [
        ("GET", f"/api/checkin-points/{point_id}/manifest"),
        ("POST", f"/api/checkin-points/{point_id}/scans/batch"),
        ("POST", f"/api/checkin-points/{point_id}/devices/self/revoke"),
    ]
    for method, path in operations:
        if method == "GET":
            res = await client.get(path, headers=_scanner_auth(issued["scanner_token"]))
        else:
            res = await client.post(
                path,
                json={"scans": []} if "batch" in path else None,
                headers=_scanner_auth(issued["scanner_token"]),
            )
        assert res.status_code == 401, f"{method} {path} should return 401"
        assert "revoked" in res.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 7. Scan ID Preservation and Conflict History
# ---------------------------------------------------------------------------

async def test_scan_ids_preserved_after_revocation(client: AsyncClient) -> None:
    """Scan IDs submitted before revocation remain in the database."""
    org = await provision_organizer(client, "Scan Preserve Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Preserve Gate")
    tier_res = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=10),
        headers=bearer(org),
    )
    tier_id = str(tier_res.json()["id"])
    ticket = await _create_ticket(client, event_id, tier_id, "preserve@test.com", "Preserve User")
    issued = await _issue_scanner(client, org, point_id)

    # Submit scans with known IDs
    scan_ids = [str(uuid.uuid4()) for _ in range(3)]
    scan_res = await client.post(
        f"/api/checkin-points/{point_id}/scans/batch",
        json={
            "scans": [
                {"scan_id": scan_ids[0], "qr_secret": ticket["qr_secret"], "scanned_at": "2027-04-10T08:00:00Z"},
                {"scan_id": scan_ids[1], "qr_secret": ticket["qr_secret"], "scanned_at": "2027-04-10T08:05:00Z"},
                {"scan_id": scan_ids[2], "qr_secret": "invalid-secret", "scanned_at": "2027-04-10T08:10:00Z"},
            ]
        },
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert scan_res.status_code == 200
    results = scan_res.json()["results"]
    assert results[0]["status"] == "ADMITTED"
    assert results[1]["status"] == "ADMITTED"
    assert results[2]["status"] == "REJECTED"

    # Revoke the device
    revoke_res = await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )
    assert revoke_res.status_code == 200

    # Issue a new scanner and verify old scans are preserved
    new_issued = await _issue_scanner(client, org, point_id)
    manifest_res = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=_scanner_auth(new_issued["scanner_token"])
    )
    assert manifest_res.status_code == 200
    manifest = manifest_res.json()
    # The manifest should reflect the admitted tickets from before revocation
    admitted_tickets = [t for t in manifest["tickets"] if t.get("is_admitted")]
    assert len(admitted_tickets) >= 1, "Previously admitted tickets should still show as admitted"


# ---------------------------------------------------------------------------
# 8. Cross-Point Isolation During Revocation
# ---------------------------------------------------------------------------

async def test_revoking_one_point_does_not_affect_others(client: AsyncClient) -> None:
    """Revoking device at Point A does not affect Point B or other events."""
    org = await provision_organizer(client, "Isolation Org")
    event_a = await _create_event(client, org)
    event_b = await _create_event(client, org)
    point_a1 = await _create_point(client, org, event_a, "Gate A1")
    point_a2 = await _create_point(client, org, event_a, "Gate A2")
    point_b1 = await _create_point(client, org, event_b, "Gate B1")

    issued_a1 = await _issue_scanner(client, org, point_a1)
    issued_a2 = await _issue_scanner(client, org, point_a2)
    issued_b1 = await _issue_scanner(client, org, point_b1)

    # Revoke A1
    revoke_res = await client.post(
        f"/api/checkin-points/{point_a1}/devices/self/revoke",
        headers=_scanner_auth(issued_a1["scanner_token"]),
    )
    assert revoke_res.status_code == 200

    # A1 token is dead
    assert (await client.get(f"/api/checkin-points/{point_a1}/manifest", headers=_scanner_auth(issued_a1["scanner_token"]))).status_code == 401

    # A2 and B1 still work
    assert (await client.get(f"/api/checkin-points/{point_a2}/manifest", headers=_scanner_auth(issued_a2["scanner_token"]))).status_code == 200
    assert (await client.get(f"/api/checkin-points/{point_b1}/manifest", headers=_scanner_auth(issued_b1["scanner_token"]))).status_code == 200


# ---------------------------------------------------------------------------
# 9. Organizer Revoke of Already-Revoked Device
# ---------------------------------------------------------------------------

async def test_organizer_revoke_already_revoked_device(client: AsyncClient) -> None:
    """Organizer revoking an already-revoked device returns 200 (idempotent)."""
    org = await provision_organizer(client, "Idempotent Org")
    event_id = await _create_event(client, org)
    point_id = await _create_point(client, org, event_id, "Idempotent Gate")
    issued = await _issue_scanner(client, org, point_id)

    # Self-revoke first
    await client.post(
        f"/api/checkin-points/{point_id}/devices/self/revoke",
        headers=_scanner_auth(issued["scanner_token"]),
    )

    # Organizer revoke should still succeed (idempotent)
    org_revoke = await client.post(
        f"/api/checkin-points/{point_id}/devices/{issued['device_id']}/revoke",
        headers=bearer(org),
    )
    assert org_revoke.status_code == 200
    assert org_revoke.json()["is_revoked"] is True
