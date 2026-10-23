# Hosted Staging Readiness — Milestone 10

Branch `integration/task-05h`, started at `93e6965ae8a64ddf54265052f36bb27f833bb250`. Nothing was deployed, pushed or changed in DNS. The demo was not touched. Staging data was kept; staging was upgraded in place to schema 0014 after a backup.

| Commit | Content |
|---|---|
| `46324deda15d1455b3dce4ffb376e62cf96b9e69` | Organizer key rotation/revocation (migration 0014), failed-authentication throttling, tests |
| *(this handoff's commit)* | Hosted Caddy modes, scheduled/off-host backups with retention, health check, operator CLI, systemd units, docs, evidence |

> **Update — operations hardening (branch `ws/a3-ops`, 2026-10-22/23).** Sections 1, 3 and 6–9 below are updated to it; section 2 keeps the Milestone 10 results and adds the new drills in §2.1. What changed:
> - Off-host copies are always **encrypted** on the server (rclone `crypt`, key `BACKUP_ENCRYPTION_KEY`) and proven with `rclone cryptcheck`; `backups --offsite` lists them and `restore-verify <name> --from-offsite` restores from them.
> - Optional **point-in-time recovery** (`BACKUP_WAL=on`): pgBackRest archives every WAL segment, encrypted (aes-256-cbc), to the same bucket; `base-backup`, `pitr-restore --to <time|latest>`.
> - **Releases and rollback:** `up` tags images with the commit and keeps 5 releases; `rollback [<sha>]` runs an older release without migrating, accepted by the schema guard when the newer migrations are `backward_compatible = True` (`docs/CODING_STANDARDS.md` §2.D).
> - **Alerts:** `check` sends deduplicated Telegram alerts, reminders and a recovery message itself (`ALERT_TELEGRAM_*`), and also checks WAL archiving and base-backup age.
> - **Timers:** `install-timers` / `uninstall-timers` render and enable the systemd units; `event-mode on|off` switches backups to hourly during a congress.
> - **Monitoring:** JSON logs with `X-Request-ID`, Prometheus `/api/metrics` (bearer token + edge allow-list), optional Sentry/GlitchTip with personal data scrubbed.
>
> The operator reference for all of it is [`STAGING_OPERATIONS.md`](STAGING_OPERATIONS.md).

## 1. What was implemented

**Organizer credential lifecycle** (admin token only; existing keys keep working):
- `GET /api/organizers` lists tenants without keys or hashes.
- `POST /api/organizers/{id}/rotate-key` returns the new key **once**. The old key fails from the same commit. Rotation also reinstates a revoked tenant.
- `POST /api/organizers/{id}/revoke` makes the key rejected exactly like an unknown key (same 401 body). Data stays intact.
- Operators use `node scripts/staging/stack.mjs organizer list|create|rotate|revoke`. It runs inside the API container, so the admin token never leaves the server and never crosses the public proxy.
- Revoking a key does not end scanner-device or reception-operator sessions already issued for that tenant's events. Revoke those separately in the workspace (API exists for both).

**Authentication throttling** (updated for ws/b1-sms-otp; Milestone 10 counted e-mail/password failures in process memory).
- Counts live in PostgreSQL (`rate_limit_counters`, `backend/app/rate_limit.py`), so every API process sees the same budgets and a restart or deploy does not reset them.
- Failures only, per 15 min: admin token 10 per IP; organizer API key 50 per IP; wrong SMS codes 10 per number (per purpose and network) and 100 per IP.
- SMS codes count every send: one per number and purpose per 60 s, 5 per number per hour, 100 per IP per hour, or `otp_sends_per_trusted_ip_per_hour` (2,000) for addresses in the venue networks (`/platform` → Sign-in). Platform-wide SMS caps (2,000 per hour, 20,000 per day by default) apply on top.
- Over budget returns 429 with Retry-After and a stable `code`. A successful sign-in clears the per-number failure counter.
- The client IP is the real visitor address: uvicorn trusts only Caddy, and Caddy replaces any client-supplied `X-Forwarded-For`. IPv6 addresses count per /64.

**Account recovery.** Passwords and e-mail no longer exist (ADR 0012): attendees, desk operators and organizer members sign in with an SMS code to their mobile number, so a lost password cannot happen. Someone who lost their number needs the organizer to correct the registration (Participants) or the desk to register them again.

**Hosted edge** (same Compose stack, environment-driven):
- `CONGRESS_LOCAL_HTTP=off`: no `http://localhost` site; Caddy redirects every HTTP request to HTTPS (308).
- `CONGRESS_HSTS=on` sends `Strict-Transport-Security: max-age=31536000`.
- `CONGRESS_ADMIN_ALLOW=127.0.0.1/32` makes `/api/organizers*` answer 404 through the proxy.
- `CONGRESS_TLS=<e-mail>` lets Caddy obtain public ACME certificates.
- Unchanged: CSP and security headers, no published DB/API ports, absolute `og:` URLs from `CONGRESS_PUBLIC_ORIGIN`, and CORS limited to that origin.
- No cookies are used (bearer tokens only), so there are no cookie flags to set.

**Backups** (`stack.mjs scheduled-backup`):
1. `pg_dump` is taken first, then the media tar, with a consistency check that every database image is in the archive. Missing images fail the run.
2. Optional off-host copy to any S3-compatible bucket (`BACKUP_S3_*`) via `rclone`, **encrypted on the server** through an rclone `crypt` remote keyed by `BACKUP_ENCRYPTION_KEY` (required; there is no unencrypted mode), then `rclone cryptcheck` proves every remote file decrypts to the local bytes. *(Milestone 10 uploaded plain files and used `rclone check`.)*
3. Retention keeps the newest `BACKUP_KEEP_DAILY` backups (7), the newest of each of the last 7 days (so hourly event-day backups never push out the dailies), plus one per week for `BACKUP_KEEP_WEEKLY` weeks (4) and one per month for `BACKUP_KEEP_MONTHLY` months (6), both locally and remotely.
   - It touches only directories named `staging-YYYYMMDD-HHMMSS`.
   - Local copies are pruned only after the new backup succeeded, including its off-host copy when configured.
4. Writes `.staging/backups/last-backup.json` and exits 1 on any failure.
5. Off-host credentials are passed as environment variables to the docker client, never on a command line or in error/status output.

**Monitoring** (`stack.mjs check`; exit 0 OK, 1 warning, 2 critical):
- container state and health, last migration result;
- `/api/ready` through the proxy (or inside the API container on hosted servers);
- HTTP 5xx in the last 15 minutes from Caddy's JSON log;
- API error lines;
- disk use of the filesystem holding the volumes (warning at 80 %, critical at 90 %) and volume sizes;
- backup age (critical over `BACKUP_MAX_AGE_HOURS`, 26, or `BACKUP_EVENT_MAX_AGE_HOURS`, 2, in event mode) and the last backup result;
- with `BACKUP_WAL=on`: archiving on and succeeding, the archive backlog, and base-backup age (`BACKUP_WAL_MAX_AGE_HOURS`, 26);
- delivery: Telegram alert on a new or changed problem, a reminder every `ALERT_REPEAT_HOURS` (6), a recovery message; a crash of the check itself is critical and alerted.

**Point-in-time recovery** (`BACKUP_WAL=on`, ws/a3-ops): `deploy/db/Dockerfile` (postgres:16-alpine + pgBackRest) and the `deploy/staging/compose.wal.yaml` overlay archive WAL at least every `BACKUP_WAL_ARCHIVE_TIMEOUT` (60) s to `<prefix>/pgbackrest`; `base-backup` (full weekly, differential otherwise); `pitr-restore` drills into a disposable project.

**Releases and rollback** (ws/a3-ops): `up` records each release (`.staging/releases.json`, 5 kept); `rollback` restarts `api` + `web` on older images without migrating. The migrate service runs `python -m app.schema_guard migrate`, which records the revision chain in `schema_compatibility` so older builds can accept a database ahead of them by backward-compatible migrations only.

**Monitoring endpoints** (ws/a3-ops): JSON logs with request ids (`CONGRESS_LOG_FORMAT`), `/api/metrics` behind `CONGRESS_METRICS_TOKEN` and the Caddy allow-list `CONGRESS_METRICS_ALLOW`, optional `CONGRESS_SENTRY_DSN`.

**Scheduling:** `deploy/hosted/systemd/congress-backup.{service,timer}` (nightly 02:30; hourly in event mode), `congress-basebackup.{service,timer}` (daily 03:15, only with `BACKUP_WAL=on`) and `congress-check.{service,timer}` (every 5 min; `check` sends its own alerts, exits 1/2 are not unit failures). `sudo node scripts/staging/stack.mjs install-timers --user congress` writes them for the actual checkout path, user and Node and enables them.

## 2. What was tested

| Test | Result |
|---|---|
| Backend mypy (strict) + pytest on disposable Docker | mypy clean, **244 passed** (6 new in `test_credential_hardening.py`: rotation, revocation and reinstatement, admin-only lifecycle, account lockout without collateral, success clears failures, admin-token guessing); 0 `ImmatureSignatureError` |
| Web unit / `tsc -b` | 63/63 / pass. **No frontend source changed** in this milestone; the full Playwright suite was not re-run (last run 169 passed / 1 skipped at `93e6965`). |
| In-place upgrade of running staging 0013 → 0014 (backup first) | migrate exit 0; 20 organizers preserved, all active |
| `verify-hardening.mjs` on staging | **6/6** — see below |
| `verify.mjs` on upgraded staging (journey 46/46, scanner real-API, Page Studio, crawler head, rebuild, stop/start, backup → restore 16/16) | **14/14**, exit 0 |

`verify-hardening.mjs` checks:
1. CLI create → rotate (old key 401, new 200) → revoke (401); no key appears in the list or in API/Caddy logs.
2. Through Caddy: 10 × 401 then 429 (Retry-After 900); another account is unaffected.
3. Hosted-mode edge in a throw-away container on the staging network (domain `congress.example.test`): HTTP → 308 to HTTPS with the query preserved, HSTS present, `/api/organizers` 404 from outside, `/api/ready` 200, and no localhost HTTP site.
   - This ran with `tls internal`. **ACME issuance was not exercised.**
4. A failed off-host upload (wrong secret) gives exit 1, `last-backup.json` `ok:false`, and `check` CRITICAL.
5. A successful scheduled backup: consistent; the off-host copy's SHA-256 equals the manifest; `check` exit 0.
6. That backup restores in a disposable project, 16/16.

**The off-host destination was a controlled stand-in** (`rclone serve s3` in a throw-away container), because no real provider credentials exist and MinIO images were not pullable. **Real off-host verification is pending.**

**Retention ran for real:** it removed 4 older ad-hoc test backups from today under the documented 7/4/6 rule. The pre-upgrade backup `staging-20261013-165633` was kept.

### 2.1 Operations drills (ws/a3-ops)

| Drill | Result |
|---|---|
| `restore-verify <name> --from-offsite` (download, decrypt, restore, compare) | passed |
| WAL archiving RPO: time from a commit until its segment is in the bucket | **8.6 s observed**; worst case ≈ `archive_timeout` (60 s) + upload, about 1 min |
| `pitr-restore --to <time>`: nothing newer than the target in `organizers`, `events`, `users`, `tickets`, `checkins`, `sms_messages`; API accepted the recovered schema | passed |
| `rollback` after an **unmarked** migration | refused by the schema guard; previous images restarted |
| `rollback` after a migration marked `backward_compatible = True` | worked; the older `migrate` left the database alone |

The bucket was again a local stand-in, not a real provider. **Not exercised:** ACME, a real S3 provider, systemd timers on Linux, a Sentry/GlitchTip endpoint, Telegram delivery (or a relay) from Iran.

## 3. Environment variables and secrets

The template is `deploy/hosted/.env.hosted.example`. On the server it becomes `.staging/staging.env`, which is git-ignored. The hosted template marks four secrets `<generate: …>` with the command that generates each: `POSTGRES_PASSWORD`, `CONGRESS_PLATFORM_ADMIN_TOKEN`, `CONGRESS_JWT_SECRET` and `CONGRESS_METRICS_TOKEN`. (`stack.mjs init` generates the same four, but from the *staging* template, `deploy/staging/.env.staging.example`, and only when `.staging/staging.env` does not exist yet.) `CONGRESS_SECRET_BOX_KEY` is not in the template; see below.

| Variable | Value on a real server |
|---|---|
| `CONGRESS_ENVIRONMENT` | `production` |
| `POSTGRES_PASSWORD`, `CONGRESS_PLATFORM_ADMIN_TOKEN`, `CONGRESS_JWT_SECRET` | generated on the server (hex / url-safe, ≥ 32 chars) |
| `CONGRESS_SECRET_BOX_KEY` (optional, recommended) | generated on the server (≥ 32 chars, different from the JWT secret); see below |
| `CONGRESS_PUBLIC_ORIGIN` | `https://<domain>` |
| `CONGRESS_SITE_ADDRESS` | `<domain>` |
| `CONGRESS_TLS` | ACME contact e-mail |
| `CONGRESS_LOCAL_HTTP` / `CONGRESS_HSTS` | `off` / `on` (HSTS only once the domain is final) |
| `CONGRESS_ADMIN_ALLOW` | `127.0.0.1/32` |
| `CONGRESS_BIND` / `CONGRESS_HTTPS_PORT` / `CONGRESS_HTTP_PORT` | `0.0.0.0` / `443` / `80` |
| `CONGRESS_METRICS_TOKEN` | generated (≥ 32 chars), or empty to disable `/api/metrics` |
| `CONGRESS_METRICS_ALLOW` | your Prometheus server's address, or `127.0.0.1/32` (nobody through the proxy) |
| `CONGRESS_LOG_FORMAT` / `CONGRESS_SENTRY_DSN` | empty (JSON logs) / optional DSN |
| `BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_PREFIX`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | from the backup provider (endpoint `https://` for WAL); keep them in `/etc/congress/backup.env` (root, group `congress`, mode 640), read by `stack.mjs` and every timer |
| `BACKUP_ENCRYPTION_KEY` | `openssl rand -base64 48`; also in the operator's password manager — without it no off-host copy can be restored |
| `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY`, `BACKUP_MAX_AGE_HOURS`, `BACKUP_EVENT_MAX_AGE_HOURS` | 7 / 4 / 6, 26, 2 |
| `BACKUP_WAL`, `BACKUP_WAL_ARCHIVE_TIMEOUT`, `_RETENTION_FULL`, `_FULL_DAYS`, `_MAX_AGE_HOURS`, `_QUEUE_MAX` | `on`, 60, 2, 7, 26, `1GiB` (point-in-time recovery) |
| `ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`, `ALERT_TELEGRAM_API`, `ALERT_REPEAT_HOURS` | bot from @BotFather, on-call chat, relay URL if Telegram is blocked, 6 |

The full list with defaults is in `STAGING_OPERATIONS.md` → *Operations settings*.

**Credentials stored in the database (the sms.ir API key saved in the platform console)** are encrypted with a key derived from `CONGRESS_SECRET_BOX_KEY`, or from `CONGRESS_JWT_SECRET` while that is unset. With the dedicated key, rotating the JWT secret (which signs out every session) no longer makes the stored key unreadable.

- Introducing it needs no migration: a key saved before still opens with the JWT secret, and it is encrypted again with the new key the next time the SMS settings are saved in the platform console (any change, for example the line number). Save them once before you rotate the JWT secret.
- Keep `CONGRESS_SECRET_BOX_KEY` with the other secrets and in the backup of `.staging/staging.env`: without it the stored API key cannot be read, and the console asks for it again.
- The staging/hosted Compose file does not pass this variable to the API yet; until it does (`CONGRESS_SECRET_BOX_KEY: ${CONGRESS_SECRET_BOX_KEY:-}` in the `x-backend` environment, plus a line in the `.env` examples), the JWT-derived key is used.

## 4. VPS sizing (measured, not guessed)

**Observed on staging** while the full journey ran: API ≈ 80–83 MiB, PostgreSQL ≈ 42–47 MiB, Caddy ≈ 46–57 MiB; CPU under 15 % of one core.

**Observed disk:**
- images: API 244 MB, web 68 MB, postgres 16-alpine ≈ 290 MB;
- data: 48 MiB of PostgreSQL holds 36 events and 58 users (mostly fixed overhead);
- backups are small (≈ 70 KB dump plus media).

**Recommendation for one congress:** **2 vCPU, 2 GB RAM, 40 GB SSD**.
- This leaves room for image builds on the server, which need Node and npm, and peak during `npm ci`/`vite build`. Building elsewhere and loading images reduces the need.
- Add disk in proportion to uploads: ≤ 200 images per event, each ≤ 2400 px after re-encoding.
- **Not measured:** load at real congress scale (hundreds of simultaneous gate scans). Run a load test before relying on 1 vCPU.
- Scale up the VPS, not the process count: **one uvicorn process** is the only tested configuration. Rate limits are now shared in PostgreSQL, but the metrics counters, SMS concurrency limit, settings cache and database pool are per process (`STAGING_OPERATIONS.md`, top), and several processes have not been load-tested.
- Disk: add room for 5 releases' images (rollback) and, with WAL, the local archive queue (up to `BACKUP_WAL_QUEUE_MAX`, 1 GiB).

## 5. DNS and firewall

- **DNS:** an `A` record (and `AAAA` if IPv6) for `<domain>` pointing to the VPS. Use a low TTL during the first deployment.
- **Firewall:** inbound **TCP 80 and 443** from anywhere (ACME HTTP-01 and the redirect), **SSH 22** from the operator's addresses only. Nothing else; PostgreSQL and the API are never published.
- **Outbound:** HTTPS to the ACME CA, the container registries, the backup endpoint (also from the `db` container when `BACKUP_WAL=on`) and the Telegram API or its relay.

## 6. Safe deployment procedure

> Server without direct internet: follow `docs/deployment/PROXY-QUICK-START.md` (`setup` → `verify` → `deploy`, same as DrGibi).
>
> CDN (ParsPack) in front, so the CDN issues the visitors' certificate and Caddy does not need Let's Encrypt: follow `docs/deployment/CDN.md`.

1. Install Docker Engine + Compose v2 and Node 22. Create an unprivileged `congress` user in the `docker` group. Clone the reviewed commit to `/opt/congress-platform`.
2. Copy `deploy/hosted/.env.hosted.example` to `.staging/staging.env` (mode 600). Fill in every `<…>` and generate the secrets on the server.
3. With DNS pointing at the server and ports 80/443 open: `node scripts/staging/stack.mjs up`. Watch the `web` log for certificate issuance with `stack.mjs logs web`.
4. `node scripts/staging/stack.mjs check` must exit 0.
5. Smoke test from outside:
   - `curl -I http://<domain>/` → 308 to HTTPS;
   - `https://<domain>/api/ready` → 200;
   - `https://<domain>/api/organizers` → 404.
6. Create organizers with `stack.mjs organizer create "<name>"` and hand each key over a secure channel.
7. Put `/etc/congress/backup.env` in place (off-host store, `BACKUP_ENCRYPTION_KEY`, optionally `BACKUP_WAL=on`, `ALERT_TELEGRAM_*`). With `BACKUP_WAL=on` run `stack.mjs up` again: it creates the pgBackRest stanza and takes the first full base backup.
8. Run `stack.mjs scheduled-backup` once by hand. Confirm it with `stack.mjs backups --offsite`, then `stack.mjs restore-verify <name> --from-offsite`. With WAL: `stack.mjs pitr-restore --to latest`.
9. Enable the timers: `sudo node scripts/staging/stack.mjs install-timers --user congress` (try `--dry-run` first). Confirm a Telegram message arrives for a deliberate problem and a recovery message after it.
10. **Updates:** `scheduled-backup` first, then `git pull` the reviewed commit, `stack.mjs up` (records the release), `check`. If the new release misbehaves: `stack.mjs rollback` (works only when its migrations are all `backward_compatible`; otherwise restore the pre-update backup or `pitr-restore` to just before it).
11. **Before congress day:** follow `STAGING_OPERATIONS.md` → *Before congress day* (`event-mode on`, verified off-host restore, PITR drill, alert test).

## 7. Backup and recovery

- **Routine:** the nightly timer (hourly in event mode), `last-backup.json`, the daily base backup with `BACKUP_WAL=on`, and `check` alerting on age or failure.
- **RPO:** nightly dumps only: up to a day (an hour in event mode). With `BACKUP_WAL=on`: about 1 minute for the database (8.6 s observed); media files still come from the newest scheduled backup.
- **Verification:** run `restore-verify <name> --from-offsite` monthly and after every migration, and `pitr-restore --to <time>` monthly with WAL. They only create and remove `congress-restore-*` / `congress-pitr-*` projects.
- **Real recovery:** as in `STAGING_OPERATIONS.md` → *Restoring for real* and *Point-in-time recovery*. The bucket holds **encrypted** files: a plain `rclone copy offsite:…` yields ciphertext; fetch through the `crypt` remote as shown there (*Fetching an off-host backup by hand*), verify, then restore into fresh folders. Never delete the old data before the restored stack passes `check`.

## 8. What should alert an operator during a live congress

- `check` exit 2: any container down or unhealthy, `/api/ready` failing, or a failed migration. Act immediately; gates and registration depend on it.
- 5xx above 5 % or more than 20 in 15 minutes, or repeated API tracebacks.
- Volume disk at 80 % (warning) or 90 % (critical).
- Backup older than 26 h (2 h in event mode) or the last backup failed; WAL archiving failing or behind; base backup older than 26 h.
- A burst of 429s on logins (credential stuffing or a locked-out operator): check `stack.mjs logs web`.
- **Delivery:** `check` sends these to Telegram itself every 5 minutes (deduplicated, reminder every 6 h, recovery message). Use the `X-Request-ID` from a user's failing request to find its lines in `stack.mjs logs api`.
- **Recovery:** `stack.mjs logs api|web|db`, then `stack.mjs start` (restarts stopped services, waits for health). A failed migration shows its error in `logs migrate`. A bad release: `stack.mjs rollback`. Restore only after `restore-verify`.

## 9. Still requires the real VPS, domain or provider

- [ ] ACME certificate issuance and renewal on the real domain (only `tls internal` was tested).
- [ ] HTTP→HTTPS redirect and admin blocking with real public client IPs (Linux Docker preserves source IPs; Docker Desktop was used here).
- [ ] Off-host backup to the real S3-compatible provider, including `restore-verify --from-offsite` and, with WAL, `pitr-restore` against that bucket (both passed against a local stand-in).
- [ ] systemd timers on the real Linux host (`install-timers`; rendering tested, units not run).
- [ ] Telegram alert delivery from the server, directly or through `ALERT_TELEGRAM_API` (relay) if `api.telegram.org` is blocked.
- [ ] Sentry/GlitchTip endpoint, if wanted (`CONGRESS_SENTRY_DSN`; scrubbing tested only with a capturing transport).
- [ ] Load test at expected congress concurrency; final VPS size.
- [ ] sms.ir account with a service line, API key and credit (every sign-in is an SMS code); a decision on a backup SMS provider (none is integrated).

## Infrastructure checklist the developer must supply

1. The final domain name(s) and who controls DNS.
2. VPS: provider, region, public IPv4/IPv6, OS (Ubuntu 24.04 LTS recommended), at least 2 vCPU / 2 GB RAM / 40 GB SSD, SSH access for the operator.
3. Firewall policy: allowed SSH source addresses; confirmation that inbound 80/443 is open.
4. ACME contact e-mail for certificates.
5. Off-host backup target: S3-compatible `https://` endpoint, region, bucket, prefix, an access key limited to that bucket, and the retention preference if it differs from 7/4/6. A decision on point-in-time recovery (`BACKUP_WAL=on`), and where the operator keeps `BACKUP_ENCRYPTION_KEY` off the server.
6. Telegram bot token and chat id for `check` alerts (and a relay URL if Telegram is not reachable from the server), and who is on call during the congress.
7. Organizer list (names) to provision, and a secure channel to deliver their keys.
8. Whether HSTS may be enabled immediately (domain final) and whether IPv6 is used.
9. The sms.ir API key and service line (entered in the platform console `/platform`), and whether a backup SMS provider is wanted (not integrated yet).
