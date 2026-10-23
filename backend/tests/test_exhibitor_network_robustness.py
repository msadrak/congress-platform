"""Leads, networking and booths under stress: concurrent network scans, input size limits, booth staff of a revoked
organizer or an archived congress, attendee actions on archived congresses, and the bounded legacy lists."""

import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import AuditEvent
from tests.conftest import ADMIN_TOKEN
from tests.exhibitors import Congress, reserve, setup_congress
from tests.helpers import bearer, publish_page
from tests.test_integrity import behind_uncommitted, scalar, user_id_of
from tests.test_lead_lifecycle import add_attendee, capture, csv_rows
from tests.test_page_media import image_bytes, upload, use_as_cover
from tests.test_tickets import register_user

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
PEER_MOBILE = "09121000803"
INSERT_CONNECTION = (
    "INSERT INTO connections(id,user_id,connected_user_id,event_id,private_notes,created_at,updated_at) "
    "VALUES($1,$2,$3,$4,'',now(),now())"
)


def leads_url(congress: Congress) -> str:
    return f"/api/booths/{congress.booth_id}/leads"


async def archive(client: AsyncClient, congress: Congress, archived: bool = True) -> None:
    response = await client.post(
        f"/api/events/{congress.event_id}/archive", json={"archived": archived}, headers=bearer(congress.organizer)
    )
    assert response.status_code == 200, response.text


async def network_scan(client: AsyncClient, congress: Congress, qr_secret: str, **fields: Any) -> Any:
    return await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": qr_secret, "event_id": congress.event_id, **fields},
        headers=congress.attendee,
    )


async def peer_ticket(client: AsyncClient, congress: Congress) -> dict[str, Any]:
    _, token = await register_user(client, PEER_MOBILE, "Dr. Peer")
    return await reserve(client, congress.event_id, congress.tier_id, token)


# --- M6: a duplicate concurrent network scan -----------------------------------------------------------------

async def test_a_concurrent_duplicate_network_scan_answers_with_the_one_connection(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    peer = await peer_ticket(client, congress)
    me, other = await user_id_of("09121000802"), await user_id_of(PEER_MOBILE)
    connection_id = uuid.uuid4()

    response = await behind_uncommitted(
        [(INSERT_CONNECTION, (connection_id, me, other, uuid.UUID(congress.event_id)))],
        network_scan(client, congress, peer["qr_secret"], private_notes="Met at the gate"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(connection_id)
    assert response.json()["private_notes"] == "Met at the gate"
    assert await scalar("SELECT count(*) FROM connections WHERE user_id=$1", me) == 1


# --- M7: size limits -----------------------------------------------------------------------------------------

@pytest.mark.parametrize(
    "fields",
    [
        {"qr_secret": "a" * 513},
        {"notes": "n" * 2001},
        {"tags": [f"t{i}" for i in range(21)]},
        {"tags": ["x" * 41]},
        {"rating": "W" * 17},
    ],
)
async def test_oversized_lead_scans_are_refused(client: AsyncClient, fields: dict[str, Any]) -> None:
    congress = await setup_congress(client)
    body = {"qr_secret": congress.ticket["qr_secret"], **fields}

    response = await client.post(f"{leads_url(congress)}/scan", json=body, headers=congress.staff)

    assert response.status_code == 422, response.text
    assert await scalar("SELECT count(*) FROM leads") == 0


@pytest.mark.parametrize("fields", [{"notes": "n" * 2001}, {"tags": ["t"] * 21}, {"tags": ["x" * 41]}])
async def test_oversized_lead_edits_are_refused(client: AsyncClient, fields: dict[str, Any]) -> None:
    congress = await setup_congress(client)
    lead = await capture(client, congress, congress.ticket["qr_secret"])

    response = await client.patch(f"{leads_url(congress)}/{lead['id']}", json=fields, headers=congress.staff)

    assert response.status_code == 422, response.text


async def test_leads_at_the_size_limits_are_accepted(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    tags = [f"{i:02d}" + "x" * 38 for i in range(20)]

    lead = await capture(client, congress, congress.ticket["qr_secret"], notes="n" * 2000, tags=tags)

    assert (len(lead["notes"]), lead["tags"]) == (2000, tags)


@pytest.mark.parametrize("fields", [{"qr_secret": "a" * 513}, {"private_notes": "n" * 2001}])
async def test_oversized_network_scans_are_refused(client: AsyncClient, fields: dict[str, Any]) -> None:
    congress = await setup_congress(client)
    peer = await peer_ticket(client, congress)

    response = await network_scan(client, congress, **{"qr_secret": peer["qr_secret"], **fields})

    assert response.status_code == 422, response.text
    assert await scalar("SELECT count(*) FROM connections") == 0


async def test_oversized_connection_notes_are_refused(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    peer = await peer_ticket(client, congress)
    connection = (await network_scan(client, congress, peer["qr_secret"])).json()
    url = f"/api/attendees/me/network/{connection['id']}"

    refused = await client.patch(url, json={"private_notes": "n" * 2001}, headers=congress.attendee)
    accepted = await client.patch(url, json={"private_notes": "n" * 2000}, headers=congress.attendee)

    assert refused.status_code == 422, refused.text
    assert accepted.status_code == 200, accepted.text


async def test_overlong_search_terms_are_refused(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    term = "q" * 101

    for url, headers in (
        (leads_url(congress), congress.staff),
        (f"{leads_url(congress)}/search", congress.staff),
        ("/api/attendees/me/network/search", congress.attendee),
    ):
        assert (await client.get(url, params={"q": term}, headers=headers)).status_code == 422, url
        assert (await client.get(url, params={"q": "q" * 100}, headers=headers)).status_code == 200, url


# --- M8: booth staff of a revoked organizer or an archived congress ------------------------------------------

async def test_booth_staff_of_a_revoked_organizer_are_refused(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    lead = await capture(client, congress, congress.ticket["qr_secret"])
    revoked = await client.post(f"/api/organizers/{congress.organizer['id']}/revoke", headers=ADMIN)
    assert revoked.status_code == 200, revoked.text
    base = leads_url(congress)

    for method, url, body in (
        ("GET", f"/api/booths/{congress.booth_id}", None),
        ("GET", base, None),
        ("GET", f"{base}/search", None),
        ("GET", f"{base}/export-csv", None),
        ("POST", f"{base}/scan", {"qr_secret": congress.ticket["qr_secret"]}),
        ("PATCH", f"{base}/{lead['id']}", {"rating": "HOT"}),
        ("DELETE", f"{base}/{lead['id']}", None),
        ("POST", f"{base}/{lead['id']}/restore", None),
    ):
        response = await client.request(method, url, json=body, headers=congress.staff)
        assert response.status_code == 403, (method, url, response.text)
        assert response.json()["code"] == "BOOTH_ACCESS_SUSPENDED", (method, url)

    assert (await client.get("/api/booths/me", headers=congress.staff)).json() == []


async def test_booth_staff_read_but_cannot_change_leads_of_an_archived_congress(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    lead = await capture(client, congress, congress.ticket["qr_secret"], notes="Wants a demo")
    other_secret = await add_attendee(client, congress, "09121000804", "Dr. Late Visitor")
    await archive(client, congress)
    base = leads_url(congress)

    for method, url, body in (
        ("POST", f"{base}/scan", {"qr_secret": other_secret}),
        ("POST", f"{base}/scan", {"qr_secret": congress.ticket["qr_secret"], "rating": "COLD"}),
        ("PATCH", f"{base}/{lead['id']}", {"rating": "HOT"}),
        ("DELETE", f"{base}/{lead['id']}", None),
        ("POST", f"{base}/{lead['id']}/restore", None),
    ):
        response = await client.request(method, url, json=body, headers=congress.staff)
        assert response.status_code == 409, (method, url, response.text)
        assert response.json()["code"] == "EVENT_ARCHIVED", (method, url)

    assert (await client.get(f"/api/booths/{congress.booth_id}", headers=congress.staff)).status_code == 200
    assert [item["id"] for item in (await client.get(base, headers=congress.staff)).json()] == [lead["id"]]
    assert (await client.get(f"{base}/search", headers=congress.staff)).json()["total"] == 1
    exported = await client.get(f"{base}/export-csv", headers=congress.staff)
    assert exported.status_code == 200 and len(csv_rows(exported.text)) == 2
    assert await scalar("SELECT count(*) FROM leads") == 1
    assert await scalar("SELECT rating FROM leads") == "WARM"

    await archive(client, congress, archived=False)
    assert (await client.patch(f"{base}/{lead['id']}", json={"rating": "HOT"}, headers=congress.staff)).status_code == 200


async def test_a_non_member_is_still_told_they_are_not_staff_on_an_archived_congress(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    await archive(client, congress)

    response = await client.post(
        f"{leads_url(congress)}/scan", json={"qr_secret": congress.ticket["qr_secret"]}, headers=congress.attendee
    )

    assert response.status_code == 403
    assert response.json()["code"] == "BOOTH_STAFF_REQUIRED"


# --- M2: attendee actions on an archived congress ------------------------------------------------------------

async def test_networking_and_booth_bookmarks_close_when_the_congress_is_archived(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    peer = await peer_ticket(client, congress)
    await archive(client, congress)

    scanned = await network_scan(client, congress, peer["qr_secret"])
    by_id = await client.post(f"/api/attendees/me/bookmarks/booths/{congress.booth_id}", headers=congress.attendee)
    by_qr = await client.post(
        "/api/attendees/me/bookmarks/booths/scan", json={"code": congress.booth["qr_secret"]}, headers=congress.attendee
    )

    for response in (scanned, by_id, by_qr):
        assert response.status_code == 409, response.text
        assert response.json()["code"] == "NETWORKING_CLOSED"
    assert await scalar("SELECT count(*) FROM connections") == 0
    assert await scalar("SELECT count(*) FROM booth_bookmarks") == 0
    # Removing one's own bookmark stays possible.
    removed = await client.delete(f"/api/attendees/me/bookmarks/booths/{congress.booth_id}", headers=congress.attendee)
    assert removed.status_code == 200


async def test_an_archived_congress_stops_serving_its_page_images(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    asset = (await upload(client, congress.organizer, congress.event_id, image_bytes())).json()
    await use_as_cover(client, congress.organizer, congress.event_id, asset["id"])
    await publish_page(client, congress.organizer, congress.event_id)
    url = f"/api/public/media/{asset['id']}"
    assert (await client.get(url)).status_code == 200

    await archive(client, congress)

    assert (await client.get(url)).status_code == 404


# --- L6: bounded legacy lists and a streamed export ----------------------------------------------------------

async def test_the_legacy_lists_take_a_bounded_limit(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    first = await capture(client, congress, congress.ticket["qr_secret"])
    second = await capture(client, congress, await add_attendee(client, congress, "09121000804", "Dr. Second"))
    peer = await peer_ticket(client, congress)
    await network_scan(client, congress, peer["qr_secret"])

    everything = (await client.get(leads_url(congress), headers=congress.staff)).json()
    newest = (await client.get(leads_url(congress), params={"limit": 1}, headers=congress.staff)).json()
    network = await client.get("/api/attendees/me/network", params={"limit": 1}, headers=congress.attendee)

    assert [item["id"] for item in everything] == [second["id"], first["id"]]
    assert [item["id"] for item in newest] == [second["id"]]
    assert network.status_code == 200 and len(network.json()) == 1
    for url, headers in ((leads_url(congress), congress.staff), ("/api/attendees/me/network", congress.attendee)):
        assert (await client.get(url, params={"limit": 1001}, headers=headers)).status_code == 422
        assert (await client.get(url, params={"limit": 0}, headers=headers)).status_code == 422


async def test_the_lead_export_is_streamed_and_audited_with_its_row_count(client: AsyncClient, app: FastAPI) -> None:
    congress = await setup_congress(client)
    await capture(client, congress, congress.ticket["qr_secret"], tags=["follow-up", "demo"], notes="=cmd()")
    deleted = await capture(client, congress, await add_attendee(client, congress, "09121000804", "Dr. Gone"))
    await client.delete(f"{leads_url(congress)}/{deleted['id']}", headers=congress.staff)

    active = await client.get(f"{leads_url(congress)}/export-csv", headers=congress.staff)
    everything = await client.get(
        f"{leads_url(congress)}/export-csv", params={"include_deleted": True}, headers=congress.staff
    )

    assert active.status_code == 200
    assert active.headers["content-type"] == "text/csv; charset=utf-8"
    assert active.headers["content-disposition"] == f'attachment; filename="{congress.booth["slug"]}-leads.csv"'
    assert active.text.startswith("﻿Lead ID,")
    rows = csv_rows(active.text)
    assert len(rows) == 2 and rows[1][7] == "follow-up; demo" and rows[1][8] == "'=cmd()"
    assert len(csv_rows(everything.text)) == 3
    async with app.state.sessionmaker() as session:
        audited = (
            await session.scalars(
                select(AuditEvent).where(AuditEvent.action == "export.download").order_by(AuditEvent.at)
            )
        ).all()
    assert [(a.summary["include_deleted"], a.summary["rows"]) for a in audited] == [(False, 1), (True, 2)]
