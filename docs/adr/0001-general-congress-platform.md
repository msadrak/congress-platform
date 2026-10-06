# 0001: General Independent Congress Platform Scope

## Context
Initial research assumed an Iranian medical congress platform tightly coupled with Continuing Medical Education (CME / آموزش مداوم) credits, medical council credentialing, and regulatory reporting. Coupling the core platform to medical-specific constraints unnecessarily complicates the data model and limits the platform's versatility.

## Decision
We decouple the core system from medical-specific workflows. The platform is designed as an independent, scalable congress platform supporting general multi-session, multi-track conferences. Domain primitives are focused strictly on conference lifecycle management (`Event`, `Organizer`, `Order`, `Ticket`, `Attendee`, `Session`, `Check-In`, `Badge`). Any industry-specific compliance requirements (such as CME) are deferred or treated as peripheral extensions.

## Consequences
- The data model and business logic center on scalable event operations, ticket distribution, and gate management.
- Scalability across concurrent ticket sales, multi-gate admissions, and multi-event operations becomes a primary architectural invariant.
