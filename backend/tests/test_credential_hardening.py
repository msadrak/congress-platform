"""Organizer key rotation/revocation and throttling of repeated failed authentication (wrong SMS codes)."""

import time
import uuid

import jwt
from httpx import AsyncClient

from app.security import create_scanner_token
from tests.conftest import ADMIN_TOKEN, TEST_JWT_SECRET
from tests.helpers import bearer, desk_sign_in, provision_organizer, request_code
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


async def test_rotation_replaces_the_key_immediately_and_shows_the_new_one_once(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    rotated = await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)

    assert rotated.status_code == 200
    new_key = rotated.json()["api_key"]
    assert new_key != organizer["api_key"] and len(new_key) >= 40
    assert (await client.get("/api/events", headers=bearer(organizer))).status_code == 401
    events = await client.get("/api/events", headers={"Authorization": f"Bearer {new_key}"})
    assert [e["id"] for e in events.json()] == [event_id]
    listed = (await client.get("/api/organizers", headers=ADMIN)).json()
    assert listed[0]["key_rotated_at"] is not None
    assert new_key not in str(listed) and organizer["api_key"] not in str(listed)
    assert set(listed[0]) == {"id", "name", "created_at", "revoked_at", "key_rotated_at"}


async def test_revocation_rejects_the_key_keeps_the_data_and_rotation_reinstates(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    event_id = await create_event(client, organizer)

    revoked = await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)

    assert revoked.json()["revoked_at"] is not None
    denied = await client.get(f"/api/events/{event_id}", headers=bearer(organizer))
    unknown = await client.get(f"/api/events/{event_id}", headers={"Authorization": "Bearer not-a-key"})
    assert denied.status_code == unknown.status_code == 401
    assert denied.json() == unknown.json()
    assert (await client.get("/api/events", headers=bearer(other))).status_code == 200
    reinstated = (await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)).json()
    again = await client.get(f"/api/events/{event_id}", headers={"Authorization": f"Bearer {reinstated['api_key']}"})
    assert again.status_code == 200
    assert (await client.get(f"/api/events/{event_id}", headers=bearer(organizer))).status_code == 401


async def test_lifecycle_endpoints_require_the_platform_admin_token(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    for path in (f"/api/organizers/{organizer['id']}/rotate-key", f"/api/organizers/{organizer['id']}/revoke"):
        assert (await client.post(path)).status_code == 401
        assert (await client.post(path, headers=bearer(other))).status_code == 401
        assert (await client.post(path, headers=bearer(organizer))).status_code == 401
    assert (await client.get("/api/organizers", headers=bearer(organizer))).status_code == 401
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.post(f"/api/organizers/{missing}/rotate-key", headers=ADMIN)).status_code == 404
    assert (await client.get("/api/events", headers=bearer(organizer))).status_code == 200


async def test_repeated_wrong_codes_lock_the_number_without_affecting_others(client: AsyncClient) -> None:
    await register_user(client, "09121000027")
    wrong = {"mobile": "09121000027", "code": "000000"}

    statuses = [(await client.post("/api/auth/otp/verify", json=wrong)).status_code for _ in range(10)]
    locked = await client.post("/api/auth/otp/verify", json={"mobile": "09121000027", "code": "123456"})
    desk_locked = await client.post(
        "/api/events/00000000-0000-0000-0000-000000000000/desk/login",
        json={"mobile": "09121000027", "code": "123456"},
    )
    bystander_code = await request_code(client, "09121000028")
    bystander = await client.post("/api/auth/otp/verify", json={"mobile": "09121000028", "code": bystander_code})

    assert statuses == [401] * 10
    assert locked.status_code == 429 and int(locked.headers["retry-after"]) > 0
    assert desk_locked.status_code in (404, 429)  # unknown event is checked first; never a sign-in
    assert bystander.status_code == 200


async def test_a_successful_sign_in_clears_the_number_failures(client: AsyncClient) -> None:
    code = await request_code(client, "09121000029")
    # Below the per-code limit of 5 guesses, so the real code still works afterwards.
    for _ in range(4):
        await client.post("/api/auth/otp/verify", json={"mobile": "09121000029", "code": "000000"})
    ok = await client.post("/api/auth/otp/verify", json={"mobile": "09121000029", "code": code})
    later = [
        (await client.post("/api/auth/otp/verify", json={"mobile": "09121000029", "code": "000000"})).status_code
        for _ in range(9)
    ]
    assert ok.status_code == 200
    assert later == [401] * 9


async def test_admin_token_guessing_is_throttled_per_client(client: AsyncClient) -> None:
    for _ in range(10):
        assert (await client.post("/api/organizers", json={"name": "x"}, headers={"X-Admin-Token": "guess"})).status_code == 401
    blocked = await client.post("/api/organizers", json={"name": "x"}, headers=ADMIN)
    assert blocked.status_code == 429


async def _gate_and_pass(client: AsyncClient, organizer: dict[str, str], event_id: str) -> tuple[str, str]:
    """A check-in point and a desk-issued pass for the event; returns (point id, ticket id)."""
    tier_id = (await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))).json()["id"]
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    issued = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Dr. Sima Rad", "mobile": "09121000041", "ticket_tier_id": tier_id},
        headers=bearer(organizer),
    )
    assert point.status_code == 201 and issued.status_code == 201, issued.text
    return point.json()["id"], issued.json()["ticket_id"]


async def _scanner_and_desk_statuses(
    client: AsyncClient, headers: dict[str, str], event_id: str, point_id: str, ticket_id: str
) -> dict[str, int]:
    scan = {"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": "x", "scanned_at": "2026-10-22T08:00:00Z"}]}
    registration = {"full_name": "Walk In", "ticket_tier_id": str(uuid.uuid4())}
    return {
        "manifest": (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=headers)).status_code,
        "scans": (await client.post(f"/api/checkin-points/{point_id}/scans/batch", json=scan, headers=headers)).status_code,
        "desk search": (await client.get(f"/api/events/{event_id}/attendees", headers=headers)).status_code,
        "desk registration": (
            await client.post(f"/api/events/{event_id}/desk-registrations", json=registration, headers=headers)
        ).status_code,
        "resend sms": (
            await client.post(f"/api/events/{event_id}/attendees/{ticket_id}/resend-sms", headers=headers)
        ).status_code,
    }


async def test_a_revoked_key_and_the_scanner_and_desk_sessions_it_issued_stop_working(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point_id, ticket_id = await _gate_and_pass(client, organizer, event_id)
    scanner = await client.post(f"/api/checkin-points/{point_id}/token", headers=bearer(organizer))
    await client.post(
        f"/api/events/{event_id}/desk/operators", json={"operator_name": "Sara", "mobile": "09121000042"},
        headers=bearer(organizer),
    )
    desk = await desk_sign_in(client, event_id, "09121000042")
    scanner_auth = {"Authorization": f"Bearer {scanner.json()['scanner_token']}"}
    desk_auth = {"Authorization": f"Bearer {desk.json()['access_token']}"}
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=scanner_auth)).status_code == 200
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=desk_auth)).status_code == 200

    await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)

    refused = dict.fromkeys(("manifest", "scans", "desk search", "desk registration", "resend sms"), 401)
    assert await _scanner_and_desk_statuses(client, bearer(organizer), event_id, point_id, ticket_id) == refused
    by_scanner = await _scanner_and_desk_statuses(client, scanner_auth, event_id, point_id, ticket_id)
    assert (by_scanner["manifest"], by_scanner["scans"]) == (401, 401)
    by_desk = await _scanner_and_desk_statuses(client, desk_auth, event_id, point_id, ticket_id)
    assert (by_desk["desk search"], by_desk["desk registration"], by_desk["resend sms"]) == (401, 401, 401)
    assert (await desk_sign_in(client, event_id, "09121000042")).status_code == 403


async def test_rotation_reinstates_scanner_and_desk_routes_for_the_new_key_only(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point_id, _ = await _gate_and_pass(client, organizer, event_id)
    await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)

    new_key = (await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)).json()["api_key"]

    fresh = {"Authorization": f"Bearer {new_key}"}
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=fresh)).status_code == 200
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=fresh)).status_code == 200
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=bearer(organizer))).status_code == 401


async def test_wrong_keys_on_scanner_and_desk_routes_count_toward_the_api_key_throttle(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point_id, _ = await _gate_and_pass(client, organizer, event_id)
    guess = {"Authorization": "Bearer not-a-key"}

    statuses = [
        (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=guess)).status_code for _ in range(25)
    ] + [(await client.get(f"/api/events/{event_id}/attendees", headers=guess)).status_code for _ in range(25)]

    assert statuses == [401] * 50
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=guess)).status_code == 429
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=guess)).status_code == 429
    assert (await client.get("/api/events", headers=guess)).status_code == 429
    # The real key is never refused for its neighbours' guesses (a venue NAT shares one address).
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=bearer(organizer))).status_code == 200


async def test_scanner_tokens_without_a_registered_device_are_refused(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point_id, _ = await _gate_and_pass(client, organizer, event_id)
    now = int(time.time())
    no_jti = jwt.encode(
        {"type": "scanner", "sub": f"scanner:{point_id}", "point_id": point_id, "event_id": event_id,
         "iat": now, "exp": now + 600},
        TEST_JWT_SECRET, algorithm="HS256",
    )
    unknown_device = create_scanner_token(uuid.UUID(point_id), uuid.UUID(event_id), TEST_JWT_SECRET, device_id=uuid.uuid4())
    random_jti = create_scanner_token(uuid.UUID(point_id), uuid.UUID(event_id), TEST_JWT_SECRET)

    for token in (no_jti, unknown_device, random_jti):
        refused = await client.get(f"/api/checkin-points/{point_id}/manifest", headers={"Authorization": f"Bearer {token}"})
        assert refused.status_code == 401, refused.text
