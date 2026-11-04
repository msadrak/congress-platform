"""The audit log: what is recorded, by whom, what never is, and that rows cannot be changed (ADR 0016)."""

import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import DBAPIError

from app.models import AuditEvent
from tests.conftest import ADMIN_TOKEN
from tests.exhibitors import setup_congress
from tests.helpers import bearer, desk_sign_in, provision_organizer
from tests.test_roles import member_session
from tests.test_events import EVENT
from tests.test_ticket_tiers import create_event, tier

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}


async def rows(app: FastAPI) -> list[AuditEvent]:
    async with app.state.sessionmaker() as session:
        return list(await session.scalars(select(AuditEvent).order_by(AuditEvent.at, AuditEvent.action)))


async def another_event(client: AsyncClient, organizer: dict[str, str]) -> str:
    body = {**EVENT, "slug": f"event-{uuid.uuid4().hex[:6]}"}
    response = await client.post("/api/events", json=body, headers=bearer(organizer))
    assert response.status_code == 201, response.text
    event_id: str = response.json()["id"]
    return event_id


async def activity(client: AsyncClient, headers: dict[str, str], **params: Any) -> dict[str, Any]:
    response = await client.get("/api/organizer/activity", params=params, headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_changes_are_recorded_with_actor_route_event_and_request_id(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    manager = await member_session(client, organizer, "09121007001", "manager")

    patched = await client.patch(
        f"/api/events/{event_id}", json={"location": "Hall B"}, headers={**manager, "X-Request-ID": "req-audit-0001"}
    )

    assert patched.status_code == 200
    row = next(r for r in await rows(app) if r.action == "http.patch")
    assert (row.actor_type, row.actor_label, row.organizer_id) == ("organizer_member", "Manager Person", uuid.UUID(organizer["id"]))
    assert row.event_id == uuid.UUID(event_id)
    assert row.summary == {"method": "PATCH", "route": "/api/events/{event_id}", "status": 200}
    assert row.request_id == "req-audit-0001" and row.ip
    created = next(r for r in await rows(app) if r.action == "http.post" and r.summary["route"] == "/api/events")
    assert (created.actor_type, created.actor_label) == ("organizer_key", "Integration key")


async def test_reads_failures_and_scans_are_not_recorded_but_exports_are(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    before = len(await rows(app))

    await client.get(f"/api/events/{event_id}", headers=bearer(organizer))
    await client.patch(f"/api/events/{event_id}", json={"starts_at": "not a date"}, headers=bearer(organizer))
    await client.patch(f"/api/events/{event_id}", json={"location": "x"}, headers={"Authorization": "Bearer nope"})
    scan = {"scans": [{"scan_id": str(uuid.uuid4()), "qr_secret": "x", "scanned_at": "2026-10-22T08:00:00Z"}]}
    scanned = await client.post(f"/api/checkin-points/{point.json()['id']}/scans/batch", json=scan, headers=bearer(organizer))
    assert scanned.status_code == 200
    assert len(await rows(app)) == before

    exported = await client.get(f"/api/events/{event_id}/participants/export-csv", headers=bearer(organizer))
    assert exported.status_code == 200
    export = (await rows(app))[-1]
    assert export.action == "export.download"
    assert export.summary["route"] == "/api/events/{event_id}/participants/export-csv"


async def test_member_changes_and_platform_actions_appear_in_the_organizers_activity(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    owner = await member_session(client, organizer, "09121007010", "owner")
    invited = await client.post(
        "/api/organizer/members", json={"mobile": "09121007011", "display_name": "Ali", "role": "staff"}, headers=owner
    )
    await client.patch(f"/api/organizer/members/{invited.json()['id']}", json={"role": "viewer"}, headers=owner)
    await client.post(f"/api/organizers/{organizer['id']}/revoke", headers=ADMIN)
    new_key = (await client.post(f"/api/organizers/{organizer['id']}/rotate-key", headers=ADMIN)).json()["api_key"]

    items = (await activity(client, {"Authorization": f"Bearer {new_key}"}))["items"]

    actions = [(i["action"], i["actor_label"]) for i in items]
    assert actions[:4] == [
        ("organizer.key_rotated", "Platform admin"),
        ("organizer.revoked", "Platform admin"),
        ("member.role_changed", "Owner Person"),
        ("member.invited", "Owner Person"),
    ]
    assert ("member.signed_in", "Owner Person") in actions
    assert ("organizer.provisioned", "Platform admin") in actions
    invite = next(i for i in items if i["action"] == "member.invited")
    assert invite["summary"] == {"role": "staff", "display_name": "Ali", "mobile": "0912***7011"}
    assert "09121007011" not in str(items)
    # An explicitly recorded request gets no second, automatic row.
    assert not any(i["action"] == "http.post" and i["summary"].get("route") == "/api/organizer/members" for i in items)
    assert new_key not in str(items)


async def test_desk_operator_actions_are_attributed_to_the_operator(client: AsyncClient, app: FastAPI) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    tier_id = (await client.post(f"/api/events/{event_id}/ticket-tiers", json=tier(), headers=bearer(organizer))).json()["id"]
    await client.post(
        f"/api/events/{event_id}/desk/operators", json={"operator_name": "Sara", "mobile": "09121007020"},
        headers=bearer(organizer),
    )
    desk = (await desk_sign_in(client, event_id, "09121007020")).json()

    issued = await client.post(
        f"/api/events/{event_id}/desk-registrations",
        json={"full_name": "Walk In", "mobile": "09121007021", "ticket_tier_id": tier_id},
        headers={"Authorization": f"Bearer {desk['access_token']}"},
    )

    assert issued.status_code == 201
    row = (await rows(app))[-1]
    assert (row.actor_type, row.actor_label, row.organizer_id) == ("desk_operator", "Sara", uuid.UUID(organizer["id"]))
    assert row.summary["route"] == "/api/events/{event_id}/desk-registrations"

    # A retried walk-in (same Idempotency-Key) replays the first answer and adds no second row.
    retry = {"Authorization": f"Bearer {desk['access_token']}", "Idempotency-Key": str(uuid.uuid4())}
    walk_in = {"full_name": "Second Walk In", "ticket_tier_id": tier_id}
    first = await client.post(f"/api/events/{event_id}/desk-registrations", json=walk_in, headers=retry)
    count = len(await rows(app))
    replay = await client.post(f"/api/events/{event_id}/desk-registrations", json=walk_in, headers=retry)
    assert first.status_code == replay.status_code == 201
    assert replay.headers["Idempotent-Replayed"] == "true"
    assert len(await rows(app)) == count


async def test_lifecycle_changes_and_every_export_are_recorded(client: AsyncClient, app: FastAPI) -> None:
    congress = await setup_congress(client)
    organizer, event_id = congress.organizer, congress.event_id
    await client.post(
        f"/api/booths/{congress.booth_id}/leads/scan",
        json={"qr_secret": congress.ticket["qr_secret"], "rating": "HOT"}, headers=congress.staff,
    )
    staff_rows = len(await rows(app))
    for path in ("participants/export-csv", "analytics/export-csv", "analytics/registrations-csv"):
        assert (await client.get(f"/api/events/{event_id}/{path}", headers=bearer(organizer))).status_code == 200
    leads = await client.get(
        f"/api/booths/{congress.booth_id}/leads/export-csv", params={"include_deleted": True}, headers=congress.staff
    )
    assert leads.status_code == 200
    archived = await client.post(f"/api/events/{event_id}/archive", json={"archived": True}, headers=bearer(organizer))
    assert archived.status_code == 200

    recorded = (await rows(app))[staff_rows:]
    assert [(r.action, r.summary["route"]) for r in recorded] == [
        ("export.download", "/api/events/{event_id}/participants/export-csv"),
        ("export.download", "/api/events/{event_id}/analytics/export-csv"),
        ("export.download", "/api/events/{event_id}/analytics/registrations-csv"),
        ("export.download", "/api/booths/{booth_id}/leads/export-csv"),
        ("http.post", "/api/events/{event_id}/archive"),
    ]
    lead_export = recorded[-2]
    assert (lead_export.actor_type, lead_export.actor_label) == ("booth_staff", "Booth Rep")
    assert lead_export.organizer_id == uuid.UUID(organizer["id"]) and lead_export.event_id == uuid.UUID(event_id)
    assert lead_export.summary["include_deleted"] is True and lead_export.summary["rows"] == 1
    # Booth staff capturing leads is the exhibitor's own work: no rows before the export.
    assert all(r.actor_type != "booth_staff" for r in (await rows(app))[:staff_rows])


async def test_activity_is_per_organizer_filterable_by_event_and_paged_without_gaps(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    first = await create_event(client, organizer)
    second = await another_event(client, organizer)
    await another_event(client, other)
    for index in range(5):
        await client.patch(f"/api/events/{first}", json={"location": f"Hall {index}"}, headers=bearer(organizer))
    await client.patch(f"/api/events/{second}", json={"location": "Annex"}, headers=bearer(organizer))

    everything = (await activity(client, bearer(organizer), limit=200))["items"]
    pages: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = await activity(client, bearer(organizer), limit=3, **({"before": cursor} if cursor else {}))
        pages += page["items"]
        cursor = page["next_before"]
        if cursor is None:
            break
    only_first = (await activity(client, bearer(organizer), event_id=first))["items"]

    assert [i["id"] for i in pages] == [i["id"] for i in everything]
    assert {i["event_id"] for i in only_first} == {first} and len(only_first) == 5
    theirs = (await activity(client, bearer(other)))["items"]
    assert {i["id"] for i in theirs}.isdisjoint({i["id"] for i in everything})
    bad = await client.get("/api/organizer/activity", params={"before": "yesterday"}, headers=bearer(organizer))
    assert bad.status_code == 400 and bad.json()["code"] == "CURSOR_INVALID"


async def test_audit_rows_cannot_be_updated_or_deleted(client: AsyncClient, app: FastAPI) -> None:
    await provision_organizer(client, "Acme Congress Co")
    async with app.state.sessionmaker() as session:
        for statement in (update(AuditEvent).values(action="tampered"), delete(AuditEvent)):
            with pytest.raises(DBAPIError, match="append-only"):
                await session.execute(statement)
            await session.rollback()
        assert (await session.execute(text("SELECT count(*) FROM audit_events"))).scalar_one() == 1
