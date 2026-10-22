"""Deployed logging: probes and query strings stay out of the access log; app loggers are visible."""

import logging

from app.logging_setup import AccessLogFilter, configure_logging


def access_record(path: str) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
        ("10.0.0.5:0", "GET", path, "1.1", 200), None,
    )


def test_probes_are_dropped_and_query_strings_never_logged() -> None:
    access_filter = AccessLogFilter()
    assert access_filter.filter(access_record("/api/ready")) is False
    assert access_filter.filter(access_record("/api/health?x=1")) is False
    record = access_record("/api/events/e1/attendees?q=09121234567&limit=30")
    assert access_filter.filter(record) is True
    assert record.getMessage() == '10.0.0.5:0 - "GET /api/events/e1/attendees HTTP/1.1" 200'


def test_application_loggers_are_written_with_a_timestamp() -> None:
    configure_logging()
    assert logging.getLogger("congress.sms").getEffectiveLevel() == logging.INFO
    handler = next(
        h for h in logging.getLogger("congress").handlers
        if isinstance(h, logging.StreamHandler) and h.formatter is not None and "%(asctime)s" in (h.formatter._fmt or "")
    )
    line = handler.format(logging.LogRecord("congress.sms", logging.INFO, __file__, 1, "sent to %s", ("0912***4567",), None))
    assert line.endswith("INFO congress.sms: sent to 0912***4567") and line[4] == "-" and line[19] == "Z"
