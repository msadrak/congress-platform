"""Messages the console SMS provider "sent" (platform admin only).

Registered only when CONGRESS_SMS_PROVIDER=console, which production refuses. Automated staging checks and
the integration journey read sign-in codes here (via `stack.mjs sms-code`), since nothing reaches a phone.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import require_platform_admin
from app.sms import SmsProvider, sms_provider
from app.sms.phone import IranMobile, normalize_ir_mobile
from app.sms.provider import RecordingProvider

router = APIRouter(
    prefix="/api/platform", tags=["platform"], dependencies=[Depends(require_platform_admin)]
)


class RecordedSmsOut(BaseModel):
    mobile: str
    template_id: int
    params: dict[str, str]
    sent_at: datetime


@router.get("/sms-outbox")
async def recorded_sms(
    mobile: Annotated[str, Query(max_length=32)],
    provider: Annotated[SmsProvider, Depends(sms_provider)],
) -> list[RecordedSmsOut]:
    """Newest first."""
    try:
        number: IranMobile = normalize_ir_mobile(mobile)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None
    if not isinstance(provider, RecordingProvider):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not available with a real SMS provider")
    return [
        RecordedSmsOut(
            mobile=m.mobile,
            template_id=m.template_id,
            params=m.params,
            sent_at=datetime.fromtimestamp(m.at, timezone.utc),
        )
        for m in reversed(provider.sent_to(number))
    ]
