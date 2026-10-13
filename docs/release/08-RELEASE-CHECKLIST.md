# 08 — Release Acceptance Checklist & Hardware Verification Procedures

**Evaluation Date:** 2026-10-10  
**Harness Seam Verification:** `scripts\check.bat`  
**Classification:** VERIFIED  

---

## 1. Automated Software Verification Gate

The platform passed all three automated verification suites:

```text
==========================================
Congress Platform: Full-Stack Verification
==========================================

[1/3] Checking Backend (Python / FastAPI)...
Success: no issues found in 42 source files
103 passed in 66.14s

[2/3] Checking Web (React / TypeScript)...
✔ node --test tests/*.test.ts (27 passed in 216ms)
✔ tsc -b (0 diagnostics, zero type errors)
✔ vite build (dist built in 2.75s, 59 modules transformed)

[3/3] Checking Mobile (Flutter / Dart)...
✔ dart test (8 passed)
✔ dart analyze (No issues found!)

==========================================
[SUCCESS] ALL CHECKS PASSED ACROSS ALL THREE STACKS
==========================================
```

Total Automated Tests: **138 tests passed** across all three technology stacks.

---

## 2. Functional & Route Verification Checklist

- [x] **Platform Home (`/`):** Hero composition, responsive navigation, and feature showcase render cleanly.
- [x] **Public Event (`/e/:slug`):** Quota presentation, tier selection, and free ticket reservation modal operate as specified.
- [x] **Public Booth (`/e/:slug/booths/:boothId`):** Booth description, location, brochure links, and bookmark button functional.
- [x] **Attendee Passes (`/my-tickets`):** High-contrast SVG QR with quiet zone, user-scoped offline caching, and logout cache purging.
- [x] **Attendee Networking (`/my-network`):** Peer camera barcode scanner, contact sharing consent toggle, and `.vcf` vCard download.
- [x] **Organizer Console (`/organizer`):** Multi-event listing, API key barrier, and event creation workflow.
- [x] **Event Settings (`/organizer/events/:id`):** Ticket tiers, check-in points, booths, and standee QR code generation.
- [x] **Event Analytics (`/organizer/events/:id/analytics`):** Real-time attendance KPIs, gate throughput breakdown, and hardened CSV export.
- [x] **Exhibitor Portal (`/booth/:boothId`):** Camera scanner, lead qualification drawer (HOT/WARM/COLD), and lead CRM CSV export.
- [x] **Front Desk Station (`/organizer/events/:id/desk`):** 200ms debounced live attendee lookup, walk-in registration, and high-contrast badge print dialog.
- [x] **Gate Scanner (`/scan/:pointId`):** High-Contrast Operational Mode, 5 operational zones, multi-modal input, and differentiated audio/visual feedback.

---

## 3. Security & Data Integrity Gate

- [x] **Multi-Tenant Isolation:** Organizers cannot access foreign events (returns 404).
- [x] **Competitor Booth Isolation:** Exhibitors cannot access competing booth leads (returns 403).
- [x] **Replay Attack Defense:** Scan UUID collisions across points rejected with `SCAN_ID_CONFLICT` (Issue #20).
- [x] **CSV Formula Hardening:** User-controlled cells prefixed with `'` to mitigate CWE-1236; UTF-8 BOM embedded.
- [x] **Cross-Role Credential Isolation:** `getApiClient()` uses route-scoped fallback; organizer keys never override attendee tokens.
- [x] **Device Revocation:** Supervisor can revoke scanner tablet credentials via JTI claim in database.

---

## 4. Hardware Verification Procedures for Venue Operations

*Notice:* The automated test environment validates software interfaces and simulated input streams. The venue team must execute these physical checks prior to doors opening:

### Test 1: Optical USB / Bluetooth HID 2D Barcode Scanner
1. Connect physical USB barcode gun to gate tablet/laptop via USB-A or Bluetooth HID.
2. Open `/scan/:pointId` in Google Chrome; ensure window has focus.
3. Aim optical laser at a printed high-contrast badge QR code and pull trigger.
4. **Verification:** Confirm the barcode listener automatically captures the 128-bit secret, trims carriage return (`\r\n`), evaluates admission, and triggers chime without requiring operator keyboard entry.

### Test 2: Tablet Camera Autofocus & Lighting
1. Open `/scan/:pointId` on mobile tablet; click *"اسکن با دوربین"* (Camera Scan).
2. Present a smartphone displaying a badge QR code at varying distances (10cm to 40cm) and angles.
3. **Verification:** Confirm the browser `BarcodeDetector` API decodes the QR code within 500ms under standard indoor venue lighting.

### Test 3: Front Desk Thermal Badge Printer
1. Open `/organizer/events/:id/desk` on front desk workstation.
2. Complete a test walk-in registration; when the modal opens, click *"چاپ کارت ورود"* (Print Badge Pass).
3. **Verification:** Confirm `@media print` CSS cleanly isolates the badge card, strips page navigation headers/footers, and prints a crisp, scannable QR code on physical paper/badge stock.
