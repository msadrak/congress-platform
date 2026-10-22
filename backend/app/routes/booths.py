import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import Booth, BoothBookmark, BoothStaff, EntityQR, Event, Lead, User
from app.routes.auth import CurrentUserDep
from app.routes.events import OwnedEventDep
from app.security import generate_entity_qr_secret
from app.sms.phone import IranMobile

router = APIRouter(tags=["booths"])

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
)
async def create_booth(
    event: OwnedEventDep,
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
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Booth slug already in use for this event"
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")
    return booth


@router.patch("/api/events/{event_id}/booths/{booth_id}")
async def update_booth(
    event: OwnedEventDep,
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
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Booth slug already in use for this event"
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
)
async def delete_booth(
    event: OwnedEventDep,
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
)
async def assign_booth_staff(
    event: OwnedEventDep,
    booth_id: uuid.UUID,
    body: BoothStaffAssign,
    session: SessionDep,
) -> BoothStaffOut:
    booth = await session.get(Booth, booth_id)
    if booth is None or booth.event_id != event.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    user = await session.scalar(select(User).where(User.mobile == body.mobile))

    if user is None:
        # The representative signs in later with an SMS code to this number.
        user = User(
            mobile=body.mobile,
            full_name=body.full_name or f"{booth.name} representative",
            organization=booth.name,
        )
        session.add(user)
        await session.flush()

    existing_staff = await session.scalar(
        select(BoothStaff).where(
            BoothStaff.booth_id == booth.id, BoothStaff.user_id == user.id
        )
    )
    if existing_staff is not None:
        return BoothStaffOut(
            id=existing_staff.id,
            booth_id=booth.id,
            user_id=user.id,
            mobile=user.mobile,
            full_name=user.full_name,
        )

    staff = BoothStaff(booth_id=booth.id, user_id=user.id)
    session.add(staff)
    await session.commit()

    return BoothStaffOut(
        id=staff.id,
        booth_id=booth.id,
        user_id=user.id,
        mobile=user.mobile,
        full_name=user.full_name,
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


@router.get("/api/booths/{booth_id}")
async def get_booth_portal(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
) -> BoothOut:
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    # Commercial isolation: verify user is assigned to this booth
    is_staff = await session.scalar(
        select(BoothStaff.id).where(
            BoothStaff.booth_id == booth.id, BoothStaff.user_id == user.id
        )
    )
    if not is_staff:
        # Check if user owns the event as organizer
        event = await session.get(Event, booth.event_id)
        if event is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Access to this booth portal is restricted to authorized staff",
            )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
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


@router.post(
    "/api/attendees/me/bookmarks/booths/{booth_id}",
    status_code=status.HTTP_201_CREATED,
)
async def bookmark_booth(
    booth_id: uuid.UUID,
    user: CurrentUserDep,
    session: SessionDep,
    response: Response,
) -> BookmarkToggleOut:
    booth = await session.get(Booth, booth_id)
    if booth is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booth not found")

    existing = await session.scalar(
        select(BoothBookmark).where(
            BoothBookmark.user_id == user.id,
            BoothBookmark.booth_id == booth.id,
        )
    )
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return BookmarkToggleOut(bookmarked=True, booth_id=booth.id)

    bookmark = BoothBookmark(user_id=user.id, booth_id=booth.id)
    session.add(bookmark)
    await session.commit()
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
