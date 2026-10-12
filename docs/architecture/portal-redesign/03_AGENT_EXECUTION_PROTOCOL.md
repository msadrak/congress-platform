# Phase 03 — Agent execution protocol

Status: PLANNING ONLY. This protocol authorizes no implementation, commit, push, deployment, dependency installation, or migration now. Phase 04 independently reviews the plan; implementation requires a later explicit assignment. Phase 00–02 remain unchanged. Read `03_ARCHITECTURE_RECONCILIATION.md` for amendments, `03_API_AND_DATA_MIGRATION.md` for contracts, and the assigned entry in `03_TASK_BACKLOG.md` for scope. Task IDs and hard prerequisites are authoritative in the backlog.

## Execution procedure for a future assigned task

1. Read the assigned task in full, its referenced decisions, prerequisite completion reports and exact baseline SHA. A proposed API is not an existing dependency: verify prerequisite delivery and generated client types. If a prerequisite or product approval is absent, report BLOCKED before editing.
2. Record `git branch --show-current`, `git rev-parse HEAD`, `git status --porcelain=v1 --untracked-files=all`, `git diff --name-only`, and `git diff --cached --name-only`. Record the distinction between pre-existing and task-owned changes. Never display credential values. T0 must have an approved reproducible baseline before any other implementation task begins.
3. Read relevant loaded repository instructions and `docs/CODING_STANDARDS.md`. Inspect only assigned source, consumers, tests and contracts. Confirm exact API paths and existing ownership checks. Read existing tests before choosing a test location.
4. Preserve unrelated work. Do not reset, clean, stash, rebase, merge, discard, rewrite history, stage broadly, or delete unfamiliar files. If assigned files have conflicting concurrent edits, stop and request integration-owner resolution; do not overwrite them. Use a dedicated approved workspace for concurrency.
5. Implement only IN SCOPE. Reuse the existing authorizers, EntityQR payload, tier reservation transaction, lead isolation, networking privacy, cache and scanner contracts unless the task explicitly changes one. Proposed new modules are responsibilities, not permission to invent a second framework or library. Final module names must follow the existing repository pattern and be reported.
6. Keep backend authorization mandatory. An AuthContext, selected portal, partner ID, event selector, decoded JWT claim or hidden button is not proof of permission. Use scoped authenticated clients; public requests carry no Authorization header. No automatic token substitution or retry under stronger authority.
7. Add or adjust behavior-focused tests specified by the task, including negative ownership cases. Test a consumer-observable invariant, not implementation wiring or static DOM existence. New migrations require disposable-database upgrade/backfill tests before UI consumers are enabled.
8. Run task-specific checks and affected regression cases from R01–R20 in `03_TEST_AND_RELEASE_PLAN.md`. Record exact working directory, command, exit status, test counts where supplied, and output artifact. A failure is not an invitation to weaken assertions or widen accepted status codes without an approved contract change.
9. Run browser journeys for UI changes, including direct reload, browser Back and prescribed viewports in EN/LTR and FA/RTL. Test actual API-backed behavior; label mocks and separate them from real-backend proof. Do not seed or mutate production data. Use isolated synthetic accounts/events and a disposable database.
10. Run the canonical full-stack gate before completing an implementation task as required by repository instructions: Windows `scripts\check.bat`; POSIX/Git Bash `./scripts/check.sh`. Inspect current scripts first: Windows currently has workstation-specific WSL and Dart paths. A unavailable dependency/environment is BLOCKED, not PASS. Do not substitute historical counts. Browser E2E, migrations and native device checks are additional gates, not implied by this script.
11. Inspect task-owned changes and report changed files, generated schema changes, migrations, compatibility evidence and deviations. Compare initial/current inventory without destroying pre-existing changes. Do not audit unrelated files or silently incorporate their work.
12. Deliver the report below and stop after the assigned task. No next task, commit, push, GitHub issue, deployment, or production migration without a distinct explicit authorization. T0 permits only reviewed local commits after its separate approval gate; no other task inherits commit permission.

## Integration ownership and parallel execution

One integration owner serializes changes to `web/src/api/client.ts`, `web/src/main.tsx`, `web/src/api/schema.d.ts`, `backend/app/models.py`, shared auth state, `web/src/lib/i18n.ts`, and the Alembic chain. Parallel work is allowed only after prerequisite contracts are delivered, on independent files/workspaces. Domain migrations are ordered, even when their feature design is independent. Each child task skips mid-flight full build/lint/format runs; the integration owner runs them after the coherent wave is integrated. Task-local negative and contract tests still earn explicit evidence before a task is accepted.

## Standard implementation report

```text
Task ID / title:
Verdict: PASS | PARTIAL | BLOCKED
Initial branch / SHA / dirty inventory:
Prerequisites verified (task report and SHA):
Approved product decisions:
Scope delivered (observable behavior):
Changed files (existing / new / generated):
Pre-existing changes preserved:
API contract and error-code changes:
Data migration / backfill evidence (disposable DB only):
Commands run (cwd, exact command, exit, output artifact):
Task-specific automated results:
R01–R20 regression cases exercised:
Browser / viewport / RTL / accessibility evidence:
Security negative tests:
Offline and printed-QR compatibility evidence:
Not run (reason; NEVER count as passing):
Deviations (approval reference or BLOCKED):
Rollback / containment:
Residual risks:
Canonical full-stack gate result:
Definition-of-done checklist:
Git operations authorized and actually performed:
STOP: assigned task concluded; no subsequent task started.
```

## Pass/fail rule

PASS requires every assigned criterion and required gate with newly executed evidence. PARTIAL means reachable scope exists but one mandatory gate is missing; BLOCKED means a required decision, contract, environment or prerequisite is unavailable. A passing unit suite never establishes release readiness. Do not report a planned test as executed, a source read as rendered UI verification, or an existing dirty file as your deliverable.

## Phase 03 audit boundary

During preparation of these documents, only read-only Git/source inspection and documentation-integrity analysis are permitted. Application verification commands are deliberately deferred: backend pytest fixtures recreate a database, and builds/tests may write generated files. Phase 03 must report historical results as historical and verify its own planning deliverables without executing T0 or migrations.
