# 07 — Congress-Day Runbook

**Audience:** the operations lead (server and platform console), gate supervisors, front-desk leads, the organizer's
on-site manager.
**Last updated:** 2026-10-23, against `integration/upgrade` (schema head `0029`). Replaces the 2026-10-10 version,
which used `GET /docs` (answers 404 in production) and a raw `pg_dump`.
**Operator reference:** [`docs/deployment/STAGING_OPERATIONS.md`](../deployment/STAGING_OPERATIONS.md). Every
server command below is `node scripts/staging/stack.mjs …`, run in the checkout on the server; `event-mode`,
`install-timers` need `sudo`.

Three rules hold for the whole congress:

1. **No deploys, no restarts and no organizer key rotation while gates scan.** A new backend needs new scanner
   apps (hashed manifest, below), a restart interrupts scans, and rotating the organizer key signs out every paired
   scanner, desk operator and organizer member (ADR 0016).
2. **Scanners must have flushed their offline queues** (pending count 0) before any planned restart, network change
   or device swap.
3. **Restore only after `restore-verify`.** A bad release is a `rollback`, not a restore (see *Bad release* below).

---

## 1. T-7 days: platform, data protection, capacity

### Release and data protection
- [ ] The release you will run is deployed now, not later: `stack.mjs releases` lists it as running (`*`) and keeps the
      previous one. Read the migration table in `STAGING_OPERATIONS.md` → *Releases and rollback*: if the release
      added a migration that is not `backward_compatible`, `rollback` cannot go back past it and the way back is a
      restore.
- [ ] `stack.mjs check` exits 0 (1 = warning, 2 = critical).
- [ ] Telegram alerts arrive: `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID` are set (in
      `/etc/congress/backup.env`), the on-call people are in the chat, and a deliberate problem (for example the `web`
      service stopped for one `check` run outside visitor hours, then `stack.mjs start`) produced an alert and then a
      `[RECOVERED]` message. Where `api.telegram.org` is blocked, `ALERT_TELEGRAM_API` points at a relay.
      Delivery from a server in Iran is **untested** until you have seen it.
- [ ] Timers installed (`sudo node scripts/staging/stack.mjs install-timers --user <user>`): nightly backup, `check`
      every 5 min, and with `BACKUP_WAL=on` the daily base backup.
- [ ] `stack.mjs scheduled-backup`, then `stack.mjs backups --offsite` lists it, then
      `stack.mjs restore-verify <that backup> --from-offsite` passes. Time it: that is your restore time (RTO) for
      this data size; write it down.
- [ ] With `BACKUP_WAL=on`: `stack.mjs base-backup full`, then `stack.mjs pitr-restore --to latest` passes.
- [ ] `BACKUP_ENCRYPTION_KEY` is in a password manager **off the server**. Without it no off-host copy can be restored.

### SMS (sms.ir) and sign-in
Every sign-in (attendee, desk operator, organizer member) is an SMS code; ticket confirmations, cancellations,
reissues, member invitations and desk resends are SMS too. There is **no backup SMS provider**.
- [ ] Platform console `/platform` → SMS (reachable only from networks in `CONGRESS_ADMIN_ALLOW`; hosted default
      `127.0.0.1/32`, so widen it to an office or VPN range beforehand if you will use the console on the day):
      mode is live (sms.ir), **Check connection & credit** succeeds, the service line is listed, and the credit covers
      the expected volume with a margin (≈ one SMS per sign-in, plus one per registration, plus resends).
- [ ] Platform SMS caps fit the expected peak. Defaults: **2,000 per rolling hour, 20,000 per rolling day**
      (`CONGRESS_SMS_HOURLY_CAP` / `CONGRESS_SMS_DAILY_CAP`, overridden in `/platform` → SMS). Above a cap nothing is
      sent: sign-in answers `SMS_HOURLY_CAP_REACHED` / `SMS_DAILY_CAP_REACHED`, and confirmations wait in the outbox.
      Crossing 80 % of a cap is logged as a warning; reaching it is logged as an error on `congress.sms.alerts`, which
      `check` reports (API error lines) and alerts on.
- [ ] A sign-in code and a ticket confirmation were received on a real phone; the confirmation wording was reviewed in
      Organizer → SMS.

### Venue network (do this as soon as the venue Wi-Fi exists)
A venue puts hundreds of phones behind **one public address** (NAT). Sign-in codes are limited per address:
**100 codes per address per hour** by default (`otp_sends_per_ip_per_hour`; IPv6 counts per /64). Addresses in
the **venue networks** list get their own, larger budget: **2,000 per address per hour** by default
(`otp_sends_per_trusted_ip_per_hour`).
- [ ] Find the venue's public address(es) **as the server sees them**: from a phone on the venue Wi-Fi, request a
      sign-in code, then look at the `client` field of that `POST /api/auth/otp/request` line in
      `stack.mjs logs api`. A private range (`10.x`, `192.168.x`) is only right if the server itself is on the venue
      network. Behind a CDN the address comes from `CONGRESS_CLIENT_IP_HEADER` (see `docs/deployment/CDN.md`).
- [ ] Enter them as CIDRs in `/platform` → Sign-in → **Venue networks** and adjust the venue budget if needed. The
      change applies to every API process within seconds, without a restart.
      `CONGRESS_OTP_TRUSTED_NETWORKS` sets the same list from the environment, but the staging/hosted Compose file
      does **not** pass that variable (nor the SMS cap variables) to the API, so on a Compose deployment use the console.
- [ ] Know what the venue list does **not** cover: wrong codes are limited to 100 per address per 15 min with no
      venue exception; SMS pass links to 600 opens and 20 failed codes per address per 15 min; attendees on mobile data
      come from carrier addresses that are not in the list.

### Event setup (organizer, with the operations lead)
- [ ] The event's public page is published (Page Studio). Reserving needs a published page, an unarchived event and an
      open registration window (`registration_enabled`, `registration_opens_at` / `registration_closes_at`) and, per
      tier, an open sales window; otherwise attendees see `REGISTRATION_CLOSED`, `REGISTRATION_NOT_OPEN` or the tier's
      closed state. The event's time zone (default `Asia/Tehran`) is right: program days, sales windows and analytics
      use it.
- [ ] Tiers and quotas set; program, venue (entrances, halls) and schedule files (PDF or image) uploaded.
- [ ] Check-in points created, one admission policy each (ADR 0010 status notes): `MULTI_ENTRY`, `SINGLE_USE` (once
      ever per point, no time window), `TIER_RESTRICTED`, `CAPACITY_CAPPED` (counts admissions in total; nobody leaving
      frees a place, and **offline it rejects everyone**).
- [ ] Booths created and booth staff added by mobile number; desk operators added (Organizer → event → Operators);
      organizer members and roles set (`/organizer/members`).
- [ ] Shortened pass links: if SMS length matters, `CONGRESS_SHORT_LINK_ORIGIN` points at a short domain served by this
      same deployment (ADR 0015). Otherwise leave it unset.

---

## 2. T-24 hours

- [ ] `sudo node scripts/staging/stack.mjs event-mode on` (backups hourly at :05; `check` now expects a backup younger
      than `BACKUP_EVENT_MAX_AGE_HOURS`, 2 h), then `stack.mjs event-mode status`.
- [ ] One `stack.mjs scheduled-backup` by hand right after switching event mode on; `stack.mjs backups --offsite`
      lists it; `stack.mjs restore-verify <it> --from-offsite` passes.
- [ ] `stack.mjs check` exits 0. `stack.mjs releases` shows the release to run plus a previous one kept.
- [ ] `/platform` → SMS: credit re-checked; the outbox shows no growing `pending` queue and no old `oldest pending`;
      sent-last-hour / sent-last-day are well below the caps.
- [ ] Venue networks entered and tested from the venue Wi-Fi (section 1).
- [ ] Ask the organizer to tell attendees (in the confirmation wording or a reminder) to **open their SMS pass link once
      before arriving**: the pass is then kept on the phone and opens without signal at the gate.
- [ ] **Scanner devices updated and paired** (section 3). Scanner tokens are valid for 7 days, so pairing the day
      before is fine.
- [ ] Desk stations: each operator signs in at `/reception` (congress code) or `/reception/<event-id>` with an SMS code
      and prints a test pass (browser print; it issues nothing new). The desk session lives in that browser tab for up to
      7 days: **do not close the tab**, or a new SMS code is needed.

---

## 3. Scanner devices (gate PWA)

The web PWA at `/scan/<point-id>` is the only scanner (ADR 0009 status notes). What it does:
- **Online:** each scan is decided by the server (`POST /api/checkin-points/{id}/scan`, 2 s timeout). If the server
  does not answer in time, the device decides from its local manifest and queues the scan with the same id.
- **Manifest:** codes are kept only as hashes (`qr_hash`), never as raw secrets; a delta is fetched every 30 s
  while online, so a cancelled or reissued ticket is refused offline after the next delta.
- **Offline:** admissions are provisional (amber) and queued in IndexedDB; uploads go in batches of up to 200 when the
  server answers again. A scan the device rejected stays a rejection (device verdict); the server never turns it into
  an admission. After **24 h** without a successful manifest download the device stops admitting until it reconnects.
- **One tab per point** (Web Locks): a second tab for the same point waits. A device that is unpaired or revoked
  deletes its manifest and synced scans; unsynced scans stay until they are uploaded or an operator discards them.

### Version parity with the backend (before doors open)
A backend from this release sends only hashed codes; **a scanner app from before it rejects every badge**. After any
deploy, every gate device must run the new web app:
- [ ] On each device, open the scanner URL **online**. Within about a minute a banner says "A new version of the app is
      ready"; tap **Reload to update** (it never reloads by itself, so an operator is not swapped mid-shift). Queued scans
      survive the reload (IndexedDB), but update while the pending count is 0 anyway.
- [ ] Parity check per device: at a `MULTI_ENTRY` point, scan a test attendee's pass online (green), then in airplane
      mode (amber, provisional), then reconnect and watch the pending count return to 0. An old app shows "not in local
      manifest" offline. Test scans appear in attendance statistics; use a dedicated test ticket.
- [ ] Never deploy, and never let devices update, during live scanning.

### Pairing
- [ ] Organizer → event → Check-in → pair a device per point (token or pairing QR). Name devices so a lost one can be
      revoked from the device list.
- [ ] Each device shows online, the manifest count, and the pending count 0. Audio on; a HID barcode gun works (Persian
      keyboard layouts are handled).
- [ ] Spare devices charged and paired to the busiest points.

---

## 4. T-2 hours

- [ ] `stack.mjs check` exits 0; `/api/ready` returns 200 through the public address.
- [ ] Every gate device: online, manifest loaded, pending 0, updated (section 3). Every desk station signed in.
- [ ] Venue Wi-Fi up; a supervisor phone hotspot ready as a fallback uplink for scanners.
- [ ] `/platform` → SMS: no pending backlog; caps and credit fine.
- [ ] On-call roles named: server (Telegram chat), SMS/console, gates, desk, organizer manager (Participants page).

---

## 5. During the congress

- Telegram alerts come from `check` every 5 min (new or changed problem, a reminder every 6 h, `[RECOVERED]`). Treat
  CRITICAL (container down, `/api/ready` failing, failed migration, backup too old, WAL archiving failing) as urgent.
- For a user's failing request, ask for the `X-Request-ID` header value and search `stack.mjs logs api` for it.
- Watch `/platform` → SMS outbox (pending count, oldest pending, sent last hour against the cap) and Organizer → SMS
  (failed / unknown messages).
- Organizer → Analytics shows attendance on the event's own clock (ADR 0020).
- Hourly backups run by themselves; `check` alerts if one is older than 2 h.

### Gate result guide
| Screen | Meaning | Action |
|---|---|---|
| Green | Admitted, decided by the server | Let in |
| Amber | Admitted provisionally (offline or server too slow) | Let in; the device uploads it later |
| Red, duplicate | `ALREADY_ADMITTED` (single-use point) | Not again; supervisor if disputed |
| Red | `TIER_NOT_ALLOWED`, `CAPACITY_REACHED`, `CAPACITY_UNAVAILABLE_OFFLINE`, `NOT_IN_LOCAL_MANIFEST`, `TICKET_INACTIVE` (cancelled or reissued pass), `INVALID_TICKET` | See the playbooks; desk for pass problems |

---

## 6. Playbooks

### A. Venue Wi-Fi or internet lost
1. Keep scanning. Passes in the local manifest are admitted provisionally (amber).
2. **Capacity-capped points reject everyone** (`CAPACITY_UNAVAILABLE_OFFLINE`): the device cannot know the room's
   count. Either reconnect that device first (hotspot) or hold the door.
3. People who registered or were reissued a pass after the device's last manifest are rejected
   (`NOT_IN_LOCAL_MANIFEST`). Connect the device briefly (hotspot) and scan again; a new scan is decided afresh.
4. Do not open a second tab for the same point. Reloading is safe (queued scans are in IndexedDB) but unnecessary.
5. When the network returns, queues upload by themselves (batches of up to 200, every 5 s). Check each device's pending
   count goes back to 0, and open the conflicts drawer if it shows any.
6. Attendees who opened their SMS link before are fine; others can still get their pass at the desk (printing needs
   the desk to be online).

### B. Device swap or lost device
- **Planned swap (battery, fault):** wait until pending is 0 (tether to a hotspot if needed), unpair the device
  (Disconnect / unpair in its settings: it revokes itself and wipes its local data), pair the spare with a new token,
  check the manifest count.
- **Lost or stolen device:** revoke it in Organizer → event → Check-in → pair dialog → device list. It is refused from
  its next request and wipes its manifest; scans it never uploaded are lost with it. Pair a spare.
- **Do not rotate the organizer key** to get rid of one device: that signs out every scanner, desk operator and member.

### C. Capacity reached
- `CAPACITY_REACHED` means `max_capacity` admissions have been recorded at this point **in total**; people leaving do
  not free places (no exit scans). Hold the queue and inform the waiting attendees.
- If the room really has space (for example a second session in the same hall), an organizer manager raises the
  point's maximum capacity in Organizer → event → Check-in; devices pick it up with the next manifest.
- For a new session in the same hall, a separate check-in point is cleaner than raising the cap.

### D. SMS outage or a cap reached
*Symptoms:* sign-in answers "SMS could not be sent" (`OTP_SEND_FAILED`, 503) or `SMS_HOURLY_CAP_REACHED` /
`SMS_DAILY_CAP_REACHED`; `/platform` → SMS outbox shows `pending` growing; Organizer → SMS shows failed messages;
`check` reports API error lines.
1. `/platform` → SMS → **Check connection & credit**. No credit: top up the sms.ir panel. Connection failing: sms.ir
   or the route to it is down; there is no backup provider, so the work-arounds below apply until it recovers.
2. A cap reached by legitimate traffic: raise it in `/platform` → SMS (applies within seconds). A cap reached by abuse:
   leave it, find the source in the logs (429s and sign-in bursts per address).
3. What keeps working without SMS: gates (passes already on phones or printed), desk lookup and **printing**, signed-in
   desk and organizer sessions. What does not: new sign-ins (attendees, desk operators, members) and new confirmation
   SMS. Keep desk tabs open.
4. Confirmations queued while the gateway could not send are delivered automatically when it recovers (they do not use
   up attempts). Messages that **failed** can be retried in Organizer → SMS. Messages marked **unknown** (timed out after
   sending) may have arrived; retry them only after asking the attendee, or mark them resolved.
5. Desk resends are limited: one per ticket per minute, five per ticket per hour, 300 per event per hour.

### E. Attendee lost their pass
1. Has the SMS: tap the link again (it opens the pass without a code until 30 days after the event, unless the ticket
   was cancelled or reissued).
2. Has their phone and number but no SMS: sign in with an SMS code; `/me` lists their passes.
3. Otherwise, at the desk: search by name or mobile, then **print the pass** (same QR, nothing new issued) or **resend
   the pass SMS** (same link).
4. Pass possibly in someone else's hands (screenshot, forwarded SMS): an organizer **manager or owner reissues** the
   ticket in Organizer → event → Participants. The old QR and link stop working at once for online scans and for
   offline devices after their next manifest delta; the new pass link is texted to the holder. Reissuing from the desk
   itself is not available yet (workstream C2, not merged).
5. Transfer to another person (Participants → transfer) cancels the original ticket and gives the place to the new
   holder with a new pass.

### F. Bad release or server failure
- **New code misbehaves, data is fine:** `stack.mjs rollback` (previous images; never touches the database). It works
  only when every migration since that release is `backward_compatible`; otherwise the schema guard refuses and the
  previous images are restarted. Update every gate device to the matching web app (section 3) after any change of
  release.
- **Data damaged or server lost:** `STAGING_OPERATIONS.md` → *Restoring for real* or *Recovering the live database to a
  point in time*, after `restore-verify` of the same backup. Scanners keep queuing while the server is down and upload
  when it is back; scans already uploaded after the restore point are lost unless the device still holds them.
- A container down: `stack.mjs logs <service>`, then `stack.mjs start` (restarts stopped services and waits for health).

---

## 7. Closeout (end of each day, and after the congress)

1. Every gate device: pending 0; conflicts reviewed and acknowledged in the conflicts drawer.
2. After the last day: unpair every device (it wipes its manifest and synced scans), and revoke any device that cannot
   be found.
3. Exports (Organizer → event): Analytics → attendance CSV (every scan, UTC and event-time columns) and registrations
   CSV; Participants → CSV. Exhibitors export their leads from the booth portal. Every export download is recorded in
   the audit log (Activity).
4. One final `stack.mjs scheduled-backup`; confirm it with `stack.mjs backups --offsite`.
5. `sudo node scripts/staging/stack.mjs event-mode off` (back to nightly backups).
6. Venue networks: remove the venue's addresses from `/platform` → Sign-in once the congress is over.
7. Only now: deploys, organizer key rotation, cleanup.
