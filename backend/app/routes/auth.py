import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import User
from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

NameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: NameStr
    organization: Annotated[str, Field(max_length=200)] = ""
    title: Annotated[str, Field(max_length=100)] = ""


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    organization: str
    title: str
    share_contact_with_peers: bool = False

class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


async def current_user(
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Missing authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    jwt_secret: str = request.app.state.settings.jwt_secret
    payload = decode_access_token(credentials.credentials, jwt_secret)
    if payload is None or "sub" not in payload:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if "type" in payload and payload["type"] != "user":
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid token type for user authentication",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id = uuid.UUID(payload["sub"])
    except (ValueError, TypeError):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Malformed token subject",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "User account not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUserDep = Annotated[User, Depends(current_user)]


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register_user(
    body: UserRegister, request: Request, session: SessionDep
) -> AuthResponse:
    user = User(
        email=body.email.lower().strip(),
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        organization=body.organization,
        title=body.title,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Email is already registered"
        ) from None

    jwt_secret: str = request.app.state.settings.jwt_secret
    token = create_access_token(user.id, user.email, jwt_secret)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/login")
async def login_user(
    body: UserLogin, request: Request, session: SessionDep
) -> AuthResponse:
    email = body.email.lower().strip()
    user = await session.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Invalid email or password"
        )

    jwt_secret: str = request.app.state.settings.jwt_secret
    token = create_access_token(user.id, user.email, jwt_secret)
    return AuthResponse(access_token=token, user=UserOut.model_validate(user))


@router.get("/me")
async def get_my_profile(user: CurrentUserDep) -> UserOut:
    return UserOut.model_validate(user)
