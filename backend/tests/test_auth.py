import uuid
from datetime import timedelta
from typing import Any

import asyncpg
import jwt
import pytest
from httpx import AsyncClient

from app.security import create_access_token
from tests.conftest import TEST_JWT_SECRET, TEST_URL
from tests.helpers import bearer as organizer_bearer, provision_organizer
from tests.test_ticket_tiers import create_event
from tests.test_tickets import register_user


USER_PAYLOAD = {
    "email": "dr.rezaei@example.com",
    "password": "StrongPassword123!",
    "full_name": "Dr. Mohammad Rezaei",
    "organization": "Tehran University of Medical Sciences",
    "title": "Associate Professor",
}


async def test_attendee_can_register_and_receives_access_token(
    client: AsyncClient,
) -> None:
    response = await client.post("/api/auth/register", json=USER_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"
    user = body["user"]
    assert user["email"] == "dr.rezaei@example.com"
    assert user["full_name"] == "Dr. Mohammad Rezaei"
    assert user["organization"] == "Tehran University of Medical Sciences"
    assert user["title"] == "Associate Professor"
    assert "password" not in user
    assert "password_hash" not in user


async def test_duplicate_email_registration_is_rejected(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)
    duplicate = await client.post("/api/auth/register", json=USER_PAYLOAD)

    assert duplicate.status_code == 409


async def test_attendee_can_login_with_correct_credentials(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "dr.rezaei@example.com", "password": "StrongPassword123!"},
    )

    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    # Verify /api/auth/me using the token
    me_resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "dr.rezaei@example.com"


async def test_login_with_wrong_password_is_rejected(
    client: AsyncClient,
) -> None:
    await client.post("/api/auth/register", json=USER_PAYLOAD)

    wrong_login = await client.post(
        "/api/auth/login",
        json={"email": "dr.rezaei@example.com", "password": "WrongPassword!"},
    )

    assert wrong_login.status_code == 401
    assert "WWW-Authenticate" not in wrong_login.headers


# Shared User dependency consumers: identity, tickets, networking, and partner data.
USER_ENDPOINTS = (
    "/api/auth/me",
    "/api/attendees/me/tickets",
    "/api/attendees/me/network",
    "/api/attendees/me/network/privacy",
    "/api/booths/me",
    "/api/attendees/me/bookmarks/booths",
)

def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("typed", [False, True], ids=["legacy", "typed-user"])
async def test_user_token_family_preserves_identity_and_consumers(
    client: AsyncClient, typed: bool,
) -> None:
    user, issued = await register_user(client, "family@example.com")
    payload = jwt.decode(issued, TEST_JWT_SECRET, algorithms=["HS256"])
    assert "type" not in payload  # Existing issuance remains compatible.
    if typed:
        payload["type"] = "user"
    token = jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")
    for path in USER_ENDPOINTS:
        response = await client.get(path, headers=bearer(token))
        assert response.status_code == 200, (path, response.text)
        assert "WWW-Authenticate" not in response.headers
        if path == "/api/auth/me":
            assert response.json() == user
    organizer = await provision_organizer(client, "Positive booth access")
    event_id = await create_event(client, organizer)
    booth = await client.post(
        f"/api/events/{event_id}/booths",
        json={"name": "Family Booth", "slug": "family-booth"},
        headers=organizer_bearer(organizer),
    )
    assert booth.status_code == 201
    booth_id = booth.json()["id"]
    denied = await client.get(f"/api/booths/{booth_id}", headers=bearer(token))
    assert denied.status_code == 403
    assert "WWW-Authenticate" not in denied.headers
    assignment = await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        json={"email": user["email"]}, headers=organizer_bearer(organizer),
    )
    assert assignment.status_code == 201
    for path in (f"/api/booths/{booth_id}", f"/api/booths/{booth_id}/leads"):
        response = await client.get(path, headers=bearer(token))
        assert response.status_code == 200
        assert "WWW-Authenticate" not in response.headers
    missing = await client.get(f"/api/booths/{uuid.uuid4()}", headers=bearer(token))
    assert missing.status_code == 404
    assert "WWW-Authenticate" not in missing.headers


@pytest.mark.parametrize(
    "token_type",
    ["desk_operator", "scanner", "unknown", None, "", "User", 1, False, [], {}, ["user"]],
    ids=["desk", "scanner", "unknown", "null", "empty", "case", "number",
         "boolean", "array", "object", "user-array"],
)
async def test_non_user_types_rejected_with_existing_uuid_subject(
    client: AsyncClient, token_type: Any,
) -> None:
    user, issued = await register_user(client, "type-guard@example.com")
    payload = jwt.decode(issued, TEST_JWT_SECRET, algorithms=["HS256"])
    assert payload["sub"] == user["id"]
    payload["type"] = token_type
    token = jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")
    paths = (*USER_ENDPOINTS, f"/api/booths/{uuid.uuid4()}",
             f"/api/booths/{uuid.uuid4()}/leads")
    for path in paths:
        response = await client.get(path, headers=bearer(token))
        assert response.status_code == 401, (path, response.text)
        assert response.headers.get("WWW-Authenticate") == "Bearer"
        assert response.json() == {
            "detail": "Invalid token type for user authentication",
        }


@pytest.mark.parametrize(
    "case", ["missing", "empty", "basic", "garbage", "signature", "expired",
             "missing-sub", "malformed-sub", "missing-user", "deleted-user"],
)
async def test_user_authentication_failures_challenge_bearer(
    client: AsyncClient, case: str,
) -> None:
    user, token = await register_user(client, "failure@example.com")
    headers = bearer(token)
    if case == "missing":
        headers = {}
    elif case == "empty":
        headers = {"Authorization": "Bearer"}
    elif case == "basic":
        headers = {"Authorization": "Basic unrelated"}
    elif case == "garbage":
        headers = bearer("not-a-jwt")
    elif case == "signature":
        headers = bearer(create_access_token(
            uuid.UUID(user["id"]), user["email"], "different-signing-secret-at-least-32-chars",
        ))
    elif case == "expired":
        headers = bearer(create_access_token(
            uuid.UUID(user["id"]), user["email"], TEST_JWT_SECRET,
            expires_delta=timedelta(seconds=-1),
        ))
    elif case in ("missing-sub", "malformed-sub"):
        payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
        if case == "missing-sub":
            del payload["sub"]
        else:
            payload["sub"] = "not-a-uuid"
        headers = bearer(jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256"))
    elif case == "missing-user":
        headers = bearer(create_access_token(
            uuid.uuid4(), user["email"], TEST_JWT_SECRET,
        ))
    elif case == "deleted-user":
        connection = await asyncpg.connect(TEST_URL.replace("+asyncpg", ""))
        try:
            await connection.execute("DELETE FROM users WHERE id = $1", uuid.UUID(user["id"]))
        finally:
            await connection.close()
    for path in USER_ENDPOINTS:
        response = await client.get(path, headers=headers)
        assert response.status_code == 401, (path, response.text)
        assert response.headers.get("WWW-Authenticate") == "Bearer"


async def test_actual_issued_credentials_do_not_cross_user_boundary(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Family isolation")
    event_id = await create_event(client, organizer)
    operator = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={"operator_name": "Family Operator", "email": "operator@example.com"},
        headers=organizer_bearer(organizer),
    )
    assert operator.status_code == 201
    login = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": "operator@example.com",
              "password": operator.json()["temporary_password"]},
    )
    assert login.status_code == 200
    desk_token = login.json()["access_token"]
    point = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Family Gate", "policy_type": "MULTI_ENTRY"},
        headers=organizer_bearer(organizer),
    )
    assert point.status_code == 201
    point_id = point.json()["id"]
    scanner = await client.post(
        f"/api/checkin-points/{point_id}/token",
        json={"device_name": "Family scanner"}, headers=organizer_bearer(organizer),
    )
    assert scanner.status_code == 201
    scanner_token = scanner.json()["scanner_token"]
    for credential in (desk_token, scanner_token, organizer["api_key"]):
        for path in (*USER_ENDPOINTS, f"/api/booths/{uuid.uuid4()}",
                     f"/api/booths/{uuid.uuid4()}/leads"):
            response = await client.get(path, headers=bearer(credential))
            assert response.status_code == 401, (path, response.text)
            assert response.headers.get("WWW-Authenticate") == "Bearer"
    # Server-issued credentials still work at their own authorizers.
    desk = await client.get(f"/api/events/{event_id}/desk/me", headers=bearer(desk_token))
    assert desk.status_code == 200
    manifest = await client.get(
        f"/api/checkin-points/{point_id}/manifest", headers=bearer(scanner_token),
    )
    assert manifest.status_code == 200
    for credential in (desk_token, scanner_token):
        response = await client.get("/api/events", headers=bearer(credential))
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"


async def test_desk_and_scanner_malformed_identity_challenges_and_lookup_order(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Challenge matrix")
    foreign = await provision_organizer(client, "Foreign tenant")
    event_id = await create_event(client, organizer)
    point = await client.post(
        f"/api/events/{event_id}/checkin-points",
        json={"name": "Gate", "policy_type": "MULTI_ENTRY"}, headers=organizer_bearer(organizer),
    )
    assert point.status_code == 201
    point_id = point.json()["id"]
    payloads = [
        (f"/api/events/{event_id}/desk/me",
         {"type": "desk_operator", "event_id": event_id, "operator_id": "malformed"}),
        (f"/api/checkin-points/{point_id}/devices/self/revoke",
         {"type": "scanner", "point_id": point_id, "event_id": event_id, "jti": "bad"}),
    ]
    for path, payload in payloads:
        token = jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")
        response = await client.request(
            "POST" if "revoke" in path else "GET", path, headers=bearer(token),
        )
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"
    for path in (f"/api/events/{event_id}", f"/api/events/{event_id}/desk/me",
                 f"/api/checkin-points/{point_id}/manifest"):
        response = await client.get(path, headers=organizer_bearer(foreign))
        assert response.status_code == 404
        assert "WWW-Authenticate" not in response.headers
    for path in (f"/api/events/{uuid.uuid4()}/desk/me",
                 f"/api/checkin-points/{uuid.uuid4()}/manifest"):
        missing = await client.get(path, headers=bearer("invalid"))
        assert missing.status_code == 404
        assert "WWW-Authenticate" not in missing.headers
        anonymous = await client.get(path)
        assert anonymous.status_code == 401
        assert anonymous.headers.get("WWW-Authenticate") == "Bearer"
    user, _ = await register_user(client, "nonmember@example.com")
    nonmember = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": user["email"], "password": "Password123!"},
    )
    assert nonmember.status_code == 403
    assert "WWW-Authenticate" not in nonmember.headers


async def test_organizer_bearer_and_platform_admin_status_contracts(
    client: AsyncClient,
) -> None:
    _, user_token = await register_user(client, "organizer-negative@example.com")
    for headers in ({}, bearer("invalid-key"), bearer(user_token)):
        response = await client.get("/api/events", headers=headers)
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"
    response = await client.post("/api/organizers", json={"name": "Not admin"})
    assert response.status_code == 401
    assert "WWW-Authenticate" not in response.headers
