# 06 — Deployment Architecture & Pilot Infrastructure Specification

> **SUPERSEDED (2026-10-23).** This document describes a bare-metal Nginx + systemd layout the project did not adopt. The platform runs as one Docker Compose stack behind Caddy. Current documents:
> - [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md): services, releases and rollback, backups, point-in-time recovery, monitoring, alerts, operations settings;
> - [`docs/deployment/HOSTED_STAGING_READINESS.md`](../deployment/HOSTED_STAGING_READINESS.md): hosted deployment procedure, sizing, DNS and firewall;
> - [`docs/deployment/CDN.md`](../deployment/CDN.md) and [`PROXY-QUICK-START.md`](../deployment/PROXY-QUICK-START.md): CDN in front, servers without direct internet.
>
> In particular, the `--workers 4` unit and the `alembic downgrade -1` rollback below are wrong today: rollback is `stack.mjs rollback` (images only, never a downgrade; see `docs/CODING_STANDARDS.md` §2.D).
>
> **One API process is the only tested configuration** (no `--workers N`, one API replica); scale the VM. Since ws/b1-sms-otp the rate limits and SMS caps are counted in PostgreSQL (`backend/app/rate_limit.py`, table `rate_limit_counters`) and shared by every process, so extra processes no longer multiply budgets. The parts that are still per process (metrics counters, SMS concurrency limit, settings cache, database pool, media on the host disk) are listed at the top of [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md); several processes have not been load-tested.

**Evaluation Date:** 2026-10-10  
**Target Release:** Browser-Based SaaS & Web Scanner Station (Pilot Tier)  
**Classification:** VERIFIED  

---

## 1. Supported Pilot Release Scope

To maintain rigorous operational safety, the initial pilot release explicitly delineates supported and unsupported client capabilities:

| Capability Tier | Deployment Mechanism | Pilot Support Status | Operating Requirement |
|:---|:---|:---|:---|
| **Tier 1: Web Public & Admin** | React SPA via Nginx | **FULLY SUPPORTED** | Modern evergreen browser (Chrome, Firefox, Safari, Edge) |
| **Tier 2: Web Gate Scanner** | PWA via Mobile / Tablet Browser | **FULLY SUPPORTED** | Requires initial network connection to load manifest |
| **Tier 3: Offline Cold-Start PWA** | Service Worker precache | **UNSUPPORTED IN V1 PILOT** | Tracked under Issue #25; requires pre-loaded session |
| **Tier 4: Native Flutter Scanner** | iOS / Android Native App | **UNSUPPORTED IN V1 PILOT** | Tracked under Issue #22; web scanner is canonical |

---

## 2. Infrastructure Architecture Topology

```text
[ Client Browsers & Scanner Tablets ]
                 │  HTTPS (Port 443 / TLS 1.3)
                 ▼
     [ Nginx Reverse Proxy ]
     ├─ /assets/* ────────────────► Serves static files from /web/dist
     ├─ /api/* ───────────────────► Reverse proxy to http://127.0.0.1:8000
     └─ / ────────────────────────► Serves index.html with SPA fallback
                 │
                 ▼
[ Uvicorn / FastAPI Backend (Python 3.11+) ]
   (systemd service: congress-backend.service)
                 │  asyncpg (Port 5432 / localhost)
                 ▼
   [ PostgreSQL 16 Relational Database ]
```

---

## 3. Production Environment Variables & Secrets

All configuration is strictly governed by `backend/app/config.py` using the `CONGRESS_` environment prefix:

| Environment Variable | Required Format | Description / Security Policy |
|:---|:---|:---|
| `CONGRESS_DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/db` | Asynchronous PostgreSQL connection DSN. |
| `CONGRESS_PLATFORM_ADMIN_TOKEN` | 64-character CSPRNG hexadecimal string | Secret token for provisioning Organizers (`X-Admin-Token`). |
| `CONGRESS_JWT_SECRET` | 64-character CSPRNG string (>= 32 chars) | Secret key for signing HS256 attendee & scanner JWTs. Insecure placeholders rejected by validator. |
| `CONGRESS_CORS_ORIGINS` | JSON array, e.g. `["https://congress.example.ir"]` | Allowed CORS origins. Never use `*` in production. |

---

## 4. Staging Deployment & Execution Sequence

### Step 1: PostgreSQL Provisioning & Alembic Migrations
```bash
# Provision PostgreSQL database
sudo -u postgres psql -c "CREATE DATABASE congress_production;"
sudo -u postgres psql -c "CREATE USER congress_app WITH ENCRYPTED PASSWORD '...';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE congress_production TO congress_app;"

# Execute database migrations
cd backend
CONGRESS_DATABASE_URL="postgresql+asyncpg://..." uv run alembic upgrade head
```

### Step 2: Backend Systemd Service
Create `/etc/systemd/system/congress-backend.service`:
```ini
[Unit]
Description=Congress Platform FastAPI ASGI Backend
After=network.target postgresql.service

[Service]
Type=simple
User=congress
WorkingDirectory=/opt/congress/backend
EnvironmentFile=/etc/congress/backend.env
ExecStart=/opt/congress/.venv/bin/uvicorn app.main:create_app_from_env --factory --host 127.0.0.1 --port 8000 --workers 4
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Step 3: Frontend Compilation & Static Hosting
```bash
cd web
npm ci
npm run build
# Deploy artifacts to Nginx web root
sudo cp -r dist/* /var/www/congress-web/
```

### Step 4: Nginx Reverse Proxy Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name congress.example.ir;

    ssl_certificate /etc/letsencrypt/live/congress.example.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/congress.example.ir/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Frontend Static Distribution
    root /var/www/congress-web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API Seam
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. Rollback Strategy & Offline Queue Safety

1. **Database Rollback:** If an Alembic migration introduces defects:
   ```bash
   uv run alembic downgrade -1
   ```
2. **Application Rollback:** Revert frontend static files to previous git build artifact.
3. **CRITICAL OPERATIONAL SAFEGUARD:** Never deploy application updates during live event scanning. Ensure all scanner tablets have flushed their offline IndexedDB queues (`Pending Queue == 0`) before restarting backend services or clearing browser caches.
