"""Data retention: used or expired sign-in codes, old SMS texts and numbers, spent links and bookkeeping are
removed; nothing current is touched. The audit log is purged only on explicit request."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError

from app.models import AuditEvent, DeskIdempotencyKey, OtpChallenge, RateLimitCounter, ShortLink, SmsMessage
from app.retention import AuditPurgeDisabled, purge_audit_events, purge_expired
from tests.test_participants import congress, register


async def test_purge_removes_old_codes_and_old_message_texts(app: FastAPI) -> None:
    now = datetime.now(timezone.utc)
    day, month = timedelta(hours=25), timedelta(days=31)

    def otp(label: str, created: datetime, *, consumed: bool = False, expires: datetime | None = None) -> OtpChallenge:
        return OtpChallenge(
            mobile="09123330001", purpose="signin", code_hash=label.ljust(64, "0"),
            created_at=created, expires_at=expires or created + timedelta(minutes=2),
            consumed_at=created + timedelta(seconds=30) if consumed else None,
        )

    def sms(label: str, created: datetime, status: str = "sent") -> SmsMessage:
        return SmsMessage(kind="ticket_resend", mobile="09123330001", body=label, status=status, created_at=created)

    async with app.state.sessionmaker() as session:
        session.add_all(
            [
                otp("old-used", now - day, consumed=True),
                otp("old-expired", now - day),
                otp("recent-used", now - timedelta(hours=1), consumed=True),
                otp("live", now, expires=now + timedelta(minutes=2)),
                sms("old-sent", now - month),
                sms("old-failed", now - month, status="failed"),
                sms("old-pending", now - month, status="pending"),
                sms("recent-sent", now - timedelta(days=2)),
            ]
        )
        await session.commit()

    async with app.state.sessionmaker() as session:
        result = await purge_expired(session, app.state.settings, now=now)
        await session.commit()

    assert (result.otp_challenges_deleted, result.sms_bodies_cleared) == (2, 2)
    async with app.state.sessionmaker() as session:
        codes = {c.code_hash.rstrip("0") for c in await session.scalars(select(OtpChallenge))}
        bodies = {m.status + ":" + str(m.body) for m in await session.scalars(select(SmsMessage))}
    assert codes == {"recent-used", "live"}
    assert bodies == {"sent:None", "failed:None", "pending:old-pending", "sent:recent-sent"}


async def test_purge_forgets_old_numbers_spent_links_and_expired_bookkeeping(app: FastAPI, client: AsyncClient) -> None:
    _, event_id, tier_id = await congress(client)
    _, ticket = await register(client, event_id, tier_id, "09123330011", "Linked")
    now = datetime.now(timezone.utc)
    settings = app.state.settings
    event, ticket_id = uuid.UUID(event_id), uuid.UUID(ticket["id"])
    old = now - timedelta(days=settings.sms_mobile_retention_days + 1)
    otp_old = now - timedelta(days=settings.otp_sms_log_retention_days + 1)

    def sms(label: str, created: datetime, *, kind: str = "ticket_resend", status: str = "sent") -> SmsMessage:
        return SmsMessage(
            kind=kind, mobile="09123330012", body=None, status=status, created_at=created, last_error=label
        )

    def link(code: str, expires: datetime) -> ShortLink:
        return ShortLink(code=code, ticket_id=ticket_id, event_id=event, expires_at=expires, open_count=0)

    def key(label: str, expires: datetime) -> DeskIdempotencyKey:
        return DeskIdempotencyKey(
            event_id=event, actor="organizer", key=label, request_hash="0" * 64, ticket_id=ticket_id, expires_at=expires
        )

    grace = timedelta(days=settings.short_link_grace_days)
    async with app.state.sessionmaker() as session:
        session.add_all([
            sms("old-otp", otp_old, kind="otp"),
            sms("recent-otp", now - timedelta(hours=2), kind="otp"),
            sms("old-sent", old),
            sms("old-pending", old, status="pending"),
            sms("recent-sent", now - timedelta(days=1)),
            link("spentlink2", now - grace - timedelta(days=1)),
            link("gracelink2", now - grace + timedelta(days=1)),
            key("expired", now - timedelta(minutes=1)),
            key("live", now + timedelta(hours=1)),
            RateLimitCounter(
                key="test:old", window_start=now - timedelta(hours=3), count=1, expires_at=now - timedelta(hours=1)
            ),
            RateLimitCounter(key="test:live", window_start=now, count=1, expires_at=now + timedelta(hours=1)),
        ])
        await session.commit()

    async with app.state.sessionmaker() as session:
        result = await purge_expired(session, settings, now=now)
        await session.commit()

    assert (result.otp_sms_deleted, result.sms_mobiles_masked) == (1, 1)
    assert (result.short_links_deleted, result.idempotency_keys_deleted) == (1, 1)
    assert result.rate_limit_counters_deleted >= 1
    async with app.state.sessionmaker() as session:
        messages = {
            m.last_error: m.mobile
            for m in await session.scalars(select(SmsMessage).where(SmsMessage.last_error.is_not(None)))
        }
        links = set(await session.scalars(select(ShortLink.code).where(ShortLink.ticket_id == ticket_id)))
        keys = set(await session.scalars(select(DeskIdempotencyKey.key)))
        counters = set(await session.scalars(select(RateLimitCounter.key).where(RateLimitCounter.key.like("test:%"))))
    assert messages == {
        "recent-otp": "09123330012", "old-sent": "0912***0012", "old-pending": "09123330012",
        "recent-sent": "09123330012",
    }
    assert "spentlink2" not in links and "gracelink2" in links
    assert keys == {"live"} and counters == {"test:live"}
    # A second pass finds nothing left to do.
    async with app.state.sessionmaker() as session:
        again = await purge_expired(session, settings, now=now)
        await session.commit()
    assert (again.otp_sms_deleted, again.sms_mobiles_masked, again.short_links_deleted) == (0, 0, 0)
    assert again.idempotency_keys_deleted == 0


async def test_audit_purge_is_off_by_default_and_explicit(app: FastAPI) -> None:
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as session:
        session.add_all([
            AuditEvent(actor_type="system", action="test.ancient", at=now - timedelta(days=800)),
            AuditEvent(actor_type="system", action="test.recent", at=now - timedelta(days=10)),
        ])
        await session.commit()

    assert app.state.settings.audit_retention_days is None
    with pytest.raises(AuditPurgeDisabled):
        await purge_audit_events(app.state.sessionmaker, app.state.settings, now=now)
    # The application itself still cannot delete audit rows.
    async with app.state.sessionmaker() as session:
        with pytest.raises(DBAPIError):
            await session.execute(delete(AuditEvent))
        await session.rollback()

    settings = app.state.settings.model_copy(update={"audit_retention_days": 730})
    deleted = await purge_audit_events(app.state.sessionmaker, settings, now=now)

    assert deleted == 1
    async with app.state.sessionmaker() as session:
        actions = set(await session.scalars(select(AuditEvent.action)))
    assert "test.ancient" not in actions and "test.recent" in actions
    assert "audit.purged" in actions  # the purge itself is on the record
    async with app.state.sessionmaker() as session:
        with pytest.raises(DBAPIError):
            await session.execute(delete(AuditEvent))  # the trigger is back in force
        await session.rollback()
