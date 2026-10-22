#!/usr/bin/env bash
# Host permissions for Congress persistent data (same idea as DrGibi scripts/fix-persistent-permissions.sh).
#
#   ./scripts/staging/fix-persistent-permissions.sh
#   sudo ./scripts/staging/fix-persistent-permissions.sh
#
# Environment:
#   CONGRESS_PERSISTENT_DATA_ROOT   default: ${HOME}/congress-persistent-data
#   CONGRESS_POSTGRES_UID/GID       default: 70 (postgres:16-alpine)
#   CONGRESS_MEDIA_UID/GID          default: 10001 (API container user)

set -euo pipefail

ROOT="${CONGRESS_PERSISTENT_DATA_ROOT:-${HOME}/congress-persistent-data}"
PG_UID="${CONGRESS_POSTGRES_UID:-70}"
PG_GID="${CONGRESS_POSTGRES_GID:-70}"
M_UID="${CONGRESS_MEDIA_UID:-10001}"
M_GID="${CONGRESS_MEDIA_GID:-10001}"

chown_r() {
	[[ -e "$1" ]] || return 0
	chown -R "$2" "$1" 2>/dev/null || {
		echo "[fix-permissions] need sudo to chown $1" >&2
		sudo chown -R "$2" "$1"
	}
}

mkdir -p "${ROOT}/data/postgres" "${ROOT}/data/media" "${ROOT}/data/caddy/data" "${ROOT}/data/caddy/config"
chown_r "${ROOT}/data/postgres" "${PG_UID}:${PG_GID}"
chown_r "${ROOT}/data/media" "${M_UID}:${M_GID}"
# Caddy runs as root in the official image; directories only need to exist.
chmod 700 "${ROOT}/data/postgres" 2>/dev/null || true

echo "[fix-permissions] ${ROOT} ready (postgres ${PG_UID}:${PG_GID}, media ${M_UID}:${M_GID})"
