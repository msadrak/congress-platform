"""Every organizer route is role-checked from one table (app/roles.py), and the table is complete (ADR 0016)."""

from pathlib import Path
from typing import Any

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts
from httpx import AsyncClient

from app.main import create_app
from app.roles import ROUTE_ROLES, Role
from tests.conftest import ADMIN_TOKEN, make_test_settings
from tests.helpers import bearer, provision_organizer, request_code
from tests.test_ticket_tiers import create_event

ADMIN = {"X-Admin-Token": ADMIN_TOKEN}
# Dependencies that accept an organizer credential, and so must consult the role table.
ORGANIZER_DEPENDENCIES = {"organizer_principal", "authorized_desk_operator", "authorized_checkin_point"}


def _dependency_names(dependant: Dependant) -> set[str]:
    names: set[str] = set()
    for sub in dependant.dependencies:
        names.add(getattr(sub.call, "__name__", ""))
        names |= _dependency_names(sub)
    return names


def organizer_routes(media_root: Path) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for context in iter_route_contexts(create_app(make_test_settings(media_root)).routes):
        if not isinstance(context.original_route, APIRoute) or context.path is None:
            continue
        if _dependency_names(context.dependant) & ORGANIZER_DEPENDENCIES:
            found |= {(method, context.path) for method in context.methods or ()}
    return found


def test_every_organizer_route_has_an_explicit_role_and_no_entry_is_stale(media_root: Path) -> None:
    routes = organizer_routes(media_root)
    assert len(routes) > 70
    assert sorted(routes - ROUTE_ROLES.keys()) == [], "add these routes to app/roles.py ROUTE_ROLES"
    assert sorted(ROUTE_ROLES.keys() - routes) == [], "these ROUTE_ROLES entries match no route"


def test_member_management_is_owner_only_and_exports_need_a_manager() -> None:
    assert {role for (method, path), role in ROUTE_ROLES.items() if path.startswith("/api/organizer/members") and method != "GET"} == {Role.owner}
    exports = {path: role for (method, path), role in ROUTE_ROLES.items() if path.endswith("-csv")}
    assert exports and set(exports.values()) == {Role.manager}


async def member_session(client: AsyncClient, organizer: dict[str, str], mobile: str, role: str) -> dict[str, str]:
    """Adds a member with `role` (through the platform admin) and signs them in; returns their auth header."""
    added = await client.post(
        f"/api/organizers/{organizer['id']}/members",
        json={"mobile": mobile, "display_name": f"{role.title()} Person", "role": role},
        headers=ADMIN,
    )
    assert added.status_code == 201, added.text
    code = await request_code(client, mobile, "organizer")
    login = await client.post("/api/organizer/login", json={"mobile": mobile, "code": code})
    assert login.status_code == 200, login.text
    assert login.json()["status"] == "signed_in"
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _statuses(client: AsyncClient, headers: dict[str, str], event_id: str) -> dict[str, int]:
    calls: dict[str, tuple[str, str, Any]] = {
        "read event": ("GET", f"/api/events/{event_id}", None),
        "analytics": ("GET", f"/api/events/{event_id}/analytics/attendance", None),
        "participants": ("GET", f"/api/events/{event_id}/participants", None),
        "desk search": ("GET", f"/api/events/{event_id}/attendees", None),
        "export": ("GET", f"/api/events/{event_id}/participants/export-csv", None),
        "edit event": ("PATCH", f"/api/events/{event_id}", {"location": "Hall B"}),
        "members": ("GET", "/api/organizer/members", None),
        "invite": ("POST", "/api/organizer/members", {"mobile": "09121009999", "display_name": "New", "role": "viewer"}),
    }
    out: dict[str, int] = {}
    for name, (method, path, body) in calls.items():
        out[name] = (await client.request(method, path, json=body, headers=headers)).status_code
    return out


async def test_each_role_reaches_exactly_what_the_table_allows(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    sessions = {
        role: await member_session(client, organizer, f"0912100900{index}", role)
        for index, role in enumerate(("viewer", "staff", "manager", "owner"), start=1)
    }

    viewer = await _statuses(client, sessions["viewer"], event_id)
    staff = await _statuses(client, sessions["staff"], event_id)
    manager = await _statuses(client, sessions["manager"], event_id)
    owner = await _statuses(client, sessions["owner"], event_id)

    assert viewer == {
        "read event": 200, "analytics": 200, "participants": 403, "desk search": 403, "export": 403,
        "edit event": 403, "members": 403, "invite": 403,
    }
    assert staff == {**viewer, "participants": 200, "desk search": 200}
    assert manager == {**staff, "export": 200, "edit event": 200, "members": 200}
    assert owner == {**manager, "invite": 201}
    refused = await client.patch(f"/api/events/{event_id}", json={"location": "x"}, headers=sessions["viewer"])
    assert refused.json()["code"] == "ROLE_FORBIDDEN"
    # The API key keeps acting as the owner.
    assert (await client.get("/api/organizer/members", headers=bearer(organizer))).status_code == 200


async def test_scanner_routes_follow_the_role_table_for_members(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    event_id = await create_event(client, organizer)
    point = await client.post(
        f"/api/events/{event_id}/checkin-points", json={"name": "Gate", "policy_type": "MULTI_ENTRY"},
        headers=bearer(organizer),
    )
    point_id = point.json()["id"]
    viewer = await member_session(client, organizer, "09121009011", "viewer")
    staff = await member_session(client, organizer, "09121009012", "staff")

    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=viewer)).status_code == 403
    assert (await client.get(f"/api/checkin-points/{point_id}/manifest", headers=staff)).status_code == 200
    assert (await client.post(f"/api/checkin-points/{point_id}/token", headers=viewer)).status_code == 403
    assert (await client.post(f"/api/checkin-points/{point_id}/token", headers=staff)).status_code == 201


async def test_a_member_cannot_reach_another_organizers_event(client: AsyncClient) -> None:
    organizer = await provision_organizer(client, "Acme Congress Co")
    other = await provision_organizer(client, "Other Co")
    foreign_event = await create_event(client, other)
    owner = await member_session(client, organizer, "09121009021", "owner")

    assert (await client.get(f"/api/events/{foreign_event}", headers=owner)).status_code == 404
    assert (await client.get(f"/api/events/{foreign_event}/attendees", headers=owner)).status_code == 404
    assert (await client.get("/api/events", headers=owner)).json() == []


def test_role_refusals_are_documented_in_the_openapi_schema(media_root: Path) -> None:
    schema = create_app(make_test_settings(media_root)).openapi()
    export = schema["paths"]["/api/events/{event_id}/participants/export-csv"]["get"]["responses"]
    assert export["403"]["content"]["application/json"]["schema"] == {"$ref": "#/components/schemas/ErrorResponse"}
    assert "403" not in schema["paths"]["/api/events"]["get"]["responses"]
