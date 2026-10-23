import hashlib
import secrets
import uuid
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.models import Organizer
from app.rate_limit import ADMIN_TOKEN_PER_IP, API_KEY_PER_IP, client_ip, limiter

_bearer = HTTPBearer(auto_error=False)


def new_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


async def require_platform_admin(
    request: Request, x_admin_token: Annotated[str | None, Header()] = None
) -> None:
    expected: str = request.app.state.settings.platform_admin_token
    throttle = limiter(request)
    key = f"admin:ip:{client_ip(request)}"
    await throttle.check((key, ADMIN_TOKEN_PER_IP))
    if x_admin_token is None or not secrets.compare_digest(x_admin_token, expected):
        await throttle.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")


async def resolve_organizer_key(session: AsyncSession, request: Request, token: str) -> Organizer | None:
    """The active organizer this API key belongs to, or None. Every route that accepts an organizer key goes
    through here, so a revoked key is refused everywhere and every miss counts toward the per-IP budget.
    Unknown, rotated-away and revoked keys are indistinguishable."""
    throttle = limiter(request)
    key = f"apikey:ip:{client_ip(request)}"
    await throttle.check((key, API_KEY_PER_IP))
    organizer = await session.scalar(
        select(Organizer).where(
            Organizer.api_key_hash == hash_api_key(token),
            Organizer.revoked_at.is_(None),
        )
    )
    if organizer is None:
        await throttle.fail(key)
    return organizer


async def organizer_is_active(session: AsyncSession, organizer_id: uuid.UUID) -> bool:
    """False once the platform admin revoked the organizer: the scanner and desk sessions it handed out stop
    working with its key, and work again only after a rotation reinstates it."""
    active = await session.scalar(
        select(Organizer.id).where(Organizer.id == organizer_id, Organizer.revoked_at.is_(None))
    )
    return active is not None


async def current_organizer(
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Organizer:
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Missing API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    organizer = await resolve_organizer_key(session, request, credentials.credentials)
    if organizer is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return organizer


OrganizerDep = Annotated[Organizer, Depends(current_organizer)]
