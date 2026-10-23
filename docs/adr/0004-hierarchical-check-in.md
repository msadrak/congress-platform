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

## Status / Implementation notes (2026-10-23)

The decision above stands as history; this section records how far the code follows it.

- **Implemented:** a `CheckInPoint` per event with exactly one admission policy (`policy_type`), an allowed-tier list
  and an optional maximum capacity (ADR 0010), and a `CheckIn` row for every processed scan, admitted or rejected,
  keyed by the scanner's scan id so a replayed batch is idempotent.
- **Not implemented: the hierarchy.** A point has no scope (perimeter versus session or hall door) and no parent;
  points are independent, and admission at one point does not depend on admission at another. There is no
  badge-issuance point type.
- Halls and Entrances in the venue directory (ADR 0014) are informational only; a door that scans tickets needs its
  own Check-In Point. Double check-ins are prevented only per point and only where its policy says so (see the
  status section of ADR 0010).
