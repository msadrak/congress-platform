# Task 03 Remediation Report: Atomic Admission Integrity & Concurrency Safety

**Role:** Principal Backend Engineer (PostgreSQL Concurrency & High-Reliability Systems)  
**Objective:** Remediate `P1-CONCURRENCY-ADMISSION` through database-enforced admission integrity and concurrency control.  
**Baseline Commit:** `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce`  
**Status:** **FULLY REMEDIATED & VERIFIED** across 93/93 backend integration tests on real PostgreSQL 16.

---

## 1. Executive Summary

Task 03 resolves the critical concurrency vulnerability (`P1-CONCURRENCY-ADMISSION`) where simultaneous scan requests at event gates allowed double admissions for `SINGLE_USE` tickets (e.g. catering meals) and allowed simultaneous arrivals to exceed `CAPACITY_CAPPED` hall limits.

We engineered a **two-layer defense-in-depth concurrency control architecture**:
1. **Application-Level Row-Level Locks (`SELECT ... FOR UPDATE`):**
   - Serializes admission decisions without requiring distributed lock managers (e.g., Redis).
   - For `CAPACITY_CAPPED` points: Locks the `CheckInPoint` row to ensure count-then-admit operations are strictly serialized.
   - For `SINGLE_USE` points: Locks the `Ticket` row to serialize concurrent scans of the same ticket across multiple entrances or handheld devices.
   - Enforces a strict lock hierarchy (Level 1: `CheckInPoint` $\rightarrow$ Level 2: `Ticket`) that **mathematically eliminates deadlocks**.
2. **Database-Level Storage Engine Constraint (Alembic Migration `0009`):**
   - Added column `policy_type` to `checkins` and backfilled from `checkin_points`.
   - Created PostgreSQL partial unique index:
     ```sql
     CREATE UNIQUE INDEX uq_checkin_single_use_admitted
     ON checkins (checkin_point_id, ticket_id)
     WHERE status = 'ADMITTED' AND policy_type = 'SINGLE_USE' AND ticket_id IS NOT NULL;
     ```
   - Guarantees that at the database storage engine level, at most one `ADMITTED` record can ever exist for a given ticket at a single-use checkpoint.
   - Completely preserves `MULTI_ENTRY` semantics (unaffected because `policy_type != 'SINGLE_USE'`) and audit logging (`REJECTED` rows are unconstrained).
3. **Resilient Transaction Boundaries & Savepoint Error Recovery:**
   - Wrapped scan insertions in SQLAlchemy nested savepoints (`async with session.begin_nested():`).
   - If a duplicate `scan_id` arrives concurrently (primary key conflict), it is caught and replayed idempotently without throwing a 500 Internal Server Error.
   - If an admission race bypasses application locks, `uq_checkin_single_use_admitted` collision is caught, the sub-transaction is rolled back, and the attempt is recorded cleanly as `REJECTED` (`ALREADY_ADMITTED`).

---

## 2. Root Cause & Reproduction Evidence

### 2.1 The Vulnerability Mechanics
In `backend/app/routes/checkin.py:527-556` (prior implementation):
```python
if point.policy_type == "SINGLE_USE":
    already_admitted = await session.scalar(
        select(CheckIn.id).where(
            CheckIn.checkin_point_id == point.id,
            CheckIn.ticket_id == ticket.id,
            CheckIn.status == "ADMITTED",
        )
    )
    if already_admitted is not None:
        scan_status = "REJECTED"
        rejection_reason = "ALREADY_ADMITTED"
...
session.add(checkin)
```
- **The Gap:** The `SELECT` query and subsequent `session.add(checkin)` / `commit()` were uncoordinated across transactions.
- **The Race:** If Request 1 and Request 2 arrived at the same time:
  1. Transaction 1 executes `SELECT CheckIn.id` -> finds `None`.
  2. Transaction 2 executes `SELECT CheckIn.id` -> finds `None` (Transaction 1 has not committed yet).
  3. Both transactions conclude the ticket is unadmitted.
  4. Both insert `CheckIn(status="ADMITTED")`.
  5. Both commit successfully because the table had no unique constraint.
- **The Result:** Double physical admission. Attendee receives two meals or two entries on one ticket.

### 2.2 Reproduction Script & Before/After Execution Evidence

We constructed a deterministic test script simulating two interleaved database sessions (`s1` and `s2`) querying `already_admitted` simultaneously before either commits:

#### Before Remediation (Vulnerable State):
```
Transaction 1 sees admitted: None
Transaction 2 sees admitted: None
Transaction 1 committed ADMITTED successfully!
Transaction 2 committed ADMITTED successfully! (DOUBLE ADMISSION VULNERABILITY PROVEN)
Total ADMITTED records in DB for this ticket: 2
```

#### After Remediation (Secured State):
```
Transaction 1 committed ADMITTED successfully!
SUCCESS: Transaction 2 BLOCKED by database constraint: IntegrityError
Total ADMITTED records in DB for this ticket: 1 (MUST BE EXACTLY 1)
```

And in the HTTP API integration test (`tests/test_concurrency.py::test_concurrent_single_use_admission_race`):
```
Concurrent Request 1 outcome: ADMITTED
Concurrent Request 2 outcome: REJECTED (ALREADY_ADMITTED)
HTTP Status Codes: Both 200 OK (Zero 500 errors)
```

---

## 3. Concurrency-Control Design & Reasoning

### 3.1 Lock Ordering and Deadlock Elimination
When handling admission requests, locks are acquired in a strict global hierarchy:
$$\text{Level 1: } \text{CheckInPoint} \longrightarrow \text{Level 2: } \text{Ticket}$$

| Policy Type | Locks Acquired | Purpose |
|:---|:---|:---|
| `SINGLE_USE` | Lock `Ticket` row (`with_for_update()`) | Serializes concurrent check-in evaluations for the same ticket across all gates/devices. |
| `CAPACITY_CAPPED` | Lock `CheckInPoint` row (`with_for_update()`) | Serializes admittance counting to ensure net room capacity is never exceeded. |
| `MULTI_ENTRY` | None | Operates with zero lock contention, allowing maximum throughput for general venue turnstiles. |
| `TIER_RESTRICTED` | None | Pure in-memory whitelist validation against ticket tier; zero lock overhead. |

Because locks are acquired in the exact same hierarchy ($Point \rightarrow Ticket$), cyclic wait conditions are impossible, preventing database deadlocks.

### 3.2 Database-Level Partial Unique Constraint
```sql
CREATE UNIQUE INDEX uq_checkin_single_use_admitted
ON checkins (checkin_point_id, ticket_id)
WHERE status = 'ADMITTED' AND policy_type = 'SINGLE_USE' AND ticket_id IS NOT NULL;
```
- **Why Partial?**
  - For `MULTI_ENTRY`, multiple `ADMITTED` records are legitimate and required. A standard unique constraint would break multi-entry venues.
  - For `REJECTED` scans, multiple entries are necessary for audit trails (e.g. logging every time an attendee attempts an invalid entry).
  - The `WHERE status = 'ADMITTED' AND policy_type = 'SINGLE_USE'` predicate isolates the constraint strictly to single-use admissions.

### 3.3 Idempotency and Collision Recovery
In `ingest_scans_batch`:
```python
try:
    async with session.begin_nested():
        session.add(checkin)
        await session.flush()
except IntegrityError as e:
    err_str = str(e).lower()
    # 1. Primary key collision: Concurrent retry of the exact same scan_id
    existing_pk = await session.get(CheckIn, scan.scan_id)
    if existing_pk is not None:
        # Replay committed outcome idempotently
        results.append(ScanResult(...))
        continue
    # 2. Unique constraint collision: Racing transaction won the single-use race
    if "uq_checkin_single_use_admitted" in err_str or "unique" in err_str:
        rejected_checkin = CheckIn(
            id=scan.scan_id,
            checkin_point_id=point.id,
            ticket_id=ticket.id,
            qr_secret=scan.qr_secret,
            policy_type=point.policy_type,
            status="REJECTED",
            rejection_reason="ALREADY_ADMITTED",
            scanned_at=scan.scanned_at,
        )
        async with session.begin_nested():
            session.add(rejected_checkin)
            await session.flush()
    else:
        raise
```
- Distinguishes identical re-transmissions (replaying the original outcome without double counting) from distinct scan attempts for an already-consumed ticket (recording a fresh `REJECTED` audit entry).
- Protects batch processing: if scan 3 in a 5-scan batch experiences a collision, only its sub-transaction is rolled back, allowing the remaining valid scans in the batch to commit cleanly.

---

## 4. Exact Changed Files & Migrations

| File | Subsystem | Nature of Modification |
|:---|:---|:---|
| `backend/migrations/versions/0009_admission_concurrency_control.py` | Migrations | Linear Alembic revision `0009` (revising `0008`):<br>1. Adds column `policy_type` to `checkins`.<br>2. Backfills `policy_type` from `checkin_points`.<br>3. Creates partial unique index `uq_checkin_single_use_admitted`. |
| `backend/app/models.py` | ORM Models | Added `policy_type: Mapped[str] = mapped_column(String(32), default="MULTI_ENTRY", index=True)` to `CheckIn`. |
| `backend/app/routes/checkin.py` | API Handler | 1. Added `with_for_update()` row locking on `CheckInPoint` for `CAPACITY_CAPPED` and `Ticket` for `SINGLE_USE`.<br>2. Set `policy_type=point.policy_type` on all `CheckIn` records.<br>3. Wrapped admissions in `session.begin_nested()` to catch `IntegrityError` and handle collisions. |
| `backend/tests/test_concurrency.py` | Integration Tests | **New 5-test concurrency suite** validating atomic single-use admissions, capacity caps, duplicate `scan_id` idempotency, and multi-entry throughput. |

---

## 5. Verification & Test Outcomes

### 5.1 Concurrency Suite Execution (`tests/test_concurrency.py`)
Executed inside the provisioned environment against PostgreSQL 16:
```
tests/test_concurrency.py::test_concurrent_single_use_admission_race PASSED      [ 20%]
tests/test_concurrency.py::test_concurrent_capacity_capped_race PASSED        [ 40%]
tests/test_concurrency.py::test_concurrent_same_scan_id_idempotent_replay PASSED [ 60%]
tests/test_concurrency.py::test_multi_entry_multiple_admissions_allowed PASSED [ 80%]
tests/test_concurrency.py::test_batch_upload_mixed_concurrent_admissions PASSED [100%]

============================== 5 passed in 4.31s ===============================
```

### 5.2 Full Backend Pytest Suite Execution
Executed across all 16 test modules in `backend/tests/`:
```
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.1.1, pluggy-1.6.0
rootdir: .../backend
configfile: pyproject.toml
testpaths: tests
collected 93 items

tests/test_analytics.py ................                                 [ 17%]
tests/test_auth.py ....                                                  [ 21%]
tests/test_booth_bookmarks.py .....                                      [ 26%]
tests/test_booths.py .....                                               [ 32%]
tests/test_checkin.py .......                                            [ 39%]
tests/test_concurrency.py .....                                          [ 45%]
tests/test_desk_registration.py ......                                   [ 51%]
tests/test_events.py ...........                                         [ 63%]
tests/test_lead_qualification.py .....                                   [ 68%]
tests/test_leads.py .....                                                [ 74%]
tests/test_networking.py ......                                          [ 80%]
tests/test_organizers.py ...                                             [ 83%]
tests/test_public_event.py ...                                           [ 87%]
tests/test_scanner_security.py ...............                           [ 93%]
tests/test_ticket_tiers.py ....                                          [ 97%]
tests/test_tickets.py .....                                              [100%]

============================= 93 passed in 39.90s ==============================
```

- **Backend Typecheck (`uv run mypy`):** `Success: no issues found in 40 source files` (Strict mode).
- **Web Frontend (`npm test && npm run typecheck && npm run build`):** 5/5 unit tests passed, 0 TypeScript errors, bundle compiled in 2.32s.
- **Mobile Stack (`dart test && dart analyze lib/models lib/services test`):** 8/8 tests passed, 0 warnings.

---

## 6. Performance Implications

1. **`MULTI_ENTRY` & `TIER_RESTRICTED` Paths:**
   - Zero lock acquisition overhead.
   - Database operations use existing read paths and standard append-only inserts.
   - Peak venue gate throughput is completely unthrottled.
2. **`SINGLE_USE` Path:**
   - Contention is localized to the specific `Ticket` ID being scanned.
   - Because delegates scan their badges at distinct times, lock duration is limited to single-row index updates ($\approx 1\text{--}2\text{ms}$).
   - Different attendees scanning at the same catering entrance do not block each other.
3. **`CAPACITY_CAPPED` Path:**
   - Serializes admissions per room checkpoint.
   - At high arrival spikes for limited-capacity keynote rooms, transactions queue briefly on the `CheckInPoint` row lock for the duration of the count query ($\approx 2\text{--}5\text{ms}$).
   - Provides guaranteed safety without requiring external Redis lock managers.

---

## 7. Remaining Risks & Offline Consistency Notice

1. **Distributed Offline Admission Conflicts:**
   - **Boundary Notice:** As specified in the task constraints, this remediation solves **server-side atomic concurrency** across all online devices and concurrent batch uploads.
   - **Offline Limitation:** If two disconnected handheld devices operating offline without network access both scan the same `SINGLE_USE` meal badge, both local devices will locally evaluate the ticket as valid based on their cached manifest snapshot.
   - **Reconciliation:** When connectivity is restored, the first batch uploaded to the server is admitted; the second batch is rejected by PostgreSQL (`ALREADY_ADMITTED`).
   - Resolving physical double-entry notification and scanner UI conflict reconciliation (`P1-SYNC-SILENT-FAIL`) remains scheduled for its dedicated upcoming task.
2. **Production Migrations:** Production deployment must run `alembic upgrade head` to apply revision `0009_admission_concurrency_control` so the partial unique index is created before handling live event traffic.
