# 08 — Implementation roadmap

Status: recommended future delivery plan; no production redesign was implemented. Phase 0 validation is complete and recorded in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md). Research date: 2026-10-10. Direction and contracts: [04](04-DESIGN-DIRECTIONS.md), [05](05-DESIGN-SYSTEM.md), [06](06-PAGE-BLUEPRINTS.md), [07](07-FRONTEND-ARCHITECTURE.md). Current source truth: [01](01-CURRENT-UI-AUDIT.md).

## Phase 0 validation addendum

Phase 0 completed local database migration, synthetic seeding, all 11 populated route renders, contract probes, issue triage and full verification. The result and remaining gates are in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md). This addendum supersedes later statements that PostgreSQL was unavailable, the check stopped on database fixtures, or Scanner endpoints were unauthenticated. Current endpoints require scoped credentials and omit attendee email; cross-scope replay and client credential rollout remain open.

## Delivery rules

Deliver small vertical releases, not a route rewrite. Existing routes, typed APIs, free-only tickets, ownership/isolation, QR payloads and UUID retry semantics survive each release. Migrate one complete user task, including empty/loading/error/denied/mobile behavior, then reuse its proven primitives. Do not create every proposed folder before it earns a purpose.

Complexity below is relative (low/medium/high), not a staffing estimate or completion guarantee. Verification entries are future required checks. `scripts/check.sh` or Windows `scripts/check.bat` remains required for integrated changes; Phase 0 established the current pipeline coverage, and browser/device checks supplement it. Preserve unique Event slugs in multi-event fixtures and expected Organizer 404/Booth 403 isolation outcomes.

Two lanes are deliberately separate:

- **Presentation lane:** hierarchy, tokens, shells, accessibility, responsive records, truthful copy, printing and safe export handling on existing contracts.
- **Contract/capability lane:** security, consent, account onboarding/recovery, booth resolver, persistent branding, PWA and native scanner completion. These have independent approval/acceptance and cannot be declared fixed by presentation changes.

The numbered sequence describes presentation adoption. Urgent scanner security and consent assessment begin in phase 0 and remediation must not wait for phase 7. An unsafe operational deployment can be blocked while unrelated public visual work proceeds. Operational **visual migration** is intentionally late.

## Phase 0 — Establish truth, gates and operational safety (completed)

**Outcome:** source claims, populated desktop/mobile baseline, local verification and contract/capability release gates have been reconciled. This phase did not implement redesign or alter business/security/synchronization contracts.

**Completed**
- Re-read the required project/design documents and compared source claims with current routes, API schema, backend auth, network/privacy behavior, Scanner clients and Flutter code.
- Started PostgreSQL, applied Alembic through `0008`, and seeded synthetic nonproduction Organizer, Event, ticket, Attendee, Booth, Lead, Connection and operational records for rendering.
- Rendered all eleven routes at 1440×960 and 390×844 CSS pixels; recorded 22 route captures and the separate 390px queued Scanner overflow under `docs/design/phase0-evidence/`.
- Ran the unified Windows check: mypy 39 files, pytest 88, web tests 5, TypeScript/build, Dart tests 8, and analyzer all passed.
- Reproduced/triaged cross-scope scan replay, offline/server result divergence, peer email disclosure, Ticket-cache access, missing Booth QR resolution, missing PWA/native capabilities, and the client credential integration gap. Separate GitHub issues #15–#25 are linked in the Phase 0 report.

**Limitations:** camera hardware, physical HID, assistive technology, kiosk and native Flutter runtime were not tested; populated 360/768/1024 captures are not yet recorded. The synthetic seed was created via API calls, not committed as a one-command fixture.

**Files/evidence:** see [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md), `docs/design/phase0-evidence/`, `web/src/main.tsx`, `web/src/api/`, `web/src/pages/`, `web/src/lib/`, relevant backend route/model files and Flutter scanner/auth/storage seams.

**Boundaries:** security/privacy/capability remediation remains separate from visual work; no new domain, payment, agenda or feature scope. Preserve tenant isolation, Entity QR payloads, Admission Policies, idempotency and durable synchronization until separately approved and behavior-tested.

**Remaining gates:** resolve #20 before Scanner release; define offline capacity and reconcile individual server outcomes (#15/#17); complete scoped device credential integration (#18); decide Ticket cache ownership/retention and peer consent (#16/#19); validate Scanner responsive behavior (#23). Decide separate product scope for Booth QR navigation, account onboarding, native Scanner and PWA (#21/#22/#24/#25).

**Phase 0 acceptance:** the local database is migrated and seeded; eleven populated routes have desktop/mobile screenshots; current full-stack checks pass; reproduced risks have separate prioritized issues; non-tested hardware/accessibility states are explicitly documented. The requirements for production Scanner, PWA or native release remain intentionally unaccepted until their gates pass.

## Phase 1 — Prove tokens and primitives in one public slice

**Objective:** ship the refined minimal grammar with a low-risk real page before altering operational workspaces.

**Tasks**
- Add semantic CSS tokens from 05 through Tailwind 4 `@theme inline`; retain 16px+ mobile inputs and scoped QR white plates.
- Introduce only needed controls, status/async states, header/skip link and Public layout; migrate Home as the first vertical release.
- Replace dead-end or misleading discovery copy with real routes. No Event directory appears unless a listing API/product decision exists.
- Establish a small component/state preview and browser screenshot/accessibility harness if approved. Certify actual foreground/background/focus pairs.

**Files:** modify `web/src/index.css`, `main.tsx`, `pages/Home.tsx`; proposed `styles/tokens.css`, `layouts/PublicLayout.tsx`, selected `components/ui/*`, `web/e2e/*`; package/lockfile changes only for deliberately selected test/primitive dependencies.

**Dependencies:** phase 0 baseline; approved token values and asset/font decision. System fonts are an acceptable first release.

**Boundaries:** Home/layout presentation only; keep all legacy route entries operational. No blanket class replacement, global dark toggle or inaccessible arbitrary Event colors.

**Risk / complexity:** low–medium; global CSS can still affect untouched pages. Gain: shared semantics and a measurable slice. Lower-cost alternative: tokens and native controls without a showcase or component library; avoid adopting a large design-system package to save a few classes.

**Verification:** all existing route shell smoke checks for CSS regressions; Home at 360/390/768/1024/1440; keyboard/skip link, 200%/400% reflow, reduced motion, contrast and long text. Run integrated repository checks after the release changes land.

**Acceptance:** Home expresses only available capabilities; focus/landmarks/navigation work; token styles do not alter legacy scanner outcomes or QR rendering; baseline review is recorded. Shared primitives have documented states rather than only a polished default.

## Phase 2 — Public Event, authentication and free reservation

**Objective:** deliver an accessible mobile Event-to-Ticket journey on existing auth/reservation APIs.

**Tasks**
- Migrate Event facts/tier composition and Public Booth using Event layout, with optional deployment-owned presentation presets and neutral fallback.
- Replace registration/login overlay mechanics with one accessible dialog primitive, including names, focus trap/return, Escape and scroll behavior.
- Expose neutral sign-in entry using existing login/register endpoints; preserve safe internal destination/reservation intent and avoid duplicate submission.
- Make unavailable tiers/server errors truthful. Quota remains total quota, not an invented remaining count. Bookmark sign-in has an actual action.
- Clarify Booth standee behavior: do not claim raw-secret QR opens the profile. Resolver/URL payload remediation is a distinct API/product decision.

**Files:** `pages/PublicEvent.tsx`, `PublicBooth.tsx`, `main.tsx`, `api/client.ts`; proposed `layouts/EventLayout.tsx`, `features/auth/*`, `features/events/*`, `components/ui/Dialog.tsx`, `config/eventPresentation.ts`.

**Dependencies:** phase 1 controls; working auth/public/reservation backend and seeded inventory; approved sign-in composition. Persisted Event branding is not a dependency for a neutral layout.

**Boundaries:** keep existing Event/Booth URLs, free tickets and one ticket per User/Event. No checkout, anonymous claim, password-reset promise, speakers or schedule. Static approved branding is not Organizer-editable theming. Explicit role credentials must not accidentally send Organizer keys for attendee tasks.

**Risk / complexity:** medium; auth/reservation order and race errors are more important than hero polish. Gain: complete conversion journey and usable dialogs. Lower-cost alternative: current fields plus neutral layout; defer artwork/presets entirely rather than invent data.

**Verification:** new/existing User sign-in, reservation success, quota exhaustion and duplicate ticket attempts; expired credentials, network failure and retained draft; keyboard/mobile dialog; long Event content; tenant-independent public Booth lookup. Test concurrent reservation against server semantics, not only disabled buttons.

**Acceptance:** 360/390px user can read facts, authenticate and reserve without clipped controls; one server result produces one ticket destination; errors are accessible; no unsupported inventory/branding/onboarding claim is displayed. Unauthenticated bookmark has a working sign-in path.

## Phase 3 — Attendee pass-first workspace and network

**Objective:** make tickets immediately usable and personal saved content coherent without misrepresenting disclosure or offline guarantees.

**Tasks**
- Add Attendee layout/navigation and centralized session-change/expired-session presentation; migrate Tickets then Network in separate vertical releases.
- Extract pass/QR presentation while preserving raw secret, quiet zone and white background. Distinguish cached pass availability, last refresh and missing token.
- Apply approved sign-out/purge/retention behavior only through the security lane, including shared-device decisions; do not silently destroy useful offline passes or expose prior-user data.
- Improve saved Booth and Connection rows, note editing, vCard download, dialog accessibility and honest manual-secret entry labels.
- Make disclosure/export UI reflect the backend only. Consent-aware behavior waits for the separately delivered model/DTO/export changes; never label unconditional email as opt-in.

**Files:** `pages/MyTickets.tsx`, `MyNetwork.tsx`, `api/client.ts`; proposed `layouts/AttendeeLayout.tsx`, `features/tickets/*`, `features/network/*`, shared QR/state/dialog UI. Consent/security lane may change `backend/app/models.py`, migrations and `backend/app/routes/network.py` with generated `api/schema.d.ts` updated together.

**Dependencies:** phase 2 attendee auth entry; privacy decisions from phase 0; seeded Ticket/bookmark/connection data. Consent release is required before claiming privacy compliance, not before neutral record-layout work.

**Boundaries:** no camera scanner, reciprocal connections or cached bookmarks promised unless implemented. Cache changes need explicit privacy/offline acceptance. No backend field hidden in the UI is considered undisclosed if API/vCard still exposes it.

**Risk / complexity:** medium–high around cached bearer credentials/QR privacy. Gain: usable ticket recovery and consistent personal workspace. Lower-cost alternative: preserve existing cache with honest warnings until the approved security release; cosmetic concealment is not a privacy alternative.

**Verification:** online/offline/reload/expired-token/sign-out/device-user switching; QR with real camera and print; notes update and vCard contents; keyboard and screen reader; 360/390 ticket and safe-area navigation; consent endpoint/export tests when that lane lands.

**Acceptance:** ticket stays readable/scanable without artwork or remote fonts; state never confuses cached access with an authenticated session; previous-user private records cannot flash across a completed approved session transition; Network describes actual one-way/manual behavior; privacy claims are withheld until API/export acceptance.

## Phase 4 — Organizer Event setup workspace

**Objective:** deliver dense, comprehensible setup without changing tenant or create-only resource contracts.

**Tasks**
- Migrate Organizer key gate, Events list/create and Event Detail resource sections incrementally; add current Event scope, task navigation and responsive record summaries.
- Pass Organizer credentials explicitly; validate through existing authorized requests and show rejected key state rather than accepting any non-empty key as authenticated.
- Reuse accessible staff/QR overlays, native forms and inline server errors. Keep create forms inline where operational density benefits.
- Correct staff-assignment copy: assignment is not a delivered invitation. Preserve raw Booth secret semantics and gate navigable standee treatment on the approved resolver decision.
- Keep unsupported edit/archive/delete actions absent. Separate resource tabs from navigation links; do not imply scheduled Sessions exist.

**Files:** `pages/OrganizerLayout.tsx`, `OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `api/client.ts`; proposed `layouts/WorkspaceLayout.tsx`, `features/organizer/*`, `features/booths/*`, native record/form UI.

**Dependencies:** phases 1–2 primitives; phase 0 tenant fixtures; optional independently released staff onboarding/Booth resolver APIs.

**Boundaries:** preserve all Organizer deep links and Event ownership 404. Do not infer authorization from frontend scope. No branding editor until persistence/upload contract ships; no invitation success copy absent working delivery/recovery.

**Risk / complexity:** medium–high because the current detail page concentrates many tasks. Gain: scope clarity and maintainable feature sections. Lower-cost alternative: accessible section navigation within the existing page before introducing route/tab restructuring; native rows instead of a table framework.

**Verification:** create Event/tier/Booth/point; invalid key; foreign Event 404; staff assignment for existing and absent Users with truthful outcomes; raw QR print/scanning contract; long names and mobile sheets; keyboard creation/return focus.

**Acceptance:** an Organizer can set up the existing resources without a hidden scope switch; restricted data never appears on denied requests; every action maps to a present endpoint; new staff are not falsely told they received access. Untouched Desk/Scanner behavior remains unchanged.

## Phase 5 — Exhibitor lead workspace

**Objective:** speed qualified lead work on existing Booth membership and duplicate-update semantics.

**Tasks**
- Migrate Booth shell, manual capture, filters, summary rows and qualification sheet; retain searchable contact fields permitted by the approved policy.
- Make manual input explicit, separate capture success from admission, retain notes/qualification drafts on recoverable failures and show duplicate-update truth.
- Check CSV HTTP response before downloading; respect available filters and give export errors inline. No error JSON delivered as a successful CSV.
- Use scoped JWT identity and clear denied/expired states, with real sign-in destination. Add no camera/HID marketing without the capability release.

**Files:** `pages/ExhibitorPortal.tsx`, `api/client.ts`; proposed `layouts/ExhibitorLayout.tsx`, `features/leads/*`, reusable filter/detail UI. Backend export changes belong in `backend/app/routes/leads.py` only when its current contract cannot support the agreed filters/policy.

**Dependencies:** attendee/staff login from phase 2, dialog/record patterns, phase 0 Booth competitor identities and disclosure decision.

**Boundaries:** preserve authorized Booth access and competitor 403, server lead deduplication and contact policy. No paid lead retrieval, fabricated scan device capability or generic table-grid project.

**Risk / complexity:** medium; wrong identity/export scope can expose competitors' contacts. Gain: fewer navigation steps and safer exports. Lower-cost alternative: native filtered list plus one qualification dialog; table library only with demonstrated selection/sort complexity.

**Verification:** assigned rep/competitor/expired JWT; duplicate capture, updates and notes; export success/failure/content scope; 360/390 summary and 768 detail; keyboard/screen reader/filter reset; disclosure policy enforced in API and CSV when applicable.

**Acceptance:** rep completes capture→qualification→export without losing draft or scope; competitor sees no records; duplicate capture does not multiply leads; failed export is not downloaded; capture method and disclosure messaging match reality.

## Phase 6 — Analytics and staff reporting

**Objective:** make current measures/filter/export truthful and accessible before operational view migration.

**Tasks**
- Migrate analytics into proven workspace; label Event/point/tier/time scope and 10-second refresh honestly.
- Distinguish zero, empty, failed and refreshing; keep prior data visibly stale during safe refresh, not a false zero. Cancel/ignore stale results and clean up polling.
- Use existing from/to API support for approved date filters; synchronize CSV with active filters. Show units/scales and an accessible tabular alternative to bars.
- Relabel current occupancy as cumulative admissions unless an independently approved entry/exit/model release supplies true occupancy. Keep capacity/time-window limitations visible where relevant.

**Files:** `pages/OrganizerAnalytics.tsx`, `api/client.ts`; proposed `features/analytics/*`, reusable filter/KPI/table UI; existing `backend/app/routes/analytics.py` for independently reviewed export/metric contract work if required.

**Dependencies:** phase 4 workspace and seeded nonzero analytics; understood backend count/time semantics; explicit timezone decision where current model is insufficient.

**Boundaries:** preserve polling/filter APIs and tenant isolation. No streaming, Redis, invented occupancy or empty decorative metrics. Chart dependency is optional and must earn its cost.

**Risk / complexity:** medium; a visually polished wrong measure is worse than a plain accurate table. Gain: operational decisions based on transparent data. Lower-cost alternative: current bar composition with readable labels/data table, no plotting package.

**Verification:** point/tier/from/to combinations and CSV parity; zero versus API failure; polling cleanup/race; foreign Event 404; keyboard filters, screen-reader values, long labels, 360 and 1440 layouts. Baseline screenshots use fixed fixtures/time, not volatile live totals.

**Acceptance:** every KPI has a defined measure/window; filtered CSV and view match; unavailable data is not rendered as zero; polling is not called streaming and cumulative admissions is not called active occupancy; data is available without interpreting color/bars.

## Phase 7 — Late operational presentation migration and final release gate

**Objective:** improve Desk/Scanner task interfaces using proven primitives without changing admission or durability underneath them.

**Tasks**
- Migrate Desk first: search/issuance split, fast keyboard path, scoped print stylesheet, minted pass/history dialogs and return focus. Preserve optional-email semantics while explaining unrecoverable accounts until claims/recovery is delivered.
- Migrate Gate Scanner view only: fixed readiness/input/result/queue zones; distinct local admission and pending/server sync truth; accessible mute/status/error/manual fallback. Preserve high-contrast outcome semantics independently of Event branding.
- Retain `scannerEngine.ts`, `scannerStorage.ts`, `audioFeedback.ts`, UUID generation/retry records and current adapters. Lifecycle fixes such as camera loop cancellation must be separate, behavior-tested changes, not incidental styling.
- Security/auth, per-result sync reconciliation and data minimization must have passed their independent gates before production operations release. A queue response body alone is not evidence each item matched the local decision.
- Complete cross-role/mobile/RTL/accessibility/print/visual regression review and remove migrated obsolete UI implementations; do not retain parallel component conventions.
- Evaluate PWA/native capability releases separately: service worker update/offline boot without queue loss; native durable store/camera/platform scaffold/hardware acceptance. Do not bundle them into the visual cutover or mark them complete from current IndexedDB/Dart prototypes.

**Files:** `pages/OrganizerDesk.tsx`, `GateScanner.tsx`; proposed `layouts/OperationsLayout.tsx`, `features/desk/*`, `features/scanner/*`, print styles and browser tests. Preserve existing `web/src/lib/*` scanner modules. Independent capability/security work may touch `backend/app/routes/checkin.py`, `web/src/api/schema.d.ts`, `mobile/lib/services/api_service.dart`, `policy_engine.dart`, `storage_service.dart`, `sync_service.dart`, `mobile/pubspec.yaml`, platform scaffolds, and proposed web manifest/service-worker files only under separately approved scope.

**Dependencies:** all relevant earlier primitives; phase 0 operational baseline/hardware; independently remediated production security/privacy gates; documented server-authoritative capacity and policy limitations. Do not wait until this phase to investigate these risks.

**Boundaries:** Scanner/Desk are operational modes, not dashboards. No lost queue, changed raw QR input or regenerated retry UUIDs. No claim of installability/offline shell/native parity absent capability acceptance. Preserve API callers together if scanner authorization is extended; never break the mobile adapter silently.

**Risk / complexity:** high despite a bounded visual scope: latency, focus loss, camera lifecycle, storage and retry failures can halt entry. Gain: clearer readiness/result/sync distinction and faster staff actions. Lower-cost alternative: keep the known Scanner view and add only status/accessibility fixes until hardware evidence permits layout migration; preserving an operational interface is better than a risky aesthetic cutover.

**Verification:** integrated repository checks; real camera and USB/Bluetooth HID, malformed QR, single-use duplicate/tier rejection; offline cold/reload behavior accurately scoped, queue persistence/network flaps/same-UUID retries, server-result reconciliation and sync failures; permission revocation/auth expiry; camera stop/unmount; Desk print/cancel/next-attendee focus and duplicate registration; mobile-width/sunlight-style contrast/audio mute/screen-reader summaries. Independently test PWA install/update/cold offline and native restart persistence/camera only if those capabilities are delivered.

**Acceptance:** staff can issue/search/print or scan without focus/navigation friction; high-contrast outcomes include reason/text/icon; queued never implies server-confirmed; retry preserves UUID and durable records; local capacity is not advertised as globally authoritative; protected production scanner endpoints and approved data retention are demonstrated, not only documented. No release passes based solely on screenshot similarity.

## Release sequencing and decision gates

1. **Keep operational security gates ahead of Scanner presentation.** Scoped endpoint authorization and manifest email minimization now exist. Close cross-scope scan-ID replay, finish device credential lifecycle, and resolve peer privacy, Ticket-cache ownership, offline capacity and per-record reconciliation before operational production approval; test isolation and retry behavior.
2. **Keep core visual releases independent.** Home → public reservation → Tickets/Network → Organizer setup → leads → reports → Desk → gate view. Each slice can ship or roll back its presentation deployment independently after checks; rollback must not discard durable scanner data or reintroduce a security hole.
3. **Separate unavailable capabilities.** Invite/recovery/desk claims, booth resolver, persisted branding, true occupancy, consent, PWA and native completion each need contract/owner/acceptance. Their absence means honest limited UI—not fake controls or a promise to repair later.
4. **Approve additions by leverage.** Query/form/table/chart/i18n packages are decisions, not prerequisites. Add only when real complexity exceeds native/feature-local solutions; measure bundle/load and maintenance consequences before lazy loading or dependency proliferation.
5. **Final handoff includes evidence.** Store reviewed viewport/state diffs, test results, API contract decisions, outstanding release blockers and a route-by-route acceptance matrix. Phase 0’s populated baseline, exact check results, limitations and issue gates are in `PHASE-0-VALIDATION.md`; later phases must add their own fresh evidence.
