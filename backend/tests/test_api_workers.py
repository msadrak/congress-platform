"""Several API worker processes (CONGRESS_API_WORKERS, app/serve.py): the image starts uvicorn with that many
workers, the metrics stay the API's totals whichever worker answers a scrape, and the background retention pass
runs in one process at a time."""

import os
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import asyncpg
import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app import serve
from app.config import Settings
from app.retention import RETENTION_LOCK_KEY, retention_pass
from tests.conftest import ADMIN_TOKEN, BACKEND_DIR, TEST_JWT_SECRET, TEST_URL, make_test_settings

METRICS_TOKEN = "metrics-token-for-tests-0123456789abcdef"
HEALTH_SERIES = re.compile(r'^congress_http_requests_total\{method="GET",route="/api/health",status="200"\} (\S+)$', re.M)


def test_the_image_command_runs_the_configured_number_of_workers() -> None:
    argv = serve.uvicorn_argv(4)
    assert argv[:3] == ["uvicorn", "app.main:create_app_from_env", "--factory"]
    assert argv[argv.index("--workers") + 1] == "4"
    assert argv[argv.index("--port") + 1] == "8000"
    assert "--proxy-headers" in argv and "--timeout-graceful-shutdown" in argv


def test_the_worker_count_is_bounded(tmp_path: Path) -> None:
    base = make_test_settings(tmp_path).model_dump()
    assert Settings.model_validate(base).api_workers == 1
    assert Settings.model_validate({**base, "api_workers": 4}).api_workers == 4
    for wrong in (0, 33):
        with pytest.raises(ValidationError):
            Settings.model_validate({**base, "api_workers": wrong})


def test_shared_metric_files_are_set_up_only_for_several_workers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    environ: dict[str, str] = {}
    assert serve.prepare_metrics_dir(1, environ) is None and environ == {}

    monkeypatch.setattr(serve, "METRICS_DIR", str(tmp_path / "default"))
    assert serve.prepare_metrics_dir(2, environ) == tmp_path / "default"
    assert environ["PROMETHEUS_MULTIPROC_DIR"] == str(tmp_path / "default")

    # A directory chosen by the operator is kept; only the counter files of an earlier run are removed.
    chosen = tmp_path / "chosen"
    chosen.mkdir()
    (chosen / "counter_123.db").write_bytes(b"old")
    (chosen / "notes.txt").write_text("keep")
    environ = {"PROMETHEUS_MULTIPROC_DIR": str(chosen)}
    assert serve.prepare_metrics_dir(3, environ) == chosen
    assert sorted(p.name for p in chosen.iterdir()) == ["notes.txt"]


def _child_env(metrics_dir: Path) -> dict[str, str]:
    return {**os.environ, "PROMETHEUS_MULTIPROC_DIR": str(metrics_dir), "PYTHONPATH": str(BACKEND_DIR)}


def test_a_scrape_sums_the_counters_of_every_worker(tmp_path: Path) -> None:
    """Two processes count requests; a third one's scrape reports both (deterministic, without uvicorn)."""
    metrics_dir = tmp_path / "metrics"
    metrics_dir.mkdir()
    count = (
        "from app.observability import Metrics\n"
        "m = Metrics()\n"
        "for _ in range({n}): m.observe('GET', '/api/health', 200, 0.01)\n"
    )
    for n in (3, 4):
        subprocess.run([sys.executable, "-c", count.format(n=n)], env=_child_env(metrics_dir), check=True, timeout=60)
    scrape = (
        "from prometheus_client import generate_latest\n"
        "from app.observability import Metrics, scrape_registry\n"
        "print(generate_latest(scrape_registry(Metrics())).decode())\n"
    )
    out = subprocess.run(
        [sys.executable, "-c", scrape], env=_child_env(metrics_dir), check=True, timeout=60, capture_output=True, text=True
    ).stdout
    match = HEALTH_SERIES.search(out)
    assert match and float(match.group(1)) == 7, out
    assert "congress_http_request_duration_seconds_count" in out


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


def test_the_api_serves_with_two_workers_and_scrapes_agree(tmp_path: Path) -> None:
    port = _free_port()
    metrics_dir = tmp_path / "metrics"
    env = {
        **_child_env(metrics_dir),
        "PATH": f"{Path(sys.executable).parent}{os.pathsep}{os.environ.get('PATH', '')}",
        "CONGRESS_ENVIRONMENT": "test",
        "CONGRESS_DATABASE_URL": TEST_URL,
        "CONGRESS_PLATFORM_ADMIN_TOKEN": ADMIN_TOKEN,
        "CONGRESS_JWT_SECRET": TEST_JWT_SECRET,
        "CONGRESS_MEDIA_ROOT": str(tmp_path / "media"),
        "CONGRESS_METRICS_TOKEN": METRICS_TOKEN,
        "CONGRESS_API_WORKERS": "2",
        "CONGRESS_SMS_OUTBOX_ENABLED": "false",
        "CONGRESS_RETENTION_ENABLED": "false",
    }
    # app.serve's own steps, on a free port instead of 8000.
    launch = (
        "import os\nfrom app import serve\nfrom app.config import Settings\n"
        "workers = Settings().api_workers\nserve.prepare_metrics_dir(workers, os.environ)\n"
        f"argv = serve.uvicorn_argv(workers, port={port})\nos.execvp(argv[0], argv)\n"
    )
    log = tmp_path / "api.log"
    with log.open("w") as sink:
        api = subprocess.Popen([sys.executable, "-c", launch], env=env, cwd=BACKEND_DIR, stdout=sink, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(120):
            try:
                if httpx.get(f"{base}/api/ready", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert api.poll() is None, log.read_text()
            time.sleep(0.25)
        else:
            raise AssertionError(f"the API never became ready:\n{log.read_text()}")
        # Each request on a new connection, so the workers share them out.
        close = {"Connection": "close"}
        for _ in range(30):
            assert httpx.get(f"{base}/api/health", headers=close, timeout=5).status_code == 200
        totals = set()
        for _ in range(8):
            scraped = httpx.get(
                f"{base}/api/metrics", headers={**close, "Authorization": f"Bearer {METRICS_TOKEN}"}, timeout=10
            )
            assert scraped.status_code == 200, scraped.text
            match = HEALTH_SERIES.search(scraped.text)
            assert match, scraped.text
            totals.add(float(match.group(1)))
        assert totals == {30.0}
    finally:
        api.send_signal(signal.SIGTERM)
        try:
            api.wait(timeout=40)
        except subprocess.TimeoutExpired:
            api.kill()
            api.wait()
    started = re.findall(r"Started server process \[(\d+)\]", log.read_text())
    assert len(set(started)) == 2, log.read_text()


async def test_only_one_process_runs_a_retention_pass_at_a_time(app: FastAPI) -> None:
    other = await asyncpg.connect(TEST_URL.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        await other.execute("SELECT pg_advisory_lock($1)", RETENTION_LOCK_KEY)
        assert await retention_pass(app.state.sessionmaker, app.state.settings) is None
        await other.execute("SELECT pg_advisory_unlock($1)", RETENTION_LOCK_KEY)
        assert await retention_pass(app.state.sessionmaker, app.state.settings) is not None
    finally:
        await other.close()
