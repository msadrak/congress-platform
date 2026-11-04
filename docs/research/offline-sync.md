# Offline-First Event Check-In Architecture — How Real Systems Do It

Research date: 2026-10-05. Question: how do real event check-in systems implement offline-first operation (scan queue + batch sync, idempotency, local attendee cache, local badge printing), and what applies to a Persian RTL / Jalali-calendar kiosk for a ~1,000–2,000 attendee congress. All claims cite primary sources (official docs, specs, vendor help pages); numbered references appear in **## Sources** at the end.

## TL;DR

- **The pattern is proven in production**: Eventleaf documents the exact loop — enable offline mode while online (registration data cached to device), check in/out against the local database during the event, then "Disable and Sync" uploads pending actions with a verified action count [15][16]. Cvent OnArrival says its check-in "continues to function even with limited connectivity" [17]; Nunify says check-in and badge printing are "designed to work offline and reconnect when the internet is restored" [24].
- **Idempotency**: assign each scan a client-generated UUID (Stripe's model: server saves the first response per key and replays it for retries; keys ≤255 chars, pruned after ≥24h) [1], or make the scan a document/event with a unique id in an append-only store (CouchDB: a document's ID MUST be unique within its database; event store: append-only log with constant-time writes) [3][4]. Timestamp alone is not a safe dedup key.
- **A 2,000-attendee list (~2MB at ~1KB/attendee) is trivially cacheable**: IndexedDB (PouchDB's default browser adapter) or SQLite/Room on Android; browser quotas are MB-to-GB scale (Chrome: 60% of disk; Firefox: min(10% of disk, 10 GiB group limit)) — but call `navigator.storage.persist()` to avoid eviction [5][6][8].
- **Badges print locally over the LAN, not via a server**: every surveyed platform prints device→LAN-printer — Eventbrite Organizer connects directly to Star/Boca printers by IP on the same network [19][20][21]; Whova kiosks connect printers to the router's Wi-Fi [22]; Nunify uses AirPrint + native Zebra integration [24]. For a browser kiosk: QZ Tray (WebSocket print helper, raw ESC/POS) [9][10] or a local Node service with node-thermal-printer over `tcp://` [14]; WebUSB is Chrome-only/experimental [11][12][13].
- **Persian RTL + Jalali work fully offline**: `dir="rtl"`/`dir="auto"` in HTML [25], `Intl.DateTimeFormat` with `calendar: "persian"` is a built-in browser API [26], jalaali-js is a local MIT-licensed conversion library [27]; for ESC/POS printing, QZ Tray documents a Right-To-Left Languages technique and code-page encoding [10].

---

## 1. The sync pattern: local queue → batch upload → idempotent dedup

### What a real product does (Eventleaf, documented step by step)

1. **Enable offline mode while online**: "The Check In App must be connected to the internet when enabling the offline mode" — the app "will automatically sync and download the latest registration data to your device, storing it locally for offline access" (app version ≥ 4.0.2) [16].
2. **Operate offline**: staff "search for their names or scan their QR codes using the app"; the app "records the check-in time and updates the attendee's status in the offline database stored on your device"; check-out works the same way [16].
3. **Batch upload on reconnect**: in Settings → Usage Mode, "Review the Offline actions to upload"; optionally "clear and verify the number of actions to clear" (discard); then "Disable and Sync" — "A confirmation will indicate that offline mode has been disabled and list the number of actions that were uploaded" [16]. The vendor's feature page frames this as automatic once connectivity returns: "as soon as your device reconnects to the internet, the Eventleaf Check In app will automatically sync all the check-in data to the cloud," and emphasizes "no attendee information is lost" and that sync "eliminates discrepancies and maintains uniformity in the records" across devices [15].

This is the canonical shape: **full attendee snapshot pulled pre-event, append-only local scan log, explicit reviewed batch push, count verification, discard option.**

### Guaranteeing the same scan isn't counted twice

- **Stripe's idempotency mechanism (the reference pattern for retryable POSTs)**: "Stripe's idempotency works by saving the resulting status code and body of the first request made for any given idempotency key, regardless of whether it succeeds or fails. Subsequent requests with the same key return the same result, including 500 errors." The client generates the key — "we suggest using V4 UUIDs, or another random string with enough entropy"; keys are up to 255 characters; keys are pruned "after they're at least 24 hours old"; and the layer "compares incoming parameters to those of the original request and errors if they're not the same to prevent accidental misuse" [1].
- **Append-only event store (event sourcing)**: "Incoming events are stored in an Event Stream, implemented as an append-only log" — this data structure gives constant-time writes, lock-free concurrent reads, and auditability ("every change is captured and persisted. Every result can be traced back to its source event(s)") [4]. For check-in, this yields the attendance audit trail CME certificates need.
- **CouchDB/PouchDB (sync-native databases)**: a document is identified by `_id`/`_rev` and "A Document's ID MUST be unique within the Database where it is stored" — writing the same scan document twice cannot create two records, it produces revisions [3]. The CouchDB Replication Protocol is one-way source→target over HTTP, driven by a changes feed with sequence IDs, and **checkpoints** recorded in a replication log "for Replication recovery" — so an interrupted upload resumes from the last checkpoint instead of re-transferring and re-applying everything [3]. PouchDB adds the connectivity behavior a venue needs: `localDB.sync(remoteDB, {live: true, retry: true})` retries automatically when the connection drops and resumes when it returns — "ideal for scenarios where the user may be flitting in and out of connectivity, such as on mobile devices" [2].
- **Duplicate detection as a product behavior**: Eventbrite's scanner already surfaces this state to the operator — in default scan mode "An error message will appear if the QR code is already checked-in or not valid for this event" [18].

**Recommended composition for this platform** (consistent with all cited docs): each scan event carries `{scan_id: UUIDv4, device_id, qr_payload, action, client_timestamp}`; the device writes it to a local queue; upload is a batch POST that is idempotent per scan — the server caches/stores the first result for each `scan_id` and replays it on retry (Stripe model [1]) and/or enforces a unique constraint on `scan_id` (CouchDB document-id model [3]); the server also rejects a re-sent key whose parameters differ (Stripe's misuse guard [1]). Keep `device_id + scan_id` as the dedup pair; treat timestamps as data, never identity (clock skew on tablets and retry storms make timestamps unsafe as keys — the Stripe doc's parameter-comparison guard exists precisely for mismatched re-sends [1]).

Sources: [1] [2] [3] [4] [15] [16] [18]

---

## 2. Full attendee list cached on device for offline lookup

**Storage engines (browser kiosk / PWA):**

- **IndexedDB** is "a Web API for storing large data structures in the browser and indexing them for high-performance searching" — i.e., built for exactly this use case [6].
- **PouchDB** is an abstraction layer that "ships with the IndexedDB adapter for the browser by default" and adds CouchDB-style sync, replication and conflict handling on top [5][2]. (Cordova/SQLite adapters exist for apps that need native storage [5].)
- **Service workers** make the app shell itself work offline: the SW intercepts `fetch` and serves from the cache — MDN's js13kPWA tutorial shows install-time caching of the shell plus cache-first fetch responses, so "our app is caching its resources on install and serving them with fetch from the cache, so it works even if the user is offline" [7].
- **Android native**: the Room persistence library is the recommended layer over SQLite, and the docs state the offline-cache use case verbatim: "The most common use case is to cache relevant pieces of data so that when the device can't access the network, your users can still browse that content while they're offline" [8].

**Size math — is 2,000 attendees × ~1KB = ~2MB feasible?**

- Yes, by orders of magnitude. Chromium browsers allow an origin up to **60% of total disk size**; Firefox best-effort allows the smaller of 10% of disk or a **10 GiB group limit** (persistent: 50% of disk, capped at 8 TiB) [6]. Even a 64 GB kiosk tablet grants ~38 GB under Chrome's rule — 2 MB is ~0.005% of that.
- By contrast, Web Storage (`localStorage` + `sessionStorage`) caps at **10 MiB per origin** (5 MiB each) and throws `QuotaExceededError` past it [6] — workable for 2 MB of text but not the right tool once badge photos or logos are included (2,000 × 100 KB photos ≈ 200 MB — still fine in IndexedDB, but budget sync time for it) [6].
- **Eviction caveats that matter for a kiosk**: browser-stored data is *best-effort* by default and can be evicted under storage pressure using an LRU policy; request persistence with `navigator.storage.persist()` (Chromium browsers silently grant/deny it based on usage history) [6]. Safari additionally **proactively deletes script-created data for origins with no user interaction in the last 7 days** (with cross-site tracking prevention on) [6] — a daily-used kiosk is safe; a spare device left dormant for a week is not.

**Offline QR lookup is a shipped feature, not a theory**: Eventleaf's offline mode explicitly supports finding the attendee by "search[ing] for their names or scan[ning] their QR codes" against the cached registration data [16].

Sources: [2] [5] [6] [7] [8] [16]

---

## 3. Badge printing at the kiosk (ESC/POS thermal printers)

**Option A — QZ Tray (browser kiosk + local helper):** QZ Tray is "a cross-browser, cross-platform plugin for printing (and talking to serial/usb devices)" [9]; the browser talks to it over a WebSocket and it relays to the printer. Its raw-printing docs cover **ESC/POS directly** (init `ESC @`, align, bold, cut commands; Code128 barcodes; QR codes via the `GS ( k` command set) [10]. Notable details from the same page:
- Non-ASCII text needs explicit encoding care — a **code-page** option (example: `encoding: 'CP1253'` for Greek) [10], plus a dedicated **"Right-To-Left Languages"** technique under Advanced techniques [10].
- A warning directly relevant to badges: "The default `UTF8` encoding can corrupt QR codes, `'ISO-8859-1'` is recommended instead" [10].
- QZ can also print **directly to a network host/port** — `qz.configs.create({ host: "192.168.254.254", port: 9100 })` (e.g., a CUPS server or raw 9100 jetdirect-style printer) [10] — which is the same route Eventbrite's apps use (below).
- Cost: a desktop component must be installed on each kiosk (and its certificate trusted) [9].

**Option B — local Node/Electron service + node-thermal-printer:** Node.js module supporting Epson, Star, Tanca, Daruma, Brother and Custom thermal printers, with interfaces `tcp://192.168.0.99:9100` (network), `printer:Name` (system driver), or a local COM port; supports `printQR`, `cut`, barcodes, images [14]. Critical browser caveat from its README: "When using inside a browser, the network interface will not work as browsers do not allow opening TCP sockets" — so it belongs in a small local service (or Electron shell) that the kiosk UI calls [14].

**Option C — WebUSB:** the W3C WebUSB spec exposes non-standard USB devices to web pages [11]; MDN flags it **experimental** with "Limited availability... because it does not work in some of the most widely-used browsers," in secure contexts only [12]; Chrome documents it for its browser [13], but Safari/Firefox/iOS do not implement it — a Chrome-kiosk-only bet.

**The "API → server → printer" route is not what the surveyed event platforms do for badges.** Their apps print **locally over the LAN**:
- **Eventbrite Organizer**: connect the Star/Boca printer to the venue router via ethernet; the tablet joins the same network and adds the printer **by IP address**; a "Test printer" button prints a test ticket [19][20]. (Both Star and Boca articles describe the same app→LAN-printer flow [19][20], and the setup article lists printer connectivity under app Settings [21].)
- **Whova kiosk**: setup requires "set[ting] up the printers and ensur[ing] they are connected to the router's Wi-Fi or network," plus a badge template and a special kiosk iPad app distributed via QR code or emailed link (not on the App Store) [22].
- **Nunify**: "Connect to a wide variety of event badge printers which support apple air-print. Most popular zebra printers are also supported through a native integration" [24].

Local printing is also a hard requirement for offline operation — a server-mediated print path fails exactly when connectivity fails.

Sources: [9] [10] [11] [12] [13] [14] [19] [20] [21] [22] [24]

---

## 4. How commercial systems describe offline check-in

- **Eventleaf (Jolly Technologies)** — the most explicit documentation found. Full offline mode: enable while online → registration data cached to device memory → check-in/check-out recorded locally with timestamps → "Disable and Sync" uploads pending actions with the count shown for verification (or explicit clear/discard); positioning targets "remote events like mountain retreats, desert festivals," basements, cruise ships, and overloaded convention-center networks; security claims: encryption in transit, firewalls at rest [15][16].
- **Cvent OnArrival** — product page FAQ: "The system is optimized for high-volume environments and **continues to function even with limited connectivity**"; positioning covers self-service (Event-in-a-Box) and full-service (OnArrival 360 with kiosks, printers, scanners, onsite staff); also does session attendance via badge scan and "track[s] signatures for CE credits and legal compliance" (relevant to CME) [17].
- **Eventbrite Organizer** — help center documents camera QR scanning with three scan behaviors (default check-in / check-out / validate-only) and the duplicate-scan error ("An error message will appear if the QR code is already checked-in") [18]; device setup describes naming devices and LAN printer connectivity [21][19][20]; "offline payment methods" (cash, check, voucher) refers to payment capture, not data sync [21]. **No Eventbrite help article was found that documents an offline check-in/sync mode** — their published check-in flow assumes connectivity (help searches for "offline check-in" surface the same connectivity-dependent articles) [18][19][21]. Absence of documentation is reported as absence of documentation, not as absence of the feature.
- **Whova** — attendee app: "you are still able to view the agenda, attendee list, and the venue floormap in logistics," but "you will need to load all of this information on an internet connection first in order to gain offline access"; messaging/networking features do not work offline [23]. Organizer side: kiosk check-in with badge printing, printers on the router's network, kiosk app installed via QR/email link [22].
- **Nunify** — "Our event check in app & software works in offline mode" and "Internet connectivity issues will not stop your event check-in and badge printing. The event check in system is designed to work offline and reconnect when the internet is restored"; kiosk mode, self/facial check-in, walk-in registration, live attendance dashboards, Stripe payment collection [24].

Sources: [15] [16] [17] [18] [19] [20] [21] [22] [23] [24]

---

## 5. Persian RTL + Jalali calendar in an offline PWA UI

- **RTL layout**: set `dir="rtl"` (with `lang="fa"`) on the root `<html>` element — MDN: "Even for documents in a single script, it is recommended to explicitly set `dir` on the root element, which is especially important for RTL scripts, because the default LTR base direction is wrong" [25]. For data with unknown directionality (mixed Persian/Latin attendee names, emails, ticket codes in one string), use `dir="auto"` (first strongly-directional character decides) or the `<bdi>` element; tables with `dir="rtl"` reverse column order automatically [25]. All of this is pure HTML/BiDi behavior — works identically offline [25].
- **Jalali calendar**: `Intl.DateTimeFormat` accepts a `calendar` option, and `"persian"` is a supported value (alongside `"gregory"`, `"islamic"`, etc.) — a built-in browser API, so Jalali formatting needs no network and no third-party dependency [26]. For more control (e.g., custom month names, arithmetic), `jalaali-js` is an MIT-licensed JavaScript library of conversion functions between Jalali (Persian/Khayyami/Shamsi) and Gregorian calendars — also fully local/client-side [27].
- **RTL on thermal printers**: raw ESC/POS text is not BiDi-aware; QZ Tray documents a dedicated "Right-To-Left Languages" technique for raw printing and supports explicit code-page encodings (their Greek example: `encoding: 'CP1253'`) — Persian badge text needs the printer's code page verified (or render the badge as an image, which QZ and node-thermal-printer both support) [10][14]. The QR-code/UTF8 corruption warning in QZ's docs is directly relevant to Persian payloads on badges [10].

Sources: [10] [14] [25] [26] [27]

---

## Synthesis for this platform (all points traceable to sources above)

1. **Kiosk client**: PWA (service-worker app shell [7]) + IndexedDB attendee snapshot [6] (PouchDB if CouchDB-replication semantics — checkpoints, live/retry sync [2][3] — are preferred over a hand-rolled sync), or Android tablet with Room/SQLite [8]. Persist storage (`navigator.storage.persist()`) and keep the kiosk in active use [6].
2. **Scan event**: `{scan_id: UUIDv4, device_id, qr_payload, action, client_timestamp}` in a local append-only queue; idempotent batch upload — server caches the first response per `scan_id` and replays it (Stripe [1]), unique `scan_id` constraint server-side (CouchDB unique-id model [3]); Eventleaf's reviewed "Disable and Sync" with action counts is the UX to copy [16].
3. **Badge printing**: local, over the LAN — QZ Tray [9][10] or a Node service with node-thermal-printer at `tcp://printer-ip:9100` [14]; verify Persian code-page support or print badges as raster images; avoid WebUSB as the only path (Chrome-only [12][13]).
4. **Iranian context**: RTL + Jalali are offline-safe in the web layer [25][26][27]; the risk concentrates in thermal-printer encoding, not in the UI [10].

## Sources

1. Stripe API Reference — Idempotent requests: https://docs.stripe.com/api/idempotent_requests
2. PouchDB — Replication guide: https://pouchdb.apache.org/guides/replication.html
3. Apache CouchDB 3.5 Documentation — 2.4. CouchDB Replication Protocol: https://docs.couchdb.org/en/stable/replication/protocol.html
4. Confluent Developer — Event Store pattern: https://developer.confluent.io/patterns/event-storage/event-store/
5. PouchDB — Adapters: https://pouchdb.apache.org/adapters.html
6. MDN — Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Browser_storage_limits_and_eviction_criteria
7. MDN — js13kGames: Making the PWA work offline with service workers: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Offline_service_workers
8. Android Developers — Save data in a local database using Room: https://developer.android.com/training/data-storage/room
9. QZ Tray — Documentation / Getting Started: https://qz.io/docs
10. QZ Tray — Raw printing (ESC/POS, encoding, RTL, host printing): https://qz.io/docs/raw
11. W3C / WHATWG — WebUSB API Specification: https://usb.spec.whatwg.org/
12. MDN — WebUSB API: https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API
13. Chrome for Developers — Access USB Devices on the Web: https://developer.chrome.com/docs/capabilities/usb
14. node-thermal-printer — README: https://github.com/Klemen1337/node-thermal-printer/blob/master/README.md
15. Eventleaf — Offline Check-In feature page: https://www.eventleaf.com/event-management/event-check-in-app-offline-mode
16. Eventleaf — How to check in/out attendees using Eventleaf's Offline Mode: https://www.eventleaf.com/how-to/check-in-out-offline-mode
17. Cvent — OnArrival onsite event check-in software (product page + FAQ): https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software
18. Eventbrite Help — Check in attendees at your event with the Eventbrite app for organizers: https://www.eventbrite.com/help/en-us/articles/741083/how-to-check-in-attendees-at-the-event-with-eventbrite-organizer/
19. Eventbrite Help — Print tickets with a Star printer and the Eventbrite Organizer App: https://www.eventbrite.com/help/en-us/articles/310229/how-to-set-up-a-star-printer-and-print-tickets-with-eventbrite-organizer/
20. Eventbrite Help — Print tickets with a Boca printer and the Eventbrite Organizer App: https://www.eventbrite.com/help/en-us/articles/537871/how-to-set-up-a-boca-printer-and-print-tickets-with-eventbrite-organizer/
21. Eventbrite Help — Set up the Organizer App on your phone or tablet: https://www.eventbrite.com/help/en-us/articles/883605/set-up-the-organizer-app-on-your-phone-or-tablet/
22. Whova Help Center — How do I get started with Whova's Kiosk Check-In feature: https://whova.zendesk.com/hc/en-us/articles/40260616153883-How-do-I-get-started-with-Whova-s-Kiosk-Check-In-feature
23. Whova Help Center — What features are available offline: https://whova.zendesk.com/hc/en-us/articles/206566858-What-features-are-available-offline
24. Nunify — Event check-in app (Works Offline / badge printing): https://www.nunify.com/event-check-in-app
25. MDN — HTML global attribute `dir`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir
26. MDN — `Intl.DateTimeFormat()` constructor (`calendar` option): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat
27. jalaali-js — Jalali/Gregorian conversion library: https://github.com/jalaali/jalaali-js
