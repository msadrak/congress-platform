# UX-ORG spec: organizer members + platform admin

Reviewer: `org`. Code reviewed: `b980385` (integration/upgrade) with `ws/webfix2-console` (64c57b6) merged on top
(no conflicts). It was rendered with the mock harness in `…/scratchpad/ux-review/org/` (`run.mjs`, `flows.mjs`, `offline.mjs`)
at 1440×900 (`d`), 1280×800 (`d2`), 820×1180 (`t`), 1180×820 (`tl`) and 390×844 (`m`), Persian first, with an English sample.
Screenshots: `…/scratchpad/ux-review/org/shots/` (`<screen>-<locale>-<vp>[-sN].jpg`, flows are `f-*.jpg`).
Automated checks found no horizontal overflow, no unlabeled controls and no sub-24 px targets, apart from the skip link.
English is complete: only user data stays Persian. The problems below are about structure, copy, state and role handling, not pixels.

Paths are relative to `web/src/` unless noted.

---

## 1. Persona / scenario inventory

### Organizer member (owner / manager / staff / viewer; the API key counts as owner)
| # | Scenario | Paths & edge cases exercised |
|---|---|---|
| S1 | Sign in with mobile + SMS code | `/organizer`, wrong code, rate limit (429), resend countdown, member of 2+ organizers then chooser (`f-signin-choose-m`), no way to switch organizer later without signing out |
| S2 | Sign in with API key | Key tab (`f-keygate-*`), rejected key reopens on the key tab, 401 mid-session returns to the gate |
| S3 | Events list | Populated, archived mixed in (`events-fa-d-s1`), empty (`events-empty-*`), 500 error, **offline (infinite skeleton)**, viewer (no create) |
| S4 | Create / edit congress | Create dialog (`f-create-event-m`), validation, Gregorian `datetime-local` on Persian, slug, time zone, registration window; edit from list, from the overview hero, from the settings card (the same dialog three times) |
| S5 | Archive / unarchive / delete | Settings card; delete only without tickets; archived event then read-only (**only the overview knows**) |
| S6 | Overview | Hero, 6 count tiles, capacity, settings, "live stats" and "desk" cards; per role; archived; error; offline |
| S7 | Program | Sessions by day, add/edit/delete, CSV import (Jalali/Gregorian), schedule files (PDF/image upload, reorder, hide, delete) |
| S8 | Venue | Entrances + halls, reorder, edit, delete |
| S9 | Ticket types | Add/edit with sales window, close, delete (refused when reserved then "close instead") |
| S10 | Check-in setup | Add/edit point (policy, tiers, IN/OUT, prerequisite, session door), archive/unarchive, delete, open scanner, pair device + device health (stale, unsynced, version), session attendance CSV |
| S11 | Booths | Add/edit/delete, assign/remove representatives (invite SMS), standee QR print |
| S12 | Desk operators | Add (invite SMS), revoke; open desk as organizer admin |
| S13 | Page Studio | Sections, brand/hero layouts, SEO, media library, fa/en content, desktop/phone preview, save draft, publish, unpublish, discard draft, stale 409 (keep mine / load latest), leave guard; viewer read-only |
| S14 | Attendee panel preview | Preview-only page with "where data comes from" cards |
| S15 | Participants | Search, filter by type/status, page, drawer (details, scan history), edit, reissue, transfer, cancel, delete (only without history), CSV export (manager) |
| S16 | SMS | Edit confirmation template, variables, segment counter, test send, log with retry/resolve, load older |
| S17 | Analytics | Auto-refresh, pause, day/point/type filters, KPIs, hourly chart + table, catering, per-gate; CSV exports offered to managers only (webfix2) |
| S18 | Members (owner) | Add (role radio cards), change role (inline select), revoke; manager/viewer reach it by URL |
| S19 | Activity | Filter by congress, load older, localized actions (webfix2) |
| S20 | Congress day on a phone | Every screen at 390 px: rail header ≈ 220 px tall, 13-item scroll strip, filters before data |

### Platform admin
| # | Scenario | Paths |
|---|---|---|
| P1 | Sign in with token | `/platform`, wrong token, offline (handled) |
| P2 | SMS gateway | Mode, API key, line, check connection, environment chip |
| P3 | Outbox health + caps | Counts, oldest pending, hourly/daily caps |
| P4 | Platform templates | OTP + default confirmation, test send |
| P5 | Sign-in rules | OTP length/TTL/cooldown/limits, venue networks |
| P6 | Organizers | Create (key shown once), rotate key, revoke/reactivate, **members dialog** (webfix2), empty list |

---

## 2. Findings (ranked)

### Critical
**C1. Check-in section ignores roles.** A viewer (and staff) sees *Add point, Edit, Archive, Delete*. A viewer also sees *Open scanner* and *Pair device*. Every one of these ends in ROLE_FORBIDDEN.
`pages/organizer/EventCheckIn.tsx:23` (no `can` taken from the workspace; C1 landed after B6a's role pass). Screenshot: `viewer-checkin-fa-d.jpg`.
Roles from `backend/app/roles.py:64-76`: points need manager; token, devices and revoke need staff.

**C2. Offline / network failure leaves screens on a skeleton forever.** This happens on the events list, the overview, check-in and members. Venue Wi-Fi on congress day is exactly when this hits.
`pages/OrganizerEvents.tsx:85`, `components/organizer/EventWorkspaceProvider.tsx:37`, `pages/OrganizerMembers.tsx:38` call `client.GET` without `networkErrors: "result"`.
openapi-fetch throws (`pageerror: Failed to fetch`), so `loading` never clears. Participants, analytics and the studio do show an error.
Screenshots: `offline-events-fa-m.jpg`, `offline-ov-fa-m.jpg`, `offline-ci-fa-m.jpg`, `offline-members-fa-m.jpg`.

### High
**H1. 13 numbered sections + 3 org pages; the day-of sections come last.** At 1440×900 the sidebar shows up to *Participants*. *Analytics*, *Desk* and the identity block need a rail scroll. At 1280×800, only items 01–09 fit.
On phones it is a 13-tab sideways strip. The "01…13" indexes are noise and leave holes for lower roles (viewer sees 06, 08, 10, 12: `viewer-overview-fa-d.jpg`).
`pages/OrganizerLayout.tsx:332-350`, `lib/organizerWorkspace.ts:2-17`.

**H2. Archived congress is read-only only on the overview.** Tiers, check-in, booths, program, SMS, studio and participants still offer Add, Edit and Delete, and the server answers 409.
The rail still shows "Upcoming" and a *Public page* link that now 404s. `pages/organizer/EventOverview.tsx:48,122` is the only `archived` check outside the settings card.
Screenshot: `archived-tiers-fa-d.jpg`.

**H3. Persian date heading is garbled on Program:** «۱۴۰۵ آبان ۱۹, سه‌شنبه» (Latin comma, reversed order).
`components/organizer/sessionTime.ts:76` formats with raw `Intl` while `lib/i18n.ts:798 formatLocalizedDate` reorders the parts. There are 8 different date formatters in this scope (§4.6). Screenshot: `program-fa-d.jpg`.

**H4. Organizer date entry is Gregorian `mm/dd/yyyy` in the Persian UI.** This covers create/edit congress, registration window, tier sales window and sessions. DATE-1 is still open.
The user must convert «۱۹ آبان» by hand. Screenshot: `f-create-event-m.jpg`.

**H5. Terminology contradicts the decided glossary in nav, titles and buttons.**
- «رده‌های بلیت»/«افزودن رده بلیت جدید» against «نوع کارت ورود», which the same page uses in its notices.
- «گیت‌های بازرسی», «ویرایش گیت», «ورود به اسکنر گیت» against «نقطه ورود».
- «لغو بلیت», «انتقال بلیت», «نوع بلیت», «دریافت بلیت» against «کارت ورود».
- «پرسنل پذیرش» against «اپراتورهای پذیرش».
- English mixes "Gate" with "Check-in point" (`checkin-en-d.jpg`).
Source: `lib/i18n.ts` keys `tabTiers, tabPoints, tabOperators, tiersHeading, pointsHeading, createTierButton, allowedTiersLabel…`, plus `lib/participants.ts`.

**H6. Device health is hidden one dialog deep, per point.** Stale scanners (">10 min offline, 14 unsynced") are only visible after opening *Pair device* on each point (`f-pairing-d.jpg`).
On congress day the organizer needs "2 of 6 scanners stale" at a glance. `components/organizer/ScannerPairingDialog.tsx`.

**H7. Primary actions are diluted.**
- Each event card has 5 actions (`events-fa-d.jpg`).
- Each check-in card has 5–6 (`checkin-fa-d.jpg`).
- Each participant row has a name button, *Edit* and *Manage* (`participants-fa-d.jpg`).
- The overview has *Edit congress* in the hero and *Edit settings* in the settings card, which open the same dialog (`EventOverview.tsx:104` and `:261`).
- Analytics makes *Download CSV* the primary button of a live dashboard.

### Medium
- **M1. Explanatory paragraphs under every header.** There are 46 `description=`/`*Desc` uses in organizer pages. Examples: the participants scope sentence, the program "no need to publish" sentence, analytics' offline disclaimer box, the SMS "sent via sms.ir" banner, the gate's SessionStorage "security note" (`OrganizerKeyGate.tsx:203`), the Studio "live data" info box, and the per-card check-in policy sentences. Full delete list in §3.
- **M2. Phone sign-in.** The marketing hero takes ≈ 45 % of the first screen, so *Send code* is below the fold (`gate-fa-m.jpg`). The organizer chooser sits under the same hero.
- **M3. Phone workspace header.** It takes ≈ 220 px: brand, back link, event name, status, public-page icon and tab strip. The overview hero then repeats the event name (`overview-fa-m.jpg`). Participants on a phone put the description, export and three stacked filters before the first row (`participants-fa-m.jpg`).
- **M4. Attendee Panel is a section with no settings.** It is a preview plus "where each block comes from" cards that link elsewhere (`panel-fa-d.jpg`). It belongs in the studio preview.
- **M5. Venue is split from Program**, although halls only exist for sessions and the program shows hall names (`venue-fa-d.jpg`).
- **M6. Internal identifiers are shown:** «شناسه: 55555555» on tiers (`EventTiers.tsx:149`), points (`EventCheckIn.tsx:250`) and "G-01" codes (`EventCheckIn.tsx:165`), `/booth/44444444`, and «06» hard-coded in the studio header while the nav says 08 (`OrganizerPageStudio.tsx:379`).
- **M7. Raw technical strings reach users:**
  - SMS log `last_error` («smsir: 401 Unauthorized», `OrganizerSms.tsx:318`).
  - Unknown SMS kinds fall back to the raw key (`otp`, `OrganizerSms.tsx:174`).
  - Scan history `rejection_reason` codes in mono (`OrganizerParticipants.tsx:627`).
  - Standee dialog shows the API `detail` ("Not found", `f-booth-standee-d.jpg`).
  - Pairing shows build hashes (`web-scanner/2+b980385c25`).
  - Settings show `Asia/Tehran` (webfix2 added `lib/timeZoneLabel.ts`, which is used only by analytics).
- **M8. Tier delete is offered on a tier with 412 reservations.** The user only learns afterwards that it can't be deleted (`EventTiers.tsx:183,255`). The participant drawer likewise explains why there is no delete button (`OrganizerParticipants.tsx:610`).
- **M9. Members: role change fires on `<select>` change with no confirmation** (`OrganizerMembers.tsx:186`), including demoting an owner. There are three different role pickers: radio cards (add), a select (list) and a select (platform dialog).
- **M10. Overview tiles for hidden sections.** A viewer sees a «پرسنل پذیرش —» tile pointing to a section they can't open (`viewer-overview-fa-d.jpg`). The viewer participants-lock empty state mentions analytics without linking to it.
- **M11. Desk inside the organizer shell shows «…» as the event name**, because the desk never loads it (`desk-fa-d.jpg`).
- **M12. CSV wording is inconsistent:** «خروجی CSV», «دریافت فایل اکسل ترددها (CSV)», «حضور جلسه (CSV)», «دریافت فایل نمونه».
- **M13. Platform Organizers.**
  - The most prominent row button is the solid red *Revoke access* (`PlatformOrganizers.tsx:192`). Pairing *Revoke* is also solid red (`ScannerPairingDialog.tsx:340`).
  - On a phone the create field shrinks to about 100 px beside the button (`pf-orgs-fa-m.jpg`).
- **M14. Platform SMS is one long page:** gateway, health, caps and 2 templates. Outbox health, the thing to watch on event day, is the second card. Every field carries an "از فایل .env" source line (`PlatformSms.tsx:144,438`).
- **M15. Sections fetch the event themselves:** Program, Venue, Studio, Panel, SMS and Analytics don't use `useEventWorkspace`. That means different skeletons, errors and gating, and extra requests (`eventWorkspaceContext.ts:43-55`).

### Low
- L1. Archived events mix into the list, and "live/upcoming" counts include them. The 3-tile portfolio strip says little.
- L2. Event cards carry a 15–17 rem decorative signature panel. The overview hero is ≈ 480 px of decoration on desktop.
- L3. Mobile numbers are grouped Persian digits in tables but raw Latin in the SMS log and booth staff (`09121234567`).
- L4. Footer tagline «دسترسی تفکیک‌شده…» and rail tagline «مدیریت چندمستأجره همایش‌ها» are jargon (`OrganizerLayout.tsx:272,432`).
- L5. The archive button is a ghost button that reads like a heading (`EventSettingsPanel.tsx:146`).
- L6. A viewer can open `/organizer/members` by URL and see member mobiles (nav hides it).

What works (keep): Page Studio stale 409 and leave guard, the webfix2 activity/member wording, analytics role-gated exports and the "وقت تهران" label, platform members dialog, participant drawer actions, check-in archived points collapsed, empty state for events with a create action, dialogs as bottom sheets on phones.

---

## 3. Simplification spec (per screen)

General rules (all screens):
- Remove the `01…13` indexes: nav, `SectionHeader index`, KPI tiles, event-card "01", tier rows, "G-01", the studio «06».
- Remove the header `description` everywhere. Keep only a one-line `hint` where a control is not self-explanatory.
- One primary (filled) button per screen, at the header end. Everything else is secondary, or goes in a row "⋯" menu for destructive actions.
- Destructive actions (delete, revoke, cancel) are never solid red in lists: use a ghost/danger-text button inside the overflow, and confirm with `ConfirmDialog`.
- Write actions are hidden by `canEdit` (role ≥ manager **and** not archived). Staff actions by `can("staff")`.

### Navigation (rail / phone)
New event workspace nav: two labelled groups, no numbers.

| Group | Item (fa / en) | Route | Replaces |
|---|---|---|---|
| — | نمای کلی / Overview | `` | Overview (becomes the day dashboard, see below) |
| روز همایش / Congress day | شرکت‌کنندگان / Participants | `/participants` | 11 |
| | نقاط ورود / Check-in points | `/check-in` | 05 + device health |
| | میز پذیرش / Reception desk | `/operators` | 07 operators + 13 desk entry (section shows "Open desk" primary + operators list for managers) |
| | آمار / Statistics | `/analytics` | 12 |
| راه‌اندازی / Setup | برنامه / Program | `/program` | 02 + 03 venue (tabs: جلسه‌ها / سالن‌ها و ورودی‌ها / فایل‌ها) |
| | انواع کارت ورود / Ticket types | `/tiers` | 04 |
| | غرفه‌ها / Booths | `/booths` | 06 |
| | صفحهٔ عمومی / Public page | `/page` | 08 + 09 panel (preview switch «صفحهٔ عمومی / پنل شرکت‌کننده») |
| | پیامک / SMS | `/sms` | 10 |

- 10 items instead of 13. `/venue` redirects to `/program?tab=venue`, `/panel` to `/page?preview=panel`, and `/desk` stays (the desk itself).
- Rail order: Overview first, then the Congress-day group. On the phone strip, use the same order (Overview, Participants, Check-in, Desk, Statistics…) so the day-of items are visible without scrolling.
- Org nav (no event): همایش‌ها / Congresses, اعضا / Members, گزارش فعالیت / Activity, unchanged and unnumbered.
- Rail: delete the tagline «مدیریت چندمستأجره همایش‌ها» and the footer sentence «دسترسی تفکیک‌شده…». The rail's event block shows name, status chip (add an «بایگانی‌شده» chip) and dates. Remove the separate «صفحه عمومی» link (it lives in Overview/Studio), and hide it entirely when archived.
- Phone header: one 56 px bar (back to congresses ← | event name, truncated | ⋯ menu holding language, sign-out, public page), plus the tab strip. Remove the brand row inside a congress.

### Sign-in (organizer gate)
- REMOVE: on phones the whole marketing panel (show it ≥ 1024 px only); the "security note" paragraph; the description under the title.
- KEEP: title «ورود به کنسول برگزارکننده / Sign in to the organizer console», segmented mobile | API key, form.
- Primary: «ارسال کد / Send code», then «ورود / Sign in».
- Chooser: title «کدام سازمان؟ / Which organization?» and the list, with no description. Add «تغییر سازمان / Switch organization» in the rail identity menu for members with more than one organizer (re-runs sign-in; no new API).
- Key tab: one hint line «برای یکپارچه‌سازی و مدیر فنی؛ نقش مالک / For integrations; acts as owner».

### Congresses list
- REMOVE: the 3-tile portfolio strip, the decorative signature panel (use a 4 px accent bar instead), the per-card *Edit / Desk / Analytics* buttons and the "01" index.
- MERGE: the whole card is the link to the congress. The public page becomes a small icon link «صفحهٔ عمومی ↗».
- Group: *active* first; then a collapsed «بایگانی‌شده (n) / Archived (n)» group (like archived check-in points).
- Primary: «همایش جدید / New congress» (manager+).
- Empty: «هنوز همایشی ندارید / No congresses yet» + primary button. For non-managers, «از مالک سازمان بخواهید همایش بسازد / Ask your owner to create one».
- Create dialog: name, address (slug, auto), start/end, venue. Move time zone (default Tehran), registration window and description to the settings dialog. Show validation inline under the field (`aria-describedby`), not as a bottom alert.

### Overview (the day dashboard)
- REMOVE: the dark hero (keep a compact header: name, status, dates, «صفحهٔ عمومی ↗»), the six count tiles, the "Live stats" and "Desk" promo cards, and the *Edit congress* button in the hero.
- When the congress is **in progress**: show 4 live numbers (admitted / registered / inside now / scanners stale or unsynced) linking to Statistics and Check-in, plus *failed SMS (n)* when > 0 linking to SMS.
- When **upcoming**: a setup checklist (program, ticket types, check-in points, public page published, desk operators). Each row has ✓ or a link «افزودن / Add»; this replaces the count tiles.
- KEEP: capacity meter + per-type bars; the settings card, now the single place for «ویرایش / Edit», archive and delete, with archive as a secondary button with icon and text.
- Archived: the banner carries «خارج کردن از بایگانی / Unarchive» (manager).
- Primary: in progress «باز کردن میز پذیرش / Open reception desk» (staff+); upcoming «انتشار صفحهٔ عمومی» if unpublished, else none.

### Program (+ venue + files)
- Tabs: «جلسه‌ها / Sessions» | «سالن‌ها و ورودی‌ها / Halls & entrances» | «فایل‌های برنامه / Schedule files».
- REMOVE: header description; the long column list in the import panel. Replace it with «فایل نمونه را بگیرید، پر کنید و بارگذاری کنید / Download the sample, fill it in, upload it.» plus «دریافت فایل نمونه». Also remove the files-card two-sentence intro (keep «PDF یا تصویر، حداکثر ۸ مگابایت»).
- Primary (Sessions tab): «افزودن جلسه / Add session». Secondary: «ورود از اکسل / Import from Excel» (rename from «بارگذاری جدول زمانی»; open as a Dialog, not an inline panel).
- Day headings: «سه‌شنبه ۱۹ آبان ۱۴۰۵» (fix H3).
- Halls tab: one primary «افزودن سالن», secondary «افزودن ورودی»; reorder arrows only for managers.
- Files tab: upload = one control. Choosing a file opens a small dialog with the label prefilled from the file name.

### Ticket types
- Title «انواع کارت ورود / Ticket types». Primary «افزودن نوع کارت ورود / Add ticket type».
- REMOVE: description, the 3-tile KPI strip (the overview has capacity), «شناسه», row index.
- Row: name · status chip · `412 / 800` meter · sales window (if any) in the event zone · «ویرایش». In ⋯: «بستن ثبت‌نام / Close» when reserved > 0, «حذف / Delete» when reserved = 0.

### Check-in points
- Title «نقاط ورود / Check-in points». Primary «افزودن نقطه ورود / Add check-in point» (manager).
- Top strip (staff+): «دستگاه‌ها: ۵ فعال · ۱ قطع · ۱۴ اسکن همگام‌نشده». Tapping "قطع" scrolls to and highlights the point.
- Card:
  - Header: name, location, policy chip.
  - Rules: at most 3 key/value rows, with no explanatory sentence (the policy sentence moves into the form hint).
  - Device line: «۲ دستگاه · ۱ قطع ⚠».
  - Actions: primary-in-card «دستگاه‌ها / Devices» (staff+), which opens the pairing + device list. Secondary «باز کردن اسکنر / Open scanner» (staff+). ⋯ menu: ویرایش, بایگانی, حذف (manager), «فهرست حضور جلسه (اکسل)» when it is a session door.
- REMOVE: «شناسه», "G-0n".
- Point form: name, location, policy (with its one-line hint). Then «تنظیمات پیشرفته / Advanced» collapsed: ticket types, IN/OUT, prerequisite, session door, daily reset. Fix the duplicated «رده‌های مجاز…» label.
- Devices dialog: list first (name, last seen relative, unsynced, ⚠ stale, ⚠ old version as «به‌روزرسانی لازم»), revoke as a ghost-danger in the row. Below that, «اتصال دستگاه تازه / Pair a new device» (name + issue link). Hide build hashes.

### Reception desk (operators)
- Title «میز پذیرش / Reception desk». Primary «باز کردن میز پذیرش / Open reception desk» (staff+).
- Manager section «اپراتورها / Operators» with secondary «افزودن اپراتور / Add operator», a table and revoke in ⋯.
- REMOVE: description and the footer shield note. Show mobile in the standard format.

### Booths
- Primary «افزودن غرفه / Add booth». Card actions: «نمایندگان / Representatives» (staff+, manager can add), «کد QR استند / Standee QR». ⋯ holds edit, delete.
- REMOVE: `/booth/<id>` path line; description. Full-width single column below 1280 px (currently half-width).
- Standee errors use `localizedApiError`.

### Public page (Page Studio)
- Top bar: status chip + «ذخیره شد ۱۱:۳۰». Primary «انتشار / Publish». Secondary «ذخیرهٔ پیش‌نویس». ⋯ holds «مشاهدهٔ صفحهٔ منتشرشده», «کنار گذاشتن پیش‌نویس», «لغو انتشار».
- REMOVE: the status card that repeats the top-bar chip, the «داده‌های زندهٔ رویداد…» info box (replace it with a lock icon + tooltip on locked sections), and the hard-coded «06».
- Language: one content-language switch («محتوای فارسی / English content») for the editor. Preview follows it; drop the second fa/en switch.
- Preview switch adds «پنل شرکت‌کننده / Attendee panel», which absorbs the Panel section. Delete the "where each block comes from" cards.
- Viewer: the read-only line stays and the editor controls are disabled.

### Participants
- REMOVE: description, the row *Edit* button (keep it in the drawer), and the drawer's "cannot delete" explanation (show delete only when allowed).
- Row = tap opens the drawer (name, mobile, type, status, check-ins). Add a «ورود» (check-in count) column and drop «ثبت‌نام» date from the table (it stays in the drawer).
- Phone: search full width + «فیلتر» button opening a sheet (type, status). Export moves into ⋯ (manager).
- Drawer actions: «ویرایش», «صدور دوبارهٔ کارت ورود», «انتقال کارت ورود», «لغو کارت ورود»; delete in ⋯.
- Scan history: localized rejection reasons.
- Empty: «هنوز کسی ثبت‌نام نکرده / No registrations yet» + link «انتشار صفحهٔ عمومی» when unpublished, else «باز کردن میز پذیرش». Hide filters and export while total = 0.
- Viewer lock state gets a link «مشاهدهٔ آمار / Open statistics».

### SMS
- REMOVE: header description; the green «sms.ir» banner (show a banner only when delivery is `console`/unconfigured, as a warning); the right-column paragraph about OTP and test limits (keep «حداکثر ۱۰ پیامک آزمایشی در ساعت» as the test field hint).
- Primary «ذخیره متن / Save text». Test send stays secondary in the same card.
- Log: map every kind (fallback «پیامک»). Map `last_error` to «ارسال نشد؛ درگاه پیامک خطا داد / Not delivered: gateway error» and put the raw text in a `title`. Retry is secondary and «حل‌شده» ghost.

### Statistics
- Title «آمار / Statistics». REMOVE the description and the offline disclaimer box (replace it with the existing «آخرین به‌روزرسانی» line, plus a chip «برخی اسکنرها همگام نشده‌اند» only when devices report unsynced > 0).
- No filled primary. «توقف به‌روزرسانی» becomes an icon toggle. Exports go in a single «خروجی اکسل ▾ / Export ▾» menu (manager), with two items: «ترددها», «ثبت‌نام‌ها».
- Phone: KPIs first, then filters in a sheet behind «فیلتر».

### Members
- REMOVE: the description and the four role cards below the table (move role meanings into the role picker, as option descriptions).
- Primary «افزودن عضو / Add member» (owner). Row: name, mobile, role chip, status. ⋯ holds «تغییر نقش», which opens a small dialog using the same radio-card picker as Add, with confirm, plus «حذف دسترسی».
- Non-owners reaching the URL see the list without mobiles, or a lock state with a link back.

### Activity
- REMOVE: description. Keep the congress filter as the header action. Hide IP for non-owners, or move it into a row detail.

### Platform console
- Tabs: «وضعیت / Status» (outbox counts, oldest pending, sent last hour/day vs caps, gateway chip; **first**) | «پیامک / SMS» (gateway + caps + templates) | «قواعد ورود» | «برگزارکنندگان».
- REMOVE: header descriptions; per-field «از فایل .env». Replace it with a single chip next to values set in the environment: «از تنظیمات سرور / from server config». Remove the token field hint on the sign-in gate (keep the label «توکن مدیر سامانه»).
- Organizers: create form stacks on phones. Row actions: «اعضا» (secondary), ⋯ holding «تعویض کلید», «لغو دسترسی» (ghost-danger, confirm).

---

## 4. Consistency spec

1. **Section scaffold**: every event section uses `useEventWorkspace()`, `<EventSectionGate>`, `<SectionHeader title action>` (no index, no description) and `<SectionLoadError>`. Migrate Program, Venue, Studio, Panel, SMS and Analytics (M15).
2. **Permissions**: one `canEdit` from the workspace = `can("manager") && !event.archived_at`; `can("staff")` for day actions. Sections must not call `sessionAllows` directly (Program, Venue and SMS do today).
3. **Row actions**: a shared `RowActions` component: ≤ 2 visible buttons + `⋯` menu. It replaces the ad-hoc flex button rows in tiers, check-in, booths, venue, program, members, operators and platform organizers. Add the menu to `components/ui/` (no menu primitive exists yet).
4. **Destructive**: `Button variant="danger"` only inside `ConfirmDialog`. In lists use `ghost` + danger text.
5. **Role picker**: one `RolePicker` (radio cards with descriptions) for organizer add, role change and platform members.
6. **Dates**: one helper in `lib/i18n.ts`, `formatEventDate(iso, locale, { timeZone, style: "day" | "dayTime" | "time" | "short" })`, built on the parts-reordering in `formatLocalizedDate`. Replace raw `Intl` in `sessionTime.ts:76`, `OrganizerParticipants.tsx:489`, `OrganizerSms.tsx:185`, `ScannerPairingDialog.tsx:37`, `OrganizerPageStudio.tsx:45`, `PlatformOrganizers.tsx:119`, `PlatformSms.tsx:473` and `lib/organizerConsole.ts:315`. Event-bound times (participants, SMS log, scans) use the **event** time zone.
7. **Time zone display**: always `timeZoneLabel()` (webfix2), never the raw IANA id (settings card, tier/session form hints).
8. **Mobile numbers**: one `formatMobile()` (grouped, locale digits, `dir=ltr`) everywhere: participants, operators, booth staff, SMS log, members.
9. **Status chips**: `Badge` only. Map `archived` to `warning` + lock, `stale` to `warning`, failed to `danger`.
10. **Errors**: always `localizedApiError`. No raw `detail`, `last_error` or `rejection_reason` on screen.
11. **Network**: organizer and platform clients default to `networkErrors: "result"`, so every load ends in data or an error card with «تلاش دوباره».
12. **Export wording**: «خروجی اکسل / Export to Excel» (the file stays CSV; no "CSV" in fa copy).
13. **Glossary** (fa): «نوع کارت ورود / انواع کارت ورود», «کارت ورود», «نقطه ورود», «اپراتور پذیرش», «جلسه», «کد QR», «ثبت‌نام حضوری». English: "Ticket type", "Ticket", "Check-in point", "Desk operator". Extend `web/tests/glossary.test.ts` to ban «رده», «گیت», «بلیت» in organizer fa copy.

---

## 5. Device-fit spec

| Breakpoint | Layout |
|---|---|
| ≥ 1280 | Rail 18 rem with the 10 grouped items at 40 px each; event block without the signature image; identity/language/sign-out in one 56 px footer row (fits 800 px height without scrolling). Content max 78 rem; Studio uses full width with editor 28 rem, rest preview. |
| 1024–1279 (tablet landscape 1180) | Rail collapses to 4.5 rem icons + tooltip labels (labels in an `aria-label`); content gains ~200 px. Tables keep all columns. |
| 768–1023 (tablet portrait 820) | Top bar (56 px) + tab strip in nav order. Tables: participants keep name, mobile, type, status, check-ins; hide date. Cards one column. Dialogs centred `max-w-xl`. |
| < 768 (phone 390/360) | One 56 px top bar inside a congress (no brand row). Tab strip 44 px with day-of items first. Tables become stacked rows (name + status chip + one meta line), and the row opens the drawer as a bottom sheet. Filters go in a sheet. Header primary action becomes a full-width button under the title only where it is the main task (Participants: none; Check-in: none for staff). Otherwise it is an icon button in the top bar. |

- Touch targets ≥ 44 px for all row actions and the `⋯` menu (the current `sm` button is 36 px; use `md` on coarse pointers).
- Safe areas: bottom sheets and the sticky Studio bar add `padding-bottom: env(safe-area-inset-bottom)`.
- Keyboard: dialog forms submit on Enter. The first invalid field gets focus and an inline error. Mobile inputs use `inputMode="tel"`; quotas and caps use `inputMode="numeric"`. On phones the Studio's sticky action bar hides while the soft keyboard is open (`visualViewport` resize).
- Landscape kiosk (tablet at a desk): not in this scope's screens, except Overview/Statistics. Statistics at 1180×820 should show the 4 KPIs + hourly chart without scrolling. Drop the 3-line header and the disclaimer box to get there.

## 6. Install / PWA
- **Organizer console: no install prompt.** The member session lives in `sessionStorage` (cleared when the tab or app is closed), so an installed icon would ask for an SMS code on every launch. Organizers use it in a browser tab.
- If the product owner wants a congress-day shortcut later, the precondition is a persistent member session (a security decision, not UI). Until then, never show `InstallHint` under `/organizer` or `/platform`.
- **Platform admin: never.**
- **Scanner pairing (organizer → device):** the Devices dialog's issued link is where install matters. After pairing, the scanner page (ops reviewer's scope) should offer "Add to home screen". The organizer dialog only says «پس از باز کردن پیوند روی دستگاه، آن را به صفحهٔ اصلی اضافه کنید» once, as the hint under the link.

---

## 7. Work packages (non-overlapping files; order matters only for WP-A)

**WP-A Foundations (first, blocks the rest; small)**
Files: `api/client.ts`, `components/organizer/EventWorkspaceProvider.tsx`, `components/organizer/eventWorkspaceContext.ts`, `components/organizer/roleAccess.ts`, `components/organizer/WorkspaceUi.tsx`, `pages/organizer/EventSectionUi.tsx`, `components/ui/RowActions.tsx` (new), `components/organizer/RolePicker.tsx` (new), `lib/i18n.ts` (all glossary/title/button copy in §3 + `formatEventDate` + `formatMobile`), `web/tests/glossary.test.ts`.
Accept:
- (a) Unit tests: `formatEventDate("2026-11-10T06:00:00Z","fa",{timeZone:"Asia/Tehran",style:"day"}) === "سه‌شنبه ۱۹ آبان ۱۴۰۵"`. `canEdit` is false for an archived event or a viewer.
- (b) The glossary test bans «رده|گیت|بلیت» in organizer fa strings.
- (c) Playwright offline: `/organizer` with the API aborted shows a `role=alert` + «تلاش دوباره» within 3 s.

**WP-B Shell & navigation**
Files: `pages/OrganizerLayout.tsx`, `lib/organizerWorkspace.ts`, `styles/organizer.css`, `App.tsx` (redirects `/venue`, `/panel`), `components/organizer/OrganizerKeyGate.tsx`, `components/organizer/OrganizerMemberSignIn.tsx`, `pages/OrganizerDesk.tsx`.
Accept:
- At 1280×800 every event nav link is visible without scrolling the rail (40 px items; identity, language and sign-out in one 56 px footer row with a menu).
- No element matches `/^\d{2}$/` in the nav.
- Viewer nav = Overview, Check-in, Statistics, Program, Ticket types, Booths, Public page, SMS.
- At 390×844, `/organizer` shows the *Send code* button above the fold.
- In-congress header height ≤ 104 px (bar + tabs).
- `/organizer/events/:id/venue` redirects to `/program?tab=venue`.

**WP-C Congress list, overview, settings**
Files: `pages/OrganizerEvents.tsx`, `pages/organizer/EventOverview.tsx`, `pages/organizer/EventSettingsPanel.tsx`, `components/organizer/EventEditDialog.tsx`, `components/organizer/eventTiming.ts`.
Accept:
- An event card has exactly 1 link + 1 public-page icon link.
- Archived events sit under a collapsed group.
- The overview has 1 «ویرایش» control.
- An in-progress event shows 4 live tiles; an upcoming one shows the checklist.
- The archived banner has an Unarchive button for a manager.
- Create dialog validation focuses the invalid field (`aria-invalid` + `aria-describedby`).

**WP-D Program, venue, schedule files**
Files: `pages/OrganizerProgram.tsx`, `pages/OrganizerVenue.tsx` (becomes a tab component), `components/organizer/ScheduleFilesManager.tsx`, `components/organizer/TimetableImport.tsx`, `components/organizer/SessionFormDialog.tsx`, `components/organizer/sessionTime.ts`.
Accept: three tabs; the day heading reads «سه‌شنبه ۱۹ آبان ۱۴۰۵»; import opens in a `role=dialog`; viewer sees no add/edit/delete/reorder; archived event the same.

**WP-E Check-in, devices, desk operators**
Files: `pages/organizer/EventCheckIn.tsx`, `components/organizer/CheckInPointFormDialog.tsx`, `components/organizer/ScannerPairingDialog.tsx`, `components/organizer/checkInPolicy.ts`, `pages/organizer/EventOperators.tsx`, `components/organizer/OperatorFormDialog.tsx`. (Coordinate with C2 if `EventOperators.tsx` is still open there.)
Accept:
- Viewer: no Add, Devices, Open scanner, Edit, Archive or Delete.
- Staff: Devices + Open scanner only.
- Device health strip shows the stale count from `/devices` (mock 1 stale).
- No «شناسه» / "G-0" text.
- The point form's advanced fields are collapsed by default.
- Revoke in the devices list is not `variant=danger`.

**WP-F Ticket types, booths**
Files: `pages/organizer/EventTiers.tsx`, `components/organizer/TierFormDialog.tsx`, `pages/organizer/EventBooths.tsx`, `components/organizer/BoothFormDialog.tsx`, `components/organizer/BoothStaffDialog.tsx`, `components/organizer/BoothQrDialog.tsx`.
Accept: a tier with reservations shows «بستن ثبت‌نام» and no «حذف»; no KPI strip; the standee error is Persian; archived means read-only.

**WP-G Page Studio (+ panel preview)**
Files: `pages/OrganizerPageStudio.tsx`, `components/organizer/studio/*`, `pages/OrganizerPanel.tsx` (reduced to a preview component), `pages/OrganizerPagePreview.tsx`.
Accept: exactly one filled button (Publish); one fa/en switch; preview switch includes «پنل شرکت‌کننده»; no «06»; the 409 keep/load dialog and leave guard tests still pass.

**WP-H Participants, SMS**
Files: `pages/OrganizerParticipants.tsx`, `lib/participants.ts`, `pages/OrganizerSms.tsx`, `components/sms/SmsTemplateEditor.tsx`.
Accept:
- A row click opens the drawer; no row *Edit* button.
- A check-ins column exists.
- At 390 px the first row is visible above the fold.
- The SMS log shows no `smsir:` text and no raw kind keys.
- No sms.ir banner when delivery = smsir.
- Times are in the event time zone.

**WP-I Statistics, members, activity**
Files: `pages/OrganizerAnalytics.tsx`, `lib/analyticsTime.ts`, `pages/OrganizerMembers.tsx`, `pages/OrganizerActivity.tsx`, `lib/organizerConsole.ts`.
Accept: exports in one menu and absent for staff/viewer; no disclaimer box; role change asks for confirmation through `RolePicker`; the role cards below the table are removed.

**WP-J Platform console**
Files: `pages/PlatformConsole.tsx`, `pages/PlatformSms.tsx`, `pages/PlatformSignIn.tsx`, `pages/PlatformOrganizers.tsx`, `pages/PlatformOrganizerMembers.tsx`, `pages/platformContext.ts`.
Accept: the Status tab is first and shows outbox counts; no «از فایل .env» strings; revoke is in the overflow and confirmed; at 390 px the create-organizer input is ≥ 300 px wide; members dialog uses `RolePicker`.

Screenshot set to re-shoot after each package: the `run.mjs org|roles|platform` groups at `d,d2,t,tl,m`, plus `flows.mjs` and `offline.mjs`.
