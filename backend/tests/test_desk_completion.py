"""The reception desk end to end: QR lookup, admitting at a check-in point, badge printing, registration
changes at the desk, walk-in reactivation, operator invitations and restore, and the pass resend.

Every desk route accepts an operator session or an organizer credential (app.routes.desk); these tests act as
an operator unless they check the organizer path, so attribution and isolation are what an operator gets.
"""

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select

from app.models import AuditEvent, CheckIn, DeskCheckIn, SmsMessage, TicketPrint, TicketTier
from app.sms.gateway import SmsGateway
from app.sms.provider import SmsResult
from tests.helpers import bearer, desk_sign_in, provision_organizer
from tests.test_events import EVENT
from tests.test_roles import member_session
from tests.test_ticket_tiers import tier

OPERATOR_MOBILE = "09121004400"


@dataclass
class Desk:
    organizer: dict[str, str]
    event_id: str
    tier_id: str
    operator_id: str
    headers: dict[str, str]


async def open_desk(client: AsyncClient, *, name: str = "Desk Congress Co", mobile: str = OPERATOR_MOBILE) -> Desk:
    """A congress with one tier and one signed-in desk operator ("Sara")."""
    organizer = await provision_organizer(client, name)
    created = await client.post(
        "/api/events", json=EVENT | {"slug": f"desk-{uuid.uuid4().hex[:8]}"}, headers=bearer(organizer)
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    tier_id = (
        await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(quota=10), headers=bearer(organizer))
    ).json()["id"]
    added = await client.post(
        f"/api/events/{event_id}/desk/operators", json={"operator_name": "Sara", "mobile": mobile},
        headers=bearer(organizer),
    )
    assert added.status_code == 201, added.text
    login = await desk_sign_in(client, event_id, mobile)
    assert login.status_code == 200, login.text
    return Desk(organizer, event_id, tier_id, added.json()["id"], {"Authorization": f"Bearer {login.json()['access_token']}"})


async def walk_in(client: AsyncClient, desk: Desk, name: str = "Dr. Neda Amini", **extra: Any) -> dict[str, Any]:
    body = {"full_name": name, "organization": "Heart Center", "title": "Cardiologist", "ticket_tier_id": desk.tier_id}
    issued = await client.post(f"/api/events/{desk.event_id}/desk-registrations", json=body | extra, headers=desk.headers)
    assert issued.status_code == 201, issued.text
    result: dict[str, Any] = issued.json()
    return result


async def card(client: AsyncClient, desk: Desk, ticket_id: str) -> dict[str, Any]:
    response = await client.get(f"/api/events/{desk.event_id}/attendees/{ticket_id}", headers=desk.headers)
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def point(client: AsyncClient, desk: Desk, **body: Any) -> str:
    created = await client.post(
        f"/api/events/{desk.event_id}/checkin-points", json={"name": "Main Hall", **body}, headers=bearer(desk.organizer)
    )
    assert created.status_code == 201, created.text
    point_id: str = created.json()["id"]
    return point_id


async def admit(client: AsyncClient, desk: Desk, ticket_id: str, point_id: str, **extra: Any) -> Any:
    return await client.post(
        f"/api/events/{desk.event_id}/attendees/{ticket_id}/admit",
        json={"checkin_point_id": point_id, **extra}, headers=desk.headers,
    )


async def audit_rows(app: FastAPI, action: str) -> list[AuditEvent]:
    async with app.state.sessionmaker() as session:
        return list(await session.scalars(select(AuditEvent).where(AuditEvent.action == action).order_by(AuditEvent.at)))


# --- QR lookup ------------------------------------------------------------------------------------------------


async def test_a_scanned_badge_finds_its_ticket_however_the_scanner_typed_it(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    url = f"/api/events/{desk.event_id}/attendees/qr-lookup"
    persian_digits = issued["qr_secret"].upper().translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))

    for typed in (issued["qr_secret"], f"  {persian_digits}\n"):
        found = await client.post(url, json={"qr": typed}, headers=desk.headers)
        assert found.status_code == 200, found.text
        assert (found.json()["ticket_id"], found.json()["attendee_name"]) == (issued["ticket_id"], "Dr. Neda Amini")

    missing = await client.post(url, json={"qr": "not-a-badge"}, headers=desk.headers)
    assert missing.status_code == 404 and missing.json()["code"] == "ATTENDEE_QR_NOT_FOUND"
    # The organizer itself can look up too.
    assert (await client.post(url, json={"qr": issued["qr_secret"]}, headers=bearer(desk.organizer))).status_code == 200


async def test_qr_lookup_never_finds_another_congress_s_badge(client: AsyncClient) -> None:
    desk_a = await open_desk(client, name="Congress A")
    desk_b = await open_desk(client, name="Congress B", mobile="09121004401")
    foreign = await walk_in(client, desk_b)

    response = await client.post(
        f"/api/events/{desk_a.event_id}/attendees/qr-lookup", json={"qr": foreign["qr_secret"]}, headers=desk_a.headers
    )

    assert response.status_code == 404 and response.json()["code"] == "ATTENDEE_QR_NOT_FOUND"
    # An operator token for congress A does not open congress B's desk.
    wrong_event = await client.post(
        f"/api/events/{desk_b.event_id}/attendees/qr-lookup", json={"qr": foreign["qr_secret"]}, headers=desk_a.headers
    )
    assert wrong_event.status_code == 403


async def test_a_cancelled_badge_is_found_and_shows_it_is_cancelled(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    cancelled = await client.post(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/cancel", json={"notify": False}, headers=desk.headers
    )
    assert cancelled.status_code == 200, cancelled.text

    found = await client.post(
        f"/api/events/{desk.event_id}/attendees/qr-lookup", json={"qr": issued["qr_secret"]}, headers=desk.headers
    )

    assert found.status_code == 200 and found.json()["status"] == "cancelled"


# --- Admitting at a check-in point ------------------------------------------------------------------------------


async def test_the_desk_lists_the_check_in_points_and_admits_with_the_gate_rules(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    hall = await point(client, desk)

    points = await client.get(f"/api/events/{desk.event_id}/desk/checkin-points", headers=desk.headers)
    assert points.status_code == 200 and [p["id"] for p in points.json()] == [hall]

    first = await admit(client, desk, issued["ticket_id"], hall)
    assert first.status_code == 200, first.text
    verdict = first.json()
    assert (verdict["status"], verdict["rejection_reason"], verdict["checkin_point_name"]) == ("ADMITTED", None, "Main Hall")
    assert verdict["attendee_name"] == "Dr. Neda Amini"

    # Attributed to the operator who pressed the button, in the attendee's history and in the audit log.
    history = (await card(client, desk, issued["ticket_id"]))["scan_history"]
    assert [(h["status"], h["checkin_point_name"], h["recorded_by"]) for h in history] == [("ADMITTED", "Main Hall", "Sara")]
    (row,) = await audit_rows(app, "desk.admitted")
    assert (row.actor_type, row.actor_id, row.entity_id) == ("desk_operator", desk.operator_id, verdict["scan_id"])
    assert row.summary == {"status": "ADMITTED", "rejection_reason": None, "checkin_point_id": hall}


async def test_desk_admission_shows_single_use_tier_and_capacity_refusals(client: AsyncClient) -> None:
    desk = await open_desk(client)
    alice, bob = await walk_in(client, desk, "Alice"), await walk_in(client, desk, "Bob")
    single = await point(client, desk, name="Lunch", policy_type="SINGLE_USE")
    capped = await point(client, desk, name="Workshop", policy_type="CAPACITY_CAPPED", max_capacity=1)
    other_tier = (
        await client.post(f"/api/events/{desk.event_id}/ticket-tiers", json=tier(name="VIP"), headers=bearer(desk.organizer))
    ).json()["id"]
    vip_only = await point(client, desk, name="VIP Lounge", policy_type="TIER_RESTRICTED", allowed_tier_ids=[other_tier])

    assert (await admit(client, desk, alice["ticket_id"], single)).json()["status"] == "ADMITTED"
    again = (await admit(client, desk, alice["ticket_id"], single)).json()
    assert (again["status"], again["rejection_reason"]) == ("REJECTED", "ALREADY_ADMITTED")

    assert (await admit(client, desk, alice["ticket_id"], capped)).json()["status"] == "ADMITTED"
    full = (await admit(client, desk, bob["ticket_id"], capped)).json()
    assert (full["status"], full["rejection_reason"]) == ("REJECTED", "CAPACITY_REACHED")

    lounge = (await admit(client, desk, bob["ticket_id"], vip_only)).json()
    assert (lounge["status"], lounge["rejection_reason"]) == ("REJECTED", "TIER_NOT_ALLOWED")


async def test_a_retried_admission_returns_the_first_verdict_once(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    lunch = await point(client, desk, name="Lunch", policy_type="SINGLE_USE")
    scan_id = str(uuid.uuid4())

    first = (await admit(client, desk, issued["ticket_id"], lunch, scan_id=scan_id)).json()
    retry = await admit(client, desk, issued["ticket_id"], lunch, scan_id=scan_id)

    assert retry.status_code == 200 and retry.json()["status"] == first["status"] == "ADMITTED"
    assert retry.json()["scan_id"] == scan_id
    async with app.state.sessionmaker() as session:
        assert await session.scalar(select(func.count()).select_from(CheckIn)) == 1


async def test_desk_admission_refuses_a_cancelled_ticket_and_another_congress_s_point(client: AsyncClient) -> None:
    desk = await open_desk(client)
    other = await open_desk(client, name="Other Congress", mobile="09121004401")
    issued = await walk_in(client, desk)
    hall, foreign_hall = await point(client, desk), await point(client, other)

    wrong_point = await admit(client, desk, issued["ticket_id"], foreign_hall)
    assert wrong_point.status_code == 404 and wrong_point.json()["code"] == "CHECKIN_POINT_NOT_FOUND"

    await client.post(f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/cancel", json={"notify": False}, headers=desk.headers)
    cancelled = await admit(client, desk, issued["ticket_id"], hall)
    assert cancelled.status_code == 409 and cancelled.json()["code"] == "TICKET_STATE_CONFLICT"

    foreign_ticket = await walk_in(client, other)
    unknown = await admit(client, desk, foreign_ticket["ticket_id"], hall)
    assert unknown.status_code == 404 and unknown.json()["code"] == "PARTICIPANT_NOT_FOUND"


# --- Badge printing ---------------------------------------------------------------------------------------------


async def test_prints_are_counted_and_an_edit_after_printing_needs_a_reprint(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    prints_url = f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/prints"

    before = await card(client, desk, issued["ticket_id"])
    assert (before["print_count"], before["last_printed_at"], before["needs_reprint"]) == (0, None, False)

    first = await client.post(prints_url, headers=desk.headers)
    assert first.status_code == 201, first.text
    assert (first.json()["reason"], first.json()["print_count"], first.json()["printed_by"]) == ("first", 1, "Sara")
    second = (await client.post(prints_url, headers=desk.headers)).json()
    assert (second["reason"], second["print_count"]) == ("reprint", 2)
    printed = await card(client, desk, issued["ticket_id"])
    assert (printed["print_count"], printed["needs_reprint"]) == (2, False) and printed["last_printed_at"]

    edited = await client.patch(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}",
        json={"attendee_title": "Professor"}, headers=desk.headers,
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["title"], edited.json()["needs_reprint"]) == ("Professor", True)

    assert (await client.post(prints_url, headers=desk.headers)).json()["reason"] == "reprint"
    assert (await card(client, desk, issued["ticket_id"]))["needs_reprint"] is False

    # A reissued pass has a new QR code: the printed badge no longer opens the gates.
    reissued = await client.post(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/reissue", json={"notify": False}, headers=desk.headers
    )
    assert reissued.status_code == 200 and reissued.json()["needs_reprint"] is True

    rows = await audit_rows(app, "desk.badge_printed")
    assert [(r.actor_type, r.summary["reason"]) for r in rows] == [
        ("desk_operator", "first"), ("desk_operator", "reprint"), ("desk_operator", "reprint")
    ]


async def test_a_cancelled_ticket_s_badge_is_not_printed(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    await client.post(f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/cancel", json={"notify": False}, headers=desk.headers)

    response = await client.post(f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/prints", headers=desk.headers)

    assert response.status_code == 409 and response.json()["code"] == "TICKET_STATE_CONFLICT"


# --- Registration changes at the desk ----------------------------------------------------------------------------


async def test_the_desk_corrects_a_registration_and_the_operator_is_recorded(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk, mobile="09121004410")

    edited = await client.patch(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}",
        json={"attendee_full_name": "  Dr. Neda Amini-Rad ", "attendee_organization": "Tehran Heart"},
        headers=desk.headers,
    )

    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["attendee_name"], body["organization"], body["title"]) == ("Dr. Neda Amini-Rad", "Tehran Heart", "Cardiologist")
    # The organizer's participant register shows the same registration copy.
    participant = await client.get(
        f"/api/events/{desk.event_id}/participants/{issued['ticket_id']}", headers=bearer(desk.organizer)
    )
    assert participant.json()["attendee_full_name"] == "Dr. Neda Amini-Rad"
    (row,) = await audit_rows(app, "desk.registration_edited")
    assert (row.actor_type, row.actor_id, row.entity_id) == ("desk_operator", desk.operator_id, issued["ticket_id"])
    assert row.summary == {"fields": ["attendee_full_name", "attendee_organization"]}

    blank = await client.patch(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}", json={"attendee_full_name": "  "}, headers=desk.headers
    )
    assert blank.status_code == 422


async def test_the_desk_cancels_reissues_and_transfers_with_the_participant_codes(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    base = f"/api/events/{desk.event_id}/attendees"
    kept = await walk_in(client, desk, "Kept", mobile="09121004411")
    moved = await walk_in(client, desk, "Moved", mobile="09121004412")
    dropped = await walk_in(client, desk, "Dropped", mobile="09121004413")

    reissued = await client.post(f"{base}/{kept['ticket_id']}/reissue", json={"notify": True}, headers=desk.headers)
    assert reissued.status_code == 200, reissued.text
    assert reissued.json()["qr_secret"] != kept["qr_secret"]
    old_pass = await client.post(f"{base}/qr-lookup", json={"qr": kept["qr_secret"]}, headers=desk.headers)
    assert old_pass.status_code == 404

    nameless = await client.post(f"{base}/{moved['ticket_id']}/transfer", json={"mobile": "09121004499"}, headers=desk.headers)
    assert nameless.status_code == 422 and nameless.json()["code"] == "FULL_NAME_REQUIRED"
    transferred = await client.post(
        f"{base}/{moved['ticket_id']}/transfer", json={"mobile": "09121004499", "full_name": "New Holder"}, headers=desk.headers
    )
    assert transferred.status_code == 200, transferred.text
    assert (transferred.json()["attendee_name"], transferred.json()["status"]) == ("New Holder", "active")
    assert transferred.json()["ticket_id"] != moved["ticket_id"]
    assert (await card(client, desk, moved["ticket_id"]))["status"] == "cancelled"

    cancelled = await client.post(
        f"{base}/{dropped['ticket_id']}/cancel", json={"reason": "No show", "notify": True}, headers=desk.headers
    )
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancelled_reason"] == "No show"
    twice = await client.post(f"{base}/{dropped['ticket_id']}/cancel", json={}, headers=desk.headers)
    assert twice.status_code == 409 and twice.json()["code"] == "TICKET_STATE_CONFLICT"
    async with app.state.sessionmaker() as session:
        # Three walk-ins, one transferred (the place moved), one cancelled (released).
        assert await session.scalar(select(TicketTier.reserved_count).where(TicketTier.id == uuid.UUID(desk.tier_id))) == 2
        kinds = list(await session.scalars(select(SmsMessage.kind).order_by(SmsMessage.created_at)))
    assert kinds.count("ticket_reissued") == 1 and kinds.count("ticket_cancelled") == 2

    actions = [(r.action, r.actor_type) for r in await audit_rows(app, "desk.ticket_reissued")]
    actions += [(r.action, r.actor_type) for r in await audit_rows(app, "desk.ticket_transferred")]
    actions += [(r.action, r.actor_type) for r in await audit_rows(app, "desk.ticket_cancelled")]
    assert actions == [
        ("desk.ticket_reissued", "desk_operator"),
        ("desk.ticket_transferred", "desk_operator"),
        ("desk.ticket_cancelled", "desk_operator"),
    ]


async def test_desk_changes_stay_inside_the_operator_s_congress(client: AsyncClient) -> None:
    desk = await open_desk(client)
    other = await open_desk(client, name="Other Congress", mobile="09121004401")
    foreign = await walk_in(client, other)

    for method, suffix, body in (
        ("PATCH", "", {"attendee_title": "X"}),
        ("POST", "/cancel", {}),
        ("POST", "/reissue", {}),
        ("POST", "/transfer", {"mobile": "09121004498", "full_name": "Y"}),
        ("POST", "/prints", None),
    ):
        # Through the operator's own congress: the ticket is not there.
        own = await client.request(
            method, f"/api/events/{desk.event_id}/attendees/{foreign['ticket_id']}{suffix}", json=body, headers=desk.headers
        )
        assert own.status_code == 404, (suffix, own.text)
        assert own.json()["code"] == "PARTICIPANT_NOT_FOUND"
        # Through the other congress: the operator's token is not valid there.
        cross = await client.request(
            method, f"/api/events/{other.event_id}/attendees/{foreign['ticket_id']}{suffix}", json=body, headers=desk.headers
        )
        assert cross.status_code == 403, (suffix, cross.text)
    assert (await card(client, other, foreign["ticket_id"]))["status"] == "active"


async def test_a_revoked_operator_cannot_change_registrations(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    await client.post(f"/api/events/{desk.event_id}/desk/operators/{desk.operator_id}/revoke", headers=bearer(desk.organizer))

    response = await client.patch(
        f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}", json={"attendee_title": "X"}, headers=desk.headers
    )

    assert response.status_code == 401


async def test_desk_roles_staff_runs_the_desk_and_a_viewer_does_not(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk)
    hall = await point(client, desk)
    staff = await member_session(client, desk.organizer, "09121004420", "staff")
    viewer = await member_session(client, desk.organizer, "09121004421", "viewer")
    url = f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/admit"

    assert (await client.post(url, json={"checkin_point_id": hall}, headers=staff)).status_code == 200
    refused = await client.post(url, json={"checkin_point_id": hall}, headers=viewer)
    assert refused.status_code == 403 and refused.json()["code"] == "ROLE_FORBIDDEN"
    history = (await card(client, desk, issued["ticket_id"]))["scan_history"]
    assert history[0]["recorded_by"] == "Staff Person"


# --- Walk-in after a cancellation ---------------------------------------------------------------------------------


async def test_a_walk_in_for_a_cancelled_registration_reactivates_it(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    first = await walk_in(client, desk, mobile="09121004430")
    await client.post(f"/api/events/{desk.event_id}/attendees/{first['ticket_id']}/cancel", json={"notify": False}, headers=desk.headers)

    again = await client.post(
        f"/api/events/{desk.event_id}/desk-registrations",
        json={"full_name": "Dr. Neda Amini", "mobile": "09121004430", "ticket_tier_id": desk.tier_id},
        headers=desk.headers,
    )

    assert again.status_code == 201, again.text
    body = again.json()
    assert (body["ticket_id"], body["reactivated"]) == (first["ticket_id"], True)
    assert body["qr_secret"] != first["qr_secret"]
    assert (await card(client, desk, first["ticket_id"]))["status"] == "active"
    async with app.state.sessionmaker() as session:
        assert await session.scalar(select(TicketTier.reserved_count).where(TicketTier.id == uuid.UUID(desk.tier_id))) == 1
        confirmations = await session.scalar(
            select(func.count()).select_from(SmsMessage).where(SmsMessage.mobile == "09121004430", SmsMessage.kind == "ticket_confirmation")
        )
    # The first registration's confirmation and the reactivated pass's.
    assert confirmations == 2

    still_active = await client.post(
        f"/api/events/{desk.event_id}/desk-registrations",
        json={"full_name": "Dr. Neda Amini", "mobile": "09121004430", "ticket_tier_id": desk.tier_id},
        headers=desk.headers,
    )
    assert still_active.status_code == 409 and still_active.json()["code"] == "ALREADY_REGISTERED"


async def test_reactivation_respects_a_sold_out_tier(client: AsyncClient) -> None:
    desk = await open_desk(client)
    tiny = (
        await client.post(f"/api/events/{desk.event_id}/ticket-tiers", json=tier(name="Tiny", quota=1), headers=bearer(desk.organizer))
    ).json()["id"]
    first = await walk_in(client, desk, mobile="09121004431")
    await client.post(f"/api/events/{desk.event_id}/attendees/{first['ticket_id']}/cancel", json={"notify": False}, headers=desk.headers)
    await walk_in(client, desk, "Someone Else", ticket_tier_id=tiny)

    again = await client.post(
        f"/api/events/{desk.event_id}/desk-registrations",
        json={"full_name": "Dr. Neda Amini", "mobile": "09121004431", "ticket_tier_id": tiny},
        headers=desk.headers,
    )

    assert again.status_code == 410
    assert (await card(client, desk, first["ticket_id"]))["status"] == "cancelled"


# --- Operators ------------------------------------------------------------------------------------------------------


async def invites(app: FastAPI, mobile: str) -> list[SmsMessage]:
    async with app.state.sessionmaker() as session:
        query = select(SmsMessage).where(SmsMessage.kind == "operator_invite", SmsMessage.mobile == mobile)
        return list(await session.scalars(query.order_by(SmsMessage.created_at)))


async def test_adding_an_operator_texts_them_the_reception_link(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)

    (invite,) = await invites(app, OPERATOR_MOBILE)

    assert invite.status == "pending" and str(invite.event_id) == desk.event_id
    assert invite.body is not None
    assert f"http://test/reception/{desk.event_id}" in invite.body and "Sara" in invite.body


async def test_a_revoked_operator_is_restored_explicitly(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    base = f"/api/events/{desk.event_id}/desk/operators/{desk.operator_id}"

    not_revoked = await client.post(f"{base}/restore", headers=bearer(desk.organizer))
    assert not_revoked.status_code == 409 and not_revoked.json()["code"] == "OPERATOR_NOT_REVOKED"

    await client.post(f"{base}/revoke", headers=bearer(desk.organizer))
    restored = await client.post(f"{base}/restore", headers=bearer(desk.organizer))

    assert restored.status_code == 200, restored.text
    assert (restored.json()["is_revoked"], restored.json()["revoked_at"]) == (False, None)
    # The session from before the revocation stays dead; a fresh sign-in works.
    assert (await client.get(f"/api/events/{desk.event_id}/desk/me", headers=desk.headers)).status_code == 401
    assert (await desk_sign_in(client, desk.event_id, OPERATOR_MOBILE)).status_code == 200
    assert len(await invites(app, OPERATOR_MOBILE)) == 2
    (row,) = await audit_rows(app, "desk.operator_restored")
    assert row.entity_id == desk.operator_id


async def test_restore_is_scoped_to_the_organizer_s_own_congress(client: AsyncClient) -> None:
    desk = await open_desk(client)
    other = await open_desk(client, name="Other Congress", mobile="09121004401")
    await client.post(f"/api/events/{other.event_id}/desk/operators/{other.operator_id}/revoke", headers=bearer(other.organizer))

    through_own = await client.post(
        f"/api/events/{desk.event_id}/desk/operators/{other.operator_id}/restore", headers=bearer(desk.organizer)
    )
    through_other = await client.post(
        f"/api/events/{other.event_id}/desk/operators/{other.operator_id}/restore", headers=bearer(desk.organizer)
    )

    assert through_own.status_code == 404 and through_own.json()["code"] == "OPERATOR_NOT_FOUND"
    assert through_other.status_code == 404


# --- Pass resend ------------------------------------------------------------------------------------------------------


async def test_the_pass_resend_holds_no_database_connection_while_sms_ir_answers(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk, mobile="09121004440")
    gateway: SmsGateway = app.state.sms
    engine = app.state.sessionmaker.kw["bind"]
    seen: list[int] = []
    send = gateway.recorder.send_text

    async def watching(mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        seen.append(engine.pool.checkedout())
        return await send(mobile, text, kind=kind, code=code)

    gateway.recorder.send_text = watching  # type: ignore[method-assign]
    response = await client.post(f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/resend-sms", headers=desk.headers)

    assert response.status_code == 200 and response.json()["status"] == "sent"
    assert seen == [0]
    async with app.state.sessionmaker() as session:
        logged = await session.scalar(select(SmsMessage).where(SmsMessage.kind == "ticket_resend"))
    assert logged is not None and logged.status == "sent"


# --- Hardening (integration audit) ------------------------------------------------------------------------------


async def test_desk_search_folds_persian_letters_and_matches_wildcards_literally(client: AsyncClient) -> None:
    desk = await open_desk(client)
    persian = await walk_in(client, desk, "علی کریمی", organization="بیمارستان")
    await walk_in(client, desk, "Other Person", organization="Clinic")
    url = f"/api/events/{desk.event_id}/attendees"

    # An Arabic keyboard types ي and ك where a Persian one types ی and ک.
    arabic = await client.get(url, params={"q": "كريمي"}, headers=desk.headers)
    assert [a["ticket_id"] for a in arabic.json()] == [persian["ticket_id"]]
    # % and _ are literal characters, not wildcards.
    assert (await client.get(url, params={"q": "%"}, headers=desk.headers)).json() == []
    assert (await client.get(url, params={"q": "_"}, headers=desk.headers)).json() == []
    assert (await client.get(url, params={"q": "x" * 201}, headers=desk.headers)).status_code == 422


async def test_an_archived_congress_s_desk_reads_but_refuses_changes(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk, mobile="09121004452")
    hall = await point(client, desk)
    archived = await client.post(
        f"/api/events/{desk.event_id}/archive", json={"archived": True}, headers=bearer(desk.organizer)
    )
    assert archived.status_code == 200, archived.text
    base = f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}"

    me = await client.get(f"/api/events/{desk.event_id}/desk/me", headers=desk.headers)
    assert me.status_code == 200 and me.json()["is_archived"] is True
    assert (await client.get(base, headers=desk.headers)).status_code == 200
    for method, path, body in (
        ("POST", f"/api/events/{desk.event_id}/desk-registrations", {"full_name": "Late", "ticket_tier_id": desk.tier_id}),
        ("PATCH", base, {"attendee_title": "X"}),
        ("POST", f"{base}/cancel", {}),
        ("POST", f"{base}/reissue", {}),
        ("POST", f"{base}/transfer", {"mobile": "09121004497", "full_name": "Y"}),
        ("POST", f"{base}/admit", {"checkin_point_id": hall}),
        ("POST", f"{base}/prints", None),
        ("POST", f"{base}/resend-sms", None),
    ):
        response = await client.request(method, path, json=body, headers=desk.headers)
        assert response.status_code == 409, (path, response.text)
        assert response.json()["code"] == "EVENT_ARCHIVED"


async def test_desk_notices_have_a_per_ticket_sms_budget(client: AsyncClient, app: FastAPI) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk, mobile="09121004450")
    url = f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/reissue"

    statuses = [(await client.post(url, json={"notify": True}, headers=desk.headers)).status_code for _ in range(6)]

    assert statuses == [200] * 5 + [429]
    refused = await client.post(url, json={"notify": True}, headers=desk.headers)
    assert refused.json()["code"] == "DESK_SMS_RATE_LIMITED"
    # Without an SMS the change still goes through.
    assert (await client.post(url, json={"notify": False}, headers=desk.headers)).status_code == 200
    async with app.state.sessionmaker() as session:
        assert await session.scalar(
            select(func.count()).select_from(SmsMessage).where(SmsMessage.kind == "ticket_reissued")
        ) == 5


async def test_the_resend_cooldown_holds_under_concurrent_clicks(client: AsyncClient) -> None:
    desk = await open_desk(client)
    issued = await walk_in(client, desk, mobile="09121004451")
    url = f"/api/events/{desk.event_id}/attendees/{issued['ticket_id']}/resend-sms"

    responses = await asyncio.gather(*(client.post(url, headers=desk.headers) for _ in range(4)))

    assert sorted(r.status_code for r in responses) == [200, 429, 429, 429]
    assert next(r for r in responses if r.status_code == 429).json()["code"] == "PASS_SMS_RATE_LIMITED"


async def test_walk_in_tier_refusals_carry_the_reservation_codes(client: AsyncClient) -> None:
    desk = await open_desk(client)
    closed = (
        await client.post(
            f"/api/events/{desk.event_id}/ticket-tiers", json=tier(name="Closed", is_open=False), headers=bearer(desk.organizer)
        )
    ).json()["id"]
    tiny = (
        await client.post(f"/api/events/{desk.event_id}/ticket-tiers", json=tier(name="Tiny", quota=1), headers=bearer(desk.organizer))
    ).json()["id"]
    await walk_in(client, desk, "First", ticket_tier_id=tiny)
    url = f"/api/events/{desk.event_id}/desk-registrations"

    shut = await client.post(url, json={"full_name": "A", "ticket_tier_id": closed}, headers=desk.headers)
    full = await client.post(url, json={"full_name": "B", "ticket_tier_id": tiny}, headers=desk.headers)
    unknown = await client.post(url, json={"full_name": "C", "ticket_tier_id": str(uuid.uuid4())}, headers=desk.headers)

    assert (shut.status_code, shut.json()["code"]) == (400, "TIER_CLOSED")
    assert (full.status_code, full.json()["code"]) == (410, "TIER_SOLD_OUT")
    assert (unknown.status_code, unknown.json()["code"]) == (404, "TIER_NOT_FOUND")


def test_print_and_desk_check_in_rows_go_with_their_ticket_event_and_check_in() -> None:
    def ondelete(table: Any, column: str) -> str | None:
        (key,) = [fk for fk in table.foreign_keys if fk.parent.name == column]
        result: str | None = key.ondelete
        return result

    assert ondelete(TicketPrint.__table__, "ticket_id") == "CASCADE"
    assert ondelete(TicketPrint.__table__, "event_id") == "CASCADE"
    assert ondelete(DeskCheckIn.__table__, "checkin_id") == "CASCADE"
    assert ondelete(DeskCheckIn.__table__, "desk_operator_id") == "SET NULL"
