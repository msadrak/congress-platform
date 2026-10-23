# 0012: Mobile Number Identity with SMS One-Time Codes (sms.ir)

## Context
Every person on the platform (attendee, booth representative, front-desk operator) used to be a User identified by an
e-mail address and a password. In practice the platform never sent a single e-mail, and e-mail is not a dependable
channel for congresses in Iran, where SMS is how people expect to be reached. The e-mail model also left three dead
ends: no password reset, desk operators received a temporary password the organizer had to hand over in person, and
booth representatives created by an assignment had an unusable password. Walk-ins were given a fake
`walkin-…@slug.local` address and could never sign in to see their pass.

## Decision
1. **Identity is an Iranian mobile number**, stored in one canonical form `09xxxxxxxxx` (`users.mobile`, unique,
   nullable only for a walk-in who gives no number). Input accepts Persian/Arabic digits, spaces and the `+98`, `0098`
   and `98` prefixes (`backend/app/sms/phone.py`, mirrored in `web/src/lib/mobile.ts`). E-mail and passwords are
   removed from the data model, the API and the UI (migration `0015`).
2. **Sign-in is passwordless by SMS code** (`POST /api/auth/otp/request`, `/verify`, `/complete`). Codes are
   6 digits from a CSPRNG, valid 120 s, single use, superseded by a newer code, limited to 5 guesses, and stored only
   as an HMAC (`otp_challenges`). A new number finishes with a short profile step. Desk operators use the same codes
   with purpose `desk`, which are only sent to active operators. Organizers keep their API key; scanners their device
   tokens. (Later, ADR 0016: organizer members sign in with purpose `organizer`, sent only to active members.)
3. **Abuse limits**: one code per number and purpose per 60 s, 5 per number per hour, 100 per IP per hour (a venue puts
   many attendees behind one IP), and failed verifications are throttled per number and per IP. Answers never reveal
   whether a number has an account.
4. **Delivery as plain text from the platform's sms.ir service line** (`POST https://api.sms.ir/v1/send/bulk` with
   `lineNumber`, `messageText` and one mobile; header `x-api-key`). The wording is **not** kept in the sms.ir panel
   (new panel templates cannot be added) but in the app (`sms_templates`, migration `0016`): built-in Persian
   defaults, a platform-wide override per kind set by the platform admin (`stack.mjs sms-template`), and for the
   ticket confirmation a per-event override edited by the organizer in the event workspace (Organizer → SMS), with
   `{name}`-style placeholders validated on save, a live preview, a test send and the event's delivery log. A small
   httpx client is used instead of the vendored SDK (which pulls in aiohttp, opens its session at construction and
   duplicates log handlers). Success requires HTTP 200 **and** an envelope `status` of 1.
5. **Ticket confirmation SMS with the pass link** after online reservation and desk walk-in, through a transactional
   outbox (`sms_messages`): the message is written in the ticket's transaction and delivered by a background task with
   exponential backoff, so a reservation never waits for or fails because of SMS. A timeout after sending is recorded
   as `unknown` and never resent, so nobody receives a message twice.
6. **Providers**: `smsir` (required in production) or `console` (development, tests and automated staging checks:
   nothing is sent; messages are kept in memory and readable by the platform admin at `/api/platform/sms-outbox`,
   which production never registers and Caddy keeps off the public internet).

## Consequences
- One credential for everyone; no passwords to store, reset or hand over. Booth representatives and desk operators
  are authorized by number and sign in immediately; walk-ins with a number can later sign in and see their pass.
- A deployment needs an sms.ir account with a service line, an API key and credit before go-live
  (`CONGRESS_SMS_PROVIDER`, `CONGRESS_SMSIR_API_KEY`, `CONGRESS_SMSIR_LINE_NUMBER`); production refuses to start
  without them. Free text on a service line is still subject to the operators' content rules (no advertising);
  the defaults are transactional on purpose.
- Peer networking and lead cards share the mobile number (consent-gated for peers) as `tel:`/`sms:` links and a
  vCard `TEL` line, where they used to share an e-mail address.
- Throttling and the outbox worker were in-process, which matched the one-API-process deployment; a multi-process
  deployment would need a shared limiter (the outbox is already safe with `FOR UPDATE SKIP LOCKED`). (Superseded by
  ADR 0019: the limiter is shared in PostgreSQL.)
- Later: staff invitation SMS (done, see below), event reminders (`send_after` already exists), organizer bulk messages with opt-out,
  delivery-report polling and a low-credit warning in the operator health check.

## Status / Implementation notes (2026-10-23)

The decision holds. The SMS/OTP workstream (B1, migration `0022`) hardened it; ADR 0019 records the abuse-limit and
SMS-cap decisions in full.

- **Codes are sent outside database transactions:** the challenge is committed and the connection released before
  sms.ir is called (`request_otp`, `backend/app/routes/auth.py`), so a slow provider never holds connections check-in
  needs. The sms.ir timeout defaults to 5 s (`CONGRESS_SMSIR_TIMEOUT_SECONDS`).
- **Point 3 limits are shared and per purpose:** the cooldown and the per-number budget are counted separately for each
  purpose (`signin`, `desk`, `organizer`), the per-IP budget per address (IPv6 per /64), all in PostgreSQL. Venue
  networks get their own per-address budget (default 2,000 per hour). Platform-wide hourly and daily SMS caps sit on top
  of every send.
- **Code length:** staging and production refuse to start with `CONGRESS_OTP_LENGTH` below 6, the console refuses to
  save less, and a shorter value saved earlier is raised to 6. In production the resend wait cannot be set below 30 s.
- **Signup tokens are single use** (`SIGNUP_TOKEN_USED` on a second use).
- **Point 5, outbox:** a pass claims messages (`status = 'sending'`, `lease_until`) in a short transaction and sends
  outside it; a lease that runs out marks the message `unknown`, never resent. Messages the gateway could not attempt
  (not configured, a cap, busy) wait without using an attempt. The organizer retries failed messages and retries or
  resolves unknown ones in Organizer → SMS; `/platform` shows the outbox health.
- **More message kinds:** `ticket_cancelled`, `ticket_reissued` (ADR 0017), `staff_invite` (booth staff) and
  `member_invite` (ADR 0016) beside `otp` and `ticket_confirmation`. The confirmation carries the short pass link
  (ADR 0015). Organizer test sends are limited to 10 per event per hour and 20 per organizer per day.
- **Point 6:** the console provider's messages are read at `/api/platform/sms-outbox` (`stack.mjs sms-code`); they live
  in the memory of the API process that "sent" them.
- Still open: a backup SMS provider (blocked on a contract), delivery-report polling, a low-credit alert (credit is
  checked by hand in `/platform`).
