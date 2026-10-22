import re
import uuid
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.db import SessionDep
from app.models import Connection, EntityQR, Ticket, User
from app.routes.auth import CurrentUserDep
from app.sms.phone import to_e164

router = APIRouter(prefix="/api/attendees/me/network", tags=["networking"])


class ConnectionScanRequest(BaseModel):
    qr_secret: str
    private_notes: str = ""
    # Event-scoped callers (the congress portal) name the congress they are scanning in; a badge
    # from another congress is then rejected before anything is written. Omitted: legacy
    # all-congress behaviour, the connection is stored in the badge's own congress.
    event_id: uuid.UUID | None = None


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

@router.post("/scan")
async def scan_peer_badge(
    body: ConnectionScanRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    response: Response,
) -> ConnectionOut:
    secret = body.qr_secret.strip().lower()

    # 1. Resolve EntityQR
    qr = await session.scalar(
        select(EntityQR).where(
            EntityQR.secret == secret, EntityQR.is_active.is_(True)
        )
    )
    if qr is None or qr.entity_type != "attendee_ticket":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Invalid or unrecognized attendee badge QR"
        )

    # 2. Resolve Ticket & Peer User (a cancelled or otherwise inactive ticket is not a badge)
    ticket = await session.get(Ticket, qr.entity_id)
    if ticket is None or ticket.status != "active":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Attendee ticket not found"
        )

    peer = await session.get(User, ticket.user_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer profile not found")

    if body.event_id is not None and ticket.event_id != body.event_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This badge belongs to a different congress",
        )

    # 3. Reject self-connect
    if peer.id == current_user.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot connect with your own badge"
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
