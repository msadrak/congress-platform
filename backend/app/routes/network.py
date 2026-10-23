import re
import uuid
from datetime import datetime
from urllib.parse import quote

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import and_, func, or_, select

from app.db import SessionDep
from app.errors import ApiError, error_responses
from app.models import Connection, EntityQR, Ticket, User
from app.rate_limit import Budget, limiter
from app.routes.auth import CurrentUserDep
from app.routes.booths import THROTTLED, require_active_ticket
from app.search import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, before_cursor, encode_cursor, text_matches
from app.sms.phone import search_digits, to_e164

router = APIRouter(prefix="/api/attendees/me/network", tags=["networking"])

# Per signed-in user, per 15 minutes: badge scans that found no usable badge, and all scans.
SCAN_FAILURES_PER_USER = Budget(20)
SCANS_PER_USER = Budget(120)


class ConnectionScanRequest(BaseModel):
    qr_secret: str
    private_notes: str = ""
    # Required: the congress the scan happens in. The scanner must hold an active ticket there, and a badge
    # from another congress is rejected before anything is written. (Typed nullable only so existing clients
    # keep compiling; null is refused with EVENT_ID_REQUIRED.)
    event_id: uuid.UUID | None


class ConnectionUpdate(BaseModel):
    private_notes: str


class PrivacyPreferenceUpdate(BaseModel):
    share_contact_with_peers: bool


class PrivacyPreferenceOut(BaseModel):
    share_contact_with_peers: bool


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    connected_user_id: uuid.UUID
    full_name: str
    # Only when the peer opted in to sharing their contact details.
    mobile: str | None = None
    organization: str
    title: str
    event_id: uuid.UUID
    private_notes: str
    created_at: datetime


class ConnectionPage(BaseModel):
    items: list[ConnectionOut]
    # Connections matching the filters, across all pages.
    total: int
    # Pass as `cursor` for the next page; null on the last page.
    next_cursor: str | None


def _connection_out(conn: Connection, peer: User) -> ConnectionOut:
    return ConnectionOut(
        id=conn.id,
        connected_user_id=peer.id,
        full_name=peer.full_name,
        mobile=peer.mobile if peer.share_contact_with_peers else None,
        organization=peer.organization,
        title=peer.title,
        event_id=conn.event_id,
        private_notes=conn.private_notes,
        created_at=conn.created_at,
    )


@router.post("/scan", responses=error_responses(400, 403, 404, 409, 429))
async def scan_peer_badge(
    body: ConnectionScanRequest,
    current_user: CurrentUserDep,
    request: Request,
    session: SessionDep,
    response: Response,
) -> ConnectionOut:
    """Adds the person whose pass QR was scanned to the caller's network in that congress (201; 200 when
    already connected). Only someone with an active ticket for the congress may scan there."""
    if body.event_id is None:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST, "EVENT_ID_REQUIRED", "Name the congress the badge is scanned in"
        )
    throttle = limiter(request)
    failures, scans = f"network:fail:user:{current_user.id}", f"network:scan:user:{current_user.id}"
    await throttle.check(
        (failures, SCAN_FAILURES_PER_USER),
        (scans, SCANS_PER_USER),
        detail=THROTTLED,
        code="CONNECTION_SCAN_RATE_LIMITED",
    )
    await throttle.hit(scans)
    await require_active_ticket(session, current_user.id, body.event_id)

    secret = body.qr_secret.strip().lower()

    # 1. Resolve EntityQR
    qr = await session.scalar(
        select(EntityQR).where(
            EntityQR.secret == secret, EntityQR.is_active.is_(True)
        )
    )
    if qr is None or qr.entity_type != "attendee_ticket":
        await throttle.fail(failures)
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "BADGE_NOT_FOUND", "Invalid or unrecognized attendee badge QR"
        )

    # 2. Resolve Ticket & Peer User (a cancelled or otherwise inactive ticket is not a badge)
    ticket = await session.get(Ticket, qr.entity_id)
    if ticket is None or ticket.status != "active":
        await throttle.fail(failures)
        raise ApiError(
            status.HTTP_404_NOT_FOUND, "BADGE_INACTIVE", "Attendee ticket not found"
        )

    peer = await session.get(User, ticket.user_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer profile not found")

    if ticket.event_id != body.event_id:
        await throttle.fail(failures)
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "BADGE_OTHER_EVENT",
            "This badge belongs to a different congress",
        )

    # 3. Reject self-connect
    if peer.id == current_user.id:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST, "BADGE_OWN", "Cannot connect with your own badge"
        )

    # 4. Check duplicate connection
    existing = await session.scalar(
        select(Connection).where(
            Connection.user_id == current_user.id,
            Connection.connected_user_id == peer.id,
            Connection.event_id == ticket.event_id,
        )
    )

    if existing is not None:
        if body.private_notes.strip():
            existing.private_notes = body.private_notes.strip()
            await session.commit()
        response.status_code = status.HTTP_200_OK
        mobile = peer.mobile if peer.share_contact_with_peers else None
        return ConnectionOut(
            id=existing.id,
            connected_user_id=peer.id,
            full_name=peer.full_name,
            mobile=mobile,
            organization=peer.organization,
            title=peer.title,
            event_id=existing.event_id,
            private_notes=existing.private_notes,
            created_at=existing.created_at,
        )

    # 5. Create new Connection
    conn = Connection(
        user_id=current_user.id,
        connected_user_id=peer.id,
        event_id=ticket.event_id,
        private_notes=body.private_notes.strip(),
    )
    session.add(conn)
    await session.commit()
    response.status_code = status.HTTP_201_CREATED

    mobile = peer.mobile if peer.share_contact_with_peers else None
    return ConnectionOut(
        id=conn.id,
        connected_user_id=peer.id,
        full_name=peer.full_name,
        mobile=mobile,
        organization=peer.organization,
        title=peer.title,
        event_id=conn.event_id,
        private_notes=conn.private_notes,
        created_at=conn.created_at,
    )


@router.get("")
async def list_my_connections(
    current_user: CurrentUserDep,
    session: SessionDep,
) -> list[ConnectionOut]:
    """Every connection, newest first. `/search` is the paginated, searchable form."""
    query = (
        select(Connection, User)
        .join(User, Connection.connected_user_id == User.id)
        .where(Connection.user_id == current_user.id)
        .order_by(Connection.created_at.desc())
    )
    res = await session.execute(query)
    rows = res.all()

    return [
        ConnectionOut(
            id=conn.id,
            connected_user_id=peer.id,
            full_name=peer.full_name,
            mobile=peer.mobile if peer.share_contact_with_peers else None,
            organization=peer.organization,
            title=peer.title,
            event_id=conn.event_id,
            private_notes=conn.private_notes,
            created_at=conn.created_at,
        )
        for conn, peer in rows
    ]


@router.get("/search", responses=error_responses(400))
async def search_my_connections(
    current_user: CurrentUserDep,
    session: SessionDep,
    q: Annotated[str, Query(max_length=200)] = "",
    event_id: Annotated[uuid.UUID | None, Query(description="Only this congress's connections")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
) -> ConnectionPage:
    """One page of the caller's connections, newest first, with the total matching the filters.

    `q` matches the peer's name, organization and title and the caller's private notes (Persian letters
    folded, `%`/`_` literal), and the peer's mobile only where the peer shares it.
    """
    filters: list[Any] = [Connection.user_id == current_user.id]
    if event_id is not None:
        filters.append(Connection.event_id == event_id)
    term = q.strip()
    if term:
        digits = search_digits(term)
        filters.append(
            or_(
                text_matches(term, User.full_name, User.organization, User.title, Connection.private_notes),
                *([and_(User.share_contact_with_peers.is_(True), User.mobile.contains(digits))] if digits else []),
            )
        )
    base = select(Connection, User).join(User, Connection.connected_user_id == User.id).where(*filters)
    total = await session.scalar(
        select(func.count(Connection.id)).join(User, Connection.connected_user_id == User.id).where(*filters)
    ) or 0
    if cursor:
        base = base.where(before_cursor(Connection.created_at, Connection.id, cursor))
    rows = (
        await session.execute(base.order_by(Connection.created_at.desc(), Connection.id.desc()).limit(limit + 1))
    ).all()
    last = rows[limit - 1][0] if len(rows) > limit else None
    return ConnectionPage(
        items=[_connection_out(conn, peer) for conn, peer in rows[:limit]],
        total=total,
        next_cursor=encode_cursor(last.created_at, last.id) if last else None,
    )


@router.get("/privacy")
async def get_privacy_preference(
    current_user: CurrentUserDep,
) -> PrivacyPreferenceOut:
    return PrivacyPreferenceOut(
        share_contact_with_peers=current_user.share_contact_with_peers
    )


@router.patch("/privacy")
async def update_privacy_preference(
    body: PrivacyPreferenceUpdate,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> PrivacyPreferenceOut:
    current_user.share_contact_with_peers = body.share_contact_with_peers
    await session.commit()
    return PrivacyPreferenceOut(
        share_contact_with_peers=current_user.share_contact_with_peers
    )


@router.patch("/{connection_id}")
async def update_connection_notes(
    connection_id: uuid.UUID,
    body: ConnectionUpdate,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> ConnectionOut:
    conn = await session.scalar(
        select(Connection).where(
            Connection.id == connection_id,
            Connection.user_id == current_user.id,
        )
    )
    if conn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")

    conn.private_notes = body.private_notes.strip()
    await session.commit()

    peer = await session.get(User, conn.connected_user_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer not found")

    mobile = peer.mobile if peer.share_contact_with_peers else None
    return ConnectionOut(
        id=conn.id,
        connected_user_id=peer.id,
        full_name=peer.full_name,
        mobile=mobile,
        organization=peer.organization,
        title=peer.title,
        event_id=conn.event_id,
        private_notes=conn.private_notes,
        created_at=conn.created_at,
    )


@router.delete(
    "/{connection_id}", status_code=status.HTTP_204_NO_CONTENT, responses=error_responses(404)
)
async def delete_connection(
    connection_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    """Removes the contact from the caller's network (the peer's own network is untouched)."""
    conn = await session.scalar(
        select(Connection).where(
            Connection.id == connection_id,
            Connection.user_id == current_user.id,
        )
    )
    if conn is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "CONNECTION_NOT_FOUND", "Connection not found")
    await session.delete(conn)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{connection_id}/vcard")
async def export_connection_vcard(
    connection_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    conn = await session.scalar(
        select(Connection).where(
            Connection.id == connection_id,
            Connection.user_id == current_user.id,
        )
    )
    if conn is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connection not found")

    peer = await session.get(User, conn.connected_user_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer profile not found")

    # vCard 3.0. Every value is escaped, so profile text can never start a property of its own.
    name = _vcard_text(peer.full_name)
    vcard_lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"FN:{name}",
        f"N:;{name};;;",
        f"ORG:{_vcard_text(peer.organization)}",
        f"TITLE:{_vcard_text(peer.title)}",
    ]
    if peer.share_contact_with_peers and peer.mobile:
        vcard_lines.append(f"TEL;TYPE=CELL:{to_e164(peer.mobile)}")
    if conn.private_notes:
        vcard_lines.append(f"NOTE:{_vcard_text(conn.private_notes)}")
    vcard_lines.append("END:VCARD")
    vcard_lines.append("")
    vcard_text = "\r\n".join(vcard_lines)

    # An ASCII filename for every client, and the name itself (Persian included) for those that read filename*.
    ascii_name = re.sub(r"[^a-zA-Z0-9]+", "-", peer.full_name.lower()).strip("-")
    display_name = " ".join(_UNSAFE_FILENAME.sub(" ", peer.full_name).split())[:100] or "contact"
    disposition = (
        f'attachment; filename="{ascii_name or "contact"}.vcf"; '
        f"filename*=UTF-8''{quote(display_name + '.vcf', safe='')}"
    )

    return Response(
        content=vcard_text,
        media_type="text/vcard; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )


# Path separators, characters Windows refuses in filenames, and control characters.
_UNSAFE_FILENAME = re.compile(r'[\x00-\x1f\x7f\\/:*?"<>|]+')


def _vcard_text(value: str) -> str:
    """A TEXT value escaped per RFC 6350 §3.4: backslash, comma and semicolon escaped, line breaks as \\n, other
    control characters dropped."""
    value = value.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;")
    value = value.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    return re.sub(r"[\x00-\x1f\x7f]", "", value)
