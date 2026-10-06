import uuid
from typing import Annotated

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select

from app.db import SessionDep
from app.models import TicketTier
from app.routes.events import OwnedEventDep

router = APIRouter(prefix="/api/events/{event_id}/ticket-tiers", tags=["ticket tiers"])


class TicketTierCreate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    description: Annotated[str, Field(max_length=2_000)] = ""
    quota: Annotated[int, Field(ge=1, le=1_000_000)]
    is_open: bool = True


class TicketTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    quota: int
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
