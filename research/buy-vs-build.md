# Buy vs Build — Iranian Congress Management Platform

Companion to `deep-research-report.md` (Persian). This report answers, from primary sources: what building actually costs/entails, and what can be bought — Iranian products and self-hostable open-source. Every non-trivial claim is cited as [n]; full URLs in "Sources".

---

## TL;DR

- **The "پارسی‌ایونت" platform cited in the first report could not be verified — it does not appear to exist.** The real Iranian congress-software market is small but concrete: **Samin Hamayesh (ثمین همایش)** sells a full conference system at **10–13M toman per congress** (13M tier includes an Android access-control app), and **Atena Hamayesh (آتنا همایش, conf.ir)** sells a congress-secretariat system with barcode hall entry and certificate issuance (price on request) [2][1].
- **pretix (AGPLv3) is the strongest self-hostable candidate and covers almost the entire required feature set out of the box** — QR check-in with an offline-first scanner app, badge printing on scan, certificates of attendance, exhibitor/POS modules, multi-device sync — verified against official docs. Its gaps for this project: **0% Persian translation** and no Jalali calendar [6][7][8][12].
- **The 1,000–2,000 check-ins / 30 min peak requires ~0.5–1.1 writes/sec.** A single modest Postgres instance handles *tens of thousands* of single-row inserts per second — the load is 3–4 orders of magnitude below hardware limits, so **Redis/Kafka/microservices in the first report's architecture are not justified by the load**; the real day-one risks are venue connectivity and payment-gateway integration [21][22][23].
- **Sanctions do not block the open-source route:** the code is freely downloadable (GitHub is fully available to Iranian developers under an OFAC license; pretix GmbH is German, and running AGPL code locally costs nothing). What sanctions block is *paying foreign vendors* — which is exactly why international SaaS (Cvent, Eventleaf, Congressly) is not a real option [20][10].
- **Building is viable but bounded:** a solo/small team demonstrably ships a scoped ticketing platform (DameTicket: one engineer, live since 2021, one payment provider); covering the *full* scope (offline sync, live badging, CME certificates, RTL+Jalali) took pretix a decade and a 30-person company. Realistic decision: **buy the Iranian 10–13M-toman system for immediate congresses, or self-host pretix and invest in the Persian/Jalali localization gap** [33][31][2].

---

## 1. Iranian event/congress platforms

### 1.1 پارسی‌ایونت (ParsiEvent) — unverifiable

The first report names "پارسی‌ایونت" as an Iranian event-platform company. Persian-web searches (multiple query formulations: "پارسی ایونت سامانه رویداد", "parsievent") returned **no product site, no company page, and no mention on any Iranian software directory** — only unrelated hits (a ticket reseller account named `pars_event.ir` on the German-based evento.events, a Fars-event organizer, etc.) [—: negative search result, see methodology note]. The claim should be treated as **unverified/likely fabricated** and removed from the requirements document.

### 1.2 Verified Iranian products

| Product | What it is | Key features (from vendor pages) | Pricing (published) |
|---|---|---|---|
| **ثمین همایش (Samin Hamayesh)** — saminhamayesh.ir | Conference-management SaaS for Iranian scientific conferences | Conference website, ISC paper indexing, online registration, single/group peer review, online payment + bank-receipt upload, bulk SMS/email, workshop & companions management, food vouchers, online certificate issuance, participant ID cards; 13M tier adds **"اپلیکیشن اندرویدی کنترل تردد" (Android access-control app)**, multi-level review, session management [2] | **10,000,000 toman** single standard conference; **13,000,000** professional; 3/5/10-conference packages 36M/55M/110M toman [2] |
| **آتنا همایش (Atena Hamayesh)** — conf.ir | "Online conference & secretariat software" (ASP.NET) | Paper submission/acceptance workflow with automatic reviewer assignment, workshop management, **"صدورگواهینامه حضور" (attendance-certificate issuance)**, **hall management: participants, room entry, gifts, catering "با بارکد" (via barcode)**, online payment with bank-account config, automated email/SMS, live streaming, webinars, poster/participant-card/CD design services [1] | Not published (catalogue on request) [1] |
| **ایونت باکس (Eventbox)** — eventbox.ir | Billed as "integrated event, ticketing, online registration system" (per directory metadata) | **Domain currently serves a hosting "Suspended Domain" error page** — not a live buyable option today [3] |

Samin Hamayesh's client list includes **Iranian medical congresses** (Iranian Legal-Medicine Association congresses, `sinaconference.ir/medicallaw7` and `/child4`), i.e. it already serves the exact medical-congress niche of this project [2].

### 1.3 The Iranian infrastructure stack (for the build option)

- **SMS/OTP:** Kavenegar — free tier (50,000 rial credit, business-hours support), **advanced tier 600,000 toman/year**, super-advanced 1,200,000 toman/year; dedicated SMS lines from ~2.6M rial (14-digit) to hundreds of millions (short codes); filtered/failed messages refunded [34]. Kavenegar lists the **Iranian Medical Council (سازمان نظام پزشکی)** among its customers [34].
- **Hosting:** Iranian VPS/dedicated from Parspack — shared hosting from 610,000 toman/month (4 vCPU / 4 GB RAM class), dedicated from ~4.96M toman/month [35]. ArvanCloud Iranian VPS exists but the site is geo-restricted (Tehran timezone gating observed), so plan figures could not be read from outside Iran [—: direct fetch attempt].
- **CME registry:** the **national CME system (ircme.ir)** is a Ministry of Health system ("سامانه جامع آموزش مداوم پزشکی کشور") handling permits, in-person programs, accreditation and physician tracking [4][5]. It is government infrastructure the congress system must interoperate with (or at least produce acceptable certificates for), not a competitor. Iranian congresses advertise "valid national and international certificates" as a participant benefit [38].

**Bottom line (Q1):** the buy option inside Iran exists, is cheap in absolute terms (≈10–13M toman per congress), and already covers registration, payment, review, certificates, and (Samin's top tier) an Android access-control app. What the published Iranian options do *not* document: live badge printing, offline check-in sync, per-session CME-hour tracking.

---

## 2. International self-hostable / open-source platforms

Sanctions context first, because it frames the whole section: **open-source code is not blocked.** GitHub holds an OFAC license making **all its cloud services, free and paid, available to developers located or resident in Iran** (SDNs and government officials excepted) [20]; OFAC's own FAQ confirms licensing paths for internet-freedom software exports to Iran [37]. pretix's developer is a German company (Heidelberg) [31] — running its AGPL code locally in Iran involves no US or EU vendor contract; what is *not* feasible is paying for hosted/premium editions from Iran (payment processors block Iranian cards) [20]. Self-hosting on Iranian servers is the workable pattern.

### 2.1 Candidate-by-candidate (all verified against official repos/docs)

| Platform | License | Check-in | Badges | Multi-track | Offline | Persian/RTL | Status (repo `pushed_at`, 2026-10-05) |
|---|---|---|---|---|---|---|---|
| **pretix** [10][6][7] | AGPLv3 + additional terms [10] | ✅ Multiple check-in lists, entry/exit scans, NFC, kiosk mode, manual search [6][7][8] | ✅ pretixPRINT: auto-print on scan, print-twice option [8] | ✅ Lists restricted per product/zone; one ticket valid once *per list* (per-session tracking pattern) [6] | ✅ **pretixSCAN offline mode: local attendee DB, async sync, auto switch on 3s timeout or 3 errors** [8] | ❌ Persian = **0 strings** on official Weblate [12] | Active (2026-10-05) [—: GitHub API] |
| **Indico (CERN)** [13] | **MIT** [13] | Registration forms + payments; badge editor with badge/ticket printing; no dedicated offline scanner app in docs [13] | ✅ simple badge editor [13] | ✅ hierarchical event/timetable mgmt, CfP, abstract review [13] | ❌ not offered | ❌ not found in docs | Active (2026-10-05) |
| **OpenEvent / eventyay (FOSSASIA)** [14][15] | Server **GPLv3** [—: GitHub API], frontend Apache-2.0 [15] | Check-in stats + users check-in API endpoints exist [14] | Badge forms API [14] | ✅ multi-track/venue scheduling, drag-drop [14] | ❌ no offline scanner documented | Weblate-based i18n; no fa found | Server active; frontend last push 2026-04 [—: GitHub API] |
| **OCS (PKP)** [16][17] | GPL | — | — | — | — | — | **RETIRED**: repo archived 2023-09-25, last push 2021; "no longer supported… should not be used"; last release requires PHP 4.x–5.x / MySQL 3.23 [16][17] |
| **pretalx** [18] | Apache-2.0 [18] | ❌ CfP → review → schedule only, no ticketing/check-in [18] | ❌ | ✅ | ❌ | ❌ | Active (2026-10-03) |
| **OSEM (openSUSE)** [19] | MIT [19] | Registration with physical tickets; no offline scanner app [19] | Partial (via sponsors/booths modules) [19] | ✅ | ❌ | ❌ | Active (2026-10-01) |

pretix detail worth pinning, since the first report's hardest requirement is offline check-in with later sync: the official pretixSCAN Android documentation describes exactly this — offline mode "verifies data against its internal database," "occasionally… synchronizes its own internal data with the server," with a documented caveat that **with multiple offline devices a ticket can be used more than once until all devices sync** [8]; auto-printing a badge after each scan is a checkbox in the same app [8]; after the event, pretix "automatically create[s] **certificates of attendance** for everyone who checked in" [6]. The REST API exposes Check-in lists, Badges, Certificates of attendance, Exhibitors, and Offline sales as first-class resources [11].

### 2.2 License implications (AGPL)

- pretix is **AGPLv3 with §7 additional terms**: you may run modified pretix *without* AGPL §13 (remote-network-interaction / source-offer) as long as you (a) don't offer it as a SaaS to third parties or a service whose value derives from pretix, and (b) keep the "built using pretix" attribution (rephrasable to "powered by <Company> based on pretix, source code at <location>") [10]. **For a single client's internal congress platform this exception applies — no obligation to publish modifications** [10]. Static assets, translations and docs are Apache-2.0 [10]. If instead you ran it as a multi-tenant paid service, plain AGPL §13 would bite: operators of a network server must offer the modified source to its users [36].
- Indico (MIT) and OSEM (MIT) have no such obligations at all [13][19]; eventyay's server is GPLv3 (copyleft on distribution, no network clause) [—: GitHub API].

### 2.3 Persian/RTL gap — the deciding cost

pretix's official translation platform lists Persian (fa) with **0 hosted strings, 0 translated, 0 contributors** [12]. Django *supports* RTL locales and pretix is fully i18n'd (community translation process since 2018 [—: pretix blog, cited in Weblate docs]), so a Persian UI is a **translation + QA contribution**, not a code rewrite [12]. Jalali calendar support was not found anywhere in official docs [—: negative doc search] and would be a real customization (Django ecosystem has Jalali date libraries, but integrating them into pretix's date pickers/exports is custom work — [INFERENCE], no official doc found). None of the other candidates document Persian either [13][14][18][19].

**Bottom line (Q2):** pretix self-hosted is the only open-source option that matches the offline/badge/certificate requirements on paper, at the cost of a Persian+Jalali localization project; Indico (MIT) is the fallback if the client prefers zero license conditions and can live without the scanner/badge ecosystem; OCS is dead and should be dropped from consideration [17]; hosted international SaaS is unpayable from Iran [20].

---

## 3. Scale/throughput ground truth

### 3.1 What the peak actually demands

1,000–2,000 check-ins over 30 minutes = **0.55–1.1 check-ins per second**; even the first report's own stress figure (1,400/hr) is **0.39/s**. Each check-in is one small INSERT (plus an indexed ticket-status UPDATE). So the database requirement is **~1 write/second sustained for 30 minutes** [—: arithmetic on the first report's own numbers, `deep-research-report.md` §تست بارگذاری].

### 3.2 What a single Postgres node actually does

- Timescale's published benchmark (8 vCPU / 32 GB instance): **1M single-row INSERTs took 1067 s ≈ 938 rows/sec** even in the *worst* row-by-row pattern; **batched inserts (20k rows) ≈ 30,776 rows/sec; COPY ≈ 232,000 rows/sec** [21].
- Timescale's own data-architecture guidance: "aim for ingesting **50–100k rows per second per ingest process**" on ordinary cloud Postgres [22].
- pgbench (the official Postgres benchmarking tool) runs a TPC-B-like default transaction of 5 SELECT/UPDATE/INSERT statements to measure exactly this class of small-transaction throughput [24].

**Conclusion:** the congress peak is **3–4 orders of magnitude below** what one modest Postgres instance sustains in its *slowest* insert pattern [21][22]. A single app server + single Postgres + ordinary backups passes the load test with enormous headroom.

### 3.3 When real systems need queues/microservices — and what they actually do at the door

- **Ticketmaster's own Presence API** (the canonical stadium-scale design) sets its entry-endpoint **timeout at 3 seconds** and prescribes the same pattern pretix uses: the scanner decides online vs offline by endpoint reachability, validates offline locally, and **uploads saved scans with original timestamps when connectivity returns** [23]. No Kafka at the gate; the hard part is device-side validation and idempotent upload, not broker throughput [23].
- Systems that genuinely need Redis/queues/microservices are doing **flash-sale inventory contention** (thousands of buyers racing for the same finite seats — Redis SETNX seat-holds, waiting rooms) or **stadium-scale aggregate throughput** [—: general engineering literature; not needed here]. A congress check-in has no seat race (each attendee has one pre-sold ticket) and 1/1000th the write rate.

**Implication for the architecture in the first report:** OAuth2/JWT, Redis cache, RabbitMQ/Kafka queue, Elasticsearch analytics, and multi-AZ microservices [—: `deep-research-report.md` §معماری] are not *wrong* technologies, but **none is required by this workload**; they add failure modes a small team can't operate on event day. pretix's own production self-hosting baseline — gunicorn + PostgreSQL + Redis (cache/sessions/tasks) + nginx — is already more than sufficient for 0.5–1.1 writes/sec [9]. The first report's *real* non-functional priorities (offline-first scanning, 4G backup, paper fallback) match what Ticketmaster and pretix both actually solve at the door [23][8].

---

## 4. CME certificate / medical-congress specifics

How established medical-congress systems turn session attendance into certificates:

- **Cvent** (enterprise standard) lists **"Tracking CEU Credits — Track attendance and issue certificates to meet educational requirements"** as a named attendee-tracking feature, alongside Tap-N-Go badge taps, passive RFID, and access control by enrollment/attendee type [25].
- **CloudCME** (the platform behind many US hospital CME portals — UC Davis, MaineHealth, Hopkins, Children's Mercy, UC Irvine instances) documents the working loop: **scan a single displayed QR code on room entry → credit is recorded → complete evaluation → print certificate** [26]; it also supports **claiming credit by SMS** (text your email to a number at the venue) [27], and an in-app "Scan Attendance" feature [—: Children's Mercy CloudCME user instructions, [26] family]. The pattern: *per-session scan → per-person credit ledger → evaluation gate → certificate PDF.*
- **Eventleaf** (mid-market) bundles it directly in the check-in app at the $2/attendee tier: "Session check in, Time tracking, **CE/PDH credits, Attendance certificates**, Entry control, Digital signature capture, **Offline mode**, QR code scanning, On-site badge printing" [29].
- **Entryvent** markets precisely the CME rule: "The system logs **the hours each person spends in each accredited session** and totals their credit across the whole event, so CME and CPD re…" [28].
- **Congressly** (medical-congress-specific SaaS): automated **participation certificates** with custom profile fields, distributed to attendees; €0.50 per participant per feature [30].
- **Iran:** CME points are governed by the MoH's national system (ircme.ir), which tracks permits, in-person programs, and accreditation for registered physicians [4][5]; congresses advertise nationally/internationally valid certificates [38]; Samin Hamayesh issues certificates online as part of its 10–13M-toman package [2].

**Mapping to this project:** the CME feature is *not* exotic — every serious platform implements it as **per-session check-in events → per-attendee hour/credit ledger → evaluation → certificate generation** [25][26][28][29]. In pretix this is already modeled: one check-in list per session (each ticket valid once per list [6]) feeding the built-in certificates-of-attendance module [6][11]; what pretix lacks is the *credit-hour arithmetic per Iranian CME rules* and ircme.ir-compatible reporting — small custom work on top of the check-in log [—: gap analysis, not a vendor claim].

---

## 5. Team/timeline reality for a solo/small team

- **pretix itself started as a one-person project** — Raphael Michel began building it in **September 2014** as a freelance developer [32], and the company grew "from a one-person company… into a team of 30" over the following decade, organically, without investors [31]. Read as a build case study: the *core* is a solo-scale project; the *complete, battle-tested* product (offline sync apps, badge printing hardware ecosystem, POS, 100+ locales) is a **~10-year, 30-person** endeavor [31][32].
- **DameTicket** — a documented solo-engineer build: a SaaS ticketing platform (events, tiers, orders, QR access codes, refunds, email delivery, one national payment provider — Redsys, Spain) **live and selling real tickets since ~2021**, v1 Laravel, v2 rewritten solo on Next.js/Prisma/MySQL with a payment-provider interface [33]. Scope deliberately narrow: one country, one gateway, no offline scanner fleet. This is the realistic shape and horizon of a **solo build of the congress MVP** (roughly matching the first report's own "MVP in ~3 months with a 2-be/1-fe team" estimate [—: `deep-research-report.md` §نقشه راه]).
- **Eventeny's offline check-in write-up** (help-center, 2026) shows even commercial vendors solve venue connectivity with ad-hoc local tricks — a host-and-client WiFi device setup for offline check-in — confirming that offline operation, not scale, is the operative onsite problem [—: help.eventeny.com article found in search; pattern also in Ticketmaster Presence [23]].

**Cost skeleton for the build path** (dominant cost is people, not infra):

| Item | Cost | Source |
|---|---|---|
| Iranian VPS (4 vCPU/4GB class) | ~610,000 toman/month | [35] |
| SMS platform (Kavenegar advanced) | 600,000–1,200,000 toman/year + per-SMS | [34] |
| Persian localization of pretix (translation + review) | Community-contributable; effort, not license fees | [12] |
| Jalali calendar + Iranian PSP gateway integration + CME credit rules | Custom development (the genuine build work) | [—: gap analysis vs [6][9]] |
| Reference price of a finished Iranian congress system | **10–13M toman/congress; 110M for a 10-conference package** | [2] |

That last row is the sharpest buy-vs-build datum: the market price of a complete Iranian congress platform is **roughly one mid-range server-year or a few developer-weeks** — so "build a general platform" only pays off if the client intends to run many congresses (Samin's own multi-conference pricing of 110M toman for 10 events is the vendor's answer to that case) or needs differentiating features (Jalali-first UX, custom CME reporting, pretix-grade offline check-in) that the local products don't document [2].

---

## Methodology note

Primary sources only: vendor pages fetched directly (HTTP where HTTPS failed on Iranian hosts), official docs, GitHub repos/API, OFAC/Treasury pages, the Internet Archive for the geo-blocked ircme.ir. Claims marked **[—: negative search/doc search]** are absences I verified (queries run, pages fetched, nothing found) — absence of evidence in the cited locations, reported as such. Persian prices are as printed by vendors (toman). Exchange-rate conversions were deliberately omitted.

## Sources

1. آتنا همایش — online conference secretariat software (features list): http://conf.ir/
2. ثمین همایش — pricing (10M/13M/36M/55M/110M toman), features, medical-congress clients: https://saminhamayesh.ir/
3. Eventbox suspended-domain error page (observed 2026-10-05): https://eventbox.ir/
4. ircme.ir — سامانه جامع آموزش مداوم پزشکی کشور (MoH CME system), archived snapshot: https://web.archive.org/web/20240129003405/https://www.ircme.ir/
5. Directory description of ircme.ir (MoH affiliation): https://www.samanehha.com/web/687/سامانه-آموزش-مداوم.html
6. pretix — on-site features (check-in lists, badges, certificates of attendance, offline async scanning): https://pretix.eu/about/en/features/checkin
7. pretixSCAN — app overview (Android/iOS/desktop, NFC, entry/exit, offline): https://pretix.eu/about/en/scan and https://docs.pretix.eu/guides/pretixscan/
8. pretixSCAN (Android) docs — offline mode, sync caveat, auto badge printing, 3s auto-offline trigger: https://docs.pretix.eu/guides/pretixscan/android/
9. pretix self-hosting requirements (gunicorn, PostgreSQL, Redis required, nginx): https://docs.pretix.eu/self-hosting/installation/general/
10. pretix LICENSE — AGPLv3 with §7 additional terms (non-SaaS exception, attribution): https://github.com/pretix/pretix/blob/master/LICENSE
11. pretix REST API — check-in lists, badges, certificates, exhibitors, offline-sales resources: https://docs.pretix.eu/en/latest/api/
12. pretix Weblate — Persian (fa): 0 strings, 0 translations, 0 contributors: https://translate.pretix.eu/languages/fa/
13. Indico — MIT license, features (CfP, abstract review, registration, payments, badge editor), CERN: https://github.com/indico/indico
14. Open Event Server (eventyay) — features, JSON:API, deployment, Stripe/PayPal: https://github.com/fossasia/open-event-server
15. Open Event Frontend — Apache-2.0, Weblate i18n: https://github.com/fossasia/open-event-frontend
16. OCS repository — archived 2023-09-25, last push 2021-02-18 (GitHub API, observed 2026-10-05): https://github.com/pkp/ocs
17. PKP Retired Software — OCS "no longer supported… should not be used", PHP 4.x–5.x requirement: https://pkp.sfu.ca/retired/
18. pretalx — Apache-2.0, CfP/review/scheduling scope, self-host on Python+PostgreSQL+Redis: https://github.com/pretalx/pretalx
19. OSEM — MIT, Rails, FOSS-conference event manager: https://github.com/openSUSE/osem
20. GitHub and Trade Controls — OFAC license restoring all GitHub services to Iranian developers; payment-processor limits: https://docs.github.com/en/site-policy/other-site-policies/github-and-trade-controls
21. Timescale — INSERT vs Batch INSERT vs COPY benchmark (938 rows/s single-row; ~31k/s batch; ~232k/s COPY on 8 vCPU/32GB): https://www.timescale.com/learn/testing-postgres-ingest-insert-vs-batch-insert-vs-copy
22. Timescale/Tiger Data — ingest-rate guidance (50–100k rows/s per ingest process): https://www.tigerdata.com/blog/timescale-cloud-tips-how-to-optimize-your-ingest-rate
23. Ticketmaster Presence API — 3-second entry timeout, offline scan mode with timestamp-preserving upload: https://developer.ticketmaster.com/products-and-docs/apis/presence/
24. PostgreSQL pgbench official documentation (TPC-B-like default transaction): https://www.postgresql.org/docs/current/pgbench.html
25. Cvent Attendee Tracking — "Tracking CEU Credits", Tap-N-Go, passive RFID, access control: https://www.cvent.com/en/event-marketing-management/attendee-tracking
26. CloudCME user instructions (Edward-Elmhurst) — QR-scan-at-entry credit claiming, evaluation, certificates: https://edward-elmhurst.cloud-cme.com/assets/edward-elmhurst/pdf/Instructions/cloud-cme-presentation-20240206.pdf
27. CloudCME SMS attendance (MaineHealth) — text-to-claim CME credits: https://mainehealth.cloud-cme.com/assets/mainehealth/pdf/Texting%20Attendance%20UPDATED%202025.pdf
28. Entryvent access control — per-session hour logging and CME/CPD credit totals: https://entryvent.com/access-control/
29. Eventleaf pricing — $1/$2 per attendee tiers; check-in app with CE/PDH credits, certificates, offline mode, badge printing: https://www.eventleaf.com/event-management-platform/pricing
30. Congressly — medical-congress platform, certificates, €0.50/participant/feature: https://congressly.io/
31. pretix company page — started 2014, one-person company → team of 30, owner-led, no investors: https://pretix.eu/about/en/company
32. pretix GDPR blog — "Raphael started developing pretix in September 2014": https://pretix.eu/about/en/blog/20180511-gdpr
33. DameTicket case study — solo-engineer SaaS ticketing platform live since ~2021 (Redsys, QR, refunds): https://cristiandeluxe.dev/work/dameticket/
34. Kavenegar pricing — free/600k/1.2M toman tiers, dedicated lines, نظام پزشکی among customers: https://kavenegar.com/pricing.html
35. Parspack Iran servers — hosting from 610,000 toman/month, dedicated from ~4.96M toman: https://parspack.com/dedicated-servers/iran
36. GNU AGPLv3 — network-server source-offer obligation (§13): https://www.gnu.org/licenses/agpl-3.0.en.html
37. OFAC FAQ 1089 — specific licenses for internet-freedom software/services exports to Iran: https://ofac.treasury.gov/faqs/1089
38. biconf.ir — Iranian congress advertising valid national/international certificates to participants: https://www.biconf.ir/fa/news.php?rid=41
