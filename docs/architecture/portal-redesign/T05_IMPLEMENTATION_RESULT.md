# P03-T05 — Bind organizer requests exclusively to tenant authority

## Verdicts

- **Implementation correctness: PASS (local, frontend-only).** All 22 in-scope Organizer HTTP call sites use the explicit Organizer authority from P03-T03; absent key means no dispatch; 401 clears only the key that was sent; event-context and key races are covered by committed browser tests.
- **Full integration / release readiness: PARTIAL.** Browser tests use intercepted `/api/` responses. Canonical `scripts/check.*`, backend pytest/mypy, Alembic and real-API browser E2E were **not run**. Production readiness is **not established**.

Only P03-T05 was authorized. No P03-T06 or later work, commit, staging, push, deployment, database or backend change was performed.

## Starting state

- Branch `integration/task-05h`, HEAD `54cf262775e2a2784d3ee50b092a35444e1e765a` (T03 `20c41e6` and T04 `6527011` checkpoints present), clean tracked tree, empty index, no untracked files. The detached T0 worktree and its `vite preview` on port 4174 were not touched.

## Authoritative contract (backlog lines 266-313)

- **Title:** Bind organizer requests exclusively to tenant authority. **Prerequisite:** P03-T03 (present).
- **In scope:** organizer event/config/analytics requests and deliberate organizer scanner administration requests.
- **Out of scope:** Organizer/User identity convergence, reception automatic organizer mode, new scanner-device UI, shell extraction.
- **Frontend contract:** existing organizer URLs keep the key gate; key comes from `congress_organizer_api_key` via session ownership; explicit organizer authority; absent key blocks dispatch; 401 clears only the sent key; 403/404/network/5xx preserve it; mutations refetch affected organizer data only.
- **Acceptance:** key gate with no protected requests when only User/desk tokens exist; only the key transmitted when everything is stored (config and export); foreign event 404 shows no foreign data and leaves User/desk sessions unchanged.
- **Stop condition:** User-derived organizer access, fallback, or foreign tenant exposure.
- No Phase 04 correction blocks T05 or changes its scope. The register's rules on explicit authority (AR-05) and no credential fallback apply and are followed.

## Backend header contract (evidence, not assumption)

- `backend/app/auth.py`: `current_organizer` reads `HTTPBearer` credentials and compares `sha256(key)` to `Organizer.api_key_hash`; missing key and invalid key both return 401 with `WWW-Authenticate: Bearer`.
- `X-Admin-Token` is used **only** by `require_platform_admin` (organizer provisioning in `routes/organizers.py`). The frontend does not call that route (`grep X-Admin-Token web/src` finds nothing) and it is out of T05 scope.
- The P03-T03 factory sends `Authorization: Bearer <token>` for the `organizer` kind, which is exactly the server contract. No new scheme was invented. `OwnedEventDep` still masks foreign events as 404 on the server.

## Legacy inventory reconciliation

Counts come from the committed source at the starting HEAD.

| Term | Count in T05 scope |
|---|---:|
| `getApiClient` imports (OrganizerEvents, OrganizerEventDetail, OrganizerAnalytics) | 3 files |
| Client factory invocations (`getApiClient(`) | **14** (3 + 10 + 1) |
| Distinct `getApiClient` HTTP call sites | **21** (3 + 14 + 4) |
| Direct `fetch` call sites using the organizer key | **1** (analytics CSV export) |
| **Total in-scope HTTP call sites** | **22** |

- Several operations share one client: OrganizerEventDetail's loader issues 5 GETs through one client, OrganizerAnalytics' loader 4 GETs. Runtime request counts are higher still: the loaders re-run on dependency changes, analytics polls every 10 s, and development StrictMode repeats effects.
- **Why earlier numbers differed.** The committed T04 report is internally consistent: its table gives 3 + 14 + 4 = **21** operations for the Organizer pages. The figure **17** appeared only in my chat summary of T04, which added 3 + 14 and omitted the 4 analytics GETs. It was an arithmetic slip, not a different inventory, and the T04 report file never contained 17. The CSV `fetch` was never part of the 42 because the T04 inventory counted only `getApiClient` clients; it is the 22nd call site here.
- **No in-scope "scanner administration" caller exists.** The backend has organizer-only scanner routes (`POST /api/checkin-points/{point_id}/token`, `GET .../devices`, `POST .../devices/{device_id}/revoke`) but no frontend code calls them. GateScanner's manifest, batch and self-revoke requests use the scanner device credential and belong to T08. T05 therefore migrated nothing for scanner administration and added no scanner-device UI (explicitly out of scope).

### In-scope operations (all migrated)

| File and function | Method and endpoint | Authority | Credential source |
|---|---|---|---|
| OrganizerEvents `fetchEvents` | GET `/api/events` | Organizer | layout `apiKey` (sessionStorage `congress_organizer_api_key`) |
| OrganizerEvents `handleCreateEvent` | POST `/api/events` | Organizer | same |
| OrganizerEvents `handleUpdateEvent` | PATCH `/api/events/{event_id}` | Organizer, event from the edited record | same |
| OrganizerEventDetail `loadData` | GET event, ticket-tiers, checkin-points, booths, desk/operators (5) | Organizer, `eventId` from route | same |
| OrganizerEventDetail handlers (9) | POST ticket-tiers, checkin-points, booths, booths/{id}/staff, desk/operators, desk/operators/{id}/revoke; PATCH event, ticket-tiers/{id}, checkin-points/{id} | Organizer, `eventId` from route | same |
| OrganizerAnalytics `loadData` | GET event, checkin-points, ticket-tiers, analytics/attendance (4) | Organizer | same |
| OrganizerAnalytics `handleDownloadCsv` | GET `/api/events/{event_id}/analytics/export-csv` | Organizer (was raw `fetch`, now the factory with `parseAs: "blob"`) | same |

Required backend behavior is unchanged: invalid key 401, foreign or nested-foreign resource 404, validation 422, existing conflict responses. A User JWT never represents organizer membership.

## Changes

- `web/src/pages/OrganizerLayout.tsx`: new outlet context member `onKeyRejected(sentKey)`. It is a stable `useCallback` and removes the key only if `sessionStorage` still holds exactly `sentKey`, then clears layout state only if it still equals `sentKey`, and shows the gate with a "key was rejected" alert (bilingual, rendered at display time). The key gate, `handleSaveKey` and `handleLogout` behavior are unchanged.
- `web/src/pages/OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `OrganizerAnalytics.tsx`: `getApiClient(apiKey)` replaced by `createApiClient({ kind: "organizer", token: apiKey })`; every request path starts with `if (!apiKey) return` (no dispatch); each response with status 401 calls `onKeyRejected(apiKey)` **with the key that was sent**, even if the page has since unmounted; 403, 404, 5xx and network failures change no credential state. The CSV export now uses the same authority path.
- Event-context isolation: `OrganizerEventDetail` and `OrganizerAnalytics` are wrapped so the content component is keyed by `eventId`. Changing the event remounts it, so a late response for event A writes only into the unmounted instance. The loaders keep their `isMounted` guards.
- Not changed: `web/src/api/client.ts`, `getApiClient` and `AuthScope`, OrganizerDesk, backend, schema, lockfiles, i18n dictionaries, routes, QR/printed URLs.
- Interpretation recorded: "successful mutations refetch affected organizer data only" is satisfied by keeping the existing behavior of updating local state from the entity returned by the mutation. No unrelated refetch was added, and no extra refetch was introduced.

## Credential and context race handling

| Scenario | Handling | Test |
|---|---|---|
| Key A replaced by key B (sign out, enter B) before the next action | A key change always passes through the gate, which unmounts the pages; actions use the new render's key. | late-401 test also creates an event under B and asserts only B was sent |
| Late 401 for key A after B is stored | `onKeyRejected` compares with the stored key and does nothing | late-401 test |
| 401 for the sent key | key removed, gate shown, other credential families untouched | 401 on load, on event mutation, on tier mutation |
| Event A response after navigating to event B | keyed remount plus `isMounted` | detail and analytics tests with a transient-render observer |
| Foreign event 404, or 403/500 | no event data rendered, all sessions kept, no other credential used | three status tests |
| Absent key | gate only, no request | gate test over list, detail and analytics URLs |

Limits: a request already dispatched cannot be recalled by the frontend; only its response is ignored. `sessionStorage` is per tab, so another tab cannot swap this tab's organizer key.

## Credential-switch stale-success review (pre-checkpoint)

Question: credential A starts a GET, the active credential becomes B with route and event id unchanged, A's request succeeds with HTTP 200 and tries to update Organizer UI state. Can A's tenant data appear under B?

**Result: safe. No defect found.**

Code review:

- The organizer key changes in only three places, all in `OrganizerLayout.tsx`: `handleSaveKey` (reachable only from the key gate), `handleLogout` (key to `null`) and `handleKeyRejected` (key to `null`). A direct A to B replacement never happens. Every A to B change passes through `apiKey === null`.
- When `apiKey` is `null` on a non-desk route the layout renders the gate instead of the `Outlet` (`!apiKey && !isDesk`), so `OrganizerEvents`, `OrganizerEventDetail` and `OrganizerAnalytics` unmount. A late response from A can only reach the unmounted instance, and the loaders also have `isMounted` guards. B's pages are new instances with their own state, even when the URL and event id are the same (for example after browser Back).
- Pages always use the `apiKey` of their own render; there is no stored or cached client. After the switch the only live requests are B's. A's polling interval is cleared on unmount.
- A delayed 401 from A calls `onKeyRejected(A)`, which does nothing unless `sessionStorage` still holds A, so B survives.
- Event changes remain guarded by the keyed remount and `isMounted`. There is no fallback to another credential anywhere in the migrated pages.
- Residual theoretical case: if a future change replaced the key without unmounting the pages, mutation handlers (not the loaders) would not discard an old response. Today that path does not exist.

Evidence:

- Committed tests that really exercise these scenarios: late 401 for A cannot clear B and later actions use only B; delayed event A response after navigating to event B on detail and analytics; 401 clearing only the sent key.
- **Not covered by a committed test: a delayed HTTP 200 from A after switching to B.** That scenario was checked with a throwaway browser probe (not part of the repository, removed afterwards). It held A's `GET /api/events/event-a` (200, "Tenant A Event"), signed out, entered B, went Back to the same route and event id, and released A's response either after B's data loaded or while B's request was pending, on the detail page and on the analytics page (4 runs). A MutationObserver never recorded "Tenant A Event"; B's data was shown; the stored key stayed B; after the switch only B's requests were sent. A control run without a key switch did record "Tenant A Event", so the probe can detect the leak. Adding this scenario as a committed regression test is a recommended follow-up under a separate authorization.

## Tests

New file `web/e2e/organizer-authority.spec.ts` (13 tests, real shipping Organizer pages and `client.ts`, **backend responses intercepted by `page.route` for `/api/` and synthetic**; not FastAPI/PostgreSQL):

1. no organizer key: gate appears on list, detail and analytics URLs, **zero requests**, User, desk and scanner credentials intact
2. valid key with every other credential stored: list, detail (5 GETs), analytics, CSV download transmit **only** `Bearer <key>`
3. event creation sends only the key and shows the created event
4. 401 on load, 401 on mutation (2 tests): key cleared, gate with alert, no retry, no other credential, others intact
5. foreign or failing event 404, 403, 500 (3 tests): no event data, key kept, others intact
6. late 401 for key A cannot clear key B; later action uses only B
7. delayed event A response never replaces event B on detail and analytics (2 tests)
8. ticket tier creation on the detail page, 201 and 401 (2 tests)

**Sensitivity check** (app code temporarily mutated and restored byte-identical afterwards): unconditional key clearing fails the late-401 test; removing the keyed remount and `isMounted` guard fails the detail and the analytics event-switch tests; dropping the 401 report from the events loader fails the 401-on-load test.

Existing T04 suite (`public-anonymous.spec.ts`) rerun as a regression guard. No Node test was added: header selection is already covered by `apiClient.test.ts` (P03-T03) and every browser test asserts the exact `Bearer` value.

## Commands and results (all independently run, cwd `web/`)

| Command | Exit | Result |
|---|:---:|---|
| `npm test` | 0 | 43 passed, 0 failed, 0 skipped |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | 14 baseline warnings, 0 errors, **no new warning** |
| `npm run build` | 0 | 60 modules; existing >500 kB chunk warning |
| `npx --no-install tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | clean |
| `npx --no-install playwright test e2e/organizer-authority.spec.ts` (`PLAYWRIGHT_BASE_URL=http://127.0.0.1:5198`) | 0 | **13 passed, 0 failed, 0 skipped**, no retry label |
| `npx --no-install playwright test e2e/public-anonymous.spec.ts` (same base URL) | 0 | **16 passed, 0 failed, 0 skipped**, no retry label |

The Vite server on 5198 was started from this checkout and its served `OrganizerLayout.tsx` contained `onKeyRejected` before each run; port 4174 (T0 worktree) was not used. The server was stopped afterwards. Two intermediate failures were test-authoring mistakes (tier tests initially did not open the "Ticket Tiers" tab) and were fixed before the final runs; no application defect was involved.

## Not run

Canonical `scripts/check.*` (backend tests mutate a database), backend pytest/mypy, Alembic, native checks, `scanner-real-api.spec.ts` and any real-API browser E2E (no proven disposable backend and database was provided), manual Network inspection with a real backend, full responsive/RTL/accessibility checks. The T0 real-API limitation remains open.

## Remaining legacy callers (after T05)

`getApiClient` remains declared in `client.ts` and imported by **6 pages**.

| Page | Instantiations | Legacy HTTP ops | Later owner |
|---|---:|---:|---|
| PublicEvent (ticket reservation) | 1 | 1 | T06 |
| MyTickets | 2 | 3 | T06 |
| MyNetwork | 4 | 5 | T06 |
| ExhibitorPortal | 4 | 5 | T06 |
| OrganizerDesk | 4 | 5 | T07 |
| GateScanner | 2 | 2 | T08 |
| **Total** | **17** (was 31) | **21** (was 42) | |

Remaining direct `fetch` calls that attach a credential (not migrated, other tasks): ExhibitorPortal CSV, MyNetwork vCard, GateScanner self-revoke. The heuristic helper is removed only in T09.

## Risks and gaps

- Frontend-only change; server authorization remains the security boundary and was not re-verified against a live backend.
- Interception can mask wiring or contract drift against real FastAPI responses; the status handling was exercised only with synthetic bodies.
- OrganizerDesk still selects `apiKey || deskToken` heuristically (T07). It consumes the same outlet context, whose new member it ignores.
- Analytics polling continues until the page unmounts; after a 401 the layout removes the page, which stops it.

## Diff summary

Tracked: 4 files, 115 insertions, 47 deletions (`OrganizerLayout.tsx`, `OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `OrganizerAnalytics.tsx`). New: `web/e2e/organizer-authority.spec.ts`, this report. `git diff --check` exit 0; no trailing whitespace in the new files. Backend, database, API schema, lockfiles and `client.ts`: no change.

**STOP: P03-T05 concluded. Nothing is staged or committed.**
