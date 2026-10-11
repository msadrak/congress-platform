import csv
import io
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.db import SessionDep
from app.models import CheckIn, CheckInPoint, Ticket, TicketTier, User
from app.routes.events import OwnedEventDep
from app.security import sanitize_csv_cell

router = APIRouter(tags=["analytics"])


class HourlyScanCount(BaseModel):
    hour: str
    count: int


class GateMetric(BaseModel):
    point_id: uuid.UUID
    point_name: str
    location: str
    policy_type: str
    total_admitted: int
    total_rejected: int
    current_occupancy: int
    hourly_scans: list[HourlyScanCount]


class CateringMetric(BaseModel):
    point_id: uuid.UUID
    point_name: str
    meals_served: int
    total_attendees: int
    redemption_rate: float


class AttendanceAnalyticsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event_id: uuid.UUID
    total_tickets: int
    unique_admitted: int
    checkin_rate: float
    total_scans: int
    total_admitted: int
    total_rejected: int
    catering_metrics: list[CateringMetric]
    gate_breakdown: list[GateMetric]


@router.get("/api/events/{event_id}/analytics/attendance")
async def get_attendance_analytics(
    event: OwnedEventDep,
    session: SessionDep,
    point_id: Annotated[uuid.UUID | None, Query()] = None,
    ticket_tier_id: Annotated[uuid.UUID | None, Query()] = None,
    from_time: Annotated[datetime | None, Query()] = None,
    to_time: Annotated[datetime | None, Query()] = None,
) -> AttendanceAnalyticsResponse:
    # 1. Total tickets for this event
    tickets_query = select(Ticket).where(
        Ticket.event_id == event.id, Ticket.status == "active"
    )
    if ticket_tier_id is not None:
        tickets_query = tickets_query.where(Ticket.ticket_tier_id == ticket_tier_id)

    all_tickets = (await session.scalars(tickets_query)).all()
    total_tickets = len(all_tickets)

    # 2. Check-in points for this event
    points_query = select(CheckInPoint).where(CheckInPoint.event_id == event.id)
    if point_id is not None:
        points_query = points_query.where(CheckInPoint.id == point_id)

    all_points = (await session.scalars(points_query)).all()
    point_ids = [p.id for p in all_points]

    if not point_ids:
        return AttendanceAnalyticsResponse(
            event_id=event.id,
            total_tickets=total_tickets,
            unique_admitted=0,
            checkin_rate=0.0,
            total_scans=0,
            total_admitted=0,
            total_rejected=0,
            catering_metrics=[],
            gate_breakdown=[],
        )

    # 3. Scans matching point_ids and filters
    scans_query = (
        select(CheckIn, CheckInPoint, Ticket)
        .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
        .outerjoin(Ticket, CheckIn.ticket_id == Ticket.id)
        .where(CheckIn.checkin_point_id.in_(point_ids))
    )

    if ticket_tier_id is not None:
        scans_query = scans_query.where(Ticket.ticket_tier_id == ticket_tier_id)
    if from_time is not None:
        scans_query = scans_query.where(CheckIn.scanned_at >= from_time)
    if to_time is not None:
        scans_query = scans_query.where(CheckIn.scanned_at <= to_time)

    scans_result = await session.execute(scans_query)
    scan_rows = scans_result.all()

    total_scans = len(scan_rows)
    total_admitted = sum(1 for row in scan_rows if row[0].status == "ADMITTED")
    total_rejected = sum(1 for row in scan_rows if row[0].status == "REJECTED")

    # Unique admitted attendees across filtered scans
    unique_admitted_users = {
        row[2].user_id
        for row in scan_rows
        if row[0].status == "ADMITTED" and row[2] is not None
    }
    unique_admitted = len(unique_admitted_users)
    checkin_rate = (
        (unique_admitted / total_tickets * 100.0) if total_tickets > 0 else 0.0
    )

    # Gate breakdown calculations
    gate_admitted: dict[uuid.UUID, int] = defaultdict(int)
    gate_rejected: dict[uuid.UUID, int] = defaultdict(int)
    gate_hourly: dict[uuid.UUID, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    for checkin, p, _ in scan_rows:
        pid = p.id
        if checkin.status == "ADMITTED":
            gate_admitted[pid] += 1
        else:
            gate_rejected[pid] += 1

        hour_str = checkin.scanned_at.strftime("%H:00")
        gate_hourly[pid][hour_str] += 1

    gate_breakdown: list[GateMetric] = []
    for p in all_points:
        pid = p.id
        hourly_counts = [
            HourlyScanCount(hour=h, count=c)
            for h, c in sorted(gate_hourly[pid].items())
        ]
        gate_breakdown.append(
            GateMetric(
                point_id=p.id,
                point_name=p.name,
                location=p.location,
                policy_type=p.policy_type,
                total_admitted=gate_admitted[pid],
                total_rejected=gate_rejected[pid],
                current_occupancy=gate_admitted[pid],
                hourly_scans=hourly_counts,
            )
        )

    # Catering metrics: check-in points configured as SINGLE_USE
    catering_metrics: list[CateringMetric] = []
    for p in all_points:
        if p.policy_type == "SINGLE_USE":
            meals = gate_admitted[p.id]
            rate = (meals / total_tickets * 100.0) if total_tickets > 0 else 0.0
            catering_metrics.append(
                CateringMetric(
                    point_id=p.id,
                    point_name=p.name,
                    meals_served=meals,
                    total_attendees=total_tickets,
                    redemption_rate=rate,
                )
            )

    return AttendanceAnalyticsResponse(
        event_id=event.id,
        total_tickets=total_tickets,
        unique_admitted=unique_admitted,
        checkin_rate=checkin_rate,
        total_scans=total_scans,
        total_admitted=total_admitted,
        total_rejected=total_rejected,
        catering_metrics=catering_metrics,
        gate_breakdown=gate_breakdown,
    )


@router.get("/api/events/{event_id}/analytics/export-csv")
async def export_attendance_csv(
    event: OwnedEventDep,
    session: SessionDep,
) -> Response:
    query = (
        select(CheckIn, CheckInPoint, Ticket, User, TicketTier)
        .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
        .outerjoin(Ticket, CheckIn.ticket_id == Ticket.id)
        .outerjoin(User, Ticket.user_id == User.id)
        .outerjoin(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .where(CheckInPoint.event_id == event.id)
        .order_by(CheckIn.scanned_at.desc())
    )
    result = await session.execute(query)
    rows = result.all()

    output = io.StringIO()
    writer = csv.writer(output)

    # CSV Header
    writer.writerow(
        [
            "Scan ID",
            "Check-In Point",
            "Policy Type",
            "Status",
            "Rejection Reason",
            "Scanned At (UTC)",
            "Attendee Name",
            "Attendee Email",
            "Organization",
            "Title",
            "Ticket Tier",
        ]
    )

    for checkin, point, ticket, user, tier in rows:
        writer.writerow(
            [
                str(checkin.id),
                sanitize_csv_cell(point.name),
                sanitize_csv_cell(point.policy_type),
                sanitize_csv_cell(checkin.status),
                sanitize_csv_cell(checkin.rejection_reason or ""),
                checkin.scanned_at.isoformat(),
                sanitize_csv_cell(user.full_name if user else ""),
                sanitize_csv_cell(user.email if user else ""),
                sanitize_csv_cell(user.organization if user else ""),
                sanitize_csv_cell(user.title if user else ""),
                sanitize_csv_cell(tier.name if tier else ""),
            ]
        )

    content = "\ufeff" + output.getvalue()
    filename = f"{event.slug}-attendance.csv"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
