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
