# 0005: Authenticated User Account Ticket Binding

## Context
When an Order contains multiple tickets, the buyer distributes them to attendees. We considered allowing anonymous ticket claiming without user accounts, but this prevents attendees from managing their registrations, viewing schedule updates, and accessing tickets across multiple events on the platform.

## Decision
All ticket claims require an authenticated `User` account:
1. An attendee opening a `Claim Link` must log in or register a `User` account.
2. Upon authentication, the `Ticket` is formally bound to the attendee's `User` ID.
3. The attendee's profile (name, affiliation, title) is stored and synchronized with the ticket for badge printing.

## Consequences
- Attendees gain a persistent home to view all their current and historical congress tickets.
- Introduces an authentication step in the claim funnel, but ensures strong data ownership and accurate attendee records.
