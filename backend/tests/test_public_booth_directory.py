from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event


async def _add_booth(
    client: AsyncClient, organizer: dict[str, str], event_id: str, **overrides: str
) -> dict[str, str]:
    response = await client.post(
        f"/api/events/{event_id}/booths",
        json={**BOOTH_PAYLOAD, **overrides},
        headers=bearer(organizer),
    )
    assert response.status_code == 201, response.text
    body: dict[str, str] = response.json()
    return body


async def test_anonymous_directory_lists_only_this_congress_booths_in_name_order(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    await _add_booth(client, organizer, event_id, name="Zeta Pharma", slug="zeta")
    alpha = await _add_booth(client, organizer, event_id, name="Alpha Devices", slug="alpha")
    other = await client.post(
        "/api/events",
        json={**EVENT, "slug": "other-congress"},
        headers=bearer(organizer),
    )
    await _add_booth(
        client, organizer, other.json()["id"], name="Unrelated Booth", slug="unrelated"
    )

    response = await client.get(f"/api/public/events/{EVENT['slug']}/booths")

    assert response.status_code == 200
    booths = response.json()
    assert [b["name"] for b in booths] == ["Alpha Devices", "Zeta Pharma"]
    assert booths[0]["id"] == alpha["id"]
    assert booths[0]["location"] == BOOTH_PAYLOAD["location"]
    assert booths[0]["brochure_url"] == BOOTH_PAYLOAD["brochure_url"]


async def test_directory_exposes_no_secrets_or_staff_data(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    created = await _add_booth(client, organizer, event_id)
    assert "qr_secret" in created

    entry = (await client.get(f"/api/public/events/{EVENT['slug']}/booths")).json()[0]

    assert set(entry) == {
        "id", "name", "slug", "location", "description", "website_url", "brochure_url", "logo_url",
    }


async def test_directory_of_an_event_without_booths_is_empty_and_unknown_slug_is_404(
    client: AsyncClient,
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await publish_page(client, organizer, await create_event(client, organizer))

    empty = await client.get(f"/api/public/events/{EVENT['slug']}/booths")
    unknown = await client.get("/api/public/events/does-not-exist/booths")

    assert empty.status_code == 200
    assert empty.json() == []
    assert unknown.status_code == 404
