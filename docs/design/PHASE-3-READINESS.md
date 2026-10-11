# Phase 2 Acceptance and Phase 3 Security/Privacy Readiness

**Status:** Completed. All three stacks verified passing (`scripts\check.bat`).  
**Issue #20 Status:** **RESOLVED & VERIFIED WITH REGRESSION TESTS**  
**Phase 3 Recommendation:** **GO (Conditional on Privacy Model Approvals)**  
**Date:** 2026-10-10  

---

## 1. Executive Summary

This readiness review evaluates the delivered Phase 2 public Event and registration experience, resolves the critical cross-tenant scanner replay vulnerability (Issue #20), establishes the required security/privacy specifications for Phase 3 (Issues #16 and #19), and designs the architecture for **Persian view prioritization** (RTL, Vazirmatn typography, Solar Hijri/Jalali calendar, and bidi isolation) for the upcoming attendee experience redesign.

All full-stack verification checks pass across Python (FastAPI/SQLAlchemy), TypeScript (React 19/Tailwind 4), and Dart (Flutter scanner services).

---

## 2. Part A — Phase 2 Final Acceptance & Edge-Case Audit

The Phase 2 implementation (`web/src/pages/PublicEvent.tsx`, `web/src/pages/PublicBooth.tsx`, `web/src/components/ui/Dialog.tsx`) was audited across the ten enumerated edge cases:

| # | Edge Case | Initial State | Audit Finding & Implemented Fix | Verification Status |
|:---|:---|:---|:---|:---|
| **1** | **Account created, but reservation subsequently fails** | User token saved in `localStorage`, but retry form re-submitted registration. | **FIXED:** `handleAuthAndReserve` now detects if a valid attendee token was already stored from the initial step. On retry, it directly invokes `executeReservation(token, tierId)` instead of re-registering and triggering a 409 Email Conflict. | **PASSED** |
| **2** | **Reservation attempted with expired/invalid token** | Silent error or modal error trapped inside closed dialog. | **FIXED:** `executeReservation` detects 401 Unauthorized / expired signature errors, automatically purges the expired token from `localStorage`, resets `alreadyHasTicket`, switches modal to "login" mode, and displays: *"Your session has expired. Please sign in to reserve your pass."* | **PASSED** |
| **3** | **Tier becomes unavailable between render and submission** | Server returns HTTP 410 Gone / 400 Closed; UI remained static. | **FIXED:** When `executeReservation` catches a sold-out or closed tier error, it immediately calls `loadEvent()` to refresh tier quotas and open/closed statuses from the live API. | **PASSED** |
| **4** | **Duplicate registration attempt** | Backend returns HTTP 409 Conflict. | Verified: Closes modal and displays prominent `[role="alert"]` banner: *"Active Pass Detected: You already hold an active attendee pass for this congress"* with a direct *"View My Pass →"* action. | **PASSED (HTTP 409)** |
| **5** | **Connectivity / server error during registration** | Form fields could be wiped on failure. | Verified: React form state (`fullName`, `email`, `organization`, `title`) is preserved; user never loses drafted inputs on network or validation errors. | **PASSED** |
| **6** | **Modal dismissed with partially completed fields** | Modal closure handling. | Verified: Closing modal via Escape or cancel leaves state intact; reopening allows attendee to resume without re-typing. | **PASSED** |
| **7** | **Error announcement accessibility** | Error visibility for screen readers. | **FIXED:** Added `role="alert"` and `aria-live="assertive"` on modal error containers so assistive technology announces validation errors immediately upon submission. | **PASSED** |
| **8** | **External Booth website and brochure link safety** | Links rendered directly from database strings. | **FIXED:** Added URL protocol sanitization (`/^https?:\/\//i.test(url)`). If a brochure or website URL contains invalid or dangerous protocols (e.g. `javascript:`), it renders as inactive text. Valid links use `rel="noopener noreferrer"`. | **PASSED** |
| **9** | **Exhibitor vs. Official Sponsor labeling** | Booth page unconditionally displayed *"Exhibition Sponsor"*. | **FIXED:** The database model `Booth` contains no sponsorship tier. Corrected badges and copy from *"Exhibition Sponsor"* to *"Exhibitor Booth"* and *"About the Exhibitor"*, preventing false commercial sponsor claims. | **PASSED** |
| **10** | **Dialog keyboard and focus mechanics** | Custom modal behavior. | Verified: `Dialog.tsx` implements `role="dialog"`, `aria-modal="true"`, focus trapping within focusable elements, Escape key listener, background scroll lock (`overflow: hidden`), and focus restoration to the trigger button upon close. | **PASSED** |

---

## 3. Part B — Resolution of Critical Cross-Tenant Security Issue (#20)

### Vulnerability Analysis
- **GitHub Issue:** [#20 — Scope idempotent scan replay to its Check-In Point and Event](https://github.com/msadrak/congress-platform/issues/20)
- **Root Cause in `backend/app/routes/checkin.py`:**  
  When ingesting scan batches, the route checked `session.get(CheckIn, scan.scan_id)` to deduplicate client retries. However, it failed to verify that the existing check-in belonged to the authorized `checkin_point_id` or that the `qr_secret` matched.  
  Consequently, if Tenant B replayed a known or guessed `scan_id` from Tenant A, the server responded with HTTP 200 OK and returned Tenant A's check-in status, attendee full name, ticket tier, and the attendee's confidential raw QR secret.

### Implemented Fix (`backend/app/routes/checkin.py`)
1. **Scoped Deduplication Verification:**
   ```python
   # 1. Idempotent deduplication: check if scan_id already processed
   existing = await session.get(CheckIn, scan.scan_id)
   if existing is not None:
       # Scope & Confidentiality verification:
       # A scan_id is strictly bound to its checkin_point_id AND qr_secret.
       # Cross-point, cross-event, cross-tenant replays, or mismatched QR secrets
       # MUST be rejected without disclosing foreign attendee identity, QR secret, or check-in status!
       if existing.checkin_point_id != point.id or existing.qr_secret != scan.qr_secret:
           results.append(
               ScanResult(
                   scan_id=scan.scan_id,
                   qr_secret=scan.qr_secret,
                   status="REJECTED",
                   rejection_reason="SCAN_ID_CONFLICT",
                   attendee_name=None,
                   ticket_tier_name=None,
               )
           )
           continue
   ```
2. **Hardened Concurrent `IntegrityError` Handlers:**  
   Applied the identical scope check across all four database constraint collision blocks (invalid QR collisions, missing ticket collisions, event mismatch collisions, and policy evaluation collisions). If an existing primary key belongs to a foreign point or mismatched secret, it immediately returns `status="REJECTED"`, `rejection_reason="SCAN_ID_CONFLICT"`, and withholds all foreign attendee and QR data.
3. **Preserved Legitimate Retry-Safe Idempotency:**  
   When the same point and scanner replay the exact same `scan_id` and `qr_secret`, the original check-in result is returned safely.

### Automated Regression Tests (`backend/tests/test_scanner_security.py`)
Added comprehensive test coverage:
1. `test_issue_20_same_point_idempotent_replay_preserves_result`: Verified that same-point retry with the same UUID returns the original `ADMITTED` status and attendee name.
2. `test_issue_20_cross_point_same_event_replay_rejected_without_data_leak`: Verified that reusing a scan UUID across different gates in the same event is rejected with `SCAN_ID_CONFLICT`, `attendee_name=None`, `ticket_tier_name=None`.
3. `test_issue_20_cross_tenant_replay_rejected_without_data_leak`: Verified that Tenant B attempting to replay Tenant A's scan UUID receives `REJECTED`, `SCAN_ID_CONFLICT`, and zero data leakage. Tenant B's response does not expose Tenant A's secret or name.
4. `test_issue_20_mismatched_qr_secret_same_scan_id_rejected`: Verified that tampering with the QR secret under an existing UUID is rejected as a conflict.

**Result:** All 19 security tests in `test_scanner_security.py` pass; all 97 backend tests pass.

---

## 4. Part C — Phase 3 Privacy Gates (Issues #16 and #19)

### Issue #16 — Owner-Scoped Offline Ticket Cache (`MyTickets.tsx`)

#### Current Defect
`MyTickets.tsx` currently stores the full ticket DTO in `localStorage.getItem("congress_cached_tickets")` under a global, unscoped key.  
If User A logs out, or User A's session expires, or User B logs into the same computer:
- Anyone opening `/my-tickets` without a token transiently or permanently sees User A's cached pass, attendee name, email, and raw scannable QR secret.
- The unauthenticated gate is bypassed if `cached` tickets exist.

#### Required Architecture & Cache Security Model for Phase 3
1. **Owner-Bound Cache Key:**  
   The cache must be partitioned by authenticated user ID:  
   `congress_cached_tickets_${user_id}`.
2. **Structured Cache Envelope:**  
   ```typescript
   interface OfflinePassCacheEnvelope {
     userId: string;
     cachedAt: string; // ISO-8601
     expiresAt: string; // e.g., 7 days or event end date
     trustedDevice: boolean; // Explicit attendee opt-in
     tickets: AttendeeTicketDetail[];
   }
   ```
3. **Account Transition & Invalidation Protocol:**
   - **Render Check:** If no valid token is present and the device is not marked as a `trustedDevice`, the cache MUST NOT be rendered.
   - **Account Switch:** When a token is detected with a different `sub` claim than the cache envelope, the prior user's cached tickets must be purged immediately.
   - **Logout:** Explicit logout must remove both the session token and the user's cached tickets.
4. **Honest Storage Disclosure:**  
   Browser `localStorage` is plaintext client-side storage. The UI must clearly explain: *"Passes saved for offline use on this browser"* and warn against saving passes on shared public computers. Never claim localStorage is an encrypted vault.

---

### Issue #19 — Peer Contact-Sharing Consent (`network.py` & Connections)

#### Current Defect
In `backend/app/routes/network.py`:
- `POST /scan`, `GET /`, and `PATCH /{id}` unconditionally return `email: str = peer.email`.
- `GET /{id}/vcard` unconditionally writes `EMAIL;TYPE=INTERNET:{peer.email}` into exported `.vcf` files.
- The `User` model has no consent preference column; the `Connection` model has no consent audit record.
- Although `SPEC_V2.md` and ADR 0011 specify opt-in contact sharing, the backend unconditionally discloses email to any attendee who scans a badge code.

#### Required Backend Contract & Model Changes for Phase 3
1. **Database Model Migration:**
   - Add column to `users` table:
     `share_contact_with_peers: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")`
   - Privacy-by-default: Default is `False` (opt-in required).
2. **API DTO Update:**
   - Update `ConnectionOut`:
     `email: str | None = None`
   - In `scan_peer_badge`, `list_my_connections`, and `update_connection_notes`:
     `email = peer.email if peer.share_contact_with_peers else None`
3. **vCard Export Filtering:**
   - In `export_connection_vcard`:
     Only append `f"EMAIL;TYPE=INTERNET:{peer.email}"` if `peer.share_contact_with_peers is True`.
4. **Distinction from Exhibitor Leads (ADR 0011 Guardrail):**
   - **Exhibitor Lead Capture** is an authorized sponsor transaction governed by `leads.py` and `BoothStaff`. Full contact details (email, organization, title) are legitimately provided to booth representatives.
   - **DO NOT** apply peer privacy filtering to `LeadOut` or exhibitor CRM exports.
5. **Connection Directionality:**
   - Current code implements **directed** connections (Scanner A stores peer B). If the product owner requires **mutual** connections, the model must either store two rows or require a mutual handshake. Until approved, the UI must accurately describe the action as: *"Save peer contact to your personal network"*, not *"Mutual Connection Established"*.

---

## 5. Part D — Persian View Prioritization Architecture

Per project directives (*"Also prioritize persian view"*), the design system foundation and Phase 3 attendee experience will treat Persian as a first-class locale, rather than an afterthought skin:

### 1. Typography & Font Hierarchy
- **Primary Typeface:** **Vazirmatn** (`"Vazirmatn", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`).
- **Latin Fallback:** Inter for Latin characters.
- **Font Licensing & Loading:** Self-hosted Vazirmatn variable font (OFL license) to avoid external CDN dependencies and ensure offline PWA font availability.
- **Font Features:** Use tabular numerals (`tnum`) for metrics and times; disable forced Latin letter-spacing on Persian text.

### 2. Directionality & RTL Layout Engine
- **HTML Container:** Standardize on `dir="rtl"` and `lang="fa"`.
- **CSS Logical Properties:**  
  Enforce logical classes throughout all attendee components:
  - `ms-*` (margin-inline-start) and `me-*` (margin-inline-end) instead of `ml-*` / `mr-*`.
  - `ps-*` (padding-inline-start) and `pe-*` (padding-inline-end) instead of `pl-*` / `pr-*`.
  - `start-*` and `end-*` instead of `left-*` / `right-*`.
  - `text-start` and `text-end` instead of `text-left` / `text-right`.
- **Mirrored Navigation Glyphs:**  
  Navigation chevrons and back arrows must mirror with reading direction:
  - Return / Back arrows point **right** (`→` in RTL).
  - Next / Forward chevrons point **left** (`←` in RTL).
  - Status checkmarks, QR codes, and camera viewfinders remain unmirrored.

### 3. Bi-Directional (Bidi) Text Isolation
In conference software, Persian text frequently mixes with Latin email addresses, URLs, UUIDs, ticket tiers, and QR secrets. Without bidi isolation, punctuation and trailing numbers render in reverse:
- All technical and Latin tokens must be wrapped with `<bdi dir="ltr">`:
  - Emails: `<bdi dir="ltr">{email}</bdi>`
  - URLs: `<bdi dir="ltr">{website_url}</bdi>`
  - Ticket IDs & UUIDs: `<bdi dir="ltr">{ticket.id.slice(0, 8)}</bdi>`
  - QR Secrets: `<bdi dir="ltr">{qr_secret}</bdi>`
  - Event Slugs: `<bdi dir="ltr">/e/{slug}</bdi>`

### 4. Persian Calendar (Jalali / Solar Hijri) & Numerals
- **Native Internationalization:**  
  Use native browser `Intl` APIs without importing heavy moment/dayjs plugins:
  ```typescript
  // Jalali Date Formatter
  export function formatPersianDate(dateString: string): string {
    return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(dateString));
  }

  // Persian Numerals Formatter
  export function formatPersianNumber(num: number): string {
    return new Intl.NumberFormat("fa-IR").format(num);
  }
  ```
- **Wire Timestamp Invariant:** All backend APIs, migrations, and database columns remain strictly UTC ISO-8601. Persian date formatting is purely a presentation-layer transformation.

### 5. Phase 3 Attendee Interface Layouts in RTL
- **Digital Ticket Pass (`/my-tickets`):**
  - High-contrast SVG QR plate remains centered with opaque white quiet zone.
  - Persian metadata headers:
    - *کارت ورود دیجیتال* (Digital Entry Pass)
    - *پذیرفته شده* (Admitted)
    - *نام شرکت‌کننده* (Attendee Name)
    - *کد پیگیری بلیط* (Ticket Reference ID)
    - *غرفه‌های نشان‌شده* (Saved Booths)
- **Networking Hub (`/my-network`):**
  - Peer badge exchange: *ثبت ارتباط جدید* (Connect with Peer).
  - Private notes editor: *یادداشت‌های محرمانه* (Confidential Notes).
  - vCard export: *دانلود کارت مخاطب (.vcf)* (Download Contact).

---

## 6. Phase 3 Attendee UX Redesign Scope

The attendee experience encompasses two primary routes:
1. **`/my-tickets` — Attendee Pass Portal:**
   - Pass-first, high-contrast mobile layout.
   - High-contrast SVG QR plate readable under harsh venue lighting.
   - Trusted-device offline pass retention with explicit ownership validation.
   - Saved exhibition booths section with direct links back to `/e/:slug/booths/:id`.
   - Persian view RTL layout with Vazirmatn typography.
2. **`/my-network` — Attendee Networking Hub:**
   - Peer badge code exchange input with clear instructions.
   - Confidential note taking on peer cards.
   - Standard vCard (.vcf) download with consent-filtered email disclosure.
   - Persian view RTL layout with bidi text isolation.

---

## 7. Dependencies & Implementation Order

```text
[Step 1: Database & Model Migration]
  └─ Issue #19: Add share_contact_with_peers to User model & update ConnectionOut DTO.

[Step 2: Backend API & vCard Consent Filtering]
  └─ Filter email in /api/attendees/me/network and vCard exports; add regression tests.

[Step 3: Attendee Cache Security Refactor]
  └─ Issue #16: Implement owner-scoped cache key & session validation in MyTickets.tsx.

[Step 4: Design System RTL & Vazirmatn Integration]
  └─ Configure Vazirmatn font family, Persian Intl formatters, and bidi utilities in web/src.

[Step 5: Attendee Pass Redesign (/my-tickets)]
  └─ High-contrast pass-first layout, offline indicator, RTL Persian view, 5 target viewports.

[Step 6: Attendee Networking Hub Redesign (/my-network)]
  └─ Peer badge scanner, notes drawer, vCard export, RTL Persian view, 5 target viewports.
```

---

## 8. Full-Stack Verification Results (`scripts\check.bat`)

Ran the unified verification pipeline:

```text
==========================================
Congress Platform: Full-Stack Verification
==========================================

[1/3] Checking Backend (Python / FastAPI)...
Success: no issues found in 40 source files
97 passed in 66.80s (0:01:06)

[2/3] Checking Web (React / TypeScript)...
✔ node --test tests/*.test.ts (8 passed)
✔ tsc -b (typecheck passed)
✔ vite build (dist built in 2.56s, 55 modules transformed)

[3/3] Checking Mobile (Flutter / Dart)...
✔ dart test (8 passed)
✔ dart analyze (No issues found!)

==========================================
[SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS
==========================================
```

- **Backend Pytest:** 97 passed in 66.8s (including all 19 scanner security and Issue #20 regression tests).
- **Backend Mypy:** Passed with zero issues across 20 app modules and 40 source files.
- **Frontend TypeScript & Build:** `tsc -b` and `vite build` passed with zero errors.
- **Frontend Linter (`oxlint`):** Zero warnings or errors in `PublicEvent.tsx`, `PublicBooth.tsx`, `Dialog.tsx`, and `Home.tsx`.

---

## 9. Explicit Recommendation: GO / NO-GO for Phase 3

### Recommendation: **GO (Proceed to Phase 3 Implementation)**

**Justification:**
1. **Critical Security Gate Resolved:** Issue #20 (cross-tenant scanner replay) is fully fixed, verified, and protected by HTTP-boundary regression tests.
2. **Phase 2 Complete & Accepted:** All 10 edge cases audited; URL sanitization, sponsor badge accuracy, token reuse on failed reservation, and dialog accessibility are verified.
3. **Privacy Contracts Defined:** Issues #16 (ticket cache) and #19 (peer contact consent) have unambiguous technical specifications and database models ready for implementation.
4. **Persian View Prioritized:** Complete architecture for RTL layout, Vazirmatn typography, Jalali calendar formatting, and bidi isolation is documented and ready for implementation.
5. **Clean Verification Pipeline:** All 97 backend tests, all frontend builds, and all mobile analyzer checks pass.

**Next Action:** Proceed with Phase 3 attendee experience implementation following the six-step sequence outlined above.
