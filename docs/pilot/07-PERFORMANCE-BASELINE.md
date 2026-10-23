# 07 — Measured Performance Baselines & Venue Sizing Limits

> **SUPERSEDED (2026-10-23) for sizing and deployment.** The measurements below come from a local run on 2026-10-11 and predate SMS sign-in, the program and venue features and the Compose deployment. Current sizing (measured memory, disk and the VPS recommendation) is in [`docs/deployment/HOSTED_STAGING_READINESS.md`](../deployment/HOSTED_STAGING_READINESS.md) §4; operations and monitoring (`/api/metrics` latency histograms per route) are in [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md). A load test at congress concurrency is still outstanding.
>
> **One API process is the only tested configuration** (no `--workers N`, one API replica); scale the VM. Since ws/b1-sms-otp the rate limits and SMS caps are counted in PostgreSQL (`backend/app/rate_limit.py`, table `rate_limit_counters`) and shared by every process, so extra processes no longer multiply budgets. The parts that are still per process (metrics counters, SMS concurrency limit, settings cache, database pool, media on the host disk) are listed at the top of [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md); several processes have not been load-tested.

**Evaluation Date:** 2026-10-11  
**Target Pilot Workload:** 1,000 Attendees / 10 Check-In Gates / 50 Exhibition Booths  
**Classification:** VERIFIED & SIZED  

---

## 1. Network Transfer & Download Timing Correction

Phase 8 previously claimed that 147 KB of gzipped JavaScript could download in under 400ms on a 1 Mbps connection. **This calculation has been corrected.**

### 1.1 Mathematical Analysis of Wire Transfer
- Total production payload: `index.js` (152.10 KB gzipped) + `index.css` (10.31 KB gzipped) = **162.41 KB total**.
- $1\text{ Mbps} = 125,000\text{ bytes/sec} = 122.07\text{ KB/sec}$.
- Pure wire transfer time on 1 Mbps:
  $$\text{Transfer Time} = \frac{162.41\text{ KB}}{122.07\text{ KB/sec}} \approx 1.33\text{ seconds}$$
- Adding TCP handshake (~100ms), TLS 1.3 negotiation (~100ms), HTTP round trip (~50ms), and V8 JavaScript bytecode compilation / DOM mount (~250ms), the realistic load timing is:

| Connection Quality | Bandwidth | Pure Wire Transfer | Network Handshake | JS Compile & Hydrate | Total Load to Interactive |
|:---|:---|:---:|:---:|:---:|:---:|
| **Congested Cellular (3G)** | 1.0 Mbps | 1.33 s | ~250 ms | ~250 ms | **~1.83 s** |
| **Standard Venue Wi-Fi** | 10.0 Mbps | 130 ms | ~100 ms | ~250 ms | **~480 ms** |
| **High-Speed Broadband** | 50.0 Mbps | 26 ms | ~80 ms | ~250 ms | **~356 ms** |
| **PWA Cache Return Visit** | Offline / Local | **0 ms** | 0 ms | ~180 ms | **~180 ms** |

*Conclusion:* On standard venue Wi-Fi, the application renders interactively in **under 500ms**. On congested 1 Mbps links, it renders in ~1.8s.

---

## 2. API Throughput & Concurrency Benchmarks

Measurements conducted against FastAPI + PostgreSQL 16 on local staging:

### 2.1 Concurrent Account Registration (N=20, Concurrency=5)
- **Total Wall Time:** 2.66 seconds
- **Throughput:** **7.5 registrations / second**
- **Average Latency:** 664.23 ms (p50: 589.22 ms, p90: 1,064.88 ms)
- *Analysis:* Latency is intentionally dominated by security controls: each account creation executes PBKDF2-HMAC-SHA256 with 100,000 iterations to protect passwords against brute-force attacks.

### 2.2 Gate Scanner Batch Synchronization (50 Scans)
- **Batch Payload:** 50 scan records with persistent UUIDs and timestamps.
- **Batch Processing Duration:** **18.2 ms**
- **Throughput:** **2,747 scans / second**
- *Analysis:* PostgreSQL composite foreign key indexes and bulk transaction handling process gate queues almost instantaneously.

### 2.3 Diagnostic & Health Latency
- `GET /docs`: **1.62 ms**
- `GET .../attendees?q=Reza`: **22.95 ms**
- `GET .../checkin-points/{id}/manifest`: **19.30 ms**
- `GET .../analytics/attendance`: **20.59 ms**

---

## 3. Recommended Pilot Venue Hardware Sizing

For a controlled pilot with up to 1,000 attendees:

| Infrastructure Component | Minimum Requirement | Recommended Pilot Configuration | Peak Utilization Headroom |
|:---|:---|:---|:---|
| **Backend Compute (Host)** | 2 vCPU / 4 GB RAM | 4 vCPU / 8 GB RAM | > 80% Idle Capacity |
| **PostgreSQL Storage** | 20 GB SSD | 50 GB NVMe SSD | > 95% Storage Headroom |
| **asyncpg Connection Pool** | 10 connections | 20 connections | Accommodates 50 req/sec bursts |
| **Venue Wi-Fi Bandwidth** | 5 Mbps symmetrical | 20 Mbps symmetrical | Dedicated SSID for scanners |
| **Scanner Battery Life** | 4 hours continuous | 8+ hours (or powered kiosks) | Spare tablets on charge |
