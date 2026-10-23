"""Organizer participants register: search, edit registration details, cancel, reissue, transfer, delete, CSV."""

import re
import uuid
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EntityQR, ShortLink, TicketTier
from app.sms.gateway import SmsGateway
from app.sms.outbox import deliver_due
from tests.helpers import bearer, provision_organizer, sign_in
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def congress(
    client: AsyncClient, organizer: dict[str, str] | None = None, **event: Any
) -> tuple[dict[str, str], str, str]:
    """(organizer, event id, tier id) for a new congress with one tier of 10 places."""
    organizer = organizer or await provision_organizer(client, "Participants Co")
    body = {**EVENT, "slug": f"participants-{uuid.uuid4().hex[:8]}", **event}
    created = await client.post("/api/events", json=body, headers=bearer(organizer))
    assert created.status_code == 201, created.text
    event_id: str = created.json()["id"]
    tier_id: str = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(quota=10), headers=bearer(organizer))
    ).json()["id"]
    return organizer, event_id, tier_id


async def register(
    client: AsyncClient, event_id: str, tier_id: str, mobile: str, name: str, organization: str = "Org", title: str = ""
) -> tuple[str, dict[str, Any]]:
    """A signed-in attendee holding a ticket: (token, ticket)."""
    _, token = await sign_in(client, mobile, name, organization, title)
    reserved = await client.post(
        f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token)
    )
    assert reserved.status_code == 201, reserved.text
    ticket: dict[str, Any] = reserved.json()
    return token, ticket


async def reserved_count(app: FastAPI, tier_id: str) -> int:
    async with app.state.sessionmaker() as session:
        found = await session.get(TicketTier, uuid.UUID(tier_id))
        assert found is not None
        return int(found.reserved_count)


async def qr_rows(app: FastAPI, ticket_id: str) -> list[EntityQR]:
    async with app.state.sessionmaker() as session:
        return list(await session.scalars(select(EntityQR).where(EntityQR.entity_id == uuid.UUID(ticket_id))))


def sms_to(app: FastAPI, mobile: str) -> list[Any]:
    gateway: SmsGateway = app.state.sms
    return gateway.recorder.sent_to(mobile)


async def test_list_searches_persian_names_organizations_and_mobiles(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    # Arabic ي/ك as typed on an Arabic keyboard, and a name written with a zero-width non-joiner.
    await register(client, event_id, tier_id, "09121230001", "علي كريمي", "دانشگاه تهران")
    await register(client, event_id, tier_id, "09121230002", "محمد‌رضا احمدی", "Clinic 50%_off")
    await register(client, event_id, tier_id, "09121234567", "Sara Lee", "Acme")
    url = f"/api/events/{event_id}/participants"

    async def names(**params: Any) -> list[str]:
        resp = await client.get(url, params=params, headers=bearer(organizer))
        assert resp.status_code == 200, resp.text
        return [p["attendee_full_name"] for p in resp.json()["items"]]

    assert await names(q="کریمی") == ["علي كريمي"]
    assert await names(q="علی") == ["علي كريمي"]
    assert await names(q="محمدرضا") == ["محمد‌رضا احمدی"]
    assert await names(q="تهران") == ["علي كريمي"]
    assert await names(q="۴۵۶۷") == ["Sara Lee"]
    # LIKE wildcards are literal characters.
    assert await names(q="50%_") == ["محمد‌رضا احمدی"]
    assert await names(q="%") == ["محمد‌رضا احمدی"]
    assert await names(q="_") == ["محمد‌رضا احمدی"]
    assert len(await names()) == 3

    page = (await client.get(url, params={"limit": 2, "offset": 2}, headers=bearer(organizer))).json()
    assert (page["total"], page["limit"], page["offset"], len(page["items"])) == (3, 2, 2, 1)
    first = page["items"][0]
    assert first["attendee_full_name"] == "علي كريمي"  # newest first: the first registration is last
    assert first["mobile"] == "09121230001" and first["status"] == "active" and first["can_delete"] is True


async def test_filters_by_tier_and_status(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    vip_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(name="VIP", quota=5), headers=bearer(organizer))
    ).json()["id"]
    await register(client, event_id, tier_id, "09121230011", "General One")
    _, vip = await register(client, event_id, vip_id, "09121230012", "Vip One")
    url = f"/api/events/{event_id}/participants"
    await client.post(f"{url}/{vip['id']}/cancel", json={"reason": "duplicate"}, headers=bearer(organizer))

    by_tier = (await client.get(url, params={"tier_id": vip_id}, headers=bearer(organizer))).json()
    cancelled = (await client.get(url, params={"status": "cancelled"}, headers=bearer(organizer))).json()
    active = (await client.get(url, params={"status": "active"}, headers=bearer(organizer))).json()

    assert [p["attendee_full_name"] for p in by_tier["items"]] == ["Vip One"]
    assert [p["attendee_full_name"] for p in cancelled["items"]] == ["Vip One"]
    assert cancelled["items"][0]["cancelled_reason"] == "duplicate"
    assert cancelled["items"][0]["cancelled_by"] == "organizer"
    assert [p["attendee_full_name"] for p in active["items"]] == ["General One"]
    assert active["total"] == 1


async def test_another_organizers_event_and_tickets_are_not_found(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230021", "Private Person")
    intruder = await provision_organizer(client, "Intruder Co")
    _, intruder_event, _ = await congress(client, intruder)
    base = f"/api/events/{event_id}/participants"
    item = f"{base}/{ticket['id']}"

    assert (await client.get(base, headers=bearer(intruder))).status_code == 404
    assert (await client.get(f"{base}/export-csv", headers=bearer(intruder))).status_code == 404
    assert (await client.get(item, headers=bearer(intruder))).status_code == 404
    assert (await client.patch(item, json={"attendee_full_name": "X"}, headers=bearer(intruder))).status_code == 404
    assert (await client.post(f"{item}/cancel", json={}, headers=bearer(intruder))).status_code == 404
    assert (await client.post(f"{item}/reissue", json={}, headers=bearer(intruder))).status_code == 404
    assert (await client.delete(item, headers=bearer(intruder))).status_code == 404
    # The intruder's own event does not reach the ticket either.
    foreign = f"/api/events/{intruder_event}/participants/{ticket['id']}"
    assert (await client.get(foreign, headers=bearer(intruder))).status_code == 404
    assert (await client.post(f"{foreign}/cancel", json={}, headers=bearer(intruder))).status_code == 404
    # Nothing changed.
    assert (await client.get(item, headers=bearer(organizer))).json()["status"] == "active"
    assert (await client.get(base)).status_code == 401


async def test_editing_registration_details_leaves_the_shared_account_alone(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121230031", "Dr. Typo", "Old Org", "MD")
    _, other_event, other_tier = await congress(client, organizer)
    await client.post(f"/api/events/{other_event}/tickets/reserve", json={"ticket_tier_id": other_tier}, headers=auth(token))

    resp = await client.patch(
        f"/api/events/{event_id}/participants/{ticket['id']}",
        json={"attendee_full_name": "  Dr. Fixed Name ", "attendee_organization": "New Org"},
        headers=bearer(organizer),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["attendee_full_name"], body["attendee_organization"], body["attendee_title"]) == (
        "Dr. Fixed Name", "New Org", "MD",
    )
    me = (await client.get("/api/auth/me", headers=auth(token))).json()
    assert (me["full_name"], me["organization"]) == ("Dr. Typo", "Old Org")
    passes = {t["event_id"]: t["attendee_name"] for t in (await client.get("/api/attendees/me/tickets", headers=auth(token))).json()}
    assert passes == {event_id: "Dr. Fixed Name", other_event: "Dr. Typo"}
    desk = (await client.get(f"/api/events/{event_id}/attendees", params={"q": "Fixed"}, headers=bearer(organizer))).json()
    assert [(a["attendee_name"], a["organization"]) for a in desk] == [("Dr. Fixed Name", "New Org")]
    detail = (await client.get(f"/api/events/{event_id}/attendees/{ticket['id']}", headers=bearer(organizer))).json()
    assert detail["attendee_name"] == "Dr. Fixed Name"

    blank = await client.patch(
        f"/api/events/{event_id}/participants/{ticket['id']}", json={"attendee_full_name": "  "}, headers=bearer(organizer)
    )
    assert blank.status_code == 422


async def test_cancel_releases_the_place_once_and_revokes_the_pass(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121230041", "Dr. Cancel Me")
    # Networking scans need the scanner's own active ticket for the congress.
    peer_token, _ = await register(client, event_id, tier_id, "09121230042", "Peer")
    item = f"/api/events/{event_id}/participants/{ticket['id']}"
    assert await reserved_count(app, tier_id) == 2
    await deliver_due(app.state.sessionmaker, app.state.sms)

    cancelled = await client.post(f"{item}/cancel", json={"reason": "Asked by phone"}, headers=bearer(organizer))
    again = await client.post(f"{item}/cancel", json={"reason": "twice"}, headers=bearer(organizer))

    assert cancelled.status_code == 200, cancelled.text
    body = cancelled.json()
    assert (body["status"], body["cancelled_reason"], body["qr_secret"]) == ("cancelled", "Asked by phone", None)
    assert body["cancelled_at"] is not None
    assert again.status_code == 409
    assert await reserved_count(app, tier_id) == 1
    assert [q.is_active for q in await qr_rows(app, ticket["id"])] == [False]
    scan = await client.post("/api/attendees/me/network/scan", json={"qr_secret": ticket["qr_secret"], "event_id": event_id}, headers=auth(peer_token))
    assert scan.status_code == 404
    # Hidden from the attendee's passes unless asked for, and never shown as a scannable code.
    assert (await client.get("/api/attendees/me/tickets", headers=auth(token))).json() == []
    (listed,) = (await client.get("/api/attendees/me/tickets", params={"include_cancelled": True}, headers=auth(token))).json()
    assert (listed["status"], listed["qr_secret"]) == ("cancelled", "")
    # The cancellation SMS goes out through the outbox.
    await deliver_due(app.state.sessionmaker, app.state.sms)
    notice = sms_to(app, "09121230041")[-1]
    assert notice.kind == "ticket_cancelled"
    assert notice.text == f"Dr. Cancel Me عزیز، بلیت شما در «{EVENT['name']}» لغو شد و کارت ورود آن دیگر معتبر نیست."
    # Reissuing a cancelled ticket is refused.
    assert (await client.post(f"{item}/reissue", json={}, headers=bearer(organizer))).status_code == 409


async def test_cancel_without_notice_sends_nothing(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230045", "Quiet Cancel")
    await deliver_due(app.state.sessionmaker, app.state.sms)
    before = len(sms_to(app, "09121230045"))

    resp = await client.post(
        f"/api/events/{event_id}/participants/{ticket['id']}/cancel", json={"notify": False}, headers=bearer(organizer)
    )
    await deliver_due(app.state.sessionmaker, app.state.sms)

    assert resp.status_code == 200
    assert resp.json()["cancelled_reason"] is None
    assert len(sms_to(app, "09121230045")) == before


async def test_registering_again_after_a_cancellation_reactivates_the_ticket(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121230051", "Second Chance")
    await client.post(f"/api/events/{event_id}/participants/{ticket['id']}/cancel", json={}, headers=bearer(organizer))

    again = await client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token))

    assert again.status_code == 201, again.text
    body = again.json()
    assert body["id"] == ticket["id"] and body["status"] == "active"
    assert body["qr_secret"] != ticket["qr_secret"]
    assert await reserved_count(app, tier_id) == 1
    (qr,) = await qr_rows(app, ticket["id"])
    assert qr.is_active and qr.secret == body["qr_secret"]
    duplicate = await client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token))
    assert duplicate.status_code == 409


async def test_reissue_replaces_the_secret_and_texts_the_new_pass(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121230061", "Lost Phone")
    peer_token, _ = await register(client, event_id, tier_id, "09121230062", "Peer")
    await deliver_due(app.state.sessionmaker, app.state.sms)

    resp = await client.post(f"/api/events/{event_id}/participants/{ticket['id']}/reissue", json={}, headers=bearer(organizer))

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "active" and body["reissued_at"] is not None
    assert body["qr_secret"] and body["qr_secret"] != ticket["qr_secret"]
    (mine,) = (await client.get("/api/attendees/me/tickets", headers=auth(token))).json()
    assert mine["qr_secret"] == body["qr_secret"]
    old = await client.post("/api/attendees/me/network/scan", json={"qr_secret": ticket["qr_secret"], "event_id": event_id}, headers=auth(peer_token))
    new = await client.post("/api/attendees/me/network/scan", json={"qr_secret": body["qr_secret"], "event_id": event_id}, headers=auth(peer_token))
    assert old.status_code == 404
    assert new.status_code in (200, 201)
    assert await reserved_count(app, tier_id) == 2
    await deliver_due(app.state.sessionmaker, app.state.sms)
    notice = sms_to(app, "09121230061")[-1]
    assert notice.kind == "ticket_reissued"
    assert "دوباره صادر شد" in notice.text and "/t/" in notice.text


async def test_transfer_moves_the_place_to_another_person(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230071", "Original Holder")
    item = f"/api/events/{event_id}/participants/{ticket['id']}"
    await deliver_due(app.state.sessionmaker, app.state.sms)

    nameless = await client.post(f"{item}/transfer", json={"mobile": "09121230072"}, headers=bearer(organizer))
    assert nameless.status_code == 422
    resp = await client.post(
        f"{item}/transfer",
        json={"mobile": "+98 912 123 0072", "full_name": "New Holder", "organization": "Clinic"},
        headers=bearer(organizer),
    )

    assert resp.status_code == 200, resp.text
    moved = resp.json()
    assert moved["ticket_id"] != ticket["id"]
    assert (moved["attendee_full_name"], moved["attendee_organization"], moved["mobile"]) == (
        "New Holder", "Clinic", "09121230072",
    )
    assert moved["status"] == "active" and moved["qr_secret"] != ticket["qr_secret"]
    original = (await client.get(item, headers=bearer(organizer))).json()
    assert (original["status"], original["cancelled_reason"]) == ("cancelled", "transferred")
    assert await reserved_count(app, tier_id) == 1
    # The new holder signs in with their number and finds the pass.
    _, new_token = await sign_in(client, "09121230072", "ignored for an existing account")
    (theirs,) = (await client.get("/api/attendees/me/tickets", headers=auth(new_token))).json()
    assert (theirs["id"], theirs["attendee_name"]) == (moved["ticket_id"], "New Holder")
    await deliver_due(app.state.sessionmaker, app.state.sms)
    assert sms_to(app, "09121230071")[-1].kind == "ticket_cancelled"
    assert sms_to(app, "09121230072")[-1].kind == "ticket_confirmation"
    # Moving it again to someone who already holds a ticket here is refused.
    _, other = await register(client, event_id, tier_id, "09121230073", "Already Here")
    refused = await client.post(
        f"/api/events/{event_id}/participants/{moved['ticket_id']}/transfer",
        json={"mobile": "09121230073"},
        headers=bearer(organizer),
    )
    assert refused.status_code == 409
    assert (await client.get(f"/api/events/{event_id}/participants/{moved['ticket_id']}", headers=bearer(organizer))).json()["status"] == "active"
    same = await client.post(
        f"/api/events/{event_id}/participants/{moved['ticket_id']}/transfer",
        json={"mobile": "09121230072"},
        headers=bearer(organizer),
    )
    assert same.status_code == 409
    assert await reserved_count(app, tier_id) == 2
    assert other["status"] == "active"


async def test_transfer_back_to_a_previous_holder_reuses_their_ticket(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230081", "Holder A")
    base = f"/api/events/{event_id}/participants"
    to_b = (
        await client.post(f"{base}/{ticket['id']}/transfer", json={"mobile": "09121230082", "full_name": "Holder B"}, headers=bearer(organizer))
    ).json()

    back = await client.post(f"{base}/{to_b['ticket_id']}/transfer", json={"mobile": "09121230081"}, headers=bearer(organizer))

    assert back.status_code == 200, back.text
    assert back.json()["ticket_id"] == ticket["id"]
    assert back.json()["status"] == "active"
    assert await reserved_count(app, tier_id) == 1


async def test_delete_only_a_registration_made_by_mistake(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, mistake = await register(client, event_id, tier_id, "09121230091", "Wrong Person")
    _, real = await register(client, event_id, tier_id, "09121230092", "Real Lead")
    booth = (
        await client.post(
            f"/api/events/{event_id}/booths", json={"name": "Booth", "slug": "booth", "location": "A1"}, headers=bearer(organizer)
        )
    ).json()
    _, staff_token = await sign_in(client, "09121230093", "Staff")
    await client.post(f"/api/events/{event_id}/booths/{booth['id']}/staff", json={"mobile": "09121230093"}, headers=bearer(organizer))
    lead = await client.post(f"/api/booths/{booth['id']}/leads/scan", json={"qr_secret": real["qr_secret"]}, headers=auth(staff_token))
    assert lead.status_code == 201, lead.text
    base = f"/api/events/{event_id}/participants"
    flags = {p["attendee_full_name"]: (p["can_delete"], p["lead_count"]) for p in (await client.get(base, headers=bearer(organizer))).json()["items"]}
    assert flags == {"Wrong Person": (True, 0), "Real Lead": (False, 1)}

    refused = await client.delete(f"{base}/{real['id']}", headers=bearer(organizer))
    deleted = await client.delete(f"{base}/{mistake['id']}", headers=bearer(organizer))

    assert refused.status_code == 409 and "Cancel" in refused.json()["detail"]
    assert deleted.status_code == 204
    assert (await client.get(f"{base}/{mistake['id']}", headers=bearer(organizer))).status_code == 404
    assert await qr_rows(app, mistake["id"]) == []
    assert await reserved_count(app, tier_id) == 1
    # A cancelled registration made by mistake can be deleted too, without releasing its place twice.
    _, second = await register(client, event_id, tier_id, "09121230094", "Also Wrong")
    await client.post(f"{base}/{second['id']}/cancel", json={}, headers=bearer(organizer))
    assert (await client.delete(f"{base}/{second['id']}", headers=bearer(organizer))).status_code == 204
    assert await reserved_count(app, tier_id) == 1


async def test_csv_export_is_formula_safe_and_follows_the_filters(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    await register(client, event_id, tier_id, "09121230101", "=HYPERLINK(\"http://evil\")", "+Org", "@title")
    _, cancelled = await register(client, event_id, tier_id, "09121230102", "Cancelled Person")
    base = f"/api/events/{event_id}/participants"
    await client.post(f"{base}/{cancelled['id']}/cancel", json={"reason": "-oops"}, headers=bearer(organizer))

    resp = await client.get(f"{base}/export-csv", headers=bearer(organizer))
    active_only = await client.get(f"{base}/export-csv", params={"status": "active"}, headers=bearer(organizer))

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "participants.csv" in resp.headers["content-disposition"]
    text = resp.text
    assert text.startswith("﻿")
    lines = text.lstrip("﻿").splitlines()
    assert lines[0].startswith("Ticket ID,Full Name,Mobile,Organization,Title,Ticket Tier,Status")
    assert len(lines) == 3
    assert "'=HYPERLINK" in text and ",'+Org,'@title," in text
    assert "'-oops" in text and "09121230101" in text
    assert len(active_only.text.lstrip("﻿").splitlines()) == 2


RESOLVE = "/api/public/passes/resolve"
LINK = re.compile(r"http://test/t/([a-z0-9]{10})")


async def resolve(client: AsyncClient, code: str) -> tuple[int, str | None]:
    """(status, error code) for a refused short link, (200, QR secret) for one that opens the pass."""
    resp = await client.post(RESOLVE, json={"code": code})
    body: dict[str, Any] = resp.json()
    return resp.status_code, body["qr_secret"] if resp.status_code == 200 else body.get("code")


async def link_codes(app: FastAPI, ticket_id: str) -> list[str]:
    async with app.state.sessionmaker() as session:
        rows = await session.scalars(
            select(ShortLink.code).where(ShortLink.ticket_id == uuid.UUID(ticket_id)).order_by(ShortLink.created_at)
        )
        return [str(code) for code in rows]


async def test_cancelled_tickets_short_link_stops_working(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230111", "Link Holder")
    (code,) = await link_codes(app, ticket["id"])
    assert await resolve(client, code) == (200, ticket["qr_secret"])

    await client.post(f"/api/events/{event_id}/participants/{ticket['id']}/cancel", json={}, headers=bearer(organizer))

    assert await resolve(client, code) == (410, "LINK_REVOKED")


async def test_reissue_revokes_the_old_link_and_texts_a_working_new_one(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230121", "Reissued Link")
    (old,) = await link_codes(app, ticket["id"])

    reissued = (
        await client.post(f"/api/events/{event_id}/participants/{ticket['id']}/reissue", json={}, headers=bearer(organizer))
    ).json()
    await deliver_due(app.state.sessionmaker, app.state.sms)

    codes = await link_codes(app, ticket["id"])
    assert len(codes) == 2 and codes[0] == old
    texted = LINK.search(sms_to(app, "09121230121")[-1].text)
    assert texted is not None and texted.group(1) == codes[1]
    assert await resolve(client, old) == (410, "LINK_REVOKED")
    assert await resolve(client, codes[1]) == (200, reissued["qr_secret"])


async def test_transferred_ticket_gets_a_new_holder_link(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09121230131", "Giver")
    (old,) = await link_codes(app, ticket["id"])

    moved = (
        await client.post(
            f"/api/events/{event_id}/participants/{ticket['id']}/transfer",
            json={"mobile": "09121230132", "full_name": "Receiver"},
            headers=bearer(organizer),
        )
    ).json()
    await deliver_due(app.state.sessionmaker, app.state.sms)

    assert await resolve(client, old) == (410, "LINK_REVOKED")
    (new,) = await link_codes(app, moved["ticket_id"])
    texted = LINK.search(sms_to(app, "09121230132")[-1].text)
    assert texted is not None and texted.group(1) == new
    assert await resolve(client, new) == (200, moved["qr_secret"])
    pass_page = (await client.post(RESOLVE, json={"code": new})).json()
    assert pass_page["attendee"]["full_name"] == "Receiver"


async def test_registering_again_texts_a_working_link(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09121230141", "Comes Back")
    await client.post(f"/api/events/{event_id}/participants/{ticket['id']}/cancel", json={}, headers=bearer(organizer))
    again = (
        await client.post(f"/api/events/{event_id}/tickets/reserve", json={"ticket_tier_id": tier_id}, headers=auth(token))
    ).json()
    await deliver_due(app.state.sessionmaker, app.state.sms)

    texted = LINK.search(sms_to(app, "09121230141")[-1].text)
    assert texted is not None
    assert await resolve(client, texted.group(1)) == (200, again["qr_secret"])
