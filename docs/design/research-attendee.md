# Attendee-facing reference research

Research date: 2026-10-10. Research-only evidence for the independent, free-ticket congress platform. No production changes, tests, builds, lint, registrations, purchases, account creation, or authenticated competitor access were performed.

## Evidence vocabulary and boundaries

- **Rendered**: personally inspected public browser page/screenshot. A screenshot of a vendor product illustration is not evidence of using that product.
- **Public content**: first-party page text retrieved through the reader; establishes information architecture/copy, not actual responsive behavior.
- **Marketing**: vendor description or published illustration; feature/performance claims are not independently verified.
- **Indexed primary snippet**: search index excerpt from an official page that could not be opened; weakest evidence here.
- **Local code**: current repository file/route observation, not proof of a populated running screen.
- **Recommendation**: proposed transfer to the local product, not an observed competitor feature or an implementation commitment.

Agent-browser CLI was unavailable (`command not found`). A managed Chromium browser was used instead. Desktop captures use CSS viewport 1440×900 (Eventee registrations 1440×1000); mobile captures use 390×844, browser deviceScaleFactor 1.25. These are responsive browser views, not real-device/native-app tests. Several public pages partially loaded, so typography/layout findings below explicitly exclude missing assets and interaction correctness. The integration owner inspected retained screenshot file headers with Pillow: all `.png` files were PNG encoded; displayed tool previews may use WebP separately.

No local schedule/speaker entity or route was established by this research. All program, session, track, room, speaker, personal agenda, workshop reservation, abstract, poster and reminder patterns are **future-only**, subject to a separately approved domain/API change. Payments, CME/credits, AI assistants, matchmaking and event scheduling are not proposed for current scope.

## Highest priority: Eventee

### Exact pages investigated

1. [Event program](https://eventee.com/features/event-program): reader content plus desktop/mobile rendered public landing page.
2. [Registrations](https://eventee.com/features/registrations): reader content plus desktop/mobile rendered public landing page.
3. Linked signup destination is `https://admin.eventee.co/auth/register`; not entered or exercised.

### Registrations: what is actually evidenced

**Rendered public page:** white canvas, compact logo/navigation, mint accent, very large left-aligned benefit headline, strong primary `Try for free` and outlined `Contact sales`, small `No credit card required` reassurance. Desktop divides copy and a branded registration-form illustration into two columns. This is a vendor acquisition page, not attendee checkout. Mobile wraps the headline, collapses navigation, and stacks primary/secondary actions. The illustration communicates event context on one side and a short registration form on the other; the fields in the image were not interactive.

**Marketing/public content:** explicitly names invitations, RSVP collection/reminders, customizable event website, registration tracking, registrant contacts/company, custom groups, attendance status, six custom-field types, ticket scanning, name-tag printing, mobile/desktop check-in and real-time tracking. `Once they accept the RSVP or register ... they become attendees` distinguishes the invitation/response lifecycle from check-in. These claims do not establish offline correctness, capacity race handling, accessibility or tenant isolation. The FAQ contains a payment-processing question; its answer was not inspected, so no claim about Eventee payment support is made.

**Evidence:** [desktop](evidence/eventee-registrations-desktop.png), [mobile](evidence/eventee-registrations-mobile.png). Initial cookie consent covered the page and blocked an attempted FAQ click. Consent was dismissed for the saved hero captures; a support-chat widget remained visible. No registration was submitted, and no error/success states were exercised.

**Transfer now:** `web/src/pages/PublicEvent.tsx` should keep event identity, free tier and server-reported closed/capacity errors visible beside the existing account/reservation flow. Current tier DTO lacks reserved count, so do not show remaining stock from quota alone. Show the attendee a reservation result, then make the pass easy to retrieve in `MyTickets.tsx`. Separate registration, pass-issued and arrival/check-in vocabulary instead of calling all three “attendance.” `OrganizerEventDetail.tsx` and `OrganizerDesk.tsx` can adopt bounded sectioning and concise status labels, not giant marketing headlines. This is an information hierarchy/copy proposal, not custom forms, emails or badge-printing scope.

**Avoid:** copying vendor signup/sales CTAs into an attendee page; unsupported custom-field builders or invitation workflows; large hero imagery above urgent operational controls; decorative chat overlays on pass/scan screens; implying “real time” when offline events remain pending.

### Program: what is actually evidenced

**Rendered public page:** same minimal white/mint system and benefit-first landing-page hierarchy; mobile hamburger, wrapped title/body and stacked full-width CTAs. The embedded phone/program views are product illustrations, not an exercised agenda. Parent independently rendered the mobile public hero and supplied [additional mobile evidence](evidence/eventee-program-public-mobile.png).

**Marketing/public content:** multi-day/multi-stage schedule; filterable custom tracks; session title/description/time/place; speaker profiles with their sessions and contact details; attached slides/handouts; favorites-based agenda; a claimed 10-minute notification; shareable session links; capacity-limited workshop booking; hybrid embedded streams. These are vendor promises, not locally available features or tested behaviors.

**Evidence:** [desktop public hero](evidence/eventee-program-desktop.png), [mobile public hero](evidence/eventee-program-mobile.png). Reader links explicit product illustrations including `session_detail_988x1184.avif`, `dashboard_mobile_988x1184.avif`, `networking_booking_988x1184.avif`; these remain published marketing assets, not live app screenshots collected here.

**Transfer now:** extract only hierarchy: meaningful page title, context summary, one primary action and subordinate supporting information. Use this for `/e/:slug` and booth detail `/e/:slug/booths/:boothId`; saved booths in `MyTickets.tsx` are not “my agenda.”

**Future-only:** date/day navigation, topic/track filters, chronological compact session rows, detail links, room/time metadata, speaker-to-session relationships and favorites. A future schedule must reconcile event timezone, concurrent rooms, published changes, and offline freshness before adopting reminders or bookings. None belong in the current redesign deliverable.

## Whova

### Exact pages and access

- [Attendee user guide](https://whova.com/pages/attendee-guide): official search-index excerpt retrieved; direct reader returned HTTP 403; managed desktop browser also rendered `403 Forbidden`.
- [App FAQ](https://whova.com/resources/how-to-guide/whova-app-faq): official search-index excerpt retrieved; reader returned HTTP 403.

**Indexed primary snippets only:** the guide instructs attendees to use the email associated with registration (or a social-media account), create a password/name, and edit their profile for networking. The FAQ excerpt points to a bottom `Messages` tab and warns about signing into the right account when an email notification does not match visible messages. These are published instructions, not observed app behavior. No live agenda, ticket, networking, responsive layout, bottom-navigation rendering, QR behavior or screenshot is claimed. Mobile access was not exercised because desktop and reader both hit the access barrier; no native app was installed.

**Transfer now:** explicit account-context help in `MyTickets.tsx` and `MyNetwork.tsx`: “Use the account you reserved your pass with,” make signed-in identity and sign-out discoverable, and give useful empty-state guidance. Keep the local email/password mechanism; do not invent social sign-in. Distinguish attendee access from organizer/exhibitor/scanner credentials.

**Avoid:** citing Whova as proof for a particular visual style, density, tabs or schedule layout; adding messaging, public profiles or social authentication on snippet evidence. Whova is lower-confidence than the directly observed products in this artifact.

## Luma, including Discover

### Exact pages investigated

- [Discover](https://luma.com/discover): personally read public content; parent independently inspected rendered desktop/mobile views.
- [OWASP Helsinki Chapter meetup #48](https://luma.com/34xlox5w): actual event linked from Discover, personally read full public content. It is organizer-authored content hosted on official Luma, not Luma's generic feature marketing.

**Discover public content:** near-you popular events (the retrieved location was Helsinki), browse-by-category groups with counts, featured community calendars with follow controls and descriptions, and city-based local-event directories. Location/personalization is an observed retrieval result, not proof of accurate user geolocation.

**Rendered evidence supplied by parent:** desktop compact thumbnail/title/location pairs in two columns, restrained headings/dividers and `Discover Events`/`Sign In` header; mobile horizontal/ribbon popular-event and category groups with clipped continuation. [Desktop](evidence/luma-discover-desktop.png), [mobile](evidence/luma-discover-mobile.png). Initial navigation timed out; some metadata remained skeletons. Treat these as partial-render evidence, not a completely loaded or tested discovery flow.

**Event public content:** cover image, organizer identity and description, host contact/report affordances, location/map link, registration box with `Stream` and `In-person` ticket choices, `1 Left`, `Require Approval`, `Register`, then “About Event,” arrival/accessibility instructions, prose agenda, sponsors and location. Presence of the prose agenda does not establish a reusable schedule entity. Registration copy said it closes October 5 while registration controls were still present in the retrieved content; do not extrapolate accurate current availability from a third-party event page.

**Transfer now:** strongest candidate for a refined product shell and compact attendee lists. Use its visual restraint and image/title/metadata ordering in `Home.tsx` only as an entry-point pattern: current Home is not an event marketplace, and adding a searchable public catalog/categories requires backend scope. Apply event identity + location + a clearly bounded free-pass action in `PublicEvent.tsx`; apply cover/organization/details/save hierarchy in `PublicBooth.tsx`; compact name/company/action rows suit `MyNetwork.tsx`.

**Avoid:** adopting category/city/follow-calendar features without entities; approval/waitlist/hybrid tier states that current API does not support; copying a paid ticket workflow; dependence on horizontal discovery ribbons for essential information; replicating viewport metadata that disables user scaling. No full local discovery product is proposed.

## Fourwaves

### Exact pages investigated

- [Official platform](https://fourwaves.com/): first-party reader returned alternate Markdown with product imagery and module descriptions.
- [Event website builder](https://fourwaves.com/event-website/): first-party reader returned alternate Markdown and explicit participant/speaker/organizer structure.
- Browser navigation to the event-website page failed with `net::ERR_CONNECTION_CLOSED`; no rendered desktop/mobile or screenshot is claimed. No dashboard or actual registered event website was entered.

**Marketing/public content:** specialized academic website modules, conference-specific speaker/sponsor/accommodation/files content, integrated registration/submission/program, dedicated pages, private registered-attendee content, own-domain claims, archives/duplication, bilingual English/French support. Homepage describes public day/track programs and offline mobile app sync; those claims were not tested. Website page explicitly differentiates organizer, speaker and participant tasks. This is relevant medical/academic information architecture, not proof that local entities should be added.

**Transfer now:** use a coherent event identity across `PublicEvent.tsx`, `PublicBooth.tsx`, saved booths/pass in `MyTickets.tsx`, and event-scoped organizer pages. Keep exhibitor information near event context instead of presenting booths as an unrelated application. Role-specific affordances help `OrganizerLayout.tsx` and `ExhibitorPortal.tsx`; each should present its own existing tasks, not all modules to everyone.

**Future-only:** abstracts, peer review, poster pages, program, speakers, academic files, presenter certificates, bilingual content modeling. Current ticket QR and scan/offline semantics cannot be inferred from Fourwaves mobile-app claims.

**Avoid:** “complete academic conference suite” scope inflation, copying the AI Event Assistant advertised on the homepage, adding payment/certificate/editor/custom-domain/translation systems as visual polish, or claiming responsive quality from a marketing statement after browser access failed.

## Figma Config San Francisco

### Exact pages investigated

- [San Francisco event](https://config.figma.com/san-francisco/) (redirected from no trailing slash): public text and desktop/mobile render.
- [San Francisco agenda](https://config.figma.com/san-francisco/agenda/): public text.
- Root [Config](https://config.figma.com/) was also read and currently promotes India, so it is not interchangeable with the SF event.

**Public content:** June 23–25, Moscone Center, in-person/virtual context; retrospective “Thanks for joining us” and recording links; featured speakers; sponsors; FAQ links. This is a past-event/recap state, not open-registration evidence. Agenda exposes featured sessions with times explicitly in PDT, stage and building level, theme/topic labels, speakers, recording links, detail URLs and a filter affordance. A practical badge-pickup item names Moscone North, time window and government-ID requirement.

**Rendered:** black/white high-contrast editorial canvas, plain uppercase task navigation (`WATCH`, `AGENDA`, `SPEAKERS`, `FAQ`, `LOCATIONS`, `LOG IN`), repeated recap ribbon with pause affordance, separated date/location/modality metadata. Desktop reserved a large mostly black hero/media area; missing/unfinished media means this capture is not proof of the intended full motion/graphic design. Mobile text reorganizes into a narrower stack. [Desktop](evidence/config-sf-desktop.png), [mobile](evidence/config-sf-mobile.png). No agenda filter, account, favorites or recording was clicked.

**Transfer now:** event-scoped editorial identity and clear task navigation, not a dark global medical portal. `/e/:slug` can combine a strong title, date/location and single reservation action while the stable product shell stays neutral. `MyTickets.tsx` can communicate practical entry instructions if real source data exists; do not invent ID requirements or badge pickup.

**Future-only:** PDT-equivalent event timezone display, day filtering, speaker links, session location hierarchy and recap/recording states.

**Avoid:** giant empty animated hero space, moving ribbons around reservation/QR controls, a Config-branded visual clone, and unapproved content lifecycle/recording features. Editorial confidence should not compromise pass retrieval speed.

## Slush

### Exact pages investigated

- [Slush home](https://slush.org/): public text plus partial desktop/mobile render.
- [Public 2025 stage program](https://platform.slush.org/public/slush25/stage-program): followed exact link from the official home page; reader returned HTTP 404.
- Official home links paid ticket shop `https://platform.slush.org/public/slush26/tickets/shop` and platform login/meeting tool; not entered.

**Public content:** explicit Nov 18–19 Helsinki identity, audience-focused value proposition, large attendance/meeting/speaker metrics, startup/investor/ecosystem ticket categories, event info, side events, speakers, Helsinki guide and platform entry points. The page combines 2026 promotion with some 2025 speaker/program references; this matters for content-year validation and is not evidence of a current working agenda.

**Rendered partial page:** dominant dark hero, strong event-specific contrast, clear `Platform` versus `Buy tickets` navigation and large call to action. Browser navigation timed out, but title/DOM and screenshots were subsequently inspected; hero video controls were disabled at zero duration. [Desktop](evidence/slush-desktop.png), [mobile](evidence/slush-mobile.png). Do not attribute black/missing media regions to an intentional design. No meeting platform, schedule, purchased pass or mobile-native app was inspected.

**Transfer now:** strong event identification on `PublicEvent.tsx`; explicit distinction between promotional event page and functional attendee destination `MyTickets.tsx`; practical event logistics as content hierarchy only. Keep `Home.tsx` as the platform entry point rather than turning every organizer workspace into an event campaign.

**Avoid:** heavy video assets, countdown urgency, investor/audience personas, price anchors, ticket discounts, marketplace/network matching and huge social-proof numbers. They are inappropriate for the current free-ticket congress operational scope. Stage/speaker concepts remain future-only, and the stale program link is a reason to avoid unvalidated navigation.

## Web Summit, including schedule

### Exact pages investigated

- [Official home](https://websummit.com/): public content with Lisbon/date, tickets/exhibit entry points, speakers and attendee-experience link.
- [2026 schedule](https://websummit.com/schedule/): public content and partial desktop/mobile rendered browser page.

**Public and rendered schedule:** clear schedule heading, ticket/network CTAs and event photo, visible search input, November label, `Highlights` plus 09/10/11/12 day controls. Actual populated cards expose category, title, date/time, venue/stage and speaker name/organization. Browser DOM confirms interactive search/day buttons and paginated result controls, but these were not operated; presence is not proof of filter correctness. Mobile wraps the heading and stacks CTAs, photo, search, date tabs and single-column cards. [Desktop](evidence/websummit-schedule-desktop.png), [mobile](evidence/websummit-schedule-mobile.png). Navigation timed out; missing header logo/icon assets were visible. These captures establish layout/content hierarchy, not full asset loading.

**Transfer now:** compact predictable result/card ordering is useful for attendee passes, saved booths and network contacts, using the existing data rather than session data. Dedicated attendee versus exhibitor navigation supports the proposed role-aware shell. Keep one primary functional action per local page; ticket purchase and newsletter network acquisition are not local equivalents.

**Future-only:** program search, day controls, category and stage metadata, paginated sessions and linked speakers. Schedule/meeting capabilities are not a current acceptance criterion.

**Avoid:** promotional ticket/newsletter actions overpowering task content, relying on truncated speaker titles for essential identity, copying the multi-audience megamenu into a small application, or treating a partially loaded page as measured responsive/accessibility success.

## RSNA attendee resources

### Exact page investigated

[Attendee Resources](https://www.rsna.org/annual-meeting/attendee-resources): public content and desktop/mobile partial render. Linked destinations include pricing/registration, invitation letters, group packages, hotel, travel/transport, faculty/presenter resources and FAQ. Only the resource hub was opened; no downstream letter, account, hotel or registration flow was exercised.

**Public content:** each resource has a task-oriented name and one short explanation, plus an explicit annual-meeting contact if the visitor cannot find what they need. The hub acknowledges practical preparation, not only promotional value. Pricing, group packages, presenter requirements and travel-saving claims are RSNA-specific, not our platform scope.

**Rendered:** institutional blue/white, breadcrumb, active-section cue, desktop left annual-meeting navigation and two-column resource rows separated by light rules. Mobile replaces the desktop hierarchy with a compact hamburger/header and stacks the same resource items; the oversized heading and long introduction push first actionable link below much of the viewport. Missing logo/icon assets were visible. Navigation timed out, then DOM/title/screenshots were inspected. [Desktop](evidence/rsna-resources-desktop.png), [mobile](evidence/rsna-resources-mobile.png).

**Transfer now:** strongest model for practical attendee help near `/e/:slug` and `/my-tickets`: concise actionable sections, recognizable contact/recovery guidance, explain where the pass is and what to do with the QR using real platform behavior. Use `PublicBooth.tsx` links and content only when the event/booth already provides them; do not create a help center, FAQ database, maps or logistics management subsystem merely to copy the layout.

**Avoid:** replicating the society-wide navigation, payments/pricing, travel-booking, CME/credits, visa-letter generation, presenter workflows, and oversized mobile introductions. Resource hierarchy can transfer without importing medical-society business processes.

## Local anchors and evidence-informed direction

Current route source is `web/src/main.tsx:22–34`; the filenames below are code observations. No populated backend-dependent local attendee screen was personally rendered by this worker. Parent reports live local shells inspected at 1440, 390 and 360 CSS pixels with unavailable backend and no authenticated-populated evidence; parent screenshots should be cited separately in the integrated plan.

| Local route / file | Strongest transfer | Hard boundary / avoidance |
| --- | --- | --- |
| `/` — `Home.tsx` | Luma's restrained entry hierarchy; separate attendee and organizer tasks | Existing code is a platform landing page, not marketplace. No category/city discovery/catalog without API scope. |
| `/e/:slug` — `PublicEvent.tsx` | Eventee registration context plus Luma metadata/action grouping; Config editorial event identity | Existing code selects free tier, uses email/password register/login, reserves via `/api/events/{event_id}/tickets/reserve`, then goes to `/my-tickets`. Do not substitute payment/RSVP/approval flow. |
| `/my-tickets` — `MyTickets.tsx` | Pass retrieval is primary; RSNA practical guidance; bounded compact cards | Existing code uses `react-qr-code`, attendee token, ticket cache and online/offline status. Preserve real QR payload and cache/retrieval semantics; do not imply saved booths are sessions or completed visits. |
| `/my-network` — `MyNetwork.tsx` | Luma compact identity rows; Whova account-context guidance | Existing code scans peer QR secret, edits private notes and exports `.vcf`. Do not invent chat, swipe matching, meeting scheduling, public attendee directory or social authentication. |
| `/e/:slug/booths/:boothId` — `PublicBooth.tsx` | Fourwaves event continuity and Luma organization/detail/save hierarchy | Bookmark action requires attendee token. Preserve public-event/booth relationship and access behavior; no leads/private tenant data in public content. |
| `/organizer` and `/organizer/events/:eventId` — `OrganizerEvents.tsx`, `OrganizerLayout.tsx`, `OrganizerEventDetail.tsx` | Fourwaves role-specific navigation; Eventee bounded lifecycle/status groups | Dense workspace, not public event marketing or an academic program builder. Preserve current event/tier/scanning/exhibitor capabilities and isolation. |
| `/organizer/events/:eventId/desk` — `OrganizerDesk.tsx` | Separate registrant/pass/arrival vocabulary; high-contrast practical operations | No visual change may alter retry-safe issue/attendance semantics or add badge printing from vendor claims. |
| `/organizer/events/:eventId/analytics` — `OrganizerAnalytics.tsx` | Concise real-data labels and compact task hierarchy | No invented session engagement/ROI metrics. |
| `/booth/:boothId` — `ExhibitorPortal.tsx` | Role-specific dense workspace rather than event hero | Preserve booth/competitor data isolation and existing lead semantics. |
| `/scan/:pointId` — `GateScanner.tsx` | Dedicated high-contrast operation, strong state/action/result | Preserve V1/V2 API, QR, duplicate/idempotent result, offline queue and synchronization semantics; marketing app screenshots prove none of these. |

### Comparative judgment for parent integration

1. **Adopt a minimal stable product shell**: Luma-like restraint, predictable navigation and compact functional lists. Evidence is stronger for public discovery structure than authenticated product behavior.
2. **Allow event-scoped editorial character**: Config/Slush show why one congress can have an identity, but do not extend heavy motion, black hero space or branding into organizer/scanner workspaces. Real event content and safe fallbacks come first.
3. **Use Eventee registrations as the closest flow reference**, transferring contextual reassurance and registration-versus-arrival clarity, not its organizer-acquisition page or untested feature inventory.
4. **Use RSNA for attendee practical information**, simplified for our actual data and mobile viewport rather than society-wide navigation and medical-business features.
5. **Maintain dedicated operations density/contrast**. None of these public-page studies provides evidence for offline scanner parity, synchronization failure handling, privacy, tenant isolation, quota concurrency or duplicate-scan semantics; current contracts are authoritative.
6. **Park programs/speakers explicitly**. Eventee, Config, Fourwaves and Web Summit are valuable future references, not justification to invent current schedule entities or navigation placeholders.

## Research limitations and later validation, not completed checks

No authenticated competitors, native apps, successful reservation/checkout, keyboard/screen-reader interaction audit, real-device usability measurement, contrast calculation, network/offline app simulation or comparator performance benchmark was completed. Whova was blocked; Fourwaves browser access failed; Config/Slush/Web Summit/RSNA had missing or unfinished assets; Luma rendered evidence came from the parent and was partially loaded. Screenshots are public-page viewport evidence only.

For later implementation validation, the main agent should exercise current backend-populated attendee registration/login/reservation, tier closed/full/error cases, pass QR retrieval and cached/offline messaging, bookmark auth, network QR/private-note/vCard flows, role gates, and scanner pending/synced/duplicate/rejected states on desktop and 390/360 mobile. Validate focus/labels/touch targets and overflow using real existing API responses. No such verification is reported as performed here.
