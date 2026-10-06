import pytest
from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer

EVENT: dict[str, Any] = {
    "name": "Spring Congress 2027",
    "slug": "spring-congress-2027",
    "starts_at": "2027-04-10T08:00:00Z",
    "ends_at": "2027-04-12T18:00:00Z",
    "location": "Milad Tower Conference Hall, Tehran",
    "description": "Three days of talks and workshops.",
}


async def test_organizer_creates_an_event_and_reads_it_back(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    created = await client.post("/api/events", json=EVENT, headers=bearer(organizer))

    assert created.status_code == 201
    event = created.json()
    assert event["name"] == "Spring Congress 2027"
    assert event["slug"] == "spring-congress-2027"
    assert event["location"] == "Milad Tower Conference Hall, Tehran"
    assert event["description"] == "Three days of talks and workshops."

    fetched = await client.get(f"/api/events/{event['id']}", headers=bearer(organizer))
    listed = await client.get("/api/events", headers=bearer(organizer))

    assert fetched.status_code == 200
    assert fetched.json() == event
    assert listed.json() == [event]


async def test_an_organizer_cannot_see_events_of_another_organizer(
    client: AsyncClient,
) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    created = await client.post("/api/events", json=EVENT, headers=bearer(owner))
    event_id = created.json()["id"]

    fetched = await client.get(f"/api/events/{event_id}", headers=bearer(intruder))
    listed = await client.get("/api/events", headers=bearer(intruder))

    assert fetched.status_code == 404
    assert listed.json() == []


async def test_event_with_an_end_before_its_start_is_rejected(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    backwards = {**EVENT, "starts_at": "2027-04-12T18:00:00Z", "ends_at": "2027-04-10T08:00:00Z"}

    response = await client.post("/api/events", json=backwards, headers=bearer(organizer))

    assert response.status_code == 422


@pytest.mark.parametrize("slug", ["Has Spaces", "UPPER", "-leading", "trailing-", "a/b", ""])
async def test_event_slug_must_be_a_url_safe_lowercase_identifier(
    client: AsyncClient, slug: str
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    response = await client.post(
        "/api/events", json={**EVENT, "slug": slug}, headers=bearer(organizer)
    )

    assert response.status_code == 422


async def test_event_name_cannot_be_blank(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    response = await client.post(
        "/api/events", json={**EVENT, "name": "   "}, headers=bearer(organizer)
    )

    assert response.status_code == 422


async def test_slug_is_unique_across_all_organizers(client: AsyncClient) -> None:
    first = await provision_organizer(client, "First Co")
    second = await provision_organizer(client, "Second Co")
    await client.post("/api/events", json=EVENT, headers=bearer(first))

    clash = await client.post("/api/events", json=EVENT, headers=bearer(second))

    assert clash.status_code == 409
