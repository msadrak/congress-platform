# Upgrade programme — handover (2026-10-23)

This document hands the AITeb Congress upgrade programme to the next team. It is the single place
that says what the plan is, what is finished, what is half-finished, what has not started, and how
to continue safely. Read it fully before starting any work.

- **Integration branch:** `integration/upgrade` (every finished workstream is merged here).
- **Last fully verified tip:** the commit that adds this document, on top of the B5a merge — backend
  614 tests + mypy clean (unchanged by B5a), web unit 215, Playwright 284 passed / 1 skipped (the live-API
  scanner spec).
- **`main`** (`6deef3b`) has NOT been touched. Nothing is deployed by agents — the product owner
  deploys himself.

---

## 1. What the product is (one paragraph)

A multi-tenant congress platform for Iranian (medical) congresses: FastAPI + PostgreSQL backend
(`backend/`), React 19 PWA (`web/`), Persian (RTL) first with English. Personas: **platform admin**
(console, SMS gateway), **organizer** (tenant; now also **member accounts with roles**), **desk /
reception operator**, **gate scanner device** (web PWA `/scan/:pointId`), **exhibitor / booth staff**,
**attendee** (SMS-code sign-in, free tickets, pass with QR), **public visitor**. Registration is free
(ADR 0007, no payments). A native Flutter scanner in `mobile/` is **parked** (only a pure-Dart engine
with tests exists).

## 2. Confirmed product decisions (do not re-litigate)

| Decision | Choice |
|---|---|
| SMS link | Short link `/t/<code>` opening a **one-tap read-only pass** (no second SMS code). ADR 0015 |
| Persian glossary | «کارت ورود» = pass, «کد QR» = QR code, «بلیت» (never «بلیط»). A unit test (`web/tests/glossary.test.ts`) guards it |
| Attendee multi-congress page | `/me` replaces `/my-tickets` and `/my-network` (old URLs redirect) |
| `/` home | Stays the B2B marketing page, with an attendee "find my pass" entry |
| Wallet passes | Not wanted |
| Flutter app | Parked; the web PWA is the only production scanner |
| Organizer accounts | Member accounts (SMS code) with roles owner / manager / staff / viewer; the API key acts as owner. ADR 0016 |
| Exhibitor contact | Exhibitors see an attendee's mobile **only with the attendee's consent** (`share_contact_with_exhibitors`, default **off**) |
| Capacity | Real occupancy with IN/OUT scans (being built in C1, not merged) |
| Payments | Out of scope (ADR 0007) |
| Alerts | Telegram (via `ALERT_TELEGRAM_*`, optional relay) |
| Backup SMS provider | **Not chosen yet** (needs a contract) |
| Schedule PDFs | Ordinary links (http/https/mailto/tel/relative) are **allowed**; scripts, automatic actions, forms, embedded files and unsafe link schemes (javascript:, data:, file:, …) are refused; PDFs are served inline in a sandbox (decided 2026-10-23) |

## 3. How the work is organised

### 3.1 Branch model
- One branch per workstream: `ws/<id>-<name>`, branched from `integration/upgrade`.
- A coordinator merges each finished branch into `integration/upgrade`, re-chains its Alembic
  migration (see 3.3), regenerates `web/src/api/schema.d.ts`, runs **all** checks, then pushes.
- Push with plain `git push` over SSH (`git@github.com:drkalani/AITeb-Congress.git`). The `gh` CLI is
  not used. **Never deploy** — hand the product owner deploy notes (section 7).
- Commit messages: conventional commits, every message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### 3.2 Verification gates (every merge)
1. Backend: mypy strict + full pytest (see 8.2 for how to run without Docker).
2. `schema.d.ts` regenerated from the backend and byte-identical (`gen-api --check`). Never hand-merge it.
3. Web: `npm test`, `npm run lint` (warnings fail), `npx tsc -b`, `vite build`.
4. Full Playwright suite (mock-backed; ~8 min).
5. Read the result's real exit code before pushing (a trailing `echo` once hid failures).

### 3.3 Migrations — numbering and re-chaining
Numbers were reserved per workstream, but branches land in any order, so the **chain order differs
from the numbers**. The coordinator sets each new migration's `down_revision` to the current head at
merge time and updates the two head tests (`backend/tests/test_desk_session_migration.py` walk list,
`backend/tests/test_staging_support.py` `expected_revision()` + `match="requires …"`).

Current chain on `integration/upgrade` (head **0031** once `ws/booth-profile` is merged):

```
… 0018 → 0019 → 0020 → 0023 → 0024 → 0021 → 0022 → 0027 → 0028 → 0029 → 0030 → 0025 → 0026 → 0031
```

Rollback rule (CODING_STANDARDS §2.D): only migrations marked `backward_compatible = True` let an older
image run on the newer schema (`stack.mjs rollback`). Unmarked ones need a restore / PITR to go back.

## 4. Finished and merged (on `integration/upgrade`)

| Workstream | Branch | What it delivered |
|---|---|---|
| W0 hotfix | `ws/w0-hotfix` | Full SMS pass link; `/c/<slug>/*` fallback routes (cut links open the pass); NotFound page; header Log in / Log out by session; logout → congress sign-in; removed footer link to platform home (client issues 4 & 5) |
| W0 CI/tests | `ws/w0-foundations-ci` | Portable `scripts/check.sh`/`.bat`; committed backend test image; drift test (models == migrations) + round trip; CI jobs: Docker builds, Caddy validate (5 modes), pip-audit gate, npm audit, Playwright (Chromium); Dependabot |
| W0 errors/load | `ws/w0-foundations-errors` | `ApiError(status, CODE, detail)` → `{detail, code}`; web `apiErrorCode`/`localizedApiError` + fa/en map; k6 load harness (`scripts/load/`, targets met on a local stack) |
| Deps | `ws/deps-security` | Pillow 13, certifi, opentelemetry-api (audit clean); hostile-image tests |
| A1 security | `ws/a1-security` | Revoked organizer keys refused everywhere; device-less scanner tokens refused; SEO head `{`/`}` encoding (real Caddy template injection fixed); booth link schemes; no profile echo by phone; vCard escaping; active-ticket/QR checks; optional `CONGRESS_SECRET_BOX_KEY`; no `/docs` in production; typed user tokens (untyped accepted if issued before 2026-12-01) |
| A2 scanner | `ws/a2-scanner` | Device verdicts (locally rejected scans never admitted); `POST /scan` server-decided online scans; manifest deltas with **hashed** codes; batch ≤ 200; clock-skew flag; local wipe on unpair; Web Locks one tab per point; Persian-layout barcode guns; migration 0020 (verdict + clock-skew columns); the web scanner makes offline capacity gates fail closed |
| A3 ops | `ws/a3-ops` | Encrypted off-host backups (rclone crypt), pgBackRest WAL + PITR (RPO ≈ 1 min), SHA-tagged releases + `stack.mjs rollback`, schema_guard compatibility walk, JSON logs + `X-Request-ID`, Prometheus `/api/metrics` (token + edge allow-list), optional Sentry, Telegram alerts, timers/event-mode, ops docs |
| A4 short links | `ws/a4-short-links` | `/t/<code>` links, `POST /api/public/passes/resolve`, link-pass cache, codes kept out of logs, "link opened" in organizer SMS log (migration 0019, ADR 0015) |
| A5a frontend | `ws/a5a-frontend-foundation` | One attendee session store + policy; API client 401/network middleware; `useMutation` (no stuck spinners); titles; scroll reset; fa date format; no mono font on Persian |
| A5b organizer split | `ws/a5b-organizer-split` | 2,331-line page split into `web/src/pages/organizer/*` sections + `EventWorkspaceProvider` + merged form dialogs |
| B1 SMS/OTP | `ws/b1-sms-otp` | Codes sent outside DB transactions; Postgres-backed shared rate limits; venue networks; per-purpose budgets; single-use signup tokens; platform SMS caps; organizer test-SMS limits; outbox leases + retry/resolve; outbox health (migration 0022) |
| B2 integrity | `ws/b2-integrity` | CHECK constraints, same-event composite FKs, delete rules, indexes, race-safe inserts (`add_or_existing`), walk-in `Idempotency-Key`, DB pool/statement timeout (migration 0021) |
| B3 participants | `ws/b3-participants` | Registration snapshot on tickets; cancel / reissue / transfer (+ link revoke/mint); organizer **Participants page** (client issue 2); attendee profile edit, export, account deletion, self-cancel API; exhibitor consent; retention job (migration 0023) |
| B4 events/program | `ws/b4-events-program` | Event timezone, registration window, archive/delete, tier sales windows, program validation, **schedule files as PDF or image** (client issue 1), Jalali/Excel CSV import, public event list (migration 0024) |
| B5 hero | `ws/b5-hero` | Banner hero layout (whole image, every screen), consistent split, cover focal point + phone image (client issue 3) |
| B5b public | `ws/b5b-public` | Program/venue on `/e/:slug`, calendar/share/directions, compact session-aware dock, success sheet with QR, attendee-only public shell, mobile booth index, home attendee entry |
| B5 sign-in | `ws/b5-signin` | Live rate-limit countdown, profile step heading + visible CTA, no root links, slim mobile strip, auto-continue, pasted codes, language-following errors |
| C3 exhibitors | `ws/c3-exhibitors` | Staff removal + invite SMS, booth standee QR + one-tap bookmark, lead soft delete/restore/search, networking needs event + active ticket, consent-aware search (migration 0027) |
| C4 roles/audit | `ws/c4-audit-roles` | Member accounts + roles enforced centrally (`app/roles.py`, coverage test), append-only audit log + Activity page, Members page, rotation logs out older scanner/desk/member tokens (migrations 0028–0029, ADR 0016) |
| C5 analytics | `ws/c5-analytics` | SQL aggregation, event-timezone hourly buckets, shared filters, streamed CSVs, registrations CSV |
| D3 docs | `ws/d3-docs` | AGENTS.md/GLOSSARY truth-up, ADR status notes, stale-spec banners, research moves, CI follow-ups |
| B5a attendee shell | `ws/b5a-attendee-shell` | `/me`, four-tab panel + avatar + congress switcher, pass page (large QR, full-screen, states, self-cancel, install hint), glossary sweep. Merged and verified (unit 215, Playwright 284 passed / 1 skipped) |
| B5d attendee pages | `ws/b5d-attendee-pages` | My Congress before/during/after, program filters + personal agenda, network rework, profile edit/consent/export/delete, booth `?b=` |
| B6a organizer UI | `ws/b6a-organizer-ui` | Event settings/archive/delete, tier delete + sales windows, booth staff + standee QR, Page Studio leave guard + 409 choice, program times in event tz, role-aware UI, data router |
| C1 gate rules | `ws/c1-gate-rules` | Single-use per day, IN/OUT occupancy, tier filter with any policy, requires-point, session attendance + CSV, device heartbeat + stale dashboard, point archive (migration 0025) |
| C2 desk | `ws/c2-desk` | Badge QR lookup, admit at a point, badge prints + reprint flag, desk registration edit/cancel/reissue/transfer, operator invite/restore, archived points hidden (migration 0026) |
| B6b exhibitor | `ws/b6b-exhibitor` | Exhibitor portal split, server-side lead search/paging, trash + undo, offline lead queue, removed/suspended/archived screens |
| FIX-1…FIX-4 | `ws/fix1-auth-sms`, `ws/fix2-privacy`, `ws/fix3-exhibitor-network`, `ws/fix4-archive-robustness` | Auth/SMS abuse fixes; attendee logout + session version (migration 0030), export/deletion/retention; network/booth hardening; archived read-only + coded errors + streamed CSVs + PDF hardening |
| D2 live e2e | `ws/d2-live-e2e` | Live-backend Playwright journeys for every persona + CI job |
| DOCS-FIX | `ws/docsfix-runbook-adrs` | Event-day runbook, ADR notes + 6 new ADRs, docs truth-up |
| OPS-FIX-A / B | `ws/opsfix-a-deploy`, `ws/opsfix-b-ci-load` | Compose passes every setting, SMS-failure alerts + external heartbeat, metrics, Caddy request id, backup consistency; CI on ws/**, SHA-pinned actions, `check.sh --full`, load harness, derived migration head tests |
| WEB-FIX-1 / 2 | `ws/webfix1-public-attendee`, `ws/webfix2-console` | Registration-window states, booth/desk cards on /me, public congress list, event-tz times; platform members, readable activity labels, manager-only exports, `formatApiError` guard |
| PERF-1 | `ws/perf1-reservations` | Reservations and walk-ins take the tier place last (50/s met), `CONGRESS_API_WORKERS`, retention advisory lock |
| PWA-1, POLISH-2 (team2) | `ws/team2-pwa1-pwa-settings`, `ws/team2-polish2` | Manifest `orientation: any` + stable id, launch reopens the paired scanner; Persian number separators, Persian fallback for uncoded errors, `event_timezone` on passes |
| PDF links | `ws/pdf-allow-links` | Schedule PDFs may contain ordinary links (http/https/mailto/tel/relative); unsafe schemes refused, strings decoded like a PDF reader |
| UX foundations F1, F6, F7 | `ws/ux-f1`, `ws/ux-f6`, `ws/ux-f7` | F1 design tokens in `index.css` (radius scale in `@theme`, type and control-height tokens, 3:1 `--border-input`, one focus style, 48 px `.ui-*` controls) plus the cascade-layer order declared inline in `index.html` (production chunk CSS had let preflight beat component styles); F6 operator shell components, `ui/Toast`, `copy/operator.ts`; F7 booth `event_archived` and shorter default SMS texts |
| UX foundations F2, F3, F4, F5 | `ws/ux-f2`, `ws/ux-f3`, `ws/ux-f4`, `ws/team2-ux-f5` | F2 one formatter set in `lib/format.ts` and the Jalali `DateField`/`DateTimeField` (its words in `copy/dateField.ts`); F3 copy modules (`src/copy/`, `useCopy`, `useLocale`), Persian UI terms in the dictionary and error messages, glossary allowlist and `copyGuard` ratchet (`tests/copy-baseline.json`; operator `dir` ternaries and `lib/format.ts` locale tags/separators are baselined), `<html lang="fa" dir="rtl">` by default; F4 shared ui primitives (`components/ui/*`, `uiCopy.ts`; `ConfirmDialog` needs `confirmLabel`); F5 (team2) home-screen launch target, offline sign-in, one `InstallHint` with `persona` (words in `copy/install.ts`), `useHidScanner`/`useWakeLock`/`useAppUpdate`, `QrCameraInput` `autoStart`/`continuous` |
| UX foundation F8 | `ws/ux-f8` | Organizer scaffold: `canEdit`, offline handling, `RolePicker` |
| UX phase 1 (all but ATT-SHELL) | `ws/team2-ux-att-pass`, `ws/ux-booth`, `ws/ux-plat`, `ws/ux-desk`, `ws/ux-org4`, `ws/ux-scan`, `ws/ux-org1`, `ws/ux-pub`, `ws/ux-org2`, `ws/ux-org3` | Pass and link pass, booth panel, platform admin, reception desk, scanner, public pages, and the organizer console (shell, program/venue/Page Studio, check-in/pass types/booths/operators, participants/SMS/statistics), each with its `src/copy/<area>.ts` |

### Client-reported issues
| # | Issue | Status |
|---|---|---|
| 1 | Upload the schedule as PDF and image | Done (B4) |
| 2 | Participant details editable and deletable | Done (B3: organizer Participants page; desk-side editing is in C2, not merged) |
| 3 | Landing image not responsive / different on mobile | Done (B5-hero) |
| 4 | Remove main-homepage link from the user panel | Done (W0) |
| 5 | SMS "my ticket" links broken; Logout shown when signed out | Done (W0 + A4 short links) |

## 5. In flight — UX implementation (UX-IMPL)

A product-owner UX review (2026-10-23) produced `docs/ux-review/UX_PLAN.md` (decisions, phases, exclusive
file lists) and five specs in `docs/ux-review/*/SPEC.md`. Status per package is on `WORKBOARD.md`.
Phase 0 (foundations: tokens, Jalali dates/format, copy guards, PWA launch/offline, operator shell,
backend flag + SMS defaults, ui primitives, organizer scaffold) → phase 1 (per-portal packages) → UX-Z.

## 6. Not started (remaining plan)

See `WORKBOARD.md` (free and later rows). Human-only: staging deploy + dress rehearsal on real devices
(HW-1), real-infrastructure ops drills (OPS-1), staging load re-run (LOAD-1), backup SMS provider
choice (SMS-2), merging `integration/upgrade` into `main`.

## 7. Deploy notes (cumulative, for the product owner)

**Upgrading the installed `main` (rehearsed 2026-10-23 on real data, OLD `main` → this branch; the same list is in
`docs/deployment/STAGING_OPERATIONS.md` → *Upgrading an existing install*):**

1. Pick a time outside any congress, when no scanner holds offline scans that have not synced.
2. `node scripts/staging/stack.mjs scheduled-backup` (or `backup`) with the current checkout; copy it off the machine.
3. `git status`: if `deploy/staging/Caddyfile` was edited by hand (the old "delete the http://localhost block" step),
   `git checkout -- deploy/staging/Caddyfile` (`CONGRESS_LOCAL_HTTP=off` does the same).
4. Only with off-host copies (`BACKUP_S3_*`): add `BACKUP_ENCRYPTION_KEY` (`openssl rand -base64 48`) to
   `/etc/congress/backup.env` and the password manager, ideally with a new `BACKUP_S3_PREFIX`.
5. `git pull`, then `node scripts/staging/stack.mjs up`. It adds `CONGRESS_SECRET_BOX_KEY` to `.staging/staging.env`
   itself, runs 0019–0031 in one transaction (under a minute on the rehearsal data) and records the first release.
6. `node scripts/staging/stack.mjs check`. Then save the updated `.staging/staging.env` with the server's secrets.
7. Linux timers: `sudo node scripts/staging/stack.mjs install-timers --user <operating user>` once.
8. Reload the scanner devices. Tell organizers and operators about the new screens.

Nothing else needs a manual edit. Every new variable defaults when it is absent. A console OTP length below 6 is
raised to 6. There is no `rollback` to `main`: the way back after a successful upgrade is the backup from step 2. If
`up` stops at `migrate`, the database is still at 0018 and the previous commit's `up` brings the old release back.
Migrations 0019, 0020, 0021, 0022 and 0023 are not rollback-compatible, so going back needs restore/PITR.

**Migrations** (run by the migrate service, `python -m app.schema_guard migrate`):

| Rev | Purpose | Image rollback OK |
|---|---|---|
| 0019 | short links (backfills one per ticket) | no |
| 0020 | scanner device verdicts / clock skew | no |
| 0023 | ticket registration snapshot (backfilled, NOT NULL), cancellation, consent, deletion | no |
| 0024 | event lifecycle, tier sales windows, program files | yes |
| 0021 | integrity constraints, same-event FKs, `leads.event_id` (backfilled), desk idempotency keys — **stops with a clear error if existing rows violate a rule** | no |
| 0022 | shared rate-limit counters, outbox lease | no (could be marked) |
| 0027 | lead soft delete | yes |
| 0028 / 0029 | audit log / organizer members | yes |
| 0030 | user session version (attendee logout everywhere) | yes |
| 0025 | check-in policies, occupancy, session attendance, device heartbeat | yes |
| 0026 | badge prints, desk check-ins | yes |
| 0031 | booth logo (`booths.logo_asset_id`) | yes |

**New environment variables (all optional unless noted):**
`CONGRESS_SHORT_LINK_ORIGIN`, `CONGRESS_SECRET_BOX_KEY` (recommended; added by `up`),
`CONGRESS_METRICS_TOKEN` + `CONGRESS_METRICS_ALLOW`, `CONGRESS_LOG_FORMAT`, `CONGRESS_SENTRY_DSN`,
`BACKUP_*` (encryption key required once S3 is set; WAL/PITR settings), `ALERT_TELEGRAM_*`,
`CONGRESS_OTP_TRUSTED_NETWORKS` (set to venue Wi-Fi), `CONGRESS_OTP_SENDS_PER_TRUSTED_IP_PER_HOUR`,
`CONGRESS_SMS_HOURLY_CAP` / `CONGRESS_SMS_DAILY_CAP`, `CONGRESS_SMS_TEST_SENDS_PER_ORGANIZER_PER_DAY`,
`CONGRESS_SMS_MAX_CONCURRENT_SENDS`, `CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS`,
`CONGRESS_SMSIR_TIMEOUT_SECONDS` (default now 5), `CONGRESS_API_WORKERS` (API workers per container;
the API image now starts with `python -m app.serve`), `ALERT_HEARTBEAT_URL`, `ALERT_SMS_FAILED_MAX`,
`ALERT_SMS_LAG_MINUTES` / `ALERT_SMS_LAG_CRITICAL_MINUTES`, `ALERT_CERT_WARN_DAYS`,
`CONGRESS_AUDIT_RETENTION_DAYS`, `CONGRESS_SHORT_LINK_GRACE_DAYS`, `CONGRESS_SMS_NOTICES_PER_*`,
`CONGRESS_SMS_OTP_RESERVE_PERCENT` (compose now passes every setting through). **Staging/production refuse to start if
`CONGRESS_OTP_LENGTH` < 6** (older env files never set it; a shorter length saved in the platform console is raised to 6).
`CONGRESS_SECRET_BOX_KEY` is passed by compose and added by `stack.mjs up` when missing.

**Caddy:** separate `short_links` logger (codes never logged); `/api/metrics` edge block.

**Behaviour changes users will notice:**
1. **Scanner PWAs must be updated together with the backend** (hashed manifest). Old scanner apps reject
   every badge on the new API. Never deploy during an event.
2. Offline capacity gates reject everyone until back online.
3. Reserving needs a published page and an open registration window.
4. Exhibitors no longer see attendee mobiles without consent (default off).
5. Rotating an organizer key logs out paired scanners, desk operators and member sessions.
6. `/docs`, `/redoc`, `/openapi.json` are off in production.
7. Attendee sessions issued before 2026-12-01 keep working until they expire.
8. The web app manifest `start_url` is now `/?source=pwa` (same `id`, so existing installs stay one app);
   the installed app opens the paired scanner point, else the pass when the phone holds one live or upcoming
   congress, else /me, else the last booth or desk; all offline.
9. Schedule PDFs with ordinary web links are accepted; javascript:/data:/file: links are refused.
10. Errors without a known code show a Persian sentence in fa instead of the server's English text.
11. SMS default texts are shorter (saved overrides untouched); booth API has `event_archived`.
12. Rate limits are now strict under concurrency (fixes possible over-budget OTP/SMS sends); desk and booth APIs return event_timezone.
13. **New UI everywhere** (UX-IMPL, `docs/ux-review/UX_PLAN.md`): one design system (40/48/56 px buttons, 12 px controls,
    Jalali date pickers, Persian digits, congress time zone), much less text, organizer nav in two groups
    («روز همایش» / «راه‌اندازی»), scanner/desk/booth on one operator shell. Old links redirect:
    `/organizer/events/:id/venue` → program `?tab=venue`, `…/panel` → Page Studio `?preview=panel`; platform SMS is now
    `/platform/sms`. Desk and organizer sessions stay per tab (no install prompt there). Tell organizers and
    operators the screens changed before the next congress.
14. Booth representatives edit their booth page (description, website, brochure, logo) from the booth panel menu
    «ویرایش صفحهٔ غرفه»; the name, page address and stand stay the organizer's. Booths get logos (organizer booth form,
    public booth page, booth directory). Logos are congress images: they count toward the 200-image limit per congress.

## 8. Environment and tooling notes (important)

### 8.1 This machine
- **Docker was hung** from 2026-10-23 (even `docker ps` hangs) after the disk hit 99 %. It was not
  restarted because the product owner's other projects (`drgibi*`, `nkf*`) share Docker Desktop.
  `scripts/check.sh` and `scripts/integration/backend-tests.mjs` need Docker.
- **Disk is chronically ~98 % full** (`Docker.raw` ≈ 121 GB; a ≈ 31 GB Cursor
  `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`). Keep parallel agents modest
  (≈ 5), symlink worktree `web/node_modules` to the main checkout's, no Playwright traces/videos,
  delete `web/dist` after runs.
- `uv` and `dart` are not installed locally; network is flaky (retry `uv sync`/`npm ci`).
- Playwright: Edge isn't installed and the bundled Chromium mismatches — use
  `CONGRESS_BROWSER_CHANNEL=chrome`; with a symlinked `node_modules`, Vite needs `--configLoader runner`.

### 8.2 Running backend tests without Docker (fallback that worked)
1. A Python 3.11 venv with the locked dependencies (export from `backend/uv.lock`, or `pip install`
   the packages in `backend/pyproject.toml` incl. dev group) plus `uv` and `pgserver`
   (pip-installable PostgreSQL 16).
2. Start PostgreSQL from `pgserver`'s bundled binaries (`initdb` once, `pg_ctl -o "-p 47131"`),
   create role `congress`/`congress` (superuser).
3. In `backend/`: `CONGRESS_TEST_DATABASE_URL=postgresql+asyncpg://congress:congress@127.0.0.1:47131/<name>_test python -m mypy && python -m pytest -q`
   (the DB name must end in `_test`; use one per branch to run in parallel).
4. API types without Docker: in `backend/`, with `CONGRESS_ENVIRONMENT=development`,
   `CONGRESS_PLATFORM_ADMIN_TOKEN=schema-export`, a 32+ char `CONGRESS_JWT_SECRET`, dump
   `create_app_from_env().openapi()` to JSON and run
   `node web/node_modules/openapi-typescript/bin/cli.js openapi.json -o web/src/api/schema.d.ts`
   (byte-identical to `scripts/gen-api.mjs`).
5. When Docker works again, prefer `./scripts/check.sh` (it runs everything).

### 8.3 Worktrees
Agent worktrees live under `.claude/worktrees/` (excluded locally via `.git/info/exclude`); the
coordinator's integration worktree is `.claude/worktrees/integration`. Remote branches are the source of
truth — a new team should clone/fetch and work from the `ws/*` branches.

## 9. Recommended next steps (in order)

1. Fetch and run the full gates once on `integration/upgrade` to establish your baseline.
2. **Finish and merge the five WIP branches** (section 5), one at a time, each fully verified;
   suggested order: C2 (desk, completes client issue 2 at the desk), B6a, B6b, B5d (resolve against
   B5a), C1 (largest; touches the scanner engine — coordinate scanner PWA rollout).
3. **Ask the product owner** for the open decisions in section 10.
4. **Prepare a release:** decide when `integration/upgrade` goes to `main` (PR on GitHub), take a
   backup, deploy to staging, run the load scripts and a dress rehearsal on real devices, then
   production — never during an event.
5. Then the "not started" list (section 6).

## 10. Open questions for the product owner
1. Exhibitor consent default is **off** — how should attendees be asked (registration checkbox wording)?
2. Backup SMS provider: which one (adapter is ready to add)?
3. OTP enumeration edge: during an sms.ir failure, a desk/organizer-purpose request from a real member
   answers differently from a stranger's. Hiding it fully would hide send failures from real members.
4. Audit log retention period (default proposal 2 years; no purge implemented).
5. When to merge `integration/upgrade` into `main`, and the staging test window before production.

## 11. Where to read more
- ADRs: `docs/adr/` — especially 0015 (short links), 0016 (members/roles/audit), and the status notes
  added to 0002–0013.
- `docs/CODING_STANDARDS.md` — §2.D migrations/rollback, §2.F coded errors, §4 tests/CI.
- `docs/deployment/STAGING_OPERATIONS.md`, `HOSTED_STAGING_READINESS.md`, `docs/pilot/08-BACKUP-RECOVERY.md`.
- `scripts/load/README.md` — load targets and how to run them.
- `GLOSSARY.md`, `AGENTS.md`.
