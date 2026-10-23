import hashlib
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Row, Select, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import Actor, current_actor, masked, record, set_actor
from app.auth import authorize, organizer_accepts_token, organizer_is_active, resolve_organizer_principal
from app.db import SessionDep, add_or_existing
from app.errors import ApiError, error_responses
from app.links import active_ticket_link, mint_ticket_link
from app.models import (
    CheckIn,
    CheckInPoint,
    DeskCheckIn,
    DeskIdempotencyKey,
    DeskOperator,
    EntityQR,
    Event,
    SmsMessage,
    Ticket,
    TicketPrint,
    TicketTier,
    User,
)
from app.rate_limit import LONGEST_WINDOW_SECONDS, Budget, limiter
from app.routes.auth import OtpCode, verify_code
from app.routes.checkin import CheckInPointOut, ScanSubmission, _record_scans, normalize_qr_secret
from app.routes.events import ARCHIVED_READ_ONLY, OwnedEventDep, WritableEventDep
from app.routes.participants import (
    ParticipantCancel,
    ParticipantReissue,
    ParticipantTransfer,
    ParticipantUpdate,
    apply_registration_update,
    transfer_target,
)
from app.routes.ticket_tiers import TicketTierOut
from app.security import (
    create_desk_operator_token,
    decode_access_token,
    generate_entity_qr_secret,
)
from app.sms import SmsGateway, sms_provider
from app.sms.budgets import charge_organizer_notice
from app.sms.outbox import link_origin, queue_operator_invite, queue_ticket_confirmation, ticket_confirmation_text
from app.search import fold, text_matches
from app.sms.phone import IranMobile, OptionalIranMobile, search_digits
from app.ticket_lifecycle import (
    TICKET_QR_TYPE,
    TicketStateError,
    attendee_snapshot,
    cancel_ticket,
    queue_ticket_sms,
    reactivate_ticket,
    reissue_ticket,
    transfer_ticket,
)

_bearer = HTTPBearer(auto_error=False)
router = APIRouter(tags=["desk"])

# Resending the pass link from the desk: a real SMS each time, so it is spaced out per attendee and capped per event.
PASS_SMS_COOLDOWN = Budget(1, 60)
PASS_SMS_PER_TICKET = Budget(5, LONGEST_WINDOW_SECONDS)
PASS_SMS_PER_EVENT = Budget(300, LONGEST_WINDOW_SECONDS)

# A walk-in submission retried with the same Idempotency-Key within this time returns the ticket it created.
WALK_IN_KEY_LIFETIME = timedelta(hours=24)
WalkInIdempotencyKey = Annotated[
    str | None,
    Header(
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        pattern=r"^[!-~]+$",
        description="Client-generated id of this walk-in submission (e.g. a UUID), sent again on every retry.",
    ),
]


class DeskOperatorCreate(BaseModel):
    mobile: IranMobile
    operator_name: str = Field(min_length=1, max_length=200)


class DeskOperatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    user_id: uuid.UUID
    operator_name: str
    mobile: str | None
    is_revoked: bool
    revoked_at: datetime | None
    created_at: datetime


class DeskLoginRequest(BaseModel):
    """Sign-in code requested with POST /api/auth/otp/request (purpose "desk")."""

    mobile: IranMobile
    code: OtpCode


class DeskLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    operator: DeskOperatorOut
    event_id: uuid.UUID
    event_name: str
    event_slug: str


class DeskMeOut(BaseModel):
    operator_id: uuid.UUID | None
    operator_name: str
    event_id: uuid.UUID
    event_name: str
    event_slug: str
    is_organizer_admin: bool
    # An archived congress's desk can look attendees up but changes nothing (409 EVENT_ARCHIVED).
    is_archived: bool = False


class DeskRegistrationCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    # Optional: with a number the attendee gets the pass link by SMS and can sign in later.
    mobile: OptionalIranMobile = None
    organization: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=100)
    ticket_tier_id: uuid.UUID


class DeskRegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticket_id: uuid.UUID
    attendee_name: str
    attendee_mobile: str | None
    organization: str
    title: str
    ticket_tier_name: str
    qr_secret: str
    issued_by: str | None = None
    created_at: datetime
    # The number already had a cancelled registration for this congress: it was made active again (same ticket).
    reactivated: bool = False


class AttendeeSearchItem(BaseModel):
    ticket_id: uuid.UUID
    attendee_id: uuid.UUID
    attendee_name: str
    attendee_mobile: str | None
    organization: str
    title: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    qr_secret: str
    status: str
    checkin_count: int
    issued_by: str | None = None


class PassSmsResendOut(BaseModel):
    status: Literal["sent", "failed", "unknown"]
    mobile: str
    error: str | None = None
    # The gateway is in test mode: the message was only recorded, nothing reached a phone.
    test_mode: bool = False


class ScanHistoryItem(BaseModel):
    checkin_point_name: str
    status: str
    rejection_reason: str | None
    scanned_at: datetime
    # Who admitted the attendee from the reception desk; None for a scan at a gate.
    recorded_by: str | None = None


class AttendeeDetailCard(BaseModel):
    ticket_id: uuid.UUID
    attendee_id: uuid.UUID
    attendee_name: str
    attendee_mobile: str | None
    organization: str
    title: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    qr_secret: str
    status: str
    created_at: datetime
    issued_by: str | None = None
    cancelled_at: datetime | None = None
    cancelled_reason: str | None = None
    scan_history: list[ScanHistoryItem]
    # Badges printed at the desk (first print and reprints).
    print_count: int = 0
    last_printed_at: datetime | None = None
    # The registration (name, organization, title, tier) or its QR code changed after the last print.
    needs_reprint: bool = False


class QrLookupRequest(BaseModel):
    qr: str = Field(min_length=1, max_length=512, description="The scanned badge code, as the camera or gun read it")


class DeskAdmitRequest(BaseModel):
    checkin_point_id: uuid.UUID
    scan_id: uuid.UUID | None = Field(
        default=None,
        description="Client-generated id of this admission, sent again on a retry: the first verdict is returned.",
    )


class DeskAdmitOut(BaseModel):
    scan_id: uuid.UUID
    status: str  # ADMITTED or REJECTED
    rejection_reason: str | None
    checkin_point_id: uuid.UUID
    checkin_point_name: str
    attendee_name: str | None
    ticket_tier_name: str | None


class BadgePrintOut(BaseModel):
    print_id: uuid.UUID
    reason: Literal["first", "reprint"]
    printed_at: datetime
    printed_by: str
    print_count: int


class AuthorizedDeskContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    event: Event
    operator: DeskOperator | None = None
    is_organizer_admin: bool = False
    operator_name: str


async def authorized_desk_operator(
    event_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthorizedDeskContext:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing front desk authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    token = credentials.credentials
    jwt_secret: str = request.app.state.settings.jwt_secret

    # 1. Attempt validation as Desk Operator JWT
    payload = decode_access_token(token, jwt_secret)
    if payload is not None and payload.get("type") == "desk_operator":
        token_event_id = payload.get("event_id")
        operator_id_str = payload.get("operator_id")

        if token_event_id != str(event.id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Operator token is not authorized for this event",
            )

        try:
            operator_uuid = uuid.UUID(str(operator_id_str))
        except (ValueError, TypeError):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, "Invalid operator token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        operator = await session.get(DeskOperator, operator_uuid)
        if operator is None or operator.event_id != event.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Operator is not assigned to this event",
            )

        if operator.is_revoked:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Front desk operator access has been revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token_version = payload.get("session_version")
        if (
            type(token_version) is not int
            or token_version < 0
            or token_version != operator.session_version
        ):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Front desk session has been superseded or is invalid",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not await organizer_accepts_token(session, event.organizer_id, payload.get("iat")):
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Front desk session is no longer valid",
                headers={"WWW-Authenticate": "Bearer"},
            )

        set_actor(request, Actor("desk_operator", str(operator.id), operator.operator_name, event.organizer_id))
        return AuthorizedDeskContext(
            event=event,
            operator=operator,
            is_organizer_admin=False,
            operator_name=operator.operator_name,
        )

    # 2. The organizer itself: its API key or a member session with a role that runs the desk (app.roles).
    principal = await resolve_organizer_principal(session, request, token)
    if principal is not None:
        if principal.organizer.id != event.organizer_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
        authorize(request, principal)
        return AuthorizedDeskContext(
            event=event,
            operator=None,
            is_organizer_admin=True,
            operator_name=principal.member.display_name if principal.member else "مدیر ارشد سازمان (Organizer Admin)",
        )

    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Invalid front desk operator credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


AuthorizedDeskDep = Annotated[AuthorizedDeskContext, Depends(authorized_desk_operator)]


async def writable_desk(desk_ctx: AuthorizedDeskDep) -> AuthorizedDeskContext:
    """The desk of a congress that accepts changes: an archived congress's desk can only look things up (409)."""
    if desk_ctx.event.archived_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "EVENT_ARCHIVED", ARCHIVED_READ_ONLY)
    return desk_ctx


WritableDeskDep = Annotated[AuthorizedDeskContext, Depends(writable_desk)]

async def _consume_notice_budget(desk_ctx: AuthorizedDeskContext, request: Request) -> None:
    """SMS notices a desk change sends (cancel, reissue, transfer, a resent pass) count against the organizer's
    hourly notice allowance like its own console's (app.sms.budgets; 429 SMS_NOTICE_LIMIT_REACHED), so a desk
    cannot run the platform's SMS allowance down. Without an SMS the change is free."""
    await charge_organizer_notice(request, desk_ctx.event.organizer_id)


# -----------------------------------------------------------------------------
# Operator Authentication & Management Routes
# -----------------------------------------------------------------------------

@router.post("/api/events/{event_id}/desk/login")
async def desk_operator_login(
    event_id: uuid.UUID,
    body: DeskLoginRequest,
    request: Request,
    session: SessionDep,
) -> DeskLoginResponse:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    await verify_code(request, session, body.mobile, body.code, "desk")
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    if user is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "User is not registered as a front desk operator for this event",
        )

    operator = await session.scalar(
        select(DeskOperator).where(
            DeskOperator.event_id == event.id,
            DeskOperator.user_id == user.id,
        )
    )
    if operator is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "User is not registered as a front desk operator for this event",
        )

    if operator.is_revoked:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Front desk operator access has been revoked",
        )
    if not await organizer_is_active(session, event.organizer_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Front desk access for this event is suspended",
        )

    jwt_secret: str = request.app.state.settings.jwt_secret
    access_token = create_desk_operator_token(
        operator_id=operator.id,
        event_id=event.id,
        user_id=user.id,
        session_version=operator.session_version,
        secret=jwt_secret,
        operator_name=operator.operator_name,
    )

    op_out = DeskOperatorOut(
        id=operator.id,
        event_id=operator.event_id,
        user_id=operator.user_id,
        operator_name=operator.operator_name,
        mobile=user.mobile,
        is_revoked=operator.is_revoked,
        revoked_at=operator.revoked_at,
        created_at=operator.created_at,
    )
    return DeskLoginResponse(
        access_token=access_token,
        token_type="bearer",
        operator=op_out,
        event_id=event.id,
        event_name=event.name,
        event_slug=event.slug,
    )


@router.get("/api/events/{event_id}/desk/me")
async def get_current_desk_operator(
    desk_ctx: AuthorizedDeskDep,
) -> DeskMeOut:
    return DeskMeOut(
        operator_id=desk_ctx.operator.id if desk_ctx.operator else None,
        operator_name=desk_ctx.operator_name,
        event_id=desk_ctx.event.id,
        event_name=desk_ctx.event.name,
        event_slug=desk_ctx.event.slug,
        is_organizer_admin=desk_ctx.is_organizer_admin,
        is_archived=desk_ctx.event.archived_at is not None,
    )


@router.get("/api/events/{event_id}/desk/tiers")
async def list_desk_ticket_tiers(
    desk_ctx: AuthorizedDeskDep,
    session: SessionDep,
) -> list[TicketTierOut]:
    tiers = await session.scalars(
        select(TicketTier)
        .where(TicketTier.event_id == desk_ctx.event.id)
        .order_by(TicketTier.created_at, TicketTier.id)
    )
    return [TicketTierOut.model_validate(tier) for tier in tiers]

@router.get("/api/events/{event_id}/desk/operators")
async def list_desk_operators(
    event: OwnedEventDep,
    session: SessionDep,
) -> list[DeskOperatorOut]:
    query = (
        select(DeskOperator, User.mobile)
        .join(User, DeskOperator.user_id == User.id)
        .where(DeskOperator.event_id == event.id)
        .order_by(DeskOperator.created_at)
    )
    res = await session.execute(query)
    rows = res.all()
    return [
        DeskOperatorOut(
            id=op.id,
            event_id=op.event_id,
            user_id=op.user_id,
            operator_name=op.operator_name,
            mobile=mobile,
            is_revoked=op.is_revoked,
            revoked_at=op.revoked_at,
            created_at=op.created_at,
        )
        for op, mobile in rows
    ]


@router.post(
    "/api/events/{event_id}/desk/operators",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(status.HTTP_409_CONFLICT),
)
async def add_desk_operator(
    event: WritableEventDep,
    body: DeskOperatorCreate,
    request: Request,
    session: SessionDep,
) -> DeskOperatorOut:
    """Authorize a person (by mobile) for this event's front desk and text them the reception link
    (`operator_invite`); they sign in there with an SMS code to this number."""
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    if user is None:
        # A concurrent request may create the account for this number first; then that account is used.
        account, _ = await add_or_existing(
            session, User(mobile=body.mobile, full_name=body.operator_name.strip()),
            select(User).where(User.mobile == body.mobile),
        )
        user = account

    existing_op = await session.scalar(
        select(DeskOperator).where(
            DeskOperator.event_id == event.id,
            DeskOperator.user_id == user.id,
        ).with_for_update()
    )
    if existing_op is not None:
        if existing_op.is_revoked:
            existing_op.is_revoked = False
            existing_op.session_version += 1
            existing_op.revoked_at = None
            existing_op.operator_name = body.operator_name.strip()
            await _invite_operator(session, request, existing_op, user, event)
            await session.commit()
            return DeskOperatorOut(
                id=existing_op.id,
                event_id=existing_op.event_id,
                user_id=existing_op.user_id,
                operator_name=existing_op.operator_name,
                mobile=user.mobile,
                is_revoked=existing_op.is_revoked,
                revoked_at=existing_op.revoked_at,
                created_at=existing_op.created_at,
            )
        raise ApiError(status.HTTP_409_CONFLICT, "OPERATOR_ALREADY_ASSIGNED", "Operator is already assigned to this event")

    operator, created = await add_or_existing(
        session,
        DeskOperator(event_id=event.id, user_id=user.id, operator_name=body.operator_name.strip(), is_revoked=False),
        select(DeskOperator).where(DeskOperator.event_id == event.id, DeskOperator.user_id == user.id),
    )
    if not created:  # assigned by a concurrent request a moment ago
        raise ApiError(status.HTTP_409_CONFLICT, "OPERATOR_ALREADY_ASSIGNED", "Operator is already assigned to this event")
    await _invite_operator(session, request, operator, user, event)
    await session.commit()
    await session.refresh(operator)

    return DeskOperatorOut(
        id=operator.id,
        event_id=operator.event_id,
        user_id=operator.user_id,
        operator_name=operator.operator_name,
        mobile=user.mobile,
        is_revoked=operator.is_revoked,
        revoked_at=operator.revoked_at,
        created_at=operator.created_at,
    )


async def _invite_operator(
    session: AsyncSession, request: Request, operator: DeskOperator, user: User, event: Event
) -> None:
    await queue_operator_invite(
        session, request.app.state.settings, str(request.base_url),
        mobile=user.mobile, name=operator.operator_name, event=event,
    )


def _operator_out(operator: DeskOperator, mobile: str | None) -> DeskOperatorOut:
    return DeskOperatorOut(
        id=operator.id,
        event_id=operator.event_id,
        user_id=operator.user_id,
        operator_name=operator.operator_name,
        mobile=mobile,
        is_revoked=operator.is_revoked,
        revoked_at=operator.revoked_at,
        created_at=operator.created_at,
    )


@router.post(
    "/api/events/{event_id}/desk/operators/{operator_id}/restore",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def restore_desk_operator(
    event: WritableEventDep,
    operator_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> DeskOperatorOut:
    """Give a revoked operator their access back and text them the reception link again. Sessions from before
    the revocation stay invalid: the operator signs in afresh."""
    operator = await session.scalar(
        select(DeskOperator).where(DeskOperator.id == operator_id, DeskOperator.event_id == event.id).with_for_update()
    )
    if operator is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "OPERATOR_NOT_FOUND", "Desk operator not found")
    if not operator.is_revoked:
        raise ApiError(status.HTTP_409_CONFLICT, "OPERATOR_NOT_REVOKED", "This operator's access is not revoked")
    operator.is_revoked = False
    operator.revoked_at = None
    operator.session_version += 1
    user = await session.get(User, operator.user_id)
    if user is not None:
        await _invite_operator(session, request, operator, user, event)
    record(
        session, request, "desk.operator_restored", entity_type="desk_operator", entity_id=operator.id,
        summary={"operator_name": operator.operator_name},
    )
    await session.commit()
    return _operator_out(operator, user.mobile if user else None)


@router.post("/api/events/{event_id}/desk/operators/{operator_id}/revoke")
@router.delete("/api/events/{event_id}/desk/operators/{operator_id}")
async def revoke_desk_operator(
    event: OwnedEventDep,
    operator_id: uuid.UUID,
    session: SessionDep,
) -> DeskOperatorOut:
    operator = await session.scalar(
        select(DeskOperator).where(
            DeskOperator.id == operator_id,
            DeskOperator.event_id == event.id,
        ).with_for_update()
    )
    if operator is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Desk operator not found")

    user = await session.get(User, operator.user_id)
    mobile = user.mobile if user else None

    operator.is_revoked = True
    operator.session_version += 1
    operator.revoked_at = datetime.now(timezone.utc)
    await session.commit()

    return DeskOperatorOut(
        id=operator.id,
        event_id=operator.event_id,
        user_id=operator.user_id,
        operator_name=operator.operator_name,
        mobile=mobile,
        is_revoked=operator.is_revoked,
        revoked_at=operator.revoked_at,
        created_at=operator.created_at,
    )


# -----------------------------------------------------------------------------
# Protected Reception Operations (AuthorizedDeskDep)
# -----------------------------------------------------------------------------

async def _claim_walk_in_key(
    session: AsyncSession, desk_ctx: AuthorizedDeskContext, key: str, body: DeskRegistrationCreate
) -> tuple[uuid.UUID | None, DeskRegistrationOut | None]:
    """Claim the key for this request (returns its row id) or, when a committed request already used it, the
    registration that request created. A concurrent request holding the key is waited for by the INSERT."""
    event = desk_ctx.event
    actor = f"operator:{desk_ctx.operator.id}" if desk_ctx.operator else "organizer"
    request_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    now = datetime.now(timezone.utc)
    await session.execute(
        delete(DeskIdempotencyKey).where(DeskIdempotencyKey.event_id == event.id, DeskIdempotencyKey.expires_at <= now)
    )
    claimed = await session.scalar(
        pg_insert(DeskIdempotencyKey)
        .values(
            id=uuid.uuid4(), event_id=event.id, actor=actor, key=key, request_hash=request_hash,
            expires_at=now + WALK_IN_KEY_LIFETIME,
        )
        .on_conflict_do_nothing(constraint="uq_desk_idempotency_keys_scope")
        .returning(DeskIdempotencyKey.id)
    )
    if claimed is not None:
        return claimed, None

    stored = await session.scalar(
        select(DeskIdempotencyKey).where(
            DeskIdempotencyKey.event_id == event.id, DeskIdempotencyKey.actor == actor, DeskIdempotencyKey.key == key
        )
    )
    if stored is None or stored.ticket_id is None:
        raise ApiError(
            status.HTTP_409_CONFLICT, "IDEMPOTENCY_KEY_IN_PROGRESS",
            "A registration with this Idempotency-Key is still being processed. Try again.",
        )
    if stored.request_hash != request_hash:
        raise ApiError(
            status.HTTP_409_CONFLICT, "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used for a different registration",
        )
    ticket, tier_name, secret = (
        await session.execute(
            select(Ticket, TicketTier.name, EntityQR.secret)
            .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
            .join(EntityQR, (EntityQR.entity_id == Ticket.id) & (EntityQR.entity_type == "attendee_ticket"))
            .where(Ticket.id == stored.ticket_id)
        )
    ).one()
    # The same answer as the original request, which echoed the submitted details.
    return None, DeskRegistrationOut(
        ticket_id=ticket.id,
        attendee_name=body.full_name.strip(),
        attendee_mobile=body.mobile,
        organization=body.organization.strip(),
        title=body.title.strip(),
        ticket_tier_name=tier_name,
        qr_secret=secret,
        issued_by=desk_ctx.operator_name,
        created_at=ticket.created_at,
    )


async def _tier_unavailable(session: AsyncSession, event: Event, tier_id: uuid.UUID) -> ApiError:
    """Why a place in the tier could not be taken, with the codes (and statuses) of the attendee reservation."""
    tier = await session.get(TicketTier, tier_id)
    if tier is None or tier.event_id != event.id:
        return ApiError(status.HTTP_404_NOT_FOUND, "TIER_NOT_FOUND", "Ticket tier not found")
    if not tier.is_open:
        return ApiError(status.HTTP_400_BAD_REQUEST, "TIER_CLOSED", "Ticket tier is closed for registration")
    return ApiError(status.HTTP_410_GONE, "TIER_SOLD_OUT", "Ticket tier is sold out / quota exhausted")


async def _reactivate_walk_in(
    session: AsyncSession,
    request: Request,
    desk_ctx: AuthorizedDeskContext,
    body: DeskRegistrationCreate,
    ticket: Ticket,
    user: User,
    key_id: uuid.UUID | None,
) -> DeskRegistrationOut:
    """A walk-in for someone whose registration for this congress was cancelled: the same ticket becomes active
    again in the chosen tier (taking a place), with a new pass and a confirmation SMS (app.ticket_lifecycle)."""
    event = desk_ctx.event
    try:
        secret, code = await reactivate_ticket(session, ticket, body.ticket_tier_id, user, event)
    except TicketStateError:
        raise await _tier_unavailable(session, event, body.ticket_tier_id) from None
    ticket.issued_by_operator_id = desk_ctx.operator.id if desk_ctx.operator else None
    if key_id is not None:
        await session.execute(
            update(DeskIdempotencyKey).where(DeskIdempotencyKey.id == key_id).values(ticket_id=ticket.id)
        )
    # Without ticket_id: the ticket's first confirmation already holds the one (kind, ticket) row.
    await queue_ticket_sms(
        session, link_origin(request.app.state.settings, str(request.base_url)), "ticket_confirmation",
        mobile=user.mobile, name=ticket.attendee_full_name, event=event, ticket=ticket, code=code,
    )
    tier_name = await session.scalar(select(TicketTier.name).where(TicketTier.id == body.ticket_tier_id))
    await session.commit()
    return DeskRegistrationOut(
        ticket_id=ticket.id,
        attendee_name=body.full_name.strip(),
        attendee_mobile=body.mobile,
        organization=body.organization.strip(),
        title=body.title.strip(),
        ticket_tier_name=tier_name or "",
        qr_secret=secret,
        issued_by=desk_ctx.operator_name,
        created_at=ticket.created_at,
        reactivated=True,
    )


@router.post(
    "/api/events/{event_id}/desk-registrations",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT, status.HTTP_410_GONE
    ),
)
async def create_desk_registration(
    desk_ctx: WritableDeskDep,
    body: DeskRegistrationCreate,
    request: Request,
    response: Response,
    session: SessionDep,
    idempotency_key: WalkInIdempotencyKey = None,
) -> DeskRegistrationOut:
    event = desk_ctx.event

    # 0. A retried submission (same Idempotency-Key) returns the ticket the first attempt created.
    key_id: uuid.UUID | None = None
    if idempotency_key is not None:
        key_id, replay = await _claim_walk_in_key(session, desk_ctx, idempotency_key, body)
        if replay is not None:
            response.headers["Idempotent-Replayed"] = "true"
            return replay

    # 1. Resolve User: an existing account with this mobile, or a new one (no mobile = cannot sign in later)
    user = None
    if body.mobile:
        user = await session.scalar(select(User).where(User.mobile == body.mobile))

    if user is None:
        user = User(
            mobile=body.mobile,
            full_name=body.full_name.strip(),
            organization=body.organization.strip(),
            title=body.title.strip(),
        )
        session.add(user)
        try:
            async with session.begin_nested():
                await session.flush()
        except IntegrityError:
            user = await session.scalar(select(User).where(User.mobile == body.mobile))
            if user is None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "User creation failed"
                ) from None

    # 2. One registration per person and congress: an active one is a conflict, a cancelled one is reactivated.
    existing_ticket = await session.scalar(
        select(Ticket).where(
            Ticket.event_id == event.id, Ticket.user_id == user.id
        ).with_for_update()
    )
    if existing_ticket is not None:
        if existing_ticket.status == "active":
            raise ApiError(
                status.HTTP_409_CONFLICT, "ALREADY_REGISTERED", "Attendee already has an active ticket for this congress"
            )
        return await _reactivate_walk_in(session, request, desk_ctx, body, existing_ticket, user, key_id)

    # 3. Atomic inventory decrement on TicketTier
    stmt = (
        update(TicketTier)
        .where(
            TicketTier.id == body.ticket_tier_id,
            TicketTier.event_id == event.id,
            TicketTier.is_open.is_(True),
            TicketTier.reserved_count < TicketTier.quota,
        )
        .values(reserved_count=TicketTier.reserved_count + 1)
        .returning(TicketTier.name)
    )
    res = await session.execute(stmt)
    tier_name = res.scalar_one_or_none()

    if tier_name is None:
        raise await _tier_unavailable(session, event, body.ticket_tier_id)

    # 4. Mint Ticket with Operator Attribution
    operator_id = desk_ctx.operator.id if desk_ctx.operator else None
    ticket = Ticket(
        event_id=event.id,
        ticket_tier_id=body.ticket_tier_id,
        user_id=user.id,
        status="active",
        issued_by_operator_id=operator_id,
        **attendee_snapshot(user),
    )
    session.add(ticket)
    try:
        await session.flush()
    except IntegrityError:
        # A concurrent registration gave this attendee a ticket a moment ago; raising also returns the seat.
        raise ApiError(
            status.HTTP_409_CONFLICT, "ALREADY_REGISTERED", "Attendee already has an active ticket for this congress"
        ) from None
    if key_id is not None:
        await session.execute(
            update(DeskIdempotencyKey).where(DeskIdempotencyKey.id == key_id).values(ticket_id=ticket.id)
        )

    # 5. Mint polymorphic EntityQR
    secret = generate_entity_qr_secret()
    qr = EntityQR(
        secret=secret,
        entity_type="attendee_ticket",
        entity_id=ticket.id,
        is_active=True,
    )
    session.add(qr)
    link = await mint_ticket_link(session, ticket, event)
    await queue_ticket_confirmation(
        session, request.app.state.settings, str(request.base_url), user=user, event=event, ticket=ticket,
        code=link.code,
    )
    await session.commit()

    # The pass shows what the desk typed. When the number already has an account, the account keeps its own
    # profile, which is not echoed back: typing a number must not reveal who holds it.
    return DeskRegistrationOut(
        ticket_id=ticket.id,
        attendee_name=body.full_name.strip(),
        attendee_mobile=body.mobile,
        organization=body.organization.strip(),
        title=body.title.strip(),
        ticket_tier_name=tier_name,
        qr_secret=secret,
        issued_by=desk_ctx.operator_name,
        created_at=ticket.created_at,
    )


def _attendee_query(event_id: uuid.UUID) -> Select[Ticket, User, TicketTier, EntityQR, str]:
    """A congress's tickets with their holder, tier, pass QR and the operator who issued a walk-in."""
    return (
        select(Ticket, User, TicketTier, EntityQR, DeskOperator.operator_name)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(EntityQR, (EntityQR.entity_id == Ticket.id) & (EntityQR.entity_type == TICKET_QR_TYPE))
        .outerjoin(DeskOperator, Ticket.issued_by_operator_id == DeskOperator.id)
        .where(Ticket.event_id == event_id)
    )


async def _search_items(
    session: AsyncSession, event: Event, rows: Sequence[Row[Ticket, User, TicketTier, EntityQR, str]]
) -> list[AttendeeSearchItem]:
    # Admissions of the listed tickets at this event's check-in points (ix_checkins_ticket_id).
    scan_counts: dict[uuid.UUID, int] = {}
    if rows:
        counts = await session.execute(
            select(CheckIn.ticket_id, func.count(CheckIn.id))
            .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
            .where(
                CheckIn.ticket_id.in_([row[0].id for row in rows]),
                CheckIn.status == "ADMITTED",
                CheckIn.direction == "IN",
                CheckInPoint.event_id == event.id,
            )
            .group_by(CheckIn.ticket_id)
        )
        scan_counts = {ticket_id: count for ticket_id, count in counts if ticket_id is not None}

    return [
        AttendeeSearchItem(
            ticket_id=ticket.id,
            attendee_id=user.id,
            attendee_name=ticket.attendee_full_name,
            attendee_mobile=user.mobile,
            organization=ticket.attendee_organization,
            title=ticket.attendee_title,
            ticket_tier_id=tier.id,
            ticket_tier_name=tier.name,
            qr_secret=qr.secret,
            status=ticket.status,
            checkin_count=scan_counts.get(ticket.id, 0),
            issued_by=op_name,
        )
        for ticket, user, tier, qr, op_name in rows
    ]


@router.get("/api/events/{event_id}/attendees")
async def search_event_attendees(
    desk_ctx: AuthorizedDeskDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AttendeeSearchItem]:
    """Newest first. Names, organizations and titles match Persian-folded and literally (app.search: ي/ك typed on
    an Arabic keyboard find ی/ک, `%` and `_` are not wildcards); a run of digits also matches the mobile."""
    event = desk_ctx.event
    term = fold(q)
    query = _attendee_query(event.id)
    if term:
        digits = search_digits(q)
        query = query.where(
            or_(
                text_matches(term, Ticket.attendee_full_name, Ticket.attendee_organization, Ticket.attendee_title),
                *([User.mobile.contains(digits, autoescape=True)] if digits else []),
            )
        )
    rows = (await session.execute(query.order_by(Ticket.created_at.desc()).limit(limit))).all()
    return await _search_items(session, event, rows)


@router.post("/api/events/{event_id}/attendees/qr-lookup", responses=error_responses(status.HTTP_404_NOT_FOUND))
async def lookup_attendee_by_qr(
    desk_ctx: AuthorizedDeskDep,
    body: QrLookupRequest,
    session: SessionDep,
) -> AttendeeSearchItem:
    """The ticket whose badge was scanned into the desk search (camera or barcode gun). The code is normalized
    exactly as the gate scanner does (`normalize_qr_secret`). A cancelled ticket's badge is found and shown as
    cancelled; a replaced (reissued) badge, or another congress's, is not found. Sent in the body: a QR secret is
    a credential and never appears in a URL."""
    event = desk_ctx.event
    row = (
        await session.execute(_attendee_query(event.id).where(EntityQR.secret == normalize_qr_secret(body.qr)))
    ).one_or_none()
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "ATTENDEE_QR_NOT_FOUND", "No ticket of this congress has this QR code")
    (item,) = await _search_items(session, event, [row])
    return item


@router.get("/api/events/{event_id}/desk/checkin-points")
async def list_desk_checkin_points(desk_ctx: AuthorizedDeskDep, session: SessionDep) -> list[CheckInPointOut]:
    """Where the desk can admit an attendee ("admit at point X")."""
    points = await session.scalars(
        select(CheckInPoint).where(CheckInPoint.event_id == desk_ctx.event.id).order_by(CheckInPoint.created_at)
    )
    return [CheckInPointOut.model_validate(point) for point in points]


def badge_fingerprint(ticket: Ticket, qr_secret: str) -> str:
    """What a printed badge shows (registration name, organization, title, tier and QR code), as a hash."""
    content = "\x1f".join(
        (ticket.attendee_full_name, ticket.attendee_organization, ticket.attendee_title, str(ticket.ticket_tier_id), qr_secret)
    )
    return hashlib.sha256(content.encode()).hexdigest()


async def _attendee_card(session: AsyncSession, event: Event, ticket_id: uuid.UUID) -> AttendeeDetailCard:
    row = (await session.execute(_attendee_query(event.id).where(Ticket.id == ticket_id))).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendee ticket not found")
    ticket, user, tier, qr, op_name = row

    history = await session.execute(
        select(CheckIn, CheckInPoint.name, DeskCheckIn.actor_label)
        .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
        .outerjoin(DeskCheckIn, DeskCheckIn.checkin_id == CheckIn.id)
        .where(CheckIn.ticket_id == ticket.id)
        .order_by(CheckIn.scanned_at.desc())
    )
    print_count, last_printed_at = (
        await session.execute(
            select(func.count(TicketPrint.id), func.max(TicketPrint.printed_at)).where(TicketPrint.ticket_id == ticket.id)
        )
    ).one()
    last_fingerprint = await session.scalar(
        select(TicketPrint.content_fingerprint)
        .where(TicketPrint.ticket_id == ticket.id)
        .order_by(TicketPrint.printed_at.desc(), TicketPrint.id.desc())
        .limit(1)
    )
    return AttendeeDetailCard(
        ticket_id=ticket.id,
        attendee_id=user.id,
        attendee_name=ticket.attendee_full_name,
        attendee_mobile=user.mobile,
        organization=ticket.attendee_organization,
        title=ticket.attendee_title,
        ticket_tier_id=tier.id,
        ticket_tier_name=tier.name,
        qr_secret=qr.secret,
        status=ticket.status,
        created_at=ticket.created_at,
        issued_by=op_name,
        cancelled_at=ticket.cancelled_at,
        cancelled_reason=ticket.cancelled_reason,
        scan_history=[
            ScanHistoryItem(
                checkin_point_name=point_name,
                status=checkin.status,
                rejection_reason=checkin.rejection_reason,
                scanned_at=checkin.scanned_at,
                recorded_by=recorded_by,
            )
            for checkin, point_name, recorded_by in history.all()
        ],
        print_count=print_count or 0,
        last_printed_at=last_printed_at,
        needs_reprint=(
            last_fingerprint is not None
            and ticket.status == "active"
            and last_fingerprint != badge_fingerprint(ticket, qr.secret)
        ),
    )


async def _desk_ticket(session: AsyncSession, event: Event, ticket_id: uuid.UUID) -> Ticket:
    """This congress's ticket, locked for the change; another congress's is not found (participants API codes)."""
    ticket = await session.scalar(
        select(Ticket).where(Ticket.id == ticket_id, Ticket.event_id == event.id).with_for_update()
    )
    if ticket is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "PARTICIPANT_NOT_FOUND", "Participant not found")
    return ticket


async def _active_secret(session: AsyncSession, ticket: Ticket) -> str | None:
    """The ticket's current pass QR secret while the ticket is active."""
    if ticket.status != "active":
        return None
    secret: str | None = await session.scalar(
        select(EntityQR.secret).where(
            EntityQR.entity_type == TICKET_QR_TYPE, EntityQR.entity_id == ticket.id, EntityQR.is_active.is_(True)
        )
    )
    return secret


def _state_conflict(message: str) -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, "TICKET_STATE_CONFLICT", message)


def _sms_origin(request: Request) -> str:
    return link_origin(request.app.state.settings, str(request.base_url))


DESK_NOT_FOUND = error_responses(status.HTTP_404_NOT_FOUND)
DESK_NOT_FOUND_OR_CONFLICT = error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT)
DESK_NOTICE_RESPONSES = error_responses(
    status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT, status.HTTP_429_TOO_MANY_REQUESTS
)


@router.get("/api/events/{event_id}/attendees/{ticket_id}")
async def get_attendee_ticket_detail(
    desk_ctx: AuthorizedDeskDep,
    ticket_id: uuid.UUID,
    session: SessionDep,
) -> AttendeeDetailCard:
    return await _attendee_card(session, desk_ctx.event, ticket_id)


@router.patch("/api/events/{event_id}/attendees/{ticket_id}", responses=DESK_NOT_FOUND)
async def update_attendee_registration(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    body: ParticipantUpdate,
    request: Request,
    session: SessionDep,
) -> AttendeeDetailCard:
    """Correct the registration's name, organization or title for this congress (the person's account is not
    changed). A badge printed before the change is then flagged `needs_reprint`."""
    ticket = await _desk_ticket(session, desk_ctx.event, ticket_id)
    changed = apply_registration_update(ticket, body)
    if changed:
        record(
            session, request, "desk.registration_edited", entity_type="ticket", entity_id=ticket.id,
            summary={"fields": changed},
        )
    await session.commit()
    return await _attendee_card(session, desk_ctx.event, ticket_id)


@router.post("/api/events/{event_id}/attendees/{ticket_id}/cancel", responses=DESK_NOTICE_RESPONSES)
async def cancel_attendee_ticket(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    body: ParticipantCancel,
    request: Request,
    session: SessionDep,
) -> AttendeeDetailCard:
    """Cancel the ticket: its place returns to the tier and its pass stops working (app.ticket_lifecycle)."""
    event = desk_ctx.event
    ticket = await _desk_ticket(session, event, ticket_id)
    if body.notify and ticket.status == "active":
        await _consume_notice_budget(desk_ctx, request)
    try:
        await cancel_ticket(
            session, ticket, actor="organizer", reason=body.reason,
            notify=(_sms_origin(request), event) if body.notify else None,
        )
    except TicketStateError as exc:
        raise _state_conflict(str(exc)) from None
    record(
        session, request, "desk.ticket_cancelled", entity_type="ticket", entity_id=ticket.id,
        summary={"reason": body.reason, "notify": body.notify},
    )
    await session.commit()
    return await _attendee_card(session, event, ticket_id)


@router.post("/api/events/{event_id}/attendees/{ticket_id}/reissue", responses=DESK_NOTICE_RESPONSES)
async def reissue_attendee_ticket(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    body: ParticipantReissue,
    request: Request,
    session: SessionDep,
) -> AttendeeDetailCard:
    """Issue a new pass (new QR code) for a lost or leaked one; the old one stops working at once."""
    event = desk_ctx.event
    ticket = await _desk_ticket(session, event, ticket_id)
    if body.notify and ticket.status == "active":
        await _consume_notice_budget(desk_ctx, request)
    try:
        await reissue_ticket(session, ticket, event, notify_origin=_sms_origin(request) if body.notify else None)
    except TicketStateError as exc:
        raise _state_conflict(str(exc)) from None
    record(
        session, request, "desk.ticket_reissued", entity_type="ticket", entity_id=ticket.id,
        summary={"notify": body.notify},
    )
    await session.commit()
    return await _attendee_card(session, event, ticket_id)


@router.post("/api/events/{event_id}/attendees/{ticket_id}/transfer", responses=DESK_NOTICE_RESPONSES)
async def transfer_attendee_ticket(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    body: ParticipantTransfer,
    request: Request,
    session: SessionDep,
) -> AttendeeDetailCard:
    """Give the ticket's place to another person (by mobile). Returns the new holder's card."""
    event = desk_ctx.event
    ticket = await _desk_ticket(session, event, ticket_id)
    if ticket.status == "active":  # a transfer always texts both holders
        await _consume_notice_budget(desk_ctx, request)
    target, snapshot = await transfer_target(session, body)
    try:
        new_ticket = await transfer_ticket(
            session, ticket, target, snapshot=snapshot, origin=_sms_origin(request), event=event
        )
    except TicketStateError as exc:
        raise _state_conflict(str(exc)) from None
    record(
        session, request, "desk.ticket_transferred", entity_type="ticket", entity_id=ticket.id,
        summary={"new_ticket_id": str(new_ticket.id), "mobile": masked(body.mobile)},
    )
    await session.commit()
    return await _attendee_card(session, event, new_ticket.id)


@router.post("/api/events/{event_id}/attendees/{ticket_id}/admit", responses=DESK_NOT_FOUND_OR_CONFLICT)
async def admit_attendee(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    body: DeskAdmitRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> DeskAdmitOut:
    """Admit the attendee at one of this congress's check-in points, as if their badge were scanned there: the
    gate's own evaluator decides (single use, tier, capacity; app.routes.checkin), and the verdict is recorded
    as a check-in attributed to the desk operator. A retry with the same `scan_id` returns the first verdict."""
    event = desk_ctx.event
    ticket = await session.scalar(select(Ticket).where(Ticket.id == ticket_id, Ticket.event_id == event.id))
    if ticket is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "PARTICIPANT_NOT_FOUND", "Participant not found")
    point = await session.scalar(
        select(CheckInPoint).where(CheckInPoint.id == body.checkin_point_id, CheckInPoint.event_id == event.id)
    )
    if point is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "CHECKIN_POINT_NOT_FOUND", "Check-in point not found")
    secret = await _active_secret(session, ticket)
    if secret is None:
        raise _state_conflict("Only an active ticket can be admitted.")

    scan_id = body.scan_id or uuid.uuid4()
    replay = await session.get(CheckIn, scan_id) is not None
    (result,) = await _record_scans(
        session, point, [ScanSubmission(scan_id=scan_id, qr_secret=secret, scanned_at=datetime.now(timezone.utc))]
    )
    if replay or result.rejection_reason == "SCAN_ID_CONFLICT":
        # The first answer was already recorded (and audited).
        response.headers["Idempotent-Replayed"] = "true"
    else:
        actor = current_actor(request)
        await session.execute(
            pg_insert(DeskCheckIn)
            .values(
                checkin_id=scan_id,
                desk_operator_id=desk_ctx.operator.id if desk_ctx.operator else None,
                actor_type=actor.type if actor else "system",
                actor_label=desk_ctx.operator_name[:200],
            )
            .on_conflict_do_nothing()
        )
        record(
            session, request, "desk.admitted", entity_type="checkin", entity_id=scan_id,
            summary={
                "status": result.status, "rejection_reason": result.rejection_reason,
                "checkin_point_id": str(point.id),
            },
        )
    await session.commit()
    return DeskAdmitOut(
        scan_id=result.scan_id,
        status=result.status,
        rejection_reason=result.rejection_reason,
        checkin_point_id=point.id,
        checkin_point_name=point.name,
        attendee_name=result.attendee_name,
        ticket_tier_name=result.ticket_tier_name,
    )


@router.post(
    "/api/events/{event_id}/attendees/{ticket_id}/prints",
    status_code=status.HTTP_201_CREATED,
    responses=DESK_NOT_FOUND_OR_CONFLICT,
)
async def record_badge_print(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> BadgePrintOut:
    """Record that the badge is being printed (sent just before the browser's print dialog): the first print
    or a reprint, by whom, and what it shows, so a later change to the registration flags it for reprinting."""
    event = desk_ctx.event
    ticket = await _desk_ticket(session, event, ticket_id)  # locked: concurrent prints are counted in turn
    secret = await _active_secret(session, ticket)
    if secret is None:
        raise _state_conflict("Only an active ticket's badge can be printed.")
    previous = await session.scalar(select(func.count(TicketPrint.id)).where(TicketPrint.ticket_id == ticket.id)) or 0
    actor = current_actor(request)
    reason: Literal["first", "reprint"] = "first" if previous == 0 else "reprint"
    printed = TicketPrint(
        ticket_id=ticket.id,
        event_id=event.id,
        printed_by_type=actor.type if actor else "system",
        printed_by_id=actor.id if actor else None,
        printed_by_label=desk_ctx.operator_name[:200],
        reason=reason,
        content_fingerprint=badge_fingerprint(ticket, secret),
    )
    session.add(printed)
    await session.flush()
    await session.refresh(printed)
    record(
        session, request, "desk.badge_printed", entity_type="ticket", entity_id=ticket.id,
        summary={"reason": reason, "print_count": previous + 1},
    )
    await session.commit()
    return BadgePrintOut(
        print_id=printed.id,
        reason=reason,
        printed_at=printed.printed_at,
        printed_by=printed.printed_by_label,
        print_count=previous + 1,
    )


@router.post("/api/events/{event_id}/attendees/{ticket_id}/resend-sms", responses=DESK_NOTICE_RESPONSES)
async def resend_pass_sms(
    desk_ctx: WritableDeskDep,
    ticket_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsGateway, Depends(sms_provider)],
) -> PassSmsResendOut:
    """Send the ticket confirmation (with the pass link) again, now, for an attendee who did not get it.

    Everything is read (and a missing link minted and committed) first; the database connection is released
    before sms.ir is called, so a slow provider never holds connections check-in needs. The outcome is logged
    in a new short transaction."""
    event = desk_ctx.event
    row = (
        await session.execute(
            select(Ticket, User)
            .join(User, Ticket.user_id == User.id)
            .where(Ticket.id == ticket_id, Ticket.event_id == event.id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendee ticket not found")
    ticket, user = row[0], row[1]
    mobile = user.mobile
    if not mobile:
        raise HTTPException(status.HTTP_409_CONFLICT, "This attendee has no mobile number")
    if ticket.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This pass is not active")

    throttle = limiter(request)
    cooldown, per_ticket, per_event = (
        f"sms:pass:cooldown:{ticket.id}",
        f"sms:pass:{ticket.id}",
        f"sms:pass:event:{event.id}",
    )
    # One atomic take: concurrent clicks cannot all pass a check before any of them is counted.
    await throttle.consume(
        (cooldown, PASS_SMS_COOLDOWN),
        (per_ticket, PASS_SMS_PER_TICKET),
        (per_event, PASS_SMS_PER_EVENT),
        detail="The pass link was sent recently. Try again later.",
        code="PASS_SMS_RATE_LIMITED",
    )
    await _consume_notice_budget(desk_ctx, request)

    link = await active_ticket_link(session, ticket, event)
    text = await ticket_confirmation_text(
        session, request.app.state.settings, str(request.base_url), user=user, event=event, ticket=ticket,
        code=link.code,
    )
    event_id = event.id
    await session.commit()  # keeps a link minted just now
    await session.close()  # nothing is held while the provider answers
    result = await provider.send_text(mobile, text, kind="ticket_resend")
    outcome: Literal["sent", "failed", "unknown"] = "sent" if result.ok else "unknown" if result.unknown else "failed"
    # Logged without ticket_id, which is unique per kind (one automatic confirmation per ticket) while a ticket
    # may be resent several times.
    session.add(
        SmsMessage(
            kind="ticket_resend", mobile=mobile, body=text, event_id=event_id, status=outcome,
            provider_message_id=result.message_id, attempts=1, last_error=result.error,
            sent_at=datetime.now(timezone.utc) if result.ok else None,
        )
    )
    await session.commit()
    test_mode = provider.config is not None and provider.config.effective == "console"
    return PassSmsResendOut(status=outcome, mobile=mobile, error=result.error, test_mode=test_mode)
