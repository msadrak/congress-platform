# Task 05D — Repository Integrity & Scanner Security Closure Audit

**Audit date:** 2026-10-10  
**Scope:** Actual source and current Git state for Tasks 02–05C; scanner revocation; bounded offline authorization; current verification.  
**Mode:** Read-only audit. No application code, tests, fixtures, dependencies, configurations, or migrations were changed. The only repository artifact created for this task is this report.  
**Release assessment:** **NOT READY** — Task 05C's principal unpairing/security acceptance criteria are not met by the current source.

## 1. Executive findings

The repository is not a clean, committed representation of Tasks 02–05C. `master` remains at `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce` (2026-10-06). Task implementation changes are present in the primary working tree as uncommitted tracked modifications and untracked files/reports. No branch or reflog entry after that commit records the task work. The only other worktree found is `.kilo/worktrees/laser-process`, detached at the initial `9c21ed2` commit. That establishes that the implementation currently exists as local working-tree state, not as committed history. It does **not** establish that files were previously deleted or overwritten; no such event appears in the available reflog.

`GateScanner.tsx` is currently 1,053 lines and has a working-tree delta of 477 insertions / 38 deletions against the 614-line `HEAD` version. `git log --follow` shows only the original scanner commit `6678b79`. Thus the current scanner changes are local modifications after the committed V1 scanner, not a later scanner commit or alternate branch. Historical explanations beyond these facts are not evidenced.

The severe Task 05C discrepancy is not that all 05C source is absent: its auth-policy module, token-store metadata, unpair controls, and tests exist in the current worktree. The discrepancy is that the unpair implementation and its tests do not demonstrate (and the backend contract prevents) server-side self-revocation:

- The revocation endpoint requires `OrganizerDep` (`backend/app/routes/checkin.py:319-328`), while the scanner calls it using its own scanner bearer (`web/src/pages/GateScanner.tsx:462-469`).
- A live HTTP/ASGI integration probe on the current backend returned **401** for scanner self-revocation; the same scanner token then fetched the manifest with **200**. A valid organizer credential returned **200** for revocation, after which the copied scanner token received **401** for manifest access.
- Fresh tokens do not have `device_id` copied into the client credential: `storeCredential` uses only the previous credential's `device_id` (or null) (`GateScanner.tsx:82-97`), and URL/paste token flows pass only the token string (`:100-109`, `:597-607`). Therefore the ordinary newly paired client skips the revoke request entirely (`:462-465`).
- Even if a revoke request is attempted, the UI ignores the HTTP response's status/error and proceeds to purge local tokens and display “Device unpaired” (`:466-485`). A 401, 403, or HTTP 500 is not treated as a failed revocation by this code path. Transport throws are swallowed too.
- Local cleanup leaves manifest and scan data intact as intended, but clears `authBlocked` and does not gate on credential presence (`:475-484`; `:348-364`). With a cached manifest, the scanner can continue locally after unpair. A copied token also remains server-valid unless an organizer separately revokes it or it expires.

The full current test suites are green except full mobile analysis. These results do not close the security gap: browser tests intercept/mock API routes and U01 supplies a canned successful revoke response without proving a request was sent or authorized. The actual integration probe demonstrates the mismatch.

## 2. Repository state and drift investigation

### 2.1 Observed Git state

| Check | Observed result |
|---|---|
| Current branch / HEAD | `master`, `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce` (`docs: add complete project delivery report for Milestones V1 and V2`) |
| `git status` | 39 modified tracked files, 28 untracked entries, no staged changes; includes backend, web, mobile changes and untracked migrations/tests/audit reports. User files such as `.obsidian/` are present and were left untouched. |
| `git diff --stat` | 39 tracked files; 13,326 insertions and 4,253 deletions (includes broad web changes and package-lock churn). Untracked files are not included in this stat. |
| Branches | Only `master` was listed by `git branch -avv`; no task-specific branch/ref found. |
| Reflog | Latest entry is the 2026-10-06 `3046cfe` commit. History is linear back through the milestone commits; no Task 02–05C commit/reflog action exists after baseline. |
| Worktrees | Primary worktree at `3046cfe`; `.kilo/worktrees/laser-process` detached at `9c21ed2` (initial commit), with no newer task implementation there. |
| GateScanner history | `git log --follow` returns only `6678b79` (V1 scanner). `HEAD` file: 614 lines; current file: 1,053 lines; worktree delta: +477 / −38. |

### 2.2 Root cause supported by evidence

The task reports reference baseline `3046cfe`, but no corresponding Task 02–05C commits exist. In the current checkout, their source changes are uncommitted modifications and untracked files. The detached secondary worktree is older, not a location containing the missing newer changes. Therefore the trustworthy statement is: **the implementation is currently local-only working-tree content, not committed repository history.** No evidence supports choosing among historical “lost,” “overwritten,” or “never saved” events. The current report discrepancies can be demonstrated independently: source/API contract disagrees with the Task 05C unpair claim, while the 05C browser test uses mocked revocation rather than the real endpoint.

### 2.3 Tracked and untracked scope

Tracked modifications include `backend/app/routes/checkin.py`, `backend/app/security.py`, `backend/app/models.py`, `web/src/pages/GateScanner.tsx`, `web/src/lib/scannerEngine.ts`, `web/src/lib/scannerStorage.ts`, `web/vite.config.ts`, several mobile service/model files, and numerous UI files. Untracked task implementation includes migrations `0008_scanner_devices.py`, `0009_admission_concurrency_control.py`, `0010_peer_contact_consent.py`; scanner/security/concurrency tests; PWA and scanner policy/store modules; `web/e2e/scanner-offline.spec.ts`; and prior audit/remediation reports. This list is evidence of present state, not proof of authorship or a claim that every unrelated untracked file belongs to these tasks.

## 3. Implementation evidence matrix

“Test result” below refers to the commands executed in this audit, not prior report claims. The API-level browser tests use Playwright route interception for backend calls unless explicitly noted.

| Task / requirement | Claimed implementation | Actual source evidence | Automated evidence and this-run result | Status |
|---|---|---|---|---|
| **02 — JWT signing secret hardened** | Reject insecure/default signing secrets | `backend/app/config.py` validator; `backend/tests/test_scanner_security.py:35-77` | Backend full suite **99 passed**; strict mypy **40 files, no issues** | **VERIFIED** |
| **02 — Scanner token scoped and revocable** | Device-bound `jti`, DB revocation, point/event/scope validation | `backend/app/security.py:57-80`; `backend/app/routes/checkin.py:153-242,247-291,319-344`; `ScannerDevice` model | `test_per_device_token_issuance_and_revocation_lifecycle` in `backend/tests/test_scanner_security.py:230-300`; full backend suite **99 passed**; separate live HTTP probe described in §4 | **PARTIAL** — organizer revocation works; scanner self-unpair does not |
| **02 — URL token removed from address bar** | Capture `?token`, persist, then strip URL | `web/src/pages/GateScanner.tsx:100-109` | Playwright T01 / T11 in `web/e2e/scanner-offline.spec.ts:206-219,516-535`; full production-browser suite **22 passed** (mock API) | **VERIFIED** for browser URL/storage behavior, not real token validity |
| **03 — Atomic cross-device SINGLE_USE admission** | Row locks, unique partial index, savepoint collision recovery | `backend/app/routes/checkin.py:640-752`; migration `backend/migrations/versions/0009_admission_concurrency_control.py:1-51` | `backend/tests/test_concurrency.py:53-112,183-234`; PostgreSQL full suite **99 passed**. Test fixture recreated DB and ran Alembic to head (`backend/tests/conftest.py:32-61`). | **VERIFIED** in tested PostgreSQL configuration |
| **03 — CAPACITY_CAPPED concurrent limit** | Lock checkpoint and serialize occupancy count | `backend/app/routes/checkin.py:640-658`; migration `0009` | `test_concurrent_capacity_capped_race`, `backend/tests/test_concurrency.py:119-176`; full suite **99 passed** | **VERIFIED** |
| **03 — Duplicate scan ID replay/idempotency** | Nested transaction catches conflict and returns deterministic outcome | `backend/app/routes/checkin.py:477-480,694-752`; database scan ID key | `test_concurrent_same_scan_id_idempotent_replay`, `backend/tests/test_concurrency.py:183-234`; full suite **99 passed** | **VERIFIED** |
| **04 — Local capacity counting** | Stateful local count and `CAPACITY_REACHED` rejection | `web/src/lib/scannerEngine.ts:82-101`; `GateScanner.tsx:370-379` | `web/tests/scannerReliability.test.ts:10-66`; web unit suite **23 passed**; Playwright T05 **passed** | **VERIFIED** for single browser local state; cross-device capacity remains server-owned |
| **04 — Restore ticket and capacity state after reload** | Replay local scan records on cached manifest | `web/src/lib/scannerEngine.ts:119-159`; `GateScanner.tsx:191-204,217-228` | `scannerReliability.test.ts:68-118`; T04/T05 **passed**; production browser suite **22 passed** | **VERIFIED** for tested IndexedDB reload path |
| **04 — Reconcile server rejections without silent success** | Per-record `PROVISIONAL/CONFIRMED/LOCAL_REJECTED/CONFLICT`, retain conflicts | `web/src/lib/scannerStorage.ts:1-19,204-258`; `GateScanner.tsx:292-343,1001-1049`; mobile `sync_service.dart:18-38` and storage service | Web tests **23 passed**; T06/T07/T09 **passed** with route-mocked API; backend **99 passed** | **PARTIAL** — web logic and mocked reconciliation covered; mobile durability/server rejection path lacks equivalent evidence |
| **05 — PWA shell and offline route recovery** | Prompted SW, app-shell precache, API exclusions, SPA navigation fallback | `web/vite.config.ts:10-39`; built `web/dist/manifest.webmanifest`/`sw.js` | Production build succeeded (12 precache entries); T01–T03/T12 passed; full Playwright **22 passed** | **VERIFIED** for Edge desktop production-build route/reload scenarios; other browsers/platforms untested |
| **05 — Scanner queue survives update/failure** | IndexedDB queue and persistent state | `web/src/lib/scannerStorage.ts:37-74,125-183`; T10/T12 | T10/T12 passed, as did full 22-test suite; calls are mocked | **PARTIAL** — persistence path verified in Edge; real server recovery and browser eviction not established |
| **05B — Fix T02 offline badge assertion and T06 mock IDs** | Keep meaningful state assertion; echo queued scan IDs | `web/e2e/scanner-offline.spec.ts:157-189,224-251,352-383`; prior report calls these test-only | T02/T06 passed in current full run; API is intercepted | **VERIFIED** as test corrections; not proof of network/hardware offline guarantees |
| **05B — Browser/device compatibility** | Browser capability matrix, Edge, Chrome, Safari/iOS, Android, USB-HID | `web/playwright.config.ts:14-22` runs only `msedge`; scanner camera/HID source in `GateScanner.tsx:420-560` | Edge E2E **22 passed**. No Safari/iOS/Android/physical USB HID run in this audit. | **UNTESTED** outside configured Edge desktop project |
| **05C — Persistent scanner credential and expiry metadata** | IndexedDB token DB, device ID and `exp` metadata | `web/src/lib/scannerTokenStore.ts:17-73,91-125`; `GateScanner.tsx:71-109` | T11 passed (test token persistence); web unit/build clean | **PARTIAL** — token persistence verified, but fresh credential’s `device_id` is not populated by token capture path |
| **05C — Visible definitive 401/403 handling** | Stop admission and show re-pair guidance; transient failures retry | `GateScanner.tsx:111-132,231-241,329-343,348-364,573-629` | U03–U05 passed with mocked HTTP responses; full Edge suite **22 passed** | **PARTIAL** — mocked UI behavior works; does not make self-revocation work or prove race-free online authorization |
| **05C — Unpair and server revoke** | Revoke server-side, clear credential locally, preserve audit/queue | UI `GateScanner.tsx:453-490,941-999`; server endpoint `backend/app/routes/checkin.py:319-344` | U01/U02/U09 pass, but U01 mocks `200`, no request assertion, and normal `device_id` is null. Live ASGI probe: scanner revoke **401**, old token manifest **200**. | **MISSING** as an end-to-end security guarantee |
| **05C — Bounded 24h offline window and manifest age** | JWT exp + freshest server-contact/manifest baseline; gate scans | `web/src/lib/scannerAuthPolicy.ts:18-93`; `GateScanner.tsx:160-169,348-364` | Policy tests included in web suite (**23 pass**); U06 stale manifest test passes using wall-clock backdating | **PARTIAL** — local timestamp gate exists; clock rollback bypass and real offline revocation are not tested; `navigator.onLine` can bypass the window |
| **05C — Pending record retention on unpair/reconnect** | Preserve scan IDs, records and conflicts for supervisor recovery | `GateScanner.tsx:475-484`; storage `scannerStorage.ts:125-183`; reconcile `:204-258` | U01/U02/U08/U09/U10 pass, all through route mocks; IDs are not compared across real backend replay | **PARTIAL** — IndexedDB data retention is shown; successful server recovery after the real failed revoke is not |

## 4. Server-side unpairing audit

### 4.1 Actual endpoint authorization

The route `POST /api/checkin-points/{point_id}/devices/{device_id}/revoke` declares `organizer: OrganizerDep` and only revokes after loading the point, validating event ownership, and finding the device (`backend/app/routes/checkin.py:319-344`). `OrganizerDep` calls `current_organizer`, which hashes the supplied bearer and looks it up as an organizer API key; unknown bearer strings return **401** (`backend/app/auth.py:31-44`). Scanner tokens are handled only by `authorized_checkin_point`, a separate dependency for manifest/batch endpoints (`checkin.py:153-244`). Therefore the scanner bearer cannot call the revocation route as implemented.

### 4.2 Actual HTTP integration reproduction

Executed a throwaway ASGI HTTP probe using the current FastAPI app and PostgreSQL test DB. It created an organizer, event, check-in point, and scanner device using actual endpoints, then made these requests:

```text
event 201
point 201
issue 201
scanner-self-revoke 401 {"detail":"Invalid API key"}
copied-token-manifest-after-self-revoke 200
organizer-revoke 200 copied-token-after-organizer-revoke 401
```

This is direct backend HTTP evidence: a scanner cannot self-revoke; an old/copied token remains useful until an organizer revokes it (or it expires); the organizer revoke does invalidate it on the next authenticated scanner request. The existing backend test `test_per_device_token_issuance_and_revocation_lifecycle` verifies the organizer path (`backend/tests/test_scanner_security.py:230-300`) but never attempts self-revocation.

### 4.3 UI request and error handling

The client attempts revocation only if `persistedCredential?.device_id`, `navigator.onLine`, and token are all truthy (`web/src/pages/GateScanner.tsx:462-469`). Fresh token entry persists `device_id` from the previous credential or null; URL/paste flows pass just a string and derive only expiry (`:82-109`, `:597-607`). This means a fresh issued token normally lacks the required client-side device ID and skips the request.

When it does call, it awaits `openapi-fetch` but does not inspect the returned `{error, response}`. It only catches thrown transport errors, then always removes local token entries, clears credential/auth-block state, reads queue state, and reports “Device unpaired” (`:466-485`). Consequently:

- **401:** scanner bearer is rejected by actual route; UI still completes local unpair and displays success.
- **403:** no normal scanner path can reach a 403 from `OrganizerDep` (invalid key is 401; cross-tenant valid organizer ownership is masked as 404). If any HTTP 403 is returned by a proxy/custom middleware, UI likewise ignores it.
- **500:** no injected server-failure reproduction was performed; the source path does not inspect an HTTP error result, so an HTTP 500 response is likewise treated as completion. A transport-level throw is swallowed and also treated as completion.

The existing U01 test installs a wildcard route returning canned 200 (`web/e2e/scanner-offline.spec.ts:571-597`) but does not assert a request was made, validate the bearer, or make the route implement backend behavior. U02 is offline local cleanup only (`:599-623`); U09 verifies local data remains (`:769-791`). They do not prove server revocation.

### 4.4 Records and stale manifest after unpair

Unpair intentionally preserves queued scans, conflicts, and cached manifest (`GateScanner.tsx:453-456,475-484`). These remain available in origin IndexedDB (`web/src/lib/scannerStorage.ts:77-123,125-183`). This is useful for recovery but also means attendee names, QR secrets, and cached admission details are still readable by anyone with access to the same browser profile. More importantly, in the same mounted scanner view, unpair clears `authBlocked` and leaves `manifest`/ticket state intact. The scan processor checks only `authBlocked` and the offline verdict, not whether a credential is present (`GateScanner.tsx:348-364`); the verdict returns `ONLINE`/allowed before checking credentials (`scannerAuthPolicy.ts:60-68`). Thus local scans can continue after unpair, while online queue sync then fails without a token. A copied old token remains valid when the server revoke was skipped/failed, as the actual probe demonstrated.

**Finding U-1 — P1, confirmed:** UI reports unpair as successful without server-side revoke; a fresh scanner credential normally cannot trigger the request, and scanner credentials cannot authorize the endpoint. It also leaves a local admission path open after unpair. **Impact:** a supposedly unpaired scanner can continue admitting using cached attendee data, and any copied old token remains valid at the API. Task 05C closure is blocked.

## 5. Offline authorization audit

### 5.1 What is implemented locally

- Scanner JWT issuance is seven days (`backend/app/routes/checkin.py:266-284`); server authorization decodes the token and checks device revocation and scope (`:174-219`). Server responses are authoritative when online.
- Browser code decodes JWT `exp` without signature verification (`web/src/lib/scannerAuthPolicy.ts:95-111`) and evaluates expiration plus a 24-hour maximum since the freshest available manifest/server-contact timestamp (`:18-93`). Local scans call the policy before evaluating a ticket (`GateScanner.tsx:348-364`).
- A fresh manifest is cached with `cached_at` (`web/src/lib/scannerStorage.ts:77-123`); initial manifest fetch updates React `lastServerContactAt`/`manifestCachedAt` and successful batch sync updates `lastServerContactAt` (`GateScanner.tsx:217-230,317-328`).
- Device revocation cannot be learned while disconnected. Therefore a revoked-but-offline device can continue under cached data until local expiry/window checks block it, assuming the local clock and connectivity state are truthful.

### 5.2 Enforcement limitations / failures

1. **Clock rollback:** all freshness/expiry checks use caller-supplied `Date.now()` and parse wall-clock ISO timestamps. `offlineForMs` clamps negative elapsed time to zero (`scannerAuthPolicy.ts:83`); there is no signed monotonic timer or trusted server-time anchor. Rolling the device clock backwards while offline can extend the 24-hour window and can make a not-yet-server-checked JWT appear unexpired locally. Server signature/expiry and revocation checks still apply on later successful requests. No clock-manipulation test exists.
2. **Online flag bypass:** `evaluateOfflineAuthorization` immediately returns `ONLINE`/allowed whenever `isOnline` is truthy (`:60-68`), before checking JWT exp or timestamps. The scan path supplies `navigator.onLine` (`GateScanner.tsx:354-359`), not a successful network-health check. If the browser reports online while the service is unreachable, local admissions can continue past the time bound while requests fail transiently. The existing test plan itself documents that headless offline emulation may leave `navigator.onLine` true (`web/e2e/scanner-offline.spec.ts:239-250`).
3. **Server contact not durable:** `lastServerContactAt` is React state only (`GateScanner.tsx:55`), not stored in IndexedDB. After browser restart it is null; only persisted manifest `cached_at` is available. A recent successful batch sync with an older manifest is forgotten on restart (overly strict, not permissive), but no test verifies the timestamp lifecycle.
4. **Revocation while offline:** impossible to detect until connectivity returns; operational window is local policy, not server enforcement. Expired token with accurate system time should block offline through `TOKEN_EXPIRED`; a revoked but unexpired token has no local revocation signal.
5. **Restart evidence:** T03/U10 use closing/opening pages within the same Playwright browser context, not a new browser process/profile. IndexedDB survival across page reload/new page is tested; full browser/OS restart and storage eviction are not.
6. **Unpair cache behavior:** unpair does not delete cached manifest or scan history. That is explicit source behavior, and the U09 test asserts manifest presence after unpair (`scanner-offline.spec.ts:769-791`). The UI continues to render cached attendee/ticket information in-place; same-origin data remains inspectable in IndexedDB until separately cleared.

**Finding O-1 — P1-adjacent/P2, confirmed design limitation:** The 24-hour bound depends on mutable wall clock and `navigator.onLine`, and does not detect offline revocation. It is not a hard security authorization boundary. **Finding O-2 — P1, confirmed:** post-unpair cached scanner state remains live and scan admission is not gated on credential presence (see U-1).

## 6. Verification rerun

| Verification | Command / environment | Actual result |
|---|---|---|
| Backend PostgreSQL integration suite | `uv run pytest -q` in WSL, `backend/tests/conftest.py` recreates dedicated `congress_test` DB and runs `alembic upgrade head` | **99 passed in 48.70s** |
| Strict mypy | `uv run mypy` in `backend/` | **Passed: no issues found in 40 source files** |
| Web unit tests | `npm test` in `web/` | **23 passed, 0 failed** |
| Web TypeScript typecheck | `npm run typecheck` (`tsc -b`) | **Passed** |
| Production build | `npm run build` | **Passed**; Vite PWA generated 12 precache entries (~612 KiB). Vite emitted a >500 KiB chunk advisory. |
| Production Playwright | `npx playwright test --project msedge` against configured `http://127.0.0.1:4174` preview | **22 passed in 2.2m** (T01–T12 + U01–U10). Browser API routes are mocked/intercepted, not connected to backend. |
| Mobile unit tests | `dart test` | **8 passed** |
| Mobile scoped analysis | `dart analyze lib/models lib/services test` (same scope as `scripts/check.bat`) | **No issues found** |
| Mobile full analysis | `dart analyze` | **Failed: 301 issues**. Root errors include missing `package:flutter/material.dart` in `lib/main.dart` and `lib/screens/*`; declared dependencies in `mobile/pubspec.yaml:8-14` contain only `http`, `uuid`, and Dart test/lints, no Flutter SDK. |
| End-to-end backend revocation probe | Throwaway ASGI HTTP probe against current FastAPI + PostgreSQL test DB | Scanner self-revoke **401**, manifest with same token **200**; organizer revoke **200**, old-token manifest **401**. |

The browser E2E run exercises the built frontend but **does not constitute real-backend E2E**: `setupApiRoutes` intercepts manifest and batch (`web/e2e/scanner-offline.spec.ts:157-189`), and U01 intercepts revoke with a canned `200` (`:575-578`). Thus passing counts describe only the tested code paths, not live browser-to-PostgreSQL integration.

## 7. Exact blocking issues

1. **P1 — Unpair does not revoke the actual scanner device.** Route expects organizer API key; scanner bearer returns 401. Current actual server confirms this and that the token remains valid.
2. **P1 — UI reports success on failed/omitted revoke.** `device_id` is normally null in captured credentials, so no call; if called, returned HTTP `error`/status is ignored. Local-only deletion is mislabeled as server unpair.
3. **P1 — New scanning is not stopped after unpair.** Cached manifest/ticket map remains, `authBlocked` is cleared, and no credential-presence gate exists. Local admissions can continue on the ostensibly unpaired device.
4. **P1-adjacent — Offline authorization is not a trusted hard bound.** Clock rollback and online-state misclassification can extend local operation; revocation is unknowable while disconnected.
5. **P2 — Security-sensitive cached attendee data remains after unpair.** Manifest, QR secrets, and scan history persist in IndexedDB by design. Recovery requirement needs a controlled handoff/clear path and an explicit threat acceptance, not a “fully unpaired” claim.
6. **P2 — Full mobile analyzer is red.** The scripted/scoped analyzer omits Flutter screens and entry point and therefore hides 301 analysis findings; package also lacks Flutter dependencies/platform runners.
7. **P2 — Repository baseline not reproducible from Git alone.** Relevant source/migrations/tests/reports are uncommitted/untracked. A fresh checkout at current `HEAD` does not contain the implementation verified above.

## 8. Recommended repository stabilization procedure

1. **Freeze the current working tree.** Do not reset/clean/rebase; retain the modified and untracked files. Record a full status snapshot and a binary diff/backup outside the repository before any integration work.
2. **Inventory untracked paths with owners.** Separate task implementation from `.obsidian/`, `nul`, generated `web/test-results`, screenshots, and other user data; do not blanket-add or discard these files.
3. **Build a reviewed change set from the real source tree.** Explicitly stage only intended task files, including required migrations and tests. Compare each prior report’s claimed paths and behavior against the staged diff; correct or withdraw contradicted report claims.
4. **Commit the independently reviewed task changes on a named branch** in coherent, ordered commits (02 security, 03 concurrency, 04 offline sync, 05 PWA, 05B verification, 05C lifecycle). Keep the current baseline commit and local user work recoverable; no history rewriting.
5. **Add and run live integration acceptance for unpair:** browser issues a real scanner token, enters it, invokes unpair through the real app/API, records server status, then proves copied token fails and local new scans are blocked. Include 401/403/500/network failure semantics and queue recovery after re-pair. Do not accept UI “success” without authoritative revocation outcome.
6. **Add explicit offline time/authorization tests:** realistic disconnect, 24-hour boundary, restart, clock rollback/forward, late revocation, and cache exposure after unpair; distinguish UX limits from cryptographically/server-enforced guarantees.
7. **Keep verification scopes visible.** Maintain separate required gates for full backend PostgreSQL tests + strict mypy, web unit/type/build, production browser tests with live backend where claimed, mobile unit/scoped analysis, and full mobile analysis/native build. Do not let a scoped check stand in for an omitted target.
8. **After stabilization, rerun the gates from a clean checkout of the resulting commit** and preserve exact command output with commit SHA. Only then decide readiness/closure.

## 9. Task 05C closure and release decision

**Task 05C cannot safely be closed on this repository evidence. Release status: NOT READY.**

Evidence supporting closure of narrower pieces: current source contains stateful local capacity and reconciliation logic; backend concurrency controls have migrations/tests; PWA shell builds; web unit/type/build, PostgreSQL backend suite, strict mypy, and Edge browser suite pass in this run. Evidence preventing closure: real scanner-token HTTP self-revocation returns 401; the old token remains accepted (manifest 200); client token capture normally stores no device ID; HTTP revocation failures are ignored; and local admission continues to be possible after the unpair action while cached data remains. Browser U01's mocked 200 does not exercise this contract. Offline authorization additionally relies on mutable wall clock and `navigator.onLine`; full mobile analysis remains 301 issues. These are material security/operational blockers, not documentation-only caveats.
