import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
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
            "email": "sara.desk@example.com",
        },
        headers=bearer(organizer),
    )
    assert create_resp.status_code == 201, create_resp.text
    created_data = create_resp.json()
    assert created_data["operator_name"] == "Sara Ahmadi"
    assert created_data["email"] == "sara.desk@example.com"
    assert created_data["is_revoked"] is False
    assert "temporary_password" in created_data
    assert len(created_data["temporary_password"]) >= 12
    operator_id = created_data["id"]

    # 2. Cannot create duplicate active operator with same email in same event
    dup_resp = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={
            "operator_name": "Sara Duplicate",
            "email": "sara.desk@example.com",
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
    assert operators[0]["email"] == "sara.desk@example.com"

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
            "email": "ali.desk@example.com",
        },
        headers=bearer(organizer),
    )
    assert create_resp.status_code == 201
    temp_password = create_resp.json()["temporary_password"]

    # Invalid password login
    bad_login = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": "ali.desk@example.com", "password": "wrong-password-123"},
    )
    assert bad_login.status_code == 401
    assert "WWW-Authenticate" not in bad_login.headers

    # Valid login
    login_resp = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": "ali.desk@example.com", "password": temp_password},
    )
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
            "email": "nima.desk@example.com",
        },
        headers=bearer(organizer),
    )
    temp_pw = op_create.json()["temporary_password"]

    # Login as operator
    login_resp = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": "nima.desk@example.com", "password": temp_pw},
    )
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
            "email": "farhad.tehrani@example.com",
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
            "email": "gate1@example.com",
        },
        headers=bearer(org1),
    )
    temp_pw = op1_resp.json()["temporary_password"]
    op1_id = op1_resp.json()["id"]

    login1 = await client.post(
        f"/api/events/{event1}/desk/login",
        json={"email": "gate1@example.com", "password": temp_pw},
    )
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

    # Subsequent login is rejected
    revoked_login = await client.post(
        f"/api/events/{event1}/desk/login",
        json={"email": "gate1@example.com", "password": temp_pw},
    )
    assert revoked_login.status_code == 403
    assert "WWW-Authenticate" not in revoked_login.headers

    # Existing token cannot be used anymore
    revoked_search = await client.get(
        f"/api/events/{event1}/attendees",
        headers=op1_headers,
    )
    assert revoked_search.status_code == 401
    assert revoked_search.headers.get("WWW-Authenticate") == "Bearer"
