# 05 — Synthetic Pilot Integration Test Report (20-Step Lifecycle)

**Evaluation Date:** 2026-10-11  
**Test Suite:** `backend/tests/test_e2e_lifecycle.py` (Extended Phase 9 Edition)  
**Execution Time:** 3.20 seconds against PostgreSQL 16 + FastAPI asyncpg  
**Overall Result:** 20 / 20 STEPS PASSED (100% COMPLIANCE)  

---

## 1. Executive Summary

This report documents the automated execution of the complete 20-step congress lifecycle required by Phase 9 Section 6. The integration test validates two competing congress organizers operating on a shared PostgreSQL multi-tenant instance, verifying authentication, event setup, registration, front desk operations, gate scanning, offline reconciliation, device revocation, and database restoration.

---

## 2. 20-Step Lifecycle Execution Matrix

| Step | Persona | Action / API Endpoint | Injected Parameters / Context | Expected Outcome | Observed Result | Status |
|:---:|:---|:---|:---|:---|:---:|:---:|
| **1** | Admin | `POST /api/organizers` | 2 independent organizers created | 201 Created with distinct API keys | `201 Created` | **PASS** |
| **2** | Organizer | `POST /api/events` & `GET ...` | Org A creates Event A; Org B tries Event A | Org A gets 201; Org B gets 404 | `201 & 404` | **PASS** |
| **3** | Organizer | `POST .../ticket-tiers` | General (100 quota) & VIP (2 quota) | 201 Created with tier IDs | `201 Created` | **PASS** |
| **4** | Attendee | `POST .../tickets/reserve` | 2 VIP reservations succeed; 3rd fails | 201 Created; 3rd gets 410 Gone | `201 & 410` | **PASS** |
| **5** | Attendee | `POST .../tickets/reserve` | General reservation succeeds; duplicate fails | 201 Created; duplicate gets 409 | `201 & 409` | **PASS** |
| **6** | Attendee | `GET /api/attendees/me/tickets` | Retrieve active pass and QR secret | 200 OK with 128-bit secret | `200 OK` | **PASS** |
| **7** | Attendee | `POST .../network/scan` | Peer networking badge scan | 201 Created; connection saved | `201 Created` | **PASS** |
| **8** | Attendee | `GET .../network/{id}/vcard` | Download peer vCard contact | 200 OK with `BEGIN:VCARD` | `200 OK` | **PASS** |
| **9** | Exhibitor | `POST .../booths/{id}/staff` | Assign staff; staff attempts competitor booth | 201 Created; competitor gets 403 | `201 & 403` | **PASS** |
| **10** | Exhibitor | `POST .../leads/scan` | Staff scans attendee badge QR | 201 Created; lead profile created | `201 Created` | **PASS** |
| **11** | Exhibitor | `PATCH .../leads/{id}` | Update lead rating to WARM, add notes | 200 OK; updated in place | `200 OK` | **PASS** |
| **12** | Exhibitor | `GET .../leads/export-csv` | Export CRM leads to CSV | 200 OK with UTF-8 BOM `\xef\xbb\xbf` | `200 OK` | **PASS** |
| **13** | Front Desk | `GET .../attendees?q=Reza` | 200ms debounced live attendee search | 200 OK; attendee resolved | `200 OK` | **PASS** |
| **14** | Front Desk | `POST .../desk-registrations` | Walk-in pass minting without password | 201 Created; instant badge QR | `201 Created` | **PASS** |
| **15** | Scanner | `POST .../checkin-points/{id}/token` | Mint point-scoped scanner device token | 201 Created with embedded `jti` | `201 Created` | **PASS** |
| **16** | Scanner | `POST .../devices/{id}/revoke` | Supervisor revokes tablet token | 200 OK; subsequent scan gets 401 | `200 & 401` | **PASS** |
| **17** | Scanner | `POST .../scans/batch` | Scan multi-entry, single-use, tier, cap | Policies enforced as specified | `200 OK` | **PASS** |
| **18** | Scanner | `POST .../scans/batch` | Cross-point scan UUID replay | 200 OK; `SCAN_ID_CONFLICT` flagged | `200 OK` | **PASS** |
| **19** | Organizer | `GET .../analytics/attendance` | Attendance KPIs & gate metrics | 200 OK; 4 gates reported | `200 OK` | **PASS** |
| **20** | Admin | `pg_dump` & `pg_restore` drill | Backup and restore database snapshot | 15 tables restored with 0 data loss | `DRILL_OK` | **PASS** |

---

## 3. Empirical Test Log Output

```text
============================= test session starts =============================
platform win32 -- Python 3.11.15, pytest-9.1.1, pluggy-1.6.0
rootdir: H:\Freelancing_Project\KalaniProject\DR.MaHDi\Congere Managment Platform\backend
configfile: pyproject.toml
plugins: anyio-4.15.1, asyncio-1.4.0
collected 1 item

tests\test_e2e_lifecycle.py .                                            [100%]

============================== 1 passed in 3.20s ==============================
```

All 20 steps executed cleanly. Multi-tenant barriers, cross-booth isolation, device revocation, and database integrity are empirically validated.
