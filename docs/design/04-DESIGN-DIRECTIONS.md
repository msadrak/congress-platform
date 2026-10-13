# 04 — Design directions

Status: recommendation for future implementation, not implemented UI. Research date: 2026-10-10. Authority: [MASTER-PLAN](MASTER-PLAN.md). Evidence detail: [02](02-COMPETITOR-RESEARCH.md); adaptations: [03](03-DESIGN-SYNTHESIS.md).

## Decision: A — Refined minimal product, expressive event layer

Keep one recognizable product grammar—typography, controls, navigation behavior, semantic feedback—while varying composition and density by task. Event branding is scoped to public Event surfaces, not admission outcomes or Organizer controls. This validates the four-layer hypothesis but adds an **operations mode**, rather than forcing Scanner and Desk into dashboard furniture.

### A. Refined minimal product
- Concept: calm, precise software with purposeful event artwork. Legibility and current action lead; decoration follows.
- Typography: Inter or system Latin sans; Vazirmatn for Persian. Regular body, medium labels, semibold headings. No all-caps paragraphs or heavy display typography in tools.
- Color: neutral white/stone surfaces, ink text, restrained teal product action; independent success/error/warning semantics. Event accents may differ within contrast constraints.
- Layout: restrained editorial public homepage; event fact block beside reservation card; compact attendee pass-first workspace; event-scoped management sidebar; full-screen operations.
- Components: modest 6–12px radii, thin borders, mostly flat surfaces, drawers for qualification, tables for comparable records, cards for individual tickets/people.
- References: Luma's observed restrained discovery hierarchy; Eventee's attendee-oriented presentation; Swapcard/Accelevents official multi-role product grouping; Cvent/pretix operational material. These are mixed evidence types, not inspected private dashboards.
- Strengths: highest reuse, mobile-friendly, lowest visual migration risk, credible across scientific and commercial events.
- Weaknesses: can become anonymous without deliberate event art, strong copy, and disciplined spacing. Teal is a proposed product choice, not competitor imitation.
- Suitability: best fit for the delivered free-ticket multi-role product. Complexity: medium; control extraction and layouts matter more than a homepage facelift.

### B. Editorial congress platform
- Concept: large editorial titles, event photography/commissioned art, asymmetric compositions and section rhythm.
- Typography: stronger display face confined to Event hero; product body remains accessible sans. Font delivery and Persian equivalents need validation.
- Color: bolder event palette, ink/cream editorial surfaces; public artwork can carry contrast rather than entire-page saturated backgrounds.
- Layout: strong cover-led public Event, alternating content bands; operational areas remain restrained.
- Components: spacious public cards, typographic dividers, visible editorial metadata.
- References: Config, Slush, Web Summit, Fourwaves. Evidence limitations and current redirects are documented in 02.
- Strengths: distinctive individual Events, stronger public storytelling.
- Weaknesses: current Event data is too limited to sustain many sections; costly content/asset production; display fonts may weaken mixed-script usability. Cannot invent speakers/programs to fill a composition.
- Suitability: excellent **optional event theme treatment**, weaker whole-product default. Complexity: medium–high including branding persistence and content work.

### C. Precision enterprise
- Concept: structured administration, denser rows, persistent scope/navigation, explicit status and exception handling.
- Typography: compact sans, tabular numeric analytics, modest headings; never smaller than readable operational body text.
- Color: mostly grayscale with functional accents; selected navigation and statuses are intentionally different.
- Layout: left scope/navigation rail, toolbar, table/detail split; management tabs; minimal marketing expressiveness.
- Components: compact forms and tables, 6–8px radius, tight grouping, few elevated cards.
- References: Swapcard, Accelevents, Cvent, pretix; enterprise workflow ideas are mainly official product/docs evidence, not private UI observations.
- Strengths: fast repeated staff tasks, efficient comparisons and clear workspace scope.
- Weaknesses: intimidating to Attendees; weak event personality; tables become difficult on phones without alternate compositions.
- Suitability: Organizer/Exhibitor density preset, not universal shell. Complexity: medium–high because scope navigation and mobile tables require careful migration.

## Comparative decision

Scores are design judgments (1 weak–5 strong), not measured competitor usability or user-study results.

| Criterion | A | B | C |
|---|---:|---:|---:|
| Fit delivered features | 5 | 3 | 4 |
| Attendee mobile clarity | 5 | 4 | 2 |
| Staff information efficiency | 4 | 2 | 5 |
| Event identity | 4 | 5 | 2 |
| Shared implementation leverage | 5 | 3 | 4 |
| Low migration risk | 4 | 3 | 3 |

Choose A, borrowing B **only for Event presentation** and C **only for staff density**. This is a controlled architecture, not three competing component libraries. Scanner is an explicit task mode with shared tokens and specialized interaction.

## Visual composition rules

- Homepage: bounded text-led hero, operational value propositions grounded in existing capabilities, genuine application imagery after seeded validation; no fabricated customer logos, vanity metrics, demo buttons, or testimonials.
- Event: date/location/name before long description; artwork optional; reservation remains reachable at 360px without dominating all content.
- Attendee: ticket/QR is a destination, not a KPI card; saved Booths and Connections are secondary personal content.
- Workspace: title, current Event/Booth, key action, then records; KPI cards only when an actual measure exists.
- Operations: readiness/result/status occupy separate fixed zones; outcomes use text, icon, and sound where enabled. Event brand never changes admission semantics.

## Validation before approval to build

Walk through a 360px ticket, 390px registration, 768px lead detail, 1024px setup and 1440px analytics specification with users representing Attendee, Organizer, Exhibitor and staff. These interviews have **not** been conducted. Test a Persian mixed-script prototype and scanner queue/result semantics before adoption. No user-preference claims are made here.
