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
