import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import OrganizerDep
from app.db import SessionDep
from app.models import Event

router = APIRouter(prefix="/api/events", tags=["events"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
]


class EventCreate(BaseModel):
    name: Name
    slug: Slug
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    location: Annotated[str, Field(max_length=300)]
    description: Annotated[str, Field(max_length=10_000)] = ""

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "EventCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self

class EventUpdate(BaseModel):
    name: Name | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    location: Annotated[str, Field(max_length=300)] | None = None
    description: Annotated[str, Field(max_length=10_000)] | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    starts_at: datetime
    ends_at: datetime
    location: str
    description: str


async def owned_event(
    event_id: uuid.UUID, organizer: OrganizerDep, session: SessionDep
) -> Event:
    """The one place tenant isolation is enforced for event-scoped routes.

    Another organizer's event is indistinguishable from a missing one (404).
    """
    event = await session.scalar(
        select(Event).where(Event.id == event_id, Event.organizer_id == organizer.id)
    )
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    return event


OwnedEventDep = Annotated[Event, Depends(owned_event)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_event(
    body: EventCreate, organizer: OrganizerDep, session: SessionDep
) -> EventOut:
    event = Event(organizer_id=organizer.id, **body.model_dump())
    session.add(event)
    try:
        await session.commit()
    except IntegrityError:
        # events.slug is the only unique column a caller can collide on.
        raise HTTPException(status.HTTP_409_CONFLICT, "Slug already in use") from None
    return EventOut.model_validate(event)


@router.get("")
async def list_events(organizer: OrganizerDep, session: SessionDep) -> list[EventOut]:
    events = await session.scalars(
        select(Event).where(Event.organizer_id == organizer.id).order_by(Event.starts_at)
    )
    return [EventOut.model_validate(event) for event in events]


@router.get("/{event_id}")
async def get_event(event: OwnedEventDep) -> EventOut:
    return EventOut.model_validate(event)


@router.patch("/{event_id}")
async def update_event(
    body: EventUpdate, event: OwnedEventDep, session: SessionDep
) -> EventOut:
    new_starts = body.starts_at if body.starts_at is not None else event.starts_at
    new_ends = body.ends_at if body.ends_at is not None else event.ends_at
    if new_ends <= new_starts:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "ends_at must be after starts_at"
        )

    if body.name is not None:
        event.name = body.name
    if body.description is not None:
        event.description = body.description
    if body.location is not None:
        event.location = body.location
    if body.starts_at is not None:
        event.starts_at = body.starts_at
    if body.ends_at is not None:
        event.ends_at = body.ends_at

    await session.commit()
    await session.refresh(event)
    return EventOut.model_validate(event)
