# Phase 0 — UX/UI Master Plan Validation

**Status:** Phase 0 completed. No production page, backend business logic, security contract, QR payload, Admission Policy, or offline synchronization behavior was changed. The only repository changes in this phase are this report and current-evidence addenda to the current UI audit, page blueprints, master plan, frontend architecture, and roadmap.

## Executive decision

**CONDITIONAL GO** for Phase 1 design-system groundwork and a deliberately isolated `/` public-landing vertical slice, after product approval of the recommended visual direction and initial brand/type choices. The slice can be built without touching authentication, API contracts, registration, ticket caching, Scanner behavior, or admission rules.

**NO-GO** for a broad rollout to attendee or operational screens, and for claiming Scanner readiness, until the relevant privacy, cross-scope replay, credential rollout, scan reconciliation, and offline-capacity gates in [the issue register](#prioritized-implementation-issues-and-release-gates) are closed and independently verified. This is not a test-suite failure: the unified test/build/analyzer pipeline passed. It is a product and operational safety gate.

The plan’s core design recommendation remains sound: a refined, minimal public/attendee language, event-specific art direction within a common event-page foundation, and more information-efficient workspace/operations layouts. That coherence must come from shared foundations, not forcing every role into one dashboard shell.

## Scope, evidence labels, and limits

This validation reviewed all nine requested design documents (`01`–`08` and `MASTER-PLAN.md`), current source and API contracts, project specifications, glossary, architecture decisions, current issue workflow, and the frontend-relevant Flutter code. The nine-document set has been reconciled against the current checkout; explicit corrections and source-of-truth rules are recorded below. Existing competitor research in `02-COMPETITOR-RESEARCH.md` and its evidence is retained as the visual research record; Phase 0 did not repeat competitor browsing.

Evidence labels used here:

- **CODE / CONTRACT:** confirmed in the checked-out source, API schema, current endpoint response, or project specification.
- **RENDERED:** observed in the current browser app using the synthetic Phase 0 seed and the stated viewport.
- **REPRODUCED:** a specific API/UI/security/offline scenario was executed and its actual response/state observed.
- **DOCUMENT:** stated in a spec/ADR or the existing design package; not necessarily implemented.
- **NOT TESTED:** unavailable hardware, unsupported viewport/state, real-user observation, or other evidence limitation.
- **DECISION:** recommendation to approve before the corresponding implementation stage; not a claim about existing behavior.

All test identities and Event data were synthetic. Ticket QR content and identity text were blurred in the Ticket screenshots. No live attendee data, credentials, scanner tokens, or QR secrets are included here.

## Repository and design-document consistency

### Current React and API reality

`web/src/main.tsx` declares exactly eleven routes and eagerly imports their page modules. The route-to-component mapping is:

| Route | Current React component |
|---|---|
| `/` | `Home` |
| `/e/:slug` | `PublicEvent` |
| `/e/:slug/booths/:boothId` | `PublicBooth` |
| `/my-tickets` | `MyTickets` |
| `/my-network` | `MyNetwork` |
| `/scan/:pointId` | `GateScanner` |
| `/booth/:boothId` | `ExhibitorPortal` |
| `/organizer` | `OrganizerLayout` + `OrganizerEvents` |
| `/organizer/events/:eventId` | `OrganizerEventDetail` within `OrganizerLayout` |
| `/organizer/events/:eventId/desk` | `OrganizerDesk` within `OrganizerLayout` |
| `/organizer/events/:eventId/analytics` | `OrganizerAnalytics` within `OrganizerLayout` |

The frontend is React 19, TypeScript, Vite, React Router, Tailwind CSS 4, `openapi-fetch`, and local page/component modules under `web/src/`. It has no existing shared design-token layer, feature-query/data framework, component library, or established i18n implementation. `web/src/api/client.ts` owns the API client and currently falls back to the Organizer key in `sessionStorage` before an Attendee token in `localStorage` when callers do not pass an explicit token. Treat this as a migration concern: do not redesign auth or change API semantics inside the visual slice. `web/src/api/schema.d.ts` is behind the backend Scanner-device API: it omits the device identity in the token response and the device-list/revoke routes. Reconcile generated types before implementing those controls.

The current `web/index.html` does not link a web manifest, `web/public/` has no manifest or service worker, and no service-worker registration or CacheStorage use was found. Scanner data can be persisted in IndexedDB while the already-loaded app is running offline; that does not amount to installability or an offline cold start. The Flutter directory has Dart source/tests but not a production-ready native scanning product: the point-selection screen does not attach credentials to its `ApiService`; storage is in-memory; no runnable native camera/ML Kit/SQLite integration was verified. These are capability and product-claim gaps, not reasons to alter UI styling.

### Review of the nine planning documents

| Document | Phase 0 consistency result |
|---|---|
| `01-CURRENT-UI-AUDIT.md` | Its old environment-blocked and unauthenticated-manifest text is a historical source snapshot. It now has a current-evidence addendum and corrected verification/screenshot section. Use the Phase 0 table and issue register rather than the older rendered-state claims. |
| `02-COMPETITOR-RESEARCH.md` | Use as the external reference record, not evidence about this codebase. Phase 0 made no new competitor claims. Preserve the distinction between public product material and access-controlled product UI. |
| `03-DESIGN-SYNTHESIS.md` | Its synthesis is compatible with current routes when read as a design proposal. Keep current capability gaps and implementation contracts from this validation separate from competitor-inspired proposals. |
| `04-DESIGN-DIRECTIONS.md` | Direction A remains the recommended primary direction, refined by role-specific density and event branding. Phase 0 validates the architecture, not a final approved palette, font, or brand identity. |
| `05-DESIGN-SYSTEM.md` | Tokens/components are proposals, not existing infrastructure. CSS variables integrated with Tailwind 4 remain the lowest-risk path; no wholesale UI-library migration is justified. Initial language remains English; RTL/Persian is readiness work, not an automatic language conversion. |
| `06-PAGE-BLUEPRINTS.md` | The eleven-route scope matches `main.tsx`. Treat each blueprint as an intended future state, not proof of a flow or capability. This report supersedes any older statements about scanner endpoint authorization, populated-state evidence, PWA readiness, or native Flutter behavior. |
| `07-FRONTEND-ARCHITECTURE.md` | A current-source addendum corrects the scanner-auth/schema state. Keep role-specific layouts and explicit credential ownership; a shell is never an authorization boundary. |
| `08-IMPLEMENTATION-ROADMAP.md` | A current Phase 0 addendum records the completed environment, issue gates, and refreshed route evidence. Do not repeat its older unavailable-backend or unauthenticated-scanner assumptions. |
| `MASTER-PLAN.md` | A current Phase 0 status and decision addendum supersedes the old baseline for test, Scanner-auth, and runtime claims. It remains the authoritative design direction; this document is authoritative for Phase 0 readiness and gates. |

Two domain/contract discrepancies need to remain explicit rather than being papered over with new UI: `GLOSSARY.md` describes a `Connection` as mutual, whereas current creation behavior is one-way; and peer email disclosure in `SPEC_V2.md`/ADR 0011 is consent-dependent, while current peer responses and vCards include email without such a stored consent setting. Resolve semantics with the product owner before exposing or changing these contracts. Neither difference justifies fabricating a consent toggle or silently changing connection semantics in a visual task.

## Reproducible local environment and verification

### Environment restored

- PostgreSQL 16 was started with `docker compose up -d --wait postgres`; container health reported **healthy** on host port `5433`.
- The application database was migrated with `cd backend && uv run alembic upgrade head`, through revision `0008` (Scanner device support).
- A local nonproduction Event and synthetic Organizer, ticket tier, Check-In Points, Booth, Attendees/Tickets, Booth staff, Lead, Connection, Bookmark, Scanner device, and Check-In were created through the application/API. No production database or real identity was used.
- The test fixture uses a separate `congress_test` database and recreates that test database; it did not replace the synthetic `congress` development database.
- API and Vite were run locally for route inspection. Do not copy local secrets or bearer values from an interactive shell into reports or screenshots.

### Repeatable setup recipe

From the repository root in PowerShell, the known setup is:

```powershell
docker compose up -d --wait postgres
Push-Location backend
uv run alembic upgrade head
$env:CONGRESS_PLATFORM_ADMIN_TOKEN = '<local-only value>'
$env:CONGRESS_JWT_SECRET = '<long random local-only value>'
uv run uvicorn app.main:create_app_from_env --factory --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
Push-Location web
npm run dev -- --host 0.0.0.0
```

Run the unified required pipeline from the repository root with:

```powershell
scripts\check.bat
```

The synthetic route seed was created through API calls during Phase 0; **there is not yet a committed one-command route-seed fixture**. The existence of a healthy database and passing test suite makes the environment reproducible, but exact populated screenshot data still needs a stable nonproduction seed fixture before this can become a repeatable visual-regression job. Keep any such fixture isolated from real tenants and use unique Event slugs in multi-event tests.

### Actual unified check result

`cmd.exe /c "scripts\check.bat"` completed successfully after PostgreSQL startup and migrations:

- Backend mypy: **39 source files passed**.
- Backend pytest: **88 passed**.
- Web Node tests: **5 passed**.
- Web TypeScript check: **passed**.
- Vite production build: **passed** (420.88 kB bundle; 117.91 kB gzipped JavaScript, as reported by the build).
- Dart tests: **8 passed**.
- `dart analyze`: **no issues**.
- Unified result: **`[SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS`**.

This says the current suite/build/type/analyzer checks pass; it does not certify user journeys, physical scanning hardware, accessibility conformance, data privacy, offline truthfulness, or production security. Browser behavior and contract probes below are separate evidence.

## Rendered baseline — all eleven routes

Every route was opened with seeded synthetic data at **1440×960** and **390×844 CSS pixels**. The screenshot links below are saved repository artifacts under `docs/design/phase0-evidence/`. The initial route screenshots have no horizontal page overflow at either measured width. The special Scanner state with two pending offline scans does overflow at mobile width. Route captures establish a visual baseline, not complete interaction or accessibility verification.

| Route | Populated baseline and visible finding | Desktop capture | Mobile capture |
|---|---|---|---|
| `/` | Current platform home is sparse and has a single prominent Organizer entry; large vertical whitespace gives the product little public platform/product explanation. | [1440](phase0-evidence/platform-1440.png) | [390](phase0-evidence/platform-390.png) |
| `/e/:slug` | Public Event details and free-registration entry are clear, but the mobile composition is one long column; event identity and conversion hierarchy are the main redesign opportunity. | [1440](phase0-evidence/event-1440.png) | [390](phase0-evidence/event-390.png) |
| `/e/:slug/booths/:boothId` | A public Booth profile is reachable by its UUID route. Do not confuse this with the printed Entity QR, which currently contains a secret-form value that this route cannot resolve. | [1440](phase0-evidence/public-booth-1440.png) | [390](phase0-evidence/public-booth-390.png) |
| `/my-tickets` | Ticket/pass and QR have strong visibility and the saved Booth feature is present. QR screenshot content was blurred. Cached pass access without a current token is a privacy issue, not a visual success criterion. | [1440](phase0-evidence/tickets-1440.png) | [390](phase0-evidence/tickets-390.png) |
| `/my-network` | Populated contact/connection cards show names and email plus notes/vCard affordances. There is no underlying peer email-consent state, so the visible email cannot be treated as a privacy-approved presentation. | [1440](phase0-evidence/network-1440.png) | [390](phase0-evidence/network-390.png) |
| `/scan/:pointId` | Scanner has a focused operational layout and offline/queue states. The ordinary initial viewport fits, but queued controls/status overflow at 390px; this state also misrepresents local admission when server rules reject a scan. | [1440](phase0-evidence/scanner-1440.png) | [390](phase0-evidence/scanner-390.png) |
| `/booth/:boothId` | Exhibitor view is a dense, dark workspace with lead capture/qualification and export features. It remained within the tested width; future work should preserve fast qualification without adding generic dashboard chrome. | [1440](phase0-evidence/exhibitor-1440.png) | [390](phase0-evidence/exhibitor-390.png) |
| `/organizer` | Organizer API-key entry and Event list are visible; the route uses its own workspace gate rather than a public landing pattern. | [1440](phase0-evidence/organizer-1440.png) | [390](phase0-evidence/organizer-390.png) |
| `/organizer/events/:id` | Event configuration exposes ticket tiers, Check-In Points/policies, Booths and Entity QR in a long, form-heavy page. Setup hierarchy, progressive disclosure and action feedback warrant redesign. | [1440](phase0-evidence/event-setup-1440.png) | [390](phase0-evidence/event-setup-390.png) |
| `/organizer/events/:id/desk` | Front-desk search and walk-in registration are visible; this is an operational station, not an attendee dashboard. The screen baseline does not validate peak-load throughput or recovery. | [1440](phase0-evidence/desk-1440.png) | [390](phase0-evidence/desk-390.png) |
| `/organizer/events/:id/analytics` | KPI summaries and charts render with data. Preserve meaningful scale/labels and responsive reading order rather than enlarging cards or adding decorative graphs. | [1440](phase0-evidence/analytics-1440.png) | [390](phase0-evidence/analytics-390.png) |

The extra [queued/offline Scanner capture at 390px](phase0-evidence/scanner-offline-390.png) records `scrollWidth = 507px` for a 390px viewport with two pending entries. The status and controls become horizontally displaced. This is a reproducible responsive defect, filed as #23.

**Not tested:** 360px, 768px, 1024px, kiosk/print dimensions, actual device pixel density, camera permission, hardware BarcodeDetector behavior, physical USB HID scanner, screen-reader tree, keyboard-only assistive-technology review, or a native Flutter app. We did not claim WCAG conformance from screenshots. Some dialogs, forms, loading/empty/error outcomes, and route journeys were not individually exercised at every viewport. Use Phase 1 acceptance tests to close these measurement gaps.

## Reproduced contract, security, privacy, and capability findings

### Scanner authorization: implemented boundary, incomplete clients, one cross-scope defect

**Reproduced:** the current check-in manifest/batch routes require a point-scoped Scanner JWT or the owning Organizer API key. A request without credentials returned **401**; an Attendee JWT returned **403**; a valid point-scoped token returned **200**; after revoking its device, the same token returned **401**. The current manifest includes attendee name, tier and QR secret, but does **not** include attendee email. This corrects the old audit/master claim that the manifest/batch endpoints were unauthenticated and returned email. Do not remove this authorization or email-minimization behavior.

**Reproduced P1 security defect:** `backend/app/routes/checkin.py:410–438` performs the idempotency lookup by `scan_id` globally before validating the requesting Check-In Point/Event scope. A valid scan under one Organizer was replayed using another Organizer’s valid point token and the same client scan ID; the second tenant received HTTP 200 and the original Check-In result, attendee name, and raw QR secret. This is a cross-scope disclosure and idempotency isolation failure. Track/fix independently in [#20](https://github.com/msadrak/congress-platform/issues/20); it is a Scanner release gate. Preserve same-point retry-safe UUID idempotency while scoping the lookup.

**Client rollout gap:** the organizer interface has no Scanner device-token issue/list/revoke workflow. Flutter point selection constructs `ApiService` without passing the token, despite the backend’s new auth requirement. The web generated schema does not yet represent the device identity/list/revoke API. The API authorization is real, but the clients cannot complete credential enrollment/revocation as an integrated supported journey. Track in [#18](https://github.com/msadrak/congress-platform/issues/18). No unauthorized endpoint behavior should be disguised as a new scanner UI.

### Offline scanning, capacity, and server-result reconciliation

**Reproduced:** with a local `CAPACITY_CAPPED` admission policy set to one remaining admission and two valid tickets, two offline HID-simulated input events both rendered as **ADMITTED** locally and entered the pending queue. Upon reconnection, the server accepted one and rejected one, but the client displayed both as admitted and cleared the queue after receiving a nonempty response. `GateScanner.tsx:170–205` treats any nonempty result as success for every queued item rather than mapping per-scan server outcomes; `GateScanner.tsx:215–244` does not provide the live admitted count to the local engine; `scannerEngine.ts:74–90` defaults a missing count to zero.

This is not just a responsive design concern. Make the local/server authority and CAPACITY_CAPPED policy truth explicit, preserve each result, and never present a server-rejected scan as a confirmed admission. Track separate issues: [#15](https://github.com/msadrak/congress-platform/issues/15) defines truthful offline capacity behavior; [#17](https://github.com/msadrak/congress-platform/issues/17) requires per-record result reconciliation. Do not change admission or sync semantics as part of a visual refactor.

### Attendee cache ownership and peer contact privacy

**Reproduced Ticket privacy gap:** `MyTickets.tsx:40–75, 93–113, 214–263` persists ticket identity data, including email/name and the reusable `qr_secret`, in browser `localStorage`. In the seeded test, after clearing the attendee token and reloading `/my-tickets`, the prior cached ticket and its SVG QR still rendered. This is useful offline behavior but is not owner-scoped on shared/account-switched devices. Define retention, lock/clear, ownership transition and privacy copy before changing or claiming it is secure. Issue [#16](https://github.com/msadrak/congress-platform/issues/16).

**Reproduced peer disclosure gap:** current `network.py` response and vCard code always returns the peer’s email; the live `MyNetwork` response and exported vCard contained it. There is no persisted peer contact-sharing preference. `SPEC_V2.md`/ADR 0011 describes opt-in disclosure, so an interface-only privacy toggle would make a promise the backend cannot honor. Resolve contract, data model and export behavior together; issue [#19](https://github.com/msadrak/congress-platform/issues/19).

**Do not conflate** this with intentional Booth lead contact behavior: ADR 0011 distinguishes exhibitor lead access from peer-to-peer Connections and tenant/Booth isolation. Existing export and authorization contracts must be retained unless a separate issue approves a change.

### Entity QR navigation and account access

**Reproduced Booth QR navigation gap:** the Organizer Event page prints the Booth’s secret-form Entity QR, while the current public profile endpoint expects a Booth UUID at `/api/public/events/{slug}/booths/{booth_id}`. Resolving the printed secret-form identifier against the endpoint returned **422**. The public profile route works when given a UUID; the printed QR does not currently provide an end-to-end route to it. Track resolver/route behavior in [#21](https://github.com/msadrak/congress-platform/issues/21). Do not alter Entity QR payloads in the design pass.

**Source-confirmed account-access gap:** creating Booth staff and Desk Attendees can create user accounts with generated passwords that are not revealed or delivered; there is no supported account recovery/claim/invitation flow. This makes a visual login link inadequate. Track recoverable onboarding as [#24](https://github.com/msadrak/congress-platform/issues/24); separately obtain product approval for identity provisioning and recovery requirements.

### PWA and Flutter capability statements

**Source-inspected:** the Browser app has no service-worker registration, manifest link, or installable offline shell. Previously loaded Scanner operation can use local IndexedDB data, which is distinct from a cold-start offline PWA. Issue [#25](https://github.com/msadrak/congress-platform/issues/25) makes the product claim/capability decision explicit.

**Source-inspected:** current Flutter code is a prototype, not a verifiable native scanner: no working camera source, persistent SQLite store, production Flutter platform scaffolding/dependency set, or end-to-end staff credential integration was verified. Existing Dart tests and analysis pass, but they do not prove native scanning. Issue [#22](https://github.com/msadrak/congress-platform/issues/22) is separate from the browser PWA decision. No native target was visually inspected in Phase 0.

## Prioritized implementation issues and release gates

All eleven issues were filed separately through `gh`; titles and live URLs below were confirmed in the open issue list. Priorities/classes are proposed triage, not proof that an issue has been accepted or fixed; see each live issue for its current labels and state.

| Priority / class | Issue | Reproduced condition / why it is separate |
|---|---|---|
| **P1 — security, Scanner release gate** | [#20 — Scope idempotent scan replay to its Check-In Point and Event](https://github.com/msadrak/congress-platform/issues/20) | Cross-tenant valid-token replay of a known scan ID returned another tenant’s Check-In result and QR secret. Preserve scoped, retry-safe idempotency. |
| **P1 — privacy, attendee release gate** | [#19 — Enforce peer contact-sharing consent in Connections and vCards](https://github.com/msadrak/congress-platform/issues/19) | Peer email is always exposed in connection response/export while the spec describes opt-in; consent state is absent. |
| **P1 — privacy, shared-device gate** | [#16 — Define owner-scoped offline Ticket cache access and retention](https://github.com/msadrak/congress-platform/issues/16) | Ticket identity and reusable QR secret survive token removal in localStorage and remain renderable. |
| **P1 — Scanner auth and support gate** | [#18 — Integrate scoped Scanner-device credentials in web and Flutter clients](https://github.com/msadrak/congress-platform/issues/18) | Server auth exists; current device-token lifecycle is not wired into browser/Flutter clients and UI/schema. |
| **P1 — operations** | [#17 — Reconcile every queued scan against its server result](https://github.com/msadrak/congress-platform/issues/17) | A mixed server batch response is not mapped per pending scan; a rejected scan continues to display as admitted. |
| **P1 — operations** | [#15 — Define truthful offline behavior for CAPACITY_CAPPED admission](https://github.com/msadrak/congress-platform/issues/15) | Offline local status admitted two scans over cap; server later rejected one. Product must define what can truthfully be promised offline. |
| **P1 — responsive/accessibility** | [#23 — Keep scanner status and controls within 390px when scans are queued](https://github.com/msadrak/congress-platform/issues/23) | Queued Scanner state measures 507px scroll width at 390px; key operational controls move offscreen. |
| **P1 — native capability** | [#22 — Deliver a runnable authenticated Flutter scanner, not only the Dart prototype](https://github.com/msadrak/congress-platform/issues/22) | Current source lacks a verified runnable native camera/persistent offline/authenticated scanner; do not represent a prototype as production capability. |
| **P2 — QR navigation** | [#21 — Make printed Booth Entity QR open the public Booth profile](https://github.com/msadrak/congress-platform/issues/21) | Printed secret-form Booth QR lookup returns 422 while public route requires UUID. |
| **P2 — account access** | [#24 — Provide recoverable onboarding for new Booth staff and Desk Attendees](https://github.com/msadrak/congress-platform/issues/24) | Password is generated but not disclosed/delivered, and no recovery/claim flow exists. |
| **P2 — PWA capability** | [#25 — Add an installable scanner shell with a verified offline cold start](https://github.com/msadrak/congress-platform/issues/25) | No manifest/service worker/offline shell; current loaded-page IndexedDB functionality is not cold-start support. |

**Release gates before operational Scanner release:** close #20; agree and pass #15/#17 behavior with policy-specific tests; integrate/revoke credentials through #18; resolve whether #16’s offline credential cache is supported and with what ownership/retention; validate responsive issue #23 at 360/390/768 and actual kiosk; make product scope explicit for #22 versus #25. A UI redesign cannot substitute for any of these.

**Release gate before promoting attendee networking as privacy-safe:** close #19 against a documented data/export consent contract; define the `Connection` mutuality discrepancy in `GLOSSARY.md` before making the interface imply mutual confirmation.

The separate P2 issues (#21/#24/#25) are not cosmetic. Their priority reflects capability/account-access work and does not authorize adding features implicitly to this design phase.

## Design direction and architecture validated for planning

### Visual recommendation

Proceed with **Direction A: Refined Minimal SaaS**, combined with the deliberate role variations specified in the design package:

- Public platform page: clear product explanation, editorial restraint, an intentional identity, and visible conversion path. Avoid a generic template hero and excess whitespace without product value.
- Event page: a reusable, accessible event layout with bounded, event-owned branding; it should not create a separate bespoke codebase per Event.
- Attendee: approachable, compact, mobile-first personal tasks (Ticket/QR, saved Booths, Connections); no organizer-style sidebar or privacy promises unsupported by the contract.
- Organizer/Exhibitor: shared SaaS foundations with role-specific navigation and calibrated table/form density. Do not clone an enterprise competitor’s full module hierarchy.
- Front Desk/Scanner: task-focused operations layouts with explicit system state and large controls, not conventional dashboard templates. Scanner result meaning remains subject to #15/#17.

This is a synthesis, not a direct copy of any competitor. Direction B’s conference editorial identity is best scoped to Event-level branding; Direction C’s precision/information density is best scoped to operational/admin tools. No option justifies making every route look or behave the same.

### Foundations and component boundaries

Confirm the proposed low-risk architecture for Phase 1:

1. Add semantic design tokens as CSS custom properties in the existing stylesheet strategy and expose them through Tailwind 4 theme integration. Start with semantic text/background/surface/border/action/status/focus tokens, spacing, type, radius, and layout constraints. The current UI has no token contract, so first deliver a small, named token set with contrast values rather than decorating the whole product with many arbitrary values.
2. Retain React 19, Vite, React Router, the typed API client and current routing. Establish a lightweight `PublicLayout` and only the real shared primitives needed by the first slice. Do not adopt a full component framework without a concrete accessible behavior it supplies that the current project lacks.
3. Keep role shells distinct: public platform, public Event, attendee, Organizer, Exhibitor, operations. Share primitives and tokens; do not share page-level layout when tasks, trust boundaries, and density differ.
4. Defer an Event theme API/schema change. Current Event data does not persist the cover/logo/accent/timezone set proposed by the blueprint. First establish a default Event presentation that works with available fields. Approve any theming fields and safe accent constraints separately before using user-supplied arbitrary CSS.
5. English remains the current presentation language. Prepare logical CSS properties, explicit `lang`/`dir`, `bdi` for mixed-script identity/content, locale-aware number/date formatting, and direction-aware icons. Persian font licensing/asset choice, Persian digits, Jalali calendar behavior, default locale and language switch UX require approval. Do not globally flip or translate the application without a complete localized content and QA plan.
6. Keep a light default theme. Use an intentionally high-contrast Scanner state palette and opaque high-contrast Ticket QR presentation; do not add a global dark-mode control without a user need and contrast validation.
7. Use keyboard-operable focus indicators, visible focus, reduced-motion support, semantic labels, error association, focus return/trapping for dialogs, and WCAG 2.2 AA as the target. Phase 0 did not certify the current site against that target.

### Do not mix capability and visual scope

The following are explicit non-goals for Phase 1 and must not be slipped into a styling change: changing endpoint authorization, ticket QR payload or cache semantics; modifying Admission Policies or capacity authority; changing offline queue/idempotency; adding peer-consent behavior; inventing Booth QR resolution; adding a service worker or native camera; adding account recovery; payments, CME, AI matchmaking or other absent features.

## Product decisions requiring approval

The recommendation is confident, but the following decisions need a named product owner before the corresponding implementation phase. They are not open invitations to implement a placeholder control:

1. **Identity/visual approval:** approve Direction A as the platform baseline, the core brand accent and neutral palette, and a licensed Latin typeface. Approve a Persian font as a separately verified asset, not a remote dependency by assumption.
2. **Localization:** choose launch language order, Persian vs Latin digit rules, calendar system, date/time representation, and Event timezone authoring/display responsibilities. Until then, English/locale-neutral components and RTL readiness only.
3. **Event theme scope:** decide whether Event owners may set logo, cover and constrained accent/theme options, and whether this needs a backend/API field. No free-form theme editor is implied.
4. **Peer visibility and connection semantics:** approve consent scope and revocation/export behavior for email/phone; resolve whether a `Connection` is mutual or directional in product vocabulary and API semantics.
5. **Offline Ticket access:** define account switching, shared-device retention/clear, lost-device and offline-display expectations before changing local caching.
6. **Offline admission:** define the supported offline promise for `CAPACITY_CAPPED` policies and the wording/state distinction between a local provisional result and a server-confirmed admission.
7. **Scanner credential operations:** decide who provisions/revokes a device, which Operator roles may do so, and how the web scanner and Flutter client authenticate. Existing endpoint auth must remain enforced.
8. **Mobile product scope:** decide if the target is browser PWA, a supported native Flutter Scanner, or both, with explicit platform/hardware commitments. They are separate technical deliverables.
9. **Account onboarding:** approve identity recovery/claim/invitation policy for attendee and booth staff before placing universal login/recovery affordances.

## Proposed first UI implementation slice

**Build one representative vertical slice: the platform public home route `/` plus its minimal public shell and token foundation.** The slice should include the actual page-level hierarchy, header/navigation behavior, one primary CTA with a real destination, a meaningful platform/product explanation, footer or equivalent navigation, and responsive/focus states. It should not include mock API data or nonfunctional controls.

Why this first:

- `Home` is a real route with no dependence on attendee credentials, Organizer API keys, ticket/QR state, data privacy, or admission logic.
- It validates typography, brand color, spacing, `PublicLayout`, button/link primitives, responsive behavior, keyboard access and CSS-token/Tailwind integration in a low-risk real route.
- The current home is unusually sparse and provides only an Organizer entry, so it offers a clear baseline and user-facing improvement without destabilizing the operational core.
- It does **not** validate registration forms, Event theming, complex tables, scanner behavior or role auth; those remain for their own later slices.

Likely scope: `web/src/pages/Home.tsx`, `web/src/index.css`, `web/src/main.tsx` only if a shell wrapper is needed, plus a narrowly scoped new public-layout/primitive module. Confirm exact folder names against current conventions at implementation start. No backend/API/schema/mobile change; no global shell rewrite; no ticket/Scanner/exhibitor/Organizer route edits.

## Phase 1 acceptance criteria

Phase 1 is the foundation plus the `/` slice only. It is accepted when all are true:

1. **Token contract:** documented semantic CSS tokens exist for the actual colors and spacing used in the slice, with explicit text/background/action/status/focus roles; the slice consumes tokens rather than duplicating literals. Tailwind 4 remains integrated; no broad dependency replacement.
2. **Responsive:** route is captured at 360, 390, 768, 1024, and 1440 CSS pixels; no horizontal page overflow; content order, navigation, CTA and footer remain intentional at every width. Mobile is not just the entire desktop content stacked indiscriminately.
3. **Keyboard/accessibility:** all actions are semantic links/buttons, keyboard reachable in logical order, visible focus, sufficient focus contrast, an effective skip-to-main path if navigation repeats, heading landmarks are coherent, contrast is measured against WCAG 2.2 AA targets, and zoom/reflow does not hide the primary action.
4. **Motion/state:** reduced-motion preference is honored; hover is not the only feedback; link destinations and navigation states are truthful. No decorative control, placeholder CTA, fake data, or misleading product promise.
5. **Localization foundation:** avoid left/right-only layout assumptions in the new shell where practical; document tested English direction and identify a follow-up RTL/`bdi` check. No claim of Persian/Jalali localization until it is actually implemented and tested.
6. **Scope safety:** no API or backend changes; no auth/API client changes; no updates to QR payload, admission, cache, idempotency, PWA, or sync behavior; all other ten routes remain behaviorally unchanged.
7. **Verification:** web tests, typecheck and production build pass; the route is browser-smoke-tested with fresh screenshots at the five widths; keyboard and reduced-motion checks are recorded. Run `scripts\check.bat` for the completed full-stack phase as required by repository policy.
8. **Review artifacts:** before/after images and any deviations from the approved system are captured; no unapproved external font/script request or new runtime dependency is introduced.

## Phase 0 conclusion

The design plan is implementation-ready for a bounded Phase 1 slice, not for a simultaneous redesign of all screens. Current code supports the planned progressive approach, and the actual route evidence identifies both a low-risk first slice and separate operational/privacy defects. The unified check pipeline passes; the major blocker is release safety for affected contracts, not compilation.

### Go / No-Go

- **GO, conditional:** approve Direction A and the initial identity/type decisions, then implement only the token/public-shell foundation and `/` slice against the acceptance criteria above.
- **NO-GO:** do not begin styling Scanner as if its behavior were safe; do not release broad Scanner/attendee privacy UI changes while #20, #15/#17, #18, #16, and #19 remain unresolved; do not describe the browser as an installable offline Scanner or the Dart prototype as a production native Scanner until #25/#22 scope and acceptance are satisfied.
- **Keep visual and contract work separate:** issue fixes must carry their own behavior-level acceptance tests and review. Phase 0 made no product/backend contract change.

**Implementation order:** first approve the visual and localization boundaries; then implement CSS tokens + the minimal public shell + `/` and validate it at the stated widths. Next, proceed to public Event/registration, then attendee Ticket/network screens only after the consent/cache gates, then Organizer and Exhibitor workspaces, and finally desk/Scanner/PWA/native operational work behind its security, authorization, capacity, and reconciliation gates.