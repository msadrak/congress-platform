# T00 — Pre-Commit Manifest, Repository Preservation & Isolated Verification Plan

**Task ID:** TASK T0-A (Preflight Baseline & Manifest Preparation)  
**Execution Mode:** STRICTLY READ-ONLY PREFLIGHT — DOCUMENTATION ONLY  
**Author:** Principal Release Engineer, Git Integration Specialist & Software Quality Auditor  
**Date:** 2026-10-11  
**Status:** **READY FOR HUMAN APPROVAL** (No Git Mutations, Staging, or Commits Executed in T0-A)

---

## 1. Executive Summary

This preflight manifest establishes an exact, human-reviewable commit plan and safe verification protocol prior to executing Task P03-T00.

The repository currently contains **42 pending files** in the working tree:
- **14 tracked modified files** representing the complete full-stack implementation of the Desk Operator, Reception, and Event Lifecycle Management feature (Task 05d/05h).
- **3 untracked backend files** representing Alembic migration `0011` and automated test suites for desk authentication and lifecycle management.
- **25 untracked documentation files** under `docs/architecture/portal-redesign/` representing the complete architectural specification, reconciliation, backlog, and independent audit artifacts from Phases 00 through 04.

### Preflight Audit Verdict: **READY FOR APPROVAL**
- **Zero Raw Secrets:** Scans of all 42 candidate diffs and contents confirmed zero unredacted API keys, JWT secrets, passwords, or production database credentials.
- **Strict Linear Migration:** Alembic revision `0011` cleanly extends `0010` and is 100% reversible via its `downgrade()` function.
- **Two-Commit Isolation Proposed:**
  - **Commit 1 (`feat`):** Exactly 17 files belonging to the Desk Operator & Lifecycle feature.
  - **Commit 2 (`docs`):** Exactly 26 documentation files under `docs/architecture/portal-redesign/` (including this preflight manifest).
- **Zero Git Mutations:** No commits, staging, branch creation, worktrees, or database operations were executed in T0-A.

---

## 2. Current Git Baseline (Verified Read-Only)

| Parameter | Current Repository Value | Verification Command |
|---|---|---|
| **Branch** | `integration/task-05h` | `git branch --show-current` |
| **HEAD SHA** | `284feaffa976171bfc4fdf5d6945d6936c507425` | `git rev-parse HEAD` |
| **Commit Subject** | `docs: add audit trail, design system, pilot, and release documentation` | `git log -1 --oneline` |
| **Staged Changes** | **0 files (Index is completely clean)** | `git diff --cached --name-status` |
| **Unstaged Tracked Modifications** | **14 files** | `git diff --name-status` |
| **Untracked Additions** | **28 files** (3 code/tests + 25 architecture docs) | `git ls-files --others --exclude-standard` |
| **Total Pending Files** | **42 files** | `git status --porcelain=v1 -uall` |
| **Whitespace Issues** | 1 trailing whitespace in `backend/tests/test_public_event.py:26` | `git diff --check` |

---

## 3. Complete Pending File Inventory (42 Files)

Every pending file in the repository has been categorized according to the mandatory taxonomy:
- **Category A:** Desk Operator & Lifecycle Feature (17 files)
- **Category B:** Architecture & Planning Documentation (25 files currently + 1 preflight report = 26 files)
- **Category C:** Existing Integration Work (0 files)
- **Category D:** Unrelated / User-Owned Files (0 files)
- **Category E:** Secrets / Sensitive Configuration (0 files — `.env` is safely ignored)
- **Category F:** Unknown Files (0 files)

```mermaid
pie title Pending Files Distribution (42 Total)
    "Category A (Desk Feature)" : 17
    "Category B (Architecture Docs)" : 25
```

---

## 4. Desk Operator Commit Manifest (Candidate Commit 1)

**Proposed Commit Message:**
```text
feat(desk): desk operator management, walk-in registration and attribution (0011)
```

**Exact File List (Exactly 17 Files):**

| # | Repository-Relative Path | Status | Category | Scope & Functional Summary |
|---|---|---|---|---|
| 1 | `backend/app/models.py` | Tracked (Modified) | A | Adds `DeskOperator` model and `tickets.issued_by_operator_id` foreign key. |
| 2 | `backend/app/routes/desk.py` | Tracked (Modified) | A | Complete Desk Operator API: login, operator management, rapid walk-in registration, attendee search, and scan history detail. |
| 3 | `backend/app/security.py` | Tracked (Modified) | A | Adds `create_desk_operator_token()` generating event-bound JWTs (`type: "desk_operator"`). |
| 4 | `backend/app/routes/checkin.py` | Tracked (Modified) | A | Adds `CheckInPointUpdate` and policy safety guard preventing policy mutation if scans exist. |
| 5 | `backend/app/routes/events.py` | Tracked (Modified) | A | Adds `EventUpdate` model and `PATCH /api/events/{id}` for organizer event settings. |
| 6 | `backend/app/routes/ticket_tiers.py` | Tracked (Modified) | A | Adds `TicketTierUpdate` and `PATCH /api/events/{id}/ticket-tiers/{id}`. |
| 7 | `backend/app/routes/public.py` | Tracked (Modified) | A | Fixes ticket tier query filtering to strictly match `TicketTier.event_id == event.id`. |
| 8 | `backend/tests/test_public_event.py` | Tracked (Modified) | A | Updates public event test to assert all tiers return with status and counts. |
| 9 | `web/src/api/client.ts` | Tracked (Modified) | A | Re-exports TypeScript desk types (`DeskOperatorOut`, `DeskOperatorCreate`, etc.). |
| 10 | `web/src/api/schema.d.ts` | Tracked (Modified) | A | Generated OpenAPI TypeScript definitions for desk and lifecycle endpoints (+409 lines). |
| 11 | `web/src/lib/i18n.ts` | Tracked (Modified) | A | Localization strings for front desk station, operator manager, and event edit forms. |
| 12 | `web/src/pages/OrganizerDesk.tsx` | Tracked (Modified) | A | Front desk station UI: operator login, walk-in form, search, pass minting, print view. |
| 13 | `web/src/pages/OrganizerEventDetail.tsx` | Tracked (Modified) | A | Event management UI: operator management tab, event settings, tier/gate editors. |
| 14 | `web/src/pages/OrganizerLayout.tsx` | Tracked (Modified) | A | Adjusts context to allow desk path without organizer API key prompt. |
| 15 | `backend/migrations/versions/0011_desk_operators_and_attribution.py` | Untracked (New) | A | Alembic migration creating `desk_operators` table and `tickets.issued_by_operator_id`. |
| 16 | `backend/tests/test_desk_operator_auth.py` | Untracked (New) | A | Automated tests for desk operator creation, login, JWT validation, revocation, and cross-event isolation. |
| 17 | `backend/tests/test_management_lifecycle.py` | Untracked (New) | A | Automated tests for event settings PATCH, tier quota edits, and check-in point policy updates. |

---

## 5. Architecture Documentation Commit Manifest (Candidate Commit 2)

**Proposed Commit Message:**
```text
docs(architecture): portal redesign specification, backlog and audit baseline (phases 00-04)
```

**Exact File List (Exactly 26 Files):**

| # | Repository-Relative Path | Phase | Description |
|---|---|---|---|
| 1 | `docs/architecture/portal-redesign/00_BASELINE_AUDIT.md` | Phase 00 | Baseline architecture, technology stack, and initial findings. |
| 2 | `docs/architecture/portal-redesign/00_ROUTE_AND_FEATURE_MATRIX.md` | Phase 00 | Inventory of existing routes, components, and capabilities. |
| 3 | `docs/architecture/portal-redesign/01_ARCHITECTURE_DECISIONS.md` | Phase 01 | Architecture Decision Records (D01–D10). |
| 4 | `docs/architecture/portal-redesign/01_AUTHENTICATION_ARCHITECTURE.md` | Phase 01 | Authentication families, token contracts, and credential boundaries. |
| 5 | `docs/architecture/portal-redesign/01_AUTHORIZATION_MATRIX.md` | Phase 01 | Authorization matrix and initial negative security scenarios. |
| 6 | `docs/architecture/portal-redesign/01_DOMAIN_MODEL.md` | Phase 01 | Domain model entities (`Partner`, `AttendeeType`, `Ticket`). |
| 7 | `docs/architecture/portal-redesign/01_MIGRATION_IMPACT.md` | Phase 01 | Migration sequencing and data preservation principles. |
| 8 | `docs/architecture/portal-redesign/01_REQUIREMENT_TRACEABILITY.md` | Phase 01 | Requirement traceability matrix for CR-01 through CR-11. |
| 9 | `docs/architecture/portal-redesign/02_ACCEPTANCE_AND_HANDOFF.md` | Phase 02 | Acceptance criteria, verification matrix, and handoff plan. |
| 10 | `docs/architecture/portal-redesign/02_FRONTEND_ARCHITECTURE.md` | Phase 02 | Multi-portal frontend shells and AuthContext design. |
| 11 | `docs/architecture/portal-redesign/02_INFORMATION_ARCHITECTURE.md` | Phase 02 | Information architecture, shallow navigation, and site map. |
| 12 | `docs/architecture/portal-redesign/02_ROUTE_AND_COMPONENT_MIGRATION.md` | Phase 02 | Route migration plan and component decomposition. |
| 13 | `docs/architecture/portal-redesign/02_UX_BLUEPRINT.md` | Phase 02 | User experience blueprints, mobile wireframes, and interaction flows. |
| 14 | `docs/architecture/portal-redesign/03_AGENT_EXECUTION_PROTOCOL.md` | Phase 03 | Agent execution protocol, boundaries, and reporting template. |
| 15 | `docs/architecture/portal-redesign/03_API_AND_DATA_MIGRATION.md` | Phase 03 | Exact API contracts, error codes, and migrations 0012–0014. |
| 16 | `docs/architecture/portal-redesign/03_ARCHITECTURE_RECONCILIATION.md` | Phase 03 | Reconciliation of AR-01 through AR-06. |
| 17 | `docs/architecture/portal-redesign/03_IMPLEMENTATION_ROADMAP.md` | Phase 03 | 67-task dependency DAG (124 edges) and structural critical path. |
| 18 | `docs/architecture/portal-redesign/03_TASK_BACKLOG.md` | Phase 03 | Complete 67-task atomic implementation specifications. |
| 19 | `docs/architecture/portal-redesign/03_TEST_AND_RELEASE_PLAN.md` | Phase 03 | Regression guards (R01–R20), 7 viewports, and release gates. |
| 20 | `docs/architecture/portal-redesign/04_INDEPENDENT_ARCHITECTURE_AUDIT.md` | Phase 04 | Independent architectural audit and CONDITIONAL GO verdict. |
| 21 | `docs/architecture/portal-redesign/04_BACKLOG_AUDIT.md` | Phase 04 | Task-by-task backlog classification and weak-agent directives. |
| 22 | `docs/architecture/portal-redesign/04_MVP_SCOPE_AND_PRIORITIES.md` | Phase 04 | P0/P1/P2/P3 prioritization and minimal 60-task MVP scope. |
| 23 | `docs/architecture/portal-redesign/04_SECURITY_AND_DATA_REVIEW.md` | Phase 04 | Token resurrection proof, server authorizers, and S01–S18 matrix. |
| 24 | `docs/architecture/portal-redesign/04_DEPENDENCY_AND_TEST_AUDIT.md` | Phase 04 | DAG cycle verification, critical path analysis, and quality gates. |
| 25 | `docs/architecture/portal-redesign/04_CORRECTION_AND_APPROVAL_REGISTER.md` | Phase 04 | Authoritative register of 10 architectural findings and corrections. |
| 26 | `docs/architecture/portal-redesign/T00_PRECOMMIT_MANIFEST.md` | Task T0-A | This preflight manifest and isolated verification specification. |

---

## 6. Excluded and Unrelated Files

- **Excluded Files:** **Zero.** All 42 existing pending files are accounted for and assigned to Commit 1 or Commit 2.
- **Ignored Files:** `.env` and `backend/.env` exist locally but are correctly ignored by `.gitignore` and MUST NOT be committed.
- **Generated Build Directories:** `node_modules/`, `dist/`, `.pytest_cache/`, `__pycache__/` are correctly ignored and excluded.

---

## 7. Sensitive Data & Secret Review

An automated regex scan was executed against the diffs of all 14 modified tracked files, the contents of the 3 untracked backend files, and all 25 architecture documents.

- **Private Keys:** Zero matches.
- **Live JWT Tokens:** Zero matches.
- **Production Connection Strings:** Zero matches. (All database URLs in tests use `postgresql://congress:congress@127.0.0.1:5433/congress_test`).
- **Administrative Tokens:** Zero matches. (All admin tokens in code use mock test fixtures like `"test-admin-token"`).
- **Finding:** **CLEAN.** No credentials or secrets exist in the staged candidate diffs.

---

## 8. Alembic Migration Chain Review

The migration graph was audited by inspecting all files in `backend/migrations/versions/`:
- `0001` -> `0002` -> `0003` -> `0004` -> `0005` -> `0006` -> `0007` -> `0008` -> `0009` -> `0010` -> `0011`
- **Revision 0011 Details:**
  - Revision ID: `"0011"`
  - Down Revision: `"0010"`
  - Tables Created: `desk_operators`
  - Columns Added: `tickets.issued_by_operator_id`
  - Downgrade Reversibility: Fully reversible. `downgrade()` drops the foreign key, column, and table in exact reverse order.
  - Multi-head Check: **Zero branching heads.** The chain is strictly linear.

---

## 9. Clean Worktree Verification Design

A separate Git Worktree must be used for verification to guarantee that:
1. Verification runs strictly against committed code at the approved SHA.
2. The primary working tree is never touched by `git checkout` or test file generation.

**Worktree Provisioning Strategy:**
```bash
# Provision isolated worktree outside repository root
git worktree add --detach ../congress-platform-baseline <COMMIT_2_SHA>
```

**Critical Workstation Guard (Windows WSL Path Warning):**
`scripts/check.bat` contains a hardcoded absolute workstation path:
```bat
cd '/mnt/h/Freelancing_Project/KalaniProject/DR.MaHDi/Congere Managment Platform/backend'
```
**CRITICAL:** If `scripts\check.bat` is invoked from inside `../congress-platform-baseline`, the WSL runner will navigate to the *original* repository rather than the worktree!  
Therefore, in T0-B verification, backend checks must be invoked using relative paths or explicit WSL commands targeting the worktree directory.

---

## 10. Isolated Test Database Verification Design

### 10.1 Destructive Database Behavior in `conftest.py`
Inspection of `backend/tests/conftest.py:25-58` revealed:
```python
TEST_DB = "congress_test"

async def _recreate_database() -> None:
    conn = await asyncpg.connect(ADMIN_DSN)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()
```
**CRITICAL SAFETY FINDING:**
- `TEST_DB = "congress_test"` is **hardcoded**.
- Every test session executing `pytest` connects to `ADMIN_DSN` and **FORCE DROPS AND RECREATES `congress_test`**.
- It then truncates all tables before every test.

### 10.2 Disposable Database Safety Preconditions
To guarantee that verification NEVER damages a developer's working database:
1. The PostgreSQL instance must be running on port 5433 (WSL isolated development container).
2. The database name `congress_test` is strictly dedicated to automated testing; no production or persistent development data may reside in `congress_test`.
3. If testing against a completely separate disposable database is required, `conftest.py` would require parameterized database names. For T0-B, testing is safe *only* because `congress_test` is already designated as the ephemeral test database.

---

## 11. Exact Future T0-B Execution Sequence

When human approval is granted, Task P03-T00 (T0-B) must execute the following 23 steps in strict sequence:

```text
 1. Verify working tree is clean of any unexpected edits: `git status --porcelain=v1 -uall`
 2. Confirm candidate file list matches this manifest exactly (17 feature files, 26 doc files).
 3. Stage the 17 Desk Operator feature files:
    git add backend/app/models.py backend/app/security.py backend/app/routes/desk.py \
            backend/app/routes/checkin.py backend/app/routes/events.py backend/app/routes/public.py \
            backend/app/routes/ticket_tiers.py backend/tests/test_public_event.py \
            backend/migrations/versions/0011_desk_operators_and_attribution.py \
            backend/tests/test_desk_operator_auth.py backend/tests/test_management_lifecycle.py \
            web/src/api/client.ts web/src/api/schema.d.ts web/src/lib/i18n.ts \
            web/src/pages/OrganizerDesk.tsx web/src/pages/OrganizerEventDetail.tsx web/src/pages/OrganizerLayout.tsx
 4. Verify staged diff matches expectations: `git diff --cached --stat`
 5. Execute pre-commit secret check on staged diff: `git diff --cached | grep -iE "secret|password|api_key"`
 6. Commit Feature 0011:
    git commit -m "feat(desk): desk operator management, walk-in registration and attribution (0011)"
 7. Record Commit 1 SHA: `COMMIT_1_SHA=$(git rev-parse HEAD)`
 8. Stage the 26 architecture documentation files:
    git add docs/architecture/portal-redesign/
 9. Verify staged diff: `git diff --cached --name-status`
10. Commit Architecture Baseline:
    git commit -m "docs(architecture): portal redesign specification, backlog and audit baseline (phases 00-04)"
11. Record Commit 2 SHA: `COMMIT_2_SHA=$(git rev-parse HEAD)`
12. Provision isolated verification worktree:
    git worktree add --detach ../congress-platform-baseline $COMMIT_2_SHA
13. Enter worktree: `cd ../congress-platform-baseline`
14. Verify migration upgrade in worktree:
    cd backend && uv run alembic upgrade head
15. Verify backend type checking in worktree:
    uv run mypy
16. Verify desk feature and lifecycle tests in worktree:
    uv run pytest tests/test_desk_operator_auth.py tests/test_management_lifecycle.py -q
17. Verify web unit tests in worktree:
    cd ../web && npm test
18. Verify web type checking in worktree:
    npm run typecheck
19. Verify web production build in worktree:
    npm run build
20. Return to primary repository: `cd ../Congere\ Managment\ Platform`
21. Remove verification worktree: `git worktree remove ../congress-platform-baseline`
22. Confirm primary working tree is completely clean and matches $COMMIT_2_SHA.
23. STOP. Do not push. Do not proceed to P03-T01 without approval.
```

---

## 12. Failure and Recovery Strategy

| Failure Scenario in T0-B | Immediate Action | Recovery Procedure |
|---|---|---|
| Unexpected file modified prior to staging | **ABORT** staging immediately. | Inspect with `git diff`; request human triage. |
| Suspected secret detected in staged diff | **UNSTAGE** immediately (`git restore --staged .`). | Redact or exclude offending file; do not commit. |
| Worktree creation fails | **STOP**. | Check disk space / path permissions. Do not run in-place checkout. |
| Alembic upgrade fails in worktree | **PRESERVE WORKTREE**. | Inspect migration error; do NOT reset commits in primary tree. |
| Backend pytest fails in worktree | **PRESERVE WORKTREE**. | Inspect test output. Verify PostgreSQL service on port 5433. |
| Web build or typecheck fails in worktree | **PRESERVE WORKTREE**. | Inspect TypeScript diagnostics. Fix forward via reviewed commit. |
| Primary working tree disturbed | **DO NOT RUN `git reset --hard`**. | Restore index using `git restore --staged .` only. |

---

## 13. Remaining Risks and Blockers

1. **Workstation Script Path Dependency:** `scripts/check.bat` hardcodes the WSL path to the original directory. T0-B verification must execute tests via the relative directory commands specified in Section 11 rather than blindly running `scripts\check.bat`.
2. **PostgreSQL WSL Service:** Backend tests require PostgreSQL running on port 5433 (accessible via WSL `service postgresql start`). If the service is stopped, pytest fails with a connection error.
3. **Trailing Whitespace:** `backend/tests/test_public_event.py:26` contains a trailing whitespace. This is harmless but will be noted during code formatting waves.

---

## 14. Human Approval Checklist

Before Task P03-T00 can execute:
- [ ] User approves the 17-file Desk Operator commit manifest.
- [ ] User approves the 26-file Architecture documentation commit manifest.
- [ ] User confirms Commit 1 message: `feat(desk): desk operator management, walk-in registration and attribution (0011)`.
- [ ] User confirms Commit 2 message: `docs(architecture): portal redesign specification, backlog and audit baseline (phases 00-04)`.
- [ ] User authorizes creating the isolated worktree `../congress-platform-baseline` for verification.
- [ ] User confirms that `congress_test` on port 5433 is an ephemeral test database safe to drop and recreate.

---

## 15. Final T0-A Verdict

### Verdict: **READY FOR HUMAN APPROVAL**

- Preflight inspections: **COMPLETE**
- Secret scan: **PASSED (0 secrets detected)**
- Migration integrity: **PASSED (0011 verified linear and reversible)**
- File manifest: **100% ACCOUNTED FOR (42 of 42 files categorized)**
- Safety restrictions: **STRICTLY ENFORCED (Zero Git mutations executed in T0-A)**

*Awaiting explicit human authorization to proceed with Task P03-T00.*
