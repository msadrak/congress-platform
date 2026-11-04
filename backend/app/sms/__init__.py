"""SMS: Iranian mobile numbers, one-time sign-in codes and message delivery through sms.ir."""

from fastapi import Request

from app.config import Settings
from app.sms.gateway import SmsGateway
from app.sms.provider import SmsProvider

__all__ = ["SmsGateway", "SmsProvider", "build_gateway", "sms_provider"]


def build_gateway(settings: Settings) -> SmsGateway:
    """Configured from the platform settings at startup (app/platform_config.py)."""
    return SmsGateway(
        timeout=settings.smsir_timeout_seconds,
        log_text=settings.environment == "development",
        max_concurrent=settings.sms_max_concurrent_sends,
    )


def sms_provider(request: Request) -> SmsGateway:
    gateway: SmsGateway = request.app.state.sms
    return gateway
