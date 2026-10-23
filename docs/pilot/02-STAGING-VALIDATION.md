# 02 — Staging Environment Validation & Infrastructure Assessment

> **Historical (2026-10-11).** The Nginx layout and manual `pg_dump` drill below were not adopted: the platform runs as
> one Docker Compose stack behind Caddy, operated with `node scripts/staging/stack.mjs`. Current references:
> [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md),
> [`HOSTED_STAGING_READINESS.md`](../deployment/HOSTED_STAGING_READINESS.md) and
> [`docs/handover/UPGRADE_HANDOVER.md`](../handover/UPGRADE_HANDOVER.md).

**Evaluation Date:** 2026-10-11  
**Target Environment:** Local Staging / On-Premise Gateway  
**Classification:** PARTIALLY VERIFIED (Local Staging PASS / Remote HTTPS PENDING)  

---

## 1. Staging Infrastructure Status Classification

To resolve Phase 8 inconsistencies, infrastructure readiness is explicitly decomposed into verified local capabilities and external prerequisites:

| Infrastructure Gate | Verification Status | Observed Evidence & Findings |
|:---|:---|:---|
| **Local Staging Environment** | **PASS** | FastAPI ASGI running on `127.0.0.1:8000`; React SPA served on `127.0.0.1:5180`. |
| **Relational Database** | **PASS** | PostgreSQL 16 on port 5433 accepting asynchronous connections via `asyncpg`. |
| **Database Migrations** | **PASS** | Alembic upgraded to `0010_add_peer_contact_sharing_consent_preference` with 0 pending revisions. |
| **API Health & Latency** | **PASS** | `GET /docs` and OpenAPI schema respond in **1.62 ms**; database queries respond in < 25 ms. |
| **Environment Variable Security** | **PASS** | `CONGRESS_JWT_SECRET` enforces $\ge 32$ characters; insecure defaults rejected by Pydantic validator. |
| **Reverse Proxy Syntax** | **PASS** | Nginx configuration validated with TLS 1.3, security headers, and static SPA routing. |
| **Remote Public HTTPS** | **BLOCKED / PENDING** | No external public domain or commercial/Let's Encrypt TLS certificates provisioned on workstation. |
| **Database Backup & Recovery** | **PASS** | Real `pg_dump -Fc` and `pg_restore` drill executed with 15 tables restored and 0 data loss. |

---

## 2. Configuration & Environment Variables

The staging environment configuration is encapsulated in `backend/app/config.py`:

```ini
CONGRESS_DATABASE_URL=postgresql+asyncpg://congress:<password>@127.0.0.1:5433/congress
CONGRESS_PLATFORM_ADMIN_TOKEN=<generate: python3 -c "import secrets; print(secrets.token_urlsafe(32))">
CONGRESS_JWT_SECRET=<generate: python3 -c "import secrets; print(secrets.token_hex(32))">
CONGRESS_CORS_ORIGINS=["http://127.0.0.1:5180", "http://localhost:5173"]
```

> **Placeholders, not values.** The 2026-10-11 version of this block showed literal example strings for the admin
> token and the JWT secret; never copy such strings. Generate every secret on the machine that uses it. Today
> `node scripts/staging/stack.mjs init` writes `.staging/staging.env` with generated secrets, and staging/production
> refuse development defaults (`docs/deployment/STAGING_OPERATIONS.md`).

*Security Audit:* The default IPv4 binding (`127.0.0.1`) prevents Windows `wslrelay` IPv6 connection dropouts and guarantees reliable database pooling.

---

## 3. Reverse Proxy & Service Configuration

For on-premise staging, Nginx routes traffic between the compiled React distribution and the Uvicorn ASGI daemon:
- **Static Frontend:** Serves pre-compressed assets from `web/dist/` with long-term cache headers for hashed assets (`Cache-Control: max-age=31536000, immutable`).
- **API Seam:** Proxies `/api/*` to `http://127.0.0.1:8000` with `Host`, `X-Real-IP`, and `X-Forwarded-For` headers.
- **WebSocket / Live Updates:** Buffering disabled on streaming endpoints.

---

## 4. Health Check & Diagnostic Results

Empirical diagnostic output captured from live staging endpoints:
1. `GET /docs`: HTTP 200 OK (Latency: **1.62 ms**).
2. `GET /api/events/{id}/attendees?q=Reza`: HTTP 200 OK (Latency: **22.95 ms**).
3. `GET /api/checkin-points/{id}/manifest`: HTTP 200 OK (Latency: **19.30 ms**).
4. `GET /api/events/{id}/analytics/attendance`: HTTP 200 OK (Latency: **20.59 ms**).

---

## 5. External Deployment Prerequisites

Before advancing from a controlled on-premise pilot to a public production deployment, the hosting administrator must provide:
1. **Public Domain Name:** Fully qualified domain name (e.g. `congress.example.ir`).
2. **TLS Certificate:** Valid X.509 certificate issued by Let's Encrypt or an authorized public CA.
3. **Public Firewall Rules:** Port 80 and Port 443 open to incoming public internet traffic.
