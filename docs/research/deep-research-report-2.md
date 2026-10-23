# Second Research Report — Corrections, Decisions, and an MVP Spec

This document is the decision layer over `deep-research-report.md` (Persian) and four primary-source research files in this folder (`docs/research/`):

| Code | File | Scope | Sources |
|---|---|---|---|
| [O] | `offline-sync.md` | Offline-first check-in: sync pattern, idempotency, local badge printing, RTL/Jalali | 27 |
| [A] | `auth-security.md` | QR anti-fraud, auth, encryption, OTP abuse, audit logging | 26 |
| [I] | `iran-platform-rails.md` | Shaparak payments, SMS/OTP rails, Iranian law, sanctions, identity | 67 |
| [B] | `buy-vs-build.md` | Iranian vendors, open-source platforms, Postgres throughput, CME, solo-build reality | 38 |

Every claim below cites one of those files (by code and section); see their Sources lists for URLs. Purpose: fix what the first report got wrong or left open, pin the decisions it dodged, and size an MVP a solo developer can actually ship.

---

## 1. Corrections to the first report

1. **"پارسی‌ایونت" could not be verified — treat it as fabricated.** Persian-web searches found no product site, company page, or directory mention. Remove it from the competitor table. The real Iranian market is **Samin Hamayesh (ثمین همایش)** at 10–13M toman per congress (13M tier includes an Android access-control app; medical congresses among its clients) and **Atena Hamayesh** (conf.ir; barcode hall entry + attendance certificates; price on request) [B §1].
2. **PCI-DSS in the Iranian context is a design constraint, not a certification path.** All payments are Shaparak PSP-redirect (request token → PSP hosted page → callback + mandatory verify). A merchant that never touches PANs qualifies for SAQ-A-class scope — but no Iranian PSP publishes a PCI DSS AOC, so there is no certification exercise to pass. Design rule: never touch or log PANs; store only refs (Zarinpal `ref_id`, Mellat `SaleReferenceId`, masked PAN / `card_hash`) [I §1.4]. **Never store card numbers — ever.**
3. **Email is not a reliable delivery channel in Iran; SMS is the rail.** The report's email-centric flows should be SMS-first (Kavenegar `verify/lookup` for OTPs, `sms/send` for notifications, webhooks for delivery status), email as best-effort [I §2].
4. **GDPR framing was wrong for this market.** Iran has no comprehensive data-protection law in force — the PDP draft bill remains unenacted (introduced Oct 2021, still pending per April 2025 commentary; no enactment found through Oct 2026). The operative rules are the **E-Commerce Law 2003 Arts. 58–61** (explicit consent for sensitive data; purpose limitation; access/erasure rights; 1–3 yrs imprisonment, Art. 71) and the **Computer Crimes Law 2009**. Design to a GDPR-ish baseline anyway — it forward-fits the draft bill's transparency and localization (Art. 44) requirements [I §3].
5. **The architecture is over-engineered for the load.** 1,000–2,000 check-ins over 30 min = 0.5–1.1 writes/sec; a single modest Postgres node sustains ~938 single-row inserts/sec in its *slowest* pattern (Timescale benchmark, 8vCPU/32GB) — 3–4 orders of magnitude of headroom [B §3]. Kafka/Redis-cache/microservices/multi-AZ are not required by this workload; pretix's own production baseline (gunicorn + Postgres + Redis for cache/sessions/celery) already exceeds the need [B §3.3]. Keep the architecture monolith-first.
6. **OAuth2/SAML SSO is ceremony.** The platform has no external IdP, no third-party clients, ~10–50 staff. Right-size: server-side sessions (Secure/HttpOnly/SameSite cookies) for browsers, revocable device tokens for scanners, TOTP for admins. RFC 10017 lands in the same place: even OAuth lands on cookie sessions in front [A §2].
7. **CME is a core feature, not a footnote.** Every serious medical-congress platform implements it as per-session check-in ledger → credit ledger → evaluation gate → certificate PDF. Iran's national CME system (ircme.ir, MoH) is infrastructure to interoperate with, not a competitor. Retention ≥6 years (ACCME anchor; covers Iran's 5-year credit cycle) [A §3, B §4].
8. **The budget numbers don't reconcile.** 200–400 person-hours/phase against a 4–5 person team over 3+ months ≈ 2,000+ hours. Either the team is much smaller or the scope is much bigger than the hours. Scope honestly: solo MVP or buy [B §5].
9. **Drop "Company" entity naming.** The first report's data model names the congress entity "Company"; call it `Event`. (Minor, but the naming invites confusion.)

## 2. Pinned decisions

| # | Decision | Rationale (source) |
|---|---|---|
| D1 | **Monolith-first** — single web app (Django/Rails/Nest) + PostgreSQL + Redis for cache/sessions/celery. No Kafka, no ClickHouse, no Elasticsearch, no multi-AZ | Load is 0.5–1.1 w/s vs ~938 w/s single-node capability [B §3]; pretix production baseline [B §3.3] |
| D2 | **Payment: Zarinpal (aggregator) for MVP**, direct PSP (Mellat/SEP) as v2 | Zarinpal v4 is the best-documented rail (request/StartPay/verify, code 100/101 idempotency, sandbox) [I §1.3]; direct PSP for v2 (Mellat PGW manual [I §1.2]) |
| D3 | **SMS-first notifications; Kavenegar Advanced tier** (600k toman/yr) for the OTP `verify/lookup` endpoint (sub-minute delivery, TTS fallback, 148-country coverage) | [I §2.1], SMS reliability vs email [I §2.4] |
| D4 | **Offline check-in = PWA kiosk + IndexedDB attendee snapshot + local append-only scan queue + idempotent batch sync** (Stripe-style response caching per scan_id + server unique constraint on scan_id) | Eventleaf/pretix/Cvent/Ticketmaster all converge on this pattern [O §1, O §4], Stripe idempotency [O §1], CouchDB unique-id model [O §1] |
| D4b | **Scanners stay online by default**; offline is the fallback, not the design center | pretix: first-scan-wins is an online property; offline sync window allows re-scan [A §1]; Ticketmaster 3s timeout → auto-offline [B §3.3] |
| D5 | **Badge printing: local, over LAN** — QZ Tray (browser kiosk) or node-thermal-printer local service at `tcp://printer:9100`. **Never** route printing through the API. Persian text → render badge as raster image (avoids code-page/UTF8-QR corruption) | Every surveyed platform prints device→LAN-printer [O §3] |
| D5b | **QR payload = random ≥128-bit secret (CSPRNG, base32), validated online, first-scan-wins.** No signatures, no rotating barcodes. Show attendee name on scanner screen for staff to compare with photo ID. Regenerate secret on transfer/refund. Treat scanner input as untrusted — never accept internal ticket IDs as redeemable values | pretix model, incl. its HIGH-severity untrusted-input lesson [A §1] |
| D6 | **Auth: sessions for browsers, device tokens for scanners, TOTP for admins.** No OAuth2 server, no SAML, no JWTs in the browser | OWASP session guidance + RFC 10017 [A §2] |
| D7 | **Data at rest: LUKS disk encryption + SCRAM + Argon2id + pgcrypto column-encryption only for کد ملی (if stored).** No app-level encryption of every PII column, no KMS | Postgres encryption options [A §3], OWASP cryptographic storage [A §3] |
| D8 | **OTP/registration abuse controls:** per-phone (≤3/hour, ≥60s apart, exponential backoff) + per-IP limits, CAPTCHA after N failures, verify ≤5 attempts per code, TTL ≤5 min, +98 geo-lock default, never log OTP values. Kavenegar's `verify/lookup` has no published rate limiting — enforcement is yours | Twilio SMS-pumping countermeasures [A §4], Kavenegar gap [A §4] |
| D8b | **Registration: mobile + OTP is the primary identity; کد ملی collected for CME certificates only** (checksum-validated, stored encrypted), name-as-on-ID. Shahkar matching optional at v2 | [I §5], OTP norm [I §2] |
| D9 | **Audit: append-only log** (separate write-only DB account, no UPDATE/DELETE path from app; no OTP/PII in logs), covering attendance edits, certificate issuance, admin actions, exports. **Retention 6+ years alongside CME records** | OWASP logging [A §5], ACCME 6-year rule [A §3] |
| D10 | **Host on Iranian infrastructure** (Iranian DC, ArvanCloud CDN), self-hosted fonts (Vazirmatn woff2) — never link Google Fonts | Sanctions: Eventbrite/Stripe/AWS ToS prohibit Iran; sanctions force localization anyway, and draft Art. 44 mandates it [I §4] |
| D10b | **Do not touch card data; PCI is design discipline:** never log PANs, harden the redirect server per SAQ-A reqs 2/6/8/11. Manual card-taking over the phone jumps to SAQ D + Art. 71 criminal exposure — don't | [I §1.4] |
| D10c | **E-Commerce Law rights are product features:** logged explicit consent at registration; purpose statement; 7-working-day withdrawal right on ticket refunds (ECL Arts. 33–49) unless exempt; ad opt-in/out (Art. 55); data access/erasure self-service. Post an honest privacy notice per the draft's Art. 33 transparency duty | [I §3.1] |
| D11 | **Buy-vs-build decision gate:** buy Samin Hamayesh (10–13M toman/congress) if the client needs one congress soon; build only if the client runs recurring congresses or needs differentiating features (Jalali-first UX, custom CME reporting, pretix-grade offline check-in) | Market price datum [B §1, B §5] |
| D12 | **If self-hosting an existing engine: pretix (AGPL, non-SaaS §7 exception applies) with a Persian/Jalali localization project; Indico (MIT) as fallback.** OCS is retired — drop it | [B §2] |

**Patterns deliberately skipped (ceremony at this scale):** rotating 15-sec SafeTix-style barcodes, Ed25519-signed offline QR secrets, OAuth2 authorization server, SAML, KMS/HSM, ClickHouse analytics, Kafka, per-attendee encrypted PDFs, blockchain audit trails, SIEM pipelines [A §1–5].

## 3. MVP spec (solo-developer size)

**Scope:** one congress, ~1,000–2,000 attendees, medical (CME), Persian RTL, Jalali calendar. Assumption: the client runs recurring congresses (per D11 — otherwise buy).

### 3.1 Feature set

1. **Registration (public web, RTL, Jalali):** mobile + OTP (D8/D8b), name, email (optional), کد ملی for CME, ticket type. SMS receipt + e-ticket with QR (D5b). Consent logging (D10c).
2. **Payment:** Zarinpal v4 (D2) — request → StartPay redirect → callback → verify (handle code 101 as idempotent success). Ticket issued on verify only. Explicit retry/payment-failure states. 7-day withdrawal refund flow (D10c).
3. **Kiosk check-in (PWA, offline-capable):** QR scan (camera or USB scanner as HID), attendee lookup, check-in state. On scan: show name + photo for ID comparison, print badge locally (D4/D5). Manual search fallback. Sync queue with idempotent upload.
4. **Admin panel:** attendees list/search, manual check-in, statistics (live check-in counts), refund handling, staff & device management (tokens, revocation), audit log view.
5. **CME module:** sessions (title, speaker, room, time, CME hours), per-session check-in lists (one ticket valid once per session — pretix pattern [B §2.1]), credit ledger, evaluation form, certificate PDF generation with serial + verification code.
6. **Notifications:** SMS confirmations (registration, payment, ticket, certificate-ready), email best-effort (D3).

### 3.2 Architecture sketch (one box)

```
[Public web + kiosk PWA + admin SPA]  ←→  [Monolith: Django + DRF]
                                             │
                        ┌────────────────────┼────────────────────┐
                        │                    │                    │
                   [PostgreSQL]         [Redis: cache/         [Kavenegar API,
                   single node          sessions/celery]       Zarinpal API]
                        │
                   [LUKS-encrypted volume]
                   [QZ Tray on kiosk → thermal printer on LAN]
```

- **Stack:** Django + DRF + Celery (Redis broker) + Postgres. Kiosk PWA: React or Vue front-end + Service Worker + IndexedDB (PouchDB optional). Badge printing via QZ Tray.
- **Why Django:** matches the pretix stack for an easy fork/localization path (D12) and the strongest RTL/Jalali ecosystem (django-jalali-date, Vazirmatn, `Intl` 'persian' calendar).
- **Single VPS:** ~610k toman/month (4 vCPU/4GB, Parspack) [B §1.3] fits the whole stack; ArvanCloud CDN in front [I §4.2].
- **Ops:** nightly `pg_dump` + weekly offsite (second Iranian DC), UFW/Docker, Netdata or Prometheus-lite for day monitoring; paper-fallback kit for event day (paper lists by hour, manual check-in on failure) [B §3.3].

### 3.3 Data model (core tables)

```
Event, Session, Speaker, Exhibitor — congress domain
TicketType (price IRR, policy) — categories: general/student/VIP/speaker/exhibitor
Attendee (mobile, name, email?, national_id (encrypted) or hash+salt?, consent_at, …)
Ticket (attendee_id, ticket_type_id, secret, status) — secret = 128-bit CSPRNG base32
Payment (ticket_id, gateway, ref_id, amount, status, verified_at, raw payload)
ScanEvent (scan_id UUID PK, device_id, qr_payload, action, client_ts, server_ts, sync_batch)
CheckInList (session_id) → CheckIn (check_in_list_id, ticket_id, first_scanned_at, device_id)
CmeCredit (attendee_id, session_id, hours, status) → CmeEvaluation → Certificate (serial, verification_code, issued_at)
AuditLog (write-only, no PII, 6-year retention)
Device (staff user, token hash, serial, revoked)
StaffUser (email, password_hash, TOTP, role)
```

Note: the sync layer's `ScanEvent` table IS the dedup mechanism — the UUID PK is the unique constraint on `scan_id`; the server replays the first response for a duplicate `scan_id` (Stripe model) and writes nothing new on retry.
