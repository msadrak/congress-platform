# Enterprise and operations reference research

Research date: 2026-10-10. Planning-only input for the UX/UI master plan; no production edits, builds, tests, or new product capabilities.

## Evidence contract

- **Rendered public UI** means a page actually opened in Chromium. Public marketing pages are still marketing, even when rendered.
- **First-party documented UI** means an official help article or the screenshot embedded in it. It is stronger evidence of layout and terminology than sales copy, but it is not a logged-in product session, responsive test, or proof of current account-specific availability.
- **Interactive product-tour UI** means a first-party published guided simulation, not a live operational deployment.
- **Marketing claim** means a vendor assertion. Conversion, adoption, ROI, throughput, compliance, and reliability claims were not independently verified.
- **Local code observation** means a current source file was read; it does not mean the populated application was rendered. Backend availability was not established in this slice. The parent reports the local backend was unavailable, so there is no populated local UI proof here.
- **Recommendation / inference** is a proposed adaptation, not competitor behavior or existing local capability.

Preferred reference order: Swapcard Exhibitor Center for information architecture and dense lead work; pretixSCAN for honest operational state and offline limitations; Cvent OnArrival for task-focused field navigation; Accelevents for the explicit scan-to-qualify sequence and device-aware workspace split. Borrow patterns, not their feature inventories or styling wholesale.

## Source register and access record

Every source below was actually read or opened. Search snippets were discovery aids, not the final basis for findings.

| ID | Exact URL | Evidence and access |
|---|---|---|
| S1 | https://www.swapcard.com/ | Official overview read as first-party marketing text; not a logged-in app. |
| S2 | https://help-attendees.swapcard.com/en/articles/8185489-what-can-i-do-in-the-exhibitor-center | Official comprehensive Exhibitor Center guide; desktop/mobile instructions and embedded screenshots; read. |
| S3 | https://help-attendees.swapcard.com/en/articles/8185518-how-do-you-follow-up-on-event-contacts-as-a-team | Official Team's Contacts, sharing, export guide; read and browser-opened; embedded desktop screenshot visually inspected. |
| S4 | https://team.swapcard.com | Public exhibitor entry opened at 1440 × 1000 and 390 × 844 CSS px; redirected to https://team.swapcard.com/login?redirect_url=https%3A%2F%2Fteam.swapcard.com%2F . Only login was reachable; no credentials submitted. |
| S5 | https://www.swapcard.com/features/exhibitor-sponsor-tools | Official exhibitor/sponsor product overview read; marketing sections for lead capture, shared dashboard, AI, hosted buyers and mobile availability. |
| A1 | https://www.accelevents.com/ | Official overview read; marketing only. |
| A2 | https://support.accelevents.com/en/articles/15960637-exhibitor-resource-center-erc | Official ERC guide read; desktop workspace, tablet/mobile preview, role/device limitations and screenshots. |
| A3 | https://support.accelevents.com/en/articles/6208379-exhibitor-lead-capture-in-the-attendee-app | Official lead capture guide read and browser-opened; three-phone screenshot visually inspected. Initial browser navigation timed out, but the same tab subsequently loaded the article and image successfully. |
| A4 | https://support.accelevents.com/en/articles/443011-check-in-attendees-through-the-admin-app | Official staff-mode check-in guide read; screenshot/GIF references, QR/search/device workflows. |
| C1 | https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software | Official OnArrival overview read; marketing claims and first-party illustrations. |
| C2 | https://community.cvent.com/education/learning-centers/product/onarrival | Read returned metadata only, not useful how-to content. Do not infer documentation steps from this inaccessible body. |
| C3 | https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software/interactive-demo | Read redirected to https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software/interactive-product-demo ; exposes official tour URL below. Initial browser attempt timed out. |
| C4 | https://demo.cvent.com/clzlet96p002709mfbzvp7h7g | Direct Chromium tour opened at 1440 × 1000 CSS px. Intro → checklist → Event Organizer View → Let's go. Observed organizer home in a simulated phone frame; not a live app. |
| P1 | https://pretix.eu/about/en/ | Official pretix overview read; marketing. |
| P2 | https://pretix.eu/about/en/features/checkin | Official onsite feature page read; check-in lists, offline copy/sync, badge printing descriptions and first-party images. |
| P3 | https://docs.pretix.eu/guides/pretixscan/android/ | Official detailed Android scanner guide read, including offline sections. Search/read originally used the same URL without trailing slash, which resolved here. |
| P4 | https://docs.pretix.eu/assets/screens/scan/valid.png | Official Android valid-ticket screenshot opened in Chromium; 439 × 800 intrinsic image. Not a running Android application. |

### Image provenance and retention

These are screenshots of official published material, not invented mockups:

- **Swapcard Team's Contacts**: S3 image asset is `https://downloads.intercomcdn.com/i/o/ineyz1by/1405991000/444beb0d316949632f9697b7a984/Default+%284%29.png` (the article currently appends expiring `expires`, `signature`, and `req` parameters). The image element was screenshot-captured and opened for visual inspection. This older screenshot has a different top-bar configuration from the newer behavior described in S2. Do not combine them as one observed product version.
- **Accelevents scan sequence**: A3 image asset is `https://downloads.intercomcdn.com/i/o/v9gpt5gw/2451292535/1ea35d7398a779cb60b2bb9decb0/3-2BiPhones.png` (also served with expiring signed parameters). Browser-captured image shows event/booth entry → QR camera → lead details/save. Its final illustrated screen is titled “Add Lead Manually”; the explanatory article describes scan-populated details. This establishes the visual fields and action hierarchy, not proof that this particular screenshot depicts automatically populated values.
- **pretix valid state**: stable exact asset P4 above; linked directly from P3.
- **Cvent organizer home**: tour state `https://demo.cvent.com/clzlet96p002709mfbzvp7h7g?g=clzlf3n7u000809lh6g6ohhad&s=1` was screenshot-captured after intro. It shows a simulated phone, event summary, registration/check-in metric, settings/register/sync actions, and bottom tabs. Capture is tour evidence only.
- The parent separately rendered Swapcard's public Exhibitor Center marketing page at desktop 1440 × 900 and retained `docs/design/evidence/swapcard-exhibitor-public-desktop.png`. Parent-reported observations: two-column value/action + media hero, mega-section navigation, and separate Participant Login / Organizer Login footer links; media partially loaded. This child did not inspect that retained capture and makes no private-workspace inference from it. Parent should attach its exact visited page URL in the integrated evidence register.

Child captures are temporary tool artifacts, not committed assets. The canonical article/tour/image URLs above are the reproducible provenance; signed Intercom links may expire and should be reacquired from their owning article. There are no newly created image files in this slice.

## 1. Swapcard — highest-priority exhibitor reference

### Overview: what is actually evidenced

S1 markets unified registration, mobile/web engagement, onsite control, and exhibitor ROI. The page separates registration, attendee experience, and exhibitor tools into distinct value sections. This is useful evidence of public product positioning, **not** proof that any private organizer screen has the same layout. Adoption/ROI statistics, AI matchmaking and recommendation claims are marketing and not design acceptance criteria. Paid ticketing, AI, meetings, agenda hierarchies and monetized exhibitor add-ons are outside this platform's free-ticket scope.

### Documented desktop architecture

S2 describes an event-scoped Exhibitor Center with a left menu containing Home, Company Profile, Team members, Leads, and Meetings when enabled by the organizer. It documents a shared top bar with an Event / Exhibitor Center pill toggle, event-name switcher grouped into Upcoming/Current and Past, and a sidebar company switcher for staff belonging to multiple booths. These are **documented behaviors**, not actions performed in a logged-in session.

S3's first-party Team's Contacts screenshot was visually inspected. Concrete visible patterns:

1. Small persistent vendor shell, event/company context in the left rail, central workspace title and short explanatory sentence.
2. Four compact summary blocks above the worklist: Contacts made, Contacts qualified, Contacts scored, and average score. The list remains the main content rather than being displaced by a large chart.
3. Search before a dense table. Columns visibly separate lead identity, organization, interactions, connection/source colleague, qualification state, and assignee. Secondary email/job-title details appear beneath the contact name rather than becoming separate full-width cards.
4. Qualification is a visible textual work state (“Qualified” / “Not yet qualified”), not just a color. Interaction chips and assignee avatar/name provide scan-friendly secondary cues.
5. Leads navigation expands to Team's contacts and other subtasks. Pagination/page-size controls sit below the table.

S3 additionally **documents** a lead detail side panel named Interactions, notes/scores/qualifiers, assignment, and date-scoped export. The image inspected does not show that side panel open, so its mechanics and width were not observed.

### Permissions and export are part of the UX

S2 documents that exhibitor access requires booth assignment and a published event; only organizers can change attendee-to-exhibitor roles and booth affiliation. S3 documents contact sharing as an individual opt-in, off by default, and says absent teammate leads can mean sharing is disabled. It also documents desktop-only `.XLS` export (not the mobile event app), organizer-controlled lead/API access, and a read-focused GraphQL API. These specifics must not be transplanted into this repository: its current booth-owned CSV and isolation semantics remain authoritative.

**Reusable idea:** Explain access failures with task context (“this account is not assigned to this booth”) and a next action, not a generic empty dashboard. Indicate exactly what a list and export cover. Keep staff, event and company identity visible during qualification to reduce wrong-booth work.

**Drawback / caution:** A large menu and nested lead modules are suitable to Swapcard's broader suite, but would overstate local capability. Default-off personal sharing also creates confusing incomplete lists; this is a competitor limitation to learn from, not a requirement to implement. A context toggle cannot grant permissions or expose unrelated booths. The newer S2 top bar and older S3 screenshot are not one verified release.

### Mobile and private-access limits

S4 rendered an email-only login gate at desktop and mobile viewport sizes; Submit was disabled until input. No authenticated Exhibitor Center was reached. The resized gate does **not** prove responsive private dashboards.

S2 says company profile editing is best on web for uploads/videos; mobile is suitable for lead review and meeting management. S3 explicitly says export is unavailable in the mobile event app. These are documented device distinctions. No native Swapcard app was launched and no mobile lead table or scan workflow was exercised.

S5's marketing FAQ broadly says all exhibitor tools are available on desktop/mobile; S3's specific help instructions exclude mobile-app export. Prefer the specific task guidance, and distinguish mobile browser from native app rather than claiming complete parity. S5's centralized-dashboard and instant-sync language does not override S3's sharing and access restrictions. This is a useful source-quality warning for the master plan.

### Local mapping

- `/booth/:boothId` → a compact company-context header, search/rating filters, dense lead rows and persistent qualification state. On wide screens keep the list while a qualification drawer opens; on phones use a focused full-width qualification surface with a clear return path. Preserve existing HOT/WARM/COLD values, tags, notes and booth-scoped CSV, not Swapcard's scoring scale/XLS/API.
- `/organizer/events/:eventId` → group existing booths, staff assignment and standee QR tasks. Make the “view public booth” distinction legible; no proposed self-service booth editor unless already supported.
- `/e/:slug/booths/:boothId` → editorial company identity with clear brochure/bookmark actions; distinguish public brochure from private lead work.
- `/organizer` and `/organizer/events/:eventId` → persistent organizer/event context with fewer task links than Swapcard; no fabricated suite modules.

## 2. Accelevents — explicit scan, qualify, save

### Overview and ERC evidence

A1 positions registration, onsite operations, exhibitors and attendee app as separate workflow areas. It contains product imagery but ROI and “one platform” statements remain marketing. A2 is the more useful source: official ERC instructions describe a left-navigation booth switcher for admins, invite-based exhibitor access, permission-limited lead retriever menus, and a separate “Go to Virtual Event Hub” / “Go to Exhibitor Portal” context transition.

A2 documents a profile-edit workspace with form on one side and collapsible booth preview on the right, with desktop/tablet/mobile and listing/profile preview modes. That is a useful **documented** editing/preview pattern, but no profile editor was exercised. It documents team, tasks, meetings and leads sections; most of that feature breadth is not needed locally.

### Observed first-party mobile screenshot

The A3 three-phone image was rendered and inspected, not a native app:

- Event identity and a company booth module are near the top of the entry screen; “Scan lead” is attached to the booth rather than hidden in generic networking navigation.
- Camera view emphasizes the QR target area.
- Detail view contains name, email, phone, note, owner and rating fields, ending in a broad bottom Save action. The illustrated screen says “Add Lead Manually,” so it is evidence for a qualification form, not an independently executed scan.

A3 **documents** the precise flow: open event → booth module Scan Lead → scan → populated identity → notes → Save → View Leads. It says an attendee may be a lead without being checked in, lead capture does not check the attendee into the event, and one attendee can only be added once per booth. Repeat scanning opens “Edit Lead” and saving displays an update message. Those distinctions are highly relevant to local booth/gate/network separation.

### Staff check-in and devices

A4 documents search by name/email/company, filtering, success text and changed check-mark state. QR scan opens a ticket summary with explicit Check In confirmation. iPad staff entry is shorter than mobile entry; badge printing access also differs by device. Kiosk mode lets attendees choose QR or lookup and requires a PIN to exit. Staff cannot see Dashboard/Summary tabs. These are first-party documented patterns, not a tested kiosk.

A2 says lead search is available in ERC, not the attendee app; tasks also are not available in the attendee app. A3 says leads can be downloaded on phone/computer through ERC. Do not misreport those as universal native mobile parity. No offline lead-capture guarantees were established by the inspected sources.

**Reusable ideas:** Put “Capture booth lead” on the booth page, “Scan entry ticket” at the gate, and “Scan peer badge” in networking. Preserve identity at the top of qualification; show “Saved” versus “Updated existing lead.” Keep scanner and recent result near the working action. Distinguish staff desk lookup from attendee self-service.

**Drawbacks:** A3 repeatedly warns not to scan using My QR because the wrong entry can error. That is concrete evidence of context ambiguity; do not copy interchangeable scan controls. A4's multiple menus and confirmation may add steps; local high-throughput entry should preserve its existing scan validation flow, not acquire an extra confirmation by imitation. Device-specific feature absence is a reason to set explicit responsive priorities, not hide supported local search/export. Automatic leads from brochure/chat interactions documented in A2 are not a local permission to collect leads without the existing consent/behavior rules.

**Local mapping:** `/booth/:boothId` gets the primary lead capture/qualify path; `/my-network` retains separate peer capture/private notes; `/scan/:pointId` retains entry validation; `/organizer/events/:eventId/desk` prioritizes search and free walk-in minting. `/my-tickets` keeps QR immediately reachable. Do not add RFID, kiosk provisioning, meeting scheduling, team purchasing, virtual rooms or task management.

## 3. Cvent OnArrival — dedicated field operations

### Evidence and access distinction

C1 is official marketing. It advertises QR/name/barcode lookup, onsite registration, badge printing, kiosk/mobile usage, attendance and reporting. It describes reporting statistics every 15 minutes. “Real-time” headline language therefore must not be interpreted as zero-latency live data, and neither cadence nor throughput was tested. Limited-connectivity operation is a vendor claim here; this slice did not find or exercise its offline consistency model.

C2 supplied metadata only. C3's official tour wrapper initially timed out in browser, but reading it exposed C4. Direct C4 eventually rendered a Navattic simulation. The actual observed path was introduction → Open checklist → Event Organizer View → Let's go → organizer home. The intro separates Event Organizer View from Event Attendee View; that is public tour navigation, not role authentication.

### Concrete observed tour screen

C4 organizer state `?g=clzlf3n7u000809lh6g6ohhad&s=1` showed:

- A blue, compact mobile operations header and event identity rather than an editorial sales hero.
- A central event card and registered versus checked-in summary: 37%, 40 checked in, 107 registered in demo data.
- Stacked “Go to settings,” “Register an attendee,” and “Sync device” tasks, with a “Synced 6m ago” freshness cue.
- Four bottom navigation areas: Event, Scan, Attendees and Stats.
- A tutorial prompt to tap Attendees.

The values are synthetic tour data and not operational evidence. Advancing with two exposed Continue buttons was blocked by the tour's clickable-area overlay; no attendee search, check-in transaction or badge print was completed. The screenshots establish this home hierarchy only. Do not describe that blocked action as a product defect.

### Adaptation and limitations

**Reusable:** Give scanning a dedicated minimal shell. Show event/check-in point, connectivity, pending queue and meaningful freshness near the working surface. Make manual lookup/walk-in a deliberate desk path, not a dense settings detour. Keep operational percentages subordinate to actionable counts, and label data freshness rather than relying on “live.”

**Drawback:** A broad suite mixes registration, printing, session rules and payment into field work. This platform should not inherit those menus or hardware dependencies. Tour-only phone imagery cannot establish a live desktop layout, touch response, mobile browser behavior, offline reliability, or accessibility. No Cvent native mobile app was installed, and no mobile viewport test of its actual application was performed.

**Local mapping:** `/scan/:pointId` for the dedicated high-contrast scan surface; `/organizer/events/:eventId/desk` for free walk-ins/lookup; `/organizer/events/:eventId/analytics` for attendance/throughput and explicit refresh time. Do not add payments, badge printers, CE signatures/CME, sessions or scheduling from C1. Preserve the local event API and manifest/queue semantics rather than interpreting a “Sync device” button as an implementation specification.

## 4. pretix and pretixSCAN — strongest offline reference

### Product positioning versus detailed guidance

P1 is ticketing marketing, with shop, tickets, onsite and administration task categories. Its security/accessibility badges are vendor claims, not proof of this repository's compliance. P2 documents separate check-in lists restricted to products and independent per-list validation, using entrance and restaurant as examples. Local check-in points/catering are a plausible task analogy, **not** a mandate to copy pretix's list/product rule model.

P3 supplies unusually concrete operational evidence. Device connection is configured with name, scoped events, security profile and gate; example name “Entrance B phone 1” identifies physical use. Event and check-in list are selected before scanning. Online-only/no-order-sync and kiosk/no-search profiles explicitly do not permit offline scanning. Those are pretix policies, not current local capabilities.

### Documented result vocabulary and authentic image

P3 describes three result classes:

- Green: “Valid ticket,” with ticket type and order/position.
- Yellow: “Ticket already used,” with first scan date/time.
- Red: explicit reason such as “Invalid ticket,” “Order canceled,” or “Entry not allowed.”

P4's authentic Android screenshot was opened in Chromium. It is an image of a valid-ticket state, not a working camera: status text, checkmark and ticket identity are grouped above the scan surface. P3 documents torch/focus controls, manual participant search, event/list switching and a PIN protecting settings/mode switching. Keep the visible text/reason principle; do not introduce order numbers if the local API does not expose them.

### Offline honesty is the main lesson

P3 explicitly states that offline scanning compares with an internal database; initial setup and at least one sync require internet; automatic synchronization attempts when connection returns. It warns that two disconnected devices can temporarily accept the same ticket until scans and device databases synchronize. It also documents automatic fallback thresholds such as “3 seconds or errors.” These are pretix implementation details, not new settings for this platform.

**Reusable:** Preflight language must distinguish “network available” from “manifest downloaded / ready offline.” Result state must distinguish local acceptance, queued upload and server reconciliation where the existing local engine permits that distinction. A prominent pending count, last successful sync/manifest information and a warning about cross-device consistency are more honest than an unconditional green “Offline safe” label. Include reason text/icon alongside color so operators need not infer meaning from tint.

**Drawbacks:** Setup/settings and expert mode are powerful but dense. Copying all controls into the local gate would increase mistakes. Offline duplicate acceptance is a real distributed-data limitation disclosed in the guide; the local UI cannot promise global single-use before synchronization. Native Android screenshots are not proof of desktop web or iOS behavior. No native pretix app, hosted shop purchase, admin account, check-in or device registration was exercised.

**Local mapping:** `/scan/:pointId` and `mobile/lib/` scanner conceptually benefit from preflight/freshness/result hierarchy, but this slice makes no mobile implementation claims. `/organizer/events/:eventId` can explain existing point purpose and scanner links; `/organizer/events/:eventId/analytics` can distinguish registration totals from accepted scans/attendance. `/e/:slug` and `/my-tickets` benefit from clear “free reservation” and “ticket available” stages rather than ticket-commerce vocabulary. Do not add payment/box-office, certificate, re-entry, PIN provisioning or multi-event expert-mode features.

## Local code anchors: recommendations must fit existing capabilities

These anchors were read directly; none is rendered local evidence:

| Source | Concrete observed code | Planning consequence |
|---|---|---|
| `web/src/main.tsx:22-34` | Eleven public/attendee/exhibitor/organizer/scan routes; organizer parameter is **eventId**, not the generic `id` in AGENTS.md. | Use actual route strings below; maintain route and API contracts. |
| `web/src/pages/ExhibitorPortal.tsx:28-48,131-175,189-203` | QR secret capture state, HOT/WARM/COLD rating, notes, tags, search/rating filters, qualification editing, PATCH lead and authenticated booth CSV export. | Propose list/drawer hierarchy using these fields; no assignee, interaction score, GraphQL or personal sharing feature. Camera capture was not established by this inspected code. |
| `web/src/pages/ExhibitorPortal.tsx:206-220` | Missing-token staff sign-in state links back to `/`. | Competitor login research suggests a clearer role/context explanation, not an invented local identity provider. |
| `web/src/pages/GateScanner.tsx:42-45,60-63,119-146,151-154` | Online/pending/sync state, cached manifest path, unsynced scan count, background flush on interval and reconnect. | Make these existing operational states conspicuous. Offline details are governed by the actual scanner engine, not competitor descriptions. |
| `web/src/pages/OrganizerDesk.tsx:76-95,303-310` | Event-scoped attendee search with 200 ms debounce, limit 30; lookup description names name/email/affiliation. | Keep dense, keyboard-friendly lookup central; do not add payment/order management. |
| `web/src/pages/OrganizerEventDetail.tsx:58-76,86-109` | Booth creation metadata, staff assignment state, standee QR state and event-scoped booth/point/tier retrieval. | Group operational setup, don't invent exhibitor self-service editing. |
| `web/src/pages/OrganizerAnalytics.tsx:82-95,149-153` | Authenticated event attendance CSV export action. | Make export and data context readable; do not turn it into a claimed live cross-system ROI dashboard. |

### Complete route translation table

| Actual local route | Borrowed design pattern | Explicit boundary |
|---|---|---|
| `/` | Separate participant/organizer entry and simple action hierarchy, supported by public positioning references. | Not an enterprise suite sales site; no unsupported claims. |
| `/e/:slug` | Event-scoped editorial identity with a clear free-ticket action. | No paid checkout, sessions or AI recommendations. |
| `/e/:slug/booths/:boothId` | Company identity, brochure and bookmark as distinct public tasks. | Public visit/download is not automatically permission to create a lead. |
| `/my-tickets` | Immediate QR/pass access; event context and explicit offline availability. | Do not promise cache availability before it exists. |
| `/my-network` | Explicit peer-badge scan context separate from booth/gate. | Keep private notes/private network ownership; no booth team sharing. |
| `/booth/:boothId` | Swapcard-style dense lead workspace; Accelevents-style capture→qualify→save context. | Preserve existing booth isolation, rating/tags/notes and CSV format; no broader attendee directory. |
| `/scan/:pointId` | pretix status reasons and offline honesty; Cvent minimal field shell. | Retain QR validation, queue idempotency and reconciliation semantics; no invented global offline guarantee. |
| `/organizer` | Minimal event worklist with clear current organizer context. | API-key gate stays a contract; no implied SSO/account provisioning. |
| `/organizer/events/:eventId` | Task groups for tiers, points, booths, staff and QR. | No new team policy, meeting/task engine or scan-device provisioning. |
| `/organizer/events/:eventId/desk` | Dense lookup + free walk-in issuance; identity-focused feedback. | No payments, badge hardware or new check-in semantics. |
| `/organizer/events/:eventId/analytics` | Compact attendance counts, throughput and contextual CSV. | Label freshness honestly; no fabricated CRM attribution/CME reporting. |

## Master-plan synthesis

1. **Refined minimal product shell:** neutral, persistent role/event/company context; a short task vocabulary. Swapcard's information architecture supports context, not copying its full menu.
2. **Event-scoped editorial branding:** public event/booth imagery and identity can be expressive; operational fields, status colors and QR contrast stay stable. Marketing art is not a dashboard template.
3. **Dense workspaces:** desktop organizer and exhibitor work should privilege readable rows, search, filters and contextual drawers. Use cards for summaries, not to turn every lead into a large low-density tile.
4. **Dedicated high-contrast operations:** scanners and desk surfaces should foreground the current task, identity, result and recovery. Success/duplicate/denial need words and icons; all status meanings come from existing local contracts.
5. **Intentional mobile hierarchy:** expose pass, scan, identity, qualification and recovery first. Desktop previews and phone frames do not prove responsive behavior. Keep supported local capabilities accessible rather than reproducing competitor mobile omissions.
6. **No suite expansion:** payment, CME/certificates, AI, schedules, meetings, virtual rooms, RFID, badge printer integrations and new sharing APIs were encountered as research context and are deliberately excluded.

### What this research cannot establish

No authenticated competitor account, native app deployment, true scan transaction, offline multi-device experiment, browser accessibility audit, localization/RTL evaluation, product load/performance measurement or populated local application was performed. No claims of touch-target conformance, keyboard navigation, contrast compliance, scan throughput or production reliability follow from these sources. Future UI acceptance must separately exercise the local implementation at desktop/mobile sizes and its existing success/error/offline states. This research itself requires no production verification command.

## Mandatory Swapcard URL supplement

Both exact requested URLs below were personally fetched successfully on 2026-10-10 with first-party content negotiation returning Markdown. Neither redirected to a substitute source. These supplement, rather than replace, the detailed official help evidence above.

| ID | Exact requested and working URL | Evidence type and useful detail |
|---|---|---|
| S6 | https://www.swapcard.com/platform/overview | Official public platform-overview marketing text. Separates registration and attendee engagement into module-led sections with repeated “It helps you” and “Key capabilities” subheadings; claims seven connected modules and branded unified web/mobile access. |
| S7 | https://www.swapcard.com/features/exhibitor-center | Official public Exhibitor Lead Center marketing text. Frames pre-event prospecting, onsite capture and post-event follow-up as one journey; distinct value blocks for no silos, onsite capture, shareable ROI, scale and no app switching. This is also the exact URL the parent independently rendered for `docs/design/evidence/swapcard-exhibitor-public-desktop.png`. |

### Concrete adaptation, not feature import

- **S6 → `/`, `/organizer`, `/organizer/events/:eventId`:** task-group headings and concise explanation of each role's existing job are a useful information-design pattern. Use the current platform's registration/booth/entry/desk/reporting vocabulary. The advertised seven-module architecture is Swapcard's positioning, not a local navigation requirement. Its conditional paths, payments, AI, schedules and meeting automation remain excluded.
- **S7 → `/booth/:boothId`:** distinguish capture, qualification and later CSV follow-up in the page hierarchy. This validates the existing lead lifecycle as an organizing idea without adding pre-event AI prospecting, OCR, pipeline estimates or meetings. Put public company profile identity and private leads in explicitly different contexts, mapped to `/e/:slug/booths/:boothId` and `/booth/:boothId`.
- **S7 → `/scan/:pointId`:** its marketing mention of offline lead capture is not scanner implementation evidence, not a proof of consistency, and not a reason to promise guaranteed capture. The detailed pretix guidance remains stronger operational evidence; local manifest and retry-safe queue behavior remains authoritative.

### Limits and drawbacks of these exact sources

S6's transaction/adoption/ROI numbers and S7's 40%, 44%, 2.5× and 83% lead statements are unverified marketing. Neither fetched text supplies responsive breakpoint measurements, logged-in dashboard mechanics, native mobile behavior or an offline reconciliation specification. S7's “no silos” and automatic shared-dashboard statements must be read alongside S3's explicit personal sharing and organizer access restrictions. S7's language can encourage overcollection from profile visits or chat; do not convert local public booth browsing into new automatic lead capture. Desktop public hero hierarchy is parent-rendered evidence only; mobile/private workspace parity is not established by these pages.

Parent's previously cited public screenshot is therefore now attached to the exact S7 URL, eliminating the missing-source limitation in the image-provenance section above. The child read both exact pages; only the parent rendered S7's public marketing layout.
