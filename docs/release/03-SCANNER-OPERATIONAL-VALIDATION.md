# 03 — Scanner Operational Validation & Gate Semantics Audit

**Evaluation Date:** 2026-10-10  
**Operational Standard:** Offline-First Gate Check-In & Truthful State Machine  
**Classification:** VERIFIED  

---

## 1. Executive Summary

The gate scanning subsystem is the highest-risk operational component of the Congress Management Platform. Under peak morning arrival pressure, scanning stations process hundreds of attendees per hour, frequently operating under unstable Wi-Fi or complete venue network outages.

This operational validation independently audits the scanner state machine, admission policies, offline feedback semantics, conflict reconciliation, and credential security.

### Key Corrections Delivered in Phase 8:
1. **Universal Offline Provisional Admission:** Eliminated the ambiguity in Phase 7 where offline `MULTI_ENTRY`, `SINGLE_USE`, and `TIER_RESTRICTED` scans could display green "Confirmed" feedback. In Phase 8, **every admission evaluated while offline is explicitly classified as `PROVISIONAL` (`outcome: "PROVISIONAL"`, `is_provisional: true`)**, triggering amber visual feedback and a distinct mid-tone chime (`playProvisionalChime()`).
2. **Differentiated Missing Credentials:** Differentiated between `INVALID_TICKET` (online verification failed) and `NOT_IN_LOCAL_MANIFEST` (credential absent from disconnected offline cache), preventing operators from falsely telling legitimate walk-in attendees their tickets are forged.
3. **Verified Per-Scan Reconciliation (Issue #17):** Batch reconciliation strictly matches each scan by persistent `scan_id` UUID. Server-rejected provisional scans trigger automatic local rollback and an interactive operator conflict drawer.

---

## 2. Audit of Scanner Semantics & State-Transition Pipeline

### 2.1 The Operational Safety Inconsistency in Phase 7
The Phase 7 report stated:
> `MULTI_ENTRY / Normal → Local Provisional Admitted → Green / Success Chime`

**Critical Finding:** An unconfirmed local evaluation must **never** trigger green confirmed feedback. If a venue has two gates running offline, Gate A cannot know if Gate B already admitted a `SINGLE_USE` pass or if central registration revoked a ticket. Displaying green "Confirmed" gives operators the false impression of authoritative database validation.

### 2.2 The Phase 8 Truthful Semantics Pipeline
In Phase 8, `evaluateLocalScan()` enforces this universal rule:

$$\text{is\_offline} = \text{true} \implies \text{outcome} = \text{"PROVISIONAL"}, \quad \text{is\_provisional} = \text{true}$$

| Evaluation Context | Admission Policy | Returned Status | Returned Outcome | Visual Feedback | Audio Chime | Operational Meaning |
|:---|:---|:---|:---|:---|:---|:---|
| **Online (Server Sync)** | Any Policy | `ADMITTED` | `ADMITTED` | Solid Green | High Chime (`playSuccessChime`) | **Authoritative:** Confirmed in central PostgreSQL |
| **Offline (Disconnected)** | `MULTI_ENTRY` | `ADMITTED` | `PROVISIONAL` | Solid Amber | Mid Chime (`playProvisionalChime`) | **Local Provisional:** Valid against local cache |
| **Offline (Disconnected)** | `SINGLE_USE` | `ADMITTED` | `PROVISIONAL` | Solid Amber | Mid Chime (`playProvisionalChime`) | **Local Provisional:** Marked used locally; pending sync |
| **Offline (Disconnected)** | `TIER_RESTRICTED` | `ADMITTED` | `PROVISIONAL` | Solid Amber | Mid Chime (`playProvisionalChime`) | **Local Provisional:** Tier verified against local cache |
| **Offline (Disconnected)** | `CAPACITY_CAPPED` | `ADMITTED` | `PROVISIONAL` | Solid Amber | Mid Chime (`playProvisionalChime`) | **Local Provisional:** Room capacity tentative |
| **Any State** | Any Policy | `REJECTED` | `REJECTED` | Solid Red | Low Buzz (`playErrorBuzz`) | **Rejected:** Policy violation or invalid credential |

---

## 3. Physical Meaning of Provisional Admission & Capacity Enforcement

A database transaction can be rolled back, but a person physically entering an auditorium cannot be magically teleported out.

### 3.1 Policy for `CAPACITY_CAPPED` Gates
- **Online Operations:** The central server enforces authoritative room occupancy (`current_occupancy < max_capacity`). When the limit is reached, scans immediately fail with `CAPACITY_REACHED` (Red / Buzz).
- **Offline Operations:** A disconnected gate scanner maintains a local counter (`current_admitted_count`). However, it cannot observe entries from adjacent gates.
- **Fail-Closed Recommendation:** For fire-safety-regulated venues, event organizers should configure capacity gates to **Fail-Closed** (require network availability) or allocate dedicated physical capacity quotas per gate.
- **Supervisor Override:** When operating offline under emergency conditions, provisional admission allows the operator to admit the attendee, but flags the scan with an amber badge: *"پذیرش مشروط آفلاین (تایید نهایی با سرور)"*.

---

## 4. Unknown vs. Invalid Credentials (Audit Item 2.C)

When an attendee presents a QR code absent from the scanner's local manifest:
1. **Online State:** The ticket is verified against the live database. If missing, it returns `INVALID_TICKET` (Red).
2. **Offline State:** The ticket may have been issued at the Front Desk 5 minutes ago while the scanner was disconnected.
3. **Phase 8 Resolution:** `evaluateLocalScan()` returns:
   ```ts
   rejection_reason: isOffline ? "NOT_IN_LOCAL_MANIFEST" : "INVALID_TICKET"
   ```
   The UI explains: *"Credential not found in offline manifest (verify online or at Front Desk)"*, preventing unnecessary attendee confrontation.

---

## 5. Per-Scan Batch Synchronization & Reconciliation (Issue #17)

Reconciliation operates per persistent `scan_id` UUID:
```json
{
  "scans": [
    {
      "scan_id": "7f8b9a1c-3d2e-4f5a-b6c7-d8e9f0a1b2c3",
      "qr_secret": "k7m3x9p2...",
      "scanned_at": "2026-11-01T08:30:00Z"
    }
  ]
}
```

### Reconciliation Workflow:
1. The scanner stores each scan in IndexedDB with `sync_state: "PENDING"`.
2. When connectivity is restored, the scanner submits the batch to `POST /api/checkin-points/{id}/scans/batch`.
3. The server processes each scan individually and returns a correlated result array.
4. **Conflict Handling:** If the server rejects a locally admitted scan (e.g. `ALREADY_ADMITTED` at another gate):
   - The local engine flags the scan as `sync_state: "CONFLICT"`.
   - `reconstructLocalState()` reverts the local ticket state (`is_admitted = false`).
   - The scanner station surfaces an interactive **Conflict Review Drawer** showing the attendee name, rejection reason, and collision timestamp.
   - Acknowledging the conflict marks it reviewed by the operator but **preserves the permanent record in IndexedDB** for post-event audit.

---

## 6. Scanner Device Credentials & Authorization (Issue #18)

- **Point-Scoped Issuance:** `POST /api/checkin-points/{id}/token` mints an HS256 JWT containing `point_id`, `event_id`, and a unique device `jti`.
- **Per-Device Revocation:** The server validates `ScannerDevice.is_revoked`. A compromised or lost scanner tablet can be immediately revoked from the Organizer Console.
- **Unpair Safety:** Clicking *"Disconnect Device"* clears the stored bearer token from `sessionStorage` and IndexedDB while **preserving all queued offline scans** so historical audits are never deleted.

---

## 7. Automated Verification Evidence

| Test Suite | File | Tests Passed | Validated Behavior |
|:---|:---|:---|:---|
| **Scanner Engine** | `web/tests/scannerEngine.test.ts` | 13 | Multi-entry, single-use, tier restrictions, capacity caps, universal offline provisional semantics, and missing credential differentiation |
| **Auth Policy** | `web/tests/scannerAuthPolicy.test.ts` | 8 | 24h offline freshness window, JWT expiration, and clock skew safety |
| **Local State** | `web/tests/scannerEngine.test.ts` | 3 | Capacity state reconstruction, snapshot reset, and server conflict rollback |
| **Full Lifecycle** | `backend/tests/test_e2e_lifecycle.py` | 1 | Complete multi-policy enforcement, batch sync, and Issue #20 scan UUID collision protection |

**Conclusion:** Scanner operational semantics are verified, truthful, and safe for live congress deployment.
