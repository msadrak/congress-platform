# 0015: SMS Short Links and the One-Tap Pass

## Context
The ticket confirmation SMS (ADR 0012) carried `{origin}/c/{slug}/my-ticket`. That link is long (a Persian SMS part
holds 70 characters, so the URL alone could cost a part) and, worse, it opened a page that asked for a second SMS
sign-in code before showing the pass. At the gate that is the wrong moment for an OTP round trip: the attendee wants
the QR now, often on poor venue reception. The product owner confirmed "mode A": like a boarding-pass link, the SMS
link opens the attendee's pass in one tap, read-only, with no sign-in code. Networking and the profile still need a
sign-in (ADR 0005 is unchanged for everything that writes or reveals other people's data).

## Decision
1. **A short code per ticket** (`short_links`, migration `0019`): 10 characters from the 31-letter alphabet
   `23456789abcdefghjkmnpqrstuvwxyz` (no `0/o`, `1/l/i` look-alikes), ~49 bits from `secrets`. Minted in the same
   transaction as the ticket (online reservation, desk walk-in; `app/links.py`) and backfilled for existing tickets.
   It expires 30 days after the event ends and can be revoked (`revoke_ticket_links`). A desk resend reuses the
   ticket's active code, or mints one if it has none. Opens are counted (`first_opened_at`, `last_opened_at`,
   `open_count`); the organizer's SMS log shows when the confirmation's link was first opened.
2. **The SMS carries `{short origin}/t/{code}`**, about 24 characters on a short domain. The origin is
   `CONGRESS_SHORT_LINK_ORIGIN` (an https origin in staging/production) or else `CONGRESS_PUBLIC_ORIGIN`.
3. **Resolve API, code out of URLs**: `POST /api/public/passes/resolve` with `{"code": …}` in the body returns a
   read-only pass view (event, tier, holder name/organization/title, ticket id, status, issue date, `qr_secret`, the
   link's `expires_at`), never the mobile number. Refusals carry a stable `code` next to the English `detail`:
   404 `LINK_NOT_FOUND`, 410 `LINK_REVOKED` / `LINK_EXPIRED` / `TICKET_INACTIVE` (410s also name the congress slug so
   the page can offer that congress's sign-in). Responses are `Cache-Control: no-store`.
4. **Throttling per client IP**: 20 failed resolves per 15 minutes, after which the address is refused even with a
   valid code (no guess-and-check); real opens have a separate budget of 600 per 15 minutes, because a venue puts many
   attendees behind one address.
5. **The browser forgets the code**: `/t/:code` resolves, stores the pass in a dedicated read-only link-pass store
   (keyed by ticket, independent of the attendee token, kept until the link expires) and replaces the address with
   `/c/<slug>/my-ticket`, so the code leaves the address bar and the history. Signed out, that page shows the pass
   with "opened from your SMS link" and a sign-in for networking and profile; signed in, the normal flow wins. A dead
   link gets a friendly bilingual page with a sign-in action.
6. **Logs never hold a code**: the API URL carries none, and Caddy writes `/t/*` requests to a separate access logger
   with the path replaced by `/t/-`. Once the PWA's service worker is installed, `/t/…` navigations are answered
   from its cache and do not reach the server at all.

## Security trade-off
The code is a bearer credential for **viewing** the pass, exactly as strong as the pass QR it reveals. A forwarded
SMS works as a copy of the pass, as a screenshot of the QR always has; the gate's admission policies (ADR 0004,
0010), such as refusing an already admitted ticket, are what limit a copy, not secrecy of the link. The link grants nothing else: no
profile, no network, no contact details, no writes, and no mobile number in the response. Exposure is bounded by
expiry (event end + 30 days) and by revocation, which belongs with the ticket: cancelling or reissuing a ticket must
call `revoke_ticket_links` (there is no cancel/reissue endpoint yet; resolve already refuses links of tickets that are
not `active`). Guessing is impractical: 49 bits against a per-IP failure budget. Message bodies in `sms_messages`
contain the link, as they always contained the pass URL; they are visible to the event's organizer, who can already
see every pass QR.

## Alternatives considered
- **Keep the OTP before the pass**: the most private, but it fails the gate use case (second SMS, delivery delays,
  reception) and was rejected by the product owner.
- **A signed token (JWT) in the link**: self-contained, but long (hundreds of characters, several SMS parts), and
  revocation would need a server-side list anyway.
- **Put the QR secret itself in the link**: shortest path to a pass, but it turns the scanning credential into a URL
  that cannot be rotated without reissuing the QR, and it would land in histories and logs.
- **`GET /api/…/{code}` for resolving**: simpler, but the code would be written to every access log, proxy and CDN
  on the way; the body keeps it out.
- **An external URL shortener**: a third party would see every attendee's pass link and could go away mid-congress.

## Consequences
- The confirmation SMS is shorter and opens the pass immediately, also offline afterwards from the device's copy.
- Whoever holds the SMS can show the pass; attendees should be told to treat it like their ticket.
- A short domain (`CONGRESS_SHORT_LINK_ORIGIN`) must be served by the same deployment; attendees who tap it use the
  app on that domain, so it is optional and off by default.
- Ticket cancel/reissue, when added, must revoke the ticket's links in the same transaction and mint a new one for the
  replacement ticket.
