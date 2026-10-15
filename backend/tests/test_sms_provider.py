"""sms.ir client: request shape and the classification of every outcome (no network)."""

import json
from collections.abc import Callable

import httpx
import pytest

from app.sms.provider import SmsIrProvider, SmsResult

Handler = Callable[[httpx.Request], httpx.Response]


async def send(handler: Handler) -> tuple[SmsResult, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    provider = SmsIrProvider("panel-key", transport=httpx.MockTransport(record))
    try:
        result = await provider.send_template("09121234567", 123456, {"CODE": "482913"})
    finally:
        await provider.aclose()
    return result, seen


async def test_verify_request_matches_the_smsir_contract() -> None:
    result, seen = await send(
        lambda _: httpx.Response(200, json={"status": 1, "message": "موفق", "data": {"messageId": 98765, "cost": 1.0}})
    )

    assert result == SmsResult(ok=True, message_id=98765)
    (request,) = seen
    assert request.method == "POST"
    assert str(request.url) == "https://api.sms.ir/v1/send/verify"
    assert request.headers["x-api-key"] == "panel-key"
    assert json.loads(request.content) == {
        "mobile": "09121234567",
        "templateId": 123456,
        "parameters": [{"name": "CODE", "value": "482913"}],
    }


async def test_http_200_with_a_failure_status_is_a_refusal_not_a_success() -> None:
    result, _ = await send(lambda _: httpx.Response(200, json={"status": 0, "message": "invalid template"}))
    assert result.ok is False
    assert result.error == "REJECTED_0"
    assert result.retryable is False and result.unknown is False


@pytest.mark.parametrize(
    ("status", "retryable"), [(400, False), (401, False), (403, False), (429, True), (500, True), (503, True)]
)
async def test_http_errors_are_classified(status: int, retryable: bool) -> None:
    result, _ = await send(lambda _: httpx.Response(status, json={"status": 0}))
    assert result == SmsResult(ok=False, error=f"HTTP_{status}", retryable=retryable)


async def test_connection_failure_is_retryable_because_nothing_was_sent() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    result, _ = await send(refuse)
    assert result == SmsResult(ok=False, error="NETWORK", retryable=True)


async def test_timeout_after_sending_is_unknown_and_never_retried() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("no response", request=request)

    result, _ = await send(slow)
    assert result == SmsResult(ok=False, error="TIMEOUT", unknown=True)


async def test_unparseable_success_response_is_unknown() -> None:
    result, _ = await send(lambda _: httpx.Response(200, text="<html>gateway</html>"))
    assert result == SmsResult(ok=False, error="PARSE", unknown=True)
