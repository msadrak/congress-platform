import uuid
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.models import Booth, BoothBookmark, Event, EventPage, MediaAsset, TicketTier
from app.page_document import PageDocument
from app.page_render import PublicPage, public_media_url, render_page
from app.seo import default_head, page_language, pick, render_head
from app.routes.events import registration_problem
from app.routes.program import PublicSession, PublicVenuePlace, live_program
from app.routes.program_files import PublicProgramFile, visible_program_files
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
    # Operational data, live as soon as the organizer saves it (no publish step; ADR 0014).
    venue: list[PublicVenuePlace]
    sessions: list[PublicSession]
    # Lifecycle (B4). `registration_open` sums up the switch, the window and whether the event has ended.
    timezone: str
    registration_enabled: bool
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    registration_open: bool
    # The schedule uploaded as PDFs or images: visible ones only, in the organizer's order.
    program_files: list[PublicProgramFile] = []


class PublicEventSummary(BaseModel):
    """An entry of the platform's public event list."""

    id: uuid.UUID
    name: str
    slug: str
    starts_at: datetime
    ends_at: datetime
    location: str
    timezone: str


class PublicEventList(BaseModel):
    items: list[PublicEventSummary]
    total: int
    limit: int
    offset: int


def event_lifecycle(event: Event) -> dict[str, Any]:
    """The lifecycle fields of the public payload (also used by the organizer's page preview)."""
    return {
        "timezone": event.timezone,
        "registration_enabled": event.registration_enabled,
        "registration_opens_at": event.registration_opens_at,
        "registration_closes_at": event.registration_closes_at,
        "registration_open": registration_problem(event, datetime.now(timezone.utc)) is None,
    }


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
            .where(Event.slug == slug, EventPage.published.is_not(None), Event.archived_at.is_(None))
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


@router.get("")
async def list_public_events(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> PublicEventList:
    """Events the organizer chose to list, once published and while not archived: upcoming and running ones
    first (soonest first), then past ones (most recent first)."""
    now = datetime.now(timezone.utc)
    visible = (
        select(Event)
        .join(EventPage, EventPage.event_id == Event.id)
        .where(Event.listed.is_(True), Event.archived_at.is_(None), EventPage.published.is_not(None))
    )
    total = await session.scalar(select(func.count()).select_from(visible.subquery())) or 0
    is_past = Event.ends_at <= now
    epoch = func.extract("epoch", Event.starts_at)
    events = await session.scalars(
        visible.order_by(
            case((is_past, 1), else_=0),
            case((is_past, -epoch), else_=epoch),
            Event.name,
            Event.id,
        )
        .limit(limit)
        .offset(offset)
    )
    return PublicEventList(
        items=[
            PublicEventSummary(
                id=e.id,
                name=e.name,
                slug=e.slug,
                starts_at=e.starts_at,
                ends_at=e.ends_at,
                location=e.location,
                timezone=e.timezone,
            )
            for e in events
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{slug}")
async def get_public_event(published: PublishedEventDep, session: SessionDep) -> PublicEvent:
    event, document = published
    venue, sessions = await live_program(session, event.id)
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
        venue=venue,
        sessions=sessions,
        program_files=await visible_program_files(session, event.id),
        **event_lifecycle(event),
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


# ── Server-side <head> for crawlers (included into index.html by the web server) ──────────────────

seo_router = APIRouter(prefix="/api/public/seo", tags=["public"])
_HEAD_HEADERS = {"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"}


def _origin(request: Request) -> str:
    configured: str | None = request.app.state.settings.public_origin
    return (configured or str(request.base_url)).rstrip("/")


async def _published(session: AsyncSession, slug: str) -> tuple[Event, PageDocument] | None:
    row = (
        await session.execute(
            select(Event, EventPage.published)
            .join(EventPage, EventPage.event_id == Event.id)
            .where(Event.slug == slug, EventPage.published.is_not(None), Event.archived_at.is_(None))
        )
    ).first()
    if row is None or row[1] is None:
        return None
    return row[0], PageDocument.model_validate(row[1])


async def _image_url(session: AsyncSession, request: Request, event: Event, document: PageDocument) -> str | None:
    asset_id = document.seo.share_image_asset_id or document.hero.cover_asset_id
    if asset_id is None:
        return None
    asset = await session.scalar(select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.event_id == event.id))
    return f"{_origin(request)}{public_media_url(asset)}" if asset else None


@seo_router.get("/e/{slug}", response_class=HTMLResponse)
async def congress_head(slug: str, request: Request, session: SessionDep) -> HTMLResponse:
    """`<head>` tags for `/e/{slug}`: published SEO title, description and share image, or neutral defaults."""
    found = await _published(session, slug)
    if found is None:
        return HTMLResponse(default_head(), headers=_HEAD_HEADERS)
    event, document = found
    lang = page_language(document, event.name)
    title = pick(document.seo.title, lang) or pick(document.hero.title, lang) or event.name
    description = pick(document.seo.description, lang) or pick(document.hero.subtitle, lang) or event.description or event.location
    head = render_head(
        title=title,
        description=description,
        url=f"{_origin(request)}/e/{event.slug}",
        image_url=await _image_url(session, request, event, document),
        lang=lang,
        indexable=True,
    )
    return HTMLResponse(head, headers=_HEAD_HEADERS)


@seo_router.get("/e/{slug}/booths/{booth_id}", response_class=HTMLResponse)
async def booth_head(slug: str, booth_id: str, request: Request, session: SessionDep) -> HTMLResponse:
    found = await _published(session, slug)
    try:
        booth_uuid = uuid.UUID(booth_id)
    except ValueError:
        booth_uuid = None
    booth = await session.get(Booth, booth_uuid) if found and booth_uuid else None
    if found is None or booth is None or booth.event_id != found[0].id:
        return HTMLResponse(default_head(), headers=_HEAD_HEADERS)
    event, document = found
    head = render_head(
        title=f"{booth.name} · {event.name}",
        description=booth.description or booth.location or event.name,
        url=f"{_origin(request)}/e/{event.slug}/booths/{booth.id}",
        image_url=None,
        lang=page_language(document, event.name),
        indexable=True,
    )
    return HTMLResponse(head, headers=_HEAD_HEADERS)


@seo_router.get("/{rest:path}", response_class=HTMLResponse, include_in_schema=False)
async def fallback_head(rest: str) -> HTMLResponse:
    """Any other public path the web server asks about gets the neutral head (never an error page)."""
    return HTMLResponse(default_head(), headers=_HEAD_HEADERS)
