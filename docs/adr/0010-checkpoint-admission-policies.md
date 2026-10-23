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

## Status / Implementation notes (2026-10-23, migration 0025)

The decision above stands as history; this section records how the code implements it.

- **Rules combine.** A point has one `policy_type` (MULTI_ENTRY, SINGLE_USE, CAPACITY_CAPPED) plus independent settings:
  a tier filter (`allowed_tier_ids`, for every policy; empty admits every tier), a `reset_window`, `tracks_occupancy`,
  a required point and a session (ADR 0004). `TIER_RESTRICTED` is kept for existing points and API clients: it means
  MULTI_ENTRY with a required, non-empty tier filter. The console no longer offers it for new points. Existing rows
  are not rewritten, so a rollback to the previous release (which ignores the filter elsewhere) keeps them restricted.
- **Order of checks** for an entry: tier filter (`TIER_NOT_ALLOWED`), required point (`REQUIRED_POINT_NOT_VISITED`),
  single use in the window (`ALREADY_ADMITTED`), already inside (admitted, not counted again), capacity
  (`CAPACITY_REACHED`). An exit needs a point that tracks occupancy (`EXIT_NOT_TRACKED`) and a ticket inside
  (`NOT_INSIDE`); an accepted exit is recorded `ADMITTED` with `direction = OUT`.
- **Windows.** `reset_window` is EVENT or DAY. DAY windows are calendar days in `events.timezone`; every scan stores its
  `admission_window` ('event' or the local date of its trusted scan time) and the single-use unique index is per
  (point, ticket, window), e.g. one lunch per day. A capped point without occupancy counts admissions per window;
  at a point with occupancy, presence starts afresh each day (forgotten exits do not carry over).
- **Occupancy.** With `tracks_occupancy`, who is inside is decided per ticket by the accepted entry or exit with the
  latest scan time (so an exit uploaded late by an offline door does not undo a later entry); a capped point caps the
  people inside. Policy, window and occupancy are locked once the point has scans (`CHECKIN_POINT_POLICY_LOCKED`).
  Analytics report `occupancy` per point; `current_occupancy` keeps its deprecated meaning (cumulative admissions).
- **Offline.** The manifest carries the window it describes, the event time zone, the people inside and, per ticket,
  `last_admitted_window`, `is_inside`, `presence_at` and `prerequisite_met`. The web scanner's engine applies the same
  checks in the same order (`web/src/lib/scannerEngine.ts`; shared scenarios in
  `backend/tests/fixtures/gate_parity.json`), computes the window on its own clock (so a manifest from yesterday does
  not count yesterday's meal), and stays fail-closed for new entries at capped points (`CAPACITY_UNAVAILABLE_OFFLINE`);
  exits are decided provisionally. A delta that crosses a day boundary is answered with a full manifest.
- **Older scanners** (installed PWAs before this release) keep working: they send no direction (every scan is an
  entry), read `is_admitted` for the server's current window, and get only allowed tiers in the manifest; the server
  decides every uploaded scan, so their offline guesses are corrected at sync.
