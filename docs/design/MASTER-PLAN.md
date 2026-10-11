# Frontend UX/UI redesign master plan

**Status:** research and implementation planning only. No production frontend/backend/mobile redesign was implemented. Research date: 2026-10-10. This is the authoritative decision summary; detailed specifications below share its scope and direction.

## Phase 0 validation status

The populated baseline, current-source reconciliation, security/capability issues, design decisions, and go/no-go recommendation are in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md). PostgreSQL is migrated through Alembic `0008`; the complete Windows verification script passed all three stacks. This report supersedes older statements below that PostgreSQL was unavailable, verification had stopped at fixture connection errors, or Scanner manifest/batch endpoints were unauthenticated or exposed attendee email. Current endpoints require a point-scoped Scanner JWT or owning Organizer key and omit attendee email; cross-scope replay and client credential rollout remain open.


## Read and execute in this order

| Document | Purpose |
|---|---|
| [01 — Current UI audit](01-CURRENT-UI-AUDIT.md) | Actual routes, source evidence, rendered evidence and contract gaps |
| [02 — Competitor research](02-COMPETITOR-RESEARCH.md) | All twelve required references, exact sources, observations and access limits |
| [03 — Design synthesis](03-DESIGN-SYNTHESIS.md) | Comparative matrix, reusable patterns, adaptations and rejection ledger |
| [04 — Design directions](04-DESIGN-DIRECTIONS.md) | Three candidates and justified direction A |
| [05 — Design system](05-DESIGN-SYSTEM.md) | Foundations, tokens, typography, RTL, components, states and accessibility |
| [06 — Page blueprints](06-PAGE-BLUEPRINTS.md) | Every current route and six critical end-to-end journeys |
| [07 — Frontend architecture](07-FRONTEND-ARCHITECTURE.md) | Actual/proposed files, safe extraction, state/theming and contract boundaries |
| [08 — Implementation roadmap](08-IMPLEMENTATION-ROADMAP.md) | Phased tasks, dependencies, risks, verification and release acceptance |

Raw first-party research provenance is retained in `research-enterprise.md` and `research-attendee.md`; these support 02 rather than introducing separate decisions. Authentic local and selected public reference screenshots are in [evidence/](evidence/). No generated mockups or competitor assets are proposed for shipping.

## 1. Overall assessment

The product is more than a conference website: it already connects public Event/free reservation, digital Tickets, public Booths/bookmarks, attendee Connections, Organizer setup/Desk/Analytics, booth-owned Lead qualification and browser gate scanning. React 19, TypeScript, Vite, Tailwind 4, React Router and the typed FastAPI client are a credible base. Preserve those vertical slices rather than restart the frontend.

The main design problem is **fragmented product grammar**, not insufficient gradients or a missing large component library. Twelve page modules repeat layout/control/state conventions; public entry mainly serves Organizers; attendee/staff sign-in links can lead to a homepage without sign-in; registration mixes account access with reservation; seven overlays lack accessible modal mechanics; dense setup, analytics and lead surfaces need clearer grouping and role scope. Mobile record browsing, error recovery, keyboard focus and state truth need systematic treatment.

Some product claims exceed current source. Browser Scanner data is retained in IndexedDB while the app is already loaded; there is no installable/offline-bootable PWA layer. Native Dart code lacks production camera/persistent SQLite wiring. Peer email is exposed without stored consent. Scanner manifest/batch routes now require a point-scoped Scanner JWT or the owning Organizer key, and the manifest omits attendee email; however, cross-scope scan-ID replay can disclose another Check-In result and QR secret. The printed Booth QR still has no public resolver. These are **contract/capability gaps**, not an invitation to implement them in a styling change. See the Phase 0 report and gate register.

### Evidence actually obtained

- Reviewed GLOSSARY, REPORT, V1/V2 specifications, coding standards, all eleven ADRs, relevant issue history, current React pages, API contracts and mobile scanner seams.
- Rendered all eleven routes with synthetic data at 1440×960 and 390×844 CSS pixels; saved 22 viewport captures and a separate queued/offline Scanner overflow state.
- Restored PostgreSQL, applied Alembic `0008`, seeded nonproduction records, and passed the unified Windows backend/web/mobile verification. Cross-scope replay, peer disclosure, cache access, offline result divergence and Booth QR failure were probed separately; details and limitations are in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md).
- Research uses directly rendered public websites, official help screenshots, documented workflows and a Cvent guided simulation. No private competitor dashboard access or user interviews were fabricated. Each evidence type is labeled in 02.

## 2. Five strongest design references

1. **Swapcard:** best conceptual and official screenshot reference for Booth-scoped dense Lead work, visible qualification state, contextual list/detail interaction and role/event/company context. Adopt its grouping, not its full suite, scoring scale or marketplace.
2. **Eventee:** best attendee-oriented hierarchy and mobile public presentation. Adopt approachable personal navigation and clear priorities, not a schedule module that this product lacks.
3. **Luma:** strongest directly observed restraint, compact discovery content and mobile ribbons. Apply fact/action hierarchy and spacing; a public Event directory remains blocked by missing API, and loading metadata/contrast must not be copied blindly.
4. **Accelevents:** strongest official scan→qualify→save and task-context distinctions. Gate check-in, booth capture and peer connection must remain different actions; capture is not admission.
5. **pretix:** strongest detailed operational/offline evidence. Readiness, initial sync, last successful synchronization, duplicate result reasons and disconnected-device limits are more useful than “offline safe” slogans.

Cvent OnArrival provides a complementary dedicated field-operations simulation; Fourwaves supports Event microsite architecture; Whova supports people/contact organization. Config, Slush and Web Summit inform bounded Event art direction; RSNA informs professional information hierarchy. None is a wholesale template.

## 3. Chosen visual direction

**A — Refined minimal product, expressive Event layer.**

Calm neutral surfaces, strong readable type, restrained teal product action, modest radius/borders and minimal elevation. Event artwork/accent may be expressive within validated constraints. Attendee pages are personal and mobile-first; Organizer/Exhibitor pages are denser; Scanner and Desk get dedicated task modes.

This wins over editorial-everywhere because current content is limited and tools need efficiency; it wins over enterprise-everywhere because Attendees need immediate Tickets and approachable networking, not administrative navigation. Borrow editorial composition only for Event public surfaces and precision density only for staff tasks. No competitor branding, proprietary artwork or exact composition is copied.

## 4. Information architecture

| Layer/mode | Scope | Navigation principle |
|---|---|---|
| Platform public | `/` | Explain current capabilities; role entry; no fake Event directory/demo |
| Event public | `/e/:slug` and public Booth | Event facts, free reservation, Booth discovery/profile; no unsupported agenda/speakers |
| Attendee | Tickets and Network | Ticket-first mobile workspace, two real primary destinations; saved Booths remain personal content |
| Organizer | Event list, setup, analytics | Visible Organizer/Event scope; setup groups Tiers/Points/Booths; Desk enters operations mode |
| Exhibitor | assigned Booth Lead portal | Booth identity and permitted Lead list/capture/qualification/export; never Organizer controls |
| Operations | Scanner and Desk | readiness→input→result→next action, visible offline/queue/freshness; no dashboard decoration |

All eleven existing route URLs remain valid. Shared layouts are presentation, not authorization. Source parameter is `:eventId` on Organizer routes; shorthand `:id` in older route maps does not justify a rename.

## 5. Major decisions

| Decision | Reason and boundary |
|---|---|
| Retain current stack and typed API seam | Reuse delivered behavior; no framework rewrite |
| Introduce semantic CSS variables + Tailwind v4 mapping | One token vocabulary and scoped themes; avoid arbitrary dynamic utility strings |
| Extract small native-first primitives and role layouts | Repeated behavior/style needs consistency; no giant universal card or folder scaffolding mandate |
| Adopt a narrow vetted modal primitive | Seven overlays need focus containment/restore, names, Escape/inert background; not a massive suite install |
| Keep native forms/tables and existing chart composition initially | Current complexity does not justify grid/chart/form dependency overhaul |
| Preserve original QR and scanner libraries | View redesign cannot change payload, quiet zone, durable storage, policy/UUID retry behavior |
| Explicit role credentials at migrated API call sites | Avoid Organizer key overriding attendee JWT in fallback selection; migrate all relevant callers, no permanent shim |
| English default; Persian/RTL readiness now | Logical properties, bidi isolation, locale formatting, license-checked Inter/Vazirmatn; no automatic Persian conversion |
| Light-first system; scoped high-contrast operations | Dark mode is not just inversion; QR always opaque white/dark |
| Event theming has a bounded configuration path | Existing Event DTO has no branding fields; curated deployment presets are optional, Organizer-managed branding requires approved API/storage work |
| No decorative controls | Every nav, button, filter, metric and badge must map to a real behavior/data contract |

Token values in 05 are proposed baselines, not completed contrast certification. Date display must respect current timestamp semantics; explicit Event timezone authoring requires an API decision. A calendar preference changes display, not stored API time.

## 6. Page transformation summary

| Route | Proposed transformation | Preserve / constraint |
|---|---|---|
| `/` | Specific product positioning, capability groups, truthful role entry | No current Event directory or invented customers/statistics |
| `/e/:slug` | Fact-first Event page, clear free tier choice, accessible authentication/reservation, explicit confirmation | Atomic capacity, authenticated ownership; no remaining count without API |
| `/e/:slug/booths/:boothId` | Clear company identity, brochure/site/bookmark, return to Event | Booth/Event match, external link safety; public scan resolution separate |
| `/my-tickets` | Ticket selector/pass-first, readable QR, cache truth, saved Booths, personal navigation | Original credential; shared-device retention requires privacy policy |
| `/my-network` | Contact list, private-note detail, deliberate peer input and vCard export | Current directed Connection and manual input; consent requires backend |
| `/scan/:pointId` | Minimal readiness/result shell, input modes, queue/freshness and explicit recovery | Engine/storage/UUID batch contract; security/reconciliation gates mandatory |
| `/booth/:boothId` | Booth scope, compact Leads, search/rating, qualification drawer, reliable export feedback | Membership isolation and duplicate updates; manual input currently |
| `/organizer` | Validated key entry, Event worklist, grouped create form | API-key model; no edit/archive/delete API |
| `/organizer/events/:eventId` | Clear Event scope and Tiers/Points/Booths task groups; staff/QR overlays | Create-only resources, policy values; do not promise invitations |
| `/organizer/events/:eventId/desk` | Search-first workspace, issuance beside lookup, pass-only print, next attendee focus | Optional email/quotas; account recovery not delivered |
| `/organizer/events/:eventId/analytics` | Meaningful compact KPIs, units/freshness, readable bars/table alternatives, contextual CSV | 10-second polling; cumulative admissions not true occupancy |

Full seventeen-field route specifications and A–F journeys are in 06. Shared breakpoints and 360/390/768/1024/1440 rules are in 05; do not substitute a desktop table squeezed into a phone.

## 7. Priority and execution order

1. **Phase 0:** validate populated UI when a migrated backend is available; inventory truth and security/privacy/policy gates; confirm direction and scope. Operations risk is assessed immediately.
2. **Phase 1:** semantic tokens, typography, native controls, accessible overlay, role layouts, focus/state rules. Migrate one vertical slice, not every page.
3. **Phase 2:** platform/Event/Booth public surfaces and free registration/auth intent.
4. **Phase 3:** Tickets/QR/saved Booths and Network; no false privacy claims.
5. **Phase 4:** Organizer list/setup with visible scope and truthful create-only controls.
6. **Phase 5:** Exhibitor Lead list/capture/qualification/export.
7. **Phase 6:** Analytics/reporting, contextual filters/CSV and accessible measures; cumulative admission is not live occupancy.
8. **Phase 7:** Desk/Scanner presentation after established primitives, real hardware/offline/reconnect verification, and final cross-route responsive/RTL/accessibility/performance/visual regression gate. Native/PWA completion remains separate capability work.

Quick wins: truthful auth entry/copy, labeled close buttons, correct loading/error distinctions, visible scope/freshness, pass-specific print stylesheet. Structural work: accessible overlay system, role layouts, token migration, feature-owned state and responsive record/detail views. Contract work: separately approved gates below. The phase list does not postpone urgent security remediation until Scanner visual work.

Complexity/risk estimates in 08 are relative planning judgments, not calendar promises. Assign actual effort after populated baseline and contract gates are available.

## 8. Separate contract gate register

| Gate | Evidence | Required decision/acceptance before claiming capability |
|---|---|---|
| Scanner authorization/minimization | Check-In routes require a point-scoped Scanner JWT or owning Organizer key; manifest omits email. Valid cross-point/Event scan-ID replay can still disclose the original result and QR secret. | Close scoped idempotency leak; complete browser/Flutter device credential lifecycle; retain denied access and manifest minimization. |
| Peer consent/disclosure | `backend/app/routes/network.py`, models and V2 mismatch | Decide opt-in model and API/vCard enforcement; no frontend-only checkbox |
| Offline capacity/reconciliation | `scannerEngine.ts`, `GateScanner.tsx`, server batch results | Local provisional vs server-confirmed truth; reconcile returned results; capacity cannot be guaranteed globally offline |
| Booth public QR | raw secret standee vs slug/UUID route | Resolver or separately approved public URL QR strategy; preserve attendee Entity QR payload |
| Staff access/Desk recovery | random passwords for created accounts; no invitation/claim flow | Real delivery/recovery contract; truthful interim copy, no fake invitation |
| Event branding/timezone/inventory | absent DTO fields | Approved field/asset permission/validation contract if Organizer-managed; art-free baseline works without it |
| Installable offline shell | no service worker/manifest | Scoped secure cache/update/boot strategy and restart proof; IndexedDB alone is not PWA |
| Native scanner parity | current in-memory Dart services and absent decoder integration | Separate camera/persistent storage/platform completion with device restart/scan proof |
| Occupancy/time windows | cumulative admissions; no exits/window model | Label accurately now; genuine occupancy/window semantics require separate API model |

No payments, CME, AI matchmaking, chat, schedules/speakers, Order/Buyer claim system or Redis workers are introduced by the redesign. Existing isolation, free reservation, QR, Lead and Connection capabilities remain mandatory regression constraints.

## 9. Verification and current limitations

Planning verification checks required documents, local links, route coverage, evidence and consistent direction; it is not verification of a redesigned UI. Future acceptance needs real seeded identities/events, safe test secrets, keyboard/screen reader, target widths, RTL/mixed script, modal focus, printed/mobile QR, camera/HID and offline reconnect with stable UUIDs.

The required unified Windows verification script passed. **Backend mypy passed (39 source files); pytest 88 passed; web tests 5 passed, TypeScript and production build passed; Dart tests 8 passed and analyzer reported no issues.** PostgreSQL and Alembic `0008` were available. Full details and untested limits are in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md).

Unresolved questions are not visual-direction choices: approved asset identity, locale launch priority, Event timezone authoring, cache retention on shared devices, contact consent, operational device authorization and native parity expectations require product/security decisions before their corresponding contract work. User-role research and real throughput measurements have not been performed; this plan makes no empirical completion-speed or accessibility-compliance claims.

## Handoff rule

An implementation agent should begin with phase 0 of 08, use 06 as route acceptance, 05 as the sole foundation vocabulary, and 07 for conservative ownership. Revalidate current source before editing because this is a snapshot. Do not use a visual refactor to silently change policy, privacy, APIs, authentication or offline durability. Resolve a contract gate in its own traceable release, then update all affected clients and this decision record.
