# Security Architecture for a 1,000-Attendee Medical Congress Platform (Iran): Needed vs. Ceremony

Research notes, grounded in primary sources (pretix/Eventbrite/Ticketmaster docs, OWASP cheat sheets, IETF RFCs, PostgreSQL docs, ACCME rules, Iranian ministry/news sources). Date of research: 2026-10-05.

## TL;DR

- **QR tickets:** Random ≥128-bit ticket secrets validated **online, server-side, first-scan-wins** is the industry-standard right size; rotating SafeTix-style barcodes and Ed25519-signed offline codes solve problems (tens of thousands of tickets, offline venues) a 1,000-seat congress does not have. Offline scanner mode is the actual weak point — keep scanners online [1][5][7][8].
- **Auth:** Server-side sessions in `Secure; HttpOnly; SameSite` cookies for browsers, revocable device tokens for scanners, TOTP 2FA for admins. JWTs in the browser, OAuth2, and SAML SSO are **ceremony** here — no external IdP, ~10–50 staff [10][11][12][13][14].
- **Data at rest:** Disk/volume encryption (LUKS) + password/OTP hashing cover the real threats; PostgreSQL has **no built-in TDE**, so column-level encryption (pgcrypto) only for the national ID (کد ملی) if you must store it; CME attendance records ≥6 years [15][16][17][18][19].
- **OTP/registration abuse:** SMS pumping against OTP endpoints is a documented, real cost-attack (Twilio publishes mitigation playbooks); apply per-phone + per-IP rate limits, attempt caps, resend-overwrites-old-code, and geo-lock to `+98` on Kavenegar's verify/lookup endpoint — whose public docs do **not** document application-level rate limiting, so it is your job [24][25][10].
- **Audit log:** Append-only trail of every attendance edit, certificate issuance, admin action, and data export with who/when/what/before-after; never log OTP values, session IDs, or PII; retain alongside CME records (6+ years) [26][12].

---

## 1. QR / Ticket Anti-Fraud for Congress Check-In

### The actual threat

The realistic fraud scenarios at a 1,000-attendee congress: (a) a screenshot of a QR code shared on WhatsApp is presented by someone other than the buyer, (b) the same screenshot is presented twice at two doors, (c) a forged/self-made QR code is presented. Not realistic: large-scale industrial ticket counterfeiting.

### How the major platforms handle it

**pretix (open-source, used for conferences exactly this size):**
- Default: every ticket gets a **random secret** — 32 lowercase alphanumeric characters (excluding confusable `o, O, 1, i, l`) — rendered as a QR code. "Guessing or forging a valid ticket code is impossible," and validation is a **database lookup**, not cryptography. pretix explicitly says the Ed25519 signature scheme is "intended for advanced use cases only, primarily for events with more than 25,000 tickets. If you are uncertain whether you need to use this feature, it is very likely that you do not" [1].
- **First-scan-wins is an online-mode property.** In pretix's own comparison table: with online scanning, "Same ticket can be scanned multiple times: no." Offline with sync, the same ticket *can* be re-scanned before data syncs (~5 min window); offline with signed secrets and no order sync, the same ticket can always be scanned multiple times [1].
- The redemption API uses a **nonce parameter to deduplicate re-uploads of the same scan** — i.e., double-entry prevention is a server-side concern with explicit race handling [2].
- Real-world lesson (pretix security release 4.11.1, rated HIGH): their API accepted the *internal ticket ID* as an alternative to the secret in the redeem URL. Internal IDs "are not a well-kept secret and don't change if a ticket is transferred," so anyone who guessed a valid internal ID could mint an accepted QR code. Fix: treat all scanner input as untrusted (`untrusted_input=true`). **Design rule for your platform: the QR payload must be validated strictly as a high-entropy random secret, never as a guessable database key** [3].
- Scanner devices authenticate as devices: created server-side with a unique serial + initialization token, can be limited to specific events, and can be **revoked** — the model to copy for your scanner app [4].

**Ticketmaster (SafeTix — the "screenshot-proof" approach):**
- Mobile tickets use a barcode that "automatically refreshes every 15 seconds," is tied to the specific device/account, and "Screenshots won't get you in" [5]. Ticketmaster's business docs describe it as an encrypted rotating barcode linked to the fan's account [6]. This is real anti-fraud engineering, but it exists because Ticketmaster faces industrial-scale resale fraud on stadium events. Reproducing it requires a live app + account binding — significant cost for zero marginal benefit at 1,000 attendees.

**Eventbrite (closest analog to a congress platform):**
- Each ticket has a QR code; scanning with the Organizer app checks it in, and "if a ticket has already been used, you'll see an error message" — plain first-scan-wins against a server-side check-in state [8]. Scan modes are configurable (default check-in / check-out / validate-only) [7].
- Ticket "transfer" is just editing the order's attendee name/email; the ticket never leaves the buyer's account — Eventbrite does not do cryptographic ticket ownership transfer for typical events [9].

### What is actually needed for this congress

1. **Random ticket secret, not signed QR.** Generate ~128+ bits of CSPRNG entropy per ticket (e.g., 26+ chars base32, or a UUIDv4-equivalent — generated with a CSPRNG), embed in the QR payload. No HMAC/Ed25519 needed: with online validation, the database *is* the source of truth; signatures only pay off when you must validate offline [1][17].
2. **Online redemption, first-scan-wins.** All scanners talk to the server (venue Wi-Fi + LTE failover). Server marks redeemed atomically; a duplicate scan returns an error with the original check-in time and device [7][8][2].
3. **Treat scanner input as untrusted.** Only accept the exact random secret; never accept ticket IDs, order codes, or row numbers as redeemable values — this is pretix's published HIGH-severity lesson [3].
4. **Photo-ID/name comparison at the door for the credential that matters (CME).** Since CME credit is the valuable output, the binding that matters is *person ↔ attendance*, not *QR ↔ phone*. Show attendee name/photo (if collected) on the scanner screen after a successful scan (pretix does exactly this in online mode [1]) and have staff compare with the badge/ID at entry. This is standard operational practice; no platform doc needed to justify it.
5. **Regenerate secrets on transfer/refund.** If you support ticket transfers, mint a new secret and invalidate the old one (pretix moves old secrets to a revocation list when product data changes [1]). Eventbrite's simpler model — rename the attendee, keep one ticket — is fine at this scale [9].
6. **Device tokens for scanners, revocable** (see §2) [4].

**Ceremony to skip:** rotating 15-second barcodes [5], Ed25519-signed offline-validatable secrets [1], and custom "ticket wallets." A static random QR + server state does the job.

---

## 2. Authentication for This App Class

The app has three distinct client classes: **browser users** (public registration, attendees viewing certificates), **scanner devices** (staff phones at doors), **admin panel users** (10–50 staff). Each gets a different mechanism — not one enterprise SSO for all.

### Browsers → server-side sessions in cookies

- OWASP Session Management: use the framework's built-in session management; session IDs need ≥64 bits of entropy from a CSPRNG; exchange them via **cookies with `Secure`, `HttpOnly`, and `SameSite=Strict` (preferred) or `Lax`**; regenerate the session ID at login (session-fixation defense); never accept session IDs from URL parameters [11].
- **Do not put tokens in localStorage:** "Do not store authentication tokens, session IDs, JWTs, refresh tokens, or any credential in `localStorage` or `sessionStorage`… a single XSS vulnerability discloses every token. Use `HttpOnly; Secure; SameSite=Strict` cookies (preferred) or a Backend-for-Frontend (BFF) pattern" [11].
- The IETF's current guidance for browser-based apps (RFC 10017, "OAuth 2.0 for Browser-Based Applications") lands in the same place: the BFF pattern "manages OAuth access and refresh tokens in the context of a cookie-based session, avoiding the direct exposure of any tokens to the browser-based application," with cookie `Secure`/`HttpOnly` MUSTs and `SameSite=Strict` SHOULD [14]. In other words: even when OAuth is used, browsers end up with a cookie session in front of it.
- **JWTs in the browser buy you nothing here:** the classic JWT trade-offs (no server-side revocation, stale permissions until expiry, larger payloads) hurt precisely where this app is weakest — revoking a compromised staff account instantly matters more than stateless horizontal scaling for 1,000 users. A plain session row in Postgres/Redis gives instant revocation and trivial audit. OWASP's session guidance is built entirely around server-side state for exactly this reason [11].

### Scanners → per-device tokens

- pretix's model: devices are registered server-side (unique serial + one-time initialization token), can be scoped to specific events, and can be **revoked** individually [4]. Do the same: each physical scanner gets a long random device token minted by an admin, stored hashed, revocable in one click when a phone is lost. This is a "something you have" credential appropriate for a shared staff device that may be handed around.
- Rate-limit and log all scanner API calls (see §4, §5).

### Admins → passwords + TOTP

- OWASP MFA Cheat Sheet quick recommendations: "Require MFA for administrative or other high privileged users," offer TOTP for everyone [12]. MFA is "by far the best defense against the majority of password-related attacks" — Microsoft's published figure of blocking 99.9% of account compromises is cited by OWASP [12].
- TOTP specifics: standards-based (RFC 6238, default 30-second step), any authenticator app works; provide single-use recovery codes at enrollment [12].
- Password handling per OWASP Authentication Cheat Sheet: length over composition rules (≥15 chars without MFA, ≥8 with MFA, per NIST SP 800-63B as cited), block breached passwords, no periodic rotation, generic error messages to prevent account enumeration, login throttling/account lockout keyed to the **account** (not just IP), CAPTCHA after repeated failures as defense-in-depth [10].
- Require **re-authentication (step-up) for sensitive admin actions**: exporting the full attendee list (containing national IDs) or changing another user's roles — OWASP requires re-auth before sensitive account/privilege changes and after risk events [10].

### Is OAuth2 / SAML SSO overkill?

**Yes, for this platform.** OAuth2 (RFC 6749) is an *authorization* framework: it exists to let a resource owner grant a third-party client scoped access to resources at a resource server via an authorization server [13]. Its whole reason to exist is **delegated cross-party access** — "let app X use my account at service Y." Your platform has no third-party clients and no external identity providers: staff are your own users, attendees register directly, scanners are your own devices. There is nothing to federate.

SAML 2.0 is heavier still (XML, metadata/ signing ceremonies, IdP-initiated flows) and exists for enterprise IdP federation.

OWASP's architectural note points the same direction: don't reuse an internal authentication solution for public/DMZ access — your public registration and staff panel are different trust zones and should not share one SSO realm [10].

**When it would stop being overkill:** the congress is run under a university/medical-association umbrella that mandates logging in with their existing SSO; or you must issue API access to a third-party (e.g., a venue app). Until then: sessions + device tokens + TOTP.

**Ceremony to skip:** OAuth2 authorization server, SAML IdP, OIDC, passkeys-for-everyone (fine to offer later), password rotation policies, custom crypto.

---

## 3. Data Protection: What to Encrypt at Rest, and Retention

### Layered options (per PostgreSQL's own docs)

PostgreSQL's "Encryption Options" page lays out the layers — and notably **community PostgreSQL has no tablespace/database-level TDE**; the documented options are: password hashing (SCRAM), **column-level encryption via pgcrypto**, **filesystem/block-level encryption** (LUS/dm-crypt+LUKS, eCryptfs, geli…), SSL/GSSAPI for the network, and client-side encryption [16]. Key properties:

- Disk/volume encryption "prevents unencrypted data from being read from the drives if the drives or the entire computer is stolen," but does nothing once the filesystem is mounted [16].
- pgcrypto column encryption is "useful if only some of the data is sensitive," but the data and key are briefly in server memory, and "someone with complete access to the database server, such as the system administrator" can intercept [16].
- OWASP Cryptographic Storage: *which* layer is right depends on the threat model — hardware/disk encryption protects against physical theft, "will provide no protection if an attacker is able to compromise the server remotely" [17]. Also: the best protection is not storing the data at all (their credit-card example generalizes to any sensitive field) [17].

### Applying this to the congress data model

| Data | Sensitivity | Recommendation |
|---|---|---|
| Passwords | High | **Hash only** (Argon2id/bcrypt) — never encrypt; OWASP Password Storage via [10][17] |
| OTP codes | Medium (short-lived) | Hash, single-use, short TTL, strict attempt limits [12] |
| Payment reference numbers | Low | Plain columns + access control. A PSP reference/RRN is not cardholder data; you should never store PANs at all (OWASP: minimize sensitive storage [17]) — the Iranian PSP (e.g., local gateway) settles and gives you a reference. |
| National ID (کد ملی) | High (PII, ~10-digit keyspace) | **If you must store it** (CME certificate requirements may demand identity verification): pgcrypto column encryption or application-level encryption, on top of disk encryption [16][17]. Consider storing only a salted hash for duplicate detection + last-4 display, keeping full values in a separate restricted table — separation of keys and data [17]. |
| Name, phone, email, specialty | Medium (PII in aggregate) | Access-controlled columns; disk encryption covers theft; do not log (see §5) [26] |
| Medical specialty / CME credit data | Medium | Not health records per se, but combined with national ID it identifies a physician's professional record — treat as PII: access control + audit trail. |

**Concrete right-sized stack:** dm-crypt/LUKS on the DB volume [16] + SCRAM auth + SSL between app and DB [16] + Argon2id for passwords [10] + hashed OTPs [12] + column-level encryption for national ID if stored [16][17] + application-level access control (this is the control that actually defends against the remote-compromise threat, which disk and column encryption do not address [16][17]).

**Ceremony to skip:** app-level encryption of every PII column (painful key management, marginal gain over disk+access control at this scale), a KMS/HSM cluster (OWASP notes key-management systems add complexity "may not be feasible for all applications" [17]), per-attendee encrypted PDFs at rest.

### Iranian data-protection bill status (verified as of 2026-10-05)

Iran's personal-data protection law is **still a bill, not enacted law, per all verifiable primary reporting**:

- A draft "طرح حمایت و حفاظت از داده و اطلاعات شخصی" (Personal Data Protection and Safeguarding Bill) has circulated since at least 1400/2021 (published text at [21's companion] ekhtebar.ir; the Ministry of ICT's "صیانت و حفاظت از داده‌های شخصی" bill text was unveiled at ELECOMP [21]).
- Feb/Mar 2024 (Esfand 1402): ISNA reported the bill **passed the government's (Cabinet's) legal commission** and would go to the full Cabinet, then to Parliament for final passage [22].
- June 2023 (Khordad 1402): Mehr News reported the digital-economy working group had approved it and it awaited Cabinet referral [—].
- Oct 2024 (Mehr 1403): ISNA's "latest status of the user data protection bill" reported on the ICT Minister's statements — still in process, no enactment [23].
- **No primary or credible secondary source found indicating the bill became law in 2025–2026.** Treat it as pending: design to a GDPR-ish baseline anyway (consent, purpose limitation, minimal collection, breach readiness), because (a) the bill's direction is knowable from the published drafts, and (b) if enacted, it will likely require it. Flag for re-verification before launch.

### CME attendance record retention

- **ACCME (US, the reference accreditation body): an accredited provider must record and, when authorized, verify participation for six years from the date of the CME activity** — this is the canonical attendance-records retention number [18]. Activity documentation must be kept for the current accreditation term or 12 months, whichever is longer [18].
- **Iran:** the national CME system runs through IRCME (ircme.ir registration) and the Supreme Council of Continuing Medical Education; credit accrual for physicians is calculated in **5-year cycles** per the Supreme Council's point-allocation regulations [19], and licensing/revalidation runs through IRIMC, with practice-permit durations set by Ministry of Health rules (maximum 2 years for GPs, 4–12 years for specialists per IRIMC's published regulations) [20]. **No published Iranian rule fixing a retention period for congress attendance records was found.**
- **Recommendation (inference, not a cited rule):** retain attendance records ≥6 years, matching the ACCME anchor and covering one full 5-year Iranian CME credit cycle plus a dispute window [18][19]. Since the platform is the system of record for certificates, treat 6 years as the floor for attendance + audit logs together.

---

## 4. Rate Limiting / Abuse of Public Registration and OTP Endpoints

### SMS pumping (the real, documented threat)

Twilio (first-party documentation) defines **SMS pumping / artificial traffic inflation**: "fraudsters take advantage of a phone number input field to receive a one-time passcode… messages are sent to a range of numbers controlled by a specific mobile network operator and the fraudsters get a share of the generated revenue. Phone number verification and two-factor authentication (2FA) flows are often exploited for this purpose." The goal is inflated traffic and revenue share — "to make money and *not* to steal information" [24]. Their published countermeasures, all applicable to any OTP endpoint [24]:

- **Rate limits** by user, IP, and device identifier; no more than 1 message per X seconds to the same number/prefix; per-country daily caps.
- **Exponential delays between retry/resend requests** to the same number; time-delayed "call me instead" option.
- **Bot detection / CAPTCHA** (botd, etc.) on the request-OTP form.
- **Email confirmation as friction** before or alongside SMS.
- **Geographic permissions:** only send to countries you expect — for an Iranian congress this means **locking sending to `+98`** (and the handful of international attendees handled manually or via a whitelist).
- **Carrier/line-type lookup** before sending — only send to mobile numbers.
- **IP/VPN analysis:** flag TOR/proxy/cloud-provider IPs.
- Twilio also cautions that no provider-side tool is 100%: "Customer participation is essential to successfully defend against fraud" [24].

### OTP implementation rules (from OWASP MFA Cheat Sheet)

- Short TTL, **single-use**, invalidate on successful verification, **strict attempt limits**; on resend, generate a new code and overwrite the old record; never log OTP values; CSPRNG generation; prefer 8-digit codes where usability allows; hashing OTPs limits blast radius if the DB is briefly exposed [12].

### Kavenegar specifics (Iranian OTP delivery)

- Kavenegar's REST API exposes the dedicated **`verify/lookup`** endpoint for sending verification codes: you pass `receptor` (phone), `token` (the code), and a pre-approved `template`; these messages get **highest priority and are not filtered** for users who have blocked promotional SMS, and the endpoint supports international delivery (148 countries) [25]. This is the endpoint to use for OTPs — not plain `sms/send` [25].
- Kavenegar also provides **per-line blacklists** (`blocked-add` / `blocked-exists` / `blocked-remove`, max 200 numbers per call) — useful for blocking abusive numbers at the provider level [25], and `localid` on sends to **prevent duplicate message delivery** for a given idempotency key [25].
- **Gap to know:** Kavenegar's public REST documentation documents no application-level rate limiting or fraud-score features on `verify/lookup` (no rate-limit parameters appear anywhere in the API docs) [25]. Unlike Twilio's Fraud Guard [24], the Iranian provider does not publish an equivalent — **your application must enforce all rate limits, attempt caps, and geo-locks itself.**

### Public registration form abuse

No first-party case study of "Iranian bots mass-registering for Iranian congress sites" was found in verifiable sources — do not assume a specific local pattern; the generic defenses are what the standards prescribe. OWASP Authentication Cheat Sheet's automated-attack protections apply directly to registration/login: **account-keyed (not just IP-keyed) throttling/lockout, CAPTCHA after a few failures as defense-in-depth, and generic responses** that don't reveal whether an account exists [10]. For the registration endpoint itself: rate-limit per IP + per phone/email, require the OTP before an account is persisted, and put CAPTCHA in front of the send-OTP action [24][10].

### Concrete limits for this congress (recommendation)

- Send-OTP: ≤3 SMS per phone per hour, ≥60s between sends, exponential resend delays, `+98`-only by default [24][12].
- Verify-OTP: ≤5 attempts per code, new code overwrites old on resend, TTL ≤5 min [12].
- Registration submissions: per-IP rate limit + CAPTCHA after N attempts [10][24].
- Admin login: lockout/throttling keyed to the account, TOTP [10][12].

---

## 5. Audit Logging for CME Certificate Integrity

### What the standards require you to log

OWASP Logging Cheat Sheet — events to "always log" where possible, mapped to this platform [26]:

| OWASP event class | Congress-platform event |
|---|---|
| Authentication successes and failures | Staff/admin/scanner logins, failed OTP verifications |
| Authorization (access control) failures | Staff attempting actions outside their role |
| **User administration actions** (adding/deleting users, changing privileges, assigning/revoking tokens) | Creating staff accounts, role changes, **scanner device registration/revocation** [26][4] |
| **Use of systems administrative privileges, including all actions by those users** | Every admin-panel action while authenticated as an admin [26] |
| **Access to sensitive data** (their example: cardholder data) | Views/exports of attendee lists containing national ID/phone |
| **Data import and export including screen-based reports** | Export of the attendance roster, certificate CSV/PDF exports |
| Data changes (optional class) | **Attendance edits** — the core CME integrity event |
| Suspicious business-logic activities | Out-of-order flows, e.g., certificate issuance without check-in; attendance modifications after certificate issuance |

### Event attributes (the "when/where/who/what" rule)

Each entry must record: log timestamp and event timestamp, interaction identifier (correlates multiple events of one user action), source address (IP/device), user identity (DB key, not just username), event type, severity, action, **object** (the affected record: which attendance row, which certificate serial), result status, and reason [26]. For an attendance edit, that means: *who* edited, *when*, *which* attendance record, *before → after* values, *from which device/IP*, and success/failure.

### What must NEVER be in the logs

OWASP is explicit: do not record (remove/mask/hash instead) **session ID values, access tokens, authentication passwords, encryption keys, sensitive PII including health data and government identifiers, bank/payment cardholder data** [26]. And from the MFA cheat sheet: **never log OTP values** [12]. In this platform: log the *fact* of an OTP verification failure, never the code; log actor identity + object ID, not the attendee's national ID.

### Storage and integrity properties (right-sized)

- Write logs via a **separate DB account with restrictive permissions** (write-only for the app) [26].
- Keep the audit trail **separate from security/ops logs** — they serve different purposes and consumers [26].
- **Append-only / no UPDATE/DELETE path** from the application for audit rows; admin UI offers no edit/delete for audit entries. OWASP notes non-repudiation for logs is genuinely hard and depends on the logging party being audited; treat log integrity as an operational discipline (restricted access, separate storage) rather than promising cryptographic non-repudiation [26].
- **Retention: align with CME records — ≥6 years** (§3), since the audit log is the evidence that certificates were issued against real attendance [18].
- Practical certificate-integrity extras (practice, not sourced): give each issued certificate a unique serial recorded in the audit log + a verification code printed on the PDF so authenticity can be checked against the DB later.

**Ceremony to skip:** SIEM pipelines, WAF-managed log shipping, blockchain-style hash-chained audit trails — a write-only Postgres table with strict permissions, 6-year retention, and disciplined event coverage is the right size for a 1,000-attendee congress [26].

---

## Sources

1. pretix Documentation — "Ticket secrets" (random secrets, Ed25519 signature scheme for >25k tickets, scan-mode comparison table): https://docs.pretix.eu/guides/ticket-secrets
2. pretix Documentation — "Check-in algorithms" (server-side redemption checks, nonce deduplication): https://docs.pretix.eu/dev/development/algorithms/checkin.html
3. pretix Security Release 4.11.1 (QR forgery via internal ticket IDs; untrusted scanner input, HIGH severity): https://pretix.eu/about/en/blog/20220705-release-4111
4. pretix API Documentation — "Devices" (device registration, initialization tokens, revocation): https://docs.pretix.eu/dev/api/resources/devices.html
5. Ticketmaster Help — "Why do my tickets have a moving barcode?" (rotates every 15 seconds; screenshots won't work): https://help.ticketmaster.com/hc/en-us/articles/26584309038353-Why-do-my-tickets-have-a-moving-barcode
6. Ticketmaster Business — Event Day & Ticketing (SafeTix overview): https://business.ticketmaster.com/solutions/event-day
7. Eventbrite Help Center — "Check in attendees at your event with the Eventbrite app for organizers" (scan modes, error on already checked-in): https://www.eventbrite.com/help/en-us/articles/741083/
8. Eventbrite Help Center — "Prevent attendees from sharing tickets" (error message on already-used ticket; name-based check-in): https://www.eventbrite.com/help/en-us/articles/308105/
9. Eventbrite Help Center — "Transfer tickets to someone else" (transfer = edit order info, ticket stays in buyer's account): https://www.eventbrite.com/help/en-us/articles/431834/transfer-tickets-to-someone-else
10. OWASP Cheat Sheet Series — Authentication Cheat Sheet (password rules, MFA, throttling/lockout, generic errors, re-auth, anti-automation): https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
11. OWASP Cheat Sheet Series — Session Management Cheat Sheet (entropy, cookie attributes, localStorage warning, session ID renewal): https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
12. OWASP Cheat Sheet Series — Multifactor Authentication Cheat Sheet (MFA for admins, TOTP, OTP handling/storage rules): https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
13. IETF RFC 6749 — The OAuth 2.0 Authorization Framework: https://www.rfc-editor.org/rfc/rfc6749
14. IETF RFC 10017 — OAuth 2.0 for Browser-Based Applications (BFF pattern, cookie requirements): https://www.rfc-editor.org/rfc/rfc10017.html
15. IETF RFC 6238 — TOTP Algorithm (30-second default step; cited via [12]): https://www.rfc-editor.org/rfc/rfc6238
16. PostgreSQL Documentation — 18.8 Encryption Options (pgcrypto, disk encryption, no built-in TDE, SCRAM/SSL): https://www.postgresql.org/docs/current/encryption-options.html
17. OWASP Cheat Sheet Series — Cryptographic Storage Cheat Sheet (encryption layer vs threat model, key management, minimize sensitive storage): https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
18. ACCME Rules Policy — "CME Activity and Attendance Records Retention" (six-year attendance verification): https://accme.org/rule/cme-activity-and-attendance-records-retention/
19. انجمن علمی شنوایی‌شناسی ایران — "نحوه محاسبه امتیازات مشمولین آموزش مداوم در یک دوره ۵ ساله" (5-year Iranian CME credit cycle per Supreme Council rules, Shahrivar 1404): https://iranaudiology.ir/news/146-%D9%86%D8%AD%D9%88%D9%87-%D9%85%D8%AD%D8%A7%D8%B3%D8%A8%D9%87-%D8%A7%D9%85%D8%AA%DB%8C%D8%A7%D8%B2%D8%A7%D8%AA-%D9%85%D8%B4%D9%85%D9%88%D9%84%DB%8C%D9%86-%D8%A2%D9%85%D9%88%D8%B2%D8%B4-%D9%85%D8%AF%D8%A7%D9%88%D9%85-%D8%AC%D8%A7%D9%85%D8%B9%D9%87-%D9%BE%D8%B2%D8%B4%DA%A9%DB%8C-%D8%AF%D8%B1-%DB%8C%DA%A9-%D8%AF%D9%88%D8%B1%D9%87-5-%D8%B3%D8%A7%D9%84%D9%87.html
20. IRI Medical Council (IRIMC) — Regulations: Medical Education (licensing/practice-permit durations, CME requirement): https://irimc.org/en/Regulations/Medical-Education
21. Ministry of ICT (Iran) — unveiling of the "صیانت و حفاظت از داده‌های شخصی" bill (bill text, ELECOMP): https://www.ict.gov.ir/fa/newsagency/21691/
22. ISNA (Esfand 1402 / Feb–Mar 2024) — bill approved in the government's legal commission, to proceed to Cabinet and Parliament: https://www.isna.ir/news/1403021510710/
23. ISNA (Mehr 1403 / Oct 2024) — "جزئیاتی از آخرین وضعیت لایحه حفاظت از داده کاربران" (latest status per ICT Minister; not yet law): https://www.isna.ir/news/1403072821050/
24. Twilio Documentation — "Preventing Fraud in Programmable Messaging" (SMS pumping definition and countermeasures): https://www.twilio.com/docs/messaging/guides/preventing-messaging-fraud
25. Kavenegar REST API Documentation (verify/lookup endpoint, templates, blacklists, localid duplicate prevention; no documented rate limiting): https://kavenegar.com/rest.html
26. OWASP Cheat Sheet Series — Logging Cheat Sheet (events to log, event attributes, data to exclude, storage/permissions): https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

**Note on verification gaps (stated honestly):** (1) Iran's personal-data-protection bill status is verified only through Oct 2024 reporting; no enactment evidence was found for 2025–2026 — re-verify before relying. (2) No published Iranian retention rule for CME attendance records was found; the 6-year figure is the ACCME anchor plus inference. (3) No first-party case study of Iranian bot-driven registration abuse was found; §4's registration defenses derive from OWASP/Twilio generic guidance. (4) IRIMC's English regulations page loads minimal content; its revalidation/permit-cycle claims come from the indexed version of that page.
