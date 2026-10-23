# Congress Platform — Staging Operations Guide

One Docker Compose project (`congress-staging`, file `deploy/staging/compose.yaml`) runs the whole platform. The same file is the template for a single Linux server. `CONGRESS_STACK_PROJECT=<name>` runs a second stack (for example a drill) from the same checkout under another Compose project name.

| Service | Image | Role | Exposed |
|---|---|---|---|
| `db` | `postgres:16-alpine`; with `BACKUP_WAL=on`, `congress-platform/db` (the same image plus pgBackRest, `deploy/db/Dockerfile`) | PostgreSQL; host `${CONGRESS_PERSISTENT_DATA_ROOT}/data/postgres` | internal network only (with WAL archiving also the outbound-only `egress` network, to reach the bucket) |
| `migrate` | `congress-platform/api` | One-shot `python -m app.schema_guard migrate` (`alembic upgrade head`, then records the revision chain), then exits 0 | — |
| `api` | `congress-platform/api` | FastAPI/uvicorn as uid 10001, **one process**; host `…/data/media` → `/data/media` | internal network only |
| `web` | `congress-platform/web` | Caddy; host `…/data/caddy/data` and `…/data/caddy/config` | `127.0.0.1:8443` (HTTPS), `127.0.0.1:18080` (HTTP, localhost) |

- **Start order:** `db` healthy (checked over TCP, so the image's temporary init-only server never counts) → `migrate` exits 0 → `api` healthy → `web`.
- **Schema guard:** in `staging`/`production` the API refuses to start unless the database is at the Alembic head of its own build, or ahead of it **only** by migrations marked `backward_compatible = True` (see [Releases and rollback](#releases-and-rollback) and `docs/CODING_STANDARDS.md` §2.D).
- **Migration lock:** migrations take a PostgreSQL advisory lock, so concurrent runs serialise.
- **One API process.** Do not add uvicorn `--workers` or a second `api` replica: the failed-login and SMS rate limits (`app/rate_limit.py`) are kept in process memory, so each extra process multiplies every budget and a restart resets them.

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux).
- Node.js 22+ for the operations tool. Playwright/Edge are needed only for `verify.mjs`.
- About 3 GB of disk for images, plus room for the last 5 releases' images kept for rollback. Persistent data grows under `CONGRESS_PERSISTENT_DATA_ROOT` (default `~/congress-persistent-data`, DrGibi-style). Run `scripts/staging/fix-persistent-permissions.sh` before the first start.

## First start (PowerShell; identical on bash)

```powershell
node scripts/staging/stack.mjs init     # writes .staging\staging.env with generated secrets (git-ignored, never printed)
node scripts/staging/stack.mjs up       # builds both images, migrates, starts, waits for healthy
node scripts/staging/stack.mjs ca       # exports Caddy's local root CA to .staging\caddy-root.crt
```

`init` generates `POSTGRES_PASSWORD`, `CONGRESS_PLATFORM_ADMIN_TOKEN`, `CONGRESS_JWT_SECRET` and `CONGRESS_METRICS_TOKEN`.

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

The response contains the organizer API key **once**. No demo accounts or demo data exist in staging. On a hosted server use `stack.mjs organizer create` instead (below).

Then add the organizer's first owner (ADR 0016), who signs in at `/organizer` with that mobile number and an SMS code and invites the rest under **Members**:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:18080/api/organizers/<organizer-id>/members -Headers @{ 'X-Admin-Token' = $t } -ContentType 'application/json' -Body '{"mobile":"09121234567","display_name":"Owner name","role":"owner"}'
```

## Portals

| Portal | URL (`https://localhost:8443` or `http://localhost:18080`) |
|---|---|
| Platform home | `/` |
| Organizer console | `/organizer` (members sign in by SMS code; the API key stays available) → events → **Program** (sessions, CSV timetable upload), **Venue** (entrances, halls), Booths, **Public page** (Page Studio), **Attendee panel** (preview), Analytics, Front Desk; `/organizer/members` and `/organizer/activity` (audit log) for managers and owners |
| Public congress | `/e/<slug>` (after Publish) and `/e/<slug>/booths/<id>` |
| Attendee | `/sign-in`, `/my-tickets`, `/my-network`, `/c/<slug>/my-congress`; `/t/<code>` (SMS pass link, opens the pass without sign-in) |
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
node scripts/staging/stack.mjs up               # after pulling new code: rebuild images, migrate, restart, record the release
```

With `BACKUP_WAL=on`, always go through `stack.mjs` (or add `-f deploy/staging/compose.wal.yaml` and the `PGBACKREST_*` environment yourself): a plain `docker compose up` restarts the database **without** WAL archiving, and `check` then reports it as critical.

**Logs.**
- JSON-file driver, rotated at 10 MB × 5 per service.
- The API writes one JSON object per line in staging/production (`CONGRESS_LOG_FORMAT=text` for human-readable lines; `text` is the development default): `ts`, `level`, `logger`, `msg`, the access fields (`client`, `method`, `path`, `status`), and `request_id` on every line written while a request is handled.
- Every response carries `X-Request-ID`: a well-formed incoming id (8–128 characters of `A-Za-z0-9._:-`) is kept, anything else replaced. Ask users or clients for that header value and search the API log for it.
- The access log leaves out `/api/health` and `/api/ready` and never records query strings. The API never logs credentials.
- Caddy access logs drop `Authorization`, `X-Admin-Token` and the scanner `?token=` query, and log SMS pass links as `/t/-` (logger `short_links`), never with their code.

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

## Organizer keys

```powershell
node scripts/staging/stack.mjs organizer list
node scripts/staging/stack.mjs organizer create "Organizer name"   # key shown once
node scripts/staging/stack.mjs organizer rotate <organizer-id>      # new key once; old key, and scanner/desk/member sessions issued before, rejected immediately
node scripts/staging/stack.mjs organizer revoke <organizer-id>
```

The organizer commands run inside the API container, so the admin token never crosses the proxy. In hosted mode `/api/organizers` and `/api/platform` are closed at the proxy (`CONGRESS_ADMIN_ALLOW`).

## Health check and alerts

```powershell
node scripts/staging/stack.mjs check     # exit 0 OK, 1 warning, 2 critical
```

`check` looks at:

| Finding | Level |
|---|---|
| `db`, `api` or `web` not running or unhealthy; last `migrate` exited non-zero | CRITICAL |
| `/api/ready` not 200 (through the proxy, or inside the API container on hosted servers) | CRITICAL |
| HTTP 5xx in the last 15 min: more than 20, or more than 5 % of over 50 requests (Caddy JSON log) | WARNING |
| `Traceback`/`ERROR` lines in the API log in the last 15 min | WARNING |
| Disk holding the volumes at 80 % / 90 % | WARNING / CRITICAL |
| No scheduled backup yet | WARNING |
| Last scheduled backup failed, or older than `BACKUP_MAX_AGE_HOURS` (26), or `BACKUP_EVENT_MAX_AGE_HOURS` (2) while event mode is on | CRITICAL |
| `BACKUP_WAL=on` but `archive_mode` is not on, or WAL archiving failing | CRITICAL |
| More than 10 WAL segments waiting to be archived | WARNING |
| No base backup recorded yet | WARNING |
| Last base backup failed, or older than `BACKUP_WAL_MAX_AGE_HOURS` (26) | CRITICAL |
| The check itself crashed (for example Docker not answering) | CRITICAL |

**Telegram alerts.** With `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID` set, `check` sends:
- one message when a warning/critical problem appears or changes (numbers are ignored when comparing, so "23 of 400" and "24 of 410" are the same problem);
- a reminder every `ALERT_REPEAT_HOURS` (6) while it lasts;
- one `[RECOVERED]` message when everything is OK again.

State is kept in `.staging/alert-state.json`; a message that could not be delivered is retried on the next run. Where `api.telegram.org` is not reachable from the server, set `ALERT_TELEGRAM_API` to a relay that speaks the same Bot API. **Untested:** delivery from a server in Iran, directly or through a relay.

The `congress-check.timer` runs `check` every 5 minutes; exits 1 and 2 count as success for systemd because `check` already alerted.

## Monitoring

**Prometheus metrics** at `/api/metrics` (not in the OpenAPI schema):
- Requires `Authorization: Bearer <CONGRESS_METRICS_TOKEN>`. With no token configured the endpoint answers 404. In staging/production the token must be a generated secret of at least 32 characters.
- Caddy also answers 404 for `/api/metrics` to any client outside `CONGRESS_METRICS_ALLOW` (local staging: `private_ranges`; hosted: `127.0.0.1/32`, i.e. nobody, until you add your Prometheus server's address).
- `node scripts/staging/stack.mjs metrics` prints the metrics from inside the API container, with no scraper.

| Metric | Meaning |
|---|---|
| `congress_http_requests_total{method,route,status}` | Requests per route **template** (`/api/events/{event_id}`), never the concrete path |
| `congress_http_request_duration_seconds{method,route}` | Latency histogram (5 ms … 10 s) |
| `congress_scans_total{status,reason}` | Admission scans by `ADMITTED`/`REJECTED` and rejection reason (from the database) |
| `congress_sms_messages{kind,status}` | SMS delivery log by kind and status (from the database) |
| `congress_sms_outbox_due`, `congress_sms_outbox_lag_seconds` | Queued SMS whose send time has passed, and the age of the oldest |
| `congress_database_up` | 1 when the scrape-time database queries succeeded |

Database-derived values are read at scrape time, so they survive restarts. The HTTP counters are per process and restart at zero.

**Error reporting (optional).** `CONGRESS_SENTRY_DSN` sends unhandled errors to Sentry or GlitchTip, tagged with the request id. No request bodies, headers, cookies, query strings, user or local variables are sent, and mobile numbers, bearer tokens, JWTs and `token=`/`code=`-style values are masked in every string. Tracing is off. **Untested** against a real Sentry/GlitchTip endpoint.

## Releases and rollback

```powershell
node scripts/staging/stack.mjs releases            # kept releases, newest first; * = running
node scripts/staging/stack.mjs rollback            # back to the release deployed before the current one
node scripts/staging/stack.mjs rollback <sha>      # to a given kept release (unique prefix is enough)
```

- Every `up` tags the API and web images it built with the commit's short SHA (`congress-platform/api:<sha>`, `…/web:<sha>`) beside the alias the services run (`CONGRESS_IMAGE_TAG`). Uncommitted or untracked files make the release `<sha>-dirty-<time>`. The last **5** releases are kept in `.staging/releases.json`; older tags are removed.
- `rollback` re-points the alias at the older images and restarts `api` and `web` only. It **never runs migrations and never downgrades the database.** The older API starts only if the schema guard accepts the database: same revision, or ahead by `backward_compatible = True` migrations only. If it refuses, `rollback` prints the API log, puts the previous images back and restarts them.
- After a rollback, `stack.mjs start` or a later `up` runs the older `migrate` image; `schema_guard migrate` sees the database ahead by compatible migrations and leaves it alone.
- To return to the newer release: `stack.mjs rollback <newer sha>` (the command prints it).
- A release whose migrations are **not** marked (a drop, rename or type change) cannot be rolled back this way. The recovery is a restore of the backup taken before the upgrade, or a point-in-time restore to just before it.

Drill results (ws/a3-ops): rollback was refused for an unmarked migration (previous images restarted) and worked after a marked one.

## Migrations

1. Take a backup: `node scripts/staging/stack.mjs scheduled-backup` (or `backup`). This is **required before every migration**. Downgrades are lossy by design and are never run by the tooling.
2. Run `node scripts/staging/stack.mjs up`. The rebuilt `migrate` runs `python -m app.schema_guard migrate` once (`alembic upgrade head`, then it records every revision with its parent and `backward_compatible` flag in `schema_compatibility`); `api` starts only if that exits 0.
3. If a migration fails, `up` prints the `migrate`/`api` logs and the rollback hint. Fix the cause, then restore the backup or re-run.
4. Write migrations expand/contract (`docs/CODING_STANDARDS.md` §2.D): additions marked `backward_compatible = True`, drops and renames only in a later, unmarked migration, so most releases stay rollback-able.

To run migrations alone: `node scripts/staging/stack.mjs migrate`.

## Backup and restore

```powershell
node scripts/staging/stack.mjs backup                              # ad hoc (no off-host copy, no retention)
node scripts/staging/stack.mjs scheduled-backup                    # backup + consistency + encrypted off-host copy + retention
# .staging\backups\staging-<UTC timestamp>\
node scripts/staging/stack.mjs backups                             # local backups with revision and row counts
node scripts/staging/stack.mjs backups --offsite                   # the encrypted off-host copies
node scripts/staging/stack.mjs restore-verify staging-<timestamp>  # test restore of a local backup (non-destructive)
node scripts/staging/stack.mjs restore-verify staging-<timestamp> --from-offsite   # download + decrypt the off-host copy, then the same test
```

**What a backup contains:**
- `db.dump` — `pg_dump -Fc` (taken first);
- `media.tar.gz` — the whole media directory, read-only mount;
- `manifest.json` — Alembic revision, row counts, published slugs, per-file and per-image SHA-256. A backup in which any image the database references is missing from the archive is reported as failed.

**`scheduled-backup`** (what the timer runs):
1. Takes the backup above.
2. With `BACKUP_S3_ENDPOINT` and `BACKUP_S3_BUCKET` set: copies it to `s3://<bucket>/<prefix>/<name>` through an rclone `crypt` remote, so every file is encrypted on this host (XSalsa20-Poly1305, key from `BACKUP_ENCRYPTION_KEY` via scrypt) before upload. File and folder names stay readable. Then `rclone cryptcheck` proves every remote file decrypts to the local bytes. There is no unencrypted off-host mode: without `BACKUP_ENCRYPTION_KEY` (≥ 32 characters) the copy is refused and the run fails.
3. Applies retention remotely, then locally (local copies are pruned only after the new one is safely off the host).
4. Writes `.staging/backups/last-backup.json` and exits 1 on any failure; `check` alerts on it.

Off-host credentials travel as environment variables of the docker client, never on a command line or in status output.

**Retention** (local and remote, only directories named `staging-YYYYMMDD-HHMMSS`): the newest `BACKUP_KEEP_DAILY` (7) backups, plus the newest backup of each of the last 7 days (so hourly event-day backups never push out the dailies), plus one per ISO week for `BACKUP_KEEP_WEEKLY` (4) weeks, plus one per month for `BACKUP_KEEP_MONTHLY` (6) months.

**The encryption key.** `BACKUP_ENCRYPTION_KEY` (`openssl rand -base64 48`) encrypts both the nightly copies and the WAL archive. Keep a copy in a password manager off the server: **without it no off-host copy can be restored.** Changing it later needs a new `BACKUP_S3_PREFIX` (older copies stay readable only with the old key).

**What `restore-verify` does:**
- Checks the files' SHA-256 against the manifest.
- Creates a *new* project `congress-restore-<random>` with its own data folder under `.staging/restores/` and no published ports.
- Restores both the database and the media into it.
- Starts the normal `migrate` → `api` path.
- Compares every count and every image checksum, and fetches each published page and image through the restored API.
- Removes only that disposable project (`--keep` leaves it for inspection).

With `--from-offsite` it first downloads and decrypts the off-host copy into a throw-away folder, so it proves the bucket copy and the key, not just the local files. Drill result (ws/a3-ops): passed.

**Restoring for real** (disaster recovery, after a successful `restore-verify` of the same backup):
1. If the server is gone: provision a new one, clone the reviewed commit, put `.staging/staging.env` and `/etc/congress/backup.env` back, and fetch the backup (below).
2. `node scripts/staging/stack.mjs stop`.
3. Move the old data aside, never delete it: `mv $ROOT/data/postgres $ROOT/data/postgres.broken-<date>` (and media if it is damaged), recreate empty folders, run `scripts/staging/fix-persistent-permissions.sh`.
4. Start only the database: `docker compose -p congress-staging -f deploy/staging/compose.yaml --env-file .staging/staging.env up -d --wait db`.
5. Copy `db.dump` in and run `pg_restore -U congress -d congress --no-owner --exit-on-error /tmp/db.dump` inside `db`.
6. `tar xzf media.tar.gz -C /data/media && chown -R 10001:10001 /data/media` (through a helper container mounting `$ROOT/data/media`, as `restore-verify` does).
7. `node scripts/staging/stack.mjs start`, then `check`. Delete the old folders only after the restored stack passes `check`.

This is deliberately not automated. With `BACKUP_WAL=on`, a dump restored into a fresh cluster has a new PostgreSQL system identifier, so the existing pgBackRest stanza rejects its WAL: set a new `BACKUP_S3_PREFIX` before step 7 (the old archive stays for forensics) and run `stack.mjs up` instead of `start` in step 7: `up` creates the new stanza and takes a first full base backup. This path is not drilled.

**Fetching an off-host backup by hand.** `restore-verify --from-offsite` deletes its download after the test. To keep a copy, configure the same rclone remotes the tool uses (`rcloneEnv` in `stack.mjs`) and copy through `secure:`:

```bash
set -a; . /etc/congress/backup.env; set +a
export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER="${BACKUP_S3_PROVIDER:-Other}" \
  RCLONE_CONFIG_OFFSITE_ENDPOINT="$BACKUP_S3_ENDPOINT" RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-us-east-1}" \
  RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=true RCLONE_S3_NO_CHECK_BUCKET=true \
  RCLONE_CONFIG_SECURE_TYPE=crypt RCLONE_CONFIG_SECURE_REMOTE="offsite:$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-congress}" \
  RCLONE_CONFIG_SECURE_FILENAME_ENCRYPTION=off RCLONE_CONFIG_SECURE_DIRECTORY_NAME_ENCRYPTION=false
export RCLONE_CONFIG_SECURE_PASSWORD="$(printf %s "$BACKUP_ENCRYPTION_KEY" | docker run --rm -i rclone/rclone:1.68 obscure -)"
docker run --rm $(env | grep -o '^RCLONE_[A-Z_]*' | sed 's/^/-e /') -v "$PWD/.staging/backups:/backups" \
  rclone/rclone:1.68 copy secure:staging-<timestamp> /backups/staging-<timestamp>
```

Then `restore-verify staging-<timestamp>` checks it like any local backup.

**Disk.**
- Watch disk use under `CONGRESS_PERSISTENT_DATA_ROOT` and `.staging/backups`; `check` warns at 80 %.
- Prune only **dangling images** (`docker image prune`). Do not delete the persistent data directory or the `<sha>` release tags (`rollback` needs them; `up` removes expired ones itself).

## Point-in-time recovery

Nightly dumps bound data loss to a day (an hour in event mode). With `BACKUP_WAL=on`, the database also ships every WAL segment, encrypted, to the same bucket, so any moment since the oldest kept full base backup can be restored.

| Piece | What it does |
|---|---|
| `deploy/db/Dockerfile` | `postgres:16-alpine` plus pgBackRest; an existing data directory starts unchanged |
| `deploy/staging/compose.wal.yaml` | Added by `stack.mjs` when `BACKUP_WAL=on`: `wal_level=replica`, `archive_mode=on`, `archive_command=pgbackrest … archive-push`, `archive_timeout=BACKUP_WAL_ARCHIVE_TIMEOUT` (60 s); repository `s3://<bucket>/<prefix>/pgbackrest`, `aes-256-cbc` with `BACKUP_ENCRYPTION_KEY` |
| `up` | Creates the stanza (idempotent), runs `pgbackrest check` (forces a WAL switch and waits for it in the bucket), takes the first full base backup if there is none |
| `base-backup [full\|diff\|incr]` | Full when the newest full is older than `BACKUP_WAL_FULL_DAYS` (7), differential otherwise; writes `.staging/backups/last-base-backup.json`. Timer: daily 03:15 |
| Retention | `BACKUP_WAL_RETENTION_FULL` (2) full backups with all WAL needed to recover to any moment since the oldest of them |
| Disk safety | Past `BACKUP_WAL_QUEUE_MAX` (1 GiB) of queued WAL while the bucket is unreachable, pgBackRest drops segments (a gap in recovery, reported by `check`) instead of filling the disk |

Requirements: `BACKUP_S3_ENDPOINT` must be `https://` (pgBackRest speaks only TLS to S3; a self-signed store needs `BACKUP_S3_VERIFY_TLS=off`), plus the bucket, keys and `BACKUP_ENCRYPTION_KEY`. `up` refuses to start with an incomplete configuration.

**RPO.** While anything is being written, at most `archive_timeout` (60 s) plus the upload: about 1 minute worst case; 8.6 s was observed in the ws/a3-ops drill. Media files are not in WAL; they come from the newest scheduled backup (or are still on the host disk if only the database was damaged).

**Drill** (run monthly and before a congress):

```bash
node scripts/staging/stack.mjs pitr-restore --to 2026-10-22T09:41:00Z   # UTC unless an offset is given
node scripts/staging/stack.mjs pitr-restore --to latest                 # everything in the archive
node scripts/staging/stack.mjs pitr-restore --to <time> --keep          # leave the restored project running
```

It restores into a new project `congress-pitr-<random>` (data under `.staging/restores/`, no published ports, `archive_mode` off so it never writes to the bucket), replays WAL to the target and promotes, starts `migrate` + `api` on it, and checks that `organizers`, `events`, `users`, `tickets`, `checkins` and `sms_messages` hold nothing newer than the target. The live stack is not touched. "recovery ended before configured recovery target was reached" means nothing committed after the target has been archived yet: pick an earlier time or `--to latest`. Drill result (ws/a3-ops): restore to a point passed.

**Recovering the live database to a point in time** (not automated, not drilled end to end):
1. `pitr-restore --to <time> --keep` and inspect the kept project until it is the state you want.
2. Dump it: `docker exec congress-pitr-<id>-db-1 pg_dump -U congress -d congress -Fc -f /tmp/pitr.dump`, then `docker cp congress-pitr-<id>-db-1:/tmp/pitr.dump .staging/backups/`.
3. `stack.mjs backup` of the current (damaged) state, for the record.
4. Restore `pitr.dump` as in *Restoring for real*, steps 2–7 (keep the media directory if it is intact), including the new `BACKUP_S3_PREFIX`.
5. Remove the kept project: `docker compose -p congress-pitr-<id> down`, then delete its folder under `.staging/restores/`.

An in-place `pgbackrest restore` over the live data directory keeps the stanza but is not scripted; do it only with someone who knows pgBackRest.

## Scheduling (Linux, systemd)

```bash
sudo node scripts/staging/stack.mjs install-timers --user congress --dry-run   # print the units and systemctl calls
sudo node scripts/staging/stack.mjs install-timers --user congress
sudo node scripts/staging/stack.mjs uninstall-timers
```

`install-timers` renders `deploy/hosted/systemd/*` for this checkout's path, the given user (default: `$SUDO_USER`) and this Node binary, writes them to `/etc/systemd/system` (`CONGRESS_SYSTEMD_DIR`), reloads systemd and enables the timers. It warns when the user is not in the `docker` group.

| Timer | When | Runs |
|---|---|---|
| `congress-backup.timer` | 02:30 nightly (hourly at :05 in event mode) | `scheduled-backup` |
| `congress-basebackup.timer` | 03:15 daily, only installed with `BACKUP_WAL=on` | `base-backup` |
| `congress-check.timer` | 2 min after boot, then every 5 min | `check` (alerts itself) |

All units read `/etc/congress/backup.env` (`EnvironmentFile=`). **Untested:** the timers have not yet run on a real Linux host.

**Event mode** (a live congress):

```bash
sudo node scripts/staging/stack.mjs event-mode on       # hourly backups; backup age limit 2 h
node scripts/staging/stack.mjs event-mode status
sudo node scripts/staging/stack.mjs event-mode off      # back to nightly
```

`on` writes the drop-in `congress-backup.timer.d/event-mode.conf` and restarts the timer; `check` then expects a backup younger than `BACKUP_EVENT_MAX_AGE_HOURS` (2). Run `scheduled-backup` once right after switching it on.

## Before congress day

1. The day before: `event-mode on`, then `scheduled-backup` by hand; confirm `backups --offsite` lists it.
2. `restore-verify <newest> --from-offsite` passes.
3. With WAL: `base-backup full`, then `pitr-restore --to latest` passes.
4. `check` exits 0 and a test problem reaches the Telegram chat (and the recovery message follows).
5. `releases` shows the release you intend to run, with the previous one kept for `rollback`.
6. No deploys during live scanning. Scanners must have flushed their offline queues before any restart.
7. After the congress: `event-mode off`.

## Operations settings

Application settings live in `.staging/staging.env`. `BACKUP_*` and `ALERT_*` may instead live in `/etc/congress/backup.env` (owner root, group of the operating user, mode 640; path overridable with `CONGRESS_OPS_ENV_FILE`), which `stack.mjs` and the systemd units read; values set in the environment win over both. Values must be bare (no trailing comments). Templates: `deploy/staging/.env.staging.example`, `deploy/hosted/.env.hosted.example`.

| Variable | Default | Meaning |
|---|---|---|
| `CONGRESS_LOG_FORMAT` | `json` in staging/production, else `text` | API log format |
| `CONGRESS_METRICS_TOKEN` | empty (generated by `init`) | Bearer token for `/api/metrics`; empty = endpoint disabled |
| `CONGRESS_METRICS_ALLOW` | `private_ranges` (hosted template: `127.0.0.1/32`) | Client ranges Caddy lets reach `/api/metrics` |
| `CONGRESS_SENTRY_DSN` | empty | Sentry/GlitchTip DSN; empty = off |
| `CONGRESS_STACK_PROJECT` | `congress-staging` | Compose project `stack.mjs` acts on |
| `CONGRESS_OPS_ENV_FILE` | `/etc/congress/backup.env` | Separate file for `BACKUP_*`/`ALERT_*` |
| `CONGRESS_SYSTEMD_DIR` | `/etc/systemd/system` | Where `install-timers`/`event-mode` write |
| `BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_PREFIX`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | — (`_REGION` `us-east-1`, `_PREFIX` `congress`) | Off-host store; endpoint + bucket enable off-host copies |
| `BACKUP_S3_PROVIDER` | `Other` | rclone S3 provider name |
| `BACKUP_S3_VERIFY_TLS` | `on` | `off` for a store with its own CA |
| `BACKUP_ENCRYPTION_KEY` | — | ≥ 32 characters; required for any off-host copy and for WAL |
| `BACKUP_RCLONE_IMAGE`, `BACKUP_RCLONE_NETWORK` | `rclone/rclone:1.68`, default network | rclone container image and network |
| `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | 7 / 4 / 6 | Retention |
| `BACKUP_MAX_AGE_HOURS` | 26 | `check` limit for the last scheduled backup |
| `BACKUP_EVENT_MAX_AGE_HOURS` | 2 | The same limit while event mode is on |
| `BACKUP_WAL` | `off` | `on` = continuous WAL archiving (point-in-time recovery) |
| `BACKUP_WAL_ARCHIVE_TIMEOUT` | 60 | Seconds; the WAL RPO while anything is written |
| `BACKUP_WAL_RETENTION_FULL` | 2 | Full base backups kept, with their WAL |
| `BACKUP_WAL_FULL_DAYS` | 7 | `base-backup` takes a full backup when the newest is older |
| `BACKUP_WAL_MAX_AGE_HOURS` | 26 | `check` limit for the last base backup |
| `BACKUP_WAL_QUEUE_MAX` | `1GiB` | Queued WAL kept while the bucket is unreachable |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID` | — | Enable Telegram alerts from `check` |
| `ALERT_TELEGRAM_API` | `https://api.telegram.org` | Bot API base URL (a relay where Telegram is blocked) |
| `ALERT_REPEAT_HOURS` | 6 | Reminder interval while a problem lasts |

## Data retention

Each API process removes personal data and bookkeeping it no longer needs once an hour (`backend/app/retention.py`). Messages still to be sent are never touched. The defaults below apply unless the variable is passed to the `api` service (compose does not pass them today; add a line under `api.environment` to change one).

| Variable | Default | What happens |
|---|---|---|
| `CONGRESS_RETENTION_ENABLED` | `true` | `false` stops the hourly pass |
| `CONGRESS_RETENTION_INTERVAL_SECONDS` | 3600 | Time between passes |
| `CONGRESS_OTP_RETENTION_HOURS` | 24 | Used or expired sign-in codes (`otp_challenges`) are deleted |
| `CONGRESS_SMS_BODY_RETENTION_DAYS` | 30 | The text of sent SMS is cleared (the delivery log keeps who, when, status) |
| `CONGRESS_OTP_SMS_LOG_RETENTION_DAYS` | 30 | Delivery-log rows of sign-in codes (`sms_messages`, kind `otp`) are deleted |
| `CONGRESS_SMS_MOBILE_RETENTION_DAYS` | 90 | Every other delivery-log row keeps only a masked number (`0912***4567`) |
| `CONGRESS_SHORT_LINK_GRACE_DAYS` | 30 | SMS pass links are deleted this long after they expired (a link expires 30 days after its congress ends; afterwards it answers "not found" instead of "expired") |
| — | — | Expired walk-in `Idempotency-Key`s and expired rate-limit counters are deleted |
| `CONGRESS_AUDIT_RETENTION_DAYS` | unset (keep forever) | See below; at least 180 |

**Audit log.** How long to keep `audit_events` is an open product decision, so nothing purges it by default, and the hourly pass never does. The table is append-only (a trigger refuses UPDATE and DELETE). When a retention period is decided, an operator purges older entries explicitly, with the table owner's database role (the role the migrations ran as; on this stack the API's own `congress` role):

```bash
docker compose -p congress-staging exec -e CONGRESS_AUDIT_RETENTION_DAYS=730 api python -m app.retention purge-audit
```

It refuses to run without `CONGRESS_AUDIT_RETENTION_DAYS`, disables the trigger only inside its own transaction (other sessions wait on the table lock and never see it off), and records itself as an `audit.purged` entry. Take a backup first; deleted entries come back only from a backup.

## Moving to a real domain (Linux VPS)

1. Install Docker Engine and the Compose plugin; clone the repository; run `node scripts/staging/stack.mjs init`. Then edit `.staging/staging.env`:
   - `CONGRESS_ENVIRONMENT=production`
   - `CONGRESS_PUBLIC_ORIGIN=https://congress.example.org`
   - `CONGRESS_SITE_ADDRESS=congress.example.org`
   - `CONGRESS_TLS=<ops e-mail>` (automatic Let's Encrypt/ZeroSSL), or put the ParsPack CDN in front ([`CDN.md`](CDN.md))
   - optional `CONGRESS_SHORT_LINK_ORIGIN=https://cngr.example`: the origin of the pass links in SMS (`<origin>/t/<code>`, ADR 0015); unset means `CONGRESS_PUBLIC_ORIGIN`. Only for a shorter domain served by this same deployment: add it to `CONGRESS_SITE_ADDRESS` (comma separated) and point its DNS here. Attendees who tap the link use the app on that domain (their pass is kept there), so leave it unset unless the shorter SMS matters.
   - `CONGRESS_BIND=0.0.0.0`, `CONGRESS_HTTPS_PORT=443`, `CONGRESS_HTTP_PORT=80`
   - `CONGRESS_LOCAL_HTTP=off`, `CONGRESS_ADMIN_ALLOW=127.0.0.1/32`, `CONGRESS_METRICS_ALLOW=<Prometheus address or 127.0.0.1/32>`
2. Point DNS A/AAAA records to the server and open ports 80/443 only. PostgreSQL and the API stay unpublished.
3. Turn on HSTS (`CONGRESS_HSTS=on`) once the domain is final.
4. Put `/etc/congress/backup.env` in place (off-host store, `BACKUP_ENCRYPTION_KEY`, optionally `BACKUP_WAL=on`, Telegram), then `stack.mjs up`, `scheduled-backup` and `restore-verify <name> --from-offsite`.
5. `sudo node scripts/staging/stack.mjs install-timers --user <operating user>`.

The full hosted procedure is in [`HOSTED_STAGING_READINESS.md`](HOSTED_STAGING_READINESS.md) §6.

## Known release blockers / limitations

- **Organizer access** is an API key per organizer (rotation and revocation exist: `organizer rotate|revoke`) plus organizer members with roles who sign in by SMS code (ADR 0016); there is no `stack.mjs` command for members yet (use the admin API above).
- **One API process.** Rate limits are in-process; do not run multiple uvicorn workers or replicas until they are shared (for example in PostgreSQL or Redis).
- **Untested for real:** ACME issuance on the real domain, a real S3 provider (drills used a stand-in), systemd timers on Linux, a Sentry/GlitchTip endpoint, Telegram delivery (or a relay) from Iran.
- **Caddy runs as root** inside its container (official image); the API runs as uid 10001.
- **CSP** allows `'unsafe-inline'` styles (React style attributes); scripts are `'self'` only.
- **Local CA:** test browsers that do not trust it use the `http://localhost` listener. Real certificates remove this split.
- **Images** have a single rendition (≤ 2400 px). A CDN (ParsPack) in front is supported ([`CDN.md`](CDN.md), [`CDN_CACHE_RULES.md`](CDN_CACHE_RULES.md)).
