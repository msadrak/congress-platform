# 06 — Page blueprints and end-to-end journeys

Status: **research-only specification for future implementation**, not production changes or proof of acceptance. Direction: [04 — Design directions](04-DESIGN-DIRECTIONS.md); tokens, component contracts and responsive foundations: [05 — Design system](05-DESIGN-SYSTEM.md). Source baseline is the 11 routes in `web/src/main.tsx:22–34` and the source audit in [01 — Current UI audit](01-CURRENT-UI-AUDIT.md). Research date: 2026-10-10.

## Reading this specification

Each route below has the same **17 required fields**. “Required implementation tasks” are a future work package, not changes made by this document. Acceptance criteria describe observable future behavior and have **not** been exercised. Routes and existing API contracts stay stable unless an explicitly labelled contract/security task changes them.

**Phase 0 evidence boundary:** all 11 current routes were rendered with populated synthetic data at 1440×960 and 390×844 CSS pixels; route-by-route captures are linked in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md) and saved under `phase0-evidence/`. The initial states fit both viewports; a queued Scanner state overflows at 390px. These captures do not prove full journeys, accessibility conformance, physical camera/HID behavior or a native Flutter runtime. This current evidence supersedes the older shell-only/unavailable-backend paragraph below. The 360/768/1024 views remain untested.

**Scope truth:** tickets are free; there is no event directory, schedule, payment flow, true current occupancy, or Event/resource edit/delete functionality. Branding assets/colors need an Event API/model contract. Peer and exhibitor “scan” inputs currently accept manually entered QR secrets; camera/HID capture on those routes is future work. Gate Scanner does have browser camera/HID source. Email-consent preferences do not exist; peer email is currently returned and exported unconditionally. Never add a decorative control that implies these missing capabilities already work.

### Shared foundations

- Apply Direction A: refined minimal product shell, Event-scoped editorial composition, dense staff workspaces, dedicated operational task zones. Use semantic tokens from 05, not route-specific palettes; event accent never controls admitted/rejected colors.
- All route grids inherit gutters **360/390: 16px; 768: 24px; 1024: 32px; 1440: 40px**. Public max width 1200px, reading/form max 720px, attendee/exhibitor portal max 960px; staff grids may expand behind an approximately 240px rail. Inputs remain 16px; touch targets aim for 44px or more. Mobile rule sets are mandatory at both 360 and 390, not a single generic “mobile” screenshot.
- Preserve raw Entity QR payloads, 128-bit secrets, white QR plate/quiet zone, ownership, organizer foreign-tenant 404 and unauthorized booth staff 403. User-visible URLs may link to existing routes; do not silently change ticket QR to a URL.
- Preserve durable browser scan queues and client-generated `scan_id` UUIDs through retries. Queued local admission is provisional; synchronization does not mean every server result is admitted. Lead duplicate capture remains an update to the same booth/ticket record, not another admission or another lead.
- References are adaptation sources, **not** claims that private dashboards were inspected: [Luma](https://lu.ma/), [Eventee](https://eventee.com/), [Config](https://config.figma.com/), [Swapcard](https://www.swapcard.com/), [Accelevents](https://www.accelevents.com/), [Cvent](https://www.cvent.com/), [pretix](https://docs.pretix.eu/). Detailed evidence types belong in 02. Borrow task hierarchy, not branding or unimplemented competitor features.

## 1. `/` — Platform home

1. **Page objective:** explain the real congress product and route users to a valid task without masquerading as an event directory.
2. **Target user role:** first-time visitor, returning Attendee, Organizer, or Exhibitor seeking an entry point.
3. **Primary user journey:** A begins with a known shared Event link; F begins with organizer access. Home clarifies those entry paths rather than supplying nonexistent event discovery data.
4. **Information architecture:** product identity → concise supported capabilities → role entry choices → operational/offline caveat → footer. Keep public marketing separate from authenticated workspace navigation.
5. **Suggested layout:** bounded text-led hero with one organizer action, supporting attendee access guidance, and three factual capability groups. No invented customer logos, testimonial quotes, event tiles or metrics.
6. **Section-by-section structure:** header/logo; hero (“Free event registration and on-site operations”); attendee guidance (“Open your event’s registration link”); free ticket/gate/booth capability summaries; organizer access section; legal/help links only when destinations exist.
7. **Major components:** PublicShell, PageHeader, primary/secondary buttons, factual FeatureGroup, role entry panel, inline unavailable-entry explanation. These are proposed extractions, not existing exports.
8. **Main CTA:** “Organizer workspace” → `/organizer`.
9. **Secondary actions:** “My tickets” → `/my-tickets`; “My network” → `/my-network`; explain that Exhibitor access requires an assigned Booth URL. Neutral attendee sign-in is a planned shared auth interaction, not a currently working destination at `/`.
10. **Interaction behavior:** standard real links; no disabled “Browse events” substitute. Proposed shared sign-in returns to the intended existing route after success. Do not promise password recovery until an endpoint exists.
11. **Responsive changes:** **360:** single hero/action stack and wrapped role links; **390:** identical structure with breathing space, no clipped heading; **768:** three capability columns only if labels fit, role entry below; **1024:** text/supporting visual split without fake dashboard data; **1440:** 1200px centered shell and controlled hero width, not full-screen empty marketing space.
12. **Loading/empty/error states:** static page has no remote-data skeleton. Auth has pending/invalid-credentials/network states if introduced. Unavailable directory copy: “Use the registration link provided by your event organizer”; never an empty-event-list illusion.
13. **Accessibility requirements:** one h1, skip link, meaningful link text, keyboard order matching reading order, visible focus and WCAG AA tokens. Images are optional; meaningful images need alt text and decorative ones empty alt.
14. **Relevant reference sites:** Luma’s clear first-action hierarchy; Config’s restrained event storytelling. Do not adopt either’s discovery inventory or program sections.
15. **Existing files/components impacted:** `web/src/pages/Home.tsx:3–48`, `web/src/main.tsx`, `web/src/index.css`; proposed shared auth would reuse `web/src/api/client.ts` and `backend/app/routes/auth.py`, not create a new identity scheme.
16. **Required implementation tasks:** replace unsupported browse/sign-in implications; extract PublicShell and entry guidance; wire existing attendee routes; add accessible shared auth only under the auth work package; do not add directory APIs as part of skinning.
17. **Acceptance criteria:** all visible navigation has a real destination; at each target width no horizontal page overflow or hidden primary action; no event catalog/schedule/payment claims; unauthenticated ticket entry clearly requests authentication; failed sign-in retains safe destination without private content.

## 2. `/e/:slug` — Public Event and free reservation

1. **Page objective:** let an Attendee understand an Event and reserve one free ticket through the existing authenticated reservation contract.
2. **Target user role:** prospective or returning Attendee.
3. **Primary user journey:** A: known Event link → facts → tier → register/login → reserve → confirmation → `/my-tickets`.
4. **Information architecture:** Event identity/facts → description → free tier options → reservation status → optional authenticated ticket destination. No fabricated agenda, speakers, venue maps or directory breadcrumb.
5. **Suggested layout:** editorial Event facts beside a bounded reservation panel at desktop; facts and reservation stack at mobile. Current name/description/dates/location can support hierarchy without an image. Future cover/logo/accent requires branding persistence.
6. **Section-by-section structure:** product header and ticket link; Event title; date range/location; readable description; free tier list with labels and actual quota limitations; auth/reservation dialog; success confirmation with ticket action. Confirmation remains tied to server success, not merely successful login.
7. **Major components:** EventHeader, EventFacts, FreeTierOption, ReservationPanel, AuthDialog, inline errors, status feedback; preserve the existing reservation transaction rather than split into fake checkout steps.
8. **Main CTA:** “Reserve free ticket” for the selected available tier.
9. **Secondary actions:** “Sign in”/“Create account” within shared auth; “View my tickets” for a known reservation; close/cancel without losing selected tier. No waitlist or payment buttons.
10. **Interaction behavior:** anonymous selection opens auth; successful auth continues the selected reservation exactly once; pending action prevents duplicate submission; server capacity/duplicate-event responses remain authoritative. Total quota is not remaining stock: current output omits `reserved_count`, so never show “N remaining” from quota alone.
11. **Responsive changes:** **360:** title/facts first, stacked tier cards, full-width action and full-height auth sheet; **390:** same, safe-area-aware action with focused controls unobscured; **768:** facts/description remain readable, optional two-column tiers but auth remains bounded; **1024:** content and 320–360px reservation column, sticky only if it fits viewport; **1440:** 1200px shell, capped reading width and reservation panel, optional future artwork without pushing facts below the fold.
12. **Loading/empty/error states:** Event/tier skeleton distinguishes loading from no tiers; missing Event has safe not-found/back guidance; unavailable tiers explain reservation closed/full according to actual server data; auth errors retain fields except password as appropriate; network failure retains selection; duplicate reservation offers ticket access. No false zero stock on failed fetch.
13. **Accessibility requirements:** radiogroup or equivalent clear selected tier semantics; programmatic labels; dialog focus management described below; error summary/field associations; no branding contrast override; localized dates must not invent Event timezone metadata absent from the API.
14. **Relevant reference sites:** Luma registration hierarchy and Eventee attendee framing; Config for optional editorial artwork, not speaker/schedule scope.
15. **Existing files/components impacted:** `web/src/pages/PublicEvent.tsx:33–145,182–296,303–452`, `web/src/api/client.ts`, `backend/app/routes/public.py`, `backend/app/routes/auth.py`, `backend/app/routes/tickets.py:51–122`, `backend/app/routes/ticket_tiers.py:18–26`, `backend/app/routes/events.py:24–52` for future branding.
16. **Required implementation tasks:** restructure facts/reservation; extract accessible auth/dialog controls; retain post-auth reserve sequencing; implement confirmation state; replace remaining-stock implications; branding is a separately estimated API/model/storage task, not a CSS-only setting.
17. **Acceptance criteria:** unauthenticated and authenticated users can complete A using actual server success; reservation retry does not create a second active user/Event ticket; capacity failure never displays a confirmed pass; all five widths retain facts/tier/action visibility; no image/theme or inventory state is assumed present; missing slug does not expose organizer data.

## 3. `/e/:slug/booths/:boothId` — Public Booth profile

1. **Page objective:** show a Booth’s permitted public company information and let an authenticated Attendee save it.
2. **Target user role:** Attendee browsing a known Booth link; anonymous visitor may read public information.
3. **Primary user journey:** open known Booth URL → read company/location/description → visit supplied resource or sign in and bookmark → later retrieve from My Tickets. Raw standee-secret navigation is blocked by the missing resolver.
4. **Information architecture:** Event context → Booth/company identity → location → description → website/brochure → save state.
5. **Suggested layout:** calm profile composition with a single resource/action column; optional future Event branding remains public-scope only. No lead dashboard fields or private staff notes.
6. **Section-by-section structure:** back-to-Event link; company heading; Booth location; description; website/brochure links; bookmark call-to-action; concise auth prompt with actual action, not “sign in” text alone.
7. **Major components:** PublicShell, BoothProfile, resource links, bookmark toggle, shared AuthDialog, pending/status region.
8. **Main CTA:** “Save booth” / “Remove from saved booths,” based on authoritative bookmark state.
9. **Secondary actions:** return to Event, visit supplied website, open/download supplied brochure, My Tickets saved-booth section. No fake messaging, meetings or map destination.
10. **Interaction behavior:** anonymous save launches planned auth and resumes intended save; POST/DELETE retain current user scope; failures restore truthful state rather than leaving optimistic success. Public profile still works without authentication. External links declare new-window behavior if used.
11. **Responsive changes:** **360:** one column, wrapped URLs and full-width save; **390:** same with safe-area clearance; **768:** profile/resources split only if descriptive content stays readable; **1024:** bounded content/action split; **1440:** max 960–1200px public layout, no oversized empty logo placeholders.
12. **Loading/empty/error states:** skeleton only for known profile fields; absent optional description/resources simply omitted with no broken buttons; wrong slug/Booth association returns not-found; save failure preserves previous state; expired token requests auth without exposing private records.
13. **Accessibility requirements:** resource names indicate purpose and file type when known; save toggle state announced; icon actions labelled; company/user content wraps and supports mixed scripts; dialogs keyboard accessible.
14. **Relevant reference sites:** Eventee attendee exposition and Swapcard’s role distinction; use public-profile concepts, not unobserved private interface claims.
15. **Existing files/components impacted:** `web/src/pages/PublicBooth.tsx:24–84,118–230`, `backend/app/routes/public.py:79–111`, `backend/app/routes/booths.py:332–424`, `web/src/api/client.ts`; standee origin is `web/src/pages/OrganizerEventDetail.tsx:546–584`.
16. **Required implementation tasks:** extract profile/resources and bookmark state; provide neutral auth continuation; fix standee navigation only after a deliberate resolver-or-public-URL contract decision; keep attendee raw ticket QR unchanged.
17. **Acceptance criteria:** public reads need no JWT; bookmarks belong only to the current User; wrong Event/Booth pair does not reveal another Booth profile; anonymous save has an actionable auth path; all widths wrap long company names/URLs; no claim that existing raw Booth secret opens this route until the resolver/payload work is delivered.

## 4. `/my-tickets` — Personal passes and saved Booths

1. **Page objective:** make the Attendee’s scannable pass quickly accessible, with honest offline/privacy state and secondary saved Booth access.
2. **Target user role:** authenticated Attendee and returning owner of a locally cached pass.
3. **Primary user journey:** A confirmation → ticket list → open/show QR → admit through B; saved Booth retrieval is a secondary personal task.
4. **Information architecture:** attendee navigation → auth/cache/network state → Event ticket cards → saved Booths → logout. Ticket identity and QR outrank navigation decoration or KPIs.
5. **Suggested layout:** bounded pass-first portal. Mobile shows one full readable pass at a time; desktop can split pass and related personal content without scaling QR down to a thumbnail.
6. **Section-by-section structure:** title and Tickets/Network links; offline/cache-age banner; Event/name/tier/status; opaque white QR plate; human-readable attendee context; saved Booth list; explicit logout action. Do not label cache as a downloaded file.
7. **Major components:** AttendeeShell, TicketCard, QRPresentation using `react-qr-code`, CacheStateBanner, SavedBoothRow, auth gate and empty composition.
8. **Main CTA:** “Show ticket” / reveal the ticket QR; the pass itself is the operational destination.
9. **Secondary actions:** view Event, saved Booth profile, My Network, logout. A real file/download feature is future work; current cache should say “Available on this device after loading,” not “Downloaded.”
10. **Interaction behavior:** cache-first behavior must be kept with explicit device privacy rules. Current cache can render without a token; a future owner/device-bound offline unlock decision must precede claiming secure cache access. Online refresh retains the pass while marking stale data. Logout clears token and ticket cache as currently implemented; further purge behavior must not delete unrelated scanner queues.
11. **Responsive changes:** **360:** ticket-first one column, QR fits 328px content width including padding/quiet zone, visible bottom Tickets/Network nav; **390:** same with safe-area spacing; **768:** pass and saved content split only with a genuinely scannable QR; **1024:** 960px portal with bounded cards; **1440:** same bound rather than stretching QR/pass across the screen.
12. **Loading/empty/error states:** cached pass shown as cached while refreshing; no-cache loading explicit; no tickets gives known-Event-link guidance rather than “Browse events”; offline distinguishes cached tickets from uncached bookmarks; unauthorized state does not silently show another account’s cache; refresh error is persistent but does not erase a permitted cached pass.
13. **Accessibility requirements:** QR has contextual accessible description without exposing secret in alt text; human context supplements but does not claim to replace scanner verification; no inverted QR; focus not hidden under bottom nav; screen-reader status avoids repeatedly announcing QR refresh.
14. **Relevant reference sites:** Eventee attendee-first hierarchy and pretix ticket/entry operational concepts; no claim of an implemented wallet integration.
15. **Existing files/components impacted:** `web/src/pages/MyTickets.tsx:14–90,114–333`, `web/src/api/client.ts`, `backend/app/routes/tickets.py`, `backend/app/routes/booths.py` for bookmarks; token/cache storage currently lives in localStorage, not a new PWA storage layer.
16. **Required implementation tasks:** extract pass/cache/saved-Booth UI; fix unsupported browse/download copy; define cache ownership, expiry and shared-device privacy contract before auth changes; preserve QR secret and existing logout purge; do not add service-worker claims without offline-shell implementation.
17. **Acceptance criteria:** QR remains unchanged and scanable on real hardware at 360/390 and desktop; owner’s previously loaded pass can be accessed under the approved offline-device contract; account switching cannot expose another owner’s cache; offline bookmarks are labelled unavailable if uncached; expired/network states never claim refreshed ticket truth; logout clears attendee credentials/pass cache without losing an operations queue.

## 5. `/my-network` — Connections and private notes

1. **Page objective:** maintain professional Connections, private notes and vCard export while representing contact permissions honestly.
2. **Target user role:** authenticated Attendee.
3. **Primary user journey:** E: manual peer QR-secret input → connection → permitted profile/contact → private notes → vCard. Camera capture and opt-in email are future contract work, not current features.
4. **Information architecture:** attendee nav → connection action → connection list → personal note/detail → contact export. Own notes must be visually distinct from the peer’s professional profile.
5. **Suggested layout:** readable person rows/cards at mobile; list/detail or compact grid at desktop, not analytics cards. Manual input belongs in a task-specific dialog.
6. **Section-by-section structure:** heading/action; current count only from loaded records; empty/list state; name/organization/title; permitted contact section; private note editor; vCard action; manual connection dialog labelled “Enter badge code.”
7. **Major components:** AttendeeShell, ConnectionRow, permission-aware ProfileContact, PrivateNoteEditor, manual QR dialog, export status feedback.
8. **Main CTA:** “Add connection” opening manual input, not “Open camera.”
9. **Secondary actions:** edit/save private note, export vCard, switch to Tickets. Do not add reciprocal connection or contact-sharing toggles without backend contracts.
10. **Interaction behavior:** submit raw secret through existing connection endpoint; duplicate scan updates existing relation according to backend semantics. Current relation is one-way scanner→peer; do not say “You are now mutually connected.” Email currently always appears/exports; a consent fix must gate both API responses and vCard, not merely hide a field in JSX.
11. **Responsive changes:** **360:** summary rows and full-height input/detail sheets with 16px fields; **390:** same, long names/emails wrap; **768:** two-column cards or readable list/detail, no squeezed table; **1024:** bounded list/detail workspace with notes visible; **1440:** 960px portal/readable notes, not four tiny contact columns.
12. **Loading/empty/error states:** loading differs from no connections; empty explains manual badge entry; invalid/wrong-event/self/duplicate responses follow actual endpoint detail; note failure preserves unsaved draft; export/network/auth error explicit; no offline write promise because a durable Connection queue does not exist.
13. **Accessibility requirements:** private note has persistent label and save state; dialogs meet shared focus contract; download gives meaningful file/action name; disclosure uses text rather than lock icon alone; prevent raw secret being echoed into public alerts.
14. **Relevant reference sites:** Eventee networking framing; Swapcard professional contact organization. Opt-in design derives from product policy, not competitor feature imitation.
15. **Existing files/components impacted:** `web/src/pages/MyNetwork.tsx:33–123,176–388`, `backend/app/routes/network.py:24–35,78–120,125–235`, `backend/app/models.py:75–84`, `web/src/api/client.ts`; no current consent field exists.
16. **Required implementation tasks:** truthfully rename manual input; extract notes/detail/export; implement accessible dialog; resolve peer consent as API/model/response/export work before claiming privacy; camera permission/decoder/lifecycle is a separately scoped capture feature.
17. **Acceptance criteria:** E can finish with manual input without a camera claim; duplicate does not create another Connection; edits affect only caller-owned notes; denied email never appears in response/UI/vCard once consent work ships; before then documentation/UI must not claim opt-in protection; one-way behavior is accurately worded; each width preserves note and export actions.

## 6. `/scan/:pointId` — Gate Scanner

1. **Page objective:** run fast admission evaluation with unmistakable local outcome, durable capture and server reconciliation.
2. **Target user role:** authorized admission staff on a dedicated device; **current endpoints do not enforce that authorization**.
3. **Primary user journey:** B: open known point → establish device/point/cache state → camera/HID/manual capture → local evaluation → result → persist → synchronize/reconcile.
4. **Information architecture:** readiness/point identity → capture mode → large result → network/cache age → pending/sync state → bounded recent audit. Queue and admission are distinct concepts.
5. **Suggested layout:** full-screen operational zones without public or management chrome; platform semantic outcomes, not Event palette. Keep camera preview subordinate to outcome and point identity.
6. **Section-by-section structure:** point/Event/policy header; readiness and cache freshness; camera/HID/manual mode controls; large named outcome/reason; pending count and sync feedback; recent locally evaluated/reconciled records; mute and camera controls.
7. **Major components:** ScannerStatusHeader, CapturePanel, ScannerResult, QueueStatus, RecentScanFeed; retain `scannerEngine.ts`/`scannerStorage.ts` behavior rather than rewrite the engine as a UI refactor.
8. **Main CTA:** “Start scanning” after a usable manifest; manual “Evaluate code” fallback.
9. **Secondary actions:** start/stop camera, mute, refresh permitted manifest, retry sync, inspect pending/reconciled results. A proposed leave prompt must never wipe durable records.
10. **Interaction behavior:** BarcodeDetector camera or HID passes the same secret to local policy evaluation; persist UUID-keyed record before treating capture as durable; offline locally evaluated result says “Queued · local result”; same UUID retries reconcile per-record server truth. Current page marks the whole response batch synced without applying per-result status, so reconciliation is a release blocker, not cosmetic wording. Lifecycle cleanup must stop camera decoding/streams on stop/unmount.
11. **Responsive changes:** **360:** readiness, large outcome, input and queue remain visible; camera below/within bounded task area, no sidebar; **390:** 44–48px controls with safe-area spacing; **768:** result and capture side-by-side if neither becomes small, queue below; **1024:** dedicated capture/result lanes and audit column; **1440:** wide but capped task lanes with readable distant outcome, no oversized KPI decoration.
12. **Loading/empty/error states:** no manifest means “Not ready,” not green; cached manifest + offline states its age; denied auth blocks manifest; unsupported/denied camera offers HID/manual; invalid QR and duplicate explicitly named; capacity uncertainty visible; sync error retains queue and UUIDs; server disagreement remains visible with authoritative reason; no cached manifest cannot scan offline.
13. **Accessibility requirements:** text/icon/color for every outcome; optional audio with visible mute; deduplicated live announcements, not frame announcements; full keyboard HID/manual flow; outcome colors pass contrast in day/night; no raw secrets/emails in the visible audit. Real camera/HID usability and scanability must be validated later.
14. **Relevant reference sites:** pretix entry-device documentation and Cvent operational framing, not imitation of uninspected admission dashboards.
15. **Existing files/components impacted:** `web/src/pages/GateScanner.tsx:60–237,241–335,382–608`, `web/src/lib/scannerEngine.ts`, `web/src/lib/scannerStorage.ts`, `backend/app/routes/checkin.py:113–355`, `web/src/api/client.ts`; separate native-parity work affects `mobile/lib/services/api_service.dart`, `mobile/lib/services/storage_service.dart`, `mobile/lib/services/policy_engine.dart`, `mobile/lib/services/sync_service.dart`, `mobile/lib/screens/login_point_select_screen.dart`, `mobile/lib/screens/camera_scanner_screen.dart`, `mobile/lib/main.dart` and `mobile/pubspec.yaml`.
16. **Required implementation tasks:** preserve the now-enforced point-scoped Scanner JWT/owning-Organizer authorization and no-email manifest. Separate contract blockers are cross-scope replay (#20) and device-token issuance/list/revoke/client integration (#18); **correctness blockers:** per-record reconciliation and truthful capacity semantics (#15/#17); **UI work:** task zones/states/accessibility; **feature work:** installable/offline-bootable PWA and durable native camera/persistence, if approved. Do not blend these categories or claim UI completes them.
17. **Acceptance criteria:** unauthenticated and wrong-role callers remain denied; a valid foreign point token cannot expose another point/Event’s result through a reused UUID; same-scope retries remain idempotent; failed sync/reload retains unsynced IDs; each response reconciles the matching UUID; local capped admission never claims globally verified capacity; stop/unmount releases camera; all five widths allow rapid capture/outcome/queue reading without color or audio alone.

## 7. `/booth/:boothId` — Exhibitor lead workspace

1. **Page objective:** assigned BoothStaff capture leads, qualify them and export only their Booth’s data.
2. **Target user role:** authenticated User with the current BoothStaff membership, not every Attendee.
3. **Primary user journey:** D: authorized Booth → manual badge-secret entry → returned lead/profile → qualification → private Booth notes/tags → filtered browsing → CSV.
4. **Information architecture:** Booth scope → capture task → latest lead/result → search/rating filters → lead list → qualification detail → export.
5. **Suggested layout:** dense but readable staff workspace, with an operational capture lane and summary-row/detail composition. Platform theme, not public Event hero treatment.
6. **Section-by-section structure:** company/Booth header; auth/assignment state; clearly labelled manual code form; capture result; filters; lead rows; qualification drawer/dialog with rating/tags/notes; CSV/export status.
7. **Major components:** StaffScopeHeader, ManualLeadInput, LeadRow, QualificationDialog/Drawer, RatingControl, TagInput, FilterBar, export feedback.
8. **Main CTA:** “Capture lead” through manual badge-code input.
9. **Secondary actions:** search, rating filter/reset, open qualification, save notes/tags/rating, export CSV. Sign-in must open an actual auth interaction, not link to `/` with a fictitious login expectation.
10. **Interaction behavior:** existing capture updates the Booth/ticket lead on duplicate; qualification saves only authorized Booth records; preserve filters after saving. Current email disclosure is returned per exhibitor contract—do not claim an absent attendee consent mechanism. CSV must check HTTP success/content before download, not save an error blob as a spreadsheet. Camera/HID capture is future work.
11. **Responsive changes:** **360:** capture first, filters in labelled sheet, summary rows and full-height qualification sheet; **390:** same with safe-area clearance and wrapped tags; **768:** capture/list split and bounded detail drawer when readable; **1024:** scope rail + dense list/capture region, optional detail pane; **1440:** wide workspace with sensible column caps and persistent qualification context, not a huge marketing header.
12. **Loading/empty/error states:** unauthenticated actionable login; assigned/no leads is distinct from forbidden; 403 reveals no lead names/counts; invalid code retains safe form state; capture/qualification errors preserve drafts; no offline-capture promise without durable queue; export denial/network failure never creates a successful file.
13. **Accessibility requirements:** rating has labelled keyboard-operable choices; tags/removal buttons named; private notes clearly described; filter sheet and qualification dialog trap/restore focus; lead row action is a real button/link, not an inaccessible clickable div; export status announced.
14. **Relevant reference sites:** Accelevents/Swapcard official lead-workflow framing and Cvent operational density. No copied private CRM dashboard design is asserted.
15. **Existing files/components impacted:** `web/src/pages/ExhibitorPortal.tsx:56–205,207–220,252–534,537–672`, `backend/app/routes/leads.py:47–78,116–181,277–351`, `backend/app/routes/booths.py:282–318`, `web/src/api/client.ts`.
16. **Required implementation tasks:** manual-input truth, shared auth continuation, mobile summary/detail UI, accessible qualification, robust export response handling; maintain BoothStaff check; future camera and any disclosure-policy change remain separate feature/contracts.
17. **Acceptance criteria:** assigned staff complete D; competitor account still gets 403 without data; duplicate lead preserves one Booth/ticket record and qualification data according to backend semantics; notes/tags/rating persist on actual success; failed CSV produces an error not a misleading download; camera is not advertised as current; all five widths retain capture/filter/qualification actions.

## 8. `/organizer` — Access gate and Event list/create

1. **Page objective:** establish organizer scope and allow selection or creation of an owned Event.
2. **Target user role:** provisioned Organizer with a bearer API key; provisioning remains an admin operation outside this UI.
3. **Primary user journey:** F: enter key → owned Event list → select Event or create → Event workspace.
4. **Information architecture:** credential gate → organizer shell → owned Event list → inline create form → scope/logout. Key entry must not imply the credential was verified merely because it was stored.
5. **Suggested layout:** focused key gate before data; then dense workspace shell with Event rows and a bounded inline create form. No directory exposure or cross-tenant list.
6. **Section-by-section structure:** key explanation/secret field; submitting/validation state; workspace navigation; Event rows with name/dates/location; create form; success/error and clear key/logout action.
7. **Major components:** OrganizerShell, ApiKeyGate, EventRow, inline EventCreateForm, async form feedback. Creation stays inline, not another pseudo-modal.
8. **Main CTA:** gate “Open workspace”; authenticated list “Create event” or choose a row.
9. **Secondary actions:** cancel creation, open known public Event link, clear key/logout. No edit/delete/archive actions because endpoints do not exist.
10. **Interaction behavior:** sessionStorage remains scoped to organizer key; validation comes from an authorized request, not non-empty input. Maintain input on failed create; successful server creation adds/navigates to the actual owned Event. Do not turn a foreign-event 404 into a tenancy hint.
11. **Responsive changes:** **360:** key form single column; Event summary rows and full-width create fields; **390:** same with no key/slug overflow; **768:** compact navigation and two-column form only for short related fields; **1024:** persistent approximately 240px rail and Event rows; **1440:** rail + wide list with bounded create form, no sparse three-card KPI header.
12. **Loading/empty/error states:** unverified/validating key explicit; unauthorized key offers re-entry; list network failure is not empty; no Events prompts creation; validation errors attach to fields; missing/expired key clears protected presentation without showing stale tenant records.
13. **Accessibility requirements:** secret label/help and optional accessible reveal control; Enter submits gate; visible focus; invalid fields/error summary; no API key echoed to notifications; headings distinguish gate from list.
14. **Relevant reference sites:** pretix organizer task grouping and Cvent management framing; apply general principles, not private-dashboard screenshot claims.
15. **Existing files/components impacted:** `web/src/pages/OrganizerLayout.tsx:5–108`, `web/src/pages/OrganizerEvents.tsx:22–79,89–295`, `backend/app/auth.py:12–47`, `backend/app/routes/events.py:24–71`, `backend/app/routes/organizers.py:10–35` (admin provisioning stays excluded), `web/src/api/client.ts`.
16. **Required implementation tasks:** clarify credential verification, extract organizer navigation/scope, restructure Event rows/create form, preserve session key handling and real create/list contracts; do not add account provisioning or edit/delete under redesign.
17. **Acceptance criteria:** a non-empty invalid key never appears authenticated; valid key lists only owned Events; creation failure retains form and no phantom Event; actual creation leads to the correct UUID route; all widths show scoped navigation/actions; session exit removes organizer credential and protected cached UI; no edit/archive/delete controls appear.

## 9. `/organizer/events/:eventId` — Event setup workspace

1. **Page objective:** configure existing free tiers, admission points/policies and Booths/staff while exposing only delivered create/read capabilities.
2. **Target user role:** owning Organizer.
3. **Primary user journey:** F: selected Event → create tiers → points/policies → Booths → staff/standee → Desk/Analytics.
4. **Information architecture:** current Event/scope → section navigation → Tiers → Check-In Points → Booths/Staff → operational links. Keep resource creation near its list; do not add schedule or Event editing tabs.
5. **Suggested layout:** persistent staff rail at desktop; linked section anchors or accessible in-page tabs; dense rows plus bounded inline creation forms. Tabs are in-page panels, Desk/Analytics remain route links.
6. **Section-by-section structure:** Event name/public link; setup summary from real resources; free tier list/create; point list/create with policy-dependent fields; Booth list/create; staff assignment dialog; standee preview/print dialog; Desk/Analytics/scanner links.
7. **Major components:** OrganizerShell, EventScopeHeader, ResourceSection, TierForm, PointPolicyForm, BoothForm, BoothStaffDialog, StandeeDialog, operational route links.
8. **Main CTA:** context-specific “Create tier,” “Create check-in point,” or “Create booth”; avoid one giant unrelated action.
9. **Secondary actions:** open Desk/Analytics, scanner link for point, public Event/Booth link, assign staff, preview/print standee. No edit/delete buttons, invite delivery claims or QR profile-navigation claim until contracts exist.
10. **Interaction behavior:** four current parallel loads can render independent section failures without false zeros. Policy fields depend on actual policy type; SINGLE_USE is permanent per point, separate meal windows use separate points. Staff assignment of a nonexistent User currently creates an unreachable random-password account; say “Assignment recorded” and expose the onboarding limitation, not “Invitation sent.” Standee secret cannot open the public profile without explicit payload/resolver work.
11. **Responsive changes:** **360:** section links and summary rows, vertically stacked create fields, full-height standee/staff sheets; **390:** same with wrapped IDs/locations and safe-area controls; **768:** compact nav and resource rows, two-column related form fields where minimums fit; **1024:** persistent rail with bounded forms/table region; **1440:** wide resource tables and parallel list/form lanes without stacking every task in nested cards.
12. **Loading/empty/error states:** per-section loading/empty/error; unauthorized/foreign Event 404 with no tenant hint; creation error preserves draft; staff assignment failure preserves email; missing raw standee QR cannot render as success; print unsupported/error communicates fallback without asserting saved file.
13. **Accessibility requirements:** tabs/anchors match behavior; native policy selects; conditional fields labelled and described; dialog focus/close contract; QR white plate and print-only composition; ID/secret content isolated LTR without exposing raw QR in accessible public copy.
14. **Relevant reference sites:** pretix policy/resource task organization; Cvent and Accelevents official multi-role operations framing. Eventee schedules are explicitly not an allowed setup section here.
15. **Existing files/components impacted:** `web/src/pages/OrganizerEventDetail.tsx:78–262,288–1000`, `web/src/pages/OrganizerLayout.tsx`, `backend/app/routes/events.py`, `backend/app/routes/ticket_tiers.py`, `backend/app/routes/checkin.py`, `backend/app/routes/booths.py:78–124,176–205`, `backend/app/models.py`, `web/src/api/client.ts`.
16. **Required implementation tasks:** separate dense sections and loading states; accessible staff/standee dialogs; print-only QR layout; accurate policy/onboarding text; preserve OwnedEvent dependency; future real staff invitation/account recovery and standee resolver are explicit feature contracts, not cosmetic patches.
17. **Acceptance criteria:** only owned resources load/create; unsupported edit/delete/schedule controls are absent; each policy’s actual field requirements and semantics are clear; forms retain input on failure; staff success does not claim delivered credentials; standee prints with unchanged intended payload and quiet zone; no QR profile promise before resolver work; all five widths expose each setup section and operational links.

## 10. `/organizer/events/:eventId/desk` — Registration Desk

1. **Page objective:** rapidly find an existing Attendee or register a walk-in and issue a free pass without duplicate/person confusion.
2. **Target user role:** Organizer-authorized registration staff using the organizer key.
3. **Primary user journey:** C: search → resolve existing vs new → issue ticket → show/print QR → next Attendee/admission.
4. **Information architecture:** Event scope → search/resolve → walk-in issue form → issued pass → credentials/history → next action. Search results and admission history are not proof of current occupancy.
5. **Suggested layout:** operational Desk with search and issuance lanes at large widths; mobile shows search first and one task at a time. Keep “Next attendee” prominent only after a successful issue.
6. **Section-by-section structure:** Event/Desk title and back link; debounced labelled search; existing attendee results/details; new attendee name/optional email/professional fields and tier; submission state; minted pass dialog; attendee credential/history dialog; next-attendee reset.
7. **Major components:** DeskScopeHeader, AttendeeSearch, AttendeeSummaryRow, WalkInForm, MintedPassDialog, CredentialHistoryDialog, print layout.
8. **Main CTA:** “Issue free ticket” for a resolved/new Attendee; never imply issuance is admission.
9. **Secondary actions:** search/open existing attendee, show existing credential/history, print pass, next Attendee, return to Event. There is no account claim/password recovery flow for optional-email walk-ins.
10. **Interaction behavior:** preserve current 200ms search debounce and server-owned Event search scope. Operator confirms existing/new identity before minting; show actual server-created QR only. Optional-email placeholder users have unreachable random passwords, so copy says “Desk-issued pass; online account access is not available through this form,” not “Email sent” or “Sign in later.” Print targets the pass rather than the entire operational screen.
11. **Responsive changes:** **360:** search first, summary results, stacked form and full-height QR/details sheets; **390:** same, focused fields clear of keyboard/action bar; **768:** compact search/form split only when both lanes remain usable; **1024:** dedicated search/history and issuance split, persistent task context; **1440:** wide operational lanes with capped form and QR dimensions, no decorative KPIs.
12. **Loading/empty/error states:** search-loading vs no matches; cancellation/stale result handling so prior query does not replace newer results; missing tiers blocks issuance with setup link; invalid/duplicate/capacity errors preserve form; issuance network ambiguity must not immediately manufacture a second ticket; history failure does not imply no Check-Ins.
13. **Accessibility requirements:** labelled search and results, keyboard selection, polite result count; issued-pass dialog announces success once; next action returns focus to the correct search/name field; print has accessible text identity and preserved QR quiet zone; optional email clearly labelled optional.
14. **Relevant reference sites:** Cvent onsite operations framing and pretix registration/entry concepts; no payment or badge designer scope imported.
15. **Existing files/components impacted:** `web/src/pages/OrganizerDesk.tsx:44–156,179–523`, `backend/app/routes/desk.py:84–103` and the route’s search/issue/history handlers, `backend/app/routes/events.py:56–71`, `web/src/pages/OrganizerLayout.tsx`, `web/src/index.css` for print styles.
16. **Required implementation tasks:** search/issue lanes, resolved identity presentation, accessible two dialogs, pass-only print CSS, truthful optional-email access copy; preserve uniqueness and existing issuance contract; account recovery/claim is separate feature work.
17. **Acceptance criteria:** C supports existing and new attendees using real server data; existing Event ticket does not become a second active ticket; failed issuance preserves entered data; optional email does not promise delivered credentials; print shows pass only with scanable QR; next-attendee action clears prior PII and restores focus; foreign organizer cannot search/read/issue; all widths can complete the full desk workflow.

## 11. `/organizer/events/:eventId/analytics` — Event reporting

1. **Page objective:** report actual registration/admission activity with transparent filters, refresh timing and export scope.
2. **Target user role:** owning Organizer/operations manager.
3. **Primary user journey:** F after setup/operation: open Analytics → inspect activity → filter point/tier → compare actual aggregates → export supported report.
4. **Information architecture:** Event/scope → applied filters and update time → factual KPIs → catering/point/hour breakdowns → export. Do not introduce true occupancy or live push claims.
5. **Suggested layout:** dense analytic workspace with modest measure cards, readable chart/table equivalents and a persistent filter toolbar; numbers use tabular glyphs.
6. **Section-by-section structure:** Event/Analytics header; point/tier filters/reset; last refresh/network state; registration/admitted/rejected factual measures; per-point/catering totals; hourly distribution; export action/scope. Any `current_occupancy` value is described as cumulative admissions, because no exit model exists.
7. **Major components:** OrganizerShell, FilterBar/Sheet, MeasureCard, GateBreakdown, HourlyBars plus accessible data table, RefreshStatus, CSV feedback.
8. **Main CTA:** “Apply filters” where explicit application is adopted; reporting itself is the principal task.
9. **Secondary actions:** reset filters, refresh, CSV export, back to Event/Desk. Current CSV ignores active filters; label “Export full event report” until filtered export is actually implemented.
10. **Interaction behavior:** preserve 10-second polling rather than advertise push/live occupancy; refresh retains last successful data with timestamp and stale warning. Current UI exposes point/tier only though backend accepts time bounds; time-range controls are optional explicitly scoped work, not an existing feature. Do not promise occupancy decreases or remaining capacity from cumulative admissions.
11. **Responsive changes:** **360:** filters in accessible sheet, stacked measures, chart with tabular alternative/labelled local scroll if essential; **390:** same with readable numbers and no clipped export; **768:** two-column measures and compact navigation, charts only if labels fit; **1024:** persistent rail, horizontal filters, two-column breakdowns; **1440:** wide capped chart/table region, four measures only when actual data supports them, no oversized whitespace.
12. **Loading/empty/error states:** boot-loading vs refresh; true zero vs unavailable; no points/tiers distinct from filter no-data; failed poll leaves stale labelled previous data, not false zero; unauthorized/foreign Event has no metrics; export failure does not download error content.
13. **Accessibility requirements:** chart alternatives convey values/time windows; no color-only series; filters labelled and selected scope announced; tabular numerals and units; polling should not steal focus or repeat every metric in a live region.
14. **Relevant reference sites:** Cvent reporting and Accelevents official analytics concepts; do not copy occupancy claims or unobserved enterprise dashboards.
15. **Existing files/components impacted:** `web/src/pages/OrganizerAnalytics.tsx:29–101,114–433`, `backend/app/routes/analytics.py:57–66,137–170`, `web/src/pages/OrganizerLayout.tsx`, `web/src/api/client.ts`.
16. **Required implementation tasks:** unify filters/refresh/error scope, rename cumulative occupancy copy, provide accessible data alternatives, label existing full-event export; filtered export or time-range UI is a separate API/UI task if chosen. True occupancy requires entry/exit/presence modeling, not chart styling.
17. **Acceptance criteria:** metrics show source-backed meaning and refresh timestamp; failed refresh never invents zeros; active point/tier filters match the fetched report; CSV scope is explicit and accurate; unauthorized tenant sees no aggregates; no true-current-occupancy/push claim; all five widths permit filters, measure reading and export with accessible chart equivalents.

## Cross-route auth and dialog specification

These are **interactions within existing routes**, not additional current route entries. There is no standalone current sign-in, logout, account, privacy or password-reset route. Proposed shared auth can be launched from Home, Tickets, Network, Booth profile and Exhibitor entry while preserving a safe intended destination. Do not send organizer keys to attendee login or treat an attendee JWT as organizer authorization.

| Surface | Existing source | Future behavior and truthful states |
|---|---|---|
| Event register/login/reserve | `PublicEvent.tsx:303–452` | Label selected free tier and intent; register/login switching retains safe non-secret fields; authentication success continues reservation, but confirmation waits for reservation success; pending/invalid/network/capacity states separate. |
| Network manual peer entry | `MyNetwork.tsx:320–388` | Heading “Add connection”; explain manual badge code; submit result/invalid code; no camera permission prompt until capture feature exists. |
| Organizer standee preview | `OrganizerEventDetail.tsx:546–588` | Preview and print the supported QR payload; describe existing raw-secret/profile-navigation gap; no fake scanner test success. |
| Booth staff assignment | `OrganizerEventDetail.tsx:590–643` | Email field, assignment result and actual onboarding limitation; no invitation-sent claim; existing users can use their credentials, newly generated random-password users cannot yet self-access. |
| Desk minted pass | `OrganizerDesk.tsx:383–433` | Successful ticket identity and QR; print-only pass; explicit next Attendee; restore focus and remove old PII from working screen. |
| Desk attendee details/history | `OrganizerDesk.tsx:435–520` | Correct selected identity, credential and actual scan history; no current-presence inference; fetch failure differs from no history. |
| Lead qualification | `ExhibitorPortal.tsx:537–672` | Contact disclosure under actual Booth contract; accessible rating/tags/private notes; save failure keeps draft; responsive drawer/sheet. |

**All seven dialogs:** vetted accessible primitive with `role="dialog"`, `aria-modal`, labelled title/description, initial focus, focus trap, background inert, scroll lock, named close control, Escape and focus restoration. Backdrop closes only when safe; destructive/draft abandonment requires explicit confirmation, never silent loss. At **360/390** use full-height or near-full-height sheets with safe-area padding and internal scrolling; **768** use bounded dialogs or detail drawer; **1024/1440** cap form width, keep title/action visible and never stretch a QR. Inline Event/Booth/Point/Tier creation forms remain inline.

**Auth acceptance:** expired JWT offers a real sign-in interaction and safe continuation; failed login reveals no restricted records; token/account switching cannot re-use another person’s private cache. Organizer gate validates through a protected request and retains tenant 404 behavior. Exhibitor access independently validates BoothStaff membership even after JWT login. API changes for invitations, password recovery and contact consent are not implied by a better auth modal.

## Six end-to-end journeys A–F

The following specifies screen sequence, state truth, dependencies and completion evidence. It is not a record of executed E2E tests.

### A — Event discovery → details → free reservation → confirmation → ticket access

1. **Entry:** organizer-distributed `/e/:slug` link or existing known Event link. `/` can explain entry but cannot display a real directory today. Directory discovery is explicitly unavailable.
2. **Details:** show current Event facts/description and free tier options; no agenda, fabricated “remaining” stock or unavailable branding assets.
3. **Reservation:** choose tier → existing auth dialog → JWT-backed reserve. Disable duplicate action while pending; retain tier across auth failure.
4. **Confirmation:** only after server returns the real ticket; show Event/tier and “View my ticket.” Existing behavior navigates directly to `/my-tickets`; a designed confirmation must retain that valid destination.
5. **Access:** My Tickets shows the owner’s original QR with network/cache status. Offline access applies only to previously loaded permitted cache, not offline registration or installation claims.
6. **Failure branches:** missing Event, no tiers/full tier, auth failure, duplicate user/Event reservation, network ambiguity, stale cache and wrong account each have distinct states.
7. **Completion evidence required during implementation:** one user/Event active ticket, server-confirmed reservation, owner-only retrieval, scanable unchanged QR at 360/390/1440, keyboard-complete auth and safe cache/account transition. Include 768/1024 layout checks.

### B — Open scanner → establish device/point → scan → evaluate → result → persist/sync

1. **Entry/readiness:** known `/scan/:pointId`; display point/Event/policy, authorization and manifest freshness. Device onboarding/point picker is not an existing browser route.
2. **Establish state:** authorized fresh manifest or an approved cached manifest; absent usable cache means not ready. Offline-loaded application is supported; offline cold boot is not an implemented PWA feature.
3. **Capture:** browser camera if supported/permitted, HID, or manual; stop lifecycle must end decoding and release streams.
4. **Evaluate/result:** local policy feedback with explicit admitted/rejected reason. CAPACITY_CAPPED cannot certify global capacity from an absent/current-zero counter; “local result, awaiting server” remains visible.
5. **Persist:** durable IndexedDB record with one UUID `scan_id`; UI must distinguish result displayed from record durably queued if persistence fails.
6. **Sync/reconcile:** reconnect/interval uploads same IDs; match every returned server result; maintain rejected/disagreed/error state and authoritative reason. Do not replace “all acknowledged” with “all admitted.”
7. **Release blockers:** point authorization and manifest PII minimization; capacity semantics; per-record reconciliation/acknowledgement are prerequisites for safe operation. Installable PWA and native parity are separate features.
8. **Completion evidence required:** unauthorized manifest/batch blocked, foreign point credential denied, unplugged network preserves queue through reload, duplicate UUID does not duplicate Check-In, local/server disagreement visible, capacity is not falsely global, real camera/HID plus five-width accessible result/queue checks.

### C — Search → resolve existing/new Attendee → issue → QR → continue admission

1. **Entry:** owned Event Desk, organizer key; scope remains visible.
2. **Search:** name/email query → debounced current results → operator selects correct existing attendee or chooses new registration. No match is not a server error.
3. **Resolve:** verify identity/tier. Optional-email walk-in can receive a pass but cannot be promised later login/recovery through nonexistent claim infrastructure.
4. **Issue:** submit existing contract once; server determines uniqueness and capacity; failed/ambiguous result does not immediately trigger a second mint.
5. **QR:** actual minted/existing credential in accessible pass dialog; print only pass; no claim that issuing a ticket admits the person.
6. **Continue:** hand off to B for admission or “Next attendee” clears previous PII and refocuses the proper field.
7. **Completion evidence required:** both existing/new paths, optional email limitation, one active user/Event ticket, actual QR scan, whole-window content excluded from print, search stale-result safety, tenant denial, keyboard/five-width completion.

### D — Booth workspace → manual badge capture → permitted profile → qualify → notes/tags → CSV

1. **Entry:** `/booth/:boothId` with User JWT plus BoothStaff assignment; a competitor is denied with 403 and no lead data.
2. **Capture:** current manual secret entry. “Scan badge” may describe the business action, but control copy must say manual input; future camera/HID is explicitly separate.
3. **Profile:** server-approved lead/contact data under current exhibitor disclosure contract. No peer opt-in UI exists; do not imply a universal consent model.
4. **Qualify:** rating and private Booth notes/tags; success confirmed by save response, preserve draft on failure.
5. **List:** updated lead appears under correct filters; duplicate same Booth/ticket remains the same lead.
6. **CSV:** currently Booth-scoped supported export; validate response before file creation and explicitly state filter/export scope from the endpoint, not assumed parity.
7. **Completion evidence required:** authorized capture/save/export, duplicate persistence, competitor isolation, truthful manual/no-offline-queue states, failed-export handling and five-width detail/filter usability.

### E — Manual peer entry → Connection → privacy-permitted contact → private notes → vCard

1. **Entry:** `/my-network` authenticated Attendee → “Add connection” dialog.
2. **Capture:** manually enter peer badge secret; camera is future capture work.
3. **Connection:** server creates scanner→peer relation; do not claim mutuality. Duplicate keeps existing relation under endpoint semantics.
4. **Contact:** professional details; **current implementation always returns email**. Privacy-permitted email requires new consent model and permission-aware list/scan/update/vCard responses. Until implemented, report this as an unresolved privacy discrepancy, not a completed journey protection.
5. **Notes:** caller-owned private notes, explicitly not sent as peer profile changes; failed save preserves draft.
6. **vCard:** current export includes email; future consent must also gate export so a hidden UI field cannot leak through download.
7. **Completion evidence required:** manual input path, one-way truthful wording, own-note isolation, no duplicate relation, download response correctness; consent on/off coverage across every API/UI/export path once contract ships; no privacy claim before that coverage.

### F — Organizer → select/create Event → tiers → points/policies → Booths → analytics

1. **Entry:** API-key gate validated via protected request; list only owned Events, select UUID or create using current fields.
2. **Tiers:** free tier name/quota/availability according to existing contract; no pricing/payment settings.
3. **Points/policies:** create actual policies with correct tier/capacity fields. Permanent per-point SINGLE_USE and cumulative server capacity are described accurately; no exit/time-window controls exist.
4. **Booths:** create public profile, assign staff, preview standee. Newly created staff users have onboarding gap; standee raw-secret navigation has resolver gap.
5. **Operations handoff:** existing Desk and Gate Scanner links; scanner authorization blockers are not waived by having a link.
6. **Analytics:** point/tier filtering, 10-second refresh and cumulative admissions; CSV currently full Event regardless of UI filters. No current occupancy, schedule or edit/delete workflows.
7. **Completion evidence required:** tenant-404 isolation across every resource, actual create-and-read persistence, unsupported controls absent, staff/standee limitations visible, operational links resolve to right UUID, reporting/filter/export scope truthful, all five-width setup/report layouts.

## Release gates versus feature work

| Category | Required separation | UI truth before completion |
|---|---|---|
| **Scanner security/auth release gate** | Manifest and batch endpoints now require a point-scoped Scanner JWT or owning Organizer key, and the manifest omits attendee email. Cross-point/Event scan-ID replay remains a disclosure defect (#20), and web/Flutter credential lifecycle is incomplete (#18). | Preserve existing auth/minimization; do not imply a Scanner is operationally ready until cross-scope isolation and client provisioning/revocation pass. |
| **Scanner capacity correctness blocker** | Local count is absent; server capacity counts cumulative admissions, not active occupants. Resolve the intended policy/authority contract; do not simulate certainty with a local progress bar. | “Local result · server capacity confirmation pending”; analytics “Cumulative admissions,” never current occupancy. |
| **Scanner reconciliation blocker** | Current web code marks all uploaded records synced when a body arrives, without reconciling individual server results. Preserve per-ID acknowledgement and server authority. | Queued/acknowledged/admitted are separate states; mismatches cannot silently remain green. |
| **Peer privacy contract gap** | No consent fields; email returned/exported unconditionally. Permission enforcement must cover all responses and vCard. | No “Opt-in email sharing” or “Privacy protected” assertion until implemented. |
| **Staff auth/onboarding gap** | Shared User login exists; standalone entry is missing; newly assigned missing users receive no credentials/invitation. | “Assignment recorded”; explain access prerequisite, not “Invitation sent.” |
| **Pass cache privacy gap** | Plaintext localStorage includes reusable secret/name/email and can display without token. Define approved offline-owner/device boundary and expiry/purge. | Explicit device storage/offline limitation; never imply storage is encrypted or automatically private. |
| **Booth QR feature/contract gap** | Raw Booth secret has no public-profile resolver; choose secure resolver or deliberate public URL payload for standee. | Do not claim printed raw standee opens profile. Ticket QR contract stays unchanged. |
| **Branding feature/API gap** | Event model has no cover/logo/theme fields; asset validation/storage/API and fallback are necessary. | Editorial current-data typography is valid; upload/theme controls are not yet available. |
| **Future capture/offline-shell/native features** | Peer/lead camera/HID; browser installable PWA/service worker; Flutter camera, persistent storage, platform scaffolds/audio are separate deliverables. | “Enter badge code” for peers/leads; browser cached session is not offline install; native source is not operational parity. |
| **Explicitly absent product features** | Directory, schedule, true occupancy, Event/resource edit/delete, account recovery/claim, payment are not redesign shortcuts. | Remove misleading CTAs/copy; do not fabricate placeholders, controls, stock or records. |

## Implementation hand-off coverage

The route count remains exactly 11; the seven overlays and shared auth are interaction specifications, not extra existing routes. The page blueprints define proposed future states, not themselves test/build/E2E results. Phase 0 did run the full repository pipeline successfully; the result is recorded in [PHASE-0-VALIDATION.md](PHASE-0-VALIDATION.md). Future implementation verification should cover all A–F paths with seeded multi-Event/Booth identities; keyboard/screen-reader/reflow and Persian mixed-script stress cases; real QR/camera/HID hardware; privacy/authorization denial paths; offline/reload/UUID retry and reconciliation; print/export correctness.
