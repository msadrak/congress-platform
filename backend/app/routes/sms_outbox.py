"""Messages the console SMS provider "sent" (platform admin only).

Never registered in production, and answers only while the SMS gateway is in test mode. Automated staging checks
and the integration journey read sign-in codes here (via `stack.mjs sms-code`), since nothing reaches a phone.
"""

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth import require_platform_admin
from app.sms import SmsGateway, sms_provider
from app.sms.phone import IranMobile, normalize_ir_mobile

router = APIRouter(
    prefix="/api/platform", tags=["platform"], dependencies=[Depends(require_platform_admin)]
)


class RecordedSmsOut(BaseModel):
    mobile: str
    kind: str
    text: str
    # Sign-in codes only, for automated checks; the console provider sends nothing.
    code: str | None
    sent_at: datetime


@router.get("/sms-outbox")
async def recorded_sms(
    mobile: Annotated[str, Query(max_length=32)],
    gateway: Annotated[SmsGateway, Depends(sms_provider)],
) -> list[RecordedSmsOut]:
    """Newest first."""
    try:
        number: IranMobile = normalize_ir_mobile(mobile)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    if gateway.config is None or gateway.config.effective != "console":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Only available while SMS is in test mode")
    return [
        RecordedSmsOut(
            mobile=m.mobile,
            kind=m.kind,
            text=m.text,
            code=m.code,
            sent_at=datetime.fromtimestamp(m.at, timezone.utc),
        )
        for m in reversed(gateway.recorder.sent_to(number))
    ]
