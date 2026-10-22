# 0010: Check-In Point Admission Policies

## Context
Different checkpoints have fundamentally different access constraints. Keynote halls track room capacity; VIP tracks enforce ticket tier entitlements; and dining/catering areas strictly require single-scan enforcement (one meal per attendee per service window).

## Decision
Check-In Points enforce configurable **Admission Policies**:
1. **Policy Rules:**
   - `SINGLE_USE`: Validates that the ticket has not been scanned at this check-in point within a specified time window (e.g. Catering Lunch window). Subsequent scans return an explicit rejection: `ALREADY_ADMITTED`.
   - `MULTI_ENTRY`: Allows repeated scans with entry/exit timestamps (e.g. Main Entrance re-entry).
   - `TIER_RESTRICTED`: Validates that the attendee's ticket tier belongs to the allowed tier list (e.g. VIP Lounge).
   - `CAPACITY_CAPPED`: Rejects scans when the active in-room count reaches maximum capacity.
2. **Offline Policy Execution:**
   - The downloaded check-in manifest provides the scanner client with the rules and local lookup tables necessary to enforce `SINGLE_USE` and `TIER_RESTRICTED` policies locally without real-time server roundtrips.

## Consequences
- Fully configurable admission rules across halls, booths, and catering areas using a single backend engine and scanner interface.
- Prevents meal theft and room overcrowding deterministically.

## Status / Implementation notes (2026-10-23)

The decision above stands as history; the code implements a narrower version of it.

- **One policy per point:** a Check-In Point carries one `policy_type`, and policies do not combine (a capped VIP room
  cannot also be tier-restricted).
- **`SINGLE_USE` has no time window:** a ticket is admitted **once ever** per point (`ALREADY_ADMITTED` afterwards),
  enforced under concurrency by a row lock and the partial unique index `uq_checkin_single_use_admitted`. Per-meal or
  per-day windows are not implemented; another service window needs another point.
- **`MULTI_ENTRY` records no entry or exit:** every valid scan is admitted; scans have no direction.
- **`CAPACITY_CAPPED` counts cumulative admissions, not occupancy:** the limit is reached after `max_capacity`
  admissions in total, and nobody leaving frees a place. Net in-room occupancy would need exit scans, which do not
  exist.
- **`TIER_RESTRICTED`** works as described.
- **Offline:** the web scanner (`web/src/lib/scannerEngine.ts`) evaluates all four policies locally from the manifest
  and marks offline admissions provisional; the server re-evaluates every scan at batch sync and its verdict wins. For a capped
  point the device only knows its own count, so offline admissions can overshoot the cap until sync; the engine has a
  fail-closed option (`CAPACITY_UNAVAILABLE_OFFLINE`) that nothing turns on yet.
