# 03 — Cross-product design synthesis

Status: recommendations, not completed redesign or usability-study results. Sources and their limitations: [02](02-COMPETITOR-RESEARCH.md). Current-product evidence: [01](01-CURRENT-UI-AUDIT.md). Direction decision: [04](04-DESIGN-DIRECTIONS.md).

## Evidence discipline

Rendered public pages prove public composition and navigation only. Embedded screenshots illustrate a product state but do not prove live interaction, error handling or accessibility. Official help material establishes described workflows, not measured performance. Authenticated competitor dashboards were not inspected. Our populated authenticated screens were source-audited, not rendered against a live database. Consequently recommendations below combine observable public patterns, described operational concepts, current contract constraints and explicit design judgment.

## Comparative reference matrix

H = strong conceptual relevance to that category; M = useful secondary reference; — = not a useful primary source. These are suitability assessments, not numerical accessibility ratings.

| Product | Public hierarchy/type | Event layout | Attendee navigation | Staff density/forms | Operations feedback | Responsive evidence | Best use here |
|---|---|---|---|---|---|---|---|
| Swapcard | M | M | H | H | M | Public desktop directly captured; private unknown | Booth/Lead scope and capture→qualification grouping |
| Accelevents | M | M | M | H | H | Consult 02; do not infer private mobile | Event setup and management task grouping |
| Cvent OnArrival | — | — | — | H | H | Product documentation/illustrations, not local hardware trial | Desk and Scanner exception/fallback workflow |
| Eventee | H | H | H | M | — | Public program page 390px screenshot; app illustration only | Attendee-first composition and approachable controls |
| Whova | M | M | H | M | — | Public material; private mobile app unknown | Connection identity and contact organization |
| Luma | H | H | M | — | — | Discovery directly captured at 1440/390; partial metadata loading | Public restraint, fact hierarchy, discovery ribbons |
| Fourwaves | M | H | M | M | — | First-party evidence described in 02 | Reusable event microsite foundation |
| pretix | — | M | M | H | H | Public check-in documentation, no device trial | Ticket state and check-in policy vocabulary |
| Config | H | H | — | — | — | Current URL access/redirect caveats in 02 | Bounded event identity and typographic rhythm |
| Slush | H | H | — | — | — | Public presentation only | Strong Event art direction, not product controls |
| Web Summit | M | H | M | — | — | Public schedule access limits in 02 | Future large-program filtering, not shipped schedule |
| RSNA | M | H | M | — | — | Public resources evidence | Professional resource hierarchy and trust |

### Ten evaluation dimensions and decisions

1. **Hierarchy:** borrow Luma's concise heading/fact/action sequence; Event details and ticket access precede promotional sections. Avoid a platform hero that only routes Organizers.
2. **Typography:** Eventee/Luma readability is a useful public reference; Config/Slush expressive display is restricted to event hero. No competitor font or exact scale copied.
3. **Composition:** Fourwaves microsite concept + current minimal Event fields yields one reusable scaffold, not a per-event fork. Missing assets must not become fake cover art.
4. **Navigation:** Swapcard's public separation of participant/organizer entry and enterprise module concepts inform role entry points. Our four real Event tasks remain enough; do not replicate an enterprise mega-sidebar.
5. **Density:** workspace rows/grouped forms rather than giant cards; attendee ticket/profile cards remain approachable. No single density for all roles.
6. **Forms:** Accelevents setup and Luma conversion concepts suggest short grouped workflows; current free reservation has authentication then reservation, not checkout. Preserve the selected tier and truthful capacity errors.
7. **Responsive:** Luma's observed mobile ribbons work for optional browsing; Eventee's stacked CTAs work for conversion. Required form steps and QR must never live off-screen in a ribbon.
8. **Feedback:** Cvent/pretix check-in concepts favor visible readiness, explicit result and recovery. Queue/server confirmation must remain distinct in our scanner.
9. **Accessibility:** no competitor receives an AA claim based on screenshots. Our system explicitly specifies focus, landmarks, dialog behavior, contrast, reduced motion and state announcements.
10. **Actual suitability:** whitelist current Event, Ticket, Booth, Lead, Connection and admission features; reject schedules/speakers/payments/chat/AI/CME as current-scope design.

## Pattern decision ledger

| ID | Reference and exact evidence | Concrete idea/problem solved | Our pages | Adaptation and rationale | Drawback/guardrail |
|---|---|---|---|---|---|
| P01 | [Luma discover](https://luma.com/discover), [desktop](evidence/luma-discover-desktop.png), [mobile](evidence/luma-discover-mobile.png) | Restrained title, compact image/name/location pairs; content rather than giant card furniture | `/`, `/e/:slug`, saved Booths | Platform positioning + existing Event facts; public directory only after API exists | Some screenshot metadata still loading; do not copy light-gray text without contrast check |
| P02 | [Eventee program](https://eventee.com/features/event-program), [mobile public evidence](evidence/eventee-program-public-mobile.png) | Stacked readable mobile content, obvious primary/secondary action | Event registration, attendee portals | Ticket/QR first, Tickets/Network bottom navigation; omit agenda tab | Phone illustration is not app usability proof; large marketing CTAs inappropriate in tables |
| P03 | [Swapcard Exhibitor Center](https://www.swapcard.com/features/exhibitor-center), [public screenshot](evidence/swapcard-exhibitor-public-desktop.png) | One Booth workspace concept across capture, qualification and export | `/booth/:boothId` | Keep search/rating/tags/notes; detail drawer alongside lead list | Workspace mechanics are official-described, not private-observed; avoid marketplace/AI modules |
| P04 | [Accelevents](https://www.accelevents.com/) + official detailed sources in 02 | Setup tasks grouped into explicit management areas | Organizer list/detail | Event-scoped Overview/Tiers/Points/Booths links or in-page tabs, existing routes retained | Do not add edit/archive controls to create-only APIs; no needless wizard around a short form |
| P05 | [Cvent OnArrival](https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software) | Operational entry/search/check-in/fallback concepts | Desk, Scanner | Search existing before creating; result zones, manual fallback, point/device state | Badge hardware integration is not present; whole-window print needs dedicated print layout, not invented printers |
| P06 | [pretix check-in](https://pretix.eu/about/en/features/checkin) | Explicit admission and offline/check-in policy concepts | Scanner, ticket | Point policy help, queued/server-confirmed distinction, duplicate handling | Do not import paid ticket/order model; capacity semantics differ and require contract repair |
| P07 | [Fourwaves](https://fourwaves.com/) | Reusable conference microsite concept | Event and Booth public pages | Fixed content hierarchy with scoped validated branding | Logo/cover/accent fields absent; persistence is separate API work |
| P08 | [Whova](https://whova.com/) | People/contact organization and networking concept | `/my-network` | Professional identity, private note, deliberate export | Current connections are directed and email always exposed; do not claim mutual/consent-aware until backend fixed |
| P09 | [Config](https://config.figma.com/san-francisco/), [Slush](https://slush.org/) | Event identity separate from generic product shell | Event hero only | Optional constrained art panel and stronger event title | Current-page availability documented in 02; no copying assets/compositions, no theatrical scanner animation |
| P10 | [Web Summit schedule](https://websummit.com/schedule/), [RSNA resources](https://www.rsna.org/annual-meeting/attendee-resources) | Group complex professional information into named, scannable sections | Current Event details; future program only | Short About/When/Where/Booths groups; credible organizer metadata only if available | Schedule/speakers absent; future IA insight must not become current blank tabs |
| P11 | [Swapcard public](https://www.swapcard.com/features/exhibitor-center) footer entry links, observed browser snapshot | Role-specific login entry prevents wrong workspace | `/`, auth gates, Booth | Attendee/staff credential entry independent of reservation, safe return destination | New auth presentation can reuse APIs; account recovery/invites require backend capability |

## Four-layer hypothesis: validated with one amendment

1. **Platform public:** owns positioning, role entry and existing-capability explanations; never pretends to be a public Event directory.
2. **Event public:** Event-branded cover/facts/registration/Booths, constrained tokens and trusted content.
3. **Attendee:** personal mobile workspace; Tickets and Network, not a management dashboard. Saved Booths stay under Tickets unless a genuine reason for another route emerges.
4. **Organizer/Exhibitor:** shared control grammar and status rules but separate scope/nav. Exhibitor gets assigned Booth and Leads, not Organizer settings.
5. **Operations mode:** specialized Scanner and Desk. Same accessibility/status language, dedicated task zones and input behavior. It is a mode, not a fifth brand or component library.

## Preserve, change, reject

**Preserve:** all eleven route addresses, authenticated ticket binding, original Entity QR secrets, free tier quotas, Organizer/Booth isolation, server policy authority, client scan UUIDs/retry semantics, browser IndexedDB, notes/tags/CSV/vCard and typed API seam.

**Change in visual refactor:** token repetition, inconsistent role navigation, focus handling in seven overlays, dense create-form organization, ambiguous async/error states, charts' explanatory labels, mobile table composition, print styles and truthful copy.

**Separate prerequisites:** scanner authorization/data minimization; peer contact consent; server/local reconciliation/capacity truth; Booth QR public resolution; staff invite/recovery; Event branding fields; true offline app-shell/native scanner support. These need independent acceptance and must not be hidden in a UI PR.

**Reject:** paid checkout/CME/AI matchmaking/attendee chat, speculative program/speaker tabs, marketing-stat KPI cards, global hero gradients/glassmorphism, playful rounded controls everywhere, full-library migration before narrow accessible primitives, fake event data, auto-advancing carousels, implicit green success for unsynchronized scans.

## How to test the synthesis

Before implementation release, run six current journeys with representative role users; measure completion/errors rather than aesthetic votes. Suggested targets are goals, not research results: no dead-end sign-in paths; no double ticket reservation; repeat scan produces policy-accurate feedback; Lead qualification without losing list context; QR reachable immediately after ticket selection; no prohibited contact disclosure. Seed real test contracts; use offline/reconnect and two-device policy conflict scenarios. See 08 for gates and 06 for route acceptance.
