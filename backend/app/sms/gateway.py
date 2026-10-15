"""The SMS gateway the application sends through, following the platform SMS settings at run time.

The platform admin can switch between test mode and real delivery, or replace the sms.ir key or line, in the
platform console; `configure` applies the change to the running process without a restart. Until a key and
line are known, nothing can be sent: every send answers NOT_CONFIGURED (retryable, so queued confirmations go
out once the gateway is configured).
"""

import httpx

from app.platform_config import SmsConfig
from app.sms.provider import RecordingProvider, SmsIrProvider, SmsResult

NOT_CONFIGURED = "NOT_CONFIGURED"


class SmsGateway:
    def __init__(self, *, timeout: float, log_text: bool) -> None:
        # Test mode keeps one recorder for the whole process, so recorded messages survive reconfiguration.
        self.recorder = RecordingProvider(log_text=log_text)
        self.config: SmsConfig | None = None
        self._timeout = timeout
        self._live: SmsIrProvider | None = None
        self._live_for: tuple[str, int] | None = None
        self._retired: list[SmsIrProvider] = []
        # Tests replace the network with an httpx.MockTransport.
        self.transport: httpx.AsyncBaseTransport | None = None

    def configure(self, config: SmsConfig) -> None:
        self.config = config
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
        if config.effective == "console":
            return await self.recorder.send_text(mobile, text, kind=kind, code=code)
        assert self._live is not None
        return await self._live.send_text(mobile, text, kind=kind, code=code)

    async def aclose(self) -> None:
        for provider in [*self._retired, *([self._live] if self._live else [])]:
            await provider.aclose()
        self._retired.clear()
        self._live = None
        self._live_for = None
