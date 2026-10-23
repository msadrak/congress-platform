"""Organizer members: SMS sign-in, choosing an organizer, sessions that end, and owner rules (ADR 0016)."""

import asyncio
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from app.models import RateLimitCounter, SmsMessage
from app.sms.gateway import SmsGateway
from app.sms.provider import SmsResult
from tests.conftest import ADMIN_TOKEN
from tests.helpers import bearer, desk_sign_in, provision_organizer, request_code, sign_in
from tests.test_roles import member_session
from tests.test_ticket_tiers import create_event

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


async def add_member(client: AsyncClient, organizer: dict[str, str], mobile: str, role: str = "owner") -> dict[str, Any]:
    added = await client.post(
        f"/api/organizers/{organizer['id']}/members",
        json={"mobile": mobile, "display_name": "Neda Karimi", "role": role},
        headers=ADMIN,
    )
    assert added.status_code == 201, added.text
    body: dict[str, Any] = added.json()
    return body


async def test_the_platform_adds_an_owner_who_signs_in_by_sms_and_sees_their_session(
    client: AsyncClient, app: FastAPI
) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    member = await add_member(client, organizer, "09121008001")

    assert member["role"] == "owner" and member["invited_by"] == "Platform admin"
    async with app.state.sessionmaker() as session:
        invite = await session.scalar(select(SmsMessage).where(SmsMessage.kind == "member_invite"))
    assert invite is not None and invite.status == "pending" and invite.mobile == "09121008001"
    assert invite.body is not None and "Acme Congress Co" in invite.body and "/organizer" in invite.body

    auth = await member_session_for(client, "09121008001")
    me = await client.get("/api/organizer/me", headers=auth)
    assert me.status_code == 200
    assert me.json()["kind"] == "member" and me.json()["role"] == "owner"
    assert me.json()["organizer"] == {"id": organizer["id"], "name": "Acme Congress Co"}
    assert me.json()["member"]["mobile"] == "09121008001"
    by_key = (await client.get("/api/organizer/me", headers=bearer(organizer))).json()
    assert (by_key["kind"], by_key["role"], by_key["member"]) == ("key", "owner", None)


async def member_session_for(client: AsyncClient, mobile: str) -> dict[str, str]:
    code = await request_code(client, mobile, "organizer")
    login = await client.post("/api/organizer/login", json={"mobile": mobile, "code": code})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_organizer_codes_go_only_to_members(client: AsyncClient) -> None:
    response = await client.post("/api/auth/otp/request", json={"mobile": "09121008002", "purpose": "organizer"})
    outbox = await client.get("/api/platform/sms-outbox", params={"mobile": "09121008002"}, headers=ADMIN)

    assert response.status_code == 202
    assert outbox.json() == []
    refused = await client.post("/api/organizer/login", json={"mobile": "09121008002", "code": "123456"})
    assert refused.status_code == 401


async def test_organizer_codes_have_their_own_budget_and_may_still_arrive(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await add_member(client, organizer, "09121008006")
    await add_member(client, organizer, "09121008008", "viewer")

    member = await client.post("/api/auth/otp/request", json={"mobile": "09121008008", "purpose": "organizer"})
    stranger = await client.post("/api/auth/otp/request", json={"mobile": "09121008007", "purpose": "organizer"})
    # A member and a stranger get the same answer: the form cannot tell who is a member.
    assert member.status_code == stranger.status_code == 202
    assert {**member.json(), "mobile": None} == {**stranger.json(), "mobile": None}

    gateway: SmsGateway = app.state.sms
    gateway.recorder.queued_results.append(SmsResult(ok=False, error="TIMEOUT", unknown=True))
    timed_out = await client.post("/api/auth/otp/request", json={"mobile": "09121008006", "purpose": "organizer"})
    assert timed_out.status_code == 202 and timed_out.json()["delivery"] == "uncertain"
    # The organizer purpose spends its own per-number budget, not the attendee sign-in one.
    signin = await client.post("/api/auth/otp/request", json={"mobile": "09121008006"})
    assert signin.status_code == 202
    async with app.state.sessionmaker() as session:
        keys = set(await session.scalars(select(RateLimitCounter.key).where(RateLimitCounter.key.like("otp:send:%"))))
    assert {"otp:send:organizer:09121008006", "otp:send:signin:09121008006"} <= keys


async def test_an_attendee_sign_in_code_does_not_open_the_console(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await add_member(client, organizer, "09121008003")
    code = await request_code(client, "09121008003", "signin")

    refused = await client.post("/api/organizer/login", json={"mobile": "09121008003", "code": code})

    assert refused.status_code == 401


async def test_a_member_of_several_organizers_chooses_one(client: AsyncClient) -> None:
    first = await provision_organizer(client, "Acme Congress Co")
    second = await provision_organizer(client, "Beta Events")
    await add_member(client, first, "09121008004", "viewer")
    await add_member(client, second, "09121008004", "manager")
    code = await request_code(client, "09121008004", "organizer")

    login = (await client.post("/api/organizer/login", json={"mobile": "09121008004", "code": code})).json()

    assert login["status"] == "choose_organizer" and login["access_token"] is None
    assert [(c["organizer"]["name"], c["role"]) for c in login["organizers"]] == [
        ("Acme Congress Co", "viewer"), ("Beta Events", "manager"),
    ]
    chosen = await client.post(
        "/api/organizer/session", json={"selection_token": login["selection_token"], "organizer_id": second["id"]}
    )
    assert chosen.status_code == 200
    assert chosen.json()["session"]["organizer"]["name"] == "Beta Events"
    assert chosen.json()["session"]["role"] == "manager"
    stranger = await provision_organizer(client, "Gamma")
    not_mine = await client.post(
        "/api/organizer/session", json={"selection_token": login["selection_token"], "organizer_id": stranger["id"]}
    )
    assert not_mine.status_code == 403 and not_mine.json()["code"] == "NOT_A_MEMBER"
    # Like the signup token, a selection token opens one session only.
    reused = await client.post(
        "/api/organizer/session", json={"selection_token": login["selection_token"], "organizer_id": second["id"]}
    )
    assert reused.status_code == 401 and reused.json()["code"] == "SIGN_IN_EXPIRED"
    forged = await client.post(
        "/api/organizer/session", json={"selection_token": chosen.json()["access_token"], "organizer_id": second["id"]}
    )
    assert forged.status_code == 401 and forged.json()["code"] == "SIGN_IN_EXPIRED"


async def test_sign_out_role_change_and_removal_end_member_sessions(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await add_member(client, organizer, "09121008010")
    owner = await member_session_for(client, "09121008010")
    invited = await client.post(
        "/api/organizer/members", json={"mobile": "09121008011", "display_name": "Ali", "role": "manager"}, headers=owner
    )
    assert invited.status_code == 201 and invited.json()["invited_by"] == "Neda Karimi"
    member_id = invited.json()["id"]

    manager = await member_session_for(client, "09121008011")
    assert (await client.get("/api/events", headers=manager)).status_code == 200
    assert (await client.post("/api/organizer/logout", headers=manager)).status_code == 204
    assert (await client.get("/api/events", headers=manager)).status_code == 401

    manager = await member_session_for(client, "09121008011")
    changed = await client.patch(f"/api/organizer/members/{member_id}", json={"role": "viewer"}, headers=owner)
    assert changed.status_code == 200 and changed.json()["role"] == "viewer"
    assert (await client.get("/api/events", headers=manager)).status_code == 401
    viewer = await member_session_for(client, "09121008011")
    assert (await client.get("/api/organizer/me", headers=viewer)).json()["role"] == "viewer"

    removed = await client.post(f"/api/organizer/members/{member_id}/revoke", headers=owner)
    assert removed.status_code == 200 and removed.json()["revoked_at"] is not None
    assert (await client.get("/api/events", headers=viewer)).status_code == 401
    outbox_before = len((await client.get("/api/platform/sms-outbox", params={"mobile": "09121008011"}, headers=ADMIN)).json())
    await client.post("/api/auth/otp/request", json={"mobile": "09121008011", "purpose": "organizer"})
    outbox_after = len((await client.get("/api/platform/sms-outbox", params={"mobile": "09121008011"}, headers=ADMIN)).json())
    assert outbox_after == outbox_before  # no code for a removed member

    again = await client.post(
        "/api/organizer/members", json={"mobile": "09121008011", "display_name": "Ali R.", "role": "staff"}, headers=owner
    )
    assert again.status_code == 201 and again.json()["id"] == member_id and again.json()["revoked_at"] is None
    duplicate = await client.post(
        "/api/organizer/members", json={"mobile": "09121008011", "display_name": "Ali", "role": "staff"}, headers=owner
    )
    assert duplicate.status_code == 409 and duplicate.json()["code"] == "MEMBER_EXISTS"


async def test_the_last_owner_cannot_be_removed_or_demoted(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    owner_id = (await add_member(client, organizer, "09121008020"))["id"]

    demote = await client.patch(f"/api/organizer/members/{owner_id}", json={"role": "manager"}, headers=bearer(organizer))
    remove = await client.post(f"/api/organizer/members/{owner_id}/revoke", headers=bearer(organizer))

    assert demote.status_code == remove.status_code == 409
    assert demote.json()["code"] == remove.json()["code"] == "LAST_OWNER"
    await add_member(client, organizer, "09121008021", "owner")
    assert (await client.post(f"/api/organizer/members/{owner_id}/revoke", headers=bearer(organizer))).status_code == 200


async def test_members_of_another_organizer_are_out_of_reach(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    foreign = await add_member(client, other, "09121008030")

    changed = await client.patch(f"/api/organizer/members/{foreign['id']}", json={"role": "viewer"}, headers=bearer(organizer))
    listed = await client.get("/api/organizer/members", headers=bearer(organizer))

    assert changed.status_code == 404
    assert listed.json() == []


async def test_key_rotation_ends_member_scanner_and_desk_sessions_issued_before_it(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point.json()["id"]
    scanner = (await client.post(f"/api/checkin-points/{point_id}/token", headers=bearer(organizer))).json()
    await client.post(
        f"/api/events/{event_id}/desk/operators", json={"operator_name": "Sara", "mobile": "09121008041"},
        headers=bearer(organizer),
    )
    desk = (await desk_sign_in(client, event_id, "09121008041")).json()
    member = await member_session(client, organizer, "09121008042", "manager")
    scanner_auth = {"Authorization": f"Bearer {scanner['scanner_token']}"}
    desk_auth = {"Authorization": f"Bearer {desk['access_token']}"}
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=scanner_auth)).status_code == 200
    # Tokens carry whole seconds; one issued in the rotation's own second is kept.
    await asyncio.sleep(1.05)

    await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)

    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=scanner_auth)).status_code == 401
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=desk_auth)).status_code == 401
    assert (await client.get("/api/events", headers=member)).status_code == 401
    fresh_member = await member_session_for(client, "09121008042")
    assert (await client.get("/api/events", headers=fresh_member)).status_code == 200
    fresh_desk = (await desk_sign_in(client, event_id, "09121008041")).json()
    fresh_desk_auth = {"Authorization": f"Bearer {fresh_desk['access_token']}"}
    assert (await client.get(f"/api/events/{event_id}/attendees", headers=fresh_desk_auth)).status_code == 200


async def test_a_revoked_organizer_refuses_member_sign_in_and_sessions(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await add_member(client, organizer, "09121008050")
    owner = await member_session_for(client, "09121008050")

    await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)

    assert (await client.get("/api/events", headers=owner)).status_code == 401
    before = len((await client.get("/api/platform/sms-outbox", params={"mobile": "09121008050"}, headers=ADMIN)).json())
    await client.post("/api/auth/otp/request", json={"mobile": "09121008050", "purpose": "organizer"})
    after = len((await client.get("/api/platform/sms-outbox", params={"mobile": "09121008050"}, headers=ADMIN)).json())
    assert after == before


async def test_deleting_the_account_ends_the_membership(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    await add_member(client, organizer, "09121008060", "manager")
    owner_session = await member_session_for(client, "09121008060")
    _, attendee_token = await sign_in(client, "09121008060")

    deleted = await client.delete("/api/auth/me", headers={"Authorization": f"Bearer {attendee_token}"})

    assert deleted.status_code == 204
    assert (await client.get("/api/events", headers=owner_session)).status_code == 401
    members = (await client.get("/api/organizer/members", headers=bearer(organizer))).json()
    assert members[0]["revoked_at"] is not None and members[0]["mobile"] is None
