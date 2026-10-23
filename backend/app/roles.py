"""Organizer roles and the one table that says which role each organizer route needs (ADR 0016).

Every route that accepts an organizer credential (the API key or a member session) is listed here by method
and route template; `app.auth` checks the table centrally, so a route cannot forget its check. A route missing
from the table needs the owner role (fail closed), and `tests/test_roles.py` fails until it is listed.

- viewer: reads the event setup and the aggregate analytics; no personal data.
- staff: runs the day: reception (desk), scanner pairing and scanning, participant lookup.
- manager: changes the setup, manages participants and operators, downloads exports, reads the activity log.
- owner: everything, including who the members are. The organizer API key acts as the owner.
"""

from enum import IntEnum
from typing import Any

from fastapi import FastAPI

from app.errors import ErrorResponse


class Role(IntEnum):
    viewer = 1
    staff = 2
    manager = 3
    owner = 4


VIEWER, STAFF, MANAGER, OWNER = Role.viewer, Role.staff, Role.manager, Role.owner

E = "/api/events/{event_id}"
P = "/api/checkin-points/{point_id}"

ROUTE_ROLES: dict[tuple[str, str], Role] = {
    # The console session itself.
    ("GET", "/api/organizer/me"): VIEWER,
    ("POST", "/api/organizer/logout"): VIEWER,
    ("GET", "/api/organizer/members"): MANAGER,
    ("POST", "/api/organizer/members"): OWNER,
    ("PATCH", "/api/organizer/members/{member_id}"): OWNER,
    ("POST", "/api/organizer/members/{member_id}/revoke"): OWNER,
    ("GET", "/api/organizer/activity"): MANAGER,
    # Events and tiers.
    ("POST", "/api/events"): MANAGER,
    ("GET", "/api/events"): VIEWER,
    ("GET", E): VIEWER,
    ("PATCH", E): MANAGER,
    ("POST", f"{E}/ticket-tiers"): MANAGER,
    ("GET", f"{E}/ticket-tiers"): VIEWER,
    ("PATCH", f"{E}/ticket-tiers/{{tier_id}}"): MANAGER,
    # Participants (personal data: staff and up; changes and the export: managers).
    ("GET", f"{E}/participants"): STAFF,
    ("GET", f"{E}/participants/export-csv"): MANAGER,
    ("GET", f"{E}/participants/{{ticket_id}}"): STAFF,
    ("PATCH", f"{E}/participants/{{ticket_id}}"): MANAGER,
    ("POST", f"{E}/participants/{{ticket_id}}/cancel"): MANAGER,
    ("POST", f"{E}/participants/{{ticket_id}}/reissue"): MANAGER,
    ("POST", f"{E}/participants/{{ticket_id}}/transfer"): MANAGER,
    ("DELETE", f"{E}/participants/{{ticket_id}}"): MANAGER,
    # Check-in points, scanner pairing and scanning.
    ("POST", f"{E}/checkin-points"): MANAGER,
    ("GET", f"{E}/checkin-points"): VIEWER,
    ("PATCH", f"{E}/checkin-points/{{point_id}}"): MANAGER,
    ("POST", f"{P}/token"): STAFF,
    ("GET", f"{P}/devices"): STAFF,
    ("POST", f"{P}/devices/{{device_id}}/revoke"): STAFF,
    ("GET", f"{P}/manifest"): STAFF,
    ("POST", f"{P}/scans/batch"): STAFF,
    ("POST", f"{P}/scan"): STAFF,
    # Reception desk (operators themselves are authorized by their own session, not by this table).
    ("GET", f"{E}/desk/me"): STAFF,
    ("GET", f"{E}/desk/tiers"): STAFF,
    ("POST", f"{E}/desk-registrations"): STAFF,
    ("GET", f"{E}/attendees"): STAFF,
    ("GET", f"{E}/attendees/{{ticket_id}}"): STAFF,
    ("POST", f"{E}/attendees/{{ticket_id}}/resend-sms"): STAFF,
    ("GET", f"{E}/desk/operators"): MANAGER,
    ("POST", f"{E}/desk/operators"): MANAGER,
    ("DELETE", f"{E}/desk/operators/{{operator_id}}"): MANAGER,
    ("POST", f"{E}/desk/operators/{{operator_id}}/revoke"): MANAGER,
    # Analytics: aggregates for everyone, row-level exports for managers.
    ("GET", f"{E}/analytics/attendance"): VIEWER,
    ("GET", f"{E}/analytics/export-csv"): MANAGER,
    ("GET", f"{E}/analytics/registrations-csv"): MANAGER,
    # Booths.
    ("POST", f"{E}/booths"): MANAGER,
    ("GET", f"{E}/booths"): VIEWER,
    ("PATCH", f"{E}/booths/{{booth_id}}"): MANAGER,
    ("DELETE", f"{E}/booths/{{booth_id}}"): MANAGER,
    ("POST", f"{E}/booths/{{booth_id}}/staff"): MANAGER,
    ("GET", f"{E}/booths/{{booth_id}}/staff"): STAFF,
    # Public page and media.
    ("GET", f"{E}/page"): VIEWER,
    ("PUT", f"{E}/page"): MANAGER,
    ("POST", f"{E}/page/publish"): MANAGER,
    ("POST", f"{E}/page/unpublish"): MANAGER,
    ("POST", f"{E}/page/discard"): MANAGER,
    ("GET", f"{E}/page/preview"): VIEWER,
    ("GET", f"{E}/media"): VIEWER,
    ("POST", f"{E}/media"): MANAGER,
    ("GET", f"{E}/media/{{asset_id}}/content"): VIEWER,
    ("DELETE", f"{E}/media/{{asset_id}}"): MANAGER,
    # Program and venue.
    ("GET", f"{E}/venue-places"): VIEWER,
    ("POST", f"{E}/venue-places"): MANAGER,
    ("PATCH", f"{E}/venue-places/{{place_id}}"): MANAGER,
    ("DELETE", f"{E}/venue-places/{{place_id}}"): MANAGER,
    ("GET", f"{E}/sessions"): VIEWER,
    ("POST", f"{E}/sessions"): MANAGER,
    ("POST", f"{E}/sessions/import"): MANAGER,
    ("PATCH", f"{E}/sessions/{{session_id}}"): MANAGER,
    ("DELETE", f"{E}/sessions/{{session_id}}"): MANAGER,
    # SMS wording; the delivery log lists mobile numbers.
    ("GET", f"{E}/sms"): VIEWER,
    ("PUT", f"{E}/sms/templates/{{kind}}"): MANAGER,
    ("DELETE", f"{E}/sms/templates/{{kind}}"): MANAGER,
    ("POST", f"{E}/sms/test"): MANAGER,
    ("GET", f"{E}/sms/messages"): MANAGER,
}


def required_role(method: str, template: str) -> Role:
    return ROUTE_ROLES.get((method.upper(), template), OWNER)


def document_role_errors(app: FastAPI) -> None:
    """Adds the 403 `ROLE_FORBIDDEN` body to the OpenAPI operations of every route in the table."""
    build = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = build()
        for (method, template), role in ROUTE_ROLES.items():
            operation = schema.get("paths", {}).get(template, {}).get(method.lower())
            if operation is None or role == VIEWER:
                continue
            operation.setdefault("responses", {}).setdefault(
                "403",
                {
                    "description": f"ROLE_FORBIDDEN: needs the {role.name} role",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/ErrorResponse"}}},
                },
            )
        schema.setdefault("components", {}).setdefault("schemas", {}).setdefault(
            "ErrorResponse", ErrorResponse.model_json_schema()
        )
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
