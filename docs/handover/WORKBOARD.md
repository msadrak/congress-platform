# Workboard — who is doing what

Single place to claim work on the upgrade programme. Read `UPGRADE_HANDOVER.md` first.

## Persian UI terms (decided 2026-10-23 — use in every new string)
Ticket type / tier = «نوع کارت ورود» · attendee ticket = «کارت ورود» · session = «جلسه» · check-in point = «نقطه ورود» · QR = «کد QR» · never «بلیط» · walk-in = «ثبت‌نام حضوری».

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
| C2 | coordinator team | `ws/c2-desk` | Desk: QR lookup, admit at a point, badge prints + reprint flag, desk registration edits/cancel/reissue/transfer, operator invite/restore, desk search Persian folding, archived checks, resend via `consume` | `backend/app/routes/desk.py`, migration 0026, `web/src/components/reception/*`, `ReceptionPortal.tsx`, `pages/organizer/EventOperators.tsx`, `OperatorFormDialog.tsx` | taken |
| C1 | coordinator team | `ws/c1-gate-rules` | Single-use per day, IN/OUT occupancy, tier filter with any policy, requires-point, session attendance + CSV, device heartbeat + dashboard, point archive | `backend/app/routes/checkin.py`, `routes/session_attendance.py`, migration 0025, `web/src/pages/GateScanner.tsx`, `web/src/lib/scanner*.ts`, `components/scanner/*`, `pages/organizer/EventCheckIn.tsx`, `CheckInPointFormDialog.tsx` | ready to merge |
| B6a | coordinator team | `ws/b6a-organizer-ui` | Event settings/archive/delete, tier delete + sales windows, booth staff + standee QR, Page Studio leave-guard + 409 choice, program times in event tz, role-aware UI | `web/src/pages/organizer/*` (except check-in/operators), `components/organizer/*` (same), `OrganizerPageStudio.tsx`, `OrganizerProgram.tsx` | ready to merge |
| B6b | coordinator team | `ws/b6b-exhibitor` | Exhibitor portal: server search, trash + undo, offline lead queue, removed-staff screen | `web/src/pages/ExhibitorPortal.tsx`, `web/src/components/booth/*`, `web/src/lib/lead*.ts` | taken |
| B5d | coordinator team | `ws/b5d-attendee-pages` | My Congress state machine, program filters/agenda, network rework, profile edit/consent/export/delete, booth `?b=` | `MyCongress.tsx`, `CongressDetails*`, `MyNetwork.tsx`, `MyProfile.tsx`, `BoothDirectory.tsx`, `PublicBooth.tsx`, `components/attendee/*` (except pass card) | merged |
| D2 | coordinator team | `ws/d2-live-e2e` | Live-backend Playwright journeys for every persona + CI job | `web/e2e-live/*`, `web/playwright.live.config.ts`, `scripts/integration/live-e2e.mjs`, one CI job | merged |
| FIX-1 | coordinator team | `ws/fix1-auth-sms` | Organizer-key throttle lockout (expired tokens), SMS cap abuse (reserve/cancel loops, organizer notices, OTP headroom), re-register race, `ip_group` limiters, admin token compare | `backend/app/auth.py`, `security.py`, `routes/tickets.py`, `app/ticket_lifecycle.py`, `sms/gateway.py`, limiter lines in `passes.py`/`booths.py` | merged |
| FIX-2 | coordinator team | `ws/fix2-privacy` | Attendee logout + session_version (migration 0030), account deletion/export completeness, retention (OTP rows, short links, idempotency keys), outbox skips deleted/cancelled | `routes/auth.py` (session parts), `app/account.py`, `app/retention.py`, `sms/outbox.py`, `lib/attendeeSession.ts` | ready to merge |
| FIX-3 | coordinator team | `ws/fix3-exhibitor-network` | Network scan race, input size limits, booth-staff tenant revocation/archive, archived network/bookmarks, `public_media` archived, paginated legacy lists, streamed leads CSV | `routes/leads.py`, `routes/network.py`, `routes/booths.py` (staff/bookmark parts), `public_media` in `routes/pages.py` | merged |
| FIX-4 | coordinator team | `ws/fix4-archive-robustness` | Archived read-only on booths/participants/SMS/Page Studio, template save race, last-owner lock, coded errors, SMS log cursor, streamed participants CSV, short-link expiry on date change, PDF hardening | `routes/participants.py`, `routes/sms.py`, `routes/events.py`, `app/links.py`, `app/media.py`, `sms/templates.py`, `routes/organizer_console.py`, dependency lines in `booths.py`/`pages.py` | ready to merge |
| PWA-1 | team2 (second agent team) | `ws/team2-pwa1-pwa-settings` | Manifest `orientation: any` + stable `id: "/"`; `start_url` is `/?source=pwa`, rewritten before the app renders to the device's own paired scanner point (plain `/` otherwise; offline too); captive-portal-aware `probeServer` + `serverReachability` monitor + `useServerReachability` hook (real `/api/health` round trip) for C1 to adopt — nothing consumes it yet. Web only: no migration, no env var, no backend. Done 2026-10-23, verified on `03003a3` + branch: backend 648, web unit 275, Playwright 318 | `web/pwa-manifest.ts` (new; manifest moved out of `vite.config.ts`), `web/vite.config.ts` (manifest block → import), `web/src/lib/pwaRegistration.ts` (+1 `await`), new `web/src/lib/launchTarget.ts`, `serverReachability.ts`, `web/src/hooks/useServerReachability.ts`, new `web/tests/{launchTarget,serverReachability,pwaManifest}.test.ts`, `web/e2e/pwa-launch.spec.ts`. Merge notes: C1's `vite.config.ts` hunk (`__APP_BUILD__`) auto-merges; B6a's data-router `main.tsx` verified compatible (keep `./lib/pwaRegistration` imported before the router is created) | ready to merge |
| POLISH-2 | team2 (second agent team) | `ws/team2-polish2` | Shared-lib polish + one small API field: (1) `formatLocalizedNumber` in `web/src/lib/i18n.ts` uses a Latin thousands comma in fa («۵,۰۰۰») → Persian separator «٬»; (2) `localizedApiError` in `web/src/api/client.ts` falls back to the English `detail` for errors without a code → localized generic sentence by HTTP status (keep English detail only in en or as a tooltip/diagnostic); (3) backend: add `event_timezone` to the attendee ticket response (`GET /api/attendees/me/tickets`, `routes/tickets.py`) and to the link-pass resolve response (`routes/passes.py`), regenerate `schema.d.ts`; (4) web: `DigitalPassCard` shows dates in that zone. Claimed 2026-10-23 | `web/src/lib/i18n.ts` (number formatter only), `web/src/api/client.ts` (fallback only), `routes/tickets.py` + `routes/passes.py` (response model only), `components/attendee/DigitalPassCard.tsx`, tests. Don't touch `Me.tsx` (pending merge); its date ranges can adopt the field later. Does NOT touch `web/src/lib/errorMessages.ts` (four pending branches edit it) | taken |
| AUD-WEB | coordinator team | (read-only) | Frontend/UX gap audit, all personas | none | merged (report done) |
| WEB-FIX-1 | coordinator team | `ws/webfix1-public-attendee` | Registration-window states on the public page, booth/desk entry cards on `/me` + switcher, public congress list on `/` and signed-out `/me`, event-timezone times on public/attendee pages, touch targets | `PublicEvent.tsx`, `components/public/*`, `Home.tsx`, `Me.tsx`, `AttendeeLayout.tsx` (switcher), attendee time display | taken |
| WEB-FIX-2 | coordinator team | `ws/webfix2-console` | Platform console members drawer, readable Activity/Members labels, analytics StrictMode bug + tz label, platform error localization + touch targets, `formatApiError` guard test | `Platform*.tsx`, `OrganizerMembers*`, Activity page, `lib/organizerConsole.ts`, `OrganizerAnalytics.tsx` | taken |
| AUD-OPS | coordinator team | (read-only) | Ops/CI/docs gap audit | none | merged (report done) |
| OPS-FIX-A | coordinator team | `ws/opsfix-a-deploy` | Referer log leak, compose passes every setting + secret-box key in init, SMS-failure alerts + external heartbeat, metrics, Caddy request id, backup consistency for program files, dev/stack data-dir collision | `deploy/**`, `scripts/staging/**` (except verify.mjs CLI), `backend/app/config.py` validators, `backend/app/observability.py` | ready to merge |
| OPS-FIX-B | coordinator team | `ws/opsfix-b-ci-load` | Load harness vs current API + new scenarios, CI gaps (ws/** CI, uv --locked, db image, compose smoke, k6 inspect, timeouts), `check.sh --full`, verify.mjs project/paths, .gitignore, head tests derive head | `scripts/load/**`, `.github/**`, `scripts/check.*`, `scripts/staging/verify.mjs` (CLI/paths), `.gitignore`, `AGENTS.md`, 2 head tests | taken |
| DOCS-FIX | coordinator team | `ws/docsfix-runbook-adrs` | Event-day runbook rewrite, stale rate-limit docs, upgrade rehearsal + migration compatibility table, ADR status notes + 6 new ADRs, docs truth, root README | `docs/**` (except `docs/handover/*`), `README.md`, `web/README.md`, `mobile/README.md`, `GLOSSARY.md`, `SPEC*.md`, `REPORT.md` | merged |

## Free — can be claimed now

| ID | Scope | Files / area | Notes |
|---|---|---|---|
| OPS-1 | Real-infrastructure drills: ACME on the real domain, a real S3 provider for encrypted backups + PITR restore drill, systemd timers on a Linux host, Sentry endpoint, Telegram delivery/relay from Iran | `deploy/**`, `scripts/staging/**` (only fixes found), docs | Needs server access — a human or ops team with credentials |
| LOAD-1 | Re-run `scripts/load/` on staging after the next deploy; update targets/notes for the current API (published page, OTP budgets, hashed manifest) | `scripts/load/**` | Needs a staging stack |
| SMS-2 | Backup SMS provider adapter with failover only on definite non-delivery | `backend/app/sms/provider.py`, `gateway.py` | **blocked** until the product owner chooses a provider |

## Later (start after the overlapping branches merge)

| ID | Scope | Waits for |
|---|---|---|
| GLOSS-2 | Glossary sweep of all remaining strings to the DECIDED terms: ticket type «نوع کارت ورود» (plural «انواع کارت ورود»), attendee ticket «کارت ورود», session «جلسه», check-in point «نقطه ورود», «کد QR», never «بلیط»; extend `web/tests/glossary.test.ts` to ban «رده»/«نشست»/«گیت بازرسی» in fa copy | B6a, B6b, C1, C2, WEB-FIX-1, WEB-FIX-2 merged (they already use the new terms in files they touch) |
| A11Y-1 | Accessibility pass: field `aria-describedby`, tabs/switch roles, route focus management, `StatusPanel` title as a heading (404/expired-link/error pages have no h1), `<html lang/dir>` updated per locale, page titles on error/scanner pages, contrast on dark gradients; VoiceOver/TalkBack check | B5d, B6a, B6b, C2 merged |
| DATE-1 | Jalali date picker for organizer date/time inputs (event tz aware) | B6a merged |
| ARCH-2 | Archived read-only on desk and check-in routes (if C1/C2 leave gaps) | C1, C2 merged |
| POLISH-1 | GateScanner title; remaining `font-mono` on Persian (OrganizerAnalytics, MobileOtpForm, AttendeeSignIn, PageSections) | C1, B5d merged |
| HW-1 | Hardware/browser matrix by a person: iOS Safari, Android Chrome, barcode guns, thermal printer; dress rehearsal | release candidate |
| TOKEN-1 | Remove the untyped attendee-token allowance (`LEGACY_UNTYPED_USER_TOKENS_UNTIL`) | after 2026-12-08 |

Gap items from the AUD-WEB and AUD-OPS audits will be added here as new free rows when they report.
