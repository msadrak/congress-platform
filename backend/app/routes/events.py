import shutil
import uuid
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from zoneinfo import ZoneInfo, available_timezones

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.auth import OrganizerDep
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.media import resolve_storage_path
from app.models import (
    Booth,
    BoothBookmark,
    BoothStaff,
    CheckIn,
    CheckInPoint,
    Connection,
    DeskOperator,
    EntityQR,
    Event,
    EventPage,
    Lead,
    ScannerDevice,
    Ticket,
    TicketTier,
)
from app.page_document import default_page_document

router = APIRouter(prefix="/api/events", tags=["events"])

DEFAULT_TIMEZONE = "Asia/Tehran"
ARCHIVED_READ_ONLY = "This event is archived and read-only. Unarchive it to make changes."

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[
    str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=100)
]


@lru_cache(maxsize=1)
def _iana_zones() -> frozenset[str]:
    return frozenset(available_timezones())


def _iana_zone(value: str) -> str:
    # Membership in the tz database, exact spelling: never a path, an offset or a guess at the case.
    if value not in _iana_zones():
        raise ValueError("timezone must be an IANA time zone name such as Asia/Tehran")
    return value


TimeZoneName = Annotated[str, StringConstraints(max_length=64), AfterValidator(_iana_zone)]


def _window_problem(opens_at: datetime | None, closes_at: datetime | None) -> str | None:
    if opens_at is not None and closes_at is not None and closes_at <= opens_at:
        return "registration_closes_at must be after registration_opens_at"
    return None


class EventCreate(BaseModel):
    name: Name
    slug: Slug
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    location: Annotated[str, Field(max_length=300)]
    description: Annotated[str, Field(max_length=10_000)] = ""
    timezone: TimeZoneName = DEFAULT_TIMEZONE
    registration_enabled: bool = True
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None
    listed: bool = False

    @model_validator(mode="after")
    def _consistent_times(self) -> "EventCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        problem = _window_problem(self.registration_opens_at, self.registration_closes_at)
        if problem:
            raise ValueError(problem)
        return self


class EventUpdate(BaseModel):
    """Partial update: omitted fields keep their value; an explicit null clears a registration bound."""

    name: Name | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    location: Annotated[str, Field(max_length=300)] | None = None
    description: Annotated[str, Field(max_length=10_000)] | None = None
    timezone: TimeZoneName | None = None
    registration_enabled: bool | None = None
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None
    listed: bool | None = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    starts_at: datetime
    ends_at: datetime
    location: str
    description: str
    timezone: str
    registration_enabled: bool
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None
    listed: bool
    archived_at: datetime | None


class EventArchive(BaseModel):
    archived: bool = True


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
        raise ApiError(status.HTTP_404_NOT_FOUND, "EVENT_NOT_FOUND", "Event not found")
    return event


OwnedEventDep = Annotated[Event, Depends(owned_event)]


async def writable_event(event: OwnedEventDep) -> Event:
    """An owned event that accepts changes: archived events are read-only (409) until unarchived."""
    if event.archived_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "EVENT_ARCHIVED", ARCHIVED_READ_ONLY)
    return event


WritableEventDep = Annotated[Event, Depends(writable_event)]


def new_event_page(event_id: uuid.UUID) -> EventPage:
    """A new event's public page: the standard layout as an unpublished draft."""
    return EventPage(event_id=event_id, draft=default_page_document().model_dump(mode="json"))


def event_zone(event: Event) -> ZoneInfo:
    return ZoneInfo(event.timezone or DEFAULT_TIMEZONE)


def event_day_window(event: Event) -> tuple[datetime, datetime, date, date]:
    """[start, end) covering the event's first through last calendar day in its own time zone."""
    zone = event_zone(event)
    first = event.starts_at.astimezone(zone).date()
    last = event.ends_at.astimezone(zone).date()
    start = datetime.combine(first, time.min, tzinfo=zone)
    end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=zone)
    return start, end, first, last


def registration_problem(event: Event, now: datetime) -> ApiError | None:
    """Why attendees cannot reserve right now (publication and archive aside), as the 409 to raise, or None
    when they can."""
    if now >= event.ends_at:
        return ApiError(status.HTTP_409_CONFLICT, "EVENT_ENDED", "This event has ended; registration is closed.")
    if not event.registration_enabled:
        return ApiError(status.HTTP_409_CONFLICT, "REGISTRATION_CLOSED", "Registration is closed for this event.")
    if event.registration_opens_at is not None and now < event.registration_opens_at:
        return ApiError(
            status.HTTP_409_CONFLICT,
            "REGISTRATION_NOT_OPEN",
            f"Registration is not open yet; it opens at {event.registration_opens_at.isoformat()}.",
        )
    if event.registration_closes_at is not None and now >= event.registration_closes_at:
        return ApiError(status.HTTP_409_CONFLICT, "REGISTRATION_CLOSED", "Registration has closed for this event.")
    return None


@router.post("", status_code=status.HTTP_201_CREATED, responses=error_responses(status.HTTP_409_CONFLICT))
async def create_event(
    body: EventCreate, organizer: OrganizerDep, session: SessionDep
) -> EventOut:
    """The event exists immediately for setup (tiers, booths, check-in, reception); its public page is
    an unpublished draft until the organizer publishes it in Page Studio."""
    event = Event(id=uuid.uuid4(), organizer_id=organizer.id, **body.model_dump())
    session.add(event)
    try:
        await session.flush()
    except IntegrityError:
        # events.slug is the only unique column a caller can collide on.
        raise ApiError(status.HTTP_409_CONFLICT, "EVENT_SLUG_TAKEN", "Slug already in use") from None
    session.add(new_event_page(event.id))
    await session.commit()
    await session.refresh(event)
    return EventOut.model_validate(event)


@router.get("")
async def list_events(organizer: OrganizerDep, session: SessionDep) -> list[EventOut]:
    """Every event of the organizer, archived ones included (see `archived_at`)."""
    events = await session.scalars(
        select(Event).where(Event.organizer_id == organizer.id).order_by(Event.starts_at)
    )
    return [EventOut.model_validate(event) for event in events]


@router.get("/{event_id}")
async def get_event(event: OwnedEventDep) -> EventOut:
    return EventOut.model_validate(event)


@router.patch(
    "/{event_id}",
    responses=error_responses(
        status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
    ),
)
async def update_event(
    body: EventUpdate, event: WritableEventDep, session: SessionDep
) -> EventOut:
    new_starts = body.starts_at if body.starts_at is not None else event.starts_at
    new_ends = body.ends_at if body.ends_at is not None else event.ends_at
    if new_ends <= new_starts:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "EVENT_TIMES_INVALID", "ends_at must be after starts_at")
    given = body.model_fields_set
    opens_at = body.registration_opens_at if "registration_opens_at" in given else event.registration_opens_at
    closes_at = body.registration_closes_at if "registration_closes_at" in given else event.registration_closes_at
    problem = _window_problem(opens_at, closes_at)
    if problem:
        raise ApiError(status.HTTP_422_UNPROCESSABLE_CONTENT, "REGISTRATION_WINDOW_INVALID", problem)

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
    if body.timezone is not None:
        event.timezone = body.timezone
    if body.registration_enabled is not None:
        event.registration_enabled = body.registration_enabled
    if body.listed is not None:
        event.listed = body.listed
    event.registration_opens_at = opens_at
    event.registration_closes_at = closes_at

    await session.commit()
    await session.refresh(event)
    return EventOut.model_validate(event)


@router.post("/{event_id}/archive")
async def archive_event(body: EventArchive, event: OwnedEventDep, session: SessionDep) -> EventOut:
    """Archive (`archived: true`) or unarchive an event. An archived event disappears from every public
    endpoint, takes no reservations and refuses organizer edits; its data, tickets and passes are kept."""
    if body.archived and event.archived_at is None:
        event.archived_at = datetime.now(timezone.utc)
    elif not body.archived:
        event.archived_at = None
    await session.commit()
    await session.refresh(event)
    return EventOut.model_validate(event)


@router.delete(
    "/{event_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(status.HTTP_409_CONFLICT)
)
async def delete_event(event: OwnedEventDep, request: Request, session: SessionDep) -> Response:
    """Deletes an event that has never issued a ticket, with its setup (tiers, booths, check-in points, desk
    operators, program, page and uploaded files). An event with tickets can only be archived (409)."""
    # Serialize with reservations: a ticket issued while we delete would otherwise orphan the delete.
    await session.execute(select(Event.id).where(Event.id == event.id).with_for_update())
    tickets = await session.scalar(select(func.count(Ticket.id)).where(Ticket.event_id == event.id)) or 0
    if tickets:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "EVENT_HAS_TICKETS",
            f"This event has {tickets} ticket(s) and cannot be deleted; archive it instead.",
        )
    booth_ids = select(Booth.id).where(Booth.event_id == event.id)
    point_ids = select(CheckInPoint.id).where(CheckInPoint.event_id == event.id)
    for statement in (
        delete(Lead).where(Lead.booth_id.in_(booth_ids)),
        delete(BoothBookmark).where(BoothBookmark.booth_id.in_(booth_ids)),
        delete(BoothStaff).where(BoothStaff.booth_id.in_(booth_ids)),
        delete(EntityQR).where(EntityQR.entity_type == "booth", EntityQR.entity_id.in_(booth_ids)),
        delete(Booth).where(Booth.event_id == event.id),
        delete(CheckIn).where(CheckIn.checkin_point_id.in_(point_ids)),
        delete(ScannerDevice).where(ScannerDevice.event_id == event.id),
        delete(CheckInPoint).where(CheckInPoint.event_id == event.id),
        delete(Connection).where(Connection.event_id == event.id),
        delete(DeskOperator).where(DeskOperator.event_id == event.id),
        delete(TicketTier).where(TicketTier.event_id == event.id),
    ):
        await session.execute(statement)
    event_id = event.id
    await session.delete(event)  # page, media, venue, program, schedule files, short links and SMS rows cascade
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "EVENT_HAS_RECORDS",
            "This event still has records that prevent deleting it; archive it instead.",
        ) from None
    root: Path = request.app.state.settings.media_root
    await run_in_threadpool(_remove_event_files, root, event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _remove_event_files(media_root: Path, event_id: uuid.UUID) -> None:
    """Every stored file of the event lives under `<media_root>/<event_id>/`."""
    if not media_root.exists():
        return
    shutil.rmtree(resolve_storage_path(media_root, str(event_id)), ignore_errors=True)
