# Task 05F — Git Integration Plan

**Date:** 2026-10-11  
**Repository:** `master`, HEAD `3046cfe6b6365e6476f7bf7ab7b4f3f176d3e5ce`  
**Purpose:** Organize the working-tree changes into reviewable commits for integration.

## Executive Summary

The working tree contains **46 modified tracked files** and **39 untracked files/directories** spanning backend, web, mobile, documentation, and infrastructure. This plan organizes them into coherent, reviewable commits while preserving all work and maintaining rollback capability.

## File Classification

### 1. Backend Implementation (Core)

| File | Change Type | Purpose |
|------|-------------|---------|
| `backend/app/routes/checkin.py` | Modified | Scanner self-revoke endpoint, authorization hardening |
| `backend/app/routes/auth.py` | Modified | JWT secret validation, auth improvements |
| `backend/app/routes/network.py` | Modified | Peer contact sharing consent |
| `backend/app/routes/analytics.py` | Modified | Analytics endpoints |
| `backend/app/routes/leads.py` | Modified | Lead management |
| `backend/app/models.py` | Modified | ScannerDevice model, peer consent field |
| `backend/app/security.py` | Modified | JWT handling, CSV sanitization |
| `backend/app/config.py` | Modified | Configuration validation |
| `backend/tests/conftest.py` | Modified | Test fixture improvements |
| `backend/.env.example` | Modified | Environment template |

### 2. Backend Migrations (Required)

| File | Purpose |
|------|---------|
| `backend/migrations/versions/0008_scanner_devices.py` | Scanner device table, per-device revocation |
| `backend/migrations/versions/0009_admission_concurrency_control.py` | Concurrency control, single-use index |
| `backend/migrations/versions/0010_peer_contact_consent.py` | Peer contact sharing consent |

### 3. Backend Tests (Security & Reliability)

| File | Purpose |
|------|---------|
| `backend/tests/test_scanner_security.py` | Scanner auth, revocation, cross-tenant isolation |
| `backend/tests/test_scanner_revocation_matrix.py` | **NEW** Comprehensive failure-matrix tests (18 tests) |
| `backend/tests/test_concurrency.py` | Concurrent admission, idempotency |
| `backend/tests/test_csv_security.py` | CSV injection prevention |
| `backend/tests/test_e2e_lifecycle.py` | Full lifecycle integration |
| `backend/tests/test_analytics.py` | Analytics endpoints |
| `backend/tests/test_checkin.py` | Check-in flows |
| `backend/tests/test_desk_registration.py` | Front-desk operations |
| `backend/tests/test_networking.py` | Peer networking |
| `backend/tests/unit_scanner_security.py` | Unit tests for scanner security |

### 4. Web Implementation

| File | Change Type | Purpose |
|------|-------------|---------|
| `web/src/pages/GateScanner.tsx` | Modified | Scanner UI, unpair flow, offline handling |
| `web/src/lib/scannerAuthPolicy.ts` | **NEW** | Offline authorization policy |
| `web/src/lib/scannerTokenStore.ts` | **NEW** | Credential persistence |
| `web/src/lib/scannerEngine.ts` | Modified | Scan evaluation engine |
| `web/src/lib/scannerStorage.ts` | Modified | Local storage |
| `web/src/lib/ticketCache.ts` | **NEW** | Ticket caching |
| `web/src/lib/audioFeedback.ts` | Modified | Audio feedback |
| `web/src/lib/i18n.ts` | **NEW** | Internationalization |
| `web/src/lib/pwaRegistration.ts` | **NEW** | PWA registration |
| `web/src/api/client.ts` | Modified | API client |
| `web/src/api/schema.d.ts` | Modified | TypeScript types |
| `web/src/main.tsx` | Modified | App entry |
| `web/src/index.css` | Modified | Styles |
| `web/index.html` | Modified | HTML shell |
| `web/vite.config.ts` | Modified | Build config, PWA |
| `web/package.json` | Modified | Dependencies |
| `web/package-lock.json` | Modified | Lockfile |

### 5. Web Pages (UI Updates)

| File | Purpose |
|------|---------|
| `web/src/pages/ExhibitorPortal.tsx` | Exhibitor lead portal |
| `web/src/pages/Home.tsx` | Landing page |
| `web/src/pages/MyNetwork.tsx` | Networking hub |
| `web/src/pages/MyTickets.tsx` | Ticket portal |
| `web/src/pages/OrganizerAnalytics.tsx` | Analytics dashboard |
| `web/src/pages/OrganizerDesk.tsx` | Front-desk operations |
| `web/src/pages/OrganizerEventDetail.tsx` | Event management |
| `web/src/pages/OrganizerEvents.tsx` | Event list |
| `web/src/pages/OrganizerLayout.tsx` | Organizer layout |
| `web/src/pages/PublicBooth.tsx` | Public booth profile |
| `web/src/pages/PublicEvent.tsx` | Public event page |

### 6. Web Components & Layouts

| File | Purpose |
|------|---------|
| `web/src/components/ui/Badge.tsx` | **NEW** UI component |
| `web/src/components/ui/Button.tsx` | **NEW** UI component |
| `web/src/components/ui/Card.tsx` | **NEW** UI component |
| `web/src/components/ui/Dialog.tsx` | **NEW** UI component |
| `web/src/components/ui/SkipLink.tsx` | **NEW** UI component |
| `web/src/layouts/AttendeeLayout.tsx` | **NEW** Layout |
| `web/src/layouts/PublicLayout.tsx` | **NEW** Layout |

### 7. Web Tests & E2E

| File | Purpose |
|------|---------|
| `web/tests/scannerAuthPolicy.test.ts` | **NEW** Auth policy unit tests |
| `web/tests/scannerEngine.test.ts` | Modified scanner engine tests |
| `web/tests/scannerReliability.test.ts` | **NEW** Reliability tests |
| `web/tests/ticketCache.test.ts` | **NEW** Ticket cache tests |
| `web/e2e/scanner-offline.spec.ts` | **NEW** Offline E2E tests (24 tests) |
| `web/e2e/scanner-real-api.spec.ts` | **NEW** Live API E2E test |
| `web/playwright.config.ts` | **NEW** Playwright configuration |
| `web/tsconfig.e2e.json` | **NEW** E2E TypeScript config |

### 8. Mobile (Dart/Flutter)

| File | Change Type | Purpose |
|------|-------------|---------|
| `mobile/lib/models/manifest_ticket.dart` | Modified | Ticket model |
| `mobile/lib/models/scan_record.dart` | Modified | Scan record model |
| `mobile/lib/services/api_service.dart` | Modified | API service |
| `mobile/lib/services/storage_service.dart` | Modified | Local storage |
| `mobile/lib/services/sync_service.dart` | Modified | Sync service |
| `mobile/test/api_and_sync_test.dart` | Modified | API/sync tests |
| `mobile/test/storage_and_sync_test.dart` | **NEW** Storage/sync tests |

### 9. Infrastructure & Scripts

| File | Change Type | Purpose |
|------|-------------|---------|
| `scripts/check.bat` | Modified | **FIXED** Windows verification with WSL pytest |
| `.gitignore` | Modified | Git ignore rules |
| `start-demo.bat` | **NEW** Demo startup script |
| `start-demo.ps1` | **NEW** Demo startup script |
| `stop-demo.bat` | **NEW** Demo shutdown script |
| `stop-demo.ps1` | **NEW** Demo shutdown script |
| `backend/seed_demo.py` | **NEW** Demo data seeding |

### 10. Documentation (Preserve but Review)

| Category | Files | Notes |
|----------|-------|-------|
| Audit Reports | `docs/audits/*.md` (9 files) | Historical audits, keep for reference |
| Design Docs | `docs/design/*.md` (20 files) | Design decisions, keep |
| Design Evidence | `docs/design/*evidence/*.png` (~100 files) | Screenshots, consider size |
| Pilot Docs | `docs/pilot/*.md` (10 files) | Pilot program docs |
| Release Docs | `docs/release/*.md` (9 files) | Release preparation |
| Release Evidence | `docs/release/evidence/*.png` (14 files) | Screenshots |
| Manual Testing | `docs/MANUAL-TESTING.md` | Testing guide |

### 11. User Data (Do Not Commit)

| File | Reason |
|------|--------|
| `.obsidian/` | User's Obsidian vault configuration |
| `nul` | Windows reserved filename artifact |
| `web/test-results/` | Test artifacts (add to .gitignore) |
| `web/public/*.svg` | PWA icons (generated, consider regenerating) |

## Proposed Commit Structure

### Commit 1: Backend — Scanner Security & Revocation
```
feat(backend): add scanner device self-revocation and security hardening

- Add POST /api/checkin-points/{point_id}/devices/self/revoke endpoint
- Implement per-device token binding via JWT jti claim
- Add authorization checks for scanner token scope (point, event)
- Add revocation state checking to all scanner endpoints
- Add scanner device model and migration (0008)
- Add comprehensive security regression tests (test_scanner_security.py)
- Add revocation failure-matrix tests (test_scanner_revocation_matrix.py)

BREAKING: Scanner tokens now require device binding; old tokens without jti claim are rejected.
```

**Files:**
- `backend/app/routes/checkin.py`
- `backend/app/models.py`
- `backend/app/security.py`
- `backend/migrations/versions/0008_scanner_devices.py`
- `backend/tests/test_scanner_security.py`
- `backend/tests/test_scanner_revocation_matrix.py`
- `backend/tests/unit_scanner_security.py`

### Commit 2: Backend — Concurrency & Data Integrity
```
feat(backend): add admission concurrency control and idempotency

- Add single-use unique index for check-ins (migration 0009)
- Implement pessimistic locking for capacity-capped gates
- Add idempotent batch replay handling
- Add concurrent admission race tests (test_concurrency.py)

Fixes: Race conditions in concurrent scan admission.
```

**Files:**
- `backend/migrations/versions/0009_admission_concurrency_control.py`
- `backend/tests/test_concurrency.py`
- `backend/app/routes/checkin.py` (concurrency portions)

### Commit 3: Backend — Privacy & Consent
```
feat(backend): add peer contact sharing consent

- Add share_contact_with_peers field to users (migration 0010)
- Enforce consent in networking endpoints
- Update privacy controls in vCard export

Related: GDPR/privacy compliance for attendee networking.
```

**Files:**
- `backend/migrations/versions/0010_peer_contact_consent.py`
- `backend/app/models.py` (User model)
- `backend/app/routes/network.py`
- `backend/tests/test_networking.py`

### Commit 4: Backend — Supporting Improvements
```
refactor(backend): improve test fixtures, auth validation, and utilities

- Update conftest.py with better database lifecycle
- Strengthen JWT secret validation in config
- Improve CSV sanitization in security.py
- Update analytics, leads, desk registration, and ticket tests
- Update .env.example with required variables
```

**Files:**
- `backend/tests/conftest.py`
- `backend/app/config.py`
- `backend/app/routes/analytics.py`
- `backend/app/routes/leads.py`
- `backend/app/routes/auth.py`
- `backend/tests/test_analytics.py`
- `backend/tests/test_checkin.py`
- `backend/tests/test_desk_registration.py`
- `backend/tests/test_csv_security.py`
- `backend/tests/test_e2e_lifecycle.py`
- `backend/.env.example`

### Commit 5: Web — Scanner Offline & PWA
```
feat(web): add offline-capable scanner with PWA support

- Add offline authorization policy (scannerAuthPolicy.ts)
- Add credential persistence with IndexedDB (scannerTokenStore.ts)
- Add ticket caching for offline access (ticketCache.ts)
- Implement PWA with service worker (pwaRegistration.ts, vite.config.ts)
- Add PWA icons and manifest
- Update GateScanner with offline sync, unpair flow, and error handling
- Add i18n support for English/Persian
- Add UI component library (Badge, Button, Card, Dialog, SkipLink)
- Add layout components (AttendeeLayout, PublicLayout)

Includes: 24 offline E2E tests, live API integration test.
```

**Files:**
- `web/src/lib/scannerAuthPolicy.ts`
- `web/src/lib/scannerTokenStore.ts`
- `web/src/lib/ticketCache.ts`
- `web/src/lib/pwaRegistration.ts`
- `web/src/lib/i18n.ts`
- `web/src/lib/audioFeedback.ts`
- `web/src/lib/scannerEngine.ts`
- `web/src/lib/scannerStorage.ts`
- `web/src/pages/GateScanner.tsx`
- `web/src/components/ui/*.tsx`
- `web/src/layouts/*.tsx`
- `web/src/api/client.ts`
- `web/src/api/schema.d.ts`
- `web/src/main.tsx`
- `web/src/index.css`
- `web/index.html`
- `web/vite.config.ts`
- `web/package.json`
- `web/package-lock.json`
- `web/public/*.svg`
- `web/tests/scannerAuthPolicy.test.ts`
- `web/tests/scannerReliability.test.ts`
- `web/tests/ticketCache.test.ts`
- `web/e2e/scanner-offline.spec.ts`
- `web/e2e/scanner-real-api.spec.ts`
- `web/playwright.config.ts`
- `web/tsconfig.e2e.json`

### Commit 6: Web — Organizer & Attendee Pages
```
feat(web): update organizer console and attendee portals

- Update OrganizerEvents, OrganizerEventDetail, OrganizerDesk pages
- Update OrganizerAnalytics with real-time metrics
- Update MyTickets with offline cache and QR display
- Update MyNetwork with peer contact sharing controls
- Update ExhibitorPortal with lead capture and qualification
- Update PublicEvent and PublicBooth pages
- Update Home landing page
```

**Files:**
- `web/src/pages/OrganizerEvents.tsx`
- `web/src/pages/OrganizerEventDetail.tsx`
- `web/src/pages/OrganizerDesk.tsx`
- `web/src/pages/OrganizerAnalytics.tsx`
- `web/src/pages/MyTickets.tsx`
- `web/src/pages/MyNetwork.tsx`
- `web/src/pages/ExhibitorPortal.tsx`
- `web/src/pages/PublicEvent.tsx`
- `web/src/pages/PublicBooth.tsx`
- `web/src/pages/Home.tsx`

### Commit 7: Mobile — Offline Sync
```
feat(mobile): add offline scan queue and sync

- Update manifest and scan record models
- Improve API service with retry logic
- Enhance storage service with queue management
- Add sync service for offline-to-online reconciliation
- Add comprehensive unit tests

Note: Flutter screens require Flutter SDK; this commit covers Dart logic only.
```

**Files:**
- `mobile/lib/models/manifest_ticket.dart`
- `mobile/lib/models/scan_record.dart`
- `mobile/lib/services/api_service.dart`
- `mobile/lib/services/storage_service.dart`
- `mobile/lib/services/sync_service.dart`
- `mobile/test/api_and_sync_test.dart`
- `mobile/test/storage_and_sync_test.dart`

### Commit 8: Infrastructure — Verification & Demo
```
chore(infra): fix Windows verification and add demo scripts

- Fix check.bat to run pytest in WSL (asyncpg stability)
- Add demo startup/shutdown scripts
- Add demo data seeding script
- Update .gitignore for test artifacts
```

**Files:**
- `scripts/check.bat`
- `.gitignore`
- `start-demo.bat`, `start-demo.ps1`
- `stop-demo.bat`, `stop-demo.ps1`
- `backend/seed_demo.py`

### Commit 9: Documentation — Audits & Design
```
docs: add audit reports, design documentation, and release preparation

- Add baseline audit and task remediation reports
- Add design system documentation
- Add pilot program documentation
- Add release preparation checklists
- Add manual testing guide
```

**Files:**
- `docs/audits/*.md`
- `docs/design/*.md`
- `docs/pilot/*.md`
- `docs/release/*.md`
- `docs/MANUAL-TESTING.md`

**Note:** Design evidence PNGs (~100 files) are large; consider using Git LFS or external storage.

## Integration Checklist

Before committing:
- [ ] Run `scripts/check.bat` — must pass all gates
- [ ] Run `git diff --check` — no whitespace errors
- [ ] Verify no secrets in staged files
- [ ] Verify .obsidian/, nul, test-results/ are excluded
- [ ] Create feature branch: `git checkout -b feature/task-05f-scanner-security`
- [ ] Stage and commit in order (1-9 above)
- [ ] Push branch: `git push -u origin feature/task-05f-scanner-security`
- [ ] Create PR for review

## Rollback Plan

The recovery archive is at:
`H:\Freelancing_Project\KalaniProject\DR.MaHDi\recovery-archives\task05f-worktree-20261011T102638.tar.gz`

To restore: extract archive over working tree, or reset to HEAD and re-apply specific files.
