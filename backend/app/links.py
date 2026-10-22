"""SMS short links (ADR 0015): `/t/{code}` opens one ticket's pass, read-only, without a sign-in code.

A code is a bearer credential for viewing the pass, exactly like the pass QR (a forwarded SMS is a copy of
the pass, as a screenshot of the QR is). It is minted in the same transaction as its ticket, expires 30 days
after the event ends, and is revoked with the ticket. 10 characters from a 31-letter alphabet without
look-alikes (no 0/o, 1/l/i) carry ~49 bits; guessing is throttled per IP (app/routes/links.py).
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, ShortLink, Ticket

CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
CODE_LENGTH = 10
LINK_LIFETIME_AFTER_EVENT = timedelta(days=30)
# For previews and test sends. The "l" is outside the alphabet, so the sample can never open a real pass.
SAMPLE_CODE = "sample2345"


def generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw: str) -> str | None:
    """The code as stored, or None when the input cannot be a code (so it is never looked up)."""
    code = raw.strip().lower()
    if len(code) != CODE_LENGTH or not set(code) <= set(CODE_ALPHABET):
        return None
    return code


async def mint_ticket_link(session: AsyncSession, ticket: Ticket, event: Event) -> ShortLink:
    """A new link for this ticket, added to the caller's transaction (the caller commits)."""
    code = generate_code()
    # ~49 bits make a collision vanishingly rare; checking keeps it from ever failing a reservation.
    while await session.get(ShortLink, code) is not None:
        code = generate_code()
    link = ShortLink(
        code=code,
        ticket_id=ticket.id,
        event_id=event.id,
        expires_at=event.ends_at + LINK_LIFETIME_AFTER_EVENT,
        open_count=0,
    )
    session.add(link)
    return link


async def active_ticket_link(session: AsyncSession, ticket: Ticket, event: Event) -> ShortLink:
    """The ticket's newest usable link, or a freshly minted one (a desk resend; a ticket from before 0019)."""
    link = await session.scalar(
        select(ShortLink)
        .where(
            ShortLink.ticket_id == ticket.id,
            ShortLink.revoked_at.is_(None),
            ShortLink.expires_at > datetime.now(timezone.utc),
        )
        .order_by(ShortLink.created_at.desc())
        .limit(1)
    )
    return link if link is not None else await mint_ticket_link(session, ticket, event)


async def revoke_ticket_links(session: AsyncSession, ticket_id: uuid.UUID) -> int:
    """Revoke every live link of a ticket (cancel or reissue); returns how many were revoked."""
    result = await session.execute(
        update(ShortLink)
        .where(ShortLink.ticket_id == ticket_id, ShortLink.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
    count: int = getattr(result, "rowcount", 0)
    return count
