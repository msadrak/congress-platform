# Congress Platform — Staging Operations Guide

One Docker Compose project (`congress-staging`, file `deploy/staging/compose.yaml`) runs the whole platform. The same file is the template for a single Linux server.

| Service | Image | Role | Exposed |
|---|---|---|---|
| `db` | `postgres:16-alpine` | PostgreSQL; host `${CONGRESS_PERSISTENT_DATA_ROOT}/data/postgres` | internal network only |
| `migrate` | `congress-platform/api` | One-shot `alembic upgrade head`, then exits 0 | — |
| `api` | `congress-platform/api` | FastAPI/uvicorn as uid 10001; host `…/data/media` → `/data/media` | internal network only |
| `web` | `congress-platform/web` | Caddy; host `…/data/caddy/data` and `…/data/caddy/config` | `127.0.0.1:8443` (HTTPS), `127.0.0.1:18080` (HTTP, localhost) |

- **Start order:** `db` healthy → `migrate` exits 0 → `api` healthy → `web`.
- **Schema guard:** in `staging`/`production` the API refuses to start unless the database is at the Alembic head of its own build.
- **Migration lock:** migrations take a PostgreSQL advisory lock, so concurrent runs serialise.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).
- Node.js 22+ for the operations tool. Playwright/Edge are needed only for `verify.mjs`.
- About 3 GB of disk for images. Persistent data grows under `CONGRESS_PERSISTENT_DATA_ROOT` (default `~/congress-persistent-data`, DrGibi-style). Run `scripts/staging/fix-persistent-permissions.sh` before the first start.

## First start (PowerShell; identical on bash)

```powershell
node scripts/staging/stack.mjs init     # writes .staging\staging.env with generated secrets (git-ignored, never printed)
node scripts/staging/stack.mjs up       # builds both images, migrates, starts, waits for healthy
node scripts/staging/stack.mjs ca       # exports Caddy's local root CA to .staging\caddy-root.crt
```

**Trusting the local CA (optional).** The certificate is issued by Caddy's internal CA. To remove browser warnings for your own Windows user only:

```powershell
Import-Certificate -FilePath .staging\caddy-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Without trusting it, `http://localhost:18080` is equally usable: browsers treat `localhost` as a secure context, so the scanner camera, service worker and offline mode all work there.

**Organizer onboarding.** Through the supported admin API; the token is in `.staging\staging.env`:

```powershell
$t = (Select-String '^CONGRESS_PLATFORM_ADMIN_TOKEN=' .staging\staging.env).Line.Split('=',2)[1]
Invoke-RestMethod -Method Post -Uri http://localhost:18080/api/organizers -Headers @{ 'X-Admin-Token' = $t } -ContentType 'application/json' -Body '{"name":"My Organizer"}'
```

The response contains the organizer API key **once**. No demo accounts or demo data exist in staging.

## Portals

| Portal | URL (`https://localhost:8443` or `http://localhost:18080`) |
|---|---|
| Platform home | `/` |
| Organizer console | `/organizer` → events → **Public page** (Page Studio), Analytics, Front Desk |
| Public congress | `/e/<slug>` (after Publish) and `/e/<slug>/booths/<id>` |
| Attendee | `/sign-in`, `/my-tickets`, `/my-network`, `/c/<slug>/my-congress` |
| Reception | `/reception` (congress code) or `/reception/<event-id>` |
| Exhibitor | `/booth/<booth-id>` |
| Gate scanner | `/scan/<point-id>` (pair with a device token) |

## Daily operations

```powershell
node scripts/staging/stack.mjs status           # services, health, /api/health and /api/ready
node scripts/staging/stack.mjs logs             # last 200 lines of every service
node scripts/staging/stack.mjs logs api         # one service
docker compose -p congress-staging -f deploy/staging/compose.yaml --env-file .staging/staging.env logs -f web
node scripts/staging/stack.mjs stop             # stop containers, keep everything
node scripts/staging/stack.mjs start            # start again and wait for health
node scripts/staging/stack.mjs up               # after pulling new code: rebuild images, migrate, restart
```

**Logs.**
- JSON-file driver, rotated at 10 MB × 5 per service.
- Caddy access logs drop `Authorization`, `X-Admin-Token` and the scanner `?token=` query.
- The API never logs credentials.

**Restart policy.** Every long-running service is `unless-stopped`, so the stack returns after a host reboot once Docker starts.

Data is on the **host** under `CONGRESS_PERSISTENT_DATA_ROOT`, not in Docker named volumes. `docker compose down` (without `-v`) stops containers and **keeps** your data. `stack.mjs` still refuses `-v` on the main project.

**One-time migration** from old named volumes (`congress-staging_pgdata`, etc.):

```bash
ROOT="${CONGRESS_PERSISTENT_DATA_ROOT:-$HOME/congress-persistent-data}"
mkdir -p "$ROOT/data/postgres" "$ROOT/data/media" "$ROOT/data/caddy/data" "$ROOT/data/caddy/config"
docker run --rm -v congress-staging_pgdata:/from -v "$ROOT/data/postgres:/to" alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v congress-staging_media:/from -v "$ROOT/data/media:/to" alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v congress-staging_caddy_data:/from -v "$ROOT/data/caddy/data:/to" alpine sh -c 'cp -a /from/. /to/'
docker run --rm -v congress-staging_caddy_config:/from -v "$ROOT/data/caddy/config:/to" alpine sh -c 'cp -a /from/. /to/'
scripts/staging/fix-persistent-permissions.sh
```
Add `CONGRESS_PERSISTENT_DATA_ROOT=...` to `.staging/staging.env`, then `stack.mjs up`.

## Health check, scheduled backups, organizer keys

```powershell
node scripts/staging/stack.mjs check              # exit 0 OK, 1 warning, 2 critical (containers, readiness, 5xx, API errors, disk, backup age)
node scripts/staging/stack.mjs scheduled-backup   # backup + consistency + optional off-host copy (BACKUP_S3_*) + retention
node scripts/staging/stack.mjs organizer list
node scripts/staging/stack.mjs organizer create "Organizer name"   # key shown once
node scripts/staging/stack.mjs organizer rotate <organizer-id>      # new key once; old key rejected immediately
node scripts/staging/stack.mjs organizer revoke <organizer-id>
```

The organizer commands run inside the API container. In hosted mode `/api/organizers` is closed at the proxy (`CONGRESS_ADMIN_ALLOW`). Scheduling, off-host settings and alerting: [`HOSTED_STAGING_READINESS.md`](HOSTED_STAGING_READINESS.md).

## Migrations

1. Take a backup: `node scripts/staging/stack.mjs backup`. This is **required before every migration**. Downgrades are lossy by design.
2. Run `node scripts/staging/stack.mjs up`. The rebuilt `migrate` runs `alembic upgrade head` once; `api` starts only if that exits 0.
3. If a migration fails, `up` prints the `migrate`/`api` logs. The previous containers stay as they were. Fix the cause, then restore the backup or re-run.

To run migrations alone: `node scripts/staging/stack.mjs migrate`.

## Backup and restore

```powershell
node scripts/staging/stack.mjs backup                    # ad hoc (no retention); scheduled-backup for routine use
# .staging\backups\staging-<UTC timestamp>\
node scripts/staging/stack.mjs backups                   # list with revision and row counts
node scripts/staging/stack.mjs restore-verify staging-<timestamp>   # test restore (non-destructive)
```

**What a backup contains:**
- `db.dump` — `pg_dump -Fc`;
- `media.tar.gz` — the whole media volume, read-only mount;
- `manifest.json` — Alembic revision, row counts, published slugs, per-file and per-image SHA-256.

**What `restore-verify` does:**
- Creates a *new* project `congress-restore-<random>` with its own volumes and no published ports.
- Restores both the database and the media into it.
- Starts the normal `migrate` → `api` path.
- Compares every count and every image checksum, and fetches each published page and image through the restored API.
- Removes only that disposable project.

**Restoring for real** (disaster recovery, after a successful `restore-verify` of the same backup):
1. `node scripts/staging/stack.mjs stop`.
2. Restore into fresh volumes. Use a new project name, or have an operator *explicitly* remove the old volumes after copying them aside.
3. Run `pg_restore -U congress -d congress --no-owner db.dump` inside `db`.
4. `tar xzf media.tar.gz -C /data/media && chown -R 10001:10001 /data/media`.
5. `up`.

This is deliberately not automated.

**Retention and off-host copies.**
- Keep 7 daily, 4 weekly and 3 monthly backups.
- Copy `.staging\backups\<name>` off the machine (object storage or another host) after each backup.
- A backup on the same disk as the volumes is not a disaster-recovery copy.

**Disk.**
- Watch disk use under `CONGRESS_PERSISTENT_DATA_ROOT` and `.staging/backups`.
- Prune only **dangling images** (`docker image prune`). Do not delete the persistent data directory.

## Moving to a real domain (Linux VPS)

1. Install Docker Engine and the Compose plugin; clone the repository; run `node scripts/staging/stack.mjs init`. Then edit `.staging/staging.env`:
   - `CONGRESS_ENVIRONMENT=production`
   - `CONGRESS_PUBLIC_ORIGIN=https://congress.example.org`
   - `CONGRESS_SITE_ADDRESS=congress.example.org`
   - `CONGRESS_TLS=<ops e-mail>` (automatic Let's Encrypt/ZeroSSL)
   - `CONGRESS_BIND=0.0.0.0`, `CONGRESS_HTTPS_PORT=443`, `CONGRESS_HTTP_PORT=80`
2. Point DNS A/AAAA records to the server and open ports 80/443 only. PostgreSQL and the API stay unpublished.
3. In `deploy/staging/Caddyfile`, delete the `http://localhost` block. Caddy then redirects HTTP to HTTPS for the domain.
4. Add HSTS (`Strict-Transport-Security "max-age=31536000"`) once the domain is final.
5. Schedule `stack.mjs backup` (cron/systemd timer) plus an off-host copy, and run `restore-verify` regularly.

## Known release blockers / limitations

- **Organizer access** is a raw API key with no rotation or revocation endpoint and no organizer user accounts.
- **No automated off-host backup or alerting**; there is no monitoring beyond health checks and logs.
- **Caddy runs as root** inside its container (official image); the API runs as uid 10001.
- **CSP** allows `'unsafe-inline'` styles (React style attributes); scripts are `'self'` only.
- **Local CA:** test browsers that do not trust it use the `http://localhost` listener. Real certificates remove this split.
- **Images** have a single rendition (≤ 2400 px), with no CDN.
