# 05 — Design system specification

Status: proposed future system; no tokens/components have been implemented. Authority: [MASTER-PLAN](MASTER-PLAN.md). Direction: [04](04-DESIGN-DIRECTIONS.md). Current CSS is only Tailwind import plus 16px input protection (`web/src/index.css:1–9`); preserve that iOS guardrail.

## Principles and identity

1. Show the user's next real action; do not invent navigation or data to decorate a screen.
2. One component grammar, different role density. Attendees see personal actions; staff see scope and records.
3. Event identity belongs to the Event, admission semantics belong to the platform.
4. State truth outranks visual optimism: queued is not synchronized, offline is not verified, capture is not admission.
5. International readability and keyboard interaction are foundations, not a final skin.

## Token architecture

Use CSS custom properties in `index.css` (or one imported token stylesheet), mapped through Tailwind v4 `@theme inline`; no runtime utility-class construction for arbitrary Event hex values. Semantic variables must reference foundation values. Component styles consume semantics, never Event configuration directly. Scope Event overrides to Event layout. Operations, portal and workspace maintain platform controls.

| Proposed semantic token | Light baseline | Purpose/rationale |
|---|---|---|
| `--surface-page` | `#F7F8FA` | Subtle distinction from raised content without shadow dependence |
| `--surface-panel` | `#FFFFFF` | Forms, ticket QR plate, detail surfaces |
| `--text-primary` | `#17212B` | High contrast body text |
| `--text-secondary` | `#475569` | Metadata still intended to be readable |
| `--border-default` | `#CBD5E1` | Visible grouping; not automatically sufficient as control outline on every surface |
| `--action-primary` | `#0F766E` | Restrained teal default; white label contrast must be checked in every state |
| `--action-hover` | `#115E59` | Darker feedback without size change |
| `--focus-ring` | `#1D4ED8` | Separate from success and event color |
| `--success-text/bg` | `#166534 / #F0FDF4` | Admitted/confirmed with explicit text and icon |
| `--warning-text/bg` | `#854D0E / #FEFCE8` | Queued/review states, not implicit success |
| `--danger-text/bg` | `#991B1B / #FEF2F2` | Denied/error with a concrete reason |
| `--info-text/bg` | `#1E40AF / #EFF6FF` | Neutral informational feedback |

These are implementation starting values, not a completed contrast certification. Verify WCAG ratios for foreground/background, outlines, charts, disabled and hover states. Brand accent cannot replace semantic status colors. Disabled controls retain visible labels and adjacent reason, not low-opacity mystery.

**Light/dark:** light-first release. Do not add a global toggle until all roles, charts, QR and branded pages are tested. Optional later dark workspace palette uses `#0F172A` page, `#172033` panels, `#F8FAFC` primary and `#CBD5E1` secondary text with separately certified actions. QR always sits on opaque white with dark modules; never invert it. Scanner day/night preference must not change outcome recognition.

## Typography

Use self-hosted, license-checked Inter variable Latin and Vazirmatn Persian if approved; otherwise system stack first. Review official font sources [Inter](https://rsms.me/inter/) and [Vazirmatn](https://github.com/rastikerdar/vazirmatn). Font choice is a recommendation; assets not installed. Subset without losing Persian shaping. Avoid loading Event fonts into management tools.

| Role | Size / line-height | Weight | Use |
|---|---|---|---|
| Metadata | 13–14 / 20px | 400–500 | Supplementary details, not primary operational results |
| Body/control | 16 / 24px | 400–500 | Includes all mobile inputs |
| Compact table | 14 / 20px | 400–500 | Desktop only; 16px form controls remain |
| Section | 20 / 28px | 600 | Form group, attendee section |
| Page title | 28 / 36px | 600 | Workspace/portal, reduce to 24px at 360 |
| Event display | fluid 32–56 / 1.12 | 600–700 | Two or three lines, bounded width |
| Marketing display | fluid 36–64 / 1.08 | 600–700 | Only public hero |
| Scanner result | 28–40 / 1.2 | 700 | Outcome recognition from a distance |

Use tabular numeric glyphs for analytics; no forced Latin letter-spacing on Persian. Paragraph width 60–72 Latin characters, evaluate Persian independently. User content must wrap; do not uppercase people's names.

## Spacing, grid and surfaces

4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96. Four is icon/label detail; 8–12 groups related fields; 24–32 separates tasks; 48+ is public page rhythm, not every dashboard card. Public content max 1200px, reading max 720px; portal max 960px; workspace flexible with approximately 240px rail and bounded forms 720px. Operations uses viewport and task zones, not public max-width.

Page gutters 16px at 360/390, 24px from 768, 32px from 1024, 40px from 1440. Use content-driven grid minimums; breakpoints 640/768/1024/1280 support layout changes, not device detection. Form labels never rely on placeholder.

Radius: 6px small controls, 8px normal controls/table containers, 12px cards/dialogs. Fully rounded only avatars and concise status pills. 1px borders; avoid stacked box-within-box framing. Elevation 0 for cards, a small shadow for sticky bars and restrained overlay shadow for dialogs/popovers. No glass surfaces behind actionable text.

## Responsive contract

| Width | Public/Event | Attendee | Workspace | Operations |
|---|---|---|---|---|
| 360 | single column, wrapped facts, reservation action below facts | ticket first, visible bottom Tickets/Network navigation | summary rows and detail sheets; no squeeze-to-fit tables | big result/manual entry; camera and queue remain discoverable |
| 390 | same, optional accessible Booth ribbon | safe-area-aware bottom nav; QR fits without clipping | filter sheet and prioritised row fields | 44–48px controls, no sidebar |
| 768 | optional two-column cards | pass/content split when readable | compact nav; tables only if column minimums fit | result beside input if usable |
| 1024 | Event content/reservation split | bounded portal | persistent rail; form groups/tables | desk search/issuance split |
| 1440 | max-width content; no endless hero whitespace | bounded readable content | rail + wide data region, sensible column caps | wide task lanes, not oversized decorative KPIs |

Ribbons are for optional discovery, never a required registration step. Provide visible next/previous controls and keyboard access; no auto-advancing carousel. Tables can have a labeled horizontal-scroll region if comparison truly needs all columns; mobile Lead/Connection browsing uses summary rows opening full detail. Sticky CTAs must not cover focused elements or browser/OS safe areas.

## Localization and RTL

Keep English default. Introduce message keys by feature; use an established i18n library only when actual locales are delivered. Avoid concatenated translated phrases; use plural/select-aware messages. Set document `lang`/`dir` from user locale; use logical margins/padding/inset and layout order, not blanket `row-reverse`.

- `bdi`/`dir="auto"` for names and user notes; isolate QR payloads, IDs, API keys, email, URL and phone as LTR where needed.
- Persian uses shaped font and native punctuation; choose Persian display digits via locale preference, keep machine/API payloads unchanged. Inputs accept expected digit forms with normalization only at a validated boundary.
- `Intl.NumberFormat`, `Intl.DateTimeFormat`, explicit Event timezone. Never infer Event time from viewer device. Persian calendar is optional display formatting, not a silent conversion of backend timestamps. Gregorian remains canonical unless API contract changes.
- Mirror chevrons/back arrows and drawer side with reading direction, not QR, camera, checkmarks, download icon or media controls. Keep numeric column alignment internally consistent.
- Test long translations, two-line labels, mixed Persian/Latin company names, notes, totals, and table keyboard order at 360 and 1440. No Persian translation rollout implied by this plan.

## Component inventory and disposition

Current repo has page-level UI rather than a shared component directory. Proposed names below are new design contracts, not existing exported symbols. Preserve domain behavior while moving visual ownership.

| Category | Disposition | Specification |
|---|---|---|
| Buttons/icon buttons | Extract/refactor | primary/secondary/quiet/destructive; 44px touch target; explicit async label; no double submission |
| Inputs/selects/textareas | Extract/refactor native | persistent label, hint/error IDs, native select first, mobile 16px inputs |
| Search | Extract | clear/reset, labeled query, loading/no-match distinction; debounce only where API semantics allow |
| Form validation | Refactor | inline errors + focusable summary; preserve server detail; no toast-only errors |
| Dialogs/drawers | Replace overlay mechanics with vetted primitive | accessible name, focus trap/restore, Escape, background inert, scroll locking; mobile full-height sheet |
| Tabs | Extract where needed | keyboard pattern and associated panels; links when navigating routes |
| Cards | Extract small composition | ticket/person/Booth content; avoid universal card full of optional props |
| Status badges | Extract | text+icon; status meaning never color alone |
| Tables | Refactor native first | caption/headers, scoped rows; responsive summary companion; add table library only for demonstrated sorting/filter/pagination complexity |
| Pagination | Build only if data contract supports | truthful page/total; no client page count invented for partial server data |
| Filters | Extract composed native fields | applied count, reset, removable chips; mobile sheet with Apply/Cancel semantics |
| Tooltips | Accessible primitive if needed | supplementary only; not sole label or explanation; no touch-only dependency |
| Popovers | Accessible primitive if needed | anchored focus/close rules; use native select when adequate |
| Notifications | Extract | polite success; persistent inline actionable failures; deduplicate scanner announcements |
| Empty/loading/error | Extract compositions | task-specific copy/retry; skeleton only for known structure; no fabricated KPI zero on failed load |
| Navigation/page header/breadcrumbs | Build shared role layouts | active route/current scope, skip link, real destinations; retain route URLs |
| KPI cards/charts | Refactor existing | actual measure/time window/unit; accessible tabular alternative; zero distinguished from unavailable |
| QR presentation/ticket card | Extract, preserve react-qr-code | original payload/quiet zone, white plate, contextual identity, privacy-aware fallback |
| Scanner states | Refactor view only | explicit ready/scanning/admitted/rejected/queued/sync-error; preserve engine/storage |
| Profile/Connection card | Extract | only permitted fields; private note not profile data; export permission-aware |
| Lead card/detail | Refactor/extract | qualification and notes drawer; scan does not fabricate admission |

## Interaction/accessibility contract

WCAG 2.2 AA target; see [W3C standard](https://www.w3.org/TR/WCAG22/). Text 4.5:1 normal/3:1 large, non-text controls and meaningful graphics 3:1. Prefer 44px touch targets (WCAG 2.2 minimum target-size rule is 24 CSS px with exceptions, not universally 44). Visible 2px focus outline plus offset; account for focus not obscured by sticky elements. Semantic landmarks/one page h1; skip link; all actions keyboard-reachable. Screen-reader announcements communicate resulting state, not camera frames.

Motion: 120–180ms opacity/short-distance transitions, none needed for scanner outcomes. Honor `prefers-reduced-motion`; no animated page entrances required. Audio optional with visible mute state; never the only result cue.

| State | Required display/action |
|---|---|
| Loading | task name; disable only duplicate action; distinguish boot from refresh |
| Success | concrete result and next action; keep QR/captured record accessible |
| Failure | reason when safe, retry/back; retain form input |
| Empty | explain absent records and valid next action; no fake examples |
| Invalid QR | rejected input, retry/manual fallback; avoid leaking raw payload |
| Duplicate check-in | explicit duplicate and policy-dependent admission truth; not generic green |
| Permission denied | no restricted record content; role/context explanation without bypass |
| Offline | network and cached-data age, capabilities/limitations; not "everything saved" |
| Sync pending | queued count and provisional local outcome clearly separated |
| Sync error | pending/rejected counts, inspect/retry; retain durable records |
| Capacity reached | unavailable tier/event and supported alternatives; never promise waitlist |
| Unauthorized/expired | explain sign-in/credential recovery, retain safe intended destination; do not expose cached private data |

## Design-system acceptance

One component/state gallery or isolated preview route can be introduced during implementation, not now. Test keyboard, zoom 200%/400% reflow, reduced motion, high contrast, RTL mixed-script and screen readers. QR quiet zone and scanability must be tested with real camera/HID hardware. Publish certified token combinations; do not claim this document itself proves accessibility.
