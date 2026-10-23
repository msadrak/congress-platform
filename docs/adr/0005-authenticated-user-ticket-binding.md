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

## Status / Implementation notes (2026-10-23)

The core of the decision holds; the claim flow it assumed was not built.

- **Implemented:** every ticket is bound to an authenticated User (`tickets.user_id`). Since ADR 0012 a User is an
  Iranian mobile number proven by an SMS code; passwords and e-mail sign-in no longer exist. Attendees see their
  tickets across congresses from one account.
- **Not implemented:** the `Claim Link` and the Order distribution it belongs to (ADR 0003). A ticket is created
  already bound: online by the signed-in User, at the desk for the User found or created for the person
  registered (the mobile number is optional there; without one the person cannot sign in later).
- **Exception for viewing:** the short link of ADR 0015 opens a ticket's pass read-only without a sign-in code (Link
  pass). It grants no profile, network or write access, so the binding rule above still governs everything else.
- Profile details (name, organization, title) live on the User, and each ticket keeps its own copy of them
  (`tickets.attendee_*`, migration `0023`): that copy is what the congress shows, prints and exports and what its
  organizer edits, without touching the account (ADR 0017).
