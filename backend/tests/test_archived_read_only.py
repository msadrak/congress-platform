"""An archived event is read-only everywhere the organizer can change it: booths and their staff, participants,
SMS wording and test sends, the SMS log actions and Page Studio media and publication (409 EVENT_ARCHIVED).
Reads keep working, and unarchiving makes the event editable again."""

import uuid
from typing import Any

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer, publish_page
from tests.test_event_lifecycle import make_event, make_tier, reserve


async def test_every_organizer_write_on_an_archived_event_is_refused(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    auth = bearer(organizer)
    event = await make_event(client, organizer)
    event_id = event["id"]
    tier = await make_tier(client, organizer, event_id)
    await publish_page(client, organizer, event_id)
    ticket = await reserve(client, event_id, tier["id"])
    assert ticket.status_code == 201, ticket.text
    ticket_id = ticket.json()["id"]
    booth = await client.post(f"/api/events/{event_id}/booths", json={"name": "Acme", "slug": "acme"}, headers=auth)
    assert booth.status_code == 201, booth.text
    booth_id = booth.json()["id"]
    staff = await client.post(
        f"/api/events/{event_id}/booths/{booth_id}/staff", json={"mobile": "09121234001", "full_name": "Rep"}, headers=auth
    )
    assert staff.status_code == 201, staff.text

    archived = await client.post(f"/api/events/{event_id}/archive", json={"archived": True}, headers=auth)
    assert archived.status_code == 200, archived.text

    e = f"/api/events/{event_id}"
    some_id = str(uuid.uuid4())
    writes: list[tuple[str, str, dict[str, Any] | None]] = [
        ("POST", f"{e}/booths", {"name": "Other", "slug": "other"}),
        ("PATCH", f"{e}/booths/{booth_id}", {"name": "Renamed"}),
        ("DELETE", f"{e}/booths/{booth_id}", None),
        ("POST", f"{e}/booths/{booth_id}/staff", {"mobile": "09121234002", "full_name": "Rep 2"}),
        ("DELETE", f"{e}/booths/{booth_id}/staff/{staff.json()['id']}", None),
        ("PATCH", f"{e}/participants/{ticket_id}", {"attendee_full_name": "Renamed"}),
        ("POST", f"{e}/participants/{ticket_id}/cancel", {"reason": "x"}),
        ("POST", f"{e}/participants/{ticket_id}/reissue", {}),
        ("POST", f"{e}/participants/{ticket_id}/transfer", {"mobile": "09121234003", "full_name": "New Holder"}),
        ("DELETE", f"{e}/participants/{ticket_id}", None),
        ("PUT", f"{e}/sms/templates/ticket_confirmation", {"body": "{name} {event} {link}"}),
        ("DELETE", f"{e}/sms/templates/ticket_confirmation", None),
        ("POST", f"{e}/sms/test", {"mobile": "09121234001"}),
        ("POST", f"{e}/sms/messages/{some_id}/retry", {}),
        ("POST", f"{e}/sms/messages/{some_id}/resolve", None),
        ("DELETE", f"{e}/media/{some_id}", None),
        ("POST", f"{e}/page/unpublish", None),
    ]
    for method, url, body in writes:
        response = await client.request(method, url, json=body, headers=auth)
        assert (response.status_code, response.json().get("code")) == (409, "EVENT_ARCHIVED"), (method, url, response.text)

    # Nothing changed, and reading still works.
    listed = await client.get(f"{e}/participants", headers=auth)
    assert listed.status_code == 200 and listed.json()["items"][0]["status"] == "active"
    assert [b["name"] for b in (await client.get(f"{e}/booths", headers=auth)).json()] == ["Acme"]
    assert len((await client.get(f"{e}/booths/{booth_id}/staff", headers=auth)).json()) == 1
    assert (await client.get(f"{e}/page", headers=auth)).json()["published_revision"] is not None

    restored = await client.post(f"/api/events/{event_id}/archive", json={"archived": False}, headers=auth)
    assert restored.status_code == 200
    renamed = await client.patch(f"{e}/booths/{booth_id}", json={"name": "Renamed"}, headers=auth)
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed"
