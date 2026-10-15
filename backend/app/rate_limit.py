"""In-process throttling of failed authentication attempts and of SMS sends (one API process per deployment).

Only failures count, so legitimate users are never slowed down by their own successful sign-ins, and a
shared venue Wi-Fi (many attendees behind one IP) gets a generous per-IP budget while each individual
account gets a tight one. Blocked callers receive 429 with Retry-After; nothing about the account's
existence is revealed. State is per process and resets on restart: this is abuse damping, not an audit log.

SMS sign-in codes cost money and reach a real phone, so every send counts (`hit`), not only failures.
"""

import time
from collections import deque
from dataclasses import dataclass, field

from fastapi import HTTPException, Request, status

WINDOW_SECONDS = 15 * 60
LONGEST_WINDOW_SECONDS = 60 * 60


@dataclass(frozen=True)
class Budget:
    limit: int
    window: float = WINDOW_SECONDS


# Failed attempts allowed per window.
LOGIN_PER_ACCOUNT = Budget(10)
LOGIN_PER_IP = Budget(100)
ADMIN_TOKEN_PER_IP = Budget(10)
API_KEY_PER_IP = Budget(50)
# Wrong sign-in codes allowed per window (each code also allows only 5 attempts of its own).
OTP_VERIFY_PER_MOBILE = Budget(10)
OTP_VERIFY_PER_IP = Budget(100)


@dataclass
class FailureLimiter:
    enabled: bool = True
    _events: dict[str, deque[float]] = field(default_factory=dict)

    def _recent(self, key: str, window: float, now: float) -> deque[float]:
        events = self._events.setdefault(key, deque())
        while events and events[0] <= now - window:
            events.popleft()
        return events

    def check(self, *limits: tuple[str, Budget], detail: str = "Too many failed attempts. Try again later.") -> None:
        """Raise 429 if any key has used up its budget."""
        if not self.enabled:
            return
        now = time.monotonic()
        for key, budget in limits:
            events = self._recent(key, budget.window, now)
            if len(events) >= budget.limit:
                retry = max(1, int(events[0] + budget.window - now) + 1)
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    detail,
                    headers={"Retry-After": str(retry)},
                )

    def fail(self, *keys: str) -> None:
        if not self.enabled:
            return
        now = time.monotonic()
        for key in keys:
            self._events.setdefault(key, deque()).append(now)
        if len(self._events) > 50_000:  # bound memory under a spray of distinct keys
            for stale in [k for k, v in self._events.items() if not v or v[-1] <= now - LONGEST_WINDOW_SECONDS]:
                del self._events[stale]

    def hit(self, *keys: str) -> None:
        """Count an attempt that is limited whether or not it succeeds (an SMS send)."""
        self.fail(*keys)

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
