"""The SMS gateway the application sends through, following the platform SMS settings at run time.

The platform admin can switch between test mode and real delivery, or replace the sms.ir key or line, in the
platform console; `configure` applies the change to the running process without a restart. Until a key and
line are known, nothing can be sent: every send answers NOT_CONFIGURED (retryable without using up an attempt, so
queued confirmations go out once the gateway is configured).

Every send first counts against the platform-wide hourly and daily caps (shared by every API process); above a
cap it answers HOURLY_CAP_REACHED / DAILY_CAP_REACHED without calling the provider, and crossing 80 % of a cap is
logged once on `congress.sms.alerts` and passed to `on_cap_warning`. At most `max_concurrent` provider calls are
in flight per process; a send that cannot start within the provider timeout answers BUSY (nothing was sent).
"""

import asyncio
import logging
import math
from collections.abc import Callable

import httpx

from app.platform_config import SmsConfig
from app.rate_limit import DAY_SECONDS, LONGEST_WINDOW_SECONDS, Budget, FailureLimiter, LimitExceeded
from app.sms.provider import RecordingProvider, SmsIrProvider, SmsResult

NOT_CONFIGURED = "NOT_CONFIGURED"
HOURLY_CAP_REACHED = "HOURLY_CAP_REACHED"
DAILY_CAP_REACHED = "DAILY_CAP_REACHED"
BUSY = "BUSY"
# Nothing was sent and it is nobody's fault: try again later without counting an attempt.
DEFERRED_ERRORS = frozenset({NOT_CONFIGURED, HOURLY_CAP_REACHED, DAILY_CAP_REACHED, BUSY})
HOURLY_KEY = "sms:platform:hour"
DAILY_KEY = "sms:platform:day"
WARN_FRACTION = 0.8
UNCAPPED = 2**31 - 1

logger = logging.getLogger("congress.sms")
alerts = logging.getLogger("congress.sms.alerts")


class SmsGateway:
    def __init__(self, *, timeout: float, log_text: bool, max_concurrent: int = 8) -> None:
        # Test mode keeps one recorder for the whole process, so recorded messages survive reconfiguration.
        self.recorder = RecordingProvider(log_text=log_text)
        self.config: SmsConfig | None = None
        self._timeout = timeout
        self._live: SmsIrProvider | None = None
        self._live_for: tuple[str, int] | None = None
        self._retired: list[SmsIrProvider] = []
        self._slots = asyncio.Semaphore(max_concurrent)
        self.counters: FailureLimiter | None = None
        # Called with (cap name, total, cap) when a send crosses 80 % of a cap (metrics, paging).
        self.on_cap_warning: Callable[[str, int, int], None] | None = None
        # Tests replace the network with an httpx.MockTransport.
        self.transport: httpx.AsyncBaseTransport | None = None

    def configure(self, config: SmsConfig, *, counters: FailureLimiter | None = None) -> None:
        self.config = config
        if counters is not None:
            self.counters = counters
        if config.effective != "smsir" or config.api_key is None or config.line_number is None:
            return
        wanted = (config.api_key, config.line_number)
        if wanted != self._live_for:
            if self._live is not None:
                self._retired.append(self._live)  # closed at shutdown; requests in flight finish on it
            self._live = SmsIrProvider(
                config.api_key, config.line_number, timeout=self._timeout, transport=self.transport
            )
            self._live_for = wanted

    async def send_text(self, mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        config = self.config
        if config is None or config.effective == "unconfigured":
            return SmsResult(ok=False, error=NOT_CONFIGURED, retryable=True)
        refused = await self._reserve(config)
        if refused is not None:
            return SmsResult(ok=False, error=refused, retryable=True)
        try:
            async with asyncio.timeout(self._timeout):
                await self._slots.acquire()
        except TimeoutError:
            logger.warning("SMS %s not sent: too many provider calls in flight", kind)
            return SmsResult(ok=False, error=BUSY, retryable=True)
        try:
            if config.effective == "console":
                return await self.recorder.send_text(mobile, text, kind=kind, code=code)
            assert self._live is not None
            return await self._live.send_text(mobile, text, kind=kind, code=code)
        finally:
            self._slots.release()

    async def _reserve(self, config: SmsConfig) -> str | None:
        """Count this send against the platform caps; the error to answer when a cap is reached."""
        # Counted even without a cap (0), so the console can show how many SMS went out.
        caps = [
            (name, key, Budget(cap or UNCAPPED, window), error)
            for name, key, cap, window, error in (
                ("hourly", HOURLY_KEY, config.hourly_cap, LONGEST_WINDOW_SECONDS, HOURLY_CAP_REACHED),
                ("daily", DAILY_KEY, config.daily_cap, DAY_SECONDS, DAILY_CAP_REACHED),
            )
        ]
        if self.counters is None:
            return None
        try:
            totals = await self.counters.take(*((key, budget) for _, key, budget, _ in caps))
        except LimitExceeded as exc:
            error = next(error for _, key, _, error in caps if key == exc.key)
            alerts.error("SMS platform cap reached (%s): sends are refused until it frees up", error)
            return error
        for (name, _, budget, _), total in zip(caps, totals):
            if budget.limit != UNCAPPED and total == math.ceil(budget.limit * WARN_FRACTION):
                alerts.warning("SMS platform %s cap at %d of %d", name, total, budget.limit)
                if self.on_cap_warning is not None:
                    self.on_cap_warning(name, total, budget.limit)
        return None

    async def aclose(self) -> None:
        for provider in [*self._retired, *([self._live] if self._live else [])]:
            await provider.aclose()
        self._retired.clear()
        self._live = None
        self._live_for = None
