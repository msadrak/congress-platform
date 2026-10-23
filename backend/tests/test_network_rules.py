"""Networking rules: a scan names its congress and needs the scanner's own active ticket there, connections can
be removed, scans are throttled per person, and the list pages with a search."""

from typing import Any

from httpx import AsyncClient

from tests.exhibitors import Congress, auth, reserve, setup_congress
from tests.test_tickets import register_user

SCAN = "/api/attendees/me/network/scan"


async def peer(client: AsyncClient, congress: Congress, mobile: str, name: str) -> tuple[dict[str, str], str]:
    _, token = await register_user(client, mobile, name)
    ticket = await reserve(client, congress.event_id, congress.tier_id, token)
    return auth(token), ticket["qr_secret"]


async def connect(client: AsyncClient, headers: dict[str, str], event_id: str, secret: str) -> dict[str, Any]:
    response = await client.post(SCAN, json={"qr_secret": secret, "event_id": event_id}, headers=headers)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_a_scan_must_name_its_congress(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    _, secret = await peer(client, congress, "09121000851", "Bob")

    missing = await client.post(SCAN, json={"qr_secret": secret}, headers=congress.attendee)
    null = await client.post(SCAN, json={"qr_secret": secret, "event_id": None}, headers=congress.attendee)

    assert missing.status_code == 422
    assert null.status_code == 400
    assert null.json()["code"] == "EVENT_ID_REQUIRED"


async def test_the_scanner_needs_an_active_ticket_for_that_congress(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    _, secret = await peer(client, congress, "09121000852", "Bob")
    _, outsider = await register_user(client, "09121000853", "No Ticket")

    refused = await client.post(SCAN, json={"qr_secret": secret, "event_id": congress.event_id}, headers=auth(outsider))

    assert refused.status_code == 403
    assert refused.json()["code"] == "ACTIVE_TICKET_REQUIRED"
    connections = (await client.get("/api/attendees/me/network", headers=auth(outsider))).json()
    assert connections == []


async def test_a_badge_of_another_congress_is_refused_with_a_code(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    other = await setup_congress(
        client, organizer=congress.organizer, slug="autumn-congress-2027",
        staff_mobile="09121000854", attendee_mobile="09121000855",
    )
    refused = await client.post(
        SCAN, json={"qr_secret": other.ticket["qr_secret"], "event_id": congress.event_id}, headers=congress.attendee
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == "BADGE_OTHER_EVENT"
    unknown = await client.post(SCAN, json={"qr_secret": "nope", "event_id": congress.event_id}, headers=congress.attendee)
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "BADGE_NOT_FOUND"
    own = await client.post(
        SCAN, json={"qr_secret": congress.ticket["qr_secret"], "event_id": congress.event_id}, headers=congress.attendee
    )
    assert own.status_code == 400
    assert own.json()["code"] == "BADGE_OWN"


async def test_an_attendee_removes_a_connection(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    bob, secret = await peer(client, congress, "09121000856", "Bob")
    connection = await connect(client, congress.attendee, congress.event_id, secret)

    # Someone else cannot remove it.
    foreign = await client.delete(f"/api/attendees/me/network/{connection['id']}", headers=bob)
    assert foreign.status_code == 404
    removed = await client.delete(f"/api/attendees/me/network/{connection['id']}", headers=congress.attendee)
    assert removed.status_code == 204, removed.text
    assert (await client.get("/api/attendees/me/network", headers=congress.attendee)).json() == []
    again = await client.delete(f"/api/attendees/me/network/{connection['id']}", headers=congress.attendee)
    assert again.status_code == 404
    assert again.json()["code"] == "CONNECTION_NOT_FOUND"
    # Scanning the badge again connects anew.
    await connect(client, congress.attendee, congress.event_id, secret)


async def test_failed_scans_are_throttled_per_person(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    _, secret = await peer(client, congress, "09121000857", "Bob")
    statuses = [
        (
            await client.post(SCAN, json={"qr_secret": f"wrong{i}", "event_id": congress.event_id}, headers=congress.attendee)
        ).status_code
        for i in range(20)
    ]
    assert statuses == [404] * 20

    blocked = await client.post(SCAN, json={"qr_secret": secret, "event_id": congress.event_id}, headers=congress.attendee)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "CONNECTION_SCAN_RATE_LIMITED"
    assert "Retry-After" in blocked.headers
    # Another attendee is not affected.
    bob, _ = await peer(client, congress, "09121000858", "Bob Two")
    assert (await client.post(SCAN, json={"qr_secret": secret, "event_id": congress.event_id}, headers=bob)).status_code == 201


async def test_network_search_pages_filters_and_normalises_persian(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    names = ["رضا كاظمي", "Sara Ahmadi", "Omid Rahimi"]
    for i, name in enumerate(names):
        _, secret = await peer(client, congress, f"0912100086{i}", name)
        await connect(client, congress.attendee, congress.event_id, secret)
    path = "/api/attendees/me/network/search"

    first = (await client.get(path, params={"limit": 2}, headers=congress.attendee)).json()
    second = (await client.get(path, params={"limit": 2, "cursor": first["next_cursor"]}, headers=congress.attendee)).json()
    assert first["total"] == 3 and len(first["items"]) == 2 and second["next_cursor"] is None
    assert [c["full_name"] for c in first["items"] + second["items"]] == list(reversed(names))

    found = (await client.get(path, params={"q": "کاظمی"}, headers=congress.attendee)).json()
    assert [c["full_name"] for c in found["items"]] == ["رضا كاظمي"]
    # The mobile of a peer who did not share it is neither shown nor searchable.
    assert (await client.get(path, params={"q": "09121000861"}, headers=congress.attendee)).json()["total"] == 0
    other_event = (
        await client.get(path, params={"event_id": "00000000-0000-0000-0000-000000000000"}, headers=congress.attendee)
    ).json()
    assert other_event["total"] == 0
    scoped = (await client.get(path, params={"event_id": congress.event_id}, headers=congress.attendee)).json()
    assert scoped["total"] == 3
