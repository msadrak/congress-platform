import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import DeskOperator, SmsMessage, User
from app.rate_limit import (
    LONGEST_WINDOW_SECONDS,
    OTP_VERIFY_PER_IP,
    OTP_VERIFY_PER_MOBILE,
    Budget,
    client_ip,
    limiter,
)
from app.security import create_access_token, create_signup_token, decode_access_token, is_user_token
from app.sms import SmsProvider, sms_provider
from app.sms.otp import OtpPurpose, consume_challenge, issue_challenge
from app.sms.phone import IranMobile, ascii_digits
from app.platform_config import platform_config
from app.sms.gateway import NOT_CONFIGURED
from app.sms.templates import platform_body, render
from app.account import AccountExport, delete_account, export_account, refresh_upcoming_snapshots

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

NameStr = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


def _code_digits(value: str) -> str:
    code = ascii_digits(value.strip())
    if not code.isdigit() or not 4 <= len(code) <= 8:
        raise ValueError("Enter the numeric code from the SMS.")
    return code


# The SMS code as typed: Persian digits are accepted.
OtpCode = Annotated[str, StringConstraints(max_length=16), AfterValidator(_code_digits)]


class OtpRequest(BaseModel):
    mobile: IranMobile
    purpose: OtpPurpose = "signin"


class OtpRequestOut(BaseModel):
    mobile: str
    code_length: int
    expires_in: int
    resend_after: int


class OtpVerify(BaseModel):
    mobile: IranMobile
    code: OtpCode


class OtpComplete(BaseModel):
    signup_token: str
    full_name: NameStr
    organization: Annotated[str, Field(max_length=200)] = ""
    title: Annotated[str, Field(max_length=100)] = ""


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    mobile: str | None
    full_name: str
    organization: str
    title: str
    share_contact_with_peers: bool = False
    share_contact_with_exhibitors: bool = False


class ProfileUpdate(BaseModel):
    """The account's own details. Name changes also apply to registrations for congresses that have not ended."""

    full_name: NameStr | None = None
    organization: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    # Exhibitors who scan this person's pass see the mobile number only with this consent.
    share_contact_with_exhibitors: bool | None = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class OtpVerifyOut(BaseModel):
    """`signed_in` carries the session; `profile_required` (new number) carries a token for /otp/complete."""

    status: Literal["signed_in", "profile_required"]
    access_token: str | None = None
    token_type: str = "bearer"
    user: UserOut | None = None
    signup_token: str | None = None


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
    if not is_user_token(payload):
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
    if user is None or user.deleted_at is not None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "User account not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


CurrentUserDep = Annotated[User, Depends(current_user)]



def _session_for(user: User, request: Request) -> AuthResponse:
    jwt_secret: str = request.app.state.settings.jwt_secret
    return AuthResponse(access_token=create_access_token(user.id, jwt_secret), user=UserOut.model_validate(user))


async def _should_send(session: SessionDep, mobile: str, purpose: OtpPurpose) -> bool:
    """Sign-in codes go to any number (that is how accounts are created). Desk codes only go to numbers of
    active desk operators, so the desk form cannot be used to spend SMS credit on arbitrary numbers; the
    response is the same either way."""
    if purpose == "signin":
        return True
    operator = await session.scalar(
        select(DeskOperator.id)
        .join(User, DeskOperator.user_id == User.id)
        .where(User.mobile == mobile, DeskOperator.is_revoked.is_(False))
        .limit(1)
    )
    return operator is not None


@router.post("/otp/request", status_code=status.HTTP_202_ACCEPTED)
async def request_otp(
    body: OtpRequest,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsProvider, Depends(sms_provider)],
) -> OtpRequestOut:
    """Send a one-time code by SMS. The answer never reveals whether the number has an account."""
    settings = request.app.state.settings
    rules = platform_config(request).sign_in
    throttle = limiter(request)
    cooldown, per_mobile, per_ip = (
        f"otp:cooldown:{body.purpose}:{body.mobile}",
        f"otp:send:{body.mobile}",
        f"otp:send-ip:{client_ip(request)}",
    )
    await throttle.check(
        (cooldown, Budget(1, rules.otp_resend_cooldown_seconds)),
        (per_mobile, Budget(rules.otp_sends_per_mobile_per_hour, LONGEST_WINDOW_SECONDS)),
        (per_ip, Budget(rules.otp_sends_per_ip_per_hour, LONGEST_WINDOW_SECONDS)),
        detail="Too many codes requested. Wait before asking for another one.",
    )
    await throttle.hit(cooldown, per_mobile, per_ip)

    if await _should_send(session, body.mobile, body.purpose):
        code = await issue_challenge(
            session, settings, body.mobile, body.purpose, length=rules.otp_length, ttl_seconds=rules.otp_ttl_seconds
        )
        text = render(
            await platform_body(session, "otp"),
            {"code": code, "minutes": str(max(1, rules.otp_ttl_seconds // 60))},
        )
        result = await provider.send_text(body.mobile, text, kind="otp", code=code)
        session.add(
            SmsMessage(
                kind="otp",
                mobile=body.mobile,
                body=None,  # never kept: it contains the code
                status="sent" if result.ok else "unknown" if result.unknown else "failed",
                provider_message_id=result.message_id,
                attempts=1,
                last_error=result.error,
            )
        )
        await session.commit()
        if not result.ok and not result.unknown:
            # Nothing reached the phone: let the person retry without waiting out the resend cooldown.
            await throttle.succeed(cooldown)
            detail = (
                "SMS delivery is not configured yet. Please try again later."
                if result.error == NOT_CONFIGURED
                else "The SMS could not be sent. Try again in a moment."
            )
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail)
    return OtpRequestOut(
        mobile=body.mobile,
        code_length=rules.otp_length,
        expires_in=rules.otp_ttl_seconds,
        resend_after=rules.otp_resend_cooldown_seconds,
    )


async def verify_code(
    request: Request, session: SessionDep, mobile: str, code: str, purpose: OtpPurpose
) -> None:
    """Consume the code or raise 401/429; shared by attendee sign-in and desk login."""
    throttle = limiter(request)
    keys = (f"otp:verify:{purpose}:{mobile}", f"otp:verify-ip:{client_ip(request)}")
    await throttle.check((keys[0], OTP_VERIFY_PER_MOBILE), (keys[1], OTP_VERIFY_PER_IP))
    if not await consume_challenge(session, request.app.state.settings, mobile, purpose, code):
        await throttle.fail(*keys)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The code is wrong or has expired.")
    await throttle.succeed(keys[0])


@router.post("/otp/verify")
async def verify_otp(body: OtpVerify, request: Request, session: SessionDep) -> OtpVerifyOut:
    await verify_code(request, session, body.mobile, body.code, "signin")
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    if user is None:
        return OtpVerifyOut(
            status="profile_required",
            signup_token=create_signup_token(body.mobile, request.app.state.settings.jwt_secret),
        )
    signed_in = _session_for(user, request)
    return OtpVerifyOut(status="signed_in", access_token=signed_in.access_token, user=signed_in.user)


@router.post("/otp/complete", status_code=status.HTTP_201_CREATED)
async def complete_signup(body: OtpComplete, request: Request, session: SessionDep) -> AuthResponse:
    """Create the account for a number verified by /otp/verify."""
    payload = decode_access_token(body.signup_token, request.app.state.settings.jwt_secret)
    mobile = payload.get("mobile") if payload and payload.get("type") == "signup" else None
    if not isinstance(mobile, str):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "The verification has expired. Request a new code."
        )
    user = User(
        mobile=mobile,
        full_name=body.full_name,
        organization=body.organization.strip(),
        title=body.title.strip(),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # The number became an account meanwhile (another tab, or an organizer added it): it is proven, sign in.
        await session.rollback()
        existing = await session.scalar(select(User).where(User.mobile == mobile))
        if existing is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Account could not be created") from None
        user = existing
    return _session_for(user, request)


@router.get("/me")
async def get_my_profile(user: CurrentUserDep) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me")
async def update_my_profile(body: ProfileUpdate, user: CurrentUserDep, session: SessionDep) -> UserOut:
    """Update the account; name, organization and title also replace the registration details of the
    person's active tickets for congresses that have not ended (past registrations keep theirs)."""
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.organization is not None:
        user.organization = body.organization
    if body.title is not None:
        user.title = body.title
    if body.share_contact_with_exhibitors is not None:
        user.share_contact_with_exhibitors = body.share_contact_with_exhibitors
    if {"full_name", "organization", "title"} & body.model_fields_set:
        await refresh_upcoming_snapshots(session, user)
    await session.commit()
    return UserOut.model_validate(user)


@router.get("/me/export")
async def export_my_data(user: CurrentUserDep, session: SessionDep) -> AccountExport:
    """A copy of everything the platform holds about the signed-in person."""
    return await export_account(session, user)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(user: CurrentUserDep, session: SessionDep) -> Response:
    """Delete the account: it is anonymised (see app/account.py) and this session stops working."""
    await delete_account(session, user)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
