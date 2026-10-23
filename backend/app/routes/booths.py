import re
import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep, add_or_existing
from app.errors import ApiError, error_responses
from app.models import Booth, BoothBookmark, BoothStaff, EntityQR, Event, EventPage, Lead, Ticket, User
from app.rate_limit import Budget, client_ip, limiter
from app.routes.auth import CurrentUserDep
from app.routes.events import OwnedEventDep, WritableEventDep
from app.security import generate_entity_qr_secret
from app.sms.outbox import queue_staff_invite
from app.sms.phone import IranMobile

router = APIRouter(tags=["booths"])
# Anonymous booth QR resolution (the standee): its own prefix, registered in app/main.py.
public_router = APIRouter(prefix="/api/public/booths", tags=["public"])

# Per 15 minutes: unknown booth codes per client IP (anonymous) and per signed-in attendee (bookmark scans).
BOOTH_QR_FAILURES_PER_IP = Budget(20)
BOOTH_QR_FAILURES_PER_USER = Budget(20)
THROTTLED = "Too many attempts. Try again later."
_BOOTH_CODE = re.compile(r"^[a-z0-9]{8,64}$")

SlugStr = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
]


def _web_link(value: str) -> str:
    """Empty, or an absolute http(s) address: these become links on the public booth page, so no
    javascript:/data: schemes, scheme-relative or relative paths."""
    value = value.strip()
    if not value:
        return ""
    parts = urlsplit(value)
    if (
        parts.scheme.lower() not in ("http", "https")
        or not parts.hostname
        or any(ch.isspace() or ord(ch) < 32 for ch in value)
    ):
        raise ValueError("Enter a full web address starting with https:// or http://.")
    return value


WebLink = Annotated[str, Field(max_length=500), AfterValidator(_web_link)]
# A short overview shown on the public booth page and in the booth directory.
BoothDescription = Annotated[str, Field(max_length=2000)]


class BoothCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    slug: SlugStr
    location: Annotated[str, Field(max_length=100)] = ""
    description: BoothDescription = ""
    website_url: WebLink = ""
    brochure_url: WebLink = ""


class BoothUpdate(BaseModel):
    """Partial update: omitted fields keep their value."""

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    slug: SlugStr | None = None
    location: Annotated[str, Field(max_length=100)] | None = None
    description: BoothDescription | None = None
    website_url: WebLink | None = None
    brochure_url: WebLink | None = None



class BoothOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    name: str
    slug: str
    location: str
    description: str
    website_url: str
    brochure_url: str
    qr_secret: str
    created_at: datetime


class BoothStaffAssign(BaseModel):
    mobile: IranMobile
    # Used only when the number has no account yet; an existing account keeps its own name.
    full_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""


class BoothStaffOut(BaseModel):
    id: uuid.UUID
    booth_id: uuid.UUID
    user_id: uuid.UUID
    mobile: str | None
    full_name: str


class BookmarkToggleOut(BaseModel):
    bookmarked: bool
    booth_id: uuid.UUID


class BoothCodeIn(BaseModel):
    # The booth QR's secret, or the whole standee URL (its `b` parameter is used).
    code: Annotated[str, Field(max_length=500)]


class BoothScanBookmarkIn(BoothCodeIn):
    # Congress-scoped callers name their congress; a booth of another congress is then refused.
    event_id: uuid.UUID | None = None


class BoothScanBookmarkOut(BookmarkToggleOut):
    name: str
    event_slug: str


class BoothResolveOut(BaseModel):
    """What anyone holding the booth QR may learn: the public booth page's address parts."""

    booth_id: uuid.UUID
    name: str
    slug: str
    event_slug: str
    event_name: str


class BoothStandeeOut(BaseModel):
    # Encode this in the standee QR: the public booth page; `b` lets a signed-in attendee bookmark in one tap.
    url: str
    booth_id: uuid.UUID
    qr_secret: str
    # The public page answers 404 until the event page is published; print after publishing.
    page_published: bool


class BookmarkedBoothOut(BaseModel):
    booth_id: uuid.UUID
    name: str
    slug: str
    location: str
    description: str
    website_url: str
    brochure_url: str
    event_name: str
    event_slug: str
    bookmarked_at: datetime


@router.post(
    "/api/events/{event_id}/booths",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(status.HTTP_409_CONFLICT),
)
async def create_booth(
    event: WritableEventDep,
    body: BoothCreate,
    session: SessionDep,
) -> BoothOut:
    booth = Booth(
        event_id=event.id,
        name=body.name.strip(),
        slug=body.slug.strip().lower(),
        location=body.location.strip(),
        description=body.description.strip(),
        website_url=body.website_url.strip(),
        brochure_url=body.brochure_url.strip(),
    )
    session.add(booth)
    try:
        await session.flush()
    except IntegrityError:
        raise ApiError(
            status.HTTP_409_CONFLICT, "BOOTH_SLUG_TAKEN", "Booth slug already in use for this event"
        ) from None

    secret = generate_entity_qr_secret()
    qr = EntityQR(
        secret=secret,
        entity_type="booth",
        entity_id=booth.id,
        is_active=True,
    )
    session.add(qr)
    await session.commit()

    return BoothOut(
        id=booth.id,
        event_id=booth.event_id,
        name=booth.name,
        slug=booth.slug,
        location=booth.location,
        description=booth.description,
        website_url=booth.website_url,
        brochure_url=booth.brochure_url,
        qr_secret=secret,
        created_at=booth.created_at,
    )


@router.get("/api/events/{event_id}/booths")
async def list_event_booths(
    event: OwnedEventDep,
    session: SessionDep,
) -> list[BoothOut]:
    query = (
        select(Booth, EntityQR)
        .join(
            EntityQR,
            (EntityQR.entity_id == Booth.id) & (EntityQR.entity_type == "booth"),
        )
        .where(Booth.event_id == event.id)
        .order_by(Booth.created_at)
    )
    res = await session.execute(query)
    rows = res.all()

    return [
        BoothOut(
            id=b.id,
            event_id=b.event_id,
            name=b.name,
            slug=b.slug,
            location=b.location,
            description=b.description,
            website_url=b.website_url,
            brochure_url=b.brochure_url,
            qr_secret=qr.secret,
            created_at=b.created_at,
        )
        for b, qr in rows
    ]


async def _own_booth(session: SessionDep, event: Event, booth_id: uuid.UUID) -> Booth:
    booth = await session.get(Booth, booth_id)
    if booth is None or booth.event_id != event.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_NOT_FOUND", "Booth not found")
    return booth


def booth_code(raw: str) -> str | None:
    """The booth secret in a scanned code: the raw secret, or the `b` parameter of a standee URL. None when it
    cannot be one (then it is never looked up)."""
    value = raw.strip()
    if "://" in value or "?" in value:
        found = parse_qs(urlsplit(value).query).get("b")
        value = found[0] if found else ""
    value = value.strip().lower()
    return value if _BOOTH_CODE.fullmatch(value) else None


async def booth_by_code(session: AsyncSession, raw: str) -> tuple[Booth, Event] | None:
    code = booth_code(raw)
    if code is None:
        return None
    row = (
        await session.execute(
            select(Booth, Event)
            .join(EntityQR, (EntityQR.entity_id == Booth.id) & (EntityQR.entity_type == "booth"))
            .join(Event, Event.id == Booth.event_id)
            .where(EntityQR.secret == code, EntityQR.is_active.is_(True))
        )
    ).first()
    return (row[0], row[1]) if row else None


async def require_active_ticket(session: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID) -> None:
    """403 unless the user holds an active ticket for the event (booth bookmarks, networking scans)."""
    ticket = await session.scalar(
        select(Ticket.id).where(Ticket.user_id == user_id, Ticket.event_id == event_id, Ticket.status == "active")
    )
    if ticket is None:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "ACTIVE_TICKET_REQUIRED", "You need an active ticket for this congress"
        )


@router.patch("/api/events/{event_id}/booths/{booth_id}", responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT))
async def update_booth(
    event: WritableEventDep,
    booth_id: uuid.UUID,
    body: BoothUpdate,
    session: SessionDep,
) -> BoothOut:
    booth = await _own_booth(session, event, booth_id)
    if body.name is not None:
        booth.name = body.name.strip()
    if body.slug is not None:
        booth.slug = body.slug.strip().lower()
    if body.location is not None:
        booth.location = body.location.strip()
    if body.description is not None:
        booth.description = body.description.strip()
    if body.website_url is not None:
        booth.website_url = body.website_url.strip()
    if body.brochure_url is not None:
        booth.brochure_url = body.brochure_url.strip()
    try:
        await session.flush()
    except IntegrityError:
        raise ApiError(
            status.HTTP_409_CONFLICT, "BOOTH_SLUG_TAKEN", "Booth slug already in use for this event"
        ) from None
    secret = await session.scalar(
        select(EntityQR.secret).where(
            EntityQR.entity_id == booth.id, EntityQR.entity_type == "booth"
        )
    )
    await session.commit()
    await session.refresh(booth)

    return BoothOut(
        id=booth.id,
        event_id=booth.event_id,
        name=booth.name,
        slug=booth.slug,
        location=booth.location,
        description=booth.description,
        website_url=booth.website_url,
        brochure_url=booth.brochure_url,
        qr_secret=secret or "",
        created_at=booth.created_at,
    )


@router.delete(
    "/api/events/{event_id}/booths/{booth_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def delete_booth(
    event: WritableEventDep,
    booth_id: uuid.UUID,
    session: SessionDep,
) -> Response:
    """Removes the booth with everything that only exists for it: captured leads, staff assignments,
    attendee bookmarks and its booth QR (which then no longer resolves)."""
    booth = await _own_booth(session, event, booth_id)
    await session.execute(delete(Lead).where(Lead.booth_id == booth.id))
    await session.execute(delete(BoothStaff).where(BoothStaff.booth_id == booth.id))
    await session.execute(delete(BoothBookmark).where(BoothBookmark.booth_id == booth.id))
    await session.execute(
        delete(EntityQR).where(EntityQR.entity_id == booth.id, EntityQR.entity_type == "booth")
    )
    await session.delete(booth)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/api/events/{event_id}/booths/{booth_id}/staff",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def assign_booth_staff(
    event: WritableEventDep,
    booth_id: uuid.UUID,
    body: BoothStaffAssign,
    request: Request,
    session: SessionDep,
) -> BoothStaffOut:
    """Assigns a representative by mobile number and texts them a link to the booth portal (queued in the
    same transaction). Assigning someone already at the booth changes nothing and sends nothing."""
    booth = await _own_booth(session, event, booth_id)

    user = await session.scalar(select(User).where(User.mobile == body.mobile))
    # The answer names the representative as submitted: an existing account keeps its own name, which is not
    # echoed back, so typing a number never reveals who holds it.
    shown_name = body.full_name

    if user is None:
        # The representative signs in later with an SMS code to this number. A concurrent request may create
        # the account first; then that account is used (and keeps its own name).
        account, created = await add_or_existing(
            session,
            User(mobile=body.mobile, full_name=body.full_name or f"{booth.name} representative", organization=booth.name),
            select(User).where(User.mobile == body.mobile),
        )
        if created:
            shown_name = account.full_name
        user = account

    # Assigning twice (or two requests at once) answers with the one assignment.
    staff, created = await add_or_existing(
        session,
        BoothStaff(booth_id=booth.id, user_id=user.id),
        select(BoothStaff).where(BoothStaff.booth_id == booth.id, BoothStaff.user_id == user.id),
    )
    if created:
        # Only a new assignment is announced; assigning someone already at the booth sends nothing.
        await queue_staff_invite(
            session, request.app.state.settings, str(request.base_url), user=user, booth=booth, event=event
        )
    await session.commit()

    return BoothStaffOut(
        id=staff.id,
        booth_id=booth.id,
        user_id=user.id,
        mobile=body.mobile,
        full_name=shown_name,
    )


@router.get("/api/events/{event_id}/booths/{booth_id}/staff")
async def list_booth_staff(
    event: OwnedEventDep,
    booth_id: uuid.UUID,
    session: SessionDep,
) -> list[BoothStaffOut]:
    booth = await session.get(Booth, booth_id)
    if booth is None or booth.event_id != event.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    query = (
        select(BoothStaff, User)
        .join(User, BoothStaff.user_id == User.id)
        .where(BoothStaff.booth_id == booth.id)
        .order_by(BoothStaff.created_at)
    )
    res = await session.execute(query)
    rows = res.all()

    return [
        BoothStaffOut(
            id=staff.id,
            booth_id=staff.booth_id,
            user_id=user.id,
            mobile=user.mobile,
            full_name=user.full_name,
        )
        for staff, user in rows
    ]


@router.delete(
    "/api/events/{event_id}/booths/{booth_id}/staff/{staff_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def remove_booth_staff(
    event: WritableEventDep,
    booth_id: uuid.UUID,
    staff_id: uuid.UUID,
    session: SessionDep,
) -> Response:
    """Ends a representative's access to the booth portal, its leads and exports from their next request on.
    Leads they captured stay with the booth, still attributed to them; the account itself is untouched."""
    booth = await _own_booth(session, event, booth_id)
    staff = await session.get(BoothStaff, staff_id)
    if staff is None or staff.booth_id != booth.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_STAFF_NOT_FOUND", "Booth staff member not found")
    await session.delete(staff)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/api/events/{event_id}/booths/{booth_id}/standee",
    responses=error_responses(status.HTTP_404_NOT_FOUND),
)
async def get_booth_standee(
    event: OwnedEventDep,
    booth_id: uuid.UUID,
    request: Request,
    session: SessionDep,
) -> BoothStandeeOut:
    """The URL to print in the booth's standee QR: `<public origin>/e/<slug>/booths/<booth_id>?b=<secret>`.

    A plain web address, so any phone camera opens the public booth page (no app or sign-in needed), while the
    `b` parameter carries the booth QR secret so a signed-in ticket holder can bookmark the booth in one tap
    (`POST /api/attendees/me/bookmarks/booths/scan`). The secret grants nothing beyond that: it is printed on
    the stand for everyone to see.
    """
    booth = await _own_booth(session, event, booth_id)
    secret = await session.scalar(
        select(EntityQR.secret).where(
            EntityQR.entity_id == booth.id, EntityQR.entity_type == "booth", EntityQR.is_active.is_(True)
        )
    )
    if secret is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_QR_NOT_FOUND", "Booth QR not found")
    published = await session.scalar(
        select(EventPage.event_id).where(EventPage.event_id == event.id, EventPage.published.is_not(None))
    )
    origin = (request.app.state.settings.public_origin or str(request.base_url)).rstrip("/")
    return BoothStandeeOut(
        url=f"{origin}/e/{event.slug}/booths/{booth.id}?{urlencode({'b': secret})}",
        booth_id=booth.id,
        qr_secret=secret,
        page_published=published is not None,
    )


@router.get("/api/booths/me")
async def get_my_assigned_booths(
    user: CurrentUserDep,
    session: SessionDep,
) -> list[BoothOut]:
    query = (
        select(Booth, EntityQR)
        .join(BoothStaff, BoothStaff.booth_id == Booth.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Booth.id) & (EntityQR.entity_type == "booth"),
        )
        .where(BoothStaff.user_id == user.id)
        .order_by(Booth.created_at)
    )
    res = await session.execute(query)
    rows = res.all()

    return [
        BoothOut(
            id=b.id,
            event_id=b.event_id,
            name=b.name,
            slug=b.slug,
            location=b.location,
            description=b.description,
            website_url=b.website_url,
            brochure_url=b.brochure_url,
            qr_secret=qr.secret,
            created_at=b.created_at,
        )
        for b, qr in rows
    ]


@router.get("/api/booths/{booth_id}", responses=error_responses(status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND))
async def get_booth_portal(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> BoothOut:
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_NOT_FOUND", "Booth not found")

    # Commercial isolation: only the booth's current staff (a removed representative is refused at once).
    is_staff = await session.scalar(
        select(BoothStaff.id).where(
            BoothStaff.booth_id == booth.id, BoothStaff.user_id == user.id
        )
    )
    if not is_staff:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "BOOTH_STAFF_REQUIRED",
            "Access to this booth portal is restricted to authorized staff",
        )

    qr = await session.scalar(
        select(EntityQR).where(
            EntityQR.entity_id == booth.id, EntityQR.entity_type == "booth"
        )
    )
    if qr is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Booth QR missing")

    return BoothOut(
        id=booth.id,
        event_id=booth.event_id,
        name=booth.name,
        slug=booth.slug,
        location=booth.location,
        description=booth.description,
        website_url=booth.website_url,
        brochure_url=booth.brochure_url,
        qr_secret=qr.secret,
        created_at=booth.created_at,
    )


async def _require_bookmarkable(
    session: AsyncSession, user_id: uuid.UUID, booth: Booth, event_id: uuid.UUID | None
) -> None:
    """A bookmark belongs to a congress the attendee takes part in: an active ticket for the booth's event,
    and, for a congress-scoped caller, a booth of that congress."""
    if event_id is not None and booth.event_id != event_id:
        raise ApiError(status.HTTP_409_CONFLICT, "BOOTH_OTHER_EVENT", "This booth belongs to a different congress")
    await require_active_ticket(session, user_id, booth.event_id)


async def _add_bookmark(session: AsyncSession, user_id: uuid.UUID, booth: Booth) -> bool:
    """Saves the bookmark; False when it already existed. Bookmarking twice, or from two tabs at once, keeps the
    one bookmark."""
    _, created = await add_or_existing(
        session,
        BoothBookmark(user_id=user_id, booth_id=booth.id),
        select(BoothBookmark).where(BoothBookmark.user_id == user_id, BoothBookmark.booth_id == booth.id),
    )
    await session.commit()
    return created


@router.post(
    "/api/attendees/me/bookmarks/booths/scan",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(403, 404, 409, 429),
)
async def bookmark_booth_by_qr(
    body: BoothScanBookmarkIn,
    user: CurrentUserDep,
    request: Request,
    session: SessionDep,
    response: Response,
) -> BoothScanBookmarkOut:
    """Bookmarks the booth whose QR (secret or standee URL) the attendee scanned: 201 new, 200 already saved."""
    throttle = limiter(request)
    failures = f"boothqr:fail:user:{user.id}"
    await throttle.check((failures, BOOTH_QR_FAILURES_PER_USER), detail=THROTTLED, code="BOOTH_QR_RATE_LIMITED")
    found = await booth_by_code(session, body.code)
    if found is None:
        await throttle.fail(failures)
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_QR_NOT_FOUND", "Unrecognized booth QR")
    booth, event = found
    await _require_bookmarkable(session, user.id, booth, body.event_id)
    if not await _add_bookmark(session, user.id, booth):
        response.status_code = status.HTTP_200_OK
    return BoothScanBookmarkOut(bookmarked=True, booth_id=booth.id, name=booth.name, event_slug=event.slug)


@router.post(
    "/api/attendees/me/bookmarks/booths/{booth_id}",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(403, 404, 409),
)
async def bookmark_booth(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
    response: Response,
    event_id: Annotated[uuid.UUID | None, Query(description="The congress the caller is in, if any")] = None,
) -> BookmarkToggleOut:
    """Saves a booth for an attendee with an active ticket for its congress: 201 new, 200 already saved."""
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_NOT_FOUND", "Booth not found")
    await _require_bookmarkable(session, user.id, booth, event_id)
    if not await _add_bookmark(session, user.id, booth):
        response.status_code = status.HTTP_200_OK
    return BookmarkToggleOut(bookmarked=True, booth_id=booth.id)


@router.delete("/api/attendees/me/bookmarks/booths/{booth_id}")
async def unbookmark_booth(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> BookmarkToggleOut:
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    bookmark = await session.scalar(
        select(BoothBookmark).where(
            BoothBookmark.user_id == user.id,
            BoothBookmark.booth_id == booth.id,
        )
    )
    if bookmark is not None:
        await session.delete(bookmark)
        await session.commit()

    return BookmarkToggleOut(bookmarked=False, booth_id=booth.id)


@router.get("/api/attendees/me/bookmarks/booths")
async def list_my_bookmarked_booths(
    user: CurrentUserDep,
    session: SessionDep,
) -> list[BookmarkedBoothOut]:
    query = (
        select(BoothBookmark, Booth, Event)
        .join(Booth, BoothBookmark.booth_id == Booth.id)
        .join(Event, Booth.event_id == Event.id)
        .where(BoothBookmark.user_id == user.id)
        .order_by(BoothBookmark.created_at.desc())
    )
    res = await session.execute(query)
    rows = res.all()

    return [
        BookmarkedBoothOut(
            booth_id=b.id,
            name=b.name,
            slug=b.slug,
            location=b.location,
            description=b.description,
            website_url=b.website_url,
            brochure_url=b.brochure_url,
            event_name=ev.name,
            event_slug=ev.slug,
            bookmarked_at=bm.created_at,
        )
        for bm, b, ev in rows
    ]


@public_router.post("/resolve", responses=error_responses(404, 429))
async def resolve_booth_qr(body: BoothCodeIn, request: Request, session: SessionDep) -> BoothResolveOut:
    """Anyone: the booth behind a booth QR (its secret, or the standee URL), to open its public page.

    Answers only for an event whose page is published, exactly like the public booth page; unknown codes are
    throttled per client IP so secrets cannot be guessed.
    """
    throttle = limiter(request)
    failures = f"boothqr:fail:ip:{client_ip(request)}"
    await throttle.check((failures, BOOTH_QR_FAILURES_PER_IP), detail=THROTTLED, code="BOOTH_QR_RATE_LIMITED")
    found = await booth_by_code(session, body.code)
    published = found is not None and await session.scalar(
        select(EventPage.event_id).where(EventPage.event_id == found[1].id, EventPage.published.is_not(None))
    )
    if found is None or not published:
        await throttle.fail(failures)
        raise ApiError(status.HTTP_404_NOT_FOUND, "BOOTH_QR_NOT_FOUND", "Unrecognized booth QR")
    booth, event = found
    return BoothResolveOut(
        booth_id=booth.id, name=booth.name, slug=booth.slug, event_slug=event.slug, event_name=event.name
    )
