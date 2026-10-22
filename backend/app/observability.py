"""Request ids, Prometheus metrics and optional error reporting.

- **Request id.** Every HTTP request gets an id: a well-formed incoming `X-Request-ID` is kept (so an id set at
  the edge or by a client follows the request), anything else is replaced by a fresh one. It is returned in the
  `X-Request-ID` response header and attached to every log line written while the request is handled.
- **Metrics** at `/api/metrics` (Prometheus text format), only with `Authorization: Bearer <CONGRESS_METRICS_TOKEN>`;
  without a configured token the endpoint does not exist (404). The edge also refuses it to addresses outside
  CONGRESS_METRICS_ALLOW (deploy/staging/Caddyfile). Request counts and latency are per route *template*
  (`/api/events/{event_id}`), never the concrete path, so ids and personal data never become label values.
  Scan outcomes, SMS states and the outbox lag are read from the database at scrape time, so they survive
  restarts and are the same whichever process answers.
- **Error reporting** to Sentry or GlitchTip when CONGRESS_SENTRY_DSN is set. Nothing personal leaves the server:
  no request bodies, headers, cookies, query strings, user or local variables, and mobile numbers, bearer tokens,
  JWTs and `token=`/`code=`-style values are masked in every string of the event.
"""

import hmac
import re
import time
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

import sentry_sdk
from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import PlainTextResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest
from prometheus_client.core import CounterMetricFamily, GaugeMetricFamily, Metric
from prometheus_client.registry import Collector
from sqlalchemy import text
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings
from app.logging_setup import request_id_var

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"[A-Za-z0-9._:-]{8,128}")
LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
DB_QUERY_TIMEOUT_MS = 5000


class Metrics:
    """One registry per application (tests build many apps in one process)."""

    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        self.requests = Counter(
            "congress_http_requests", "HTTP requests by method, route template and status.",
            ["method", "route", "status"], registry=self.registry,
        )
        self.latency = Histogram(
            "congress_http_request_duration_seconds", "HTTP request duration by method and route template.",
            ["method", "route"], buckets=LATENCY_BUCKETS, registry=self.registry,
        )
        self.database = DatabaseSnapshot()
        self.registry.register(self.database)

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        self.requests.labels(method, route, str(status)).inc()
        self.latency.labels(method, route).observe(seconds)


class DatabaseSnapshot(Collector):
    """Values read from the database just before each scrape (see `refresh`)."""

    def __init__(self) -> None:
        self.up = 0
        self.scans: list[tuple[str, str, int]] = []
        self.sms: list[tuple[str, str, int]] = []
        self.outbox_due = 0
        self.outbox_lag_seconds = 0.0

    async def refresh(self, request: Request) -> None:
        try:
            async with request.app.state.sessionmaker() as session:
                await session.execute(text(f"SET LOCAL statement_timeout = {DB_QUERY_TIMEOUT_MS}"))
                scans = await session.execute(text(
                    "SELECT status, coalesce(rejection_reason, ''), count(*) FROM checkins GROUP BY 1, 2"
                ))
                sms = await session.execute(text("SELECT kind, status, count(*) FROM sms_messages GROUP BY 1, 2"))
                due = (await session.execute(text(
                    "SELECT count(*), min(send_after) FROM sms_messages "
                    "WHERE status = 'pending' AND send_after <= now()"
                ))).one()
        except Exception:
            self.up = 0
            return
        self.up = 1
        self.scans = [(str(s), str(r), int(n)) for s, r, n in scans.all()]
        self.sms = [(str(k), str(s), int(n)) for k, s, n in sms.all()]
        self.outbox_due = int(due[0])
        oldest: datetime | None = due[1]
        self.outbox_lag_seconds = max(0.0, (datetime.now(UTC) - oldest).total_seconds()) if oldest else 0.0

    def collect(self) -> Iterable[Metric]:
        yield GaugeMetricFamily("congress_database_up", "1 when the metrics queries reached the database.", value=self.up)
        scans = CounterMetricFamily(
            "congress_scans", "Admission scans recorded, by status (ADMITTED/REJECTED) and rejection reason.",
            labels=["status", "reason"],
        )
        for status, reason, count in self.scans:
            scans.add_metric([status, reason], count)
        yield scans
        sms = GaugeMetricFamily("congress_sms_messages", "SMS messages in the delivery log by kind and status.", labels=["kind", "status"])
        for kind, status, count in self.sms:
            sms.add_metric([kind, status], count)
        yield sms
        yield GaugeMetricFamily("congress_sms_outbox_due", "Queued SMS whose send time has passed.", value=self.outbox_due)
        yield GaugeMetricFamily(
            "congress_sms_outbox_lag_seconds", "Age of the oldest queued SMS that is due (0 when none).",
            value=self.outbox_lag_seconds,
        )


def _route_template(scope: Scope) -> str:
    path = getattr(scope.get("route"), "path", None)
    return path if isinstance(path, str) else "unmatched"


class RequestContextMiddleware:
    """Request id for logs and the response header, and per-route request metrics (pure ASGI)."""

    def __init__(self, app: ASGIApp, metrics: Metrics) -> None:
        self.app = app
        self.metrics = metrics

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"x-request-id"), "")
        request_id = incoming if _VALID_REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        if sentry_sdk.get_client().is_active():
            # Unhandled errors are captured outside this middleware, after the id is reset: tag the scope.
            sentry_sdk.set_tag("request_id", request_id)
        status = 500
        started = time.perf_counter()

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            self.metrics.observe(scope["method"], _route_template(scope), status, time.perf_counter() - started)
            request_id_var.reset(token)


metrics_router = APIRouter()


@metrics_router.get("/api/metrics", include_in_schema=False)
async def metrics(request: Request) -> Response:
    token = request.app.state.settings.metrics_token.strip()
    if not token:
        return PlainTextResponse("Not Found", status_code=404)
    scheme, _, supplied = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(supplied.strip().encode(), token.encode()):
        return PlainTextResponse("Unauthorized", status_code=401, headers={"WWW-Authenticate": "Bearer"})
    app_metrics: Metrics = request.app.state.metrics
    await app_metrics.database.refresh(request)
    return Response(generate_latest(app_metrics.registry), media_type=CONTENT_TYPE_LATEST)


# ── Error reporting ─────────────────────────────────────────────────────────────────────────────────

_SCRUB_PATTERNS = (
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "[jwt]"),
    (re.compile(r"(?i)\bbearer\s+[^\s\"',;]+"), "Bearer [redacted]"),
    (
        re.compile(r"(?i)\b(token|secret|password|passwd|api[_-]?key|x-admin-token|authorization|otp"
                   r"|(?:sms|otp|verification|sign[_-]?in)[_-]?code)(\"?'?\s*[:=]\s*\"?'?)[^\s\"'&,;)}]+"),
        r"\1\2[redacted]",
    ),
    # Iranian mobile numbers in every common spelling (09…, 9…, +989…, 00989…).
    (re.compile(r"(?<!\d)(?:\+98|0098|98|0)?9\d{9}(?!\d)"), "[mobile]"),
)
# Event fields that may carry request data or identities; dropped whole.
_DROPPED_REQUEST_KEYS = ("data", "cookies", "headers", "query_string", "env")


def scrub_text(value: str) -> str:
    for pattern, replacement in _SCRUB_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_scrub(v) for v in value]
    return value


def scrub_event(event: Any, hint: Any = None) -> Any:
    """Sentry `before_send`: keep the error and where it happened, drop everything about the person."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in _DROPPED_REQUEST_KEYS:
            request.pop(key, None)
        if isinstance(request.get("url"), str):
            request["url"] = request["url"].split("?", 1)[0]
    event.pop("user", None)
    event.pop("extra", None)
    request_id = request_id_var.get()
    if request_id:
        event.setdefault("tags", {})["request_id"] = request_id
    return _scrub(event)


def scrub_breadcrumb(crumb: Any, hint: Any = None) -> Any:
    return _scrub(crumb)


def init_error_reporting(settings: Settings, **options: Any) -> bool:
    """`options` go to sentry_sdk.init unchanged (the tests pass a capturing transport)."""
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        return False
    sentry_sdk.init(
        **options,
        dsn=dsn,
        environment=settings.environment,
        # Personal data stays off by default (send_default_pii is unset); scrub_event removes the rest.
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    return True


def install_observability(app: FastAPI, settings: Settings) -> None:
    """Request ids + metrics middleware (outermost, so it sees every response) and the metrics endpoint."""
    app.state.metrics = Metrics()
    app.add_middleware(RequestContextMiddleware, metrics=app.state.metrics)
    app.include_router(metrics_router)
    init_error_reporting(settings)

