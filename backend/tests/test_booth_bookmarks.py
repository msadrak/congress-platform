import uuid
from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event
from tests.test_tickets import register_user


async def setup_event_and_booth(
    client: AsyncClient,
) -> tuple[dict[str, str], str, dict[str, str]]:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    booth = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json=BOOTH_PAYLOAD,
            headers=bearer(organizer),
        )
    ).json()
    return organizer, event_id, booth


async def test_public_booth_profile_returns_details_and_brochure(
    client: AsyncClient,
) -> None:
    _, event_id, booth = await setup_event_and_booth(client)

    # Public request without auth
    resp = await client.get(
        f"/api/public/events/{EVENT['slug']}/booths/{booth['id']}"
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "Siemens Healthineers"
    assert data["location"] == "Booth A-12, Hall 1"
    assert data["description"] == "Pioneering breakthroughs in healthcare."
    assert data["website_url"] == "https://siemens-healthineers.com"
    assert data["brochure_url"] == "https://siemens-healthineers.com/brochure.pdf"
    assert data["event_name"] == "Spring Congress 2027"
    assert data["event_slug"] == "spring-congress-2027"
    assert data["is_bookmarked"] is False


async def test_authenticated_attendee_bookmarks_and_unbookmarks_booth(
    client: AsyncClient,
) -> None:
    _, event_id, booth = await setup_event_and_booth(client)
    booth_id = booth["id"]

    _, token = await register_user(client, "bookmark.user@example.com")

    # 1. Bookmark booth
    add_resp = await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert add_resp.status_code == 201
    assert add_resp.json()["bookmarked"] is True

    # Duplicate bookmark is idempotent
    dup_resp = await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["bookmarked"] is True

    # Check public endpoint with attendee token -> is_bookmarked is True
    check_resp = await client.get(
        f"/api/public/events/{EVENT['slug']}/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert check_resp.status_code == 200
    assert check_resp.json()["is_bookmarked"] is True

    # 2. Unbookmark booth
    del_resp = await client.delete(
        f"/api/attendees/me/bookmarks/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["bookmarked"] is False

    # Check public endpoint again -> is_bookmarked is False
    after_resp = await client.get(
        f"/api/public/events/{EVENT['slug']}/booths/{booth_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert after_resp.status_code == 200
    assert after_resp.json()["is_bookmarked"] is False


async def test_attendee_can_list_bookmarked_booths(
    client: AsyncClient,
) -> None:
    organizer, event_id, booth1 = await setup_event_and_booth(client)

    # Create second booth
    booth2 = (
        await client.post(
            f"/api/events/{event_id}/booths",
            json={**BOOTH_PAYLOAD, "name": "AstraZeneca", "slug": "astrazeneca"},
            headers=bearer(organizer),
        )
    ).json()

    _, token = await register_user(client, "collector@example.com")

    # Bookmark both
    await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth1['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )
    await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth2['id']}",
        headers={"Authorization": f"Bearer {token}"},
    )

    # List bookmarks
    list_resp = await client.get(
        "/api/attendees/me/bookmarks/booths",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_resp.status_code == 200
    saved = list_resp.json()
    assert len(saved) == 2
    names = {b["name"] for b in saved}
    assert names == {"Siemens Healthineers", "AstraZeneca"}
    assert all(b["brochure_url"] != "" for b in saved)


async def test_unauthenticated_bookmark_attempt_is_rejected(
    client: AsyncClient,
) -> None:
    _, event_id, booth = await setup_event_and_booth(client)

    resp = await client.post(
        f"/api/attendees/me/bookmarks/booths/{booth['id']}"
    )
    assert resp.status_code == 401


async def test_nonexistent_booth_returns_404(
    client: AsyncClient,
) -> None:
    random_id = str(uuid.uuid4())
    resp = await client.get(
        f"/api/public/events/{EVENT['slug']}/booths/{random_id}"
    )
    assert resp.status_code == 404
