"""SMS delivery through sms.ir (https://api.sms.ir, REST v1), plus a recording provider for development.

Only template ("verify") messages are sent: they go out on sms.ir's service line, are not blocked as
advertising, and the panel approves the wording once. A provider call never raises; it returns an
`SmsResult` the caller can act on. Logs carry the masked number and the outcome, never message parameters
(an OTP code is a credential).
"""

import logging
import time
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.sms.phone import mask_mobile

SMS_IR_ENDPOINT = "https://api.sms.ir"

logger = logging.getLogger("congress.sms")


@dataclass(frozen=True)
class SmsResult:
    ok: bool
    message_id: int | None = None
    # TIMEOUT, NETWORK, HTTP_<status>, REJECTED_<sms.ir status>, PARSE
    error: str | None = None
    # Safe to send again later: the provider certainly did not accept the message.
    retryable: bool = False
    # The request may or may not have been accepted (e.g. timed out after sending); never resend blindly.
    unknown: bool = False


class SmsProvider(Protocol):
    async def send_template(self, mobile: str, template_id: int, params: Mapping[str, str]) -> SmsResult: ...

    async def aclose(self) -> None: ...


class SmsIrProvider:
    """sms.ir `POST /v1/send/verify`. Success needs HTTP 200 *and* an envelope `status` of 1."""

    def __init__(self, api_key: str, *, timeout: float = 10.0, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=SMS_IR_ENDPOINT,
            headers={"x-api-key": api_key, "Accept": "application/json"},
            timeout=httpx.Timeout(timeout),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_template(self, mobile: str, template_id: int, params: Mapping[str, str]) -> SmsResult:
        payload = {
            "mobile": mobile,
            "templateId": template_id,
            "parameters": [{"name": name, "value": value} for name, value in params.items()],
        }
        result = await self._post("/v1/send/verify", payload)
        logger.info(
            "sms.ir verify to %s template %s: %s",
            mask_mobile(mobile), template_id, "accepted" if result.ok else result.error,
        )
        return result

    async def _post(self, path: str, payload: dict[str, Any]) -> SmsResult:
        try:
            response = await self._client.post(path, json=payload)
        except (httpx.ConnectError, httpx.ConnectTimeout):
            # Nothing reached sms.ir.
            return SmsResult(ok=False, error="NETWORK", retryable=True)
        except httpx.TimeoutException:
            # The request may have been accepted before the response was lost.
            return SmsResult(ok=False, error="TIMEOUT", unknown=True)
        except httpx.HTTPError:
            return SmsResult(ok=False, error="NETWORK", retryable=True)

        if response.status_code != 200:
            retryable = response.status_code == 429 or response.status_code >= 500
            return SmsResult(ok=False, error=f"HTTP_{response.status_code}", retryable=retryable)
        try:
            body = response.json()
        except ValueError:
            return SmsResult(ok=False, error="PARSE", unknown=True)
        status = body.get("status") if isinstance(body, dict) else None
        if status != 1:
            return SmsResult(ok=False, error=f"REJECTED_{status}")
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        message_id = data.get("messageId") if isinstance(data, dict) else None
        return SmsResult(ok=True, message_id=message_id if isinstance(message_id, int) else None)


@dataclass(frozen=True)
class RecordedSms:
    mobile: str
    template_id: int
    params: dict[str, str]
    at: float


@dataclass
class RecordingProvider:
    """Sends nothing; keeps the last messages in memory (development, automated staging checks, tests).

    `log_parameters` prints parameters (including OTP codes) to the log: development only, so a developer can
    sign in without an sms.ir account. `queued_results` lets a test script provider failures in order.
    """

    log_parameters: bool = False
    messages: deque[RecordedSms] = field(default_factory=lambda: deque(maxlen=500))
    queued_results: deque[SmsResult] = field(default_factory=deque)

    async def send_template(self, mobile: str, template_id: int, params: Mapping[str, str]) -> SmsResult:
        result = self.queued_results.popleft() if self.queued_results else SmsResult(ok=True)
        if result.ok:
            self.messages.append(RecordedSms(mobile, template_id, dict(params), time.time()))
        if self.log_parameters:
            logger.warning("SMS (not sent, development) to %s template %s: %s", mobile, template_id, dict(params))
        else:
            logger.info("SMS (not sent) to %s template %s", mask_mobile(mobile), template_id)
        return result

    def sent_to(self, mobile: str) -> list[RecordedSms]:
        return [m for m in self.messages if m.mobile == mobile]

    async def aclose(self) -> None:
        return None
