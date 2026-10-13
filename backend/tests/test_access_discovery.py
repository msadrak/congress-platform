from typing import Any

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import create_async_engine

from app.models import Ticket
from tests.conftest import TEST_URL
from tests.helpers import bearer, provision_organizer
from tests.test_events import EVENT
from tests.test_ticket_tiers import tier
from tests.test_tickets import register_user


async def make_event(client: AsyncClient, organizer: dict[str, str], slug: str) -> str:
    resp = await client.post("/api/events", json={**EVENT, "slug": slug, "name": slug.title()}, headers=bearer(organizer))
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def reserve(client: AsyncClient, organizer: dict[str, str], event_id: str, token: str) -> str:
    tier_resp = await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))
    resp = await client.post(
        f"/api/events/{event_id}/tickets/reserve",
        json={"ticket_tier_id": tier_resp.json()["id"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def make_booth(client: AsyncClient, organizer: dict[str, str], event_id: str, slug: str, email: str) -> str:
    resp = await client.post(f"/api/events/{event_id}/booths", json={"name": slug, "slug": slug}, headers=bearer(organizer))
    assert resp.status_code == 201, resp.text
    booth_id = str(resp.json()["id"])
    staff = await client.post(f"/api/events/{event_id}/booths/{booth_id}/staff", json={"email": email}, headers=bearer(organizer))
    assert staff.status_code == 201, staff.text
    return booth_id


async def access(client: AsyncClient, token: str) -> Any:
    resp = await client.get("/api/me/access", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_user_without_memberships_gets_empty_contexts(client: AsyncClient) -> None:
    user, token = await register_user(client, "nobody@example.com")
    body = await access(client, token)
    assert body == {"user_id": user["id"], "events": []}


async def test_multi_role_multi_event_multi_booth_contexts_are_exact(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Access Org")
    event_a = await make_event(client, organizer, "alpha-congress")
    event_b = await make_event(client, organizer, "beta-congress")
    email = "multi@example.com"
    user, token = await register_user(client, email)

    ticket_a = await reserve(client, organizer, event_a, token)
    booth_1 = await make_booth(client, organizer, event_a, "booth-one", email)
    booth_2 = await make_booth(client, organizer, event_a, "booth-two", email)
    operator = await client.post(
        f"/api/events/{event_b}/desk/operators",
        json={"operator_name": "Multi", "email": email},
        headers=bearer(organizer),
    )
    assert operator.status_code == 201, operator.text

    body = await access(client, token)
    assert body["user_id"] == user["id"]
    assert [e["event_slug"] for e in body["events"]] == ["alpha-congress", "beta-congress"]
    alpha, beta = body["events"]
    assert alpha["roles"] == ["ATTENDEE", "PARTNER"]
    assert alpha["ticket_ids"] == [ticket_a]
    assert alpha["booth_ids"] == sorted([booth_1, booth_2])
    assert alpha["desk_operator_ids"] == [] and alpha["partner_ids"] == []
    assert beta["roles"] == ["RECEPTION"]
    assert beta["desk_operator_ids"] == [operator.json()["id"]]
    assert "ORGANIZER" not in {r for e in body["events"] for r in e["roles"]}

    # Discovery describes eligibility only: the User still cannot use desk or organizer routes.
    denied = await client.get(f"/api/events/{event_b}/desk/me", headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 401
    organizer_route = await client.get("/api/events", headers={"Authorization": f"Bearer {token}"})
    assert organizer_route.status_code == 401


async def test_revoked_operator_and_inactive_ticket_lose_only_their_eligibility(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Revocation Org")
    event_a = await make_event(client, organizer, "gamma-congress")
    email = "revoked@example.com"
    _, token = await register_user(client, email)
    ticket = await reserve(client, organizer, event_a, token)
    booth = await make_booth(client, organizer, event_a, "booth-keep", email)
    operator = await client.post(
        f"/api/events/{event_a}/desk/operators",
        json={"operator_name": "Rev", "email": email},
        headers=bearer(organizer),
    )
    assert (await access(client, token))["events"][0]["roles"] == ["ATTENDEE", "RECEPTION", "PARTNER"]

    revoke = await client.delete(f"/api/events/{event_a}/desk/operators/{operator.json()['id']}", headers=bearer(organizer))
    assert revoke.status_code == 200
    engine = create_async_engine(TEST_URL)
    async with engine.begin() as conn:
        await conn.execute(update(Ticket).where(Ticket.id == ticket).values(status="cancelled"))
    await engine.dispose()

    (event,) = (await access(client, token))["events"]
    assert event["roles"] == ["PARTNER"]
    assert event["ticket_ids"] == [] and event["desk_operator_ids"] == []
    assert event["booth_ids"] == [booth]


async def test_non_user_credentials_are_rejected(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Family Org")
    event_id = await make_event(client, organizer, "delta-congress")
    operator = await client.post(
        f"/api/events/{event_id}/desk/operators",
        json={"operator_name": "Desk", "email": "desk.family@example.com"},
        headers=bearer(organizer),
    )
    login = await client.post(
        f"/api/events/{event_id}/desk/login",
        json={"email": "desk.family@example.com", "password": operator.json()["temporary_password"]},
    )
    assert login.status_code == 200, login.text
    for headers in ({}, bearer(organizer), {"Authorization": f"Bearer {login.json()['access_token']}"}, {"Authorization": "Bearer not-a-token"}):
        resp = await client.get("/api/me/access", headers=headers)
        assert resp.status_code == 401, (headers, resp.text)
        assert "events" not in resp.json()
