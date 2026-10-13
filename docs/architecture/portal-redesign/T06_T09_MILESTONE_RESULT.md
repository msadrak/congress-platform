# P03-T06 to T09 — Credential-authority migration milestone

**Result:** T06, T07, T08 and T09 are implemented, tested and committed locally. No production request now selects a credential from pathname or storage precedence. **Integration/release: PARTIAL** — real-API browser E2E and the canonical full-stack gate were not run; production readiness is not established.

## Outcome table

| Task | Outcome | Files | Tests (all run in this milestone) | Commit SHA |
|---|---|---|---|---|
| T06 attendee / Booth requests to User authority | PASS. 14 HTTP operations + vCard and CSV downloads use `user` authority; stale-session and owner-isolation guards. Offline-ticket 401 rule reviewed; one small guard added (below). | `PublicEvent`, `MyTickets`, `MyNetwork`, `ExhibitorPortal`, new `lib/attendeeSession.ts`, `e2e/attendee-authority.spec.ts`, T06 report | attendee suite 25/25 | `c9165c4f31ba120d4b15c816ae4bd6c375ef255a` |
| T07 reception desk | PASS. Explicit operator / organizer mode, resource-bound desk authority per event, exact-credential 401 handling, retry on 5xx/network. | `OrganizerDesk.tsx`, `e2e/desk-authority.spec.ts` | desk suite 12/12 (60/60 over 5 repeats) | `ad16283d10b6c279db872234febfc0d494df154a` |
| T08 scanner | PASS. Manifest, batch and self-revoke use the scanner device authority bound to the point; no credential means no dispatch; payloads, queue and token formats unchanged. | `GateScanner.tsx`, `api/client.ts`, `tests/apiClient.test.ts`, `e2e/scanner-authority.spec.ts` | scanner-authority 4/4; existing scanner-offline 24/24 on the built preview; unit 44/44 at that point | `838a1163a92cb128ce5ba9b6e3d669ee1114bb05` |
| T09 remove heuristic client | PASS. `getApiClient`, `AuthScope` and the pathname/storage inference are deleted; module-surface unit test added; desk test race stabilized. | `api/client.ts`, `tests/apiClient.test.ts`, `e2e/desk-authority.spec.ts`, this report | unit 45/45; every suite below | this commit (reported in the final response) |

## Final source inventory (counted from the actual code after T09)

| Item | Count |
|---|---:|
| `getApiClient` invocations, imports or declarations (src, tests, e2e) | **0** |
| `AuthScope` references | **0** |
| Production `fetch(` calls | **0** (all HTTP goes through `createApiClient`, `createDeskApiClient` or `createScannerApiClient`) |
| Hand-built `Authorization` headers outside the factory | **0** |
| Pathname-based credential logic | **0** (remaining `location.pathname` uses only mark navigation tabs or strip a scanner URL parameter) |
| Remaining legacy HTTP operations | **0** |
| Remaining direct credential-bearing fetches | **0** |

Explicit client call sites by page: OrganizerEvents 3, OrganizerEventDetail 10, OrganizerAnalytics 2, OrganizerDesk 5 (4 desk or organizer-mode calls plus the anonymous login), PublicEvent 4, PublicBooth 3, MyTickets 2, MyNetwork 5, ExhibitorPortal 5, GateScanner 1 shared adapter (3 requests). Credential persistence stays with the session owners (`congress_organizer_api_key`, `congress_attendee_token`, `congress_desk_token_${eventId}`, the scanner point store); only implicit *selection* was removed.

## What changed in T07, T08 and T09 (compact)

- **T07 Desk.** Mode (`operator` | `organizer`) is explicit state, never storage precedence. It starts as operator mode, or organizer mode when only an organizer key exists (the existing behavior for organizers), and changes only through a visible switch. Operator mode sends the event desk JWT alone through `createDeskApiClient(authority, eventId)`; organizer mode sends the owning key alone. A missing credential of the selected mode shows its entry gate (operator login, or "organizer mode needs your key") and sends nothing. 401 removes only the exact sent credential (a newer session or the other mode's credential is untouched); 403/404/5xx/network keep every credential, show the failure and offer Retry; previously any error cleared the desk token. The page is keyed per event, so an event A token or response can never act in event B.
- **T08 Scanner.** The only client change is optional event context on the scanner authority (a device token is opaque to the browser; the endpoints carry only the point). `GateScanner` builds the client from the stored device token and the route point; with no device token nothing is sent, so queued scans stay on the device and no human session can be attached (previously `getApiClient(null)` could fall back to a User or organizer token). Self-revoke now goes through the same adapter and keeps the revoke-before-token-delete behavior, including the HTTP-status notice on failure.
- **T09.** Deleted `getApiClient`, `AuthScope`, the pathname/storage fallback and the "staged coexistence" comment. The typed factories and response handling are unchanged. No shim, alias or re-export remains.

## Preserved security invariants

- **Desk:** desk credentials are never organizer credentials; no fallback in either direction; the event is part of the authority and checked before dispatch; revoked/expired/wrong-scope tokens fail safely (401 clears only that event session, 403 keeps it); a late 401 cannot clear a newer session; the T02 session-version check stays server-side and untouched (no backend change).
- **Scanner:** point scope enforced before dispatch; device credential only; revocation and the unpair/pending-deactivation flow unchanged; queue, IndexedDB and token formats unchanged; offline window, provisional/conflict UX and `/scan/:pointId` route unchanged; self-revoke still uses the scanner Bearer, which is what `revoke_current_scanner_device` requires.
- **User, organizer, public:** as documented in the T04, T05 and T06 reports; public auth requests remain anonymous.
- T01 token-family validation and T02 session versioning: no backend or migration change in this milestone.

## T06 finalization notes

- Reviewed the 401-with-valid-owner-cache behavior. It satisfies the documented contract: the page shows an explicit "session is no longer valid" alert, the cached pass keeps the offline label, other pages clear the rejected token on their own 401, and the cache is owner-scoped with a reset on any token change. **One gap was found and fixed in T06 scope:** `MyTickets.handleRemoveBookmark` could still dispatch with the retained rejected token; it now returns early while the session is flagged rejected. The attendee suite was rerun (25/25) before the T06 commit.
- The T06 report was committed as written (it predates this one-line guard).

## Browser and unit results (final tree, independently run)

| Command (cwd `web/`) | Exit | Result |
|---|:---:|---|
| `npm test` | 0 | 45 passed, 0 failed, 0 skipped |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | 14 baseline warnings, 0 errors, no new warning |
| `npm run build` | 0 | 61 modules, existing >500 kB chunk warning |
| `npx --no-install tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| Playwright `public-anonymous` (dev server, `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5198`) | 0 | 16 passed |
| Playwright `organizer-authority` | 0 | 13 passed |
| Playwright `attendee-authority` | 0 | 25 passed |
| Playwright `desk-authority` | 0 | 12 passed |
| Playwright `scanner-authority` | 0 | 4 passed |
| Playwright `scanner-offline` (built app via `vite preview`, port 5199) | 0 | 24 passed |

All suites report no retry label. Total browser tests: 94. **All browser tests use intercepted `/api/` responses (`page.route`)**; they are not FastAPI/PostgreSQL integration. The offline scanner suite needs the service worker and therefore the built preview; against the dev server its offline reload tests fail by environment (`ERR_INTERNET_DISCONNECTED`), which is not an application issue. The T0 detached worktree server on port 4174 was never used.

Sensitivity checks (application code temporarily mutated and restored byte-identical): desk tests catch unconditional token clearing, a missing per-event remount, treating any error as 401, and an operator-to-organizer fallback; the scanner no-credential test catches a restored legacy heuristic; attendee tests catch removal of the click-time, stale-response, owner-reset, remount and vCard/export guards.

One desk test was flaky (it raced the 200 ms debounced attendee search). It was fixed by polling for the request and then passed 60/60 over 5 repeats; the fix is part of the T09 commit.

## Real-API integration status

`REAL-API E2E: NOT RUN — INTEGRATION GATE OPEN.` `scanner-real-api.spec.ts`, the canonical `scripts/check.*`, backend pytest/mypy and Alembic were not run: no backend, schema or migration changed, and no proven disposable FastAPI/PostgreSQL environment was set up in this milestone. Shared PostgreSQL was not touched.

## Known issues and release blockers

- Real-API E2E and the canonical full-stack gate remain open (above).
- The factory's scanner authority now allows an omitted event; the event is descriptive only (scanner URLs carry no event), so no enforcement was lost, but the T03 report's "event is required for scanner" statement is superseded.
- Desk default mode for an organizer who also holds a desk token for the event is operator mode; the switch is visible, but this default is a product choice worth confirming.
- Ticket-list 401 with a valid cache keeps the rejected token by design (documented in the T06 report).
- Cross-tab session changes are noticed lazily (no storage listener), as in T04 and T06.
- Not covered by any suite: real devices (camera, HID), responsive/RTL/accessibility matrices, populated-database migration rehearsal.

## Git state at milestone end

Branch `integration/task-05h`, local only (no push, no deployment, no reset/rebase/stash). Starting HEAD `92bbfa89d5206a0081aa94a45b91a962e936b191`. Commits in order: T06 `c9165c4`, T07 `ad16283`, T08 `838a116`, then T09 (this report is included in it). Working tree clean after the T09 commit.
