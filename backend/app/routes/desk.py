import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import CheckIn, CheckInPoint, EntityQR, Ticket, TicketTier, User
from app.routes.events import OwnedEventDep
from app.security import generate_entity_qr_secret, hash_password

router = APIRouter(tags=["desk"])


class DeskRegistrationCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: str | None = None
    organization: str = Field(default="", max_length=200)
    title: str = Field(default="", max_length=100)
    ticket_tier_id: uuid.UUID


class DeskRegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ticket_id: uuid.UUID
    attendee_name: str
    attendee_email: str
    organization: str
    title: str
    ticket_tier_name: str
    qr_secret: str
    created_at: datetime


class AttendeeSearchItem(BaseModel):
    ticket_id: uuid.UUID
    attendee_id: uuid.UUID
    attendee_name: str
    attendee_email: str
    organization: str
    title: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    qr_secret: str
    status: str
    checkin_count: int


class ScanHistoryItem(BaseModel):
    checkin_point_name: str
    status: str
    rejection_reason: str | None
    scanned_at: datetime


class AttendeeDetailCard(BaseModel):
    ticket_id: uuid.UUID
    attendee_id: uuid.UUID
    attendee_name: str
    attendee_email: str
    organization: str
    title: str
    ticket_tier_name: str
    qr_secret: str
    status: str
    created_at: datetime
    scan_history: list[ScanHistoryItem]


@router.post(
    "/api/events/{event_id}/desk-registrations",
    status_code=status.HTTP_201_CREATED,
)
async def create_desk_registration(
    event: OwnedEventDep,
    body: DeskRegistrationCreate,
    session: SessionDep,
) -> DeskRegistrationOut:
    # 1. Resolve User (find or create)
    email = body.email.strip().lower() if body.email else None
    user = None

    if email:
        user = await session.scalar(select(User).where(User.email == email))

    if user is None:
        actual_email = email or f"walkin-{uuid.uuid4().hex[:12]}@{event.slug}.local"
        random_pwd = secrets.token_urlsafe(16)
        user = User(
            email=actual_email,
            password_hash=hash_password(random_pwd),
            full_name=body.full_name.strip(),
            organization=body.organization.strip(),
            title=body.title.strip(),
        )
        session.add(user)
        try:
            await session.flush()
        except IntegrityError:
            user = await session.scalar(select(User).where(User.email == actual_email))
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

    # 4. Mint Ticket
    ticket = Ticket(
        event_id=event.id,
        ticket_tier_id=body.ticket_tier_id,
        user_id=user.id,
        status="active",
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
    await session.commit()

    return DeskRegistrationOut(
        ticket_id=ticket.id,
        attendee_name=user.full_name,
        attendee_email=user.email,
        organization=user.organization,
        title=user.title,
        ticket_tier_name=tier_name,
        qr_secret=secret,
        created_at=ticket.created_at,
    )


@router.get("/api/events/{event_id}/attendees")
async def search_event_attendees(
    event: OwnedEventDep,
    session: SessionDep,
    q: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AttendeeSearchItem]:
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

    # Query tickets joined with user, tier, qr
    query = (
        select(Ticket, User, TicketTier, EntityQR)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .where(Ticket.event_id == event.id)
    )

    if term:
        like_term = f"%{term}%"
        query = query.where(
            or_(
                User.full_name.ilike(like_term),
                User.email.ilike(like_term),
                User.organization.ilike(like_term),
            )
        )

    query = query.order_by(Ticket.created_at.desc()).limit(limit)
    res = await session.execute(query)
    rows = res.all()

    return [
        AttendeeSearchItem(
            ticket_id=ticket.id,
            attendee_id=user.id,
            attendee_name=user.full_name,
            attendee_email=user.email,
            organization=user.organization,
            title=user.title,
            ticket_tier_id=tier.id,
            ticket_tier_name=tier.name,
            qr_secret=qr.secret,
            status=ticket.status,
            checkin_count=scan_counts.get(ticket.id, 0),
        )
        for ticket, user, tier, qr in rows
    ]


@router.get("/api/events/{event_id}/attendees/{ticket_id}")
async def get_attendee_ticket_detail(
    event: OwnedEventDep,
    ticket_id: uuid.UUID,
    session: SessionDep,
) -> AttendeeDetailCard:
    query = (
        select(Ticket, User, TicketTier, EntityQR)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .where(Ticket.id == ticket_id, Ticket.event_id == event.id)
    )
    res = await session.execute(query)
    row = res.one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attendee ticket not found")

    ticket, user, tier, qr = row[0], row[1], row[2], row[3]

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
        attendee_name=user.full_name,
        attendee_email=user.email,
        organization=user.organization,
        title=user.title,
        ticket_tier_name=tier.name,
        qr_secret=qr.secret,
        status=ticket.status,
        created_at=ticket.created_at,
        scan_history=scan_history,
    )
