# Phase 3 Implementation Report — Attendee Experience, Privacy Hardening & Persian-First UI

**Status:** Completed. All three stacks verified passing (`scripts\check.bat`).  
**Design Direction:** Direction A — Refined Minimal SaaS with an Expressive Event Layer.  
**Language & Orientation:** Persian-First RTL (`dir="rtl"`) with Vazirmatn typography, Solar Hijri (Jalali) calendar, and bidi isolation, plus full English LTR toggle.  
**Date:** 2026-10-10.  

---

## 1. Executive Summary

Phase 3 accomplishes two strictly separated stages:
1. **Stage A (Privacy & Security Hardening):**
   - **Resolved Issue #16 (Owner-Scoped Ticket Cache):** Transitioned `MyTickets` from a global, unscoped `localStorage` key to an owner-scoped cache model partitioned by the attendee's JWT `sub` claim (`congress_cached_tickets_${user_id}`). Unauthenticated sessions strictly fail closed; legacy plaintext keys are purged on sight; account switching and logout immediately invalidate foreign passes.
   - **Resolved Issue #19 (Peer Contact-Sharing Consent):** Added `share_contact_with_peers: bool = False` to the database schema (`users` table) via Alembic revision `0010`. Connection responses and RFC 6350 vCard exports now redact attendee email addresses by default unless explicit consent is granted. Endpoints `GET` and `PATCH /api/attendees/me/network/privacy` allow attendees to view and toggle their consent.
2. **Stage B (Persian-First Attendee Experience Redesign):**
   - **Localization Architecture (`web/src/lib/i18n.ts`):** Implemented Persian (`fa`) as the primary design target with RTL container layout (`dir="rtl"`), Vazirmatn font stack (`font-sans`), Solar Hijri (Jalali) calendar formatting via native browser `Intl`, Persian numeral formatting, and `<bdi dir="ltr">` isolation for technical tokens. An accessible language toggle allows switching between Persian and English.
   - **Redesigned `/my-tickets` (Digital Attendee Pass):** Centered on an active pass presentation with a high-contrast black-on-white SVG QR plate with verified quiet zones, multi-ticket switcher, offline status indicator, and saved exhibition booths.
   - **Redesigned `/my-network` (Networking Hub):** Built compact mobile contact cards, interactive peer badge code entry dialog (`Dialog.tsx`), in-place private conversation notes editor, direct vCard download, and a dedicated privacy consent card.
   - **Shared Attendee Layout (`AttendeeLayout.tsx`):** Unifies `/my-tickets` and `/my-network` under a cohesive mobile-friendly navigation bar with session logout and privacy disclosures.

---

## 2. Stage A — Privacy Contract Changes & Issue Closure

### Issue #16: Owner-Scoped Offline Ticket Cache
- **Module:** `web/src/lib/ticketCache.ts`
- **Unit Tests:** `web/tests/ticketCache.test.ts` (7 tests, all passing)
- **Key Technical Mechanics:**
  - `getAuthenticatedUserId(token)` extracts the stable user UUID from the JWT `sub` claim.
  - `loadOwnerScopedTickets(token, now, storage)`:
    - If `token` is missing or invalid: returns `{ status: "unauthorized", tickets: [] }`. **Fails closed.**
    - Only reads from `congress_cached_tickets_${userId}`.
    - Enforces TTL (`expiresAt`). Expired envelopes are purged and return `{ status: "expired" }`.
    - Automatically purges legacy unscoped `congress_cached_tickets` keys.
  - `saveOwnerScopedTickets(token, tickets, now, ttlMs, storage)` saves an envelope containing `{ userId, cachedAt, expiresAt, tickets }`.
  - `clearOwnerScopedTickets(token, storage)` purges the user's cache upon logout.
- **Threat Model & Storage Disclaimer:** Web Storage (`localStorage`) is plaintext storage. The UI explicitly notifies attendees: *"Digital Pass Portal • Stored under owner-scoped local storage for offline venue access. Privacy Advisory: Browser storage contains your reusable QR credential. Log out when using shared computers."*

### Issue #19: Peer Contact-Sharing Consent
- **Database Model:** `backend/app/models.py`
  - Added `share_contact_with_peers: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")` to `User`.
- **Alembic Migration:** `backend/migrations/versions/0010_peer_contact_consent.py` (Revision `0010`, down_revision `0009`).
- **Route & DTO Updates (`backend/app/routes/network.py`):**
  - Updated `ConnectionOut`: `email: str | None = None`.
  - In `scan_peer_badge`, `list_my_connections`, and `update_connection_notes`: `email = peer.email if peer.share_contact_with_peers else None`.
  - In `export_connection_vcard`: Only writes `EMAIL;TYPE=INTERNET:{peer.email}` if `peer.share_contact_with_peers` is `True`.
  - Added endpoints:
    - `GET /api/attendees/me/network/privacy` (returns current consent boolean)
    - `PATCH /api/attendees/me/network/privacy` (updates consent boolean)
- **FastAPI Route Order Invariant:** Declared `/privacy` routes *before* `/{connection_id}` routes to prevent UUID path parameter collisions (HTTP 422).
- **ADR 0011 Guardrail Preserved:** Exhibitor Lead Capture (`leads.py`) remains an authorized sponsor transaction and is unaffected by peer privacy rules.
- **Tests:** `backend/tests/test_networking.py` (8 tests passing, verifying default redaction, opt-in disclosure, and revocation).

---

## 3. Stage B — Persian-First Localization Architecture

Per project directives (*"Also prioritize persian view"*), Persian is implemented as the primary attendee experience:

### 1. Typography & Font Hierarchy
- `--font-sans` updated in `web/src/index.css`:  
  `"Vazirmatn", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;`
- Prioritizes Vazirmatn for Persian shaping while maintaining seamless Inter fallback for Latin characters.

### 2. Directionality & RTL Layout Engine
- Container-level `dir="rtl"` and `lang="fa"`.
- Logical CSS classes applied throughout: `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`.
- Directional glyphs mirrored appropriately (back arrows point `→` in RTL; forward chevrons point `←` in RTL).
- Language toggle (`🌐 English` / `🌐 فارسی`) persists preference in `localStorage.getItem("congress_attendee_locale")`.

### 3. Bi-Directional (Bidi) Text Isolation
Technical tokens (emails, URLs, ticket UUIDs, QR secrets, dates) mixed within Persian text are strictly isolated with `<bdi dir="ltr">` to prevent punctuation reversal and corrupted phone/code reading:
- Emails: `<a href="mailto:..."><bdi dir="ltr">{conn.email}</bdi></a>`
- Ticket Reference IDs: `<bdi dir="ltr">{currentTicket.id.slice(0, 13)}</bdi>`

### 4. Solar Hijri (Jalali) Calendar & Persian Numerals
Implemented in `web/src/lib/i18n.ts`:
- **Dates:** `new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date)`
- **Numbers:** `new Intl.NumberFormat("fa-IR").format(num)`
- Canonical backend timestamps remain strictly UTC ISO-8601.

---

## 4. Modified & Created Files

### Created Files
- `web/src/lib/ticketCache.ts` — Owner-scoped offline ticket cache with TTL and fail-closed security.
- `web/tests/ticketCache.test.ts` — Unit tests for ticket cache (7 tests covering account switching, TTL, logout).
- `backend/migrations/versions/0010_peer_contact_consent.py` — Database migration adding `share_contact_with_peers` to `users`.
- `web/src/lib/i18n.ts` — Persian-first localization engine, dictionaries, Jalali date & number formatters.
- `web/src/layouts/AttendeeLayout.tsx` — Shared attendee layout with RTL switcher, tabs, and session controls.
- `docs/design/phase3-evidence/*.png` — 15 responsive and state screenshots across all viewports.
- `docs/design/PHASE-3-IMPLEMENTATION.md` — This implementation deliverable.

### Modified Files
- `backend/app/models.py` — Added `share_contact_with_peers` column to `User`.
- `backend/app/routes/network.py` — Scoped email disclosure to consent preference, added `/privacy` endpoints.
- `backend/app/routes/auth.py` — Added `share_contact_with_peers` to `UserOut`.
- `backend/tests/test_networking.py` — Updated tests to verify consent default, opt-in, and revocation.
- `web/src/api/client.ts` — Exported `PrivacyPreferenceOut` and `PrivacyPreferenceUpdate` types.
- `web/src/api/schema.d.ts` — Regenerated typed OpenAPI client.
- `web/src/index.css` — Prioritized Vazirmatn in `--font-sans`.
- `web/src/pages/MyTickets.tsx` — Complete redesign with Persian RTL, QR badge card, and owner-scoped cache.
- `web/src/pages/MyNetwork.tsx` — Complete redesign with Persian RTL, consent toggle card, and private notes.

---

## 5. Responsive Verification & Screenshots Across 5 Target Viewports

All screenshots were captured using headless Chrome DevTools Protocol (CDP) on the live Vite application with real local API responses and synthetic Persian attendee data:

### Digital Ticket Pass (`/my-tickets`)
| Target Viewport | Dimensions | Scroll Width | Inner Width | Overflow Status | Direction | Artifact Link |
|:---|:---|:---|:---|:---|:---|:---|
| **360px Mobile** | 360 × 800 | 360px | 360px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-fa-360.png`](phase3-evidence/tickets-fa-360.png) |
| **390px Mobile** | 390 × 844 | 390px | 390px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-fa-390.png`](phase3-evidence/tickets-fa-390.png) |
| **768px Tablet** | 768 × 1024 | 768px | 768px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-fa-768.png`](phase3-evidence/tickets-fa-768.png) |
| **1024px Laptop** | 1024 × 768 | 1009px | 1024px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-fa-1024.png`](phase3-evidence/tickets-fa-1024.png) |
| **1440px Desktop** | 1440 × 960 | 1425px | 1440px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-fa-1440.png`](phase3-evidence/tickets-fa-1440.png) |
| **English (LTR)** | 1440 × 960 | 1425px | 1440px | **0px (None)** | `ltr` | [`docs/design/phase3-evidence/tickets-en-1440.png`](phase3-evidence/tickets-en-1440.png) |
| **Offline Mode** | 1440 × 960 | 1425px | 1440px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-offline-mode.png`](phase3-evidence/tickets-offline-mode.png) |
| **Unauthenticated** | 1440 × 960 | Centered gate card | — | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/tickets-unauthenticated.png`](phase3-evidence/tickets-unauthenticated.png) |

### Networking Hub (`/my-network`)
| Target Viewport | Dimensions | Scroll Width | Inner Width | Overflow Status | Direction | Artifact Link |
|:---|:---|:---|:---|:---|:---|:---|
| **360px Mobile** | 360 × 800 | 360px | 360px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-fa-360.png`](phase3-evidence/network-fa-360.png) |
| **390px Mobile** | 390 × 844 | 390px | 390px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-fa-390.png`](phase3-evidence/network-fa-390.png) |
| **768px Tablet** | 768 × 1024 | 768px | 768px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-fa-768.png`](phase3-evidence/network-fa-768.png) |
| **1024px Laptop** | 1024 × 768 | 1024px | 1024px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-fa-1024.png`](phase3-evidence/network-fa-1024.png) |
| **1440px Desktop** | 1440 × 960 | 1440px | 1440px | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-fa-1440.png`](phase3-evidence/network-fa-1440.png) |
| **Connect Dialog** | 1440 × 960 | Accessible modal | — | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-connect-modal.png`](phase3-evidence/network-connect-modal.png) |
| **Privacy Toggled** | 1440 × 960 | Consent updated | — | **0px (None)** | `rtl` | [`docs/design/phase3-evidence/network-privacy-toggled.png`](phase3-evidence/network-privacy-toggled.png) |

---

## 6. Accessibility & Bidi Audit Findings

1. **RTL Reading Order & Landmark Coherence:**
   - `<header>`, `<main id="attendee-main-content">`, `<nav>`, and `<footer>` establish clean landmarks.
   - Reading order flows naturally right-to-left in Persian mode, with proper heading levels (`<h1>` for active pass / network title, `<h2>` for sections, `<h3>` for cards).
2. **Bi-Directional Text Isolation:**
   - Verified that English emails, UUIDs, and QR codes inside Persian text cards render without punctuation corruption or swapped digits.
3. **Contrast:**
   - QR code: Opaque `#FFFFFF` plate with `#0F172A` dark modules, exceeding 18:1 contrast.
   - Text `#0F172A` on `#FFFFFF`: **18.1 : 1** (exceeds AAA).
   - Brand teal `#0F766E` on white: **5.5 : 1** (exceeds AA).
4. **Focus Management & Dialogs:**
   - Verified focus trapping, Escape key listener, and focus restoration in the Connect with Peer dialog.
   - Visible 2px focus ring indicator on all interactive buttons, inputs, and links.

---

## 7. Full-Stack Verification Pipeline Results (`scripts\check.bat`)

Ran the unified full-stack verification script:

```text
==========================================
Congress Platform: Full-Stack Verification
==========================================

[1/3] Checking Backend (Python / FastAPI)...
Success: no issues found in 40 source files
99 passed in 80.32s (0:01:20)

[2/3] Checking Web (React / TypeScript)...
✔ node --test tests/*.test.ts (15 passed)
✔ tsc -b (typecheck passed)
✔ vite build (dist built in 352ms, 58 modules transformed)

[3/3] Checking Mobile (Flutter / Dart)...
✔ dart test (8 passed)
✔ dart analyze (No issues found!)

==========================================
[SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS
==========================================
```

- **Backend Pytest:** 99 passed in 80.3s (including all 19 scanner security tests, 8 networking consent tests, and conftest fixtures).
- **Backend Mypy:** Passed on all 40 source files with zero issues.
- **Web Node Tests:** 15 passed in 180ms (including 7 new owner-scoped ticket cache tests).
- **Web TypeScript & Build:** `tsc -b` and `vite build` passed with zero errors.
- **Dart & Mobile Analysis:** 8 tests passed, `dart analyze` reported zero issues.

---

## 8. Remaining Limitations

1. **Remote vCard Revocation Impossibility:** As documented in the threat model, vCards downloaded to an attendee's local device prior to consent revocation cannot be remotely revoked. Revocation takes effect on all subsequent API queries and downloads.
2. **Browser Storage Plaintext Reality:** Web Storage (`localStorage`) provides owner-scoping, but is not hardware-encrypted storage. Attendees on shared public terminals should log out to purge their cache.
3. **Scanner Capacity & Reconciliation Gates (#15/#17):** Unrelated scanner operational defects remain independent release gates and were not modified in Phase 3.

---

## 9. Final Recommendation

**RECOMMENDATION: ACCEPT PHASE 3**

Phase 3 successfully fulfills all mission criteria:
- **Privacy Gates Resolved:** Issues #16 and #19 are fully implemented with database migration, backend contract enforcement, and unit/regression tests.
- **Persian-First Architecture:** Clean RTL directionality, Vazirmatn typography, Solar Hijri calendar formatting, and bidi isolation are active and verified across 5 target viewports.
- **Zero Horizontal Overflow:** Verified across all viewports from 360px to 1440px.
- **Full-Stack Verification:** Passed across Python, Web, and Mobile stacks without regression.

**Per mission instructions, work stops here for review before proceeding to subsequent workspaces.**
