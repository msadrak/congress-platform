# Mobile scanner (`mobile/`): parked

**Status: parked (October 2026).** This folder is not a working mobile app and nothing here is shipped. The
production gate scanner is the web PWA at `/scan/:pointId` (`web/src/pages/GateScanner.tsx`). What is kept here is
a pure-Dart copy of the scanner's offline logic, with its tests, so that a native app can be revived later without
starting from nothing.

## What exists

- `lib/services/policy_engine.dart`: offline evaluation of a scan against a downloaded manifest for the four
  admission policies the backend implements (`MULTI_ENTRY`, `SINGLE_USE`, `TIER_RESTRICTED`, `CAPACITY_CAPPED`),
  with the backend's rejection codes (`INVALID_TICKET`, `ALREADY_ADMITTED`, `TIER_NOT_ALLOWED`, `CAPACITY_REACHED`).
- `lib/services/api_service.dart` and `sync_service.dart`: manifest download
  (`GET /api/checkin-points/{id}/manifest`) and batch upload of queued scans (`POST …/scans/batch`) with a scanner
  bearer token, a request timeout, and scans kept queued while the server is unreachable.
- `lib/services/storage_service.dart`: the storage interface and an **in-memory** implementation (manifest cache
  and scan queue are lost when the process ends).
- `lib/services/scan_labels.dart` and `lib/models/`: operator wording for rejection codes, and the data classes.
- `test/`: `dart test` covers the policy engine, the sync/API services (against a fake HTTP client), the in-memory
  queue, and the labels. `scripts/check.*` and CI run `dart test` and `dart analyze lib/models lib/services test`.

## What does not exist

- **No Flutter app.** `pubspec.yaml` declares only `http` and `uuid`: no Flutter SDK, so `lib/main.dart` and
  `lib/screens/` do not compile and are excluded from analysis. There are no `android/` or `ios/` projects.
- **No camera or QR detection.** No ML Kit or camera plugin; the scanner screen's `processCode` is not wired to any
  input.
- **No durable storage.** No SQLite (sqflite); nothing survives a restart, which an offline gate scanner needs.
- **No pairing flow matching the web scanner** (device-less scanner tokens, revocation, unpairing), no Persian copy,
  no RTL layout.

## Why the PWA is the scanner

The PWA already does everything a gate needs and is tested end to end: camera scanning (the native
`BarcodeDetector`, with jsQR as fallback), the offline manifest and scan queue in IndexedDB, idempotent batch sync,
scanner tokens that the organizer can revoke, Persian and English with RTL, and it installs from a link on any phone
or tablet with no app-store release. Maintaining a second scanner client would double that work for no gate feature
the PWA lacks today.

## Reviving it

A native app is worth it only for something the browser cannot do well (for example, dedicated hardware scanners,
kiosk lock-down, or Bluetooth badge printers). It would take:

1. A Flutter project (`flutter create`), with the Flutter SDK, `mobile_scanner` or Google ML Kit, and `sqflite` in
   `pubspec.yaml`, plus Android/iOS signing and a distribution channel (stores or MDM).
2. A SQLite `IStorageService` with the same contract and tests as the in-memory one.
3. Parity with the web scanner's pairing and authority rules (`web/src/lib/scannerAuthPolicy.ts`, `scannerPairing.ts`,
   `scannerTokenStore.ts`) and the backend's scanner token, revocation and coded-error responses.
4. Moving `scripts/check.*` and CI from `dart` to `flutter test` / `flutter analyze` for the whole package.
5. Re-checking the policy engine against the backend (`backend/app/routes/checkin.py`), which stays the authority:
   the device only gives a provisional answer until the batch sync returns the server's verdict.
