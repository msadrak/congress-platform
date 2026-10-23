# 0004: Hierarchical Check-In Points

## Context
Congresses require access control at two levels: initial arrival at the venue perimeter (for badge issuance) and internal doors (keynote halls, VIP lounges, workshops with limited seat capacities).

## Decision
Check-in operations are modeled around a configurable `CheckInPoint` entity associated with an `Event`. Each check-in point specifies:
- The scope: perimeter (main gate badge issuance) or session/hall door.
- Permitted ticket tiers and maximum capacity constraints.
- Admission records: append-only `Check-In` events tied to a specific ticket and timestamp.

## Consequences
- The system supports both single-gate events and complex multi-hall convention centers using the exact same data model.
- Prevents double check-ins at restricted capacity sessions while keeping perimeter entry fast.

## Status / Implementation notes (2026-10-23, migration 0025)

The decision above stands as history; this section records how far the code follows it.

- **Implemented:** a `CheckInPoint` per event with its gate rules (ADR 0010) and a `CheckIn` row for every processed
  scan, admitted or rejected, keyed by the scanner's scan id so a replayed batch is idempotent.
- **Hierarchy:** `requires_point_id` names a point of the same event at which a ticket must have been admitted first
  (`REQUIRED_POINT_NOT_VISITED` otherwise), e.g. the venue entrance before a hall. It is validated on write (same
  event, not itself, no cycle: `REQUIRED_POINT_INVALID`); a point another one requires cannot be deleted
  (`CHECKIN_POINT_REQUIRED_BY_OTHER`). "Admitted first" means ever admitted there, not currently inside.
- **Session doors:** `session_id` links a point to a programme session (ADR 0014). Every entry admitted at the session's
  doors is its attendance: `GET /api/events/{id}/sessions/{session_id}/attendance` (staff) and `…/attendance-csv`
  (managers; sanitised, BOM, event time zone, audited as an export). Halls and Entrances in the venue directory stay
  informational; a door that scans tickets needs its own point.
- **Archive:** a point with scans is archived, not deleted: hidden from pairing, its scanners are refused
  (`CHECKIN_POINT_ARCHIVED`), its scans stay in analytics; scans recorded offline before the archive still upload.
  An archived congress refuses every point change and pairing (`EVENT_ARCHIVED`); its points' own archive flag is
  separate and survives unarchiving the congress.
- **Not implemented:** a badge-issuance point type.
