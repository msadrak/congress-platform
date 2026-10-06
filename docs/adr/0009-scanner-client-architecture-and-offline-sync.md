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
