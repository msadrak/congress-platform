# syntax=docker/dockerfile:1
# Web edge for staging/production: the real Vite production bundle served by Caddy, which also terminates
# HTTPS and reverse-proxies /api to the API container. Build context: repository root.

FROM node:24-bookworm-slim AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
COPY deploy/web/make-seo-shell.mjs /tools/make-seo-shell.mjs
RUN npm run build && node /tools/make-seo-shell.mjs dist

FROM caddy:2-alpine
COPY deploy/staging/Caddyfile /etc/caddy/Caddyfile
COPY deploy/staging/caddy/ /etc/caddy/options/
COPY --from=build /web/dist /srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
