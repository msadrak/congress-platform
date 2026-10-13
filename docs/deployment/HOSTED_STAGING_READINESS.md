# Hosted Staging Readiness — Milestone 10

Branch `integration/task-05h`, started at `93e6965ae8a64ddf54265052f36bb27f833bb250`. Nothing was deployed, pushed or changed in DNS. The demo was not touched. Staging data was kept; staging was upgraded in place to schema 0014 after a backup.

| Commit | Content |
|---|---|
| `46324deda15d1455b3dce4ffb376e62cf96b9e69` | Organizer key rotation/revocation (migration 0014), failed-authentication throttling, tests |
| *(this handoff's commit)* | Hosted Caddy modes, scheduled/off-host backups with retention, health check, operator CLI, systemd units, docs, evidence |

## 1. What was implemented

**Organizer credential lifecycle** (admin token only; existing keys keep working):
- `GET /api/organizers` lists tenants without keys or hashes.
- `POST /api/organizers/{id}/rotate-key` returns the new key **once**. The old key fails from the same commit. Rotation also reinstates a revoked tenant.
- `POST /api/organizers/{id}/revoke` makes the key rejected exactly like an unknown key (same 401 body). Data stays intact.
- Operators use `node scripts/staging/stack.mjs organizer list|create|rotate|revoke`. It runs inside the API container, so the admin token never leaves the server and never crosses the public proxy.
- Revoking a key does not end scanner-device or reception-operator sessions already issued for that tenant's events. Revoke those separately in the workspace (API exists for both).

**Authentication throttling.**
- Failed attempts are counted in-process and only failures count:
  - user login and desk-operator login: 10 per account and 100 per client IP per 15 min;
  - admin token: 10 per IP;
  - organizer API key: 50 per IP.
- Over budget returns 429 with Retry-After. A successful sign-in clears the account counter.
- The client IP is the real visitor address: uvicorn trusts only Caddy, and Caddy replaces any client-supplied `X-Forwarded-For`.
- Limits: counters live per process and reset on restart. Someone who knows a victim's e-mail can lock that account for 15 minutes. Registration is not throttled, because a whole venue can share one NAT.

**Password recovery.** There is no self-service reset for attendees or desk operators; it needs an e-mail provider (SMTP/transactional), which is not configured.
- Today the organizer re-adds an operator to issue a new one-time password.
- Attendees have no recovery path; an operator must register them again with another e-mail address.
- Before public launch, decide on a provider. This is a product requirement, not something staging can solve.

**Hosted edge** (same Compose stack, environment-driven):
- `CONGRESS_LOCAL_HTTP=off`: no `http://localhost` site; Caddy redirects every HTTP request to HTTPS (308).
- `CONGRESS_HSTS=on` sends `Strict-Transport-Security: max-age=31536000`.
- `CONGRESS_ADMIN_ALLOW=127.0.0.1/32` makes `/api/organizers*` answer 404 through the proxy.
- `CONGRESS_TLS=<e-mail>` lets Caddy obtain public ACME certificates.
- Unchanged: CSP and security headers, no published DB/API ports, absolute `og:` URLs from `CONGRESS_PUBLIC_ORIGIN`, and CORS limited to that origin.
- No cookies are used (bearer tokens only), so there are no cookie flags to set.

**Backups** (`stack.mjs scheduled-backup`):
1. `pg_dump` is taken first, then the media tar, with a consistency check that every database image is in the archive. Missing images fail the run.
2. Optional off-host copy to any S3-compatible bucket (`BACKUP_S3_*`) via `rclone`, then a checksum `rclone check`.
3. Retention keeps the newest `BACKUP_KEEP_DAILY` backups (7), plus one per week for `BACKUP_KEEP_WEEKLY` weeks (4) and one per month for `BACKUP_KEEP_MONTHLY` months (6), both locally and remotely.
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
- backup age (critical over `BACKUP_MAX_AGE_HOURS`, 26) and the last backup result.

**Scheduling templates:** `deploy/hosted/systemd/congress-backup.{service,timer}` (nightly 02:30) and `congress-check.{service,timer}` (every 5 min, attach an `OnFailure=` alert).

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

## 3. Environment variables and secrets

The template is `deploy/hosted/.env.hosted.example`. On the server it becomes `.staging/staging.env`, which is git-ignored. `stack.mjs init` generates the three secrets.

| Variable | Value on a real server |
|---|---|
| `CONGRESS_ENVIRONMENT` | `production` |
| `POSTGRES_PASSWORD`, `CONGRESS_PLATFORM_ADMIN_TOKEN`, `CONGRESS_JWT_SECRET` | generated on the server (hex / url-safe, ≥ 32 chars) |
| `CONGRESS_PUBLIC_ORIGIN` | `https://<domain>` |
| `CONGRESS_SITE_ADDRESS` | `<domain>` |
| `CONGRESS_TLS` | ACME contact e-mail |
| `CONGRESS_LOCAL_HTTP` / `CONGRESS_HSTS` | `off` / `on` (HSTS only once the domain is final) |
| `CONGRESS_ADMIN_ALLOW` | `127.0.0.1/32` |
| `CONGRESS_BIND` / `CONGRESS_HTTPS_PORT` / `CONGRESS_HTTP_PORT` | `0.0.0.0` / `443` / `80` |
| `BACKUP_S3_ENDPOINT`, `_REGION`, `_BUCKET`, `_PREFIX`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY` | from the backup provider; keep them in `/etc/congress/backup.env` (root-only) for the timer |
| `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY`, `BACKUP_MAX_AGE_HOURS` | 7 / 4 / 6, 26 |

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

## 5. DNS and firewall

- **DNS:** an `A` record (and `AAAA` if IPv6) for `<domain>` pointing to the VPS. Use a low TTL during the first deployment.
- **Firewall:** inbound **TCP 80 and 443** from anywhere (ACME HTTP-01 and the redirect), **SSH 22** from the operator's addresses only. Nothing else; PostgreSQL and the API are never published.
- **Outbound:** HTTPS to the ACME CA, the container registries and the backup endpoint.

## 6. Safe deployment procedure

1. Install Docker Engine + Compose v2 and Node 22. Create an unprivileged `congress` user in the `docker` group. Clone the reviewed commit to `/opt/congress-platform`.
2. Copy `deploy/hosted/.env.hosted.example` to `.staging/staging.env` (mode 600). Fill in every `<…>` and generate the secrets on the server.
3. With DNS pointing at the server and ports 80/443 open: `node scripts/staging/stack.mjs up`. Watch the `web` log for certificate issuance with `stack.mjs logs web`.
4. `node scripts/staging/stack.mjs check` must exit 0.
5. Smoke test from outside:
   - `curl -I http://<domain>/` → 308 to HTTPS;
   - `https://<domain>/api/ready` → 200;
   - `https://<domain>/api/organizers` → 404.
6. Create organizers with `stack.mjs organizer create "<name>"` and hand each key over a secure channel.
7. Put `/etc/congress/backup.env` in place, then run `stack.mjs scheduled-backup` once by hand. Confirm the copy in the bucket, then `stack.mjs restore-verify <name>`.
8. Enable the timers: `systemctl enable --now congress-backup.timer congress-check.timer`, plus an `OnFailure` alert.
9. **Updates:** `scheduled-backup` first, then `git pull` the reviewed commit, `stack.mjs up`, `check`.

## 7. Backup and recovery

- **Routine:** the nightly timer, `last-backup.json`, and `check` alerting on age or failure.
- **Verification:** run `restore-verify <name>` monthly and after every migration. It only creates and removes `congress-restore-*` projects.
- **Real recovery:** as in `STAGING_OPERATIONS.md` → *Restoring for real*. Download the backup directory from the bucket with `rclone copy offsite:<bucket>/<prefix>/<name> .staging/backups/<name>`, verify it, then restore into fresh volumes. Never delete the old volumes before the restored stack passes `check`.

## 8. What should alert an operator during a live congress

- `check` exit 2: any container down or unhealthy, `/api/ready` failing, or a failed migration. Act immediately; gates and registration depend on it.
- 5xx above 5 % or more than 20 in 15 minutes, or repeated API tracebacks.
- Volume disk at 80 % (warning) or 90 % (critical).
- Backup older than 26 h or the last backup failed.
- A burst of 429s on logins (credential stuffing or a locked-out operator): check `stack.mjs logs web`.
- **Recovery:** `stack.mjs logs api|web|db`, then `stack.mjs start` (restarts stopped services, waits for health). A failed migration shows its error in `logs migrate`. Restore only after `restore-verify`.

## 9. Still requires the real VPS, domain or provider

- [ ] ACME certificate issuance and renewal on the real domain (only `tls internal` was tested).
- [ ] HTTP→HTTPS redirect and admin blocking with real public client IPs (Linux Docker preserves source IPs; Docker Desktop was used here).
- [ ] Off-host backup to the real S3-compatible provider, including a restore from a copy downloaded out of that bucket.
- [ ] systemd timers and the alert delivery channel (units are provided but not run).
- [ ] Load test at expected congress concurrency; final VPS size.
- [ ] Decision on an e-mail provider for password recovery.

## Infrastructure checklist the developer must supply

1. The final domain name(s) and who controls DNS.
2. VPS: provider, region, public IPv4/IPv6, OS (Ubuntu 24.04 LTS recommended), at least 2 vCPU / 2 GB RAM / 40 GB SSD, SSH access for the operator.
3. Firewall policy: allowed SSH source addresses; confirmation that inbound 80/443 is open.
4. ACME contact e-mail for certificates.
5. Off-host backup target: S3-compatible endpoint, region, bucket, prefix, an access key limited to that bucket, and the retention preference if it differs from 7/4/6.
6. Alert channel for `check`/backup failures (e-mail, Telegram or webhook) and who is on call during the congress.
7. Organizer list (names) to provision, and a secure channel to deliver their keys.
8. Whether HSTS may be enabled immediately (domain final) and whether IPv6 is used.
9. An e-mail provider decision (for future password recovery), or explicit acceptance of the operator-assisted process.
