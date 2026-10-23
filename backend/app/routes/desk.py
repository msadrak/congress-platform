import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.audit import Actor, set_actor
from app.auth import authorize, organizer_accepts_token, organizer_is_active, resolve_organizer_principal
from app.db import SessionDep
from app.links import active_ticket_link, mint_ticket_link
from app.models import (
    CheckIn,
    CheckInPoint,
    DeskOperator,
    EntityQR,
    Event,
    SmsMessage,
    Ticket,
    TicketTier,
    User,
)
from app.rate_limit import LONGEST_WINDOW_SECONDS, Budget, limiter
from app.routes.events import OwnedEventDep
from app.routes.ticket_tiers import TicketTierOut
from app.routes.auth import OtpCode, verify_code
from app.security import (
    create_desk_operator_token,
    decode_access_token,
    generate_entity_qr_secret,
)
from app.sms import SmsGateway, sms_provider
from app.sms.outbox import queue_ticket_confirmation, ticket_confirmation_text
from app.sms.phone import IranMobile, OptionalIranMobile, ascii_digits, search_digits
from app.ticket_lifecycle import attendee_snapshot

_bearer = HTTPBearer(auto_error=False)
router = APIRouter(tags=["desk"])

# Resending the pass link from the desk: a real SMS each time, so it is spaced out per attendee and capped per event.
PASS_SMS_COOLDOWN = Budget(1, 60)
PASS_SMS_PER_TICKET = Budget(5, LONGEST_WINDOW_SECONDS)
PASS_SMS_PER_EVENT = Budget(300, LONGEST_WINDOW_SECONDS)


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


class AttendeeDetailCard(BaseModel):
    ticket_id: uuid.UUID
    attendee_id: uuid.UUID
    attendee_name: str
    attendee_mobile: str | None
    organization: str
    title: str
    ticket_tier_name: str
    qr_secret: str
    status: str
    created_at: datetime
    issued_by: str | None = None
    scan_history: list[ScanHistoryItem]


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
)
async def add_desk_operator(
    event: OwnedEventDep,
    body: DeskOperatorCreate,
    session: SessionDep,
) -> DeskOperatorOut:
    """Authorize a person (by mobile) for this event's front desk; they sign in with an SMS code."""
    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    if user is None:
        user = User(mobile=body.mobile, full_name=body.operator_name.strip())
        session.add(user)
        await session.flush()

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
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Operator is already assigned to this event",
        )

    operator = DeskOperator(
        event_id=event.id,
        user_id=user.id,
        operator_name=body.operator_name.strip(),
        is_revoked=False,
    )
    session.add(operator)
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

@router.post(
    "/api/events/{event_id}/desk-registrations",
    status_code=status.HTTP_201_CREATED,
)
async def create_desk_registration(
    desk_ctx: AuthorizedDeskDep,
    body: DeskRegistrationCreate,
    request: Request,
    session: SessionDep,
) -> DeskRegistrationOut:
    event = desk_ctx.event

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

    # 2. Check if user already holds a ticket for this event
    existing_ticket = await session.scalar(
        select(Ticket).where(
            Ticket.event_id == event.id, Ticket.user_id == user.id
        )
    )
    if existing_ticket is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Attendee already has an active ticket for this congress",
        )

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
        tier = await session.get(TicketTier, body.ticket_tier_id)
        if tier is None or tier.event_id != event.id:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Ticket tier not found"
            )
        if not tier.is_open:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Ticket tier is closed for registration"
            )
        raise HTTPException(
            status.HTTP_410_GONE, "Ticket tier is sold out / quota exhausted"
        )

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
    await session.flush()

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


@router.get("/api/events/{event_id}/attendees")
async def search_event_attendees(
    desk_ctx: AuthorizedDeskDep,
    session: SessionDep,
    q: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AttendeeSearchItem]:
    event = desk_ctx.event
    term = q.strip()

    # Count check-ins per ticket
    counts_stmt = (
        select(CheckIn.ticket_id, func.count(CheckIn.id))
        .where(CheckIn.status == "ADMITTED", CheckIn.ticket_id.is_not(None))
        .group_by(CheckIn.ticket_id)
    )
    counts_res = await session.execute(counts_stmt)
    scan_counts: dict[uuid.UUID, int] = {
        row[0]: row[1] for row in counts_res.all() if row[0] is not None
    }

    # Query tickets joined with user, tier, qr, and operator attribution
    query = (
        select(Ticket, User, TicketTier, EntityQR, DeskOperator.operator_name)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .outerjoin(DeskOperator, Ticket.issued_by_operator_id == DeskOperator.id)
        .where(Ticket.event_id == event.id)
    )

    if term:
        like_term = f"%{ascii_digits(term)}%"
        digits = search_digits(term)
        query = query.where(
            or_(
                Ticket.attendee_full_name.ilike(like_term),
                Ticket.attendee_organization.ilike(like_term),
                *([User.mobile.contains(digits)] if digits else []),
            )
        )

    query = query.order_by(Ticket.created_at.desc()).limit(limit)
    res = await session.execute(query)
    rows = res.all()

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


@router.get("/api/events/{event_id}/attendees/{ticket_id}")
async def get_attendee_ticket_detail(
    desk_ctx: AuthorizedDeskDep,
    ticket_id: uuid.UUID,
    session: SessionDep,
) -> AttendeeDetailCard:
    event = desk_ctx.event
    query = (
        select(Ticket, User, TicketTier, EntityQR, DeskOperator.operator_name)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .outerjoin(DeskOperator, Ticket.issued_by_operator_id == DeskOperator.id)
        .where(Ticket.id == ticket_id, Ticket.event_id == event.id)
    )
    res = await session.execute(query)
    row = res.one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendee ticket not found")

    ticket, user, tier, qr, op_name = row[0], row[1], row[2], row[3], row[4]

    # Fetch scan history
    history_query = (
        select(CheckIn, CheckInPoint.name)
        .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
        .where(CheckIn.ticket_id == ticket.id)
        .order_by(CheckIn.scanned_at.desc())
    )
    history_res = await session.execute(history_query)
    history_rows = history_res.all()

    scan_history = [
        ScanHistoryItem(
            checkin_point_name=point_name,
            status=checkin.status,
            rejection_reason=checkin.rejection_reason,
            scanned_at=checkin.scanned_at,
        )
        for checkin, point_name in history_rows
    ]

    return AttendeeDetailCard(
        ticket_id=ticket.id,
        attendee_id=user.id,
        attendee_name=ticket.attendee_full_name,
        attendee_mobile=user.mobile,
        organization=ticket.attendee_organization,
        title=ticket.attendee_title,
        ticket_tier_name=tier.name,
        qr_secret=qr.secret,
        status=ticket.status,
        created_at=ticket.created_at,
        issued_by=op_name,
        scan_history=scan_history,
    )


@router.post("/api/events/{event_id}/attendees/{ticket_id}/resend-sms")
async def resend_pass_sms(
    desk_ctx: AuthorizedDeskDep,
    ticket_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    provider: Annotated[SmsGateway, Depends(sms_provider)],
) -> PassSmsResendOut:
    """Send the ticket confirmation (with the pass link) again, now, for an attendee who did not get it."""
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
    if not user.mobile:
        raise HTTPException(status.HTTP_409_CONFLICT, "This attendee has no mobile number")
    if ticket.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This pass is not active")

    throttle = limiter(request)
    cooldown, per_ticket, per_event = (
        f"sms:pass:cooldown:{ticket.id}",
        f"sms:pass:{ticket.id}",
        f"sms:pass:event:{event.id}",
    )
    throttle.check(
        (cooldown, PASS_SMS_COOLDOWN),
        (per_ticket, PASS_SMS_PER_TICKET),
        (per_event, PASS_SMS_PER_EVENT),
        detail="The pass link was sent recently. Try again later.",
    )
    throttle.hit(cooldown, per_ticket, per_event)

    link = await active_ticket_link(session, ticket, event)
    text = await ticket_confirmation_text(
        session, request.app.state.settings, str(request.base_url), user=user, event=event, ticket=ticket,
        code=link.code,
    )
    result = await provider.send_text(user.mobile, text, kind="ticket_resend")
    outcome: Literal["sent", "failed", "unknown"] = "sent" if result.ok else "unknown" if result.unknown else "failed"
    # Sent inline so the desk sees the outcome; logged without ticket_id, which is unique per kind (one
    # automatic confirmation per ticket) while a ticket may be resent several times.
    session.add(
        SmsMessage(
            kind="ticket_resend", mobile=user.mobile, body=text, event_id=event.id, status=outcome,
            provider_message_id=result.message_id, attempts=1, last_error=result.error,
            sent_at=datetime.now(timezone.utc) if result.ok else None,
        )
    )
    await session.commit()
    test_mode = provider.config is not None and provider.config.effective == "console"
    return PassSmsResendOut(status=outcome, mobile=user.mobile, error=result.error, test_mode=test_mode)
