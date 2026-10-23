# 0007: Zero-Cost Registration and Elimination of Payment Gateway

## Context
Initial platform design assumed ticketing might involve paid tiers, requiring payment gateways (Zarinpal, Stripe, etc.), PSP redirects, webhook verification, and payment failure handling. However, the congress platform operates on free registration across all ticket tiers.

## Decision
We eliminate all payment gateways and billing logic from the core platform:
1. All tickets are zero-cost ($0 / free).
2. An `Order` is a direct ticket reservation transaction that completes immediately upon submission without checkout redirects or financial transaction states.
3. No payment provider libraries, webhooks, or financial data storage are included in the codebase.

## Consequences
- Radically simplifies the checkout domain model, API contracts, and testing surface.
- Maximizes checkout throughput during traffic surges by eliminating external third-party payment gateway latency and failure points.

## Status / Implementation notes (2026-10-23)

The decision holds and is implemented.

- No payment provider, webhook or financial field exists in the code or the schema; `ticket_tiers` has a quota and a
  `reserved_count`, no price (`backend/app/models.py`). Payments stay out of scope (upgrade handover §2).
- **No `Order` table:** the "order" is the reservation itself. `POST /api/events/{event_id}/tickets/reserve` takes a
  place with one conditional `UPDATE` of `ticket_tiers.reserved_count` (guarded by `reserved_count < quota`, and since
  migration `0021` also by the CHECK `0 <= reserved_count <= quota`) and creates the ticket in the same transaction. One
  person holds at most one ticket per congress (`uq_tickets_event_user`); registering again after a cancellation reuses
  the row (ADR 0017).
- Reserving is refused unless the event's page is published, the event is not archived, its registration window is
  open and the tier's sales window is open (migration `0024`; coded errors such as `REGISTRATION_CLOSED`,
  `REGISTRATION_NOT_OPEN` and `TIER_SOLD_OUT`, ADR 0022).
- Cancelling (by the organizer, by the attendee before the congress starts, or by account deletion) returns the place
  to the tier in the same transaction (`backend/app/ticket_lifecycle.py`).
