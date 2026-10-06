from httpx import AsyncClient

from tests.conftest import ADMIN_TOKEN


async def provision_organizer(client: AsyncClient, name: str) -> dict[str, str]:
    response = await client.post(
        "/api/organizers", json={"name": name}, headers={"X-Admin-Token": ADMIN_TOKEN}
    )
    assert response.status_code == 201, response.text
    body: dict[str, str] = response.json()
    return body


def bearer(organizer: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {organizer['api_key']}"}
