# P03-T04 — Anonymous public and credential-entry cutover

## Verdict and authorization

**PARTIAL overall.** The scoped implementation, all four final frontend gates, 16 shipping-page browser regression tests (12 original plus race tests R1-R4, rerun after the race correction) passed; the manual Chromium Network journeys are a worker log from before the correction. The canonical full-stack gate and real FastAPI/PostgreSQL integration gate were **not run**: the available backend harness force-drops/recreates `congress_test`, and this assignment does not authorize destructive host-database testing or database provisioning. Synthetic HTTP/page tests are not real-backend authorization evidence. Under `03_AGENT_EXECUTION_PROTOCOL.md` §Pass/fail, those missing mandatory gates prevent an unconditional PASS.

**Update after the authorized race correction:** the confirmed stale-token bookmark defect is fixed in `PublicBooth.tsx` and covered by four committed browser regression tests (R1-R4, section "PublicBooth session-race review"). The 16-test browser suite, 43 Node tests, typecheck, lint, build and e2e typecheck were independently rerun after the fix and passed. The overall verdict **remains PARTIAL**: canonical full-stack, backend and real-API integration gates are still not run. Not production-ready.

Only **P03-T04** was authorized. No T05 or other new task, commit, staging, push, database/backend change, schema regeneration, package installation, lockfile change, shell redesign, RBAC/domain change or legacy-helper removal was performed.

## Initial state, prerequisites and correction precedence

- Integration owner verified the initial branch `integration/task-05h`, HEAD **`20c41e6313232d2a4e971b1e21edcfc18adbf69c`**, and clean tracked/untracked/index inventories before delegation. That is the supplied baseline, not a claim that the worker repeated those commands.
- Read the complete T04 backlog entry (217–265), complete Phase04 correction register, T03 implementation report, execution protocol, relevant roadmap authority/dependency section and complete current API authority/endpoint matrix, repository instructions, coding standards and glossary before editing. Planning artifact: `local://p03-t04-contract.txt`.
- T03 prerequisite exists in current `web/src/api/client.ts`: `createApiClient` requires explicit authority; `{ kind: "anonymous" }` removes Authorization, including caller overrides. Explicit `null` is also anonymous, but **legacy `getApiClient(null)` is not**. New callers use the explicit anonymous kind, not credential inference.
- AR-05/current API matrix overrides historical public optional-personalization behavior. Public metadata is anonymous; protected bookmark APIs provide saved state. No Phase04 finding requires a new T04 product decision. Findings concerning reception-shell routing, Organizer authority and legacy removal remain later tasks.
- Inspected actual `auth.py`, `public.py`, desk login and bookmark handlers/dependencies as security truth. Existing T01 User token-family checks and T02 desk session-generation rules are untouched. Public optional personalization remains compatible server-side; new clients ignore its saved bit.
- Search of shipping frontend source found User registration/login only in PublicEvent and desk login only in OrganizerDesk. All those entry callsites, public event initial/availability-refresh reads and public Booth reads are migrated.

## Endpoint, authority, session and status inventory

Statuses below are inspected existing backend contracts. The fresh exercised subset is separately identified; this table does not claim every backend branch was executed.

| Endpoint | T04 authority and credential state | Existing response/status contract | Fresh evidence |
|---|---|---|---|
| GET `/api/public/events/{slug}` | Anonymous, regardless of stored User/Organizer/desk/scanner; includes availability refresh | Public event metadata and ticket tiers, 200; missing event404 | Real Request-header test; shipping-page 200/404 browser tests; manual Network200/404 |
| GET `/api/public/events/{slug}/booths/{booth_id}` | Anonymous; optional `is_bookmarked` field unused for UI saved state | Public Booth metadata, 200; unknown/mismatched event/Booth404; optional bit/default preserved server-side | Header test; shipping-page list-derived state, missing profile and stale response tests; manual Network |
| POST `/api/auth/register` | Anonymous body credentials; resulting token only in existing User storage key | Existing email/password/full_name/organization/title body; AuthResponse201; duplicate409, validation422 | Header test with all alternatives stored; shipping registration201 + reservation/navigation; manual201 |
| POST `/api/auth/login` | Anonymous body credentials; login401 does not delete any stored session | Existing email/password body; AuthResponse200; invalid credentials401 | All-stored header test; shipping200/401 form and navigation tests; manual Network200/401 |
| POST `/api/events/{event_id}/desk/login` | Anonymous body credentials; success handler still stores only returned event-specific desk token | Existing normalized email/password body; DeskLoginResponse200; bad credentials401; nonmember/revoked403; missing event404 | All-stored header test; shipping and manual anonymous401 form journey. Success handler containment inspected, not freshly exercised as real desk issuance |
| GET `/api/attendees/me/bookmarks/booths` | Separate explicit User client, only when User token exists; no Organizer/desk/scanner substitute | Current User-owned all-event collection200; missing/invalid/expired User401 | Actual HTTP unauthorized seam; shipping saved/empty/expired list tests; manual exact User header |
| POST `/api/attendees/me/bookmarks/booths/{booth_id}` | Explicit selected User only | BookmarkToggleOut201, existing bookmark200; User401; missing Booth404 | HTTP401; shipping save201/mutation401/no-User-no-dispatch; manual201/401 |
| DELETE `/api/attendees/me/bookmarks/booths/{booth_id}` | Explicit selected User only | BookmarkToggleOut200; User401; missing Booth404 | HTTP401; shipping unbookmark200; manual200 |
| POST `/api/events/{event_id}/tickets/reserve` | **Intentionally unchanged legacy protected transport**, explicit token argument from existing User owner; T06 owns migration | Same event/tier body, TicketOut201; duplicate409, closed400, exhausted410, missing tier404 | Shipping and manual successful auth → selected User reservation201 → existing success dialog and `/my-tickets`; no new reservation API/policy |

Protected bookmarks use `CurrentUserDep`, not the public optional authorizer. The backend still validates signature, token family, subject and current User row, and scopes ownership server-side. Frontend authority selection is not permission proof.

## Delivered behavior and state handling

- PublicEvent initial read, capacity/closed-tier refresh, User register and User login use anonymous `createApiClient`. OrganizerDesk changes only its login client/import; its four protected operational clients, `apiKey || deskToken` legacy selection and existing layout stay unchanged for T07/T05.
- PublicBooth has independent public metadata and protected saved-state requests. UI saved state is initialized false, then set exclusively from the User-owned bookmark list matching **both Booth ID and event slug**. A public payload claiming `is_bookmarked: true` cannot produce a saved UI state on its own.
- Bookmark loading/mutation disables the button. With no User token, no protected lookup or mutation is dispatched; the existing sign-in guidance is shown even when Organizer/desk/scanner credentials exist.
- Bookmark mutation success uses `BookmarkToggleOut.bookmarked`, not optimistic public data. HTTP errors show exact status plus existing formatted detail; network failures show a separate saved-state/action error. These errors never replace or fail the anonymous public profile.
- A bookmark401 removes only the exact selected User token, and only after checking that it remains the currently stored session. Other credentials are preserved. Late response, failure and cleanup cannot mutate the next slug/Booth/session; no alternate-token retry occurs. 403/404/other HTTP failures do not delete the selected User credential.
- Slug/Booth changes clear old public data and bookmark feedback/state. PublicEvent resets selected tier, modal/success/duplicate state and submitting state, retaining its current loading/missing presentation. Page-local active contexts ignore late reads, availability refresh, authentication and reservation results after navigation. Late authentication does not create an old-event reservation or overwrite the new page with a stale dialog.
- Normal registration/login request bodies, returned-token storage keys, duplicate-registration retry-safe branch, ticket reservation schemas/status handling, success modal, My Tickets navigation and direct routes remain unchanged. No request is replayed because of reauthentication.

### Existing UI gating and honest proof boundaries

PublicEvent intentionally skips User registration when a User token already exists, reusing that session for retry-safe reservation. Changing that branch to force a registration request would violate T04's reservation-behavior exclusion. Accordingly:

1. Transport tests dispatch registration with every credential stored and prove no Authorization.
2. Actual shipping registration journeys use stored Organizer/desk/scanner credentials with **User absent**, then prove returned User-only reservation and My Tickets navigation.
3. Actual User login journeys open the existing dialog first, then populate all stored credential families before submitting; requests remain anonymous and login401 preserves them.

Likewise OrganizerDesk hides its login form when its already-selected in-memory Organizer/desk authority exists. The manual and automated desk journey opens the real legacy route/form without selected authority, then populates all credential stores **before submission**, without overriding React state or changing the shipping gate. Desk login is anonymous even on an organizer pathname. A route freshly opened with all credentials already selected continues existing operational behavior; independent reception-shell work was not smuggled into T04.

## Changed files and containment

Existing:

- `web/src/pages/PublicEvent.tsx`: anonymous reads/entry calls; minimal route-context reset/stale result guards.
- `web/src/pages/PublicBooth.tsx`: anonymous metadata, independent explicit-User bookmark lookup/actions and status/session/stale-state handling.
- `web/src/pages/OrganizerDesk.tsx`: anonymous login import/client only.

New:

- `web/tests/publicTransport.test.ts`: two focused request/HTTP tests.
- `web/e2e/public-anonymous.spec.ts`: **16** actual shipping-page behavioral browser tests (12 original plus race tests R1-R4) using clearly labelled synthetic, intercepted responses.
- `docs/architecture/portal-redesign/T04_IMPLEMENTATION_RESULT.md`: requested implementation/proof report.

Final tracked source diff: **3 files, 101 insertions, 56 deletions**. Complete scoped diff inspected in `artifact://797`, including its unabridged continuation. No diff for `web/src/api/client.ts`, generated schema, backend, manifests or lockfile. New files are separate additions, not included in that tracked-file statistic. Legacy helper/global precedence, protected desk operations, Organizer callers, other protected User callers, scanner/queue/cache formats, routes and printed URL shapes are intentionally unchanged. Source containment is not a fresh camera/printed-QR/offline-device validation.

Tracked diff after the race correction: **3 files, 106 insertions, 56 deletions** (`PublicBooth.tsx` gained 5 lines). `git diff --check` exit 0; no trailing whitespace in the three untracked files.

## Final automated verification

Final coherent verification used existing installed dependencies, with subprocess capture supplying **explicit numeric exits** rather than relying on background completion metadata. Cwd for all commands: repository `web/`.

| Exact command | Exit | Fresh final result / artifact |
|---|---:|---|
| `npm.cmd test` | 0 | **43 passed**, 2 suites, 0 failed/cancelled/skipped/todo; 463.2048ms |
| `npm.cmd run typecheck` | 0 | `tsc -b`, no diagnostics |
| `npm.cmd run lint` | 0 | **14 warnings, 0 errors**, 42 files; no new T04 warning |
| `npm.cmd run build` | 0 | 60 modules, Vite9.61s; PWA12 entries796.47KiB; main JS740.05kB/gzip209.93kB |
| `npx.cmd tsc -p tsconfig.e2e.json --types node,vite/client` | 0 | Existing installed Node/browser declarations supplied explicitly; no config edit |
| `npx.cmd playwright test e2e/public-anonymous.spec.ts --workers=1 --retries=0` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5198` | 0 | **12 passed** (worker log, before the R1-R4 additions), 24.8s, existing msedge project412×915 |

Raw final outputs: `local://p03-t04-final-frontend-checks.txt`, `local://p03-t04-browser-typecheck-node.txt`, `local://p03-t04-final-browser-tests.txt`.

Lint warnings are the baseline patterns: GateScanner9, MyNetwork2, MyTickets1, ExhibitorPortal1 and unchanged OrganizerDesk operational effect1. No suppressions or unrelated fixes. Build retains its >500kB minified-chunk warning; no speculative code splitting.

Additional attempted browser-test typing command `npx.cmd tsc -p tsconfig.e2e.json` returned **2**: existing scanner E2E files reference Buffer/process/node:crypto while their inherited config excludes Node declarations. Raw output `local://p03-t04-browser-typecheck.txt`. Explicit `--types node,vite/client` succeeds; no out-of-scope config/dependency modification was made.

## Evidence provenance (integration-owner reverification)

| Evidence | Status |
|---|---|
| `npm test` (`web/`) | **Independently rerun**: 43 passed, 0 failed/skipped. |
| `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` (`web/`), each run separately after the race correction | **Independently rerun, all exit 0.** Tests: 43 passed, 0 failed/skipped. Typecheck clean. Lint: 14 baseline warnings, 0 errors. Build: 60 modules, existing >500 kB chunk warning. |
| `npx --no-install playwright test e2e/public-anonymous.spec.ts --reporter=list` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5198`, cwd `web/`, after the race correction | **Independently rerun, exit 0: 16 passed, 0 failed, 0 skipped**, no retry label in the output (environment had `CI=true`, so config retries=2, none used). Before serving, the server's `/src/pages/PublicBooth.tsx` was confirmed to contain the new guard, so it is this checkout and not the T0 worktree. Backend responses are **intercepted and fulfilled by `page.route` for `/api/`**; no FastAPI/PostgreSQL was involved. Pages and `client.ts` are real. A first run of the new R3 test failed because of a test-design error (its own route bypassed the request recorder), not an application defect; it was corrected and the suite rerun. |
| First reverification attempt | Invalid and discarded: with no `PLAYWRIGHT_BASE_URL` Playwright used its default `127.0.0.1:4174`, which is a `vite preview` of the separate detached T0 verification worktree, not this checkout. A stale worker-owned Vite on 5198 from this checkout was stopped, then a fresh server was started for the valid run and stopped afterwards. The T0 preview was not touched. |
| `npx --no-install tsc -p tsconfig.e2e.json --types node,vite/client` after the race tests | **Independently rerun, exit 0.** The earlier default-config exit 2 (scanner files lacking Node types) is a worker log only, not rerun. |
| Sensitivity (mutation) check of R1-R4 | **Independently run.** With the app temporarily changed (file restored byte-identical afterwards): removing the new click-time guard fails R4; removing the storage comparison in the saved-state lookup fails R1 and R2; removing the context guard on the mutation response fails R3. The restored code passes all four. |
| Manual Chromium Network journeys, 45 recorded fixture requests, screenshots | **Worker log only**, not rerun. |
| `getApiClient` inventory below | **Independently recounted** by `git grep` over `web/src`, `web/tests`, `web/e2e` plus untracked files. |
| Bookmark race scenarios 1 and 2 | **Independently reproduced** with a throwaway browser script (removed afterwards, not part of the repo). |
| Bookmark race scenario 4 | **Independently reproduced; see defect below.** |
| Canonical `scripts/check.*`, backend pytest/mypy, real-API browser E2E, Alembic, native, scanner hardware | **Not run.** |

Earlier non-final runs were not concealed: a browser fixture glob `**/api/**` also intercepted Vite's `/src/api/client.ts`, producing blank pages. That task-owned invalid fixture run was cancelled; interception now matches only origin-root `/api/`. The next run had10 passes/1 failed because the test incorrectly assumed one initial lookup under development StrictMode's double effect mount. The corrected invariant permits the one production/two development initial same-User lookups and proves no additional dispatch after unauthorized action. An early frontend run showed two task-owned lifecycle warnings; the final active-context implementation resolves them and returns the baseline14. The final suite and all four commands above ran after all implementation edits.

### Test layers and exercised security negatives

- Two new Node tests capture actual openapi-fetch Requests for all five anonymous endpoint families with stored alternatives; conflicting mixed-case Authorization is removed. A real localhost HTTP server receives selected-User bookmark GET/POST/DELETE and returns exact401, with one request per operation/no retry.
- Shipping-page browser tests cover protected list false/true overriding the public bit; POST/DELETE toggles; expired lookup preserving public profile; mutation401 clearing only selected User/no optimistic saved state; no User/no dispatch despite other sessions; both public404 pages; User login200/401 and success navigation; registration with other families stored; anonymous desk401; late public/list results across slug/Booth; late login across slug preventing old reservation/stale dialogs.
- **R01/R07/R18/R20 frontend/transport portions** freshly exercised. Existing scanner reliability/auth/engine and ticket-cache tests ran in the43-test suite. No fresh claim is made for real-backend registration/bookmark integration, database permission isolation, native/device behavior or full release gates.

## Mandatory manual browser / Network proof

Note: the manual Network journeys below are a worker log from before the race correction and were not repeated. The committed browser suite was rerun after the correction.

Read `agent-browser` skill; `agent-browser skills get core` returned127 (`command not found`). Used documented managed Chromium instead.

Actual **shipping routes/components**, not a helper-only fixture, ran through real Vite HTTP middleware on an isolated origin. Response bodies/statuses were synthetic; no fetch mock or request interception was used for this manual layer. The server inspected headers and saved only booleans; no login bodies or credential strings were logged. Synthetic credentials occupied real User localStorage, Organizer/event-specific desk sessionStorage and scanner IndexedDB `congress_scanner_tokens`/`tokens` stores.

Performed public event and Booth reads, bookmark POST/DELETE, successful registration → reservation → `/my-tickets`, bad User login401 preserving sessions, successful User login200, desk login401 preserving sessions, expired bookmark lookup while metadata remains readable, mutation401, both public404 pages, breadcrumb → browser Back and direct reload. Registration/desk form-gating distinctions are described above.

Captured actual Chromium **Network `requestHeaders`** and compared Authorization privately. Initial Network window has20 API requests; the later window contains12 (not a disjoint-total count). The synthetic HTTP server recorded45 manual API requests including development StrictMode loads and unchanged downstream My Tickets reads: **zero public/entry Authorization violations, zero bookmark non-User authority violations**. Browser page errors0, dropped0.

Evidence: `local://p03-t04-browser-evidence.json`, `local://p03-t04-browser-diagnostics.json`. Screenshots retained as external evidence artifacts:

- `C:/Users/sadra/AppData/Local/Temp/omp-sshots-15a32ea56fca1208.webp` — actual PublicBooth, EN1100×800.
- `C:/Users/sadra/AppData/Local/Temp/omp-sshots-15a32eb51a8a1209.webp` — actual PublicEvent, FA locale412×915; document scrollWidth412 observed.

This is not a complete RTL/accessibility/320px matrix. Static nonlocalized public copy and legacy desk operational behavior were not redesigned.

Cleanup completed: fixture-origin local/sessionStorage and scanner IndexedDB cleared; task tab closed; task-owned HTTP fixture service stopped and external fixture script removed. Final browser-suite Vite service also received its stop command. No shipping fixture/scaffold or new package remains. Evidence screenshots/output artifacts are retained intentionally.

## Intentionally remaining legacy transport inventory

`getApiClient` remains unchanged. Verified by `git grep` (no test, e2e or untracked file references it):

- 1 declaration: `web/src/api/client.ts`.
- 9 pages still import it: ExhibitorPortal, GateScanner, MyNetwork, MyTickets, OrganizerAnalytics, OrganizerDesk, OrganizerEventDetail, OrganizerEvents, PublicEvent.
- **31 client instantiations** (matches the earlier total) and **42 legacy HTTP operations** (several operations share one client).

| Page | Instantiations | Legacy HTTP operations | Later owner |
|---|---:|---:|---|
| OrganizerEvents | 3 | 3 | T05 |
| OrganizerEventDetail | 10 | 14 | T05 |
| OrganizerAnalytics | 1 | 4 | T05 |
| PublicEvent (ticket reservation only) | 1 | 1 | T06 (backlog lists it in T06 files) |
| MyTickets | 2 | 3 | T06 |
| MyNetwork | 4 | 5 | T06 |
| ExhibitorPortal | 4 | 5 | T06 |
| OrganizerDesk (me/tiers, search, registration, detail) | 4 | 5 | T07 |
| GateScanner (manifest, batch) | 2 | 2 | T08 |
| **Total** | **31** | **42** | |

OrganizerDesk also has one migrated anonymous login POST and PublicEvent three migrated anonymous operations (initial read, availability refresh, register/login); these are not legacy. Per-file operation counts were derived from the `client.<METHOD>(` calls on each legacy client.

PublicBooth has no remaining legacy client construction. All public/credential-entry constructions are migrated. Existing direct fetch paths also remain intentionally unchanged: Exhibitor CSV, network vCard, Organizer attendance CSV and scanner self-revocation. T09 removes the heuristic helper only after separately authorized remaining cutovers.

## PublicBooth session-race review

Reviewed `PublicBooth.tsx` and the browser tests. The current Attendee token is read from `localStorage` on every render, and the page has no login UI, so a token swap on this page can only come from another tab (simulated in tests by writing `localStorage`).

**Confirmed defect (now fixed, low severity).** `handleToggleBookmark` dispatched the request with the `token` captured at render and compared it with `localStorage` only after the response. Reproduced: page rendered under token A, storage switched to B, click sent `POST /api/attendees/me/bookmarks/booths/{id}` with `Bearer A`; the response was then discarded, so the bookmark was saved in account A with no feedback. No privilege escalation and no other credential family was involved; the legacy code had the same closure behaviour.

**Correction (`web/src/pages/PublicBooth.tsx`, +5 lines).** At the start of the mutation, after the existing no-token check, if `localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token` the handler sets the feedback "Your attendee session changed in another tab. Please reload this page." and returns before any client or request is created. The newer token is not cleared, no bookmark state is changed, and no success state is shown. The resulting re-render reads the current stored token, so the saved-state lookup is reloaded for the current session.

**Limits.** A request already dispatched before a session change cannot be recalled or cancelled on the backend; only its response is ignored. The guard is a synchronous check at click time, so a token change between the check and the request is not possible in the same JavaScript task but another tab can still change it after dispatch.

**Committed regression tests (`web/e2e/public-anonymous.spec.ts`, all pass):**

1. **R1** delayed saved-state response for token A (`saved=true`) after storage switched to B: "Saved in Passes" is never rendered, even transiently (a MutationObserver records any appearance); B's own lookup runs; B stays stored.
2. **R2** delayed 401 for token A after the switch: B stays in `localStorage`, no error status is shown, Organizer and desk session entries are intact.
3. **R3** bookmark mutation held in flight for booth X, route changed to booth Y, then completed: Y's saved state and feedback are unchanged, never rendered as saved, exactly one mutation (X, `Bearer` of the original user) was dispatched, none for Y.
4. **R4** page rendered under A, storage switched to B before the click: no POST or DELETE is dispatched, B stays stored, no saved or success state, the "session changed" message is shown, other credentials are intact.

The older test "late public and saved-state responses cannot replace the next slug/Booth" still covers reads and the saved-state list across a slug/booth change. T06 also lists `PublicBooth.tsx` but this defect is closed here, not deferred.

## Missing gates, rollback and final checklist

**Not run:** canonical `scripts/check.bat`/`scripts/check.sh`, backend pytest/mypy, real API/browser database integration, Alembic/migration checks, mobile/native checks and scanner hardware/offline/printed-QR journeys. Inspected Windows gate invokes backend pytest via workstation-specific WSL paths; `backend/tests/conftest.py` force-drops/recreates `congress_test` and truncates tables. No verified authorized disposable PostgreSQL target was provided; running that gate against host data would violate the assignment. No database migration is required by these changes.

Rollback is a reviewed coherent page/test rollback retaining explicit anonymous public/entry and explicit User bookmark authority, not restoring credential leakage. Accounts, bookmarks, existing routes and server contracts remain untouched.

- [x] Every named public/entry endpoint has no-header Request proof, with shipping-page proof at the reachable existing form flows.
- [x] Protected saved state and mutations use only the explicit User credential; the public optional saved bit is ignored; a mutation is not dispatched under a stale rendered session (R4).
- [x] Public404, bookmark401/no fallback, login401/no unrelated deletion and success navigation exercised.
- [x] Route-context and session-race behaviour covered: reads, saved-state lookup, login, delayed A responses after a token switch (R1, R2), in-flight mutation across a booth change (R3), click after a token switch (R4).
- [x] Independently rerun by the integration owner after the correction: 43 Node tests, typecheck, lint, build, e2e typecheck and 16 Playwright tests (intercepted `/api/` responses), all exit 0. Worker-only: manual Network journeys and the e2e default-config typecheck result.
- [x] Manual actual-page Network journeys and limitations recorded; fixture cleanup performed.
- [x] Scoped diff and unchanged helper/backend/schema/lockfiles inspected; T01/T02 preserved.
- [ ] Canonical full-stack and real FastAPI/PostgreSQL integration gates — unavailable/not run; **overall PARTIAL**, not release-ready.

Git operations performed by worker were read-only scoped diff/stat inspection. No commit, staging, push, reset, clean, stash, rebase, merge, database action or deployment.

**STOP: P03-T04 assigned implementation and reachable evidence concluded; no subsequent task started.**
