# Milestone 09 — Dockerized Local Staging

Branch `integration/task-05h`, started at `9a38def9e3649c55ea6d056d07c5bbabd08f9727`. Nothing was pushed or deployed publicly. The persistent `.demo` environment and unrelated Docker resources were not touched. The operations guide is [`STAGING_OPERATIONS.md`](STAGING_OPERATIONS.md).

| Commit | Content |
|---|---|
| `d7ddeb25be0ddf1656ed284960033f057ee59a25` | Backend image, server-side `<head>` for public pages, schema guard, advisory-locked migrations, tests |
| `4bbd564d6920d64388b67605129b2b3f9f6170a7` | Compose stack, Caddy, web image, staging tooling (backup/restore/verify), browser-test fixes |
| `fa22f1195c70dde7e26046faf290b9f4df0e31e7` | `.gitattributes`: container files keep LF |
| *(this report's commit)* | Report, guide, evidence |

**Result.** The staging stack **is running now** at **https://localhost:8443** (and http://localhost:18080 on localhost). `scripts/staging/verify.mjs` passes **14/14** on it, and the fresh-deployment check passed on the first run against empty volumes.

## 1. Architecture

```
browser ──HTTPS 127.0.0.1:8443──┐
        ──HTTP  127.0.0.1:18080─┤  web (Caddy 2, production SPA, TLS: internal CA)
                                 │   /api/*  → api:8000      /e/*  → SPA shell + server <head>
           network "edge"        │   else    → static files, SPA fallback
──────────────────────────────── │ ───── network "backend" (internal, no internet, no published ports)
                                 ├── api      (FastAPI/uvicorn, uid 10001, media volume)
                                 ├── migrate  (one-shot alembic upgrade head; api waits for exit 0)
                                 └── db       (PostgreSQL 16)
```

**Volumes:** `congress-staging_pgdata`, `congress-staging_media`, `congress-staging_caddy_data`, `congress-staging_caddy_config`.

**Images**, both built locally:
- `congress-platform/api:staging` — uv-locked, Python 3.11, Pillow.
- `congress-platform/web:staging` — `npm ci` + `vite build` inside the image, served by Caddy.

**Migrations.**
- Run by the `migrate` service only, with a PostgreSQL advisory lock.
- In staging/production the API **refuses to start** unless the database is at its own Alembic head.

**Service states at the end of the run:** `db` healthy, `migrate` exited 0, `api` healthy, `web` healthy; `/api/health` 200, `/api/ready` 200.

## 2. Verification on staging (`node scripts/staging/verify.mjs`, final run exit 0)

| # | Check | Result |
|---|---|---|
| 00 | All services healthy; schema 0013; only `web` publishes ports, both on 127.0.0.1 | PASS |
| 01 | Fresh deployment has no organizers, users, events, tickets or media (first run with `--fresh`) | PASS |
| 02 | HTTPS with a chain verified against the exported Caddy root CA (no verification disabled) | PASS |
| 03 | Deep links (`/organizer/events/…/page`) return the SPA; `sw.js` and `index.html` are `no-cache`; hashed assets are `immutable` with JS MIME; CSP, nosniff, Referrer-, Permissions- (camera=self) and Frame-Options are set; no `Server` header | PASS |
| 04 | No admin token, JWT secret or DB password in the JS bundle or in any container log | PASS |
| 05 | 7 portal routes render over HTTPS with no page or CSP errors; scanner page has `isSecureContext`, a service worker and `getUserMedia` | PASS |
| 06 | Full congress journey through Caddy: organizer, Page Studio publish, registration, reception (walk-in, duplicates, capacity, revocation), scanner (pairing, SINGLE_USE, **offline queue + sync**, idempotent replay, revocation), exhibitor leads + CSV, analytics + CSV, cross-tenant and credential-family isolation | **46/46** |
| 07 | `scanner-real-api.spec.ts` against staging | 1 passed |
| 08 | New organizer uploads an image, publishes a branded page with SEO; an attendee registers and gets a ticket; a second congress stays unpublished | PASS |
| 09 | Crawler view, no JavaScript (Node HTTPS GET of `/e/<slug>`): escaped `<title>`, description, `og:*`, absolute HTTPS `og:image` (fetches 200 `image/png`), canonical; SPA still boots; the unpublished slug's head equals the unknown slug's (`noindex`, no draft text); booth page title | PASS |
| 10 | Published page renders in a browser over HTTPS with the cover image | PASS |
| 11 | API image rebuilt and container re-created: same image bytes (SHA-256), page still public | PASS |
| 12 | `stop` + `start` of the whole stack: counts of events, users, tickets, published pages and media unchanged; image bytes identical; attendee logs in and still has 1 ticket | PASS |
| 13 | Backup (pg_dump + media tar + manifest) restored into a **separate** `congress-restore-*` project; migrate + API start on it; all row counts, every media SHA-256, every published page and image served by the restored API match | **16/16** |
| 14 | Staging volumes intact, no restore volumes left, staging still serving | PASS |

**Earlier runs, reported truthfully:**
- A 15/15 run on fresh volumes had two failures:
  - Caddy kept the restarted API marked unhealthy, which gave empty responses. Fixed with `lb_try_duration` instead of active health checks.
  - The verifier reused a stale keep-alive socket after `stop`. Fixed with `agent: false`.
- A later run found that journey E4 counted leads across all congresses. Fixed by scoping the count to this run's booths.
- A port conflict was found: another local Python process listens on `0.0.0.0:8080`/`[::]:8080`. The staging HTTP port moved to **18080**.
- One run failed check 11 once with a transient `docker compose build api` error. The same build succeeded immediately afterwards; the next full run passed 14/14.

**Migration upgrade path.** Beyond the fresh install (0 → 0013), `tests/test_page_migration.py` and `tests/test_desk_session_migration.py` prove populated upgrades (0011→0012, 0012→0013). Restarts re-ran `migrate` as a no-op against the existing database.

Evidence lives in `docs/deployment/staging-evidence/`: `last-run.json`, `journey-last-run.json`, `crawler-head.html`, `backup-manifest.json`, journey screenshots, `scanner-https.png`, `public-page-https.png`.

## 3. Regression fix: `attendee-authority` › owner isolation

**Cause.**
1. The test asserted A's *cached* pass, which renders instantly, then switched the stored session to B before A's live response arrived.
2. `MyTickets` correctly discards a response that arrives after a session change. So A's bookmarks never rendered, and the test waited 60 s for a "Remove Bookmark" button that, by design, could not appear.
3. The race depended on timing alone and is unrelated to Page Studio.

**Fix.** The test now waits for A's bookmarks before switching. The security assertions are unchanged: no A content under B, B's token kept.

**After the fix:** spec ×5 → **125/125**; full suite **169 passed, 1 skipped**, exit 0.

## 4. Tests (final code)

| Suite | Exit | Result |
|---|---|---|
| Backend mypy + pytest on disposable Docker (`backend-tests.mjs`) | 0 | mypy clean (63 files), **238 passed**, 0 clock steps, 0 `ImmatureSignatureError` |
| Web unit (`npm test`) | 0 | 63/63 |
| `tsc -b` / `npm run build` | 0 / 0 | pass |
| `oxlint` | 0 | 0 errors, 15 warnings (pre-existing files) |
| Playwright full suite (intercepted APIs) | 0 | **169 passed, 1 skipped** (real-API spec without token) |
| Page Studio lifecycle (`page-studio-e2e.mjs`, disposable stack) | 0 | 15/15 |
| Staging verification (`verify.mjs`): journey 46/46, scanner real-API 1/1, restore 16/16 | 0 | 14/14 |

## 5. Commands

```powershell
node scripts/staging/stack.mjs init        # once: generated secrets in .staging\staging.env
node scripts/staging/stack.mjs up          # build + migrate + start, waits for healthy
node scripts/staging/stack.mjs status
node scripts/staging/stack.mjs logs [api|web|db|migrate]
node scripts/staging/stack.mjs stop
node scripts/staging/stack.mjs start
node scripts/staging/stack.mjs ca          # export local root CA (.staging\caddy-root.crt)
node scripts/staging/stack.mjs backup
node scripts/staging/stack.mjs backups
node scripts/staging/stack.mjs restore-verify <backup-name>
node scripts/staging/verify.mjs [--fresh]  # end-to-end verification
```

Never run `docker compose down -v` on `congress-staging`.

## 6. Remaining limitations before a real server

- **Real domain:** set `CONGRESS_SITE_ADDRESS`/`CONGRESS_TLS`/`CONGRESS_PUBLIC_ORIGIN`, remove the `http://localhost` block, add HSTS and open 80/443. Not exercised here: no public host or ACME certificate was issued.
- **Backups:** no scheduled backups or off-host copies yet. Retention policy is documented only.
- **Monitoring:** no alerting beyond health checks and logs.
- **Organizer keys** cannot be rotated or revoked; there are no organizer accounts.
- **Caddy** runs as root in its official image.
- **CSP** keeps `'unsafe-inline'` for styles.
- **Local CA:** the test browser used the localhost HTTP listener for service-worker and offline steps because it does not trust the local CA. HTTPS itself was verified with the CA.
- **Images** have one rendition; there is no CDN.
