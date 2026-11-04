# 0009: Dual-Client Scanner Architecture (React PWA and Native Flutter)

## Context
Gate check-in lines at congresses experience high arrival surges. Gate operations require maximum scanning speed (low camera latency) and zero operational friction (instant deployment on volunteers' phones without app store delays). Additionally, reception desks with laptops require USB barcode gun support.

## Decision
We implement a **Dual-Client Scanner Architecture** powered by a single, unified FastAPI backend API:
1. **Unified Backend Sync Contract:**
   - `GET /api/checkin-points/{id}/manifest`: Returns a compact JSON snapshot of valid ticket secrets, attendee names, ticket tiers, and admission statuses.
   - `POST /api/checkin-points/{id}/scans/batch`: Ingests queued scan events idempotently using client-generated `scan_id` (UUIDv4) keys.
2. **Client 1: React Web / PWA (Instant Access & Kiosk Desks):**
   - Zero-installation web client accessible via any mobile or desktop browser.
   - Caches manifests in browser `IndexedDB`; decodes camera video via `BarcodeDetector` API.
   - Supports USB/Bluetooth hardware barcode guns (HID keyboard emulation) for instantaneous (<10ms) desk operations.
3. **Client 2: Flutter Mobile App (Dedicated High-Speed Handheld Scanner):**
   - Native iOS and Android app compiled to ARM bytecode.
   - Leverages Google ML Kit (native CameraX / AVFoundation) for sub-40ms camera autofocus and decode.
   - Caches manifests and buffers offline scans in local SQLite.

## Consequences
- The system achieves both zero-install operational flexibility (volunteers open a URL) and native hardware camera performance (dedicated staff run the Flutter app).
- Both clients use identical data schemas, offline buffering logic, and idempotent sync APIs.

## Status / Implementation notes (2026-10-23)

The dual-client decision is **superseded**: the web PWA is the only scanner. The sync contract changed with the scanner
workstream (A2, migration `0020`).

- **One client.** The gate scanner is the PWA at `/scan/:pointId` (`web/src/pages/GateScanner.tsx`,
  `web/src/lib/scanner*.ts`): camera decoding with the native `BarcodeDetector` and jsQR as fallback, HID barcode guns
  (also typed on a Persian keyboard layout), manifest and scan queue in IndexedDB. The Flutter app was never built and
  is parked (`mobile/README.md`); its pure-Dart engine speaks the old contract (raw secrets, no verdicts) and does not
  work against this API.
- **Hashed manifest.** `GET /api/checkin-points/{id}/manifest` carries no QR secrets: each ticket has
  `qr_hash = sha256("<event_id>:<normalized secret>")` (`manifest_qr_hash`, `backend/app/routes/checkin.py`), and the
  scanner hashes a scanned code the same way. `?since=<cursor>` returns a delta (changed tickets plus
  `removed_qr_hashes` for cancelled tickets and deactivated QRs); the scanner asks for one every 30 s while online.
  Consequence: a scanner build from before this change rejects every badge on the new API, so scanners are updated
  together with the backend (runbook §3).
- **Online scans are decided by the server:** `POST /api/checkin-points/{id}/scan` applies the same rules, locks and
  idempotency as the batch. When it does not answer within 2 s the device decides locally and queues the scan with the
  same `scan_id`.
- **Device verdicts.** A queued scan carries `client_verdict` (`ADMITTED`, `PROVISIONAL`, `REJECTED`) and the local
  reason. A scan the device rejected is recorded as REJECTED and is never turned into an admission at sync time; other
  queued scans are evaluated by the server, whose verdict wins and shows up as a conflict on the device when it differs.
- **Batch** `POST /api/checkin-points/{id}/scans/batch`: at most **200** scans per request, in order, idempotent by
  `scan_id`; longer queues upload in chunks. A device time more than 5 minutes ahead of the server is not trusted: the
  scan is recorded at the receive time with `clock_skew` set and the claim kept in `client_scanned_at`.
- **Offline rules.** Offline admissions are provisional; capacity-capped points reject everyone offline
  (`CAPACITY_UNAVAILABLE_OFFLINE`, turned on in `GateScanner.tsx`); after 24 h without a successful manifest download
  the device stops admitting (`web/src/lib/scannerAuthPolicy.ts`).
- **Device authority and data.** Scanner tokens are bound to a device row and refused once the device is revoked or the
  organizer key is rotated (ADR 0016). Unpairing, or a revoked/expired credential, wipes the cached manifest and synced
  scans from the device (`wipePointData`); unsynced scans stay until they are uploaded or an operator discards them.
  One tab per point holds a Web Lock, so two tabs never scan the same point's queue.
