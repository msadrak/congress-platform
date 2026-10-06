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
