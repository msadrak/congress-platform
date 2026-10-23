"""Attendee self-service: profile edits, self-cancellation, data export, account deletion, exhibitor consent."""

from fastapi import FastAPI
from httpx import AsyncClient

from app.sms.outbox import deliver_due
from tests.helpers import bearer, sign_in, sms_code
from tests.test_participants import auth, congress, register, reschedule, reserved_count

PAST = {"starts_at": "2025-03-01T08:00:00Z", "ends_at": "2025-03-02T18:00:00Z"}
ONGOING = {"starts_at": "2026-01-01T08:00:00Z", "ends_at": "2030-01-01T18:00:00Z"}


async def test_attendee_cancels_their_own_ticket_until_the_congress_starts(app: FastAPI, client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09122220001", "Self Cancel")
    _, started_event, started_tier = await congress(client, organizer, **ONGOING)
    started = await client.post(
        f"/api/events/{started_event}/tickets/reserve", json={"ticket_tier_id": started_tier}, headers=auth(token)
    )
    _, stranger_token = await sign_in(client, "09122220002", "Stranger")

    foreign = await client.post(f"/api/attendees/me/tickets/{ticket['id']}/cancel", headers=auth(stranger_token))
    too_late = await client.post(f"/api/attendees/me/tickets/{started.json()['id']}/cancel", headers=auth(token))
    resp = await client.post(f"/api/attendees/me/tickets/{ticket['id']}/cancel", headers=auth(token))
    again = await client.post(f"/api/attendees/me/tickets/{ticket['id']}/cancel", headers=auth(token))

    assert foreign.status_code == 404
    assert too_late.status_code == 409
    assert resp.status_code == 200, resp.text
    assert (resp.json()["status"], resp.json()["qr_secret"]) == ("cancelled", "")
    assert again.status_code == 409
    assert await reserved_count(app, tier_id) == 0
    detail = (await client.get(f"/api/events/{event_id}/participants/{ticket['id']}", headers=bearer(organizer))).json()
    assert detail["cancelled_by"] == "attendee"


async def test_profile_update_refreshes_only_upcoming_registrations(client: AsyncClient) -> None:
    organizer, upcoming, upcoming_tier = await congress(client)
    _, past, past_tier = await congress(client, organizer)
    token, _ = await register(client, upcoming, upcoming_tier, "09122220011", "Old Name", "Old Org", "Dr")
    await client.post(f"/api/events/{past}/tickets/reserve", json={"ticket_tier_id": past_tier}, headers=auth(token))
    await reschedule(client, organizer, past, **PAST)

    resp = await client.patch(
        "/api/auth/me",
        json={"full_name": "New Name", "organization": "New Org", "share_contact_with_exhibitors": True},
        headers=auth(token),
    )

    assert resp.status_code == 200, resp.text
    me = resp.json()
    assert (me["full_name"], me["organization"], me["title"], me["share_contact_with_exhibitors"]) == (
        "New Name", "New Org", "Dr", True,
    )
    names = {t["event_id"]: t["attendee_name"] for t in (await client.get("/api/attendees/me/tickets", headers=auth(token))).json()}
    assert names == {upcoming: "New Name", past: "Old Name"}
    registered = (await client.get(f"/api/events/{upcoming}/participants", headers=bearer(organizer))).json()["items"][0]
    assert registered["attendee_organization"] == "New Org"
    assert (await client.patch("/api/auth/me", json={"full_name": " "}, headers=auth(token))).status_code == 422
    # Consent alone leaves registration details untouched.
    await client.patch(
        f"/api/events/{upcoming}/participants/{registered['ticket_id']}",
        json={"attendee_full_name": "Organizer Fix"},
        headers=bearer(organizer),
    )
    await client.patch("/api/auth/me", json={"share_contact_with_exhibitors": False}, headers=auth(token))
    names = {t["event_id"]: t["attendee_name"] for t in (await client.get("/api/attendees/me/tickets", headers=auth(token))).json()}
    assert names[upcoming] == "Organizer Fix"


async def test_export_contains_the_persons_own_data(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09122220021", "Export Me", "Org", "Prof")
    _, peer = await register(client, event_id, tier_id, "09122220022", "Peer Person")
    await client.post(
        "/api/attendees/me/network/scan",
        json={"qr_secret": peer["qr_secret"], "private_notes": "met at lunch"},
        headers=auth(token),
    )

    resp = await client.get("/api/auth/me/export", headers=auth(token))

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["profile"]["mobile"] == "09122220021" and data["profile"]["full_name"] == "Export Me"
    (exported,) = data["tickets"]
    assert (exported["ticket_id"], exported["status"], exported["attendee_title"]) == (ticket["id"], "active", "Prof")
    (connection,) = data["connections"]
    assert (connection["full_name"], connection["private_notes"]) == ("Peer Person", "met at lunch")
    assert "mobile" not in connection
    assert data["exhibitor_leads"] == [] and data["booth_bookmarks"] == []
    assert all(m["body"] is None for m in data["sms_messages"] if m["kind"] == "otp")
    assert (await client.get("/api/auth/me/export")).status_code == 401


async def test_deleting_the_account_anonymises_it_and_keeps_statistics(app: FastAPI, client: AsyncClient) -> None:
    organizer, upcoming, upcoming_tier = await congress(client)
    _, past, past_tier = await congress(client, organizer)
    token, ticket = await register(client, upcoming, upcoming_tier, "09122220031", "Leaving Person", "Org", "Dr")
    past_ticket = (
        await client.post(f"/api/events/{past}/tickets/reserve", json={"ticket_tier_id": past_tier}, headers=auth(token))
    ).json()
    await reschedule(client, organizer, past, **PAST)
    _, peer = await register(client, upcoming, upcoming_tier, "09122220032", "Peer")
    await client.post("/api/attendees/me/network/scan", json={"qr_secret": peer["qr_secret"]}, headers=auth(token))
    await deliver_due(app.state.sessionmaker, app.state.sms)

    resp = await client.delete("/api/auth/me", headers=auth(token))

    assert resp.status_code == 204
    assert (await client.get("/api/auth/me", headers=auth(token))).status_code == 401
    upcoming_row = (await client.get(f"/api/events/{upcoming}/participants/{ticket['id']}", headers=bearer(organizer))).json()
    assert (upcoming_row["status"], upcoming_row["cancelled_by"]) == ("cancelled", "account_deleted")
    assert (upcoming_row["attendee_full_name"], upcoming_row["attendee_organization"], upcoming_row["mobile"]) == (
        "حذف‌شده", "", None,
    )
    assert upcoming_row["account_deleted"] is True
    assert await reserved_count(app, upcoming_tier) == 1  # only the peer's place remains taken
    past_row = (await client.get(f"/api/events/{past}/participants/{past_ticket['id']}", headers=bearer(organizer))).json()
    assert (past_row["status"], past_row["attendee_full_name"]) == ("active", "حذف‌شده")
    # The number is free again: signing in starts a new account.
    code_request = await client.post("/api/auth/otp/request", json={"mobile": "09122220031"})
    assert code_request.status_code == 202
    verified = await client.post(
        "/api/auth/otp/verify", json={"mobile": "09122220031", "code": await sms_code(client, "09122220031")}
    )
    assert verified.json()["status"] == "profile_required"


async def test_lead_mobile_is_shared_only_with_consent(client: AsyncClient) -> None:
    organizer, event_id, tier_id = await congress(client)
    token, ticket = await register(client, event_id, tier_id, "09122220041", "Lead Subject")
    booth = (
        await client.post(f"/api/events/{event_id}/booths", json={"name": "B", "slug": "b"}, headers=bearer(organizer))
    ).json()
    _, staff = await sign_in(client, "09122220042", "Staff")
    await client.post(f"/api/events/{event_id}/booths/{booth['id']}/staff", json={"mobile": "09122220042"}, headers=bearer(organizer))
    leads = f"/api/booths/{booth['id']}/leads"

    scanned = await client.post(f"{leads}/scan", json={"qr_secret": ticket["qr_secret"]}, headers=auth(staff))
    csv_without = (await client.get(f"{leads}/export-csv", headers=auth(staff))).text
    await client.patch("/api/auth/me", json={"share_contact_with_exhibitors": True}, headers=auth(token))
    listed = (await client.get(leads, headers=auth(staff))).json()
    csv_with = (await client.get(f"{leads}/export-csv", headers=auth(staff))).text

    assert scanned.json()["attendee_mobile"] is None
    assert "09122220041" not in csv_without
    assert listed[0]["attendee_mobile"] == "09122220041"
    assert "09122220041" in csv_with


async def test_new_accounts_do_not_share_contact_with_exhibitors(client: AsyncClient) -> None:
    user, _ = await sign_in(client, "09122220051", "Fresh")
    assert user["share_contact_with_exhibitors"] is False
