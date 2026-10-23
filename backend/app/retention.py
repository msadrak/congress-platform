"""Data retention: personal data the platform no longer needs is removed on a schedule.

* Sign-in codes (`otp_challenges`) that were used or have expired are deleted after `otp_retention_hours`
  (default 24 h): only an HMAC of the code is stored, but the row still ties a mobile number to a time.
* The text of sent SMS (`sms_messages.body`) is cleared after `sms_body_retention_days` (default 30): the
  delivery log keeps who, when and whether it arrived, not what it said. Pending messages are never touched.

One asyncio task per API process (like the SMS outbox); both statements are idempotent, so overlapping runs
are harmless.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.models import OtpChallenge, SmsMessage

logger = logging.getLogger("congress.retention")


@dataclass(frozen=True)
class PurgeResult:
    otp_challenges_deleted: int
    sms_bodies_cleared: int


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


async def purge_expired(session: AsyncSession, settings: Settings, *, now: datetime | None = None) -> PurgeResult:
    """Apply the retention rules once (caller commits)."""
    now = now or datetime.now(timezone.utc)
    otp_cutoff = now - timedelta(hours=settings.otp_retention_hours)
    otps = await session.execute(
        delete(OtpChallenge).where(
            OtpChallenge.created_at < otp_cutoff,
            or_(OtpChallenge.consumed_at.is_not(None), OtpChallenge.expires_at < now),
        )
    )
    bodies = await session.execute(
        update(SmsMessage)
        .where(
            SmsMessage.created_at < now - timedelta(days=settings.sms_body_retention_days),
            SmsMessage.body.is_not(None),
            SmsMessage.status.not_in(("pending", "sending")),  # still to be sent
        )
        .values(body=None)
    )
    return PurgeResult(otp_challenges_deleted=_rowcount(otps), sms_bodies_cleared=_rowcount(bodies))


async def run_retention(sessionmaker: async_sessionmaker[AsyncSession], settings: Settings) -> None:
    while True:
        await asyncio.sleep(settings.retention_interval_seconds)
        try:
            async with sessionmaker() as session:
                result = await purge_expired(session, settings)
                await session.commit()
            if result.otp_challenges_deleted or result.sms_bodies_cleared:
                logger.info(
                    "Retention: deleted %d sign-in codes, cleared %d SMS texts",
                    result.otp_challenges_deleted, result.sms_bodies_cleared,
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # keep running after a transient database error
            logger.exception("Retention pass failed")
