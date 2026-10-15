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
from app.models import Event, SmsMessage, Ticket, User
from app.sms.phone import mask_mobile
from app.sms.provider import SmsProvider

logger = logging.getLogger("congress.sms")

MAX_ATTEMPTS = 6
BATCH_SIZE = 20
# sms.ir limits template parameter values; long event names are shortened rather than rejected.
MAX_PARAM_LENGTH = 50


def backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(60 * 2 ** (attempts - 1), 3600))


def _short(value: str) -> str:
    value = " ".join(value.split())
    return value if len(value) <= MAX_PARAM_LENGTH else value[: MAX_PARAM_LENGTH - 1] + "…"


def pass_link(origin: str, event: Event) -> str:
    return f"{origin.rstrip('/')}/c/{event.slug}/my-ticket"


def queue_ticket_confirmation(
    session: AsyncSession, settings: Settings, origin: str, *, user: User, event: Event, ticket: Ticket
) -> None:
    """Queue "your ticket is confirmed" with the pass link; a no-op for an attendee without a mobile."""
    if not user.mobile:
        return
    session.add(
        SmsMessage(
            kind="ticket_confirmation",
            mobile=user.mobile,
            template_id=settings.smsir_ticket_template_id or 0,
            params={
                "NAME": _short(user.full_name),
                "EVENT": _short(event.name),
                "LINK": pass_link(settings.public_origin or origin, event),
            },
            ticket_id=ticket.id,
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
            result = await provider.send_template(message.mobile, message.template_id, message.params or {})
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
