"""Organizer-facing errors carry a stable code next to their unchanged status and English detail: credentials,
missing events and members, slug conflicts and inconsistent event times."""

import uuid

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_event_lifecycle import make_event, patch_event
from tests.test_events import EVENT


async def test_a_missing_or_wrong_credential_is_coded(client: AsyncClient) -> None:
    missing = await client.get("/api/events")
    wrong = await client.get("/api/events", headers={"Authorization": "Bearer not-a-key"})

    assert (missing.status_code, missing.json()) == (401, {"detail": "Missing API key", "code": "API_KEY_MISSING"})
    assert (wrong.status_code, wrong.json()) == (401, {"detail": "Invalid API key", "code": "API_KEY_INVALID"})
    assert missing.headers["www-authenticate"] == wrong.headers["www-authenticate"] == "Bearer"


async def test_another_organizers_event_and_member_are_coded_not_found(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")

    event = await client.get(f"/api/events/{uuid.uuid4()}", headers=bearer(organizer))
    member = await client.patch(
        f"/api/organizer/members/{uuid.uuid4()}", json={"role": "viewer"}, headers=bearer(organizer)
    )

    assert (event.status_code, event.json()) == (404, {"detail": "Event not found", "code": "EVENT_NOT_FOUND"})
    assert (member.status_code, member.json()) == (404, {"detail": "Member not found", "code": "MEMBER_NOT_FOUND"})


async def test_slug_conflicts_are_coded(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)

    taken = await client.post("/api/events", json={**EVENT, "slug": event["slug"]}, headers=bearer(organizer))
    assert (taken.status_code, taken.json()) == (409, {"detail": "Slug already in use", "code": "EVENT_SLUG_TAKEN"})

    booths = f"/api/events/{event['id']}/booths"
    await client.post(booths, json={"name": "Acme", "slug": "acme"}, headers=bearer(organizer))
    other = (await client.post(booths, json={"name": "Beta", "slug": "beta"}, headers=bearer(organizer))).json()
    expected = (409, {"detail": "Booth slug already in use for this event", "code": "BOOTH_SLUG_TAKEN"})
    created = await client.post(booths, json={"name": "Copy", "slug": "acme"}, headers=bearer(organizer))
    renamed = await client.patch(f"{booths}/{other['id']}", json={"slug": "acme"}, headers=bearer(organizer))
    assert (created.status_code, created.json()) == expected
    assert (renamed.status_code, renamed.json()) == expected


async def test_inconsistent_event_times_are_coded(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)

    backwards = await patch_event(client, organizer, event["id"], ends_at="2000-01-01T00:00:00Z")
    window = await patch_event(
        client, organizer, event["id"],
        registration_opens_at="2027-03-02T00:00:00Z", registration_closes_at="2027-03-01T00:00:00Z",
    )

    assert (backwards.status_code, backwards.json()) == (
        400, {"detail": "ends_at must be after starts_at", "code": "EVENT_TIMES_INVALID"}
    )
    assert (window.status_code, window.json()) == (
        422,
        {
            "detail": "registration_closes_at must be after registration_opens_at",
            "code": "REGISTRATION_WINDOW_INVALID",
        },
    )
