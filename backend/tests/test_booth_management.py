"""Organizer edits and removes booths; removal takes the booth's staff, bookmarks, leads and QR with it."""

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier
from tests.test_tickets import register_user

DIRECTORY = f"/api/public/events/{EVENT['slug']}/booths"


async def test_organizer_edits_a_booth_and_keeps_its_qr(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    booth = (await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))).json()

    edited = await client.patch(
        f"/api/events/{event_id}/booths/{booth['id']}",
        json={"name": "  Siemens Medical  ", "slug": "siemens-medical", "location": "Hall 2, B-04"},
        headers=bearer(organizer),
    )

    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["name"], body["slug"], body["location"]) == ("Siemens Medical", "siemens-medical", "Hall 2, B-04")
    assert body["description"] == BOOTH_PAYLOAD["description"]
    assert body["qr_secret"] == booth["qr_secret"]
    assert [b["name"] for b in (await client.get(DIRECTORY)).json()] == ["Siemens Medical"]


async def test_a_booth_cannot_take_a_slug_already_used_in_the_event(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))
    other = (
        await client.post(
            f"/api/events/{event_id}/booths", json={**BOOTH_PAYLOAD, "slug": "philips"}, headers=bearer(organizer)
        )
    ).json()

    taken = await client.patch(
        f"/api/events/{event_id}/booths/{other['id']}", json={"slug": BOOTH_PAYLOAD["slug"]}, headers=bearer(organizer)
    )
    invalid = await client.patch(
        f"/api/events/{event_id}/booths/{other['id']}", json={"slug": "Not A Slug"}, headers=bearer(organizer)
    )

    assert taken.status_code == 409
    assert invalid.status_code == 422
    listed = (await client.get(f"/api/events/{event_id}/booths", headers=bearer(organizer))).json()
    assert sorted(b["slug"] for b in listed) == ["philips", BOOTH_PAYLOAD["slug"]]


async def test_deleting_a_booth_removes_its_staff_bookmarks_and_leads(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    await publish_page(client, organizer, event_id)
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    ).json()["id"]
    booth = (await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(organizer))).json()
    kept = (
        await client.post(
            f"/api/events/{event_id}/booths", json={**BOOTH_PAYLOAD, "name": "Philips", "slug": "philips"},
            headers=bearer(organizer),
        )
    ).json()
    _, staff_token = await register_user(client, "09121000071", "Booth Rep")
    await client.post(
        f"/api/events/{event_id}/booths/{booth['id']}/staff", json={"mobile": "09121000071"}, headers=bearer(organizer)
    )
    _, attendee_token = await register_user(client, "09121000072", "Visitor")
    attendee = {"Authorization": f"Bearer {attendee_token}"}
    staff = {"Authorization": f"Bearer {staff_token}"}
    ticket = (
        await client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=attendee)
    ).json()
    lead = await client.post(f"/api/booths/{booth['id']}/leads/scan", json={"qr_secret": ticket["qr_secret"]}, headers=staff)
    assert lead.status_code == 201, lead.text
    for booth_id in (booth["id"], kept["id"]):
        bookmarked = await client.post(f"/api/attendees/me/bookmarks/booths/{booth_id}", headers=attendee)
        assert bookmarked.status_code == 201, bookmarked.text

    deleted = await client.delete(f"/api/events/{event_id}/booths/{booth['id']}", headers=bearer(organizer))

    assert deleted.status_code == 204, deleted.text
    assert [b["id"] for b in (await client.get(DIRECTORY)).json()] == [kept["id"]]
    assert (await client.get(f"{DIRECTORY}/{booth['id']}")).status_code == 404
    assert [b["id"] for b in (await client.get(f"/api/events/{event_id}/booths", headers=bearer(organizer))).json()] == [
        kept["id"]
    ]
    assert (await client.get("/api/booths/me", headers=staff)).json() == []
    assert (await client.get(f"/api/booths/{booth['id']}/leads", headers=staff)).status_code == 404
    bookmarks = (await client.get("/api/attendees/me/bookmarks/booths", headers=attendee)).json()
    assert [b["booth_id"] for b in bookmarks] == [kept["id"]]
    again = await client.delete(f"/api/events/{event_id}/booths/{booth['id']}", headers=bearer(organizer))
    assert again.status_code == 404


async def test_another_organizer_can_neither_edit_nor_delete_a_booth(client: AsyncClient) -> None:
    owner = await provision_organizer(client, "Owner Co")
    intruder = await provision_organizer(client, "Intruder Co")
    event_id = await create_event(client, owner)
    booth = (await client.post(f"/api/events/{event_id}/booths", json=BOOTH_PAYLOAD, headers=bearer(owner))).json()
    own_event = (
        await client.post("/api/events", json={**EVENT, "slug": "intruder-congress-2027"}, headers=bearer(intruder))
    ).json()["id"]

    attempts = [
        await client.patch(f"/api/events/{event_id}/booths/{booth['id']}", json={"name": "X"}, headers=bearer(intruder)),
        await client.delete(f"/api/events/{event_id}/booths/{booth['id']}", headers=bearer(intruder)),
        # The owner's booth id is unknown under the intruder's own event too.
        await client.patch(f"/api/events/{own_event}/booths/{booth['id']}", json={"name": "X"}, headers=bearer(intruder)),
        await client.delete(f"/api/events/{own_event}/booths/{booth['id']}", headers=bearer(intruder)),
    ]

    assert [a.status_code for a in attempts] == [404] * len(attempts)
    assert (await client.get(f"/api/events/{event_id}/booths", headers=bearer(owner))).json() == [booth]
