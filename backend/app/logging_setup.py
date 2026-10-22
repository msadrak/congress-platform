"""Process logging for deployed runs (`create_app_from_env`).

- The application's own loggers (`congress.*`: SMS delivery, outbox, platform settings) are written to stdout at
  INFO; without this they are silently dropped, because uvicorn only configures its own loggers.
- Every line gets a UTC timestamp.
- The access log leaves out the health and readiness probes (the container health check calls them every few
  seconds and would bury real traffic) and never records query strings, which can carry personal data
  (attendee search `?q=` with names or mobile numbers).
"""

import logging
import sys
import time

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
PROBES = ("/api/health", "/api/ready")


def _utc_formatter() -> logging.Formatter:
    formatter = logging.Formatter(FORMAT, "%Y-%m-%dT%H:%M:%SZ")
    formatter.converter = time.gmtime
    return formatter


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


def configure_logging() -> None:
    formatter = _utc_formatter()
    app_logger = logging.getLogger("congress")
    if not app_logger.handlers:
        stdout = logging.StreamHandler(sys.stdout)
        stdout.setFormatter(formatter)
        app_logger.addHandler(stdout)
    app_logger.setLevel(logging.INFO)
    app_logger.propagate = False

    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, AccessLogFilter) for f in access.filters):
        access.addFilter(AccessLogFilter())
    # uvicorn's server messages are handled on the parent "uvicorn" logger, its access lines on "uvicorn.access".
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            handler.setFormatter(formatter)
