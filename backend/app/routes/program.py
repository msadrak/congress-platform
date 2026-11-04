"""The congress program (sessions) and the venue directory (entrances and halls).

Both are operational data, like ticket tiers: attendees see a change as soon as it is saved, with no
Page Studio publish step (ADR 0014). Venue places are informational (where to find an entrance or a
hall); they are not Check-In Points and admit nobody. Every route is scoped by `OwnedEventDep`.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidatorFunctionWrapHandler,
    field_validator,
    model_validator,
)
from pydantic_core import PydanticCustomError, ValidationError
from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import Event, EventSession, VenuePlace
from app.routes.events import OwnedEventDep, WritableEventDep, event_day_window

router = APIRouter(prefix="/api/events/{event_id}", tags=["program"])

VenuePlaceKind = Literal["entrance", "hall"]

PlaceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
PlaceLocation = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Track = Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]
Speakers = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4_000)]
HallName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]

ENDS_BEFORE_STARTS = "ends_at must be after starts_at"


def hall_key(name: str) -> str:
    """Hall names are unique per event ignoring case and spacing ("Main  hall" is "main hall")."""
    return " ".join(name.split()).casefold()


# ── Venue directory ──────────────────────────────────────────────────────────────────────────────


class VenuePlaceCreate(BaseModel):
    kind: VenuePlaceKind
    name: PlaceName
    location: PlaceLocation = ""


class VenuePlaceUpdate(BaseModel):
    """Partial update; the kind of a place never changes (delete and re-add instead)."""

    name: PlaceName | None = None
    location: PlaceLocation | None = None
    position: Annotated[int, Field(ge=0, le=1_000_000)] | None = None


class PublicVenuePlace(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: VenuePlaceKind
    name: str
    location: str


class VenuePlaceOut(PublicVenuePlace):
    event_id: uuid.UUID
    position: int
    created_at: datetime


def _places(event_id: uuid.UUID) -> Select[VenuePlace]:
    # Entrances first, then halls ("entrance" < "hall"); within a kind the organizer's order.
    return (
        select(VenuePlace)
        .where(VenuePlace.event_id == event_id)
        .order_by(VenuePlace.kind, VenuePlace.position, VenuePlace.created_at, VenuePlace.id)
    )


async def _next_position(session: AsyncSession, event_id: uuid.UUID, kind: str) -> int:
    highest = await session.scalar(
        select(func.max(VenuePlace.position)).where(VenuePlace.event_id == event_id, VenuePlace.kind == kind)
    )
    return 0 if highest is None else highest + 1


async def _require_unique_hall(
    session: AsyncSession, event: Event, name: str, except_id: uuid.UUID | None = None
) -> None:
    # Serializes hall writes per event, so two concurrent requests cannot both add the same name.
    await session.execute(select(Event.id).where(Event.id == event.id).with_for_update())
    halls = await session.scalars(_places(event.id).where(VenuePlace.kind == "hall"))
    if any(hall.id != except_id and hall_key(hall.name) == hall_key(name) for hall in halls):
        raise ApiError(status.HTTP_409_CONFLICT, "HALL_NAME_TAKEN", f"This event already has a hall named “{name}”")


async def _own_place(session: AsyncSession, event: Event, place_id: uuid.UUID) -> VenuePlace:
    place = await session.scalar(
        select(VenuePlace).where(VenuePlace.id == place_id, VenuePlace.event_id == event.id)
    )
    if place is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venue place not found")
    return place


@router.get("/venue-places")
async def list_venue_places(event: OwnedEventDep, session: SessionDep) -> list[VenuePlaceOut]:
    places = await session.scalars(_places(event.id))
    return [VenuePlaceOut.model_validate(place) for place in places]


@router.post("/venue-places", status_code=status.HTTP_201_CREATED, responses=error_responses(status.HTTP_409_CONFLICT))
async def create_venue_place(body: VenuePlaceCreate, event: WritableEventDep, session: SessionDep) -> VenuePlaceOut:
    if body.kind == "hall":
        await _require_unique_hall(session, event, body.name)
    place = VenuePlace(
        event_id=event.id,
        kind=body.kind,
        name=body.name,
        location=body.location,
        position=await _next_position(session, event.id, body.kind),
    )
    session.add(place)
    await session.commit()
    await session.refresh(place)
    return VenuePlaceOut.model_validate(place)


@router.patch("/venue-places/{place_id}", responses=error_responses(status.HTTP_409_CONFLICT))
async def update_venue_place(
    place_id: uuid.UUID, body: VenuePlaceUpdate, event: WritableEventDep, session: SessionDep
) -> VenuePlaceOut:
    place = await _own_place(session, event, place_id)
    if body.name is not None and place.kind == "hall":
        await _require_unique_hall(session, event, body.name, except_id=place.id)
    if body.name is not None:
        place.name = body.name
    if body.location is not None:
        place.location = body.location
    if body.position is not None:
        place.position = body.position
    await session.commit()
    await session.refresh(place)
    return VenuePlaceOut.model_validate(place)


@router.delete(
    "/venue-places/{place_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(status.HTTP_409_CONFLICT)
)
async def delete_venue_place(place_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> Response:
    """A hall that sessions are held in cannot be deleted (409 with how many): move them first."""
    place = await _own_place(session, event, place_id)
    used_by = await session.scalar(select(func.count(EventSession.id)).where(EventSession.hall_id == place.id)) or 0
    if used_by:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "HALL_IN_USE",
            f"{used_by} session(s) are held in this hall; move them to another hall before deleting it",
        )
    await session.delete(place)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Program ──────────────────────────────────────────────────────────────────────────────────────


class EventSessionCreate(BaseModel):
    title: Title
    track: Track = ""
    speakers: Speakers = ""
    description: Description = ""
    hall_id: uuid.UUID | None = None
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "EventSessionCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError(ENDS_BEFORE_STARTS)
        return self


class EventSessionUpdate(BaseModel):
    """Partial update: omitted fields keep their value; an explicit `hall_id: null` clears the hall."""

    title: Title | None = None
    track: Track | None = None
    speakers: Speakers | None = None
    description: Description | None = None
    hall_id: uuid.UUID | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None


class EventSessionImportRow(BaseModel):
    title: Title
    track: Track = ""
    speakers: Speakers = ""
    description: Description = ""
    # A hall name, matched case-insensitively against this event's halls; unknown names create a hall.
    hall: HallName = ""
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def _ends_after_it_starts(self) -> "EventSessionImportRow":
        if self.ends_at <= self.starts_at:
            raise ValueError(ENDS_BEFORE_STARTS)
        return self


class EventSessionImport(BaseModel):
    """A whole timetable at once: every row is valid or nothing is saved."""

    replace: bool = False
    sessions: Annotated[list[EventSessionImportRow], Field(min_length=1, max_length=500)]

    @field_validator("sessions", mode="wrap")
    @classmethod
    def _name_the_row(cls, value: object, handler: ValidatorFunctionWrapHandler) -> list[EventSessionImportRow]:
        """Row errors read "Row 3: title: …" (1-based, as in the organizer's spreadsheet)."""
        try:
            rows: list[EventSessionImportRow] = handler(value)
        except ValidationError as exc:
            messages = []
            for error in exc.errors():
                loc = error["loc"]
                message = error["msg"].removeprefix("Value error, ")
                if loc and isinstance(loc[0], int):
                    field = ".".join(str(part) for part in loc[1:])
                    messages.append(f"Row {loc[0] + 1}: {field + ': ' if field else ''}{message}")
                else:
                    messages.append(message)
            raise PydanticCustomError("session_import", "{detail}", {"detail": "; ".join(messages)}) from None
        return rows


class EventSessionImportOut(BaseModel):
    created: int
    removed: int
    halls_created: int


class PublicSession(BaseModel):
    id: uuid.UUID
    title: str
    track: str
    speakers: str
    description: str
    hall_id: uuid.UUID | None
    # "" when the session has no hall.
    hall_name: str
    starts_at: datetime
    ends_at: datetime


class EventSessionOut(PublicSession):
    event_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


def _sessions(event_id: uuid.UUID) -> Select[EventSession, str | None]:
    return (
        select(EventSession, VenuePlace.name)
        .outerjoin(VenuePlace, VenuePlace.id == EventSession.hall_id)
        .where(EventSession.event_id == event_id)
        .order_by(EventSession.starts_at, EventSession.title, EventSession.id)
    )


def _session_out(item: EventSession, hall_name: str | None) -> EventSessionOut:
    return EventSessionOut(
        id=item.id,
        event_id=item.event_id,
        title=item.title,
        track=item.track,
        speakers=item.speakers,
        description=item.description,
        hall_id=item.hall_id,
        hall_name=hall_name or "",
        starts_at=item.starts_at,
        ends_at=item.ends_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


async def _hall_name(session: AsyncSession, event: Event, hall_id: uuid.UUID | None) -> str | None:
    """The name of `hall_id`, which must be a hall (not an entrance) of this event; 422 otherwise."""
    if hall_id is None:
        return None
    name = await session.scalar(
        select(VenuePlace.name).where(
            VenuePlace.id == hall_id, VenuePlace.event_id == event.id, VenuePlace.kind == "hall"
        )
    )
    if name is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "hall_id is not a hall of this event")
    return name


def _outside_event_days(event: Event, starts_at: datetime, ends_at: datetime) -> str | None:
    """Sessions fall within the event's first through last day, read in the event's time zone."""
    start, end, first, last = event_day_window(event)
    if starts_at < start or ends_at > end:
        return f"The session must fall within the event days ({first.isoformat()} to {last.isoformat()}, {event.timezone})"
    return None


async def _own_session(session: AsyncSession, event: Event, session_id: uuid.UUID) -> EventSession:
    item = await session.scalar(
        select(EventSession).where(EventSession.id == session_id, EventSession.event_id == event.id)
    )
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return item


@router.get("/sessions")
async def list_sessions(event: OwnedEventDep, session: SessionDep) -> list[EventSessionOut]:
    rows = await session.execute(_sessions(event.id))
    return [_session_out(item, hall_name) for item, hall_name in rows]


@router.post("/sessions", status_code=status.HTTP_201_CREATED, responses=error_responses(status.HTTP_409_CONFLICT))
async def create_session(body: EventSessionCreate, event: WritableEventDep, session: SessionDep) -> EventSessionOut:
    outside = _outside_event_days(event, body.starts_at, body.ends_at)
    if outside:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, outside)
    hall_name = await _hall_name(session, event, body.hall_id)
    item = EventSession(event_id=event.id, **body.model_dump())
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return _session_out(item, hall_name)


# Declared before /sessions/{session_id} (static paths precede parameterized siblings).
@router.post("/sessions/import", responses=error_responses(status.HTTP_409_CONFLICT))
async def import_sessions(body: EventSessionImport, event: WritableEventDep, session: SessionDep) -> EventSessionImportOut:
    outside = [
        f"Row {index}: {problem}"
        for index, row in enumerate(body.sessions, start=1)
        if (problem := _outside_event_days(event, row.starts_at, row.ends_at))
    ]
    if outside:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "; ".join(outside[:20]))
    # One import per event at a time, so two concurrent imports cannot both create the same new hall.
    await session.execute(select(Event.id).where(Event.id == event.id).with_for_update())

    halls: dict[str, uuid.UUID] = {}
    for place in await session.scalars(_places(event.id).where(VenuePlace.kind == "hall")):
        halls.setdefault(hall_key(place.name), place.id)

    position = await _next_position(session, event.id, "hall")
    halls_created = 0
    for row in body.sessions:
        key = hall_key(row.hall)
        if key and key not in halls:
            name = " ".join(row.hall.split())
            hall = VenuePlace(id=uuid.uuid4(), event_id=event.id, kind="hall", name=name, position=position)
            session.add(hall)
            halls[key] = hall.id
            position += 1
            halls_created += 1
    await session.flush()

    removed = 0
    if body.replace:
        removed = len(
            (
                await session.scalars(
                    delete(EventSession).where(EventSession.event_id == event.id).returning(EventSession.id)
                )
            ).all()
        )

    session.add_all(
        EventSession(
            event_id=event.id,
            title=row.title,
            track=row.track,
            speakers=row.speakers,
            description=row.description,
            hall_id=halls[hall_key(row.hall)] if row.hall else None,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
        )
        for row in body.sessions
    )
    await session.commit()
    return EventSessionImportOut(created=len(body.sessions), removed=removed, halls_created=halls_created)


@router.patch("/sessions/{session_id}", responses=error_responses(status.HTTP_409_CONFLICT))
async def update_session(
    session_id: uuid.UUID, body: EventSessionUpdate, event: WritableEventDep, session: SessionDep
) -> EventSessionOut:
    item = await _own_session(session, event, session_id)
    starts_at = body.starts_at or item.starts_at
    ends_at = body.ends_at or item.ends_at
    if ends_at <= starts_at:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, ENDS_BEFORE_STARTS)
    if body.starts_at is not None or body.ends_at is not None:
        outside = _outside_event_days(event, starts_at, ends_at)
        if outside:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, outside)
    hall_id = body.hall_id if "hall_id" in body.model_fields_set else item.hall_id
    hall_name = await _hall_name(session, event, hall_id)

    if body.title is not None:
        item.title = body.title
    if body.track is not None:
        item.track = body.track
    if body.speakers is not None:
        item.speakers = body.speakers
    if body.description is not None:
        item.description = body.description
    item.hall_id = hall_id
    item.starts_at = starts_at
    item.ends_at = ends_at
    await session.commit()
    await session.refresh(item)
    return _session_out(item, hall_name)


@router.delete(
    "/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(status.HTTP_409_CONFLICT)
)
async def delete_session(session_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> Response:
    item = await _own_session(session, event, session_id)
    await session.delete(item)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── What attendees see ──────────────────────────────────────────────────────────────────────────


async def live_program(
    session: AsyncSession, event_id: uuid.UUID
) -> tuple[list[PublicVenuePlace], list[PublicSession]]:
    """The venue directory and program as attendees see them: live data, in the organizer's order.
    Shared by the public event payload and the organizer's page preview."""
    places = (await session.scalars(_places(event_id))).all()
    rows = await session.execute(_sessions(event_id))
    return (
        [PublicVenuePlace.model_validate(place) for place in places],
        [
            PublicSession(
                id=item.id,
                title=item.title,
                track=item.track,
                speakers=item.speakers,
                description=item.description,
                hall_id=item.hall_id,
                hall_name=hall_name or "",
                starts_at=item.starts_at,
                ends_at=item.ends_at,
            )
            for item, hall_name in rows
        ],
    )
