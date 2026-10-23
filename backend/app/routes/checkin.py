import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.auth import OrganizerDep, organizer_is_active, resolve_organizer_key
from app.db import SessionDep
from app.models import (
    CheckIn,
    CheckInPoint,
    EntityQR,
    Event,
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
    max_capacity: int | None = Field(default=None, gt=0)  # ck_checkin_points_max_capacity


class CheckInPointUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    policy_type: str | None = Field(
        default=None,
        description="MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED",
    )
    allowed_tier_ids: list[str] | None = None
    max_capacity: int | None = Field(default=None, gt=0)  # ck_checkin_points_max_capacity


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
    qr_hash: str = Field(
        description="sha256 hex of '<event_id>:<normalized QR secret>'; the raw secret is never sent",
    )
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
    tickets: list[ManifestTicket] = Field(
        description="Full manifest: every admissible ticket. Delta: tickets added or whose admission state "
        "at this point changed since the cursor (upsert by qr_hash)."
    )
    cursor: str = Field(description="Pass back as ?since= to receive only what changed after this manifest")
    is_delta: bool = False
    removed_qr_hashes: list[str] = Field(
        default_factory=list,
        description="Delta only: tickets that are no longer admissible (cancelled ticket or deactivated QR)",
    )


ClientVerdict = Literal["ADMITTED", "PROVISIONAL", "REJECTED"]


class ScanSubmission(BaseModel):
    scan_id: uuid.UUID
    qr_secret: str = Field(min_length=1, max_length=512, description="The raw scanned code")
    scanned_at: AwareDatetime = Field(
        description="Device time of the scan, with a UTC offset. A time later than the server's clock "
        "plus 5 minutes is not trusted: the scan is recorded at the receive time with clock_skew set."
    )
    client_verdict: ClientVerdict | None = Field(
        default=None,
        description="What the scanner decided on its own (offline or after a server timeout). REJECTED is "
        "final: the server records a rejection and never admits. Omitted by server-decided scans and "
        "by older scanners, whose scans the server evaluates.",
    )
    client_rejection_reason: str | None = Field(default=None, max_length=48)


class BatchScanRequest(BaseModel):
    scans: list[ScanSubmission] = Field(max_length=200)


class ScanResult(BaseModel):
    scan_id: uuid.UUID
    qr_secret: str
    status: str  # ADMITTED or REJECTED
    rejection_reason: str | None = None
    attendee_name: str | None = None
    ticket_tier_name: str | None = None
    clock_skew: bool = False


class BatchScanResponse(BaseModel):
    results: list[ScanResult]


ADMISSION_POLICIES = ("MULTI_ENTRY", "SINGLE_USE", "TIER_RESTRICTED", "CAPACITY_CAPPED")


def _admission_policy(raw: str) -> str:
    policy = raw.strip().upper()
    if policy not in ADMISSION_POLICIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid policy_type: {policy}")
    return policy


def _require_tiers_for_tier_policy(policy: str, tier_ids: list[str]) -> None:
    """A tier-restricted point with no tiers would admit nobody (or, on a lenient client, everybody)."""
    if policy == "TIER_RESTRICTED" and not tier_ids:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A TIER_RESTRICTED check-in point needs at least one allowed ticket tier",
        )


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
    _require_tiers_for_tier_policy(policy, body.allowed_tier_ids)
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

    _require_tiers_for_tier_policy(
        _admission_policy(body.policy_type) if body.policy_type is not None else point.policy_type,
        body.allowed_tier_ids if body.allowed_tier_ids is not None else point.allowed_tier_ids or [],
    )

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
            # Every scanner token names its registered device (jti); revocation is per device, so a token
            # without one, or whose device row is gone, cannot be revoked and is refused.
            try:
                device_uuid = uuid.UUID(str(payload.get("jti")))
            except (ValueError, TypeError):
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "Invalid scanner device identifier in token",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            device = await session.get(ScannerDevice, device_uuid)
            if device is None:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "Scanner device is not registered",
                    headers={"WWW-Authenticate": "Bearer"},
                )
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
            if not await organizer_is_active(session, event.organizer_id):
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED,
                    "Scanner token is no longer valid",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            device.last_seen_at = datetime.now(timezone.utc)
            return point
        else:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Insufficient permissions for check-in point scanning",
            )

    # 2. Attempt validation as Organizer API Key
    organizer = await resolve_organizer_key(session, request, token)
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


# --- Offline manifest -------------------------------------------------------------------------------

# A delta re-reads this much before its cursor: a ticket or scan committed by a transaction that started
# before the previous manifest was generated still carries an earlier timestamp. Upserts are idempotent.
MANIFEST_DELTA_OVERLAP = timedelta(minutes=5)

_PERSIAN_ARABIC_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def normalize_qr_secret(raw: str) -> str:
    """The form a scanner compares and uploads: trimmed, Latin digits, lower case, at most 64 characters."""
    return raw.translate(_PERSIAN_ARABIC_DIGITS).strip().lower()[:64]


def manifest_qr_hash(event_id: uuid.UUID, secret: str) -> str:
    """What the manifest carries instead of the secret; scanners hash a scanned code the same way."""
    return hashlib.sha256(f"{event_id}:{normalize_qr_secret(secret)}".encode()).hexdigest()


def _allowed_tier_uuids(point: CheckInPoint) -> list[uuid.UUID]:
    allowed: list[uuid.UUID] = []
    for raw in point.allowed_tier_ids or []:
        try:
            allowed.append(uuid.UUID(str(raw)))
        except ValueError:
            continue
    return allowed


def _manifest_tickets_stmt(point: CheckInPoint) -> Select[Ticket, TicketTier, User, EntityQR]:
    """Admissible tickets for this point: the one query both the full manifest and a delta start from."""
    stmt = (
        select(Ticket, TicketTier, User, EntityQR)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .join(
            EntityQR,
            (EntityQR.entity_id == Ticket.id)
            & (EntityQR.entity_type == "attendee_ticket")
            & EntityQR.is_active.is_(True),
        )
        .where(Ticket.event_id == point.event_id, Ticket.status == "active")
        .order_by(Ticket.created_at)
    )
    if point.policy_type == "TIER_RESTRICTED":
        # A tier-restricted gate only needs (and only gets) the tickets it may admit.
        stmt = stmt.where(Ticket.ticket_tier_id.in_(_allowed_tier_uuids(point)))
    return stmt


def _parse_manifest_cursor(raw: str | None, now: datetime) -> datetime | None:
    """The previous manifest's generation time, or None (full manifest) when absent or unusable."""
    if not raw:
        return None
    try:
        cursor = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if cursor.tzinfo is None or cursor > now:
        return None
    return cursor


@router.get("/api/checkin-points/{point_id}/manifest")
async def get_checkin_manifest(
    point: AuthorizedCheckInPointDep,
    session: SessionDep,
    since: Annotated[
        str | None,
        Query(max_length=64, description="Cursor of a previous manifest: return only what changed after it"),
    ] = None,
) -> CheckInManifest:
    # Database time, the same clock as the created_at/synced_at timestamps the delta compares against.
    generated_at: datetime = await session.scalar(select(func.now())) or datetime.now(timezone.utc)
    since_at = _parse_manifest_cursor(since, generated_at)

    tickets_stmt = _manifest_tickets_stmt(point)
    removed_qr_hashes: list[str] = []
    if since_at is not None:
        window = since_at - MANIFEST_DELTA_OVERLAP
        admission_changed = select(CheckIn.ticket_id).where(
            CheckIn.checkin_point_id == point.id,
            CheckIn.synced_at >= window,
            CheckIn.ticket_id.is_not(None),
        )
        tickets_stmt = tickets_stmt.where(
            or_(Ticket.created_at >= window, Ticket.id.in_(admission_changed))
        )
        # Tickets have no change timestamp, so every no-longer-admissible QR is listed (a small set).
        inactive = await session.execute(
            select(EntityQR.secret)
            .join(Ticket, (EntityQR.entity_id == Ticket.id) & (EntityQR.entity_type == "attendee_ticket"))
            .where(
                Ticket.event_id == point.event_id,
                or_(Ticket.status != "active", EntityQR.is_active.is_(False)),
            )
        )
        removed_qr_hashes = [manifest_qr_hash(point.event_id, secret) for (secret,) in inactive.all()]

    rows = (await session.execute(tickets_stmt)).all()

    admissions_stmt = (
        select(CheckIn.ticket_id, func.count(CheckIn.id))
        .where(
            CheckIn.checkin_point_id == point.id,
            CheckIn.status == "ADMITTED",
            CheckIn.ticket_id.is_not(None),
        )
        .group_by(CheckIn.ticket_id)
    )
    if since_at is not None:
        admissions_stmt = admissions_stmt.where(CheckIn.ticket_id.in_([row[0].id for row in rows]))
    admitted_counts: dict[uuid.UUID, int] = {
        ticket_id: count
        for ticket_id, count in (await session.execute(admissions_stmt)).all()
        if ticket_id is not None
    }

    manifest_tickets = [
        ManifestTicket(
            qr_hash=manifest_qr_hash(point.event_id, qr.secret),
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
        generated_at=generated_at,
        tickets=manifest_tickets,
        cursor=generated_at.isoformat(),
        is_delta=since_at is not None,
        removed_qr_hashes=removed_qr_hashes,
    )


# --- Scan ingestion -----------------------------------------------------------------------------------

# A device clock may run a little fast; beyond this its scanned_at is not trusted.
CLOCK_SKEW_TOLERANCE = timedelta(minutes=5)


@dataclass
class _ScanTarget:
    ticket: Ticket
    tier: TicketTier
    user: User


async def _load_scan_targets(session: SessionDep, secrets: set[str]) -> dict[str, _ScanTarget]:
    """Every scanned attendee-ticket QR of a batch, in one query; a secret missing here is INVALID_TICKET."""
    if not secrets:
        return {}
    rows = await session.execute(
        select(EntityQR.secret, Ticket, TicketTier, User)
        .join(Ticket, Ticket.id == EntityQR.entity_id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .join(User, Ticket.user_id == User.id)
        .where(
            EntityQR.secret.in_(secrets),
            EntityQR.is_active.is_(True),
            EntityQR.entity_type == "attendee_ticket",
        )
    )
    return {secret: _ScanTarget(ticket, tier, user) for secret, ticket, tier, user in rows.all()}


async def _ticket_identities(
    session: SessionDep, ticket_ids: set[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str]]:
    if not ticket_ids:
        return {}
    rows = await session.execute(
        select(Ticket.id, User.full_name, TicketTier.name)
        .join(User, Ticket.user_id == User.id)
        .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
        .where(Ticket.id.in_(ticket_ids))
    )
    return {ticket_id: (name, tier_name) for ticket_id, name, tier_name in rows.all()}


def _trusted_scan_time(claimed: datetime, now: datetime) -> tuple[datetime, bool]:
    """(time to record, clock_skew): a claim later than the server allows is replaced by the receive time."""
    if claimed > now + CLOCK_SKEW_TOLERANCE:
        return now, True
    return claimed, False


def _local_rejection_reason(scan: ScanSubmission) -> str:
    return f"LOCAL_REJECTED:{(scan.client_rejection_reason or 'UNSPECIFIED').strip()[:48]}"


def _replay_result(
    scan: ScanSubmission,
    secret: str,
    point: CheckInPoint,
    existing: CheckIn,
    identities: dict[uuid.UUID, tuple[str, str]],
) -> ScanResult:
    """An already-recorded scan_id: its original outcome, or SCAN_ID_CONFLICT outside its own scope.

    A scan_id is bound to its check-in point AND its QR secret. A cross-point, cross-event or
    cross-tenant replay, or a different secret, is rejected without disclosing the original
    attendee, secret or status.
    """
    if existing.checkin_point_id != point.id or existing.qr_secret != secret:
        return ScanResult(
            scan_id=scan.scan_id,
            qr_secret=scan.qr_secret,
            status="REJECTED",
            rejection_reason="SCAN_ID_CONFLICT",
        )
    identity = identities.get(existing.ticket_id) if existing.ticket_id else None
    return ScanResult(
        scan_id=existing.id,
        qr_secret=existing.qr_secret,
        status=existing.status,
        rejection_reason=existing.rejection_reason,
        attendee_name=identity[0] if identity else None,
        ticket_tier_name=identity[1] if identity else None,
        clock_skew=existing.clock_skew,
    )


async def _flush_checkin(session: SessionDep, checkin: CheckIn) -> IntegrityError | None:
    try:
        async with session.begin_nested():
            session.add(checkin)
            await session.flush()
    except IntegrityError as exc:
        return exc
    return None


async def _record_scans(
    session: SessionDep, point: CheckInPoint, scans: list[ScanSubmission]
) -> list[ScanResult]:
    """Evaluate and record scans in order, idempotently by scan_id. The caller commits.

    Concurrency: SINGLE_USE locks the scanned tickets' rows (sorted, all at once) and CAPACITY_CAPPED
    locks the point row, both until commit, so concurrent batches and single scans serialize on exactly
    the state they decide on. The partial unique index uq_checkin_single_use_admitted is the backstop.
    """
    now = datetime.now(timezone.utc)
    secrets = {scan.scan_id: normalize_qr_secret(scan.qr_secret) for scan in scans}

    recorded: dict[uuid.UUID, CheckIn] = {
        c.id: c for c in await session.scalars(select(CheckIn).where(CheckIn.id.in_(list(secrets))))
    }
    targets = await _load_scan_targets(session, set(secrets.values()))
    identities = await _ticket_identities(
        session, {c.ticket_id for c in recorded.values() if c.ticket_id is not None}
    )

    # Tickets the server will evaluate: new scans the device did not reject, of this event's tickets.
    evaluated: set[uuid.UUID] = set()
    for scan in scans:
        target = targets.get(secrets[scan.scan_id])
        if (
            target is not None
            and target.ticket.event_id == point.event_id
            and target.ticket.status == "active"
            and scan.scan_id not in recorded
            and scan.client_verdict != "REJECTED"
        ):
            evaluated.add(target.ticket.id)

    admitted_tickets: set[uuid.UUID] = set()
    admitted_count = 0
    if evaluated and point.policy_type == "SINGLE_USE":
        await session.execute(
            select(Ticket.id).where(Ticket.id.in_(evaluated)).order_by(Ticket.id).with_for_update()
        )
        admitted_tickets = {
            ticket_id
            for ticket_id in await session.scalars(
                select(CheckIn.ticket_id).where(
                    CheckIn.checkin_point_id == point.id,
                    CheckIn.ticket_id.in_(evaluated),
                    CheckIn.status == "ADMITTED",
                )
            )
            if ticket_id is not None
        }
    elif evaluated and point.policy_type == "CAPACITY_CAPPED":
        await session.execute(
            select(CheckInPoint.id).where(CheckInPoint.id == point.id).with_for_update()
        )
        admitted_count = await session.scalar(
            select(func.count(CheckIn.id)).where(
                CheckIn.checkin_point_id == point.id, CheckIn.status == "ADMITTED"
            )
        ) or 0

    results: list[ScanResult] = []
    for scan in scans:
        secret = secrets[scan.scan_id]
        existing = recorded.get(scan.scan_id)
        if existing is not None:
            results.append(_replay_result(scan, secret, point, existing, identities))
            continue

        scanned_at, clock_skew = _trusted_scan_time(scan.scanned_at, now)
        target = targets.get(secret)
        linked = target if target is not None and target.ticket.event_id == point.event_id else None
        scan_status = "REJECTED"
        rejection_reason: str | None
        if scan.client_verdict == "REJECTED":
            # The device turned the attendee away: that stays a rejection, whatever the rules say now.
            rejection_reason = _local_rejection_reason(scan)
        elif target is None:
            rejection_reason = "INVALID_TICKET"
        elif linked is None:
            # Another event's ticket: recorded against the gate only. The foreign ticket is not linked
            # (this event's reports never join the other congress's attendee) and its holder is not disclosed.
            rejection_reason = "EVENT_MISMATCH"
        elif linked.ticket.status != "active":
            # A cancelled or otherwise inactive ticket of this event: recorded against the ticket so the desk
            # sees the attempt in its scan history, and named like any of this event's verdicts (and replays).
            rejection_reason = "TICKET_INACTIVE"
        elif (
            point.policy_type == "CAPACITY_CAPPED"
            and point.max_capacity is not None
            and admitted_count >= point.max_capacity
        ):
            rejection_reason = "CAPACITY_REACHED"
        elif point.policy_type == "SINGLE_USE" and linked.ticket.id in admitted_tickets:
            rejection_reason = "ALREADY_ADMITTED"
        elif (
            point.policy_type == "TIER_RESTRICTED"
            and str(linked.ticket.ticket_tier_id) not in (point.allowed_tier_ids or [])
        ):
            rejection_reason = "TIER_NOT_ALLOWED"
        else:
            scan_status, rejection_reason = "ADMITTED", None

        def build(status_: str, reason: str | None) -> CheckIn:
            return CheckIn(
                id=scan.scan_id,
                checkin_point_id=point.id,
                ticket_id=linked.ticket.id if linked else None,
                qr_secret=secret,
                policy_type=point.policy_type,
                status=status_,
                rejection_reason=reason,
                scanned_at=scanned_at,
                client_verdict=scan.client_verdict,
                clock_skew=clock_skew,
                client_scanned_at=scan.scanned_at if clock_skew else None,
            )

        checkin = build(scan_status, rejection_reason)
        failure = await _flush_checkin(session, checkin)
        if failure is not None:
            # Case A: the same scan_id was recorded concurrently (primary key collision).
            concurrent = await session.get(CheckIn, scan.scan_id)
            if concurrent is not None:
                recorded[scan.scan_id] = concurrent
                if concurrent.ticket_id is not None and concurrent.ticket_id not in identities:
                    identities.update(await _ticket_identities(session, {concurrent.ticket_id}))
                results.append(_replay_result(scan, secret, point, concurrent, identities))
                continue
            # Case B: another admission of this single-use ticket won (uq_checkin_single_use_admitted).
            if linked is None or scan_status != "ADMITTED" or "unique" not in str(failure).lower():
                raise failure
            scan_status, rejection_reason = "REJECTED", "ALREADY_ADMITTED"
            checkin = build(scan_status, rejection_reason)
            async with session.begin_nested():
                session.add(checkin)
                await session.flush()

        recorded[scan.scan_id] = checkin
        if linked is not None:
            identities[linked.ticket.id] = (linked.user.full_name, linked.tier.name)
            if scan_status == "ADMITTED":
                admitted_tickets.add(linked.ticket.id)
                admitted_count += 1
        results.append(
            ScanResult(
                scan_id=scan.scan_id,
                qr_secret=secret,
                status=scan_status,
                rejection_reason=rejection_reason,
                attendee_name=linked.user.full_name if linked else None,
                ticket_tier_name=linked.tier.name if linked else None,
                clock_skew=clock_skew,
            )
        )
    return results


@router.post("/api/checkin-points/{point_id}/scans/batch")
async def ingest_scans_batch(
    body: BatchScanRequest, point: AuthorizedCheckInPointDep, session: SessionDep
) -> BatchScanResponse:
    """Queued scans (at most 200 per request, in order), idempotent by scan_id."""
    results = await _record_scans(session, point, body.scans)
    await session.commit()
    return BatchScanResponse(results=results)


@router.post("/api/checkin-points/{point_id}/scan")
async def record_single_scan(
    body: ScanSubmission, point: AuthorizedCheckInPointDep, session: SessionDep
) -> ScanResult:
    """One scan decided by the server while the scanner is online. Same rules, locks and idempotency
    as the batch, so a scanner that timed out can queue the same scan_id and get this verdict back."""
    results = await _record_scans(session, point, [body])
    await session.commit()
    return results[0]
