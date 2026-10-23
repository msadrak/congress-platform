"""Credentials for the organizer console, desk, scanner and platform routes.

An organizer is reached with either its API key (an integration credential that acts as the owner) or a
member session (a person signed in by SMS code, with a role; ADR 0016). Both resolve to an
`OrganizerPrincipal`, and `authorize` checks the principal's role against `app.roles.ROUTE_ROLES` for the
route being called, so every organizer route is role-checked in one place.
"""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import PLATFORM_ADMIN, Actor, set_actor
from app.db import SessionDep
from app.errors import ApiError
from app.models import Organizer, OrganizerMember
from app.platform_config import platform_config
from app.rate_limit import ADMIN_TOKEN_PER_IP, API_KEY_PER_IP, client_ip, in_networks, ip_group, limiter
from app.roles import Role, required_role
from app.security import inspect_token

_bearer = HTTPBearer(auto_error=False)
KEY_LABEL = "Integration key"


def new_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


async def require_platform_admin(
    request: Request, x_admin_token: Annotated[str | None, Header()] = None
) -> None:
    expected: str = request.app.state.settings.platform_admin_token
    throttle = limiter(request)
    key = f"admin:ip:{ip_group(client_ip(request))}"
    await throttle.check((key, ADMIN_TOKEN_PER_IP))
    # Bytes, not str: compare_digest refuses non-ASCII strings (a 500 that would not count as a failure).
    if x_admin_token is None or not secrets.compare_digest(x_admin_token.encode(), expected.encode()):
        await throttle.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")
    set_actor(request, PLATFORM_ADMIN)


@dataclass(frozen=True)
class OrganizerPrincipal:
    """Who is acting for an organizer: its API key (as the owner) or one of its members."""

    organizer: Organizer
    role: Role
    member: OrganizerMember | None = None

    @property
    def label(self) -> str:
        return self.member.display_name if self.member else KEY_LABEL

    @property
    def actor(self) -> Actor:
        if self.member is None:
            return Actor("organizer_key", str(self.organizer.id), KEY_LABEL, self.organizer.id)
        return Actor("organizer_member", str(self.member.id), self.member.display_name, self.organizer.id)


def issued_before_rotation(organizer: Organizer, issued_at: object) -> bool:
    """True for a token issued before the organizer's last key rotation (or without a usable `iat`).

    A rotation is how a compromised organizer is recovered, so every session handed out until then (scanner,
    desk, member) ends with it. Tokens carry whole seconds: one issued in the same second as the rotation stays.
    """
    if organizer.key_rotated_at is None:
        return False
    return type(issued_at) is not int or issued_at < int(organizer.key_rotated_at.timestamp())


async def organizer_is_active(session: AsyncSession, organizer_id: uuid.UUID) -> bool:
    """False once the platform admin revoked the organizer."""
    active = await session.scalar(
        select(Organizer.id).where(Organizer.id == organizer_id, Organizer.revoked_at.is_(None))
    )
    return active is not None


async def organizer_accepts_token(session: AsyncSession, organizer_id: uuid.UUID, issued_at: object) -> bool:
    """For a scanner, desk or member session: the organizer is active and has not rotated its key since."""
    organizer = await session.get(Organizer, organizer_id)
    return organizer is not None and organizer.revoked_at is None and not issued_before_rotation(organizer, issued_at)


async def _member_principal(session: AsyncSession, payload: dict[str, object]) -> OrganizerPrincipal | None:
    try:
        member_id = uuid.UUID(str(payload.get("member_id")))
    except ValueError:
        return None
    member = await session.get(OrganizerMember, member_id)
    version = payload.get("session_version")
    if (
        member is None
        or member.revoked_at is not None
        or str(member.organizer_id) != payload.get("organizer_id")
        or type(version) is not int
        or version != member.session_version
    ):
        return None
    organizer = await session.get(Organizer, member.organizer_id)
    if organizer is None or organizer.revoked_at is not None or issued_before_rotation(organizer, payload.get("iat")):
        return None
    return OrganizerPrincipal(organizer, Role[member.role], member)


async def resolve_organizer_principal(
    session: AsyncSession, request: Request, token: str
) -> OrganizerPrincipal | None:
    """The organizer this key or member session acts for, or None. Every route that accepts an organizer
    credential goes through here (scanner and desk routes too, after their own tokens), so a revoked key or member
    is refused everywhere. Unknown, rotated-away and revoked credentials are indistinguishable.

    Only guesses count toward the per-IP budget: a credential that verifies is never refused because others behind
    the same address (a venue NAT) failed, and our own signed tokens are never guesses. An expired one answers
    401 TOKEN_EXPIRED, so the client knows to sign in again. API keys are 256-bit random values, so the budget
    bounds noise, not a guessable secret."""
    state, payload = inspect_token(token, request.app.state.settings.jwt_secret)
    if state == "expired":
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "TOKEN_EXPIRED", "This session has expired. Sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if state != "foreign":
        if state == "valid" and payload is not None and payload.get("type") == "organizer_member":
            return await _member_principal(session, payload)
        return None
    organizer = await session.scalar(
        select(Organizer).where(Organizer.api_key_hash == hash_api_key(token), Organizer.revoked_at.is_(None))
    )
    if organizer is not None:
        return OrganizerPrincipal(organizer, Role.owner)
    await _count_wrong_key(request)
    return None


async def _count_wrong_key(request: Request) -> None:
    """Count a wrong API key against the caller's address (IPv6 per /64), or answer 429 once it is used up.
    Venue networks (the sign-in rules' trusted networks) are exempt: everyone there shares a handful of addresses."""
    ip = client_ip(request)
    if in_networks(ip, platform_config(request).sign_in.trusted_networks):
        return
    throttle = limiter(request)
    key = f"apikey:ip:{ip_group(ip)}"
    await throttle.check((key, API_KEY_PER_IP))
    await throttle.fail(key)


def authorize(request: Request, principal: OrganizerPrincipal) -> None:
    """Refuse a principal whose role is below what this route needs (app.roles); record who is acting."""
    template = getattr(request.scope.get("route"), "path", "")
    needed = required_role(request.method, template if isinstance(template, str) else "")
    if principal.role < needed:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "ROLE_FORBIDDEN", f"Your role does not allow this; it needs {needed.name} or higher"
        )
    set_actor(request, principal.actor)


async def organizer_principal(
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> OrganizerPrincipal:
    if credentials is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "API_KEY_MISSING", "Missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    principal = await resolve_organizer_principal(session, request, credentials.credentials)
    if principal is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "API_KEY_INVALID", "Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    authorize(request, principal)
    return principal


OrganizerPrincipalDep = Annotated[OrganizerPrincipal, Depends(organizer_principal)]


async def current_organizer(principal: OrganizerPrincipalDep) -> Organizer:
    return principal.organizer


OrganizerDep = Annotated[Organizer, Depends(current_organizer)]
