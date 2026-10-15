"""One-time sign-in codes delivered by SMS.

A code is random (CSPRNG), short-lived (settings.otp_ttl_seconds), single use, limited to MAX_ATTEMPTS
guesses, and superseded by any newer code for the same number and purpose. Only an HMAC of the code is
stored, keyed with the JWT secret, so a database dump does not reveal live codes.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import OtpChallenge

OtpPurpose = Literal["signin", "desk"]
MAX_ATTEMPTS = 5


def generate_code(length: int) -> str:
    return f"{secrets.randbelow(10**length):0{length}d}"


def hash_code(secret: str, mobile: str, purpose: str, code: str) -> str:
    message = f"{purpose}:{mobile}:{code}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


async def issue_challenge(
    session: AsyncSession, settings: Settings, mobile: str, purpose: OtpPurpose, *, length: int, ttl_seconds: int
) -> str:
    """Store a new challenge (committed) and return its plain code for sending."""
    now = datetime.now(timezone.utc)
    # Only the newest code works: a resend makes the previous SMS useless.
    await session.execute(
        update(OtpChallenge)
        .where(
            OtpChallenge.mobile == mobile,
            OtpChallenge.purpose == purpose,
            OtpChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    code = generate_code(length)
    session.add(
        OtpChallenge(
            mobile=mobile,
            purpose=purpose,
            code_hash=hash_code(settings.jwt_secret, mobile, purpose, code),
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
    )
    await session.commit()
    return code


async def consume_challenge(
    session: AsyncSession, settings: Settings, mobile: str, purpose: OtpPurpose, code: str
) -> bool:
    """True exactly once for the right code of the newest live challenge; every outcome is committed."""
    now = datetime.now(timezone.utc)
    challenge = await session.scalar(
        select(OtpChallenge)
        .where(
            OtpChallenge.mobile == mobile,
            OtpChallenge.purpose == purpose,
            OtpChallenge.consumed_at.is_(None),
            OtpChallenge.expires_at > now,
        )
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    if challenge is None or challenge.attempts >= MAX_ATTEMPTS:
        await session.rollback()
        return False
    expected = hash_code(settings.jwt_secret, mobile, purpose, code)
    if not secrets.compare_digest(challenge.code_hash, expected):
        challenge.attempts += 1
        if challenge.attempts >= MAX_ATTEMPTS:
            challenge.consumed_at = now
        await session.commit()
        return False
    challenge.consumed_at = now
    await session.commit()
    return True
