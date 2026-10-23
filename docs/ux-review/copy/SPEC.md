# UX-COPY — copy minimalism, terminology, i18n completeness (spec + copy deck)

Reviewer id: `copy`. Base `b980385` (`integration/upgrade`) plus the copy on `ws/webfix1-public-attendee`,
`ws/webfix2-console`, `ws/b6b-exhibitor`, `ws/c2-desk`, `origin/ws/team2-pwa1-pwa-settings` (merged view:
`…/ux-review/copy/merged/web/src`, built from b980385 with each branch's changed files laid on top).
Screenshots (Persian, 390×844, mock API, base ref): `/private/tmp/claude-501/-Users-mahdi-AITeb-Congress/e0633dca-6f77-4db9-8d0d-5bfdf63eb3a9/scratchpad/ux-review/copy/harness/shots/` (named `<screen>-fa-m[-sN].png`, written `shots/…` below).
Raw data: `copy/inline.tsv` (every inline `isRtl ? fa : en` pair with file:line, 1,105 rows), `copy/deadkeys.txt`.
Review and specification only; no repo file was changed.

---

## 0. Measurements (merged view)

| Area | Persian string literals | Persian words | strings > 20 words | files |
|---|---:|---:|---:|---:|
| Organizer console (incl. Page Studio, participants) | 1,042 | 5,256 | 33 | 35 |
| Legacy dictionary `lib/i18n.ts` | 371 | 2,073 | 7 | 1 |
| Attendee | 384 | 2,002 | 2 | 23 |
| Public (home, congress page, booth page) | 325 | 1,893 | 22 | 7 |
| Gate scanner | 224 | 1,532 | 20 | 6 |
| Platform admin | 204 | 1,026 | 5 | 5 |
| Reception desk | 165 | 1,003 | 1 | 11 |
| Error messages | 91 | 981 | 1 | 1 |
| Booth (exhibitor) | 121 | 796 | 5 | 6 |
| SMS screens | 80 | 448 | 2 | 2 |
| **Total** | **≈3,000** | **≈17,000** | **98** | |

Mechanisms in use (all at once, often in the same file):

| # | Mechanism | Size | Where |
|---|---|---|---|
| A | Monolithic dictionary `translations` in `lib/i18n.ts`, read as `t.key` | 372 keys; **66 unreferenced** (`copy/deadkeys.txt`); ~45 of the live keys still carry banned terms («رده»، «گیت»، «بلیت»، «توکن»، «Slug») | organizer pages, analytics, scanner verdicts, desk, link pass |
| B | Typed per-area copy modules `{ fa, en }` | `public/copy.ts`, `public/homeCopy.ts`, `attendee/attendeeCopy.ts` (5 objects), `studio/studioCopy.ts`, `scanner/copy.ts`, `booth/boothText.ts`, `lib/participants.ts`, `lib/organizerConsole.ts`, `lib/errorMessages.ts` + local `COPY = {fa,en}` objects at the top of `MobileOtpForm`, `AttendeeSignIn`, `Me`, `MyTickets`, `AttendeeLayout`, `InstallHint` | public, attendee, studio, scanner, booth |
| C | Inline ternaries `isRtl ? "…" : "…"` | **1,105** pairs in ≈60 files (top: `PlatformSms` 71, `OrganizerPanel` 57, `ScannerPairingDialog` 41, `OrganizerVenue` 41, `DeskActions` 37, `TimetableImport` 35, `PlatformOrganizers` 35) | organizer, desk, platform, SMS |
| D | Ad-hoc pairs: `{fa, en}` objects nested inside the `fa` branch (scanner `BiLabel`), `[fa, en]` tuples (activity log) | ~25 | scanner, activity |

Locale state is also split: `useAttendeeLocale` (17 files) and `usePublicLocale` (4 files) each keep their own React
state over the same storage key; organizer screens get `locale/isRtl/t` as props. Two different exports are both named
`homeCopy` (`public/homeCopy.ts` and `attendee/attendeeCopy.ts`).

Inline-string quality: 35 inline Persian strings exceed 200 characters, 74 more exceed 120 (list: `awk -F'\t' 'length($3)>120' copy/inline.tsv`).
Most duplicated inline strings: «انصراف» ×28, «بستن پیام» ×8, «در حال ذخیره…» ×7, «اتصال به سرور برقرار نشد.» ×6, «پنل مدیریت سامانه» ×6.

Competing variants of the same word (whole merged tree): «تلاش دوباره» 24 vs «تلاش مجدد» 5 · «پیوند» 36 vs «لینک» 14 ·
«بارگذاری» 75 vs «بارگیری» 6 · «جستجو» 31 vs «جست‌وجو» 8 · «تأیید» 28 vs «تایید» 3 · «لید» 131 vs «سرنخ» 11 ·
«کنسول» 18 / «پنل» 39 / «پیشخوان» 3 / «پرتال» 6 / «پورتال» 6 / «درگاه» 5 for the same portal idea · «لغو» vs «ابطال» 19 ·
bureaucratic forms «نمایید» 8, «جهت» 7, «گردید» 2, «لطفاً» 14, «با موفقیت» 5, ASCII "..." in 16 Persian strings, "✓" prefixes 9.

Banned glossary terms still shipped (base, as words): «رده» 31 lines (i18n.ts 26, `SmsTemplateEditor.tsx:17`, `ReceptionStation.tsx:1023`, `homeCopy.ts` 4),
«نشست» 25 lines in 12 files (program sessions *and* sign-in sessions), «گیت» 51 lines in 6 files, «بلیت» 51 lines in 11 files (mostly avoidable).
English leaking into the Persian UI found by rendering (harness LATIN check): see findings F2–F6.

---

## 1. Persona / scenario inventory (copy lens)

| Persona | Paths (incl. edge cases) | What the copy must let them do — and nothing more |
|---|---|---|
| Public visitor | `/` home → congress list → `/e/:slug` → choose pass type → OTP sheet → success; booth page; 404 congress/booth; registration not open / closed / full / sales ended; API down; preview-disabled | Know what the congress is, when/where, pick a pass type, confirm the mobile number. Status words for closed/full/opens-at. |
| Attendee | `/me` (signed in, empty, signed out), `/c/:slug/*` tabs (home, program, network, pass, profile), SMS short link `/t/:code` (ok, expired, invalid, throttled, offline), offline pass, self-cancel, account delete/export, install hint, bookmark booth via standee QR | Show the pass, find sessions, add a contact, change own details. One instruction per screen. |
| Booth staff | invite SMS → `/booth/:id` sign-in → capture lead (camera/USB/typed), rating/tags/notes, list/search/export, trash/undo, offline queue, removed/suspended/archived | Scan, rate, export. No explanation of how storage works unless it failed. |
| Desk operator | invite SMS → `/reception/:eventId` (or code entry) → OTP → search/scan → card (admit at point, print, reprint flag, resend SMS, edit, transfer, reissue, cancel) → desk registration (duplicate number, cancelled-then-restored) → archived; organizer mode | Find person, act, next person. Every outcome as one short line. |
| Gate scanner operator | pairing link/QR → `/scan/:pointId` idle → verdict takeover (admitted / provisional / duplicate / rejected reasons) → exit mode → offline window, stale list, other tab, storage failed, unpair, revoked/expired/forbidden, discard unsynced | Big verdict words; one-line reason; what to do now. No protocol vocabulary. |
| Organizer member (owner/manager/staff/viewer) | sign-in (mobile / key), org chooser, events list/create, overview, pass types, check-in points + pairing, booths + staff + standee QR, operators, program/import/files, venue, participant panel preview, Page Studio, participants (edit/cancel/reissue/transfer/delete), analytics, SMS, members, activity, archive/delete; role-limited read-only states | Labels, one confirm sentence per destructive action, empty states with the one next action. |
| Platform admin (technical) | `/platform` token gate, SMS gateway + templates + caps, sign-in rules, organizers (create/rotate/suspend), members drawer | May see technical terms (sms.ir, `.env`, API key, CIDR) — but short. |

---

## 2. Findings (ranked)

Paths are under `web/src/` of the merged view unless stated; shots under `copy/harness/shots/`.

### Critical
- **F1 — Scanner verdict reasons use banned and technical words on the screen the gate operator must read in one second.**
  `lib/i18n.ts:372-378` (consumed by `components/scanner/copy.ts:380+`): «بلیت قبلاً مصرف شده است (ورود تکراری)», «رده بلیت مجاز به ورود از این گیت نیست»,
  «کد در حافظه آفلاین گیت یافت نشد (نیاز به استعلام آنلاین یا میز پذیرش)», «تداخل در شناسه اسکن با گیت دیگر». Parentheses and protocol terms on a takeover screen
  slow the decision. Deck §4.6.
- **F2 — Unknown/uncoded errors show raw English in the Persian UI.** `api/client.ts:336-342` falls back to the English `detail` (and to
  "An unexpected error occurred."). Rendered: `shots/org-overview-error-fa-m.png` ("Internal Server Error"), `shots/my-network-fa-m.png` ("Not found").
  Backend codes with no localized message: `SMS_TEMPLATE_INVALID` (`backend/app/routes/sms.py:113`, `platform.py:296`; its detail is the English
  `TemplateError` text "shown to the organizer as is", `backend/app/sms/templates.py:93-110`), `TRUSTED_NETWORK_INVALID`.
  `ScannerPairingDialog.tsx:75,114,150` interpolates `formatApiError(...)` (English) into Persian sentences.
- **F3 — Developer vocabulary on non-technical screens.** Organizer sign-in: «کلید API», «نشست ورود… (SessionStorage)» (`OrganizerKeyGate.tsx:186,202`; `shots/org-gate-fa-m.png`);
  event form «شناسه اینترنتی اختصاصی (Slug)», «(اسلاگ)» (`i18n.ts:101,113,206`, `EventEditDialog.tsx:160`); pairing «این کنسول از آدرس localhost باز شده…» (`ScannerPairingDialog.tsx:184`);
  scanner «توکن» ×12, «HTTP ${status}», «Tracking ID», bilingual placeholder «توکن دستگاه را اینجا بچسبانید — Paste device scanner token...» (`scanner/copy.ts:39,56,98,114-154`; `shots/scan-fa-m.png`);
  check-in form «یکپارچگی مانیفست» (`CheckInPointFormDialog.tsx:213`); activity log raw path segments «events › participants», «checkin-points › token», «API key», «افزوده‌شده به دست api-key»
  (`shots/org-activity-fa-m.png`, `shots/org-members-fa-m.png`; largely fixed on `ws/webfix2-console`, keep the fix); profile «یک فایل JSON…» (`attendeeCopy.ts:322`).

### High
- **F4 — The decided glossary is not applied (see §0 counts).** «رده»/«بلیت»/«گیت بازرسی» in organizer tabs and forms (`i18n.ts:128-196`), participants
  («نوع بلیت», «لغو بلیت», «انتقال بلیت», `lib/participants.ts:72-152`), SMS editor (`SmsTemplateEditor.tsx:17`), desk (`ReceptionStation.tsx:1023`), SMS default
  `ticket_cancelled` («بلیت شما … لغو شد», `backend/app/sms/templates.py`), errors (`TICKET_*`, `EVENT_HAS_TICKETS`, `PARTICIPANT_HAS_HISTORY`).
  «نشست» is used for *both* program sessions (`public/copy.ts` errSession*, `attendeeCopy.ts:211`) and sign-in sessions (`errorMessages.ts TOKEN_EXPIRED`,
  `OrganizerKeyGate.tsx:145`, `DeskAuthGate`, `ModeSwitch.tsx:21`, `organizerConsole.ts:341,344`, `EventOperators.tsx:200,230`, `MyTickets.tsx:26`).
- **F5 — Marketing and architecture text on task screens.** Home renders ≈1,900 Persian words: six "environments", three lifecycle phases, three
  "venue engineering" principles, «چندمستأجری», «کلید API», «vCard», «بارکدخوان USB» (`public/homeCopy.ts`, all keys rendered by `pages/Home.tsx`;
  `shots/home-fa-m*.png`). The congress page adds «کارت ورود شما شامل» with four feature cards («نشان پرکنتراست برای پذیرش سریع در گیت‌های ورود») (`public/copy.ts` `includes`).
  Organizer shell: «مدیریت چندمستأجره همایش‌ها», «دسترسی تفکیک‌شده برای هر سازمان برگزارکننده», hero «همهٔ همایش‌های شما، در یک فضای کاری دقیق.»
  (`OrganizerLayout.tsx:272,432`; `OrganizerKeyGate`). Booth: «جمع‌آوری لیدهای تجاری، تعیین سطح تمایل و دریافت فهرست لیدها در قالب CSV» (`i18n.ts exhibitorPortalDesc`; `shots/exhibitor-fa-m.png`).
- **F6 — English inside Persian strings and labels.** «ثبت‌نام و پذیرش حضوری (Walk-In)» (`i18n.ts walkInRegistrationHeading`; `shots/org-desk-fa-m.png`),
  «سطح تمایل تجاری (Rating)», «علاقه زیاد (Hot)», «کلید دسترسی (API Key)», «Add to Home Screen» in the install checklist (`attendeeCopy.ts:41`; `shots/my-congress-fa-m.png`),
  scanner `BiLabel` shows English beside Persian by design (`scanner/copy.ts:4-8`, 13 labels), platform chip "production" (`shots/platform-*.png`).
- **F7 — Explanations that restate the control or the state.** 109 inline strings > 120 characters. Worst: CSV import help 609 chars (`TimetableImport.tsx:182`),
  SMS page footnote 420 (`OrganizerSms.tsx:223`), archive confirm 393 (`EventSettingsPanel.tsx:180`), platform organizers intro 369 (`PlatformOrganizers.tsx:127`),
  panel preview intro 356 (`OrganizerPanel.tsx:479`), booth delete 356 (`EventBooths.tsx:179`), files 335 (`ScheduleFilesManager.tsx:219`), scanner unpair
  explanations 5 × ~250 (`scanner/copy.ts:82-102`), desk duplicate-safe retry 223 (`ReceptionStation.tsx:342`). Many restate a label («زمان‌های این فرم… به این وقت خوانده می‌شوند»
  under «منطقهٔ زمانی همایش», `OrganizerEvents.tsx:399`) or repeat the dialog title (`MintedDialog.tsx:28`, `editTierDesc`, `editPointDesc`, `createBoothModalDesc`).
- **F8 — One portal, five names.** Organizer area: «کنسول مدیریت همایش», «کنسول برگزارکننده», «پنل برگزارکننده», «پیشخوان مدیریت», «فضای کاری برگزارکننده».
  Booth: «پیشخوان غرفه», «پرتال تجاری غرفه و لیدها», «پورتال غرفه», «پنل غرفه», «فضای کاری غرفه». Desk: «میز پذیرش», «ایستگاه پذیرش», «ایستگاه اپراتور»,
  «میز پذیرش و صدور آنی کارت همایش». Organizer key: «کلید API», «کلید سازمان», «کلید مدیر», «کلید مدیر ارشد», «حالت مدیر» (en "Organizer key").

### Medium
- **F9 — Inconsistent action/status verbs.** Cancel dialog «انصراف» vs domain «لغو» vs «ابطال»; «بله، لغو شود / نه، نگه دار» (`MyTickets.tsx:42-43`);
  status «لغوشده» / «لغو شده» / «باطل‌شده» (`ReceptionStation.tsx:687-688`); «تلاش مجدد» vs «تلاش دوباره»; success with «✓» and «با موفقیت».
- **F10 — String concatenation that breaks in RTL / other word orders.** `ResendPassSms.tsx:62` «لینک کارت دوباره پیامک شد به » + number;
  `MintedDialog.tsx:61`; `ReceptionPortal.tsx:219-221` («همان بخش پس از » + `/e/` + « در نشانی…»); scanner `windowLeadLabel`+value+`windowLeftTail`,
  `bufferLead`/`bufferTail` (`scanner/copy.ts:30-31,63-64`); `ScannerPairingDialog.tsx:222,282,302,304` label-colon fragments.
- **F11 — Latin digits in Persian.** Scanner header counts («1 کارت در حافظه», «0 در صف», `ScannerHeader.tsx:104,149`; `shots/scan-fa-m.png`).
- **F12 — Duplicated install instructions** (`attendeeCopy.ts:39-43` and `InstallHint.tsx:15-19`, different wording) and duplicated messages
  (operators hint `EventOperators.tsx:97` and `:200`; archive text `EventSettingsPanel.tsx:180` and `:217`; desk wrong-code `ReceptionStation.tsx:260` vs `MobileOtpForm codeInvalid` vs `OTP_CODE_INVALID`).
- **F13 — en side inconsistent**: "Event"/"Congress"/"Conference"; "Program"/"Programme"; "ticket tier"/"pass type"/"ticket type"; "Scanner stations" for check-in points
  (`EventOverview.tsx:141`); "Sold Out"/"Fully Booked"/"Full".

### Low
- **F14 — 66 dead dictionary keys** still translated and reviewed (`copy/deadkeys.txt`: network/privacy block, old scanner `token*`, `hidScanHint`, `fastActionsHeading` …).
- **F15 — Bureaucratic register**: «نمایید», «گردیده», «جهت حفظ», «کلیه», «در صورت» (e.g. `i18n.ts:83,87`, `OrganizerKeyGate.tsx:202`, `ReceptionStation.tsx:556`).
- **F16 — ASCII "..."** in 16 Persian strings (`AttendeeCard.tsx:55`, `AttendeeSearch.tsx:62`, `WalkInForm.tsx:89`, `ReceptionPortal.tsx:133`, `ResendPassSms.tsx:94`…).
- **F17 — Two spellings of ezafe** («صفحه اصلی» 9 vs «صفحهٔ اصلی» 8; «برنامه جلسات» vs «برنامهٔ همایش»).

---

## 3. Voice, terminology and patterns (the rules every deck entry follows)

### 3.1 Voice
- Persian: short, polite, direct. Plural imperative (`کنید`), no «لطفاً», no «نمایید/گردید/جهت/می‌باشد/کلیه/در صورت».
  One sentence per hint, ≤ 12 words; no parentheses with English; no "(اختیاری)" in hints when the label already says it.
- A hint exists only if it adds a fact the label cannot (a constraint, a consequence). Otherwise DELETE.
- Dialog descriptions: one sentence stating the consequence. Never restate the title.
- Empty state: title (what is missing) + one primary button. No body paragraph unless the action is not obvious.
- English mirrors the Persian meaning and length; sentence case; US spelling ("Program").

### 3.2 Terms (decided + proposed — proposals marked D# need the product owner's yes, see §10)

| Concept | fa | en | Never (fa) |
|---|---|---|---|
| Ticket Tier | نوع کارت ورود / انواع کارت ورود | pass type | رده، رده بلیت، دسته |
| Ticket / pass | کارت ورود | pass | بلیط; «بلیت» only in legal/receipt text |
| Session (program) | جلسه | session | نشست |
| Check-In Point | نقطهٔ ورود / نقطه‌های ورود | check-in point | گیت، گیت بازرسی، ایستگاه، نقطه کنترل |
| QR | کد QR | QR code | transliteration |
| Desk registration | ثبت‌نام حضوری | desk registration | Walk-In |
| Signed-in state (D9) | ورود («زمان ورود شما تمام شده است») | sign-in | نشست |
| Organizer area (D2) | پنل برگزارکننده | organizer console | کنسول، پیشخوان، فضای کاری |
| Booth area (D2) | پنل غرفه | booth panel | پرتال، پورتال، پیشخوان غرفه |
| Desk (D2) | میز پذیرش | reception desk | ایستگاه پذیرش/اپراتور |
| Scanner (D2) | اسکنر نقطهٔ ورود | check-in scanner | اسکنر گیت |
| Attendee area | همایش من | my congress | پنل شرکت‌کننده (for attendees) |
| Platform admin (D2) | مدیریت سامانه | platform admin | پنل مدیریت سامانه (repeated) |
| Organizer key (D4) | کلید سازمان | organizer key | کلید API، کلید مدیر ارشد، حالت مدیر |
| Scanner credential (D8) | پیوند اتصال / کد اتصال | pairing link / pairing code | توکن، کلید، اعتبار |
| Lead (D1) | لید (booth panel only) | lead | سرنخ |
| Bookmark (D5) | ذخیره / غرفه‌های ذخیره‌شده | save / saved booths | نشان کردن («نشان» = badge confusion) |
| Link (D6) | پیوند | link | لینک |
| Admission Policy (D3) | قانون ورود | entry rule | سیاست پذیرش، سیاست اعتبارسنجی |
| Congress | همایش | congress | رویداد، کنگره (in chrome) |
| Slug | نشانی صفحه | page address | Slug، اسلاگ، شناسه اینترنتی |
| Unsynced | ارسال‌نشده | not sent yet | همگام‌نشده |
| Loading / upload / download | در حال بارگذاری… / بارگذاری / دریافت | Loading… / Upload / Download | بارگیری |
| Search | جستجو | search | جست‌وجو |
| Confirm | تأیید | confirm | تایید |
| Export | خروجی اکسل | Export CSV | دریافت فایل اکسل (CSV) |

### 3.3 Verbs
| Intent | fa button | en |
|---|---|---|
| Open a create dialog from a list | «{چیز} جدید» (همایش جدید، نوع کارت ورود جدید، نقطهٔ ورود جدید، غرفهٔ جدید، اپراتور جدید، عضو جدید) | New {thing} |
| Submit create dialog | افزودن | Add |
| Submit edit | ذخیره | Save |
| Dismiss dialog | انصراف | Cancel |
| Close panel/toast | بستن | Close |
| Permanent removal | حذف | Delete |
| Cancel a pass / registration / access | لغو کارت ورود / لغو ثبت‌نام / لغو دسترسی | Cancel pass / Cancel registration / Remove access |
| Record a fact | ثبت (ثبت لید، ثبت ورود، ثبت‌نام حضوری) | Record / Capture |
| Issue | صدور / صدور دوباره | Issue / Reissue |
| Retry | تلاش دوباره | Try again |
| Sign in / out | ورود / خروج | Sign in / Sign out |
| Publish | انتشار / لغو انتشار | Publish / Unpublish |
| Archive | بایگانی / خروج از بایگانی | Archive / Unarchive |
| Send SMS | ارسال / ارسال دوباره | Send / Resend |
Confirm dialogs: title is a question («… حذف شود؟»), confirm button repeats the verb («حذف»), never «بله/تأیید».

### 3.4 Status words (chips)
فعال Active · لغوشده Cancelled · بایگانی‌شده Archived · باز Open · بسته Closed · ظرفیت تکمیل Full · هنوز باز نشده Not open yet ·
مهلت تمام شد Ended · منتشرشده Published · منتشرنشده Not published · پذیرفته شد Admitted · رد شد Rejected · در صف ارسال Waiting to send ·
آنلاین Online · آفلاین Offline · دسترسی لغو شده Access removed. («باطل‌شده»، «لغو شده» with space, «ورود مجاز و تایید شده» → DELETE.)

### 3.5 Messages
- Error: `[what failed, plain]. [one next step].` — «فهرست بارگذاری نشد. دوباره تلاش کنید.» Never show a code, HTTP status, or English detail in fa.
- Success toast: `[object] [past verb].` — «نوع کارت ورود ذخیره شد.» No «✓», no «با موفقیت».
- Values from users or the network (names, mobiles, URLs, codes) go into placeholders of a whole-sentence function and render inside `<bdi>`; never concatenate fragments.
- Persian digits for every number shown in fa (counts, times in sentences); Latin only inside codes/URLs/QR payloads; «…» not "...".

---

## 4. Copy deck

Format: `key or file:line` | current fa → **proposed fa** | proposed en. `DELETE` = remove the string and the element that only carries it.
Entries not listed keep their current text (after the global replacements in §4.0). Line numbers: merged view.

### 4.0 Global replacements (apply in every file of the area you touch)
«رده(ها/ی) بلیت» → «نوع(انواع) کارت ورود» · «بلیت» → «کارت ورود» (except SMS/legal where "ticket" is unavoidable) · «گیت/گیت بازرسی/نقطه کنترل/ایستگاه کنترل تردد» → «نقطهٔ ورود» ·
program «نشست» → «جلسه» · sign-in «نشست» → rephrase with «ورود» · «تلاش مجدد» → «تلاش دوباره» · «لینک» → «پیوند» · «بارگیری» → «بارگذاری» · «جست‌وجو» → «جستجو» ·
«تایید» → «تأیید» · «ابطال» → «لغو دسترسی» · «همگام‌نشده» → «ارسال‌نشده» · «سرنخ» → «لید» (D1) · «نشان کردن» → «ذخیره» (D5) · «...» → «…» · drop «✓ », «با موفقیت», «لطفاً».

### 4.1 Common module (`copy/common.ts`, new — every area imports these instead of re-typing)
| key | fa | en |
|---|---|---|
| save / saving / saved | ذخیره / در حال ذخیره… / ذخیره شد. | Save / Saving… / Saved. |
| add | افزودن | Add |
| cancel | انصراف | Cancel |
| close / dismissMessage | بستن / بستن پیام | Close / Dismiss |
| delete / edit / back | حذف / ویرایش / بازگشت | Delete / Edit / Back |
| retry | تلاش دوباره | Try again |
| loading | در حال بارگذاری… | Loading… |
| loadFailed(thing) | {thing} بارگذاری نشد. | Couldn't load {thing}. |
| network | اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید. | Can't connect. Check your internet and try again. |
| generic (fallback for any uncoded error) | انجام نشد. دوباره تلاش کنید. | That didn't work. Try again. |
| search / clearSearch | جستجو / پاک کردن جستجو | Search / Clear search |
| copy / copied | کپی / کپی شد | Copy / Copied |
| exportCsv / exporting | خروجی اکسل / در حال آماده‌سازی… | Export CSV / Preparing… |
| optional (label suffix) | (اختیاری) | (optional) |
| mobileInvalid | شمارهٔ موبایل درست نیست؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹. | Enter a valid mobile number, e.g. 0912 345 6789. |
| sessionEnded | زمان ورود شما تمام شده است. دوباره وارد شوید. | You've been signed out. Sign in again. |
| languageToggle | English (lang="en") | فارسی (lang="fa") |
| status.* | §3.4 | §3.4 |

### 4.2 Public (portal package: PUBLIC)

**Home — `public/homeCopy.ts`, `pages/Home.tsx`, `layouts/PublicLayout.tsx`** (target ≤ 60 static words)
| key | current → proposed fa | en |
|---|---|---|
| eyebrowLead | سامانهٔ همایش → DELETE | DELETE |
| titleLead + titleAccent | سامانهٔ یکپارچهٔ اجرای / همایش‌های علمی و تخصصی → **همایش‌ها** (one h1) | Congresses |
| lead | (34 words) → **ثبت‌نام، کارت ورود و برنامهٔ همایش‌ها.** | Registration, passes and programs. |
| ctaAttendee | کارت ورود خود را پیدا کنید → **کارت ورود من** (primary) | My pass |
| ctaOrganizer, openOrganizer, openReception | → one quiet row «ورود کارکنان:» **پنل برگزارکننده · میز پذیرش · پنل غرفه** | Staff: Organizer console · Reception desk · Booth panel |
| highlights, panelEyebrow, panelTitle, panelNote, environments[6], rolesEyebrow, rolesTitle, rolesLead, lifecycle*, phases[3], venue*, principles[3], closingTitle, closingLead, myPasses, networkingHub, viewMyPasses | DELETE (all) | DELETE |
| registerTitle + registerBody | → empty state of the list only: **همایشی برای نمایش نیست. پیوند ثبت‌نام را از برگزارکننده بگیرید.** | No congresses listed. Ask the organizer for the registration link. |
| copy.listEyebrow / listLead | DELETE | DELETE |
| copy.listTitle | همایش‌های پیش رو (keep) | Upcoming congresses |
| copy.navCapabilities/navRoles/navArchitecture/menuCapabilities/menuRoles/menuArchitecture | DELETE (anchors disappear with the sections) | DELETE |
| copy.footerCapabilities/footerRoles/footerArchitecture/footerPrivate/platformFooterBody/platformFooterPrivateLead/Tail/platformTagline | DELETE | DELETE |
| copy.footerCongressNote | (2 sentences) → **محتوای همایش را برگزارکنندهٔ آن منتشر می‌کند.** | Content is published by the congress organizer. |
| copy.organizerConsole | پنل برگزارکننده (keep) | Organizer console |
| copy.mainNav/mobileNav/openMenu/closeMenu | keep (a11y) | keep |

**Congress page — `public/copy.ts`, `pages/PublicEvent.tsx`, `components/public/*`** (target ≤ 120 static words besides organizer content)
| key | current → proposed fa | en |
|---|---|---|
| officialRegistration | DELETE | DELETE |
| statusFull / tierStatusSoldOut | ظرفیت تکمیل شد / تکمیل ظرفیت → **ظرفیت تکمیل** | Full |
| sectionIncludes, sectionIncludesEyebrow, includes[4] | DELETE | DELETE |
| sectionPassesEyebrow / passesLead / digitalNote / tierAdmit / tierPassNo / tierLegend | DELETE | DELETE |
| sectionPasses | انتخاب کارت ورود → **نوع کارت ورود** | Pass type |
| tierDefaultDescription | DELETE (show nothing) | DELETE |
| reserve | رزرو رایگان کارت ورود (keep) | Reserve free pass |
| processing / submitting | → **در حال رزرو…** | Reserving… |
| noDescription | DELETE (hide About when empty) | DELETE |
| programLead / exhibitionLead / exhibitionFallback | DELETE (zoneNote already states the time zone) | DELETE |
| activePassTitle / activePassBody | → title only **کارت ورود این همایش را دارید** | You already have a pass |
| dialogDescription(tier) | (21 words) → **کد تأیید به شمارهٔ شما پیامک می‌شود.** | We'll text you a code. |
| submitVerify | تأیید و دریافت کارت ورود (keep) | Verify and get my pass |
| errSessionChanged / errSessionExpired | «نشست شما…» → common.sessionEnded | common |
| successTitle | کارت ورود با موفقیت رزرو شد → **کارت ورود شما آماده است** | Your pass is ready |
| successDescription | DELETE | DELETE |
| successBody | → **این کد QR را در ورودی نشان دهید.** | Show this QR code at the entrance. |
| successSms | → **پیوند کارت ورود را هم پیامک کردیم.** | We also texted you the link. |
| successStay | ماندن در صفحهٔ همایش → **بازگشت به صفحهٔ همایش** | Back to the congress page |
| tierStatusSalesEnded / tierSalesEndedNotice | → **مهلت رزرو تمام شد** / DELETE notice (chip says it) | Ended |
| shareText | → **{name} — ثبت‌نام و کارت ورود رایگان** | {name} — free registration |
| bookmark / bookmarked | نشان‌کردن غرفه → **ذخیرهٔ غرفه** / **ذخیره شد** | Save booth / Saved |
| bookmarkHint / bookmarkedHint | DELETE | DELETE |
| fbSaved / fbRemoved | → **غرفه ذخیره شد.** / **از غرفه‌های ذخیره‌شده حذف شد.** | Booth saved. / Removed from saved booths. |
| fbSessionChanged | → **حساب در زبانهٔ دیگری عوض شد. صفحه را دوباره باز کنید.** | You switched accounts in another tab. Reload this page. |
| fbSessionExpired | → common.sessionEnded | common |
| brochureDownload / brochureMissing / website | → **بروشور** / DELETE (hide button) / **وب‌سایت** | Brochure / — / Website |
| defaultBoothDescription, exhibitionArea, mainFloor | DELETE | DELETE |
| onSiteTitle + onSiteBody | → one line **در غرفه، کد QR کارت ورود خود را نشان دهید.** | At the booth, show your pass QR code. |
| exhibitorBooth / aboutExhibitor | keep | keep |
| notFoundBody / boothNotFoundBody | → **نشانی را بررسی کنید.** | Check the address. |
| en sectionProgram/sectionAgenda | Programme → Program | Program |

### 4.3 Attendee (portal package: ATTENDEE)
| file / key | current → proposed fa | en |
|---|---|---|
| `AttendeeSignIn` title | ورود به سامانه شرکت‌کنندگان → **ورود** | Sign in |
| subtitleGeneric, panelGeneric, panelGenericLead, panelBoothLead | DELETE | DELETE |
| portalAttendee / portalExhibitor | سامانه شرکت‌کنندگان / پرتال غرفه → **همایش من** / **پنل غرفه** | My congress / Booth panel |
| boothTitle / boothSubtitle | → **ورود به پنل غرفه** / **با شماره‌ای وارد شوید که برگزارکننده برای غرفه ثبت کرده است.** | Sign in to the booth panel / Use the number the organizer registered for the booth. |
| noAccountGeneric | → **کارت ورود ندارید؟ از صفحهٔ همایش ثبت‌نام کنید.** | No pass yet? Register on the congress page. |
| `MobileOtpForm` mobileHint | → **کد ورود پیامک می‌شود.** | We'll text you a code. |
| code / codeRequired | کد پیامک‌شده → **کد تأیید** / **کد تأیید را وارد کنید.** | Verification code |
| codeInvalid, expired | → reuse `errorMessages` OTP_CODE_INVALID / SIGN_IN_EXPIRED | same |
| mayStillArrive | → **ممکن است کد با تأخیر برسد. اگر تا یک دقیقه نرسید، دوباره درخواست کنید.** | The code may be late. If it hasn't arrived in a minute, request a new one. |
| profileTitle / profileLead | → **خوش آمدید** / **نام شما روی کارت ورود می‌آید.** | Welcome / Your name appears on your pass. |
| smsFailed / server | drop «لطفاً» | — |
| `Me` lead, staffLead | DELETE | DELETE |
| emptyBody | → **پیوند ثبت‌نام را از برگزارکنندهٔ همایش بگیرید.** | Ask the organizer for the registration link. |
| findBody | → **با شماره‌ای که ثبت‌نام کرده‌اید وارد شوید.** | Sign in with the number you registered with. |
| staffHeading | محل کار شما در همایش‌ها → **محل کار شما** | Where you work |
| openBooth | باز کردن پنل غرفه (keep) | Open booth panel |
| `AttendeeLayout` footer | DELETE (logout dialog already says it) | DELETE |
| `MyTickets` sessionExpired | → **زمان ورود شما تمام شده؛ کارت ذخیره‌شده نمایش داده می‌شود.** | Signed out; showing the saved pass. |
| online | به‌روز و آماده نشان دادن در ورودی → **به‌روز** | Up to date |
| confirmBody(event) | (38 words) → **کد QR این کارت ورود دیگر کار نمی‌کند و جای شما آزاد می‌شود. برگشت‌پذیر نیست.** | The QR code stops working and your place is released. This can't be undone. |
| confirmAction / keepAction | بله، لغو شود / نه، نگه دار → **لغو ثبت‌نام** / **انصراف** | Cancel registration / Keep |
| selfCancelHint | → **تا پیش از آغاز همایش.** | Until the congress starts. |
| `attendeeCopy.homeCopy` installHow/installIos/installAndroid/installWhy, checklistInstall | DELETE — use InstallHint (§8) | DELETE |
| tapForPass / passAtGate | keep one: **این کد QR را در ورودی نشان دهید** | Show this QR code at the entrance |
| thanksBody | → **ارتباط‌ها و فایل‌های برنامه همچنان در دسترس‌اند.** | Your contacts and program files are still here. |
| signInTitle / signInBody / signIn | → **ورود** / **برای دیدن کارت ورود وارد شوید.** / **ورود** | Sign in / Sign in to see your pass. / Sign in |
| `networkCopy` myCodeLead | → **همکارتان این کد را اسکن کند.** | Let your colleague scan this code. |
| codeHint | DELETE | DELETE |
| emptyBody | «نشست‌ها» → **کد QR کارت ورود همکاران را اسکن کنید.** | Scan a colleague's pass QR code. |
| privacyLink | → **نمایش شماره به همکاران را در پروفایل تنظیم کنید.** | Choose who sees your number in Profile. |
| `profileCopy` mobileFixed | → **شمارهٔ ورود شما؛ اینجا تغییر نمی‌کند.** | Your sign-in number; it can't be changed here. |
| updatesPass | → **روی کارت ورود همایش‌های پیش رو هم اعمال می‌شود.** | Also updates passes for upcoming congresses. |
| allCongresses | DELETE | DELETE |
| exportDesc | یک فایل JSON… → **فایلی از همهٔ اطلاعات شما.** | A file with all your data. |
| deleteDialogLead + 4 bullets | keep bullets, lead → **پس از حذف:** | After deletion: |
| `boothCopy` standeeBody / standeeSignInBody | DELETE / DELETE | DELETE |
| standeeTitle / standeeSave | → **ذخیرهٔ این غرفه** (one button) | Save this booth |
| `i18n.ts` link pass: linkPassNote | → **کارت ورود از پیوند پیامک** | Pass from your SMS link |
| linkPassSignInAction | → **ورود برای شبکه و پروفایل** | Sign in for network and profile |
| linkExpiredDesc | → **برای دیدن کارت ورود وارد شوید یا تازه‌ترین پیامک را باز کنید.** | Sign in, or open your latest SMS. |
| notFoundDesc | → **این صفحه پیدا نشد.** + buttons | Page not found. |
| `lib/attendeeSession.ts:23` | «نشست شما در زبانه دیگری تغییر کرد…» → same as fbSessionChanged | same |

### 4.4 Organizer console (portal package: ORGANIZER; split ORG-A setup / ORG-B content as in §9)

Shell, sign-in (`OrganizerLayout.tsx`, `OrganizerKeyGate.tsx`, `OrganizerMemberSignIn.tsx`, `lib/organizerConsole.ts`, `i18n.ts`)
| key / line | current → proposed fa | en |
|---|---|---|
| organizerConsole, Layout:355, KeyGate:60 | کنسول مدیریت همایش / کنسول مدیریت / فضای کاری برگزارکننده → **پنل برگزارکننده** | Organizer console |
| organizerConsoleDesc, KeyGate hero headline | DELETE | DELETE |
| Layout:272, :331, :349, :432 | مدیریت چندمستأجره… / فضای کاری همایش / میز پذیرش با دسترسی مستقل اپراتور / دسترسی تفکیک‌شده… → DELETE | DELETE |
| Layout:383 | حالت مدیر (en "Organizer key") → **با کلید سازمان** | Signed in with organizer key |
| KeyGate:145 | → common.sessionEnded | common |
| KeyGate:186 | کلید API رد شد. لطفاً کلید معتبر وارد کنید. → **کلید سازمان پذیرفته نشد.** | The organizer key was not accepted. |
| KeyGate:202 security notice | DELETE | DELETE |
| mobileTitle / mobileDesc | → **ورود به پنل برگزارکننده** / **با شماره‌ای که مالک سازمان ثبت کرده است.** | Sign in / With the number your organization's owner added. |
| keyTab / keyHint | کلید API / … → link-style secondary «**ورود با کلید سازمان**», hint DELETE | Use organizer key |
| apiKeyGate*, apiKeyLabel, apiKeyPlaceholder, apiKeyRequired, apiKeySubmit | → **کلید سازمان** / **کلید سازمان را وارد کنید.** / **ورود** | Organizer key |
| chooseDesc | → **سازمان را انتخاب کنید.** | Choose an organization. |
| membersDesc | → **هر عضو با شمارهٔ موبایل خود وارد می‌شود و به اندازهٔ نقشش دسترسی دارد.** | Each member signs in with their own number and sees what their role allows. |
| inviteDesc | → **نشانی پنل به این شماره پیامک می‌شود.** | We'll text them the console link. |
| removed(name) / removeDesc(name) | «…نشست‌هایش بسته شد» → **{name} حذف شد.** / **{name} دیگر نمی‌تواند وارد شود.** | {name} removed. / {name} can no longer sign in. |
| noMembersBody | → **اعضا را اضافه کنید تا هر کس با شمارهٔ خودش وارد شود.** | Add members so everyone signs in with their own number. |
| activityDesc | → **چه کسی، چه زمانی، چه کاری کرد.** | Who did what, and when. |
| activity actor organizer_key / "organizer.key_rotated" | کلید API → **کلید سازمان** | organizer key |
| loadFailed / activityLoadFailed / loading | «بارگیری» → «بارگذاری» | — |

Events list and congress form (`OrganizerEvents.tsx`, `EventEditDialog.tsx`, `EventSettingsPanel.tsx`, `i18n.ts`)
| key / line | current → proposed fa | en |
|---|---|---|
| eventsListHeading / eventsListSubheading | مدیریت همایش‌ها و کنگره‌ها / … → **همایش‌ها** / DELETE | Congresses |
| createEventButton / createEventModalTitle / createEventModalDesc | → **همایش جدید** / **همایش جدید** / DELETE | New congress |
| eventNameLabel | عنوان رسمی همایش → **نام همایش** | Congress name |
| eventSlugLabel / eventSlugHint | → **نشانی صفحه** (show the `…/e/` prefix before the input) / **حروف کوچک انگلیسی، عدد و خط تیره** | Page address / Lowercase letters, digits and hyphens |
| startsAtLabel / endsAtLabel / locationLabel / descriptionLabel | → **آغاز** / **پایان** / **محل برگزاری** / **توضیحات** | Starts / Ends / Venue / Description |
| saveEventAction | ثبت و ایجاد همایش → **افزودن** | Add |
| noEventsFoundTitle / noEventsFoundDesc | → **هنوز همایشی ندارید** / DELETE | No congresses yet |
| manageEventAction | مدیریت و تنظیمات → **مدیریت** | Manage |
| OrganizerEvents:399 tz hint | DELETE | DELETE |
| OrganizerEvents:442 | «…بلیت رزرو کنند. بازهٔ ثبت‌نام اختیاری است.» → **رزرو پس از انتشار صفحهٔ همایش باز می‌شود.** | Reservations open once the page is published. |
| OrganizerEvents:471 placeholder | DELETE | DELETE |
| editEventTitle / editEventDesc | → **ویرایش همایش** / DELETE | Edit congress |
| EventEditDialog:133 | DELETE (label shows the zone) | DELETE |
| EventEditDialog:160 | → **نشانی صفحه پس از ساخت تغییر نمی‌کند.** | The page address can't change. |
| EventEditDialog:215 | → **رزرو تازه پذیرفته نمی‌شود؛ کارت‌های صادرشده معتبر می‌مانند.** | No new reservations; issued passes stay valid. |
| EventEditDialog:243 | → **نمایش در فهرست صفحهٔ اصلی** (toggle label only) | Show on the home page list |
| EventSettingsPanel:166/:169 | → **فقط همایشی که کارت ورود صادر نکرده حذف می‌شود.** (one line, shown only when relevant) | Only a congress with no passes can be deleted. |
| EventSettingsPanel:180 archive confirm | → **صفحهٔ همایش از دسترس خارج و تنظیمات فقط‌خواندنی می‌شود. داده‌ها می‌مانند.** | The page goes offline and settings become read-only. Data is kept. |
| EventSettingsPanel:197 delete confirm | → **«{name}» و همهٔ داده‌هایش برای همیشه حذف می‌شود.** | “{name}” and all its data will be deleted permanently. |
| EventSettingsPanel:217 | DELETE (duplicate of :180) | DELETE |

Overview and tabs (`EventOverview.tsx`, `i18n.ts`)
| key / line | proposed fa | en |
|---|---|---|
| tabOverview / tabTiers / tabPoints / tabBooths / tabOperators / tabProgram / tabVenue / tabPanel | نمای کلی / **انواع کارت ورود** / **نقطه‌های ورود** / **غرفه‌ها** / **اپراتورها** / **برنامه** / **محل برگزاری** / **نمای شرکت‌کننده** | Overview / Pass types / Check-in points / Booths / Operators / Program / Venue / Attendee view |
| EventOverview:126 | → **این همایش بایگانی شده و فقط‌خواندنی است.** + button خروج از بایگانی | Archived (read-only). |
| EventOverview:141 en | Scanner stations → Check-in points | — |
| EventOverview:186 | → **هنوز نوع کارت ورودی ندارید؛ بدون آن ثبت‌نام ممکن نیست.** | No pass types yet; registration needs one. |
| EventOverview:269 | DELETE | DELETE |
| EventOverview:217/223/226 | → **رزروشده** / **پر** / **خالی** | reserved / filled / open |

Pass types (`EventTiers.tsx`, `TierFormDialog.tsx`, `i18n.ts`)
| key / line | proposed fa | en |
|---|---|---|
| tiersHeading / tiersDesc | **انواع کارت ورود** / DELETE | Pass types |
| createTierButton / createTierModalTitle / createTierModalDesc | **نوع کارت ورود جدید** ×2 / DELETE | New pass type |
| tierNameLabel / tierQuotaLabel / tierDescriptionLabel / tierIsOpenLabel | **نام** / **ظرفیت** / **توضیحات (اختیاری)** / **ثبت‌نام باز است** | Name / Capacity / Description (optional) / Registration open |
| saveTierAction | **افزودن** | Add |
| editTierAction / editTierTitle / editTierDesc | **ویرایش** / **ویرایش نوع کارت ورود** / DELETE | Edit / Edit pass type |
| tierStatusLabel / tierOpenOption / tierClosedOption | **وضعیت ثبت‌نام** / **باز** / **بسته** | Registration / Open / Closed |
| noTiersTitle | **هنوز نوع کارت ورودی ندارید** | No pass types yet |
| EventTiers:143 / :149 | فروش: / شناسه: → **رزرو:** / DELETE | Reservations: / — |
| EventTiers:240 | → title **«{name}» حذف شود؟**, body **نوعی که رزرو دارد حذف نمی‌شود؛ ثبت‌نامش را ببندید.** | Delete “{name}”? / A type with reservations can't be deleted; close it instead. |
| EventTiers:262 | → **رزرو تازه پذیرفته نمی‌شود؛ کارت‌های صادرشده معتبر می‌مانند.** | No new reservations; issued passes stay valid. |
| TierFormDialog:250 | → **خالی یعنی بدون محدودیت.** | Empty means no limit. |
| TierFormDialog:283 | → **رزرو تازه پذیرفته نمی‌شود؛ رزروهای قبلی می‌مانند.** | No new reservations; existing ones stay. |

Check-in points and pairing (`EventCheckIn.tsx`, `CheckInPointFormDialog.tsx`, `ScannerPairingDialog.tsx`, `i18n.ts`)
| key / line | proposed fa | en |
|---|---|---|
| pointsHeading / pointsDesc | **نقطه‌های ورود** / DELETE | Check-in points |
| createPointButton / createPointModalTitle / createPointModalDesc | **نقطهٔ ورود جدید** ×2 / DELETE | New check-in point |
| pointNameLabel / pointLocationLabel / policyTypeLabel / maxCapacityLabel / allowedTiersLabel | **نام** / **مکان** / **قانون ورود** / **ظرفیت (اختیاری)** / **انواع کارت ورود مجاز** | Name / Location / Entry rule / Capacity (optional) / Allowed pass types |
| savePointAction / openScannerAction / noPointsTitle | **افزودن** / **باز کردن اسکنر** / **هنوز نقطهٔ ورودی ندارید** | Add / Open scanner / No check-in points yet |
| policySingleUse / Desc | **یک‌بار** / **مثلاً ناهار یا هدیه** | Once / e.g. lunch or a gift |
| policyMultiEntry / Desc | **ورود مکرر** / **مثلاً در اصلی** | Re-entry / e.g. main door |
| policyTierRestricted / Desc | **فقط انواع انتخاب‌شده** / **مثلاً سالن ویژه** | Selected pass types / e.g. VIP hall |
| policyCapacityCapped / Desc | **سقف ظرفیت** / **پس از تکمیل، ورود رد می‌شود.** | Capacity cap / Refused when full. |
| editPointAction / editPointTitle / editPointDesc | **ویرایش** / **ویرایش نقطهٔ ورود** / DELETE | Edit |
| policyLockedNotice, CheckInPointFormDialog:213 | → **پس از نخستین اسکن، قانون ورود قفل می‌شود.** | The entry rule locks after the first scan. |
| CheckInPointFormDialog:233 | → **خالی یعنی همهٔ انواع.** | Empty means all types. |
| :302 / :314 / :350 | → **افراد داخل شمرده می‌شوند.** / **هر روز از نو (مثلاً یک ناهار در روز).** / **ورودها حضور در این جلسه شمرده می‌شود.** | Counts people inside. / Resets daily. / Entries count as session attendance. |
| EventCheckIn:250 «شناسه:» | DELETE | DELETE |
| EventCheckIn:322 | → **فقط نقطه‌ای که اسکن ندارد حذف می‌شود؛ بقیه را بایگانی کنید.** | Only a point with no scans can be deleted; archive the rest. |
| Pairing :172 title | **اتصال اسکنر** | Connect a scanner |
| :174 | → **گوشی یا تبلت را به «{point}» وصل کنید.** | Connect a phone or tablet to “{point}”. |
| :184 localhost | DELETE from production (dev-only `import.meta.env.DEV`) | — |
| :199 | → **این کد QR را با دوربین گوشی اسکن کنید. پیوند فقط یک‌بار نمایش داده می‌شود.** | Scan this QR code with the phone. The link is shown only once. |
| :246 | کلید ۷ روز معتبر است… → **پیوند تا ۷ روز معتبر است.** | Valid for 7 days. |
| :266 | صدور لینک اتصال → **ساخت پیوند اتصال** | Create pairing link |
| :150 | «لغو دستگاه انجام نشد: {English}» → **لغو دسترسی دستگاه انجام نشد. دوباره تلاش کنید.** | Couldn't remove the device. Try again. |
| :309 | «{n} اسکن همگام‌نشده» → **{n} اسکن ارسال‌نشده** | {n} not sent |
| :345/:348/:362/:370 | لغو → **لغو دسترسی** | Remove access |

Booths and staff (`EventBooths.tsx`, `BoothFormDialog.tsx`, `BoothStaffDialog.tsx`, `BoothQrDialog.tsx`, `i18n.ts`)
| key / line | proposed fa | en |
|---|---|---|
| boothsHeading / boothsDesc | **غرفه‌ها** / DELETE | Booths |
| createBoothButton / createBoothModalTitle / createBoothModalDesc | **غرفهٔ جدید** ×2 / DELETE | New booth |
| boothNameLabel / boothSlugLabel / boothLocationLabel / boothDescriptionLabel / websiteUrlLabel / brochureUrlLabel | **نام شرکت** / **نشانی صفحهٔ غرفه** / **جایگاه** / **معرفی** / **وب‌سایت** / **پیوند بروشور (PDF)** | Company / Page address / Stand / About / Website / Brochure link (PDF) |
| saveBoothAction / noBoothsTitle | **افزودن** / **هنوز غرفه‌ای ندارید** | Add / No booths yet |
| assignStaffButton / assignStaffModalTitle / staffMobileLabel / assignStaffAction | **افزودن نماینده** / **نمایندگان غرفه** / **شمارهٔ موبایل** / **افزودن و ارسال پیامک** | Add representative / Booth representatives / Mobile / Add and text |
| BoothStaffDialog:202 | → **پیوند پنل غرفه به این شماره پیامک می‌شود.** | We'll text them the booth panel link. |
| :91 | → **{name} اضافه شد و پیامک دعوت ارسال شد.** | {name} added and invited by SMS. |
| :248 | → **{name} دیگر به این غرفه دسترسی ندارد. لیدهای ثبت‌شده می‌مانند.** | {name} loses access. Captured leads stay. |
| standeeQrButton / standeeQrModalTitle / standeeQrModalDesc | **کد QR غرفه** ×2 / **برای چاپ روی استند؛ شرکت‌کنندگان با اسکن آن غرفه را ذخیره می‌کنند.** | Booth QR code / For the stand; attendees scan it to save the booth. |
| BoothQrDialog:70 | → **صفحهٔ همایش منتشر نشده است؛ پیش از چاپ آن را منتشر کنید.** | Publish the congress page before printing. |
| BoothFormDialog:25 / :129 | → **نشانی صفحهٔ غرفه را وارد کنید.** / **این نشانی را غرفهٔ دیگری دارد.** | Enter the page address. / Another booth uses this address. |
| EventBooths:179 | → **«{name}» و همهٔ لیدهایش برای همیشه حذف می‌شود.** | “{name}” and all its leads will be deleted permanently. |

Operators (`EventOperators.tsx`, `OperatorFormDialog.tsx`, `i18n.ts`)
| key / line | proposed fa | en |
|---|---|---|
| operatorsHeading / operatorsDesc | **اپراتورهای پذیرش** / DELETE | Desk operators |
| addOperatorButton / addOperatorModalTitle | **اپراتور جدید** ×2 | New operator |
| addOperatorModalDesc | → **نشانی میز پذیرش به این شماره پیامک می‌شود.** | We'll text them the desk link. |
| operatorNameLabel / operatorStatusActive / operatorStatusRevoked / revokeOperatorAction | **نام** / **فعال** / **دسترسی لغو شده** / **لغو دسترسی** | Name / Active / Access removed / Remove access |
| noOperatorsTitle | **هنوز اپراتوری ندارید** | No operators yet |
| EventOperators:97 | → **اپراتورها این نشانی را باز می‌کنند و با کد پیامکی وارد می‌شوند.** | Operators open this link and sign in with an SMS code. |
| :200 | DELETE (duplicate of :97) | DELETE |
| :216 / :230 | → **{name} اضافه شد و نشانی میز پذیرش برایش پیامک شد.** / **{name} دیگر نمی‌تواند وارد میز پذیرش شود.** | {name} added and texted the desk link. / {name} can no longer use the desk. |

Program, venue, files, import (`OrganizerProgram.tsx`, `SessionFormDialog.tsx`, `TimetableImport.tsx`, `ScheduleFilesManager.tsx`, `OrganizerVenue.tsx`)
| line | proposed fa | en |
|---|---|---|
| OrganizerProgram:207 | DELETE | DELETE |
| :248 empty | → **جلسه اضافه کنید یا فایل اکسل (CSV) بارگذاری کنید.** | Add a session or upload a CSV file. |
| SessionFormDialog:96 | DELETE | DELETE |
| TimetableImport:182 (609 chars) | → **نمونهٔ فایل را دریافت کنید، پر کنید و بارگذاری کنید.** + link «دریافت نمونه» (the column list moves into the sample file's header row) | Download the sample, fill it in and upload it. |
| :153 / :314 / :347 | → **حداکثر {max} جلسه در هر فایل.** / **{n} جلسهٔ فعلی جایگزین می‌شود.** / **اگر یک سطر خطا داشته باشد، هیچ جلسه‌ای ذخیره نمی‌شود.** | Up to {max} sessions per file. / Replaces {n} sessions. / One bad row saves nothing. |
| ScheduleFilesManager:219 | → **PDF یا تصویر، حداکثر ۸ مگابایت.** | PDF or image, up to 8 MB. |
| OrganizerVenue:298 / :318 | DELETE / placeholder **مثلاً سالن اصلی، طبقهٔ همکف** | — |

Attendee view / panel preview (`OrganizerPanel.tsx`)
| line | proposed fa | en |
|---|---|---|
| :122/:477/:560 | پیش‌نمایش پنل شرکت‌کننده / پنل شرکت‌کننده → **نمای شرکت‌کننده** | Attendee view |
| :479 intro (356 chars) | DELETE | DELETE |
| :572 «هر بخش پنل از کجا می‌آید» + :408/:417/:426/:436/:445/:457 descriptions | DELETE the explainers; keep each row as «{بخش} · {شمار} · ویرایش» | — |
| :495 / :508 | → **صفحهٔ همایش منتشر نشده؛ شرکت‌کنندگان هنوز این نما را نمی‌بینند.** / **تغییرات منتشرنشده دارید.** | Not published yet. / You have unpublished changes. |
| :564 | → **داده‌های نمونه؛ پیوندها غیرفعال‌اند.** | Sample data; links are off. |

Page Studio (`studio/studioCopy.ts`)
| key | proposed fa | en |
|---|---|---|
| eyebrow / description | DELETE / DELETE | DELETE |
| statusPendingBody, statusLiveBody | DELETE (status chip says it) | DELETE |
| confirmUnpublishBody | → **صفحهٔ همایش و غرفه‌ها از دسترس خارج می‌شوند. ثبت‌نام‌ها و کارت‌های ورود کار می‌کنند.** | The congress and booth pages go offline. Registrations and passes keep working. |
| conflict | → **این صفحه جای دیگری ذخیره شده است.** + two buttons | This page was saved elsewhere. |
| operationalBody | DELETE | DELETE |
| addSectionBody | DELETE | DELETE |
| coreHint | → **پنهان می‌شود، حذف نمی‌شود.** | Can be hidden, not removed. |
| brand.accentHint / attribution / seo.limitation | DELETE | DELETE |
| brand.logoHint | → **PNG با پس‌زمینهٔ شفاف** | PNG with a transparent background |
| hero image hints (banner/cover/split/mobileImage) | one line each, ≤ 10 words (e.g. cover **بدون نوشته؛ نقطهٔ کانونی را تنظیم کنید.**) | ≤ 10 words |
| media.uploadHint | → **PNG، JPEG یا WebP، حداکثر ۵ مگابایت** | PNG, JPEG or WebP, up to 5 MB |
| preview.note | → **پیوندها در پیش‌نمایش غیرفعال‌اند.** | Links are off in preview. |
| sections.*.description | keep ≤ 6 words each | — |

Participants (`lib/participants.ts`, `OrganizerParticipants.tsx`)
| key | proposed fa | en |
|---|---|---|
| description | DELETE | DELETE |
| tierFilter / colTier | نوع بلیت → **نوع کارت ورود** | Pass type |
| exportCsv | خروجی CSV → **خروجی اکسل** | Export CSV |
| editDescription | → **فقط برای همین همایش.** | This congress only. |
| cancelTicket / cancelTitle / confirmCancel | **لغو کارت ورود** / **این کارت ورود لغو شود؟** / **لغو کارت ورود** | Cancel pass / Cancel this pass? / Cancel pass |
| cancelDescription | → **کد QR آن دیگر کار نمی‌کند و ظرفیتش آزاد می‌شود.** | Its QR code stops working and the place is released. |
| transfer / transferTitle / transferDescription | **انتقال کارت ورود** / **انتقال به شخص دیگر** / **کارت فعلی لغو و کارت تازه برای شمارهٔ جدید پیامک می‌شود.** | Transfer pass / Transfer / The current pass is cancelled and a new one is texted to the new number. |
| reissueDescription | → **کد QR تازه ساخته می‌شود و کارت قبلی دیگر کار نمی‌کند.** | A new QR code is issued; the old one stops working. |
| deleteDescription | → **فقط برای ثبت‌نام اشتباه. برای همیشه حذف می‌شود.** | Only for a mistaken registration. Deleted permanently. |
| deleteBlocked / cancelled / transferred / passInactive | «بلیت» → «کارت ورود» | pass |
| noScans | → **هنوز اسکن نشده است.** | Not scanned yet. |
| emptyBody | DELETE | DELETE |
| OrganizerParticipants:213 | → **نقش شما اطلاعات شخصی را نمی‌بیند.** | Your role can't see personal details. |

Analytics (`OrganizerAnalytics.tsx`, `i18n.ts` analytics keys)
| key | proposed fa | en |
|---|---|---|
| analyticsTitle / analyticsSubtitle | **آمار** / DELETE | Analytics |
| offlineSyncDisclaimer | → **اسکن‌های آفلاین پس از اتصال شمرده می‌شوند.** | Offline scans count once they sync. |
| admissionsDesc / gateAdmissionsNote | → **هر ورود جدا شمرده می‌شود؛ تعداد حاضران فعلی نیست.** / DELETE | Every entry counts; not people inside now. |
| filterByPoint / filterByTier / allPointsFilter / allTiersFilter | **نقطهٔ ورود** / **نوع کارت ورود** / **همهٔ نقطه‌ها** / **همهٔ انواع** | Check-in point / Pass type / All points / All types |
| exportAttendanceCsvAction / exportRegistrationsCsvAction | **خروجی ترددها** / **خروجی ثبت‌نام‌ها** | Export entries / Export registrations |
| analyticsFiltersApply, analyticsTimezoneNote | DELETE / → chip **وقت محل همایش** | — |
| cateringSectionTitle / Desc | **پذیرایی** / DELETE | Catering |
| gateThroughputSectionTitle / noGatesMatchFilter / eventHourlyTitle / tierRegistrationsTitle | **ورود به تفکیک نقطه** / **نقطه‌ای با این فیلترها نیست.** / **اسکن در هر ساعت** / **ثبت‌نام به تفکیک نوع کارت ورود** | Entries by point / No points match. / Scans per hour / Registrations by pass type |
| uniqueAdmittedKPI / checkinRateKPI / totalScansKPI | **افراد واردشده** / **نرخ حضور** / **همهٔ اسکن‌ها** | People admitted / Attendance rate / All scans |
| staleDataWarning | → **اتصال قطع است؛ آمار ممکن است قدیمی باشد.** | Offline; figures may be out of date. |

SMS (`OrganizerSms.tsx`, `components/sms/SmsTemplateEditor.tsx`)
| line | proposed fa | en |
|---|---|---|
| OrganizerSms:178 | → **پیامکی که پس از ثبت‌نام برای شرکت‌کننده ارسال می‌شود.** | Sent to attendees after they register. |
| :197 / :204 | → **حالت آزمایشی: پیامکی ارسال نمی‌شود.** / **پیامک هنوز راه‌اندازی نشده؛ پیامک‌ها در صف می‌مانند.** | Test mode: nothing is sent. / SMS isn't set up yet; messages wait in the queue. |
| :217 | → **متن پیش‌فرض سامانه به کار می‌رود.** | The platform default is used. |
| :223 (420 chars) | split: under the template **متن کد ورود را مدیر سامانه تعیین می‌کند.**; under the test field **فقط به اپراتورها، نمایندگان غرفه یا دارندگان کارت ورود همین همایش؛ حداکثر ۱۰ در ساعت.** | Sign-in code text is set by the platform admin. / Only to this congress's operators, booth staff or pass holders; 10 per hour. |
| :336 | → **ممکن است رسیده باشد؛ ارسال دوباره شاید تکراری شود.** | It may have arrived; resending may duplicate it. |
| SmsTemplateEditor:17 | رده بلیت → **نوع کارت ورود** | Pass type |
| SmsTemplateEditor:28-30 (organizer view) | sms.ir/API details → **ارسال پیامک ممکن نشد؛ به مدیر سامانه خبر دهید.** (keep details in the platform view only) | Couldn't send; tell the platform admin. |
| :189 size line | → **{n} نویسه · {parts} پیامک** | {n} characters · {parts} SMS |

### 4.5 Reception desk (portal package: DESK) — files on `ws/c2-desk`
| file:line / key | current → proposed fa | en |
|---|---|---|
| ReceptionPortal:20/:31/:32/:53/:172, deskTitle | ایستگاه پذیرش / میز پذیرش همایش / ایستگاه اپراتور / میز پذیرش و صدور آنی کارت همایش → **میز پذیرش** | Reception desk |
| deskSubtitle, DeskAuthGate:66 tagline | DELETE | DELETE |
| deskLoginTitle / deskLoginSubtitle | **ورود به میز پذیرش** / **با شمارهٔ موبایل اپراتور.** | Sign in to the desk / With the operator's mobile number. |
| ReceptionPortal:75 / :197 | → **کد همایش را وارد کنید.** (once) | Enter the congress code. |
| ReceptionPortal:219-221 (concatenated) | → one function `codeHelp(path)`: **کد همایش بخش بعد از {path} در نشانی صفحهٔ همایش است.** | The congress code is the part after {path} in its page address. |
| walkInRegistrationHeading | ثبت‌نام و پذیرش حضوری (Walk-In) → **ثبت‌نام حضوری** | Desk registration |
| WalkInForm:43 | DELETE | DELETE |
| WalkInForm:55 | → **پیوند کارت ورود به این شماره پیامک می‌شود.** | We'll text the pass link to this number. |
| WalkInForm:49/:61/:65 placeholders | keep one: name **مثلاً مریم احمدی** (drop «دکتر»); others DELETE | e.g. Maryam Ahmadi |
| WalkInForm:90/:91/:94 | → **جستجوی شماره انجام نشد؛ دستی جستجو کنید.** / DELETE / **این شماره کارت ورود دارد:** | Lookup failed; search manually. / This number already has a pass: |
| mintBadgeAction / mintingBadge / nextAttendeeAction | **صدور کارت ورود** / **در حال صدور…** / **نفر بعدی** | Issue pass / Issuing… / Next person |
| ticketIssuedSuccess | ✓ کارت ورود با موفقیت صادر شد. → **کارت ورود صادر شد.** | Pass issued. |
| MintedDialog:28 description | DELETE | DELETE |
| MintedDialog:35 / :54 / :61 | **آمادهٔ چاپ** / **ثبت‌نام لغوشدهٔ این شماره دوباره فعال شد.** / **پیوند کارت ورود به {mobile} پیامک می‌شود.** (`<bdi>`) | Ready to print / This number's cancelled registration was restored. / We'll text the link to {mobile}. |
| AttendeeCard:43/:45 | **کسی انتخاب نشده** / DELETE | Nobody selected |
| AttendeeCard:231 | → **پس از آخرین چاپ تغییر کرده؛ دوباره چاپ کنید.** | Changed since last print; reprint. |
| AttendeeCard:263 | DELETE | DELETE |
| AttendeeSearch:82 | → placeholder **نام، موبایل یا اسکن کارت ورود** | Name, mobile or scan a pass |
| ReceptionStation:342 | → **اتصال قطع شد. دوباره «صدور» را بزنید؛ کارت تکراری صادر نمی‌شود.** | Connection lost. Press Issue again; no duplicate is created. |
| ReceptionStation:757 | → **همایش بایگانی شده؛ فقط جستجو ممکن است.** | Archived congress: search only. |
| ReceptionStation:764 | → **دوباره وارد شدید؛ فرم ثبت‌نام حضوری حفظ شده است.** | Signed in again; the registration form was kept. |
| ReceptionStation:260/:265 | → reuse OTP_CODE_INVALID / **این شماره اپراتور این همایش نیست.** | — / This number isn't an operator of this congress. |
| ReceptionStation:687/:688 | لغوشده / باطل‌شده → **لغوشده** (one) | Cancelled |
| ReceptionStation:1023 | «هنوز رده بلیتی…» → **هنوز نوع کارت ورودی ندارید.** | No pass types yet. |
| DeskAuthGate:20/:24/:28/:108 | → **برای حالت مدیر کلید سازمان لازم است** / **ورود با کلید سازمان** / **ورود اپراتور** / **ورود با کلید سازمان** | Organizer mode needs the organizer key / Use organizer key / Operator sign-in |
| DeskAuthGate:93 / :96 | → **دسترسی اپراتور لغو شده یا زمان ورود تمام شده است.** / **فرم ثبت‌نام حضوری حفظ شده و خودکار ارسال نمی‌شود.** | Access removed or signed out. / Your form is kept and won't be sent automatically. |
| ModeSwitch:21/:22 | فعال: نشست اپراتور / فعال: حالت مدیر → **اپراتور** / **مدیر** (segmented control) | Operator / Organizer |
| DeskActions:181/:203/:234/:241 | → **فقط برای همین همایش؛ کارت چاپ‌شده را دوباره چاپ کنید.** / **کارت فعلی لغو و کارت تازه برای دارندهٔ جدید پیامک می‌شود.** / **کد QR تازه پیامک می‌شود و کارت فعلی کار نمی‌کند.** / **جای این کارت آزاد و پیامک لغو ارسال می‌شود.** | (same meaning, ≤ 12 words) |
| DeskActions:188/:192 | سازمان / دانشگاه · عنوان حرفه‌ای → **سازمان** · **سمت** (match profile) | Organization · Title |
| ResendPassSms:62 / :74 / :95 | → **پیوند کارت ورود دوباره به {mobile} پیامک شد.** / **همین الان ارسال شد؛ {n} ثانیه دیگر دوباره تلاش کنید.** / **ارسال دوبارهٔ پیوند کارت ورود** | Link resent to {mobile}. / Just sent; try again in {n} s. / Resend pass link |
| AttendeeCard:76, AttendeeSearch:101, ReceptionStation:672 | تلاش مجدد → **تلاش دوباره** | Try again |

### 4.6 Gate scanner (portal package: SCANNER) — `components/scanner/copy.ts`, `GateScanner.tsx`, `QrCameraInput.tsx`, scanner keys in `i18n.ts`
| key | current → proposed fa | en |
|---|---|---|
| BiLabel pairs (syncNow, refreshCache, unpair, confirmUnpair, pausedTitle, windowExpired, pairLabel, authorize, deactivated, storageFailedTitle, otherTabTitle, discardAction, discardConfirmAction) | Persian + English → **Persian only**; specs locate by `data-testid` | English only in en |
| product (en) | Gate Scanner → Check-in scanner | — |
| loading | در حال بارگذاری فهرست نقطه ورود… → **در حال بارگذاری…** | Loading… |
| manifestSynced / manifestCached / manifest | **فهرست به‌روز است** / **فهرست ذخیره‌شده** / **فهرست** | List up to date / Saved list / List |
| windowLeadLabel + windowLeftTail | → one function **{time} تا پایان کار آفلاین** | {time} of offline time left |
| bufferLead + bufferTail | → **{n} اسکن در صف ارسال** | {n} waiting to send |
| syncFailures(n) | → **{n} ارسال ناموفق** | {n} failed sends |
| tokenPlaceholder | توکن دستگاه را اینجا بچسبانید — Paste device scanner token... → **کد اتصال را اینجا بچسبانید** | Paste the pairing code |
| listeningTitle / listeningBody | → **آمادهٔ اسکن** / **کارت را جلوی بارکدخوان بگیرید یا دوربین را روشن کنید.** | Ready to scan / Hold a pass to the scanner or turn on the camera. |
| enableCamera / cameraOff | **روشن کردن دوربین** / **خاموش کردن دوربین** | Turn on camera / Turn off camera |
| cameraBlocked / cameraNotFound / cameraUnavailable / cameraInsecure | ≤ 12 words each, ending **از بارکدخوان یا ورود دستی استفاده کنید.** | … use a barcode scanner or manual entry. |
| manualLabel / manualHint / manualPlaceholder | **محتوای کد QR** / DELETE / **محتوای کد QR را بچسبانید** | QR content / — / Paste the QR content |
| trackingIdWarning | → **این شمارهٔ پیگیری است، نه کد QR. کارت را اسکن کنید.** | That's a reference number, not the QR code. Scan the pass. |
| duplicateTitle | تکراری — ورود ممنوع → **تکراری — ورود ندهید** | Duplicate — do not admit |
| statusConfirmedAdmitted / statusProvisionalAdmitted / statusRejected (i18n) | **مجاز** / **مجاز (آفلاین)** / **رد شد** | Admitted / Admitted (offline) / Rejected |
| reasonAlreadyAdmitted | → **قبلاً وارد شده است** | Already admitted |
| reasonCapacityReached | → **ظرفیت تکمیل است** | Full |
| reasonTierNotAllowed | → **این نوع کارت ورود اینجا مجاز نیست** | Pass type not allowed here |
| reasonInvalidTicket | کد QR نامعتبر است (keep) | Invalid QR code |
| reasonNotInManifest | → **در فهرست این دستگاه نیست؛ به میز پذیرش بفرستید** | Not on this device's list; send to the desk |
| reasonCapacityOffline | → **آفلاین؛ ظرفیت کنترل نمی‌شود. با سرپرست هماهنگ کنید** | Offline: capacity can't be checked; ask a supervisor |
| reasonScanConflict | → **تداخل با اسکن نقطهٔ دیگر** | Conflicts with another point |
| reasonTicketInactive / reasonEventMismatch / reasonNotInside / reasonRequiredPoint | **کارت ورود لغو شده است** / **کارت همایش دیگری است** / **داخل نیست؛ خروج ثبت نشد** / **اول باید از نقطهٔ پیش‌نیاز وارد شود** | Pass cancelled / Other congress / Not inside / Must enter the required point first |
| settingsBody (≈300 chars) | → **قطع اتصال، این دستگاه را از کار می‌اندازد.** | Unpairing stops this device. |
| unpairQuestion | → **اتصال این دستگاه قطع شود؟** | Unpair this device? |
| unpairPending / unpairRetained / unpairOffline / unpairNoticeOffline / unpairNoticeNoCredential / unpairNoticeUnsynced / unpairNoticeNotConfirmed / unpairNoticeConfirmed / unpairNoticeFailed (5 × ~250 chars, «ابطال»، «اعتبار»، «HTTP ${status}») | collapse to three: **اتصال قطع شد.** · **روی این دستگاه قطع شد، اما سرور هنوز تأیید نکرده است. دستگاه را به سرپرست بدهید.** · **{n} اسکن ارسال‌نشده روی این دستگاه است. اول به اینترنت وصل شوید.** (status code goes to the log, not the copy) | Unpaired. · Stopped here, not yet confirmed by the server. Hand the device to a supervisor. · {n} scans not sent. Connect first. |
| conflictsBody / acknowledge / acknowledged | → **سرور این اسکن‌ها را رد کرد (مثلاً ورود از نقطهٔ دیگر).** / **بررسی شد** / **بررسی‌شده** | The server rejected these scans (e.g. entered elsewhere). / Mark reviewed |
| windowExpired / windowTokenExpired / windowStale | → **زمان کار آفلاین تمام شد؛ اسکن متوقف است.** / **کد اتصال منقضی شده؛ پیوند تازه بگیرید.** / **فهرست قدیمی است؛ به اینترنت وصل شوید.** | Offline time is up; scanning paused. / Pairing expired; get a new link. / List is old; connect to refresh. |
| setupEyebrow / point / pairTitle / pairBody | DELETE / **نقطهٔ ورود** / **اتصال به نقطهٔ ورود** / **پیوند اتصال را از برگزارکننده بگیرید.** | — / Check-in point / Connect to a check-in point / Get the pairing link from the organizer. |
| unavailableTitle / unavailableBody | **نقطهٔ ورود در دسترس نیست** / common.network | Check-in point unavailable |
| revokedTitle / revokedBody(n) | **دسترسی این دستگاه لغو شد** / **{n} اسکن ارسال‌نشده روی دستگاه مانده است.** | Device access removed / {n} scans not sent. |
| forbiddenTitle / forbiddenBody | **نقطهٔ ورود اشتباه است** / **این کد اتصال برای نقطهٔ دیگری است.** | Wrong check-in point / This code is for another point. |
| expiredTitle / expiredBody | **کد اتصال منقضی شده است** / **پیوند تازه از برگزارکننده بگیرید.** | Pairing expired / Get a new link. |
| systemDetail | جزئیات سیستم → **جزئیات فنی** (collapsed) | Technical details |
| repairLabel / repairPlaceholder / repairAction | **اتصال دوباره** / **کد اتصال تازه** / **اتصال** | Reconnect |
| deactivatedDefault / remaining / reconnectFirst / retryRevoke / revoking | → **این دستگاه متوقف است.** / **{n} اسکن ارسال‌نشده.** / **اول به اینترنت وصل شوید.** / **تلاش دوباره** / **در حال قطع…** | — |
| storageFailedBody | → **این اسکن ذخیره نشد. صفحه را دوباره باز کنید یا از دستگاه دیگری استفاده کنید.** | Not saved. Reload, or use another device. |
| otherTabBody | → **این نقطه در زبانهٔ دیگری باز است. آن را ببندید.** | Open in another tab. Close it. |
| discardTitle / discardBody / discardConfirm | **{n} اسکن ارسال‌نشده** / **فقط روی همین دستگاه‌اند. فقط با تأیید سرپرست حذف کنید.** / **{n} اسکن برای همیشه حذف شود؟** | {n} scans not sent / They exist only here. Delete only if a supervisor agrees. |
| counts in ScannerHeader:104/:149 | Latin digits → `formatLocalizedNumber` | — |

### 4.7 Booth panel (portal package: BOOTH) — files on `ws/b6b-exhibitor`
| key / line | current → proposed fa | en |
|---|---|---|
| exhibitorPortal / header product | پیشخوان غرفه / پرتال تجاری غرفه و لیدها → **پنل غرفه** | Booth panel |
| exhibitorPortalDesc, boothAuthorizedBadge | DELETE | DELETE |
| leadsCountLabel | لید تجاری ثبت‌شده → **لید** | leads |
| captureLeadModalDesc | → **کد QR کارت ورود بازدیدکننده را اسکن کنید.** | Scan the visitor's pass QR code. |
| badgeCodeLabel / badgeCodeHint / badgeCodePlaceholder | **کد QR کارت ورود** / DELETE / DELETE | Pass QR code |
| interestRatingLabel / ratingHot / ratingWarm / ratingCold | سطح تمایل تجاری (Rating) / علاقه زیاد (Hot)… → **میزان علاقه** / **زیاد** / **متوسط** / **کم** | Interest / High / Medium / Low |
| followUpTagsLabel / addCustomTagPlaceholder | **برچسب‌ها** / **برچسب تازه** | Tags / New tag |
| notesLabel / notesPlaceholder | **یادداشت** / DELETE | Note |
| leadCapturedSuccess / leadUpdatedSuccess | ✓ … → **لید ثبت شد.** / **لید به‌روز شد.** | Lead captured. / Lead updated. |
| leadsListHeading / searchLeadsPlaceholder | **لیدها** / **نام، موبایل یا سازمان** | Leads / Name, mobile or organization |
| exportCsvAction | دریافت فایل اکسل (CSV) → **خروجی اکسل** | Export CSV |
| qualifyLeadButton / qualificationDrawerTitle / qualificationDrawerDesc | **ارزیابی** / **ارزیابی لید** / DELETE | Rate / Rate lead |
| noLeadsTitle / noLeadsDesc | **هنوز لیدی ندارید** / **با «ثبت لید» کارت بازدیدکننده را اسکن کنید.** | No leads yet / Tap Capture and scan a visitor's pass. |
| unauthorizedExhibitorDesc / unauthenticatedExhibitorDesc | → **این حساب نمایندهٔ این غرفه نیست.** / **با شماره‌ای که برگزارکننده ثبت کرده وارد شوید.** | This account isn't on this booth. / Sign in with the number the organizer added. |
| CaptureDialog:172 / :227 / :366 | → **اتصال قطع شد. فهرست را بررسی کنید؛ اسکن دوباره لید تکراری نمی‌سازد.** / **این لید از قبل بود؛ ارزیابی قبلی حفظ شد.** / DELETE | Connection lost. Check the list; rescanning won't duplicate. / Already a lead; rating kept. |
| ExhibitorPortal:483 | «…نشست شما حفظ شده است.» → **اتصال برقرار نیست؛ همچنان وارد هستید.** | Can't connect; you're still signed in. |
| ExhibitorPortal:490 / :510 | DELETE | DELETE |
| boothText.retry | تلاش مجدد → **تلاش دوباره** | Try again |
| trashEmptyDesc / trashNote | → **لیدهای حذف‌شده اینجا می‌مانند.** / DELETE | Deleted leads stay here. |
| exportStarted / exportStartedWithDeleted | → **دریافت فایل آغاز شد.** (both) | Download started. |
| contactNotShared / contactNotSharedHint | → **شماره پنهان است** / DELETE | Number hidden |
| offlineBanner | → **آفلاین هستید؛ لیدها روی دستگاه ذخیره و بعداً ارسال می‌شوند.** | Offline: leads are saved here and sent later. |
| pendingDesc | DELETE | DELETE |
| failRefused(status) | → **سرور این اسکن را نپذیرفت.** | The server refused this scan. |
| storageUnavailable | → **این مرورگر نمی‌تواند لید را نگه دارد. کد را یادداشت کنید.** | This browser can't keep the lead. Note the code. |
| removedDesc + removedAsk | → **دسترسی شما به این غرفه برداشته شد. اگر اشتباه است، با برگزارکننده تماس بگیرید.** | Your access was removed. Contact the organizer if this is a mistake. |
| suspendedDesc + suspendedAsk | → **دسترسی این همایش موقتاً متوقف است. با برگزارکننده تماس بگیرید.** | Access is paused. Contact the organizer. |
| archivedNotice | → **همایش بایگانی شده؛ فقط مشاهده و خروجی ممکن است.** | Archived: view and export only. |

### 4.8 Platform admin (portal package: PLATFORM) — technical terms allowed, length not
| line | proposed fa | en |
|---|---|---|
| "پنل مدیریت سامانه" ×6 | once in the header: **مدیریت سامانه** | Platform admin |
| PlatformConsole:164 | DELETE | DELETE |
| PlatformConsole:183 | → **مقدار CONGRESS_PLATFORM_ADMIN_TOKEN سرور** | The server's CONGRESS_PLATFORM_ADMIN_TOKEN |
| environment chip "production" | → **محیط اصلی** / **آزمایشی** | Production / Staging |
| PlatformSms:112-114 | → **اکنون از .env خوانده می‌شود.** (one) | Now read from .env. |
| PlatformSms:137 | → **پیکربندی نشده: کلید API یا شمارهٔ خط خالی است.** | Not configured: API key or line missing. |
| PlatformSms:238 | → **کلید ذخیره‌شده خوانده نمی‌شود؛ دوباره وارد کنید.** | The saved key can't be read; enter it again. |
| PlatformSms:344 / :507 | → **بدون کلید در .env، ارسال پیامک برای همه متوقف می‌شود.** / **همهٔ پیامک‌ها شمرده می‌شوند؛ بالای سقف، کد ورود ارسال نمی‌شود.** | Without a .env key, all SMS stops. / All SMS count; above the cap, sign-in codes stop. |
| PlatformOrganizers:127 | → **اعضا با شمارهٔ موبایل وارد می‌شوند. کلید سازمان فقط برای یکپارچه‌سازی است و یک‌بار نمایش داده می‌شود.** | Members sign in by mobile. The organizer key is for integrations and is shown once. |
| PlatformSignIn:154 | → **هر سطر یک نشانی یا CIDR، مثلاً 203.0.113.0/24** | One address or CIDR per line |

### 4.9 Error messages (`lib/errorMessages.ts` — owned by COPY-0)
Rules: §3.5. Rewrites (fa):
| code | proposed fa |
|---|---|
| TICKET_STATE_CONFLICT | وضعیت این کارت ورود تغییر کرده است. فهرست را به‌روز کنید. |
| TICKET_ALREADY_CANCELLED / TICKET_NOT_FOUND | این کارت ورود قبلاً لغو شده است. / این کارت ورود پیدا نشد. |
| PARTICIPANT_HAS_HISTORY | این شرکت‌کننده سابقهٔ ورود دارد و حذف نمی‌شود؛ کارت ورودش را لغو کنید. |
| EVENT_HAS_TICKETS | این همایش کارت ورود صادرشده دارد و حذف نمی‌شود؛ بایگانی‌اش کنید. |
| TIER_NOT_FOUND | این نوع کارت ورود دیگر وجود ندارد. نوع دیگری انتخاب کنید. |
| REGISTRATION_CLOSED / REGISTRATION_NOT_OPEN / TIER_SALES_NOT_OPEN / TIER_SALES_CLOSED | revert webfix1's long forms to one clause each (the page already shows dates): ثبت‌نام بسته است. / ثبت‌نام هنوز آغاز نشده است. / رزرو این نوع هنوز آغاز نشده است. / مهلت رزرو این نوع تمام شده است. |
| TOKEN_EXPIRED / API_KEY_INVALID / API_KEY_MISSING | common.sessionEnded / کلید سازمان پذیرفته نشد. دوباره وارد شوید. / برای ادامه وارد پنل برگزارکننده شوید. |
| PASS_SMS_RATE_LIMITED | پیوند کارت ورود همین الان ارسال شد. کمی بعد دوباره تلاش کنید. |
| OTP_SEND_FAILED / SMS_NOT_CONFIGURED / SMS_HOURLY_CAP_REACHED / SMS_DAILY_CAP_REACHED | drop «لطفاً» and «سامانه»: ارسال پیامک ممکن نشد. کمی بعد دوباره تلاش کنید. (etc.) |
| SIGNUP_TOKEN_EXPIRED / SIGNUP_TOKEN_USED | زمان تأیید تمام شد. کد تازه بگیرید. (both) |
| IDEMPOTENCY_KEY_REUSED | این فرم با اطلاعات دیگری ارسال شده بود. دوباره بررسی و ارسال کنید. |
| CURSOR_INVALID | فهرست تغییر کرده است. از ابتدا بارگذاری کنید. |
| SCANNER_CREDENTIALS_MISSING / SCANNER_TOKEN_INVALID / SCANNER_REVOKED / SCANNER_SCOPE_MISMATCH | این دستگاه هنوز وصل نیست. / کد اتصال نامعتبر یا منقضی است؛ پیوند تازه بگیرید. / دسترسی این دستگاه لغو شده است. / این کد اتصال برای نقطهٔ ورود دیگری است. |
| EVENT_SLUG_TAKEN / BOOTH_SLUG_TAKEN | این نشانی را همایش دیگری دارد. / این نشانی را غرفهٔ دیگری دارد. |
| TIER_FILTER_REQUIRED (en) | Select at least one allowed pass type. |
| BADGE_OTHER_EVENT | این کارت ورود مال همایش دیگری است و ذخیره نشد. |
| NETWORKING_CLOSED | این همایش بایگانی شده؛ افزودن مخاطب یا ذخیرهٔ غرفه ممکن نیست. |
| **new** SMS_TEMPLATE_INVALID | متن پیامک درست نیست؛ جای‌نگهدارها را بررسی کنید. / The SMS text is invalid; check the placeholders. |
| **new** TRUSTED_NETWORK_INVALID | نشانی شبکه درست نیست؛ مثل 203.0.113.0/24 بنویسید. / Invalid network; write it like 203.0.113.0/24. |
| fallback (no or unknown code) | fa: common.generic — **never the English detail**; en: keep detail |

### 4.10 SMS template defaults (`backend/app/sms/templates.py` — owned by COPY-SMS)
Rules: one greeting, one fact, one link, no product pitch, ≤ 2 lines + link, glossary terms.
| kind | current | proposed |
|---|---|---|
| otp | کد ورود شما به سامانه همایش: {code}\nاین کد تا {minutes} دقیقه معتبر است؛ آن را به کسی ندهید. | **کد ورود همایش: {code}\nآن را به کسی ندهید.** |
| ticket_confirmation | {name} عزیز، ثبت‌نام شما در «{event}» تأیید شد.\nکارت ورود: {link} | keep |
| ticket_cancelled | {name} عزیز، بلیت شما در «{event}» لغو شد و کارت ورود آن دیگر معتبر نیست. | **{name} عزیز، کارت ورود شما در «{event}» لغو شد.** |
| ticket_reissued | {name} عزیز، کارت ورود شما در «{event}» دوباره صادر شد و کارت قبلی دیگر معتبر نیست.\nکارت ورود جدید: {link} | **{name} عزیز، کارت ورود تازهٔ شما در «{event}»:\n{link}\nکارت قبلی دیگر کار نمی‌کند.** |
| staff_invite | {name} عزیز، شما نمایندهٔ غرفهٔ «{booth}» در «{event}» شدید.\nورود به پنل غرفه و ثبت لید: {link} | **{name} عزیز، شما نمایندهٔ غرفهٔ «{booth}» در «{event}» هستید.\nورود: {link}** |
| member_invite | {name} عزیز، شما با نقش «{role}» به کنسول «{organizer}» اضافه شدید.\nورود با همین شماره: {link} | **{name} عزیز، شما با نقش «{role}» به پنل برگزارکنندهٔ «{organizer}» اضافه شدید.\nورود: {link}** |
| operator_invite (c2) | {name} عزیز، شما اپراتور میز پذیرش «{event}» شدید.\nورود با همین شماره: {link} | **{name} عزیز، شما اپراتور میز پذیرش «{event}» هستید.\nورود: {link}** |
Only defaults change; stored overrides are untouched (say so in the deploy note). `TemplateError` messages stay English in the API `detail` but the web shows §4.9's localized `SMS_TEMPLATE_INVALID`.

### 4.11 Legacy dictionary `lib/i18n.ts` (COPY-0)
- DELETE the 66 unreferenced keys in both locales (`copy/deadkeys.txt`; re-run the check after the branch merges).
- Rewrite the live keys per §4.3–§4.7 (they are listed under their screens above).
- The file keeps only the locale engine (`formatLocalizedDate`, `formatLocalizedNumber`, `codeFontClass`, the hook) once the portal packages have moved their keys out (COPY-Z).

---

## 5. One localization mechanism

**Keep mechanism B — typed per-area copy modules — and retire A, C and D without a big-bang.**
- Shape: `web/src/copy/<area>.ts` with `const fa = { … } as const; const en: CopyShape<typeof fa> = { … }; export const <area>Copy = { fa, en };`
  where `CopyShape` maps every string to `string` and every function to the same signature — TypeScript then rejects a missing en (or fa) key at build time.
  Interpolation through functions (`(name: string) => …`) as today; no new dependency (no i18next/ICU needed for two languages).
- Areas: `common`, `public`, `attendee`, `organizer` (may split: `organizerSetup`, `organizerContent`, `studio`, `participants`, `analytics`, `sms`), `desk`, `scanner`, `booth`, `platform`, `errors` (= `errorMessages.ts`, stays where it is).
  Existing B modules move as-is (rename the two `homeCopy` exports: `homePageCopy`, `attendeeHomeCopy`).
- Access: `const c = useCopy(deskCopy)` returning `deskCopy[locale]` from one `LocaleProvider` (single React state; also sets `<html lang dir>` — coordinate with A11Y-1). Until the provider lands, `deskCopy[locale]` with the prop is fine.
- Migration order (each package moves the files it already edits for copy — a file is touched once):
  1. COPY-0: create `copy/common.ts`, guards, dictionary clean-up, errors.
  2. Operational first (wrong words cost most here): desk, scanner, booth.
  3. Organizer (setup, then content), platform.
  4. Public, attendee (already mostly B — mainly wording).
  5. COPY-Z: delete the now-unused `translations` keys; `i18n.ts` keeps only formatting + hook.
- Guards (all `node --test`, part of `npm test`, so `scripts/check.sh` enforces them):
  1. `tests/glossary.test.ts` — extend `FORBIDDEN` (built from code points as now) with: «رده» (word-boundary regex, not a substring — «کرده»/«گسترده» must pass),
     «نشست», «گیت», «بلیط» (exists), «توکن», «اسلاگ», «پرتال», «پورتال», «پیشخوان», «تلاش مجدد», «بارگیری», «جست‌وجو», «تایید», «ابطال», «نمایید», «گردید»,
     and (after D-decisions) «سرنخ», «لینک», «کنسول». Scope: Persian string literals in `src/**` + `backend/app/sms/templates.py`. Temporary per-file allowlist that only shrinks.
  2. `tests/copyGuard.test.ts` (new, ratchet): counts per file of (a) inline locale ternaries with a string literal (`/\b(isRtl|isFa|locale\s*===\s*["']fa["'])\s*\?\s*["'`]/`),
     (b) Persian literals in `.tsx` files outside `src/copy/**`; compares with `tests/copy-baseline.json`. Fails if any count rises or a new file appears; prints
     "lower the baseline" when a count drops (so it only ever goes down). Also: no Latin dev terms inside Persian literals (`API|token|Slug|IANA|JWT|localhost|HTTP|manifest|SessionStorage|Walk-In|\(Hot\)|\(Rating\)`), allowlisting `pages/Platform*`; no `...` in Persian literals; no `✓` prefix.
  3. `tests/apiErrorCodes.test.ts` — add: every `ApiError(…, "CODE", …)` / `code="CODE"` literal under `backend/app/**/*.py` exists in both `errorMessages` maps (minus a small allowlist of scan-verdict codes that `scanner/copy.ts` maps); `localizedApiError(x, "fa")` never returns a string without Persian letters.
  4. `docs/CODING_STANDARDS.md` §2: "New user-facing strings go into `src/copy/<area>.ts`; no inline `isRtl ? '…' : '…'` text; terms per GLOSSARY Persian UI terms; errors per §2.F."

---

## 6. Consistency spec (copy-related components)
- `ConfirmDialog`: props `title` (question), `confirmLabel` (the verb), `cancelLabel` default `common.cancel`; no default "تأیید". Description ≤ 1 sentence.
- `PortalState`/`StatusPanel` (empty/error/loading): title + optional one-line body + one action; default error body = `common.network`/`common.generic`; default action label `common.retry`.
- Form `Field`: `hint` only for constraints; validation message replaces the hint (do not show both).
- Toasts: one line, ≤ 60 characters; success has no icon prefix in the string.
- Status chips: only §3.4 words; one component, one map (`copy/common.ts status`).
- Language toggle: text in the target language with `lang`; same in every portal (remove the four bespoke toggles' different aria texts).
- Values inside sentences: `<bdi>` around names/mobiles/URLs/codes; functions, never concatenated fragments.

## 7. Device-fit (copy)
- Buttons ≤ 18 Persian characters (fits 360 px at 16 px with icon); tab labels ≤ 12 characters (organizer tabs proposed above all fit); chips ≤ 10.
- No sentence inside a button; no line-wrapping primary action on 360×740 (check: `scrollWidth` of the button ≤ its box).
- Scanner takeover: verdict word ≤ 2 words, reason ≤ 8 words (readable at arm's length in landscape kiosks).
- Long organizer/congress names wrap (no ellipsis on titles; ellipsis + `title` only in table cells).

## 8. Install / PWA copy
- Offer only to: attendees who hold a pass (My congress / pass screen, after the pass has rendered once, mobile, not standalone, not dismissed);
  scanner operators on the paired idle screen (once). Never on public pages, organizer, platform, desk desktop.
- One component (`InstallHint`) and one string set; delete the checklist copy in `attendeeCopy`.
  | key | fa | en |
  |---|---|---|
  | title | نصب روی گوشی | Install on your phone |
  | body (attendee) | کارت ورود بدون اینترنت هم باز می‌شود. | Your pass opens even offline. |
  | body (scanner) | اسکنر با یک لمس باز می‌شود. | Open the scanner in one tap. |
  | install (Android prompt) | نصب | Install |
  | ios | در Safari: اشتراک‌گذاری ← Add to Home Screen | In Safari: Share → Add to Home Screen |
  | dismiss | بعداً | Not now |
  (The iOS menu item is shown in English because most Persian iPhones run an English system UI; it is a UI label, wrap in `<bdi lang="en">`.)
- Update prompt (`AppUpdatePrompt`): «نسخهٔ تازه آماده است.» + «به‌روزرسانی» / «بعداً».

---

## 9. Work packages (non-overlapping file lists)

Start after `ws/webfix1-public-attendee`, `ws/webfix2-console`, `ws/b6b-exhibitor`, `ws/c2-desk`, `ws/team2-pwa1-pwa-settings` are merged (they edit the same copy files).
This replaces the workboard's GLOSS-2 row. Deck sections §4.2–§4.8 are applied **by the per-portal implementer of that portal** (they own those files anyway);
if a portal has no package, the COPY-n package of the same row does it. Every package: moves its files' inline strings into `src/copy/<area>.ts`
(its baseline entries in `copy-baseline.json` drop to 0), updates the e2e specs that match the changed English names (1,439 `getBy*` locators in `web/e2e`,
148 Persian ones in `web/e2e-live`; locate by role/testid where the name changed), passes `npm test`, `npm run lint`, `npm run build`, `./scripts/check.sh`.

| Pkg | Deck | Files (exclusive) | Acceptance |
|---|---|---|---|
| **COPY-0** guards + shared (first) | §3, §4.1, §4.9, §4.11, §5 | `web/tests/glossary.test.ts`, `web/tests/copyGuard.test.ts` (new), `web/tests/copy-baseline.json` (new), `web/tests/apiErrorCodes.test.ts`, `web/src/copy/common.ts` (new), `web/src/lib/i18n.ts`, `web/src/lib/errorMessages.ts`, `web/src/api/client.ts` (fa fallback only), `GLOSSARY.md` (Persian UI terms incl. decided D#), `docs/CODING_STANDARDS.md` | Guards green with baseline; `localizedApiError({detail:"Internal Server Error"},"fa")` returns Persian; 66 dead keys gone; no banned term left in `i18n.ts`/`errorMessages.ts`; harness `org-overview-error` fa shows no Latin. |
| **COPY-SMS** | §4.10 | `backend/app/sms/templates.py`, `backend/tests/test_sms_templates.py`, `test_otp_auth.py`, `test_pass_sms_resend.py`, `test_sms_outbox.py`, `test_short_links.py` (only their expected texts), `web/e2e/organizer-workspace.spec.ts` & `platform-console.spec.ts` (only default-text assertions) | Backend runner green; each default renders ≤ 2 lines + link; glossary test (extended to templates.py) green. Deploy note: defaults only, overrides untouched. |
| **PUBLIC** | §4.2 | `components/public/**`, `pages/Home.tsx`, `pages/PublicEvent.tsx`, `pages/PublicBooth.tsx`, `layouts/PublicLayout.tsx`, `components/BoothDirectory.tsx`, `pages/NotFound.tsx`, `web/e2e/public-*.spec.ts` | Home fa 390×844 static text ≤ 60 words (harness `TEXT=1`), event page chrome ≤ 120; no `#capabilities/#roles/#architecture`; LATIN check empty except congress content. |
| **ATTENDEE** | §4.3, §8 | `components/attendee/**`, `components/auth/MobileOtpForm.tsx`, `pages/AttendeeSignIn.tsx`, `pages/Me.tsx`, `pages/My*.tsx`, `pages/CongressDetails.tsx`, `layouts/AttendeeLayout.tsx`, `lib/attendeeSession.ts`, `components/AppUpdatePrompt.tsx`, `web/e2e/attendee-*.spec.ts`, `sms-link-pass.spec.ts`, `web/e2e-live/attendee.spec.ts` | No «Add to Home Screen» outside `<bdi lang=en>`; one install component; my-profile has no "JSON"; MyTickets confirm uses «لغو ثبت‌نام/انصراف». |
| **ORG-A** setup | §4.4 shell → operators | `pages/OrganizerLayout.tsx`, `pages/OrganizerEvents.tsx`, `pages/organizer/{EventOverview,EventTiers,EventCheckIn,EventBooths,EventOperators,EventSettingsPanel,EventSectionUi}.tsx`, `components/organizer/{OrganizerKeyGate,OrganizerMemberSignIn,EventEditDialog,TierFormDialog,CheckInPointFormDialog,ScannerPairingDialog,BoothFormDialog,BoothStaffDialog,BoothQrDialog,OperatorFormDialog,WorkspaceUi,useGuardedClose}.tsx`, `lib/organizerConsole.ts`, `pages/OrganizerMembers.tsx`, `pages/OrganizerActivity.tsx`, `web/e2e/organizer-{workspace,authority,checkin-rules,members,settings}.spec.ts`, `web/e2e-live/{organizer,members}.spec.ts` | Org gate fa ≤ 30 words, no «API/SessionStorage/کنسول»; activity shows no raw path segment; tabs per §4.4; no inline ternary left in these files. |
| **ORG-B** content | §4.4 program → SMS | `pages/OrganizerProgram.tsx`, `pages/OrganizerVenue.tsx`, `pages/OrganizerPanel.tsx`, `pages/OrganizerPageStudio.tsx`, `components/organizer/studio/**`, `components/organizer/{SessionFormDialog,TimetableImport,ScheduleFilesManager}.tsx`, `pages/OrganizerParticipants.tsx`, `lib/participants.ts`, `pages/OrganizerAnalytics.tsx`, `pages/OrganizerSms.tsx`, `components/sms/SmsTemplateEditor.tsx`, `web/e2e/{page-studio,participants,organizer-analytics,schedule-files}.spec.ts` | No string > 160 chars in these files; import help ≤ 1 line + sample link; participants use «کارت ورود» (no «بلیت»). |
| **DESK** | §4.5 | `components/reception/**`, `pages/ReceptionPortal.tsx`, `lib/deskBadge.ts`, `web/e2e/{reception-portal,desk-authority}.spec.ts`, `web/e2e-live/desk.spec.ts` | No «Walk-In/نشست/ایستگاه/تلاش مجدد/لینک»; ResendPassSms/MintedDialog/ReceptionPortal sentences built by functions with `<bdi>`. |
| **SCANNER** | §4.6 | `components/scanner/**`, `pages/GateScanner.tsx`, `components/QrCameraInput.tsx`, `web/e2e/scanner-*.spec.ts`, `scannerFixtures.ts`, `web/e2e-live/scanner.spec.ts` | `BiLabel` removed; no «توکن/ابطال/همگام/HTTP» in fa; verdict reasons ≤ 8 words; header numbers in Persian digits; specs use test ids. |
| **BOOTH** | §4.7 | `components/booth/**`, `pages/ExhibitorPortal.tsx`, `web/e2e/exhibitor-portal.spec.ts`, `web/e2e-live/exhibitor.spec.ts` | No «(Hot)/(Rating)/پیشخوان/پرتال/✓»; booth home fa ≤ 40 static words. |
| **PLATFORM** | §4.8 | `pages/Platform*.tsx`, `pages/platformContext.ts`, `web/e2e/platform-console.spec.ts` (non-SMS-default parts) | Header label once; no string > 160 chars. |
| **COPY-Z** cleanup (last) | §4.11, §5 step 5 | `web/src/lib/i18n.ts`, `web/tests/copy-baseline.json`, `web/tests/glossary.test.ts` (drop allowlist) | Baseline all zero; allowlist empty; `translations` gone. |

Note on overlaps: `copy/common.ts` is created by COPY-0 and then only *read* by the others; a package that needs a new common key adds it to its own
area module instead (COPY-Z can hoist duplicates). `GLOSSARY.md` only in COPY-0.

---

## 10. Open decisions for the product owner (needed before COPY-0 merges its banned list)
- **D1 Lead**: «لید» (sales staff know it; 131 uses) vs «سرنخ» (11 uses, literary). Recommend «لید», booth panel only; attendees never see it.
- **D2 Portal names**: پنل برگزارکننده · پنل غرفه · میز پذیرش · اسکنر نقطهٔ ورود · همایش من · مدیریت سامانه. Ban «کنسول/پرتال/پورتال/پیشخوان/فضای کاری/ایستگاه».
- **D3 Admission Policy**: «قانون ورود» (plain) vs «سیاست پذیرش». Recommend «قانون ورود».
- **D4 Organizer key**: «کلید سازمان», hidden behind a secondary link on sign-in; never «کلید API» outside the platform admin.
- **D5 Bookmark**: «ذخیره» (and free «نشان» from the badge meaning).
- **D6 Link**: «پیوند» everywhere (incl. SMS).
- **D7 English**: congress · pass · pass type · check-in point · session · program (US) · reception desk · booth panel · organizer console.
- **D8 Scanner credential**: «پیوند اتصال / کد اتصال»; never «توکن».
- **D9 Sign-in session**: «ورود» phrasing; «نشست» banned entirely.
