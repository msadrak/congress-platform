"""Throttling of failed authentication attempts and of SMS sends, shared by every API process through PostgreSQL.

Only failures count for sign-in style budgets, so legitimate users are never slowed down by their own successful
sign-ins, and a shared venue Wi-Fi (many attendees behind one IP) gets a generous per-IP budget while each
individual account gets a tight one. Blocked callers receive 429 with Retry-After; nothing about the account's
existence is revealed. SMS codes cost money and reach a real phone, so every send counts (`consume`/`hit`).

Counts live in `rate_limit_counters` (one row per key and time bucket), so budgets survive restarts and deploys
and are not multiplied by the number of API workers. A bucket is 1/60 of the window (at least 5 s); a check
counts every bucket that overlaps the window, so a budget is never looser than stated, at most one bucket
stricter. `consume` adds one to every key and reads the totals in one transaction per call, so concurrent
requests cannot overshoot a budget, and a refused attempt is rolled back (it does not count). Expired rows are
deleted about once a minute per process.

Two in-process shortcuts, neither of which can loosen a limit: a key found over budget is refused locally until
its Retry-After passes (no database round trip while someone hammers it), and when the database cannot be reached
the limiter falls back to per-process memory instead of failing the request.
"""

import logging
import math
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from ipaddress import IPv4Network, IPv6Address, IPv6Network, ip_address

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.errors import ApiError
from app.models import RateLimitCounter

logger = logging.getLogger("congress.rate_limit")

WINDOW_SECONDS = 15 * 60
LONGEST_WINDOW_SECONDS = 60 * 60
DAY_SECONDS = 24 * 60 * 60
MIN_BUCKET_SECONDS = 5.0
CLEANUP_EVERY_SECONDS = 60.0
DEFAULT_DETAIL = "Too many failed attempts. Try again later."
# A 429's message and stable code: one for every key, or per key ({key: ...}).
Message = str | dict[str, str]
ErrorCode = str | dict[str, str] | None


@dataclass(frozen=True)
class Budget:
    limit: int
    window: float = WINDOW_SECONDS

    @property
    def bucket(self) -> float:
        return max(MIN_BUCKET_SECONDS, self.window / 60)


# Failed attempts allowed per window.
LOGIN_PER_ACCOUNT = Budget(10)
LOGIN_PER_IP = Budget(100)
ADMIN_TOKEN_PER_IP = Budget(10)
API_KEY_PER_IP = Budget(50)
# Wrong sign-in codes allowed per window (each code also allows only 5 attempts of its own).
OTP_VERIFY_PER_MOBILE = Budget(10)
OTP_VERIFY_PER_IP = Budget(100)
# A key that is only ever `hit`/`fail`ed (never `consume`d) is kept this long.
HIT_RETENTION = Budget(1, LONGEST_WINDOW_SECONDS)


class LimitExceeded(Exception):
    def __init__(self, key: str, retry_after: int) -> None:
        super().__init__(key)
        self.key = key
        self.retry_after = retry_after


def _bucket_start(at: float, bucket: float) -> datetime:
    return datetime.fromtimestamp(math.floor(at / bucket) * bucket, timezone.utc)


def _since(at: float, budget: Budget) -> datetime:
    """Rows starting after this instant overlap the window (the conservative edge: one extra bucket)."""
    return datetime.fromtimestamp(at - budget.window - budget.bucket, timezone.utc)


def _retry_after(oldest: datetime | None, budget: Budget, at: float) -> int:
    start = oldest.timestamp() if oldest is not None else at
    return max(1, math.ceil(start + budget.window - at))


_BUMP = text(
    """
    WITH bumped AS (
        INSERT INTO rate_limit_counters (key, window_start, count, expires_at)
        VALUES (:key, :start, 1, :expires)
        ON CONFLICT (key, window_start) DO UPDATE
            SET count = rate_limit_counters.count + 1,
                expires_at = GREATEST(rate_limit_counters.expires_at, EXCLUDED.expires_at)
        RETURNING count
    )
    SELECT
        (SELECT count FROM bumped) + COALESCE((
            SELECT SUM(count) FROM rate_limit_counters
            WHERE key = :key AND window_start > :since AND window_start <> :start
        ), 0) AS total,
        (SELECT MIN(window_start) FROM rate_limit_counters WHERE key = :key AND window_start > :since) AS oldest
    """
)
_COUNT = text(
    "SELECT COALESCE(SUM(count), 0) AS total, MIN(window_start) AS oldest "
    "FROM rate_limit_counters WHERE key = :key AND window_start > :since"
)
_CLAIM = text(
    "INSERT INTO rate_limit_counters (key, window_start, count, expires_at) VALUES (:key, :start, 1, :expires) "
    "ON CONFLICT (key, window_start) DO NOTHING RETURNING count"
)


@dataclass
class _MemoryCounters:
    """The per-process fallback while the database cannot be reached (the limiter before it was shared)."""

    events: dict[str, deque[float]] = field(default_factory=dict)

    def _recent(self, key: str, window: float, now: float) -> deque[float]:
        events = self.events.setdefault(key, deque())
        while events and events[0] <= now - window:
            events.popleft()
        return events

    def check(self, limits: tuple[tuple[str, Budget], ...], now: float) -> None:
        for key, budget in limits:
            events = self._recent(key, budget.window, now)
            if len(events) >= budget.limit:
                raise LimitExceeded(key, max(1, int(events[0] + budget.window - now) + 1))

    def add(self, keys: tuple[str, ...], now: float) -> None:
        for key in keys:
            self.events.setdefault(key, deque()).append(now)
        if len(self.events) > 50_000:  # bound memory under a spray of distinct keys
            for stale in [k for k, v in self.events.items() if not v or v[-1] <= now - DAY_SECONDS]:
                del self.events[stale]

    def forget(self, keys: tuple[str, ...]) -> None:
        for key in keys:
            self.events.pop(key, None)


class FailureLimiter:
    """One per application (`app.state.limiter`); `limiter(request)` binds it to the application's database."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.sessionmaker: async_sessionmaker[AsyncSession] | None = None
        # Keys known to be over this budget, refused locally until this (time.time()) instant.
        self._blocked: dict[str, tuple[float, Budget]] = {}
        self._memory = _MemoryCounters()
        self._last_cleanup = 0.0

    def bind(self, sessionmaker: async_sessionmaker[AsyncSession]) -> "FailureLimiter":
        self.sessionmaker = sessionmaker
        return self

    # --- the request-facing interface ---------------------------------------------------------------------------

    async def check(
        self, *limits: tuple[str, Budget], detail: Message = DEFAULT_DETAIL, code: ErrorCode = None
    ) -> None:
        """Raise 429 if any key has used up its budget (counts nothing)."""
        if not self.enabled:
            return
        try:
            await self.count(*limits)
        except LimitExceeded as exc:
            raise _too_many(exc, detail, code) from None

    async def consume(
        self, *limits: tuple[str, Budget], detail: Message = DEFAULT_DETAIL, code: ErrorCode = None
    ) -> None:
        """Count one attempt against every key, or raise 429 (counting nothing) if any budget is used up."""
        if not self.enabled:
            return
        try:
            await self.take(*limits)
        except LimitExceeded as exc:
            raise _too_many(exc, detail, code) from None

    async def fail(self, *keys: str) -> None:
        if self.enabled:
            await self._add(keys)

    async def hit(self, *keys: str) -> None:
        """Count an attempt that is limited whether or not it succeeds (an SMS send)."""
        if self.enabled:
            await self._add(keys)

    async def succeed(self, *keys: str) -> None:
        for key in keys:
            self._blocked.pop(key, None)
        self._memory.forget(keys)
        if not self.enabled or self.sessionmaker is None:
            return
        try:
            async with self.sessionmaker() as session:
                await session.execute(delete(RateLimitCounter).where(RateLimitCounter.key.in_(keys)))
                await session.commit()
        except (SQLAlchemyError, OSError):
            logger.warning("Rate limit counters unavailable; could not clear %d key(s)", len(keys))

    # --- counters that are enforced even when auth throttling is disabled (SMS caps, single-use tokens) ---------

    async def count(self, *limits: tuple[str, Budget]) -> list[int]:
        """The current totals; LimitExceeded for the first key at or over its budget."""
        limits = _active(limits)
        now = time.time()
        self._refuse_known(limits, now)
        if self.sessionmaker is None:
            self._memory.check(limits, time.monotonic())
            return []
        try:
            async with self.sessionmaker() as session:
                totals = []
                for key, budget in limits:
                    row = (await session.execute(_COUNT, {"key": key, "since": _since(now, budget)})).one()
                    if row.total >= budget.limit:
                        raise self._blocked_now(key, budget, _retry_after(row.oldest, budget, now), now)
                    totals.append(int(row.total))
                await self._maybe_clean(session, now)
                await session.commit()
                return totals
        except (SQLAlchemyError, OSError):
            self._degraded()
            self._memory.check(limits, time.monotonic())
            return []

    async def peek(self, *limits: tuple[str, Budget]) -> list[int]:
        """The current totals for display; never raises (zeros when the counters cannot be read)."""
        if self.sessionmaker is None:
            return [0] * len(limits)
        now = time.time()
        try:
            async with self.sessionmaker() as session:
                return [
                    int((await session.execute(_COUNT, {"key": key, "since": _since(now, budget)})).one().total)
                    for key, budget in limits
                ]
        except (SQLAlchemyError, OSError):
            return [0] * len(limits)

    async def take(self, *limits: tuple[str, Budget]) -> list[int]:
        """Add one to every key and return the totals, atomically; LimitExceeded (nothing added) when one is over."""
        limits = _active(limits)
        now = time.time()
        self._refuse_known(limits, now)
        if self.sessionmaker is None:
            return self._take_in_memory(limits)
        try:
            async with self.sessionmaker() as session:
                totals = []
                for key, budget in limits:
                    start = _bucket_start(now, budget.bucket)
                    row = (
                        await session.execute(
                            _BUMP,
                            {
                                "key": key,
                                "start": start,
                                "since": _since(now, budget),
                                "expires": start + timedelta(seconds=budget.window + 2 * budget.bucket),
                            },
                        )
                    ).one()
                    if row.total > budget.limit:
                        await session.rollback()
                        raise self._blocked_now(key, budget, _retry_after(row.oldest, budget, now), now)
                    totals.append(int(row.total))
                await self._maybe_clean(session, now)
                await session.commit()
                return totals
        except (SQLAlchemyError, OSError):
            self._degraded()
            return self._take_in_memory(limits)

    async def claim_once(self, key: str, ttl_seconds: float) -> bool:
        """True the first time `key` is claimed within `ttl_seconds`, False afterwards (single-use tokens)."""
        if self.sessionmaker is None:
            raise RuntimeError("the rate limiter is not bound to a database")
        now = time.time()
        async with self.sessionmaker() as session:
            claimed = await session.scalar(
                _CLAIM,
                {
                    "key": key,
                    "start": datetime.fromtimestamp(0, timezone.utc),
                    "expires": datetime.fromtimestamp(now + ttl_seconds, timezone.utc),
                },
            )
            await session.commit()
        return claimed is not None

    # --- internals -------------------------------------------------------------------------------------------

    def _refuse_known(self, limits: tuple[tuple[str, Budget], ...], now: float) -> None:
        for key, budget in limits:
            known = self._blocked.get(key)
            if known is None:
                continue
            until, blocked_budget = known
            if until > now and blocked_budget == budget:
                raise LimitExceeded(key, max(1, math.ceil(until - now)))
            if until <= now:
                del self._blocked[key]

    def _blocked_now(self, key: str, budget: Budget, retry_after: int, now: float) -> LimitExceeded:
        """Remember the refusal: until then the count cannot drop (the oldest bucket is still in the window), so
        refusing locally is exact, unless the budget changes (then the entry no longer applies)."""
        if len(self._blocked) > 50_000:
            self._blocked = {k: v for k, v in self._blocked.items() if v[0] > now}
        self._blocked[key] = (now + retry_after, budget)
        return LimitExceeded(key, retry_after)

    def _take_in_memory(self, limits: tuple[tuple[str, Budget], ...]) -> list[int]:
        now = time.monotonic()
        self._memory.check(limits, now)
        keys = tuple(key for key, _ in limits)
        self._memory.add(keys, now)
        return [len(self._memory.events[key]) for key in keys]

    async def _add(self, keys: tuple[str, ...]) -> None:
        if self.sessionmaker is None:
            self._memory.add(keys, time.monotonic())
            return
        now = time.time()
        start = _bucket_start(now, MIN_BUCKET_SECONDS)
        expires = start + timedelta(seconds=HIT_RETENTION.window + 2 * MIN_BUCKET_SECONDS)
        try:
            async with self.sessionmaker() as session:
                for key in keys:
                    await session.execute(
                        _BUMP, {"key": key, "start": start, "since": start, "expires": expires}
                    )
                await self._maybe_clean(session, now)
                await session.commit()
        except (SQLAlchemyError, OSError):
            self._degraded()
            self._memory.add(keys, time.monotonic())

    async def _maybe_clean(self, session: AsyncSession, now: float) -> None:
        if now - self._last_cleanup < CLEANUP_EVERY_SECONDS:
            return
        self._last_cleanup = now
        await session.execute(
            delete(RateLimitCounter).where(RateLimitCounter.expires_at < datetime.fromtimestamp(now, timezone.utc))
        )

    def _degraded(self) -> None:
        logger.warning("Rate limit counters unavailable; limiting in this process only until the database is back")


def _active(limits: tuple[tuple[str, Budget], ...]) -> tuple[tuple[str, Budget], ...]:
    """A zero window (e.g. no resend cooldown) limits nothing."""
    return tuple((key, budget) for key, budget in limits if budget.window > 0)


def _too_many(exc: LimitExceeded, detail: Message, code: ErrorCode) -> HTTPException:
    """429 with Retry-After; `detail` and `code` may be given per key (the first key over its budget wins)."""
    headers = {"Retry-After": str(exc.retry_after)}
    text = detail.get(exc.key, DEFAULT_DETAIL) if isinstance(detail, dict) else detail
    error_code = code.get(exc.key) if isinstance(code, dict) else code
    if error_code is None:
        return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, text, headers=headers)
    return ApiError(status.HTTP_429_TOO_MANY_REQUESTS, error_code, text, headers=headers)


def limiter(request: Request) -> FailureLimiter:
    value: FailureLimiter = request.app.state.limiter
    if value.sessionmaker is None and hasattr(request.app.state, "sessionmaker"):
        value.bind(request.app.state.sessionmaker)
    return value


def client_ip(request: Request) -> str:
    # Behind Caddy, uvicorn --proxy-headers puts the visitor address here (Caddy replaces any
    # client-supplied X-Forwarded-For).
    return request.client.host if request.client else "unknown"


def ip_group(ip: str) -> str:
    """The unit a per-IP budget counts: the address, or its /64 for IPv6 (one subscriber gets a whole /64, so
    rotating addresses inside it must not multiply the budget)."""
    try:
        address = ip_address(ip)
    except ValueError:
        return ip
    if isinstance(address, IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(IPv6Network(f"{address}/64", strict=False))
    return str(address)


def in_networks(ip: str, networks: tuple[IPv4Network | IPv6Network, ...]) -> bool:
    try:
        address = ip_address(ip)
    except ValueError:
        return False
    if isinstance(address, IPv6Address) and address.ipv4_mapped is not None:
        address = address.ipv4_mapped
    return any(address.version == network.version and address in network for network in networks)
