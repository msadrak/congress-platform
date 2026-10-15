"""SMS: Iranian mobile numbers, one-time sign-in codes and message delivery through sms.ir."""

from fastapi import Request

from app.config import Settings
from app.sms.provider import RecordingProvider, SmsIrProvider, SmsProvider

__all__ = ["SmsProvider", "build_provider", "sms_provider"]


def build_provider(settings: Settings) -> SmsProvider:
    if settings.sms_provider == "smsir":
        return SmsIrProvider(settings.smsir_api_key.strip(), timeout=settings.smsir_timeout_seconds)
    return RecordingProvider(log_parameters=settings.environment == "development")


def sms_provider(request: Request) -> SmsProvider:
    provider: SmsProvider = request.app.state.sms
    return provider
