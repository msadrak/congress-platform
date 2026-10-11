# 09 — Controlled-Pilot Acceptance Checklist & Gate Verification

**Evaluation Date:** 2026-10-11  
**Target Release:** Controlled On-Premise Pilot (`v1.0.0-pilot.1`)  
**Standard:** Explicit Gate Status Classification (`PASS` / `FAIL` / `BLOCKED` / `NOT TESTED` / `NOT APPLICABLE`)  

---

## 1. Pilot Go/No-Go Gates Evaluation Matrix

| Gate # | Pilot Acceptance Gate | Assigned Status | Verification Evidence / Blocker Detail | Action Required Before Doors Open |
|:---:|:---|:---:|:---|:---|
| **Gate 1** | Staging HTTPS works on intended devices | **NOT APPLICABLE / BLOCKED** | Local staging works over HTTP (`127.0.0.1:5180`). Remote public HTTPS blocked by lack of external domain/DNS. | For on-premise venue pilot, operate over private isolated WPA2 Wi-Fi subnet. |
| **Gate 2** | Event configuration validated | **PASS** | Tiers, quotas, 4 check-in points, booths, and staff assignments verified via automated integration tests. | Configure real event metadata in Organizer Console. |
| **Gate 3** | Staff authorization verified | **PASS** | Organizer API key, booth staff JWT, and scanner device tokens verified with strict isolation. | Issue API keys and passwords to event staff. |
| **Gate 4** | Scanner pairing & revocation work | **PASS** | Point-scoped token issuance and database JTI revocation verified. Revoked devices return 401. | Pair tablets on-site using point-scoped tokens. |
| **Gate 5** | Admission status feedback is truthful | **PASS** | Universal offline provisional amber feedback, missing credential differentiation, and distinct audio chimes verified. | Train gate staff using Visual Feedback Card. |
| **Gate 6** | Offline operation has approved physical-entry policy | **PASS** | Fail-closed capacity default implemented in `scannerEngine.ts`. SOP documented in `04-OFFLINE-ADMISSION-SOP.md`. | Review SOP with venue gate supervisors. |
| **Gate 7** | Pending scan data survives supported recovery paths | **PASS** | IndexedDB queues persist across browser reloads, Uvicorn restarts, and offline periods without data loss. | Ensure staff do not clear browser storage mid-shift. |
| **Gate 8** | Relevant physical scanner hardware passed on-site tests | **NOT TESTED** | Software interfaces and simulated inputs verified. Physical optical scanner guns, cameras, and thermal printers not tested on-site. | **MANDATORY:** Execute `03-SCANNER-FIELD-TEST-PLAN.md` on-site at T-2 hours. |
| **Gate 9** | Database backup & recovery exercised | **PASS** | Real `pg_dump -Fc` and `pg_restore` drill executed on PostgreSQL 16; 15 tables restored with 0 data loss. | Capture pre-event backup snapshot at T-2 hours. |
| **Gate 10** | Critical security regressions pass | **PASS** | 10/10 security vectors pass: multi-tenant 404, booth 403, replay 409, CSV formula sanitization, UTF-8 BOM, QR entropy. | None. Automated regression suite green. |
| **Gate 11** | Staff have documented manual fallback procedure | **PASS** | Standard Operating Procedure provided in `docs/pilot/04-OFFLINE-ADMISSION-SOP.md`. | Print paper copies of SOP for every check-in gate. |
| **Gate 12** | Named human release owner approved remaining risks | **BLOCKED / PENDING** | Requires designated operations lead signature to accept operating over on-premise network and manual hardware checks. | Operations Lead must sign release sign-off sheet. |

---

## 2. Gate Summary & Release Readiness

- **Passing Gates:** 8 / 12 Gates (**PASS**)
- **Unverified Hardware:** 1 Gate (**NOT TESTED** — Gate 8: On-site physical hardware verification)
- **External Dependencies:** 1 Gate (**NOT APPLICABLE** — Gate 1: Remote public HTTPS)
- **Human Approval:** 1 Gate (**BLOCKED / PENDING** — Gate 12: Named human release owner sign-off)
- **Failed Gates:** **0 / 12 Gates**

---

## 3. Explicit Pilot Pre-Conditions

The controlled pilot may proceed **ONLY** when the following two physical actions are executed on-site:
1. **Field Acceptance:** The on-site team executes Protocols A, B, and C from `docs/pilot/03-SCANNER-FIELD-TEST-PLAN.md` on the physical tablets and printers.
2. **Release Sign-Off:** The designated human event director signs Gate 12 after reviewing the operational SOP and remaining constraints.
