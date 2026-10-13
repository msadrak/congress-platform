# Congress end-to-end integration — milestone 06

Branch `integration/task-05h`, base `d162330504058a27373557bf9f79269baac635ac`.

**Complete journey: PASS** — 45/45 checks on the final tree (two consecutive full runs passed; one earlier run had a single transient `fetch failed` in the harness at step A8, not reproduced). `scanner-real-api.spec.ts`, which had never been executed, was run against the same real stack and **passed** (1/1).

## Reproduce it

```
node scripts/integration/congress-e2e.mjs [--skip-build] [--keep] [--skip-scanner-spec]
```

Creates `congress-e2e-net` (Docker `--internal`), a private PostgreSQL container with **no published port**, a dedicated `congress_e2e` database, and the API (published on `127.0.0.1:8000` only), runs Alembic to head, builds and serves the production build (service worker on) at `127.0.0.1:4175`, runs the journey in Edge (Playwright), then `scanner-real-api.spec.ts`, then removes everything. It refuses to run unless the API's effective database URL points at `@congress-e2e-pg:5432/congress_e2e` and PostgreSQL publishes no port. Needs Docker, the local images `congress-t0-backend:2c0085137f` (backend deps in `/app/.venv`; override with `CONGRESS_E2E_BACKEND_IMAGE`) and `postgres:16`, Node 22+, `npm ci` in `web/`. All identities are generated (`*.example.com`, random passwords/keys per run); nothing touches shared services. Files: `scripts/integration/congress-e2e.mjs` (environment), `journey.mjs` (stages), screenshots + `last-run.json` in `congress-e2e/`.

## Stage results (real browser → production build → FastAPI → PostgreSQL)

| Stage | Result | What was verified (against PostgreSQL, not just the UI) |
|---|:---:|---|
| A Organizer preparation | PASS 8/8 | Credential gate (wrong key removed, no fallback); two congresses created in the UI; tiers with capacity (quota 3 / 5); SINGLE_USE gate; two booths + staff authorization; reception operator provisioned (one-time password shown); scanner device issued; cross-tenant: organizer 2 gets 404 on Alpha event/analytics/scanner-token, scanner token or admin header as organizer → 401 |
| B Attendee | PASS 6/6 | Public page → real registration/reservation dialog (201); `tickets`/`entity_qrs` rows; `reserved_count` 1/3 and shown to the organizer; ticket page shows only this congress; outsider sees nothing; second reservation → 409 with counts unchanged; switching accounts in one browser never shows the previous account's ticket |
| C Reception | PASS 9/9 | `/reception` code → operator sign-in; search + review (QR); walk-in issued (ticket, QR, `issued_by_operator_id`, `reserved_count` 2); duplicate email → 409 with the exact pass offered; **walk-in whose response is lost**: UI claims no success, the ticket exists once, retry recovers the pass; capacity enforced (3/3 → 410, counts unchanged); Alpha operator gets 403 on every Beta route and cannot sign in to Beta; User/scanner tokens refused as desk; **organizer revokes the operator in the UI → open session cut (401), login 403, old token still dead after reactivation, fresh login works** |
| D Gate scanner | PASS 9/9 | Pairing with the device token and gate manifest (Beta ticket absent); valid scan admitted and synced (`checkins` ADMITTED, manifest `admission_count`); duplicate rejected by SINGLE_USE (one admission); wrong-congress ticket rejected (`EVENT_MISMATCH`, no admission anywhere); **offline** scan queued (no DB row), synced after reconnecting (row appears); stored scan-id replay idempotent, conflicting replay `SCAN_ID_CONFLICT`; other-gate/garbage/User/foreign-organizer tokens refused; expired scanner token 401; organizer revokes the device → old token 401, records kept, UI blocks |
| E Exhibitor | PASS 7/7 | Direct sign-in to the booth; lead for the right booth/ticket/`captured_by`; qualification saved and preserved on re-scan; wrong-congress badge 400, no lead; search; CSV equals the DB row; **lead scan with lost response**: no success shown, one lead, retry only updates it; other booth's staff 403 on read/scan/update/export, switched account sees nothing |
| F Organizer reporting | PASS 6/6 | Tier shows 3/3 = DB; analytics `total_tickets/scans/admitted/unique` equal SQL aggregates; event CSV rows = check-in rows (whole event, includes the rejected foreign scan, **no foreign attendee**); switching to Beta shows only Beta numbers; other tenant gets 404 on the export; no request mixed credential families |

Data relationships checked: organizer → event → tier/booth/gate/operator/device; user → ticket → QR → check-in (per gate) → analytics/CSV; ticket → lead (per booth, captured by staff user); operator ↔ event; tenant isolation on every export.

Exceptions (no UI exists, done through the supported HTTP contract): organizer/tenant provisioning (admin token); registration of booth reps, the outsider and the Beta attendee; scanner device token issue/revoke; codes typed into the supported manual-entry fields (no camera/HID hardware).

## Defects found and fixed

| # | Defect (found by the journey) | Severity | Fix | Regression test |
|---|---|:---:|---|---|
| 1 | **Cross-congress attendee exposure.** Scanning a ticket of another congress at a gate stored the foreign `ticket_id` on the rejection and returned the foreign holder's **name and tier** to the gate; the gate's event CSV/analytics then joined it and exported the **foreign attendee's name and email** (cross-tenant when the congresses belong to different organizers). | P0 | Wrong-event rejection is recorded against the gate only (`ticket_id` NULL, no identity in the response or replay). | `backend/tests/test_scan_event_mismatch.py` (fails on the old code, verified) |
| 2 | **Scanner silently dropped the next badge.** A different badge scanned within 1.8 s of the previous one was ignored with no feedback (typed or HID), so a person could be waved through unrecorded while the previous result was still on screen. | P1 | Only the same badge re-presented inside its own result window is ignored; a different badge is always evaluated and the result timer restarts. | `web/e2e/scanner-rapid-scans.spec.ts` (fails on old code, verified) |
| 3 | **Agreed rejections were reported as sync conflicts and could un-admit a ticket.** A scan the gate rejected locally (duplicate, wrong congress) that the server also rejected became `CONFLICT`; after a reload `reconstructLocalState` then forgot the ticket's genuine admission (offline duplicate-admission window) and the gate showed a permanent "Conflicts" warning. | P1 | Only a provisional *admission* the server rejects is a conflict; an agreed rejection stays a rejection (`applyServerVerdict`). | `web/tests/scannerReliability.test.ts` (4 new) + rapid-scans spec |

Observed, not changed (product decisions): the same badge re-presented within 1.8 s of its own result is ignored on purpose (camera re-reads), so a second person using the same QR inside that window sees the first result; the 1.8 s window is not configurable.

## Tests and exit codes

| Category | Command | Exit | Result |
|---|---|:---:|---|
| 1 Unit | `npm test` (web) | 0 | 55 passed (was 51) |
| 1 Unit/API | `pytest -q` (disposable PostgreSQL) | 0 | 185 passed (was 184) |
| 1 | `mypy` | 0 | no issues, 50 files |
| — | `npm run typecheck`, `npm run build`, `tsc -p tsconfig.e2e.json` | 0, 0, 0 | clean; 74 modules |
| — | `npm run lint` | 0 | 14 warnings, 0 errors (baseline) |
| 2 Browser, **intercepted API** | full Playwright suite on the final build | 0 | **165 passed, 1 skipped** (`scanner-real-api`, which needs the real stack — see 3), 0 failed; includes scanner-offline (all), reception, exhibitor, organizer, public/attendee regressions and 3 new rapid-scan tests |
| 3 Browser, **real FastAPI/PostgreSQL** | `node scripts/integration/congress-e2e.mjs` | 0 | **45/45** journey checks |
| 3 | `scanner-real-api.spec.ts` via the same script | 0 | **1/1 passed** (it is skipped in category 2 by design) |

## Remaining integration blockers and hardware

- **Not performed (hardware):** physical camera QR decoding (attendee passes on phone screens/paper, light, angle), real USB/Bluetooth HID scan guns, receipt/badge printers, real phones/tablets and browsers other than Edge, venue network (captive portal, flaky Wi-Fi) for the scanner PWA. Camera paths were exercised only with Chromium's fake device in earlier milestones, never as a decoded physical badge.
- Not covered: load/concurrency beyond the existing backend concurrency tests, multi-device scanner races at one gate, long offline windows (hours), upgrade of a PWA mid-event.
- Journey used the manual-entry fields for Scanner, Exhibitor and the typed QR secrets; the QR value itself is read from PostgreSQL.

## Product decisions still required

1. Scanner device provisioning needs a UI or a printed pairing flow for organizers/supervisors (today: API only).
2. Whether Reception may admit attendees (today: scanner-only by contract).
3. Whether wrongly captured leads may be deleted/merged by booth staff.
4. Credential lifecycle for operators and attendees (reusable global passwords, no reset).

## Release assessment

**A. Functional MVP readiness: YES for the supported lifecycle** — one congress can be created, opened for registration, attended with walk-ins, admitted at a gate (online and offline), worked by exhibitors and reported on, with tenant/booth/event isolation verified in the database. This holds with the exceptions above and after the three fixes in this milestone.

**B. Operational/production readiness: NO — not verified.** Deployment (TLS, secrets management, CORS/origin config, container/runtime hardening), backup/restore, monitoring/alerting/log retention, rate limiting and brute-force protection, accessibility testing with assistive technology, physical-device and venue-network testing were not examined. A passing journey on demo data is not a production-readiness claim.

| Priority | Item (evidence) |
|---|---|
| P0 | None open. (The cross-congress attendee exposure was found and fixed here.) |
| P1 | Physical scanner/camera/HID verification at a real gate; scanner provisioning without API access; production deployment + backup + monitoring runbook and checks; operator/attendee credential lifecycle (reset, rotation); a live-event dry run with several devices |
| P2 | Pagination for events/booths/leads/attendees; lead deletion policy; configurable scan-result window; accessibility audit; audit trail of reception/exhibitor actions |
| P3 | Quality-of-life: bulk operator/booth import, CSV filters, richer analytics |

## Commits

- `115c9164ed94ae5b9269d1882552e168e27c1703` — fix(api): do not link or disclose the holder of another congress's ticket on a gate scan
- `e4e84be7805aaf9c0e4a783e58d3f3c42b38def6` — fix(web): scanner no longer drops a different badge scanned quickly or reports agreed rejections as conflicts
- the commit that adds the integration script, this report and screenshots (top of `git log`)
