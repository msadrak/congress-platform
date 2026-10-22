# syntax=docker/dockerfile:1
# Backend test runner: Python 3.11, uv and every locked dependency (dev group included) in /app/.venv, nothing
# else. The source, migrations and tests are copied in per run by scripts/integration/*.mjs, so the image only
# changes with the lock file. Built and tagged by scripts/lib/backend-image.mjs:
#   congress-backend-test:<hash of this file, backend/pyproject.toml and backend/uv.lock>
# Build context: backend/ (backend/.dockerignore keeps the local .venv and caches out).

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim
ENV UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_HTTP_TIMEOUT=120 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
# Build-time proxy, as in backend/Dockerfile. Declared per RUN so layer cache is not tied to proxy env.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
# The package index is reached over a flaky network: a generous timeout and up to three attempts.
RUN --mount=type=cache,target=/root/.cache/uv \
    export HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} NO_PROXY=${NO_PROXY} \
           http_proxy=${HTTP_PROXY} https_proxy=${HTTPS_PROXY} no_proxy=${NO_PROXY}; \
    for attempt in 1 2 3; do \
      uv sync --frozen --no-install-project && exit 0; \
      echo "uv sync attempt ${attempt} failed; retrying" >&2; sleep $((attempt * 5)); \
    done; exit 1
