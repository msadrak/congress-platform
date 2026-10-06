import pytest
from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT


async def create_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    response = await client.post("/api/events", json=EVENT, headers=bearer(organizer))
    assert response.status_code == 201, response.text
    event_id: str = response.json()["id"]
    return event_id


def tier(**overrides: Any) -> dict[str, Any]:
    return {
        "name": "General Admission",
        "description": "Access to all main-hall talks.",
        "quota": 500,
        **overrides,
    }


async def test_organizer_configures_multiple_free_tiers_for_an_event(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    url = f"/api/events/{event_id}/ticket-tiers"

    general = await client.post(url, json=tier(), headers=bearer(organizer))
    vip = await client.post(
        url, json=tier(name="VIP", description="Front rows and lounge.", quota=50),
        headers=bearer(organizer),
    )
    listed = await client.get(url, headers=bearer(organizer))

    assert general.status_code == 201
    assert vip.status_code == 201
    assert [(t["name"], t["quota"]) for t in listed.json()] == [
        ("General Admission", 500),
        ("VIP", 50),
    ]
    assert listed.json()[1]["description"] == "Front rows and lounge."


@pytest.mark.parametrize("quota", [0, -5])
async def test_tier_quota_must_be_at_least_one(client: AsyncClient, quota: int) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)

    response = await client.post(
        f"/api/events/{event_id}/ticket-tiers",
        json=tier(quota=quota),
        headers=bearer(organizer),
    )

    assert response.status_code == 422


async def test_an_organizer_cannot_read_or_add_tiers_on_another_organizers_event(
    client: AsyncClient,
) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    url = f"/api/events/{event_id}/ticket-tiers"

    added = await client.post(url, json=tier(), headers=bearer(intruder))
    listed = await client.get(url, headers=bearer(intruder))
    owners_view = await client.get(url, headers=bearer(owner))

    assert added.status_code == 404
    assert listed.status_code == 404
    assert owners_view.json() == []
