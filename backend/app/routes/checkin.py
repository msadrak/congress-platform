import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth import OrganizerDep, hash_api_key
from app.db import SessionDep
from app.models import (
    CheckIn,
    CheckInPoint,
    EntityQR,
    Event,
    Organizer,
    ScannerDevice,
    Ticket,
    TicketTier,
    User,
)
from app.routes.events import OwnedEventDep
from app.security import create_scanner_token, decode_access_token

_bearer = HTTPBearer(auto_error=False)

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


class CheckInPointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    policy_type: str | None = Field(
        default=None,
        description="MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED",
    )
    allowed_tier_ids: list[str] | None = None
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
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    admission_count: int
    is_admitted: bool


class ScannerTokenOut(BaseModel):
    scanner_token: str
    token_type: str = "Bearer"
    point_id: uuid.UUID
    event_id: uuid.UUID
    device_id: uuid.UUID
    expires_at: datetime


class ScannerDeviceCreate(BaseModel):
    device_name: str = Field(default="Gate Scanner Client", min_length=1, max_length=100)


class ScannerDeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    checkin_point_id: uuid.UUID
    event_id: uuid.UUID
    device_name: str
    is_revoked: bool
    revoked_at: datetime | None
    created_at: datetime
    last_seen_at: datetime | None


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


ADMISSION_POLICIES = ("MULTI_ENTRY", "SINGLE_USE", "TIER_RESTRICTED", "CAPACITY_CAPPED")


def _admission_policy(raw: str) -> str:
    policy = raw.strip().upper()
    if policy not in ADMISSION_POLICIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid policy_type: {policy}")
    return policy


async def _require_event_tiers(session: SessionDep, event: Event, tier_ids: list[str]) -> None:
    """Every allowed tier must be one of this event's tiers; another event's tier is rejected."""
    if not tier_ids:
        return
    valid_tiers = await session.scalars(select(TicketTier.id).where(TicketTier.event_id == event.id))
    valid_tier_strs = {str(t_id) for t_id in valid_tiers}
    for tier_id_str in tier_ids:
        if tier_id_str not in valid_tier_strs:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Tier ID '{tier_id_str}' does not belong to this event",
            )


@router.post(
    "/api/events/{event_id}/checkin-points",
    status_code=status.HTTP_201_CREATED,
)
async def create_checkin_point(
    body: CheckInPointCreate, event: OwnedEventDep, session: SessionDep
) -> CheckInPointOut:
    policy = _admission_policy(body.policy_type)
    await _require_event_tiers(session, event, body.allowed_tier_ids)
    point = CheckInPoint(
        event_id=event.id,
        name=body.name.strip(),
        location=body.location.strip(),
        policy_type=policy,
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


@router.patch("/api/events/{event_id}/checkin-points/{point_id}")
async def update_checkin_point(
    point_id: uuid.UUID,
    body: CheckInPointUpdate,
    event: OwnedEventDep,
    session: SessionDep,
) -> CheckInPointOut:
    point = await session.scalar(
        select(CheckInPoint)
        .where(CheckInPoint.id == point_id, CheckInPoint.event_id == event.id)
        .with_for_update()
    )
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    # 1. Validate policy_type change safety
    if body.policy_type is not None:
        new_policy = _admission_policy(body.policy_type)

        if new_policy != point.policy_type:
            # Check if scans have already been recorded at this point
            existing_scans_count = await session.scalar(
                select(func.count(CheckIn.id)).where(CheckIn.checkin_point_id == point.id)
            ) or 0
            if existing_scans_count > 0:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Cannot change admission policy for a check-in point with existing scan history. "
                    "Create a new check-in point instead to preserve scanner cache and audit integrity.",
                )
            point.policy_type = new_policy

    # 2. Validate allowed_tier_ids against event ownership
    if body.allowed_tier_ids is not None:
        await _require_event_tiers(session, event, body.allowed_tier_ids)
        point.allowed_tier_ids = body.allowed_tier_ids

    # 3. Update metadata
    if body.name is not None:
        point.name = body.name.strip()
    if body.location is not None:
        point.location = body.location.strip()
    if body.max_capacity is not None:
        point.max_capacity = body.max_capacity

    await session.commit()
    await session.refresh(point)
    return CheckInPointOut.model_validate(point)
async def authorized_checkin_point(
    point_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CheckInPoint:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    event = await session.get(Event, point.event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    token = credentials.credentials
    jwt_secret: str = request.app.state.settings.jwt_secret

    # 1. Attempt validation as Scanner JWT
    payload = decode_access_token(token, jwt_secret)
    if payload is not None:
        token_type = payload.get("type")
        if token_type == "scanner":
            token_point_id = payload.get("point_id")
            token_event_id = payload.get("event_id")
            if str(point.id) != token_point_id:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Scanner token is not authorized for this check-in point",
                )
            if str(point.event_id) != token_event_id:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Scanner token is not authorized for this event",
                )
            # Check per-device revocation via jti claim
            jti = payload.get("jti")
            if jti:
                try:
                    device_uuid = uuid.UUID(jti)
                except (ValueError, TypeError):
                    raise HTTPException(
                        status.HTTP_401_UNAUTHORIZED,
                        "Invalid scanner device identifier in token",
                        headers={"WWW-Authenticate": "Bearer"},
                    )
                device = await session.get(ScannerDevice, device_uuid)
                if device is not None:
                    if device.is_revoked:
                        raise HTTPException(
                            status.HTTP_401_UNAUTHORIZED,
                            "Scanner device token has been revoked",
                            headers={"WWW-Authenticate": "Bearer"},
                        )
                    if device.checkin_point_id != point.id:
                        raise HTTPException(
                            status.HTTP_403_FORBIDDEN,
                            "Scanner token is not authorized for this check-in point",
                        )
                    device.last_seen_at = datetime.now(timezone.utc)
            return point
        else:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Insufficient permissions for check-in point scanning",
            )

    # 2. Attempt validation as Organizer API Key
    key_hash = hash_api_key(token)
    organizer = await session.scalar(
        select(Organizer).where(Organizer.api_key_hash == key_hash)
    )
    if organizer is not None:
        if event.organizer_id != organizer.id:
            # Mask presence of foreign organizer's check-in point with 404
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")
        return point

    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Invalid authorization credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


AuthorizedCheckInPointDep = Annotated[CheckInPoint, Depends(authorized_checkin_point)]


@router.post(
    "/api/checkin-points/{point_id}/token",
    status_code=status.HTTP_201_CREATED,
    summary="Issue a point-scoped scanner client token",
)
async def create_checkin_point_scanner_token(
    point_id: uuid.UUID,
    request: Request,
    organizer: OrganizerDep,
    session: SessionDep,
    body: ScannerDeviceCreate | None = None,
) -> ScannerTokenOut:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    settings = request.app.state.settings
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    device_name = (body.device_name if body else None) or "Gate Scanner Client"

    device = ScannerDevice(
        checkin_point_id=point.id,
        event_id=event.id,
        device_name=device_name,
    )
    session.add(device)
    await session.commit()

    token = create_scanner_token(
        point_id=point.id,
        event_id=event.id,
        secret=settings.jwt_secret,
        device_id=device.id,
        expires_delta=timedelta(days=7),
    )
    return ScannerTokenOut(
        scanner_token=token,
        token_type="Bearer",
        point_id=point.id,
        event_id=event.id,
        device_id=device.id,
        expires_at=expires_at,
    )


@router.get(
    "/api/checkin-points/{point_id}/devices",
    summary="List registered scanner devices for a check-in point",
)
async def list_checkin_point_devices(
    point_id: uuid.UUID,
    organizer: OrganizerDep,
    session: SessionDep,
) -> list[ScannerDeviceOut]:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    devices = await session.scalars(
        select(ScannerDevice)
        .where(ScannerDevice.checkin_point_id == point.id)
        .order_by(ScannerDevice.created_at.desc())
    )
    return [ScannerDeviceOut.model_validate(d) for d in devices]


@router.post(
    "/api/checkin-points/{point_id}/devices/self/revoke",
    summary="Revoke the scanner device represented by its own credential",
)
async def revoke_current_scanner_device(
    point_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> ScannerDeviceOut:
    """Self-revocation is scoped to the authenticated device; no device ID is caller-supplied."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials, request.app.state.settings.jwt_secret)
    if payload is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid or expired scanner token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("type") != "scanner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Scanner credentials required")
    if payload.get("point_id") != str(point_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Scanner token scope mismatch")

    try:
        device_id = uuid.UUID(str(payload.get("jti", "")))
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Scanner token has no valid device identity",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")
    if payload.get("event_id") != str(point.event_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Scanner token scope mismatch")

    device = await session.scalar(
        select(ScannerDevice)
        .where(ScannerDevice.id == device_id)
        .with_for_update()
    )
    if (
        device is None
        or device.checkin_point_id != point.id
        or device.event_id != point.event_id
    ):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Scanner device is no longer authorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if device.is_revoked:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Scanner device has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    device.is_revoked = True
    device.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    return ScannerDeviceOut.model_validate(device)


@router.post(
    "/api/checkin-points/{point_id}/devices/{device_id}/revoke",
    summary="Revoke a registered scanner device token",
)
async def revoke_checkin_point_device(
    point_id: uuid.UUID,
    device_id: uuid.UUID,
    organizer: OrganizerDep,
    session: SessionDep,
) -> ScannerDeviceOut:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in point not found")

    device = await session.get(ScannerDevice, device_id)
    if device is None or device.checkin_point_id != point.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scanner device not found")

    device.is_revoked = True
    device.revoked_at = datetime.now(timezone.utc)
    await session.commit()

    return ScannerDeviceOut.model_validate(device)


@router.get("/api/checkin-points/{point_id}/manifest")
async def get_checkin_manifest(
    point: AuthorizedCheckInPointDep, session: SessionDep
) -> CheckInManifest:
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
    body: BatchScanRequest, point: AuthorizedCheckInPointDep, session: SessionDep
) -> BatchScanResponse:
    results: list[ScanResult] = []

    for scan in body.scans:
        # 1. Idempotent deduplication: check if scan_id already processed
        existing = await session.get(CheckIn, scan.scan_id)
        if existing is not None:
            # Scope & Confidentiality verification:
            # A scan_id is strictly bound to its checkin_point_id AND qr_secret.
            # Cross-point, cross-event, cross-tenant replays, or mismatched QR secrets
            # MUST be rejected without disclosing foreign attendee identity, QR secret, or check-in status!
            if existing.checkin_point_id != point.id or existing.qr_secret != scan.qr_secret:
                results.append(
                    ScanResult(
                        scan_id=scan.scan_id,
                        qr_secret=scan.qr_secret,
                        status="REJECTED",
                        rejection_reason="SCAN_ID_CONFLICT",
                        attendee_name=None,
                        ticket_tier_name=None,
                    )
                )
                continue

            # Legitimate same-point idempotent replay within authorized scope:
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
                policy_type=point.policy_type,
                status="REJECTED",
                rejection_reason="INVALID_TICKET",
                scanned_at=scan.scanned_at,
            )
            try:
                async with session.begin_nested():
                    session.add(checkin)
                    await session.flush()
            except IntegrityError:
                existing_pk = await session.get(CheckIn, scan.scan_id)
                if (
                    existing_pk is not None
                    and existing_pk.checkin_point_id == point.id
                    and existing_pk.qr_secret == scan.qr_secret
                ):
                    results.append(
                        ScanResult(
                            scan_id=existing_pk.id,
                            qr_secret=existing_pk.qr_secret,
                            status=existing_pk.status,
                            rejection_reason=existing_pk.rejection_reason,
                        )
                    )
                    continue
                elif existing_pk is not None:
                    results.append(
                        ScanResult(
                            scan_id=scan.scan_id,
                            qr_secret=scan.qr_secret,
                            status="REJECTED",
                            rejection_reason="SCAN_ID_CONFLICT",
                        )
                    )
                    continue
                raise
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
                policy_type=point.policy_type,
                status="REJECTED",
                rejection_reason="INVALID_TICKET",
                scanned_at=scan.scanned_at,
            )
            try:
                async with session.begin_nested():
                    session.add(checkin)
                    await session.flush()
            except IntegrityError:
                existing_pk = await session.get(CheckIn, scan.scan_id)
                if (
                    existing_pk is not None
                    and existing_pk.checkin_point_id == point.id
                    and existing_pk.qr_secret == scan.qr_secret
                ):
                    results.append(
                        ScanResult(
                            scan_id=existing_pk.id,
                            qr_secret=existing_pk.qr_secret,
                            status=existing_pk.status,
                            rejection_reason=existing_pk.rejection_reason,
                        )
                    )
                    continue
                elif existing_pk is not None:
                    results.append(
                        ScanResult(
                            scan_id=scan.scan_id,
                            qr_secret=scan.qr_secret,
                            status="REJECTED",
                            rejection_reason="SCAN_ID_CONFLICT",
                        )
                    )
                    continue
                raise
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
            # Ticket is for another event. The rejection is recorded against the gate only: the
            # foreign ticket is not linked (so this event's reports and exports never join the
            # other congress's attendee) and its holder's identity is never disclosed.
            checkin = CheckIn(
                id=scan.scan_id,
                checkin_point_id=point.id,
                ticket_id=None,
                qr_secret=scan.qr_secret,
                policy_type=point.policy_type,
                status="REJECTED",
                rejection_reason="EVENT_MISMATCH",
                scanned_at=scan.scanned_at,
            )
            try:
                async with session.begin_nested():
                    session.add(checkin)
                    await session.flush()
            except IntegrityError:
                existing_pk = await session.get(CheckIn, scan.scan_id)
                if (
                    existing_pk is not None
                    and existing_pk.checkin_point_id == point.id
                    and existing_pk.qr_secret == scan.qr_secret
                ):
                    results.append(
                        ScanResult(
                            scan_id=existing_pk.id,
                            qr_secret=existing_pk.qr_secret,
                            status=existing_pk.status,
                            rejection_reason=existing_pk.rejection_reason,
                        )
                    )
                    continue
                elif existing_pk is not None:
                    results.append(
                        ScanResult(
                            scan_id=scan.scan_id,
                            qr_secret=scan.qr_secret,
                            status="REJECTED",
                            rejection_reason="SCAN_ID_CONFLICT",
                        )
                    )
                    continue
                raise
            results.append(
                ScanResult(
                    scan_id=scan.scan_id,
                    qr_secret=scan.qr_secret,
                    status="REJECTED",
                    rejection_reason="EVENT_MISMATCH",
                )
            )
            continue

        # 4. Evaluate Admission Policy with Concurrency Controls
        scan_status = "ADMITTED"
        rejection_reason = None

        if point.policy_type == "CAPACITY_CAPPED":
            # Pessimistic row lock on CheckInPoint to serialize capacity check and admission
            await session.scalar(
                select(CheckInPoint.id)
                .where(CheckInPoint.id == point.id)
                .with_for_update()
            )
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

        elif point.policy_type == "SINGLE_USE":
            # Pessimistic row lock on Ticket to serialize concurrent single-use scans
            await session.scalar(
                select(Ticket.id)
                .where(Ticket.id == ticket.id)
                .with_for_update()
            )
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

        # MULTI_ENTRY or passed other policies
        checkin = CheckIn(
            id=scan.scan_id,
            checkin_point_id=point.id,
            ticket_id=ticket.id,
            qr_secret=scan.qr_secret,
            policy_type=point.policy_type,
            status=scan_status,
            rejection_reason=rejection_reason,
            scanned_at=scan.scanned_at,
        )

        try:
            async with session.begin_nested():
                session.add(checkin)
                await session.flush()
        except IntegrityError as e:
            err_str = str(e).lower()
            # Case A: Concurrent duplicate scan_id (primary key collision)
            existing_pk = await session.get(CheckIn, scan.scan_id)
            if (
                existing_pk is not None
                and existing_pk.checkin_point_id == point.id
                and existing_pk.qr_secret == scan.qr_secret
            ):
                ticket_info = await session.execute(
                    select(User.full_name, TicketTier.name)
                    .join(Ticket, Ticket.user_id == User.id)
                    .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
                    .where(Ticket.id == existing_pk.ticket_id)
                )
                t_row = ticket_info.one_or_none()
                results.append(
                    ScanResult(
                        scan_id=existing_pk.id,
                        qr_secret=existing_pk.qr_secret,
                        status=existing_pk.status,
                        rejection_reason=existing_pk.rejection_reason,
                        attendee_name=t_row[0] if t_row else None,
                        ticket_tier_name=t_row[1] if t_row else None,
                    )
                )
                continue
            elif existing_pk is not None:
                results.append(
                    ScanResult(
                        scan_id=scan.scan_id,
                        qr_secret=scan.qr_secret,
                        status="REJECTED",
                        rejection_reason="SCAN_ID_CONFLICT",
                    )
                )
                continue

            # Case B: Database constraint collision (uq_checkin_single_use_admitted)
            if "uq_checkin_single_use_admitted" in err_str or "unique" in err_str:
                scan_status = "REJECTED"
                rejection_reason = "ALREADY_ADMITTED"
                rejected_checkin = CheckIn(
                    id=scan.scan_id,
                    checkin_point_id=point.id,
                    ticket_id=ticket.id,
                    qr_secret=scan.qr_secret,
                    policy_type=point.policy_type,
                    status="REJECTED",
                    rejection_reason="ALREADY_ADMITTED",
                    scanned_at=scan.scanned_at,
                )
                async with session.begin_nested():
                    session.add(rejected_checkin)
                    await session.flush()
            else:
                raise

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
