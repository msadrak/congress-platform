import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import func, select

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import Ticket, TicketTier
from app.routes.events import OwnedEventDep, WritableEventDep

router = APIRouter(prefix="/api/events/{event_id}/ticket-tiers", tags=["ticket tiers"])


class TicketTierCreate(BaseModel):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    description: Annotated[str, Field(max_length=2_000)] = ""
    quota: Annotated[int, Field(ge=1, le=1_000_000)]
    is_open: bool = True
    # Optional sales window enforced at reservation; either end may be open.
    sales_starts_at: AwareDatetime | None = None
    sales_ends_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _window_in_order(self) -> "TicketTierCreate":
        problem = _sales_window_problem(self.sales_starts_at, self.sales_ends_at)
        if problem:
            raise ValueError(problem)
        return self


class TicketTierUpdate(BaseModel):
    """Partial update: omitted fields keep their value; an explicit null clears a sales-window bound."""

    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ] | None = None
    description: Annotated[str, Field(max_length=2_000)] | None = None
    quota: Annotated[int, Field(ge=1, le=1_000_000)] | None = None
    is_open: bool | None = None
    sales_starts_at: AwareDatetime | None = None
    sales_ends_at: AwareDatetime | None = None


class TicketTierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str
    quota: int
    reserved_count: int = 0
    is_open: bool
    sales_starts_at: datetime | None = None
    sales_ends_at: datetime | None = None


def _sales_window_problem(starts_at: datetime | None, ends_at: datetime | None) -> str | None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        return "sales_ends_at must be after sales_starts_at"
    return None


def tier_sales_problem(tier: TicketTier, now: datetime) -> ApiError | None:
    """Why this tier's sales window refuses a reservation right now, as the 409 to raise, or None."""
    if tier.sales_starts_at is not None and now < tier.sales_starts_at:
        return ApiError(
            status.HTTP_409_CONFLICT,
            "TIER_SALES_NOT_OPEN",
            f"Sales for this ticket tier have not started yet; they start at {tier.sales_starts_at.isoformat()}.",
        )
    if tier.sales_ends_at is not None and now >= tier.sales_ends_at:
        return ApiError(status.HTTP_409_CONFLICT, "TIER_SALES_CLOSED", "Sales for this ticket tier have ended.")
    return None


@router.post("", status_code=status.HTTP_201_CREATED, responses=error_responses(status.HTTP_409_CONFLICT))
async def create_ticket_tier(
    body: TicketTierCreate, event: WritableEventDep, session: SessionDep
) -> TicketTierOut:
    tier = TicketTier(event_id=event.id, **body.model_dump())
    session.add(tier)
    await session.commit()
    await session.refresh(tier)
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


@router.patch("/{tier_id}", responses=error_responses(status.HTTP_409_CONFLICT))
async def update_ticket_tier(
    tier_id: uuid.UUID,
    body: TicketTierUpdate,
    event: WritableEventDep,
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
    given = body.model_fields_set
    starts_at = body.sales_starts_at if "sales_starts_at" in given else tier.sales_starts_at
    ends_at = body.sales_ends_at if "sales_ends_at" in given else tier.sales_ends_at
    problem = _sales_window_problem(starts_at, ends_at)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    tier.sales_starts_at = starts_at
    tier.sales_ends_at = ends_at

    await session.commit()
    await session.refresh(tier)
    return TicketTierOut.model_validate(tier)


@router.delete(
    "/{tier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def delete_ticket_tier(tier_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> Response:
    """Only a tier nobody has reserved can be deleted (409 otherwise; close it instead)."""
    tier = await session.scalar(
        select(TicketTier)
        .where(TicketTier.id == tier_id, TicketTier.event_id == event.id)
        .with_for_update()
    )
    if tier is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "TIER_NOT_FOUND", "Ticket tier not found")
    issued = await session.scalar(select(func.count(Ticket.id)).where(Ticket.ticket_tier_id == tier.id)) or 0
    if tier.reserved_count or issued:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "TIER_HAS_RESERVATIONS",
            f"This ticket tier has {max(tier.reserved_count, issued)} reservation(s) and cannot be deleted; close it instead.",
        )
    await session.delete(tier)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
