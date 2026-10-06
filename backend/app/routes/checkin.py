import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.db import SessionDep
from app.models import CheckIn, CheckInPoint, EntityQR, Ticket, TicketTier, User
from app.routes.events import OwnedEventDep

router = APIRouter(tags=["checkin"])


class CheckInPointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(default="", max_length=200)
    policy_type: str = Field(
        default="MULTI_ENTRY",
        description="MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED",
    )
    allowed_tier_ids: list[str] = Field(default_factory=list)
    max_capacity: int | None = None


class CheckInPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    name: str
    location: str
    policy_type: str
    allowed_tier_ids: list[str]
    max_capacity: int | None
    created_at: datetime


class ManifestTicket(BaseModel):
    qr_secret: str
    ticket_id: uuid.UUID
    attendee_name: str
    attendee_email: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    admission_count: int
    is_admitted: bool


class CheckInManifest(BaseModel):
    checkin_point: CheckInPointOut
    event_id: uuid.UUID
    generated_at: datetime
    tickets: list[ManifestTicket]


class ScanSubmission(BaseModel):
    scan_id: uuid.UUID
    qr_secret: str
    scanned_at: datetime


class BatchScanRequest(BaseModel):
    scans: list[ScanSubmission]


class ScanResult(BaseModel):
    scan_id: uuid.UUID
    qr_secret: str
    status: str  # ADMITTED or REJECTED
    rejection_reason: str | None = None
    attendee_name: str | None = None
    ticket_tier_name: str | None = None


class BatchScanResponse(BaseModel):
    results: list[ScanResult]


@router.post(
    "/api/events/{event_id}/checkin-points",
    status_code=status.HTTP_201_CREATED,
)
async def create_checkin_point(
    body: CheckInPointCreate, event: OwnedEventDep, session: SessionDep
) -> CheckInPointOut:
    point = CheckInPoint(
        event_id=event.id,
        name=body.name.strip(),
        location=body.location.strip(),
        policy_type=body.policy_type.upper(),
        allowed_tier_ids=body.allowed_tier_ids,
        max_capacity=body.max_capacity,
    )
    session.add(point)
    await session.commit()
    return CheckInPointOut.model_validate(point)


@router.get("/api/events/{event_id}/checkin-points")
async def list_checkin_points(
    event: OwnedEventDep, session: SessionDep
) -> list[CheckInPointOut]:
    points = await session.scalars(
        select(CheckInPoint)
        .where(CheckInPoint.event_id == event.id)
        .order_by(CheckInPoint.created_at)
    )
    return [CheckInPointOut.model_validate(p) for p in points]


@router.get("/api/checkin-points/{point_id}/manifest")
async def get_checkin_manifest(
    point_id: uuid.UUID, session: SessionDep
) -> CheckInManifest:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    # Fetch count of admissions per ticket at this check-in point
    admissions_stmt = (
        select(CheckIn.ticket_id, func.count(CheckIn.id))
        .where(
            CheckIn.checkin_point_id == point.id,
            CheckIn.status == "ADMITTED",
            CheckIn.ticket_id.is_not(None),
        )
        .group_by(CheckIn.ticket_id)
    )
    admissions_result = await session.execute(admissions_stmt)
    admitted_counts: dict[uuid.UUID, int] = {
        row[0]: row[1]
        for row in admissions_result.all()
        if row[0] is not None
    }

    # Fetch all valid tickets for this event
    tickets_stmt = (
        select(Ticket, TicketTier, User, EntityQR)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket"),
        )
        .where(Ticket.event_id == point.event_id, Ticket.status == "active")
        .order_by(Ticket.created_at)
    )
    tickets_result = await session.execute(tickets_stmt)
    rows = tickets_result.all()

    manifest_tickets = [
        ManifestTicket(
            qr_secret=qr.secret,
            ticket_id=ticket.id,
            attendee_name=user.full_name,
            attendee_email=user.email,
            ticket_tier_id=tier.id,
            ticket_tier_name=tier.name,
            admission_count=admitted_counts.get(ticket.id, 0),
            is_admitted=admitted_counts.get(ticket.id, 0) > 0,
        )
        for ticket, tier, user, qr in rows
    ]

    return CheckInManifest(
        checkin_point=CheckInPointOut.model_validate(point),
        event_id=point.event_id,
        generated_at=datetime.now(timezone.utc),
        tickets=manifest_tickets,
    )


@router.post("/api/checkin-points/{point_id}/scans/batch")
async def ingest_scans_batch(
    point_id: uuid.UUID, body: BatchScanRequest, session: SessionDep
) -> BatchScanResponse:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    results: list[ScanResult] = []

    for scan in body.scans:
        # 1. Idempotent deduplication: check if scan_id already processed
        existing = await session.get(CheckIn, scan.scan_id)
        if existing is not None:
            # Replay existing result
            attendee_name = None
            tier_name = None
            if existing.ticket_id:
                ticket_info = await session.execute(
                    select(User.full_name, TicketTier.name)
                    .join(Ticket, Ticket.user_id == User.id)
                    .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
                    .where(Ticket.id == existing.ticket_id)
                )
                t_row = ticket_info.one_or_none()
                if t_row:
                    attendee_name, tier_name = t_row[0], t_row[1]

            results.append(
                ScanResult(
                    scan_id=existing.id,
                    qr_secret=existing.qr_secret,
                    status=existing.status,
                    rejection_reason=existing.rejection_reason,
                    attendee_name=attendee_name,
                    ticket_tier_name=tier_name,
                )
            )
            continue

        # 2. Look up QR secret
        qr = await session.scalar(
            select(EntityQR).where(
                EntityQR.secret == scan.qr_secret, EntityQR.is_active.is_(True)
            )
        )
        if qr is None or qr.entity_type != "attendee_ticket":
            # Invalid or unrecognized QR code
            checkin = CheckIn(
                id=scan.scan_id,
                checkin_point_id=point.id,
                ticket_id=None,
                qr_secret=scan.qr_secret,
                status="REJECTED",
                rejection_reason="INVALID_TICKET",
                scanned_at=scan.scanned_at,
            )
            session.add(checkin)
            results.append(
                ScanResult(
                    scan_id=scan.scan_id,
                    qr_secret=scan.qr_secret,
                    status="REJECTED",
                    rejection_reason="INVALID_TICKET",
                )
            )
            continue

        # 3. Look up ticket
        ticket_query = await session.execute(
            select(Ticket, TicketTier, User)
            .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
            .join(User, Ticket.user_id == User.id)
            .where(Ticket.id == qr.entity_id)
        )
        ticket_row = ticket_query.one_or_none()
        if ticket_row is None:
            checkin = CheckIn(
                id=scan.scan_id,
                checkin_point_id=point.id,
                ticket_id=None,
                qr_secret=scan.qr_secret,
                status="REJECTED",
                rejection_reason="INVALID_TICKET",
                scanned_at=scan.scanned_at,
            )
            session.add(checkin)
            results.append(
                ScanResult(
                    scan_id=scan.scan_id,
                    qr_secret=scan.qr_secret,
                    status="REJECTED",
                    rejection_reason="INVALID_TICKET",
                )
            )
            continue

        ticket, tier, user = ticket_row[0], ticket_row[1], ticket_row[2]

        if ticket.event_id != point.event_id:
            # Ticket is for another event
            checkin = CheckIn(
                id=scan.scan_id,
                checkin_point_id=point.id,
                ticket_id=ticket.id,
                qr_secret=scan.qr_secret,
                status="REJECTED",
                rejection_reason="EVENT_MISMATCH",
                scanned_at=scan.scanned_at,
            )
            session.add(checkin)
            results.append(
                ScanResult(
                    scan_id=scan.scan_id,
                    qr_secret=scan.qr_secret,
                    status="REJECTED",
                    rejection_reason="EVENT_MISMATCH",
                    attendee_name=user.full_name,
                    ticket_tier_name=tier.name,
                )
            )
            continue

        # 4. Evaluate Admission Policy
        scan_status = "ADMITTED"
        rejection_reason = None

        if point.policy_type == "SINGLE_USE":
            already_admitted = await session.scalar(
                select(CheckIn.id).where(
                    CheckIn.checkin_point_id == point.id,
                    CheckIn.ticket_id == ticket.id,
                    CheckIn.status == "ADMITTED",
                )
            )
            if already_admitted is not None:
                scan_status = "REJECTED"
                rejection_reason = "ALREADY_ADMITTED"

        elif point.policy_type == "TIER_RESTRICTED":
            allowed = point.allowed_tier_ids or []
            if str(ticket.ticket_tier_id) not in allowed:
                scan_status = "REJECTED"
                rejection_reason = "TIER_NOT_ALLOWED"

        elif point.policy_type == "CAPACITY_CAPPED":
            if point.max_capacity is not None:
                current_admitted = await session.scalar(
                    select(func.count(CheckIn.id)).where(
                        CheckIn.checkin_point_id == point.id,
                        CheckIn.status == "ADMITTED",
                    )
                )
                if (current_admitted or 0) >= point.max_capacity:
                    scan_status = "REJECTED"
                    rejection_reason = "CAPACITY_REACHED"

        # MULTI_ENTRY or passed other policies
        checkin = CheckIn(
            id=scan.scan_id,
            checkin_point_id=point.id,
            ticket_id=ticket.id,
            qr_secret=scan.qr_secret,
            status=scan_status,
            rejection_reason=rejection_reason,
            scanned_at=scan.scanned_at,
        )
        session.add(checkin)
        results.append(
            ScanResult(
                scan_id=scan.scan_id,
                qr_secret=scan.qr_secret,
                status=scan_status,
                rejection_reason=rejection_reason,
                attendee_name=user.full_name,
                ticket_tier_name=tier.name,
            )
        )

    await session.commit()
    return BatchScanResponse(results=results)
