"""Background delivery of queued SMS (transactional outbox).

A message is queued in the same transaction as the business change it reports (a ticket), so it is sent if
and only if that change committed, and the change never waits for or fails because of the SMS provider.
One asyncio task per API process polls due rows (FOR UPDATE SKIP LOCKED and the claim keep several processes
from sending the same message).

Retries: a definite "not accepted" that is retryable (network, 429, 5xx) is tried again with exponential
backoff; a timeout after sending is marked `unknown` and never resent, so nobody receives a message twice. A
message the gateway could not even attempt (not configured, a platform cap, busy) waits without using an attempt.
A pass claims its messages (`sending`, `lease_until`) before sending; if it dies before recording an outcome, the
next pass marks them `unknown` once the lease has run out. The organizer can retry a failed message, and retry
or resolve an unknown one, by hand (app/routes/sms.py).

Just before sending, each claimed message is checked once more, because things change between queueing and
sending: it is not sent, and is marked `failed` with the reason in `last_error`, when its recipient deleted the
account (`ACCOUNT_DELETED`, which account deletion also writes on messages not yet claimed), when the ticket it
confirms is no longer active (`TICKET_CANCELLED`), or when a pass link it carries was revoked meanwhile
(`PASS_REVOKED`: the ticket was cancelled, reissued or transferred since). A cancellation notice is always sent.
"""

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.links import CODE_ALPHABET, CODE_LENGTH
from app.models import Booth, Event, ShortLink, SmsMessage, Ticket, TicketTier, User
from app.sms.phone import mask_mobile
from app.sms.gateway import DEFERRED_ERRORS
from app.sms.provider import SmsProvider, SmsResult
from app.sms.templates import effective_body, render

logger = logging.getLogger("congress.sms")

MAX_ATTEMPTS = 6
BATCH_SIZE = 20
# Longer than a whole batch can take (BATCH_SIZE sends, each bounded by the provider timeout and a free slot).
LEASE = timedelta(minutes=10)
LEASE_EXPIRED = "LEASE_EXPIRED"
# Why a claimed message was not sent after all (`last_error` of a `failed` message; see the module docstring).
ACCOUNT_DELETED = "ACCOUNT_DELETED"
TICKET_CANCELLED = "TICKET_CANCELLED"
PASS_REVOKED = "PASS_REVOKED"
NOT_SENT_REASONS = frozenset({ACCOUNT_DELETED, TICKET_CANCELLED, PASS_REVOKED})
# Notices that stay true after the pass stopped working, so they are sent regardless.
_PASS_INDEPENDENT_KINDS = frozenset({"ticket_cancelled"})
_PASS_LINK = re.compile(rf"/t/([{CODE_ALPHABET}]{{{CODE_LENGTH}}})(?![0-9a-z])")


def backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(60 * 2 ** (attempts - 1), 3600))


def link_origin(settings: Settings, origin: str) -> str:
    """Where SMS links point: the short-link origin, else the public origin, else this request's origin."""
    return settings.short_link_origin or settings.public_origin or origin


def pass_link(origin: str, code: str) -> str:
    """The one-tap pass link (ADR 0015): short on purpose, so the SMS stays as few parts as the wording allows."""
    return f"{origin.rstrip('/')}/t/{code}"


def confirmation_values(origin: str, *, name: str, event: Event, tier_name: str, code: str) -> dict[str, str]:
    """The placeholder values of a ticket confirmation (also used for previews and test sends)."""
    return {
        "name": name,
        "event": event.name,
        "tier": tier_name,
        "location": event.location,
        "link": pass_link(origin, code),
    }


async def ticket_confirmation_text(
    session: AsyncSession, settings: Settings, origin: str, *, user: User, event: Event, ticket: Ticket, code: str
) -> str:
    """The ticket confirmation for this attendee, in the event's current wording, linking to short link `code`."""
    tier = await session.get(TicketTier, ticket.ticket_tier_id)
    values = confirmation_values(
        link_origin(settings, origin), name=user.full_name, event=event, tier_name=tier.name if tier else "", code=code
    )
    return render(await effective_body(session, "ticket_confirmation", event.id), values)


async def queue_ticket_confirmation(
    session: AsyncSession, settings: Settings, origin: str, *, user: User, event: Event, ticket: Ticket, code: str
) -> None:
    """Queue "your ticket is confirmed" in the event's wording; a no-op for an attendee without a mobile.

    The text is rendered now, so it says what the template said when the ticket was issued.
    """
    if not user.mobile:
        return
    session.add(
        SmsMessage(
            kind="ticket_confirmation",
            mobile=user.mobile,
            body=await ticket_confirmation_text(
                session, settings, origin, user=user, event=event, ticket=ticket, code=code
            ),
            event_id=event.id,
            ticket_id=ticket.id,
            status="pending",
            send_after=datetime.now(timezone.utc),
        )
    )


async def queue_staff_invite(
    session: AsyncSession, settings: Settings, origin: str, *, user: User, booth: Booth, event: Event
) -> None:
    """Queue "you represent this booth" with a link to the booth portal (`/booth/<id>`, which asks for the
    SMS sign-in code); a no-op for an account without a mobile. Booth portal pages live on the public origin,
    not on the short-link domain."""
    if not user.mobile:
        return
    portal = f"{(settings.public_origin or origin).rstrip('/')}/booth/{booth.id}"
    values = {"name": user.full_name, "booth": booth.name, "event": event.name, "link": portal}
    session.add(
        SmsMessage(
            kind="staff_invite",
            mobile=user.mobile,
            body=render(await effective_body(session, "staff_invite", None), values),
            event_id=event.id,
            status="pending",
            send_after=datetime.now(timezone.utc),
        )
    )


def reception_url(settings: Settings, origin: str, event_id: object) -> str:
    """The congress's reception station (`/reception/<event id>`), on the public origin."""
    return f"{(settings.public_origin or origin).rstrip('/')}/reception/{event_id}"


async def queue_operator_invite(
    session: AsyncSession, settings: Settings, origin: str, *, mobile: str | None, name: str, event: Event
) -> None:
    """Queue "you run this congress's reception desk" with a link to the reception station, where the operator
    signs in with an SMS code to this number; a no-op without a mobile. Platform-wide wording (`operator_invite`)."""
    if not mobile:
        return
    values = {"name": name, "event": event.name, "link": reception_url(settings, origin, event.id)}
    session.add(
        SmsMessage(
            kind="operator_invite",
            mobile=mobile,
            body=render(await effective_body(session, "operator_invite", None), values),
            event_id=event.id,
            status="pending",
            send_after=datetime.now(timezone.utc),
        )
    )


def unconfigured_delay(waited: timedelta) -> timedelta:
    """Backoff for a message that could not be attempted at all (gateway unconfigured, cap reached, busy): about
    half the time it has waited so far, between 30 s and 15 min, without using up an attempt."""
    return min(max(waited / 2, timedelta(seconds=30)), timedelta(minutes=15))


async def expire_leases(session: AsyncSession, now: datetime) -> int:
    """A claimed message whose pass died mid-send may or may not have gone out: `unknown`, never resent."""
    result = await session.execute(
        update(SmsMessage)
        .where(SmsMessage.status == "sending", SmsMessage.lease_until < now)
        .values(status="unknown", last_error=LEASE_EXPIRED, lease_until=None)
    )
    expired: int = result.rowcount  # type: ignore[attr-defined]
    if expired:
        logger.warning("%d SMS left unknown: their outbox pass stopped before recording the outcome", expired)
    return expired


async def _claim(sessionmaker: async_sessionmaker[AsyncSession], now: datetime) -> list[SmsMessage]:
    async with sessionmaker() as session:
        await expire_leases(session, now)
        due = (
            select(SmsMessage.id)
            .where(SmsMessage.status == "pending", SmsMessage.send_after <= now)
            .order_by(SmsMessage.send_after)
            .limit(BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
        claimed = list(
            await session.scalars(
                update(SmsMessage)
                .where(SmsMessage.id.in_(due.scalar_subquery()))
                .values(status="sending", lease_until=datetime.now(timezone.utc) + LEASE)
                .returning(SmsMessage)
            )
        )
        await session.commit()
    return sorted(claimed, key=lambda m: m.send_after)


async def _record(
    sessionmaker: async_sessionmaker[AsyncSession], message: SmsMessage, result: SmsResult, now: datetime
) -> None:
    values: dict[str, object] = {"lease_until": None, "last_error": result.error}
    if result.ok:
        values |= {"status": "sent", "sent_at": datetime.now(timezone.utc), "provider_message_id": result.message_id,
                   "attempts": message.attempts + 1}
    elif result.unknown:
        values |= {"status": "unknown", "attempts": message.attempts + 1}
    elif result.error in DEFERRED_ERRORS:
        # Nothing was attempted: wait for the gateway (configuration, cap, a free slot) without using an attempt.
        values |= {"status": "pending", "send_after": now + unconfigured_delay(now - message.created_at)}
    elif result.retryable and message.attempts + 1 < MAX_ATTEMPTS:
        values |= {"status": "pending", "send_after": now + backoff(message.attempts + 1),
                   "attempts": message.attempts + 1}
    else:
        values |= {"status": "failed", "attempts": message.attempts + 1}
        logger.warning("SMS %s to %s failed permanently: %s", message.kind, mask_mobile(message.mobile), result.error)
    async with sessionmaker() as session:
        # Only while still ours: a lease that ran out meanwhile has already made it `unknown`.
        await session.execute(
            update(SmsMessage).where(SmsMessage.id == message.id, SmsMessage.status == "sending").values(**values)
        )
        await session.commit()


async def _not_sent_reason(sessionmaker: async_sessionmaker[AsyncSession], message: SmsMessage) -> str | None:
    """None when the claimed message should go out now; otherwise why not (see the module docstring)."""
    async with sessionmaker() as session:
        current = (
            await session.execute(select(SmsMessage.status, SmsMessage.last_error).where(SmsMessage.id == message.id))
        ).first()
        if current is None or current.status != "sending":
            # No longer ours: account deletion marked it failed meanwhile (or the lease ran out).
            return (current.last_error if current is not None else None) or LEASE_EXPIRED
        if message.kind in _PASS_INDEPENDENT_KINDS:
            return None
        if message.ticket_id is not None:
            holder = (
                await session.execute(
                    select(Ticket.status, User.deleted_at)
                    .join(User, Ticket.user_id == User.id)
                    .where(Ticket.id == message.ticket_id)
                )
            ).first()
            if holder is not None and holder.deleted_at is not None:
                return ACCOUNT_DELETED
            if holder is None or holder.status != "active":
                return TICKET_CANCELLED
        codes = _PASS_LINK.findall(message.body or "")
        if codes:
            revoked = await session.scalar(
                select(ShortLink.code).where(ShortLink.code.in_(codes), ShortLink.revoked_at.is_not(None)).limit(1)
            )
            if revoked is not None:
                return PASS_REVOKED
    return None


async def _record_not_sent(sessionmaker: async_sessionmaker[AsyncSession], message: SmsMessage, reason: str) -> None:
    async with sessionmaker() as session:
        await session.execute(
            update(SmsMessage)
            .where(SmsMessage.id == message.id, SmsMessage.status == "sending")
            .values(status="failed", last_error=reason, lease_until=None)
        )
        await session.commit()
    logger.info("SMS %s to %s not sent: %s", message.kind, mask_mobile(message.mobile), reason)


async def deliver_due(
    sessionmaker: async_sessionmaker[AsyncSession], provider: SmsProvider, *, now: datetime | None = None
) -> int:
    """Send one batch of due messages; returns how many were claimed.

    Claimed in one short transaction (`sending` with a lease), checked once more just before sending, sent with
    no transaction open, and each outcome recorded in its own short transaction, so no row lock or connection is
    held while the provider answers and a failure after sending never repeats the messages already sent.
    """
    now = now or datetime.now(timezone.utc)
    messages = await _claim(sessionmaker, now)
    for message in messages:
        reason = await _not_sent_reason(sessionmaker, message)
        if reason is not None:
            await _record_not_sent(sessionmaker, message, reason)
            continue
        result = await provider.send_text(message.mobile, message.body or "", kind=message.kind)
        await _record(sessionmaker, message, result, now)
    return len(messages)


async def run_outbox(
    sessionmaker: async_sessionmaker[AsyncSession], provider: SmsProvider, poll_seconds: float
) -> None:
    while True:
        try:
            await deliver_due(sessionmaker, provider)
        except asyncio.CancelledError:
            raise
        except Exception:  # keep delivering after a transient database or provider error
            logger.exception("SMS outbox pass failed")
        await asyncio.sleep(poll_seconds)
