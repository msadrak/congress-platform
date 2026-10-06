import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import SessionDep
from app.models import Booth, BoothStaff, EntityQR, Event, User
from app.routes.auth import CurrentUserDep
from app.routes.events import OwnedEventDep
from app.security import generate_entity_qr_secret, hash_password

router = APIRouter(tags=["booths"])

SlugStr = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
]


class BoothCreate(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=200)]
    slug: SlugStr
    location: Annotated[str, Field(max_length=100)] = ""
    description: str = ""
    website_url: Annotated[str, Field(max_length=500)] = ""
    brochure_url: Annotated[str, Field(max_length=500)] = ""


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
    email: EmailStr


class BoothStaffOut(BaseModel):
    id: uuid.UUID
    booth_id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str


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

    email = body.email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email))

    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_urlsafe(16)),
            full_name=email.split("@")[0].capitalize(),
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
            email=user.email,
            full_name=user.full_name,
        )

    staff = BoothStaff(booth_id=booth.id, user_id=user.id)
    session.add(staff)
    await session.commit()

    return BoothStaffOut(
        id=staff.id,
        booth_id=booth.id,
        user_id=user.id,
        email=user.email,
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
            email=user.email,
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
