"""SMS delivery through sms.ir (https://api.sms.ir, REST v1), plus a recording provider for development.

Messages are plain text sent from the platform's sms.ir service line (`POST /v1/send/bulk` with one mobile);
the wording comes from the app's own templates (app/sms/templates.py), not from sms.ir panel templates. A
provider call never raises; it returns an `SmsResult` the caller can act on. Logs carry the masked number and
the outcome, never the text (a sign-in code is a credential).
"""

import logging
import time
from collections import deque
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
    async def send_text(self, mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        """`kind` labels the message in logs; `code` (sign-in codes only) is kept solely by the recording provider."""
        ...

    async def aclose(self) -> None: ...


class SmsIrProvider:
    """sms.ir `POST /v1/send/bulk` from a service line. Success needs HTTP 200 *and* an envelope `status` of 1."""

    def __init__(
        self,
        api_key: str,
        line_number: int,
        *,
        timeout: float = 5.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._line_number = line_number
        self._client = httpx.AsyncClient(
            base_url=SMS_IR_ENDPOINT,
            headers={"x-api-key": api_key, "Accept": "application/json"},
            timeout=httpx.Timeout(timeout),
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_text(self, mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        payload = {"lineNumber": self._line_number, "messageText": text, "mobiles": [mobile]}
        result = await self._post("/v1/send/bulk", payload)
        logger.info("sms.ir %s to %s: %s", kind, mask_mobile(mobile), "accepted" if result.ok else result.error)
        return result

    async def account(self) -> tuple[SmsResult, float | None, list[int]]:
        """Credit and the account's line numbers (`GET /v1/credit`, `GET /v1/line`), for the console's check."""
        credit_result, credit_body = await self._get("/v1/credit")
        if not credit_result.ok:
            return credit_result, None, []
        credit = credit_body.get("data") if isinstance(credit_body, dict) else None
        lines_result, lines_body = await self._get("/v1/line")
        raw = lines_body.get("data") if lines_result.ok and isinstance(lines_body, dict) else None
        lines = [int(n) for n in raw if str(n).isdigit()] if isinstance(raw, list) else []
        return credit_result, float(credit) if isinstance(credit, (int, float)) else None, lines

    async def _get(self, path: str) -> tuple[SmsResult, Any]:
        try:
            response = await self._client.get(path)
        except httpx.TimeoutException:
            return SmsResult(ok=False, error="TIMEOUT", unknown=True), None
        except httpx.HTTPError:
            return SmsResult(ok=False, error="NETWORK", retryable=True), None
        if response.status_code != 200:
            return SmsResult(ok=False, error=f"HTTP_{response.status_code}"), None
        try:
            body = response.json()
        except ValueError:
            return SmsResult(ok=False, error="PARSE"), None
        if not isinstance(body, dict) or body.get("status") != 1:
            return SmsResult(ok=False, error=f"REJECTED_{body.get('status') if isinstance(body, dict) else None}"), None
        return SmsResult(ok=True), body

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
        ids = data.get("messageIds") if isinstance(data, dict) else None
        first = ids[0] if isinstance(ids, list) and ids else None
        return SmsResult(ok=True, message_id=first if isinstance(first, int) else None)


@dataclass(frozen=True)
class RecordedSms:
    mobile: str
    kind: str
    text: str
    code: str | None
    at: float


@dataclass
class RecordingProvider:
    """Sends nothing; keeps the last messages in memory (development, automated staging checks, tests).

    `log_text` prints the text (including sign-in codes) to the log: development only, so a developer can sign
    in without an sms.ir account. `queued_results` lets a test script provider failures in order.
    """

    log_text: bool = False
    messages: deque[RecordedSms] = field(default_factory=lambda: deque(maxlen=500))
    queued_results: deque[SmsResult] = field(default_factory=deque)

    async def send_text(self, mobile: str, text: str, *, kind: str, code: str | None = None) -> SmsResult:
        result = self.queued_results.popleft() if self.queued_results else SmsResult(ok=True)
        if result.ok:
            self.messages.append(RecordedSms(mobile, kind, text, code, time.time()))
        if self.log_text:
            logger.warning("SMS (not sent, development) %s to %s:\n%s", kind, mobile, text)
        else:
            logger.info("SMS (not sent) %s to %s", kind, mask_mobile(mobile))
        return result

    def sent_to(self, mobile: str) -> list[RecordedSms]:
        return [m for m in self.messages if m.mobile == mobile]

    async def aclose(self) -> None:
        return None
