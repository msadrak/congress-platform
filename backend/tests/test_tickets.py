import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier


async def register_user(
    client: AsyncClient, email: str, name: str = "Test Attendee"
) -> tuple[dict[str, str], str]:
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "full_name": name,
            "organization": "Test Org",
            "title": "Engineer",
        },
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return data["user"], data["access_token"]


async def test_attendee_can_reserve_free_ticket_and_receives_qr(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General Admission", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    _, user_token = await register_user(client, "attendee1@example.com", "Dr. Ali")

    reserve_resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {user_token}"},
    )

    assert reserve_resp.status_code == 201, reserve_resp.text
    ticket = reserve_resp.json()
    assert ticket["event_id"] == event_id
    assert ticket["ticket_tier_id"] == tier_id
    assert ticket["ticket_tier_name"] == "General Admission"
    assert ticket["attendee_name"] == "Dr. Ali"
    assert ticket["status"] == "active"
    assert "qr_secret" in ticket
    assert len(ticket["qr_secret"]) == 26  # 128 bits in base32 without padding is 26 chars


async def test_reserving_beyond_quota_is_rejected_as_sold_out(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    # Tier with capacity of exactly 1
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="VIP Exclusive", quota=1),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    _, user1_token = await register_user(client, "first@example.com")
    _, user2_token = await register_user(client, "second@example.com")

    # First attendee reserves the only seat
    resp1 = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {user1_token}"},
    )
    assert resp1.status_code == 201

    # Second attendee attempts to reserve -> sold out
    resp2 = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {user2_token}"},
    )
    assert resp2.status_code == 410
    assert "sold out" in resp2.json()["detail"].lower()


async def test_user_cannot_reserve_two_tickets_for_the_same_event(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier1_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Tier 1", quota=50),
        headers=bearer(organizer),
    )
    tier2_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Tier 2", quota=50),
        headers=bearer(organizer),
    )
    tier1_id = tier1_resp.json()["id"]
    tier2_id = tier2_resp.json()["id"]

    _, token = await register_user(client, "double@example.com")

    first_res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier1_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert first_res.status_code == 201

    # Attempt to reserve another tier in the same event
    second_res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier2_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert second_res.status_code == 409


async def test_closed_tier_cannot_be_reserved(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Closed Pass", quota=50, is_open=False),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    _, token = await register_user(client, "closed@example.com")

    res = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400


async def test_attendee_can_retrieve_their_tickets_list(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="Standard Pass", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    _, token = await register_user(client, "viewer@example.com", "Sara Tehrani")
    await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {token}"},
    )

    my_tickets_resp = await client.get(
        "/api/attendees/me/tickets",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert my_tickets_resp.status_code == 200
    tickets = my_tickets_resp.json()
    assert len(tickets) == 1
    t = tickets[0]
    assert t["event_name"] == "Spring Congress 2027"
    assert t["event_slug"] == "spring-congress-2027"
    assert t["ticket_tier_name"] == "Standard Pass"
    assert t["attendee_name"] == "Sara Tehrani"
    assert len(t["qr_secret"]) == 26
