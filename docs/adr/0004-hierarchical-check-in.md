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
