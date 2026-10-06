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
