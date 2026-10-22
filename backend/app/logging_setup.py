"""Process logging for deployed runs (`create_app_from_env`).

- The application's own loggers (`congress.*`: SMS delivery, outbox, platform settings) are written to stdout at
  INFO; without this they are silently dropped, because uvicorn only configures its own loggers.
- Two formats (CONGRESS_LOG_FORMAT): `json`, one object per line for log shippers (the default in staging and
  production), and `text` for people (the default in development). Every line has a UTC timestamp, and every line
  written while a request is handled carries that request's id (`X-Request-ID`, app/observability.py).
- The access log leaves out the health and readiness probes (the container health check calls them every few
  seconds and would bury real traffic) and never records query strings, which can carry personal data
  (attendee search `?q=` with names or mobile numbers).
"""

import json
import logging
import sys
import time
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Literal

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
PROBES = ("/api/health", "/api/ready")

# The id of the request being handled; set by app.observability.RequestContextMiddleware.
request_id_var: ContextVar[str | None] = ContextVar("congress_request_id", default=None)


def _utc_formatter() -> logging.Formatter:
    formatter = logging.Formatter(FORMAT, "%Y-%m-%dT%H:%M:%SZ")
    formatter.converter = time.gmtime
    return formatter


class JsonFormatter(logging.Formatter):
    """One JSON object per line: ts, level, logger, msg, request_id, and the fields of an access line."""

    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id:
            line["request_id"] = request_id
        args = record.args
        if record.name == "uvicorn.access" and isinstance(args, tuple) and len(args) >= 5:
            line.update(client=args[0], method=args[1], path=args[2], status=args[4])
        if record.exc_info:
            line["exc"] = self.formatException(record.exc_info)
        if record.stack_info:
            line["stack"] = self.formatStack(record.stack_info)
        return json.dumps(line, ensure_ascii=False, default=str)


class AccessLogFilter(logging.Filter):
    """uvicorn access records carry (client, method, path, http version, status) as args."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            path = args[2].split("?", 1)[0]
            if path in PROBES:
                return False
            record.args = (*args[:2], path, *args[3:])
        return True


def configure_logging(log_format: Literal["json", "text"] = "text") -> None:
    formatter = JsonFormatter() if log_format == "json" else _utc_formatter()
    app_logger = logging.getLogger("congress")
    if not app_logger.handlers:
        app_logger.addHandler(logging.StreamHandler(sys.stdout))
    for handler in app_logger.handlers:
        handler.setFormatter(formatter)
    app_logger.setLevel(logging.INFO)
    app_logger.propagate = False

    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, AccessLogFilter) for f in access.filters):
        access.addFilter(AccessLogFilter())
    # uvicorn's server messages are handled on the parent "uvicorn" logger, its access lines on "uvicorn.access".
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            handler.setFormatter(formatter)
