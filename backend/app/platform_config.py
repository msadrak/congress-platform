"""Platform-wide settings: edited in the platform console, stored in `platform_settings`, cached per process.

Every setting has an environment default (CONGRESS_*, app/config.py); a value saved in the console overrides
it. The effective configuration is loaded at startup and reloaded after each change, so the console takes
effect without a restart (the deployment runs a single API process). Bootstrap secrets (database, JWT secret,
admin token, media root, public origin) stay in the environment: they are needed before the database can be
read, or they protect the console itself.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import FastAPI, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import PlatformSetting
from app.secret_box import open_sealed, opening_secrets, seal, sealing_secret

logger = logging.getLogger("congress.platform")

Source = Literal["console", "environment"]
SmsMode = Literal["smsir", "console"]

SMS_MODE = "sms.mode"
SMS_API_KEY = "sms.api_key"
SMS_LINE_NUMBER = "sms.line_number"
SIGN_IN_FIELDS = (
    "otp_length",
    "otp_ttl_seconds",
    "otp_resend_cooldown_seconds",
    "otp_sends_per_mobile_per_hour",
    "otp_sends_per_ip_per_hour",
)
SIGN_IN_PREFIX = "sign_in."


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


@dataclass(frozen=True)
class SignInConfig:
    otp_length: int
    otp_ttl_seconds: int
    otp_resend_cooldown_seconds: int
    otp_sends_per_mobile_per_hour: int
    otp_sends_per_ip_per_hour: int
    sources: dict[str, Source]


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
    sms = SmsConfig(
        mode=mode, mode_source=mode_source, api_key=api_key, api_key_source=api_key_source,
        api_key_unreadable=unreadable, line_number=line, line_number_source=line_source, effective=effective,
    )

    values: dict[str, int] = {}
    sources: dict[str, Source] = {}
    for field in SIGN_IN_FIELDS:
        key = SIGN_IN_PREFIX + field
        if key in stored:
            values[field], sources[field] = int(stored[key]), "console"
        else:
            values[field], sources[field] = int(getattr(settings, field)), "environment"
    return PlatformConfig(sms=sms, sign_in=SignInConfig(**values, sources=sources))


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
    app.state.sms.configure(config.sms)
    return config


async def reload_platform(app: FastAPI, session: AsyncSession) -> PlatformConfig:
    """Load the effective configuration and apply it to the running process (SMS gateway included)."""
    return apply_platform(app, await load_platform_config(session, app.state.settings))


async def keep_loading_platform(app: FastAPI, retry_seconds: float = 5.0) -> None:
    """Started when the database was unreachable at startup: retry until the saved settings are applied."""
    while True:
        try:
            async with app.state.sessionmaker() as session:
                await reload_platform(app, session)
            logger.info("Platform settings loaded from the database")
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(retry_seconds)


def platform_config(request: Request) -> PlatformConfig:
    config: PlatformConfig = request.app.state.platform
    return config
