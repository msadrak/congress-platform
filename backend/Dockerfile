# syntax=docker/dockerfile:1
# Congress Platform API. Dependencies come from uv.lock (reproducible); the runtime image holds only the
# virtualenv, the application and its migrations, and runs as an unprivileged user. Configuration is
# supplied at runtime (CONGRESS_* environment); nothing secret is baked in.

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS deps
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock ./
# Build-time proxy (deploy/proxy/congress-proxy.sh stack up). Declared per RUN so layer cache is not tied to proxy env.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
RUN --mount=type=cache,target=/root/.cache/uv \
    HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} https_proxy=${HTTPS_PROXY} no_proxy=${NO_PROXY} \
    uv sync --frozen --no-dev --no-install-project

# Same base as deps (ghcr.io) — avoids docker.io pulls that often 403 through an SSH SOCKS tunnel.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS runtime
RUN groupadd --system --gid 10001 congress \
 && useradd --system --uid 10001 --gid congress --home-dir /app --shell /usr/sbin/nologin congress \
 && mkdir -p /data/media \
 && chown congress:congress /data/media
WORKDIR /app
COPY --from=deps /app/.venv /app/.venv
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONGRESS_MEDIA_ROOT=/data/media
USER congress:congress
VOLUME ["/data/media"]
EXPOSE 8000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/ready', timeout=4).status == 200 else 1)"]
# uvicorn is PID 1 (exec form): SIGTERM drains in-flight requests, then the process exits.
CMD ["uvicorn", "app.main:create_app_from_env", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header", "--timeout-graceful-shutdown", "20"]
