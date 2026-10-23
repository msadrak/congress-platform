# 0002: Multi-Tenant Modular Monolith for Scalability

## Context
The platform must support multiple independent congress organizers and scale horizontally to handle traffic surges (such as ticket release bursts and morning gate arrivals). However, distributed microservices or multi-database architectures introduce excessive operational complexity for a lean team.

## Decision
We adopt a **modular monolith** with **row-level multi-tenancy** (tenant/organizer scoping across all queries). The architecture comprises:
1. A stateless web application layer that scales horizontally behind a reverse proxy/load balancer.
2. A single primary PostgreSQL database with indexed foreign keys and connection pooling.
3. Redis for caching, atomic inventory counters, and background job queuing (Celery/worker).

## Consequences
- Operational overhead remains low: one codebase, one database migration stream, one deployment pipeline.
- Scalability is achieved by scaling stateless application containers and offloading slow tasks (emails, badge rasterization, reports) to background workers.

## Status / Implementation notes (2026-10-23)

The decision above stands as history; this section records how far the code follows it.

- **Implemented:** one FastAPI codebase, one PostgreSQL database, one Alembic migration stream, and organizer scoping
  on every event-owned query (row-level tenancy).
- **Not implemented: Redis and Celery.** Neither is a dependency. Ticket inventory is an atomic conditional `UPDATE`
  of `ticket_tiers.reserved_count` in PostgreSQL; the SMS outbox (ADR 0012) is an asyncio task inside the API process
  polling a PostgreSQL table; sign-in and SMS throttling are in-process counters (`app/rate_limit.py`), which another
  workstream is moving to PostgreSQL.
- **Not horizontally scaled yet.** The in-process throttles, the outbox loop and the platform settings cache
  (ADR 0013) assume **one API process per deployment**. Several replicas need shared throttling state and a settings
  change notification first. The supported pilot size is in `docs/pilot/MASTER-PILOT-READINESS.md`.
