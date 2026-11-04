# syntax=docker/dockerfile:1
# Web edge for staging/production: the real Vite production bundle served by Caddy, which also terminates
# HTTPS and reverse-proxies /api to the API container. Build context: repository root.

# AWS ECR Public copy of Docker Library — docker.io CloudFront often returns 403 via bastion SOCKS.
FROM public.ecr.aws/docker/library/node:26-bookworm-slim AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
RUN --mount=type=cache,target=/root/.npm \
    HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} NO_PROXY=${NO_PROXY} \
    http_proxy=${HTTP_PROXY} https_proxy=${HTTPS_PROXY} no_proxy=${NO_PROXY} \
    npm ci --no-audit --no-fund
COPY web/ ./
COPY deploy/web/make-seo-shell.mjs /tools/make-seo-shell.mjs
# The build id the scanner shows and reports (e.g. --build-arg CONGRESS_APP_BUILD=$(git rev-parse --short=10 HEAD));
# without it the build time is used (the image has no .git).
ARG CONGRESS_APP_BUILD=""
RUN CONGRESS_APP_BUILD=${CONGRESS_APP_BUILD} npm run build && node /tools/make-seo-shell.mjs dist

# Same image (same digest) as caddy:2-alpine on Docker Hub; mirror.gcr.io answers 403 through the bastion.
FROM public.ecr.aws/docker/library/caddy:2-alpine
COPY deploy/staging/Caddyfile /etc/caddy/Caddyfile
COPY deploy/staging/caddy/ /etc/caddy/options/
COPY --from=build /web/dist /srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
