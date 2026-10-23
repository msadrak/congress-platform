"""Data retention: personal data and bookkeeping the platform no longer needs are removed on a schedule.

Every pass (one asyncio task per API process, every `retention_interval_seconds`):

* Sign-in codes (`otp_challenges`) that were used or have expired are deleted after `otp_retention_hours`
  (default 24 h): only an HMAC of the code is stored, but the row still ties a mobile number to a time.
* The text of sent SMS (`sms_messages.body`) is cleared after `sms_body_retention_days` (default 30): the
  delivery log keeps who, when and whether it arrived, not what it said.
* The delivery-log rows of sign-in codes (`sms_messages`, kind `otp`) are deleted after
  `otp_sms_log_retention_days` (default 30): each one records that a number asked for a code at a time.
* Every other delivery-log row keeps only a masked number (`0912***4567`) after `sms_mobile_retention_days`
  (default 90): the organizer's SMS log still counts and dates the messages.
* SMS short links (`short_links`) are deleted `short_link_grace_days` (default 30) after they expired (a link
  expires 30 days after its congress ends; until deleted it answers "expired", afterwards "not found").
* Walk-in `Idempotency-Key`s (`desk_idempotency_keys`) are deleted once expired, and so are expired rate-limit
  counters (`rate_limit_counters`; the limiter also clears them as it goes, this catches quiet periods).

Messages still to be sent (`pending`, `sending`) are never touched. Every statement is idempotent, so
overlapping passes are harmless.

The audit log (`audit_events`) is not part of the scheduled pass. It is append-only (a trigger refuses UPDATE and
DELETE, migration 0028), and how long to keep it is a product decision not yet taken, so it is kept forever by
default. With `audit_retention_days` set, an operator can purge older entries explicitly:

    python -m app.retention purge-audit

It runs as the table owner (it briefly disables the append-only trigger inside one transaction, which other
sessions never observe), refuses to run while the setting is unset, and records the purge itself as an
`audit.purged` entry.
"""

import asyncio
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings
from app.models import AuditEvent, DeskIdempotencyKey, OtpChallenge, RateLimitCounter, ShortLink, SmsMessage

logger = logging.getLogger("congress.retention")

NOT_YET_SENT = ("pending", "sending")
MASKED = "%***%"
AUDIT_TRIGGER = "audit_events_append_only"


@dataclass(frozen=True)
class PurgeResult:
    otp_challenges_deleted: int
    sms_bodies_cleared: int
    otp_sms_deleted: int = 0
    sms_mobiles_masked: int = 0
    short_links_deleted: int = 0
    idempotency_keys_deleted: int = 0
    rate_limit_counters_deleted: int = 0

    def any(self) -> bool:
        return any(vars(self).values())


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
            SmsMessage.status.not_in(NOT_YET_SENT),
        )
        .values(body=None)
    )
    otp_log = await session.execute(
        delete(SmsMessage).where(
            SmsMessage.kind == "otp",
            SmsMessage.created_at < now - timedelta(days=settings.otp_sms_log_retention_days),
            SmsMessage.status.not_in(NOT_YET_SENT),
        )
    )
    # `0912***4567`, as app.sms.phone.mask_mobile writes it (and as account deletion leaves it).
    masked = await session.execute(
        update(SmsMessage)
        .where(
            SmsMessage.created_at < now - timedelta(days=settings.sms_mobile_retention_days),
            SmsMessage.status.not_in(NOT_YET_SENT),
            SmsMessage.mobile.not_like(MASKED),
        )
        .values(mobile=func.left(SmsMessage.mobile, 4) + "***" + func.right(SmsMessage.mobile, 4))
    )
    links = await session.execute(
        delete(ShortLink).where(ShortLink.expires_at < now - timedelta(days=settings.short_link_grace_days))
    )
    keys = await session.execute(delete(DeskIdempotencyKey).where(DeskIdempotencyKey.expires_at < now))
    counters = await session.execute(delete(RateLimitCounter).where(RateLimitCounter.expires_at < now))
    return PurgeResult(
        otp_challenges_deleted=_rowcount(otps),
        sms_bodies_cleared=_rowcount(bodies),
        otp_sms_deleted=_rowcount(otp_log),
        sms_mobiles_masked=_rowcount(masked),
        short_links_deleted=_rowcount(links),
        idempotency_keys_deleted=_rowcount(keys),
        rate_limit_counters_deleted=_rowcount(counters),
    )


async def run_retention(sessionmaker: async_sessionmaker[AsyncSession], settings: Settings) -> None:
    while True:
        await asyncio.sleep(settings.retention_interval_seconds)
        try:
            async with sessionmaker() as session:
                result = await purge_expired(session, settings)
                await session.commit()
            if result.any():
                logger.info(
                    "Retention: deleted %d sign-in codes and %d sign-in SMS log rows, cleared %d SMS texts, masked "
                    "%d SMS numbers, deleted %d short links, %d idempotency keys, %d rate-limit counters",
                    result.otp_challenges_deleted, result.otp_sms_deleted, result.sms_bodies_cleared,
                    result.sms_mobiles_masked, result.short_links_deleted, result.idempotency_keys_deleted,
                    result.rate_limit_counters_deleted,
                )
        except asyncio.CancelledError:
            raise
        except Exception:  # keep running after a transient database error
            logger.exception("Retention pass failed")


class AuditPurgeDisabled(RuntimeError):
    """`audit_retention_days` is unset: the audit log is kept forever."""


async def purge_audit_events(
    sessionmaker: async_sessionmaker[AsyncSession], settings: Settings, *, now: datetime | None = None
) -> int:
    """Delete audit entries older than `audit_retention_days`; returns how many. An explicit operator action.

    The append-only trigger is disabled and re-enabled inside the same transaction, which holds an exclusive
    lock on the table meanwhile, so no other session ever writes, or deletes, while it is off. Needs the
    table owner's privileges (ALTER TABLE).
    """
    if settings.audit_retention_days is None:
        raise AuditPurgeDisabled(
            "CONGRESS_AUDIT_RETENTION_DAYS is not set: the audit log is kept forever. Set it to purge older entries."
        )
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=settings.audit_retention_days)
    async with sessionmaker() as session, session.begin():
        await session.execute(text(f"ALTER TABLE audit_events DISABLE TRIGGER {AUDIT_TRIGGER}"))
        deleted = _rowcount(await session.execute(delete(AuditEvent).where(AuditEvent.at < cutoff)))
        await session.execute(text(f"ALTER TABLE audit_events ENABLE TRIGGER {AUDIT_TRIGGER}"))
        session.add(
            AuditEvent(
                actor_type="system", actor_label="Retention", action="audit.purged",
                summary={
                    "before": cutoff.isoformat(), "deleted": deleted, "retention_days": settings.audit_retention_days,
                },
            )
        )
    return deleted


async def _purge_audit_from_env() -> None:
    settings = Settings()
    # Not the API's engine: no statement timeout for what may be a large delete. CONGRESS_DATABASE_URL may name
    # the table owner's role for this one command when the API's role does not own the tables.
    engine = create_async_engine(settings.database_url)
    try:
        deleted = await purge_audit_events(async_sessionmaker(engine, expire_on_commit=False), settings)
    finally:
        await engine.dispose()
    print(f"retention: deleted {deleted} audit entries older than {settings.audit_retention_days} days")


if __name__ == "__main__":
    if sys.argv[1:] != ["purge-audit"]:
        raise SystemExit("usage: python -m app.retention purge-audit")
    try:
        asyncio.run(_purge_audit_from_env())
    except AuditPurgeDisabled as exc:
        raise SystemExit(f"retention: {exc}") from None
