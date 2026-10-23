"""Platform-wide settings: edited in the platform console, stored in `platform_settings`, cached per process.

Every setting has an environment default (CONGRESS_*, app/config.py); a value saved in the console overrides
it. The effective configuration is loaded at startup and reloaded after each change, so the console takes
effect without a restart. Every API process also compares a fingerprint of `platform_settings` every few seconds
(CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS) and reloads when another process saved a change. Bootstrap secrets
(database, JWT secret, admin token, media root, public origin) stay in the environment: they are needed before
the database can be read, or they protect the console itself.
"""

import asyncio
import logging
from dataclasses import dataclass
from ipaddress import IPv4Network, IPv6Network
from typing import Any, Literal

from fastapi import FastAPI, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import STRICT_ENVIRONMENTS, Settings, parse_networks
from app.models import PlatformSetting
from app.secret_box import open_sealed, opening_secrets, seal, sealing_secret

logger = logging.getLogger("congress.platform")

Source = Literal["console", "environment"]
SmsMode = Literal["smsir", "console"]

SMS_MODE = "sms.mode"
SMS_API_KEY = "sms.api_key"
SMS_LINE_NUMBER = "sms.line_number"
SMS_HOURLY_CAP = "sms.hourly_cap"
SMS_DAILY_CAP = "sms.daily_cap"
# Integer sign-in rules (console key: SIGN_IN_PREFIX + name, environment: CONGRESS_<NAME>).
SIGN_IN_FIELDS = (
    "otp_length",
    "otp_ttl_seconds",
    "otp_resend_cooldown_seconds",
    "otp_sends_per_mobile_per_hour",
    "otp_sends_per_ip_per_hour",
    "otp_sends_per_trusted_ip_per_hour",
)
TRUSTED_NETWORKS = "otp_trusted_networks"
SIGN_IN_PREFIX = "sign_in."
# Sign-in codes shorter than this are refused in staging and production.
MIN_STRICT_OTP_LENGTH = 6


@dataclass(frozen=True)
class SmsConfig:
    # What the platform admin chose (or the environment default).
    mode: SmsMode
    mode_source: Source
    api_key: str | None
    api_key_source: Source | None
    # A key is stored but cannot be decrypted (the JWT secret changed): it must be entered again.
    api_key_unreadable: bool
    line_number: int | None
    line_number_source: Source | None
    # What actually happens: real delivery, test mode, or nothing can be sent yet.
    effective: Literal["smsir", "console", "unconfigured"]
    # Platform-wide SMS caps per rolling hour and day (0 = none), counted across every API process.
    hourly_cap: int = 0
    daily_cap: int = 0
    caps_source: dict[str, Source] | None = None


@dataclass(frozen=True)
class SignInConfig:
    otp_length: int
    otp_ttl_seconds: int
    otp_resend_cooldown_seconds: int
    otp_sends_per_mobile_per_hour: int
    otp_sends_per_ip_per_hour: int
    otp_sends_per_trusted_ip_per_hour: int
    # Venue networks (normalized CIDRs) with the trusted per-IP budget.
    otp_trusted_networks: tuple[str, ...]
    sources: dict[str, Source]

    @property
    def trusted_networks(self) -> tuple[IPv4Network | IPv6Network, ...]:
        return tuple(parse_networks(list(self.otp_trusted_networks)))


@dataclass(frozen=True)
class PlatformConfig:
    sms: SmsConfig
    sign_in: SignInConfig


def environment_config(settings: Settings) -> PlatformConfig:
    """The configuration from the environment alone (used until the database can be read)."""
    return _build({}, settings)


async def _stored(session: AsyncSession) -> dict[str, Any]:
    rows = await session.execute(select(PlatformSetting.key, PlatformSetting.value))
    return {key: value for key, value in rows.all()}


async def load_platform_config(session: AsyncSession, settings: Settings) -> PlatformConfig:
    return _build(await _stored(session), settings)


def _build(stored: dict[str, Any], settings: Settings) -> PlatformConfig:
    mode: SmsMode = stored.get(SMS_MODE) or settings.sms_provider
    mode_source: Source = "console" if SMS_MODE in stored else "environment"
    if mode == "console" and settings.environment == "production":
        mode = "smsir"  # never pretend to deliver in production

    api_key: str | None = None
    api_key_source: Source | None = None
    unreadable = False
    if SMS_API_KEY in stored:
        api_key = open_sealed(str(stored[SMS_API_KEY].get("sealed", "")), *opening_secrets(settings))
        unreadable = api_key is None
        api_key_source = "console"
    elif settings.smsir_api_key.strip():
        api_key, api_key_source = settings.smsir_api_key.strip(), "environment"

    line: int | None = None
    line_source: Source | None = None
    if SMS_LINE_NUMBER in stored:
        line, line_source = int(stored[SMS_LINE_NUMBER]), "console"
    elif settings.smsir_line_number is not None:
        line, line_source = settings.smsir_line_number, "environment"

    effective: Literal["smsir", "console", "unconfigured"] = (
        "console" if mode == "console" else "smsir" if api_key and line else "unconfigured"
    )
    caps: dict[str, int] = {}
    caps_source: dict[str, Source] = {}
    for name, key in (("hourly_cap", SMS_HOURLY_CAP), ("daily_cap", SMS_DAILY_CAP)):
        if key in stored:
            caps[name], caps_source[name] = int(stored[key]), "console"
        else:
            caps[name], caps_source[name] = int(getattr(settings, f"sms_{name}")), "environment"
    sms = SmsConfig(
        mode=mode, mode_source=mode_source, api_key=api_key, api_key_source=api_key_source,
        api_key_unreadable=unreadable, line_number=line, line_number_source=line_source, effective=effective,
        hourly_cap=caps["hourly_cap"], daily_cap=caps["daily_cap"], caps_source=caps_source,
    )

    values: dict[str, int] = {}
    sources: dict[str, Source] = {}
    for field in SIGN_IN_FIELDS:
        key = SIGN_IN_PREFIX + field
        if key in stored:
            values[field], sources[field] = int(stored[key]), "console"
        else:
            values[field], sources[field] = int(getattr(settings, field)), "environment"
    if settings.environment in STRICT_ENVIRONMENTS and values["otp_length"] < MIN_STRICT_OTP_LENGTH:
        values["otp_length"] = MIN_STRICT_OTP_LENGTH  # saved before the minimum existed
    raw_networks = stored.get(SIGN_IN_PREFIX + TRUSTED_NETWORKS)
    sources[TRUSTED_NETWORKS] = "console" if raw_networks is not None else "environment"
    try:
        networks = parse_networks(raw_networks if raw_networks is not None else settings.otp_trusted_networks)
    except ValueError:
        logger.warning("Ignoring unreadable trusted venue networks in the platform settings")
        networks = []
    return PlatformConfig(
        sms=sms,
        sign_in=SignInConfig(**values, otp_trusted_networks=tuple(str(n) for n in networks), sources=sources),
    )


async def put_setting(session: AsyncSession, key: str, value: Any) -> None:
    row = await session.get(PlatformSetting, key, with_for_update=True)
    if row is None:
        session.add(PlatformSetting(key=key, value=value))
    else:
        row.value = value


async def delete_setting(session: AsyncSession, key: str) -> None:
    row = await session.get(PlatformSetting, key)
    if row is not None:
        await session.delete(row)


def sealed_api_key(settings: Settings, api_key: str) -> dict[str, str]:
    return {"sealed": seal(sealing_secret(settings), api_key)}


async def reseal_api_key(session: AsyncSession, settings: Settings) -> None:
    """Seal the stored API key again with the current secret when it only opens with an older one (it was saved
    before CONGRESS_SECRET_BOX_KEY was set). A key no secret opens is left for the admin to enter again."""
    row = await session.get(PlatformSetting, SMS_API_KEY, with_for_update=True)
    if row is None:
        return
    token = str(row.value.get("sealed", ""))
    if open_sealed(token, sealing_secret(settings)) is not None:
        return
    api_key = open_sealed(token, *opening_secrets(settings))
    if api_key is not None:
        row.value = sealed_api_key(settings, api_key)


def apply_platform(app: FastAPI, config: PlatformConfig) -> PlatformConfig:
    app.state.platform = config
    sessionmaker = getattr(app.state, "sessionmaker", None)
    if sessionmaker is not None:
        app.state.limiter.bind(sessionmaker)
    # The gateway counts the platform-wide caps with the shared counters.
    app.state.sms.configure(config.sms, counters=app.state.limiter)
    return config


# Changes whenever any setting is added, changed or removed (the table holds a handful of rows).
_FINGERPRINT = text(
    "SELECT md5(COALESCE(string_agg(key || '=' || value::text, ',' ORDER BY key), '')) FROM platform_settings"
)


async def reload_platform(app: FastAPI, session: AsyncSession) -> PlatformConfig:
    """Load the effective configuration and apply it to the running process (SMS gateway included)."""
    # Taken before loading: a change saved in between makes the next check reload once more, never miss it.
    fingerprint = await session.scalar(_FINGERPRINT)
    config = apply_platform(app, await load_platform_config(session, app.state.settings))
    app.state.platform_fingerprint = fingerprint
    return config


async def keep_platform_fresh(app: FastAPI, interval_seconds: float) -> None:
    """Runs for the life of the process: applies the saved settings once the database is reachable (if it was
    not at startup) and reloads them whenever another process changed them."""
    while True:
        try:
            async with app.state.sessionmaker() as session:
                fingerprint = await session.scalar(_FINGERPRINT)
                if fingerprint != getattr(app.state, "platform_fingerprint", None):
                    await reload_platform(app, session)
                    logger.info("Platform settings loaded from the database")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("Platform settings check failed; retrying", exc_info=True)
        await asyncio.sleep(interval_seconds)


def platform_config(request: Request) -> PlatformConfig:
    config: PlatformConfig = request.app.state.platform
    return config
