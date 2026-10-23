import hashlib
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import DeskOperator, Organizer, OrganizerMember, SmsMessage, User
from app.rate_limit import (
    LONGEST_WINDOW_SECONDS,
    OTP_VERIFY_PER_IP,
    OTP_VERIFY_PER_MOBILE,
    Budget,
    client_ip,
    in_networks,
    ip_group,
    limiter,
)
from app.security import (
    SIGNUP_TOKEN_MINUTES,
    create_access_token,
    create_signup_token,
    decode_access_token,
    is_user_token,
)
from app.sms import SmsProvider, sms_provider
from app.sms.otp import OtpPurpose, consume_challenge, issue_challenge
from app.sms.phone import IranMobile, ascii_digits
from app.platform_config import platform_config
from app.sms.gateway import DAILY_CAP_REACHED, HOURLY_CAP_REACHED, NOT_CONFIGURED
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
    # uncertain: sms.ir did not confirm in time, so the code may still arrive (the form says so).
    delivery: Literal["sent", "uncertain"] = "sent"


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
    """Sign-in codes go to any number (that is how accounts are created). Desk and organizer codes only go to
    numbers of active desk operators or organizer members, so those forms cannot be used to spend SMS credit on
    arbitrary numbers; the response is the same either way."""
    if purpose == "signin":
        return True
    if purpose == "organizer":
        member = await session.scalar(
            select(OrganizerMember.id)
            .join(User, OrganizerMember.user_id == User.id)
            .join(Organizer, OrganizerMember.organizer_id == Organizer.id)
            .where(User.mobile == mobile, OrganizerMember.revoked_at.is_(None), Organizer.revoked_at.is_(None))
            .limit(1)
        )
        return member is not None
    operator = await session.scalar(
        select(DeskOperator.id)
        .join(User, DeskOperator.user_id == User.id)
        .where(User.mobile == mobile, DeskOperator.is_revoked.is_(False))
        .limit(1)
    )
    return operator is not None


_SEND_ERRORS: dict[str, tuple[str, str]] = {
    NOT_CONFIGURED: ("SMS_NOT_CONFIGURED", "SMS delivery is not configured yet. Please try again later."),
    HOURLY_CAP_REACHED: (
        "SMS_HOURLY_CAP_REACHED", "The platform has reached its hourly SMS limit. Please try again later."
    ),
    DAILY_CAP_REACHED: ("SMS_DAILY_CAP_REACHED", "The platform has reached its daily SMS limit. Please try again later."),
}
_SEND_FAILED = ("OTP_SEND_FAILED", "The SMS could not be sent. Try again in a moment.")


@router.post("/otp/request", status_code=status.HTTP_202_ACCEPTED, responses=error_responses(429, 503))
async def request_otp(
    body: OtpRequest,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsProvider, Depends(sms_provider)],
) -> OtpRequestOut:
    """Send a one-time code by SMS. The answer never reveals whether the number has an account.

    The code is committed and the database connection released before sms.ir is called, so a slow provider
    never holds connections the rest of the platform (check-in) needs.
    """
    settings = request.app.state.settings
    rules = platform_config(request).sign_in
    throttle = limiter(request)
    ip = client_ip(request)
    venue = in_networks(ip, rules.trusted_networks)
    # Per purpose: sign-in requests for a number cannot use up its desk-code budget, or the reverse.
    cooldown, per_mobile, per_ip = (
        f"otp:cooldown:{body.purpose}:{body.mobile}",
        f"otp:send:{body.purpose}:{body.mobile}",
        f"otp:send-ip:{'venue:' if venue else ''}{ip_group(ip)}",
    )
    ip_budget = rules.otp_sends_per_trusted_ip_per_hour if venue else rules.otp_sends_per_ip_per_hour
    await throttle.consume(
        (cooldown, Budget(1, rules.otp_resend_cooldown_seconds)),
        (per_mobile, Budget(rules.otp_sends_per_mobile_per_hour, LONGEST_WINDOW_SECONDS)),
        (per_ip, Budget(ip_budget, LONGEST_WINDOW_SECONDS)),
        detail="Too many codes requested. Wait before asking for another one.",
        code="OTP_RATE_LIMITED",
    )

    delivery: Literal["sent", "uncertain"] = "sent"
    if await _should_send(session, body.mobile, body.purpose):
        template = await platform_body(session, "otp")
        code = await issue_challenge(
            session, settings, body.mobile, body.purpose, length=rules.otp_length, ttl_seconds=rules.otp_ttl_seconds
        )
        await session.close()  # nothing is held while the provider answers
        text = render(template, {"code": code, "minutes": str(max(1, rules.otp_ttl_seconds // 60))})
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
        if result.unknown:
            delivery = "uncertain"
        elif not result.ok:
            # Nothing reached the phone: let the person retry without waiting out the resend cooldown.
            await throttle.succeed(cooldown)
            error_code, detail = _SEND_ERRORS.get(result.error or "", _SEND_FAILED)
            raise ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, error_code, detail)
    return OtpRequestOut(
        mobile=body.mobile,
        code_length=rules.otp_length,
        expires_in=rules.otp_ttl_seconds,
        resend_after=rules.otp_resend_cooldown_seconds,
        delivery=delivery,
    )


async def verify_code(
    request: Request, session: SessionDep, mobile: str, code: str, purpose: OtpPurpose
) -> None:
    """Consume the code or raise 401/429; shared by attendee sign-in and desk login.

    The lockout counts wrong codes per number and purpose from one network, so wrong codes typed elsewhere cannot
    lock the owner out; guessing stays bounded by the 5 attempts each code allows and the per-number send budget.
    """
    throttle = limiter(request)
    ip = ip_group(client_ip(request))
    keys = (f"otp:verify:{purpose}:{mobile}:{ip}", f"otp:verify-ip:{ip}")
    await throttle.check(
        (keys[0], OTP_VERIFY_PER_MOBILE), (keys[1], OTP_VERIFY_PER_IP), code="OTP_VERIFY_RATE_LIMITED"
    )
    if not await consume_challenge(session, request.app.state.settings, mobile, purpose, code):
        await throttle.fail(*keys)
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "OTP_CODE_INVALID", "The code is wrong or has expired.")
    await throttle.succeed(keys[0])


@router.post("/otp/verify", responses=error_responses(401, 429))
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


@router.post("/otp/complete", status_code=status.HTTP_201_CREATED, responses=error_responses(401))
async def complete_signup(body: OtpComplete, request: Request, session: SessionDep) -> AuthResponse:
    """Create the account for a number verified by /otp/verify. A signup token works once."""
    payload = decode_access_token(body.signup_token, request.app.state.settings.jwt_secret)
    mobile = payload.get("mobile") if payload and payload.get("type") == "signup" else None
    if not isinstance(mobile, str):
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "SIGNUP_TOKEN_EXPIRED", "The verification has expired. Request a new code."
        )
    spent = f"signup-token:{hashlib.sha256(body.signup_token.encode()).hexdigest()}"
    if not await limiter(request).claim_once(spent, SIGNUP_TOKEN_MINUTES * 60 + 60):
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED, "SIGNUP_TOKEN_USED", "This verification was already used. Request a new code."
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
