import uuid
from datetime import timedelta
from typing import Any

import asyncpg
import jwt
import pytest
from httpx import AsyncClient

from app import security
from app.security import create_access_token
from tests.conftest import TEST_JWT_SECRET, TEST_URL
from tests.helpers import bearer as organizer_bearer, desk_sign_in, provision_organizer, request_code
from tests.test_ticket_tiers import create_event
from tests.test_tickets import register_user


async def test_new_number_signs_up_with_sms_code_and_receives_access_token(
    client: AsyncClient,
) -> None:
    code = await request_code(client, "09121000008")
    verified = await client.post("/api/auth/otp/verify", json={"mobile": "09121000008", "code": code})
    assert verified.status_code == 200, verified.text
    assert verified.json()["status"] == "profile_required"
    assert verified.json()["access_token"] is None

    response = await client.post(
        "/api/auth/otp/complete",
        json={
            "signup_token": verified.json()["signup_token"],
            "full_name": "Dr. Mohammad Rezaei",
            "organization": "Tehran University of Medical Sciences",
            "title": "Associate Professor",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    user = body["user"]
    assert user["mobile"] == "09121000008"
    assert user["full_name"] == "Dr. Mohammad Rezaei"
    assert user["organization"] == "Tehran University of Medical Sciences"
    assert user["title"] == "Associate Professor"
    assert set(user) == {"id", "mobile", "full_name", "organization", "title", "share_contact_with_peers", "share_contact_with_exhibitors"}


async def test_known_number_signs_in_with_sms_code(
    client: AsyncClient,
) -> None:
    user, _ = await register_user(client, "09121000008")
    code = await request_code(client, "۰۹۱۲ ۱۰۰ ۰۰۰۸")  # Persian digits and spaces as typed on a phone

    signed_in = await client.post("/api/auth/otp/verify", json={"mobile": "+989121000008", "code": code})

    assert signed_in.status_code == 200
    assert signed_in.json()["status"] == "signed_in"
    token = signed_in.json()["access_token"]
    me_resp = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert me_resp.status_code == 200
    assert me_resp.json() == user


async def test_wrong_sms_code_is_rejected(
    client: AsyncClient,
) -> None:
    code = await request_code(client, "09121000008")
    wrong = "000000" if code != "000000" else "111111"

    wrong_login = await client.post("/api/auth/otp/verify", json={"mobile": "09121000008", "code": wrong})

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
    user, issued = await register_user(client, "09121000009")
    payload = jwt.decode(issued, TEST_JWT_SECRET, algorithms=["HS256"])
    assert payload["type"] == "user"  # Issued sessions name their kind.
    if not typed:
        del payload["type"]  # A session issued before tokens carried a type (still before the cutoff).
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
        json={"mobile": user["mobile"]}, headers=organizer_bearer(organizer),
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
    user, issued = await register_user(client, "09121000010")
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


async def test_untyped_tokens_count_as_user_sessions_only_when_issued_before_the_cutoff(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    user, issued = await register_user(client, "09121000012")
    payload = jwt.decode(issued, TEST_JWT_SECRET, algorithms=["HS256"])
    del payload["type"]
    untyped = bearer(jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256"))
    no_iat = bearer(jwt.encode({k: v for k, v in payload.items() if k != "iat"}, TEST_JWT_SECRET, algorithm="HS256"))
    assert (await client.get("/api/auth/me", headers=untyped)).status_code == 200

    monkeypatch.setattr(security, "LEGACY_UNTYPED_USER_TOKENS_UNTIL", payload["iat"])

    for headers in (untyped, no_iat):
        refused = await client.get("/api/auth/me", headers=headers)
        assert refused.status_code == 401
        assert refused.json() == {"detail": "Invalid token type for user authentication"}
    assert (await client.get("/api/auth/me", headers=bearer(issued))).json() == user


@pytest.mark.parametrize(
    "case", ["missing", "empty", "basic", "garbage", "signature", "expired",
             "missing-sub", "malformed-sub", "missing-user", "deleted-user"],
)
async def test_user_authentication_failures_challenge_bearer(
    client: AsyncClient, case: str,
) -> None:
    user, token = await register_user(client, "09121000011")
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
            uuid.UUID(user["id"]), "different-signing-secret-at-least-32-chars",
        ))
    elif case == "expired":
        headers = bearer(create_access_token(
            uuid.UUID(user["id"]), TEST_JWT_SECRET,
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
            uuid.uuid4(), TEST_JWT_SECRET,
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
        json={"operator_name": "Family Operator", "mobile": "09121000012"},
        headers=organizer_bearer(organizer),
    )
    assert operator.status_code == 201
    login = await desk_sign_in(client, event_id, "09121000012")
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
    user, _ = await register_user(client, "09121000013")
    # A signed-up attendee who is not an operator never receives a desk code, so the login fails as a wrong code.
    nonmember = await desk_sign_in(client, event_id, user["mobile"])
    assert nonmember.status_code == 401
    assert "WWW-Authenticate" not in nonmember.headers


async def test_organizer_bearer_and_platform_admin_status_contracts(
    client: AsyncClient,
) -> None:
    _, user_token = await register_user(client, "09121000014")
    for headers in ({}, bearer("invalid-key"), bearer(user_token)):
        response = await client.get("/api/events", headers=headers)
        assert response.status_code == 401
        assert response.headers.get("WWW-Authenticate") == "Bearer"
    response = await client.post("/api/organizers", json={"name": "Not admin"})
    assert response.status_code == 401
    assert "WWW-Authenticate" not in response.headers
