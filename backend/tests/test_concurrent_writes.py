"""Concurrent writes that used to race: the first save of an event's SMS wording, and two owners removing or
demoting each other at the same moment."""

import asyncio

from httpx import AsyncClient

from tests.helpers import bearer, provision_organizer
from tests.test_event_lifecycle import make_event
from tests.test_organizer_members import add_member


CONCURRENT = 8


async def warm_pool(client: AsyncClient, organizer: dict[str, str]) -> None:
    """Open enough pooled connections first, so the concurrent requests really overlap (a request that has to
    open a new connection would otherwise start long after one that reuses an idle one)."""
    await asyncio.gather(*(client.get("/api/events", headers=bearer(organizer)) for _ in range(CONCURRENT)))


async def test_simultaneous_first_saves_of_an_sms_template_all_succeed(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event = await make_event(client, organizer)
    url = f"/api/events/{event['id']}/sms/templates/ticket_confirmation"
    bodies = [f"{{name}} {{event}} {{link}} v{i}" for i in range(CONCURRENT)]
    await warm_pool(client, organizer)

    responses = await asyncio.gather(*(client.put(url, json={"body": b}, headers=bearer(organizer)) for b in bodies))

    assert [r.status_code for r in responses] == [200] * len(bodies), [r.text for r in responses]
    panel = await client.get(f"/api/events/{event['id']}/sms", headers=bearer(organizer))
    saved = next(t for t in panel.json()["templates"] if t["kind"] == "ticket_confirmation")
    assert saved["is_custom"] is True and saved["body"] in bodies


async def test_two_owners_removing_each_other_at_once_leave_one_owner(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    first = await add_member(client, organizer, "09121009001", "owner")
    second = await add_member(client, organizer, "09121009002", "owner")
    await warm_pool(client, organizer)

    responses = await asyncio.gather(
        client.post(f"/api/organizer/members/{first['id']}/revoke", headers=bearer(organizer)),
        client.post(f"/api/organizer/members/{second['id']}/revoke", headers=bearer(organizer)),
    )

    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    assert [r.json()["code"] for r in responses if r.status_code == 409] == ["LAST_OWNER"]
    members = (await client.get("/api/organizer/members", headers=bearer(organizer))).json()
    assert [m["role"] for m in members if m["revoked_at"] is None] == ["owner"]


async def test_two_owners_demoting_each_other_at_once_leave_one_owner(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    first = await add_member(client, organizer, "09121009011", "owner")
    second = await add_member(client, organizer, "09121009012", "owner")
    await warm_pool(client, organizer)

    responses = await asyncio.gather(
        client.patch(f"/api/organizer/members/{first['id']}", json={"role": "manager"}, headers=bearer(organizer)),
        client.patch(f"/api/organizer/members/{second['id']}", json={"role": "manager"}, headers=bearer(organizer)),
    )

    assert sorted(r.status_code for r in responses) == [200, 409], [r.text for r in responses]
    members = (await client.get("/api/organizer/members", headers=bearer(organizer))).json()
    assert sorted(m["role"] for m in members) == ["manager", "owner"]
