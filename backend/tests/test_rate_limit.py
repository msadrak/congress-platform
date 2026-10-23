"""The shared limiter: counts live in PostgreSQL, so every API process and every restart sees the same budgets."""

import asyncio
import itertools
import math
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.rate_limit as rate_limit_module
from app.models import RateLimitCounter
from app.rate_limit import Budget, FailureLimiter, LimitExceeded, in_networks, ip_group
from app.config import parse_networks


def fresh(app: FastAPI) -> FailureLimiter:
    """A limiter of another process on the same database."""
    return FailureLimiter().bind(app.state.sessionmaker)


async def test_a_budget_is_shared_between_processes(app: FastAPI) -> None:
    one, two = fresh(app), fresh(app)
    budget = Budget(3, 60)
    assert await one.take(("k", budget)) == [1]
    assert await two.take(("k", budget)) == [2]
    assert await one.take(("k", budget)) == [3]
    with pytest.raises(LimitExceeded) as refused:
        await two.take(("k", budget))
    assert 0 < refused.value.retry_after <= 60


async def test_a_refused_attempt_counts_nothing(app: FastAPI) -> None:
    limiter = fresh(app)
    tight, loose = ("tight", Budget(1, 60)), ("loose", Budget(10, 60))
    await limiter.take(tight, loose)
    for _ in range(3):
        with pytest.raises(LimitExceeded):
            await limiter.take(tight, loose)
    assert await fresh(app).count(loose) == [1]


async def test_concurrent_takes_never_overshoot(app: FastAPI) -> None:
    limiters = [fresh(app) for _ in range(5)]
    budget = Budget(7, 60)

    async def attempt(limiter: FailureLimiter) -> bool:
        try:
            await limiter.take(("race", budget))
            return True
        except LimitExceeded:
            return False

    results = await asyncio.gather(*(attempt(limiters[i % 5]) for i in range(20)))
    assert sum(results) == 7


async def test_concurrent_takes_across_a_bucket_boundary_never_overshoot(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A burst that straddles a bucket boundary bumps two rows; each take must still see the other bucket's
    in-flight attempts (a per-key lock orders the takes), or both buckets fill up to the budget."""
    budget = Budget(7, 60)
    boundary = math.floor(time.time() / budget.bucket) * budget.bucket
    clock = itertools.cycle((boundary - 0.001, boundary + 0.001))

    class Clock:
        monotonic = staticmethod(time.monotonic)

        @staticmethod
        def time() -> float:
            return next(clock)

    monkeypatch.setattr(rate_limit_module, "time", Clock)
    limiters = [fresh(app) for _ in range(5)]

    async def attempt(limiter: FailureLimiter) -> bool:
        try:
            await limiter.take(("edge", budget))
            return True
        except LimitExceeded:
            return False

    results = await asyncio.gather(*(attempt(limiters[i % 5]) for i in range(40)))
    assert sum(results) == 7
    assert await fresh(app).peek(("edge", budget)) == [7]


async def test_success_clears_failures_everywhere(app: FastAPI) -> None:
    one, two = fresh(app), fresh(app)
    await one.fail("login:x")
    await one.fail("login:x")
    assert await two.count(("login:x", Budget(5))) == [2]
    await two.succeed("login:x")
    assert await one.count(("login:x", Budget(5))) == [0]


async def test_a_single_use_claim_works_once(app: FastAPI) -> None:
    assert await fresh(app).claim_once("token:abc", 60) is True
    assert await fresh(app).claim_once("token:abc", 60) is False
    assert await fresh(app).claim_once("token:other", 60) is True


async def test_expired_rows_are_cleaned_up(app: FastAPI) -> None:
    limiter = fresh(app)
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    async with app.state.sessionmaker() as session:
        session.add(RateLimitCounter(key="short", window_start=past, count=3, expires_at=past))
        await session.commit()
    await limiter.take(("other", Budget(5, 60)))
    async with app.state.sessionmaker() as session:
        keys = set(await session.scalars(select(RateLimitCounter.key)))
    assert "short" not in keys and "other" in keys


async def test_without_the_database_it_limits_in_memory_instead_of_failing(app: FastAPI) -> None:
    unreachable = create_async_engine("postgresql+asyncpg://congress:congress@127.0.0.1:1/nowhere_test")
    limiter = FailureLimiter().bind(async_sessionmaker(unreachable))
    budget = Budget(2, 60)
    await limiter.take(("k", budget))
    await limiter.take(("k", budget))
    with pytest.raises(LimitExceeded):
        await limiter.take(("k", budget))
    await unreachable.dispose()
    async with app.state.sessionmaker() as session:
        assert await session.scalar(select(func.count()).select_from(RateLimitCounter)) == 0


def test_ipv6_addresses_count_per_64_and_ipv4_per_address() -> None:
    assert ip_group("2001:db8:1:2::1") == ip_group("2001:db8:1:2:ffff::9") == "2001:db8:1:2::/64"
    assert ip_group("2001:db8:1:3::1") != ip_group("2001:db8:1:2::1")
    assert ip_group("::ffff:192.0.2.7") == ip_group("192.0.2.7") == "192.0.2.7"
    assert ip_group("unknown") == "unknown"


def test_venue_networks_match_addresses_of_their_own_family() -> None:
    networks = tuple(parse_networks("10.0.0.0/8, 2001:db8::/32, 192.0.2.7"))
    assert in_networks("10.20.30.40", networks)
    assert in_networks("::ffff:10.1.1.1", networks)
    assert in_networks("2001:db8:ffff::1", networks)
    assert in_networks("192.0.2.7", networks)
    assert not in_networks("192.0.2.8", networks)
    assert not in_networks("unknown", networks)
    with pytest.raises(ValueError, match="'10.0.0.300'"):
        parse_networks("10.0.0.300")
