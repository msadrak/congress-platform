# UX-OPS spec — gate scanner, desk/reception, exhibitor booth

Reviewer: UX-OPS (`ops`). Review + specify only; no repo files changed.

Refs reviewed (detached worktrees, removed after the review):
- Scanner `/scan/:pointId` — `b980385` (integration/upgrade; C1 merged, PWA-1 **not** merged)
- Desk `/reception/:eventId` + organizer desk — `ws/c2-desk` `863fb1b`
- Booth `/booth/:boothId` — `ws/b6b-exhibitor` `1fd538c`

Evidence: screenshots in `/private/tmp/claude-501/-Users-mahdi-AITeb-Congress/e0633dca-6f77-4db9-8d0d-5bfdf63eb3a9/scratchpad/ux-review/ops/shots/`
(written below as `shots/<name>`; `-fa-m` = Persian 390×844, `-s` 360×740, `-t` 820×1180, `-k` 1180×820 kiosk, `-d` 1440×900).
Harness: `…/ux-review/ops/lib.mjs` (stateful mocks for the three schemas), `scan.mjs`, `desk.mjs`, `booth.mjs`, `gunwalkin.mjs`; raw output in `scan.out`, `desk.out`, `booth.out`.

---

## 1. Persona / scenario inventory

### Gate scanner operator (phone in one hand, or tablet on a stand; camera or HID gun; long queues; flaky Wi-Fi)
| # | Scenario | Today (b980385) |
|---|---|---|
| S1 | Get device paired: supervisor shows pairing QR (organizer `ScannerPairingDialog`) → phone camera opens `/scan/<pt>?token=` | Works in the browser. Unpaired screen only offers **paste a token** (`shots/scan-unpaired-fa-m.jpg`) |
| S2 | Pair *inside the installed app* (iOS home-screen apps have their own storage; Android WebAPK may also open links in Chrome) | **Impossible without pasting a JWT** — no in-app "scan pairing QR" |
| S3 | First scan, camera | Tap "فعال‌سازی دوربین دستگاه" every load; no auto-start, no remembered choice (`GateScanner.tsx:1113`) |
| S4 | First scan, HID gun | Works with nothing focused (window listener, `GateScanner.tsx:1000-1033`) — good (`shots/scan-hid-admitted-fa-k.jpg`) |
| S5 | Verdicts: admitted / provisional (offline) / duplicate / rejected (unknown, tier, cancelled, other event, required point) / capacity reached / capacity unknown offline | All implemented, colour+icon+words (`shots/scan-v-*.jpg`). Copy is long and duplicated (see F-S2) |
| S6 | Exit mode at occupancy points | Toggle + amber banner (`shots/scan-occupancy-exitmode-fa-m.jpg`); exit verdict «خروج ثبت شد» |
| S7 | Offline: provisional admissions, queue, auto-sync, offline window countdown | Works (`shots/scan-v-provisional-fa-m.jpg`, `scan-offline-after-fa-m.jpg`); countdown reads `23h 59m` in Persian |
| S8 | Sync conflicts after reconnect | Red "N تداخل" button + drawer |
| S9 | Device revoked / wrong point / credential expired / point archived | One setup template; Persian shows translated + verbatim English readout (`shots/scan-revoked-fa-m.jpg`) |
| S10 | Unpair, discard unsynced | In "Device settings" on the live screen, below the log, with confirm |
| S11 | Second tab on same point | Clear blocking screen (`shots/scan-othertab-fa-m.jpg`) |
| S12 | Update available | Global `AppUpdatePrompt` card, fixed top, light panel over the dark header (`AppUpdatePrompt.tsx:22`) |
| S13 | Screen sleeps between bursts of attendees | **No wake lock**; camera track dies on lock, no restart on `visibilitychange` |
| S14 | Reopen installed app next morning | `start_url: '/'`, `orientation: 'portrait'` (`vite.config.ts:56-57`) — lands on marketing home, landscape kiosks locked portrait (PWA-1 fixes for scanner only, unmerged) |
| S15 | Storage failure | Blocking red alertdialog "do not admit" — good |

### Desk / reception operator (tablet or laptop on a desk, HID gun, thermal/A6 printer, queue of walk-ins)
| # | Scenario | Today (863fb1b) |
|---|---|---|
| D1 | Open desk: link from organizer (EventOperators) or `/reception` + congress code | Works; entry page carries a 3-step marketing panel |
| D2 | Sign in by mobile + SMS code | Works; aside with tagline + steps |
| D3 | Find attendee by name/mobile | Debounced search, Enter opens first match |
| D4 | Scan badge with gun | Works **only while the search box has focus** (`ReceptionStation.tsx:494-513`). With focus anywhere else the scan is lost; with focus in the walk-in name field it **issues a pass** (F-D1) |
| D5 | Scan badge with camera | Camera dialog → lookup |
| D6 | Print badge / reprint / needs-reprint | Print recorded then `window.print()`; reprint flag shown in a small line; Print is *secondary*, "Next attendee (clear form)" is primary |
| D7 | Admit at a point | Select (defaults to first point) + Admit; verdict as a small text line |
| D8 | Edit details / reissue / transfer / cancel | Four small buttons + dialogs; cancel/reissue confirmed |
| D9 | Resend pass SMS | Full-width large button in the card's action area |
| D10 | Walk-in | Always-visible third panel (on phone: below the card, 3,000 px down); label says "صدور و چاپ" but nothing prints until the dialog's Print |
| D11 | Duplicate mobile on walk-in (409) | Offers the existing pass — good |
| D12 | Archived congress | Banner; actions hidden, print disabled — good, wording long |
| D13 | Offline / server down | Only "search failed" line; no persistent offline state; writes fail one by one |
| D14 | Session revoked/expired | Re-sign-in keeps walk-in draft — good |
| D15 | Organizer acting as desk (`/organizer/events/:id/desk`) | Operator/Organizer mode switch in the ink header |

### Exhibitor / booth staff (phone in one hand, sometimes a tablet + gun, crowded hall, weak signal)
| # | Scenario | Today (1fd538c) |
|---|---|---|
| B1 | Sign in (`/booth/:id/sign-in`) | Shared OTP sign-in — fine |
| B2 | Capture by camera | Bottom dock → dialog → tap "اسکن با دوربین" → decode only *fills* the field → tap "ذخیرهٔ لید" → result → tap "بعدی" = **4 taps per visitor** |
| B3 | Capture by gun | Works only after the capture dialog is open (code field focused); no page-level listener |
| B4 | Manual code | Same dialog; on phones the code field is auto-focused (`CaptureDialog.tsx:87`) so the soft keyboard covers the camera |
| B5 | Qualify (rating/tags/notes) | Optional block *before* capture; qualify dialog after |
| B6 | List/search/filter/trash/undo | Server search, rating chips, trash tab, 8 s undo toast — good |
| B7 | Export CSV (+ deleted) | Outline button + checkbox in the list header |
| B8 | Offline capture + queue + sync failures | Works, but offline banner and pending list sit ~1,100 px down on a phone (`shots/booth-offline-list-fa-m.jpg`); the pending list prints the **full badge QR secret** |
| B9 | Removed from staff / organizer suspended | Clear gate screens — good |
| B10 | Archived congress | Learned only from a 409 after the operator scans (`ExhibitorPortal.tsx:56`, `shots/booth-archived-capture-fa-m.jpg`) |
| B11 | Reopen installed app | Lands on `/` (no booth launch target) |

---

## 2. Findings (ranked)

### Critical
**F-D1 Desk: a barcode-gun scan with focus in the walk-in form issues a real pass named after the QR secret.**
`components/reception/WalkInForm.tsx:46,49` (form submits on Enter) + `ReceptionStation.tsx:494-513` (bursts recognised only inside the search box). Reproduced: `gunwalkin.mjs` → `POST /desk-registrations` with `full_name = "qrsecretdesk2…"`, minted dialog shows it (`shots/desk-gun-into-walkin-fa-k.jpg`). Consumes quota, sends an SMS if a mobile was typed, prints a credential as a name. On a busy desk the operator constantly clicks into the form between scans. Same root cause: scans are silently lost whenever focus is on the card (verified: second scan after clicking the card did nothing).

**F-S1 Scanner: an installed scanner cannot be paired without pasting a JWT.**
`GateScanner.tsx:1400-1430` (paste-only form), `lib/scannerPairing.ts` (pairing is a URL in a QR). iOS home-screen apps do not share Safari's storage, so the pass-through `?token=` pairing lands in Safari, not in the app; the installed app opens unpaired and the operator must paste a 300-character token on a phone. Gate staff will run the browser tab instead and lose the install benefits (launch target, full screen, wake lock).

### High
**F-X1 No screen wake lock on any operator tool; camera not restarted after sleep.** Scanner idles between bursts → phone locks → camera track ends; on unlock `cameraActive` is still true with a dead stream (no `visibilitychange` handling in `GateScanner.tsx`). Booth capture and desk kiosk also sleep. A wake-lock implementation already exists in `components/attendee/QrFullscreen.tsx:22-45`.

**F-X2 Installed apps reopen on the marketing home and are locked to portrait.** `vite.config.ts:56-57` (`orientation: 'portrait'`, `start_url: '/'`). PWA-1 (`ws/team2-pwa1-pwa-settings`, unmerged) fixes orientation and reopens the *scanner* point only; booth and desk are not covered. Landscape kiosk 1180×820 cannot be used installed.

**F-S2 Scanner verdict copy is long, duplicated and partly off-glossary.** Duplicate shows three lines: «ورود غیرمجاز (رد شد)» + «تکراری — ورود ممنوع» + reason; admitted «ورود مجاز و تایید شده»; tier prefixed by «سطح دسترسی و جایگاه:»; log reason «بلیت قبلاً مصرف شده است (ورود تکراری)» (banned «بلیت»); offline-capacity reason is a sentence (`lib/i18n.ts:369-377`, `components/scanner/ResultTakeover.tsx:20-55`). At arm's length the operator needs one word. Phone verdict title is 28 px (`scan.out` takeover rect) inside a 320 px stage; the header still takes the top 256 px.

**F-S3 Scanner live screen is a long scrolling page (1,474 px on a phone, `shots/scan-ready-full-fa-m.jpg`)** with seven blocks: header + 3-cell status rail, stage, manual entry with a 2-line hint, offline buffer bar with two bilingual buttons, scan log, device settings with a 4-line paragraph, unpair button, attribution. Persian screens also stack English under every command (`BiLabel`, `ScannerChrome.tsx:22-50`) and an English "System detail" readout. "N کارت در حافظه", manifest time, point UUID and build id are supervisor data on the operator's main screen.

**F-D2 Desk card buries the actions.** Phone: page is 3,089 px after opening a card; card heading at y≈814 (`desk.out`), Print at ≈1,900 (`tmp/desk-card-1600.jpg`). Kiosk 1180×820: only name + a 176 px on-screen QR pass are visible (`shots/desk-card-fa-k.jpg`); status, print state, Print and Admit are below the fold. Primary button is "پذیرش نفر بعدی (پاکسازی فرم)" not Print/Admit (`AttendeeCard.tsx:237-245`).

**F-B1 Booth capture costs 4 taps and opens the keyboard on phones.** `CaptureDialog.tsx:87` autofocuses the code field (soft keyboard over the camera on touch devices); `CaptureDialog.tsx:316-320` decode only fills the field; "Quick qualification" block (`:355`) sits between camera and Save. Gun scans outside the dialog are dropped.

**F-B2 Booth phone layout hides the list and the offline state.** Ink hero (event, name at 34 px, placard with stand + booth code, authorised badge, public-profile link, lead ledger with distribution bar) fills the first screen; first lead at y≈1,171 (`booth.out`, `shots/booth-ready-fa-m.jpg`). Offline banner + pending queue are below that, so offline is invisible where the operator looks (`shots/booth-offline-list-fa-m.jpg`).

**F-B3 Booth pending queue shows the full badge QR secret** (`PendingSyncPanel.tsx:76`). The secret is the attendee's gate credential (the desk API refuses to put it in a URL). Anyone glancing at the phone can copy it.

### Medium
- **F-B4 Archived congress learned only after a failed scan** (`ExhibitorPortal.tsx:56`); `BoothOut` has no archived flag (schema). Operator fills the capture form, then sees «این همایش بسته شده است».
- **F-D3 Walk-in always rendered** as a full third panel (phone: after the card, `tmp/desk-card-2300.jpg`); submit label «صدور و چاپ کارت ورود» does not print; tier select shows total quota «(ظرفیت کل: ۸۰۰)» not seats left, full tiers selectable (`WalkInForm.tsx:69-73`); label «سطح دسترسی و جایگاه» is not the decided term («نوع کارت ورود»).
- **F-D4 Desk admit**: defaults to the first point every time (`DeskActions.tsx:31`), verdict is a small sentence, not the gate's verdict look.
- **F-D5 Desk times**: scan history shows the Jalali weekday + date without time (`AttendeeCard.tsx:206`) — the desk needs "09:30 today". Same in booth lead cards ("زمان ثبت").
- **F-D6 Desk walk-in success** dialog: title and description repeat «کارت ورود با موفقیت صادر شد», then «صادر شد و آماده چاپ است»; Print is secondary (`MintedDialog.tsx`, `shots/desk-minted-fa-m.jpg`).
- **F-X3 Update prompt** is a light card fixed over the scanner's dark header (`AppUpdatePrompt.tsx:22`), covering sound/language controls; it ignores pending scans/open dialogs.
- **F-S4 Scanner camera choice not remembered**; operator taps "Enable camera" on every load (`Viewfinder.tsx` idle state).
- **F-X4 Three different "blocked/gate" screen implementations**: `ScannerChrome.SetupPanel`, `booth/BoothGate`, desk inline panels (`ReceptionPortal.tsx` invalid link, `ReceptionStation.tsx:660-680` pageError, `DeskAuthGate.OrganizerKeyRequired`). Plus `ui/PortalState.StatusPanel` exists.
- **F-X5 Three HID implementations** (`GateScanner.tsx` window listener, `lib/deskScan.ts KeyBurst` on one input, booth relies on a focused input) and two camera decoders (`GateScanner.tsx` loop vs `QrCameraInput.tsx`).
- **F-X6 Decorative/explanatory text everywhere**: section indices «۰۱ ۰۲ ۰۳»/"01 02 03" (scanner, desk, booth), desk tagline + subtitle + steps (`DeskAuthGate.tsx:54`, `ReceptionPortal.tsx:153`, `i18n deskSubtitle`), booth list title + description + footer privacy line, scanner `listeningBody`, `manualHint`, `settingsBody`, booth rating hints («فرصت فوری»…), desk print footnote.
- **F-X7 Persian mixing**: «سطح تمایل تجاری (Rating)», «دریافت فایل اکسل (CSV)», "Pass ID: #TK-1" (`ReceptionPass.tsx:53`), `/e/slug` and `arya-teb` mono in Persian headers, `0 اسکن…` Latin digits, `09:35:23` (`copy.ts:402`), `23h 59m`, «کیوآر» in `QrCameraInput` (decided «کد QR»), booth monogram «من» for «مهندس … نیک‌نام» (reads "me").
- **F-X8 `<html lang="en" dir="">` on all three Persian screens** (harness `lang=en dir=`); the tools set `dir/lang` on an inner div only. (A11Y-1 owns the global fix; operator shells must not depend on it.)

### Low
- Scanner sound toggle uses a bell icon (`ScannerHeader.tsx`), reads as notifications; use speaker.
- Scanner revoked body always says «0 اسکن همگام‌نشده…» even at 0.
- Desk `/` `Enter` `Esc` kbd hints on tablets (no keyboard) (`AttendeeSearch.tsx`).
- Desk print is recorded before the print dialog; cancelling the dialog still counts a print (`ReceptionStation.tsx:522-538`). Acceptable, but label it "print sent" not "printed".
- Booth delete is one tap + undo (good); the trash note paragraph is redundant with the tab name.

---

## 3. Simplification spec (per screen)

Copy rule for all three tools: one word for state, one short line for the next step, no "why" paragraphs, no English under Persian, no section numbers. Long explanations move to `docs/` (runbook), not the UI.

### 3.1 Scanner — live screen
REMOVE: section indices; `listeningBody`; `manualHint` paragraph; `BufferBar` (whole); policy chip duplication («فقط یک بار ورود» + «هر روز یک بار» → one chip); "N کارت در حافظه"; manifest timestamp cell; `settingsBody`; `BiLabel/BiHeading` English lines in Persian; point UUID; AIteb attribution on the live screen; `DeviceSettings` section from the page.
MERGE: link/manifest/queue rail → one **status pill** in the top bar: `● آنلاین` / `● آفلاین · ۳ در صف` / `↻ ارسال…` / `⚠ ۲ تداخل` (tap → conflicts sheet). Offline window appears only when < 2 h left: `آفلاین · ۱:۴۵ مانده`.
MOVE to the **⋮ menu sheet**: sound on/off, language, «تازه‌سازی فهرست», «ارسال صف», «آخرین اسکن‌ها» (phone), «نصب برنامه», «نسخهٔ تازه», version, «قطع اتصال دستگاه» (danger, confirm).
KEEP: top bar (point name as h1, one policy chip), Entry/Exit toggle (occupancy points), stage, manual entry (collapsed), last 5 scans on tablet/kiosk.
PRIMARY action: the stage (camera live by default when permission is already granted; otherwise one big «روشن کردن دوربین» button).
Manual entry: a single «ورود دستی کد» button under the stage → reveals input + «بررسی»; tracking-ID warning stays but one line.

Verdict (full-bleed over the stage; on phones the stage expands to all space under the top bar):
| state | colour | icon | fa word | en word | second line |
|---|---|---|---|---|---|
| admitted (server) | green | ✓ | مجاز | Admit | name (≥32 px) + tier chip |
| provisional (offline) | amber, dashed | ⧗ | مجاز · آفلاین | Admit · offline | name + tier |
| exit recorded | blue-grey | ⇥ | خروج | Exit | name |
| duplicate | red, striped | ⧉ | تکراری | Duplicate | name + «ورود قبلی ۰۹:۱۲» if known |
| rejected | red | ✕ | رد | Denied | short reason (below) |
Reasons (fa / en): کد نامعتبر / Invalid code · لغو شده / Cancelled · رویداد دیگر / Other event · نوع کارت ورود مجاز نیست / Ticket type not allowed · ظرفیت پر / Full · ظرفیت نامعلوم (آفلاین) / Capacity unknown offline · ابتدا ورود از {point} / Enter via {point} first · داخل نیست / Not inside · نقطه بایگانی شد / Point archived.
Title ≥ 44 px on phones, ≥ 64 px on tablets/kiosk; name ≥ 28/40 px. Remove the eyebrow line and the «سطح دسترسی و جایگاه:» prefix.

### 3.2 Scanner — setup / blocked screens (one template)
Layout: icon, one-line title, one-line instruction, one primary button, optional secondary, collapsed «جزئیات» (English diagnostic, version, point id).
- Unpaired: title «اتصال به نقطه ورود» / "Connect to gate"; line «کد QR اتصال را از سرپرست بگیرید.» / "Get the pairing QR from your supervisor."; primary **«اسکن کد QR اتصال»** (camera reads `/scan/<pt>?token=…`, must match this point); secondary «چسباندن کد» (reveals the current token field). On iOS (not standalone) also show the install hint (see §6).
- Revoked: «دستگاه لغو شد» / "Device revoked"; same primary. Unsynced line only when > 0: «۳ اسکن ارسال‌نشده روی این دستگاه» + «حذف» (confirm).
- Wrong point: «نقطه ورود اشتباه» / "Wrong gate". Expired: «اعتبار تمام شد» / "Pairing expired". Unavailable: «اتصال برقرار نشد» / "Can't reach server" + «تلاش دوباره».
- Other tab: «این نقطه در زبانهٔ دیگری باز است» / "Open in another tab" + no body.
- Deactivated (unpair pending): «قطع اتصال کامل نشد» + «تلاش دوباره» + re-pair primary.
REMOVE: `backToOrganizer` link (operators are not organizers; keep only in the collapsed details), SystemReadout always-open, token note line.

### 3.3 Desk — entry, sign-in
- `/reception`: REMOVE ink panel with 3 steps and helper paragraph; KEEP one field «کد همایش» + «ادامه»; error one line.
- Sign-in: REMOVE aside (tagline, steps) and `deskLoginSubtitle`; KEEP title «ورود اپراتور پذیرش» / "Desk sign-in", `MobileOtpForm`, rejected-session line (shorten to «نشست تمام شد؛ دوباره وارد شوید.»).

### 3.4 Desk — station
Top bar (shared operator bar, light): congress name (truncate) · status pill · ⋮ menu (operator name, language, sign out, mode switch for organizers, «تنظیمات همایش» for organizers).
REMOVE: ink header band, `deskSubtitle`, `/e/slug`, «01/02/03», kbd hints below 1024 px, helper line under search (put "scan or type" into the placeholder: «نام، موبایل یا اسکن کارت ورود» / "Name, mobile or scan badge"), idle "no attendee selected" plate on phones, on-screen `ReceptionPass` QR in the card, "Pass ID", print footnote, resend as a big button.
KEEP: search (autofocus, sticky), results list, attendee card, camera scan button (icon button inside the search field end).
Card (top → bottom): name (h2) + status chip + tier chip; print state line only if never/stale («چاپ نشده» / «نیاز به چاپ دوباره»); **sticky action bar**:
- primary = Print when never printed or stale («چاپ کارت ورود» / «چاپ دوباره»), otherwise Admit;
- Admit = one button per point when ≤ 2 points («پذیرش · درِ اصلی»), else select + button, remembering the last point per event (localStorage `congress_desk_point_<eventId>`);
- «بعدی» (secondary; also Esc) clears and refocuses search;
- ⋯ menu: «ارسال دوبارهٔ پیامک», «ویرایش», «صدور دوباره», «انتقال», divider, «لغو کارت ورود» (danger).
Details collapsed under «جزئیات» (mobile, organisation, issued by, registered, scan history with **time**: `۰۹:۳۰ · درِ اصلی · ورود`).
Admit result = shared verdict banner (colour + icon + one word + reason) inside the card for 3 s.

Walk-in: not a panel. A button «ثبت‌نام حضوری» next to the search, and the empty-result state's «ثبت «{q}» به‌عنوان ثبت‌نام حضوری» open a dialog (sheet on phones). Fields: name*, mobile, type («نوع کارت ورود»; options show seats left `عمومی · ۳۸۸ جا`; full types disabled), organisation + title on one row. Submit «صدور کارت ورود». Remove the mobile helper line. Success dialog: title «صادر شد» (no description), name + tier, **primary «چاپ کارت ورود»**, secondary «بعدی», SMS line only if a mobile was given («لینک به ۰۹۱۲… پیامک شد»). No on-screen QR unless printing is unavailable (keep a «نمایش کد QR» link).
Archived: one pill in the bar «بایگانی‌شده · فقط مشاهده»; hide walk-in button and action bar (not disabled), keep search/card.
Offline: bar pill «آفلاین»; disable action bar with one line «اتصال قطع است».

### 3.5 Booth — portal
Top bar (shared, light; phone 56 px): booth name (truncate) + small congress name · status pill (`آفلاین · ۲ در صف`, `بایگانی‌شده`) · ⋮ menu (language, «پروفایل عمومی غرفه», «خروجی CSV», «خروجی CSV با حذف‌شده‌ها», sign out, install).
REMOVE: ink hero, placard (stand + booth code), «نماینده رسمی غرفه», distribution bar + 3 rating counters (counts live in the filter chips), list eyebrow/title/description, footer privacy line, desktop capture aside copy (heading, paragraph, USB note), lead monogram, consent line under a shared mobile (keep only «بدون شماره» with eye-off when not shared), rating hints in the rating control, «(Rating)» and «(CSV)» suffixes.
KEEP: tabs «لیدها N | سطل بازیافت N», search, rating chips with counts, lead cards, undo toast, bottom capture dock (all sizes < 1024; ≥ 1024 a primary button in the bar).
Lead card: name, role line, rating chip, time («امروز ۱۰:۴۲»), tags, notes (2 lines clamp); tap card = qualify; trash icon button (44 px) with undo. Phone/SMS links only when the mobile is shared.
Pending queue: collapsed row under the tabs «۲ اسکن در انتظار ارسال · ارسال» → expands to rows `۰۹:۴۲ · کد …ghij · منتظر اتصال · کنار گذاشتن`. Never show the full secret (last 4 only).

### 3.6 Booth — capture sheet
Order: camera (auto-start on touch devices when camera permission is `granted`; otherwise one big «روشن کردن دوربین»), «وارد کردن کد» link (reveals the field; field autofocus only on `pointer: fine` devices).
Decode or gun Enter → **save immediately** (no rating unless the operator sets it later) → result:
| result | colour/icon | word |
|---|---|---|
| new | green ✓ | لید جدید / New lead |
| existing | indigo ⧉ | قبلاً ثبت شده / Already a lead |
| queued offline | amber ⧗ | ذخیره روی دستگاه / Saved offline |
| invalid | red ✕ | کد نامعتبر / Invalid code |
| other congress | red ✕ | همایش دیگر / Other congress |
Below the result: name + role, **rating chips (one tap saves)**, «یادداشت» (opens qualify), primary «بعدی» (camera resumes / field refocuses), secondary «پایان». Auto-advance to «بعدی» after 4 s if nothing is touched.
REMOVE from the pre-capture form: quick qualification block, rating hint, tags, notes, «یا کد را وارد کنید» divider.

### 3.7 Booth — qualify dialog
KEEP rating (3 segments without hints), tags, custom tag, notes, Save. REMOVE description line and «تعیین وضعیت و پیگیری» wording → title is the attendee name.

### 3.8 Booth — gates
Use the shared operator gate (§4): signed-out «ورود به غرفه», removed «دسترسی شما به این غرفه برداشته شد», suspended «غرفه موقتاً در دسترس نیست»; one line each, buttons as today. Unsent count only when > 0.

---

## 4. Consistency spec

New shared folder `web/src/components/operator/` (used by all three tools; scanner in `tone="ink"`, desk/booth in `tone="light"`):
- `OperatorBar` — 56 px, `pt-safe`, logical paddings: start = tool icon + context title (h1, truncate) + optional chip; end = `StatusPill` + `OperatorMenu` trigger (44 px). Replaces `ScannerHeader`, desk `ReceptionShell` header + ink band, booth ink header.
- `StatusPill` — states `online | offline | syncing | queued(n) | conflicts(n) | archived | update`. Colour + icon + ≤ 2 words. One component, three tools.
- `OperatorMenu` — bottom sheet on phones, popover ≥ 768 px; items: language, sound (scanner), sign out / unpair (danger, confirm), install, update, version.
- `OperatorGate` — generalise `booth/BoothGate.tsx` (icon, title, one line, actions, collapsed details) with `tone="ink"` for the scanner; delete `ScannerChrome.SetupFrame/SetupPanel/SystemReadout` and the desk inline gate panels; `ui/PortalState.StatusPanel` stays for attendee pages.
- `VerdictBanner` — colour + icon + word + name + reason; sizes `stage` (scanner takeover), `card` (desk admit), `sheet` (booth capture result). Replaces `ResultTakeover` internals, `DeskActions.AdmitPanel` verdict `<p>`, `CaptureDialog` confirm cards.
- `components/ui/Toast.tsx` — generalise `booth/UndoToast.tsx` (message, optional action, timeout); desk notices (cancelled, reissued, transferred, resent) use it instead of inline green text.
- Hooks: `hooks/useWakeLock.ts` (from `QrFullscreen.tsx`), `hooks/useHidScanner.ts` (window-level, capture phase; uses `hidCharacter` + `KeyBurst`; while a burst is in progress it `preventDefault`s keystrokes so nothing lands in inputs, and swallows the closing Enter), `hooks/useOperatorLaunch.ts` (records the last operator route).
- Camera: extend `QrCameraInput.tsx` with `autoStart` (only when permission is granted) and `continuous` (keep running, debounce the same value 3 s); scanner keeps its own loop for now but uses the same permission/auto-start rules.
- Buttons: operator primary actions `Button size="lg"` (≥ 48 px) / `xl` for the one primary; replace hand-rolled `scanner-tool …` buttons with `Button` variants `light`/`ink`/`danger` where the dark theme allows.
- Chips: `ui/Badge` variants for ticket status (desk `TicketStatusChip`), rating (`RatingChip`), policy chip (`scanner-policy`) — same height 28 px, same radius.
- Dialogs: desk and booth already use `ui/Dialog`; the scanner's conflicts drawer and unpair confirm move to `ui/Dialog`/`ConfirmDialog`.
- Copy: each tool keeps one copy module (`components/scanner/copy.ts`, `components/booth/boothText.ts`, new `components/reception/deskCopy.ts`); no inline `isRtl ? … : …` strings in desk components; shared operator words in `components/operator/operatorCopy.ts`. Digits: Persian digits and Persian time (`۰۹:۳۵`) in fa everywhere (scanner `clockTime`, offline window, counts).
- Directional icons: "next" arrows already use `arrow-right` mirrored by `Icon`; keep. (`logout` already mirrors in RTL.)

Duplicates to consolidate: 3 gate screens → `OperatorGate`; 3 HID paths → `useHidScanner`; 2 camera loops (later); 3 verdict looks → `VerdictBanner`; `UndoToast` → `Toast`; desk `ModeSwitch` stays (organizer only) but moves into the menu.

---

## 5. Device-fit spec

| Tool | Phone 360–414 portrait | Tablet 820×1180 portrait | Kiosk 1180×820 landscape | Desktop 1440 |
|---|---|---|---|---|
| Scanner | Bar 56 · (Entry/Exit 56) · stage = remaining height − 56 · «ورود دستی کد» 56. **No page scroll** (`scrollHeight ≤ innerHeight`). Verdict covers the stage | Bar · toggle · stage 60 vh · last 5 scans | Two columns: stage 60 % full height · right: last 5 scans + queue row. No scroll | Same as kiosk, max-w 1280 |
| Desk | Bar · sticky search · results list; card opens as full-screen sheet with sticky action bar; walk-in sheet | List 40 % · card 60 % (≥ 768) | List 38 % · card 62 %; card action bar sticky at the bottom of the card; **Print/Admit visible without scrolling** | Same, max-w 1440 |
| Booth | Bar · tabs+search+chips (sticky) · list · bottom dock 72 px + safe area; capture = full-height sheet | Same, list max-w 720 centred, dock | Bar with «ثبت لید» button; list 2 columns of cards | Same |

Touch: primary ≥ 48 px, others ≥ 44 px, ≥ 8 px gaps; destructive actions never in the thumb zone next to the primary (unpair/cancel/discard only in menus, always confirmed).
Safe areas: `pt-safe` on bars, `pb-safe` on docks/sheets (already used; keep for the new bar).
Keyboard: no autofocus of text fields on touch devices (`matchMedia('(pointer: coarse)')`), except desk search on ≥ 1024. Scanner manual field `enterkeyhint="go"`, `autocapitalize="none"`, `inputmode="text"`. Desk: `/` focuses search, Esc = «بعدی». Gun input works with any focus on all three tools.
Bright light: verdict colours as today (solid fills); raise small grey text on ink (`text-ink-400` 11–12 px) to `text-ink-200` ≥ 13 px or delete it.
Orientation: manifest `orientation: any` (PWA-1).

---

## 6. Install / PWA

- One manifest per origin (CSP `manifest-src 'self'`): extend PWA-1's launch rewrite (`lib/launchTarget.ts`) to the **last operator tool used on this device**: `localStorage.congress_operator_launch = {kind: 'scan'|'booth'|'desk', path, at}` written by each tool once it is ready (scanner paired, booth loaded, desk signed in). Priority on `/?source=pwa`: paired scanner point (PWA-1) → last booth → last desk → `/`.
- Scanner: offer install **after a successful pairing on Android/desktop Chrome** (beforeinstallprompt) as one dismissible row under the bar: «نصب اسکنر روی صفحهٔ اصلی» + «نصب» + ✕; never while a verdict is showing, never on blocked screens. **iOS Safari: show the hint on the unpaired screen** («ابتدا برنامه را به صفحهٔ اصلی اضافه کنید، سپس کد QR اتصال را داخل برنامه اسکن کنید») because pairing must happen inside the installed app (F-S1). In standalone mode: no hint.
- Booth: offer after the first successful capture (phones only), same row component; dismiss remembered.
- Desk: do not prompt (laptop/tablet in a browser with a printer; printing from standalone works but kiosk mode is set up by staff). Launch target still recorded.
- Never prompt on: sign-in screens (except iOS scanner pairing), gates, archived booths/desks.
- Wake lock: scanner whenever the live screen is visible; booth while the capture sheet is open; desk while signed in. Re-acquire on `visibilitychange`; scanner also restarts a dead camera track on return.
- Update: on operator routes `AppUpdatePrompt` is replaced by the `StatusPill` "update" state + menu item «نسخهٔ تازه · بارگذاری»; the scanner applies it only when `pendingCount === 0` and no verdict is up (otherwise the item says «پس از ارسال صف»).

---

## 7. Work packages (non-overlapping files, ordered)

Order: **P0 (parallel): WP-A, WP-B, WP-C** → **P1 (parallel): WP-D, WP-E, WP-F** → **P2: WP-G**.

### WP-A Operator shell components (P0)
Files (new unless noted): `web/src/components/operator/{OperatorBar,StatusPill,OperatorMenu,OperatorGate,VerdictBanner,InstallRow,operatorCopy}.tsx|ts`, `web/src/components/ui/Toast.tsx`, `web/src/styles/operator.css`, `web/tests/operatorCopy.test.ts`.
Acceptance: unit tests for `StatusPill` state mapping; Storybook-free Playwright smoke page not needed — checked in WP-D/E/F. `npm run lint && npm run build && npm test` pass.

### WP-B Device hooks + camera (P0)
Files: `web/src/hooks/{useWakeLock,useHidScanner,useOperatorLaunch}.ts` (new), `web/src/components/attendee/QrFullscreen.tsx` (use `useWakeLock`), `web/src/components/QrCameraInput.tsx` (`autoStart`, `continuous`, «کد QR» wording), `web/src/lib/launchTarget.ts` + `web/src/lib/pwaRegistration.ts` + `web/pwa-manifest.ts` + `web/vite.config.ts` (after PWA-1 merges; else take PWA-1's commits), `web/src/components/AppUpdatePrompt.tsx` (hidden on `/scan`, `/booth`, `/reception`; exports `useAppUpdate`), tests `web/tests/{hidScanner,launchTarget,wakeLock}.test.ts`.
Acceptance: unit — burst of ≥ 8 keys at < 60 ms + Enter resolves a code and calls `preventDefault` on each key; slow typing passes through. `launchTarget` picks booth/desk paths. Playwright — `/c/<slug>/my-ticket` full-screen QR still requests wake lock (mock `navigator.wakeLock`).

### WP-C Backend: booth archived flag (P0)
Files: `backend/app/routes/booths.py` (BoothOut adds `event_archived: bool`), `backend/tests/test_booths*.py`, `web/src/api/schema.d.ts` (regenerated). No migration.
Acceptance: `GET /api/booths/{id}` returns `event_archived=true` for an archived event; `npm run gen:api` clean.

### WP-D Scanner (P1, needs A+B)
Files: `web/src/pages/GateScanner.tsx`, `web/src/components/scanner/*` (delete `BufferBar` part of `ScanLog.tsx`, `DeviceSettings.tsx` → menu content, `ScannerChrome.tsx` setup parts removed), `web/src/styles/scanner.css`, `web/e2e/*scanner*.spec.ts`.
Scope: §3.1, §3.2 (incl. «اسکن کد QR اتصال» via `QrCameraInput` reading the pairing URL, point id must match), wake lock + camera restart, remembered camera auto-start (`localStorage congress_scanner_camera_<point>`), fa digits/time, verdict copy table, iOS pairing hint, install row, update gating.
Acceptance (Playwright, fa + en):
- 390×844 and 1180×820: `document.documentElement.scrollHeight <= innerHeight` on the live screen.
- Admitted verdict: `.scanner-takeover` contains exactly one of «مجاز|Admit», font-size of title ≥ 44 px (phone) / ≥ 64 px (kiosk); no text matching `/بلیت|سطح دسترسی/`.
- Duplicate shows «تکراری» and the name, and no «رد شد» eyebrow.
- Unpaired: button «اسکن کد QR اتصال» exists; no element with `lang="en"` visible in fa outside «جزئیات».
- No visible text matching `/[0-9]{2}:[0-9]{2}/` in fa (Persian digits expected).
- Menu contains «قطع اتصال دستگاه»; the live page has no unpair button.
- Wake lock requested (stub `navigator.wakeLock.request`) after load.
- Screenshots: `scan-ready`, `scan-v-admitted|duplicate|provisional|exit|capacity`, `scan-unpaired`, `scan-revoked` at m/s/t/k.

### WP-E Desk (P1, needs A+B)
Files: `web/src/pages/ReceptionPortal.tsx`, `web/src/pages/OrganizerDesk.tsx`, `web/src/components/reception/*` (new `deskCopy.ts`; `WalkInForm` → dialog; `ReceptionPass` only in minted dialog fallback), `web/src/styles/reception.css`, `web/src/lib/deskBadge.ts`, `web/e2e/reception-portal.spec.ts`, `web/e2e/desk-completion.spec.ts`.
Scope: §3.3, §3.4, `useHidScanner` at station level (F-D1), last admit point, times in history, archived/offline pills.
Acceptance:
- **F-D1 regression**: focus the walk-in name field (dialog open) or the card heading, type a 26-char code at 4 ms/key + Enter → no `POST /desk-registrations`; the scanned attendee's card opens.
- 1180×820: after Enter on a search, the Print (or Admit) button's bounding box is inside the viewport.
- 390×844: card opens as a sheet; Print visible without scrolling.
- Walk-in tier options show seats left; a full tier is `disabled`.
- Scan history entries match `/[۰-۹]{2}:[۰-۹]{2}/` in fa.
- No text «پاکسازی فرم», «Pass ID», «01», «02», «03» on the station.
- Archived: no walk-in button, no action bar, pill «بایگانی‌شده».

### WP-F Booth (P1, needs A+B+C)
Files: `web/src/pages/ExhibitorPortal.tsx`, `web/src/components/booth/*` (`UndoToast` replaced by `ui/Toast`; `LeadMonogram` deleted), `web/src/styles/exhibitor.css`, `web/src/lib/lead*.ts` (only if queue display needs a masked code helper), `web/e2e/exhibitor*.spec.ts`.
Scope: §3.5–3.8, page-level `useHidScanner` (burst with no sheet open → capture directly), camera auto-start + auto-save, masked secret, archived from `event_archived`, wake lock in capture sheet, install row after first capture, launch target.
Acceptance:
- 390×844: first lead card `top < 400`; offline pill visible in the bar when `context.setOffline(true)`.
- Capture by gun with no dialog open: one `POST /leads/scan`, result sheet shows «لید جدید»; total taps for a camera capture = 1 (open) when permission granted (decode stubbed via `onDecode`).
- Capture sheet on a touch viewport (`hasTouch: true`): `document.activeElement` is not an input after opening.
- Pending queue rows never contain the full secret (`/qrsecret[a-z0-9]{8,}/` absent).
- `event_archived=true`: no capture dock/button, pill «بایگانی‌شده».
- No text «(Rating)», «(CSV)», «کیوآر».

### WP-G Glossary + cleanup (P2, coordinate with GLOSS-2/A11Y-1)
Files: `web/src/lib/i18n.ts` (remove keys no longer used by ops: `deskSubtitle`, `nextAttendeeAction`, `mintBadgeAction`, `statusConfirmedAdmitted`… and fix `tierLabel` → «نوع کارت ورود»), `web/tests/glossary.test.ts` (ban «بلیت», «سطح دسترسی و جایگاه», «کیوآر» in fa).
Acceptance: `npm test` glossary passes; `rg "isRtl \?" web/src/components/reception` returns nothing.

---

## Open questions for the product owner
1. Desk session is `sessionStorage` (closing the tab = new SMS code). Keep, or allow a 12-hour desk session on a trusted kiosk?
2. «لید» stays as the Persian word for a captured visitor? (Used across booth UI and tests.)
3. Should the scanner auto-dismiss an *admitted* verdict faster (1.0 s) in long queues? Today 1.5 s / 3 s.
