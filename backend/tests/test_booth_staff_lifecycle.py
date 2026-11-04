"""Booth staff lifecycle: an invite SMS on assignment, and removal that ends portal access but keeps the leads."""

import uuid

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import Lead, SmsMessage, User
from app.sms.outbox import deliver_due
from app.sms.templates import KINDS
from tests.exhibitors import STAFF_MOBILE, setup_congress
from tests.helpers import bearer, provision_organizer
from tests.test_booths import BOOTH_PAYLOAD
from tests.test_tickets import register_user


async def test_assigning_a_representative_queues_an_invite_sms_with_the_portal_link(
    app: FastAPI, client: AsyncClient
) -> None:
    congress = await setup_congress(client)

    async with app.state.sessionmaker() as session:
        invites = list(await session.scalars(select(SmsMessage).where(SmsMessage.kind == "staff_invite")))
    assert len(invites) == 1
    invite = invites[0]
    assert (invite.mobile, invite.status, str(invite.event_id)) == (STAFF_MOBILE, "pending", congress.event_id)
    assert invite.body is not None
    assert f"http://test/booth/{congress.booth_id}" in invite.body
    assert congress.booth["name"] in invite.body

    await deliver_due(app.state.sessionmaker, app.state.sms)
    delivered = app.state.sms.recorder.sent_to(STAFF_MOBILE)[-1]
    assert delivered.kind == "staff_invite"
    assert delivered.text == invite.body

    # Assigning the same representative again is idempotent and sends nothing new.
    again = await client.post(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff",
        json={"mobile": STAFF_MOBILE},
        headers=bearer(congress.organizer),
    )
    assert again.status_code == 201
    assert again.json()["id"] == congress.staff_assignment["id"]
    async with app.state.sessionmaker() as session:
        count = len(list(await session.scalars(select(SmsMessage.id).where(SmsMessage.kind == "staff_invite"))))
    assert count == 1


async def test_staff_invite_wording_is_a_platform_template_with_the_link_required(client: AsyncClient) -> None:
    spec = KINDS["staff_invite"]
    assert "link" in spec.required
    assert "{link}" in spec.default and "{booth}" in spec.default
    refused = await client.put(
        "/api/platform/sms-templates/staff_invite",
        json={"body": "You were added to a booth"},
        headers={"X-Admin-Token": "test-admin-token"},
    )
    assert refused.status_code == 422


async def test_removed_representative_loses_the_portal_and_their_leads_stay(app: FastAPI, client: AsyncClient) -> None:
    congress = await setup_congress(client)
    captured = await client.post(
        f"/api/booths/{congress.booth_id}/leads/scan",
        json={"qr_secret": congress.ticket["qr_secret"], "rating": "HOT"},
        headers=congress.staff,
    )
    assert captured.status_code == 201, captured.text
    staff_id = congress.staff_assignment["id"]

    removed = await client.delete(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff/{staff_id}",
        headers=bearer(congress.organizer),
    )

    assert removed.status_code == 204, removed.text
    listed = await client.get(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff", headers=bearer(congress.organizer)
    )
    assert listed.json() == []
    portal = await client.get(f"/api/booths/{congress.booth_id}", headers=congress.staff)
    assert portal.status_code == 403
    assert portal.json()["code"] == "BOOTH_STAFF_REQUIRED"
    for method, path, payload in (
        ("GET", f"/api/booths/{congress.booth_id}/leads", None),
        ("GET", f"/api/booths/{congress.booth_id}/leads/search", None),
        ("GET", f"/api/booths/{congress.booth_id}/leads/export-csv", None),
        ("POST", f"/api/booths/{congress.booth_id}/leads/scan", {"qr_secret": congress.ticket["qr_secret"]}),
    ):
        refused = await client.request(method, path, json=payload, headers=congress.staff)
        assert refused.status_code == 403, (path, refused.text)
        assert refused.json()["code"] == "BOOTH_STAFF_REQUIRED"
    assert (await client.get("/api/booths/me", headers=congress.staff)).json() == []
    access = (await client.get("/api/me/access", headers=congress.staff)).json()
    assert all(congress.booth_id not in e["booth_ids"] for e in access["events"])

    # The lead is kept and still attributed to the representative who captured it.
    async with app.state.sessionmaker() as session:
        lead = await session.get(Lead, uuid.UUID(captured.json()["id"]))
        rep = await session.scalar(select(User).where(User.mobile == STAFF_MOBILE))
    assert lead is not None and rep is not None
    assert lead.captured_by_user_id == rep.id

    # A colleague still at the booth sees it.
    _, colleague_token = await register_user(client, "09121000809", "Colleague")
    await client.post(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff",
        json={"mobile": "09121000809"},
        headers=bearer(congress.organizer),
    )
    leads = await client.get(
        f"/api/booths/{congress.booth_id}/leads", headers={"Authorization": f"Bearer {colleague_token}"}
    )
    assert [lead["id"] for lead in leads.json()] == [captured.json()["id"]]

    again = await client.delete(
        f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff/{staff_id}",
        headers=bearer(congress.organizer),
    )
    assert again.status_code == 404
    assert again.json()["code"] == "BOOTH_STAFF_NOT_FOUND"


async def test_only_the_owning_organizer_removes_staff_of_that_booth(client: AsyncClient) -> None:
    congress = await setup_congress(client)
    intruder = await provision_organizer(client, "Intruder Co")
    staff_id = congress.staff_assignment["id"]
    path = f"/api/events/{congress.event_id}/booths/{congress.booth_id}/staff/{staff_id}"

    assert (await client.delete(path, headers=bearer(intruder))).status_code in (403, 404)
    other_booth = await client.post(
        f"/api/events/{congress.event_id}/booths",
        json={**BOOTH_PAYLOAD, "slug": "other-booth"},
        headers=bearer(congress.organizer),
    )
    assert other_booth.status_code == 201, other_booth.text
    wrong_booth = await client.delete(
        f"/api/events/{congress.event_id}/booths/{other_booth.json()['id']}/staff/{staff_id}",
        headers=bearer(congress.organizer),
    )
    assert wrong_booth.status_code == 404
    assert (await client.get(f"/api/booths/{congress.booth_id}", headers=congress.staff)).status_code == 200
