"""The API image's entry point: `python -m app.serve` starts uvicorn with `CONGRESS_API_WORKERS` processes.

The settings are validated once here (a misconfigured deployment stops with the list of what to fix, as
`create_app_from_env` does), then this process is replaced by uvicorn (exec), so uvicorn stays PID 1 and SIGTERM
drains in-flight requests. With more than one worker the Prometheus counters are kept in files shared by the
workers (`PROMETHEUS_MULTIPROC_DIR`, emptied at every start), so a scrape reports the whole API, whichever worker
answers it (app/observability.py).
"""

import os
from collections.abc import MutableMapping
from pathlib import Path

from pydantic import ValidationError

from app.config import Settings, describe_settings_error

# Inside the container; emptied at every start, so counters of an earlier run never add up with this one's.
METRICS_DIR = "/tmp/congress-metrics"


def uvicorn_argv(workers: int, port: int = 8000) -> list[str]:
    return [
        "uvicorn", "app.main:create_app_from_env", "--factory", "--host", "0.0.0.0", "--port", str(port),
        "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header", "--timeout-graceful-shutdown", "20",
        "--workers", str(workers),
    ]


def prepare_metrics_dir(workers: int, environ: MutableMapping[str, str]) -> Path | None:
    """With several workers: an empty directory for the shared Prometheus counters, exported to the workers."""
    if workers <= 1:
        return None
    directory = Path(environ.setdefault("PROMETHEUS_MULTIPROC_DIR", METRICS_DIR))
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.db"):
        stale.unlink()
    return directory


def main() -> None:
    try:
        settings = Settings()
    except ValidationError as exc:
        raise SystemExit(describe_settings_error(exc)) from None
    prepare_metrics_dir(settings.api_workers, os.environ)
    argv = uvicorn_argv(settings.api_workers)
    os.execvp(argv[0], argv)


if __name__ == "__main__":
    main()
