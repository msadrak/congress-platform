"""Attendance analytics for an organizer's event: the dashboard and two CSV exports.

Every count is a PostgreSQL aggregate (GROUP BY), so the dashboard costs the same handful of statements at any
size and no ticket or scan row is loaded into Python. Times are shown on the event's wall clock
(`event_timezone`): scans are bucketed by local date and hour with `AT TIME ZONE`, and the UTC offset of each
local time is computed by PostgreSQL too, so the API needs no time-zone database of its own.

One set of filters (`AnalyticsFilters`: check-in point, ticket tier, date range, local day) scopes the
dashboard and both exports alike. The exports are streamed from a server-side cursor.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import ColumnElement, Date, DateTime, String, cast, func, literal, literal_column, select

from app.csv_export import AnyRow, AnySelect, csv_response, csv_stream
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import CheckIn, CheckInPoint, Event, Ticket, TicketTier, User
from app.routes.checkin import _inside_count, admission_window
from app.routes.events import OwnedEventDep, event_zone

router = APIRouter(tags=["analytics"])

DEFAULT_EVENT_TIMEZONE = "Asia/Tehran"
ADMITTED = "ADMITTED"
ACTIVE = "active"
# The day picker lists every day from the event's first to its last; longer spans list only days with scans.
MAX_LISTED_EVENT_DAYS = 62


def event_timezone(event: Event) -> str:
    """The IANA zone of the event's wall clock: `events.timezone` once that column exists and is set, else
    Asia/Tehran, where every event so far takes place."""
    name = getattr(event, "timezone", None)
    return name if isinstance(name, str) and name else DEFAULT_EVENT_TIMEZONE


class HourlyScanCount(BaseModel):
    """Scans in one hour of the event's wall clock (`starts_at` to one hour later)."""

    day: date = Field(description="Local date in the event's timezone.")
    hour: str = Field(description='Local hour, "HH:00".')
    starts_at: str = Field(description="Start of the hour as an ISO 8601 local time with the event's UTC offset.")
    count: int = Field(description="Every scan: admitted entries, rejections and accepted exits.")
    admitted: int = Field(description="Admitted entries.")
    rejected: int


class GateMetric(BaseModel):
    point_id: uuid.UUID
    point_name: str
    location: str
    policy_type: str
    total_admitted: int
    total_rejected: int
    admissions: int = Field(description="Cumulative admitted entries at this point (exits are not admissions).")
    current_occupancy: int = Field(
        deprecated=True,
        description="Deprecated: the cumulative admissions (same as `admissions`), not who is inside now; "
        "read `occupancy` for that.",
    )
    occupancy: int | None = Field(
        default=None,
        description="People inside now (points that track occupancy, in the current admission window); "
        "null for points without entry and exit scans. Not scoped by the date or tier filters.",
    )
    hourly_scans: list[HourlyScanCount]


class CateringMetric(BaseModel):
    point_id: uuid.UUID
    point_name: str
    meals_served: int
    total_attendees: int
    redemption_rate: float


class TicketStatusCount(BaseModel):
    status: str
    count: int


class TierRegistration(BaseModel):
    tier_id: uuid.UUID
    tier_name: str
    quota: int
    active: int = Field(description="Tickets with status active.")
    total: int = Field(description="Tickets in any status (active, cancelled, ...).")


class AttendanceAnalyticsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: uuid.UUID
    timezone: str = Field(description="IANA zone of every local date and time in this response.")
    days: list[date] = Field(description="Local dates of the event and of any scans, for a day picker.")
    total_tickets: int = Field(description="Active tickets (tier filter applies).")
    tickets_by_status: list[TicketStatusCount]
    tier_registrations: list[TierRegistration]
    unique_admitted: int
    checkin_rate: float
    total_scans: int
    total_admitted: int
    total_rejected: int
    hourly_scans: list[HourlyScanCount] = Field(description="Scans of every listed point per local hour.")
    catering_metrics: list[CateringMetric]
    gate_breakdown: list[GateMetric]


@dataclass(frozen=True)
class AnalyticsFilters:
    """The dashboard's filters. A naive `from_time`/`to_time` is wall-clock time in the event's zone, an aware
    one an instant; both bounds are inclusive. `day` is midnight to midnight on the event's clock."""

    event: Event
    timezone: str
    point_id: uuid.UUID | None
    ticket_tier_id: uuid.UUID | None
    from_time: datetime | None
    to_time: datetime | None
    day: date | None

    def local(self, instant: Any) -> ColumnElement[datetime]:
        """`instant AT TIME ZONE <event zone>`: the event's wall-clock time, without a zone."""
        return func.timezone(literal(self.timezone, String), instant, type_=DateTime())

    def local_parts(self, instant: Any) -> tuple[ColumnElement[datetime], ColumnElement[datetime]]:
        """The wall-clock time and the UTC wall-clock time of an instant, for `local_iso`."""
        return self.local(instant), func.timezone(literal("UTC", String), instant, type_=DateTime())

    def scans(self, *columns: Any, by_tier: bool = True) -> AnySelect:
        """SELECT `columns` FROM this event's scans matching the filters (`by_tier=False` ignores the tier)."""
        statement = (
            select(*columns)
            .select_from(CheckIn)
            .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
            .where(CheckInPoint.event_id == self.event.id)
        )
        if self.point_id is not None:
            statement = statement.where(CheckIn.checkin_point_id == self.point_id)
        if by_tier and self.ticket_tier_id is not None:
            statement = statement.join(Ticket, CheckIn.ticket_id == Ticket.id).where(
                Ticket.ticket_tier_id == self.ticket_tier_id
            )
        local = self.local(CheckIn.scanned_at)
        if self.from_time is not None:
            statement = statement.where(
                (CheckIn.scanned_at if self.from_time.tzinfo else local) >= self.from_time
            )
        if self.to_time is not None:
            statement = statement.where((CheckIn.scanned_at if self.to_time.tzinfo else local) <= self.to_time)
        if self.day is not None:
            midnight = datetime.combine(self.day, datetime.min.time())
            statement = statement.where(local >= midnight, local < midnight + timedelta(days=1))
        return statement


async def analytics_filters(
    event: OwnedEventDep,
    point_id: Annotated[uuid.UUID | None, Query()] = None,
    ticket_tier_id: Annotated[uuid.UUID | None, Query()] = None,
    from_time: Annotated[datetime | None, Query(description="Inclusive; naive means the event's local time.")] = None,
    to_time: Annotated[datetime | None, Query(description="Inclusive; naive means the event's local time.")] = None,
    day: Annotated[date | None, Query(description="One local day of the event's clock.")] = None,
) -> AnalyticsFilters:
    if (
        from_time is not None
        and to_time is not None
        and (from_time.tzinfo is None) == (to_time.tzinfo is None)
        and from_time > to_time
    ):
        raise ApiError(status.HTTP_400_BAD_REQUEST, "ANALYTICS_RANGE_INVALID", "from_time must not be after to_time")
    return AnalyticsFilters(event, event_timezone(event), point_id, ticket_tier_id, from_time, to_time, day)


FiltersDep = Annotated[AnalyticsFilters, Depends(analytics_filters)]


def local_iso(local: datetime | None, utc: datetime | None) -> str:
    """ISO 8601 local time with its UTC offset, from the wall-clock and UTC times PostgreSQL computed."""
    if local is None or utc is None:
        return ""
    return local.replace(tzinfo=timezone(local - utc)).isoformat()


def _percent(part: int, whole: int) -> float:
    return part / whole * 100.0 if whole > 0 else 0.0


@router.get(
    "/api/events/{event_id}/analytics/attendance",
    responses=error_responses(status.HTTP_400_BAD_REQUEST),
)
async def get_attendance_analytics(filters: FiltersDep, session: SessionDep) -> AttendanceAnalyticsResponse:
    event = filters.event
    tz = filters.timezone

    # Registrations per tier and ticket status.
    tier_query = (
        select(TicketTier.id, TicketTier.name, TicketTier.quota, Ticket.status, func.count(Ticket.id))
        .outerjoin(Ticket, Ticket.ticket_tier_id == TicketTier.id)
        .where(TicketTier.event_id == event.id)
        .group_by(TicketTier.id, TicketTier.name, TicketTier.quota, Ticket.status)
        .order_by(TicketTier.created_at, TicketTier.id)
    )
    if filters.ticket_tier_id is not None:
        tier_query = tier_query.where(TicketTier.id == filters.ticket_tier_id)
    tiers: dict[uuid.UUID, TierRegistration] = {}
    by_status: dict[str, int] = defaultdict(int)
    for tier_id, tier_name, quota, ticket_status, count in (await session.execute(tier_query)).all():
        tier = tiers.setdefault(
            tier_id, TierRegistration(tier_id=tier_id, tier_name=tier_name, quota=quota, active=0, total=0)
        )
        if ticket_status is not None:
            tier.total += count
            tier.active += count if ticket_status == ACTIVE else 0
            by_status[ticket_status] += count
    total_tickets = by_status.get(ACTIVE, 0)

    points_query = select(CheckInPoint).where(CheckInPoint.event_id == event.id).order_by(CheckInPoint.created_at)
    if filters.point_id is not None:
        points_query = points_query.where(CheckInPoint.id == filters.point_id)
    points = (await session.scalars(points_query)).all()

    # Admitted and rejected scans per point and local hour; the gate and event totals are their sums.
    scans = filters.scans(
        CheckIn.checkin_point_id.label("point_id"),
        CheckIn.status.label("status"),
        CheckIn.direction.label("direction"),
        func.date_trunc(literal_column("'hour'"), filters.local(CheckIn.scanned_at), type_=DateTime()).label(
            "bucket"
        ),
    ).subquery()
    bucket_utc = func.timezone(literal("UTC", String), func.timezone(literal(tz, String), scans.c.bucket))
    admitted_count = func.count().filter(scans.c.status == ADMITTED, scans.c.direction == "IN")
    rejected_count = func.count().filter(scans.c.status != ADMITTED)
    bucket_rows = (
        await session.execute(
            select(scans.c.point_id, scans.c.bucket, bucket_utc, admitted_count, rejected_count, func.count())
            .group_by(scans.c.point_id, scans.c.bucket)
            .order_by(scans.c.bucket)
        )
    ).all()

    unique_admitted = (
        await session.scalar(
            filters.scans(func.count(CheckIn.ticket_id.distinct())).where(
                CheckIn.status == ADMITTED, CheckIn.direction == "IN", CheckIn.ticket_id.is_not(None)
            )
        )
    ) or 0

    # Every day of the event plus any day with scans (unfiltered), on the event's clock.
    scan_days = (
        await session.scalars(
            select(cast(filters.local(CheckIn.scanned_at), Date))
            .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
            .where(CheckInPoint.event_id == event.id)
            .distinct()
        )
    ).all()
    first_day, last_day = (
        await session.execute(
            select(
                cast(filters.local(literal(event.starts_at, DateTime(timezone=True))), Date),
                cast(filters.local(literal(event.ends_at, DateTime(timezone=True))), Date),
            )
        )
    ).one()
    days = set(scan_days)
    if 0 <= (last_day - first_day).days < MAX_LISTED_EVENT_DAYS:
        days.update(first_day + timedelta(days=n) for n in range((last_day - first_day).days + 1))

    gate_hourly: dict[uuid.UUID, list[HourlyScanCount]] = defaultdict(list)
    event_hourly: dict[datetime, HourlyScanCount] = {}
    for point_id, bucket, utc, admitted, rejected, count in bucket_rows:
        hour = HourlyScanCount(
            day=bucket.date(),
            hour=bucket.strftime("%H:00"),
            starts_at=local_iso(bucket, utc),
            count=count,
            admitted=admitted,
            rejected=rejected,
        )
        gate_hourly[point_id].append(hour)
        total = event_hourly.setdefault(bucket, hour.model_copy(update={"count": 0, "admitted": 0, "rejected": 0}))
        total.count += count
        total.admitted += admitted
        total.rejected += rejected

    gate_breakdown: list[GateMetric] = []
    catering_metrics: list[CateringMetric] = []
    zone = event_zone(event)
    now = datetime.now(UTC)  # occupancy is "now": the current admission window, no extra statement
    for point in points:
        hourly = gate_hourly[point.id]
        admitted = sum(h.admitted for h in hourly)
        gate_breakdown.append(
            GateMetric(
                point_id=point.id,
                point_name=point.name,
                location=point.location,
                policy_type=point.policy_type,
                total_admitted=admitted,
                total_rejected=sum(h.rejected for h in hourly),
                admissions=admitted,
                current_occupancy=admitted,
                occupancy=(
                    await _inside_count(session, point, admission_window(point, zone, now))
                    if point.tracks_occupancy
                    else None
                ),
                hourly_scans=hourly,
            )
        )
        if point.policy_type == "SINGLE_USE":
            catering_metrics.append(
                CateringMetric(
                    point_id=point.id,
                    point_name=point.name,
                    meals_served=admitted,
                    total_attendees=total_tickets,
                    redemption_rate=_percent(admitted, total_tickets),
                )
            )

    total_admitted = sum(g.total_admitted for g in gate_breakdown)
    total_rejected = sum(g.total_rejected for g in gate_breakdown)
    return AttendanceAnalyticsResponse(
        event_id=event.id,
        timezone=tz,
        days=sorted(days),
        total_tickets=total_tickets,
        tickets_by_status=[TicketStatusCount(status=s, count=c) for s, c in sorted(by_status.items())],
        tier_registrations=list(tiers.values()),
        unique_admitted=unique_admitted,
        checkin_rate=_percent(unique_admitted, total_tickets),
        total_scans=total_admitted + total_rejected,
        total_admitted=total_admitted,
        total_rejected=total_rejected,
        hourly_scans=[event_hourly[bucket] for bucket in sorted(event_hourly)],
        catering_metrics=catering_metrics,
        gate_breakdown=gate_breakdown,
    )


def attendee_columns() -> tuple[Any, ...]:
    """Attendee name, mobile, organization and title for the exports: the name, organization and title come
    from the ticket's registration snapshot (what the organizer edits), the mobile from the account (needs the
    User join)."""
    return (Ticket.attendee_full_name, User.mobile, Ticket.attendee_organization, Ticket.attendee_title)


ATTENDEE_HEADERS = ["Attendee Name", "Attendee Mobile", "Organization", "Title"]


@router.get(
    "/api/events/{event_id}/analytics/export-csv",
    response_class=StreamingResponse,
    responses=error_responses(status.HTTP_400_BAD_REQUEST),
)
async def export_attendance_csv(request: Request, filters: FiltersDep) -> StreamingResponse:
    """Every scan matching the dashboard's filters, newest first."""
    tz = filters.timezone
    statement = (
        filters.scans(
            CheckIn.id,
            CheckInPoint.name,
            CheckInPoint.policy_type,
            CheckIn.status,
            CheckIn.rejection_reason,
            CheckIn.scanned_at,
            *filters.local_parts(CheckIn.scanned_at),
            *attendee_columns(),
            TicketTier.name.label("tier_name"),
            Ticket.status.label("ticket_status"),
            CheckIn.direction,
            by_tier=False,
        )
        .outerjoin(Ticket, CheckIn.ticket_id == Ticket.id)
        .outerjoin(User, Ticket.user_id == User.id)
        .outerjoin(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .order_by(CheckIn.scanned_at.desc(), CheckIn.id)
    )
    if filters.ticket_tier_id is not None:
        statement = statement.where(Ticket.ticket_tier_id == filters.ticket_tier_id)
    header = [
        "Scan ID",
        "Check-In Point",
        "Policy Type",
        "Status",
        "Rejection Reason",
        "Scanned At (UTC)",
        f"Scanned At ({tz})",
        *ATTENDEE_HEADERS,
        "Ticket Tier",
        "Ticket Status",
        "Direction",
    ]

    def cells(row: AnyRow) -> Sequence[object]:
        scan_id, point, policy, scan_status, reason, scanned_at, local, utc, *rest = row
        scanned_utc = scanned_at.astimezone(UTC).isoformat()
        return [scan_id, point, policy, scan_status, reason, scanned_utc, local_iso(local, utc), *rest]

    body = csv_stream(request.app.state.sessionmaker, header, statement, cells)
    return csv_response(f"{filters.event.slug}-attendance.csv", body)


@router.get(
    "/api/events/{event_id}/analytics/registrations-csv",
    response_class=StreamingResponse,
    responses=error_responses(status.HTTP_400_BAD_REQUEST),
)
async def export_registrations_csv(request: Request, filters: FiltersDep) -> StreamingResponse:
    """One row per ticket in any status, oldest registration first. The tier filter picks the tickets; the
    point and date filters scope the admission columns."""
    tz = filters.timezone
    admissions = (
        filters.scans(
            CheckIn.ticket_id.label("ticket_id"),
            func.min(CheckIn.scanned_at).label("first_admission"),
            func.count().label("admissions"),
            by_tier=False,
        )
        .where(CheckIn.status == ADMITTED, CheckIn.direction == "IN", CheckIn.ticket_id.is_not(None))
        .group_by(CheckIn.ticket_id)
        .subquery()
    )
    statement = (
        select(
            Ticket.id,
            TicketTier.name,
            Ticket.status,
            *filters.local_parts(Ticket.created_at),
            *attendee_columns(),
            *filters.local_parts(admissions.c.first_admission),
            func.coalesce(admissions.c.admissions, 0),
        )
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .outerjoin(User, Ticket.user_id == User.id)
        .outerjoin(admissions, admissions.c.ticket_id == Ticket.id)
        .where(Ticket.event_id == filters.event.id)
        .order_by(Ticket.created_at, Ticket.id)
    )
    if filters.ticket_tier_id is not None:
        statement = statement.where(Ticket.ticket_tier_id == filters.ticket_tier_id)
    header = [
        "Ticket ID",
        "Ticket Tier",
        "Status",
        f"Registered At ({tz})",
        *ATTENDEE_HEADERS,
        f"First Admission ({tz})",
        "Admissions",
    ]

    def cells(row: AnyRow) -> Sequence[object]:
        ticket_id, tier, ticket_status, registered, registered_utc, *rest = row
        *attendee, first, first_utc, count = rest
        return [
            ticket_id,
            tier,
            ticket_status,
            local_iso(registered, registered_utc),
            *attendee,
            local_iso(first, first_utc),
            count,
        ]

    body = csv_stream(request.app.state.sessionmaker, header, statement, cells)
    return csv_response(f"{filters.event.slug}-registrations.csv", body)
