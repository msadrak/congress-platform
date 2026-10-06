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
