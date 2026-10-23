"""SMS templates and delivery log: the event organizer's SMS panel and the platform-wide wording.

Messages are sent as text from the platform's sms.ir service line, so their wording is managed here
(app/sms/templates.py). Organizers edit their event's ticket confirmation, send themselves a test, and see
what was sent for their event. The platform admin sets the sign-in code text and the default confirmation.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_platform_admin
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.links import SAMPLE_CODE
from app.models import Booth, BoothStaff, DeskOperator, ShortLink, SmsMessage, Ticket, TicketTier, User
from app.platform_config import platform_config
from app.rate_limit import DAY_SECONDS, LONGEST_WINDOW_SECONDS, Budget, limiter
from app.routes.events import OwnedEventDep
from app.sms import SmsGateway, sms_provider
from app.sms.outbox import confirmation_values, link_origin
from app.sms.phone import IranMobile, mask_mobile
from app.sms.templates import (
    EVENT_KINDS,
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

EventKind = Literal["ticket_confirmation", "ticket_cancelled", "ticket_reissued"]
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
    # What the platform gateway does now: smsir, messages really go out from the service line; console, test
    # mode, nothing is sent; unconfigured, nothing can be sent yet (queued confirmations wait).
    delivery: Literal["smsir", "console", "unconfigured"]
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
    # The gateway is in test mode: the message was only recorded, nothing reached a phone.
    test_mode: bool = False


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
    # Ticket confirmations: when the attendee first opened the pass link it carries (ADR 0015); null = not yet.
    link_opened_at: datetime | None = None
    # A queued notice that failed, or whose delivery is unknown, can be sent again (an unknown one only when the
    # organizer accepts it may arrive twice); an unknown one can also be marked resolved.
    can_retry: bool = False
    can_resolve: bool = False


class SmsRetryRequest(BaseModel):
    # Required for an `unknown` message: it may already have been delivered, so a retry may send it twice.
    confirm_duplicate: bool = False


def _template_error(exc: TemplateError) -> ApiError:
    return ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "SMS_TEMPLATE_INVALID", str(exc))


def _message_out(m: SmsMessage, link_opened_at: datetime | None) -> SmsMessageOut:
    requeueable = m.kind in EVENT_KINDS and m.body is not None
    return SmsMessageOut(
        id=m.id, kind=m.kind, mobile=mask_mobile(m.mobile), body=m.body, status=m.status,
        attempts=m.attempts, last_error=m.last_error, created_at=m.created_at, sent_at=m.sent_at,
        link_opened_at=link_opened_at,
        can_retry=requeueable and m.status in ("failed", "unknown"),
        can_resolve=m.status == "unknown",
    )


async def _may_receive_tests(session: AsyncSession, event_id: uuid.UUID, mobile: str) -> bool:
    """Test messages go only to this event's own people: its desk operators, booth staff and ticket holders."""
    operator = (
        select(DeskOperator.id)
        .join(User, DeskOperator.user_id == User.id)
        .where(DeskOperator.event_id == event_id, DeskOperator.is_revoked.is_(False), User.mobile == mobile)
    )
    staff = (
        select(BoothStaff.id)
        .join(Booth, BoothStaff.booth_id == Booth.id)
        .join(User, BoothStaff.user_id == User.id)
        .where(Booth.event_id == event_id, User.mobile == mobile)
    )
    holder = (
        select(Ticket.id)
        .join(User, Ticket.user_id == User.id)
        .where(Ticket.event_id == event_id, Ticket.status == "active", User.mobile == mobile)
    )
    return bool(await session.scalar(select(or_(exists(operator), exists(staff), exists(holder)))))


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
    origin = link_origin(request.app.state.settings, str(request.base_url))
    return confirmation_values(origin, name=SAMPLE_NAME, event=event, tier_name=tier or "", code=SAMPLE_CODE)


@router.get("/api/events/{event_id}/sms")
async def get_sms_panel(event: OwnedEventDep, request: Request, session: SessionDep) -> SmsPanelOut:
    return SmsPanelOut(
        delivery=platform_config(request).sms.effective,
        templates=[await _event_template(session, kind, event.id) for kind in EVENT_KINDS],
        sample=await _sample(request, session, event),
    )


@router.put("/api/events/{event_id}/sms/templates/{kind}", responses=error_responses(422))
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


@router.post("/api/events/{event_id}/sms/test", responses=error_responses(403, 422, 429))
async def send_test_sms(
    event: OwnedEventDep,
    body: SmsTestRequest,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsGateway, Depends(sms_provider)],
) -> SmsTestOut:
    """Send the message, filled with sample values, to one of this event's own people (a real SMS from the
    platform's service line, so never to arbitrary numbers). Limited per event and per organizer per day."""
    if not await _may_receive_tests(session, event.id, body.mobile):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "TEST_SMS_RECIPIENT_NOT_ALLOWED",
            "Test messages can only go to this event's desk operators, booth staff or ticket holders.",
        )
    try:
        template = (
            validate_body(body.kind, body.body)
            if body.body is not None
            else await effective_body(session, body.kind, event.id)
        )
    except TemplateError as exc:
        raise _template_error(exc) from None
    per_event, per_organizer = f"sms:test:{event.id}", f"sms:test:organizer:{event.organizer_id}"
    daily = Budget(request.app.state.settings.sms_test_sends_per_organizer_per_day, DAY_SECONDS)
    await limiter(request).consume(
        (per_event, TEST_SENDS_PER_EVENT),
        (per_organizer, daily),
        detail={
            per_event: "Too many test messages. Try again later.",
            per_organizer: "Your daily allowance of test messages is used up. Try again tomorrow.",
        },
        code={per_event: "TEST_SMS_RATE_LIMITED", per_organizer: "TEST_SMS_DAILY_CAP_REACHED"},
    )
    text = render(template, await _sample(request, session, event))
    event_id = event.id
    await session.close()  # nothing is held while the provider answers
    result = await provider.send_text(body.mobile, text, kind="test")
    outcome: Literal["sent", "failed", "unknown"] = "sent" if result.ok else "unknown" if result.unknown else "failed"
    session.add(
        SmsMessage(
            kind="test", mobile=body.mobile, body=text, event_id=event_id, status=outcome,
            provider_message_id=result.message_id, attempts=1, last_error=result.error,
        )
    )
    await session.commit()
    test_mode = provider.config is not None and provider.config.effective == "console"
    return SmsTestOut(status=outcome, text=text, error=result.error, test_mode=test_mode)


@router.get("/api/events/{event_id}/sms/messages")
async def list_event_sms(
    event: OwnedEventDep,
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[SmsMessageOut]:
    """Newest first. Numbers are masked; the attendee list and CSV export carry the full numbers."""
    link_opened_at = (
        select(func.min(ShortLink.first_opened_at))
        .where(ShortLink.ticket_id == SmsMessage.ticket_id)
        .correlate(SmsMessage)
        .scalar_subquery()
    )
    rows = await session.execute(
        select(SmsMessage, link_opened_at)
        .where(SmsMessage.event_id == event.id)
        .order_by(SmsMessage.created_at.desc())
        .limit(limit)
    )
    return [_message_out(m, opened) for m, opened in rows]


async def _event_message(session: AsyncSession, event_id: uuid.UUID, message_id: uuid.UUID) -> SmsMessage:
    message = await session.scalar(
        select(SmsMessage).where(SmsMessage.id == message_id, SmsMessage.event_id == event_id).with_for_update()
    )
    if message is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "SMS_MESSAGE_NOT_FOUND", "Message not found")
    return message


async def _opened_at(session: AsyncSession, message: SmsMessage) -> datetime | None:
    if message.ticket_id is None:
        return None
    opened: datetime | None = await session.scalar(
        select(func.min(ShortLink.first_opened_at)).where(ShortLink.ticket_id == message.ticket_id)
    )
    return opened


@router.post("/api/events/{event_id}/sms/messages/{message_id}/retry", responses=error_responses(404, 409))
async def retry_event_sms(
    event: OwnedEventDep, message_id: uuid.UUID, body: SmsRetryRequest, session: SessionDep
) -> SmsMessageOut:
    """Queue a failed (or, confirmed, an unknown) notice again; the outbox sends it with a fresh set of attempts."""
    message = await _event_message(session, event.id, message_id)
    if message.kind not in EVENT_KINDS or message.status not in ("failed", "unknown"):
        raise ApiError(
            status.HTTP_409_CONFLICT, "SMS_MESSAGE_NOT_RETRYABLE", "Only a failed or unknown notice can be sent again."
        )
    if message.body is None:
        raise ApiError(
            status.HTTP_409_CONFLICT, "SMS_MESSAGE_TEXT_REMOVED", "The text of this message was removed after the "
            "retention period, so it cannot be sent again."
        )
    if message.status == "unknown" and not body.confirm_duplicate:
        raise ApiError(
            status.HTTP_409_CONFLICT, "SMS_RETRY_MAY_DUPLICATE",
            "This message may already have been delivered; sending it again may deliver it twice.",
        )
    message.status, message.attempts, message.last_error = "pending", 0, None
    message.send_after, message.lease_until = datetime.now(timezone.utc), None
    await session.commit()
    return _message_out(message, await _opened_at(session, message))


@router.post("/api/events/{event_id}/sms/messages/{message_id}/resolve", responses=error_responses(404, 409))
async def resolve_event_sms(event: OwnedEventDep, message_id: uuid.UUID, session: SessionDep) -> SmsMessageOut:
    """Settle a message whose delivery is unknown (e.g. the attendee confirmed it arrived); it is never resent."""
    message = await _event_message(session, event.id, message_id)
    if message.status != "unknown":
        raise ApiError(
            status.HTTP_409_CONFLICT, "SMS_MESSAGE_NOT_UNKNOWN", "Only a message whose delivery is unknown can be resolved."
        )
    message.status = "resolved"
    await session.commit()
    return _message_out(message, await _opened_at(session, message))


@platform_router.get("")
async def list_platform_templates(session: SessionDep) -> list[SmsTemplateOut]:
    return [await _platform_template(session, kind) for kind in KINDS]


@platform_router.put("/{kind}", responses=error_responses(422))
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
