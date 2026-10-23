"""Booth QR (standee): the URL the organizer prints, resolving the booth secret, and one-tap bookmarks.

Bookmarks belong to a congress the attendee is part of: an active ticket for the booth's event is required.
"""

import uuid
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import update

from app.models import Ticket
from tests.exhibitors import auth, reserve, setup_congress
from tests.helpers import bearer
from tests.test_tickets import register_user

RESOLVE = "/api/public/booths/resolve"
SCAN = "/api/attendees/me/bookmarks/booths/scan"


async def test_standee_url_opens_the_public_booth_page_and_carries_the_booth_secret(client: AsyncClient) -> None:
    congress = await setup_congress(client)

    standee = await client.get(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/standee", headers=bearer(congress.organizer)
    )

    assert standee.status_code == 200, standee.text
    body = standee.json()
    parts = urlsplit(body["url"])
    assert f"{parts.scheme}://{parts.netloc}" == "http://test"
    assert parts.path == f"/e/{congress.slug}/booths/{congress.booth_id}"
    assert parse_qs(parts.query) == {"b": [congress.booth["qr_secret"]]}
    assert body["qr_secret"] == congress.booth["qr_secret"]
    assert body["page_published"] is True
    # The page behind the URL works for anyone.
    public = await client.get(f"/api/public/events/{congress.slug}/booths/{congress.booth_id}")
    assert public.status_code == 200


async def test_standee_is_for_the_owning_organizer_only(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    path = f"/api/events/{congress.event_id}/booths/{congress.booth_id}/standee"
    assert (await client.get(path, headers=congress.staff)).status_code == 401


async def test_anyone_resolves_a_booth_secret_or_standee_url(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    secret = congress.booth["qr_secret"]

    for code in (secret, f"  {secret.upper()} ", f"http://test/e/{congress.slug}/booths/{congress.booth_id}?b={secret}"):
        resolved = await client.post(RESOLVE, json={"code": code})
        assert resolved.status_code == 200, resolved.text
        assert resolved.json() == {
            "booth_id": congress.booth_id,
            "name": congress.booth["name"],
            "slug": congress.booth["slug"],
            "event_slug": congress.slug,
            "event_name": "Spring Congress 2027",
        }

    unknown = await client.post(RESOLVE, json={"code": "notabooth"})
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "BOOTH_QR_NOT_FOUND"
    # An attendee pass QR is not a booth QR.
    ticket_qr = await client.post(RESOLVE, json={"code": congress.ticket["qr_secret"]})
    assert ticket_qr.status_code == 404


async def test_resolving_unknown_codes_is_throttled_per_ip(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    statuses = [(await client.post(RESOLVE, json={"code": f"wrong{i}"})).status_code for i in range(25)]
    assert statuses[:20] == [404] * 20
    blocked = await client.post(RESOLVE, json={"code": congress.booth["qr_secret"]})
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "BOOTH_QR_RATE_LIMITED"
    assert "Retry-After" in blocked.headers


async def test_ticket_holder_bookmarks_a_booth_by_scanning_its_qr(client: AsyncClient) -> None:
    congress = await setup_congress(client)

    first = await client.post(SCAN, json={"code": congress.booth["qr_secret"]}, headers=congress.attendee)
    again = await client.post(SCAN, json={"code": congress.booth["qr_secret"]}, headers=congress.attendee)

    assert first.status_code == 201, first.text
    assert first.json() == {
        "bookmarked": True,
        "booth_id": congress.booth_id,
        "name": congress.booth["name"],
        "event_slug": congress.slug,
    }
    assert again.status_code == 200
    saved = (await client.get("/api/attendees/me/bookmarks/booths", headers=congress.attendee)).json()
    assert [b["booth_id"] for b in saved] == [congress.booth_id]


async def test_scanning_a_booth_qr_needs_an_active_ticket_for_that_event(app: FastAPI, client: AsyncClient) -> None:
    congress = await setup_congress(client)
    _, outsider = await register_user(client, "09121000811", "No Ticket")

    refused = await client.post(SCAN, json={"code": congress.booth["qr_secret"]}, headers=auth(outsider))
    assert refused.status_code == 403
    assert refused.json()["code"] == "ACTIVE_TICKET_REQUIRED"

    # A cancelled ticket no longer counts.
    async with app.state.sessionmaker() as session:
        await session.execute(
            update(Ticket).where(Ticket.id == uuid.UUID(congress.ticket["id"])).values(status="cancelled")
        )
        await session.commit()
    cancelled = await client.post(SCAN, json={"code": congress.booth["qr_secret"]}, headers=congress.attendee)
    assert cancelled.status_code == 403
    assert cancelled.json()["code"] == "ACTIVE_TICKET_REQUIRED"

    unknown = await client.post(SCAN, json={"code": "notabooth"}, headers=congress.attendee)
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "BOOTH_QR_NOT_FOUND"
    assert (await client.post(SCAN, json={"code": congress.booth["qr_secret"]})).status_code == 401


async def test_bookmarking_by_id_needs_an_active_ticket_and_refuses_another_congress(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    other = await setup_congress(
        client,
        organizer=congress.organizer,
        slug="autumn-congress-2027",
        staff_mobile="09121000821",
        attendee_mobile="09121000822",
    )
    path = f"/api/attendees/me/bookmarks/booths/{other.booth_id}"

    # congress.attendee holds no ticket for the other congress.
    refused = await client.post(path, headers=congress.attendee)
    assert refused.status_code == 403
    assert refused.json()["code"] == "ACTIVE_TICKET_REQUIRED"

    # Holding a ticket there too, a congress-scoped call still refuses a booth of another congress.
    await reserve(client, other.event_id, other.tier_id, congress.attendee["Authorization"][7:])
    mismatch = await client.post(path, params={"event_id": congress.event_id}, headers=congress.attendee)
    assert mismatch.status_code == 409
    assert mismatch.json()["code"] == "BOOTH_OTHER_EVENT"
    scan_mismatch = await client.post(
        SCAN, json={"code": other.booth["qr_secret"], "event_id": congress.event_id}, headers=congress.attendee
    )
    assert scan_mismatch.status_code == 409
    assert scan_mismatch.json()["code"] == "BOOTH_OTHER_EVENT"

    accepted = await client.post(path, params={"event_id": other.event_id}, headers=congress.attendee)
    assert accepted.status_code == 201, accepted.text
    # Removing a bookmark never needs a ticket.
    assert (await client.delete(path, headers=congress.attendee)).status_code == 200
