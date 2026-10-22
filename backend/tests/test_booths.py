import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event
from tests.test_tickets import register_user


BOOTH_PAYLOAD = {
    "name": "Siemens Healthineers",
    "slug": "siemens-healthineers",
    "location": "Booth A-12, Hall 1",
    "description": "Pioneering breakthroughs in healthcare.",
    "website_url": "https://siemens-healthineers.com",
    "brochure_url": "https://siemens-healthineers.com/brochure.pdf",
}


async def test_organizer_creates_booth_and_receives_entity_qr(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    resp = await client.post(
        f"/api/events/{event_id}/booths",
        json=BOOTH_PAYLOAD,
        headers=bearer(organizer),
    )

    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "Siemens Healthineers"
    assert data["slug"] == "siemens-healthineers"
    assert data["location"] == "Booth A-12, Hall 1"
    assert data["website_url"] == "https://siemens-healthineers.com"
    assert data["brochure_url"] == "https://siemens-healthineers.com/brochure.pdf"
    assert "qr_secret" in data
    assert len(data["qr_secret"]) == 26

    # List booths
    listed = await client.get(
        f"/api/events/{event_id}/booths", headers=bearer(organizer)
    )
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["name"] == "Siemens Healthineers"


async def test_organizer_assigns_booth_staff_by_mobile(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    booth_resp = await client.post(
        f"/api/events/{event_id}/booths",
        json=BOOTH_PAYLOAD,
        headers=bearer(organizer),
    )
    booth_id = booth_resp.json()["id"]

    # Register user first
    _, token = await register_user(
        client, "09121000017", "Sarah Siemens"
    )

    # Assign staff by mobile
    assign_resp = await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        json={"mobile": "09121000017"},
        headers=bearer(organizer),
    )
    assert assign_resp.status_code == 201
    assert assign_resp.json()["mobile"] == "09121000017"
    assert assign_resp.json()["full_name"] == "Sarah Siemens"

    # List assigned staff
    staff_list = await client.get(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        headers=bearer(organizer),
    )
    assert staff_list.status_code == 200
    assert len(staff_list.json()) == 1
    assert staff_list.json()[0]["mobile"] == "09121000017"


async def test_assigned_booth_staff_can_access_their_booth_portal(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    booth_resp = await client.post(
        f"/api/events/{event_id}/booths",
        json=BOOTH_PAYLOAD,
        headers=bearer(organizer),
    )
    booth_id = booth_resp.json()["id"]

    _, token = await register_user(
        client, "09121000018", "Rep One"
    )
    await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff",
        json={"mobile": "09121000018"},
        headers=bearer(organizer),
    )

    # Staff accesses booth portal by ID
    portal_resp = await client.get(
        f"/api/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert portal_resp.status_code == 200
    data = portal_resp.json()
    assert data["name"] == "Siemens Healthineers"
    assert len(data["qr_secret"]) == 26

    # Staff calls /api/booths/me
    my_booths = await client.get(
        "/api/booths/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert my_booths.status_code == 200
    assert len(my_booths.json()) == 1
    assert my_booths.json()[0]["id"] == booth_id


async def test_commercial_isolation_between_booth_staff(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    # Create Booth A
    booth_a = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json={**BOOTH_PAYLOAD, "name": "Company A", "slug": "company-a"},
            headers=bearer(organizer),
        )
    ).json()

    # Create Booth B
    booth_b = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json={**BOOTH_PAYLOAD, "name": "Company B", "slug": "company-b"},
            headers=bearer(organizer),
        )
    ).json()

    # Staff A assigned to Booth A
    _, token_a = await register_user(client, "09121000019", "Staff A")
    await client.post(
        f"/api/events/{event_id}/booths/{booth_a['id']}/staff",
        json={"mobile": "09121000019"},
        headers=bearer(organizer),
    )

    # Staff A accesses Booth A -> 200
    res_a = await client.get(
        f"/api/booths/{booth_a['id']}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_a.status_code == 200

    # Staff A attempts to access Booth B -> 403 Forbidden!
    res_b = await client.get(
        f"/api/booths/{booth_b['id']}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert res_b.status_code == 403


async def test_tenant_isolation_on_booths(
    client: AsyncClient,
) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)

    # Intruder attempts to create booth on owner's event -> 404
    create_res = await client.post(
        f"/api/events/{event_id}/booths",
        json=BOOTH_PAYLOAD,
        headers=bearer(intruder),
    )
    assert create_res.status_code == 404

    # Owner creates booth
    booth = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json=BOOTH_PAYLOAD,
            headers=bearer(owner),
        )
    ).json()

    # Intruder attempts to list or assign staff on owner's booth -> 404
    staff_res = await client.post(
        f"/api/events/{event_id}/booths/{booth['id']}/staff",
        json={"mobile": "09121000020"},
        headers=bearer(intruder),
    )
    assert staff_res.status_code == 404
