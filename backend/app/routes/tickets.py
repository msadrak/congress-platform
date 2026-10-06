import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import EntityQR, Event, Ticket, TicketTier
from app.routes.auth import CurrentUserDep
from app.security import generate_entity_qr_secret

router = APIRouter(tags=["tickets"])


class TicketReserveRequest(BaseModel):
    ticket_tier_id: uuid.UUID


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    attendee_name: str
    attendee_email: str
    status: str
    qr_secret: str
    created_at: datetime


class AttendeeTicketDetail(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    event_name: str
    event_slug: str
    event_location: str
    event_starts_at: datetime
    event_ends_at: datetime
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    attendee_name: str
    attendee_email: str
    status: str
    qr_secret: str
    created_at: datetime


@router.post(
    "/api/events/{event_id}/tickets/reserve",
    status_code=status.HTTP_201_CREATED,
)
async def reserve_ticket(
    event_id: uuid.UUID,
    body: TicketReserveRequest,
    user: CurrentUserDep,
    session: SessionDep,
) -> TicketOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    # Check if user already holds a ticket for this event
    existing = await session.scalar(
        select(Ticket).where(
            Ticket.event_id == event_id, Ticket.user_id == user.id
        )
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "User already holds a ticket for this event",
        )

    # Atomic inventory reservation
    stmt = (
        update(TicketTier)
        .where(
            TicketTier.id == body.ticket_tier_id,
            TicketTier.event_id == event_id,
            TicketTier.is_open.is_(True),
            TicketTier.reserved_count < TicketTier.quota,
        )
        .values(reserved_count=TicketTier.reserved_count + 1)
        .returning(TicketTier.name)
    )
    res = await session.execute(stmt)
    tier_name = res.scalar_one_or_none()

    if tier_name is None:
        # Investigate why the update failed
        tier = await session.get(TicketTier, body.ticket_tier_id)
        if tier is None or tier.event_id != event_id:
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

    ticket = Ticket(
        event_id=event_id,
        ticket_tier_id=body.ticket_tier_id,
        user_id=user.id,
        status="active",
    )
    session.add(ticket)
    try:
        await session.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "User already holds a ticket for this event",
        ) from None

    secret = generate_entity_qr_secret()
    qr = EntityQR(
        secret=secret,
        entity_type="attendee_ticket",
        entity_id=ticket.id,
        is_active=True,
    )
    session.add(qr)
    await session.commit()

    return TicketOut(
        id=ticket.id,
        event_id=ticket.event_id,
        ticket_tier_id=ticket.ticket_tier_id,
        ticket_tier_name=tier_name,
        attendee_name=user.full_name,
        attendee_email=user.email,
        status=ticket.status,
        qr_secret=secret,
        created_at=ticket.created_at,
    )


@router.get("/api/attendees/me/tickets")
async def get_my_tickets(
    user: CurrentUserDep, session: SessionDep
) -> list[AttendeeTicketDetail]:
    query = (
        select(Ticket, Event, TicketTier, EntityQR)
        .join(Event, Ticket.event_id == Event.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .where(Ticket.user_id == user.id)
        .order_by(Ticket.created_at.desc())
    )
    results = await session.execute(query)
    rows = results.all()

    return [
        AttendeeTicketDetail(
            id=ticket.id,
            event_id=event.id,
            event_name=event.name,
            event_slug=event.slug,
            event_location=event.location,
            event_starts_at=event.starts_at,
            event_ends_at=event.ends_at,
            ticket_tier_id=tier.id,
            ticket_tier_name=tier.name,
            attendee_name=user.full_name,
            attendee_email=user.email,
            status=ticket.status,
            qr_secret=qr.secret,
            created_at=ticket.created_at,
        )
        for ticket, event, tier, qr in rows
    ]
