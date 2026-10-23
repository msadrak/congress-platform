# 0008: Polymorphic Entity QR Architecture

## Context
In addition to attendees holding tickets with QR codes, congresses require QR-based interactions across other physical and logical entities: exhibitor booths (for information/leads), lecture halls and rooms (for session schedules/door checks), and catering vouchers. Designing a ticket-only QR model would require redesigning tables and scanner logic for future phases.

## Decision
We implement a **Polymorphic Entity QR** pattern:
1. A dedicated `EntityQR` registry stores unique 128-bit CSPRNG secrets, mapped to an `entity_type` (`attendee_ticket`, `booth`, `hall`, `session`) and an `entity_id`.
2. All QR payloads encode a standard URI or compact token referencing this secret.
3. Check-in scanners resolve the `EntityQR` payload to verify entitlement and apply relevant admission policies.

## Consequences
- The database schema and scanner pipelines remain identical whether scanning an attendee badge at a dining hall or scanning a booth badge in future phases.
- Avoids schema migrations or scanner software rewrites when expanding QR interactions.

## Status / Implementation notes (2026-10-23)

The decision above stands as history; this section records how far the code follows it.

- **Implemented:** the `entity_qrs` registry (random secret, `entity_type`, `entity_id`, `is_active`). Two entity
  types are minted: `attendee_ticket` (with every ticket, online or at the desk) and `booth` (with every booth).
- **Not implemented:** `hall` and `session` QRs. Halls and sessions (ADR 0014) have no QR, and the check-in scanner
  accepts only `attendee_ticket` secrets; a booth QR is not a check-in credential.
- There is no single shared scanner pipeline: gate check-in, exhibitor lead capture and attendee networking (ADR 0011)
  each resolve attendee ticket QRs in their own endpoint. Ticket reissue (rotating a ticket's QR) is being added by
  another workstream and is not done at the time of writing.
