# 0003: Decoupled Order and Attendee Claim Model

## Context
In professional conferences and congresses, buyers often purchase tickets in bulk for teams, students, or colleagues. Tying the payment transaction directly to a single attendee profile prevents corporate buying and creates messy data mutations when attendees change.

## Decision
We decouple the `Order` from the `Ticket` and `Attendee`:
- An `Order` belongs to a `Buyer` and contains one or more `Ticket` items across various tiers.
- A `Ticket` can be assigned directly at checkout or claimed asynchronously via a secure, one-time `Claim Link`.
- The `Attendee` profile is populated when the ticket is claimed, locking in badge details without requiring full account creation.

## Consequences
- Enables bulk purchases, corporate sponsorships, and delegate management with zero friction.
- Eliminates account creation friction for attendees who just need to claim their badge.

## Status / Implementation notes (2026-10-23)

The decision above was **not implemented**; it remains here as history.

- There is no `Order`, `Buyer` or `Claim Link` in the schema or the API. A ticket is reserved by a signed-in User for
  themselves and bound to that User (`tickets.user_id`, one ticket per User per event); at the desk, staff register a
  person by name (mobile number optional) and the ticket is bound to the User found or created for that person (Desk
  Registration).
- Bulk or third-party registration is therefore not possible today. `GLOSSARY.md` marks Buyer, Order and Claim Link
  as not implemented.
- In progress in another workstream, not done at the time of writing: a participant register that keeps the
  registration's own copy of the holder's details, and ticket cancel, reissue and transfer. Transfer covers the
  "attendee changes" case without an order model. Reviving bulk ordering needs a new ADR.
