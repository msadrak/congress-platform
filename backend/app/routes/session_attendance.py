"""Session attendance (ADR 0004): who came through the doors of a programme session.

A check-in point linked to a session (`checkin_points.session_id`) is that session's door; every entry admitted
there is attendance, whatever its time. The report lists each attendee once, with entries, exits (at doors that
track occupancy) and the first entry and last scan on the event's wall clock. The CSV export is the same list with
the mobile number, sanitised against formula injection, with a BOM for spreadsheet programs, and recorded in the
audit log as an export (`AuditMiddleware`: a GET route ending in `-csv`).
"""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, String, func, literal, select

from app.csv_export import AnyRow, csv_response, csv_stream
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import CheckIn, CheckInPoint, Event, EventSession, Ticket, TicketTier, User
from app.routes.analytics import ATTENDEE_HEADERS, attendee_columns, event_timezone, local_iso
from app.routes.checkin import _latest_presence, admission_window
from app.routes.events import OwnedEventDep, event_zone

router = APIRouter(tags=["checkin"])


class SessionDoor(BaseModel):
    id: uuid.UUID
    name: str
    tracks_occupancy: bool
    archived_at: datetime | None


class SessionAttendee(BaseModel):
    ticket_id: uuid.UUID
    attendee_name: str
    organization: str
    ticket_tier_name: str
    admissions: int = Field(description="Entries admitted at the session's doors")
    exits: int = Field(description="Exits accepted (doors that track occupancy)")
    first_admission_at: str | None = Field(description="ISO 8601 local time with the event's UTC offset")
    last_scan_at: str | None = Field(description="Latest accepted entry or exit, ISO 8601 local time")
    inside: bool | None = Field(description="Inside now; null when no door tracks occupancy")


class SessionAttendanceReport(BaseModel):
    session_id: uuid.UUID
    title: str
    starts_at: datetime
    ends_at: datetime
    timezone: str = Field(description="IANA zone of every local time in this report")
    points: list[SessionDoor] = Field(description="Check-in points linked to this session")
    unique_attendees: int
    admissions: int
    rejected: int
    inside: int | None = Field(description="People inside now; null when no door tracks occupancy")
    attendees: list[SessionAttendee] = Field(description="Earliest entry first")


async def event_session(session_id: uuid.UUID, event: OwnedEventDep, session: SessionDep) -> EventSession:
    found = await session.scalar(
        select(EventSession).where(EventSession.id == session_id, EventSession.event_id == event.id)
    )
    if found is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "SESSION_NOT_FOUND", "Session not found")
    return found


EventSessionDep = Annotated[EventSession, Depends(event_session)]


def _local_parts(zone: str, instant: Any) -> tuple[Any, Any]:
    return (
        func.timezone(literal(zone, String), instant, type_=DateTime()),
        func.timezone(literal("UTC", String), instant, type_=DateTime()),
    )


def _per_ticket(point_ids: list[uuid.UUID]) -> Any:
    """Entries, exits, first entry and last accepted scan per ticket at the session's doors."""
    entry = CheckIn.direction == "IN"
    return (
        select(
            CheckIn.ticket_id.label("ticket_id"),
            func.count().filter(entry).label("admissions"),
            func.count().filter(CheckIn.direction == "OUT").label("exits"),
            func.min(CheckIn.scanned_at).filter(entry).label("first_admission"),
            func.max(CheckIn.scanned_at).label("last_scan"),
        )
        .where(CheckIn.checkin_point_id.in_(point_ids), CheckIn.status == "ADMITTED", CheckIn.ticket_id.is_not(None))
        .group_by(CheckIn.ticket_id)
        .subquery()
    )


async def _doors(session: SessionDep, programme_session: EventSession) -> list[CheckInPoint]:
    return list(
        await session.scalars(
            select(CheckInPoint)
            .where(CheckInPoint.session_id == programme_session.id)
            .order_by(CheckInPoint.created_at)
        )
    )


async def _inside_now(session: SessionDep, event: Event, doors: list[CheckInPoint]) -> set[uuid.UUID] | None:
    tracking = [door for door in doors if door.tracks_occupancy]
    if not tracking:
        return None
    zone = event_zone(event)
    now: datetime = await session.scalar(select(func.now())) or datetime.now(zone)
    inside: set[uuid.UUID] = set()
    for door in tracking:
        latest = _latest_presence(door)
        inside |= {
            tid
            for tid in await session.scalars(
                select(latest.c.ticket_id).where(
                    latest.c.admission_window == admission_window(door, zone, now), latest.c.direction == "IN"
                )
            )
            if tid is not None
        }
    return inside


@router.get(
    "/api/events/{event_id}/sessions/{session_id}/attendance",
    responses=error_responses(status.HTTP_404_NOT_FOUND),
)
async def get_session_attendance(
    event: OwnedEventDep, programme_session: EventSessionDep, session: SessionDep
) -> SessionAttendanceReport:
    tz = event_timezone(event)
    doors = await _doors(session, programme_session)
    point_ids = [door.id for door in doors]
    per_ticket = _per_ticket(point_ids)
    rows = (
        await session.execute(
            select(
                Ticket.id,
                Ticket.attendee_full_name,
                Ticket.attendee_organization,
                TicketTier.name,
                per_ticket.c.admissions,
                per_ticket.c.exits,
                *_local_parts(tz, per_ticket.c.first_admission),
                *_local_parts(tz, per_ticket.c.last_scan),
            )
            .join(per_ticket, per_ticket.c.ticket_id == Ticket.id)
            .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
            .order_by(per_ticket.c.first_admission.nulls_last(), Ticket.id)
        )
    ).all()
    rejected = (
        await session.scalar(
            select(func.count(CheckIn.id)).where(CheckIn.checkin_point_id.in_(point_ids), CheckIn.status == "REJECTED")
        )
    ) or 0
    inside = await _inside_now(session, event, doors)
    attendees = [
        SessionAttendee(
            ticket_id=ticket_id,
            attendee_name=name,
            organization=organization,
            ticket_tier_name=tier_name,
            admissions=admissions,
            exits=exits,
            first_admission_at=local_iso(first, first_utc) or None,
            last_scan_at=local_iso(last, last_utc) or None,
            inside=None if inside is None else ticket_id in inside,
        )
        for ticket_id, name, organization, tier_name, admissions, exits, first, first_utc, last, last_utc in rows
    ]
    return SessionAttendanceReport(
        session_id=programme_session.id,
        title=programme_session.title,
        starts_at=programme_session.starts_at,
        ends_at=programme_session.ends_at,
        timezone=tz,
        points=[
            SessionDoor(id=d.id, name=d.name, tracks_occupancy=d.tracks_occupancy, archived_at=d.archived_at)
            for d in doors
        ],
        unique_attendees=sum(1 for a in attendees if a.admissions > 0),
        admissions=sum(a.admissions for a in attendees),
        rejected=rejected,
        inside=None if inside is None else len(inside),
        attendees=attendees,
    )


@router.get(
    "/api/events/{event_id}/sessions/{session_id}/attendance-csv",
    response_class=StreamingResponse,
    responses=error_responses(status.HTTP_404_NOT_FOUND),
)
async def export_session_attendance_csv(
    request: Request, event: OwnedEventDep, programme_session: EventSessionDep, session: SessionDep
) -> StreamingResponse:
    """The attendance list with mobile numbers, earliest entry first."""
    tz = event_timezone(event)
    point_ids = [door.id for door in await _doors(session, programme_session)]
    per_ticket = _per_ticket(point_ids)
    statement = (
        select(
            Ticket.id,
            *attendee_columns(),
            TicketTier.name,
            *_local_parts(tz, per_ticket.c.first_admission),
            *_local_parts(tz, per_ticket.c.last_scan),
            per_ticket.c.admissions,
            per_ticket.c.exits,
        )
        .join(per_ticket, per_ticket.c.ticket_id == Ticket.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .outerjoin(User, Ticket.user_id == User.id)
        .order_by(per_ticket.c.first_admission.nulls_last(), Ticket.id)
    )
    header = [
        "Ticket ID",
        *ATTENDEE_HEADERS,
        "Ticket Tier",
        f"First Admission ({tz})",
        f"Last Scan ({tz})",
        "Admissions",
        "Exits",
    ]

    def cells(row: AnyRow) -> Sequence[object]:
        ticket_id, name, mobile, organization, title, tier, first, first_utc, last, last_utc, admissions, exits = row
        return [
            ticket_id, name, mobile, organization, title, tier,
            local_iso(first, first_utc), local_iso(last, last_utc), admissions, exits,
        ]

    body = csv_stream(request.app.state.sessionmaker, header, statement, cells)
    return csv_response(f"{event.slug}-session-attendance.csv", body)
