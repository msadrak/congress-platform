"""The platform console's API (X-Admin-Token): SMS gateway, sign-in rules and a status overview.

Changes are stored in `platform_settings` and applied to the running process immediately
(app/platform_config.py). The sms.ir API key is write-only: it is stored encrypted and never returned, only
its last four characters. Organizer management and the SMS wording have their own routes
(app/routes/organizers.py, app/routes/sms.py), under the same token.
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.auth import require_platform_admin
from app.config import STRICT_ENVIRONMENTS, parse_networks
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.links import SAMPLE_CODE
from app.models import SmsMessage
from app.platform_config import (
    MIN_STRICT_OTP_LENGTH,
    SIGN_IN_FIELDS,
    SIGN_IN_PREFIX,
    SMS_API_KEY,
    SMS_DAILY_CAP,
    SMS_HOURLY_CAP,
    SMS_LINE_NUMBER,
    SMS_MODE,
    TRUSTED_NETWORKS,
    PlatformConfig,
    SmsMode,
    Source,
    delete_setting,
    platform_config,
    put_setting,
    reload_platform,
    reseal_api_key,
    sealed_api_key,
)
from app.rate_limit import DAY_SECONDS, LONGEST_WINDOW_SECONDS, Budget, limiter
from app.sms import SmsGateway, sms_provider
from app.sms.gateway import DAILY_KEY, HOURLY_KEY
from app.sms.outbox import link_origin, pass_link
from app.sms.phone import IranMobile
from app.sms.provider import SmsIrProvider
from app.sms.templates import SmsKind, TemplateError, platform_body, render, validate_body

router = APIRouter(prefix="/api/platform", tags=["platform"], dependencies=[Depends(require_platform_admin)])

TEST_SENDS = Budget(20, LONGEST_WINDOW_SECONDS)


class SmsSettingsOut(BaseModel):
    mode: SmsMode
    mode_source: Source
    # smsir: real delivery; console: test mode, nothing is sent; unconfigured: no key/line yet, nothing can be sent.
    effective: Literal["smsir", "console", "unconfigured"]
    api_key_set: bool
    api_key_hint: str | None
    api_key_source: Source | None
    api_key_unreadable: bool
    line_number: int | None
    line_number_source: Source | None
    # Test mode is refused in production.
    console_allowed: bool
    # Platform-wide SMS caps per rolling hour and day across every API process (0 = no cap); above a cap nothing
    # is sent (sign-in codes are refused, queued confirmations wait).
    hourly_cap: int
    daily_cap: int
    caps_source: dict[str, Source]


class SmsSettingsUpdate(BaseModel):
    mode: SmsMode | None = None
    # Write-only. Omitted: keep the current key.
    api_key: Annotated[str | None, Field(max_length=200)] = None
    line_number: Annotated[int | None, Field(gt=0)] = None
    hourly_cap: Annotated[int | None, Field(ge=0, le=1_000_000)] = None
    daily_cap: Annotated[int | None, Field(ge=0, le=10_000_000)] = None
    # Forget the console value and use the environment default again.
    reset: list[Literal["mode", "api_key", "line_number", "hourly_cap", "daily_cap"]] = []


class SmsOutboxOut(BaseModel):
    """Delivery health for the console: counts only, no numbers or message text."""

    counts: dict[str, int]
    # The longest-waiting queued message (null when nothing waits).
    oldest_pending_at: datetime | None
    # SMS counted against the platform caps in the rolling hour and day.
    sent_last_hour: int
    sent_last_day: int
    hourly_cap: int
    daily_cap: int


class SmsCheckRequest(BaseModel):
    # Try values before saving them; the current ones when omitted.
    api_key: Annotated[str | None, Field(max_length=200)] = None
    line_number: Annotated[int | None, Field(gt=0)] = None


class SmsCheckOut(BaseModel):
    ok: bool
    credit: float | None = None
    lines: list[int] = []
    # Whether the line messages are sent from belongs to this sms.ir account (None when unknown).
    line_ok: bool | None = None
    error: str | None = None


class PlatformSmsTestRequest(BaseModel):
    mobile: IranMobile
    kind: SmsKind = "otp"
    body: Annotated[str | None, Field(max_length=2000)] = None


class PlatformSmsTestOut(BaseModel):
    status: Literal["sent", "failed", "unknown"]
    text: str
    error: str | None = None
    # The gateway is in test mode: the message was only recorded, nothing reached a phone.
    test_mode: bool = False


class SignInOut(BaseModel):
    otp_length: int
    otp_ttl_seconds: int
    otp_resend_cooldown_seconds: int
    otp_sends_per_mobile_per_hour: int
    otp_sends_per_ip_per_hour: int
    # Venue networks (CIDRs) whose addresses share the higher trusted per-IP budget.
    otp_sends_per_trusted_ip_per_hour: int
    otp_trusted_networks: list[str]
    sources: dict[str, Source]


class SignInUpdate(BaseModel):
    # At least 6 in staging and production.
    otp_length: Annotated[int | None, Field(ge=4, le=8)] = None
    otp_ttl_seconds: Annotated[int | None, Field(ge=60, le=600)] = None
    otp_resend_cooldown_seconds: Annotated[int | None, Field(ge=0, le=600)] = None
    otp_sends_per_mobile_per_hour: Annotated[int | None, Field(ge=1, le=50)] = None
    otp_sends_per_ip_per_hour: Annotated[int | None, Field(ge=1, le=100_000)] = None
    otp_sends_per_trusted_ip_per_hour: Annotated[int | None, Field(ge=1, le=100_000)] = None
    otp_trusted_networks: Annotated[list[Annotated[str, Field(max_length=64)]] | None, Field(max_length=100)] = None
    reset: list[
        Literal[
            "otp_length",
            "otp_ttl_seconds",
            "otp_resend_cooldown_seconds",
            "otp_sends_per_mobile_per_hour",
            "otp_sends_per_ip_per_hour",
            "otp_sends_per_trusted_ip_per_hour",
            "otp_trusted_networks",
        ]
    ] = []


class PlatformStatusOut(BaseModel):
    environment: str
    public_origin: str | None
    # Origin of the SMS pass links when it differs from public_origin (CONGRESS_SHORT_LINK_ORIGIN).
    short_link_origin: str | None = None
    sms: SmsSettingsOut
    sign_in: SignInOut


def _sms_out(config: PlatformConfig, environment: str) -> SmsSettingsOut:
    sms = config.sms
    key = sms.api_key
    return SmsSettingsOut(
        mode=sms.mode, mode_source=sms.mode_source, effective=sms.effective,
        api_key_set=key is not None or sms.api_key_unreadable,
        api_key_hint=f"…{key[-4:]}" if key and len(key) >= 8 else None,
        api_key_source=sms.api_key_source, api_key_unreadable=sms.api_key_unreadable,
        line_number=sms.line_number, line_number_source=sms.line_number_source,
        console_allowed=environment != "production",
        hourly_cap=sms.hourly_cap, daily_cap=sms.daily_cap, caps_source=sms.caps_source or {},
    )


def _sign_in_out(config: PlatformConfig) -> SignInOut:
    rules = config.sign_in
    return SignInOut(
        **{field: getattr(rules, field) for field in SIGN_IN_FIELDS},
        otp_trusted_networks=list(rules.otp_trusted_networks),
        sources=rules.sources,
    )


def _unprocessable(code: str, detail: str) -> ApiError:
    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, code, detail)


@router.get("/status")
async def platform_status(request: Request) -> PlatformStatusOut:
    settings = request.app.state.settings
    config = platform_config(request)
    return PlatformStatusOut(
        environment=settings.environment, public_origin=settings.public_origin,
        sms=_sms_out(config, settings.environment), sign_in=_sign_in_out(config),
        short_link_origin=settings.short_link_origin,
    )


@router.get("/sms")
async def get_sms_settings(request: Request) -> SmsSettingsOut:
    return _sms_out(platform_config(request), request.app.state.settings.environment)


_SMS_KEYS = {
    "mode": SMS_MODE, "api_key": SMS_API_KEY, "line_number": SMS_LINE_NUMBER,
    "hourly_cap": SMS_HOURLY_CAP, "daily_cap": SMS_DAILY_CAP,
}


@router.put("/sms", responses=error_responses(422))
async def update_sms_settings(body: SmsSettingsUpdate, request: Request, session: SessionDep) -> SmsSettingsOut:
    settings = request.app.state.settings
    if body.mode == "console" and settings.environment == "production":
        raise _unprocessable("SMS_TEST_MODE_NOT_ALLOWED", "Test mode is not allowed in production.")
    if body.mode is not None:
        await put_setting(session, SMS_MODE, body.mode)
    if body.api_key is not None:
        key = body.api_key.strip()
        if len(key) < 8:
            raise _unprocessable("SMS_API_KEY_INVALID", "Enter the full API key from the sms.ir panel.")
        await put_setting(session, SMS_API_KEY, sealed_api_key(settings, key))
    if body.line_number is not None:
        await put_setting(session, SMS_LINE_NUMBER, body.line_number)
    for cap, value in (("hourly_cap", body.hourly_cap), ("daily_cap", body.daily_cap)):
        if value is not None:
            await put_setting(session, _SMS_KEYS[cap], value)
    for name in body.reset:
        await delete_setting(session, _SMS_KEYS[name])
    if body.api_key is None and "api_key" not in body.reset:
        await reseal_api_key(session, settings)
    await session.commit()
    config = await reload_platform(request.app, session)
    return _sms_out(config, settings.environment)


@router.post("/sms/check")
async def check_sms_connection(body: SmsCheckRequest, request: Request) -> SmsCheckOut:
    """Ask sms.ir for the account credit and lines with the given (or current) key; sends nothing."""
    current = platform_config(request).sms
    key = (body.api_key or "").strip() or current.api_key
    line = body.line_number or current.line_number
    if not key:
        return SmsCheckOut(ok=False, error="NO_API_KEY")
    provider = SmsIrProvider(
        key, line or 0, timeout=request.app.state.settings.smsir_timeout_seconds, transport=request.app.state.sms.transport
    )
    try:
        result, credit, lines = await provider.account()
    finally:
        await provider.aclose()
    if not result.ok:
        return SmsCheckOut(ok=False, error=result.error)
    return SmsCheckOut(
        ok=True, credit=credit, lines=lines,
        line_ok=(line in lines) if line is not None and lines else None,
    )


@router.get("/sms/outbox")
async def sms_outbox_health(request: Request, session: SessionDep) -> SmsOutboxOut:
    rows = await session.execute(select(SmsMessage.status, func.count()).group_by(SmsMessage.status))
    counts = dict.fromkeys(("pending", "sending", "sent", "failed", "unknown", "resolved"), 0)
    counts.update({status_: int(n) for status_, n in rows.all()})
    oldest = await session.scalar(select(func.min(SmsMessage.send_after)).where(SmsMessage.status == "pending"))
    await session.close()
    sms = platform_config(request).sms
    hour, day = await limiter(request).peek(
        (HOURLY_KEY, Budget(1, LONGEST_WINDOW_SECONDS)), (DAILY_KEY, Budget(1, DAY_SECONDS))
    )
    return SmsOutboxOut(
        counts=counts, oldest_pending_at=oldest, sent_last_hour=hour, sent_last_day=day,
        hourly_cap=sms.hourly_cap, daily_cap=sms.daily_cap,
    )


@router.post("/sms/test", responses=error_responses(422, 429))
async def send_platform_test_sms(
    body: PlatformSmsTestRequest,
    request: Request,
    session: SessionDep,
    gateway: Annotated[SmsGateway, Depends(sms_provider)],
) -> PlatformSmsTestOut:
    """Send a sample of a platform message through the gateway as it is configured now."""
    try:
        template = validate_body(body.kind, body.body) if body.body is not None else await platform_body(session, body.kind)
    except TemplateError as exc:
        raise _unprocessable("SMS_TEMPLATE_INVALID", str(exc)) from None
    await limiter(request).consume(
        ("platform:sms-test", TEST_SENDS), detail="Too many test messages. Try again later.", code="TEST_SMS_RATE_LIMITED"
    )
    rules = platform_config(request).sign_in
    origin = link_origin(request.app.state.settings, str(request.base_url))
    sample = {
        "code": "1" * rules.otp_length, "minutes": str(max(1, rules.otp_ttl_seconds // 60)),
        "name": "نام شرکت‌کننده", "event": "همایش نمونه", "tier": "عمومی", "location": "تهران",
        "booth": "غرفهٔ نمونه", "link": pass_link(origin, SAMPLE_CODE),
    }
    text = render(template, sample)
    await session.close()  # nothing is held while the provider answers
    result = await gateway.send_text(body.mobile, text, kind="test")
    outcome: Literal["sent", "failed", "unknown"] = "sent" if result.ok else "unknown" if result.unknown else "failed"
    session.add(SmsMessage(kind="test", mobile=body.mobile, body=text, status=outcome,
                           provider_message_id=result.message_id, attempts=1, last_error=result.error))
    await session.commit()
    test_mode = gateway.config is not None and gateway.config.effective == "console"
    return PlatformSmsTestOut(status=outcome, text=text, error=result.error, test_mode=test_mode)


@router.get("/sign-in")
async def get_sign_in_rules(request: Request) -> SignInOut:
    return _sign_in_out(platform_config(request))


@router.put("/sign-in", responses=error_responses(422))
async def update_sign_in_rules(body: SignInUpdate, request: Request, session: SessionDep) -> SignInOut:
    environment = request.app.state.settings.environment
    cooldown = body.otp_resend_cooldown_seconds
    if environment == "production" and cooldown is not None and cooldown < 30:
        raise _unprocessable(
            "OTP_COOLDOWN_TOO_SHORT", "In production a new code can be requested at most every 30 seconds."
        )
    if environment in STRICT_ENVIRONMENTS and body.otp_length is not None and body.otp_length < MIN_STRICT_OTP_LENGTH:
        raise _unprocessable(
            "OTP_LENGTH_TOO_SHORT", f"Sign-in codes must have at least {MIN_STRICT_OTP_LENGTH} digits in {environment}."
        )
    if body.otp_trusted_networks is not None:
        try:
            networks = [str(n) for n in parse_networks(body.otp_trusted_networks)]
        except ValueError as exc:
            raise _unprocessable("TRUSTED_NETWORK_INVALID", str(exc)) from None
        await put_setting(session, SIGN_IN_PREFIX + TRUSTED_NETWORKS, networks)
    for field in SIGN_IN_FIELDS:
        value = getattr(body, field)
        if value is not None:
            await put_setting(session, SIGN_IN_PREFIX + field, value)
    for field in body.reset:
        await delete_setting(session, SIGN_IN_PREFIX + field)
    await session.commit()
    return _sign_in_out(await reload_platform(request.app, session))
