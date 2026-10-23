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
* booth-staff assignments are removed, and desk-operator access and organizer memberships are revoked; the
  name they held those roles under is erased too (operator name, member name, and "invited by" where they
  invited other members), so tickets they issued show «حذف‌شده» as the issuer;
* every session of the account ends (`session_version` is incremented);
* pending SMS to them, and any the outbox has claimed but not sent yet, are not sent (`ACCOUNT_DELETED`); sent
  SMS lose their text and keep only a masked number, and sign-in codes for the number are deleted.

The last owner of an organizer cannot delete their account (409 `ACCOUNT_LAST_OWNER`): the organizer would be
left with no owner member, which the Members page never allows either (`LAST_OWNER`). They add another owner
first (or the platform revokes the organizer). Audit log entries are append-only and keep the name they were
recorded with (`actor_label`) until the audit purge removes them (app/retention.py; off by default).
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import status
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.errors import ApiError
from app.models import (
    AuditEvent,
    Booth,
    BoothBookmark,
    BoothStaff,
    CheckIn,
    CheckInPoint,
    Connection,
    DeskOperator,
    Event,
    Lead,
    Organizer,
    OrganizerMember,
    OtpChallenge,
    SmsMessage,
    Ticket,
    TicketTier,
    User,
)
from app.sms.outbox import ACCOUNT_DELETED
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


async def end_sessions(session: AsyncSession, user: User) -> None:
    """Every access token issued to the account so far stops working (caller commits)."""
    await session.execute(update(User).where(User.id == user.id).values(session_version=User.session_version + 1))


async def _refuse_last_owner(session: AsyncSession, user: User) -> None:
    """409 when the person is the only active owner member of an organizer that is still active."""
    owned = list(
        await session.scalars(
            select(Organizer)
            .join(OrganizerMember, OrganizerMember.organizer_id == Organizer.id)
            .where(
                OrganizerMember.user_id == user.id,
                OrganizerMember.role == "owner",
                OrganizerMember.revoked_at.is_(None),
                Organizer.revoked_at.is_(None),
            )
            .order_by(Organizer.name)
        )
    )
    if not owned:
        return
    # Lock the owners of those organizers, so two owners deleting their accounts at once cannot both pass.
    owners = (
        await session.execute(
            select(OrganizerMember.organizer_id, OrganizerMember.user_id)
            .where(
                OrganizerMember.organizer_id.in_([organizer.id for organizer in owned]),
                OrganizerMember.role == "owner",
                OrganizerMember.revoked_at.is_(None),
            )
            .with_for_update()
        )
    ).all()
    alone = [o.name for o in owned if not any(oid == o.id and uid != user.id for oid, uid in owners)]
    if alone:
        names = ", ".join(f"«{name}»" for name in alone)
        raise ApiError(
            status.HTTP_409_CONFLICT, "ACCOUNT_LAST_OWNER",
            f"You are the last owner of {names}. Add another owner before deleting your account.",
        )


async def delete_account(session: AsyncSession, user: User) -> None:
    """Anonymise the account as described in the module docstring (caller commits).

    Raises ApiError 409 ACCOUNT_LAST_OWNER, before changing anything, for the last owner of an organizer.
    """
    await _refuse_last_owner(session, user)
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
    await session.execute(update(DeskOperator).where(DeskOperator.user_id == user.id).values(operator_name=DELETED_NAME))
    memberships = (
        await session.execute(
            select(OrganizerMember.organizer_id, OrganizerMember.display_name).where(OrganizerMember.user_id == user.id)
        )
    ).all()
    for organizer_id, display_name in memberships:
        # "Invited by" holds the inviter's name as it was: erase it where it is this person's.
        await session.execute(
            update(OrganizerMember)
            .where(OrganizerMember.organizer_id == organizer_id, OrganizerMember.invited_by == display_name)
            .values(invited_by=DELETED_NAME)
        )
    await session.execute(
        update(OrganizerMember)
        .where(OrganizerMember.user_id == user.id, OrganizerMember.revoked_at.is_(None))
        .values(revoked_at=now, session_version=OrganizerMember.session_version + 1)
    )
    await session.execute(
        update(OrganizerMember).where(OrganizerMember.user_id == user.id).values(display_name=DELETED_NAME)
    )
    if user.mobile:
        await session.execute(delete(OtpChallenge).where(OtpChallenge.mobile == user.mobile))
        # The outbox checks a message it has already claimed (`sending`) again just before sending it.
        await session.execute(
            update(SmsMessage)
            .where(SmsMessage.mobile == user.mobile, SmsMessage.status.in_(("pending", "sending")))
            .values(status="failed", last_error=ACCOUNT_DELETED, lease_until=None)
        )
        await session.execute(
            update(SmsMessage).where(SmsMessage.mobile == user.mobile).values(mobile=mask_mobile(user.mobile), body=None)
        )

    await end_sessions(session, user)
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


class ExportBoothStaff(BaseModel):
    """The person represents this booth (exhibitor portal access)."""

    event_name: str
    booth_name: str
    created_at: datetime


class ExportDeskOperator(BaseModel):
    """The person works (or worked) a congress's front desk under this name."""

    event_name: str
    operator_name: str
    active: bool
    created_at: datetime
    revoked_at: datetime | None


class ExportOrganizerMembership(BaseModel):
    """The person signs in (or signed in) to an organizer's console with this role."""

    organizer_name: str
    role: str
    display_name: str
    invited_by: str
    active: bool
    created_at: datetime
    revoked_at: datetime | None


class ExportAuditEvent(BaseModel):
    """An audit log entry the person made (`actor`) or that concerns their membership, desk access, ticket or
    account (`subject`). Request details (IP, summary) are left out: they may describe other people."""

    at: datetime
    action: str
    relation: Literal["actor", "subject"]
    actor_type: str
    organizer_name: str | None
    event_name: str | None
    entity_type: str | None


class AccountExport(BaseModel):
    exported_at: datetime
    profile: ExportProfile
    tickets: list[ExportTicket]
    connections: list[ExportConnection]
    booth_bookmarks: list[ExportBookmark]
    exhibitor_leads: list[ExportLead]
    sms_messages: list[ExportSms]
    booth_staff: list[ExportBoothStaff]
    desk_operators: list[ExportDeskOperator]
    organizer_memberships: list[ExportOrganizerMembership]
    audit_events: list[ExportAuditEvent]


async def _export_roles(
    session: AsyncSession, user: User, ticket_ids: list[uuid.UUID]
) -> tuple[list[ExportBoothStaff], list[ExportDeskOperator], list[ExportOrganizerMembership], list[ExportAuditEvent]]:
    """Booth-staff assignments, desk access, organizer memberships and the audit entries about them."""
    staff = (
        await session.execute(
            select(BoothStaff.created_at, Booth.name, Event.name)
            .join(Booth, BoothStaff.booth_id == Booth.id)
            .join(Event, Booth.event_id == Event.id)
            .where(BoothStaff.user_id == user.id)
            .order_by(BoothStaff.created_at)
        )
    ).all()
    operators = (
        await session.execute(
            select(DeskOperator, Event.name)
            .join(Event, DeskOperator.event_id == Event.id)
            .where(DeskOperator.user_id == user.id)
            .order_by(DeskOperator.created_at)
        )
    ).all()
    members = (
        await session.execute(
            select(OrganizerMember, Organizer.name)
            .join(Organizer, OrganizerMember.organizer_id == Organizer.id)
            .where(OrganizerMember.user_id == user.id)
            .order_by(OrganizerMember.created_at)
        )
    ).all()
    operator_ids = [str(op.id) for op, _ in operators]
    member_ids = [str(m.id) for m, _ in members]
    as_actor = or_(
        and_(AuditEvent.actor_type == "desk_operator", AuditEvent.actor_id.in_(operator_ids)),
        and_(AuditEvent.actor_type == "organizer_member", AuditEvent.actor_id.in_(member_ids)),
        and_(AuditEvent.actor_type == "booth_staff", AuditEvent.actor_id == str(user.id)),
    )
    subjects = [*operator_ids, *member_ids, *(str(t) for t in ticket_ids), str(user.id)]
    audit_event = aliased(Event)
    audit = (
        await session.execute(
            select(AuditEvent, as_actor, Organizer.name, audit_event.name)
            .outerjoin(Organizer, AuditEvent.organizer_id == Organizer.id)
            .outerjoin(audit_event, AuditEvent.event_id == audit_event.id)
            .where(or_(as_actor, AuditEvent.entity_id.in_(subjects)))
            .order_by(AuditEvent.at)
        )
    ).all()
    return (
        [ExportBoothStaff(event_name=e, booth_name=b, created_at=c) for c, b, e in staff],
        [
            ExportDeskOperator(
                event_name=event_name, operator_name=op.operator_name, active=not op.is_revoked,
                created_at=op.created_at, revoked_at=op.revoked_at,
            )
            for op, event_name in operators
        ],
        [
            ExportOrganizerMembership(
                organizer_name=organizer_name, role=m.role, display_name=m.display_name, invited_by=m.invited_by,
                active=m.revoked_at is None, created_at=m.created_at, revoked_at=m.revoked_at,
            )
            for m, organizer_name in members
        ],
        [
            ExportAuditEvent(
                at=entry.at, action=entry.action, relation="actor" if acted else "subject",
                actor_type=entry.actor_type, organizer_name=organizer_name, event_name=event_name,
                entity_type=entry.entity_type,
            )
            for entry, acted, organizer_name, event_name in audit
        ],
    )


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
    booth_staff, desk_operators, organizer_memberships, audit_events = await _export_roles(session, user, ticket_ids)
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
        booth_staff=booth_staff,
        desk_operators=desk_operators,
        organizer_memberships=organizer_memberships,
        audit_events=audit_events,
    )
