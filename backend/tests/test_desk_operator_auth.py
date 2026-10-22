import asyncio
import uuid
from typing import Any

import jwt
import pytest
from httpx import AsyncClient

from tests.helpers import bearer, desk_sign_in, provision_organizer, sign_in
from tests.conftest import TEST_JWT_SECRET
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier


async def test_organizer_can_create_list_and_revoke_desk_operator(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Congress Org Alpha")
    event_id = await create_event(client, organizer)

    # 1. Create desk operator
    create_resp = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={
            "operator_name": "Sara Ahmadi",
            "mobile": "09121000030",
        },
        headers=bearer(organizer),
    )
    assert create_resp.status_code == 201, create_resp.text
    created_data = create_resp.json()
    assert created_data["operator_name"] == "Sara Ahmadi"
    assert created_data["mobile"] == "09121000030"
    assert created_data["is_revoked"] is False
    # No password exists to hand over: the operator signs in with an SMS code to this number.
    assert "temporary_password" not in created_data
    operator_id = created_data["id"]

    # 2. Cannot create duplicate active operator with same mobile in same event
    dup_resp = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={
            "operator_name": "Sara Duplicate",
            "mobile": "09121000030",
        },
        headers=bearer(organizer),
    )
    assert dup_resp.status_code == 409

    # 3. List operators
    list_resp = await client.get(
        f"/api/events/{event_id}/desk/operators",
        headers=bearer(organizer),
    )
    assert list_resp.status_code == 200
    operators = list_resp.json()
    assert len(operators) == 1
    assert operators[0]["id"] == operator_id
    assert operators[0]["mobile"] == "09121000030"

    # 4. Revoke operator
    revoke_resp = await client.delete(
        f"/api/events/{event_id}/desk/operators/{operator_id}",
        headers=bearer(organizer),
    )
    assert revoke_resp.status_code == 200
    revoked_data = revoke_resp.json()
    assert revoked_data["is_revoked"] is True
    assert revoked_data["revoked_at"] is not None


async def test_desk_operator_login_and_me_profile(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Congress Org Beta")
    event_id = await create_event(client, organizer)

    create_resp = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={
            "operator_name": "Ali Moradi",
            "mobile": "09121000031",
        },
        headers=bearer(organizer),
    )
    assert create_resp.status_code == 201

    # Wrong code
    bad_login = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"mobile": "09121000031", "code": "000000"},
    )
    assert bad_login.status_code == 401
    assert "WWW-Authenticate" not in bad_login.headers

    # Valid login with the SMS code
    login_resp = await desk_sign_in(client, event_id, "09121000031")
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    assert "access_token" in login_data
    assert login_data["token_type"] == "bearer"
    assert login_data["operator"]["operator_name"] == "Ali Moradi"
    operator_token = login_data["access_token"]
    op_bearer = {"Authorization": f"Bearer {operator_token}"}

    # Call desk/me with operator token
    me_resp = await client.get(
        f"/api/events/{event_id}/desk/me",
        headers=op_bearer,
    )
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["operator_name"] == "Ali Moradi"
    assert me_data["is_organizer_admin"] is False
    assert me_data["event_id"] == event_id

    # Call desk/me with organizer master token
    me_admin_resp = await client.get(
        f"/api/events/{event_id}/desk/me",
        headers=bearer(organizer),
    )
    assert me_admin_resp.status_code == 200
    admin_me_data = me_admin_resp.json()
    assert admin_me_data["is_organizer_admin"] is True
    assert admin_me_data["operator_id"] is None


async def test_desk_operator_can_perform_walkin_registration_with_audit_attribution(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Congress Org Gamma")
    event_id = await create_event(client, organizer)

    # Add tier
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="VIP Guest", quota=50),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Provision desk operator
    op_create = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={
            "operator_name": "Nima Rad",
            "mobile": "09121000032",
        },
        headers=bearer(organizer),
    )
    assert op_create.status_code == 201

    # Login as operator
    login_resp = await desk_sign_in(client, event_id, "09121000032")
    token = login_resp.json()["access_token"]
    op_headers = {"Authorization": f"Bearer {token}"}

    # Operator gets ticket tiers via desk/tiers
    tiers_resp = await client.get(
        f"/api/events/{event_id}/desk/tiers",
        headers=op_headers,
    )
    assert tiers_resp.status_code == 200
    tiers_list = tiers_resp.json()
    assert any(t["id"] == tier_id for t in tiers_list)

    # Operator performs walk-in registration
    reg_resp = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={
            "full_name": "Dr. Farhad Tehrani",
            "mobile": "09121000033",
            "organization": "University of Medical Sciences",
            "title": "Professor",
            "ticket_tier_id": tier_id,
        },
        headers=op_headers,
    )
    assert reg_resp.status_code == 201, reg_resp.text
    ticket_data = reg_resp.json()
    ticket_id = ticket_data["ticket_id"]

    # Search attendees returns issued_by attribution
    search_resp = await client.get(
        f"/api/events/{event_id}/attendees",
        params={"q": "Farhad"},
        headers=op_headers,
    )
    assert search_resp.status_code == 200
    search_results = search_resp.json()
    assert len(search_results) == 1
    assert search_results[0]["ticket_id"] == ticket_id
    assert search_results[0]["issued_by"] == "Nima Rad"

    # Detail card returns issued_by attribution
    card_resp = await client.get(
        f"/api/events/{event_id}/attendees/{ticket_id}",
        headers=op_headers,
    )
    assert card_resp.status_code == 200
    card_data = card_resp.json()
    assert card_data["issued_by"] == "Nima Rad"
async def test_cross_event_operator_isolation_and_revocation_enforcement(
    client: AsyncClient,
) -> None:
    # Event 1
    org1 = await provision_organizer(client, "Org One")
    resp1 = await client.post(
        "/api/events",
        json={**EVENT, "slug": f"event-one-{uuid.uuid4().hex[:6]}"},
        headers=bearer(org1),
    )
    assert resp1.status_code == 201
    event1 = resp1.json()["id"]

    # Event 2
    org2 = await provision_organizer(client, "Org Two")
    resp2 = await client.post(
        "/api/events",
        json={**EVENT, "slug": f"event-two-{uuid.uuid4().hex[:6]}"},
        headers=bearer(org2),
    )
    assert resp2.status_code == 201
    event2 = resp2.json()["id"]

    tier2_resp = await client.post(
        f"/api/events/{event2}/ticket-tiers",
        json=tier(name="Standard", quota=20),
        headers=bearer(org2),
    )
    tier2_id = tier2_resp.json()["id"]

    # Operator for Event 1
    op1_resp = await client.post(
        f"/api/events/{event1}/desk/operators",
        json={
            "operator_name": "Gate Operator 1",
            "mobile": "09121000034",
        },
        headers=bearer(org1),
    )
    op1_id = op1_resp.json()["id"]

    login1 = await desk_sign_in(client, event1, "09121000034")
    token1 = login1.json()["access_token"]
    op1_headers = {"Authorization": f"Bearer {token1}"}

    # Cross-event access: Operator for Event 1 cannot access Event 2 desk endpoints
    cross_search = await client.get(
        f"/api/events/{event2}/attendees",
        headers=op1_headers,
    )
    assert cross_search.status_code == 403
    assert "WWW-Authenticate" not in cross_search.headers

    cross_reg = await client.post(
        f"/api/events/{event2}/desk-registrations",
        json={
            "full_name": "Cross Intruder",
            "ticket_tier_id": tier2_id,
        },
        headers=op1_headers,
    )
    assert cross_reg.status_code == 403

    # Revoke operator in Event 1
    revoke_resp = await client.delete(
        f"/api/events/{event1}/desk/operators/{op1_id}",
        headers=bearer(org1),
    )
    assert revoke_resp.status_code == 200

    # Subsequent login is rejected: a revoked operator is not even sent a desk code
    revoked_login = await desk_sign_in(client, event1, "09121000034")
    assert revoked_login.status_code == 401
    assert "WWW-Authenticate" not in revoked_login.headers

    # Existing token cannot be used anymore
    revoked_search = await client.get(
        f"/api/events/{event1}/attendees",
        headers=op1_headers,
    )
    assert revoked_search.status_code == 401
    assert revoked_search.headers.get("WWW-Authenticate") == "Bearer"


async def test_old_desk_session_never_revives_after_reactivation(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Generation lifecycle")
    event_id = await create_event(client, organizer)
    base = f"/api/events/{event_id}"
    assignment = {"mobile": "09121000035", "operator_name": "Reception"}
    created = await client.post(
        f"{base}/desk/operators", json=assignment, headers=bearer(organizer),
    )
    assert created.status_code == 201
    operator_id = created.json()["id"]
    mobile = assignment["mobile"]
    tier_response = await client.post(
        f"{base}/ticket-tiers", json=tier(name="Reception", quota=30),
        headers=bearer(organizer),
    )
    assert tier_response.status_code == 201
    tier_id = tier_response.json()["id"]
    login = await desk_sign_in(client, event_id, mobile)
    assert login.status_code == 200
    old_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    initial_claims = jwt.decode(
        login.json()["access_token"], TEST_JWT_SECRET, algorithms=["HS256"],
    )
    assert initial_claims["session_version"] == 0
    initial_claims.pop("session_version")
    legacy_token = jwt.encode(initial_claims, TEST_JWT_SECRET, algorithm="HS256")
    issued = await client.post(
        f"{base}/desk-registrations",
        json={"full_name": "Original attendee", "ticket_tier_id": tier_id},
        headers=old_headers,
    )
    assert issued.status_code == 201
    ticket_id = issued.json()["ticket_id"]
    reads = (
        f"{base}/desk/me", f"{base}/desk/tiers", f"{base}/attendees",
        f"{base}/attendees/{ticket_id}",
    )
    retained_headers = [
        old_headers, {"Authorization": f"Bearer {legacy_token}"},
    ]
    for cycle in range(2):
        revoke = await client.request(
            "DELETE" if cycle == 0 else "POST",
            f"{base}/desk/operators/{operator_id}" + ("/revoke" if cycle else ""),
            headers=bearer(organizer),
        )
        assert revoke.status_code == 200
        denied_login = await desk_sign_in(client, event_id, mobile)
        assert denied_login.status_code == 401
        assert "WWW-Authenticate" not in denied_login.headers
        for headers in retained_headers:
            for path in reads:
                denied = await client.get(path, headers=headers)
                assert denied.status_code == 401
                assert denied.headers["WWW-Authenticate"] == "Bearer"
            denied_issue = await client.post(
                f"{base}/desk-registrations",
                json={"full_name": "Revoked must not issue", "ticket_tier_id": tier_id},
                headers=headers,
            )
            assert denied_issue.status_code == 401
            assert denied_issue.headers["WWW-Authenticate"] == "Bearer"
        reactivated = await client.post(
            f"{base}/desk/operators", json=assignment, headers=bearer(organizer),
        )
        assert reactivated.status_code == 201
        assert reactivated.json()["id"] == operator_id
        for headers in retained_headers:
            for path in reads:
                denied = await client.get(path, headers=headers)
                assert denied.status_code == 401
                assert denied.headers["WWW-Authenticate"] == "Bearer"
            denied_issue = await client.post(
                f"{base}/desk-registrations",
                json={"full_name": "Must not issue", "ticket_tier_id": tier_id},
                headers=headers,
            )
            assert denied_issue.status_code == 401
            assert denied_issue.headers["WWW-Authenticate"] == "Bearer"
        fresh_login = await desk_sign_in(client, event_id, mobile)
        assert fresh_login.status_code == 200
        fresh_claims = jwt.decode(
            fresh_login.json()["access_token"], TEST_JWT_SECRET, algorithms=["HS256"],
        )
        assert fresh_claims["session_version"] == (cycle + 1) * 2
        fresh_headers = {
            "Authorization": f"Bearer {fresh_login.json()['access_token']}",
        }
        for path in reads:
            allowed = await client.get(path, headers=fresh_headers)
            assert allowed.status_code == 200
        fresh_issue = await client.post(
            f"{base}/desk-registrations",
            json={"full_name": f"Fresh attendee {cycle}", "ticket_tier_id": tier_id},
            headers=fresh_headers,
        )
        assert fresh_issue.status_code == 201
        retained_headers.append(fresh_headers)


async def provision_generation_operator(
    client: AsyncClient,
) -> tuple[dict[str, str], str, dict[str, str], str, str]:
    organizer = await provision_organizer(client, "Generation negatives")
    event_id = await create_event(client, organizer)
    assignment = {"mobile": "09121000036", "operator_name": "Claims operator"}
    created = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json=assignment, headers=bearer(organizer),
    )
    assert created.status_code == 201
    login_body = {"mobile": assignment["mobile"]}
    login = await desk_sign_in(client, event_id, assignment["mobile"])
    assert login.status_code == 200
    return organizer, event_id, login_body, created.json()["id"], login.json()["access_token"]


@pytest.mark.parametrize(
    "claim", [None, True, False, -1, 1, "0", 0.0, [], {}, "absent"],
)
async def test_strict_desk_generation_claims_fail_closed(
    client: AsyncClient, claim: Any,
) -> None:
    organizer, event_id, _, _, token = await provision_generation_operator(client)
    base = f"/api/events/{event_id}"
    payload = jwt.decode(token, TEST_JWT_SECRET, algorithms=["HS256"])
    assert type(payload["session_version"]) is int
    assert payload["session_version"] == 0
    assert payload["type"] == "desk_operator"
    assert payload["sub"] == f"desk:{payload['operator_id']}"
    assert payload["exp"] - payload["iat"] == 7 * 24 * 60 * 60
    tier_response = await client.post(
        f"{base}/ticket-tiers", json=tier(name="Claims", quota=10),
        headers=bearer(organizer),
    )
    assert tier_response.status_code == 201
    tier_id = tier_response.json()["id"]
    good_headers = {"Authorization": f"Bearer {token}"}
    original = await client.post(
        f"{base}/desk-registrations",
        json={"full_name": "Claim fixture", "ticket_tier_id": tier_id},
        headers=good_headers,
    )
    assert original.status_code == 201
    ticket_id = original.json()["ticket_id"]
    if claim == "absent":
        payload.pop("session_version")
    else:
        payload["session_version"] = claim
    forged = jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")
    headers = {"Authorization": f"Bearer {forged}"}
    for path in (
        f"{base}/desk/me", f"{base}/desk/tiers",
        f"{base}/attendees", f"{base}/attendees/{ticket_id}",
    ):
        denied = await client.get(path, headers=headers)
        assert denied.status_code == 401
        assert denied.headers["WWW-Authenticate"] == "Bearer"
    denied_issue = await client.post(
        f"{base}/desk-registrations",
        json={"full_name": "Forbidden claim", "ticket_tier_id": tier_id},
        headers=headers,
    )
    assert denied_issue.status_code == 401
    assert denied_issue.headers["WWW-Authenticate"] == "Bearer"
    search = await client.get(f"{base}/attendees", headers=good_headers)
    assert search.status_code == 200
    assert len(search.json()) == 1


async def test_concurrent_desk_lifecycle_preserves_every_generation(
    client: AsyncClient,
) -> None:
    organizer, event_id, login_body, operator_id, old_token = (
        await provision_generation_operator(client)
    )
    base = f"/api/events/{event_id}"
    management_headers = bearer(organizer)
    assignment = {"mobile": login_body["mobile"], "operator_name": "Concurrent"}
    for round_number in range(3):
        revokes = await asyncio.gather(*(
            client.request(
                "DELETE" if index % 2 else "POST",
                f"{base}/desk/operators/{operator_id}" + ("/revoke" if index % 2 == 0 else ""),
                headers=management_headers,
            )
            for index in range(6)
        ))
        assert [response.status_code for response in revokes] == [200] * 6
        activations = await asyncio.gather(*(
            client.post(f"{base}/desk/operators", json=assignment, headers=management_headers)
            for _ in range(6)
        ))
        assert sorted(response.status_code for response in activations) == [201] + [409] * 5
        fresh = await desk_sign_in(client, event_id, login_body["mobile"])
        assert fresh.status_code == 200
        claims = jwt.decode(fresh.json()["access_token"], TEST_JWT_SECRET, algorithms=["HS256"])
        assert claims["session_version"] == (round_number + 1) * 7
        denied = await client.get(
            f"{base}/desk/me", headers={"Authorization": f"Bearer {old_token}"},
        )
        assert denied.status_code == 401
        assert denied.headers["WWW-Authenticate"] == "Bearer"
        old_token = fresh.json()["access_token"]
    # Race the two opposite operations. Either ordering is valid; increments
    # must account for every successful reactivation and every revoke.
    outcomes = await asyncio.gather(
        client.post(f"{base}/desk/operators", json=assignment, headers=management_headers),
        client.post(f"{base}/desk/operators/{operator_id}/revoke", headers=management_headers),
    )
    assert outcomes[0].status_code in (201, 409)
    assert outcomes[1].status_code == 200
    expected_version = 22 + (outcomes[0].status_code == 201)
    login = await desk_sign_in(client, event_id, login_body["mobile"])
    if login.status_code == 401:
        reactivated = await client.post(
            f"{base}/desk/operators", json=assignment, headers=management_headers,
        )
        assert reactivated.status_code == 201
        expected_version += 1
        login = await desk_sign_in(client, event_id, login_body["mobile"])
    assert login.status_code == 200
    claims = jwt.decode(login.json()["access_token"], TEST_JWT_SECRET, algorithms=["HS256"])
    assert claims["session_version"] == expected_version
    denied = await client.get(
        f"{base}/desk/me", headers={"Authorization": f"Bearer {old_token}"},
    )
    assert denied.status_code == 401


async def test_desk_generation_does_not_grant_management_or_cross_event_authority(
    client: AsyncClient,
) -> None:
    organizer, event_id, login_body, operator_id, token = (
        await provision_generation_operator(client)
    )
    base = f"/api/events/{event_id}"
    headers = {"Authorization": f"Bearer {token}"}
    for method, path, body in (
        ("GET", f"{base}/desk/operators", None),
        ("POST", f"{base}/desk/operators", {"mobile": "09121000020", "operator_name": "Intruder"}),
        ("POST", f"{base}/desk/operators/{operator_id}/revoke", None),
        ("DELETE", f"{base}/desk/operators/{operator_id}", None),
    ):
        denied = await client.request(method, path, json=body, headers=headers)
        assert denied.status_code == 401
        assert denied.headers["WWW-Authenticate"] == "Bearer"
    foreign = await provision_organizer(client, "Foreign generation tenant")
    event = await client.post(
        "/api/events", json={**EVENT, "slug": f"foreign-{uuid.uuid4().hex}"},
        headers=bearer(foreign),
    )
    assert event.status_code == 201
    foreign_base = f"/api/events/{event.json()['id']}"
    cross = await client.get(f"{foreign_base}/desk/me", headers=headers)
    assert cross.status_code == 403
    assert "WWW-Authenticate" not in cross.headers
    foreign_revoke = await client.delete(
        f"{base}/desk/operators/{operator_id}", headers=bearer(foreign),
    )
    assert foreign_revoke.status_code == 404
    # A row in another owned event is also masked, without touching its version.
    wrong_operator = await client.delete(
        f"{foreign_base}/desk/operators/{operator_id}", headers=bearer(foreign),
    )
    assert wrong_operator.status_code == 404
    _, user_token = await sign_in(client, login_body["mobile"])
    user_me = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {user_token}"},
    )
    assert user_me.status_code == 200
    assert user_me.json()["mobile"] == login_body["mobile"]
    allowed = await client.get(f"{base}/desk/me", headers=bearer(organizer))
    assert allowed.status_code == 200
