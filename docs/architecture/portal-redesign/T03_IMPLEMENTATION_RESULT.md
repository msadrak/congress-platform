# P03-T03 — Pure explicit-authority API boundary

## Verdict and authorized scope

**P03-T03 implementation, assigned frontend gates and real-browser transport fixture: PASS.** This is not a production release, full-stack approval or completion of the caller migration. The final build's successful completion output was delivered by a background job without a numeric exit field; this tooling limitation is recorded below, not fabricated as a directly reported exit.

Only P03-T03 was authorized. No P03-T04 or later task, commit, staging, push, backend/database change, dependency installation, lockfile change, route migration, AuthContext, new state library or shell work was performed. The original helper intentionally coexists until the separately authorized T04–T08 caller migrations and T09 removal.

## Initial baseline and prerequisites

- Checkout: `integration/task-05h`, HEAD **`015bdab0b1cbc9bad64f1c51a0670f7690dc87d5`** in the main working checkout, not the detached T0 verification tree.
- Initial `git status --porcelain=v1 --untracked-files=all`, `git diff --name-only` and `git diff --cached --name-only` were empty. No pre-existing dirty work was incorporated or removed.
- Read the complete authoritative T03 backlog entry, lines167–216; execution protocol; relevant complete authority/resource and endpoint-matrix sections of the roadmap, API/data migration and architecture reconciliation; Phase04 backlog classification, correction register and security review; the T01 report and relevant T02 contract/policy sections; historical frontend credential design; fixed regression/transport scenarios; repository instructions, coding standards and glossary. Actual source, generated schema use, openapi-fetch0.17 transport/types, callers and Node test conventions were inspected before editing.
- T01 prerequisite verified in current `backend/app/routes/auth.py`: a present type other than exact `user` is rejected, absent type retains legacy User compatibility, and protected failures carry the Bearer challenge. T01 report records its backend status/authority results. No backend tests were rerun for this frontend-only task.
- T02 is already present, although not T03's hard prerequisite. Current desk authorizer requires a strict nonnegative matching integer `session_version`; the latest T02 fail-closed amendment rejects all unversioned Desk tokens even at row0. That amendment and legacy typeless **User** compatibility were left untouched.
- Phase04 marks **T03 READY**, not blocked. No correction-register finding imposes a new T03 product decision. AR-05's explicit authority and anonymous public/auth contract takes precedence over historical portal-derived selection/public personalization. The Phase04 audit's shorthand “null guarantees anonymous” applies to the **new** factory; the legacy helper cannot safely be treated as anonymous during staged coexistence.
- Internal minimal contract/plan and inspected prerequisites: session artifact `local://p03-t03-contract.txt`.

## Delivered observable behavior

1. `ApiAuthority` is a readonly discriminated union: `anonymous`, `user(token)`, `organizer(token)`, `desk(token,eventId)`, `scanner(token,eventId,pointId)`. It is descriptive request context, not proof of signature, family, membership or ownership.
2. `createApiClient(authority, options?)` reuses `createClient<paths>` and the existing generated schema. It does not acquire or decode credentials, inspect browser storage/location, infer roles, mutate stored sessions or retry. Explicit `null` means anonymous; omitted/undefined authority is rejected. Protected authorities with missing/blank tokens or missing resource context fail before transport.
3. The selected credential/context is copied on construction. Anonymous request middleware removes even a conflicting caller Authorization header; protected requests use only the supplied token. No stored alternate credential can be substituted.
4. Desk clients reject absent/different request `event_id`. Scanner clients reject absent/different `point_id` and any supplied conflicting `event_id` before transport.
5. `createDeskApiClient(authority,eventId,options?)` rejects a desk credential declared for eventA when asked for eventB. It permits Organizer operational mode only when an explicit Organizer authority was supplied, and still checks the selected request event.
6. `createScannerApiClient(authority,{eventId,pointId},options?)` rejects either mismatched scope. Scanner URLs carry only point identity, so the expected event is deliberately supplied to this adapter; no JWT claim is decoded to invent it. Explicit Organizer administrative mode remains point-bound. Server authorizers still verify the actual point→event relationship and permission.
7. Raw openapi-fetch results retain `response.status`. `unwrapApiResponse(result)` returns successful data (including undefined for an empty response) or throws `ApiResponseError` with exact `status`, original `body` and existing error formatting. Native transport failures remain native errors, not synthetic401s. `ApiContextError` distinguishes local no-dispatch context failures from server HTTP failures.

## Changed files and diff summary

Existing:

- `web/src/api/client.ts`: additive explicit authority/factory, event/point adapters and status error interface; original schema aliases, storage keys, `AuthScope`, `getApiClient` and `formatApiError` behavior preserved. A comment explicitly bounds legacy coexistence to T04–T08/T09.

New:

- `web/tests/apiClient.test.ts`: **13** behavior tests at the factory/adapter→transport→consumer seam, including real localhost HTTP status responses.
- `docs/architecture/portal-redesign/T03_IMPLEMENTATION_RESULT.md`: this implementation/evidence/migration report.

Generated schema: unchanged. No endpoint/request/response schema changed, so regeneration would be unrelated churn. No backend/model/migration/source, dependency manifest/lock, scanner engine/token store/queue/cache, page/layout/route or unrelated component was edited. Build outputs were generated normally by the assigned build, not source deliverables. The task consists of additive client code plus the focused test file and this report; no global caller cutover is hidden in it.

## API/status and credential-owner policy

No server endpoint, HTTP status, FastAPI detail envelope, JWT format or permission rule changed. Local context errors do not dispatch and are not HTTP403 responses. Real server401/403/404 remain distinguishable through either `result.response.status` or `ApiResponseError.status`.

The new pure transport **does not clear storage**. Its caller/session owner retains the exact supplied authority for response handling:

- On protected human401, invalidate only the precise credential used, and only if it is still the same selected session; do not clear a newer session because an old request returned late.
- On403/404, preserve the credential and display forbidden/missing-or-masked state. Preserve credentials on409/422/5xx/network failures too.
- Anonymous login401 is a login failure, not a reason to erase other stored credentials.
- Never automatically retry with another token or automatically replay ticket issuance after reauthentication.
- Scanner failures follow the existing durable device/queue/unpair policy, not human global-sign-out deletion.

Those session/UI policies are documented for dependent tasks, not falsely claimed implemented in unchanged pages under T03.

## Automated verification: exact commands and results

Working directory: repository `web/`. Used existing installed dependencies corresponding to the existing lockfile; no install or dependency modification was necessary.

Ran the final coherent gate once:

```text
npm test && npm run typecheck && npm run lint && npm run build
```

Raw complete output: **`artifact://744`**; total tool-reported wall time72.06s.

| Command | Exit evidence | Fresh result |
|---|---|---|
| `npm test` | 0, evidenced by subsequent `&&` command execution | **41 tests passed**, 0 failed/cancelled/skipped/todo, 2 suites, 518.0905ms; includes13 new authority tests and28 existing tests |
| `npm run typecheck` | 0, evidenced by subsequent `&&` command execution | `tsc -b` completed without TypeScript diagnostics |
| `npm run lint` | 0, evidenced by subsequent `&&` command execution | oxlint completed with **14 warnings in5 unchanged page files**, no task-owned warning or error |
| `npm run build` | Successful final output observed; numeric exit not surfaced by background completion notice | `tsc -b && vite build`: **60 modules**, build2.11s; PWA generateSW completed,12 precache entries794.11KiB, `dist/sw.js` and workbox emitted |

Lint warnings: GateScanner9 (immutability1, purity1, set-state-in-effect3, exhaustive-deps4); MyNetwork2; MyTickets1; ExhibitorPortal1; OrganizerDesk1. These source files are unchanged. Build warns about a minified chunk above500kB: main JS737.66kB, gzip209.18kB. Warnings were not suppressed and no unrelated page/code-splitting changes were made.

The tool moved the gate to `bg_1`, then automatically delivered the full completed output but omitted a numeric exit. Its documented `proc://bg_1` URI was already unavailable after completion. This tool-output metadata limitation was reported via `xd://report_issue`; no successful gate was rerun simply to manufacture another status. Test/typecheck/lint zeros are observable from `&&` continuation; the final build is reported by its actually completed Vite/PWA output rather than an invented numeric field.

Finalization addendum: after the original background-output limitation, the integration owner explicitly reran `npm.cmd run build` in the development checkout's `web` directory through a bounded subprocess. The numeric return code was **0**, Vite completed60 modules and PWA generation, with the same >500kB chunk warning. Thus the final build's exit0 is now directly evidenced; the earlier metadata limitation and its original account above remain historical.

### Task-specific automated cases

- Five authorities, each through three pathname values, capture actual openapi-fetch-created `Request` headers. Supplied credentials differ from all stored alternatives. Storage acquisition/mutation methods throw if touched. Anonymous removes a conflicting Authorization header; selected User/Organizer/Desk/scanner values are exact and storage remains unchanged.
- Explicit null login sends no Authorization; undefined and incomplete protected contexts cause no extra request.
- DeskA→adapterB and request eventB are refused; an unscoped request is refused; eventA dispatches exactly its credential.
- Scanner wrong event, wrong point and absent request point are refused; selected point dispatches exactly its credential.
- Deliberately chosen Organizer desk/scanner operational clients are explicitly credentialed and resource-bound, not fallbacks.
- Three actual localhost HTTP server tests send a desk request using normal fetch and return401,403,404. The consumer sees the exact status/body/message; the server receives exactly **one** request under the selected credential, and all stored alternatives remain unchanged.
- Successful consumer data unwraps correctly; a native network error propagates unchanged with one attempt.

No mocked helper merely echoes its input. Header tests observe the transport Request, and status tests cross a real HTTP server. Synthetic HTTP responses are contract fixtures, not real backend permission proof.

## Mandatory real-browser verification

**Performed**, not replaced by an HTTP-only fallback. `agent-browser skills get core` was attempted after reading its skill; the CLI was unavailable (`command not found`, exit127). Read `xd://eval/browser` and used its managed real Chromium browser instead.

A task-owned Vite HTTP fixture was created **outside the repository** in a unique OS temporary directory and served on127.0.0.1:5197. It imported the actual shipping `client.ts` module and existing `scannerTokenStore.ts`. No fetch mock, browser route interception, shipping fixture, alternate client implementation or real backend/database was used. HTTP response bodies/statuses were intentionally synthetic, while browser requests and server transport were real.

Before requests, the fresh fixture origin contained simultaneously:

- User token in the actual `congress_attendee_token` localStorage key;
- Organizer key in actual `congress_organizer_api_key` sessionStorage;
- DeskA and DeskB tokens in actual event-specific sessionStorage keys;
- scanner credential in the actual `congress_scanner_tokens` IndexedDB store, persisted through the existing storage module.

All fixture credentials were synthetic and distinct from the explicit request values. No real credentials were read, logged or used.

Invoked the visible fixture button at `/organizer/events/event-b/desk`, then changed history pathname to `/e/fixture` and invoked the same fixture again. Each round dispatched nine requests: five authorities, explicit-null anonymous login, and three selected-desk401/403/404 responses. Captured the browser **Network requestHeaders** and compared Authorization exactly to the supplied value, privately; saved only sanitized presence/equality results. Both rounds had:

- Anonymous read and login: Authorization absent, including removal of an attempted caller override.
- User/Organizer/Desk/scanner: only exact supplied authority, identical after pathname change.
- Error responses: exact401/403/404, no fallback or retry; one request per response.
- Five local negative-context cases refused before dispatch (desk wrong adapter event/request event, scanner wrong event/request point, missing User credential).
- All stored credential records unchanged after successful and failed requests.

Evidence: **18 transport requests**, **10 no-dispatch refusals**, all Network equality checks true, zero captured page errors. Sanitized structured record: **`local://p03-t03-browser-evidence.json`**. A full-page screenshot was captured and displayed in the verification transcript; its task-owned temporary image was removed after capture.

Cleanup: first IndexedDB deletion was blocked by the existing storage module's open connections and the evaluate call timed out. Navigated the task-owned tab away from the fixture to release those connections, then successfully deleted that origin's fixture IndexedDB and cleared local/sessionStorage. Closed only the task-owned tab, stopped only `p03-t03-authority-fixture`, and removed only its unique external temporary directory and screenshot. No unrelated service, browser tab, repository file or data was removed. No fixture/scaffold remains in shipping code.

Viewport was1100×800 solely for inspecting this non-shipping fixture; responsive/RTL/accessibility/Back/full-portal journeys were not represented as tested product behavior.

## Regression and security scope

- **R20:** new explicit transport credential isolation, no null fallback, no automatic retry, no persistence mutation and real-browser pathname independence exercised.
- **R16:** client-side desk event/scanner point/event no-dispatch guards exercised; actual backend tenant404 and membership403 contracts were not rerun and remain server-owned.
- **R13/R14/R15/R17 frontend portions:** existing scanner auth/engine/reliability tests all ran in the41-test suite. No new engine, queue, token format or admission policy work.
- **R04:** all existing owner-cache tests ran. Cache implementation and session acquisition are unchanged.
- **R01/R11:** anonymous login transport and desk event selection exercised, not registration/issuance backend behavior.
- Printed URLs, EntityQR, routes and scanner persistence/queue code unchanged. This is source containment, not fresh printed-QR, camera/HID, offline restart, device-revocation or browser-product compatibility proof.
- The factory/adapters prevent accidental credential/context dispatch. They are not a substitute for server signature/type/row/tenant authorizers; frontend JavaScript can always issue arbitrary requests outside this interface.

## Migration interface: T04–T09

Keep credential acquisition and persistence in existing owners. Import new factories from `web/src/api/client.ts`; no new provider or library is required.

```ts
const publicClient = createApiClient({ kind: "anonymous" }); // null is also explicitly anonymous
const userClient = createApiClient({ kind: "user", token: userToken });
const organizerClient = createApiClient({ kind: "organizer", token: organizerKey });
const deskClient = createDeskApiClient(
  { kind: "desk", token: deskToken, eventId: credentialEventId },
  selectedEventId,
);
const scannerClient = createScannerApiClient(
  { kind: "scanner", token: deviceToken, eventId: credentialEventId, pointId: credentialPointId },
  { eventId: selectedEventId, pointId: selectedPointId },
);
```

- **T04:** use anonymous for public event/Booth reads, register/login and event desk login. Do not mistake legacy `getApiClient(null)` for anonymous. Personalized bookmark operations use a separate User client.
- **T05:** supply only the explicitly acquired Organizer key for tenant management.
- **T06:** supply only User authority for attendee/network/bookmark/existing exact-Booth operations; preserve owner cache and legacy typeless User JWTs.
- **T07:** pass independently known credential event and selected event to the desk adapter. Deliberate Organizer operational mode passes `{kind:"organizer",token:organizerKey}` to that same event-bound adapter; never `organizerKey || deskToken`. Implement credential-specific401 handling and stale-response protection in the caller owner, retaining403/404 and preventing issuance replay.
- **T08:** pass the existing scanner credential and independently known point/event context. Explicit Organizer administrative mode is supported by the scanner adapter, without token/queue/cache-format changes. Keep scanner secrets outside human AuthContext and preserve durable failure/unpair handling.
- **T09:** once every T04–T08 caller is migrated and independently verified, remove `getApiClient`, `AuthScope` and their storage/pathname heuristic together. Do not retain a deprecated fallback alias. Existing key constants may remain with credential owners as required; acquisition stays outside the new factory.

Calls keep existing generated GET/POST/PATCH/DELETE endpoint/body/response typing. Consumers can retain raw `response` for custom UX or use `unwrapApiResponse`; they must retain the exact selected authority in their owning request flow, not decode claims or read another credential to recover from an error. Base URL/custom transport options are explicit infrastructure inputs, not credential-selection inputs.

## Not run, containment and rollback

- Backend pytest/mypy, Alembic/database checks and native checks: not run; no backend/data/native changes were authorized or needed.
- Canonical `scripts/check.sh` / `scripts/check.bat`: **NOT RUN**, not counted passing. The inspected full-stack script would execute backend tests that mutate a database and native checks outside this assignment. The expressly required frontend test/typecheck/lint/build gate was completed instead. This frontend-only task does not erase the separate full-stack release gate.
- Full product browser E2E, responsive seven-width EN/FA, accessibility, actual backend browser authorization and scanner device/camera/offline/printed-URL checks: not run, not implied by the real transport fixture.
- Before dependent caller migration, rollback can remove the unused additive boundary/tests coherently. After callers land, roll back only a reviewed coherent caller+factory artifact; never reinstate credential leakage or weaker-authority fallback as accepted recovery. No schema/data rollback is involved.
- Residual risk: current callers still use the original heuristic until T04–T08; production leakage is not claimed fixed across the application by an unused new interface. T09 and later security/browser release gates remain necessary.

## Definition of done and Git operations

- [x] All five explicit authorities have captured transport and real-browser Network evidence.
- [x] Anonymous and explicit-null requests send no Authorization despite stored alternatives.
- [x] New factory has no browser storage/location/claims acquisition; missing credentials/context refuse dispatch.
- [x] Desk cross-event and scanner scope mismatch refuse transport.
- [x] Consumer-visible401/403/404 status/body remain exact; no fallback/retry/storage mutation.
- [x] Existing schema and staged legacy compatibility preserved; every existing caller intentionally unchanged under T03.
- [x] Full assigned frontend suite/typecheck/lint/build executed; warnings and final-build exit-metadata limitation recorded.
- [x] Mandatory browser fixture performed and task-owned temporary artifacts cleaned.
- [x] Migration interface, security containment, actual checks and limitations documented.

Git operations actually performed: initial read-only branch/HEAD/status/unstaged/index inventory. No commits, staging, reset/clean/stash/rebase/merge/worktree mutation, push or deployment. No further routine Git validation was performed after edits.

**STOP: P03-T03 concluded. No P03-T04 or subsequent task started.**
