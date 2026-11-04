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
  polling a PostgreSQL table; sign-in and SMS throttling are counted in PostgreSQL (`rate_limit_counters`,
  `app/rate_limit.py`, ADR 0019), not Redis.
- **Not horizontally scaled yet.** Since ADR 0019 the throttles are shared by every process, the outbox claims rows with
  `FOR UPDATE SKIP LOCKED` and a lease, and each process reloads the platform settings (ADR 0013) within
  `CONGRESS_PLATFORM_SETTINGS_REFRESH_SECONDS` of a change made elsewhere. The deployment still runs **one API
  process**, the only tested configuration; the parts that remain per process (metrics counters, the SMS concurrency
  limit, the database pool, media on the host disk) are listed in `docs/deployment/STAGING_OPERATIONS.md`. Sizing:
  `docs/deployment/HOSTED_STAGING_READINESS.md` §4.
