import hashlib
import secrets
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.db import SessionDep
from app.models import Organizer
from app.rate_limit import ADMIN_TOKEN_PER_IP, API_KEY_PER_IP, client_ip, limiter

_bearer = HTTPBearer(auto_error=False)


def new_api_key() -> str:
    return secrets.token_urlsafe(32)


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode()).hexdigest()


def require_platform_admin(
    request: Request, x_admin_token: Annotated[str | None, Header()] = None
) -> None:
    expected: str = request.app.state.settings.platform_admin_token
    throttle = limiter(request)
    key = f"admin:ip:{client_ip(request)}"
    throttle.check((key, ADMIN_TOKEN_PER_IP))
    if x_admin_token is None or not secrets.compare_digest(x_admin_token, expected):
        throttle.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid admin token")


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
    throttle = limiter(request)
    key = f"apikey:ip:{client_ip(request)}"
    throttle.check((key, API_KEY_PER_IP))
    organizer = await session.scalar(
        select(Organizer).where(
            Organizer.api_key_hash == hash_api_key(credentials.credentials),
            Organizer.revoked_at.is_(None),
        )
    )
    if organizer is None:
        # Unknown, rotated-away and revoked keys are indistinguishable.
        throttle.fail(key)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return organizer


OrganizerDep = Annotated[Organizer, Depends(current_organizer)]
