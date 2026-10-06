import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select

from app.db import SessionDep
from app.models import Booth, BoothBookmark, Event, TicketTier
from app.routes.ticket_tiers import TicketTierOut
from app.security import decode_access_token

router = APIRouter(prefix="/api/public/events", tags=["public"])


class PublicEvent(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    starts_at: datetime
    ends_at: datetime
    location: str
    description: str
    ticket_tiers: list[TicketTierOut]


class PublicBoothOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    location: str
    description: str
    website_url: str
    brochure_url: str
    event_name: str
    event_slug: str
    is_bookmarked: bool = False


async def optional_user_id(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> uuid.UUID | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    secret: str = request.app.state.settings.jwt_secret
    payload = decode_access_token(token, secret)
    if payload and "sub" in payload:
        try:
            return uuid.UUID(payload["sub"])
        except Exception:
            return None
    return None


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
        id=event.id,
        name=event.name,
        slug=event.slug,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=event.location,
        description=event.description,
        ticket_tiers=[TicketTierOut.model_validate(tier) for tier in tiers],
    )


@router.get("/{slug}/booths/{booth_id}")
async def get_public_booth(
    slug: str,
    booth_id: uuid.UUID,
    session: SessionDep,
    user_id: Annotated[uuid.UUID | None, Depends(optional_user_id)] = None,
) -> PublicBoothOut:
    event = await session.scalar(select(Event).where(Event.slug == slug))
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    booth = await session.get(Booth, booth_id)
    if booth is None or booth.event_id != event.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    is_bookmarked = False
    if user_id is not None:
        bookmark = await session.scalar(
            select(BoothBookmark.id).where(
                BoothBookmark.user_id == user_id,
                BoothBookmark.booth_id == booth.id,
            )
        )
        is_bookmarked = bookmark is not None

    return PublicBoothOut(
        id=booth.id,
        name=booth.name,
        slug=booth.slug,
        location=booth.location,
        description=booth.description,
        website_url=booth.website_url,
        brochure_url=booth.brochure_url,
        event_name=event.name,
        event_slug=event.slug,
        is_bookmarked=is_bookmarked,
    )
