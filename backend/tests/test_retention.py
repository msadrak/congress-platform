"""Data retention: used or expired sign-in codes and old SMS texts are removed; nothing current is touched."""

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from sqlalchemy import select

from app.models import OtpChallenge, SmsMessage
from app.retention import purge_expired


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
