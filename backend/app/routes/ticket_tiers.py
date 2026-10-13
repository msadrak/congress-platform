import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select

from app.db import SessionDep
from app.models import Ticket, TicketTier
from app.routes.events import OwnedEventDep

router = APIRouter(prefix="/api/events/{event_id}/ticket-tiers", tags=["ticket tiers"])


class TicketTierCreate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    description: Annotated[str, Field(max_length=2_000)] = ""
    quota: Annotated[int, Field(ge=1, le=1_000_000)]
    is_open: bool = True
class TicketTierUpdate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ] | None = None
    description: Annotated[str, Field(max_length=2_000)] | None = None
    quota: Annotated[int, Field(ge=1, le=1_000_000)] | None = None
    is_open: bool | None = None


class TicketTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    quota: int
    reserved_count: int = 0
    is_open: bool


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_ticket_tier(
    body: TicketTierCreate, event: OwnedEventDep, session: SessionDep
) -> TicketTierOut:
    tier = TicketTier(event_id=event.id, **body.model_dump())
    session.add(tier)
    await session.commit()
    return TicketTierOut.model_validate(tier)


@router.get("")
async def list_ticket_tiers(
    event: OwnedEventDep, session: SessionDep
) -> list[TicketTierOut]:
    tiers = await session.scalars(
        select(TicketTier)
        .where(TicketTier.event_id == event.id)
        .order_by(TicketTier.created_at, TicketTier.id)
    )
    return [TicketTierOut.model_validate(tier) for tier in tiers]


@router.patch("/{tier_id}")
async def update_ticket_tier(
    tier_id: uuid.UUID,
    body: TicketTierUpdate,
    event: OwnedEventDep,
    session: SessionDep,
) -> TicketTierOut:
    tier = await session.scalar(
        select(TicketTier)
        .where(TicketTier.id == tier_id, TicketTier.event_id == event.id)
        .with_for_update()
    )
    if tier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket tier not found")

    if body.quota is not None:
        current_active_count = await session.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.ticket_tier_id == tier.id,
                Ticket.status == "active",
            )
        ) or 0
        existing_claimed = max(current_active_count, tier.reserved_count or 0)
        if body.quota < existing_claimed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Quota cannot be reduced below current confirmed registrations ({existing_claimed})",
            )
        tier.quota = body.quota

    if body.name is not None:
        tier.name = body.name
    if body.description is not None:
        tier.description = body.description
    if body.is_open is not None:
        tier.is_open = body.is_open

    await session.commit()
    await session.refresh(tier)
    return TicketTierOut.model_validate(tier)
