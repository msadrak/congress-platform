from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.db import SessionDep
from app.models import Event, TicketTier
from app.routes.ticket_tiers import TicketTierOut

router = APIRouter(prefix="/api/public/events", tags=["public"])


class PublicEvent(BaseModel):
    name: str
    slug: str
    starts_at: datetime
    ends_at: datetime
    location: str
    description: str
    ticket_tiers: list[TicketTierOut]


@router.get("/{slug}")
async def get_public_event(slug: str, session: SessionDep) -> PublicEvent:
    event = await session.scalar(select(Event).where(Event.slug == slug))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    tiers = await session.scalars(
        select(TicketTier)
        .where(TicketTier.event_id == event.id, TicketTier.is_open)
        .order_by(TicketTier.created_at, TicketTier.id)
    )
    return PublicEvent(
        name=event.name,
        slug=event.slug,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=event.location,
        description=event.description,
        ticket_tiers=[TicketTierOut.model_validate(tier) for tier in tiers],
    )
