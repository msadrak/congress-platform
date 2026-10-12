import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user


async def setup_booth_staff_and_attendee(
    client: AsyncClient,
) -> tuple[str, str, str, str, dict[str, str]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_resp = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(name="General", quota=100),
        headers=bearer(organizer),
    )
    tier_id = tier_resp.json()["id"]

    # Create Booth
    booth = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json=BOOTH_PAYLOAD,
            headers=bearer(organizer),
        )
    ).json()
    booth_id = booth["id"]

    # Register & assign staff
    _, staff_token = await register_user(
        client, "staff@siemens.com", "Booth Staff Rep"
    )
    await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        json={"email": "staff@siemens.com"},
        headers=bearer(organizer),
    )

    # Register attendee with ticket
    _, attendee_token = await register_user(
        client, "dr.lead@hospital.org", "Dr. Lead Buyer"
    )
    ticket = (
        await client.post(
            f"/api/events/{event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {attendee_token}"},
        )
    ).json()

    return event_id, booth_id, staff_token, attendee_token, ticket


async def test_booth_staff_scans_attendee_badge_and_captures_lead(
    client: AsyncClient,
) -> None:
    event_id, booth_id, staff_token, _, ticket = (
        await setup_booth_staff_and_attendee(client)
    )

    # Staff scans attendee QR
    scan_resp = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={
            "qr_secret": ticket["qr_secret"],
            "rating": "HOT",
            "tags": ["Send Quote", "Schedule Demo"],
            "notes": "Interested in 5 CT scanner systems for Q3.",
        },
        headers={"Authorization": f"Bearer {staff_token}"},
    )

    assert scan_resp.status_code == 201, scan_resp.text
    data = scan_resp.json()
    assert data["booth_id"] == booth_id
    assert data["attendee_name"] == "Dr. Lead Buyer"
    assert data["attendee_email"] == "dr.lead@hospital.org"
    assert data["rating"] == "HOT"
    assert data["tags"] == ["Send Quote", "Schedule Demo"]
    assert data["notes"] == "Interested in 5 CT scanner systems for Q3."
    assert "id" in data


async def test_duplicate_lead_scan_updates_existing_lead(
    client: AsyncClient,
) -> None:
    event_id, booth_id, staff_token, _, ticket = (
        await setup_booth_staff_and_attendee(client)
    )

    # First scan
    first = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={
            "qr_secret": ticket["qr_secret"],
            "rating": "WARM",
            "notes": "Initial contact.",
        },
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert first.status_code == 201

    # Second scan updates notes and rating
    second = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={
            "qr_secret": ticket["qr_secret"],
            "rating": "HOT",
            "notes": "Discussed with hospital director.",
        },
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["rating"] == "HOT"
    assert second.json()["notes"] == "Discussed with hospital director."

    # Verify only 1 lead in booth list
    listed = await client.get(
        f"/api/booths/{booth_id}/leads",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1


async def test_commercial_isolation_staff_cannot_scan_or_access_competitor_leads(
    client: AsyncClient,
) -> None:
    event_id, booth_a_id, staff_a_token, _, ticket = (
        await setup_booth_staff_and_attendee(client)
    )

    # Setup Booth B with Staff B
    organizer = await provision_organizer(client, "Acme Congress Co 2")
    event_b_resp = await client.post(
        "/api/events",
        json={**EVENT, "name": "Event B", "slug": "event-b-unique"},
        headers=bearer(organizer),
    )
    event_b_id = event_b_resp.json()["id"]

    booth_b = (
        await client.post(
            f"/api/events/{event_b_id}/booths",
            json={**BOOTH_PAYLOAD, "name": "Competitor B", "slug": "competitor-b"},
            headers=bearer(organizer),
        )
    ).json()
    booth_b_id = booth_b["id"]

    # Staff A attempts to scan lead for Booth B -> 403 Forbidden!
    scan_b = await client.post(
        f"/api/booths/{booth_b_id}/leads/scan",
        json={"qr_secret": ticket["qr_secret"]},
        headers={"Authorization": f"Bearer {staff_a_token}"},
    )
    assert scan_b.status_code == 403

    # Staff A attempts to list leads for Booth B -> 403 Forbidden!
    list_b = await client.get(
        f"/api/booths/{booth_b_id}/leads",
        headers={"Authorization": f"Bearer {staff_a_token}"},
    )
    assert list_b.status_code == 403


async def test_staff_can_list_booth_leads(
    client: AsyncClient,
) -> None:
    event_id, booth_id, staff_token, _, ticket1 = (
        await setup_booth_staff_and_attendee(client)
    )

    _, token2 = await register_user(client, "lead2@clinic.com", "Second Lead")
    tier_id = ticket1["ticket_tier_id"]
    ticket2 = (
        await client.post(
            f"/api/events/{event_id}/tickets/reserve",
            json={"ticket_tier_id": tier_id},
            headers={"Authorization": f"Bearer {token2}"},
        )
    ).json()

    # Scan both leads
    await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={"qr_secret": ticket1["qr_secret"], "rating": "HOT"},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={"qr_secret": ticket2["qr_secret"], "rating": "WARM"},
        headers={"Authorization": f"Bearer {staff_token}"},
    )

    leads_resp = await client.get(
        f"/api/booths/{booth_id}/leads",
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert leads_resp.status_code == 200
    leads = leads_resp.json()
    assert len(leads) == 2
    names = {l["attendee_name"] for l in leads}
    assert names == {"Dr. Lead Buyer", "Second Lead"}


async def test_scanning_ticket_from_different_event_is_rejected(
    client: AsyncClient,
) -> None:
    # Event 1 and Booth 1
    event_1_id, booth_1_id, staff_token, _, _ = (
        await setup_booth_staff_and_attendee(client)
    )

    # Event 2 with unique slug
    org2 = await provision_organizer(client, "Org 2")
    event_2_resp = await client.post(
        "/api/events",
        json={**EVENT, "name": "Event 2", "slug": "event-2-unique"},
        headers=bearer(org2),
    )
    event_2_id = event_2_resp.json()["id"]

    tier2 = (
        await client.post(
            f"/api/events/{event_2_id}/ticket-tiers",
            json=tier(),
            headers=bearer(org2),
        )
    ).json()

    _, user2_token = await register_user(client, "event2.attendee@test.com")
    ticket_event2 = (
        await client.post(
            f"/api/events/{event_2_id}/tickets/reserve",
            json={"ticket_tier_id": tier2["id"]},
            headers={"Authorization": f"Bearer {user2_token}"},
        )
    ).json()

    # Staff from Booth 1 scans ticket from Event 2 -> 400 Bad Request
    scan_resp = await client.post(
        f"/api/booths/{booth_1_id}/leads/scan",
        json={"qr_secret": ticket_event2["qr_secret"]},
        headers={"Authorization": f"Bearer {staff_token}"},
    )
    assert scan_resp.status_code == 400
    assert "different event" in scan_resp.json()["detail"].lower()


async def test_rescan_with_only_the_badge_keeps_existing_qualification(
    client: AsyncClient,
) -> None:
    _, booth_id, staff_token, _, ticket = await setup_booth_staff_and_attendee(client)
    headers = {"Authorization": f"Bearer {staff_token}"}
    first = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={
            "qr_secret": ticket["qr_secret"],
            "rating": "HOT",
            "tags": ["Send Quote"],
            "notes": "Wants a demo.",
        },
        headers=headers,
    )
    assert first.status_code == 201

    again = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={"qr_secret": ticket["qr_secret"]},
        headers=headers,
    )

    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["rating"] == "HOT"
    assert again.json()["tags"] == ["Send Quote"]
    assert again.json()["notes"] == "Wants a demo."


async def test_rescan_updates_only_the_fields_it_sends(client: AsyncClient) -> None:
    _, booth_id, staff_token, _, ticket = await setup_booth_staff_and_attendee(client)
    headers = {"Authorization": f"Bearer {staff_token}"}
    await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={"qr_secret": ticket["qr_secret"], "rating": "HOT", "tags": ["A"], "notes": "n1"},
        headers=headers,
    )

    again = await client.post(
        f"/api/booths/{booth_id}/leads/scan",
        json={"qr_secret": ticket["qr_secret"], "tags": ["B"]},
        headers=headers,
    )

    assert again.json()["rating"] == "HOT"
    assert again.json()["tags"] == ["B"]
    assert again.json()["notes"] == "n1"
