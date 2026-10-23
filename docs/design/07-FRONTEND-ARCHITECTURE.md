# 07 — Frontend architecture

Status: proposed architecture, not an implemented refactor. Research date: 2026-10-10. Read with [04 — Direction](04-DESIGN-DIRECTIONS.md), [05 — Design system](05-DESIGN-SYSTEM.md), [06 — Page blueprints](06-PAGE-BLUEPRINTS.md), and [08 — Roadmap](08-IMPLEMENTATION-ROADMAP.md).

## Phase 0 validation addendum

The populated route baseline, successful full-stack verification, and live contract checks are recorded in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md); `phase0-evidence/` holds the screenshots. This addendum supersedes later shell-only/unpopulated rendering and unavailable-backend claims. Current Scanner authorization and manifest email minimization are implemented; cross-scope replay, client token integration, local cache policy, peer consent, and offline result/capacity semantics remain separate gates. Generated web OpenAPI types lag the scanner-device response and device routes. Hardware, native camera, assistive technology and WCAG conformance were not verified.

## 1. Evidence and scope

The initial source-only audit had route shells but no seeded backend; that limitation is superseded by [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md). Phase 0 rendered all 11 routes with synthetic populated data at 1440/390 CSS pixels and ran the full unified checks. Those captures do not establish physical-camera/HID operation, native Flutter, assistive-technology behavior, or WCAG conformance.

Direction A means one refined minimal product grammar, optional editorial Event composition, dense staff workspaces, and dedicated operations. Do not replace React, Vite, React Router, the typed client, or working scanning modules. Adopt shared UI a vertical slice at a time; retain page filenames and routes while extracting behavior only where reuse or testability actually improves.

## 2. Actual files versus proposed ownership

| Current, observed file/module | Current responsibility | Proposed change (not present today) |
|---|---|---|
| `web/src/main.tsx` | Eager imports and BrowserRouter for 11 routes | Keep route URLs; compose role layouts, route-level error/loading handling, and measured lazy loading later |
| `web/src/pages/OrganizerLayout.tsx` | API-key entry, sessionStorage, navigation, Outlet key context | Retain as Organizer entry; extract workspace chrome without changing credential semantics implicitly |
| `web/src/pages/Home.tsx` | Generic platform introduction | Public layout and truthful route discovery; not an Event directory |
| `PublicEvent.tsx`, `PublicBooth.tsx` in `web/src/pages/` | Public fetch, reservation/auth overlay, bookmark/profile | Event layout; scoped brand presentation; preserve current public/JWT endpoint use |
| `MyTickets.tsx`, `MyNetwork.tsx` | Page-local attendee auth/data/cache, passes, bookmarks, connections | Attendee layout and feature-local pass/network compositions; security-approved cache/sign-out behavior is separate work |
| `OrganizerEvents.tsx`, `OrganizerEventDetail.tsx`, `OrganizerAnalytics.tsx` | List/create, resource setup, polling/reporting | Workspace layout and focused feature sections, preserving create-only capabilities |
| `OrganizerDesk.tsx`, `GateScanner.tsx` | Fast issuance/search and gate scanning | Operations layout with no dashboard rail during active tasks; migrate these views late |
| `ExhibitorPortal.tsx` | Booth authorization gate, manual lead capture, filtering, qualification, CSV | Booth-scoped staff layout; native record views and accessible qualification sheet |
| `web/src/api/client.ts`, `schema.d.ts` | openapi-fetch transport, generated DTOs, credential fallback | Preserve typed transport; explicit role credential selection at migrated call sites; regenerate schema only from a changed backend contract |
| `web/src/lib/scannerEngine.ts`, `scannerStorage.ts`, `audioFeedback.ts` | Local policy, IndexedDB durability, audio | Preserve implementations and public interfaces during presentation migration |
| `web/src/index.css` | Tailwind import and 16px input safeguard | Add semantic token layer and bounded base styles; keep iOS input protection |
| `web/tests/scannerEngine.test.ts` | Node test runner policy checks | Retain; add integration/browser/accessibility layers deliberately, not by pretending they exist |
| `web/public/favicon.svg` | Only current public asset | Approved static brand/font assets later; no existing Event media library |

All names below are **proposed new files/directories**, not claims of existing exports:

```text
web/src/
  layouts/
    PublicLayout.tsx       EventLayout.tsx        AttendeeLayout.tsx
    WorkspaceLayout.tsx    ExhibitorLayout.tsx    OperationsLayout.tsx
  components/ui/
    Button.tsx            FormField.tsx          Dialog.tsx
    StatusBadge.tsx        AsyncState.tsx         PageHeader.tsx
  features/
    auth/                 tickets/               network/
    events/               booths/                leads/
    organizer/            analytics/             desk/       scanner/
  styles/tokens.css
  config/eventPresentation.ts
web/tests/                # existing Node tests plus proposed tests
web/e2e/                  # proposed browser/visual tests; not installed
```

This is an ownership map, not a mandate to create every folder up front. Start with token styles, two or three primitives and the first layout. Create a feature module when extracting a complete task, not a one-line forwarding hook. A module should hide repeated loading/error/domain coordination behind a small interface. Prefer colocated feature views to a universal `DataCard` with dozens of options. Keep pages as route adapters; there is no need to move all files just for symmetry.

## 3. Role shells and authorization seam

| Shell | Existing routes covered | Responsibility and exclusions |
|---|---|---|
| Public | `/` | Platform identity, clear real destinations, skip link/footer; no fabricated event search |
| Event | `/e/:slug`, `/e/:slug/booths/:boothId` | Event facts, editorial hierarchy, optional scoped branding, reservation/profile; no invented agenda/speakers |
| Attendee | `/me` (formerly `/my-tickets`, `/my-network`), `/c/:slug/my-congress\|details\|my-network\|my-ticket\|my-profile` | Four panel tabs plus profile and congress switcher, session status, safe intended destination, bounded mobile content; not Organizer credentials |
| Workspace | `/organizer`, `/organizer/events/:eventId`, `/organizer/events/:eventId/analytics` | API-key gate, Event scope, resource/report navigation; no invisible cross-tenant lookup |
| Exhibitor | `/booth/:boothId` | Booth scope, lead work and JWT session; staff membership still enforced by server, not shell |
| Operations | `/scan/:pointId`, `/organizer/events/:eventId/desk` | Readiness, fast input, results, queue/issuance and escape back to scope; no distracting rail or Event brand colors on outcomes |

A shell is presentation and navigation, **not authorization**. Organizer API keys remain session-scoped; attendee/staff JWTs remain their own identity type until an approved security migration. `getApiClient()` currently chooses Organizer sessionStorage before attendee localStorage when no token is passed. Migrate role call sites to explicit credentials so a user holding both does not accidentally send the wrong one. Audit all callers before removing ambiguous selection; do not leave a permanent alias/fallback layer. The Scanner endpoints are now protected by point-scoped Scanner JWT or owning Organizer key; preserve that server boundary and separately fix the cross-scope replay tracked in #20.

A shared attendee session module can centralize token-change notifications and expired-session display. Use React context/reducer only for this cross-route state, not all server records. Never infer a staff role from possession of a JWT. Organizer foreign-tenant records must continue returning 404; booth competitors must continue receiving 403. Permission failures must never paint previously loaded restricted content.

Neutral sign-in can reuse existing login/register endpoints; password recovery, staff invitations and desk account claims have no working contract and need separate backend work. Proposed destination handling permits only internal routes and retains reservation intent without automatic duplicate requests. No new route replaces an existing deep link.

## 4. Feature interfaces and state

- **Public Event/reservation:** fetch public Event, render real facts/tiers, authenticate where needed, reserve once, then show ticket destination. Preserve atomic quota enforcement and one active Ticket per User/Event. Total quota is not remaining inventory; do not compute an availability figure absent the DTO field.
- **Tickets:** original QR payload and opaque white plate; cache freshness/network status visible. Existing plaintext localStorage passes can outlive tokens; changing expiry, purge, sign-out and device policy is a privacy decision, not a styling helper.
- **Network:** private notes, current one-way connection creation and vCard download. Do not describe connections as mutual or contact data as consent-filtered until backend changes. Manual secret entry stays truthful; camera work is a separate capability.
- **Organizer resources:** feature sections for Booths/staff, Check-In Points/policies and Ticket Tiers. No edit/delete controls without corresponding endpoints. Resource tabs are local panels; links remain links when navigating routes.
- **Leads:** Booth membership, duplicate-update semantics, filtering and qualification. Export must check HTTP success before downloading; do not deliver an error response as a CSV. A lead scan is not admission.
- **Analytics:** keep existing 10-second polling until measured need says otherwise. Clean up timers and ignore stale/unmounted results. Preserve point/tier filters; time filters can use existing from/to API support, and export must reflect selected filters. Do not label cumulative admitted counts as live occupancy or polling as streaming.
- **Desk:** preserve optional-email registration, debounce/search, minted pass and history. Print stylesheet can improve pass printing now; recoverable identity for placeholder-email users cannot be solved by print UX.
- **Scanner:** view seam consumes current readiness/result/queue state; engine/storage/audio remain authoritative modules for their current responsibilities. Do not move durable queues into React state or a generic query cache.

State categories: URL params are scope; URL search can hold shareable filters where no secrets are exposed; component state owns transient dialogs and drafts; feature state owns request lifecycle; IndexedDB owns durable scanner data; server owns authorization, inventory and accepted check-ins. Avoid cache copies of the same record in several contexts. Clear or re-key role data when scope/credentials change. Retain drafts on safe recoverable failures but never persist raw QR secrets or API keys in URL/logging.

**Query library decision:** no query/cache dependency exists. Start with feature-local requests and cancellation/stale-response handling where needed. Add TanStack Query only if repeated invalidation, overlapping reads and refresh ownership justify it. Gain: centralized server-state lifecycles. Risk: stale private cross-role caches and scanner retries hidden behind generic mutation behavior. Lower-cost alternative: small task-specific hooks. Never apply query retries to scanning or reservation without preserving client IDs and contract semantics.

## 5. CSS, Tailwind 4 and Event theming

Reuse Tailwind 4's existing Vite integration. Proposed `styles/tokens.css` is imported once from `index.css`; foundations feed semantic CSS variables and Tailwind utility mappings. Illustrative future syntax, not installed code:

```css
:root {
  --surface-page: #F7F8FA;
  --surface-panel: #FFFFFF;
  --text-primary: #17212B;
  --action-primary: #0F766E;
}
@theme inline {
  --color-page: var(--surface-page);
  --color-panel: var(--surface-panel);
  --color-ink: var(--text-primary);
  --color-action: var(--action-primary);
}
```

Complete semantic pairs/states, spacing/type/radii, focus and responsive contracts are in 05; do not create a second palette here. Keep mobile form text at 16px+, use logical CSS properties, and isolate LTR machine values in mixed-script content. Start light-first. Operations dark/high-contrast surfaces use a scoped palette, not a global toggle that accidentally inverts QR plates.

**Current Event API lacks branding fields.** Name/slug/date/location/description do not include artwork, logo, accent, font, theme or timezone configuration. Proposed `config/eventPresentation.ts` can hold reviewed, deployment-owned presets keyed by known slug for an initial curated Event. This is an explicit limited configuration adapter, not Organizer-editable persistent theming and not a new Event DTO. Unknown Events use the product baseline. Keep overrides on Event-layout attributes/CSS variables; never build arbitrary Tailwind class names or leak overrides into admission, workspace or lead controls.

Persistent Organizer branding requires a separate API/schema/migration, upload/storage/security model, permissions, validation, accessible color pairs and fallback behavior. Arbitrary accent must not become arbitrary CSS/HTML/font URLs. Theme selection should initially use approved presets. Gain: independent Event identity. Risk: inaccessible contrast, unsafe assets, broken caches and content burden. Lower-cost alternative: strong hierarchy with existing description and a neutral art-free layout. Brand assets are optional; essential facts/reservation are not.

## 6. Forms, tables, charts and assets

| Decision | Necessity/gain | Risk and lower-cost alternative |
|---|---|---|
| Small shared native form/control primitives | Consistent labels/errors, target sizes, duplicate-submit handling | Over-configurable wrappers; keep domain validation/fields in each feature |
| Vetted dialog primitive for seven overlays | Focus containment/restoration, Escape, inert background, accessible names and scroll handling | Added dependency and mobile behavior; select one maintained primitive or use native dialog with fully tested lifecycle, not a hand-rolled focus trap |
| Narrow dialog library choice | [Radix Dialog official documentation](https://www.radix-ui.com/primitives/docs/components/dialog) describes trapped focus, Title/Description announcements, controlled state, and Escape returning focus to the trigger | Prefer this one primitive, not a whole suite; native `<dialog>` lowers dependency cost but still needs React lifecycle, focus/scroll and accessibility testing. React Aria is an alternative for broader internationalized interaction needs, not a prerequisite for these seven dialogs |
| Native tables first | Semantic comparison and predictable keyboard reading | Phone overflow; use prioritized summary rows/detail sheets, or labeled horizontal scroll for true comparison |
| No table framework by default | Current list/filter capabilities do not require an enterprise grid | Adopt a library only with demonstrated complex sorting/selection; server pagination remains blocked by API support |
| Keep native bar/summary chart composition initially | Existing analytics can be clarified without a plotting stack | Misleading units/scales; always give labeled values and accessible data table; larger chart library only for approved needs |
| Local forms before React Hook Form/schema package | Existing forms remain small after section extraction | Repeated field-array/validation complexity may justify a library later; backend validation remains authoritative and errors remain inline |
| Keep `react-qr-code` | Preserve payload, quiet zone and reliable output | Decorative distortion destroys readability; test real printed/mobile scans rather than swapping QR libraries |
| Approved local SVG/icons/fonts and optional Event art | Stable delivery, clear labels, scoped identity | Licenses, privacy from remote font requests, script in untrusted SVG, large images; system fonts and text-first Event are valid lower-cost defaults |

Do not add stock crowd photos as factual Event imagery. Track asset source/license, intended context, dimensions, alternative text and ownership. Informative photos need useful alt; decorative art has empty alt. Provide intrinsic dimensions/responsive image sizes and avoid blocking a ticket on image/font delivery. Event logos and sponsors cannot be invented. Inter/Vazirmatn remain proposed, self-hosted and license-checked, not installed assets.

## 7. Accessibility and verification architecture

WCAG 2.2 AA is a target, not an audit result. Layouts provide landmarks, skip links and scoped headings. Controls use actual buttons/links and persistent labels. Dialogs restore focus to triggers; scanner announcements are deduplicated and use text/icon alongside optional sound. Form errors associate with fields and a focusable summary. Test zoom/reflow, keyboard, reduced motion, contrast, long names and Persian/Latin bidi. Explicit Event timezone is not in the current Event model; first label observed date semantics accurately, then approve timezone API before promising timezone-aware Event authoring.

Existing checks: Node policy tests under `web/tests/`, TypeScript/build and oxlint scripts in `web/package.json`; full-stack `scripts/check.sh`/`scripts/check.bat`. No browser runner, DOM testing package or visual snapshot harness is installed. Proposed additions should be small: browser E2E/visual tests in `web/e2e/`, component interaction coverage for forms/dialogs, and accessibility automation plus manual review. Keep pure scanner tests; interface-level durable queue/retry tests matter more than implementation snapshots.

Visual regression baseline must have deterministic seeded Events, unique slugs, Organizer/attendee/Booth identities, admitted/rejected/pending queues and realistic long data. Use a running migrated backend or explicit test fixtures that are clearly fixtures, never claim a screenshot of stub data is live product proof. Capture 360, 390, 768, 1024 and 1440; include focus, errors, empty/denied/offline/sync states and print output. Fix locale/timezone/fonts/clock, disable irrelevant animation, mask secrets and limit volatile chart timestamps. Humans review diffs; do not automatically bless every changed image. Current shell screenshots are useful context only, not populated-flow baselines.

## 8. Contract and risk register

| Work lane | Scope | Presentation cannot substitute for |
|---|---|---|
| Frontend presentation | Tokens, layouts, dialogs, responsive records, hierarchy, error states, print CSS, truthful copy, explicit client credentials | Server authorization or new capabilities |
| Security/privacy | Cross-scope Scanner replay; explicit client credential lifecycle; local Ticket/manifest ownership and retention; safe session transitions | Hiding an existing replay, cache-ownership or client-credential defect behind a new visual shell |
| Consent | Peer disclosure preferences and permission-aware API/vCard; settle exhibitor disclosure policy | A frontend checkbox while API/export still discloses email |
| API/product contracts | Staff invite/recovery, desk claims, booth QR resolver, inventory, true occupancy/time windows, persistent branding | Successful-looking UI promises without working backend flow |
| PWA | Manifest/service worker, offline boot/update strategy and secure cache scope | Existing IndexedDB after a successful page load |
| Native/mobile capability | Real camera decoding, durable SQLite, platform scaffolds and hardware feedback | Current Dart in-memory prototype or a drawn camera reticle |

Preserve all 11 existing routes and current endpoint contracts during presentation releases, authenticated Ticket ownership, atomic free-ticket capacity, tenant/Booth isolation, 128-bit Entity QR semantics, idempotent UUID retry batches and duplicate-update behavior. Security/API remediation may explicitly extend/change a contract only in its own approved release, with every browser/mobile caller updated together. Preserve `scannerEngine.ts`, `scannerStorage.ts`, `audioFeedback.ts` and current Dart policy/API/sync interfaces during the visual work; native capability completion is not implied. No payments, CME, schedules, chat, AI matchmaking or Redis architecture is introduced.

Operations risk is evaluated in phase 0, but Scanner/Desk visual migration occurs only after quieter slices establish tested primitives. This avoids discovering a queue-loss or input-latency regression during an event while still exposing critical endpoint/privacy issues immediately.
