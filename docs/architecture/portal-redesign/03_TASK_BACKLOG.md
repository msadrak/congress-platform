# Phase 03 — Atomic implementation backlog

**PLANNING ONLY.** This document contains 67 stable tasks, P03-T00 through P03-T66: 63 unconditional baseline/product/quality/scope tasks and four approval-blocked enhancements/decision gates (T56–T59). It authorizes no implementation now. T00 is a future user-approved Git prerequisite, never an action performed in Phase03. T59 and T66 are decision/evidence tasks, not permission to implement unknown content/native scope.

Read [reconciliation](03_ARCHITECTURE_RECONCILIATION.md), [roadmap/DAG](03_IMPLEMENTATION_ROADMAP.md), [exact API/data contracts](03_API_AND_DATA_MIGRATION.md), [regression/UI/release plan](03_TEST_AND_RELEASE_PLAN.md), and [execution protocol](03_AGENT_EXECUTION_PROTOCOL.md). Their fixed model, field, status, route and authority contracts are normative for every task below; references to “unchanged” mean preserve the source-confirmed matrix, not agent-designed behavior. No conflicting interpretation is permitted: report it BLOCKED. Proposed new modules are responsibilities, not invented exact paths. All commands/tests below are future instructions, not current results.

Every task's complete template is mandatory. Shared frontend states and quality gates apply in addition to task-specific states. Tasks changing no backend API explicitly reuse existing contracts; no such task may invent an endpoint. All migrations share one serialized chain owner. Shared router/client/schema/i18n/model edits integrate under one owner; independent feature files may proceed concurrently only after prerequisites. All UI/API changes must update relevant docs/generated schema and retain regression evidence. The full67 tasks have been reviewed for scope, dependencies, data safety and negative behavior; optional business decisions remain explicit blockers.

**Non-negotiable rollback boundary for every task:** retain explicit credential isolation, token-generation/current-membership checks, additive data, QR identities and pending scanner records. “Revert UI/calls” never authorizes restoring heuristic fallback, reviving revoked credentials, dropping new data, or deleting queues. If an older UI cannot consume the hardened contracts, contain/disable that operation until a coherent compatible version is restored.

## Task definitions — P03-T00 through P03-T36

Planning only. Nothing below authorizes implementation, commits, migrations, installation, tests, deployment, or changes to Phase 00–02. Existing-file references are source-confirmed by the supplied evidence reports and targeted source reads. Proposed modules describe responsibilities, not supposedly existing filenames. All tests and manual checks below are instructions for future execution; none was run for this report. Historical 131/28/8 pass claims are not current evidence.

The implementation owner must run each task's focused checks and the current canonical root check (`scripts\check.bat` on Windows or `bash scripts/check.sh` on POSIX) in an authorized, configured environment, recording command, SHA, environment, result, and failures. Database-backed tests require the configured PostgreSQL test database. Canonical checks do not replace browser, migration, OpenAPI drift, or device checks named below.

Fixed regression identifiers: R01 registration; R02 tier quota; R03 digital QR; R04 offline ticket access; R05 networking; R06 vCard; R07 Booth profile/brochures; R08 lead capture; R09 qualification/export; R10 organizer event management; R11 desk issuance; R12 desk revocation; R13 scanner PWA; R14 scan synchronization; R15 admission policies; R16 tenant isolation; R17 device revocation; R18 printed QR URLs; R19 localization/RTL; R20 credential isolation.

## P03-T00
### TASK ID
P03-T00
### TITLE
Authorize and establish the reviewed local integration baseline
### PRODUCT OUTCOME
A reviewed local SHA reproduces the intended current desk feature, migration 0011, generated contract, and approved documentation without losing the user's work or recording secrets.
### BASELINE
Current source contains desk operators/attribution and uncommitted architecture work. Historical audit counts and prior check results do not prove the present manifest or clean-checkout behavior.
### PREREQUISITES
Separate explicit human approval of the exact local commit manifest; planning approval alone is insufficient.
### IN SCOPE
Read-only inventory; file-by-file review; secret exclusion; approved path-specific local commits; separate clean-checkout migration and check evidence.
### OUT OF SCOPE
Broad staging, `git add .`, `git add -A`, push, deploy, reset, clean, stash, branch deletion, force operations, dependency upgrades, and unrelated edits. No Git mutation during Phase03 planning.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, `backend/app/security.py`, `backend/app/routes/desk.py`, `backend/migrations/versions/0011_desk_operators_and_attribution.py`, `backend/tests/test_desk_operator_auth.py`, `backend/tests/test_management_lifecycle.py`, `web/src/api/schema.d.ts`, current organizer pages, `scripts/check.bat`, `scripts/check.sh`, existing architecture documents. The actual approved manifest comes from current inventory, not this illustrative list. Proposed: reviewed baseline evidence record in the authorized documentation package.
### BACKEND CONTRACT
No API change. Reproduce current auth/events/desk/tickets/scanner contracts from the approved SHA. Apply committed migrations through actual head in the isolated checkout; never alter 0011 numbering.
### FRONTEND CONTRACT
All current 11 routes remain functional: `/`, `/organizer`, `/organizer/events/:eventId`, `/organizer/events/:eventId/desk`, `/organizer/events/:eventId/analytics`, `/e/:slug`, `/e/:slug/booths/:boothId`, `/booth/:boothId`, `/my-tickets`, `/my-network`, `/scan/:pointId`. No shell/route redesign here.
### DATA MODEL IMPACT
None invented. Establish reproducibility of the existing linear 0001–0011 chain and desk attribution schema.
### IMPLEMENTATION STEPS
1. Run exactly these read-only checks at repository root: `git status --short --branch`, `git branch --show-current`, `git rev-parse HEAD`, `git diff --name-status`, `git diff --stat`, `git diff --cached --name-status`, `git ls-files --others --exclude-standard`, and `git log -5 --oneline`.
2. Review tracked changes with `git diff -- <each approved path>` and any pre-existing staged changes with `git diff --cached -- <each staged path>`. Read every untracked candidate using repository read tools; exclude `.env`, credentials, tokens, database dumps, private exports, and temporary logs containing secrets. Do not assume untracked documentation is automatically approved.
3. Present the exact file/commit manifest for human approval. If existing staged files fall outside it, stop without changing the index.
4. Only after approval, stage explicitly named approved paths (`git add -- <named paths>`), review the exact staged diff, and make only the approved local commits. Do not push or clean the original checkout.
5. Obtain a separate isolated checkout of the approved SHA without modifying the original worktree. Configure required environment variables privately, apply `alembic upgrade head` from `backend`, run task-specific baseline suites and the canonical root check, and record real results. Do not use fixtures that merely create ORM tables as migration proof.
### ACCEPTANCE CRITERIA
- Given the user's mixed worktree, when the manifest is reviewed, then every changed/untracked candidate has an explicit include/exclude decision and no work is discarded.
- Given approval, when local commits are made, then their staged content matches the approved manifest and excludes secrets/unrelated files.
- Given a separate checkout at the resulting SHA, when committed migrations and checks run, then desk login/issuance/revocation and all recorded baseline contracts reproduce without borrowing uncommitted files.
### AUTOMATED TESTS
Future: current backend desk/auth/management suites, generated OpenAPI comparison, existing web/cache/scanner suites, and canonical check from the isolated SHA. Record collected/pass/fail/skip counts rather than copying historical counts.
### MANUAL VERIFICATION
Compare each approved file against the staged diff; confirm no raw credential in the commit; open each of the 11 listed routes with its required credential; issue a desk ticket, revoke the operator, and verify the next protected request fails. Record clean-checkout SHA and migration head.
### SECURITY CHECKS
Secret review is mandatory before staging; logs redact keys/JWTs/passwords. Preserve tenant masks and existing server authorization. Human approval does not authorize remote publication.
### REGRESSION GUARDS
R01–R20; especially R11, R12, R16, R18, R20.
### ROLLBACK
Preserve original checkout and approved recovery evidence. Stop on reproduction failure; correct only approved content in a new reviewed local commit. No reset/clean/downgrade or destructive restoration of the user's work.
### DELIVERABLES
Approved manifest, local SHA(s), secret-review record, isolated-checkout migration/check evidence, and accurately labeled blockers.
### DEFINITION OF DONE
Human approval and exact local commit review are recorded; the independent checkout reproduces the intended baseline with current evidence.
### STOP CONDITION
Missing approval, unexpected staged content, secret inclusion, omitted 0011/source artifacts, or failed clean-checkout reproduction blocks every dependent task.

## P03-T01
### TASK ID
P03-T01
### TITLE
Stabilize human token family and authorization status contracts
### PRODUCT OUTCOME
User endpoints explicitly reject non-User token families while existing typeless User sessions keep working; clients can distinguish authentication failure from denial and tenant masking.
### BASELINE
`current_user` validates a UUID subject but not token type. Issued desk/scanner tokens already fail because their subjects are non-UUID; this task is defense in depth, not remediation of a demonstrated issued-token escalation.
### PREREQUISITES
P03-T00.
### IN SCOPE
Explicit User type validation; exact negative tests; protected Bearer 401 challenge consistency; preservation of established 403/404 distinctions.
### OUT OF SCOPE
Unified sessions, organizer-to-User association, refresh tokens, password recovery, scanner claims redesign, or role inference from JWT/UI.
### EXPECTED FILES
Confirmed: `backend/app/routes/auth.py`, `backend/app/auth.py`, `backend/app/routes/desk.py`, `backend/app/routes/checkin.py`, `backend/app/security.py`, existing auth/desk/scanner security tests. Proposed: focused token-family/status test cases in existing suites.
### BACKEND CONTRACT
Reuse `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` and all `CurrentUserDep` consumers. User auth accepts absent `type` or `type=user`; other types return 401 even with an existing UUID subject. Invalid/expired/revoked protected Bearer credentials return 401 with `WWW-Authenticate: Bearer`. Existing desk token wrong-event returns 403; revoked desk login/nonmember login returns 403; foreign organizer resources return 404. Missing resources retain established lookup ordering. Platform `X-Admin-Token` remains separate, not converted to Bearer.
### FRONTEND CONTRACT
No route/UI implementation. Publish status semantics consumed by P03-T03–P03-T09: 401 affects only the credential sent; 403/404 preserve credentials; no alternate-credential retry.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Add the explicit type guard before User lookup while retaining legacy typeless JWTs.
2. Normalize protected Bearer challenge headers without changing public login or custom platform auth semantics.
3. Replace ambiguous status assertions with exact endpoint-specific expectations.
4. Record the defense-in-depth limitation and status contract in implementation documentation.
### ACCEPTANCE CRITERIA
- Given a typeless legacy User token, when `/api/auth/me` is requested, then the original User response succeeds.
- Given a signed `desk_operator` or scanner token with a User UUID subject, when any User dependency is invoked, then it returns 401 before User data is exposed.
- Given revoked desk login, wrong-event desk access, and foreign organizer access, when requested, then results are respectively 403, 403, and 404 rather than a generic error.
### AUTOMATED TESTS
Extend auth and token-family negatives across ticket/network/Booth routes; assert invalid signature, expiry, missing/deleted User and Bearer headers; retain existing scanner/desk matrices and canonical checks.
### MANUAL VERIFICATION
Use isolated fixtures: call `/api/auth/me` with legacy User, actual desk, actual scanner, and organizer credentials; capture status/header without logging credential bodies. Repeat foreign organizer event and wrong-event desk request.
### SECURITY CHECKS
Server dependencies remain authoritative; never authorize from decoded claims alone; no organizer identity inferred from User.
### REGRESSION GUARDS
R01, R11, R12, R16, R17, R20.
### ROLLBACK
Revert the application guard/header change as one reviewed commit if compatibility fails; no data/schema changes to undo.
### DELIVERABLES
Type guard, exact-status regression tests, updated auth contract evidence.
### DEFINITION OF DONE
Legacy User success and every named negative/status branch have exercised evidence.
### STOP CONDITION
Legacy User rejection, broadened authorization, changed tenant mask, or ambiguous revoked-token status blocks completion.

## P03-T02
### TASK ID
P03-T02
### TITLE
Prevent desk-session resurrection with generations
### PRODUCT OUTCOME
Revoking and reactivating a desk operator never makes an old token usable again.
### BASELINE
Revocation toggles `is_revoked`; reactivation reuses the operator ID. Desk JWTs contain no generation and old unexpired tokens can revive.
### PREREQUISITES
P03-T01.
### IN SCOPE
Additive generation column, issuance claim, per-request comparison, revoke/reactivate increments, versionless compatibility.
### OUT OF SCOPE
Password lifecycle redesign, scanner queue/token changes, token refresh, operator provisioning policy changes.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, `backend/app/security.py`, `backend/app/routes/desk.py`, `backend/migrations/versions/0011_desk_operators_and_attribution.py`, desk operator tests. Proposed: next available additive Alembic revision after actual head, populated-generation migration tests.
### BACKEND CONTRACT
Existing `/api/events/{event_id}/desk/login` issues tokens containing the row `session_version`. Every `AuthorizedDeskDep` request compares it to the current operator row. Missing version is accepted only at row version 0. Revocation and reactivation each increment the version transactionally. Invalid/expired/revoked/generation-mismatched existing tokens return 401; revoked login and wrong-event token remain 403. Organizer operational authority remains independently validated.
### FRONTEND CONTRACT
No shell change. Existing event-specific desk session storage remains compatible; a generation mismatch follows the credential-specific 401 flow delivered in P03-T07.
### DATA MODEL IMPACT
`DeskOperator.session_version`: non-null integer default 0; existing rows backfill 0. First of three serialized expansions: desk generation, Partner, AttendeeType. Do not invent a numeric revision or renumber 0011.
### IMPLEMENTATION STEPS
1. Inspect current migration head and create one linear additive revision.
2. Add model/default and issue/validate the claim.
3. Increment generation atomically on revoke and on reactivation, including existing revoke alias.
4. Add populated compatibility and lifecycle tests; document retaining expansion during application rollback.
### ACCEPTANCE CRITERIA
- Given versionless token A and version-0 active row, when used before revocation, then it remains valid until normal expiry.
- Given token A, when its row is revoked then reactivated, then A returns exactly 401 for me, tiers, lookup, detail, and issuance; newly logged-in token B succeeds.
- Given versionless A after generation increment, when used, then it cannot regain access.
### AUTOMATED TESTS
Populated upgrade from existing head; version-0 compatibility; revoke/reactivate sequence; malformed/mismatched generation; concurrent lifecycle safety; exact 401/403 tests and current desk suites/canonical checks.
### MANUAL VERIFICATION
Login, retain token A privately, revoke, reactivate, request desk/me using A, verify 401, then login again and verify token B operates only its event.
### SECURITY CHECKS
Generation is checked against DB on every request; frontend cache/claim decode cannot override revocation. Never expose tokens in evidence.
### REGRESSION GUARDS
R11, R12, R16, R20; preserve R13, R14, R17 untouched.
### ROLLBACK
Keep column and monotonic values. Do not roll back to code that ignores generations after revocation writes; use a generation-aware previous artifact or forward fix. Never reset generations/drop the column to restore sessions.
### DELIVERABLES
Expansion revision, hardened issuer/authorizer/lifecycle, populated and HTTP evidence.
### DEFINITION OF DONE
Old tokens stay invalid after reactivation and legacy version-0 compatibility is proved.
### STOP CONDITION
Competing migration head, version reset, legacy acceptance after increment, or any resurrection blocks completion.

## P03-T03
### TASK ID
P03-T03
### TITLE
Introduce the pure explicit-authority API boundary
### PRODUCT OUTCOME
Each request has a deliberate authority; anonymous calls cannot accidentally transmit a stored credential.
### BASELINE
`web/src/api/client.ts` reads storage/pathname when token is falsy, including null. All current callers omit its scope argument.
### PREREQUISITES
P03-T01.
### IN SCOPE
Pure authority union/factory; typed request context and status-preserving error representation; adapters accepting explicit credentials.
### OUT OF SCOPE
Full shell/AuthContext delivery, new state library, server authorization rewrite, immediate simultaneous callsite migration.
### EXPECTED FILES
Confirmed: `web/src/api/client.ts`, `web/src/api/schema.d.ts`, current API consumers and web tests. Proposed: explicit-authority types/adapters and client contract tests following existing test conventions.
### BACKEND CONTRACT
No endpoint change. Reuse existing public, User, organizer, desk(event), scanner(point,event) contracts; a portal name is not authorization.
### FRONTEND CONTRACT
No new route. Factory accepts discriminated anonymous/User/organizer/desk/scanner authority with supplied token/resource context; anonymous produces no Authorization header. Factory never reads storage, pathname, or decoded role claims. Preserve storage keys in caller/session ownership. Errors expose HTTP status. Clients can coexist during P03-T04–P03-T08, but final heuristic removal is required by P03-T09.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Define the minimal union and pure factory using current openapi-fetch/generated types.
2. Keep storage acquisition outside the factory and resource identity explicit.
3. Preserve response status and document credential-specific handling.
4. Add tests for every authority and stage old-helper removal at P03-T09.
### ACCEPTANCE CRITERIA
- Given every credential stored simultaneously, when anonymous client sends a request, then captured transport headers contain no Authorization.
- Given desk authority for event A, when its adapter is asked for event B, then it refuses to dispatch rather than substituting another credential.
- Given 401/403/404, when errors propagate, then callers can distinguish the exact status.
### AUTOMATED TESTS
Transport-header assertions; storage/pathname-independent factory tests; missing context/no-dispatch; status retention and no retry; current web type/build/check gates.
### MANUAL VERIFICATION
In a browser with organizer/User/desk/scanner sessions present, invoke adapter fixtures and inspect Network headers; change pathname and confirm identical supplied-authority behavior.
### SECURITY CHECKS
Do not log tokens; no implicit fallback; client context remains descriptive and server authorizers remain mandatory.
### REGRESSION GUARDS
R16, R20; R01, R11, R13 for compatibility.
### ROLLBACK
Revert unused new boundary before cutover; after dependent callers land roll back a coherent reviewed caller/factory artifact, never reinstate credential leakage as an accepted fallback.
### DELIVERABLES
Pure factory/union, status contract, header-based tests, migration interface documentation.

### DEFINITION OF DONE
All five authorities have transport evidence and no factory storage/pathname access exists.
### STOP CONDITION
Any null-to-storage fallback, hidden role inference, or loss of HTTP status blocks completion.

## P03-T04
### TASK ID
P03-T04
### TITLE
Cut public and credential-entry requests over to anonymous transport
### PRODUCT OUTCOME
Visitors can read/register/login without exposing unrelated stored secrets; protected bookmarking stays separate.
### BASELINE
PublicEvent/PublicBooth and desk login can attach stored credentials through `getApiClient(null)`.
### PREREQUISITES
P03-T03.
### IN SCOPE
Public event/Booth reads and User/desk login/register requests; separate protected bookmark requests.
### OUT OF SCOPE
Public layout redesign, Partner listing, reservation behavior changes, broad protected User migration.
### EXPECTED FILES
Confirmed: `web/src/pages/PublicEvent.tsx`, `PublicBooth.tsx`, `OrganizerDesk.tsx`, `web/src/api/client.ts`, `backend/app/routes/public.py`. Proposed: focused public transport/browser tests.
### BACKEND CONTRACT
Reuse anonymous `GET /api/public/events/{slug}`, `GET /api/public/events/{slug}/booths/{booth_id}`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/events/{event_id}/desk/login`. Bodies/results/statuses stay unchanged. Bookmark POST/DELETE/list use User Bearer on `/api/attendees/me/bookmarks/booths...`; public payload must not require optional Authorization for saved-state personalization.
### FRONTEND CONTRACT
Existing `/e/:slug`, `/e/:slug/booths/:boothId`, and desk entry remain direct routes. Public reads/login use anonymous authority; bookmark state comes from protected bookmark data when a User session exists. Loading/empty/missing/public error states remain visible; login 401 stays form error and does not clear unrelated credentials; successful register/login stores only the resulting correct credential.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Replace public/auth client calls with anonymous authority.
2. Separate bookmark personalization from public read transport.
3. Preserve existing request schemas and success navigation.
4. Add real request-header assertions with all credentials stored.
### ACCEPTANCE CRITERIA
- Given stored organizer/User/desk credentials, when public read or login/register runs, then no Authorization is transmitted.
- Given a signed-in User bookmarks a Booth, when the action succeeds, then only the User JWT is sent and saved state updates.
- Given invalid login, when rejected, then the form displays 401 and other sessions remain intact.
### AUTOMATED TESTS
Public/header tests, registration/login and bookmark API integration, unauthorized bookmark action, public 404, canonical checks.
### MANUAL VERIFICATION
Open both public URLs, register/login, toggle a Booth bookmark, and attempt desk login with all credential keys populated; inspect each Network request and verify only bookmark requests are protected.
### SECURITY CHECKS
No optional public credential forwarding; protect bookmark mutations; do not print login bodies/secrets.
### REGRESSION GUARDS
R01, R07, R18, R20.
### ROLLBACK
Restore the previous page presentation using the explicit anonymous/protected adapters; preserve accounts/bookmarks and routes, not heuristic transport.
### DELIVERABLES
Anonymous callsite cutover and transport/browser evidence.
### DEFINITION OF DONE
Every named public/entry request has no-header proof and bookmark behavior still works.
### STOP CONDITION
Any public/auth Authorization header or unauthenticated bookmark mutation blocks completion.

## P03-T05
### TASK ID
P03-T05
### TITLE
Bind organizer requests exclusively to tenant authority
### PRODUCT OUTCOME
Organizer operations never borrow User/desk credentials or damage those sessions on failure.
### BASELINE
Organizer pages read a tenant key but use the heuristic shared helper. Organizer is a tenant credential, not User identity.
### PREREQUISITES
P03-T03.
### IN SCOPE
Organizer event/config/analytics requests and deliberate organizer scanner administration requests.
### OUT OF SCOPE
Organizer/User identity convergence, reception automatic organizer mode, new scanner-device UI, shell extraction.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerLayout.tsx`, `OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `OrganizerAnalytics.tsx`, `web/src/api/client.ts`. Proposed: organizer transport/status tests.
### BACKEND CONTRACT
Reuse organizer Bearer `GET/POST /api/events`, `GET/PATCH /api/events/{event_id}`, event tier/point/Booth/operator and analytics routes. Requests retain current schemas; invalid key 401, foreign event/nested resource 404, validation 422 and existing conflict responses. User JWT does not represent organizer membership.
### FRONTEND CONTRACT
Existing organizer URLs retain key gate. Obtain key from `congress_organizer_api_key` through session ownership, pass explicit organizer authority, block dispatch if absent. Loading/empty/error states retain tenant context. 401 clears only the sent organizer key; 403/404/network/5xx preserve it. Successful mutations refetch affected organizer data only.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Inventory every organizer callsite, including exports.
2. Migrate to explicit organizer adapter with absent-key no-dispatch.
3. Replace generic failure handling with status-specific key ownership.
4. Add mixed-storage header and foreign-tenant tests.
### ACCEPTANCE CRITERIA
- Given User and desk tokens but no organizer key, when organizer entry opens, then key gate appears and protected requests are not sent.
- Given valid organizer key and all other tokens, when config/export runs, then only the key is transmitted.
- Given foreign event 404, when rendered, then no foreign data appears and User/desk sessions remain unchanged.
### AUTOMATED TESTS
Organizer header/no-dispatch/401 preservation tests; existing event/tier/point/Booth/operator/analytics suites and canonical check.
### MANUAL VERIFICATION
Visit event list/detail/analytics, create then update a fixture event, export analytics; inspect headers. Replace key with invalid value and confirm only organizer session is cleared; use another tenant's event ID and confirm 404.
### SECURITY CHECKS
Keep `OwnedEventDep` masks; no credential substitution; never expose raw key in evidence.
### REGRESSION GUARDS
R10, R16, R20; R02, R11, R15.
### ROLLBACK
Revert page cutover coherently while retaining explicit organizer selection and current data; no key rotation/deletion required.
### DELIVERABLES
Organizer callsite cutover, status handling, inventory and transport evidence.
### DEFINITION OF DONE
All organizer requests, including CSV, use only explicit tenant authority.
### STOP CONDITION
User-derived organizer access, fallback, or foreign tenant exposure blocks completion.

## P03-T06
### TASK ID
P03-T06
### TITLE
Bind attendee and existing Booth requests to User authority
### PRODUCT OUTCOME
Tickets, networking, bookmarks and existing Booth workspace use only the authenticated global User session.
### BASELINE
MyTickets, MyNetwork and ExhibitorPortal read the attendee token; null can still invoke helper fallback.
### PREREQUISITES
P03-T03.
### IN SCOPE
Current protected User callsites, including self-reservation and Booth lead/export requests.
### OUT OF SCOPE
New Partner model/UI, five-tab shell, category integration, global profile editing.
### EXPECTED FILES
Confirmed: `web/src/pages/MyTickets.tsx`, `MyNetwork.tsx`, `ExhibitorPortal.tsx`, `PublicEvent.tsx`, `PublicBooth.tsx`, `web/src/layouts/AttendeeLayout.tsx`, `web/src/api/client.ts`, `ticketCache.ts`. Proposed: User transport/status tests.
### BACKEND CONTRACT
Reuse User Bearer `/api/auth/me`, `/api/attendees/me/tickets`, `POST /api/events/{event_id}/tickets/reserve`, network/bookmark families, `/api/booths/me`, `/api/booths/{booth_id}` and leads scan/list/PATCH/export. Requests retain schemas; 401 invalid User; existing known nonstaff Booth 403; missing/owned-nested resources 404. Reserve duplicate 409/closed 400/sold out 410 remain distinct.
### FRONTEND CONTRACT
Existing attendee/Booth/public reservation URLs remain unchanged. Absent User blocks protected dispatch and offers User login; no organizer/desk substitution. 401 clears only sent User credential and renders re-login while preserving owner cache according to existing TTL/logout distinction; explicit logout clears owner cache. 403/404 preserve User session and show denial/missing. Loading/empty/mutation success remain feature-specific.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Migrate all User-owned callsites and downloads.
2. Keep public reads anonymous and reserve/bookmarks protected.
3. Apply status handling without broad cache deletion.
4. Add mixed-storage/permission regressions.
### ACCEPTANCE CRITERIA
- Given organizer/desk sessions but no User JWT, when opening ticket/network/Booth actions, then no protected call borrows them.
- Given a User without BoothStaff, when requesting Booth leads, then 403 is shown without logging the User out.
- Given ticket-list 401, when cache is still valid, then presentation remains labeled non-authoritative and unrelated sessions survive.
### AUTOMATED TESTS
Header/no-fallback, reserve statuses, own-ticket/bookmark isolation, Booth403 and User401 lifecycle, existing cache/network/lead tests plus canonical check.
### MANUAL VERIFICATION
Reserve ticket, view QR, scan peer, save note, download vCard, bookmark Booth, capture/qualify/export lead with the correct memberships; inspect headers and test unauthorized Booth.
### SECURITY CHECKS
Exact BoothStaff remains lead authority; no User identity selected from client parameters; cache is not admission proof.
### REGRESSION GUARDS
R01–R09, R16, R20.
### ROLLBACK
Restore previous feature presentation with explicit User transport; preserve tickets, connections, leads and owner caches within existing TTL.
### DELIVERABLES
Complete existing User callsite cutover and functional/header evidence.
### DEFINITION OF DONE
Every current protected User request and export has explicit-authority evidence.
### STOP CONDITION
Cross-family fallback, removed owner isolation, or broken lead/ticket operations blocks completion.

## P03-T07
### TASK ID
P03-T07
### TITLE
Select reception credentials explicitly per event and status
### PRODUCT OUTCOME
Operator mode and deliberate organizer operational mode are distinct; failure never silently changes authority.
### BASELINE
OrganizerDesk uses `apiKey || deskToken` and may clear a desk token for unrelated errors.
### PREREQUISITES
P03-T02, P03-T03.
### IN SCOPE
Current desk request transport, explicit selected mode, event-keyed session lifecycle, exact error handling.
### OUT OF SCOPE
Independent ReceptionShell, complete draft/re-auth UX, duplicate recovery, password redesign.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerDesk.tsx`, `OrganizerLayout.tsx`, `web/src/api/client.ts`; desk auth tests. Proposed: event/mode transport and status tests.
### BACKEND CONTRACT
Reuse anonymous desk/login and protected desk/me, desk/tiers, desk-registrations, attendees list/detail for the selected event. Operator authority is that event's desk JWT; deliberate organizer mode uses only the owning key. Existing-token 401 includes generation mismatch/revocation/expiry; wrong event 403; foreign organizer event 404; duplicate issuance 409. No request retry with another authority.
### FRONTEND CONTRACT
Current desk route remains. Selected mode is explicit, not storage priority. Store desk JWT under `congress_desk_token_${eventId}`. Missing selected credential shows corresponding entry gate. 401 clears only the exact sent event-token/key; 403/404/5xx/network preserve credentials and show denial/missing/retry respectively. Success reflects desk/me identity; do not attribute organizer operations to an operator.
### DATA MODEL IMPACT
None beyond P03-T02.
### IMPLEMENTATION STEPS
1. Replace `apiKey || deskToken` with explicit mode/state.
2. Pass selected resource-bound authority for every desk read/write.
3. Make credential clearing depend on sent authority and status.
4. Test event changes and simultaneous stored credentials.
### ACCEPTANCE CRITERIA
- Given both key and desk token, when operator mode is selected, then desk JWT alone is sent and issued ticket has operator attribution.
- Given invalid organizer key in organizer mode, when me returns401, then valid desk token remains untouched and no fallback occurs.
- Given event-A token and event-B route, when accessed, then operations cannot dispatch as event A in B; server wrong-scope request remains403.
### AUTOMATED TESTS
Mode/header assertions, event-token selection, exact401/403/404/5xx handling, generation lifecycle integration, desk issuance regressions and canonical check.
### MANUAL VERIFICATION
Populate both credentials, choose each mode, inspect desk/me headers/identity; revoke operator and verify only that event desk session clears; induce404/500 and verify credential preservation.
### SECURITY CHECKS
No automatic organizer escalation; scope selected before dispatch; server rechecks row generation.
### REGRESSION GUARDS
R11, R12, R16, R20.
### ROLLBACK
Restore earlier station presentation only with explicit mode adapter; retain generation hardening and event-token storage. Never restore precedence fallback.
### DELIVERABLES
Explicit desk transport/mode/status lifecycle and evidence.
### DEFINITION OF DONE
Every station request uses exactly the chosen authority and statuses affect only that authority.
### STOP CONDITION
Fallback, broad token clearing or incorrect ticket attribution blocks completion.


## P03-T08
### TASK ID
P03-T08
### TITLE
Preserve scanner transport under explicit device/admin authority
### PRODUCT OUTCOME
Scanner requests retain scoped credentials and mature offline behavior without portal heuristics.
### BASELINE
GateScanner already owns point-keyed token persistence, status handling, manifests, durable queues and revoke flow.
### PREREQUISITES
P03-T03.
### IN SCOPE
Narrow transport adapter compatibility; explicit scanner point/event token or deliberately supplied organizer administration authority.
### OUT OF SCOPE
Scanner engine/state-machine refactor, token/queue format changes, shell wrapping, native remediation or new admin UI.
### EXPECTED FILES
Confirmed: `web/src/pages/GateScanner.tsx`, `web/src/lib/scannerTokenStore.ts`, `scannerStorage.ts`, `scannerAuthPolicy.ts`, `scannerEngine.ts`, scanner E2E/unit tests. Proposed: narrow adapter header tests; engine files remain intentionally unchanged.
### BACKEND CONTRACT
Reuse `GET /api/checkin-points/{point_id}/manifest`, `POST .../scans/batch` with existing scan IDs/payloads, `POST .../devices/self/revoke` using scanner token. Organizer token issuance/list/admin revoke retain organizer-only authority. 401 expiry/revocation, 403 wrong point/event, foreign organizer404 retain current semantics.
### FRONTEND CONTRACT
`/scan/:pointId` remains direct and byte-identical, no redirect or global human-session gate. Restore credential from existing point store before offline manifest use; adapter carries only explicit token. Preserve pending deactivation, 24-hour authorization window, provisional/conflict UX, queue retention and successful revoke-before-token-delete behavior. Loading/unpaired/denied/offline states remain existing scanner states.
### DATA MODEL IMPACT
None; queue/IndexedDB/token shapes unchanged.
### IMPLEMENTATION STEPS
1. Trace scanner transport separately from human pages.
2. Replace only shared-client dependency if present with explicit adapter.
3. Retain current status classifier and storage flow.
4. Assert headers/payload identity and run existing scanner checks.
### ACCEPTANCE CRITERIA
- Given User/organizer sessions and paired scanner, when manifest/batch executes, then only selected scanner token is sent.
- Given offline queued scans, when transport is migrated then reconnect occurs, then original scan IDs reconcile and records are not deleted before confirmation.
- Given self-revoke failure, when unpairing, then pending-deactivation blocks scanning and durable records remain.
### AUTOMATED TESTS
Existing scanner unit/reliability/auth/offline/real-API suites, adapter headers, unchanged batch payloads, canonical check; real-device evidence remains later gates.
### MANUAL VERIFICATION
Pair fixture scanner, scan online, go offline and scan, reload, reconnect and inspect reconciliation; unpair while disconnected then reconnect. Confirm direct scanner URL and no human credential headers.
### SECURITY CHECKS
Do not broaden point scope; local claim decode is UX only; offline authorization expires; no forced queue deletion.
### REGRESSION GUARDS
R13, R14, R15, R16, R17, R18, R20.
### ROLLBACK
Restore prior scanner transport artifact without changing DB/IndexedDB records or scan IDs; preserve pending deactivation and revoke state.
### DELIVERABLES
Minimal scanner adapter cutover and compatibility evidence.
### DEFINITION OF DONE
Transport is explicit and existing scanner offline/revocation contracts remain exercised unchanged.
### STOP CONDITION
Queue/token format drift, redirects, lost pending scans or broadened authority blocks completion.

## P03-T09
### TASK ID
P03-T09
### TITLE
Remove the heuristic client after complete caller migration
### PRODUCT OUTCOME
No production request can select a credential from pathname or fallback storage precedence.
### BASELINE
P03-T04–P03-T08 may temporarily coexist with the old helper during safe slices.
### PREREQUISITES
P03-T04, P03-T05, P03-T06, P03-T07, P03-T08.
### IN SCOPE
Remove obsolete helper/AuthScope/storage-path inference and migrate any remaining real callers; final transport inventory.
### OUT OF SCOPE
Compatibility shim, retained heuristic feature flag, new request library, unrelated page refactor.
### EXPECTED FILES
Confirmed: `web/src/api/client.ts`, all existing API consumers and scanner transport; web tests. Proposed: final callsite/security inventory in implementation evidence.
### BACKEND CONTRACT
No endpoint/schema change; reuse existing authorizers and typed OpenAPI contracts.
### FRONTEND CONTRACT
Every current route uses anonymous/User/organizer/desk/scanner adapter explicitly. No `scope=any`, pathname credential lookup, falsy-token fallback, old helper alias or re-export remains. Status handling still belongs to the exact sent authority. No new UI.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Search production source for old helper, AuthScope, pathname and storage-based credential selection.
2. Finish actual missed callsites within their established authority.
3. Delete obsolete implementation/aliases/tests that endorse fallback.
4. Run consolidated transport and route gates once after integration; document complete caller map.
### ACCEPTANCE CRITERIA
- Given all credential stores populated, when every request family executes from a misleading pathname, then headers still match supplied authority.
- Given absent selected credential, when protected action is attempted, then no unrelated token is sent.
- Given source inventory, when reviewed, then no production caller/import of obsolete heuristic exists.
### AUTOMATED TESTS
Full authority matrix including public/login no-header, all protected families, 401/403/404/no-retry, generated typing/build and canonical checks.
### MANUAL VERIFICATION
Exercise public registration, organizer edit, attendee QR/network, desk login/issue, Booth capture/export and scanner sync in one browser with mixed sessions; inspect each request family and verify no credential switching.
### SECURITY CHECKS
No residual shims; public auth is truly anonymous; negative checks include all stored-credential combinations.
### REGRESSION GUARDS
R01–R20, specifically R20.
### ROLLBACK
Use a coherent explicit-authority application artifact; do not resurrect heuristic code as a supported fallback. Data/storage keys remain intact.
### DELIVERABLES
Deleted heuristic, complete caller inventory, consolidated transport evidence.
### DEFINITION OF DONE
All callsites and obsolete exports are reconciled and the final header matrix passes.
### STOP CONDITION
Any residual production heuristic or missing caller evidence blocks shared-shell work.

## P03-T10
### TASK ID
P03-T10
### TITLE
Expose descriptive current-row access discovery
### PRODUCT OUTCOME
A User can discover eligible event/portal contexts without receiving new authority or organizer identity.
### BASELINE
Roles exist through Ticket, active DeskOperator and BoothStaff rows; no `/api/me/access` endpoint exists.
### PREREQUISITES
P03-T01.
### IN SCOPE
Read-only event-grouped discovery from current rows; stable empty response; multiple roles/resources; empty Partner IDs initially.
### OUT OF SCOPE
Generic RBAC table, organizer role, session issuance, authorization cache, duplicate Partner collection.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, `backend/app/routes/auth.py`, `backend/app/main.py`, `web/src/api/schema.d.ts`, existing auth/Booth/desk/ticket tests. Proposed: access-discovery route module and focused tests following router conventions.
### BACKEND CONTRACT
New `GET /api/me/access`, User Bearer via `CurrentUserDep`; no request body. Response: current User identity plus deduplicated event contexts with event ID/slug/name, eligible roles, `booth_ids`, and `partner_ids: []`. Active Ticket confers attendee eligibility; nonrevoked DeskOperator confers reception eligibility, not desk JWT; exact BoothStaff confers existing Booth capability. No rows returns empty contexts200. Invalid/wrong family401; no Organizer role inferred. Each destination still authorizes independently.
Exact200 schema: `{user_id, events:[{event_id,event_slug,event_name,roles,ticket_ids,desk_operator_ids,booth_ids,partner_ids}]}`. Roles use ATTENDEE/RECEPTION/PARTNER in that order; T10 partner_ids is empty. Stable deduplicated IDs; no-role events[]; no ORGANIZER. Use API/data §3.1 for exact ordering/filter rules; do not invent alternate contexts or role names.

### FRONTEND CONTRACT
No chooser yet. Generated client exposes descriptive result; loading/error/no-membership is distinguishable. This online response is not required for owner-cached ticket display.
### DATA MODEL IMPACT
None; reuse indexed membership relations.
### IMPLEMENTATION STEPS
1. Define event-grouped schema and explicit active-ticket filter.
2. Query current memberships, deduplicate without dropping multiple Booths/roles.
3. Register static route safely and regenerate OpenAPI types.
4. Add current-row mutation/negative tests and contract documentation.
### ACCEPTANCE CRITERIA
- Given one User with multiple roles/events/Booths, when discovery runs, then exact event-scoped IDs appear once without collapsing Booths.
- Given revoked desk row or inactive Ticket, when discovery runs, then that eligibility is excluded while independent roles remain.
- Given organizer/desk/scanner credential, when called, then401 and no access data are returned.
### AUTOMATED TESTS
No-role/multirole/multievent/multiBooth, revoked desk/inactive Ticket, no organizer inference, token families, destination still-denied assertions, schema generation and canonical checks.
### MANUAL VERIFICATION
Create isolated User memberships in events A/B, fetch discovery, revoke only A desk membership and refetch; verify attendee/Booth entries survive and no desk session is issued.
### SECURITY CHECKS
No frontend-controlled User ID; current DB rows authoritative; avoid leaking tenant keys or staff/contact data.
### REGRESSION GUARDS
R03, R11, R12, R16, R20.
### ROLLBACK
Remove/disable additive discovery application endpoint while keeping existing destination APIs; no data changes.
### DELIVERABLES
Read-only resolver, generated types, scenario evidence.
### DEFINITION OF DONE
Exact descriptive contexts and all token/current-row negatives are exercised.
### STOP CONDITION
Organizer inference, revoked eligibility, collapsed resource IDs or resolver-as-authorizer blocks completion.

## P03-T11
### TASK ID
P03-T11
### TITLE
Expand Partner ownership and backfill legacy Booths
### PRODUCT OUTCOME
Event-owned Partners can have zero/many Booths, and every existing Booth keeps its physical identity and exact lead grants.
### BASELINE
Partner/PartnerStaff do not exist; Booth is event-owned and BoothStaff is exact-Booth authority.
### PREREQUISITES
P03-T02.
### IN SCOPE
Partner/PartnerStaff schema; nullable Booth linkage; composite same-event constraint; deterministic one-Partner-per-Booth populated backfill.
### OUT OF SCOPE
API/UI, company-name merges, lead re-keying, Partner QR, hard delete/archive, mandatory linkage contract migration.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, migration directory through0011, existing Booth/lead/bookmark test fixtures. Proposed: next actual-head Partner expansion revision and populated-upgrade test module.
### BACKEND CONTRACT
No new HTTP endpoints in this task. Existing Booth/lead/bookmark/QR responses remain compatible. Proposed model supports Partner profile data and exact PartnerStaff membership without granting Booth leads.
### FRONTEND CONTRACT
NOT APPLICABLE: existing routes/components remain unchanged; no directory or sponsor shell delivered.
### DATA MODEL IMPACT
Partner: UUID, event FK, name, constrained type (EXHIBITOR/SPONSOR/INSTITUTIONAL/SCIENTIFIC), description/website/logo/brochure, created time. PartnerStaff unique(partner,user). Nullable indexed Booth.partner_id with composite (partner_id,event_id) FK to Partner(id,event_id); no unique partner_id. Backfill one Partner per Booth, copy profile values, set link, derive distinct profile membership from BoothStaff. Preserve all existing UUIDs/EntityQR secrets.
### IMPLEMENTATION STEPS
1. Confirm one migration head after generation expansion.
2. Add schema/ownership constraints and deterministic backfill without heuristic merging.
3. Keep nullable linkage for compatible old-writer overlap; record reconciliation requirement at P03-T14.
4. Add populated fixtures proving unchanged physical/operational rows.
### ACCEPTANCE CRITERIA
- Given populated legacy Booths with staff/leads/bookmarks, when upgraded, then Partner count equals legacy Booth count and each copied profile/link matches its own event.
- Given two Booths for one Partner, when inserted, then both are legal; cross-event linkage is rejected by DB.
- Given preupgrade EntityQRs/leads/bookmarks, when compared, then identifiers/secrets/content are unchanged.
### AUTOMATED TESTS
Upgrade populated actual predecessor with multiple tenants/events; count/value/staff-distinct assertions; zero/many Booth model cases; composite-FK rejection; existing Booth/lead suites and canonical checks.
### MANUAL VERIFICATION
In an isolated migrated fixture, inspect Partner/Booth linkage and staff counts; open an existing printed Booth URL and scan its unchanged secret into its original lead workspace.
### SECURITY CHECKS
Membership is profile-only; no implicit lead grant; never merge competitors by name/domain.
### REGRESSION GUARDS
R07, R08, R09, R16, R18, R20.
### ROLLBACK
Retain expansion and backfilled rows during application rollback. Never drop Partners/links/memberships after new writes; export/backup before rehearsal and use compatible code/forward fix.
### DELIVERABLES
Partner expansion, deterministic backfill, populated integrity evidence and rollback notes.
### DEFINITION OF DONE
Migration has one head and preserves every named legacy identity/invariant.
### STOP CONDITION
Competing head, heuristic merge, modified QR/lead FK or cross-event legal link blocks completion.

## P03-T12
### TASK ID
P03-T12

### TITLE
Add organizer Partner create/list/update
### PRODUCT OUTCOME
The owning organizer can manage a real boothless or Booth-owning Partner without pretending it is a Booth.
### BASELINE
Only organizer Booth create/list exists; glossary currently discourages Partner terminology.
### PREREQUISITES
P03-T11.
### IN SCOPE
Organizer Partner create/list/PATCH schemas and validation; future approved Partner Organization glossary/typography terminology amendment.
### OUT OF SCOPE
Hard delete/archive, representative editing, staff grants, implicit Booth creation, branding/program changes; no glossary edit during current planning.
### EXPECTED FILES
Confirmed: `backend/app/main.py`, `backend/app/models.py`, `backend/app/routes/events.py`, `GLOSSARY.md`, `web/src/api/schema.d.ts`. Proposed: Partner management route/schema module and tests; future approved glossary amendment under this task.
### BACKEND CONTRACT
New `POST /api/events/{event_id}/partners`201, `GET .../partners`200 list including zero-Booth Partners, `PATCH .../partners/{partner_id}`200. Organizer Bearer/OwnedEventDep. Create/update only profile fields and type: name1–200, type enum, description, website/logo/brochchure URLs within repository URL-length conventions; event/id/staff/Booth links are not writable through PATCH. Body validation422; invalid key401; missing/foreign event or mismatched Partner404. No DELETE or archive contract.
### FRONTEND CONTRACT
No admin UI yet; regenerate typed client. Empty list200 is a valid result; later P03-T35 consumes it. No read-only representative editor is implied.
### DATA MODEL IMPACT
Write only P03-T11 Partner fields; no additional migration.
### IMPLEMENTATION STEPS
1. Reuse OwnedEventDep for every action.
2. Define create/read/PATCH whitelists and field validation; reject attempted ownership changes.
3. Return Partner profile and event/resource IDs, with explicit Booth collection shape where included.
4. Regenerate types, add tenant/validation tests, and make the approved future glossary amendment distinguish Partner Organization, Exhibitor and physical Booth; document typography/localized label conventions without editing earlier phase docs.
### ACCEPTANCE CRITERIA
- Given owning organizer, when creating a SPONSOR, then201 profile exists with zero Booths and no QR.
- Given foreign organizer, when list/PATCH is attempted, then404 and data is unchanged.
- Given profile PATCH, when successful, then only allowed fields change and existing Booth/lead identities remain stable.
### AUTOMATED TESTS
Create/list/update zero/many Booth cases, type/length validation, immutable ownership, foreign404, wrong-family401, OpenAPI drift and canonical checks.
### MANUAL VERIFICATION
Create sponsor and exhibitor fixtures, list them, update profile, verify no Booth auto-created; attempt same operations from a foreign tenant key.
### SECURITY CHECKS
Tenant masking; writable-field whitelist; no staff/ownership escalation through mass assignment; external URLs rendered safely by future clients.
### REGRESSION GUARDS
R07, R10, R16, R19, R20.
### ROLLBACK
Roll back API application surface while retaining all Partner data; no destructive downgrade.
### DELIVERABLES
Organizer contracts/tests/types, approved future terminology amendment and evidence.
### DEFINITION OF DONE
Create/read/update and forbidden-field/tenant cases have exact HTTP evidence.
### STOP CONDITION
Delete/archive scope, implicit Booth or writable event/staff fields blocks completion.

## P03-T13
### TASK ID
P03-T13
### TITLE
Implement transactional Partner membership and exact Booth grants
### PRODUCT OUTCOME
Organizers assign existing Users profile access and only selected Booth lead access; removal is immediate and complete under that Partner.
### BASELINE
Exact BoothStaff grants exist, but Partner membership/revocation do not; legacy Booth assignment may provision unusable missing accounts.
### PREREQUISITES
P03-T12.
### IN SCOPE
Existing-User Partner assignment/list/removal; explicit grant set; transactional full Partner removal and per-Booth unassignment.
### OUT OF SCOPE
Invitation/password generation, absent-User creation, implicit all-Booth grants, User deletion, unrelated Partner removal.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, `backend/app/routes/booths.py`, `backend/app/routes/leads.py`, existing Booth/lead tests. Proposed: Partner staff routes/transaction tests and explicit Booth unassignment handler.
### BACKEND CONTRACT
Organizer OwnedEventDep: `POST /api/events/{event_id}/partners/{partner_id}/staff` body `{email, booth_ids: []}` creates membership/exact selected grants201, repeated identical assignment200; normalized email must resolve existing User, else409 instruct public registration first. Every Booth must belong to this Partner/event else404; deduplicate IDs; any invalid selection rolls back the entire operation. `GET .../staff` returns members plus exact granted Booth IDs. `DELETE .../staff/{user_id}`204 idempotently removes PartnerStaff and all that User's BoothStaff under this Partner in one transaction. `DELETE /api/events/{event_id}/booths/{booth_id}/staff/{user_id}`204 removes only selected Booth grant, retaining profile membership. Invalid key401; foreign resources404.
### FRONTEND CONTRACT
No UI yet. Typed results support profile-only assignment and explicit Booth selections at P03-T35. Existing User session remains valid but authorization changes immediately.
### DATA MODEL IMPACT
Use PartnerStaff/BoothStaff only; no User password/profile mutation; no new migration.
### IMPLEMENTATION STEPS
1. Normalize/resolve User without provisioning.
2. Validate complete resource set before mutation and define idempotent repeated grant behavior.
3. Implement atomic full removal and narrow Booth unassignment.
4. Test rollback on mixed valid/foreign IDs and same-JWT revocation.
### ACCEPTANCE CRITERIA
- Given existing User and empty booth_ids, when assigned, then profile membership exists and no lead capability is granted.
- Given Booth A selected under Partner P, when assigned, then A lead access succeeds and P's Booth B/Q's Booth C remain403.
- Given full Partner removal, when the same JWT requests profile/leads, then403 immediately; grants in another Partner survive.
- Given absent email, when assigned, then409 and no User/password/membership is created.
### AUTOMATED TESTS
Same-event P:A/B and Q:C matrix; absent409; repeated200; mixed-invalid rollback; narrow versus full removal; unchanged User password; tenant404; canonical checks.
### MANUAL VERIFICATION
Assign a registered User profile-only, grant A, inspect staff list, verify B denied, unassign A, regrant then remove P membership; confirm Q assignment remains and old JWT loses P access.
### SECURITY CHECKS
Exact BoothStaff authorizer unchanged; row deletion atomic; never treat PartnerStaff as lead authority.
### REGRESSION GUARDS
R08, R09, R16, R20.
### ROLLBACK
Keep membership/grant state and restore a compatible transactional API version; never resurrect removed grants or regenerate passwords. Restore from backup only through a separately authorized data operation.
### DELIVERABLES
Membership/grant/revoke contracts, generated types and transactional security evidence.
### DEFINITION OF DONE
Profile-only, selected Booth, full removal, narrow removal and failure atomicity are proved.
### STOP CONDITION
Implicit grants, missing-User creation or partial revocation blocks completion.

## P03-T14
### TASK ID
P03-T14
### TITLE
Link Booth writes and synchronize legacy staff with Partner membership
### PRODUCT OUTCOME
Legacy Booth workflows remain usable while every new Booth/staff write respects real Partner ownership.
### BASELINE
Existing POST/GET Booth and staff routes are organizer-owned; old Booth create has no Partner link and staff assignment can create a missing User.
### PREREQUISITES
P03-T13.
### IN SCOPE
Optional same-event Partner on existing Booth create; atomic one-to-one Partner creation when omitted; legacy staff/profile synchronization; reconciliation of old-writer NULL links.
### OUT OF SCOPE
Changing preserved legacy account provisioning, implicit Booth grants, QR changes, regrouping by company name, NOT NULL contract migration, lead rewrite.
### EXPECTED FILES
Confirmed: `backend/app/routes/booths.py`, `backend/app/models.py`, existing Booth/lead/bookmark tests and EntityQR code. Proposed: compatibility/link synchronization tests and controlled reconciliation evidence.
### BACKEND CONTRACT
Existing `POST /api/events/{event_id}/booths` accepts optional `partner_id`. Provided same-event Partner links Booth; foreign/missing Partner404; omitted value atomically creates one EXHIBITOR Partner and Booth while retaining existing201 BoothOut/QR contract. Existing `POST/GET .../booths/{booth_id}/staff` retains legacy provisioning/idempotence; successful staff assignment also ensures PartnerStaff without granting other Booths. Narrow DELETE from P03-T13 retains profile membership. Existing slug collision409 and tenant404 remain.
### FRONTEND CONTRACT
Existing organizer Booth create/staff UI remains functional; optional Partner selector is later P03-T35. Existing `/booth/:boothId` and public standee URL/QR retain exact identity; no redirect.
### DATA MODEL IMPACT
Writes P03-T11 linkage/membership; keep nullable DB column for overlap. Reconcile NULL links deterministically after draining old writers; do not merge companies.
### IMPLEMENTATION STEPS
1. Make Partner/Booth/QR creation one transaction.
2. Validate supplied Partner/event before writes.
3. Synchronize legacy staff grant to profile membership.
4. Exercise old-shape requests and mixed-version NULL reconciliation; record no remaining unintended NULLs after old writers drain.
### ACCEPTANCE CRITERIA
- Given old create body, when submitted, then one linked Partner/Booth/QR is committed and response remains compatible.
- Given existing same-event Partner, when two Booths are created for it, then both link without extra Partner or changed QR format.
- Given legacy Booth staff assignment, when successful, then profile membership exists and only that Booth lead access is granted.
### AUTOMATED TESTS
Old/new body compatibility; cross-event404/transaction rollback; slug409; QR exact preservation; legacy new/existing User path; multiple Booth same Partner; synchronization and reconciliation fixtures; canonical checks.
### MANUAL VERIFICATION
Create Booth with old form, then create two linked Booths via approved fixture/API; assign legacy staff, open preserved printed links and capture leads separately; inspect linkage and no extra grants.
### SECURITY CHECKS
Same-event DB constraint and route check; legacy password behavior preserved truthfully, not copied into new Partner assignment; no Partner-wide leads.
### REGRESSION GUARDS
R07, R08, R09, R10, R16, R18, R20.
### ROLLBACK
Leave expand schema/data and compatible dual writes in place. Do not run old unsynchronized writers without an approved reconciliation plan; no deletion of generated Partners/QRs.
### DELIVERABLES
Compatible Booth/staff handlers, reconciled linkage evidence, regression tests.
### DEFINITION OF DONE
Old and new request shapes work, populated identities remain stable, and linkage synchronization is documented/exercised.
### STOP CONDITION
Unlinked new Booth, extra implicit lead grants, QR reminting or partial writes blocks completion.

## P03-T15
### TASK ID
P03-T15
### TITLE
Expose authorized Partner context and anonymous directory
### PRODUCT OUTCOME
Sponsor-only representatives have a real read-only workspace contract, and visitors can discover all event Partners without private lead/staff data.
### BASELINE
Public single-Booth detail exists; no public Partner collection or Partner-authorized GET exists.
### PREREQUISITES
P03-T14.
### IN SCOPE
Partner profile/context GET with exact membership; public event Partner directory with zero/many Booth metadata and explicit caller lead capabilities only in protected response.
### OUT OF SCOPE
Partner profile PATCH, `/api/partners/me`, Partner bookmarks, aggregate attendee overview, lead endpoint changes.
### EXPECTED FILES
Confirmed: `backend/app/routes/public.py`, `backend/app/routes/booths.py`, `backend/app/routes/leads.py`, `backend/app/main.py`, `web/src/api/schema.d.ts`. Proposed: Partner read authorizer/routes and public directory tests.
### BACKEND CONTRACT
New `GET /api/partners/{partner_id}`: User Bearer+exact PartnerStaff;200 profile/event/public Booth metadata and `lead_booth_ids` derived solely from this User's exact BoothStaff. Unknown404, known nonmember403, invalid/wrong family401. No editing capability. New anonymous `GET /api/public/events/{slug}/partners`:200 profiles with `booths: []` or public Booth metadata/standee references, never QR secrets/private staff/leads/contact lists; unknown slug404. No Authorization header required or forwarded by clients. Existing public single-Booth route retained.
### FRONTEND CONTRACT
No directory/workspace UI yet. Generated result distinguishes zero Booths from unauthorized leads. Loading/empty/404/protected403 contracts feed P03-T27/P03-T45/P03-T54. Bookmark state remains a separate User API.
### DATA MODEL IMPACT
Read-only Partner/Booth/membership queries; none new.
### IMPLEMENTATION STEPS
1. Implement exact PartnerStaff authorizer independent of BoothStaff.
2. Return minimal protected context and exact lead IDs.
3. Implement slug-bound public directory with safe fields and deterministic ordering.
4. Regenerate types; assert public/private redaction and membership removal effects.
### ACCEPTANCE CRITERIA
- Given boothless sponsor member, when protected GET runs, then200 with booths[]/lead_booth_ids[] and no fake Booth.
- Given member of P with A only, when P context is fetched, then only A is a lead capability even if B appears as public metadata.
- Given anonymous visitor, when directory runs, then all event Partners appear without staff/leads/QR secrets.
### AUTOMATED TESTS
Zero/many Booth, known403/unknown404, revoked same-JWT403, same-event exact grants, public redaction, wrong slug404, anonymous header tests and canonical checks.
### MANUAL VERIFICATION
Fetch directory anonymously; login sponsor-only User and open protected context; request another known Partner and its Booth leads and verify403; compare public response for secret fields.
### SECURITY CHECKS
Public metadata is not lead permission; no duplicate discovery API; server checks each request.
### REGRESSION GUARDS
R07, R08, R09, R16, R18, R20.
### ROLLBACK
Disable new read surfaces while retaining schema, memberships and legacy Booth reads/URLs.
### DELIVERABLES
Protected/public read contracts, generated types and redaction/isolation evidence.
### DEFINITION OF DONE
Sponsor-only, multi-Booth and public privacy cases are exercised.
### STOP CONDITION
Public secret/staff exposure, Partner-wide leads, fake Booth or unapproved editing blocks completion.

## P03-T16
### TASK ID
P03-T16
### TITLE
Enrich access discovery with exact Partner capabilities
### PRODUCT OUTCOME

Chooser discovery describes current Partner/profile and exact Booth lead eligibility across events without duplicating APIs.
### BASELINE
P03-T10 reports booth_ids and empty partner_ids; P03-T15 provides resource-authorized Partner context.
### PREREQUISITES
P03-T10, P03-T15.
### IN SCOPE
Enrich existing `/api/me/access` from PartnerStaff with partner_ids and event-scoped resource capabilities.
### OUT OF SCOPE
New `/api/partners/me`, organizer identity, token issuance, implicit leads, resolver authorization cache.
### EXPECTED FILES
Confirmed: models/main/generated schema; P03-T10 access module and its tests become existing prerequisites. Proposed: enrichment cases within the resolver suite, not a duplicate endpoint.
### BACKEND CONTRACT
Same `GET /api/me/access`, User Bearer, no body; existing response remains additive-compatible. Partner eligibility derives from current PartnerStaff, partner_ids include boothless sponsor, booth_ids remain exact grants. Member removal immediately removes Partner and its cleaned Booth grants while independent memberships remain. Invalid/wrong-family401; no memberships200 empty; no Organizer role.
### FRONTEND CONTRACT
No chooser UI here. Consumers can distinguish eligible portal/resource from stored destination credentials. Offline cached ticket resolution remains independent of discovery.
### DATA MODEL IMPACT
Read-only new relations; no migration.
### IMPLEMENTATION STEPS
1. Add Partner membership join to existing grouping.
2. Keep exact Booth IDs independent from Partner ownership.
3. Preserve old fields/current eligibility filters and regenerate types.
4. Test live removal and cross-event/multi-Partner results.
### ACCEPTANCE CRITERIA
- Given sponsor-only User, when discovery runs, then partner_id is present and booth_ids empty.
- Given P/Q across events and only P:A grant, when fetched, then each Partner is grouped correctly and B/C never appear as capabilities.
- Given removal of P, when refetched with unchanged JWT, then P/A disappear and Q remains.
### AUTOMATED TESTS
Sponsor-only/multiPartner/multiEvent/revocation, empty compatibility, no organizer, existing access scenarios, types and canonical checks.
### MANUAL VERIFICATION
Compare access before/after adding and removing P membership; verify protected GET independently authorizes and stale chooser data cannot restore removed permission.
### SECURITY CHECKS
Descriptions never substitute for authorizers; current rows only; no duplicate collection leaks.
### REGRESSION GUARDS
R08, R12, R16, R20.
### ROLLBACK
Rollback enrichment app response while retaining Partner data and direct protected API; keep old fields compatible.
### DELIVERABLES
Enriched resolver/types and current-row evidence.
### DEFINITION OF DONE
Discovery accurately reflects zero/many Partner and exact Booth capabilities after mutations.
### STOP CONDITION
Inferred all-Booth grants, stale revoked membership or new duplicate endpoint blocks completion.

## P03-T17
### TASK ID
P03-T17
### TITLE
Expand event-owned AttendeeType and immutable issue labels
### PRODUCT OUTCOME
Tickets can record optional event taxonomy without altering admission tiers or rewriting historical labels.
### BASELINE
Ticket is unique(event,user); User is global. No type schema exists; TicketTier is inventory/admission, not participant taxonomy.
### PREREQUISITES
P03-T11.
### IN SCOPE
Event-owned AttendeeType; nullable Ticket FK and immutable name-at-issue field; same-event DB constraint; NULL legacy backfill.
### OUT OF SCOPE
Type APIs/UI, Order table, global User category, tier repurposing, inferred backfill, reassignment or policy changes.
### EXPECTED FILES
Confirmed: `backend/app/models.py`, migration chain, Ticket/tier tests. Proposed: next available AttendeeType expansion revision after actual Partner head and populated-history tests.
### BACKEND CONTRACT
No new route in this task. Existing ticket issuance remains compatible with NULL category; future contract uses exact `attendee_type_name_at_issue` rather than mutable joined name.
### FRONTEND CONTRACT
NOT APPLICABLE: no selector/badge delivered here; existing ticket/scanner presentation remains.
### DATA MODEL IMPACT
AttendeeType: UUID/event FK, name1–100, description, display_order default0, is_active defaulttrue, created_at; unique(event,name), unique(id,event). Ticket adds nullable attendee_type_id with composite(event,type) FK and nullable `attendee_type_name_at_issue`; existing rows both NULL. Three revisions remain serialized: generation→Partner→Type. Preserve Ticket/event/User/tier/QR IDs and counters.
### IMPLEMENTATION STEPS
1. Inspect actual head; create single linear Type expansion.
2. Add nullable fields and composite ownership constraint.
3. Backfill NULL only; enforce issue-label immutability in application write ownership design.
4. Add populated upgrade and DB rejection tests; document rollback retaining history.
### ACCEPTANCE CRITERIA
- Given existing tickets, when upgraded, then type/snapshot are NULL and every tier/QR/quota value remains unchanged.
- Given event-A Ticket and event-B type, when linked, then DB rejects cross-event association.
- Given a type is renamed later, when an issued ticket is read after issuance integration, then its stored historical label remains unchanged.
### AUTOMATED TESTS
Populated predecessor upgrade, NULL defaults, unique(event,name), legal same-name different-event, composite-FK negative, preserved QR/tier counters, canonical checks.
### MANUAL VERIFICATION
Compare pre/post migration Ticket and tier/QR records in isolated fixture; inspect NULL historical columns and attempt a cross-event link in rolled-back test transaction.
### SECURITY CHECKS
Type is event participation data, never permission/admission authority; no User/global category overwrite.
### REGRESSION GUARDS
R02, R03, R15, R16.
### ROLLBACK
Retain type/snapshot schema and data when rolling application back; never drop historical assignments after writes. Use forward-compatible artifact or forward fix.
### DELIVERABLES
Serialized expansion/model and populated integrity evidence.
### DEFINITION OF DONE
Legacy preservation and DB event isolation are proved without inferred historical categories.
### STOP CONDITION
Competing head, inferred backfill, mutable historical read label or tier coupling blocks completion.

## P03-T18
### TASK ID
P03-T18
### TITLE
Add organizer AttendeeType CRUD and active public/desk discovery
### PRODUCT OUTCOME
Organizers maintain event taxonomy; attendees/reception discover only active choices through their correct authority.
### BASELINE
Type schema is delivered by P03-T17; PublicEvent currently contains metadata and tiers only.
### PREREQUISITES
P03-T17.
### IN SCOPE
POST/GET/PATCH with no DELETE; admin inactive visibility; ordering; additive PublicEvent active list; new protected desk active list; reusable exact assignment-validation contract.
### OUT OF SCOPE
Issuance writes, postissue reassignment, admission/quota rules, separate public type collection, hard deletion.
### EXPECTED FILES
Confirmed: `backend/app/routes/public.py`, `desk.py`, `events.py`, `backend/app/main.py`, `web/src/api/schema.d.ts`. Proposed: AttendeeType management routes/schema/tests using existing OwnedEventDep and AuthorizedDeskDep conventions.
### BACKEND CONTRACT
Organizer `POST /api/events/{event_id}/attendee-types`201, `GET .../attendee-types`200 includes inactive, `PATCH .../attendee-types/{type_id}`200; fields name, description, display_order, is_active only. Duplicate same-event name409, invalid fields422, missing/wrong-event type404, foreign organizer404, bad key401. No DELETE. Existing anonymous `GET /api/public/events/{slug}` adds `attendee_types` active only, ordered display_order then stable ID; unknown slug404. New `GET /api/events/{event_id}/desk/attendee-types` uses event desk/explicit owning organizer authority, active only; desk401/403 and organizer404 retained. Shared assignment validation: inactive409; wrong-event404; missing404; optional NULL accepted, implemented at issuance in P03-T19.
### FRONTEND CONTRACT
No UI; types regenerate for organizer selector/public reserve/desk consumers. Active empty list means category remains optional, not an error. Rename/deactivation never rewrites issued label.
### DATA MODEL IMPACT
P03-T17 records only; no schema changes.
### IMPLEMENTATION STEPS
1. Add owned create/list/PATCH and conflict handling.
2. Add ordered active PublicEvent property and desk read route.
3. Define reusable same-event/active lookup with exact404/409 semantics.
4. Add field/status/auth/history tests and regenerate schema.
### ACCEPTANCE CRITERIA
- Given active/inactive types, when admin lists, then both appear; public/desk lists show only active in deterministic order.
- Given another event's type ID, when PATCH/assignment validation runs, then404 with no mutation.
- Given deactivate/rename, when applied, then existing ticket snapshot is unchanged and future inactive assignment is409.
### AUTOMATED TESTS
CRUD/status/ordering, no DELETE404/405, duplicate409, public additive compatibility/no-header, desk401/wrong-event403, organizer tenant404, snapshot preservation, canonical checks.
### MANUAL VERIFICATION
Create two types, order them, deactivate one, compare organizer list/PublicEvent/desk list; request wrong-event/missing IDs and verify404; confirm no delete control/contract.
### SECURITY CHECKS
Desk may read active types but cannot administer; category remains nonauthoritative.
### REGRESSION GUARDS
R02, R11, R15, R16, R20.
### ROLLBACK
Disable new admin/read surface while preserving types/snapshots; keep existing PublicEvent fields and ticket compatibility.
### DELIVERABLES
Exact type contracts, active discovery, types/tests/evidence.
### DEFINITION OF DONE
All three list audiences and exact validation errors are exercised.
### STOP CONDITION
DELETE, inactive selectable discovery, wrong-event disclosure or admission coupling blocks completion.

## P03-T19
### TASK ID
P03-T19
### TITLE
Capture optional category and historical name during issuance
### PRODUCT OUTCOME
Self-reserved and desk-issued tickets store an optional same-event category and immutable label without changing inventory or QR issuance.
### BASELINE
Current reserve accepts tier only; desk registration accepts identity/tier and attributes operator. Duplicate event/User409; closed400; sold-out410.
### PREREQUISITES
P03-T18.
### IN SCOPE
Optional request type ID; same-event active validation before quota mutation; snapshot on issue; additive relevant ticket/desk read outputs.
### OUT OF SCOPE
Existing-ticket reassignment, User type field, quota/admission changes, QR remint, new frontend forms.
### EXPECTED FILES
Confirmed: `backend/app/routes/tickets.py`, `desk.py`, `backend/app/models.py`, `web/src/api/schema.d.ts`, ticket/desk/concurrency tests. Proposed: category issuance/history cases in these suites.
### BACKEND CONTRACT
Existing `POST /api/events/{event_id}/tickets/reserve` User Bearer and `POST .../desk-registrations` selected desk/owning organizer authority accept nullable optional `attendee_type_id`. NULL/omission preserves existing behavior. Active same-event type stores FK and exact current name in `attendee_type_name_at_issue` within issuance transaction. Inactive409; wrong-event/missing404; body422. Preserve duplicate409, closed400, sold-out410 and attribution. Add ID/snapshot to issued ticket, own-ticket, desk detail/search outputs where ticket category is represented; use stored snapshot, never mutable name. No mutation endpoint for reassignment.
### FRONTEND CONTRACT
No new page controls here; generated clients accept optional value, existing forms can omit it. Consumers display the snapshot when present and no fabricated default when NULL. Future public/reception selectors use delivered discovery.
### DATA MODEL IMPACT
Populate P03-T17 fields only at creation; old tickets remain NULL.
### IMPLEMENTATION STEPS
1. Validate type before inventory writes and capture name in the transaction.
2. Add fields to both issuance/read serializers.
3. Keep tier atomic reservation, event/User uniqueness and EntityQR unchanged.
4. Test rejected types do not consume quota and renames do not alter issued labels.
### ACCEPTANCE CRITERIA
- Given omitted type, when either issuance path succeeds, then ticket remainsNULL and tier count increments once.
- Given active same-event type, when issued then renamed/deactivated, then old ticket retains original label/FK.
- Given inactive/foreign/missing type, when submitted, then409/404/404 respectively and no Ticket/QR/quota increment is committed.
### AUTOMATED TESTS
Both issuance paths forNULL/active/invalid, snapshot rename, duplicate/concurrent quota/idempotence regressions, attribution, read-output consistency and canonical checks.
### MANUAL VERIFICATION
Issue self/desk fixtures with and without type, rename/deactivate type, view own pass/desk detail; repeat rejected assignment and compare reserved_count/QR/ticket totals.
### SECURITY CHECKS
No new permission via category; no client snapshot input; operator cannot reassign old ticket.
### REGRESSION GUARDS
R01, R02, R03, R11, R15, R16, R20.
### ROLLBACK
Keep historical values; roll application to compatible nullable-field readers/writers. Never erase snapshot/FK or decrement legitimate reservations during rollback.
### DELIVERABLES
Additive issuance/read contracts/types and quota/history evidence.
### DEFINITION OF DONE
Both paths and all named rejection/history branches are proved with unchanged admission semantics.
### STOP CONDITION
Rejected type consumes quota, mutable historical label, reassignment or QR change blocks completion.

## P03-T20
### TASK ID
P03-T20
### TITLE
Deliver organizer AttendeeType administration
### PRODUCT OUTCOME
The owning organizer can create, edit, order and deactivate event categories separately from ticket tiers.
### BASELINE
OrganizerEventDetail has existing tiers/points/Booths/operators, not a category manager.
### PREREQUISITES

P03-T05, P03-T18.
### IN SCOPE
Working category administration in current event workspace, including inactive visibility and conflict handling.
### OUT OF SCOPE
New shell dependency, delete, ticket reassignment, admission/quota controls or issuance selectors.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerEventDetail.tsx`, `web/src/lib/i18n.ts`, generated schema/client. Proposed: category-manager feature module and action/browser tests; integration owner owns the large page edits.
### BACKEND CONTRACT
NOT APPLICABLE: reuse P03-T18 organizer POST/GET/PATCH attendee-types, explicit organizer Bearer;409 duplicate,422 validation,404 missing/foreign and401 invalid key. No DELETE.
### FRONTEND CONTRACT
`/organizer/events/:eventId` gains a shallow Types section. Form name/description/display_order/is_active uses local form state. List includes inactive, ordered consistently. Loading skeleton/status; empty invites creation;409 duplicate shows field-level correction;422 retains draft;404 masks context;401 organizer gate only. Successful mutation refetches types, not tier counters. Explain category versus tier and historical-label preservation in EN/FA.
### DATA MODEL IMPACT
Only P03-T18 writes; no migration.
### IMPLEMENTATION STEPS
1. Add a working bounded manager rather than another monolithic block.
2. Wire explicit organizer client and fields/statuses.
3. Provide create/edit/deactivate and order editing; no delete.
4. Add localized labels and API-backed action tests.
### ACCEPTANCE CRITERIA
- Given owning organizer, when a type is created/ordered/deactivated, then API persisted values match and public active list changes accordingly.
- Given duplicate name409, when save fails, then draft remains and no extra row appears.
- Given tier list before type edits, when category operations finish, then quota/reserved_count remain unchanged.
### AUTOMATED TESTS
Create/PATCH/deactivate browser-to-API tests, duplicate/422 draft handling, inactive list, header authority, no delete, localization/type/build and canonical checks.
### MANUAL VERIFICATION
Create Physician/Student, reverse display order, rename one, deactivate it, compare public choices and existing issued snapshot; check no tier/quota changes and EN/FA RTL layout at320/390.
### SECURITY CHECKS
No management with User/desk token; foreign event404; no client-only authorization or mass-assignment fields.
### REGRESSION GUARDS
R02, R10, R15, R16, R19, R20.
### ROLLBACK
Hide/revert manager presentation while retaining category data and APIs; no deletion of assigned taxonomy.
### DELIVERABLES
Working localized manager, tests and persisted-state evidence.
### DEFINITION OF DONE
All management actions operate against real contracts and errors preserve editable drafts.
### STOP CONDITION
Tier coupling, delete action, unsupported fields or DOM-only success proof blocks completion.

## P03-T21
### TASK ID
P03-T21
### TITLE
Establish shared context, async states and shallow navigation primitives
### PRODUCT OUTCOME
Delivered portals share consistent credential/event boundaries and accessible async navigation without replacing working features with empty shells.
### BASELINE
Current router lives in main.tsx; no central AuthContext or five-portal shell system exists. Existing i18n/RTL and session keys must be reused.
### PREREQUISITES
P03-T09, P03-T10.
### IN SCOPE
Minimal shared identity/credential/active-event boundary using React conventions; async-state components; navigation/context primitives; stale-response isolation.
### OUT OF SCOPE
Adding a state library, generic RBAC framework, all portal shells, feature implementations or deliverable placeholder pages.
### EXPECTED FILES
Confirmed: `web/src/main.tsx`, `web/src/api/client.ts`, `web/src/lib/i18n.ts`, `web/src/layouts/AttendeeLayout.tsx`, current layouts/pages. Proposed: context provider, credential-specific session hooks, async-state and shallow-navigation modules following repository naming at implementation.
### BACKEND CONTRACT
NOT APPLICABLE: reuse `/api/me/access`, auth/me, public event and destination APIs. Resolver data describes eligibility only; no organizer session derived from User. Offline cached tickets can independently establish attendee event presentation.
### FRONTEND CONTRACT
Shared boundary tracks distinct credentials and active event/portal, not one merged token. Preserve storage keys. Route resource context outranks remembered context after validation. Loading/empty/network/401/403/404 are explicit. On event/portal change ignore obsolete responses and reset scoped server state, not other-account cache. Shared navigation accepts only approved route descriptors. Keep existing production pages operational; do not expose incomplete portal cutovers or placeholder destination screens. No scanner wrapper/gate.
### DATA MODEL IMPACT
None; local context not server authority.
### IMPLEMENTATION STEPS
1. Define context lifecycle/storage ownership using existing React tools.
2. Add reusable async/error/navigation primitives with focus/RTL behavior.
3. Connect discovery without making it an offline pass dependency.
4. Prove event-switch response isolation and unaffected current routes.
### ACCEPTANCE CRITERIA
- Given simultaneous credentials, when portal changes, then each destination selects its explicit credential and missing destination authority opens its entry gate.
- Given slow event-A response after switching to B, when A resolves, then B content is not overwritten.
- Given scanner deep link, when provider/router integration lands, then direct scanner pairing/offline path is unchanged.
### AUTOMATED TESTS
Context lifecycle/status/no-fallback, obsolete-response race, existing route transport, keyboard navigation and cache-owner handling, type/build/canonical checks.
### MANUAL VERIFICATION
Switch User/organizer/desk contexts with mixed sessions, throttle A response then switch B, inspect resulting data/headers; navigate by keyboard in EN/FA; open scanner directly offline.
### SECURITY CHECKS
Decoded JWTs are not authority; no shared logout accidentally clears another portal; unknown online context does not wipe another account's cache.
### REGRESSION GUARDS
R04, R13, R16, R18, R19, R20.
### ROLLBACK
Revert shared provider/navigation integration to working routes with explicit adapters; preserve existing storage/cache shapes and scoped data.
### DELIVERABLES
Minimal boundary/primitives, integration and race/transport evidence; no state-library dependency.
### DEFINITION OF DONE
Boundary works with existing features and every enabled destination is real, not placeholder UI.
### STOP CONDITION
New state library, merged credential, mandatory online ticket resolver or enabled empty feature blocks completion.

## P03-T22
### TASK ID
P03-T22
### TITLE
Deliver truthful portal chooser and credential-specific entry
### PRODUCT OUTCOME
Users discover legitimate event/resource choices while understanding that organizer and desk entry require separate credentials.
### BASELINE
No central chooser exists; organizer key/User/desk sessions are separate. P03-T16 exposes Partner IDs without issuing destination authority.
### PREREQUISITES
P03-T21, P03-T16.
### IN SCOPE
Chooser, no-role/single-role/multirole flows, Partner resource selection, explicit organizer key and event desk login handoff.
### OUT OF SCOPE
Automatic organizer identity, desk token issued from User login, scanner pairing redesign, unavailable feature routing.
### EXPECTED FILES
Confirmed: `web/src/main.tsx`, existing login/public/organizer/desk pages and i18n. Proposed: chooser and User entry modules using shared boundary; no `/api/partners/me`.
### BACKEND CONTRACT
NOT APPLICABLE: anonymous auth/login/register, User GET `/api/me/access`, organizer key gate, anonymous event desk/login, and protected Partner GET. Existing401/403/404 semantics apply; chooser never authorizes destination.
### FRONTEND CONTRACT
Provide a shallow chooser entry associated with User login; exact new URL is named under router conventions at implementation, not asserted existing. One eligible delivered User portal/resource can auto-select; multiple require explicit event/Partner choice; none shows no-membership plus public browsing. Reception eligibility opens assigned-event desk entry requiring its token/login. Organizer is an explicit separate key entry, never inferred from access response. Loading/error/retry remain visible;403 retains session; success enters only delivered destination; preserve return URL after permission validation.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Build chooser from current access contexts/resources.
2. Separate eligibility from destination credential readiness.
3. Validate return route/event/resource and prevent loops.
4. Add real multirole entry and removal tests.
### ACCEPTANCE CRITERIA
- Given attendee+reception eligibility, when User logs in, then chooser offers both but selecting reception still requires event desk login before protected station calls.
- Given sponsor-only Partner, when choosing it, then context uses its real Partner ID and no fake Booth.
- Given organizer key absent, when organizer chosen, then key gate opens rather than using User JWT.
### AUTOMATED TESTS
Single/multiple/no-role, multiEvent/multiPartner, removed membership, missing destination credential/no dispatch, validated return target/no loop, real request headers and canonical checks.
### MANUAL VERIFICATION
Login multirole fixture, select attendee then reception, confirm separate login; select two Partners; choose organizer without key; remove membership then refresh/deep-link and verify denied state.
### SECURITY CHECKS
Return targets must be local validated routes; no role claim escalation; credential switching is explicit.
### REGRESSION GUARDS
R01, R11, R16, R18, R20.
### ROLLBACK
Remove chooser integration and retain direct working credential entries/URLs; membership and sessions unchanged.
### DELIVERABLES
Chooser/entry flows and API-backed navigation/security evidence.
### DEFINITION OF DONE
Eligibility and actual destination authority are demonstrably distinct in all named scenarios.
### STOP CONDITION
Automatic desk/organizer login, invented permissions or redirect loops blocks completion.

## P03-T23
### TASK ID
P03-T23
### TITLE
Introduce the five-destination AttendeeShell
### PRODUCT OUTCOME
Attendees have exactly My Congress, My Network, My Ticket, My Profile and Congress Details in one shallow event context.
### BASELINE
AttendeeLayout currently has only Tickets/Network; canonical `/c/:slug/*` routes are absent.
### PREREQUISITES
P03-T21.
### IN SCOPE
AttendeeShell/navigation and working current Ticket/Network integration; route registration for feature delivery; disabled future destinations until their tasks complete.
### OUT OF SCOPE
Delivering empty future pages, sixth Partner tab, feature-specific implementations, scanner/shared admin shell.
### EXPECTED FILES
Confirmed: `web/src/main.tsx`, `web/src/layouts/AttendeeLayout.tsx`, `web/src/pages/MyTickets.tsx`, `MyNetwork.tsx`, i18n. Proposed: AttendeeShell/navigation module and event-aware route bindings.
### BACKEND CONTRACT
NOT APPLICABLE: reuse User ticket/network APIs and anonymous public event context; exact feature contracts belong to P03-T24–P03-T29.
### FRONTEND CONTRACT
Canonical targets `/c/:slug/my-congress`, `/c/:slug/my-network`, `/c/:slug/my-ticket`, `/c/:slug/my-profile`, `/c/:slug/details`. Persistent mobile five-destination navigation, localized EN/FA labels, ≥48px touch targets, keyboard/focus support and safe-area spacing. Ticket/Network remain working on legacy routes. This task delivers the complete navigation component, exercised with real routed child content in its verification harness; public activation of the five-destination workspace waits until P03-T30 confirms all five feature tasks are complete. Do not ship disabled future tabs or placeholder destination pages. No nested primary tab bar/sixth tab. Unknown context prompts selection;401 User login;403 denial; no-content and network error are explicit.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Reuse current layout/i18n patterns for bounded shell/navigation.
2. Wire existing working Ticket/Network routes with event context.
3. Define all five exact route descriptors and integrate the complete shell with working children in the verification harness; leave production activation gated by P03-T30 rather than shipping incomplete routes.
4. Verify mobile navigation does not cover QR/actions and direct legacy routes still work.
### ACCEPTANCE CRITERIA
- Given selected event, when Ticket/Network navigation is used, then real API-backed content uses that event and back/history remains shallow.
- Given320px/FA RTL, when navigation renders, then five destinations fit without horizontal overflow and controls remain tappable.
- Given undelivered Profile feature, when navigation is inspected, then its target is disabled, not a fake successful empty page.
### AUTOMATED TESTS
Route/history/focus tests plus actual ticket/network request/context assertions, EN/FA responsive navigation, no sixth tab, canonical checks.
### MANUAL VERIFICATION
At320,375,390,430,768,1024,1440 widths, navigate working destinations in EN/FA; ensure nav does not obscure QR or actions; test back/forward and direct legacy URLs.
### SECURITY CHECKS
Shell presence never grants Ticket/Network authorization; no User-to-organizer fallback.
### REGRESSION GUARDS
R03, R04, R05, R06, R18, R19, R20.
### ROLLBACK
Restore current two-feature layout while keeping new context/explicit transport and all legacy URLs; no local/data schema change.
### DELIVERABLES
Five-destination shell/navigation with functional current integration and explicit feature enablement limits.
### DEFINITION OF DONE
Shell's working integration and responsive navigation are evidenced; feature completion remains separately gated.
### STOP CONDITION
Fake enabled pages, sixth tab, overflow covering actions or route breakage blocks completion.

## P03-T24
### TASK ID
P03-T24
### TITLE
Deliver event-context My Ticket with owner-scoped offline presentation
### PRODUCT OUTCOME
The selected congress pass displays online or from valid owner cache, with unchanged QR and historical category label.
### BASELINE
MyTickets and ticketCache already provide QR, owner/shape/TTL checks and cached event metadata. Cache is plaintext, not signed or admission authority.
### PREREQUISITES
P03-T23, P03-T19 (additive historical Ticket output and regenerated schema).

### IN SCOPE
Canonical My Ticket feature; selected-event filtering; cached event resolution; live/cache states; existing print/QR reuse and optional delivered snapshot display.
### OUT OF SCOPE

New cache cryptography, ticket minting/reassignment, online access-discovery prerequisite, scanner policy changes.
### EXPECTED FILES
Confirmed: `web/src/pages/MyTickets.tsx`, `web/src/lib/ticketCache.ts`, existing cache tests, i18n/generated schema. Proposed: event-aware Ticket feature/route tests.
### BACKEND CONTRACT
NOT APPLICABLE: reuse User `GET /api/attendees/me/tickets`; additive category fields when P03-T19 is present. No per-event ticket API required. QR is existing EntityQR secret; no remint on display/print.
### FRONTEND CONTRACT
`/c/:slug/my-ticket` in AttendeeShell; legacy `/my-tickets` retained for P03-T30 integration. Resolve active event from owner-cached ticket slug/ID before online discovery; one ticket can select automatically, multiple prompt. Loading can retain valid selected cached pass; no ticket shows truthful empty state; network failure uses cache with offline label;401 shows re-login/session-expired while cache presentation follows owner/TTL rules; no claim of valid session/admission. Explicit logout clears owner cache. Unknown online context must not wipe another account's cache. Display immutable category snapshot when available.
### DATA MODEL IMPACT
None; preserve cache keys/shape/TTL and logout semantics, additive reader handling only.
### IMPLEMENTATION STEPS
1. Extract/reuse QR/pass rendering and existing cache helper.
2. Filter by resolved event without requiring `/api/me/access` online.
3. Separate live authentication state from cached pass presentation.
4. Test offline multiEvent/owner/TTL and unchanged QR identity.
### ACCEPTANCE CRITERIA
- Given cached owner ticket and no network, when direct pass route opens, then correct event/QR appears without successful discovery request.
- Given tickets A/B, when A selected, then B pass never flashes or replaces A after async refresh.
- Given cache owner mismatch/expiry, when loaded, then it is not rendered; given explicit logout, then owner cache is cleared.
### AUTOMATED TESTS
Existing cache suite plus offline route, no mandatory discovery, multiEvent race, owner/TTL/malformed cache,401 stale-session label, snapshotNULL/history and QR payload identity; canonical checks.
### MANUAL VERIFICATION
Load A/B tickets online, disconnect/reload canonical and legacy pass URLs, select each event, verify QR via scanner fixture; expire cache and switch account/logout to confirm isolation and clearing.
### SECURITY CHECKS
Plaintext QR storage limitation disclosed; cache cannot authorize admission or restore server session; no cross-account read.
### REGRESSION GUARDS
R03, R04, R18, R19, R20.
### ROLLBACK
Restore current pass renderer/cache consumers without changing cache keys/data or QR. Preserve owner isolation and direct URLs.
### DELIVERABLES
Working My Ticket feature and offline/owner/QR evidence.
### DEFINITION OF DONE
Correct selected pass works offline, exact QR remains stable, and stale/expired/mismatched states are truthful.
### STOP CONDITION
Mandatory online discovery, cache called signed, cross-owner pass or QR remint blocks completion.

## P03-T25
### TASK ID
P03-T25
### TITLE
Scope My Network and vCard actions to the active event
### PRODUCT OUTCOME
Attendees view and mutate only the selected congress's connections while keeping existing networking/privacy/vCard behavior.
### BASELINE
Network list returns all User connections with event_id; current MyNetwork displays all-event data.
### PREREQUISITES
P03-T23.
### IN SCOPE
Client event filtering; same-event peer scan guard; visible-connection-only note/vCard actions; existing global privacy control reuse.
### OUT OF SCOPE
New aggregate/event endpoint, changed privacy model, connection deletion, global profile editing or cross-event merging.
### EXPECTED FILES
Confirmed: `web/src/pages/MyNetwork.tsx`, `backend/app/routes/network.py`, generated schema and network tests. Proposed: event-scoped feature/action tests.
### BACKEND CONTRACT
NOT APPLICABLE: reuse User `GET /api/attendees/me/network`, `POST .../scan` `{qr_secret,private_notes}`, `PATCH .../{connection_id}` `{private_notes}`, `GET .../{connection_id}/vcard`, `GET/PATCH .../privacy` `{share_contact_with_peers}`. List remains all-event; filter Connection.event_id client-side. Mutations/downloads reference only currently visible event-scoped connection IDs. Before scan dispatch, resolve the active event's target badge using existing peer flow/contract constraints; backend existing same-event checks remain authoritative.401 invalid User; owned connection missing404; existing scan validation/permission errors remain unchanged.
### FRONTEND CONTRACT
`/c/:slug/my-network` in AttendeeShell; active event list derives from Connection.event_id, not pathname alone. Clear selected connection/draft binding on event change; stale results cannot reopen old event contact. Loading/empty/error/401 distinct;403/404 preserve session; successful scan/note updates reconcile only active event. Global privacy clearly labeled global, not per-congress. vCard downloads preserve backend privacy redaction.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Reuse peer scan/list/note/vCard code.
2. Filter by activeEventId and guard actions against stale/nonvisible IDs.
3. Keep privacy semantics explicit; isolate async switches.
4. Test data/API mutations and vCard content, not only DOM labels.
### ACCEPTANCE CRITERIA
- Given connections in A/B, when A is selected, then only A appears and B IDs cannot be submitted from A's UI state.
- Given A note edit and switch to B before save, when stale action fires, then it is blocked and no B/A unintended mutation occurs.
- Given peer contact-sharing disabled, when vCard downloaded, then private email is omitted as existing server rules require.
### AUTOMATED TESTS
MultiEvent list/action guard, scan success/error, note persistence, event-switch race, vCard MIME/content/privacy, global privacy persistence and existing network suite/canonical checks.
### MANUAL VERIFICATION
Create A/B connections, switch events, edit A note and download A vCard; verify persisted API state and no B mutation; toggle global privacy and inspect another User's export.
### SECURITY CHECKS
CurrentUser ownership remains server-side; event-filtered UI is not new authorization; no hidden-contact leakage in vCard.
### REGRESSION GUARDS
R05, R06, R16, R19, R20.
### ROLLBACK
Restore prior networking view with explicit User transport and preserved connections/notes/privacy; maintain event guard if canonical event route retained.
### DELIVERABLES
Working scoped network feature and persisted-action/vCard evidence.
### DEFINITION OF DONE
Every display/mutation/download follows selected event and existing privacy behavior.
### STOP CONDITION
All-event leakage, stale connection mutation or vCard privacy regression blocks completion.

## P03-T26
### TASK ID
P03-T26
### TITLE
Deliver My Congress status and existing saved Booth actions
### PRODUCT OUTCOME
An attendee sees truthful current congress/ticket status and event-scoped saved Booths without a new aggregate API.
### BASELINE
MyTickets currently combines tickets/bookmarks; My Congress page does not exist. Public event metadata and protected bookmark list already exist.
### PREREQUISITES
P03-T24.
### IN SCOPE
Working My Congress summary; existing ticket/event data composition; event-filtered saved Booth list/unbookmark/direct standee actions.
### OUT OF SCOPE
Partner directory until P03-T27, fictional KPIs/programme, new overview API, Partner bookmarks or another tab.
### EXPECTED FILES
Confirmed: MyTickets, PublicBooth, PublicEvent, bookmark endpoints/types and i18n. Proposed: My Congress feature module and API-backed saved-action tests.
### BACKEND CONTRACT
NOT APPLICABLE: compose User own tickets/bookmarks and anonymous PublicEvent; `GET /api/attendees/me/bookmarks/booths`, idempotent POST/DELETE bookmark family. Filter saved Booths by selected event_id. No `/api/attendees/me/events/{id}/overview` introduced.
### FRONTEND CONTRACT
`/c/:slug/my-congress` in AttendeeShell becomes a working destination. Show actual event dates/location and ticket existence/status, with My Ticket action. Saved Booths show real profile/brochure/standee link and unbookmark. Loading sections independent; empty saved list truthful; offline pass summary may reuse selected owner cache, never claim live membership; bookmark mutations disabled without online authorized session;401 login,403 denial,404 removed resource; success updates saved state from API.
### DATA MODEL IMPACT
None; BoothBookmark semantics unchanged.
### IMPLEMENTATION STEPS
1. Compose existing selected-event ticket/public metadata without new API.
2. Move reusable saved-Booth functionality from ticket page.
3. Add protected unbookmark and direct public link/brochure actions.
4. Enable completed tab and test persisted saved state/event isolation.
### ACCEPTANCE CRITERIA
- Given tickets/bookmarks in A/B, when A hub opens, then only A status/saved Booths show.
- Given saved Booth, when unbookmarked, then protected API persists removal and public toggle/list agree after reload.
- Given no saved Booths, when hub opens, then empty state offers real public browsing and no fabricated partner cards.
### AUTOMATED TESTS
Composition/no-new-endpoint, event filtering, bookmark idempotence/persistence, offline summary/session distinction, loading/error/empty and canonical checks.
### MANUAL VERIFICATION
Bookmark A/B Booths, open A hub, remove A, reload and inspect bookmark API; open preserved A standee and brochure URL; disconnect and confirm status language is cache presentation, not current authority.
### SECURITY CHECKS
Anonymous metadata and protected saved state stay separate; no brochure/standee URL credential leakage.
### REGRESSION GUARDS
R03, R04, R07, R18, R19, R20.
### ROLLBACK
Remove hub route integration while retaining existing saved Booth APIs/data and ticket access; restore old saved presentation without deleting bookmarks.
### DELIVERABLES
Working hub/status/saved actions with real contract evidence.
### DEFINITION OF DONE
Summary is factual and saved actions persist with active-event isolation.
### STOP CONDITION
Fake content, new aggregate scope, sponsor bookmark emulation or cross-event saved items blocks completion.

## P03-T27
### TASK ID
P03-T27
### TITLE
Embed Partner discovery inside My Congress
### PRODUCT OUTCOME
Attendees find exhibitors and boothless sponsors in place without a sixth tab or fake sponsor bookmark.
### BASELINE
P03-T26 supplies the real hub; P03-T15 supplies public Partner directory; Booth bookmarks remain Booth-keyed.
### PREREQUISITES
P03-T26, P03-T15.
### IN SCOPE
In-place searchable/type-filtered directory; zero/many Booth cards; per-Booth saved actions and safe brochure/profile links.
### OUT OF SCOPE
Separate primary tab, PartnerBookmark schema, directory lead access, invented featured ranking, profile editing.
### EXPECTED FILES
Confirmed: MyTickets/PublicBooth bookmark/rendering code, i18n, router/schema. Proposed: directory/card modules embedded in My Congress and API-backed action tests.
### BACKEND CONTRACT
NOT APPLICABLE: anonymous `GET /api/public/events/{slug}/partners`; protected bookmark list/POST/DELETE separately. Public requests carry no Authorization. Partner booths[] provides real Booth choices; no sponsor-only bookmark mutation exists.
### FRONTEND CONTRACT
Within `/c/:slug/my-congress`, preview/expand and local search/type filters remain in place, not nested primary tabs. Sponsor card has profile/brochure only; multi-Booth Partner offers exact Booth choices/standee links and individual bookmarks. Loading/empty filter/no Partners/error/retry differentiated; protected action with no User opens login;401 clears sent User only; success updates saved state. Event switch clears previous directory/filter-bound actions before refetch.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Consume public directory anonymously and compose protected saved state.
2. Render sponsor/one/many Booth cases with truthful actions.
3. Add in-place filter/expand navigation with accessible focus/RTL.
4. Test bookmark persistence and event/resource selection.
### ACCEPTANCE CRITERIA
- Given sponsor and two-Booth exhibitor, when directory viewed, then sponsor has no fabricated Booth/star and exhibitor exposes independent A/B actions.
- Given filter changes, when applied, then matching API data is shown without leaving My Congress or adding sixth tab.
- Given A bookmarked, when reload occurs, then only A is saved, not every Booth of its Partner.
### AUTOMATED TESTS
Real directory schema fixtures/API, zero/many Booth, filter/empty/error, separate request headers, persisted per-Booth bookmark, stale event response and canonical checks.
### MANUAL VERIFICATION
Open hub, filter sponsors/exhibitors and search name, expand two-Booth Partner, bookmark A only, reload and confirm state; open brochure/standee and use browser Back; check320/390 EN/FA.
### SECURITY CHECKS
Public Partner metadata never grants protected leads; external URLs safe and credential-free; no fake sponsor identity.
### REGRESSION GUARDS
R07, R16, R18, R19, R20.
### ROLLBACK
Remove embedded directory while keeping hub/saved Booth features and public directory data/API; no bookmark deletion.
### DELIVERABLES
In-place directory/cards/actions and functional/filter/bookmark evidence.
### DEFINITION OF DONE
Sponsor/multi-Booth discovery works in the five-tab IA and real saved actions persist.
### STOP CONDITION
Sixth tab, implicit Partner-wide bookmark or private capability exposure blocks completion.

## P03-T28
### TASK ID
P03-T28
### TITLE
Deliver read-only My Profile and existing privacy preferences
### PRODUCT OUTCOME
Attendees can see global identity and current congress category truthfully, and control existing peer-contact privacy.
### BASELINE
GET auth/me exists; no profile PATCH. Organization/title are global User fields; category snapshot is Ticket/event-specific.
### PREREQUISITES
P03-T23, P03-T19 (additive historical Ticket output and regenerated schema).

### IN SCOPE
Read-only profile fields; optional delivered selected-ticket snapshot display; existing global networking privacy update.
### OUT OF SCOPE
Editing name/email/organization/title/password, profile PATCH, reassignment, organization branding; editing remains approval-blocked P03-T57.
### EXPECTED FILES
Confirmed: auth/me generated schema, `web/src/pages/MyNetwork.tsx` privacy code, MyTickets ticket data and i18n. Proposed: My Profile module and privacy persistence tests.
### BACKEND CONTRACT

NOT APPLICABLE: User `GET /api/auth/me`, own tickets for event snapshot, `GET/PATCH /api/attendees/me/network/privacy` with `{share_contact_with_peers}`.401 invalid User;422 invalid privacy body. No new profile update contract.
### FRONTEND CONTRACT
`/c/:slug/my-profile` in AttendeeShell becomes working. Show name/email/organization/title as read-only; label global identity versus selected-event type snapshot when present, NULL means unassigned not General. Privacy toggle clearly global. Loading/partial ticket absence/error/retry,401 login distinct; success confirmed by persisted preference; optimistic failure restores prior value and displays error. No disabled fake edit controls implying authorization.
### DATA MODEL IMPACT
Existing global consent field only; no migration.
### IMPLEMENTATION STEPS
1. Render existing User read contract and selected-ticket optional snapshot.
2. Reuse privacy API/form behavior with clear global label.
3. Enable Profile tab only with complete read/privacy behavior.
4. Test API persistence and privacy effect on peer/vCard output.
### ACCEPTANCE CRITERIA
- Given User identity, when profile opens, then displayed fields match auth/me and there is no profile-edit submission.
- Given different categories in A/B, when congress switches, then event label changes while global organization/title do not.
- Given privacy toggled off, when another peer retrieves contact/vCard, then email follows existing redaction rule after reload.
### AUTOMATED TESTS
Read-only/no-PATCH, privacy GET/PATCH persistence/failure rollback, optionalNULL snapshot, multiEvent distinction, vCard/privacy integration and canonical checks.
### MANUAL VERIFICATION
Open profile, compare auth/me response, change privacy/reload, inspect peer vCard; switch A/B categories and verify global fields stable; trigger401 and failed PATCH.
### SECURITY CHECKS
No client User-ID override; privacy server-enforced; no editing endpoint hidden in a read-only task.
### REGRESSION GUARDS
R05, R06, R16, R19, R20.
### ROLLBACK
Remove profile route presentation while preserving global privacy/User data and existing network controls; no preference reset.
### DELIVERABLES
Read-only localized profile, functioning privacy control and persistence/redaction evidence.
### DEFINITION OF DONE
Real identity read and privacy write behavior are complete, with editing explicitly absent.
### STOP CONDITION
Unapproved editing, category stored on User or DOM-only privacy proof blocks completion.

## P03-T29
### TASK ID
P03-T29
### TITLE
Deliver Congress Details from real event metadata
### PRODUCT OUTCOME
Attendees see accurate congress name, venue, dates and description without fabricated programme/speaker/map content.
### BASELINE
PublicEvent supplies name/slug/starts_at/ends_at/location/description and tiers; no scientific programme/content model exists.
### PREREQUISITES
P03-T23.
### IN SCOPE
Metadata-only Details feature; existing localized date/description rendering and public event link.
### OUT OF SCOPE
Agenda/speakers/maps/emergency notices, invented API, branding fields, conditional content tasks or fake unavailable controls.
### EXPECTED FILES
Confirmed: `web/src/pages/PublicEvent.tsx`, `backend/app/routes/public.py`, `backend/app/routes/events.py`, i18n/generated schema. Proposed: metadata Details module and data-rendering tests.
### BACKEND CONTRACT
NOT APPLICABLE: anonymous `GET /api/public/events/{slug}`;200 current event fields,404 unknown slug. No Authorization header; no new content endpoint. Respect existing timezone-aware timestamps; do not infer sessions from event date range.
### FRONTEND CONTRACT
`/c/:slug/details` in AttendeeShell becomes working. Render actual name/date range/location/description with existing locale conventions and safe text/links. Do not label date range as actual scientific schedule. Loading/empty description/missing event/network retry distinct; public content does not require a User JWT refresh. Success corresponds to selected slug and outdated async responses are ignored.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Reuse existing public metadata formatting and generated fields.
2. Separate real event details from unavailable programme/branding features.
3. Wire selected slug with anonymous client and stale-response guard.
4. Test exact values, dates/timezones and unknown slug.
### ACCEPTANCE CRITERIA
- Given event A metadata, when Details opens, then exact venue/date range/description are shown and no speaker/session is invented.
- Given no description, when rendered, then truthful empty content is shown without fake handbook.
- Given expired User session, when public Details loads, then anonymous request succeeds without transmitting the token.
### AUTOMATED TESTS
API-value/date/timezone rendering, anonymous headers,404/error/empty, multiEvent stale response, EN/FA/RTL and canonical checks.
### MANUAL VERIFICATION
Compare Details to PublicEvent API, change event venue/date via organizer then refresh, verify updated values; test empty description, unknown slug and EN/FA320/390.
### SECURITY CHECKS
No HTML/script injection from description; public data cannot reveal protected ticket/staff fields; no credentials sent.
### REGRESSION GUARDS
R10, R16, R18, R19, R20.
### ROLLBACK
Remove Details integration and retain original public event page; no content/schema data changes.
### DELIVERABLES
Working metadata-only feature and source/API rendering evidence.
### DEFINITION OF DONE
All displayed facts come from existing fields and unavailable content is not promised.
### STOP CONDITION
Fabricated scientific content, unsupported branding/API or public credential header blocks completion.

## P03-T30
### TASK ID
P03-T30
### TITLE
Complete active-congress selection and direct attendee aliases
### PRODUCT OUTCOME
All five attendee destinations follow one explicit event selection; legacy entries and offline ticket shortcuts remain direct and loop-free.
### BASELINE
Current `/my-tickets` and `/my-network` are all-event pages. Canonical five features are delivered by prerequisites; cache contains owner event slug/ID.
### PREREQUISITES
P03-T24, P03-T25, P03-T26, P03-T28, P03-T29.
### IN SCOPE
Single/multi/no-event picker; canonical route context validation; direct legacy aliases for tickets/network and proposed My Congress/Profile entry aliases where included in the approved route matrix; state reset/history/offline selection.
### OUT OF SCOPE
Redirect-only aliases, online discovery requirement for cached pass, aggregate protected cross-event views, changing printed/scanner URLs.
### EXPECTED FILES
Confirmed: `web/src/main.tsx`, MyTickets/MyNetwork, ticketCache/i18n; prerequisite feature/context modules. Proposed: congress picker/alias resolver and route-history/offline tests.
### BACKEND CONTRACT
NOT APPLICABLE: reuse User own tickets, descriptive access, anonymous event metadata and current network/bookmark APIs. Destination authorization remains independent; offline selected pass resolves owner cache without successful `/api/me/access`.
### FRONTEND CONTRACT
Canonical `/c/:slug/{my-congress,my-network,my-ticket,my-profile,details}` use validated route event. `/my-tickets` and `/my-network` render the same respective feature directly without redirect; `/my-congress` and `/my-profile`, if in the finalized route matrix, use the same direct resolver, not new feature copies. One eligible/cached event auto-selects; several prompt; none offers real public browsing. Event switch resets scoped selection/drafts/data and ignores stale responses, preserves User credential and owner cache. Loading/empty/offline401/403/404 distinct; Back/Forward preserve meaningful feature/event context. All five features now enabled and working.
### DATA MODEL IMPACT
None; remembered context cannot override validated URL or leak another owner cache.
### IMPLEMENTATION STEPS
1. Unify canonical/legacy context resolver using live and owner-cached event metadata.
2. Add accessible picker and deterministic single/no-event behavior.
3. Wire all five actual feature modules and event-switch resets.
4. Add reload/back/forward/offline/unknown-slug regression evidence.
### ACCEPTANCE CRITERIA
- Given A/B tickets, when legacy pass URL opens offline, then picker resolves from owner cache and displays selected pass without discovery success.
- Given canonical A route and remembered B, when loaded, then A wins after validation and B data does not flash.
- Given switching A→B and navigating all five destinations, when Back/Forward/reload occurs, then event/feature context remains correct without redirect loops.
### AUTOMATED TESTS
Direct-alias/no-redirect, canonical precedence, single/multiple/none, offline owner/TTL, all five actual API/action journeys, stale response/cache preservation and canonical checks.
### MANUAL VERIFICATION
In EN/FA, navigate all five tabs for A/B, reload each canonical/legacy URL, use Back/Forward, disconnect before `/my-tickets`, choose cached A, then switch accounts/unknown slug; inspect requests/data for no cross-event bleed.
### SECURITY CHECKS
Unknown context never clears another account cache; remembered IDs are not permission; aliases run the same server-protected actions.
### REGRESSION GUARDS
R03, R04, R05, R06, R07, R16, R18, R19, R20.
### ROLLBACK
Restore prior direct attendee entries while retaining cache shape/data and explicit transport; route rollback must preserve canonical bookmarked links with the same working features or direct compatible aliases, never loops.
### DELIVERABLES
Unified picker/resolver, working five-feature routing, direct aliases and history/offline evidence.
### DEFINITION OF DONE
All five destinations and required legacy entries work across event switches, reload/history and offline pass access.
### STOP CONDITION
Online-only pass selection, redirect alias, missing working tab or cross-event/cache exposure blocks completion.

## P03-T31
### TASK ID
P03-T31
### TITLE
Introduce OrganizerShell without changing tenant management
### PRODUCT OUTCOME
Organizers retain working event administration in a distinct shell with explicit tenant gate and shallow event workspace.
### BASELINE
OrganizerLayout and OrganizerEvents already manage key gate/event listing; OrganizerEventDetail is a large working page.
### PREREQUISITES
P03-T21, P03-T05.
### IN SCOPE
Shell/event selection/navigation; preserve existing management pages and tenant-key lifecycle; reception operational entry is clearly separate.
### OUT OF SCOPE
User organizer association, manager extractions, new scanner-device UI, automatic reception fallback or replacing working admin with placeholders.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerLayout.tsx`, `OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `OrganizerAnalytics.tsx`, `web/src/main.tsx`, i18n. Proposed: OrganizerShell/navigation modules following conventions.
### BACKEND CONTRACT
NOT APPLICABLE: organizer `GET/POST /api/events`, `GET/PATCH /api/events/{event_id}` and existing admin families. Tenant key only;401 gate, authenticated foreign event404; preserve validation/conflicts. No Organizer role from User resolver.
### FRONTEND CONTRACT
Preserve `/organizer`, `/organizer/events/:eventId`, analytics URL. Shell shows tenant event list/current event and shallow workspace sections; each existing working manager remains enabled. Selected event validated via owned API; loading/empty/create/error/401/404 explicit. Key clearing clears organizer state only. Reception link labels distinct operator versus deliberate organizer operations, not a child layout requirement; actual independent station delivered later. Back/history and EN/FA responsive nav remain functional.
### DATA MODEL IMPACT
None.
### IMPLEMENTATION STEPS
1. Refactor layout/navigation around existing working outlets.
2. Bind event selection to owned event API and ignore stale responses.
3. Preserve event create/update and existing manager actions untouched in semantics.
4. Test key gate/foreign404 and persisted event management.
### ACCEPTANCE CRITERIA
- Given valid key, when create/update event through shell, then persisted values match and existing sections operate.
- Given only User JWT, when organizer deep link opens, then key gate prevents protected dispatch.
- Given foreign event ID, when loaded, then404 with no foreign title/data and no redirect loop.
### AUTOMATED TESTS
Shell routing/key authority, create/update persistence, event-switch race, foreign404, existing organizer suites and canonical checks.
### MANUAL VERIFICATION
Create/update fixture event, navigate all existing sections/analytics and Back; clear key and deep-link, then supply foreign key; inspect headers and320/390 EN/FA layout.
### SECURITY CHECKS
No User-to-organizer inference; tenant masks preserved; organizer secret never rendered/logged.
### REGRESSION GUARDS
R10, R16, R18, R19, R20.
### ROLLBACK
Restore original organizer layout around unchanged working managers; keep event data/key storage and URLs.
### DELIVERABLES
Working OrganizerShell, preserved actions and tenant/navigation evidence.
### DEFINITION OF DONE
Shell does not remove any existing management workflow or weaken tenant gate.
### STOP CONDITION
Placeholder replacement, organizer identity inference or event-mask regression blocks completion.

## P03-T32
### TASK ID
P03-T32
### TITLE
Extract the working ticket-tier manager
### PRODUCT OUTCOME
Organizers maintain tier inventory in a bounded feature without quota/admission changes.
### BASELINE
Tier create/list/PATCH and UI exist inside OrganizerEventDetail; tier quota is not attendee taxonomy.
### PREREQUISITES
P03-T31.
### IN SCOPE
Extraction/reuse of current forms/list/status handling; preserve quota editing safeguards and counters.
### OUT OF SCOPE
Pricing/payment, tier deletion, category merge, quota algorithm or Ticket reassignment changes.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerEventDetail.tsx`, `backend/app/routes/ticket_tiers.py`, tier/management/ticket/concurrency tests and i18n. Proposed: bounded tier-manager module and extraction/action regression tests.
### BACKEND CONTRACT
NOT APPLICABLE: organizer `POST/GET /api/events/{event_id}/ticket-tiers`, `PATCH .../{tier_id}`. Create name1–100/description≤2000/quota1–1000000/is_open; PATCH uses existing fields. Return tier incl reserved_count; preserve current quota-below-reservation conflict/validation behavior, missing/wrong-event404, invalid key401/422. No DELETE. Reservation still uses atomic server logic and existing400/409/410 statuses.
### FRONTEND CONTRACT
Organizer event Tiers section renders extracted working feature. Local draft, loading/empty/error; validation/conflict retains draft;401 gate only;404 missing owned context. Success refetches server counters rather than locally guessing reservations. Type controls remain separate. No new nested navigation; EN/FA number/RTL labels reused.
### DATA MODEL IMPACT

None.
### IMPLEMENTATION STEPS
1. Move tier responsibility at a bounded interface of event ID/organizer authority.
2. Preserve request bodies and existing validation/error behavior.
3. Remove obsolete duplicated page handlers/state after cutover.
4. Exercise persisted edits and live reservation counter behavior.
### ACCEPTANCE CRITERIA
- Given tier with reservations, when manager reloads, then exact server reserved_count/quota display.
- Given quota lowered below existing reservations, when saved, then current server rejection is visible and persisted quota does not change.
- Given tier closed/sold-out, when reservation attempted, then400/410 remain unchanged and no extra ticket is issued.
### AUTOMATED TESTS
Extraction contract/action persistence, draft-on-conflict, event-switch isolation, existing tier/management/ticket/concurrency suites and canonical checks.
### MANUAL VERIFICATION
Create tier, reserve ticket, reload manager, edit name/quota/open state, attempt invalid below-reserved quota; verify API counts and public reservation errors.
### SECURITY CHECKS
Only organizer modifies inventory; no frontend counter authority; no category affecting tier policy.
### REGRESSION GUARDS
R01, R02, R10, R15, R16, R20.
### ROLLBACK
Restore original tier presentation/handlers as one reviewed extraction rollback with no duplicate writers; tier/ticket data unchanged.
### DELIVERABLES
Bounded working manager, removed obsolete page code, persisted/quota evidence.
### DEFINITION OF DONE
Original tier behavior and inventory invariants survive extraction.
### STOP CONDITION
Changed quota rules, copied stale counters, duplicate handlers or DOM-only save proof blocks completion.

## P03-T33
### TASK ID
P03-T33
### TITLE
Extract point and admission-policy administration
### PRODUCT OUTCOME
Organizers manage existing gates/policies in a bounded feature while scanners retain unchanged operational semantics.
### BASELINE
Point create/list/PATCH UI exists; current page does not contain scanner token/device management despite older docs' claims.
### PREREQUISITES
P03-T31.
### IN SCOPE
Extract existing point/policy forms and real current controls; preserve policy validation and tier choices.
### OUT OF SCOPE
Scanner engine rewrite, adding absent token/device UI, new policy types, scanner shell, native work.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerEventDetail.tsx`, `backend/app/routes/checkin.py`, scanner/policy/management tests, GateScanner and scanner libs intentionally unchanged. Proposed: point-manager module and extraction/action tests.
### BACKEND CONTRACT
NOT APPLICABLE: organizer `POST/GET /api/events/{event_id}/checkin-points`, `PATCH .../{point_id}` with current name/location/policy_type/allowed_tier_ids/max_capacity. Preserve MULTI_ENTRY, SINGLE_USE, TIER_RESTRICTED, CAPACITY_CAPPED and existing validations/errors;401 invalid key,404 wrong-event point,422/body and current policy conflict handling. Existing manifest/batch/device contracts are reused unchanged, not exposed as newly extracted UI.
### FRONTEND CONTRACT
Organizer event Gates section; current forms/list and policy-dependent fields work with explicit organizer adapter. Loading/empty/error; rejected save retains draft; success refetches point policy. Tier selection comes from same owned event, not attendee types. Existing scanner link remains `/scan/:pointId` direct. No automatic device token issuance.
### DATA MODEL IMPACT
None; existing point policies only.
### IMPLEMENTATION STEPS
1. Extract point manager around event/authority inputs.
2. Preserve conditional policy fields and same-event tier data.
3. Delete replaced duplicated handlers/state; leave scanner operational code unchanged.
4. Verify persisted policy effects through existing scanner API tests.
### ACCEPTANCE CRITERIA
- Given gate edited to tier-restricted, when saved and manifest/batch used, then existing policy admits/rejects based on selected tier exactly as before.
- Given invalid capacity/tier input, when rejected, then persisted point is unchanged and draft is recoverable.
- Given existing scanner bookmark, when extraction lands, then direct route and queue/revocation behavior remain unchanged.
### AUTOMATED TESTS
Point create/PATCH persistence and conditional fields, event404, policy/scan/concurrency suites, scanner offline/regression suites and canonical checks.
### MANUAL VERIFICATION
Create fixtures for all four policy types, inspect saved API values and scanner decisions; edit a policy, reload; open scanner bookmark and confirm no redirect or new device controls claim.
### SECURITY CHECKS
Policy remains backend-enforced; only same-event tiers; no automatic key-to-scanner substitution.
### REGRESSION GUARDS
R10, R13, R14, R15, R16, R17, R18, R20.
### ROLLBACK
Restore previous manager presentation with existing policy data untouched; no scanner queue/schema rollback.
### DELIVERABLES
Working bounded point manager, removed duplicates and policy compatibility evidence.
### DEFINITION OF DONE
All existing policy configuration/actions work and scanner behavior remains unchanged.
### STOP CONDITION
New policy semantics, fabricated token UI or scanner state-machine edits blocks completion.

## P03-T34
### TASK ID
P03-T34
### TITLE
Extract reception operator management with truthful credentials
### PRODUCT OUTCOME
Organizers provision/list/revoke/reactivate reception operators and understand the actual reusable password/session lifecycle.
### BASELINE
Operator manager exists in OrganizerEventDetail; missing User gets a reusable generated global password displayed once, existing User/reactivation gets no new secret. P03-T02 hardens generations.
### PREREQUISITES
P03-T31, P03-T02.
### IN SCOPE
Working operator manager extraction; truthful temporary password messaging; persisted revoke/reactivate and generation effects.
### OUT OF SCOPE
One-use invitation/reset/forced-password-change redesign, new account lifecycle, storing/redelivering plaintext password, independent station implementation.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerEventDetail.tsx`, `backend/app/routes/desk.py`, operator/management tests and i18n. Proposed: bounded operator-manager module and lifecycle browser tests.
### BACKEND CONTRACT
NOT APPLICABLE: organizer `GET/POST /api/events/{event_id}/desk/operators`; `POST .../operators/{operator_id}/revoke`; existing `DELETE .../operators/{operator_id}` is revoke alias, not `/revoke` DELETE. Preserve current create body/result and temporary_password nullable. Revoke/reactivate generation increment from P03-T02; invalid key401, foreign/missing operator404. Desk JWT cannot administer operators. No password reset contract added.
### FRONTEND CONTRACT
Organizer event Reception Staff section: active/revoked list, assign/create/reactivate, explicit revoke confirmation, one-response password display only. Label generated password reusable global User credential, not one-use/expiring invitation; existing User uses existing password and no secret is invented. Loading/empty/error; failed mutations keep draft; success refetches rows. Do not persist password in browser storage/logs; closing display clears local secret state. Link to reception uses separate credential entry.
### DATA MODEL IMPACT
Existing operator lifecycle/generation only; no migration.
### IMPLEMENTATION STEPS
1. Extract manager preserving current provisioning and list contracts.
2. Correct credential wording and ephemeral display handling.
3. Wire revoke/reactivate with current row/generation results.
4. Remove obsolete large-page code and add actual login/revoke evidence.
### ACCEPTANCE CRITERIA
- Given new User operator, when provisioned, then response password is displayed once with truthful reusable-global wording and not persisted.
- Given existing User/reactivation, when assigned, then no password appears and existing password is unchanged.
- Given retained token A, when revoked/reactivated, then A stays401 and new login B succeeds.
### AUTOMATED TESTS
Manager/API action persistence, ephemeral secret/no storage, existing-User password stability, exact lifecycle401/403, wrong-family admin401/tenant404 and canonical checks.
### MANUAL VERIFICATION
Create new operator, record password privately only for fixture login, close panel/reload and confirm no redisplay; assign existing User; revoke/reactivate and test retained token versus fresh login; inspect logs/storage for no plaintext secret.
### SECURITY CHECKS
Never call password one-time; no secret logging; organizer-only administration; generations cannot reset.
### REGRESSION GUARDS
R10, R11, R12, R16, R19, R20.
### ROLLBACK
Restore old manager presentation only with generation-aware lifecycle and corrected credential messaging; preserve operator/revocation state and never reissue stored secrets.
### DELIVERABLES
Extracted operator manager, truthful UX, removed duplicate code and lifecycle/secret evidence.
### DEFINITION OF DONE
All provision/list/revoke/reactivate actions work against real API and password limitations are explicit.
### STOP CONDITION
Claimed one-use password, persisted secret, generation bypass or missing working revoke blocks completion.

## P03-T35
### TASK ID
P03-T35
### TITLE
Deliver Partner administration and explicit staff/Booth capability UI
### PRODUCT OUTCOME
Organizers manage real Partners and existing-User memberships with independently selected Booth grants, without commercial access ambiguity.
### BASELINE
Legacy Booth manager exists; P03-T12–P03-T14 deliver Partner management and exact transactional grant contracts.
### PREREQUISITES
P03-T31, P03-T12, P03-T13, P03-T14.
### IN SCOPE
Create/list/edit Partner; Booth creation with optional explicit link; existing-User staff selection; profile-only versus exact Booth grant UI; narrow/full removal; preserve legacy Booth management.
### OUT OF SCOPE
Partner hard delete/archive, representative profile editor, invitations/password creation, automatic all-Booth grant, QR redesign or heuristic regrouping.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerEventDetail.tsx`, existing Booth forms/staff/QR rendering, generated schema/i18n. Proposed: bounded Partner/admin staff-capability modules; one integration owner manages page extraction.
### BACKEND CONTRACT
NOT APPLICABLE: reuse P03-T12 Partner POST/GET/PATCH, P03-T13 staff POST/GET/DELETE and narrow Booth unassignment, P03-T14 Booth create/legacy staff. Explicit organizer Bearer. Absent new Partner assignee User409 instructs public registration first; selected Booth outside Partner/event404; repeated grant200; full/narrow delete204. Existing legacy Booth provisioning remains separately labeled, not silently used to bypass new Partner existing-User409.
### FRONTEND CONTRACT
Organizer event Partners & Booths section: real zero/many Booth profile list/forms, Partner select on new Booth, exact checkbox selections only from chosen Partner/event. Empty selection means profile-only; full membership removal confirmation explains all this Partner's Booth grants removed; per-Booth unassign explains profile remains. Loading/empty/401/404/409/422/error states; failures retain draft and don't display optimistic grants; success refetches actual staff/grant state. No hard-delete/archive buttons. EN/FA labels distinguish Partner Organization, physical Booth and lead capability.
### DATA MODEL IMPACT
Only delivered Partner/Booth/staff contracts; no migration.
### IMPLEMENTATION STEPS
1. Extract/reuse current Booth manager into bounded Partner workspace administration.
2. Add working Partner forms/link selector and explicit existing-User staff form.
3. Add separate narrow/full removal actions with truthful confirmation.
4. Remove replaced duplicate code and test persisted permissions with real User JWT.
### ACCEPTANCE CRITERIA
- Given boothless sponsor, when created/profile-only staff assigned, then real Partner membership exists and User has no Booth lead access.
- Given P:A/B, when organizer grants A only, then same User JWT accesses A and gets403 for B; UI lists exact grant.
- Given absent email, when new Partner assignment returns409, then no User/grant is created and UI instructs registration.
- Given full removal, when confirmed, then all P grants disappear immediately while Q remains; narrow A removal retains P profile.
### AUTOMATED TESTS
API-backed create/PATCH/link/grant/removal UI, zero/many Booth, existing-User409/no fallback, transactional failure, same-event capability matrix, QR/bookmark/lead regressions and canonical checks.
### MANUAL VERIFICATION
Create sponsor P and exhibitor Q with two Booths, assign registered User profile-only then A only, test protected profile/A/B APIs; unassign A then remove membership; submit unregistered email and verify409/no row; open existing Booth QR/standee.
### SECURITY CHECKS
Form filtering is not authorizer; never grant selected Partner's all Booths; no client role/ownership mutation; destructive confirmation matches exact transactional scope.
### REGRESSION GUARDS
R07, R08, R09, R10, R16, R18, R19, R20.
### ROLLBACK
Restore prior working admin presentation with compatible Partner/link writes retained; do not delete Partners, detach Booths, resurrect grants or drop schema.
### DELIVERABLES
Working bounded Partner/staff/Booth UI, removed duplicate page code and real permission/persistence evidence.
### DEFINITION OF DONE
Every named admin action operates against exact contracts and resulting profile/lead permissions are exercised, not merely rendered.
### STOP CONDITION
Implicit leads, missing-User provisioning bypass, hard delete/archive or lost legacy Booth workflow blocks completion.

## P03-T36
### TASK ID
P03-T36
### TITLE
Preserve organizer analytics filtering, polling and export
### PRODUCT OUTCOME
Organizer analytics remains accurate and tenant-scoped through shell integration, with existing filters, ten-second refresh and CSV export.
### BASELINE
OrganizerAnalytics already loads event/tiers/points/attendance, filters results, polls every10 seconds and exports server CSV.
### PREREQUISITES
P03-T31.
### IN SCOPE
Shell/event-context integration and bounded extraction only where needed; preserve exact current filters, polling cleanup and export contract.
### OUT OF SCOPE
New metrics/aggregate API, private lead analytics, changed polling cadence, charts with fabricated data, scanner-policy rewrite.
### EXPECTED FILES
Confirmed: `web/src/pages/OrganizerAnalytics.tsx`, `backend/app/routes/analytics.py`, `backend/tests/test_analytics.py`, event/tier/point contracts and i18n. Proposed: integration/filter/poll/export browser tests using existing module boundaries.
### BACKEND CONTRACT
NOT APPLICABLE: organizer `GET /api/events/{event_id}/analytics/attendance` with current filter query parameters and existing response metrics; `GET .../analytics/export-csv` retains its actual server export scope and sanitized UTF-8 CSV. Do not pretend export accepts active filters if existing contract does not; UI labels scope truthfully. Event/point/tier reads remain organizer-only. Invalid key401; foreign event404; existing parameter validation retained.
### FRONTEND CONTRACT
Keep `/organizer/events/:eventId/analytics` in OrganizerShell. Preserve existing filters and ten-second polling; clear interval/ignore outdated requests on unmount/event/authority change; no overlapping stale result overwrites. Loading/zero metrics/error/retry distinct;401 clears sent key only;404 masks event. Dashboard success matches the selected event/filter query. Export uses the explicit organizer client and real server filename/content; CSV has no filter parameters and exports all rows of the selected event, clearly labeled event-wide. Show server timestamp/current refresh state without inventing measurements.
### DATA MODEL IMPACT
Read-only existing checkins/tickets/tiers/points; none.
### IMPLEMENTATION STEPS
1. Integrate analytics under current shell without altering metric definitions.

2. Preserve filter-to-query mapping and poll cleanup.
3. Preserve CSV server sanitization/download and label actual scope.
4. Test fixture counts/query parameters/interval lifecycle and CSV bytes.
### ACCEPTANCE CRITERIA
- Given fixture attendance in A/B and multiple gates/tiers, when A filters change, then requests/metrics match existing A filter semantics and no B data appears.
- Given navigation away or event switch, when another10-second tick occurs, then old polling stops and delayed A result cannot overwrite B.
- Given CSV export, when downloaded, then content/filename follow server contract and dangerous cells remain sanitized; UI does not mislabel unfiltered export as filtered.
### AUTOMATED TESTS
Current analytics suite, filter query/value assertions, fake-clock interval cleanup plus live API counts, race/tenant404, CSV BOM/headers/sanitization/scope and canonical checks.
### MANUAL VERIFICATION
Seed isolated A/B attendance with gate/tier variety, set each current filter and compare API metrics, wait through refresh, navigate away/switch event and inspect no stale polling; download/read CSV and test foreign tenant key.
### SECURITY CHECKS
Tenant-only data; no User/desk fallback; CSV injection sanitization remains server-side; credentials excluded from export filename/content/logs.
### REGRESSION GUARDS
R10, R15, R16, R19, R20; preserve R09 export-security conventions without adding private lead analytics.
### ROLLBACK
Restore prior analytics presentation/poll integration while retaining read contracts/data and explicit organizer transport; no DB/data rollback needed.
### DELIVERABLES
Working analytics shell integration and filter/poll/CSV/tenant evidence.
### DEFINITION OF DONE
Actual metrics, refresh lifecycle and CSV behavior are preserved with API/content evidence.
### STOP CONDITION
Changed metric/filter/export semantics, stale-event overwrite, missing polling cleanup or tenant exposure blocks completion.

## Task-size review — assigned rows

| Rows | Review and executable boundary |
|---|---|
| P03-T00 | One authorization/reproducibility gate. Local commits are conditional on separate human approval; no implementation feature hidden inside baseline work. |
| P03-T01 | One auth-family/status contract; not a session-system rewrite. |
| P03-T02 | One revoke/reactivate generation invariant across schema/issuer/authorizer/lifecycle/tests; these pieces cannot independently establish the security outcome. |
| P03-T03 | One pure transport interface; excludes shells and callsite-wide cutover. |
| P03-T04–P03-T08 | Five authority-specific runnable caller slices. Shared factory interface is fixed first; shared files need one integration owner. No slice may retain fallback as its completed behavior. |
| P03-T09 | One final caller/removal gate; old heuristic/shims deleted, not kept for a release. |
| P03-T10 | One read-only existing-row discovery response; no Partner schema or UI. |
| P03-T11 | One populated ownership/backfill invariant spanning model/migration/tests; no HTTP/UI or lead re-keying. |
| P03-T12 | One organizer Partner create/read/update contract and required future terminology amendment; no lifecycle deletion or staff grants. |
| P03-T13 | One transactional membership/capability lifecycle, including narrow versus full removal; required cases are one least-privilege invariant. |
| P03-T14 | One legacy-write compatibility boundary; keeps legacy provisioning distinct from new Partner assignment policy. |
| P03-T15 | One Partner read boundary for protected/public audiences; no editing/discovery duplicate. |
| P03-T16 | One additive enrichment of existing discovery. |
| P03-T17 | One category/history expansion invariant, serialized after Partner expansion; no API/UI. |
| P03-T18 | One event taxonomy management/discovery contract for organizer/public/desk; active-only discovery and no DELETE are integral. |
| P03-T19 | One creation-time category/history invariant in two existing issuance paths; no selectors, reassignment or policy expansion. |
| P03-T20 | One functioning taxonomy manager against delivered contracts. |
| P03-T21 | One shared boundary/navigation/async primitive package using existing React tools; no state-library adoption or all-shell scaffold. |
| P03-T22 | One eligibility-versus-credential entry/chooser flow; direct destination features remain their own tasks. |
| P03-T23 | One attendee navigation shell with existing working features; unfinished tabs remain disabled, not delivered empty pages. |
| P03-T24–P03-T29 | Six bounded attendee features with observable data/actions: offline pass, scoped network/vCard, hub/saved actions, embedded directory, profile/privacy, and metadata Details. No aggregate API or optional editing/content implementation. |
| P03-T30 | One final attendee event/picker/direct-alias integration boundary after all five feature destinations work. |
| P03-T31 | One organizer shell integration preserving working management and tenant gate. |
| P03-T32–P03-T34 | Three independently testable existing-manager extractions: tiers, points/policies, operators. One owner should edit OrganizerEventDetail sequentially; no scanner/password redesign bundled. |
| P03-T35 | One Partner administration feature using stable delivered domain APIs; includes required related staff/Booth controls but excludes invitations, deletion/archive and representative editing. Review size after binding existing Booth extraction: split internal commits by profile/link versus capability actions without changing fixed task IDs/dependencies or accepting a partial task. |
| P03-T36 | One analytics preservation/integration boundary; no new metrics or API. |

All rows require observable persisted data, transport, permission, downloaded-content or runtime-state evidence; a rendered heading/button alone is not acceptance. No task adds generic padded work, speculative exact module filenames, implementation permission for approval-blocked enhancements, or a lossy schema downgrade as rollback. Canonical and focused checks are future execution requirements, not Phase03 activity.

---

# Phase 03 backlog — P03-T37 through P03-T66

Planning only. No application, database, dependency, test, Git, deployment or issue operation is authorized by this text. Baselines below are source observations, not executed verification. Earlier pass counts are historical, not current evidence. Proposed modules are responsibilities; their exact filenames must be chosen during implementation using existing repository conventions. Previously delivered prerequisite modules must be located from their completion reports, not assumed to exist today.

## Shared execution and evidence rules

Each future implementation task verifies its exact prerequisites and approved baseline, adds the listed behavior tests, records task-specific results, then runs the canonical root gate: Windows `scripts\check.bat`; POSIX `./scripts/check.sh`. Inspect the wrappers first because current Windows WSL/Dart paths are workstation-specific. An unavailable environment is BLOCKED, not PASS. Web behavior cases below must be tagged with the full task ID; run them from `web` with `npx playwright test --project=msedge --grep "P03-Tnn"`. New browser test modules are proposed, not existing. `npm test`, `npm run typecheck`, `npm run build` and `npm run lint` run from `web`; backend commands run from `backend`. Browser cases requiring authorization must use an actual disposable API/database and synthetic accounts; mocked failures are additional evidence, not a substitute. No tests are run during Phase 03 preparation.

Every frontend contract below includes: initial/loading, successful populated, empty when meaningful, recoverable network/server failure with explicit retry, 401 affecting only the actual credential used, 403 denied without credential deletion, and 404 missing/masked without credential deletion. Disable unsafe actions while authority/context is unresolved. Never retry with another credential. Stale responses must not populate a different selected event/Partner/Booth. Form drafts survive recoverable errors; success clearing and deliberate logout clearing are explicit. Protected reception actions are online-only; cached presentation does not authorize operations. Test EN/LTR and FA/RTL at 320px and 390px for each changed UI; P03-T62 expands this to all seven widths.

User-fixed regression guards: R01 Existing Attendee registration; R02 TicketTier quota enforcement; R03 digital QR ticket; R04 offline ticket access; R05 attendee networking; R06 vCard export; R07 Booth profile/brochures; R08 partner lead capture; R09 qualification/export; R10 Organizer event management; R11 DeskOperator issuance; R12 DeskOperator revocation; R13 scannerPWA; R14 scan synchronization; R15 admission policies; R16 tenant isolation; R17 device revocation; R18 printedQR URLs; R19 localizationRTL; R20 API credential isolation.

---

## P03-T37
### TASK ID
P03-T37

### TITLE
Independent ReceptionShell and canonical route

### PRODUCT OUTCOME
A reception operator opens `/reception/:eventId` without entering OrganizerLayout or supplying an organizer key.

### BASELINE
`web/src/main.tsx` mounts the current desk page beneath OrganizerLayout. `OrganizerDesk.tsx` consumes Organizer outlet context and computes organizer-key-or-desk-token precedence. The backend already supports event-bound desk operations.

### PREREQUISITES
P03-T21, P03-T07.

### IN SCOPE
Independent shell, canonical route, event parameter boundary, reception-only navigation, explicit selected authority mode, and integration with delivered transport/status primitives.

### OUT OF SCOPE
Login form extraction belongs to P03-T38; lookup, issuance and legacy alias cutover belong to later tasks. No organizer identity convergence or scanner change.

### EXPECTED FILES
Confirmed existing: `web/src/main.tsx`, `web/src/pages/OrganizerDesk.tsx`, `web/src/pages/OrganizerLayout.tsx`, `web/src/lib/i18n.ts`. Proposed/prerequisite-delivered: ReceptionShell, reception context boundary and browser route tests. No invented exact module paths.

### BACKEND CONTRACT
Reuse `GET /api/events/{event_id}/desk/me` and existing desk authorization. Operator mode uses only the selected event desk JWT; deliberately selected organizer operational mode uses only its organizer key. Never automatic fallback. Existing invalid desk token 401; wrong-event/nonmember 403; foreign organizer 404.

### FRONTEND CONTRACT
Apply shared states. Missing desk session shows independent entry, not organizer-key prompt; unresolved event blocks operations. Explicit organizer mode is labeled and does not appear merely because a key is stored. No Organizer menu or Outlet dependency.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Locate P03-T21/P03-T07 interfaces and preserve storage keys.
2. Extract shell-level locale/context responsibilities without operational mutations.
3. Register `/reception/:eventId` outside OrganizerLayout and bind authority to route context.
4. Add route isolation, reload and status tests; update implementation-facing route documentation.
5. Mount the existing functional station content using its decoupled reception context so current login/search/issuance/retrieval/print remain usable; do not ship a placeholder station. P03-T38–T43 subsequently extract or extend those working workflows; no automatic organizer fallback or alternate duplicated implementation is introduced.

### ACCEPTANCE CRITERIA
- Given no organizer key, when the canonical route reloads, then independent reception entry renders.
- Given organizer and desk credentials coexist, when operator mode is selected, then only the desk credential is sent.
- Given a wrong-event response, when it returns 403, then operations are blocked and no alternate credential is tried.

### AUTOMATED TESTS
Browser tag P03-T37: direct route/reload, missing session, both-credential mode selection, 401/403/404 and stale event response. Run web checks and canonical root gate.

### MANUAL VERIFICATION
Store synthetic organizer and event-A desk credentials; open `/reception/{eventA}` directly, reload, inspect request Authorization owner, switch explicit mode, then open event B. Repeat EN/FA at 320/390px; verify no Organizer navigation or automatic fallback.

### SECURITY CHECKS
Shell context never proves server permission; do not expose credential values or transmit organizer key in operator mode.

### REGRESSION GUARDS
R10, R11, R12, R16, R18, R19, R20.

### ROLLBACK
Revert canonical-route/shell integration as a coherent UI change; leave existing desk route available and retain explicit transport hardening.

### DELIVERABLES
Independent route/shell, route behavior tests, updated implementation route record and evidence report.

### DEFINITION OF DONE
All shell acceptance cases and required checks pass with current evidence; operational tasks are not falsely declared delivered. Task-size review: one routing/authority boundary, not a full reception rewrite.

### STOP CONDITION
Stop after P03-T37; absent prerequisite interfaces or conflicting router ownership means BLOCKED, not a second shell convention.

---

## P03-T38
### TASK ID
P03-T38

### TITLE
Reception email/password entry and assigned-event identity

### PRODUCT OUTCOME
An assigned operator signs into the selected event and sees their operator and congress identity.

### BASELINE
`OrganizerDesk.tsx` already posts email/password, stores `congress_desk_token_${eventId}`, and displays login/event identity, but depends on organizer context.

### PREREQUISITES
P03-T37.

### IN SCOPE
Extract working event-specific login/logout and identity display into the independent shell; preserve event-keyed storage and truthful password wording.

### OUT OF SCOPE
No new registration, invitation, password reset, one-use password, forced change, organizer association or credential substitution.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `web/src/lib/i18n.ts`, `backend/tests/test_desk_operator_auth.py`. Proposed: reception entry/session and header modules, browser login tests.

### BACKEND CONTRACT
Anonymous `POST /api/events/{event_id}/desk/login` body `{email,password}`; success includes access token/operator/event identity. Bad credentials 401; revoked login or valid User without event membership 403; missing event 404. Protected identity uses `/desk/me` with the selected credential. Temporary global password is reusable, not one-use.

### FRONTEND CONTRACT
Entry, submitting, successful identity, protected-session checking, rejected credentials, denied assignment, missing event and network failure are distinct. Password is never persisted; clear it after successful login. Logout removes only the event desk session and clears reception PII, not User/Organizer/scanner credentials.

### DATA MODEL IMPACT
None; consumes P03-T02 generation-aware sessions.

### IMPLEMENTATION STEPS
1. Extract anonymous login and event-specific storage adapter.
2. Bind returned event/operator identity to the route and validate using `/desk/me`.
3. Implement precise login failures and event-local logout.
4. Test response races, storage isolation and truthful credential copy; document entry behavior.

### ACCEPTANCE CRITERIA
- Given an assigned operator, when correct credentials are submitted for event A, then only event-A session is stored.
- Given valid global credentials without assignment, when login returns 403, then no desk session is created.
- Given another portal credential, when desk login runs, then the request carries no Authorization header.

### AUTOMATED TESTS
Backend `uv run pytest tests/test_desk_operator_auth.py -q`; browser tag P03-T38 for login statuses, event switch during response, reload and logout isolation; web/canonical gates.

### MANUAL VERIFICATION
Use assigned, revoked and nonmember synthetic Users; log into `/reception/{eventA}` with each. Inspect login headers, reload successful session, open event B, and logout event A while a User session remains. Repeat EN/FA; verify reusable-password wording and no stored plaintext password.

### SECURITY CHECKS
Never issue desk session from User eligibility alone; no organizer-key fallback; redact passwords/tokens in evidence.

### REGRESSION GUARDS
R11, R12, R16, R19, R20.

### ROLLBACK
Revert entry extraction without changing backend login or event-keyed storage; retain independent shell boundary.

### DELIVERABLES
Reception entry/header/session behavior, negative login tests and implementation documentation.

### DEFINITION OF DONE
Assigned-event identity and session isolation have API-backed evidence and all checks pass. Task-size review: one existing entry workflow, no account-lifecycle redesign.

### STOP CONDITION
Stop after P03-T38; missing desk membership or failed generation prerequisite is BLOCKED.

---

## P03-T39
### TASK ID
P03-T39

### TITLE
Authorized event attendee search and detail

### PRODUCT OUTCOME
Reception finds and opens only attendees belonging to its selected congress.

### BASELINE
Existing desk page searches after 200ms, requests limit 30, and opens attendee details/history, but search/detail error handling is incomplete.

### PREREQUISITES
P03-T38.

### IN SCOPE
Extract event-scoped search, explicit ticket selection and detail/history using existing contracts; prevent stale results across query/event/session changes.

### OUT OF SCOPE
No global attendee search, new pagination API, ticket mutation, category reassignment or automatic duplicate selection.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `backend/tests/test_desk_registration.py`, `backend/tests/test_desk_operator_auth.py`. Proposed: reception search/detail modules and tagged browser cases.

### BACKEND CONTRACT
`GET /api/events/{event_id}/attendees?q=...&limit=30` (server limit 1–100); `GET /api/events/{event_id}/attendees/{ticket_id}`. Event-authorized desk/explicit organizer mode only. Detail foreign/missing ticket 404; wrong-event desk 403; invalid session 401. Preserve ticket, QR, tier, issuer and scan-history fields.

### FRONTEND CONTRACT
Idle search instruction, searching, results, no matches, detail loading/populated/no history, request failure and shared auth/missing states. Do not retain visible previous-event PII. Selection is explicit; no result opens itself.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Extract controlled debounced search and event-bound request identity.
2. Prevent old query/context responses from replacing current results.
3. Extract detail/history with explicit selection and safe close/focus behavior.
4. Add API isolation and browser error/race cases; document search boundaries.

### ACCEPTANCE CRITERIA
- Given attendees in A/B, when A reception searches, then only A results appear.
- Given two quickly entered queries, when the older response arrives last, then newer results remain.
- Given a B ticket ID, when A detail is requested, then 404 exposes no B attendee data.

### AUTOMATED TESTS
`uv run pytest tests/test_desk_registration.py tests/test_desk_operator_auth.py -q`; browser P03-T39 tests debounce/race, empty, detail history and 401/403/404/5xx; web/canonical gates.

### MANUAL VERIFICATION
Seed A/B attendees with similar names; search name, email and organization in A, select an A ticket, inspect history, and request B ticket via A context. Change search rapidly and event context during an in-flight response. Repeat EN/FA at 320/390px.

### SECURITY CHECKS
No client-supplied User authority; preserve server event authorizer; errors must not display foreign PII.

### REGRESSION GUARDS
R03, R11, R12, R16, R19, R20.

### ROLLBACK
Restore legacy search/detail rendering while leaving backend contracts and explicit authority unchanged.

### DELIVERABLES
Search/detail modules, race/ownership tests, documented states and evidence.

### DEFINITION OF DONE
Lookup/history and all negative states pass. Task-size review: existing read-only lookup boundary, not issuance or duplicate recovery.

### STOP CONDITION
Stop after P03-T39; unresolved event/session blocks requests.

---

## P03-T40
### TASK ID
P03-T40

### TITLE
Walk-in issuance with separate category and tier selectors

### PRODUCT OUTCOME
Reception issues a pass with an optional event category while quota/admission continue to depend on TicketTier.

### BASELINE
Desk registration already accepts identity fields and tier, creates/reuses User, issues Ticket/EntityQR and attributes the operator. Category is a new prerequisite-delivered contract, not current source capability.

### PREREQUISITES
P03-T39, P03-T19.

### IN SCOPE
Extract walk-in form; optional active-category selector separate from tier; use historical name output and preserve identity/quota behavior.

### OUT OF SCOPE
No post-issuance category reassignment, category pricing/quota/admission policy, guessed duplicate identity, password/onboarding redesign or printer integration.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `backend/tests/test_desk_registration.py`, `backend/tests/test_tickets.py`. Proposed/prerequisite-delivered: reception issuance form, Type API/client schema and behavior tests.

### BACKEND CONTRACT
Read `/desk/tiers` and `GET /api/events/{event_id}/desk/attendee-types`; submit `POST /api/events/{event_id}/desk-registrations` with existing fields plus optional nullable `attendee_type_id`. Only active same-event category is valid; output `attendee_type_name_at_issue` is immutable. Preserve 201 issuance, 409 duplicate, 404 foreign/missing tier, 400 closed tier, 410 exhausted tier and P03-T19 category validation statuses.
Exact category outcomes: omitted/null accepted; missing or wrong-event type404; inactive same-event type409; malformed UUID422. Validate and lock the type before any quota mutation; rejected category creates no Ticket/QR and consumes no quota.

### FRONTEND CONTRACT
Form loading, no active category (valid None), no available tier (issuance disabled), validation, submitting, issued pass and precise rejection states. Keep draft on failure; one in-flight submit; no automatic retry. Clear attendee fields only after confirmed success.

### DATA MODEL IMPACT
None beyond P03-T19. Category stored on Ticket, never User; no new migration here.

### IMPLEMENTATION STEPS
1. Read delivered category schema and validation statuses.
2. Extract form and load separate category/tier options.
3. Send optional category without altering quota flow; render returned historical label.
4. Test null/category/tier outcomes and preserve issuer attribution; update workflow docs.

### ACCEPTANCE CRITERIA
- Given no category selection, when issued, then Ticket category remains NULL and quota changes once.
- Given active A category, when A issues, then snapshot label is shown.
- Given inactive/B category, when submitted to A, then issuance is rejected without quota consumption.

### AUTOMATED TESTS
`uv run pytest tests/test_desk_registration.py tests/test_tickets.py tests/test_concurrency.py -q`, delivered Type cases, browser P03-T40 (double-click, draft preservation, separate controls); web/canonical gates.

### MANUAL VERIFICATION
Create open, closed and exhausted A tiers and active/inactive A/B types; issue one no-email uncategorized walk-in and one email categorized walk-in. Verify separate selectors, one Ticket/QR, quota delta, issuer and snapshot. Try invalid category and closed/exhausted tier; confirm draft remains and no auto-submit.

### SECURITY CHECKS
Server enforces type/tier event ownership; no UI category changes grant privileges; protect walk-in PII.

### REGRESSION GUARDS
R01, R02, R03, R11, R12, R15, R16, R19, R20.

### ROLLBACK
Restore compatible tier-only form; leave additive category/snapshot schema and existing issued data intact.

### DELIVERABLES
Walk-in form, category/tier tests, issuance evidence and documented limits.

### DEFINITION OF DONE
Null/same-event/rejection/quota criteria pass. Task-size review: one issuance consumer, no backend category redesign.

### STOP CONDITION
Stop after P03-T40; absent P03-T19 contract means BLOCKED, not a local fabricated category list.

---

## P03-T41
### TASK ID
P03-T41

### TITLE
Retrieve existing QR and browser print without reminting

### PRODUCT OUTCOME
Reception redisplays or browser-prints an existing pass without creating another Ticket or QR.

### BASELINE
Desk detail already returns QR; current minted-pass dialog calls `window.print()`. Existing-detail dialog does not yet provide the complete equivalent print action. No hardware printer support is established.

### PREREQUISITES
P03-T39.

### IN SCOPE
Reusable pass presentation for existing detail and issuance output; original QR/tier/historical label, browser print layout and accessible close behavior.

### OUT OF SCOPE
No QR rotation, reminting, registration request, printer drivers, silent printing or badge-printer certification.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `web/src/components/ui/Dialog.tsx`. Proposed: shared reception pass presenter/print styles and browser tests; locate existing style entry before editing.

### BACKEND CONTRACT
Retrieve `GET /api/events/{event_id}/attendees/{ticket_id}` only; print has no mutation endpoint. Preserve original `qr_secret`, Ticket ID/status, tier and delivered `attendee_type_name_at_issue`. Same desk status/ownership rules apply.

### FRONTEND CONTRACT
Detail loading, pass ready, missing/denied/expired, missing QR treated as error rather than fake pass, print-dialog invocation and cancellation. Read-only inactive status is explicit; never claim a printed pass guarantees admission. Dialog close returns focus.

### DATA MODEL IMPACT
None; Ticket/EntityQR counts and values unchanged.

### IMPLEMENTATION STEPS
1. Extract existing QR renderer without changing payload.
2. Add existing-ticket print action and printable selected-pass-only presentation.
3. Preserve metadata/status and focus behavior; isolate unrelated reception UI from print.
4. Test print invocation and no mutation; document browser-only support.

### ACCEPTANCE CRITERIA
- Given an existing Ticket, when reopened and printed twice, then QR/Ticket IDs and counts remain unchanged.
- Given print cancellation, when returning, then no issuance request occurs.
- Given unauthorized detail, when print is attempted, then no pass or QR is exposed.

### AUTOMATED TESTS
Backend desk suites; browser P03-T41 spies on print invocation and network mutations, validates original QR value and focus/metadata; web/canonical gates. Print-preview inspection remains manual.

### MANUAL VERIFICATION
Record synthetic Ticket ID/QR/count, open through search, invoke browser print preview, confirm only selected pass is printable, cancel, reopen and print again. Compare QR/counts; verify FA/EN name and historical category/tier at 320/390px. Record browser, not printer certification.

### SECURITY CHECKS
Do not place QR secrets in logs/URLs or print unrelated search PII; require authorized retrieval.

### REGRESSION GUARDS
R03, R11, R16, R18, R19, R20.

### ROLLBACK
Revert shared presenter/print styles; keep original ticket/QR data unchanged.

### DELIVERABLES
Existing-pass print UI, no-remint tests, browser preview evidence and support boundary docs.

### DEFINITION OF DONE
Original QR preservation and browser-only print behavior pass. Task-size review: presentation-only feature, not a printing subsystem.

### STOP CONDITION
Stop after P03-T41; hardware printing requests require separate approved scope.

---

## P03-T42
### TASK ID
P03-T42

### TITLE
Duplicate 409 recovery with explicit existing-ticket selection

### PRODUCT OUTCOME
A duplicate walk-in rejection guides reception to the actual existing ticket without silently selecting a person or issuing again.

### BASELINE
Desk issuance returns 409 when the normalized-email User already has an event Ticket. Search matches name/email/organization broadly; the current frontend shows only a generic form error.

### PREREQUISITES
P03-T40, P03-T41.

### IN SCOPE
409 recovery state, event-scoped lookup, normalized exact-email candidate filtering, explicit existing-ticket selection and existing QR/print presentation.

### OUT OF SCOPE
No automatic selection/resubmit, name-based identity matching, no-email duplicate guessing, Ticket replacement or new duplicate-resolution API.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `backend/tests/test_desk_registration.py`. Proposed/prerequisite-delivered: duplicate-recovery controller using reception form/search/pass modules and browser cases.

### BACKEND CONTRACT
Keep existing 409 issuance and attendee lookup/detail contracts. A search result is not an exact identity match until normalized `attendee_email` equals submitted normalized email in the same event. Generic 409 may represent another conflict; absent exact result must not fabricate a duplicate.

### FRONTEND CONTRACT
Conflict explanation preserves draft; lookup loading/error; exact candidate ready awaiting operator selection; no exact match; no-email/manual-search path; selected existing pass. Every transition is explicit. Do not auto-open/print or retry POST.

### DATA MODEL IMPACT
None; 409 recovery leaves quota/Ticket/QR unchanged.

### IMPLEMENTATION STEPS
1. Classify issuance response without suppressing nonduplicate conflicts.
2. Offer same-event email lookup and filter exact normalized match.
3. Require explicit ticket selection; no-email offers manual search only.
4. Test ambiguous substring matches, no result and failed lookup; document operator recovery.

### ACCEPTANCE CRITERIA
- Given existing `a@example.test`, when duplicate issuance returns 409, then its ticket is offered but not selected automatically.
- Given substring-only matches, when lookup completes, then none is treated as the duplicate.
- Given no email, when conflict occurs, then no identity is guessed and no POST is replayed.

### AUTOMATED TESTS
Desk registration tests assert unchanged quota/QR on duplicate; browser P03-T42 covers mixed-case exact email, substring candidates, no email, generic 409, selection and no resubmit; web/canonical gates.

### MANUAL VERIFICATION
Issue a ticket, resubmit its email in mixed case, inspect 409 and unchanged counts, choose existing ticket explicitly and print. Search with similar emails and verify they are not auto-selected. Simulate 409 without email and failed lookup; confirm draft preservation/manual search and zero automatic POSTs.

### SECURITY CHECKS
No broad cross-event identity search; verify selected ticket through authorized detail; never infer identity from name/profile similarity.

### REGRESSION GUARDS
R02, R03, R11, R16, R19, R20.

### ROLLBACK
Return to explicit 409 message plus manual lookup; never reinstate automatic issue/retry.

### DELIVERABLES
Duplicate recovery UI/tests, operator instructions and current evidence.

### DEFINITION OF DONE
Exact-match and explicit-selection criteria pass. Task-size review: one conflict recovery state machine, not identity reconciliation.

### STOP CONDITION
Stop after P03-T42; unsupported identity matching is outside scope.

---

## P03-T43
### TASK ID
P03-T43

### TITLE
Reception expiry/revocation recovery without automatic resubmission

### PRODUCT OUTCOME
Lost desk authority immediately stops operations while preserving an in-memory registration draft for deliberate recovery.

### BASELINE
Current desk page clears stored desk token on any `/desk/me` error. P03-T02 supplies generation-aware revocation; precise status handling and draft-preserving reauthentication are new.

### PREREQUISITES
P03-T42, P03-T02.

### IN SCOPE
Reception-wide status transition across lookup/detail/issuance/print retrieval; event-local credential clearing; in-memory draft preservation; explicit reauthentication and submit.

### OUT OF SCOPE
No refresh tokens, automatic POST retry, persistent PII drafts, recovery with organizer/User credentials, or full account-session redesign.

### EXPECTED FILES
Confirmed existing: `web/src/pages/OrganizerDesk.tsx`, `backend/app/routes/desk.py`, `backend/app/security.py`, `backend/tests/test_desk_operator_auth.py`. Proposed/prerequisite-delivered: reception session/error coordination and browser recovery cases.

### BACKEND CONTRACT
Existing expired/invalid/revoked/generation-mismatched desk token exactly 401; revoked fresh login 403; wrong-event/nonmember 403; foreign organizer 404. Versionless token accepted only at row version 0; increment on revoke and reactivation. No scanner-format change.

### FRONTEND CONTRACT
Active, auth lost (protected actions blocked), reauth entry/submitting/failed, authenticated draft restored awaiting explicit submit. Preserve draft only for same reception event in memory; hide/clear retrieved PII and stale QR on authority loss. 403/404 retain credential; network/5xx retain session/draft and never label it revoked. Deliberate logout/context exit clears draft.

### DATA MODEL IMPACT
None beyond P03-T02.

### IMPLEMENTATION STEPS
1. Route every reception request through delivered status-aware session boundary.
2. Preserve draft separately from authorized response data.
3. On 401 clear only actual event credential and block operations; reauth never replays mutation.
4. Add revoke/reactivate, network and in-flight race tests; document draft/privacy limits.

### ACCEPTANCE CRITERIA
- Given draft and revoked token, when request returns 401, then actions stop and draft remains.
- Given successful reauth, when form returns, then zero POSTs occur until explicit submit.
- Given token A revoked/reactivated, when reused, then it still gets 401; new token succeeds.
- Given 403/404/500, when handled, then no unrelated credential is removed.

### AUTOMATED TESTS
`uv run pytest tests/test_desk_operator_auth.py -q` including exact generation/status negatives; browser P03-T43 covers every operational request, draft recovery and no auto-resubmit; web/canonical gates.

### MANUAL VERIFICATION
Type unsent draft; revoke operator from owning organizer; trigger search/submit and inspect 401/blocking. Reactivate, attempt old token, then log in again. Verify draft remains, original ticket is not created until click, and only event desk key cleared. Repeat wrong-event, network and 500 failures plus explicit logout.

### SECURITY CHECKS
No failed-auth response installs stale QR/PII; old generation never revives; no privilege fallback or persistent draft cache.

### REGRESSION GUARDS
R11, R12, R16, R19, R20.

### ROLLBACK
Contain UI changes while retaining backend generations and no-resubmit invariant; do not roll back to token resurrection.

### DELIVERABLES
Session recovery behavior/tests, precise state documentation and revocation evidence.

### DEFINITION OF DONE
All exact statuses and no-resubmit/draft cases pass. Task-size review: one reception session lifecycle, no new auth platform.


### STOP CONDITION
Stop after P03-T43; generation/status failures are BLOCKED and cannot be accepted as `(401,403)`.

---

## P03-T44
### TASK ID
P03-T44

### TITLE
Legacy desk URL directly aliases independent ReceptionShell

### PRODUCT OUTCOME
Existing desk bookmarks still open the same independent reception station without redirects or OrganizerLayout dependency.

### BASELINE
`/organizer/events/:eventId/desk` is an existing registered route and operational entry.

### PREREQUISITES
P03-T43.

### IN SCOPE
Direct route alias, parameter/context parity, Back/reload behavior and removal of obsolete organizer-layout desk exception after integration.

### OUT OF SCOPE
No redirect chain, URL rewrite, new auth flow, Organizer menu redesign or scanner routing change.

### EXPECTED FILES
Confirmed existing: `web/src/main.tsx`, `web/src/pages/OrganizerLayout.tsx`, `web/src/pages/OrganizerDesk.tsx`. Proposed/prerequisite-delivered: shared reception route entry and compatibility browser tests.

### BACKEND CONTRACT
Both URLs call the same event-bound desk endpoints using the same explicitly chosen authority. Organizer pathname does not grant/select organizer authority.

### FRONTEND CONTRACT
All P03-T37–P03-T43 states are identical at both URLs. Legacy direct entry does not require a key; valid desk session restores. Browser Back and reload retain route/context without loops; invalid event and denied authority remain explicit.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Register the legacy path directly to the delivered reception entry outside OrganizerLayout.
2. Remove only layout/desk branches made obsolete by this cutover.
3. Preserve route parameters/storage keys and navigation destinations.
4. Add parity/history tests and update compatibility map.

### ACCEPTANCE CRITERIA
- Given only desk JWT, when old URL reloads, then independent reception works.
- Given old URL entry, when rendered, then pathname remains unchanged and no redirect occurs.
- Given both route variants, when revoke/re-auth is exercised, then behavior is identical.

### AUTOMATED TESTS
Browser P03-T44 covers direct/reload/Back, no redirect, keyless login, explicit mode and 401/403/404 parity; web/canonical gates.

### MANUAL VERIFICATION
Open `/organizer/events/{eventA}/desk` from saved bookmark with no organizer key, sign in and issue/search/print a synthetic pass. Follow another link then Back, reload, and compare `/reception/{eventA}`. Inspect network/URL and Organizer navigation absence; repeat EN/FA.

### SECURITY CHECKS
No pathname-based credential selection; alias cannot bypass session generation/event checks.

### REGRESSION GUARDS
R10, R11, R12, R16, R18, R19, R20.

### ROLLBACK
Restore previous route wiring only as a contained UI rollback with explicit authority; preserve both existing URLs and desk generation protections.

### DELIVERABLES
Direct alias, obsolete desk-layout branch removal, route parity tests and compatibility evidence.

### DEFINITION OF DONE
No redirect/key dependency/history loop and all reception flows pass on legacy entry. Task-size review: one compatibility cutover, not a second reception implementation.

### STOP CONDITION
Stop after P03-T44; do not silently convert alias to redirect.

---

## P03-T45
### TASK ID
P03-T45

### TITLE
PartnerShell and resource-authorized canonical entry

### PRODUCT OUTCOME
A representative enters `/partner/:partnerId` using User identity and an actual PartnerStaff membership.

### BASELINE
Only `/booth/:boothId` exhibitor entry exists. Partner model/read/discovery are new prerequisite deliverables, not current baseline APIs.

### PREREQUISITES
P03-T21, P03-T15, P03-T16.

### IN SCOPE
Independent PartnerShell, canonical route, anonymous User login entry when needed, authorized Partner context and precise access states.

### OUT OF SCOPE
No Partner JWT, organizer fallback, `/api/partners/me`, account auto-provisioning, profile edit or implicit Booth authority.

### EXPECTED FILES
Confirmed existing: `web/src/main.tsx`, `web/src/pages/ExhibitorPortal.tsx`, `web/src/api/client.ts`, `web/src/lib/i18n.ts`. Proposed/prerequisite-delivered: PartnerShell/context, existing shared login adapter, Partner read/discovery client and browser tests.

### BACKEND CONTRACT
Anonymous `POST /api/auth/login` for User login; `GET /api/partners/{partner_id}` with User JWT and exact PartnerStaff, 403 known nonmember, 404 unknown. `GET /api/me/access` provides selection; no duplicate Partner collection endpoint. User token invalid/family mismatch 401.

### FRONTEND CONTRACT
Anonymous entry/login, context loading, authorized Partner, no membership/403, unknown/404, expired User session/401 and recoverable failure. Membership discovery is descriptive; no leads fetched until exact Booth selection. Keep destination during login; no organizer credential retry.

### DATA MODEL IMPACT
None beyond delivered Partner package.

### IMPLEMENTATION STEPS
1. Locate delivered Partner capabilities and access schema.
2. Create independent route/shell and explicit User entry.
3. Load authorized Partner context with stale-response protection.
4. Add nonmember/family/reload tests and document authority separation.

### ACCEPTANCE CRITERIA
- Given PartnerStaff(P), when P route loads, then authorized profile/workspace renders.
- Given only BoothStaff elsewhere, when P is opened, then 403 denies P.
- Given stored organizer key and missing User token, when login occurs, then anonymous login is used and no key leaks.

### AUTOMATED TESTS
Delivered Partner/API negative tests; browser P03-T45 covers login return, multiple credentials, 401/403/404, reload and stale route response; web/canonical gates.

### MANUAL VERIFICATION
Use P member, nonmember and wrong-token-family fixtures; open P directly and reload, log in from anonymous state, inspect credential headers, then open foreign Q. Verify no lead request from profile membership alone and no organizer fallback; repeat EN/FA at 320/390px.

### SECURITY CHECKS
PartnerStaff profile authority and BoothStaff lead authority remain separate server row checks.

### REGRESSION GUARDS
R07, R08, R16, R18, R19, R20.

### ROLLBACK
Disable new canonical entry and restore existing Booth UI without dropping Partner data or broadening lead grants.

### DELIVERABLES
Canonical Partner entry/shell, access tests and documented credential contract.

### DEFINITION OF DONE
Resource authorization and entry failures pass. Task-size review: one shell/read boundary, not all Partner workflows.

### STOP CONDITION
Stop after P03-T45; absent Partner APIs means BLOCKED, never fake Booth-backed Partner.

---

## P03-T46
### TASK ID
P03-T46

### TITLE
Partner/Event and explicitly authorized Booth chooser

### PRODUCT OUTCOME
A multi-event or multi-Partner representative selects context without seeing or receiving another Booth's leads.

### BASELINE
Current `/api/booths/me` can return multiple assignments, but exhibitor page is a single-Booth deep link. New access/Partner capability APIs supply grouped context.

### PREREQUISITES
P03-T45.

### IN SCOPE
Chooser based on `/api/me/access`; authorized Partner context; separate public Booth metadata from selectable `lead_booth_ids`; zero/one/many assignment behavior.

### OUT OF SCOPE
No aggregate lead API, all-Booth implied grants, extra membership endpoint or remembered context that overrides current server access.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `web/src/api/client.ts`. Proposed/prerequisite-delivered: Partner/Event/Booth chooser and context boundary, access/Partner clients and tests.

### BACKEND CONTRACT
Use `GET /api/me/access` and `GET /api/partners/{partner_id}`. Only exact authorized `lead_booth_ids` enable Booth operations; Partner public `booths[]` is not capability. Re-read authoritative target endpoints on entry. Removal of Partner membership also removes that user's BoothStaff under that Partner.

### FRONTEND CONTRACT
Loading access, no assignments, single context, explicit multi-context picker, zero lead-capability, selected Booth loading/ready, revoked selection and shared errors. Reset lead/qualification/scan state on context change; no previous-context flash.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Map delivered access records without inferring organizer roles.
2. Implement deterministic explicit multi-context selection and no-role state.
3. Limit lead Booth choices to current exact capability IDs.
4. Invalidate selected Booth and old requests when context/grants change; add tests/docs.

### ACCEPTANCE CRITERIA
- Given P has A/B but User has A only, when chooser opens, then only A enables leads.
- Given multi-event assignments, when switching events, then prior leads/forms disappear before new load.
- Given grant removed while User JWT remains valid, when target reloads, then denied state replaces old capability.

### AUTOMATED TESTS
Delivered access/Partner membership matrix; browser P03-T46 covers zero/one/many, same-event multi-Partner and cross-event switching, response races and removed grant; web/canonical gates.

### MANUAL VERIFICATION
Seed P(A,B), Q(C) and event-B Partner D; grant User only A and D. Verify explicit chooser, B/C denied if manually addressed, switch A→D during delayed response, remove A membership and reload. Inspect no mixed data and current capability labels in EN/FA.

### SECURITY CHECKS
Never trust cached capability to authorize mutations; no profile-membership-to-all-leads escalation.

### REGRESSION GUARDS
R07, R08, R09, R16, R19, R20.

### ROLLBACK
Return to explicitly authorized single-Booth entries; retain exact grants and Partner data.

### DELIVERABLES
Context chooser, isolation/race tests and documented selection rules.

### DEFINITION OF DONE
Zero/one/many and revoked-context cases pass. Task-size review: one context selection feature, no lead workflow redesign.

### STOP CONDITION
Stop after P03-T46; ambiguous access schema blocks implementation rather than inferred Booth permission.

---

## P03-T47
### TASK ID
P03-T47

### TITLE
Sponsor-only read-only profile with zero lead capability

### PRODUCT OUTCOME
A boothless sponsor representative has a useful truthful workspace without fake Booths or lead actions.

### BASELINE
Current Lead requires a real Booth; current exhibitor workspace cannot represent a boothless sponsor. PartnerStaff and zero-Booth Partner support are new prerequisites.

### PREREQUISITES
P03-T46.

### IN SCOPE
Read-only Partner profile, event context, valid website/logo/brochure presentation, explicit no-lead state and disabled/absent edit affordances.

### OUT OF SCOPE
Profile editing belongs to approval-gated P03-T58. No fake Booth/QR/Lead, sponsor bookmark entity, staff management or partner-type change.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `web/src/pages/PublicBooth.tsx`. Proposed/prerequisite-delivered: read-only Partner profile/no-capability view and Partner read API tests.

### BACKEND CONTRACT
`GET /api/partners/{partner_id}` requires PartnerStaff. Sponsor returns `booths: []`, `lead_booth_ids: []`, and `edit_profile: false` until approved editing is actually delivered. Lead endpoints still require exact BoothStaff; profile-only member gets 403 for an existing foreign Booth.

### FRONTEND CONTRACT
Profile loading/populated, absent optional content with honest omission, zero-Booth/no-lead explanation and shared status states. No scan/list/export request or editor is mounted when no lead capability. Broken image uses accessible fallback without inventing content.

### DATA MODEL IMPACT
None; sponsor creates no fake operational records.

### IMPLEMENTATION STEPS
1. Render profile from authorized Partner response.

2. Present event identity and zero-Booth/no-lead capabilities explicitly.
3. Reuse safe profile links/images with empty-content fallback.
4. Add sponsor API/browser negatives and read-only documentation.

### ACCEPTANCE CRITERIA
- Given boothless sponsor member, when workspace opens, then profile renders with no lead controls.
- Given profile-only member, when an existing Booth lead endpoint is called, then 403 denies it.
- Given missing brochure/logo, when rendered, then no dead or fake action appears.

### AUTOMATED TESTS
Delivered Partner sponsor tests (zero Booth/QR/Lead records, edit false); browser P03-T47 checks no lead requests/edit controls, empty metadata and foreign resource denial; web/canonical gates.

### MANUAL VERIFICATION
Create sponsor with PartnerStaff and no Booth; open canonical route, inspect network and record counts, follow valid brochure/website links, remove optional values and reload. Attempt real foreign Booth lead API with same User; confirm 403. Repeat EN/FA and 320/390px.

### SECURITY CHECKS
Sanitize/validate link schemes according to delivered profile contract; external links must not expose credentials. No capability inference from type label.

### REGRESSION GUARDS
R07, R08, R09, R16, R19, R20.

### ROLLBACK
Revert profile view without deleting sponsor records or granting leads.

### DELIVERABLES
Sponsor workspace/no-capability UI, authorization tests and read-only evidence.

### DEFINITION OF DONE
Useful sponsor profile and zero operational capability are proven. Task-size review: one read-only capability case; editing is excluded.

### STOP CONDITION
Stop after P03-T47; requested edit controls remain BLOCKED until P03-T58 approval/delivery.

---

## P03-T48
### TASK ID
P03-T48

### TITLE
Existing manual Booth lead capture within selected Booth

### PRODUCT OUTCOME
Representatives retain current manual QR-secret lead capture under the exact selected Booth grant.

### BASELINE
`ExhibitorPortal.tsx` currently accepts typed QR secret and posts the existing scan endpoint. It has no camera capture today.

### PREREQUISITES
P03-T46.

### IN SCOPE
Extract manual capture, qualification defaults/notes/tags passed at capture, 201 new versus 200 duplicate-update feedback and selected-Booth context safety.

### OUT OF SCOPE
Camera belongs to P03-T51; no offline lead queue, new scan API, cross-Booth lead aggregation or changed duplicate semantics.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `backend/app/routes/leads.py`, `backend/tests/test_leads.py`. Proposed: selected-Booth manual capture module and browser cases.

### BACKEND CONTRACT
`POST /api/booths/{booth_id}/leads/scan` with existing `qr_secret`, rating, notes, tags; exact BoothStaff authorizer. 201 new, 200 existing Booth/Ticket lead update; wrong-event Ticket 400; valid nonstaff 403; missing Booth 404; invalid User token 401. Preserve existing QR/entity and lead uniqueness rules.

### FRONTEND CONTRACT
No selected grant disables capture; entry, validation, submitting, new/updated success, invalid badge/wrong-event error and shared errors. Preserve input on failure; no cross-context completion; reset capture on deliberate Booth switch. Manual fallback remains first-class.

### DATA MODEL IMPACT
None; preserve unique `(booth,ticket)`.

### IMPLEMENTATION STEPS
1. Extract current manual handler/UI using explicit User client.
2. Bind request/result to selected authorized Booth.
3. Preserve duplicate feedback and successful list refresh.
4. Add same-Partner cross-Booth and stale submission tests; document manual baseline.

### ACCEPTANCE CRITERIA
- Given A grant, when valid A-event badge is entered, then 201 captures A lead.
- Given same badge/A, when repeated, then 200 updates one lead, not a duplicate row.
- Given P membership but no B grant, when B scan is attempted, then 403.

### AUTOMATED TESTS
`uv run pytest tests/test_leads.py tests/test_lead_qualification.py -q`; browser P03-T48 covers manual success, duplicate, invalid badge, event/Booth switch and 401/403/404; web/canonical gates.

### MANUAL VERIFICATION
Grant User A only within P(A,B); enter real synthetic attendee QR twice in A, verify create/update messages and one lead. Try B and event-B attendee QR, confirm denial/rejection. Switch Booth during delayed capture; ensure old response cannot populate new context. Repeat EN/FA/mobile.

### SECURITY CHECKS
Exact BoothStaff checked on every mutation; never log badge secrets or send organizer/desk token.

### REGRESSION GUARDS
R03, R08, R09, R16, R19, R20.

### ROLLBACK
Restore existing manual capture UI with unchanged scan API; retain exact grants and captured leads.

### DELIVERABLES
Manual capture extraction, API-backed capture/duplicate/isolation tests and evidence.

### DEFINITION OF DONE
Manual behavior and lead uniqueness are preserved. Task-size review: one existing mutation consumer; camera/offline excluded.

### STOP CONDITION
Stop after P03-T48; do not claim camera as baseline or widen lead permissions.

---

## P03-T49
### TASK ID
P03-T49

### TITLE
Existing lead qualification, notes and tags extraction

### PRODUCT OUTCOME
A representative edits only the selected Booth's existing lead qualification without losing current rating/tag/note behavior.

### BASELINE
Exhibitor page already edits HOT/WARM/COLD, preset/custom tags and notes through Booth-bound PATCH.

### PREREQUISITES
P03-T48.

### IN SCOPE
Extract editor and existing save/feedback/focus behavior; selected lead/Booth identity boundary and draft/error preservation.

### OUT OF SCOPE
No bulk editing, new rating taxonomy, tag model, audit system, CRM synchronization or cross-Booth mutation.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `backend/app/routes/leads.py`, `backend/tests/test_lead_qualification.py`, `web/src/components/ui/Dialog.tsx`. Proposed: lead qualification editor and behavior tests.

### BACKEND CONTRACT
`PATCH /api/booths/{booth_id}/leads/{lead_id}` with rating HOT/WARM/COLD, notes, tags according to existing schema. Invalid rating 422; foreign lead under authorized Booth 404; missing Booth 404; nonstaff 403; invalid session 401. No lead ownership change.

### FRONTEND CONTRACT
Editor closed/open with original values, editing, saving, confirmed success, validation/error retaining draft and shared denied/missing/auth states. Save disabled during submission; pending result cannot modify another Booth/lead. Explicit cancel discards unsaved editor values.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Extract editor using existing rating/tag handling.
2. Bind lead ID and Booth ID to request/result; reset on context change.
3. Preserve validation, success feedback and accessible close/focus.
4. Add consumer behavior and ownership tests; document qualification limits.

### ACCEPTANCE CRITERIA
- Given A lead, when rating/notes/tags save, then A list shows returned values after reload.
- Given B lead ID under A path, when PATCH runs, then 404 changes neither lead.
- Given failed save, when retry is offered, then draft remains and no automatic retry occurs.

### AUTOMATED TESTS
`uv run pytest tests/test_lead_qualification.py tests/test_leads.py -q`; browser P03-T49 covers presets/custom tags, cancel, 422/5xx, context race and cross-lead isolation; web/canonical gates.

### MANUAL VERIFICATION
Capture synthetic A/B leads; edit A to HOT, add preset/custom tag and note, save/reload and cancel a second edit. Force failed save; verify draft. Attempt B lead through A path and switch context during delayed save. Repeat keyboard-only EN/FA at 320/390px.

### SECURITY CHECKS
Server checks exact Booth grant and lead path ownership; render notes/tags as text, not HTML; no sensitive values in logs.

### REGRESSION GUARDS
R08, R09, R16, R19, R20.

### ROLLBACK
Restore current qualification component/handler without reverting saved values or loosening authorizers.

### DELIVERABLES
Qualification editor, behavior/negative tests and updated workflow documentation.

### DEFINITION OF DONE
Existing rating/tag/note semantics and error preservation pass. Task-size review: one editing workflow, not lead-feed/export work.

### STOP CONDITION
Stop after P03-T49; taxonomy or bulk-edit requests require separate approval.

---

## P03-T50
### TASK ID
P03-T50

### TITLE
Booth lead list/filter and sanitized CSV export extraction

### PRODUCT OUTCOME
Representatives browse/filter and export exactly the selected Booth's leads using existing server sanitization.

### BASELINE
Exhibitor page uses existing `q`/rating filters and a raw authenticated CSV download. Current list has no pagination; CSV sanitization is server-side.

### PREREQUISITES
P03-T49.

### IN SCOPE
List/filter extraction, accurate empty/error states, explicit User-authority export and safe download resource cleanup. Preserve existing export dataset semantics rather than promising filtered export.

### OUT OF SCOPE
No pagination, cross-Partner aggregation, new export format, client-only sanitization replacement or aggregate API.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `backend/app/routes/leads.py`, `backend/app/security.py`, `backend/tests/test_lead_qualification.py`, `backend/tests/test_csv_security.py`. Proposed: Booth lead feed/filter/export modules and browser cases.

### BACKEND CONTRACT
`GET /api/booths/{booth_id}/leads?q=...&rating=HOT|WARM|COLD`; `GET /api/booths/{booth_id}/leads/export-csv`. Exact BoothStaff for both. CSV retains BOM, filename and `sanitize_csv_cell` behavior. Existing export is the Booth's export contract, not automatically the UI-filtered subset.

### FRONTEND CONTRACT
Loading, populated, Booth has no leads, filter has no matches, recoverable read failure; export idle/downloading/success/failure and shared status states. Block export without current grant/context. No old Booth data or blob download after context change; revoke object URL.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Extract list and existing filters preserving server semantics.
2. Move export to explicit selected User transport with precise status handling.
3. Preserve filename/BOM and cleanup download resources.
4. Test race/isolation and dangerous CSV inputs; document export scope/no pagination.

### ACCEPTANCE CRITERIA
- Given HOT/COLD leads, when filtered, then only matching selected-Booth rows display.
- Given formula-like name/note, when exported, then dangerous cells are sanitized by server.
- Given no B grant, when B export is called, then 403 yields no CSV.

### AUTOMATED TESTS
`uv run pytest tests/test_lead_qualification.py tests/test_csv_security.py tests/test_leads.py -q`; browser P03-T50 covers filters/empty/download/content/statuses and context race; web/canonical gates.

### MANUAL VERIFICATION
Create A/B leads with HOT/COLD and `=`, `+`, `-`, `@` prefixed export values. Filter A, download CSV, inspect BOM/filename/sanitized cells and actual export scope. Attempt B export without grant, revoke A membership and retry. Repeat EN/FA/mobile.

### SECURITY CHECKS
No credential in download URL; exact server grant, sanitized cells and no cross-Booth PII. Do not claim client filtering is export authorization.

### REGRESSION GUARDS
R08, R09, R16, R19, R20.

### ROLLBACK
Restore existing feed/export UI; keep server sanitization and stored lead values.

### DELIVERABLES
Feed/filter/export modules, CSV/isolation tests and precise export documentation.

### DEFINITION OF DONE
Filtering and real downloaded CSV behavior pass. Task-size review: one existing read/export boundary; no new pagination/backend aggregation.

### STOP CONDITION
Stop after P03-T50; missing sanitized export evidence blocks completion.

---

## P03-T51
### TASK ID
P03-T51

### TITLE
New camera badge input feeding existing lead capture


### PRODUCT OUTCOME
An authorized Booth representative can decode a badge using camera, while manual QR entry remains available when camera is unavailable or denied.

### BASELINE
Exhibitor capture is manual-only. `jsqr` is already a web dependency; GateScanner has camera behavior but its admission/queue state machine must not be reused as lead logic or refactored.

### PREREQUISITES
P03-T48.

### IN SCOPE
New opt-in camera input, existing jsqr decode, one decoded input handed to the same selected-Booth lead capture contract, denial/error fallback and camera lifecycle cleanup.

### OUT OF SCOPE
No new dependency, scanner admission/queue behavior, offline lead capture, camera-based global identity lookup or native scanner work.

### EXPECTED FILES
Confirmed existing: `web/src/pages/ExhibitorPortal.tsx`, `web/src/pages/GateScanner.tsx` (reference only), `web/package.json`, `backend/app/routes/leads.py`. Proposed: lead camera input/lifecycle module and deterministic browser camera tests.

### BACKEND CONTRACT
Use only existing `POST /api/booths/{booth_id}/leads/scan` via P03-T48. Decoding does not authorize capture. Preserve 201/200, event rejection and exact BoothStaff checks; no new endpoint.

### FRONTEND CONTRACT
Manual default, request camera permission, opening, live preview, decoded value, existing capture submitting/success/error, permission denied, no device/unsupported/insecure context and retry/manual fallback. Suppress repeated frames while decoding/submitting; do not create a scan loop. Stop tracks and animation work on close, navigation, Booth change, authority loss and unmount; stop late-arriving streams too.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Add opt-in camera control using existing jsqr dependency.
2. Isolate camera lifecycle/input from lead mutation and selected-Booth context.
3. Gate repeated decoded frames and preserve manual workflow for every camera failure.
4. Test denied permission, late permission resolution and all cleanup paths; document camera as new feature.

### ACCEPTANCE CRITERIA
- Given authorized A Booth, when one badge is decoded, then existing A scan contract receives it once per intentional capture.
- Given denied permission, when camera fails, then manual entry still works.
- Given active/late stream, when view closes or context/auth changes, then every media track stops and no stale mutation occurs.

### AUTOMATED TESTS
Browser P03-T51 with deterministic frame/media mocks checks decode, repeated-frame gating, denial, unsupported device, track stop on close/unmount/change/auth loss and late resolution; real API capture regression plus manual-input browser case; web/canonical gates. Mock video is not physical-camera proof.

### MANUAL VERIFICATION
On target camera-capable browser, open authorized A, grant permission and scan a synthetic badge, verify 201 then intentional duplicate 200. Deny permission and capture manually. Close/reopen, navigate away, switch Booth and revoke membership; verify browser camera indicator turns off each time and no hidden capture continues. Record device/browser, EN/FA and narrow-width behavior.

### SECURITY CHECKS
Request camera only on explicit action; never record/upload video frames; QR secrets not logged; server retains lead authority.

### REGRESSION GUARDS
R08, R09, R13, R16, R19, R20.

### ROLLBACK
Remove camera entry/lifecycle cleanly and retain complete manual capture; no data rollback or scanner change.

### DELIVERABLES
New camera input, manual fallback, lifecycle tests and real-device evidence.

### DEFINITION OF DONE
Permission/cleanup and actual camera capture pass without regressing manual entry. Task-size review: one input adapter, not a scanner engine.

### STOP CONDITION
Stop after P03-T51; absent target-camera proof is a recorded blocked gate, not claimed from mocks.

---

## P03-T52
### TASK ID
P03-T52

### TITLE
Direct `/booth/:boothId` compatibility entry

### PRODUCT OUTCOME
Existing Booth workspace URLs remain usable directly while canonical Partner entry supports sponsor and multi-Booth context.

### BASELINE
`/booth/:boothId` is current protected exhibitor entry and may be bookmarked/printed. Booth IDs and EntityQRs must remain unchanged.

### PREREQUISITES
P03-T47, P03-T50.

### IN SCOPE
Direct compatibility route using authorized Booth entry and delivered Partner workspace; exact selected Booth preserved; legacy/manual qualification/feed/export parity.

### OUT OF SCOPE
No redirect to Partner URL, heuristic Partner lookup, implicit grant, new camera dependency (P03-T51 independent), or Booth QR mutation.

### EXPECTED FILES
Confirmed existing: `web/src/main.tsx`, `web/src/pages/ExhibitorPortal.tsx`, `backend/app/routes/booths.py`, `backend/tests/test_booths.py`. Proposed/prerequisite-delivered: direct compatibility context adapter and Partner/manual/feed modules/tests.

### BACKEND CONTRACT
`GET /api/booths/{booth_id}` requires exact BoothStaff; delivered additive linkage identifies Partner context without public/guessed authorization. Use `/api/me/access` and authorized Partner read as needed. Lead APIs continue exact BoothStaff. 403 nonstaff, 404 absent, 401 invalid User; no stronger fallback.

### FRONTEND CONTRACT
Legacy pathname unchanged, login preserving Booth destination, authorized Booth ready, removed grant, unknown Booth and shared failure states. Never route-loop; no unauthorized default Booth. Camera appears only if separately delivered P03-T51.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Wire legacy route directly to compatible delivered workspace.
2. Resolve exact authorized Booth then linked Partner using delivered contracts.
3. Remove obsolete exhibitor shell implementation only after parity is established.
4. Add reload/Back/auth/capture/export parity cases and update URL matrix.

### ACCEPTANCE CRITERIA
- Given A staff, when `/booth/{A}` reloads, then A manual/feed/export works without redirect.
- Given Partner-only membership without A grant, when URL opens, then 403 prevents leads.
- Given preserved Booth QR/ID, when older URL is used, then it still resolves the same resource.

### AUTOMATED TESTS
`uv run pytest tests/test_booths.py tests/test_leads.py tests/test_lead_qualification.py -q`; browser P03-T52 legacy path/history/login/parity/no-grant cases; web/canonical gates.

### MANUAL VERIFICATION
Open original saved `/booth/{A}` with authorized and profile-only Users, reload and use Back. Capture manually, qualify, filter and export; compare canonical selected-A workspace. Verify pathname/IDs unchanged and profile-only User denied. Independently open `/e/{slug}/booths/{A}` to guard public standee URL.

### SECURITY CHECKS
Known Booth ID is not capability; no Partner membership bypass; no secret in redirect/history because there is no redirect.

### REGRESSION GUARDS
R07, R08, R09, R16, R18, R19, R20.

### ROLLBACK
Restore original direct Booth page route with explicit User authority; never retire the URL or drop Partner data.

### DELIVERABLES
Direct compatibility adapter, old implementation cutover, parity tests and URL evidence.

### DEFINITION OF DONE
Original URL and all existing operational features pass. Task-size review: one compatibility boundary, not additional capability implementation.

### STOP CONDITION
Stop after P03-T52; unresolved linkage blocks cutover rather than redirecting or guessing.

---

## P03-T53
### TASK ID
P03-T53

### TITLE
Public event layout with actual metadata and Booth deep links

### PRODUCT OUTCOME
Visitors see accurate congress information at existing public URLs without unrelated credentials or invented content.

### BASELINE
`PublicEvent.tsx` consumes event name/slug/dates/location/description and tiers. `PublicBooth.tsx` consumes actual Booth profile. Scientific agenda/speakers and branding fields are absent.

### PREREQUISITES
P03-T04, P03-T21.

### IN SCOPE
Public event/Booth layout reuse, real metadata sections, existing deep links and shared state/navigation/accessibility boundaries.

### OUT OF SCOPE
No fake agenda/speakers/maps/emergency content, branding fields, registration redesign or invented public Booth list; directory belongs to P03-T54.

### EXPECTED FILES
Confirmed existing: `web/src/pages/PublicEvent.tsx`, `web/src/pages/PublicBooth.tsx`, `web/src/layouts/PublicLayout.tsx`, `web/src/main.tsx`, `backend/app/routes/public.py`, `backend/tests/test_public_event.py`. Proposed: public event metadata sections and browser tests.

### BACKEND CONTRACT
Anonymous `GET /api/public/events/{slug}` and `GET /api/public/events/{slug}/booths/{booth_id}`; no Authorization header, even if all credentials are stored. Preserve slug/Booth same-event 404. Bookmarks use separate protected APIs only; public optional-token behavior does not justify sending token here.

### FRONTEND CONTRACT
Public loading, populated metadata, omitted absent optional description/location, missing event/Booth, recoverable failure. Protected bookmark state/action is separate; anonymous save offers User login. Preserve `/e/:slug` and `/e/:slug/booths/:boothId` directly with reload/Back.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Extract actual metadata/profile sections using shared public boundary.
2. Preserve exact current URLs and resource/event validation.
3. Separate public fetches from protected bookmark requests.
4. Test all stored credentials, missing fields and deep-link history; document absent content boundaries.

### ACCEPTANCE CRITERIA
- Given stored User/desk/organizer/scanner credentials, when public metadata loads, then no Authorization header is sent.
- Given a Booth from B under A slug, when opened, then 404.
- Given no agenda data, when landing renders, then no invented agenda/speaker section appears.

### AUTOMATED TESTS
`uv run pytest tests/test_public_event.py tests/test_booths.py tests/test_booth_bookmarks.py -q`; browser P03-T53 anonymous headers/deep-link/empty/error/bookmark separation; web/canonical gates.

### MANUAL VERIFICATION
Open `/e/{slugA}` and original public Booth URL with all credential stores populated; inspect headers, actual dates/location/description and brochure. Use foreign Booth/unknown slug, reload/Back, then anonymous/protected bookmark action. Verify EN/FA at 320/390px and no content placeholders.

### SECURITY CHECKS
Render description as safe text; external profile links follow existing safe scheme contract; no API key/QR leak in public content.

### REGRESSION GUARDS
R01, R07, R16, R18, R19, R20.

### ROLLBACK
Restore current public components without changing URLs/contracts or anonymous transport.

### DELIVERABLES
Public metadata layout, anonymous/deep-link tests and documented actual-content inventory.

### DEFINITION OF DONE
Real metadata and URL/header criteria pass. Task-size review: one layout/extraction boundary; no new content model.

### STOP CONDITION
Stop after P03-T53; unavailable content is omitted, not mocked into product UI.

---

## P03-T54
### TASK ID
P03-T54

### TITLE
Public Partner and sponsor sections from directory contract

### PRODUCT OUTCOME
Visitors discover actual event Partners, including boothless sponsors, and follow preserved physical Booth links.

### BASELINE
Current public API provides single-Booth lookup, not a Partner collection. P03-T15 delivers the new public directory.

### PREREQUISITES
P03-T53, P03-T15.

### IN SCOPE
Directory consumption, profile/type-based sections, zero/many Booth presentation, safe external links and exact Booth deep links.

### OUT OF SCOPE
No staff/capability/lead exposure, Partner bookmark entity, guessed logos, invented sponsors or extra primary attendee tab.

### EXPECTED FILES
Confirmed existing: `web/src/pages/PublicEvent.tsx`, `web/src/pages/PublicBooth.tsx`, `backend/app/routes/public.py`. Proposed/prerequisite-delivered: public Partner directory client/cards/sections and API/browser tests.

### BACKEND CONTRACT
Anonymous `GET /api/public/events/{slug}/partners`; event-scoped public profile and `booths[]`, no staff/login email/internal capability/lead/QR secret. Sponsor with zero Booths is valid. Unknown event 404. Protected Booth bookmarks remain separate existing API calls.

### FRONTEND CONTRACT
Directory loading/populated, empty directory, zero-Booth sponsor, multiple Booth links, missing optional image/brochure, fetch failure and missing event. Public content stays accessible without User session. No fake Booth action for sponsor; safe image fallback.

### DATA MODEL IMPACT
None.

### IMPLEMENTATION STEPS
1. Consume delivered public response through anonymous transport.
2. Render real Partner sections and zero/many Booth cards.
3. Link each Booth to `/e/:slug/booths/:boothId`; separate protected saves if surfaced.
4. Test event isolation/public-field redaction and empty/multi-Booth states; document directory behavior.

### ACCEPTANCE CRITERIA
- Given sponsor without Booth, when listed, then profile appears without fake Booth link.
- Given P with A/B, when listed, then both original deep links target correct resources.
- Given event A directory, when read, then B Partners and staff/lead details are absent.

### AUTOMATED TESTS

Delivered public Partner redaction/event tests; browser P03-T54 zero/many/empty/failure/deep-links/no auth header; existing Booth/bookmark regressions and web/canonical gates.

### MANUAL VERIFICATION
Seed A sponsor(no Booth), A exhibitor(A1,A2), B Partner and empty event C; open each public page anonymously with stored credentials. Inspect response redaction/headers, follow both physical Booth links and sponsor brochure, then simulate directory failure. Repeat EN/FA/narrow widths.

### SECURITY CHECKS
No private PartnerStaff/BoothStaff or leads in directory; no credentials on public reads; no inappropriate sponsor bookmark surrogate.

### REGRESSION GUARDS
R07, R16, R18, R19, R20.

### ROLLBACK
Hide directory sections while preserving public Booth links and Partner data/API expansion.

### DELIVERABLES
Public Partner/sponsor UI, event/redaction tests and current browser evidence.

### DEFINITION OF DONE
Real zero/many Partner directory works anonymously and retains deep links. Task-size review: one public collection consumer, no domain redesign.

### STOP CONDITION
Stop after P03-T54; absent directory API means BLOCKED rather than a static Partner list.

---

## P03-T55
### TASK ID
P03-T55

### TITLE
Public reservation and explicit portal login integration

### PRODUCT OUTCOME
Visitors register/login anonymously, reserve with User authority and optional category, then enter the correct attendee event without confused portal credentials.

### BASELINE
PublicEvent currently registers/logs in and reserves by event UUID, then navigates to `/my-tickets`. Existing reservation uniqueness/quota is mature; new category/chooser/event routes are prerequisites.

### PREREQUISITES
P03-T53, P03-T19, P03-T22, P03-T30.

### IN SCOPE
Existing registration/login/reservation integration, separate tier/optional type choices from delivered public data, explicit portal-entry links and event-specific post-success navigation.

### OUT OF SCOPE
No payment, invitation/reset, automatic desk session, organizer association, category reassignment or privileged login fallback.

### EXPECTED FILES
Confirmed existing: `web/src/pages/PublicEvent.tsx`, `backend/app/routes/auth.py`, `backend/app/routes/tickets.py`, `backend/tests/test_auth.py`, `backend/tests/test_tickets.py`. Proposed/prerequisite-delivered: reservation form integration, portal chooser and active-congress navigation/tests.

### BACKEND CONTRACT
Anonymous `POST /api/auth/register` and `/login`; `GET /api/public/events/{slug}` includes delivered `active_attendee_types[]`; User-authorized `POST /api/events/{event_id}/tickets/reserve` body tier plus optional nullable category. Preserve duplicate 409, tier 404/400/410 and category validation. Return existing QR and immutable `attendee_type_name_at_issue`.
Exact category outcomes: omitted/null accepted; missing or wrong-event type404; inactive same-event type409; malformed UUID422. Validate and lock the type before any quota mutation; rejected category creates no Ticket/QR and consumes no quota.

### FRONTEND CONTRACT
Public loading, auth entry/submitting/validation/rejected/duplicate account, User-ready tier/category selection, no available tier, submitting, reserved success, existing Ticket 409 and shared protected failures. Login/reauth never automatically reserves; explicit submit required. Preserve selected event; successful flow reaches its My Ticket.

### DATA MODEL IMPACT
None beyond P03-T19.

### IMPLEMENTATION STEPS
1. Reuse delivered anonymous auth and explicit User reservation adapters.
2. Load optional types separately from tier semantics.
3. Integrate truthful portal chooser links; retain destination through login.
4. Test end-to-end register/reserve/existing ticket/event routing; document flow.

### ACCEPTANCE CRITERIA
- Given anonymous visitor, when registered then explicitly reserved, then one correct-event Ticket/QR exists.
- Given no type, when reserved, then NULL is valid and tier quota changes once.
- Given duplicate/sold-out/invalid type, when rejected, then no automatic repeat or quota drift occurs.
- Given desk eligibility, when User logs in, then no desk session is silently issued.

### AUTOMATED TESTS
`uv run pytest tests/test_auth.py tests/test_tickets.py tests/test_concurrency.py -q`, delivered Type tests; browser P03-T55 real register/login/reserve/no-auth-header/event destination/portal entry cases; web/canonical gates.

### MANUAL VERIFICATION
At `/e/{slugA}`, register new User, reserve uncategorized and categorized synthetic scenarios, inspect headers/UUID/quota/snapshot and correct My Ticket event. Test duplicate email/Ticket, sold-out/closed tier and foreign category; open explicit reception/Partner/Organizer entries and verify distinct credentials are required.

### SECURITY CHECKS
No credentials on auth/public calls; no category-derived admission; no User-to-organizer/desk session convergence; no credential substitution.

### REGRESSION GUARDS
R01, R02, R03, R04, R11, R16, R18, R19, R20.

### ROLLBACK
Restore existing compatible reservation/navigation UI while retaining anonymous transport and additive category data; preserve old attendee URLs.

### DELIVERABLES
Integrated public auth/reservation/portal entry, behavior tests and API-backed flow evidence.

### DEFINITION OF DONE
All auth/reservation outcomes and correct-event navigation pass. Task-size review: existing flow integration using delivered contracts, no new ticket business rules.

### STOP CONDITION
Stop after P03-T55; absent category/chooser/navigation prerequisite means BLOCKED.

---

## P03-T56
### TASK ID
P03-T56

### TITLE
Approval-gated event logo, cover and accent contract/UI

### PRODUCT OUTCOME
Only an approved release scope may show organizer-configured event imagery/accent; otherwise actual metadata uses existing default styling.

### BASELINE
Event/public response currently has no `logo_url`, `cover_url` or `accent_color`. Branding is not an implemented capability.

### PREREQUISITES
P03-T53, P03-T17 plus explicit product approval of this exact additive contract, validation rules, asset responsibilities and release inclusion. Default status: BLOCKED.

### IN SCOPE
After approval only: nullable Event fields `logo_url`, `cover_url`, `accent_color`, each default NULL; organizer event create/update and public Event reads; limited branding UI with safe defaults.

### OUT OF SCOPE
No arbitrary font, custom CSS/HTML, theme builder, asset upload/storage service, remote server fetch/proxy, admission or event ownership change.

### EXPECTED FILES
Confirmed existing: `backend/app/models.py`, `backend/app/routes/events.py`, `backend/app/routes/public.py`, `web/src/pages/OrganizerEvents.tsx`, `web/src/pages/PublicEvent.tsx`, `web/src/api/schema.d.ts`. Proposed: approval record, next-available additive migration, bounded branding settings/presentation and tests. No migration filename assumed.

### BACKEND CONTRACT
Proposed after approval: `logo_url`/`cover_url` NULL means default, otherwise HTTPS URLs length ≤500; `accent_color` NULL or six-digit `#RRGGBB`. Normalize submitted empty strings to NULL; omission on PATCH preserves existing value. Reject unsafe schemes/invalid hex with 422. Organizer-owned `POST /api/events`/`PATCH /api/events/{event_id}` write fields; anonymous public Event response exposes them additively. Preserve all existing fields/statuses and tenant 404.

### FRONTEND CONTRACT
Until approval/delivery no live editor or fake controls. After approval: load/read/edit/save/error/default, unavailable image fallback, contrast-tested approved accent or accessible default fallback; no dependency on branding for public content. Never apply arbitrary font or color to QR readability.

### DATA MODEL IMPACT
Approved additive nullable varchar(500) logo/cover and varchar(7) accent columns, NULL defaults, no historical inference, FKs, uniqueness or new indexes. Serialize the approval-only expansion after the actual head containing P03-T17; test populated prior records stay NULL, old bodies still work and application rollback retains data. Never renumber earlier expansions.

### IMPLEMENTATION STEPS
1. Obtain recorded approval of fields/limits/contrast policy and scope.
2. Inspect actual model/head; add approved schema and generated contract.
3. Validate organizer writes and anonymously render bounded branding with fallback.
4. Test invalid URLs/hex, contrast/image failures and old requests/records; document defaults/rollback.

### ACCEPTANCE CRITERIA
- Given no approval, when task is assigned, then BLOCKED with no schema/UI mutation.
- Given approved valid values, when saved by owner, then public Event exposes exactly additive fields.
- Given unsafe URL/invalid accent, when saved, then 422 and original data remain.
- Given low contrast or failed image, when displayed, then usable default fallback preserves content/QR.

### AUTOMATED TESTS
After approval: Event/public/tenant API cases and populated additive-migration tests; browser P03-T56 validation/default/contrast/image/header cases; web/canonical gates. None execute before approval.

### MANUAL VERIFICATION
Record approval first. In disposable A/B tenants, set approved HTTPS images/hex as A owner, reload public A anonymously; test HTTP/javascript URL, invalid hex, failed image and low-contrast accent. Confirm B owner 404, old unbranded events unchanged, QR legible and EN/FA at 320/390px.

### SECURITY CHECKS
HTTPS-only safe asset references; no server fetch/SSRF, arbitrary styles/fonts or credential-bearing URLs; output escaping and contrast fallback.

### REGRESSION GUARDS
R03, R10, R16, R18, R19, R20.

### ROLLBACK
Disable branding rendering/editor and use defaults while retaining additive fields; no schema downgrade after writes.

### DELIVERABLES
Approval reference; only after approval, bounded schema/API/UI/tests and fallback evidence.

### DEFINITION OF DONE
Approved exact field contract and all acceptance/checks pass, or remains explicitly BLOCKED outside release scope. Task-size review: three bounded fields, not generic customization.

### STOP CONDITION
No approval means stop BLOCKED; do not implement a speculative branding model or broaden fonts/content.

---

## P03-T57
### TASK ID
P03-T57

### TITLE
Approval-gated global organization/title profile editing

### PRODUCT OUTCOME
If approved, a User edits only their global organization/title while identity and privacy consent stay unchanged.

### BASELINE
`GET /api/auth/me` is read-only. User stores organization/title, full_name/email and `share_contact_with_peers`; current limits are organization 200, title 100.

### PREREQUISITES
P03-T28 plus explicit product approval of global editing scope and mutable-profile versus historical-ticket behavior. Default status: BLOCKED.

### IN SCOPE
After approval only: `PATCH /api/auth/me` organization/title allowlist, self-profile UI, validation, partial update and successful refetch.

### OUT OF SCOPE
No name/email/password/consent mutation here, attendee category change, event-specific identity, merge/recovery or immutable badge-profile snapshot redesign.

### EXPECTED FILES
Confirmed existing: `backend/app/routes/auth.py`, `backend/app/models.py`, `backend/tests/test_auth.py`, `web/src/api/schema.d.ts`. Proposed/prerequisite-delivered: read-only My Profile module, approved profile edit form and API/browser tests.

### BACKEND CONTRACT
Proposed `PATCH /api/auth/me` with optional `organization` (≤200) and `title` (≤100), omission leaves unchanged, empty string clears; reject null/unknown/read-only fields with 422. CurrentUserDep only, self row, return UserOut. Preserve full_name/email/consent exactly. No client User ID. 401 invalid/family mismatch; no organizer/desk/scanner fallback.

### FRONTEND CONTRACT
Until approval read-only. After delivery: viewing/editing/saving/saved, validation/failure preserving draft, unchanged cancellation and shared session states. Explain global scope; do not silently promise historical badge text permanence or alter consent controls owned by P03-T28.

### DATA MODEL IMPACT
No new schema; existing User fields updated. Category/snapshot and Ticket IDs/QR unaffected.

### IMPLEMENTATION STEPS
1. Record approval and confirm existing ticket profile reads versus historical snapshot limits.
2. Add strict self-only PATCH and generated types.
3. Add bounded form to delivered My Profile, preserving separate privacy actions.
4. Test allowed/disallowed fields, global reads and consent invariance; document global scope.

### ACCEPTANCE CRITERIA
- Given no approval, when task begins, then no edit endpoint/control is delivered.
- Given allowed values, when User updates self, then organization/title change and name/email/consent remain exact.
- Given full_name/email/consent/User ID or other fields, when PATCHed, then 422 causes no mutation.
- Given omitted title, when organization changes, then title is unchanged.

### AUTOMATED TESTS
After approval `uv run pytest tests/test_auth.py tests/test_networking.py tests/test_tickets.py -q` plus allowlist/family cases; browser P03-T57 edit/cancel/errors/refetch/global-context tests; web/canonical gates.

### MANUAL VERIFICATION
Record approval; User A changes organization/title, reloads Profile in two congresses, and verifies global values. Attempt forbidden fields/overlength/null with API; compare name/email/consent before/after. Use User B and wrong credential families to confirm no A mutation; verify ticket QR/type snapshot unchanged and EN/FA/mobile behavior.

### SECURITY CHECKS
Strict input allowlist and authenticated self row; preserve consent and identity; no mass assignment or global User mutation via reception.

### REGRESSION GUARDS
R01, R03, R05, R06, R16, R19, R20.

### ROLLBACK
Remove editor/disable PATCH coherently; preserve legitimately saved organization/title and existing read/privacy APIs.

### DELIVERABLES
Approval reference; approved endpoint/form, allowlist tests and global-scope evidence only after approval.

### DEFINITION OF DONE
Exact self-only field boundary and unchanged identity/consent proven. Task-size review: two existing global fields, no account-lifecycle changes.

### STOP CONDITION
Stop BLOCKED without approval; identity/contact-consent editing requires separately approved scope.

---

## P03-T58
### TASK ID
P03-T58

### TITLE
Approval-gated restricted Partner profile editing

### PRODUCT OUTCOME
If approved, a PartnerStaff member edits profile content only, without acquiring ownership, staff-management or Booth lead powers.

### BASELINE
Partner APIs are proposed prerequisites; workspace is read-only by default. PartnerStaff is profile authority, BoothStaff is exact lead authority.


### PREREQUISITES
P03-T47 plus explicit product approval of field/URL validation, role authority and release scope. Default status: BLOCKED.

### IN SCOPE
After approval only: `PATCH /api/partners/{partner_id}/profile` with description/website_url/logo_url/brochure_url; strict allowlist, approved limits/safe HTTPS URLs, editor and truthful `edit_profile` capability.

### OUT OF SCOPE
No name/type/event/staff/Booth changes, organizer identity, lead permission, Partner archive/hard delete, invitation or asset upload.

### EXPECTED FILES
Confirmed existing reference patterns: `backend/app/routes/booths.py`, `backend/app/routes/leads.py`, `web/src/pages/ExhibitorPortal.tsx`, `web/src/api/schema.d.ts`. Proposed/prerequisite-delivered: Partner route/model/read-only profile module and approved editor/tests; locate actual names from prerequisite reports.

### BACKEND CONTRACT
Proposed User+exact PartnerStaff PATCH with only four fields; omission unchanged, empty string clears; unknown/read-only/null/unsafe URL rejected 422. URLs HTTPS and ≤500; description new writes max2000 characters, matching Partner admin request validation. Preserve readable longer legacy backfill values unless explicitly edited; output schema remains an unrestricted string. 403 known nonmember/revoked membership, 404 unknown, 401 invalid User. Return updated profile. `edit_profile:false` until endpoint/UI/security tests are delivered; then true only for authorized delivered capability. No lead grants created.

### FRONTEND CONTRACT
Read-only until approval/delivery. Approved editing/saving/saved, validation/failure preserving draft, cancel unchanged, membership removed/403 hides editor and authoritative stale data; safe missing-image/default states. No staff/type/name/event controls.

### DATA MODEL IMPACT
No new fields or migration beyond delivered Partner package; only approved profile values update. If prerequisite fields are missing or incompatible, stop BLOCKED for reconciliation instead of adding an unplanned migration.

### IMPLEMENTATION STEPS
1. Record precise approval including description limit and HTTPS link rules.
2. Add strict authorized PATCH/generated types; expose delivered capability only after coherent integration.
3. Add bounded editor to read-only profile while retaining separate Booth grants.
4. Test field and cross-Partner negatives, removed membership and public profile refresh; document restrictions.

### ACCEPTANCE CRITERIA
- Given unapproved/undelivered editing, when profile loads, then edit_profile is false and no editor exists.
- Given sponsor PartnerStaff, when approved profile fields save, then profile updates but Booth/lead counts/grants stay unchanged.
- Given name/type/event/staff/booth payload, when PATCHed, then 422 with no mutation.
- Given P member only, when Q profile PATCH is attempted, then 403.

### AUTOMATED TESTS
Approved Partner PATCH allowlist/URL/revocation matrix and existing Booth/lead regressions; browser P03-T58 edit/cancel/failure/capability/public-refetch cases; web/canonical gates.

### MANUAL VERIFICATION
Record approval; sponsor P member edits four allowed values and reloads private/public profile. Send forbidden ownership/staff/Booth fields, unsafe URL and overlength input; verify no partial mutation. Remove P membership and repeat using same JWT; expect 403 and no editor. Test Q and lead API denial; repeat EN/FA/mobile.

### SECURITY CHECKS
No mass assignment; exact PartnerStaff per request; membership removal removes underlying Partner Booth grants atomically; no profile edit implies leads.

### REGRESSION GUARDS
R07, R08, R09, R16, R19, R20.

### ROLLBACK
Disable editor/PATCH and report edit_profile false; retain saved profile data and exact Booth grants.

### DELIVERABLES
Approval reference; after approval, restricted endpoint/editor, negative tests and capability evidence.

### DEFINITION OF DONE
Four-field boundary and no authority expansion pass. Task-size review: bounded profile mutation, no staff/domain lifecycle.

### STOP CONDITION
Stop BLOCKED absent approval or unresolved description/URL contract; never expose speculative editing capability.

---

## P03-T59
### TASK ID
P03-T59

### TITLE
Scientific program/speaker decision and schema gate only

### PRODUCT OUTCOME
Actual scientific requirements become a reviewed finite implementation addendum, or the release explicitly excludes scientific content. No unknown-schema feature is implemented under this task.

### BASELINE
Current Event/public API has dates/description but no scientific agenda/session/speaker/content model. Earlier desired sections are not implemented source contracts.

### PREREQUISITES
P03-T00 plus explicit client schema/content approval. This decision-only task creates a reviewed finite task addendum, not application code.

### IN SCOPE
Decision record covering actual content/source/ownership, required speaker/session relationships, publication/moderation, dates/time zones/localization, ordering, permissions, asset/link policy, imports/updates and release inclusion; reviewed executable task addendum with exact contracts/dependencies/tests/rollback.

### OUT OF SCOPE
All application changes: no models/migrations/endpoints/types/components, no mock speakers/schedule, no placeholder program tab or broad single implementation task.

### EXPECTED FILES
Confirmed read-only reference: `backend/app/models.py`, `backend/app/routes/public.py`, `web/src/pages/PublicEvent.tsx`, Phase 03 roadmap/contracts. Proposed deliverable: approved decision/schema and separately reviewed finite task addendum in the planning package. No application module proposed as an implemented deliverable.

### BACKEND CONTRACT
None delivered here. Addendum must define real approved schemas, endpoint request/response/status contracts and ownership/public redaction before implementation is authorized.

### FRONTEND CONTRACT
Existing real-metadata UI remains unchanged and scientific controls absent. Addendum must specify actual future loading/populated/empty/unpublished/error/permission/localization states; this task delivers no UI or placeholder.

### DATA MODEL IMPACT
None. A reviewed proposed schema is a decision artifact, not an applied migration or proof of suitability.

### IMPLEMENTATION STEPS
1. Collect actual scientific content and responsible approver; distinguish mandatory from optional release needs.
2. Resolve concrete content/permission/publication/timezone/localization and asset questions against existing architecture.
3. Write reviewed contracts and atomize into finite tasks with prerequisite edges, fixtures, acceptance and rollback.
4. Obtain product/technical review; mark implementation separately authorized or explicit release exclusion.

### ACCEPTANCE CRITERIA
- Given unavailable/unapproved actual requirements, when gate is reviewed, then BLOCKED and no application changes occur.
- Given approved actual requirements, when addendum is reviewed, then every feature has bounded schema/contracts/tests/dependencies before assignment.
- Given scientific content excluded, when release scope is recorded, then existing UI has no promised placeholder section.

### AUTOMATED TESTS
No application tests under this decision-only task. Future addendum must enumerate real schema/ownership/publication/localization tests and canonical checks for its own implementation tasks. Planning consistency review checks finite IDs/dependencies without running app checks.

### MANUAL VERIFICATION
Compare signed requirements to actual content samples and every addendum field/state; review ownership/redaction/timezone cases with product and technical owners. Confirm no source/DB/UI change, no placeholders and explicit release decision; record unresolved inputs as BLOCKED.

### SECURITY CHECKS
Review future content publishing authority, personal data/redaction, asset safety and cross-event ownership; do not invent a public schema from private source content.

### REGRESSION GUARDS
R10, R16, R18, R19, R20 (future addendum must add affected guards).

### ROLLBACK
Withdraw unapproved addendum; existing application unchanged. Never downgrade an uncreated schema.

### DELIVERABLES
Approved requirements/decision and separately reviewed finite task addendum, or exact BLOCKED decision report.

### DEFINITION OF DONE
Decision/addendum review complete; no app capability claimed. Task-size review: gate only; unknown scientific implementation must be split before assignment.

### STOP CONDITION
BLOCKED until actual approved requirements; even approved completion authorizes no implementation under P03-T59.

---

## P03-T60
### TASK ID
P03-T60

### TITLE
API credential and cross-event/Partner security regression gate

### PRODUCT OUTCOME
Current API-backed evidence proves portal transport cannot substitute credentials or broaden event/Partner/Booth authority.

### BASELINE
Existing suites cover tenant/Booth/scanner isolation but not the entire new explicit-authority/Partner/Type matrix. Existing issued desk/scanner tokens already fail User auth through non-UUID subjects; explicit type rejection is defense in depth.

### PREREQUISITES
P03-T09, P03-T16, P03-T19, P03-T43, P03-T52.

### IN SCOPE
Dedicated negative/positive API and transport evidence for credential families, exact desk statuses/generation, PartnerStaff versus BoothStaff, membership removal, category event/history and tenant masking.

### OUT OF SCOPE
No new auth scheme, invitation/session redesign, silent security contract change, broad vulnerability remediation or deployment.

### EXPECTED FILES
Confirmed existing: `backend/tests/test_auth.py`, `test_desk_operator_auth.py`, `test_booths.py`, `test_leads.py`, `test_scanner_security.py`, `test_scanner_revocation_matrix.py`, `web/src/api/client.ts`. Proposed/prerequisite-delivered: access/Partner/Type tests, explicit-authority transport tests and security result artifact.

### BACKEND CONTRACT
Assert typeless User compatibility and rejection of issued desk/scanner plus signed wrong-type UUID-sub tokens; exact 401 expired/invalid/revoked desk, 403 revoked login/wrong-event/nonmember, organizer foreign tenant 404. PartnerStaff alone never authorizes leads; removing membership removes that user's Partner BoothStaff atomically. New grants require existing normalized-email User; absent User 409. Type is same-event/active/optional at issuance, historical snapshot immutable, no tier policy effect.

### FRONTEND CONTRACT
Exercise anonymous headers and every protected authority selection with all credentials stored; 401 clears only actual used credential, 403/404 retain, 5xx/network recoverable, no fallback/automatic replay. Wrong context never shows foreign data.

### DATA MODEL IMPACT
None beyond disposable test fixtures.

### IMPLEMENTATION STEPS
1. Build full family/resource/status matrix from delivered contracts.
2. Add missing negative tests without widening exact assertions.
3. Run targeted matrix, relevant suites and canonical gate once integrated.
4. Record exact commands/status/counts/artifacts and unresolved security failures; update gate documentation.

### ACCEPTANCE CRITERIA
- Given each credential family, when sent to each relevant portal endpoint, then only intended authority succeeds.
- Given same-Partner A/B grants and profile-only sponsor, when forbidden leads/profile are requested, then exact denial holds.
- Given desk revoke/reactivate, when old token is reused, then 401 persists.
- Given foreign/inactive category or renamed type, when issuing/reading, then rejection/snapshot invariants and unchanged quota hold.

### AUTOMATED TESTS
Run targeted existing files above plus prerequisite access/Partner/Type/transport suites, then `uv run pytest -q`/`uv run mypy`, web tests/typecheck/lint/build and canonical root wrapper. Tag browser transport cases P03-T60; mocks and live API results separated.

### MANUAL VERIFICATION
In disposable two-tenant/two-event setup, run each credential against User/organizer/desk/Partner/Booth/scanner families; compare exact code/header and no foreign response PII. Remove Partner member and revoke/reactivate desk while retaining old JWTs. Inspect public/auth network headers with all credentials stored and category historical label after rename.

### SECURITY CHECKS
This is the security gate: no privilege fallback, token logging, UI-only authorization, cross-Partner leak or category-derived access. Scanner/device isolation remains unchanged.

### REGRESSION GUARDS
R01, R02, R03, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R20.

### ROLLBACK
Mark gate failed/No-Go and contain affected coherent feature; keep protective schema/generation changes. Contract remediation requires separately bounded task, not weakened tests.

### DELIVERABLES
Executable matrix tests, current command artifacts and exact security verdict.

### DEFINITION OF DONE
Every matrix cell and mandatory gate passes with current evidence. Task-size review: one cross-boundary security gate, not remediation implementation.

### STOP CONDITION
Any required denial/ownership/status failure is No-Go; stop after gate report, no deployment or next task.

---

## P03-T61
### TASK ID
P03-T61

### TITLE
Real-browser portal journeys and deep-link/history gate

### PRODUCT OUTCOME
Actual API-backed user journeys and every retained URL work through login, direct entry, reload and browser history.

### BASELINE
Current Playwright suites focus on scanner; no complete new portal journey gate exists. Unit/source evidence cannot prove browser workflows.

### PREREQUISITES
P03-T20, P03-T27, P03-T30, P03-T32, P03-T33, P03-T34, P03-T35, P03-T36, P03-T44, P03-T51, P03-T52, P03-T54, P03-T55.

### IN SCOPE
Real-backend attendee/organizer/reception/Partner/public journeys, active context switches, protected failures, all 11 current routes and delivered canonical routes; truthful performance measurements.

### OUT OF SCOPE
No deployment, mocked-only acceptance, new feature scope, printer guarantee or scanner state-machine refactor.

### EXPECTED FILES
Confirmed existing: `web/playwright.config.ts`, `web/e2e/scanner-offline.spec.ts`, `web/e2e/scanner-real-api.spec.ts`, `backend/tests/test_e2e_lifecycle.py`. Proposed: portal real-API journey specifications, isolated data setup and evidence report; no exact new filename assumed.

### BACKEND CONTRACT
Exercise delivered APIs unchanged, including existing registration/tier quotas, network/vCard/bookmarks, analytics and explicit authorities. Use unique event slugs; synthetic fixture setup must not use production data.

### FRONTEND CONTRACT
For each portal test loading/populated/empty/error/401/403/404 and direct reload/Back. Attendee has exactly five primary destinations; directory stays in My Congress. Offline My Ticket event resolves from owner cache without `/api/me/access`. No alias redirects/loops or cross-context flashes.

### DATA MODEL IMPACT
Disposable fixture data only.

### IMPLEMENTATION STEPS
1. Define journey fixtures and real-backend test/environment requirements.
2. Cover public registration→reservation→My Ticket/network/profile/details; Organizer managers/analytics; reception issue/duplicate/reauth/print; sponsor and multi-Booth capture/qualification/export.
3. Cover retained URLs and canonical entries with reload/Back/denial cases.
4. Run tagged real-browser gate, record measurements and update evidence/compatibility matrix.

### ACCEPTANCE CRITERIA
- Given all existing URLs, when directly loaded/reloaded, then same resource/function remains reachable without redirects.
- Given multi-role/multi-event account, when switching context/portal, then correct destination credential and data are used.
- Given duplicate reception and lost session, when recovered, then explicit selection/submit is required.
- Given cached Ticket offline, when alias opens, then event/ticket renders without online discovery.

### AUTOMATED TESTS
From `web`, `npx playwright test --project=msedge --grep "P03-T61"` against real configured API; existing scanner specs remain separate. Run applicable backend lifecycle suite, web/canonical gates; record mock versus real distinction and actual timings, not historic claims.

### MANUAL VERIFICATION
Exercise `/`, `/organizer`, `/organizer/events/{id}`, `/organizer/events/{id}/desk`, `/organizer/events/{id}/analytics`, `/e/{slug}`, `/e/{slug}/booths/{booth}`, `/booth/{booth}`, `/my-tickets`, `/my-network`, `/scan/{point}`. Also open `/reception/{id}`, `/partner/{id}` and five `/c/{slug}` destinations. For each reload/Back, verify resource/auth and no loop; perform listed portal workflows and offline cached alias in EN/FA. Print preview only, no hardware claim.


### SECURITY CHECKS
No recorded secrets/PII; actual server denials and all credential stores tested; fixture cleanup cannot touch unrelated data.

### REGRESSION GUARDS
R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R16, R18, R19, R20.

### ROLLBACK
Gate failure is No-Go; contain failing cutover while retaining exact old routes and stored data.

### DELIVERABLES
Real-browser specs, all-route matrix, screenshots/traces and current journey/timing verdict.

### DEFINITION OF DONE
Every journey and route has current API-backed evidence. Task-size review: browser integration gate only; feature fixes require separately assigned bounded work.

### STOP CONDITION
Missing live environment or journey failure means BLOCKED/No-Go; no release conclusion from unit tests alone.

---

## P03-T62
### TASK ID
P03-T62

### TITLE
Seven-viewport EN/FA accessibility acceptance gate

### PRODUCT OUTCOME
Delivered portals remain usable at every prescribed width and locale with keyboard/focus/contrast/touch behavior proven, not assumed.

### BASELINE
Seven widths and WCAG-oriented behavior are targets in planning, not current measured compliance. Existing components include navigation/dialog primitives.

### PREREQUISITES
P03-T61.

### IN SCOPE
Widths 320, 375, 390, 430, 768, 1024, 1440; EN/LTR and FA/RTL; all delivered destinations, forms, pickers/dialogs, errors/empty states and conditional features actually in release scope.

### OUT OF SCOPE
No generic redesign, invented certification, arbitrary fonts, new accessibility dependency/install or omitted narrow/RTL cells.

### EXPECTED FILES
Confirmed existing: `web/playwright.config.ts`, `web/src/components/ui/Dialog.tsx`, `web/src/layouts/AttendeeLayout.tsx`, `web/src/lib/i18n.ts`. Proposed/prerequisite-delivered: viewport/accessibility cases for delivered shells/features and auditable acceptance matrix.

### BACKEND CONTRACT
Unchanged real APIs; tests use fixture states for populated/empty/denied/missing/failure, not private production data.

### FRONTEND CONTRACT
All shared states plus dialogs/menu/picker forms must be accessible at each width. Exactly five attendee tabs stay visible without clipping/sixth tab; RTL semantic order and mixed LTR identifiers correct. Touch targets ≥48×48 below 768 and ≥44×44 at 768+. Safe-area/zoom/reduced-motion/focus/labels/status announcements and keyboard modal trapping/restoration verified. Contrast meets intended WCAG AA thresholds; QR contrast unaffected by optional branding.

### DATA MODEL IMPACT
None except fixtures.

### IMPLEMENTATION STEPS
1. Enumerate every delivered screen/state × seven widths × two locales.
2. Add behavior assertions for overflow, target size, navigation, labels/focus/dialog and contrast evidence.
3. Run browser matrix plus manual keyboard/assistive and target-device checks.
4. Record exact failures/unsupported cells, never aggregate them away; update acceptance artifact.

### ACCEPTANCE CRITERIA
- Given 320px FA attendee shell, when five tabs render, then each remains actionable without horizontal overflow.
- Given modal at any width, when keyboard navigation/Escape occurs, then focus trap/close/restoration behave correctly.
- Given mixed email/UUID/date text, when RTL displays, then ordering is readable and meaning unchanged.
- Given any mandatory matrix cell fails, when gate assessed, then No-Go.

### AUTOMATED TESTS
Browser P03-T62 iterates exact widths/locales and delivered states, verifies interaction/geometry and accessible names; use existing capabilities without installing a new tool. Web/canonical gates. Automated assertions do not establish full screen-reader compliance.

### MANUAL VERIFICATION
For each 320/375/390/430/768/1024/1440 width in EN then FA, operate all five attendee tabs, organizer managers, reception form/search/pass, sponsor/multi-Booth workspace and public pages with keyboard. Open/close dialogs, trigger empty/errors, inspect tab labels/target sizes/overflow, 200% zoom, reduced motion and safe areas on target device. Use available screen reader for labels/status/focus and record reader/browser; include approved optional screens. Capture each matrix cell evidence.

### SECURITY CHECKS
Accessible error copy does not disclose foreign resources/PII; focus loss cannot leave hidden active camera or unintended submit.

### REGRESSION GUARDS
R03, R04, R05, R06, R07, R08, R09, R10, R11, R13, R18, R19, R20.

### ROLLBACK
Mark failed screens No-Go and contain affected presentation cutover; preserve route/data contracts. No weakening target widths or removing FA.

### DELIVERABLES
Complete viewport/locale/state matrix, interaction tests, screenshots and manual accessibility evidence.

### DEFINITION OF DONE
Every required cell passes with explicit evidence and limitations documented. Task-size review: accessibility acceptance boundary, not unrestricted UI remediation.

### STOP CONDITION
Any mandatory missing/failing cell blocks gate; no unobserved compliance claim.

---

## P03-T63
### TASK ID
P03-T63

### TITLE
Scanner/PWA offline, restart, update and device compatibility gate

### PRODUCT OUTCOME
Portal work has not disturbed the existing web scanner's operational authorization, durable queue or PWA behavior.

### BASELINE
GateScanner has point-scoped token/IndexedDB persistence, offline authorization window, provisional outcomes, idempotent sync, conflict retention and deferred update/unpair behavior. Native parity is not established.

### PREREQUISITES
P03-T08, P03-T61.

### IN SCOPE
Web scanner/PWA regression evidence: pairing/URL token removal, camera/HID/manual input as supported, online/offline/restart, expiry/window, revocation/unpair, sync failures/conflicts and controlled update.

### OUT OF SCOPE
No scanner rewrite, queue/token/scan-ID format change, new admission semantics or native implementation; P03-T66 handles native scope decision.

### EXPECTED FILES
Confirmed existing: `web/src/pages/GateScanner.tsx`, `web/src/lib/scannerEngine.ts`, `scannerStorage.ts`, `scannerTokenStore.ts`, `scannerAuthPolicy.ts`, `pwaRegistration.ts`, `web/vite.config.ts`, `web/e2e/scanner-offline.spec.ts`, `scanner-real-api.spec.ts`, `web/tests/scannerReliability.test.ts`. Proposed: extra compatibility cases/device evidence only where gaps remain.

### BACKEND CONTRACT
Existing protected manifest/batch/token/device revoke endpoints; exact point/event authority, client scan_id idempotency, conflict semantics and server policy unchanged. Queue retained until confirmed outcomes; rejected/conflict rows retained as defined. Offline remote revocation cannot be instant: enforce expiry and existing ≤24h contact window, then server denial on reconnect.

### FRONTEND CONTRACT
Credential restoring/loading, paired ready, provisional offline admission, local rejection, pending sync, confirmed/conflict, invalid authorization/expired/wrong scope, pending deactivation, network/5xx/malformed failure and update waiting. No portal shell intercepts `/scan/:pointId`; cached manifest cannot bypass credential restoration/window.

### DATA MODEL IMPACT
No schema/format change; disposable scanner data/device records only.

### IMPLEMENTATION STEPS
1. Confirm scanner transport cutover preserved device/admin authority and route.
2. Extend gaps in existing deterministic and live API suites without refactoring state machine.
3. Exercise real PWA install/offline/restart/camera/HID/update/revoke/unpair on target devices.
4. Record durable queue/authorization limitations and current gate verdict.

### ACCEPTANCE CRITERIA
- Given queued offline scan, when restarted then reconnected, then same scan_id syncs once and remains until confirmed.
- Given expired/offline-window-lapsed token, when offline badge entered, then admission is blocked.
- Given failed remote unpair, when browser restarts, then pending deactivation still blocks and queue remains.
- Given update available mid-shift, when prompt deferred, then no uncontrolled swap loses scans.

### AUTOMATED TESTS
From `web`: `npm test`; `npx playwright test e2e/scanner-offline.spec.ts --project=msedge`; `npx playwright test e2e/scanner-real-api.spec.ts --project=msedge` with required live admin/test environment. Backend scanner/check-in/concurrency/security suites, web/canonical gates. Skipped live API case is not PASS.

### MANUAL VERIFICATION
Pair synthetic point on target installed PWA, verify token removed from URL, load manifest, go offline, capture badge, close/restart, inspect same pending scan ID, reconnect and verify confirmed/conflict state. Test camera/HID paths, token expiry/window, organizer device revoke while online/offline, failed then successful unpair and pending-update deferral/application. Record device/browser, queue counts and exact outcomes; no production gate scans.

### SECURITY CHECKS
No credential substitution/API cache, no offline-window bypass, no premature queue deletion; explain physical-device custody and revocation latency.

### REGRESSION GUARDS
R03, R13, R14, R15, R16, R17, R18, R19, R20.

### ROLLBACK
No-Go; restore coherent scanner transport if required while preserving IndexedDB/queue/token formats and stronger auth protections.

### DELIVERABLES
Current scanner automated/live/device artifacts and explicit compatibility/limitation verdict.

### DEFINITION OF DONE
Durability, authority, device and update cases pass with real device evidence. Task-size review: scanner regression gate, no engine/native remediation.

### STOP CONDITION
Any queued-data loss, authorization bypass or missing mandatory device evidence blocks release; stop after gate.

---

## P03-T64
### TASK ID
P03-T64

### TITLE
Populated migration and application rollback rehearsal

### PRODUCT OUTCOME
Serialized expansions preserve real legacy relationships/QRs and allow safe application rollback without dropping newly written domain data.

### BASELINE
Existing Alembic chain reaches `0011_desk_operators_and_attribution.py`; ordinary test fixture fresh-upgrades, not populated legacy rehearsal. Earlier numeric future revision suggestions are not binding.

### PREREQUISITES
P03-T14, P03-T19, P03-T60.

### IN SCOPE
Disposable populated 0011→desk generation→Partner→Type rehearsal, mixed-writer nullable compatibility, ownership constraints, new-data application rollback and restoration/roll-forward evidence.

### OUT OF SCOPE
No production migration, destructive downgrade after new writes, renumbering 0011, heuristic company merge or schema redesign.

### EXPECTED FILES
Confirmed existing: `backend/migrations/versions/0011_desk_operators_and_attribution.py`, `backend/tests/conftest.py`, `backend/app/models.py`, `backend/tests/test_management_lifecycle.py`. Proposed/prerequisite-delivered: actual serialized expansion revisions, populated migration fixtures/assertions and rollback evidence record. Inspect actual head; no fixed future filename.

### BACKEND CONTRACT
Old-compatible app operations retain QR/Booth/Ticket behavior against additive schema. New app supports exact Partner grants, optional category and immutable name-at-issue. Older app rollback must not undo session-generation enforcement; if it cannot preserve new auth invariants, rollback is containment/read-only or compatible backport, not unsafe restart.

### FRONTEND CONTRACT
Rehearsal smoke verifies legacy URLs/public/ticket/Booth/desk entries and delivered states against current and compatible rollback application; new-feature UI may be disabled during rollback. No fake success for inaccessible new content; old app must not reinterpret category as tier.

### DATA MODEL IMPACT
Disposable migrations/data only. Verify NULL legacy category/snapshot, version0 desk compatibility, one Partner per legacy Booth, profile staff backfill and same-event composite FKs. No source production schema mutation under rehearsal unless separately assigned fixture work.

### IMPLEMENTATION STEPS
1. Record actual head/order and snapshot populated 0011 fixture containing two tenants/events, operators, Booth staff/leads/bookmarks/EntityQRs/Tickets/scans.
2. Apply delivered revisions serially; compare IDs/secrets/counts/profile values/constraints and old-writer nullable compatibility.
3. Accept representative new Partner/type/grant writes; rehearse approved compatible app rollback with expand schema retained.
4. Restore/roll forward and compare data again; rehearse schema downgrade only on separate no-new-write disposable fixture with explicit loss limits.

### ACCEPTANCE CRITERIA
- Given populated 0011, when upgraded, then original IDs/QR secrets/leads/bookmarks/tier counts remain unchanged.
- Given legacy Tickets, when upgraded, then category/snapshot stay NULL without inference.
- Given new domain writes, when app rollback rehearsed, then data/grants and generation protections survive; schema is not dropped.
- Given cross-event Partner/type link, when inserted, then DB rejects it.

### AUTOMATED TESTS
Dedicated populated migration tests plus management/Booth/Ticket/desk/concurrency suites, current Alembic-head checks in disposable environment, web smoke and canonical root gate. Future operator records exact `uv run alembic upgrade head` from `backend` after fixture preparation; downgrade command limited to approved disposable no-write rehearsal.

### MANUAL VERIFICATION
In two separate disposable databases, record preupgrade IDs/secrets/counts, apply serialized chain and inspect backfill/FKs; create boothless sponsor/multi-Booth member/categorized ticket, switch only to approved compatible rollback app with schema retained, open old URLs and verify data. Roll forward/restore and compare. Use separate no-new-write fixture for any downgrade; label post-write downgrade lossy/prohibited.

### SECURITY CHECKS
Backups/evidence redact secrets; no production DB target; rollback never reintroduces desk-token resurrection or stale lead grants.

### REGRESSION GUARDS
R02, R03, R07, R08, R09, R10, R11, R12, R14, R15, R16, R17, R18, R20.

### ROLLBACK
Retain expand schema after domain writes; approved compatible app rollback/containment and verified restore/roll-forward only. Downgrade requires no new data or separate explicit data-loss authorization.

### DELIVERABLES
Populated migration tests, actual linear-chain manifest, data comparison and application rollback/restore evidence.

### DEFINITION OF DONE
Populated upgrade, constraint and safe rollback/restore criteria pass. Task-size review: one migration/recovery gate, not migration implementation.

### STOP CONDITION
Wrong revision order, QR/backfill drift, unsafe app rollback or unverified restore is No-Go; no production migration authorized.

---

## P03-T65
### TASK ID
P03-T65

### TITLE
Clean-checkout staging evidence and pilot Go/No-Go report

### PRODUCT OUTCOME
A reviewer can decide pilot readiness from fresh complete evidence, while pilot authorization and deployment remain separate human decisions.

### BASELINE
Existing historical 131/28/8 pass claims and dirty-worktree observations are not current readiness proof. Canonical wrappers omit browser/device/populated migration/native release gates.

### PREREQUISITES
Hard prerequisites: P03-T60, P03-T61, P03-T62, P03-T63, P03-T64, P03-T66. The explicit all-task evidence checklist in IMPLEMENTATION STEPS and DEFINITION OF DONE is an additional completion gate, not a self-dependency or substitute for these graph edges.

### IN SCOPE

Approved clean-checkout/staging verification, exact SHA/manifest/env provenance, all-task reconciliation, current canonical/additional gates, residual-risk/rollback report and Go/No-Go recommendation.

### OUT OF SCOPE
No deployment, production migration, pilot user onboarding, commit/push authorization, weaker evidence substitution or silently omitted off-critical-path tasks.

### EXPECTED FILES
Confirmed existing: `scripts/check.bat`, `scripts/check.sh`, `web/playwright.config.ts`, `backend/tests/conftest.py`, Phase 03 roadmap/protocol. Proposed: release evidence manifest, complete task checklist, staging results and pilot decision report; approved conditionals/addendum referenced explicitly.

### BACKEND CONTRACT
No contract change. Reproduce actual current schemas/API/generated types and required environment without disclosing secrets. Verify approved 0011 and actual serialized expansions; isolated staging only. Real auth/tenant/grant/category/scan invariants must already pass.

### FRONTEND CONTRACT
All delivered journeys/states and preserved 11 URLs/canonical entries, five attendee destinations, seven widths/two locales and offline/device cases must have fresh matching-SHA evidence. Read-only optional features remain default if excluded. Scientific/native scope decisions are explicit, not hidden missing UI.

### DATA MODEL IMPACT
No production change; staging/disposable schema/data setup and approved migration rehearsal only.

### IMPLEMENTATION STEPS
1. Verify approved baseline and obtain dedicated clean checkout/staging authorization; do not discard existing work.
2. Enumerate every task below, acceptance report/SHA/check artifact and approved scope decision; reject omissions.
3. Run current canonical gate and additional lint/schema-drift/browser/migration/PWA/device/native-scope gates required by approved scope; record exact commands/exits/counts.
4. Reconcile same-SHA evidence, blockers/risks/rollback and produce recommendation; request separate human pilot authorization without deploying.

Completion checklist must explicitly include: P03-T00, P03-T01, P03-T02, P03-T03, P03-T04, P03-T05, P03-T06, P03-T07, P03-T08, P03-T09, P03-T10, P03-T11, P03-T12, P03-T13, P03-T14, P03-T15, P03-T16, P03-T17, P03-T18, P03-T19, P03-T20, P03-T21, P03-T22, P03-T23, P03-T24, P03-T25, P03-T26, P03-T27, P03-T28, P03-T29, P03-T30, P03-T31, P03-T32, P03-T33, P03-T34, P03-T35, P03-T36, P03-T37, P03-T38, P03-T39, P03-T40, P03-T41, P03-T42, P03-T43, P03-T44, P03-T45, P03-T46, P03-T47, P03-T48, P03-T49, P03-T50, P03-T51, P03-T52, P03-T53, P03-T54, P03-T55, P03-T60, P03-T61, P03-T62, P03-T63, P03-T64, P03-T65, P03-T66. Explicitly retain P03-T20, P03-T27, P03-T32, P03-T33, P03-T34, P03-T35, P03-T51 and P03-T54 despite not all lying on the longest dependency chain. For P03-T56/P03-T57/P03-T58, require completed gates if approved/included or explicit exclusion. For P03-T59, require approved decision plus all separately approved/included addendum implementation gates, or explicit scientific exclusion/BLOCKED scope decision.

### ACCEPTANCE CRITERIA
- Given any unconditional task lacks accepted evidence, when report is produced, then No-Go identifies the exact missing ID.
- Given approved conditional scope, when assessed, then its actual implementation/addendum acceptance gates are mandatory.
- Given native required but not viable, when assessed, then pilot is BLOCKED, not web-only Go.
- Given all current evidence passes, when recommendation is Go, then report still states pilot authorization/deployment not granted.

### AUTOMATED TESTS
From approved clean checkout run canonical root wrapper, task-specific security/backend/web suites, `npm run lint`, generated schema consistency using approved existing generation command, real Playwright journeys, exact viewport cases and populated migrations. Run scope-required scanner/native evidence gates separately. Record omitted canonical-wrapper coverage and current counts; no historical result reuse.

### MANUAL VERIFICATION
Review clean SHA/file manifest/environment redacted config; reproduce public→attendee, organizer→analytics/managers, reception→issue/duplicate/reauth/print and sponsor/multi-Booth→manual/camera/qualification/export staging journeys. Inspect all 11 URLs, seven EN/FA widths, owner-cache offline Ticket and PWA restart/revoke/update evidence. Review rollback/restore and native/conditional approvals with release owner. Sign only recommendation; perform no deployment/pilot activation.

### SECURITY CHECKS
Full R20 family matrix, cross-tenant/Partner/event isolation, secret-free evidence, reviewed generation/grant removals and physical-device custody. No unapproved Git cleanup or production data mutation.

### REGRESSION GUARDS
R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20.

### ROLLBACK
No deployment occurs here. Failed gate means No-Go; use reviewed containment/application rollback with expand schema retained and verified restore plan. Never destructive worktree cleanup or unapproved downgrade.

### DELIVERABLES
Complete task/scope checklist, clean-checkout/staging evidence manifest, exact current results, residual risks/rollback and signed Go/No-Go recommendation separate from pilot authorization.

### DEFINITION OF DONE
Every unconditional and approved conditional/addendum deliverable accepted with current evidence; all release gates complete and decision explicit. Task-size review: release evidence/reconciliation boundary only, not feature completion or deployment.

### STOP CONDITION
Missing mandatory evidence/scope approval/native viability means BLOCKED/No-Go; stop after report. Pilot authorization, deployment and production migrations require distinct explicit human assignments.

---

## P03-T66
### TASK ID
P03-T66

### TITLE
Native scanner scope decision and preserved-client compatibility evidence

### PRODUCT OUTCOME
Release owners explicitly decide whether native scanning is required and understand existing native limitations; mandatory nonviable native scope blocks pilot.

### BASELINE
Native services have logic/sync tests, but setup lacks valid scanner authority, storage is in-memory, camera UI is not actual capture, and offline/device lifecycle parity is absent. Canonical Dart checks exclude Flutter screens/main and are not native release proof.

### PREREQUISITES
P03-T00 plus explicit release-scope approval.

### IN SCOPE
Decision/evidence only: source/contract compatibility review, preserved existing model/service behavior checks, actual native viability assessment and signed include/exclude/blocked release scope. If native required, a separately approved finite remediation backlog and real-device acceptance gates are prerequisites to pilot, not implementation here.

### OUT OF SCOPE
No native source/model/storage/auth/camera/dependency/project repair, no native build scaffold, no prototype-as-parity claim and no broad remediation hidden under this gate.

### EXPECTED FILES
Confirmed read-only reference: `mobile/lib/services/api_service.dart`, `storage_service.dart`, `sync_service.dart`, `policy_engine.dart`, `mobile/lib/screens/login_point_select_screen.dart`, `camera_scanner_screen.dart`, `mobile/pubspec.yaml`, `mobile/test/api_and_sync_test.dart`, `storage_and_sync_test.dart`, `policy_engine_test.dart`, canonical wrappers. Proposed: native scope/compatibility evidence and separately reviewed remediation addendum if required; no native implementation module.

### BACKEND CONTRACT
Existing protected point-scoped manifest/batch/device APIs and scanner JWT required. User login token is not scanner authority. Preserve scan_id/reconciliation/policy formats for existing clients; no backend weakening to accommodate absent native auth or durability.

### FRONTEND CONTRACT
No native UI change. Decision must distinguish actual unsupported pairing, camera, restart durability, auth errors/window, provisional/conflict, revoke/unpair and update/device behavior from tested pure services. If native excluded, label prototype accurately; web PWA scope still depends on P03-T63. If included, all missing real states require separate approved remediation/evidence before Go.

### DATA MODEL IMPACT
None; no storage migration or native persistence implementation.

### IMPLEMENTATION STEPS
1. Record baseline/scope approval and inspect current native setup, manifest/auth, storage/camera/policy and wrapper coverage.
2. Run existing logic/service compatibility checks only when future gate assigned; preserve current source and distinguish tests from device behavior.
3. Review real-device viability against required release workflows without inventing missing implementation.
4. Obtain signed exclusion or required-native decision; if required nonviable, mark pilot BLOCKED and define separately reviewed finite remediation/evidence addendum.

### ACCEPTANCE CRITERIA
- Given only Dart logic passes, when assessing native readiness, then no native auth/camera/persistence/parity claim is made.
- Given required native and current missing protected auth/durability/camera, when scope assessed, then P03-T65 pilot is explicitly BLOCKED.
- Given approved native exclusion, when report produced, then scope is web/PWA only and native limitations remain explicit.
- Given separately remediated required native in future, when pilot reviewed, then full native build/auth/camera/restart/revoke/offline/device evidence is mandatory.

### AUTOMATED TESTS
Future gate may run from `mobile`: `dart test` and `dart analyze lib/models lib/services test`, plus canonical root gate, recording coverage limitations. Full Flutter analyze/test/build/device checks are separately required only for approved native release after separately authorized remediation; this task does not install/fix dependencies or implement native code. Existing logic pass never substitutes for missing real-device proof.

### MANUAL VERIFICATION
Compare current source/setup with protected scanner API; document token absence/User-token mismatch, in-memory restart loss, camera noncapture and capacity/state/window/revoke gaps. With release owner review target native workflows and available real-device evidence; record exact platform/device/tool limitations and signed include/exclude decision. If native required and viable proof unavailable, explicitly mark pilot BLOCKED, list finite remediation gates and make no implementation changes.

### SECURITY CHECKS
Never weaken server scanner auth or infer native authority from attendee JWT; no lost pending scans concealed; revocation/offline-window/device custody limitations explicit.

### REGRESSION GUARDS
R03, R13, R14, R15, R16, R17, R18, R20.

### ROLLBACK
Withdraw unsupported release claim or keep native excluded only with approval; preserve existing client/source and backend contracts. Required native cannot be silently downgraded to web-only.

### DELIVERABLES
Signed native release-scope decision, current preserved-client/service compatibility evidence, explicit missing native gates and separately reviewed remediation addendum if required. No native implementation.

### DEFINITION OF DONE
Scope and evidence limitations are resolved truthfully; required nonviable native yields BLOCKED pilot until separate remediation/device gates pass. Task-size review: one release-scope/evidence gate, not native scanner reconstruction.

### STOP CONDITION
Stop after decision/evidence. No native implementation under P03-T66; missing required native viability blocks P03-T65/pilot explicitly.

---

## Task-size review for this backlog slice

P03-T37/P03-T38 separate reception shell from entry. P03-T39/P03-T40/P03-T41 separate lookup, issuance consumer and nonmutating pass presentation. P03-T42 is explicit conflict recovery; P03-T43 is one session-loss lifecycle; P03-T44 is compatibility cutover. P03-T45/P03-T46/P03-T47 separate Partner entry, context capability selection and sponsor-only read state. P03-T48/P03-T49/P03-T50 isolate existing capture, qualification and feed/export; P03-T51 is new camera input only; P03-T52 is URL parity. P03-T53/P03-T54/P03-T55 isolate real public metadata, delivered directory and existing auth/reservation integration. P03-T56–P03-T58 remain approval-blocked bounded contracts, not optional UI promises. P03-T59 is deliberately a decision/schema gate producing no application implementation; actual scientific scope must be atomized into a reviewed addendum. P03-T60–P03-T64 are independent security/browser/accessibility/scanner/migration verification boundaries; P03-T65 is complete release reconciliation without deployment; P03-T66 is a native scope/evidence gate without remediation implementation. Shared router/client/schema/i18n/model/migration changes retain one integration owner; no task silently adds generic retries, telemetry, validation policy or new business modules outside its stated boundary.
