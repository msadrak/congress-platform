"""Background delivery of queued SMS (transactional outbox).

A message is queued in the same transaction as the business change it reports (a ticket), so it is sent if
and only if that change committed, and the change never waits for or fails because of the SMS provider.
One asyncio task per API process polls due rows (the deployment runs a single process; FOR UPDATE SKIP
LOCKED keeps it correct even if that ever changes).

Retries: a definite "not accepted" that is retryable (network, 429, 5xx) is tried again with exponential
backoff; a timeout after sending is marked `unknown` and never resent, so nobody receives a message twice.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.models import Booth, Event, SmsMessage, Ticket, TicketTier, User
from app.sms.phone import mask_mobile
from app.sms.provider import SmsProvider
from app.sms.templates import effective_body, render

logger = logging.getLogger("congress.sms")

MAX_ATTEMPTS = 6
BATCH_SIZE = 20


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


async def deliver_due(
    sessionmaker: async_sessionmaker[AsyncSession], provider: SmsProvider, *, now: datetime | None = None
) -> int:
    """Send one batch of due messages; returns how many were attempted."""
    now = now or datetime.now(timezone.utc)
    async with sessionmaker() as session:
        messages = list(
            await session.scalars(
                select(SmsMessage)
                .where(SmsMessage.status == "pending", SmsMessage.send_after <= now)
                .order_by(SmsMessage.send_after)
                .limit(BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        )
        for message in messages:
            result = await provider.send_text(message.mobile, message.body or "", kind=message.kind)
            message.attempts += 1
            if result.ok:
                message.status = "sent"
                message.sent_at = datetime.now(timezone.utc)
                message.provider_message_id = result.message_id
                message.last_error = None
            elif result.unknown:
                message.status = "unknown"
                message.last_error = result.error
            elif result.retryable and message.attempts < MAX_ATTEMPTS:
                message.send_after = now + backoff(message.attempts)
                message.last_error = result.error
            else:
                message.status = "failed"
                message.last_error = result.error
                logger.warning(
                    "SMS %s to %s failed permanently: %s", message.kind, mask_mobile(message.mobile), result.error
                )
        await session.commit()
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
