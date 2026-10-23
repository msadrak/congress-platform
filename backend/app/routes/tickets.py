import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.links import mint_ticket_link
from app.models import EntityQR, Event, EventPage, Ticket, TicketTier
from app.routes.auth import CurrentUserDep
from app.routes.events import registration_problem
from app.routes.ticket_tiers import tier_sales_problem
from app.security import generate_entity_qr_secret
from app.sms.budgets import attendee_notice_allowed, charge_attendee_notice
from app.sms.outbox import link_origin, queue_ticket_confirmation
from app.ticket_lifecycle import (
    TicketStateError,
    attendee_snapshot,
    cancel_ticket,
    locked_status,
    queue_ticket_sms,
    reactivate_ticket,
)

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
    attendee_mobile: str | None
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
    # The congress's own IANA zone (`events.timezone`): the pass shows its dates in it, not in the phone's zone.
    event_timezone: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    attendee_name: str
    attendee_mobile: str | None
    status: str
    qr_secret: str
    created_at: datetime


@router.post(
    "/api/events/{event_id}/tickets/reserve",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(
        status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT, status.HTTP_410_GONE,
        status.HTTP_429_TOO_MANY_REQUESTS,
    ),
)
async def reserve_ticket(
    event_id: uuid.UUID,
    body: TicketReserveRequest,
    user: CurrentUserDep,
    request: Request,
    session: SessionDep,
) -> TicketOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "EVENT_NOT_FOUND", "Event not found")
    # Lifecycle rules (B4): only a published, unarchived event within its registration (and the tier's
    # sales) window takes reservations. Unpublished and archived events look missing, as on public pages.
    page = await session.get(EventPage, event_id)
    if event.archived_at is not None or page is None or page.published is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "EVENT_NOT_FOUND", "Event not found")
    now = datetime.now(timezone.utc)
    closed = registration_problem(event, now)
    if closed is None:
        tier_row = await session.get(TicketTier, body.ticket_tier_id)
        closed = tier_sales_problem(tier_row, now) if tier_row and tier_row.event_id == event_id else None
    if closed is not None:
        raise closed

    # Check if user already holds a ticket for this event
    existing = await session.scalar(
        select(Ticket).where(
            Ticket.event_id == event_id, Ticket.user_id == user.id
        )
    )
    if existing is not None and existing.status == "cancelled":
        return await _register_again(existing, body, user, event, request, session)
    if existing is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "ALREADY_REGISTERED",
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
            raise ApiError(status.HTTP_404_NOT_FOUND, "TIER_NOT_FOUND", "Ticket tier not found")
        if not tier.is_open:
            raise ApiError(
                status.HTTP_400_BAD_REQUEST, "TIER_CLOSED", "Ticket tier is closed for registration"
            )
        raise ApiError(status.HTTP_410_GONE, "TIER_SOLD_OUT", "Ticket tier is sold out / quota exhausted")

    ticket = Ticket(
        event_id=event_id,
        ticket_tier_id=body.ticket_tier_id,
        user_id=user.id,
        status="active",
        **attendee_snapshot(user),
    )
    session.add(ticket)
    try:
        await session.flush()
    except IntegrityError:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "ALREADY_REGISTERED",
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
    link = await mint_ticket_link(session, ticket, event)
    await queue_ticket_confirmation(
        session, request.app.state.settings, str(request.base_url), user=user, event=event, ticket=ticket,
        code=link.code,
    )
    await session.commit()

    return TicketOut(
        id=ticket.id,
        event_id=ticket.event_id,
        ticket_tier_id=ticket.ticket_tier_id,
        ticket_tier_name=tier_name,
        attendee_name=ticket.attendee_full_name,
        attendee_mobile=user.mobile,
        status=ticket.status,
        qr_secret=secret,
        created_at=ticket.created_at,
    )


async def _register_again(
    ticket: Ticket, body: TicketReserveRequest, user: CurrentUserDep, event: Event, request: Request, session: SessionDep
) -> TicketOut:
    """Registering again after a cancellation reactivates the person's ticket row with a new pass."""
    tier = await session.get(TicketTier, body.ticket_tier_id)
    if tier is None or tier.event_id != event.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "TIER_NOT_FOUND", "Ticket tier not found")
    if not tier.is_open:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "TIER_CLOSED", "Ticket tier is closed for registration")
    # The ticket was read without a lock: a concurrent request may have registered it again meanwhile.
    if await locked_status(session, ticket) != "cancelled":
        raise ApiError(status.HTTP_409_CONFLICT, "ALREADY_REGISTERED", "User already holds a ticket for this event")
    if user.mobile:  # registering again texts a new pass: bounded, so cancel/register loops cannot spend SMS
        await charge_attendee_notice(request, user.id, ticket.id)
    try:
        secret, code = await reactivate_ticket(session, ticket, tier.id, user, event)
    except TicketStateError:  # the status is locked above, so only the quota can refuse
        raise ApiError(status.HTTP_410_GONE, "TIER_SOLD_OUT", "Ticket tier is sold out / quota exhausted") from None
    await queue_ticket_sms(
        session, link_origin(request.app.state.settings, str(request.base_url)), "ticket_confirmation",
        mobile=user.mobile, name=ticket.attendee_full_name, event=event, ticket=ticket, code=code,
    )
    await session.commit()
    await session.refresh(ticket)
    return TicketOut(
        id=ticket.id, event_id=ticket.event_id, ticket_tier_id=tier.id, ticket_tier_name=tier.name,
        attendee_name=ticket.attendee_full_name, attendee_mobile=user.mobile, status=ticket.status,
        qr_secret=secret, created_at=ticket.created_at,
    )


@router.post(
    "/api/attendees/me/tickets/{ticket_id}/cancel",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def cancel_my_ticket(
    ticket_id: uuid.UUID, user: CurrentUserDep, request: Request, session: SessionDep
) -> AttendeeTicketDetail:
    """The attendee cancels their own registration; allowed until the congress starts."""
    row = (
        await session.execute(
            select(Ticket, Event)
            .join(Event, Ticket.event_id == Event.id)
            .where(Ticket.id == ticket_id, Ticket.user_id == user.id)
            .with_for_update(of=Ticket)
        )
    ).one_or_none()
    if row is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "TICKET_NOT_FOUND", "Ticket not found")
    ticket, event = row[0], row[1]
    if event.starts_at <= datetime.now(timezone.utc):
        raise ApiError(
            status.HTTP_409_CONFLICT, "EVENT_STARTED",
            "The congress has started; ask the organizer to cancel the registration.",
        )
    origin = link_origin(request.app.state.settings, str(request.base_url))
    # Over the attendee's notice budget the cancellation still goes ahead (it frees a place), without its text.
    texted = ticket.status == "active" and await attendee_notice_allowed(request, user.id, ticket.id)
    try:
        await cancel_ticket(session, ticket, actor="attendee", notify=(origin, event) if texted else None)
    except TicketStateError as exc:
        raise ApiError(status.HTTP_409_CONFLICT, "TICKET_ALREADY_CANCELLED", str(exc)) from None
    await session.commit()
    (detail,) = [t for t in await get_my_tickets(user, session, include_cancelled=True) if t.id == ticket_id]
    return detail


@router.get("/api/attendees/me/tickets")
async def get_my_tickets(
    user: CurrentUserDep,
    session: SessionDep,
    include_cancelled: Annotated[bool, Query()] = False,
) -> list[AttendeeTicketDetail]:
    """The attendee's passes. Cancelled registrations (whose passes no longer work) only on request."""
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
    if not include_cancelled:
        query = query.where(Ticket.status == "active")
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
            event_timezone=event.timezone,
            ticket_tier_id=tier.id,
            ticket_tier_name=tier.name,
            attendee_name=ticket.attendee_full_name,
            attendee_mobile=user.mobile,
            status=ticket.status,
            # A cancelled pass is never shown as a scannable code.
            qr_secret=qr.secret if ticket.status == "active" else "",
            created_at=ticket.created_at,
        )
        for ticket, event, tier, qr in rows
    ]
