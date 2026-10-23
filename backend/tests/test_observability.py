"""Request ids, structured logs, the metrics endpoint and the privacy of error reports."""

import json
import logging
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
import sentry_sdk
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sentry_sdk.envelope import Envelope
from sentry_sdk.transport import Transport
from sqlalchemy import text

from app.config import Settings
from app.logging_setup import JsonFormatter, configure_logging, request_id_var
from app.main import create_app
from app.observability import init_error_reporting, scrub_event, scrub_text
from tests.conftest import ADMIN_TOKEN, TEST_JWT_SECRET, _truncate_all, make_test_settings

METRICS_TOKEN = "metrics-token-for-tests-0123456789abcdef"


@pytest.fixture
async def observed(migrated_database: None, media_root: Path) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    await _truncate_all()
    application = create_app(make_test_settings(media_root).model_copy(update={"metrics_token": METRICS_TOKEN}))
    async with application.router.lifespan_context(application):
        async with AsyncClient(transport=ASGITransport(app=application), base_url="http://test") as http:
            yield application, http


async def test_every_response_carries_a_request_id_and_a_good_incoming_one_is_kept(client: AsyncClient) -> None:
    generated = (await client.get("/api/health")).headers["x-request-id"]
    assert len(generated) == 32 and generated != (await client.get("/api/health")).headers["x-request-id"]
    kept = await client.get("/api/health", headers={"X-Request-ID": "edge-4f1c2a9b"})
    assert kept.headers["x-request-id"] == "edge-4f1c2a9b"
    # Anything that could inject into log lines or is implausibly long is replaced.
    for bad in ('x"}\n{"level":"ERROR', "a" * 200, "short"):
        assert (await client.get("/api/health", headers={"X-Request-ID": bad})).headers["x-request-id"] != bad


def test_json_lines_carry_the_request_id_and_access_fields() -> None:
    formatter = JsonFormatter()
    token = request_id_var.set("req-12345678")
    try:
        record = logging.LogRecord(
            "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
            ("10.0.0.5:0", "GET", "/api/events/e1/attendees", "1.1", 200), None,
        )
        line = json.loads(formatter.format(record))
    finally:
        request_id_var.reset(token)
    assert line["request_id"] == "req-12345678" and line["logger"] == "uvicorn.access"
    assert (line["method"], line["path"], line["status"]) == ("GET", "/api/events/e1/attendees", 200)
    assert line["ts"].endswith("Z") and line["level"] == "INFO"
    try:
        raise ValueError("boom")
    except ValueError:
        failed = logging.LogRecord("congress.sms", logging.ERROR, __file__, 1, "send failed", (), sys.exc_info())
    parsed = json.loads(formatter.format(failed))
    assert "request_id" not in parsed and "ValueError: boom" in parsed["exc"] and "\n" not in formatter.format(failed)


def test_log_format_follows_the_environment_unless_set() -> None:
    def settings(**extra: Any) -> Settings:
        return Settings(database_url="postgresql+asyncpg://x@h/db", platform_admin_token="t" * 40,
                        jwt_secret=TEST_JWT_SECRET, media_root=Path("/data/media"), **extra)

    assert settings(environment="development").effective_log_format == "text"
    assert settings(environment="staging").effective_log_format == "json"
    assert settings(environment="staging", log_format="text").effective_log_format == "text"
    assert settings(environment="development", log_format="").effective_log_format == "text"
    with pytest.raises(ValidationError, match="CONGRESS_METRICS_TOKEN"):
        settings(environment="staging", metrics_token="short")
    assert settings(environment="development", metrics_token="short").metrics_token == "short"
    configure_logging("json")
    try:
        assert all(isinstance(h.formatter, JsonFormatter) for h in logging.getLogger("congress").handlers)
    finally:
        configure_logging("text")


async def test_metrics_need_a_configured_token(client: AsyncClient, observed: tuple[FastAPI, AsyncClient]) -> None:
    # Not configured: the endpoint does not exist.
    assert (await client.get("/api/metrics", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})).status_code == 404
    _, http = observed
    assert (await http.get("/api/metrics")).status_code == 401
    assert (await http.get("/api/metrics", headers={"Authorization": "Bearer wrong"})).status_code == 401
    assert (await http.get("/api/metrics", headers={"X-Admin-Token": ADMIN_TOKEN})).status_code == 401
    assert (await http.get("/api/metrics", headers={"Authorization": f"Bearer {METRICS_TOKEN}"})).status_code == 200


async def test_metrics_report_route_templates_scans_sms_and_outbox_lag(observed: tuple[FastAPI, AsyncClient]) -> None:
    application, http = observed
    await http.get("/api/public/events/a-secret-slug-0912")
    async with application.state.sessionmaker() as session:
        await session.execute(text(
            "INSERT INTO sms_messages (id, kind, mobile, status, send_after) "
            "VALUES (gen_random_uuid(), 'ticket_confirmation', '09121234567', 'pending', now() - interval '90 seconds')"
        ))
        await session.commit()

    body = (await http.get("/api/metrics", headers={"Authorization": f"Bearer {METRICS_TOKEN}"})).text

    assert 'congress_http_requests_total{method="GET",route="/api/public/events/{slug}",status="404"} 1.0' in body
    assert 'congress_http_request_duration_seconds_count{method="GET",route="/api/public/events/{slug}"} 1.0' in body
    assert "a-secret-slug" not in body and "09121234567" not in body
    assert "congress_database_up 1.0" in body
    assert "# TYPE congress_scans_total counter" in body
    assert 'congress_sms_messages{kind="ticket_confirmation",status="pending"} 1.0' in body
    assert "congress_sms_outbox_due 1.0" in body
    lag = next(float(line.split()[1]) for line in body.splitlines() if line.startswith("congress_sms_outbox_lag_seconds "))
    assert 85 <= lag < 600
    assert '"/api/metrics"' not in json.dumps((await http.get("/openapi.json")).json()["paths"])


class CapturingTransport(Transport):
    def __init__(self, options: Any = None) -> None:
        super().__init__(options)
        self.events: list[dict[str, Any]] = []

    def capture_envelope(self, envelope: Envelope) -> None:
        for item in envelope.items:
            if item.type == "event" and item.payload.json is not None:
                self.events.append(item.payload.json)


def test_scrub_masks_mobiles_tokens_and_secrets() -> None:
    masked = scrub_text(
        "user 09121234567 / +989121234567 Bearer abc.def eyJhbGciOi.eyJzdWIi.c2ln token=XYZ123 otp_code: 4821 "
        "event 7d4c9a1e-1111-2222-3333-444455556666 status code 500"
    )
    assert "09121234567" not in masked and "989121234567" not in masked and "abc.def" not in masked
    assert "eyJ" not in masked and "XYZ123" not in masked and "4821" not in masked
    # Identifiers and ordinary numbers stay useful.
    assert "7d4c9a1e-1111-2222-3333-444455556666" in masked and "status code 500" in masked


def test_error_events_carry_no_personal_data(media_root: Path) -> None:
    event = scrub_event({
        "request": {"url": "https://x.test/api/auth/otp?mobile=09121234567", "method": "POST",
                    "headers": {"Authorization": "Bearer s3cret"}, "data": {"mobile": "09121234567"},
                    "cookies": {"a": "b"}, "query_string": "mobile=09121234567"},
        "user": {"ip_address": "1.2.3.4"},
        "exception": {"values": [{"type": "ValueError", "value": "no ticket for 09121234567"}]},
        "breadcrumbs": {"values": [{"message": "sms sent to 9121234567"}]},
    })
    dumped = json.dumps(event)
    assert "9121234567" not in dumped and "s3cret" not in dumped and "1.2.3.4" not in dumped
    assert event["request"] == {"url": "https://x.test/api/auth/otp", "method": "POST"}
    assert event["exception"]["values"][0]["value"] == "no ticket for [mobile]"


async def test_an_unhandled_error_is_reported_without_request_data(media_root: Path) -> None:
    transport = CapturingTransport()
    settings = make_test_settings(media_root).model_copy(update={"sentry_dsn": "https://public@errors.example.invalid/1"})
    assert init_error_reporting(make_test_settings(media_root)) is False
    try:
        assert init_error_reporting(settings, transport=transport)
        application = create_app(make_test_settings(media_root))

        async def fail() -> None:
            raise RuntimeError("lookup failed for 09121234567 with token=abcdef123456")

        application.add_api_route("/api/test-failure", fail)
        async with AsyncClient(transport=ASGITransport(app=application, raise_app_exceptions=False), base_url="http://test") as http:
            response = await http.get("/api/test-failure?mobile=09121234567", headers={"Authorization": "Bearer s3cret-token"})
        assert response.status_code == 500
        sentry_sdk.flush()
    finally:
        sentry_sdk.init()  # no DSN: reporting off again for the rest of the suite
    assert transport.events, "the error was not reported"
    dumped = json.dumps(transport.events)
    assert "lookup failed for [mobile]" in dumped and "token=[redacted]" in dumped
    for leaked in ("09121234567", "abcdef123456", "s3cret-token"):
        assert leaked not in dumped, leaked
    event = transport.events[0]
    assert event["request"]["url"] == "http://test/api/test-failure"
    assert set(event["request"]) <= {"url", "method"} and "user" not in event
    assert event["tags"]["request_id"]
