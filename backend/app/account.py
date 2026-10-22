"""An attendee's own account: profile changes, a copy of their data, and account deletion.

Deletion anonymises rather than removes the `users` row, because tickets, check-ins and exhibitor leads
reference it and a congress's attendance statistics must still add up. What identifies the person is erased:

* name → «حذف‌شده», organization, title and mobile cleared (the number can sign up again as a new account);
  every registration's copy of those details is erased the same way;
* tickets for congresses that have not ended are cancelled (their places return to the tiers, the passes stop
  working); past tickets and their check-ins stay, anonymised, for statistics;
* their own address book (connections they made, with their private notes) and booth bookmarks are deleted;
  connections other attendees made to them stay, because the notes are the other attendee's data, and now
  show only the anonymised profile;
* exhibitor leads about them stay with the exhibitor (rating and notes are the exhibitor's data) but no longer
  carry a name, organization or mobile;
* booth-staff assignments are removed and desk-operator access is revoked;
* pending SMS to them are not sent, sent SMS lose their text and keep only a masked number, and sign-in codes
  for the number are deleted.
"""

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import (
    Booth,
    BoothBookmark,
    BoothStaff,
    CheckIn,
    CheckInPoint,
    Connection,
    DeskOperator,
    Event,
    Lead,
    OtpChallenge,
    SmsMessage,
    Ticket,
    TicketTier,
    User,
)
from app.sms.phone import mask_mobile
from app.ticket_lifecycle import DELETED_NAME, attendee_snapshot, cancel_ticket


async def refresh_upcoming_snapshots(session: AsyncSession, user: User) -> int:
    """Copy the account's details onto its active registrations for congresses that have not ended.

    Registrations of past congresses keep the details they were held under. Returns how many were updated.
    """
    upcoming = select(Event.id).where(Event.ends_at > func.now())
    result = await session.execute(
        update(Ticket)
        .where(Ticket.user_id == user.id, Ticket.status == "active", Ticket.event_id.in_(upcoming))
        .values(**attendee_snapshot(user))
        .execution_options(synchronize_session=False)
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def delete_account(session: AsyncSession, user: User) -> None:
    """Anonymise the account as described in the module docstring (caller commits)."""
    now = datetime.now(timezone.utc)
    rows = await session.execute(
        select(Ticket, Event).join(Event, Ticket.event_id == Event.id).where(Ticket.user_id == user.id).with_for_update(of=Ticket)
    )
    for ticket, event in rows.all():
        if ticket.status == "active" and event.ends_at > now:
            await cancel_ticket(session, ticket, actor="account_deleted")
        ticket.attendee_full_name = DELETED_NAME
        ticket.attendee_organization = ""
        ticket.attendee_title = ""

    await session.execute(delete(Connection).where(Connection.user_id == user.id))
    await session.execute(delete(BoothBookmark).where(BoothBookmark.user_id == user.id))
    await session.execute(delete(BoothStaff).where(BoothStaff.user_id == user.id))
    await session.execute(
        update(DeskOperator)
        .where(DeskOperator.user_id == user.id, DeskOperator.is_revoked.is_(False))
        .values(is_revoked=True, revoked_at=now, session_version=DeskOperator.session_version + 1)
    )
    if user.mobile:
        await session.execute(delete(OtpChallenge).where(OtpChallenge.mobile == user.mobile))
        await session.execute(
            update(SmsMessage)
            .where(SmsMessage.mobile == user.mobile, SmsMessage.status == "pending")
            .values(status="failed", last_error="account deleted")
        )
        await session.execute(
            update(SmsMessage).where(SmsMessage.mobile == user.mobile).values(mobile=mask_mobile(user.mobile), body=None)
        )

    user.full_name = DELETED_NAME
    user.organization = ""
    user.title = ""
    user.mobile = None
    user.share_contact_with_peers = False
    user.share_contact_with_exhibitors = False
    user.deleted_at = now


class ExportProfile(BaseModel):
    id: uuid.UUID
    mobile: str | None
    full_name: str
    organization: str
    title: str
    share_contact_with_peers: bool
    share_contact_with_exhibitors: bool
    created_at: datetime


class ExportScan(BaseModel):
    checkin_point: str
    status: str
    scanned_at: datetime


class ExportTicket(BaseModel):
    ticket_id: uuid.UUID
    event_name: str
    event_starts_at: datetime
    event_ends_at: datetime
    ticket_tier: str
    status: str
    attendee_full_name: str
    attendee_organization: str
    attendee_title: str
    created_at: datetime
    cancelled_at: datetime | None
    cancelled_reason: str | None
    scans: list[ExportScan]


class ExportConnection(BaseModel):
    event_name: str
    full_name: str
    organization: str
    title: str
    private_notes: str
    created_at: datetime


class ExportBookmark(BaseModel):
    event_name: str
    booth_name: str
    created_at: datetime


class ExportLead(BaseModel):
    """An exhibitor scanned this person's pass. The exhibitor's rating and notes are the exhibitor's data."""

    event_name: str
    booth_name: str
    captured_at: datetime


class ExportSms(BaseModel):
    kind: str
    status: str
    body: str | None
    created_at: datetime


class AccountExport(BaseModel):
    exported_at: datetime
    profile: ExportProfile
    tickets: list[ExportTicket]
    connections: list[ExportConnection]
    booth_bookmarks: list[ExportBookmark]
    exhibitor_leads: list[ExportLead]
    sms_messages: list[ExportSms]


async def export_account(session: AsyncSession, user: User) -> AccountExport:
    """Everything the platform holds about this person, in one JSON document."""
    tickets = (
        await session.execute(
            select(Ticket, Event, TicketTier.name)
            .join(Event, Ticket.event_id == Event.id)
            .join(TicketTier, Ticket.ticket_tier_id == TicketTier.id)
            .where(Ticket.user_id == user.id)
            .order_by(Ticket.created_at)
        )
    ).all()
    ticket_ids = [ticket.id for ticket, _, _ in tickets]
    scans: dict[uuid.UUID, list[ExportScan]] = {tid: [] for tid in ticket_ids}
    for scan, point_name in (
        await session.execute(
            select(CheckIn, CheckInPoint.name)
            .join(CheckInPoint, CheckIn.checkin_point_id == CheckInPoint.id)
            .where(CheckIn.ticket_id.in_(ticket_ids))
            .order_by(CheckIn.scanned_at)
        )
    ).all():
        if scan.ticket_id is not None:
            scans[scan.ticket_id].append(
                ExportScan(checkin_point=point_name, status=scan.status, scanned_at=scan.scanned_at)
            )
    peer = aliased(User)
    connections = (
        await session.execute(
            select(Connection, peer, Event.name)
            .join(peer, Connection.connected_user_id == peer.id)
            .join(Event, Connection.event_id == Event.id)
            .where(Connection.user_id == user.id)
            .order_by(Connection.created_at)
        )
    ).all()
    bookmarks = (
        await session.execute(
            select(BoothBookmark.created_at, Booth.name, Event.name)
            .join(Booth, BoothBookmark.booth_id == Booth.id)
            .join(Event, Booth.event_id == Event.id)
            .where(BoothBookmark.user_id == user.id)
            .order_by(BoothBookmark.created_at)
        )
    ).all()
    leads = (
        await session.execute(
            select(Lead.created_at, Booth.name, Event.name)
            .join(Booth, Lead.booth_id == Booth.id)
            .join(Event, Booth.event_id == Event.id)
            .where(Lead.ticket_id.in_(ticket_ids))
            .order_by(Lead.created_at)
        )
    ).all()
    messages = (
        list(
            await session.scalars(
                select(SmsMessage).where(SmsMessage.mobile == user.mobile).order_by(SmsMessage.created_at)
            )
        )
        if user.mobile
        else []
    )
    return AccountExport(
        exported_at=datetime.now(timezone.utc),
        profile=ExportProfile(
            id=user.id, mobile=user.mobile, full_name=user.full_name, organization=user.organization,
            title=user.title, share_contact_with_peers=user.share_contact_with_peers,
            share_contact_with_exhibitors=user.share_contact_with_exhibitors, created_at=user.created_at,
        ),
        tickets=[
            ExportTicket(
                ticket_id=ticket.id, event_name=event.name, event_starts_at=event.starts_at,
                event_ends_at=event.ends_at, ticket_tier=tier_name, status=ticket.status,
                attendee_full_name=ticket.attendee_full_name, attendee_organization=ticket.attendee_organization,
                attendee_title=ticket.attendee_title, created_at=ticket.created_at,
                cancelled_at=ticket.cancelled_at, cancelled_reason=ticket.cancelled_reason, scans=scans[ticket.id],
            )
            for ticket, event, tier_name in tickets
        ],
        connections=[
            ExportConnection(
                event_name=event_name, full_name=other.full_name, organization=other.organization,
                title=other.title, private_notes=connection.private_notes, created_at=connection.created_at,
            )
            for connection, other, event_name in connections
        ],
        booth_bookmarks=[
            ExportBookmark(event_name=event_name, booth_name=booth_name, created_at=created_at)
            for created_at, booth_name, event_name in bookmarks
        ],
        exhibitor_leads=[
            ExportLead(event_name=event_name, booth_name=booth_name, captured_at=created_at)
            for created_at, booth_name, event_name in leads
        ],
        sms_messages=[
            ExportSms(kind=m.kind, status=m.status, body=None if m.kind == "otp" else m.body, created_at=m.created_at)
            for m in messages
        ],
    )
