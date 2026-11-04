"""The audit log (ADR 0016): who did what, for which organizer and event, from where.

Two ways a row is written:

- **Explicitly** by a route, with `record(...)`, for actions whose meaning the route knows best (a key
  rotation, a member's role change, a sign-in). It joins the route's transaction, so it is committed exactly
  when the change is.
- **Automatically** by `AuditMiddleware` for every other successful (2xx) POST/PUT/PATCH/DELETE made with an
  organizer key, a member session, a desk session or the platform admin token, and for downloads of exports:
  `http.<method>` (or `export.download`) with the route template, never the concrete path or the body.
  Scanner scans are not recorded here: they are already a log of their own (`checkins`), and neither is the
  replay of an idempotent request (`Idempotent-Replayed: true`), whose first answer was already recorded.

The acting credential is attached to the request by the auth dependencies (`set_actor`). Nothing personal is
stored beyond what identifies the actor: mobile numbers are masked and secrets never reach `summary`.
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.logging_setup import request_id_var
from app.models import AuditEvent
from app.rate_limit import client_ip
from app.sms.phone import mask_mobile

logger = logging.getLogger("congress.audit")

MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Scanner traffic: recorded per scan in `checkins`; an audit row per batch would only add noise.
UNAUDITED_TEMPLATES = frozenset({
    "/api/checkin-points/{point_id}/scans/batch",
    "/api/checkin-points/{point_id}/scan",
})
_ACTOR_KEY = "audit_actor"
_RECORDED_KEY = "audit_recorded"


@dataclass(frozen=True)
class Actor:
    type: str  # one of app.models.AUDIT_ACTOR_TYPES
    id: str | None
    label: str
    organizer_id: uuid.UUID | None = None


PLATFORM_ADMIN = Actor("platform_admin", None, "Platform admin")


def set_actor(request: Request, actor: Actor) -> None:
    request.state.audit_actor = actor


def current_actor(request: Request) -> Actor | None:
    actor = getattr(request.state, _ACTOR_KEY, None)
    return actor if isinstance(actor, Actor) else None


def masked(mobile: str | None) -> str | None:
    return mask_mobile(mobile) if mobile else None


def _path_uuid(scope: Scope, name: str) -> uuid.UUID | None:
    value = (scope.get("path_params") or {}).get(name)
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value)) if value is not None else None
    except ValueError:
        return None


def record(
    session: AsyncSession,
    request: Request,
    action: str,
    *,
    actor: Actor | None = None,
    organizer_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | str | None = None,
    summary: dict[str, Any] | None = None,
) -> None:
    """Add one audit row to `session` (committed with the caller's change); the middleware then skips the request.

    `actor` defaults to the credential the request was authorized with.
    """
    who = actor or current_actor(request) or Actor("system", None, "")
    session.add(
        AuditEvent(
            actor_type=who.type,
            actor_id=who.id,
            actor_label=who.label[:200],
            organizer_id=organizer_id or who.organizer_id,
            event_id=event_id or _path_uuid(request.scope, "event_id"),
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=summary or {},
            ip=client_ip(request),
            request_id=request_id_var.get(),
        )
    )
    request.state.audit_recorded = True


def _automatic_action(method: str, template: str) -> str | None:
    if template in UNAUDITED_TEMPLATES:
        return None
    if method in MUTATING_METHODS:
        return f"http.{method.lower()}"
    if method == "GET" and (template.endswith("-csv") or template.endswith("/export")):
        return "export.download"
    return None


class AuditMiddleware:
    """Writes the automatic audit row after the response (pure ASGI, so streamed bodies pass untouched)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        status = 500
        replayed = False

        async def send_and_watch(message: Message) -> None:
            nonlocal status, replayed
            if message["type"] == "http.response.start":
                status = int(message["status"])
                replayed = (b"idempotent-replayed", b"true") in message.get("headers", [])
            await send(message)

        await self.app(scope, receive, send_and_watch)
        state = scope.get("state") or {}
        actor = state.get(_ACTOR_KEY)
        if not isinstance(actor, Actor) or state.get(_RECORDED_KEY) or replayed or not 200 <= status < 300:
            return
        template = getattr(scope.get("route"), "path", None)
        if not isinstance(template, str):
            return
        action = _automatic_action(scope["method"], template)
        if action is None:
            return
        try:
            request = Request(scope)
            async with scope["app"].state.sessionmaker() as session:
                session.add(
                    AuditEvent(
                        actor_type=actor.type,
                        actor_id=actor.id,
                        actor_label=actor.label[:200],
                        organizer_id=actor.organizer_id,
                        event_id=_path_uuid(scope, "event_id"),
                        action=action,
                        summary={"method": scope["method"], "route": template, "status": status},
                        ip=client_ip(request),
                        request_id=request_id_var.get(),
                    )
                )
                await session.commit()
        except Exception:
            # The change itself already succeeded; a missing audit row must not turn it into an error.
            logger.exception("Could not write the audit row for %s %s", scope["method"], template)
