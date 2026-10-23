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

Current chain on `integration/upgrade` (head **0029**):

```
… 0018 → 0019 → 0020 → 0023 → 0024 → 0021 → 0022 → 0027 → 0028 → 0029
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
| A2 scanner | `ws/a2-scanner` | Device verdicts (locally rejected scans never admitted); `POST /scan` server-decided online scans; manifest deltas with **hashed** codes; batch ≤ 200; clock-skew flag; local wipe on unpair; Web Locks one tab per point; Persian-layout barcode guns; offline capacity fails closed (migration 0020) |
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

### Client-reported issues
| # | Issue | Status |
|---|---|---|
| 1 | Upload the schedule as PDF and image | Done (B4) |
| 2 | Participant details editable and deletable | Done (B3: organizer Participants page; desk-side editing is in C2, not merged) |
| 3 | Landing image not responsive / different on mobile | Done (B5-hero) |
| 4 | Remove main-homepage link from the user panel | Done (W0) |
| 5 | SMS "my ticket" links broken; Logout shown when signed out | Done (W0 + A4 short links) |

## 5. In flight — stopped mid-task (WIP pushed, UNVERIFIED)

Each branch below was stopped on request. Its last commit is
`wip(<scope>): UNVERIFIED checkpoint — agent stopped mid-task by request`: work saved as-is, **not
type-checked or tested after the last edits**. All branched from `823f52a`. Continue on the branch,
make it green, then merge (re-chain migrations after **0029**).

| Branch | Done (committed before the WIP) | Left to do |
|---|---|---|
| `ws/b5d-attendee-pages` | Pure helpers; program (day tabs, track/hall filters, search, personal agenda, per-session .ics); My Congress before/during/after state machine; network "my code / scan", notes after scan, searchable paged contacts + delete; profile edit, consents, language, data export, account deletion; one-tap booth save from standee `?b=` | WIP touched e2e specs and several attendee components (BoothDirectory, CongressDetailsView, CongressHero, CongressHomeView, PhaseBadge, attendeeCopy, congressTime) + new `attendee-home.spec.ts`. Finish spec updates (signin-discovery profile/scan tests), run full checks. Expect conflicts with B5a (`i18n.ts` glossary lines, `MyNetwork.tsx`, `CongressHomeView.tsx`) — B5a is merged first |
| `ws/b6a-organizer-ui` | Data router (so pages can block navigation); `PAGE_DRAFT_STALE` code; event-clock helpers; event settings + archive + delete; tier sales windows + delete; booth staff list + printable standee QR | Page Studio leave-guard + 409 "keep mine / load latest" (WIP in studioCopy/pageDocument), program times in event timezone, removing redundant `onKeyRejected`, role-aware UI, tests |
| `ws/b6b-exhibitor` | ExhibitorPortal split into Capture / Qualify / LeadList | WIP: server-side lead search + load more, delete with undo + trash, export include_deleted, removed-staff screen, offline lead queue (`leadQueue*.ts`, `useLeadQueue.ts`, `PendingSyncPanel.tsx` exist, unfinished), consent indicator, tests |
| `ws/c1-gate-rules` | Nothing committed before the WIP | WIP: migration `0025_checkin_policies.py`, `routes/session_attendance.py`, edits in checkin/analytics/desk/participants/roles/models/main + head tests. Brief: single-use per DAY window (event tz) with server/client parity; IN/OUT occupancy; tier filter with any policy; `requires_point_id`; session-door points + attendance report/CSV; device heartbeat + stale dashboard; point archive. Needs scanner engine + UI work and all tests |
| `ws/c2-desk` | Migration `0026` (`ticket_prints`, `desk_checkins`, expand only); QR lookup, admit at a point, badge prints, desk registration edits/cancel/reissue/transfer, operator invite + restore (backend) | WIP: ReceptionStation split into AttendeeCard / AttendeeSearch / DeskAuthGate / MintedDialog / WalkInForm (`deskTypes.ts`). Finish UI (badge print view, needs-reprint flag, admit, QR lookup), operator URL on `EventOperators.tsx`, resend pass outside the DB transaction, tests |

## 6. Not started (remaining plan)

1. **Accessibility pass (D1):** field `aria-describedby`, tab/switch semantics, route focus
   management, VoiceOver/TalkBack check.
2. **Jalali date picker** for organizer date inputs (CSV import already accepts Jalali).
3. **PWA settings:** manifest `orientation: any`; installed scanner reopens its point (`start_url`);
   captive-portal detection.
4. **Test expansion (D2):** one Playwright journey per persona against a real backend; the
   `scanner-real-api` spec in CI with a live API; hardware matrix by a person (iOS Safari, Android
   Chrome, barcode guns, thermal printer).
5. **Event-day rehearsal (D4):** load test re-run on staging (`scripts/load/`), full dress rehearsal on
   real devices (≈ 3 gates, desk, booths, 20 people), updated runbook.
6. **Ops drills on real infrastructure:** ACME, a real S3 provider, systemd timers on Linux, Sentry,
   Telegram delivery/relay from Iran (only local drills were done).
7. **Backup SMS provider adapter (B1 step 2.7):** blocked on choosing a provider.
8. **Desk/scanner title & glossary leftovers:** GateScanner has no page title; a few `font-mono`
   spots (OrganizerAnalytics, MobileOtpForm, AttendeeSignIn mobile display, PageSections program times).
9. **Spread `WritableEventDep`** (archived events read-only) to booths, check-in points, operators,
   SMS templates and participants (currently only B4's routes).
10. **Remove the untyped-attendee-token allowance** (`LEGACY_UNTYPED_USER_TOKENS_UNTIL`) after 2026-12-08.

## 7. Deploy notes (cumulative, for the product owner)

**Before deploying:** take a backup (`node scripts/staging/stack.mjs backup`). Migrations 0019, 0020,
0021, 0022 and 0023 are not rollback-compatible — going back needs restore/PITR.

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

**New environment variables (all optional unless noted):**
`CONGRESS_SHORT_LINK_ORIGIN`, `CONGRESS_SECRET_BOX_KEY` (recommended; check compose passes it),
`CONGRESS_METRICS_TOKEN` + `CONGRESS_METRICS_ALLOW`, `CONGRESS_LOG_FORMAT`, `CONGRESS_SENTRY_DSN`,
`BACKUP_*` (encryption key required once S3 is set; WAL/PITR settings), `ALERT_TELEGRAM_*`,
`CONGRESS_OTP_TRUSTED_NETWORKS` (set to venue Wi-Fi), `CONGRESS_OTP_SENDS_PER_TRUSTED_IP_PER_HOUR`,
`CONGRESS_SMS_HOURLY_CAP` / `CONGRESS_SMS_DAILY_CAP`, `CONGRESS_SMS_TEST_SENDS_PER_ORGANIZER_PER_DAY`,
`CONGRESS_SMS_MAX_CONCURRENT_SENDS`, `CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS`,
`CONGRESS_SMSIR_TIMEOUT_SECONDS` (default now 5). **Staging/production refuse to start if
`CONGRESS_OTP_LENGTH` < 6.**

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
