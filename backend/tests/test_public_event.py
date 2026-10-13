from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier


async def test_public_visitor_sees_all_tiers_with_status_and_counts(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    url = f"/api/events/{event_id}/ticket-tiers"
    await client.post(url, json=tier(name="General Admission", quota=100), headers=bearer(organizer))
    await client.post(
        url, json=tier(name="Early Bird", quota=20, is_open=False), headers=bearer(organizer)
    )

    response = await client.get(f"/api/public/events/{EVENT['slug']}")

    assert response.status_code == 200
    page = response.json()
    assert page["name"] == "Spring Congress 2027"
    assert page["location"] == "Milad Tower Conference Hall, Tehran"
    assert page["starts_at"].startswith("2027-04-10T08:00:00")

    tier_names = [t["name"] for t in page["ticket_tiers"]]
    assert "General Admission" in tier_names
    assert "Early Bird" in tier_names

    tier_map = {t["name"]: t for t in page["ticket_tiers"]}
    assert tier_map["General Admission"]["is_open"] is True
    assert tier_map["General Admission"]["quota"] == 100
    assert tier_map["General Admission"]["reserved_count"] == 0
    assert tier_map["Early Bird"]["is_open"] is False
    assert tier_map["Early Bird"]["quota"] == 20

async def test_public_page_for_an_unknown_event_is_not_found(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/public/events/does-not-exist")

    assert response.status_code == 404


async def test_public_page_does_not_leak_tenant_internals(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await publish_page(client, organizer, await create_event(client, organizer))

    page = (await client.get(f"/api/public/events/{EVENT['slug']}")).json()

    assert "organizer_id" not in page
    assert organizer["api_key"] not in str(page)
