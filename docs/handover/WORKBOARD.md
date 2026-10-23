# Workboard — who is doing what

Single place to claim work on the upgrade programme. Read `UPGRADE_HANDOVER.md` first.

## Persian UI terms (decided 2026-10-23 — use in every new string)
Ticket type / tier = «نوع کارت ورود» · attendee ticket = «کارت ورود» · session = «جلسه» · check-in point = «نقطه ورود» · QR = «کد QR» · never «بلیط» · walk-in = «ثبت‌نام حضوری». The full term list (portal names, «لید», «پیوند», banned words) is `docs/ux-review/UX_PLAN.md` §1.

## How to claim (any team)
1. `git fetch origin` and look at the newest version of this file on `integration/upgrade`.
2. Pick a row whose status is **free**. Check its "Files / area" column does not overlap a row that is **taken**.
3. Edit this file: set owner (team name), branch, status `taken`, date. Commit only this file
   (`docs(workboard): <team> claims <id>`) and push to `integration/upgrade`. If the push is rejected,
   fetch, re-check the row is still free, and retry.
4. Work on your own branch (`ws/<team>-<id>-<name>`) from `integration/upgrade`; pass all gates
   (handover §3.2). New migrations: number ≥ 0030, `down_revision` = current head; the merger re-chains.
5. When done, set status `ready to merge` here and push your branch (or open a GitHub PR into
   `integration/upgrade`). Do not merge into `integration/upgrade` yourself — one merger
   (the coordinator session `aiteb-congress-7d` on the product owner's Mac) merges, verifies and pushes.
6. Same-Mac teams: use ports from 47500 up, your own `*_test` database names, and never touch Docker
   containers you did not start.

Status values: `free` · `taken` · `ready to merge` · `merged` · `blocked (reason)`.

## In progress (taken)

| ID | Owner | Branch | Scope | Files / area | Status |
|---|---|---|---|---|---|
| C2 | coordinator team | `ws/c2-desk` | Desk: QR lookup, admit at a point, badge prints + reprint flag, desk registration edits/cancel/reissue/transfer, operator invite/restore, desk search Persian folding, archived checks, resend via `consume` | `backend/app/routes/desk.py`, migration 0026, `web/src/components/reception/*`, `ReceptionPortal.tsx`, `pages/organizer/EventOperators.tsx`, `OperatorFormDialog.tsx` | merged |
| C1 | coordinator team | `ws/c1-gate-rules` | Single-use per day, IN/OUT occupancy, tier filter with any policy, requires-point, session attendance + CSV, device heartbeat + dashboard, point archive | `backend/app/routes/checkin.py`, `routes/session_attendance.py`, migration 0025, `web/src/pages/GateScanner.tsx`, `web/src/lib/scanner*.ts`, `components/scanner/*`, `pages/organizer/EventCheckIn.tsx`, `CheckInPointFormDialog.tsx` | merged |
| B6a | coordinator team | `ws/b6a-organizer-ui` | Event settings/archive/delete, tier delete + sales windows, booth staff + standee QR, Page Studio leave-guard + 409 choice, program times in event tz, role-aware UI | `web/src/pages/organizer/*` (except check-in/operators), `components/organizer/*` (same), `OrganizerPageStudio.tsx`, `OrganizerProgram.tsx` | merged |
| B6b | coordinator team | `ws/b6b-exhibitor` | Exhibitor portal: server search, trash + undo, offline lead queue, removed-staff screen | `web/src/pages/ExhibitorPortal.tsx`, `web/src/components/booth/*`, `web/src/lib/lead*.ts` | merged |
| B5d | coordinator team | `ws/b5d-attendee-pages` | My Congress state machine, program filters/agenda, network rework, profile edit/consent/export/delete, booth `?b=` | `MyCongress.tsx`, `CongressDetails*`, `MyNetwork.tsx`, `MyProfile.tsx`, `BoothDirectory.tsx`, `PublicBooth.tsx`, `components/attendee/*` (except pass card) | merged |
| D2 | coordinator team | `ws/d2-live-e2e` | Live-backend Playwright journeys for every persona + CI job | `web/e2e-live/*`, `web/playwright.live.config.ts`, `scripts/integration/live-e2e.mjs`, one CI job | merged |
| FIX-1 | coordinator team | `ws/fix1-auth-sms` | Organizer-key throttle lockout (expired tokens), SMS cap abuse (reserve/cancel loops, organizer notices, OTP headroom), re-register race, `ip_group` limiters, admin token compare | `backend/app/auth.py`, `security.py`, `routes/tickets.py`, `app/ticket_lifecycle.py`, `sms/gateway.py`, limiter lines in `passes.py`/`booths.py` | merged |
| FIX-2 | coordinator team | `ws/fix2-privacy` | Attendee logout + session_version (migration 0030), account deletion/export completeness, retention (OTP rows, short links, idempotency keys), outbox skips deleted/cancelled | `routes/auth.py` (session parts), `app/account.py`, `app/retention.py`, `sms/outbox.py`, `lib/attendeeSession.ts` | merged |
| FIX-3 | coordinator team | `ws/fix3-exhibitor-network` | Network scan race, input size limits, booth-staff tenant revocation/archive, archived network/bookmarks, `public_media` archived, paginated legacy lists, streamed leads CSV | `routes/leads.py`, `routes/network.py`, `routes/booths.py` (staff/bookmark parts), `public_media` in `routes/pages.py` | merged |
| FIX-4 | coordinator team | `ws/fix4-archive-robustness` | Archived read-only on booths/participants/SMS/Page Studio, template save race, last-owner lock, coded errors, SMS log cursor, streamed participants CSV, short-link expiry on date change, PDF hardening | `routes/participants.py`, `routes/sms.py`, `routes/events.py`, `app/links.py`, `app/media.py`, `sms/templates.py`, `routes/organizer_console.py`, dependency lines in `booths.py`/`pages.py` | merged |
| PWA-1 | team2 (second agent team) | `ws/team2-pwa1-pwa-settings` | Manifest `orientation: any` + stable `id: "/"`; `start_url` is `/?source=pwa`, rewritten before the app renders to the device's own paired scanner point (plain `/` otherwise; offline too); captive-portal-aware `probeServer` + `serverReachability` monitor + `useServerReachability` hook (real `/api/health` round trip) for C1 to adopt — nothing consumes it yet. Web only: no migration, no env var, no backend. Done 2026-10-23, verified on `03003a3` + branch: backend 648, web unit 275, Playwright 318 | `web/pwa-manifest.ts` (new; manifest moved out of `vite.config.ts`), `web/vite.config.ts` (manifest block → import), `web/src/lib/pwaRegistration.ts` (+1 `await`), new `web/src/lib/launchTarget.ts`, `serverReachability.ts`, `web/src/hooks/useServerReachability.ts`, new `web/tests/{launchTarget,serverReachability,pwaManifest}.test.ts`, `web/e2e/pwa-launch.spec.ts`. Merge notes: C1's `vite.config.ts` hunk (`__APP_BUILD__`) auto-merges; B6a's data-router `main.tsx` verified compatible (keep `./lib/pwaRegistration` imported before the router is created) | merged |
| POLISH-2 | team2 (second agent team) | `ws/team2-polish2` | Shared-lib polish + one small API field: (1) `formatLocalizedNumber` in `web/src/lib/i18n.ts` uses a Latin thousands comma in fa («۵,۰۰۰») → Persian separator «٬»; (2) `localizedApiError` in `web/src/api/client.ts` falls back to the English `detail` for errors without a code → localized generic sentence by HTTP status (keep English detail only in en or as a tooltip/diagnostic); (3) backend: add `event_timezone` to the attendee ticket response (`GET /api/attendees/me/tickets`, `routes/tickets.py`) and to the link-pass resolve response (`routes/passes.py`), regenerate `schema.d.ts`; (4) web: `DigitalPassCard` shows dates in that zone. Done 2026-10-23, merged with `75fcab0` and verified on the merge (`75fcab0..7b5d785`): backend 712, web unit 283, staging 26, Playwright 343. API change is additive (`event_timezone: string` on `AttendeeTicketDetail` and `LinkPassOut`; no migration, no env var). Behaviour change: in fa, an error without a known code now reads as a generic localized sentence by status instead of the server's English text; bare `result.error` bodies carry no status (so they get the neutral sentence, or the 422 one for a validation body) until a call site passes `result.response.status` as the new optional third argument | `web/src/lib/i18n.ts` (number formatter only), `web/src/api/client.ts` (fallback + `apiErrorDiagnostic`/`genericApiErrorMessage`), `routes/tickets.py` + `routes/passes.py` (response model only), `components/attendee/DigitalPassCard.tsx`, new `web/src/lib/passDates.ts` (zone-aware range/issued date; `congressTime.ts` left alone: WEB-FIX-1 "attendee time display"), `web/src/lib/linkPass.ts` (`linkPassCard` +1 line), `schema.d.ts` (regenerated), tests incl. `web/e2e/pass-event-timezone.spec.ts`. Merge notes: `Me.tsx` untouched (its date ranges can adopt `passDates.ts` later); `errorMessages.ts` untouched; regenerate `schema.d.ts` rather than hand-merging; `web/tests/apiErrorCodes.test.ts` has one deliberately changed test (fa fallback) | merged |
| AUD-WEB | coordinator team | (read-only) | Frontend/UX gap audit, all personas | none | merged (report done) |
| UX-REVIEW | coordinator team | (read-only) | Product-owner UX pass: all personas/scenarios, simple & minimal (remove unnecessary text), consistent design system, device fit, PWA install on mobile. 5 reviewers: design system, attendee/public, organizer/platform, on-site operators, copy/i18n → specs in `docs/ux-review/*/SPEC.md`, plan `docs/ux-review/UX_PLAN.md` | none | merged (report done) |
| WEB-FIX-1 | coordinator team | `ws/webfix1-public-attendee` | Registration-window states on the public page, booth/desk entry cards on `/me` + switcher, public congress list on `/` and signed-out `/me`, event-timezone times on public/attendee pages, touch targets | `PublicEvent.tsx`, `components/public/*`, `Home.tsx`, `Me.tsx`, `AttendeeLayout.tsx` (switcher), attendee time display | merged |
| WEB-FIX-2 | coordinator team | `ws/webfix2-console` | Platform console members drawer, readable Activity/Members labels, analytics StrictMode bug + tz label, platform error localization + touch targets, `formatApiError` guard test | `Platform*.tsx`, `OrganizerMembers*`, Activity page, `lib/organizerConsole.ts`, `OrganizerAnalytics.tsx` | merged |
| AUD-OPS | coordinator team | (read-only) | Ops/CI/docs gap audit | none | merged (report done) |
| OPS-FIX-A | coordinator team | `ws/opsfix-a-deploy` | Referer log leak, compose passes every setting + secret-box key in init, SMS-failure alerts + external heartbeat, metrics, Caddy request id, backup consistency for program files, dev/stack data-dir collision | `deploy/**`, `scripts/staging/**` (except verify.mjs CLI), `backend/app/config.py` validators, `backend/app/observability.py` | merged |
| OPS-FIX-B | coordinator team | `ws/opsfix-b-ci-load` | Load harness vs current API + new scenarios, CI gaps (ws/** CI, uv --locked, db image, compose smoke, k6 inspect, timeouts), `check.sh --full`, verify.mjs project/paths, .gitignore, head tests derive head | `scripts/load/**`, `.github/**`, `scripts/check.*`, `scripts/staging/verify.mjs` (CLI/paths), `.gitignore`, `AGENTS.md`, 2 head tests | merged |
| DOCS-FIX | coordinator team | `ws/docsfix-runbook-adrs` | Event-day runbook rewrite, stale rate-limit docs, upgrade rehearsal + migration compatibility table, ADR status notes + 6 new ADRs, docs truth, root README | `docs/**` (except `docs/handover/*`), `README.md`, `web/README.md`, `mobile/README.md`, `GLOSSARY.md`, `SPEC*.md`, `REPORT.md` | merged |

## Free — can be claimed now

| ID | Scope | Files / area | Notes |
|---|---|---|---|
| OPS-1 | Real-infrastructure drills: ACME on the real domain, a real S3 provider for encrypted backups + PITR restore drill, systemd timers on a Linux host, Sentry endpoint, Telegram delivery/relay from Iran | `deploy/**`, `scripts/staging/**` (only fixes found), docs | Needs server access — a human or ops team with credentials |
| LOAD-1 | Re-run `scripts/load/` on staging after the next deploy; update targets/notes for the current API (published page, OTP budgets, hashed manifest) | `scripts/load/**` | Needs a staging stack |
| SMS-2 | Backup SMS provider adapter with failover only on definite non-delivery | `backend/app/sms/provider.py`, `gateway.py` | **blocked** until the product owner chooses a provider |

## UX-IMPL — UI/UX implementation (from the UX review)

**Read `docs/ux-review/UX_PLAN.md` first** — decisions (§1), phases and exclusive file lists (§2), critical items (§3),
how to work (§4). Specs: `docs/ux-review/{ds,att,org,ops,copy}/SPEC.md`. These rows absorb A11Y-1, GLOSS-2, DATE-1 and POLISH-1.
The batch (C2, B6b, WEB-FIX-1/2, OPS-FIX-B, PWA-1, PERF-1, POLISH-2, pdf links) is merged — start from the `integration/upgrade` tip.
Branch `ws/ux-<id>` (team2: `ws/team2-ux-<id>`). A phase-1 package starts when the foundations it needs are merged.

| ID | Phase | Needs | Owner | Status |
|---|---|---|---|---|
| UX-F1 tokens | 0 | — | coordinator team | merged (`ws/ux-f1` a3b34a7) |
| UX-F2 format & Jalali dates | 0 | — | coordinator team | merged (`ws/ux-f2` 74c732a) |
| UX-F3 copy foundation + guards | 0 | — | coordinator team | merged (`ws/ux-f3` 596ed48) |
| UX-F5 PWA launch, install, offline sign-in, device hooks (critical) | 0 | — | team2 | merged (`ws/team2-ux-f5` 4989c8f; report below) |
| UX-F6 operator shell components | 0 | — | coordinator team | merged (`ws/ux-f6` d245b42) |
| UX-F7 backend: booth `event_archived`, SMS default texts | 0 | — | coordinator team | merged (`ws/ux-f7` 3940717) |
| UX-F4 shared ui primitives | 0 | F1 | coordinator team | merged (`ws/ux-f4` 5af511a) |
| UX-F8 organizer scaffold (`canEdit`, offline, RolePicker) | 0 | F4 | coordinator team | taken |
| UX-SCAN scanner | 1 | F1–F6 | coordinator team | waiting |
| UX-DESK reception desk | 1 | F1–F6 | coordinator team | waiting |
| UX-BOOTH booth panel | 1 | F1–F7 | coordinator team | waiting |
| UX-ATT-PASS pass + link pass (also `lib/ticketCache.ts`) | 1 | F1–F5 | team2 | taken (`ws/team2-ux-att-pass`) |
| UX-ATT-SHELL attendee shell, Home/Program, /me, Network, Profile | 1 | F1–F5 | team2 | waiting |
| UX-PUB platform home, public congress, reservation, booth page | 1 | F1–F4 | coordinator team | waiting |
| UX-ORG-1 organizer shell, congress list, overview, members, activity | 1 | F1–F4, F8 | coordinator team | waiting |
| UX-ORG-2 program, venue, Page Studio | 1 | F1–F4, F8 | coordinator team | waiting |
| UX-ORG-3 check-in, operators, ticket types, booths | 1 | F1–F4, F8 | coordinator team | waiting |
| UX-ORG-4 participants, SMS, statistics | 1 | F1–F4, F8 | coordinator team | waiting |
| UX-PLAT platform admin | 1 | F1–F4, F8 | coordinator team | waiting |
| UX-Z cleanup, design guard, copy baseline 0, screenshot re-run | 2 | all of phase 1 | coordinator team | waiting |

### UX-F5 report (team2, 2026-10-23) — `ws/team2-ux-f5` at `4989c8f`, from `0170ef6`

Web only: no migration, no env var, no backend, no new dependency, no `schema.d.ts` change. A dry merge into `3bf1b43` is clean (no shared files).

**What changed.**
- **Launch** (`lib/launchTarget.ts`; `pwa-manifest.ts`, `pwaRegistration.ts`, `vite.config.ts` need no functional change — Workbox already serves offline deep links). The home-screen icon opens, in order: the paired scanner point → the pass (`/c/<slug>/my-ticket`) when the device holds exactly one live/upcoming active pass → `/me` for several → the last booth/desk recorded on the device → `/me` when only a session exists → `/` (clean address). All local-storage/IndexedDB reads; works offline. Cached passes are read without the 7-day cap.
- **Offline sign-in** (`AttendeeSignIn.tsx`): a stored session with an unreachable server (fetch failure or HTTP ≥500 from `/api/auth/me`) continues to the destination (`?next=` honoured); a 401 still shows the phone form.
- **Install** (`InstallHint.tsx`, `installPrompt.ts`): one component, `persona` = `attendee | scanner | booth`. T6 rules in `installAllowedOnPath`/`installOffer`: never on public, organizer, platform or desk pages, never when installed (display-mode or `navigator.standalone`), never after «بعداً»/"Not now" (dismissal kept per persona), attendee/booth only on phones. iOS Safari gets a 3-step «چطور؟» sheet and **no offline promise**; iOS in-app browsers (Instagram etc.) get nothing; Android Chrome uses the native prompt, hides on `appinstalled`.
- **Hooks**: `useHidScanner` (burst of ≥8 keys <60 ms + Enter = a code, `preventDefault` on the burst's keys, slow typing passes through; `createRepeatFilter`), `useWakeLock` (re-acquires on visibility, swallows refusals), `useAppUpdate`. `AppUpdatePrompt` is hidden on `/scan`, `/booth`, `/reception`. `QrCameraInput` gained `autoStart` (only when camera permission is already granted) and `continuous` (repeat-filtered).

**`InstallHint` props (stable):** `{ locale: AttendeeLocale; persona?: "attendee" | "scanner" | "booth" }` (default `"attendee"`). It decides for itself whether to render (route + device + dismissal), so callers just mount it. Test ids: `install-hint`, `install-action`, `install-how`, `install-ios-steps`, `install-ios-step`. Allowed paths: attendee `/c/:slug/my-ticket` and `/t/:code`; scanner `/scan[/:id]`; booth `/booth/:id` (not `/sign-in`). The booth strings are mine (copy SPEC §8 has none).

**Gates (real exit codes).** `npm test` 0 (460 pass) · `npm run lint` 0 · `npx tsc -b` 0 · `vite build` 0 · `e2e/pwa-launch.spec.ts` 0 (27 pass; 3 deliberate source breaks made exactly the 5 expected tests fail) · full Playwright on `vite preview` :47531, `CONGRESS_BROWSER_CHANNEL=chrome` **0 (416 passed, 12.3 min)** · `./scripts/check.sh` **0** (mypy 145 files clean, pytest 762 passed, `schema.d.ts` matches, web unit 460, staging 26, Dart tests + analyze clean). Screenshots (JPEG, fa + en; iOS row, iOS «چطور؟» sheet, Android row at 390×844 and 360×740, desktop with no row at 1440×900): `/tmp/team2-f5-shots/` on the shared Mac. `web/dist` deleted.

**Files outside my list.** `web/e2e/attendee-me-and-pass.spec.ts` (UX-ATT-SHELL's): deleted the single case "the add-to-home-screen hint uses the install prompt and stays dismissed" — it ran on a desktop pointer with the old button names; `pwa-launch.spec.ts` covers the install row on iOS, Android and desktop.

**For the coordinator at merge.**
1. `web/src/lib/ticketCache.ts` (phase-0 file, not mine): the 7-day TTL defeats offline launch at the gate for a congress that starts later. Keep a cached pass until its congress ends (`launchTarget` already reads the cache without the TTL, so the launch works either way; the pass page does not).
2. `docs/handover/UPGRADE_HANDOVER.md` ~line 185 describes the launch rewrite as "paired scanner point" only; it now also covers the pass, `/me`, booth and desk.
3. The att spec suggests emulating `display-mode: standalone` through CDP `Emulation.setEmulatedMedia`; Chrome ignores it. The e2e overrides `matchMedia` instead.

**For the operator packages (UX-SCAN, UX-DESK, UX-BOOTH).**
- Call `recordOperatorLaunch("scan" | "booth" | "desk", path)` (from `lib/launchTarget`) once the screen is ready. Without it a booth-staff device (which holds an attendee token) opens `/me` from the icon; with it, it reopens its booth or desk.
- Use `useHidScanner(onCode)`, `useWakeLock()` and `useAppUpdate()` rather than local copies. UX-DESK can delete its `KeyBurst` (the desk passes its `badgeCode` filter inside its own `onCode`).
- Known limit: the first 1–3 keys of a burst can reach a focused text field before the burst is recognised; clear the field in `onCode`.
- `QrCameraInput` `autoStart`/`continuous` have unit tests for the repeat filter only; no screen mounts them yet.

**Left over.** `useWakeLock` has no consumer until UX-ATT-PASS wires it into `QrFullscreen`. The pass card still says «شناسه رهگیری بلیت» (ATT-PASS's file; I will fix it there).

## Later (start after the overlapping branches merge)

| ID | Scope | Waits for |
|---|---|---|
| GLOSS-2 | Folded into UX-IMPL (see `docs/ux-review/UX_PLAN.md`) | — |
| A11Y-1 | Folded into UX-IMPL (see `docs/ux-review/UX_PLAN.md`) | — |
| DATE-1 | Folded into UX-IMPL (see `docs/ux-review/UX_PLAN.md`) | — |
| ARCH-2 | Archived read-only on desk and check-in routes (if C1/C2 leave gaps) | C1, C2 merged |
| POLISH-1 | Folded into UX-IMPL (see `docs/ux-review/UX_PLAN.md`) | — |
| HW-1 | Hardware/browser matrix by a person: iOS Safari, Android Chrome, barcode guns, thermal printer; dress rehearsal | release candidate |
| TOKEN-1 | Remove the untyped attendee-token allowance (`LEGACY_UNTYPED_USER_TOKENS_UNTIL`) | after 2026-12-08 |

| FOLLOW-1 | DB pool timeout returns 503 with a retry hint instead of 500 | — |
| FOLLOW-2 | Remove the remaining manual `onKeyRejected` 401 calls (EventCheckIn, CheckInPointFormDialog, EventOperators, OperatorFormDialog, OrganizerProgram, OrganizerPageStudio) — do it inside the UX-ORG packages that own those files | UX-ORG-2/3 |
| FOLLOW-3 | Call sites pass `result.response.status` to `localizedApiError` (POLISH-2 third argument) so fa errors get the status-specific sentence | UX phase 1 (each package for its files) |
| TOKEN-2 | Remove `LEGACY_UNVERSIONED_USER_TOKENS_UNTIL` | after 2027-01-08 |
