import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.models import Booth, BoothBookmark, Event, EventPage, TicketTier
from app.page_render import PublicPage, public_media_url, render_page
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
    # The published page only; drafts are never part of an anonymous response.
    page: PublicPage


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


class PublicBoothSummary(BaseModel):
    """Directory entry: public booth metadata only, never staff, leads or QR secrets."""

    id: uuid.UUID
    name: str
    slug: str
    location: str
    description: str
    website_url: str
    brochure_url: str


async def published_event(slug: str, session: SessionDep) -> tuple[Event, dict[str, Any]]:
    """An event is public once its page has been published. Until then (and after an unpublish) every
    anonymous endpoint answers exactly as for a slug that does not exist. Returns the published document."""
    row = (
        await session.execute(
            select(Event, EventPage.published)
            .join(EventPage, EventPage.event_id == Event.id)
            .where(Event.slug == slug, EventPage.published.is_not(None))
        )
    ).first()
    if row is None or row[1] is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    return row[0], row[1]


PublishedEventDep = Annotated[tuple[Event, dict[str, Any]], Depends(published_event)]


async def event_tiers(session: AsyncSession, event_id: uuid.UUID) -> list[TicketTierOut]:
    tiers = await session.scalars(
        select(TicketTier)
        .where(TicketTier.event_id == event_id)
        .order_by(TicketTier.created_at, TicketTier.id)
    )
    return [TicketTierOut.model_validate(tier) for tier in tiers]


async def booth_directory(session: AsyncSession, event_id: uuid.UUID) -> list[PublicBoothSummary]:
    booths = await session.scalars(
        select(Booth).where(Booth.event_id == event_id).order_by(Booth.name, Booth.id)
    )
    return [
        PublicBoothSummary(
            id=b.id,
            name=b.name,
            slug=b.slug,
            location=b.location,
            description=b.description,
            website_url=b.website_url,
            brochure_url=b.brochure_url,
        )
        for b in booths
    ]


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
async def get_public_event(published: PublishedEventDep, session: SessionDep) -> PublicEvent:
    event, document = published
    return PublicEvent(
        id=event.id,
        name=event.name,
        slug=event.slug,
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        location=event.location,
        description=event.description,
        ticket_tiers=await event_tiers(session, event.id),
        page=await render_page(session, event.id, document, public_media_url),
    )


@router.get("/{slug}/booths")
async def list_public_booths(
    published: PublishedEventDep, session: SessionDep
) -> list[PublicBoothSummary]:
    return await booth_directory(session, published[0].id)


@router.get("/{slug}/booths/{booth_id}")
async def get_public_booth(
    booth_id: uuid.UUID,
    published: PublishedEventDep,
    session: SessionDep,
    user_id: Annotated[uuid.UUID | None, Depends(optional_user_id)] = None,
) -> PublicBoothOut:
    event = published[0]
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
