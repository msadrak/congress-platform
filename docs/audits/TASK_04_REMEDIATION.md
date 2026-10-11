# Task 04 Remediation Report: Offline Admission Reliability, Local Capacity & Sync Reconciliation

**Role:** Principal Software Engineer (Offline-First Distributed Systems & Admission Systems)  
**Objective:** Remediate `P1-LOCAL-CAPACITY` and `P1-SYNC-SILENT-FAIL`, and address `P2-SNAPSHOT-RESET` for robust, conflict-aware offline gate operations.  
**Baseline Commit:** `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce`  
**Status:** **FULLY REMEDIATED & VERIFIED** across web unit/component suites, mobile models/services, and all 93 backend PostgreSQL integration tests.

---

## 1. Executive Summary

Task 04 resolves the core client-side offline admission and synchronization vulnerabilities identified in the baseline audit:
1. **Remediated `P1-LOCAL-CAPACITY`:** `evaluateLocalScan()` in `web/src/lib/scannerEngine.ts` now maintains and increments a running `current_admitted_count`. When `current >= max_capacity`, scans are deterministically rejected with `CAPACITY_REACHED`.
2. **Remediated `P2-SNAPSHOT-RESET`:** Introduced `reconstructLocalState()`. Upon browser refresh or cold start, the scanner loads the cached manifest tickets and replays all stored local scan events from IndexedDB, reconstructing single-use `is_admitted: true` states and the exact running capacity count. Page refreshes no longer reset ticket states or allow duplicate single-use admissions.
3. **Remediated `P1-SYNC-SILENT-FAIL`:** Upgraded `web/src/lib/scannerStorage.ts` with a **four-state per-record synchronization state machine** (`PROVISIONAL`, `CONFIRMED`, `LOCAL_REJECTED`, `CONFLICT`). Batch upload processing now iterates through `data.results` individually; scans rejected by the server (e.g. `ALREADY_ADMITTED` at another gate or server capacity breach) are transitioned to `CONFLICT`, stopped from infinite retry loops, and surfaced in the operator's review drawer.
4. **Enhanced Operator Experience:**
   - Visual feedback clearly differentiates provisional admissions (`bg-emerald-900` with amber striped border and `"Buffered Locally • Pending Server Sync"` banner) from server-confirmed admissions and rejections.
   - Header bar displays a real-time pulse counter: `⚠️ X Sync Conflicts (Review)`.
   - Built the accessible **Conflict Review Drawer** allowing operators to inspect conflict timestamps, attendee names, and rejection reasons, and manually acknowledge them.
5. **Mobile Stack Alignment:** Updated `mobile/lib/models/scan_record.dart`, `api_service.dart`, and `sync_service.dart` to return and process individual server scan results rather than reducing batch uploads to a single HTTP 200 boolean.

---

## 2. Root Cause Analysis & Reproduction Evidence

### 2.1 P1-LOCAL-CAPACITY Root Cause
In `web/src/pages/GateScanner.tsx:215-220` (prior implementation):
```typescript
const policy: LocalPolicyConfig = {
  policy_type: manifest.checkin_point.policy_type as LocalPolicyConfig["policy_type"],
  allowed_tier_ids: manifest.checkin_point.allowed_tier_ids,
  max_capacity: manifest.checkin_point.max_capacity,
  // Note: current_admitted_count was NOT provided!
};
```
In `web/src/lib/scannerEngine.ts:76`:
```typescript
const current = policy.current_admitted_count ?? 0;
if (current >= policy.max_capacity) { return { status: "REJECTED", ... }; }
```
Because `current_admitted_count` was missing, `current` defaulted to 0 on every scan. For a checkpoint with `max_capacity = 1`, scanning 10 different tickets resulted in all 10 being admitted locally.

**Reproduction Proof (`web/tests/scannerReliability.test.ts`):**
```
AssertionError: Expected values to be strictly equal:
+ actual: 'ADMITTED'
- expected: 'REJECTED'
operator: strictEqual
```
After remediation: Scan 1 admits, Scan 2 is rejected with `CAPACITY_REACHED` (`PASSED`).

---

### 2.2 P2-SNAPSHOT-RESET Root Cause
`buildTicketMap(manifest)` in `GateScanner.tsx` built ticket lookup tables purely from the raw `manifest.tickets` array. If an operator admitted a `SINGLE_USE` lunch pass offline, `ticketMap[secret].is_admitted` became `true` in memory. However, refreshing the page (or reopening the tab) rebuilt `ticketMap` from the unmodified manifest, resetting `is_admitted` back to `false` and resetting `current_admitted_count` back to 0.

**Reproduction Proof:**
Scanning the same single-use pass after a simulated reload resulted in `ADMITTED` a second time.
After remediation: `reconstructLocalState()` merges the manifest with IndexedDB scan history, ensuring the pass evaluates as `REJECTED: ALREADY_ADMITTED` immediately after refresh (`PASSED`).

---

### 2.3 P1-SYNC-SILENT-FAIL Root Cause
In `GateScanner.tsx:195-199` (prior implementation):
```typescript
const { data } = await client.POST("/api/checkin-points/{point_id}/scans/batch", ...);
if (data) {
  const syncedIds = unsynced.map((s) => s.scan_id);
  await markScansSyncedInDb(syncedIds);
  updatePendingCount();
}
```
The client ignored `data.results` (an array of `ScanResult` objects). Even if the server rejected a scan with `status: "REJECTED"`, `rejection_reason: "ALREADY_ADMITTED"` (because a competing device admitted the ticket first), the client marked the record `synced: true` and hid the failure from the operator.

**Remediation:** `reconcileBatchOutcomes()` processes each `ScanResult`. Admitted scans become `CONFIRMED`; rejected scans become `CONFLICT`, increment the conflict count, and surface in the review drawer.

---

## 3. Revised Scanner State Machine

```
                              [LOCAL SCAN EVENT]
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
          Local Status: ADMITTED              Local Status: REJECTED
                    │                                   │
                    ▼                                   ▼
             status: ADMITTED                    status: REJECTED
          sync_state: "PROVISIONAL"           sync_state: "LOCAL_REJECTED"
              synced: false                       synced: false
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      │
                               [BATCH SYNC]
                     POST /scans/batch (HTTP 200 OK)
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
   result.status == "ADMITTED"                         result.status == "REJECTED"
            │                                                   │
            ▼                                                   ▼
     status: "ADMITTED"                                  status: "REJECTED"
   sync_state: "CONFIRMED"                             sync_state: "CONFLICT"
        synced: true                                        synced: true
     reconciled_at: now()                               reconciled_at: now()
   (Removed from sync queue)                         (Removed from sync queue;
                                                      persisted in Conflicts Drawer)
                                                                │
                                                                ▼
                                                     [Operator Acknowledges]
                                                   conflict_acknowledged: true
```

---

## 4. Per-Record Synchronization & Reconciliation Contract

### Contract Definition (`web/src/lib/scannerStorage.ts`)
```typescript
export type ScanSyncState = "PROVISIONAL" | "CONFIRMED" | "LOCAL_REJECTED" | "CONFLICT";

export interface QueuedScan {
  scan_id: string;
  point_id: string;
  qr_secret: string;
  scanned_at: string;
  status: "ADMITTED" | "REJECTED";
  rejection_reason: string | null;
  synced: boolean;
  sync_state: ScanSyncState;
  attendee_name?: string | null;
  ticket_tier_name?: string | null;
  conflict_acknowledged?: boolean;
  reconciled_at?: string | null;
}

export interface ServerScanResult {
  scan_id: string;
  qr_secret: string;
  status: string;
  rejection_reason?: string | null;
  attendee_name?: string | null;
  ticket_tier_name?: string | null;
}

export interface ReconciliationReport {
  confirmedCount: number;
  conflictCount: number;
  conflicts: QueuedScan[];
}
```

### Invariant Guarantees:
1. **Stable Client UUID:** `scan_id` is generated once via `crypto.randomUUID()` at scan time and is never regenerated on retry.
2. **No Infinite Retries for Business Errors:** Conflicted scans are marked `synced: true` with `sync_state: "CONFLICT"`. `getUnsyncedScans()` filters them out, preventing redundant network retries.
3. **Idempotent Replay Resilience:** Server replays of identical `scan_id` values match client records without creating duplicates.

---

## 5. Changed Files

| File | Subsystem | Description of Modification |
|:---|:---|:---|
| `web/src/lib/scannerEngine.ts` | State Engine | Added running `current_admitted_count` updates to `evaluateLocalScan()`. Added `reconstructLocalState()` helper to replay IndexedDB scans on top of manifest tickets. |
| `web/src/lib/scannerStorage.ts` | Storage & Sync | Upgraded IndexedDB to `DB_VERSION = 2`. Added `ScanSyncState` enum, `reconcileBatchOutcomes()`, `getAllScansForPoint()`, `getConflictsForPoint()`, and `acknowledgeConflict()`. |
| `web/src/pages/GateScanner.tsx` | Operator UI | 1. Integrated `reconstructLocalState()` on load/refresh.<br>2. Reconciles batch scan responses per record in `flushQueue()`.<br>3. Flash overlay distinguishes provisional offline admissions from confirmed admissions.<br>4. Header shows dynamic conflict count.<br>5. Added accessible Conflict Review Drawer. |
| `web/tests/scannerReliability.test.ts` | Test Suite | New automated test suite reproducing and verifying capacity counters, refresh reconstruction, and conflict state transitions. |
| `mobile/lib/models/scan_record.dart` | Mobile Models | Added `syncState` property and JSON serialization. |
| `mobile/lib/services/api_service.dart` | Mobile Network | Updated `sendBatchScans()` to return `List<Map<String, dynamic>>?` (parsed server `results` array). |
| `mobile/lib/services/storage_service.dart` | Mobile Storage | Added `reconcileBatchOutcomes()` updating scan status, `syncState`, and `rejectionReason`. |
| `mobile/lib/services/sync_service.dart` | Mobile Sync | Reconciles per-record outcomes upon batch upload completion. |
| `mobile/test/api_and_sync_test.dart` | Mobile Tests | Updated mock batch response to return per-scan results for `s1` and `s2`. |

---

## 6. Verification & Test Outcomes

### 6.1 Web Unit & Reliability Tests (`web/`)
```
> web@0.0.0 test
> node --experimental-strip-types --test tests/*.test.ts

✔ evaluateLocalScan - MULTI_ENTRY admits ticket repeatedly (0.9704ms)
✔ evaluateLocalScan - SINGLE_USE rejects second scan with ALREADY_ADMITTED (0.2954ms)
✔ evaluateLocalScan - TIER_RESTRICTED enforces allowed tier list (0.154ms)
✔ evaluateLocalScan - unknown QR secret returns INVALID_TICKET (0.2295ms)
✔ evaluateLocalScan - CAPACITY_CAPPED rejects when room capacity exceeded (0.1583ms)
✔ P1-LOCAL-CAPACITY: evaluateLocalScan maintains stateful capacity counter (1.4356ms)
✔ P2-SNAPSHOT-RESET: reconstructLocalState preserves admitted tickets and capacity across refresh (0.3658ms)
✔ reconstructLocalState: correctly reverts provisional admission when server flagged CONFLICT (0.2605ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ duration_ms 172.0025
```
- **TypeScript Typecheck (`tsc -b`):** 0 errors.
- **Production Build (`vite build`):** Compiled cleanly in 2.15s.

### 6.2 Mobile Stack Verification (`mobile/`)
- `dart test`: **8/8 passed**.
- `dart analyze lib/models lib/services test`: **0 issues**.

### 6.3 Full Backend Pytest Suite (`backend/`)
- **93/93 tests passed (100%)** on PostgreSQL 16.
- Strict mypy: **40/40 source files passed with 0 errors**.

---

## 7. Explicit Offline Consistency Limitations

1. **Fundamental Disconnected Multi-Device Limitation:**
   - **Guaranteed Boundary:** A single offline scanner guarantees local capacity tracking and single-use enforcement across its own scans and page refreshes.
   - **Impossible Guarantee:** Two completely disconnected devices operating without network connectivity **cannot** detect each other's scans in real time without a physical communication medium.
   - **Behavioral Guarantee:** When disconnected devices submit batches upon reconnection, PostgreSQL's atomic concurrency controls (remediated in Task 03) authoritatively serialize the submissions: the first transaction commits `ADMITTED`, the second transaction commits `REJECTED: ALREADY_ADMITTED` or `CAPACITY_REACHED`. The client receives this outcome, flags a `CONFLICT`, and presents it to the operator.
2. **Destructive Cache Clear:**
   - If an operator manually clears browser site data / IndexedDB via browser developer settings, local un-synced scan records will be deleted. Standard browser refresh (F5), page close/reopen, and network transitions do not clear IndexedDB.

---

## 8. Unresolved Dependencies for Task 05 and Task 06

1. **Task 05 (PWA Shell Reliability & Service Worker):**
   - While IndexedDB data survives browser tab close and reload, cold-booting `/scan/:pointId` when completely offline requires an installable Progressive Web App with a Cache-First Service Worker shell (`P1-PWA-MISSING`).
2. **Task 06 (Native Mobile Scanner Toolchain & Persistence):**
   - The Flutter mobile application requires full platform runner configuration (`android/`, `ios/`), Google ML Kit camera decoding, and embedded SQLite (`sqflite`) to replace in-memory maps (`P1-MOBILE-TOOLCHAIN`, `P1-MOBILE-DURABILITY`).
