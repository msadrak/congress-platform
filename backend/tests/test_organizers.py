from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer


async def test_provisioned_organizer_can_authenticate_with_its_api_key(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    response = await client.get("/api/events", headers=bearer(organizer))

    assert response.status_code == 200
    assert response.json() == []


async def test_requests_without_a_valid_organizer_key_are_rejected(
    client: AsyncClient,
) -> None:
    missing = await client.get("/api/events")
    wrong = await client.get("/api/events", headers={"Authorization": "Bearer nope"})

    assert missing.status_code == 401
    assert wrong.status_code == 401


async def test_only_the_platform_admin_can_provision_organizers(
    client: AsyncClient,
) -> None:
    no_token = await client.post("/api/organizers", json={"name": "Sneaky"})
    bad_token = await client.post(
        "/api/organizers", json={"name": "Sneaky"}, headers={"X-Admin-Token": "wrong"}
    )

    assert no_token.status_code == 401
    assert bad_token.status_code == 401
