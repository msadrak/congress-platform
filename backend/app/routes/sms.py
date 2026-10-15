"""SMS templates and delivery log: the event organizer's SMS panel and the platform-wide wording.

Messages are sent as text from the platform's sms.ir service line, so their wording is managed here
(app/sms/templates.py). Organizers edit their event's ticket confirmation, send themselves a test, and see
what was sent for their event. The platform admin sets the sign-in code text and the default confirmation.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth import require_platform_admin
from app.db import SessionDep
from app.models import SmsMessage, TicketTier
from app.rate_limit import LONGEST_WINDOW_SECONDS, Budget, limiter
from app.routes.events import OwnedEventDep
from app.sms import SmsProvider, sms_provider
from app.sms.outbox import confirmation_values
from app.sms.phone import IranMobile, mask_mobile
from app.sms.templates import (
    KINDS,
    SmsKind,
    TemplateError,
    delete_body,
    effective_body,
    platform_body,
    render,
    save_body,
    stored_body,
    validate_body,
)

router = APIRouter(tags=["sms"])
platform_router = APIRouter(
    prefix="/api/platform/sms-templates", tags=["platform"], dependencies=[Depends(require_platform_admin)]
)

EventKind = Literal["ticket_confirmation"]
TEST_SENDS_PER_EVENT = Budget(10, LONGEST_WINDOW_SECONDS)
SAMPLE_NAME = "نام شرکت‌کننده"


class SmsTemplateOut(BaseModel):
    kind: SmsKind
    body: str
    # True when this scope has its own wording; false when it falls back to the default.
    is_custom: bool
    default_body: str
    placeholders: list[str]
    required: list[str]


class SmsTemplateUpdate(BaseModel):
    body: Annotated[str, Field(max_length=2000)]


class SmsPanelOut(BaseModel):
    # smsir: messages really go out from the service line; console: test mode, nothing is sent.
    delivery: Literal["smsir", "console"]
    templates: list[SmsTemplateOut]
    # Values used for the preview and test sends (the event's own name, location, first tier and pass link).
    sample: dict[str, str]


class SmsTestRequest(BaseModel):
    mobile: IranMobile
    kind: EventKind = "ticket_confirmation"
    # An unsaved draft to try out; the saved wording when omitted.
    body: Annotated[str | None, Field(max_length=2000)] = None


class SmsTestOut(BaseModel):
    status: Literal["sent", "failed", "unknown"]
    text: str
    error: str | None = None


class SmsMessageOut(BaseModel):
    id: uuid.UUID
    kind: str
    mobile: str
    body: str | None
    status: str
    attempts: int
    last_error: str | None
    created_at: datetime
    sent_at: datetime | None


def _template_error(exc: TemplateError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


async def _event_template(session: SessionDep, kind: SmsKind, event_id: uuid.UUID) -> SmsTemplateOut:
    own = await stored_body(session, kind, event_id)
    default = await platform_body(session, kind)
    spec = KINDS[kind]
    return SmsTemplateOut(
        kind=kind, body=own or default, is_custom=own is not None, default_body=default,
        placeholders=list(spec.placeholders), required=list(spec.required),
    )


async def _platform_template(session: SessionDep, kind: SmsKind) -> SmsTemplateOut:
    own = await stored_body(session, kind, None)
    spec = KINDS[kind]
    return SmsTemplateOut(
        kind=kind, body=own or spec.default, is_custom=own is not None, default_body=spec.default,
        placeholders=list(spec.placeholders), required=list(spec.required),
    )


async def _sample(request: Request, session: SessionDep, event: OwnedEventDep) -> dict[str, str]:
    tier = await session.scalar(
        select(TicketTier.name).where(TicketTier.event_id == event.id).order_by(TicketTier.created_at).limit(1)
    )
    origin = request.app.state.settings.public_origin or str(request.base_url)
    return confirmation_values(origin, name=SAMPLE_NAME, event=event, tier_name=tier or "")


@router.get("/api/events/{event_id}/sms")
async def get_sms_panel(event: OwnedEventDep, request: Request, session: SessionDep) -> SmsPanelOut:
    return SmsPanelOut(
        delivery=request.app.state.settings.sms_provider,
        templates=[await _event_template(session, "ticket_confirmation", event.id)],
        sample=await _sample(request, session, event),
    )


@router.put("/api/events/{event_id}/sms/templates/{kind}")
async def update_event_template(
    event: OwnedEventDep, kind: EventKind, body: SmsTemplateUpdate, session: SessionDep
) -> SmsTemplateOut:
    try:
        text = validate_body(kind, body.body)
    except TemplateError as exc:
        raise _template_error(exc) from None
    await save_body(session, kind, event.id, text)
    await session.commit()
    return await _event_template(session, kind, event.id)


@router.delete("/api/events/{event_id}/sms/templates/{kind}")
async def reset_event_template(event: OwnedEventDep, kind: EventKind, session: SessionDep) -> SmsTemplateOut:
    """Back to the platform wording."""
    await delete_body(session, kind, event.id)
    await session.commit()
    return await _event_template(session, kind, event.id)


@router.post("/api/events/{event_id}/sms/test")
async def send_test_sms(
    event: OwnedEventDep,
    body: SmsTestRequest,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsProvider, Depends(sms_provider)],
) -> SmsTestOut:
    """Send the message, filled with sample values, to one number (a real SMS from the service line)."""
    throttle = limiter(request)
    key = f"sms:test:{event.id}"
    throttle.check((key, TEST_SENDS_PER_EVENT), detail="Too many test messages. Try again later.")
    try:
        template = (
            validate_body(body.kind, body.body)
            if body.body is not None
            else await effective_body(session, body.kind, event.id)
        )
    except TemplateError as exc:
        raise _template_error(exc) from None
    throttle.hit(key)
    text = render(template, await _sample(request, session, event))
    result = await provider.send_text(body.mobile, text, kind="test")
    outcome: Literal["sent", "failed", "unknown"] = "sent" if result.ok else "unknown" if result.unknown else "failed"
    session.add(
        SmsMessage(
            kind="test", mobile=body.mobile, body=text, event_id=event.id, status=outcome,
            provider_message_id=result.message_id, attempts=1, last_error=result.error,
        )
    )
    await session.commit()
    return SmsTestOut(status=outcome, text=text, error=result.error)


@router.get("/api/events/{event_id}/sms/messages")
async def list_event_sms(
    event: OwnedEventDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[SmsMessageOut]:
    """Newest first. Numbers are masked; the attendee list and CSV export carry the full numbers."""
    rows = await session.scalars(
        select(SmsMessage)
        .where(SmsMessage.event_id == event.id)
        .order_by(SmsMessage.created_at.desc())
        .limit(limit)
    )
    return [
        SmsMessageOut(
            id=m.id, kind=m.kind, mobile=mask_mobile(m.mobile), body=m.body, status=m.status,
            attempts=m.attempts, last_error=m.last_error, created_at=m.created_at, sent_at=m.sent_at,
        )
        for m in rows
    ]


@platform_router.get("")
async def list_platform_templates(session: SessionDep) -> list[SmsTemplateOut]:
    return [await _platform_template(session, kind) for kind in KINDS]


@platform_router.put("/{kind}")
async def update_platform_template(kind: SmsKind, body: SmsTemplateUpdate, session: SessionDep) -> SmsTemplateOut:
    try:
        text = validate_body(kind, body.body)
    except TemplateError as exc:
        raise _template_error(exc) from None
    await save_body(session, kind, None, text)
    await session.commit()
    return await _platform_template(session, kind)


@platform_router.delete("/{kind}")
async def reset_platform_template(kind: SmsKind, session: SessionDep) -> SmsTemplateOut:
    """Back to the built-in wording."""
    await delete_body(session, kind, None)
    await session.commit()
    return await _platform_template(session, kind)
