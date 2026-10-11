# 02 — International competitor research

Research date: 2026-10-10. This document consolidates the twelve mandatory products; detailed personally investigated sources, images, observations and access records are retained in [enterprise research](research-enterprise.md) and [attendee research](research-attendee.md). These linked appendices are part of this research deliverable, not generic reading suggestions. Synthesis/decisions live in [03](03-DESIGN-SYNTHESIS.md), not in vendor claims.

## Evidence key

**R:** directly rendered public page; **I:** authentic first-party product screenshot/illustration visually inspected; **T:** interactive guided simulation; **D:** official documentation/content read; **M:** marketing assertion; **X:** inaccessible or incomplete. No private dashboard, native app transaction or competitor offline experiment was performed. Public screenshots do not establish accessibility, responsiveness of private tools or throughput. All mobile results below are browser viewport inspection or explicit documented guidance—not real-device testing.

## Coverage and exact source register

| Mandatory product/pages | Evidence | Detailed record and captures |
|---|---|---|
| [Swapcard home](https://www.swapcard.com/), [overview](https://www.swapcard.com/platform/overview), [Exhibitor Center](https://www.swapcard.com/features/exhibitor-center) | D/M, public R, official lead table I | Enterprise S1–S7 including exact-URL supplement; [public hero](evidence/swapcard-exhibitor-public-desktop.png); Team's Contacts official image provenance in appendix |
| [Accelevents](https://www.accelevents.com/) | D/M and official mobile lead I | Enterprise A1–A4: ERC, attendee-app Lead capture, admin-app check-in |
| [Cvent OnArrival](https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software) | D/M/T | Enterprise C1–C4; [official tour](https://demo.cvent.com/clzlet96p002709mfbzvp7h7g) home simulation reached, later steps blocked |
| [Eventee](https://eventee.com/), [program](https://eventee.com/features/event-program), [registrations](https://eventee.com/features/registrations) | D/M/R/I | Attendee Eventee sections; [registration desktop](evidence/eventee-registrations-desktop.png), [mobile](evidence/eventee-registrations-mobile.png), [program desktop](evidence/eventee-program-desktop.png), [mobile](evidence/eventee-program-mobile.png) |
| [Whova](https://whova.com/) | X; indexed official excerpts only | Attendee Whova: [guide](https://whova.com/pages/attendee-guide), [FAQ](https://whova.com/resources/how-to-guide/whova-app-faq); direct pages/home 403 |
| [Luma](https://luma.com/), [discover](https://luma.com/discover) | D/R partial | Attendee Luma; actual public [event](https://luma.com/34xlox5w) read; [desktop](evidence/luma-discover-desktop.png), [mobile](evidence/luma-discover-mobile.png) |
| [Fourwaves](https://fourwaves.com/) and [event website](https://fourwaves.com/event-website/) | D/M/X browser | Attendee Fourwaves; reader succeeded, browser connection closed |
| [pretix](https://pretix.eu/about/en/), [check-in](https://pretix.eu/about/en/features/checkin) | D/M/I | Enterprise P1–P4; [Android guide](https://docs.pretix.eu/guides/pretixscan/android/), [authentic valid image](https://docs.pretix.eu/assets/screens/scan/valid.png) |
| [Config SF](https://config.figma.com/san-francisco/) and [agenda](https://config.figma.com/san-francisco/agenda/) | D/R partial | Attendee Config; [desktop](evidence/config-sf-desktop.png), [mobile](evidence/config-sf-mobile.png); current SF recap distinguished from root India event |
| [Slush](https://slush.org/) | D/R partial | Attendee Slush; [desktop](evidence/slush-desktop.png), [mobile](evidence/slush-mobile.png); linked 2025 program 404 |
| [Web Summit](https://websummit.com/), [schedule](https://websummit.com/schedule/) | D/R partial | Attendee Web Summit; [schedule desktop](evidence/websummit-schedule-desktop.png), [mobile](evidence/websummit-schedule-mobile.png) |
| [RSNA attendee resources](https://www.rsna.org/annual-meeting/attendee-resources) | D/R partial | Attendee RSNA; [desktop](evidence/rsna-resources-desktop.png), [mobile](evidence/rsna-resources-mobile.png) |

The additional sources are first-party help/tour pages of the requested products, not an inflated list of extra vendors. No extra competitors were necessary to resolve the current design categories. Library/font research appears in 05/07.

## Findings by platform

### 1. Swapcard — highest priority

**Observed:** authentic official Team's Contacts screenshot has contextual company/Event rail, four compact summaries, search, dense identity/organization/interaction/qualification/assignee table, pagination. The public Exhibitor Center hero is split value/action and media; public footer exposes separate Participant and Organizer entry. Media partially loaded. **Documented:** newer Event/Exhibitor Center toggle, Event/company switching, Lead Interactions side panel, qualification, team sharing and export. Old screenshot and new help instructions are not treated as one inspected release.

**Transfer:** `/booth/:boothId` gets compact scope, filterable Lead worklist and qualification drawer. Event setup groups Booth/staff/QR. **Adapt:** retain HOT/WARM/COLD, tags/notes and Booth-owned CSV; no assignee/score/meeting module added. **Avoid:** deep nested enterprise navigation and AI/marketplace suite breadth. Specific help says mobile-app export unavailable despite broad mobile marketing; distinguish task/device support.

**Desktop/mobile:** official desktop screenshot inspected; team portal login opened at 1440 and 390, no private workspace reached. Documented mobile review is not responsive test. No private Organizer dashboard, analytics interaction or lead transaction verified.

### 2. Accelevents — highest priority

**Observed:** first-party three-phone lead illustration shows Event/Booth entry, QR reticle, identity/notes/rating and broad Save; illustrated final screen says Add Lead Manually, not proof of automated population. **Documented:** ERC navigation/context switch, profile form with preview, booth Scan Lead→details→notes→Save→View Leads, repeat scan updates existing Lead, lead capture does not admit attendee. Admin check-in guide describes lookup, explicit status and device-specific staff paths.

**Transfer:** lead capture/qualification, Organizer setup grouping, Desk search. **Adapt:** no extra confirmation for fast gate scanning merely because another vendor has one; separate Booth/peer/admission scan contexts. **Avoid:** generic My QR route ambiguity explicitly warned about in guide; tasks/meetings/custom forms/hardware additions. Desktop ERC/mobile app capability differs; no live ERC, native scanner or offline lead guarantee established.

### 3. Cvent OnArrival

**Observed simulation:** official Navattic tour reached Organizer home with Event/Scan/Attendees/Stats, settings/register/sync tasks and Synced 6m ago. Values are synthetic tour data. Further Continue actions were blocked by guided overlay. **Marketing:** QR/lookup/registration/badge/kiosk/reporting claims, including reporting cadence; no actual printer/check-in used.

**Transfer:** Scanner preflight and status/freshness; Desk rapid lookup/issuance; Analytics refresh labeling. **Avoid:** wholesale badge/payments/session controls, extra navigation and interpreting “real time” as immediate consistency. The simulated phone frame does not establish live mobile/desktop, offline or touch behavior; learning-center body unavailable.

### 4. Eventee — highest priority

**Observed public desktop/mobile:** restrained white/mint system, strong benefit heading, two-column copy/registration illustration on desktop; collapsed menu and stacked CTAs on mobile. Program phone frame is an illustration. **Marketing/content:** website/app interfaces, registration/status/custom fields/program favorites/workshops; not exercised.

**Transfer:** Event identity near reservation, understandable registration/pass/arrival vocabulary, mobile attendee priorities. **Adapt:** personal Ticket/Network actions rather than marketing Try for free/Contact sales. **Avoid:** schedule/custom-fields/invitation/chat-like layers and huge staff headers. No attendee registration submission/private builder/native app/AA proof.

### 5. Whova

**Access:** homepage and guide/FAQ failed with 403; browser guide also forbidden. Official indexed snippets discuss registration-account identity, profile editing and Messages access. **Transfer with low confidence:** help users choose the account used for reservation, make identity explicit. **Avoid:** using inaccessible screens as a visual/style reference, social auth/chat/directory assumptions. No screenshot, desktop/mobile app UI or QR flow verified. Whova is deliberately not one of the five strongest references.

### 6. Luma

**Observed partial discovery:** compact thumbnail/name/location pairs, restrained headings/dividers, Discover/Sign In header; mobile popular/category ribbons with clipped continuation. Some metadata stayed skeletons. **Actual public Event content read:** organizer/cover/location, registration choice/availability/approval copy, About/arrival instructions; no reservation submitted. **Homepage content read:** create/discover/sign-in paths and repeated delight-themed headline variants; not rendered here.

**Transfer:** fact-first Event action, compact saved Booth/Connection content and minimal public shell. **Adapt:** free reservation/auth contract, not approval/waitlist/paid RSVP. **Avoid:** importing categories/city/calendars without API; essential actions in ribbons; page viewport metadata disabling scaling. Desktop/mobile discovery inspected; Event responsive and form errors not verified.

### 7. Fourwaves

**First-party content:** event microsite modules and organizer/participant/speaker grouping, website identity, bilingual claims and program/archive features. Reader succeeded; browser closed connection. **Transfer:** coherent Event foundation across Event/Booth/Ticket context; role-specific affordances. **Adapt:** current name/date/location/description and Booths only; persistent branding separate API. **Avoid:** abstracts/posters/AI/program/certification/translation-suite scope. No rendered desktop/mobile microsite/private editor tested.

### 8. pretix

**Observed image:** official Android valid state groups text/checkmark/ticket identity. **Documented:** independent Check-In lists, reasons for used/invalid/denied states, configured device/Event/gate, initial sync prerequisite, internal offline database and cross-device duplicate risk until reconciliation. **Transfer:** manifest readiness, explicit local/queued/server truth, duplicate reason and last sync. **Adapt:** current Check-In Point/Admission Policy, free Tickets, client UUID batches. **Avoid:** Order/payment expert menus and global offline single-use promises. Native image not live camera; no shop/device/account/offline experiment executed.

### 9. Config

**Observed partial SF recap:** black/white editorial hierarchy, uppercase task navigation, separated dates/location/modality, recap ribbon with pause; media incomplete. Public agenda content includes named timezone/stage/session metadata. **Transfer:** bounded Event identity and fact priority. **Avoid:** giant missing-media hero, moving ribbons at QR/reservation, copied artwork, current program/speaker routes. SF/root events differ; no agenda filter or account action exercised. Desktop/mobile captures are partial public-page evidence.

### 10. Slush

**Observed partial:** dark event-branded hero, clear Platform vs ticket action, high-impact title; zero-duration disabled media limits visual judgment. **Content:** audience/date/logistics, mixed-year program links; linked 2025 program returns 404. **Transfer:** unmistakable Event identity and separation of campaign from attendee workspace. **Avoid:** paid urgency, giant social proof metrics, video-heavy controls, startup matching or stale links. Desktop/mobile partial; no platform transaction.

### 11. Web Summit

**Observed partial public schedule:** heading, search, Highlights/day buttons, category/title/time/stage/speaker card ordering and pagination; mobile stack. Controls present but not operated. **Transfer now:** compact predictable content order to Booth/Connection/Ticket lists. **Future only:** schedule/filter/day/speaker IA. **Avoid:** promotional CTAs overwhelming task, whole mega-menu and truncated essential identity. Missing assets and timeouts disclosed; no search correctness/agenda/user-account proof.

### 12. RSNA

**Observed partial:** institutional hierarchy, breadcrumb, left annual-meeting nav and two-column resource rows; mobile compact header/stack with overly large intro before first action. **Content:** concrete preparation tasks and fallback contact. **Transfer:** short practical QR/arrival/access guidance where current data exists. **Avoid:** medical-only/CME/travel/visa/pricing workflows and society-wide nav. No downstream resource/registration action; missing assets mean no complete art-direction claim.

## Cross-cutting evidence conclusions

- Most trustworthy patterns: Swapcard official dense Lead screenshot; Accelevents documented capture/admission separation; pretix detailed offline limitations; Luma directly rendered compact hierarchy; Eventee consistent public responsive composition.
- Most important counterexamples: Whova access blocked; Slush stale program; vendor marketing/mobile scope conflicts; incomplete media; guided simulations with restricted progression. They are evidence limitations, not automatically product defects.
- No product receives a numerical usability, accessibility, performance or RTL score from these materials. Design suitability judgments are in 03/04.
- Public/Event art direction can be ambitious without adding entities. Private staff workflows require source/contract alignment and independent local validation.
- Authentic screenshots are research artifacts only. Browser viewport CSS dimensions differ from output pixel dimensions because device scale is 1.25. Retained `.png` evidence file headers were checked with Pillow and are PNG encoded; displayed tool previews may use WebP separately. Signed help-image links may expire: owning articles are canonical.

## Mandatory boundaries for reuse

Keep free-ticket V1/V2, original Entity QR payload, quotas/admission policy, auth/isolation, idempotent scan IDs/durable queue, Booth-owned Lead updates/CSV, private notes/vCard. No payments/CME/AI/chat/program/speaker module is adopted. Refer to 06 for exact route adaptations and 08 for safe migration and contract gates. No claimed observed private/dashboard behavior exceeds the linked evidence.
