"""Check-in points, scanner devices, the offline manifest and scan ingestion (ADR 0004/0009/0010).

Gate rules a point combines (migration 0025):

- `policy_type`: MULTI_ENTRY, SINGLE_USE (once per admission window), CAPACITY_CAPPED, or TIER_RESTRICTED, which is
  kept for compatibility and means MULTI_ENTRY with a (required, non-empty) tier filter.
- `allowed_tier_ids`: a tier filter for every policy; empty admits every tier (except TIER_RESTRICTED).
- `reset_window`: EVENT, or DAY (calendar days in the event's time zone) for SINGLE_USE and for the cumulative count
  of a capped point; at a point that tracks occupancy, presence also starts afresh each day.
- `tracks_occupancy`: scans carry a direction; a capped point then caps the people inside.
- `requires_point_id`: the ticket must have been admitted at that point (same event) first.
- `session_id`: the door of a programme session (attendance: `routes/session_attendance.py`).

An entry (IN) is checked in this order: tier filter, required point, single use in the window, already inside
(admitted, not counted again), capacity. An exit (OUT) needs a point that tracks occupancy and a ticket inside.
The web scanner's local engine (`web/src/lib/scannerEngine.ts`) applies the same order;
`tests/fixtures/gate_parity.json` holds the scenarios both must decide alike.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from sqlalchemy import Select, func, or_, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.exc import IntegrityError

from app.auth import OrganizerDep, authorize, organizer_accepts_token, resolve_organizer_principal
from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import (
    CheckIn,
    CheckInPoint,
    EntityQR,
    Event,
    EventSession,
    ScannerDevice,
    Ticket,
    TicketTier,
    User,
)
from app.routes.events import ARCHIVED_READ_ONLY, OwnedEventDep, WritableEventDep, event_zone
from app.security import create_scanner_token, decode_access_token

_bearer = HTTPBearer(auto_error=False)

router = APIRouter(tags=["checkin"])

ResetWindow = Literal["EVENT", "DAY"]
Direction = Literal["IN", "OUT"]

POLICY_LOCKED = (
    "Cannot change admission policy for a check-in point with existing scan history. "
    "Create a new check-in point instead to preserve scanner cache and audit integrity."
)
ARCHIVED = "This check-in point is archived"


class CheckInPointCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location: str = Field(default="", max_length=200)
    policy_type: str = Field(
        default="MULTI_ENTRY",
        description="MULTI_ENTRY, SINGLE_USE, CAPACITY_CAPPED, or TIER_RESTRICTED (kept for compatibility: "
        "MULTI_ENTRY with a required tier filter)",
    )
    allowed_tier_ids: list[str] = Field(
        default_factory=list, description="Tier filter for every policy; empty admits every tier"
    )
    max_capacity: int | None = Field(default=None, gt=0)  # ck_checkin_points_max_capacity
    reset_window: ResetWindow = Field(
        default="EVENT",
        description="SINGLE_USE admits once per window: the event, or each calendar day in the event's time zone",
    )
    tracks_occupancy: bool = Field(
        default=False, description="Entry and exit scans; a capped point caps the people inside"
    )
    requires_point_id: uuid.UUID | None = Field(
        default=None, description="A ticket must have been admitted at this point (same event) first"
    )
    session_id: uuid.UUID | None = Field(default=None, description="The programme session this point is the door of")


class CheckInPointUpdate(BaseModel):
    """Partial update: omitted fields keep their value; an explicit null clears max_capacity, requires_point_id
    and session_id. The policy, window and occupancy are locked once the point has scans."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    location: str | None = Field(default=None, max_length=200)
    policy_type: str | None = Field(
        default=None,
        description="MULTI_ENTRY, SINGLE_USE, CAPACITY_CAPPED, or TIER_RESTRICTED",
    )
    allowed_tier_ids: list[str] | None = None
    max_capacity: int | None = Field(default=None, gt=0)  # ck_checkin_points_max_capacity
    reset_window: ResetWindow | None = None
    tracks_occupancy: bool | None = None
    requires_point_id: uuid.UUID | None = None
    session_id: uuid.UUID | None = None


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
    reset_window: str = "EVENT"
    tracks_occupancy: bool = False
    requires_point_id: uuid.UUID | None = None
    session_id: uuid.UUID | None = None
    archived_at: datetime | None = None


class ManifestTicket(BaseModel):
    qr_hash: str = Field(
        description="sha256 hex of '<event_id>:<normalized QR secret>'; the raw secret is never sent",
    )
    ticket_id: uuid.UUID
    attendee_name: str
    ticket_tier_id: uuid.UUID
    ticket_tier_name: str
    admission_count: int = Field(description="Entries admitted at this point, in every window")
    is_admitted: bool = Field(description="Admitted at this point in the manifest's admission_window")
    last_admitted_window: str | None = Field(
        default=None,
        description="Window of the latest admission ('event' or a local date). A scanner compares it with the "
        "window it is in now, so a manifest from yesterday does not count yesterday's meal today.",
    )
    is_inside: bool = Field(
        default=False, description="Occupancy points: inside in the manifest's admission_window"
    )
    presence_at: datetime | None = Field(
        default=None,
        description="Occupancy points: scan time of the entry or exit that decided is_inside; a device replays "
        "only its own scans later than this",
    )
    prerequisite_met: bool = Field(
        default=True, description="Admitted at the required point (always true without one)"
    )


class ScannerTokenOut(BaseModel):
    scanner_token: str
    token_type: str = "Bearer"
    point_id: uuid.UUID
    event_id: uuid.UUID
    device_id: uuid.UUID
    expires_at: datetime


class ScannerDeviceCreate(BaseModel):
    device_name: str = Field(default="Gate Scanner Client", min_length=1, max_length=100)


# A device that has not reached the server for this long is shown as stale in the organizer's device list.
DEVICE_STALE_AFTER = timedelta(minutes=10)


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
    unsynced_count: int | None = Field(default=None, description="Scans waiting on the device, as last reported")
    app_version: str | None = None
    last_heartbeat_at: datetime | None = None
    stale: bool = Field(
        default=False, description="Active device last seen more than 10 minutes ago (never seen: not stale)"
    )


def _device_out(device: ScannerDevice, now: datetime) -> ScannerDeviceOut:
    out = ScannerDeviceOut.model_validate(device)
    out.stale = (
        not device.is_revoked and device.last_seen_at is not None and now - device.last_seen_at > DEVICE_STALE_AFTER
    )
    return out


class DeviceHeartbeat(BaseModel):
    unsynced_count: int = Field(ge=0, le=1_000_000)
    app_version: str | None = Field(default=None, max_length=40)


class CheckInManifest(BaseModel):
    checkin_point: CheckInPointOut
    event_id: uuid.UUID
    generated_at: datetime
    tickets: list[ManifestTicket] = Field(
        description="Full manifest: every admissible ticket. Delta: tickets added or whose admission state "
        "at this point (or at its required point) changed since the cursor (upsert by qr_hash)."
    )
    cursor: str = Field(description="Pass back as ?since= to receive only what changed after this manifest")
    is_delta: bool = False
    removed_qr_hashes: list[str] = Field(
        default_factory=list,
        description="Delta only: tickets that are no longer admissible (cancelled ticket or deactivated QR)",
    )
    admission_window: str = Field(
        default="event", description="The window is_admitted and is_inside refer to: 'event' or today's local date"
    )
    event_timezone: str = Field(default="Asia/Tehran", description="IANA zone that DAY windows are dates in")
    occupancy: int | None = Field(default=None, description="People inside now (occupancy points only)")


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
    direction: Direction = Field(
        default="IN", description="Entry or exit; exits only at points that track occupancy"
    )


class BatchScanRequest(BaseModel):
    scans: list[ScanSubmission] = Field(max_length=200)


class ScanResult(BaseModel):
    scan_id: uuid.UUID
    qr_secret: str
    status: str  # ADMITTED or REJECTED; an accepted exit is ADMITTED with direction OUT
    rejection_reason: str | None = None
    attendee_name: str | None = None
    ticket_tier_name: str | None = None
    clock_skew: bool = False
    direction: str = "IN"


class BatchScanResponse(BaseModel):
    results: list[ScanResult]


ADMISSION_POLICIES = ("MULTI_ENTRY", "SINGLE_USE", "TIER_RESTRICTED", "CAPACITY_CAPPED")
# Occupancy needs a policy that lets a ticket in more than once.
OCCUPANCY_POLICIES = ("MULTI_ENTRY", "TIER_RESTRICTED", "CAPACITY_CAPPED")


def _admission_policy(raw: str) -> str:
    policy = raw.strip().upper()
    if policy not in ADMISSION_POLICIES:
        raise ApiError(status.HTTP_400_BAD_REQUEST, "CHECKIN_POLICY_INVALID", f"Invalid policy_type: {policy}")
    return policy


def _require_tiers_for_tier_policy(policy: str, tier_ids: list[str]) -> None:
    """A tier-restricted point with no tiers would admit nobody (or, on a lenient client, everybody)."""
    if policy == "TIER_RESTRICTED" and not tier_ids:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "TIER_FILTER_REQUIRED",
            "A TIER_RESTRICTED check-in point needs at least one allowed ticket tier",
        )


def _require_occupancy_policy(policy: str, tracks_occupancy: bool) -> None:
    if tracks_occupancy and policy not in OCCUPANCY_POLICIES:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "OCCUPANCY_POLICY_UNSUPPORTED",
            "Occupancy (entry and exit scans) needs a MULTI_ENTRY or CAPACITY_CAPPED check-in point",
        )


async def _require_event_tiers(session: SessionDep, event: Event, tier_ids: list[str]) -> None:
    """Every allowed tier must be one of this event's tiers; another event's tier is rejected."""
    if not tier_ids:
        return
    valid_tiers = await session.scalars(select(TicketTier.id).where(TicketTier.event_id == event.id))
    valid_tier_strs = {str(t_id) for t_id in valid_tiers}
    for tier_id_str in tier_ids:
        if tier_id_str not in valid_tier_strs:
            raise ApiError(
                status.HTTP_400_BAD_REQUEST,
                "TIER_NOT_IN_EVENT",
                f"Tier ID '{tier_id_str}' does not belong to this event",
            )


async def _require_valid_parent(
    session: SessionDep, event: Event, point_id: uuid.UUID | None, parent_id: uuid.UUID | None
) -> None:
    """The required point exists in the same event, is not the point itself, and does not lead back to it."""
    if parent_id is None:
        return
    invalid = ApiError(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "REQUIRED_POINT_INVALID",
        "The required check-in point must be another point of this event, without a circular requirement",
    )
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = parent_id
    while current is not None:
        if current == point_id or current in seen:
            raise invalid
        seen.add(current)
        row = (
            await session.execute(
                select(CheckInPoint.event_id, CheckInPoint.requires_point_id).where(CheckInPoint.id == current)
            )
        ).first()
        if row is None or row.event_id != event.id:
            raise invalid
        current = row.requires_point_id


async def _require_event_session(session: SessionDep, event: Event, session_id: uuid.UUID | None) -> None:
    if session_id is None:
        return
    found = await session.scalar(
        select(EventSession.id).where(EventSession.id == session_id, EventSession.event_id == event.id)
    )
    if found is None:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "CHECKIN_SESSION_INVALID",
            "The session must be a programme session of this event",
        )


POINT_WRITE_ERRORS = error_responses(
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_404_NOT_FOUND,
    status.HTTP_409_CONFLICT,
    status.HTTP_422_UNPROCESSABLE_CONTENT,
)


@router.post(
    "/api/events/{event_id}/checkin-points",
    status_code=status.HTTP_201_CREATED,
    responses=POINT_WRITE_ERRORS,
)
async def create_checkin_point(
    body: CheckInPointCreate, event: WritableEventDep, session: SessionDep
) -> CheckInPointOut:
    policy = _admission_policy(body.policy_type)
    _require_tiers_for_tier_policy(policy, body.allowed_tier_ids)
    _require_occupancy_policy(policy, body.tracks_occupancy)
    await _require_event_tiers(session, event, body.allowed_tier_ids)
    await _require_valid_parent(session, event, None, body.requires_point_id)
    await _require_event_session(session, event, body.session_id)
    point = CheckInPoint(
        event_id=event.id,
        name=body.name.strip(),
        location=body.location.strip(),
        policy_type=policy,
        allowed_tier_ids=body.allowed_tier_ids,
        max_capacity=body.max_capacity,
        reset_window=body.reset_window,
        tracks_occupancy=body.tracks_occupancy,
        requires_point_id=body.requires_point_id,
        session_id=body.session_id,
    )
    session.add(point)
    await session.commit()
    return CheckInPointOut.model_validate(point)


@router.get("/api/events/{event_id}/checkin-points")
async def list_checkin_points(
    event: OwnedEventDep, session: SessionDep
) -> list[CheckInPointOut]:
    """Every point of the event, archived ones included (with `archived_at`)."""
    points = await session.scalars(
        select(CheckInPoint)
        .where(CheckInPoint.event_id == event.id)
        .order_by(CheckInPoint.created_at)
    )
    return [CheckInPointOut.model_validate(p) for p in points]


async def _owned_point(session: SessionDep, event: Event, point_id: uuid.UUID, lock: bool = False) -> CheckInPoint:
    stmt = select(CheckInPoint).where(CheckInPoint.id == point_id, CheckInPoint.event_id == event.id)
    point = await session.scalar(stmt.with_for_update() if lock else stmt)
    if point is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    return point


async def _has_scans(session: SessionDep, point_id: uuid.UUID) -> bool:
    return (await session.scalar(select(CheckIn.id).where(CheckIn.checkin_point_id == point_id).limit(1))) is not None


@router.patch("/api/events/{event_id}/checkin-points/{point_id}", responses=POINT_WRITE_ERRORS)
async def update_checkin_point(
    point_id: uuid.UUID,
    body: CheckInPointUpdate,
    event: WritableEventDep,
    session: SessionDep,
) -> CheckInPointOut:
    point = await _owned_point(session, event, point_id, lock=True)
    given = body.model_fields_set

    policy = _admission_policy(body.policy_type) if body.policy_type is not None else point.policy_type
    tiers = body.allowed_tier_ids if body.allowed_tier_ids is not None else point.allowed_tier_ids or []
    reset_window = body.reset_window or point.reset_window
    tracks_occupancy = body.tracks_occupancy if body.tracks_occupancy is not None else point.tracks_occupancy
    _require_tiers_for_tier_policy(policy, tiers)
    _require_occupancy_policy(policy, tracks_occupancy)

    # The rules a scanner's cache and the recorded verdicts depend on are fixed once scans exist.
    rules_changed = (policy, reset_window, tracks_occupancy) != (
        point.policy_type,
        point.reset_window,
        point.tracks_occupancy,
    )
    if rules_changed and await _has_scans(session, point.id):
        raise ApiError(status.HTTP_409_CONFLICT, "CHECKIN_POINT_POLICY_LOCKED", POLICY_LOCKED)
    point.policy_type, point.reset_window, point.tracks_occupancy = policy, reset_window, tracks_occupancy

    if body.allowed_tier_ids is not None:
        await _require_event_tiers(session, event, body.allowed_tier_ids)
        point.allowed_tier_ids = body.allowed_tier_ids
    if "requires_point_id" in given:
        await _require_valid_parent(session, event, point.id, body.requires_point_id)
        point.requires_point_id = body.requires_point_id
    if "session_id" in given:
        await _require_event_session(session, event, body.session_id)
        point.session_id = body.session_id
    if body.name is not None:
        point.name = body.name.strip()
    if body.location is not None:
        point.location = body.location.strip()
    if "max_capacity" in given:
        point.max_capacity = body.max_capacity

    await session.commit()
    await session.refresh(point)
    return CheckInPointOut.model_validate(point)


@router.post(
    "/api/events/{event_id}/checkin-points/{point_id}/archive",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def archive_checkin_point(point_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> CheckInPointOut:
    """Hide the point from scanners and pairing; its scans stay in analytics. Its devices stop working until it is
    unarchived."""
    point = await _owned_point(session, event, point_id, lock=True)
    if point.archived_at is None:
        point.archived_at = datetime.now(timezone.utc)
    await session.commit()
    return CheckInPointOut.model_validate(point)


@router.post(
    "/api/events/{event_id}/checkin-points/{point_id}/unarchive",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def unarchive_checkin_point(point_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> CheckInPointOut:
    point = await _owned_point(session, event, point_id, lock=True)
    point.archived_at = None
    await session.commit()
    return CheckInPointOut.model_validate(point)


@router.delete(
    "/api/events/{event_id}/checkin-points/{point_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
)
async def delete_checkin_point(point_id: uuid.UUID, event: WritableEventDep, session: SessionDep) -> Response:
    """Only a point without scans is deleted (with its paired devices); a point with scans is archived instead."""
    point = await _owned_point(session, event, point_id, lock=True)
    if await _has_scans(session, point.id):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "CHECKIN_POINT_HAS_SCANS",
            "This check-in point has recorded scans; archive it instead",
        )
    dependent = await session.scalar(
        select(CheckInPoint.id).where(CheckInPoint.requires_point_id == point.id).limit(1)
    )
    if dependent is not None:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "CHECKIN_POINT_REQUIRED_BY_OTHER",
            "Another check-in point requires admission at this one; change that point first",
        )
    await session.delete(point)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Authorization ------------------------------------------------------------------------------------------


def _missing_credentials() -> ApiError:
    return ApiError(
        status.HTTP_401_UNAUTHORIZED,
        "SCANNER_CREDENTIALS_MISSING",
        "Missing authorization credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _scanner_device(
    session: SessionDep, point: CheckInPoint, event: Event, payload: dict[str, Any]
) -> ScannerDevice:
    """The registered, unrevoked device a scanner token names, for this point; its last contact is noted."""
    token_point_id = payload.get("point_id")
    token_event_id = payload.get("event_id")
    if str(point.id) != token_point_id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "SCANNER_SCOPE_MISMATCH",
            "Scanner token is not authorized for this check-in point",
        )
    if str(point.event_id) != token_event_id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "SCANNER_SCOPE_MISMATCH",
            "Scanner token is not authorized for this event",
        )
    # Every scanner token names its registered device (jti); revocation is per device, so a token
    # without one, or whose device row is gone, cannot be revoked and is refused.
    try:
        device_uuid = uuid.UUID(str(payload.get("jti")))
    except (ValueError, TypeError):
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_TOKEN_INVALID",
            "Invalid scanner device identifier in token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    device = await session.get(ScannerDevice, device_uuid)
    if device is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_TOKEN_INVALID",
            "Scanner device is not registered",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if device.is_revoked:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_REVOKED",
            "Scanner device token has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if device.checkin_point_id != point.id:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "SCANNER_SCOPE_MISMATCH",
            "Scanner token is not authorized for this check-in point",
        )
    if not await organizer_accepts_token(session, event.organizer_id, payload.get("iat")):
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_TOKEN_INVALID",
            "Scanner token is no longer valid",
            headers={"WWW-Authenticate": "Bearer"},
        )
    device.last_seen_at = datetime.now(timezone.utc)
    return device


async def _point_and_event(session: SessionDep, point_id: uuid.UUID) -> tuple[CheckInPoint, Event]:
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "EVENT_NOT_FOUND", "Event not found")
    return point, event


async def authorized_checkin_point(
    point_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CheckInPoint:
    if credentials is None or not credentials.credentials:
        raise _missing_credentials()

    point, event = await _point_and_event(session, point_id)

    token = credentials.credentials
    jwt_secret: str = request.app.state.settings.jwt_secret

    # 1. Attempt validation as Scanner JWT
    payload = decode_access_token(token, jwt_secret)
    if payload is not None and payload.get("type") != "organizer_member":
        if payload.get("type") == "scanner":
            await _scanner_device(session, point, event, payload)
            return point
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "SCANNER_CREDENTIALS_REQUIRED",
            "Insufficient permissions for check-in point scanning",
        )

    # 2. The organizer itself: its API key or a member session with a role that may scan (app.roles).
    principal = await resolve_organizer_principal(session, request, token)
    if principal is not None:
        if event.organizer_id != principal.organizer.id:
            # Mask presence of foreign organizer's check-in point with 404
            raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
        authorize(request, principal)
        return point

    raise ApiError(
        status.HTTP_401_UNAUTHORIZED,
        "SCANNER_TOKEN_INVALID",
        "Invalid authorization credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


AuthorizedCheckInPointDep = Annotated[CheckInPoint, Depends(authorized_checkin_point)]


async def paired_scanner_device(
    point_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> ScannerDevice:
    """A paired scanner device of this point, by its own token only (no organizer credential)."""
    if credentials is None or not credentials.credentials:
        raise _missing_credentials()
    point, event = await _point_and_event(session, point_id)
    payload = decode_access_token(credentials.credentials, request.app.state.settings.jwt_secret)
    if payload is None or payload.get("type") != "scanner":
        raise ApiError(status.HTTP_403_FORBIDDEN, "SCANNER_CREDENTIALS_REQUIRED", "Scanner credentials required")
    return await _scanner_device(session, point, event, payload)


def _refuse_archived(point: CheckInPoint) -> None:
    """Scanners of an archived point are blocked like a device of another point (403), old scanners included."""
    if point.archived_at is not None:
        raise ApiError(status.HTTP_403_FORBIDDEN, "CHECKIN_POINT_ARCHIVED", ARCHIVED)


@router.post(
    "/api/checkin-points/{point_id}/token",
    status_code=status.HTTP_201_CREATED,
    summary="Issue a point-scoped scanner client token",
    responses=error_responses(status.HTTP_404_NOT_FOUND, status.HTTP_409_CONFLICT),
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
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    if event.archived_at is not None:
        # An archived congress is read-only: no new scanner devices (its points' archive is separate).
        raise ApiError(status.HTTP_409_CONFLICT, "EVENT_ARCHIVED", ARCHIVED_READ_ONLY)
    if point.archived_at is not None:
        raise ApiError(status.HTTP_409_CONFLICT, "CHECKIN_POINT_ARCHIVED", ARCHIVED)

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
    """Newest first, with what each device last reported: last contact, unsynced scans, app version, staleness."""
    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")

    devices = await session.scalars(
        select(ScannerDevice)
        .where(ScannerDevice.checkin_point_id == point.id)
        .order_by(ScannerDevice.created_at.desc())
    )
    now = datetime.now(timezone.utc)
    return [_device_out(d, now) for d in devices]


@router.post(
    "/api/checkin-points/{point_id}/devices/self/heartbeat",
    summary="Report the scanner's state (unsynced scans, app version) for the organizer's device list",
    responses=error_responses(status.HTTP_403_FORBIDDEN),
)
async def scanner_device_heartbeat(
    point_id: uuid.UUID,
    body: DeviceHeartbeat,
    device: Annotated[ScannerDevice, Depends(paired_scanner_device)],
    session: SessionDep,
) -> ScannerDeviceOut:
    point = await session.get(CheckInPoint, point_id)
    if point is not None:
        _refuse_archived(point)
    now = datetime.now(timezone.utc)
    device.unsynced_count = body.unsynced_count
    device.app_version = body.app_version.strip() if body.app_version else None
    device.last_heartbeat_at = now
    await session.commit()
    return _device_out(device, now)


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
        raise _missing_credentials()

    payload = decode_access_token(credentials.credentials, request.app.state.settings.jwt_secret)
    if payload is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_TOKEN_INVALID",
            "Invalid or expired scanner token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if payload.get("type") != "scanner":
        raise ApiError(status.HTTP_403_FORBIDDEN, "SCANNER_CREDENTIALS_REQUIRED", "Scanner credentials required")
    if payload.get("point_id") != str(point_id):
        raise ApiError(status.HTTP_403_FORBIDDEN, "SCANNER_SCOPE_MISMATCH", "Scanner token scope mismatch")

    try:
        device_id = uuid.UUID(str(payload.get("jti", "")))
    except ValueError as exc:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_TOKEN_INVALID",
            "Scanner token has no valid device identity",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    point = await session.get(CheckInPoint, point_id)
    if point is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    if payload.get("event_id") != str(point.event_id):
        raise ApiError(status.HTTP_403_FORBIDDEN, "SCANNER_SCOPE_MISMATCH", "Scanner token scope mismatch")

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
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_REVOKED",
            "Scanner device is no longer authorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if device.is_revoked:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "SCANNER_REVOKED",
            "Scanner device has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    now = datetime.now(timezone.utc)
    device.is_revoked = True
    device.revoked_at = now
    await session.commit()
    return _device_out(device, now)


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
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")
    event = await session.get(Event, point.event_id)
    if event is None or event.organizer_id != organizer.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "POINT_NOT_FOUND", "Check-in point not found")

    device = await session.get(ScannerDevice, device_id)
    if device is None or device.checkin_point_id != point.id:
        raise ApiError(status.HTTP_404_NOT_FOUND, "SCANNER_DEVICE_NOT_FOUND", "Scanner device not found")

    now = datetime.now(timezone.utc)
    device.is_revoked = True
    device.revoked_at = now
    await session.commit()

    return _device_out(device, now)


# --- Admission windows and presence ---------------------------------------------------------------------------


def admission_window(point: CheckInPoint, zone: ZoneInfo, at: datetime) -> str:
    """'event', or the local date of `at` in the event's zone at a point whose reset_window is DAY."""
    return at.astimezone(zone).date().isoformat() if point.reset_window == "DAY" else "event"


def _tier_allowed(point: CheckInPoint, ticket: Ticket) -> bool:
    allowed = point.allowed_tier_ids or []
    if not allowed and point.policy_type != "TIER_RESTRICTED":
        return True
    return str(ticket.ticket_tier_id) in allowed


def _latest_presence(point: CheckInPoint) -> Any:
    """Per ticket and window, the accepted entry or exit with the latest scan time: it decides who is inside."""
    return (
        select(CheckIn.ticket_id, CheckIn.admission_window, CheckIn.direction, CheckIn.scanned_at)
        .where(CheckIn.checkin_point_id == point.id, CheckIn.status == "ADMITTED", CheckIn.ticket_id.is_not(None))
        .ext(distinct_on(CheckIn.ticket_id, CheckIn.admission_window))
        .order_by(CheckIn.ticket_id, CheckIn.admission_window, CheckIn.scanned_at.desc(), CheckIn.synced_at.desc())
        .subquery()
    )


async def _inside_count(session: SessionDep, point: CheckInPoint, window: str) -> int:
    latest = _latest_presence(point)
    return (
        await session.scalar(
            select(func.count())
            .select_from(latest)
            .where(latest.c.admission_window == window, latest.c.direction == "IN")
        )
    ) or 0


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
    if point.allowed_tier_ids or point.policy_type == "TIER_RESTRICTED":
        # A gate with a tier filter only needs (and only gets) the tickets it may admit.
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


@router.get(
    "/api/checkin-points/{point_id}/manifest", responses=error_responses(status.HTTP_403_FORBIDDEN)
)
async def get_checkin_manifest(
    point: AuthorizedCheckInPointDep,
    session: SessionDep,
    since: Annotated[
        str | None,
        Query(max_length=64, description="Cursor of a previous manifest: return only what changed after it"),
    ] = None,
) -> CheckInManifest:
    _refuse_archived(point)
    event = await session.get(Event, point.event_id)
    assert event is not None  # loaded by the authorization dependency
    zone = event_zone(event)
    # Database time, the same clock as the created_at/synced_at timestamps the delta compares against.
    generated_at: datetime = await session.scalar(select(func.now())) or datetime.now(timezone.utc)
    since_at = _parse_manifest_cursor(since, generated_at)
    window = admission_window(point, zone, generated_at)
    if since_at is not None and admission_window(point, zone, since_at) != window:
        # A new day voided every admission of the previous one: only a full manifest can say so.
        since_at = None

    tickets_stmt = _manifest_tickets_stmt(point)
    removed_qr_hashes: list[str] = []
    if since_at is not None:
        overlap = since_at - MANIFEST_DELTA_OVERLAP
        watched = [point.id] + ([point.requires_point_id] if point.requires_point_id else [])
        admission_changed = select(CheckIn.ticket_id).where(
            CheckIn.checkin_point_id.in_(watched),
            CheckIn.synced_at >= overlap,
            CheckIn.ticket_id.is_not(None),
        )
        tickets_stmt = tickets_stmt.where(
            or_(Ticket.created_at >= overlap, Ticket.id.in_(admission_changed))
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
    row_ids = [row[0].id for row in rows]

    entries = (CheckIn.direction == "IN") & (CheckIn.status == "ADMITTED")
    admissions_stmt = (
        select(
            CheckIn.ticket_id,
            func.count(CheckIn.id),
            func.max(CheckIn.admission_window),
            func.bool_or(CheckIn.admission_window == window),
        )
        .where(CheckIn.checkin_point_id == point.id, entries, CheckIn.ticket_id.is_not(None))
        .group_by(CheckIn.ticket_id)
    )
    if since_at is not None:
        admissions_stmt = admissions_stmt.where(CheckIn.ticket_id.in_(row_ids))
    admissions: dict[uuid.UUID, tuple[int, str, bool]] = {
        ticket_id: (count, last_window, admitted_now)
        for ticket_id, count, last_window, admitted_now in (await session.execute(admissions_stmt)).all()
        if ticket_id is not None
    }

    presence: dict[uuid.UUID, tuple[str, datetime]] = {}
    occupancy: int | None = None
    if point.tracks_occupancy:
        latest = _latest_presence(point)
        presence_stmt = select(latest.c.ticket_id, latest.c.direction, latest.c.scanned_at).where(
            latest.c.admission_window == window
        )
        if since_at is not None:
            presence_stmt = presence_stmt.where(latest.c.ticket_id.in_(row_ids))
        presence = {tid: (direction, at) for tid, direction, at in (await session.execute(presence_stmt)).all()}
        occupancy = await _inside_count(session, point, window)

    visited: set[uuid.UUID] | None = None
    if point.requires_point_id is not None:
        visited_stmt = select(CheckIn.ticket_id).where(
            CheckIn.checkin_point_id == point.requires_point_id, entries, CheckIn.ticket_id.is_not(None)
        )
        if since_at is not None:
            visited_stmt = visited_stmt.where(CheckIn.ticket_id.in_(row_ids))
        visited = {tid for tid in await session.scalars(visited_stmt.distinct()) if tid is not None}

    manifest_tickets = []
    for ticket, tier, user, qr in rows:
        count, last_window, admitted_now = admissions.get(ticket.id, (0, None, False))
        direction, presence_at = presence.get(ticket.id, (None, None))
        manifest_tickets.append(
            ManifestTicket(
                qr_hash=manifest_qr_hash(point.event_id, qr.secret),
                ticket_id=ticket.id,
                attendee_name=user.full_name,
                ticket_tier_id=tier.id,
                ticket_tier_name=tier.name,
                admission_count=count,
                is_admitted=bool(admitted_now),
                last_admitted_window=last_window,
                is_inside=direction == "IN",
                presence_at=presence_at,
                prerequisite_met=visited is None or ticket.id in visited,
            )
        )

    manifest = CheckInManifest(
        checkin_point=CheckInPointOut.model_validate(point),
        event_id=point.event_id,
        generated_at=generated_at,
        tickets=manifest_tickets,
        cursor=generated_at.isoformat(),
        is_delta=since_at is not None,
        removed_qr_hashes=removed_qr_hashes,
        admission_window=window,
        event_timezone=zone.key,
        occupancy=occupancy,
    )
    # A scanner's manifest fetch is its regular contact: keep its last_seen_at (device dashboard).
    await session.commit()
    return manifest


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
            direction=scan.direction,
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
        direction=existing.direction,
    )


async def _flush_checkin(session: SessionDep, checkin: CheckIn) -> IntegrityError | None:
    try:
        async with session.begin_nested():
            session.add(checkin)
            await session.flush()
    except IntegrityError as exc:
        return exc
    return None


@dataclass
class _GateState:
    """What a batch's verdicts depend on, read under the point's or the tickets' locks and advanced as it goes."""

    point: CheckInPoint
    # SINGLE_USE: (ticket, window) pairs admitted.
    admitted: set[tuple[uuid.UUID, str]] = field(default_factory=set)
    # Capped points without occupancy: entries admitted per window.
    counts: dict[str, int] = field(default_factory=dict)
    # Occupancy points: (ticket, window) -> (scan time, direction) of the latest accepted entry or exit.
    presence: dict[tuple[uuid.UUID, str], tuple[datetime, str]] = field(default_factory=dict)
    inside: dict[str, int] = field(default_factory=dict)
    # Tickets admitted at the required point.
    visited: set[uuid.UUID] = field(default_factory=set)

    def is_inside(self, ticket_id: uuid.UUID, window: str) -> bool:
        latest = self.presence.get((ticket_id, window))
        return latest is not None and latest[1] == "IN"

    def current(self, window: str) -> int:
        return self.inside.get(window, 0) if self.point.tracks_occupancy else self.counts.get(window, 0)

    def accept(self, ticket_id: uuid.UUID, window: str, direction: str, at: datetime) -> None:
        if direction == "IN":
            self.admitted.add((ticket_id, window))
            self.counts[window] = self.counts.get(window, 0) + 1
        if not self.point.tracks_occupancy:
            return
        latest = self.presence.get((ticket_id, window))
        if latest is not None and at < latest[0]:
            return  # an older scan uploaded late: the later one still decides
        was_inside = latest is not None and latest[1] == "IN"
        self.presence[(ticket_id, window)] = (at, direction)
        self.inside[window] = self.inside.get(window, 0) + (direction == "IN") - was_inside

    @classmethod
    async def load(
        cls, session: SessionDep, point: CheckInPoint, tickets: set[uuid.UUID], windows: set[str]
    ) -> "_GateState":
        state = cls(point)
        if not tickets:
            return state
        entries = (CheckIn.direction == "IN") & (CheckIn.status == "ADMITTED")
        if point.policy_type == "SINGLE_USE":
            await session.execute(
                select(Ticket.id).where(Ticket.id.in_(tickets)).order_by(Ticket.id).with_for_update()
            )
            rows = await session.execute(
                select(CheckIn.ticket_id, CheckIn.admission_window).where(
                    CheckIn.checkin_point_id == point.id,
                    CheckIn.ticket_id.in_(tickets),
                    CheckIn.admission_window.in_(windows),
                    entries,
                )
            )
            state.admitted = {(tid, w) for tid, w in rows.all() if tid is not None}
        if point.policy_type == "CAPACITY_CAPPED" or point.tracks_occupancy:
            await session.execute(select(CheckInPoint.id).where(CheckInPoint.id == point.id).with_for_update())
        if point.tracks_occupancy:
            latest = _latest_presence(point)
            in_windows = latest.c.admission_window.in_(windows)
            inside_rows = await session.execute(
                select(latest.c.admission_window, func.count())
                .where(in_windows, latest.c.direction == "IN")
                .group_by(latest.c.admission_window)
            )
            state.inside = {w: n for w, n in inside_rows.all()}
            presence_rows = await session.execute(
                select(latest.c.ticket_id, latest.c.admission_window, latest.c.scanned_at, latest.c.direction).where(
                    in_windows, latest.c.ticket_id.in_(tickets)
                )
            )
            state.presence = {(tid, w): (at, d) for tid, w, at, d in presence_rows.all()}
        elif point.policy_type == "CAPACITY_CAPPED":
            count_rows = await session.execute(
                select(CheckIn.admission_window, func.count(CheckIn.id))
                .where(CheckIn.checkin_point_id == point.id, CheckIn.admission_window.in_(windows), entries)
                .group_by(CheckIn.admission_window)
            )
            state.counts = {w: n for w, n in count_rows.all()}
        if point.requires_point_id is not None:
            state.visited = {
                tid
                for tid in await session.scalars(
                    select(CheckIn.ticket_id).where(
                        CheckIn.checkin_point_id == point.requires_point_id, CheckIn.ticket_id.in_(tickets), entries
                    )
                )
                if tid is not None
            }
        return state

    def decide(self, ticket: Ticket, window: str, direction: str) -> str | None:
        """The rejection reason for a valid ticket of this event, or None to admit (or accept the exit)."""
        point = self.point
        if direction == "OUT":
            if not point.tracks_occupancy:
                return "EXIT_NOT_TRACKED"
            return None if self.is_inside(ticket.id, window) else "NOT_INSIDE"
        if not _tier_allowed(point, ticket):
            return "TIER_NOT_ALLOWED"
        if point.requires_point_id is not None and ticket.id not in self.visited:
            return "REQUIRED_POINT_NOT_VISITED"
        if point.policy_type == "SINGLE_USE" and (ticket.id, window) in self.admitted:
            return "ALREADY_ADMITTED"
        if point.tracks_occupancy and self.is_inside(ticket.id, window):
            return None  # already inside: let them through without counting them again
        if (
            point.policy_type == "CAPACITY_CAPPED"
            and point.max_capacity is not None
            and self.current(window) >= point.max_capacity
        ):
            return "CAPACITY_REACHED"
        return None


async def _record_scans(
    session: SessionDep, point: CheckInPoint, scans: list[ScanSubmission]
) -> list[ScanResult]:
    """Evaluate and record scans in order, idempotently by scan_id. The caller commits.

    Concurrency: SINGLE_USE locks the scanned tickets' rows (sorted, all at once); capped and occupancy points
    lock the point row; both until commit, so concurrent batches and single scans serialize on exactly the
    state they decide on. The partial unique index uq_checkin_single_use_window is the backstop.
    """
    now = datetime.now(timezone.utc)
    event = await session.get(Event, point.event_id)
    assert event is not None
    zone = event_zone(event)
    secrets = {scan.scan_id: normalize_qr_secret(scan.qr_secret) for scan in scans}
    times = {scan.scan_id: _trusted_scan_time(scan.scanned_at, now) for scan in scans}
    windows = {scan_id: admission_window(point, zone, at) for scan_id, (at, _) in times.items()}

    recorded: dict[uuid.UUID, CheckIn] = {
        c.id: c for c in await session.scalars(select(CheckIn).where(CheckIn.id.in_(list(secrets))))
    }
    targets = await _load_scan_targets(session, set(secrets.values()))
    identities = await _ticket_identities(
        session, {c.ticket_id for c in recorded.values() if c.ticket_id is not None}
    )

    # Tickets the server will evaluate: new scans the device did not reject, of this event's tickets.
    evaluated: set[uuid.UUID] = set()
    evaluated_windows: set[str] = set()
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
            evaluated_windows.add(windows[scan.scan_id])
    state = await _GateState.load(session, point, evaluated, evaluated_windows)

    results: list[ScanResult] = []
    for scan in scans:
        secret = secrets[scan.scan_id]
        existing = recorded.get(scan.scan_id)
        if existing is not None:
            results.append(_replay_result(scan, secret, point, existing, identities))
            continue

        scanned_at, clock_skew = times[scan.scan_id]
        window = windows[scan.scan_id]
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
        elif point.archived_at is not None and scanned_at > point.archived_at:
            # Scans an offline device recorded before the archive still count; later ones do not.
            rejection_reason = "POINT_ARCHIVED"
        else:
            rejection_reason = state.decide(linked.ticket, window, scan.direction)
            if rejection_reason is None:
                scan_status = "ADMITTED"

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
                direction=scan.direction,
                admission_window=window,
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
            # Case B: another admission of this single-use ticket won (uq_checkin_single_use_window).
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
                state.accept(linked.ticket.id, window, scan.direction, scanned_at)
        results.append(
            ScanResult(
                scan_id=scan.scan_id,
                qr_secret=secret,
                status=scan_status,
                rejection_reason=rejection_reason,
                attendee_name=linked.user.full_name if linked else None,
                ticket_tier_name=linked.tier.name if linked else None,
                clock_skew=clock_skew,
                direction=scan.direction,
            )
        )
    return results


@router.post("/api/checkin-points/{point_id}/scans/batch")
async def ingest_scans_batch(
    body: BatchScanRequest, point: AuthorizedCheckInPointDep, session: SessionDep
) -> BatchScanResponse:
    """Queued scans (at most 200 per request, in order), idempotent by scan_id. Accepted at an archived point
    too, so scans recorded offline before the archive still arrive (later ones are rejected POINT_ARCHIVED)."""
    results = await _record_scans(session, point, body.scans)
    await session.commit()
    return BatchScanResponse(results=results)


@router.post("/api/checkin-points/{point_id}/scan", responses=error_responses(status.HTTP_403_FORBIDDEN))
async def record_single_scan(
    body: ScanSubmission, point: AuthorizedCheckInPointDep, session: SessionDep
) -> ScanResult:
    """One scan decided by the server while the scanner is online. Same rules, locks and idempotency
    as the batch, so a scanner that timed out can queue the same scan_id and get this verdict back."""
    _refuse_archived(point)
    results = await _record_scans(session, point, [body])
    await session.commit()
    return results[0]
