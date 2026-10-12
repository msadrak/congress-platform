# 02 — Acceptance Criteria, Verification Matrix & Handoff Blueprint

**Status:** ARCHITECTURAL DESIGN (Planning Only — Implementation Prohibited)  
**Role:** Principal Software Architect + Quality Assurance Lead  
**Prerequisite:** Phase 00 Baseline Audit, Phase 01 Decisions, Phase 02 Architecture Blueprints

---

## 1. Client Requirement Traceability Matrix (CR-01 to CR-11)

Every client requirement is mapped directly to its target Portal, Screen, UI Interaction, API Dependency, and Verifiable Acceptance Criterion:

| Req ID | Client Requirement | Target Portal | Primary Screen | UI Interaction | API Dependency | Verifiable Acceptance Criterion |
|---|---|---|---|---|---|---|
| **CR-01** | Public congress landing page | Public | `/e/:slug` (`PublicEventPage`) | Visitor scrolls overview, views venue, dates, speakers, and opens registration modal | `GET /api/public/events/{slug}` | Page renders publicly without credentials; displays Solar Hijri & Gregorian dates; registration modal submits successfully |
| **CR-02** | Four distinct user experiences (Admin, Attendee, Reception, Partner) | All | `OrganizerShell`, `AttendeeShell`, `ReceptionShell`, `PartnerShell` | User accesses dedicated, tailored layout designed specifically for their role | Scoped API endpoints | Each user role operates within their own distinct shell; zero mixing of administrative tools into attendee or reception views |
| **CR-03** | Role-based portal access | Core Router | Portal Router / Auth Gate | User logs in; system resolves eligible portals; auto-selects if single, opens chooser if multiple | `GET /api/me/access` (D02) | Multi-role user can switch portals seamlessly; single-role user auto-enters; zero unauthorized portal access |
| **CR-04** | Clear and secure authentication | Core Auth | `AuthContext` & Login Modals | Explicit credential resolution (`credentialFor`); no heuristic guessing | Scoped Auth Endpoints | Pathname-guessing heuristic in `client.ts` completely removed; master API key never leaks to public or attendee endpoints |
| **CR-05** | Organizer-managed reception operator access | Organizer & Reception | `/organizer/events/:id#operators` & `/desk` | Organizer provisions operator; operator logs into `/desk`; organizer revokes access instantly | `POST /desk/operators`, `POST .../revoke`, `POST /desk/login` | Operator issues tickets with attribution; upon revocation, next request returns 401 and immediately terminates session |
| **CR-06** | Configurable attendee categories/types | Organizer & Attendee | `/organizer/events/:id#types` & `/my-profile` | Organizer creates types (Physician, Student, VIP); attendee sees badge on ticket & profile | `POST/GET/PATCH .../attendee-types` | Types are event-scoped; orthogonal to quotas; display order respected; visible on digital pass |
| **CR-07** | Mobile-first, shallow, tab-oriented portal navigation | Attendee | `AttendeeShell` (Bottom Nav) | 1-tap switching among 5 primary tabs; maximum navigation depth $\le 2$ | All Attendee APIs | Fixed bottom nav visible on mobile; touch targets $\ge 48 \times 48$ px; zero nested tab-inside-tab clutter |
| **CR-08** | Attendee portal with exactly five primary tabs | Attendee | 5 Primary Tabs (`My Congress`, `My Network`, `My Ticket`, `My Profile`, `Congress Details`) | Persistent bottom navigation bar across all attendee screens | Attendee Endpoints | Exactly 5 top-level tabs exist; canonical English IDs and localized Persian labels match specification |
| **CR-09** | Partner listing within My Congress | Attendee | Tab 1 (`My Congress`) | In-place filterable partner directory with bookmark toggles and brochure downloads | `GET .../partners`, `POST .../bookmarks/booths` | Partners discovered directly inside Tab 1; boothless sponsors display cleanly; zero need to leave attendee portal |
| **CR-10** | Avoid unnecessarily nested page navigation | All | All Portals | Contextual modal drawers and tabs replace deep multi-level URL paths | All APIs | Max URL depth $\le 3$; major actions open in shallow bottom sheets; back button returns to parent tab |
| **CR-11** | Preserve existing registration, QR, networking, lead, and check-in | All | All Portals | Legacy printed QR codes, offline pass cache, USB gate scanners, and lead CSV export remain 100% operational | Preserved backend APIs | 131 backend tests remain green; offline pass displays during network drop; gate scanner syncs offline batches |

---

## 2. Security Requirements & Authority Checklist

| # | Security Invariant | Frontend Enforcement | Authoritative Backend Enforcement | Test Verification |
|:---:|---|---|---|---|
| **S1** | **Tenant Isolation** | UI displays only events belonging to active organizer | `OwnedEventDep` masks foreign events with HTTP 404 | `test_events.py` |
| **S2** | **Desk Operator Revocation** | `useDeskSession` catches 401 and flushes session | `desk.py:196-201` checks `is_revoked` on every request | `test_desk_operator_auth.py` |
| **S3** | **Commercial Lead Isolation** | Partner portal renders only user's assigned booth | `AuthorizedBoothDep` checks `BoothStaff` row, returns 403 on foreign booths | `test_leads.py` |
| **S4** | **Hardware Scanner Device Revocation** | Device HUD shows red "Device Revoked" banner | `checkin.py:277-290` checks `ScannerDevice.is_revoked` via `jti` claim | `test_scanner_revocation_matrix.py` |
| **S5** | **Offline Pass Tamper Evidence** | `ticketCache.ts` validates owner signature & TTL | EntityQR 128-bit CSPRNG secret cannot be guessed | `ticketCache.test.ts` |
| **S6** | **Credential Separation** | Explicit `credentialFor(portal, event)` selects token | Authorizers validate token `type` claim (`desk_operator`, `scanner`, user) | Negative Matrix Scenario 11 |
| **S7** | **CSV Formula Injection Prevention** | Export button triggers download | `security.sanitize_csv_cell` escapes `=`, `+`, `-`, `@` characters | `test_csv_security.py` |

---

## 3. UX Journey Test Matrix (J01 to J18)

| Journey | Description | Entry URL | Primary Assertion | Expected Pass Criteria |
|:---:|---|---|---|---|
| **J01** | First-time attendee self-registration | `/e/:slug` | Free ticket minted; JWT issued | Redirects to `/c/:slug/my-ticket` with high-contrast QR pass |
| **J02** | Returning attendee opens My Congress | `/my-congress` | Auto-resolves active event | Tab 1 renders personalized greeting and partner directory |
| **J03** | Attendee presents QR at entrance gate | Tab 3 (`/my-ticket`) | High-contrast QR visible | Scanner detects code in $< 1$s; works offline via `ticketCache.ts` |
| **J04** | Attendee connects with fellow delegate | Tab 2 (`/my-network`) | Scans peer badge | Connection added with private notes; `.vcf` vCard downloads |
| **J05** | Attendee bookmarks exhibition partner | Tab 1 (`My Congress`) | In-place bookmark toggle | Booth star turns active; added to saved items carousel |
| **J06** | Multi-event attendee switches congress | Header Event Pill | Congress Picker Sheet | Active event switches seamlessly; URL updates to `/c/:newSlug/*` |
| **J07** | Organizer provisions reception operator | `/organizer/events/:id` | Desk staff modal | Operator created; temporary password displayed; row appears in table |
| **J08** | Reception operator logs into desk station | `/organizer/events/:id/desk`| Desk login modal | Event-scoped token issued to `sessionStorage`; station unlocks |
| **J09** | Reception operator registers walk-in | Reception Station | Rapid registration form | Pass minted with attribution in $< 5$s; QR pass displayed |
| **J10** | Reception operator handles duplicate | Rapid registration form | Existing attendee email | 409 Conflict triggers auto-lookup; allows re-printing existing pass |
| **J11** | Organizer revokes desk operator | Desk Staff Manager | Revoke button clicked | Database sets `is_revoked = True`; operator's next request fails 401 |
| **J12** | Partner representative logs into booth | `/booth/:boothId` | Partner login modal | Validates `BoothStaff` row; unlocks booth lead workspace |
| **J13** | Partner representative captures lead | Partner Workspace | Lead scanner drawer | Delegate badge scanned; rating (`HOT`) and notes saved to CRM |
| **J14** | Sponsor-only partner accesses portal | Partner Workspace | Booth capability check | Lead scanner cleanly hidden; corporate profile editor displayed |
| **J15** | Multi-role user switches portal | Portal Switcher | Header Switcher menu | Transitions between Organizer and Attendee without logging out |
| **J16** | Unauthorized user opens deep link | `/organizer/events/123` | Route Auth Guard | Blocks data fetching; displays Organizer Key Gate dialog |
| **J17** | Printed standee QR code scanned | `/e/:slug/booths/:boothId`| Physical QR scan | Opens company brochure and standee profile without redirection |
| **J18** | Desk session expires during registration | Reception Station | Background 401 handler | Form draft preserved; re-auth dialog prompts password; auto-resubmits |

---

## 4. Mobile Viewport & Responsiveness Test Matrix

Every view must pass visual verification and interactive testing across all 7 target viewports:

| Viewport Width | Target Device Archetype | Bottom Nav Labels | Columns | Touch Target Min | Modal Presentation |
|:---:|---|---|:---:|:---:|---|
| **320px** | iPhone SE (1st gen) | Compact single-word (10px) | 1 col | $48 \times 48$ px | Fullscreen Overlay (`w-full h-full`) |
| **375px** | iPhone 8 / SE2 / SE3 | Standard concise (11px) | 1 col | $48 \times 48$ px | Bottom Sheet Drawer (`rounded-t-2xl`) |
| **390px** | iPhone 12/13/14/15 | Standard concise + Safe Area | 1 col | $48 \times 48$ px | Bottom Sheet Drawer (`rounded-t-2xl`) |
| **430px** | iPhone 14/15 Pro Max | Full labels + Safe Area | 1 col | $48 \times 48$ px | Bottom Sheet Drawer (`rounded-t-2xl`) |
| **768px** | iPad Mini (Portrait) | Compact Top / Split Bar | 2 col | $44 \times 44$ px | Centered Modal Dialog (`max-w-lg`) |
| **1024px** | iPad Pro / Small Laptop | Right Side Rail (RTL) | 2 col | $44 \times 44$ px | Centered Modal Dialog (`max-w-xl`) |
| **1440px** | Desktop Workstation | Full Right Sidebar (RTL) | 3 col | $44 \times 44$ px | Centered Modal or Slide-out Drawer |

---

## 5. Unresolved Assumptions & Open Client Decisions

These product decisions must be explicitly reviewed with the client prior to Phase 03 implementation:

| Decision ID | Topic | Current Architectural Assumption | Client Confirmation Required | Risk if Assumption is Wrong |
|---|---|---|---|---|
| **UA-01** | **Admin Semantics** (D01) | "Admin" refers to Event Organizer managing their congress tenant | Does the client require a super-platform admin UI above event organizers? | Minor: would require adding a platform-admin shell for tenant provisioning |
| **UA-02** | **Attendee Type Pricing** | Attendee Type is a taxonomy label (Speaker, VIP, Student), not a priced ticket tier | Does the client intend for Attendee Types to have separate quotas or payment gates? | Moderate: if types have quotas, they must merge into TicketTier logic |
| **UA-03** | **Multiple Congress Default** | When an attendee opens `/my-congress` with 3 tickets, the app prompts with a Congress Picker | Should the system auto-select the chronologically nearest upcoming congress instead? | Minor UX tweak in `activeEventId` auto-resolver |
| **UA-04** | **Profile Editing Scope** | Attendee can edit organization and title, but name and email are read-only | Should attendees be allowed to change their full name after badge issuance? | Low: backend `PATCH /api/auth/me` can be expanded if requested |
| **UA-05** | **Partner Hierarchy** (D06) | Option C: Partner entity added; existing booths linked 1:1; boothless sponsors supported | Does a single partner organization need multiple booths at one event? | Low: Option C already supports 1-to-many partner-to-booth relationships |

---

## 6. Implementation Handoff & Work Breakdown Packages for Phase 03

To enable an implementation team (or coding agents) to implement components independently without architectural ambiguity, the work is partitioned into **six self-contained implementation packages**:

### Package P1: Core Routing, Shells & Auth Infrastructure
- **Files to Create:** `src/auth/AuthContext.tsx`, `src/auth/credentialResolver.ts`, `src/layouts/AttendeeShell.tsx`, `src/layouts/ReceptionLayout.tsx`, `src/layouts/PartnerLayout.tsx`, `src/app/routes.tsx`.
- **Primary Goal:** Set up the 5 shells and replace `client.ts:56-83` heuristics with explicit credential resolution.
- **Verification:** Unit tests in `authContext.test.ts`; smoke test navigating between shells.

### Package P2: Attendee Portal (The 5 Tabs)
- **Files to Create:** `src/portals/attendee/MyCongressPage.tsx`, `src/portals/attendee/MyNetworkPage.tsx`, `src/portals/attendee/MyTicketPage.tsx`, `src/portals/attendee/MyProfilePage.tsx`, `src/portals/attendee/CongressDetailsPage.tsx`.
- **Primary Goal:** Integrate bottom navigation bar; embed partner directory in Tab 1; reuse `ticketCache.ts` in Tab 3; reuse peer vCard export in Tab 2.
- **Verification:** Viewport responsiveness tests at 320px and 390px; offline pass rendering.

### Package P3: Reception Portal & Fast Registration
- **Files to Create:** `src/features/desk-operations/RapidRegistrationForm.tsx`, `src/features/desk-operations/LiveAttendeeSearch.tsx`, `src/features/desk-operations/MintedPassSummaryModal.tsx`, `src/portals/reception/ReceptionStationPage.tsx`.
- **Primary Goal:** Sub-second keyboard-optimized walk-in registration with operator attribution; instant duplicate detection.
- **Verification:** `test_desk_operator_auth.py` and `test_desk_registration.py` pass; duplicate flow reprints pass.

### Package P4: Partner Portal & Lead Retrieval
- **Files to Create:** `src/features/partners/PartnerProfileCard.tsx`, `src/features/partners/BoothLeadScanner.tsx`, `src/features/partners/LeadQualificationDrawer.tsx`, `src/features/partners/LeadCsvExportButton.tsx`, `src/portals/partner/PartnerWorkspacePage.tsx`.
- **Primary Goal:** Decompose `ExhibitorPortal.tsx`; support sponsor-only partners (`booth_id === null`); lead qualification feed and CSV export.
- **Verification:** `test_leads.py` passes; CSV formula sanitization verified.

### Package P5: Organizer Portal Decomposition & Attendee Types
- **Files to Create:** `src/features/organizer/EventOverviewSection.tsx`, `src/features/organizer/TicketTierManager.tsx`, `src/features/organizer/AttendeeTypeManager.tsx`, `src/features/organizer/DeskStaffManager.tsx`, `src/features/organizer/PartnerBoothManager.tsx`.
- **Primary Goal:** Break down `OrganizerEventDetail.tsx` (1,981 lines) into focused domain managers; add Attendee Type CRUD (CR-06).
- **Verification:** `test_ticket_tiers.py`, `test_checkin.py`, `test_booths.py` pass.

### Package P6: Quality Assurance, RTL Polishing & E2E Verification
- **Files to Update:** `src/lib/i18n.ts`, responsive styling tests, Playwright e2e suites.
- **Primary Goal:** Verify Persian RTL layout across all portals; ensure WCAG 2.2 AA compliance; execute full verification script (`scripts/check.sh` / `scripts/check.bat`).
- **Verification:** 100% full-stack tests pass with zero regressions.
