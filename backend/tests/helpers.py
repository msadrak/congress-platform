from typing import Any

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


async def publish_page(client: AsyncClient, organizer: dict[str, str], event_id: str) -> dict[str, Any]:
    """Publishes the event's current page draft: the step that makes a new event public."""
    state = await client.get(f"/api/events/{event_id}/page", headers=bearer(organizer))
    assert state.status_code == 200, state.text
    published = await client.post(
        f"/api/events/{event_id}/page/publish",
        json={"revision": state.json()["draft_revision"]},
        headers=bearer(organizer),
    )
    assert published.status_code == 200, published.text
    body: dict[str, Any] = published.json()
    return body
