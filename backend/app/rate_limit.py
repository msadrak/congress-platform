"""In-process throttling of failed authentication attempts (one API process per deployment).

Only failures count, so legitimate users are never slowed down by their own successful sign-ins, and a
shared venue Wi-Fi (many attendees behind one IP) gets a generous per-IP budget while each individual
account gets a tight one. Blocked callers receive 429 with Retry-After; nothing about the account's
existence is revealed. State is per process and resets on restart: this is abuse damping, not an audit log.
"""

import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException, Request, status

WINDOW_SECONDS = 15 * 60


@dataclass(frozen=True)
class Budget:
    limit: int
    window: float = WINDOW_SECONDS


# Failed attempts allowed per window.
LOGIN_PER_ACCOUNT = Budget(10)
LOGIN_PER_IP = Budget(100)
ADMIN_TOKEN_PER_IP = Budget(10)
API_KEY_PER_IP = Budget(50)


@dataclass
class FailureLimiter:
    enabled: bool = True
    _events: dict[str, deque[float]] = field(default_factory=dict)

    def _recent(self, key: str, window: float, now: float) -> deque[float]:
        events = self._events.setdefault(key, deque())
        while events and events[0] <= now - window:
            events.popleft()
        return events

    def check(self, *limits: tuple[str, Budget]) -> None:
        """Raise 429 if any key has used up its budget of failures."""
        if not self.enabled:
            return
        now = time.monotonic()
        for key, budget in limits:
            events = self._recent(key, budget.window, now)
            if len(events) >= budget.limit:
                retry = max(1, int(events[0] + budget.window - now) + 1)
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Too many failed attempts. Try again later.",
                    headers={"Retry-After": str(retry)},
                )

    def fail(self, *keys: str) -> None:
        if not self.enabled:
            return
        now = time.monotonic()
        for key in keys:
            self._events.setdefault(key, deque()).append(now)
        if len(self._events) > 50_000:  # bound memory under a spray of distinct keys
            for stale in [k for k, v in self._events.items() if not v or v[-1] <= now - WINDOW_SECONDS]:
                del self._events[stale]

    def succeed(self, *keys: str) -> None:
        for key in keys:
            self._events.pop(key, None)


def limiter(request: Request) -> FailureLimiter:
    value: FailureLimiter = request.app.state.limiter
    return value


def client_ip(request: Request) -> str:
    # Behind Caddy, uvicorn --proxy-headers puts the visitor address here (Caddy replaces any
    # client-supplied X-Forwarded-For).
    return request.client.host if request.client else "unknown"
