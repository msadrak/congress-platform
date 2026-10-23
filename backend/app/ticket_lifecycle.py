"""Ticket lifecycle: cancel, reissue, transfer and reactivate a registration.

A ticket is one person's registration for one congress. The person's account (`User`, one per mobile number)
is shared by every congress on the platform, so each ticket keeps its own copy of the attendee's name,
organization and title (`attendee_*`): that copy is what the congress shows, prints and exports, and what its
organizer edits.

Every change that makes a pass stop working goes through `ticket_invalidated`, the single place that revokes
whatever a pass can be presented as: its QR secret and its SMS short links (ADR 0015). A new pass (reissue,
transfer, registering again) gets a fresh QR secret and a fresh short link. Quota bookkeeping happens in the same transaction
as the status change, guarded by the status itself, so a ticket is never released twice. The caller commits.

SMS notices are queued in the transactional outbox (app/sms/outbox.py) and are written without `ticket_id`:
`sms_messages` allows one row per kind and ticket (the automatic confirmation), while a ticket may be
reissued or reactivated several times.
"""

import uuid
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.links import mint_ticket_link, revoke_ticket_links
from app.models import EntityQR, Event, SmsMessage, Ticket, TicketTier, User
from app.security import generate_entity_qr_secret
from app.sms.outbox import confirmation_values
from app.sms.templates import SmsKind, effective_body, render

TICKET_QR_TYPE = "attendee_ticket"
# Shown instead of the name of a person who deleted their account.
DELETED_NAME = "حذف‌شده"

CancelActor = Literal["organizer", "attendee", "account_deleted"]


class TicketStateError(Exception):
    """The ticket is not in a state that allows the change (the route answers 409)."""


def attendee_snapshot(user: User) -> dict[str, str]:
    """The registration's own copy of the attendee's details, taken from their account."""
    return {
        "attendee_full_name": user.full_name,
        "attendee_organization": user.organization,
        "attendee_title": user.title,
    }


async def ticket_invalidated(session: AsyncSession, ticket: Ticket) -> None:
    """Revoke everything the ticket's current pass can be presented as.

    Called by cancel, reissue, transfer and delete. Scanners and lead/peer scans only accept active QR rows,
    so the old pass is refused from the next scan on (offline scanners from their next manifest download);
    the SMS short links answer 410 LINK_REVOKED.
    """
    await session.execute(
        update(EntityQR)
        .where(EntityQR.entity_type == TICKET_QR_TYPE, EntityQR.entity_id == ticket.id)
        .values(is_active=False)
    )
    await revoke_ticket_links(session, ticket.id)


async def _new_pass(session: AsyncSession, ticket: Ticket, event: Event) -> tuple[str, str]:
    """Give the ticket a fresh active QR secret and a fresh short link; returns (secret, link code).

    The ticket's one QR row is rotated in place rather than replaced, because every reader joins a ticket to
    exactly one QR row; the old secret is gone, so it can never be reactivated.
    """
    secret = generate_entity_qr_secret()
    result = await session.execute(
        update(EntityQR)
        .where(EntityQR.entity_type == TICKET_QR_TYPE, EntityQR.entity_id == ticket.id)
        .values(secret=secret, is_active=True)
        .returning(EntityQR.id)
    )
    if result.first() is None:
        session.add(EntityQR(secret=secret, entity_type=TICKET_QR_TYPE, entity_id=ticket.id, is_active=True))
    link = await mint_ticket_link(session, ticket, event)
    return secret, link.code


async def queue_ticket_sms(
    session: AsyncSession,
    origin: str,
    kind: SmsKind,
    *,
    mobile: str | None,
    name: str,
    event: Event,
    ticket: Ticket,
    code: str | None,
) -> None:
    """Queue a lifecycle notice in the event's wording; a no-op without a mobile number.

    `origin` is where SMS links point (app.sms.outbox.link_origin); `code` the short link of the ticket's
    current pass, or None for a notice without a pass (a cancellation: its wording has no {link}).
    """
    if not mobile:
        return
    tier = await session.get(TicketTier, ticket.ticket_tier_id)
    values = confirmation_values(origin, name=name, event=event, tier_name=tier.name if tier else "", code=code or "")
    if code is None:
        values.pop("link")
    session.add(
        SmsMessage(
            kind=kind,
            mobile=mobile,
            body=render(await effective_body(session, kind, event.id), values),
            event_id=event.id,
            status="pending",
            send_after=datetime.now(timezone.utc),
        )
    )


async def _release_quota(session: AsyncSession, tier_id: uuid.UUID) -> None:
    await session.execute(
        update(TicketTier)
        .where(TicketTier.id == tier_id, TicketTier.reserved_count > 0)
        .values(reserved_count=TicketTier.reserved_count - 1)
    )


async def cancel_ticket(
    session: AsyncSession,
    ticket: Ticket,
    *,
    actor: CancelActor,
    reason: str | None = None,
    notify: tuple[str, Event] | None = None,
    release_quota: bool = True,
) -> None:
    """Cancel an active ticket, release its place in the tier and revoke its pass.

    The status change is a conditional UPDATE, so two concurrent cancellations release the quota once.
    `notify` is (origin, event) to queue the cancellation SMS to the holder.
    """
    now = datetime.now(timezone.utc)
    changed = await session.execute(
        update(Ticket)
        .where(Ticket.id == ticket.id, Ticket.status == "active")
        .values(status="cancelled", cancelled_at=now, cancelled_reason=reason or None, cancelled_by=actor)
        .returning(Ticket.id)
        .execution_options(synchronize_session=False)
    )
    if changed.first() is None:
        raise TicketStateError("This ticket is already cancelled.")
    await session.refresh(ticket)
    if release_quota:
        await _release_quota(session, ticket.ticket_tier_id)
    await ticket_invalidated(session, ticket)
    if notify is not None:
        origin, event = notify
        holder = await session.get(User, ticket.user_id)
        await queue_ticket_sms(
            session, origin, "ticket_cancelled",
            mobile=holder.mobile if holder else None, name=ticket.attendee_full_name, event=event, ticket=ticket,
            code=None,
        )


async def reissue_ticket(
    session: AsyncSession, ticket: Ticket, event: Event, *, notify_origin: str | None = None
) -> str:
    """Replace an active ticket's pass (a lost or leaked pass): new QR secret and short link; the old ones stop
    working. With `notify_origin` the new pass link is texted to the holder. Returns the new secret."""
    if ticket.status != "active":
        raise TicketStateError("Only an active ticket can be reissued.")
    await ticket_invalidated(session, ticket)
    secret, code = await _new_pass(session, ticket, event)
    ticket.reissued_at = datetime.now(timezone.utc)
    if notify_origin is not None:
        holder = await session.get(User, ticket.user_id)
        await queue_ticket_sms(
            session, notify_origin, "ticket_reissued",
            mobile=holder.mobile if holder else None, name=ticket.attendee_full_name, event=event, ticket=ticket,
            code=code,
        )
    return secret


async def reactivate_ticket(
    session: AsyncSession,
    ticket: Ticket,
    tier_id: uuid.UUID,
    user: User,
    event: Event,
    *,
    reserve_quota: bool = True,
) -> tuple[str, str]:
    """Turn a cancelled ticket back into an active one in `tier_id`, with a new pass; returns (secret, link code).

    One person holds at most one ticket row per congress, so registering again after a cancellation reuses
    the row. With `reserve_quota` the tier's place is taken atomically (the caller has already checked the
    tier exists and maps a failure to the right answer by raising TicketStateError("quota")).
    """
    if ticket.status != "cancelled":
        raise TicketStateError("This ticket is still active.")
    if reserve_quota:
        reserved = await session.execute(
            update(TicketTier)
            .where(
                TicketTier.id == tier_id,
                TicketTier.event_id == ticket.event_id,
                TicketTier.is_open.is_(True),
                TicketTier.reserved_count < TicketTier.quota,
            )
            .values(reserved_count=TicketTier.reserved_count + 1)
            .returning(TicketTier.id)
        )
        if reserved.first() is None:
            raise TicketStateError("quota")
    ticket.status = "active"
    ticket.ticket_tier_id = tier_id
    ticket.user_id = user.id
    ticket.cancelled_at = None
    ticket.cancelled_reason = None
    ticket.cancelled_by = None
    for column, value in attendee_snapshot(user).items():
        setattr(ticket, column, value)
    return await _new_pass(session, ticket, event)


async def transfer_ticket(
    session: AsyncSession,
    ticket: Ticket,
    target: User,
    *,
    snapshot: dict[str, str],
    origin: str,
    event: Event,
) -> Ticket:
    """Give an active ticket's place to another person; returns the ticket the new holder now has.

    The original ticket is cancelled (actor organizer, reason "transferred") rather than rebound, so its
    check-ins and exhibitor leads keep pointing at the person who actually attended; the place moves to the
    new holder in the same transaction without passing through the open quota, so nobody can take it in
    between. The new holder gets a new pass by SMS; the old holder is told their ticket was cancelled.
    """
    if ticket.status != "active":
        raise TicketStateError("Only an active ticket can be transferred.")
    if target.id == ticket.user_id:
        raise TicketStateError("The ticket already belongs to this person.")
    held = await session.scalar(
        select(Ticket).where(Ticket.event_id == ticket.event_id, Ticket.user_id == target.id).with_for_update()
    )
    if held is not None and held.status == "active":
        raise TicketStateError("This person already has a ticket for this congress.")
    tier_id = ticket.ticket_tier_id
    # The place is handed over, not released to the open quota.
    await cancel_ticket(
        session, ticket, actor="organizer", reason="transferred", notify=(origin, event), release_quota=False
    )
    if held is not None:
        _, code = await reactivate_ticket(session, held, tier_id, target, event, reserve_quota=False)
        new_ticket = held
        for column, value in snapshot.items():
            setattr(new_ticket, column, value)
    else:
        new_ticket = Ticket(
            event_id=ticket.event_id, ticket_tier_id=tier_id, user_id=target.id, status="active", **snapshot
        )
        session.add(new_ticket)
        await session.flush()
        _, code = await _new_pass(session, new_ticket, event)
    await session.flush()
    await queue_ticket_sms(
        session, origin, "ticket_confirmation",
        mobile=target.mobile, name=new_ticket.attendee_full_name, event=event, ticket=new_ticket, code=code,
    )
    return new_ticket
