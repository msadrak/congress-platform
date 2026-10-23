# UX-DS: design system and cross-portal consistency (review of `b980385`)

Reviewer id: `ds`. Scope: tokens, shared components, forms and controls, RTL direction, Persian type and numbers,
visual noise, across all seven portals (public, attendee, organizer, platform, desk, scanner, exhibitor).
I also checked new UI on the open branches `ws/webfix1-public-attendee`, `ws/webfix2-console`, `ws/b6b-exhibitor`,
`ws/c2-desk` and `origin/ws/team2-pwa1-pwa-settings`.

Evidence: screenshots live in `/private/tmp/claude-501/-Users-mahdi-AITeb-Congress/e0633dca-6f77-4db9-8d0d-5bfdf63eb3a9/scratchpad/ux-review/ds/shots/`.
They are named `<screen>-<fa|en>-<m|d|s|tl>.jpg`, where m = 390×844, d = 1440×900, s = 360×740 and tl = 1180×820.
Computed-style probe output is in the files named `…/ux-review/ds/probe-*.json`. The probe script is `…/ux-review/ds/probe.mjs`.
I rendered 28 screens: 28 at phone fa, 28 at desktop fa, 9 in English (phone and desktop), and 4 at 360 px and at tablet landscape.
I also rendered the dialogs (`dlg-*.jpg`) and NotFound (`x-notfound-*.png`).
The mock API is the shared harness, updated for this ref: check-in points now carry `reset_window`, `tracks_occupancy`,
`requires_point_id`, `session_id` and `archived_at`.

---

## 1. Personas and scenarios (DS lens)

The design system is the only thing all personas share. These scenarios stress it:

| # | Scenario | DS risk found |
|---|---|---|
| S1 | One person, several roles: the access API returns ATTENDEE + PARTNER (exhibitor) + RECEPTION. The same phone moves from `/c/:slug/my-congress` to `/booth/:id` to `/reception/:id`. | Each portal has its own buttons, inputs, headers, language toggle and hero card, so the user relearns the UI three times. |
| S2 | Switch language halfway through a task, on any portal | 9 different language toggles. Some show English sub-labels under Persian (scanner `BiLabel`). |
| S3 | Persian user enters a date (organizer: event, tier sales window, session) | The native `datetime-local` shows a Gregorian `mm/dd/yyyy, --:-- AM` picker in Latin digits and a monospace font (`dlg-tier-fa-m.jpg`, `dlg-edit-event-fa-1440.jpg`). |
| S4 | Persian user reads numbers (counts, clocks, mobile numbers, indexes) | Persian digits and Latin digits are mixed on the same screen (scanner `0`, `1`, `09:34:26`; organizer rail `01…13`; desk `01/02/03`). Persian digits are set in IBM Plex Mono, which falls back to another font. |
| S5 | Long names and long locations on a 360–390 px phone | The exhibitor placard squeezes the booth code into a 1-character column that runs off-screen (`exhibitor-fa-m.jpg`, the vertical "a r y a - t e b"). |
| S6 | Keyboard-only desk operator, or a screen-reader user | Field errors are not linked to their fields (`aria-describedby` appears in only 7 files). Input borders measure 1.30:1 against white. On ink, two different light-grey focus outlines appear. |
| S7 | Gate operator in sunlight with gloves, on a phone or a tablet in landscape | Scanner controls have 5 different heights and radii. The scanner shows Persian text in a monospace font with the letters disconnected (`scan-unpaired-fa-m.jpg`). The installed PWA was locked to portrait (fixed on pwa1). |
| S8 | Organizer on a phone | About 220 px of rail chrome (brand, back link, event name, status, tabs) sits above a second ink hero that repeats the event name (`org-overview-fa-m.jpg`). |
| S9 | Offline / loading / empty / error | There are 4 empty-state designs, 3 toasts, 2 spinners plus 9 ad-hoc `animate-spin`, and about 80 hand-written alert boxes. |
| S10 | Printing (pass, desk badge, booth standee) | There are 3 separate print stylesheets for the same "pass/badge alone, black on white" job. This is acceptable, but the QR plate is implemented 4 times. |

---

## 2. Findings (ranked)

### Critical

**C1. Persian date entry uses a Gregorian, Latin-digit, monospace picker.**
- Where: `components/organizer/EventEditDialog.tsx:179,184,224,228`, `components/organizer/TierFormDialog.tsx:232,240`, `components/organizer/SessionFormDialog.tsx:120,123`, `pages/OrganizerEvents.tsx:412,416,451,455`. All are `type="datetime-local"` with `ui-input font-mono`.
- Evidence: `dlg-tier-fa-m.jpg` shows `mm/dd/yyyy, --:-- --`. `dlg-edit-event-fa-1440.jpg` shows `11/10/2026, 08:30 AM`.
- Why it hurts: an Iranian organizer has to convert آبان ۱۹ to 11/10 in their head to schedule a congress. Every other screen shows Jalali dates, so the input and the output disagree. `lib/jalali.ts` already exists, but only CSV import uses it.

**C2. Persian text is set in IBM Plex Mono, which has no Arabic-script glyphs, so letters render disconnected.**
- `components/scanner/ScannerChrome.tsx:146` (`SystemReadout`, `lang="en" dir="ltr" font-mono` but it holds Persian lines): `scan-unpaired-fa-m.jpg`.
- `components/organizer/EventEditDialog.tsx:169` timezone `<select>` with `font-mono`, showing «(وقت ایران)» letter-spaced: `dlg-edit-event-fa-1440.jpg`.
- Persian digits in mono: `styles/public.css:116` `.pub-index`, `pages/OrganizerParticipants.tsx:510,628` (mobile numbers), and the platform SMS counters.
- Cause: `lib/i18n.ts:829` `codeFontClass()` exists to prevent exactly this, but only some places call it. There are 142 `font-mono` uses in 62 files.

### High

**H1. The radius scale is inverted, and buttons get a bigger radius as they get smaller.**
- `index.css:77-81` redefines `--radius-sm/md/lg/xl` in unlayered `:root`. That overrides Tailwind's theme for `rounded-sm…xl`, but not for `2xl`/`3xl`.
- Measured: `rounded-lg` 14px, `rounded-xl` **20px**, `rounded-2xl` **16px**, `rounded-3xl` 24px.
- `buttonStyles.ts:23-26` therefore gives sm 14px, md 10px, lg 20px and xl 16px.
- `rounded-xl` (169 uses) and `rounded-2xl` (168 uses) are used as if xl < 2xl.
- There are 8 more one-off radii (`rounded-[10px|12px|18px|20px|22px|24px|28px|32px|44px]`), plus `shape-arc` / `shape-arc-lg` / `--radius-arc` (34px / 56px).

**H2. Control sizes are not a system.**
- Probe, phone fa: filled buttons come in **14 heights** (32, 34, 36, 37, 40, 44, 47, 48, 52, 54, 56, 58, 60, 62, 64) and **6 radii**.
- Fields: `.ui-input` is 50 px because `min-block-size: 46px` grows with the fa line-height of 1.75. `.ui-select` is 46 px in the same form (`dlg-edit-event`). `.scanner-input` is 52 px with radius 12. `.rx-command-input` is 64 px with radius 18. The desk text input is 56 px at 18 px font.
- Textareas use `ui-input` instead of `ui-textarea` in 7 places (probe `textarea … cls:ui-input`).
- Button sizes are used sm 136×, md 129×, lg 70× and xl 9×. sm is 36 px, which is below the 44 px used everywhere else for touch.

**H3. Field boundaries fail non-text contrast.** `--border-default #E3E0EF` on white is **1.30:1**, and `--border-strong` is 1.69:1. WCAG 1.4.11 needs 3:1 for the boundary of a text input. On a phone in daylight the fields almost disappear (`org-participants-fa-m.jpg`, `platform-sms-fa-d.jpg`).

**H4. Wrong logical direction (RTL).** `Icon` already mirrors `arrow-left/right`, `chevron-left/right`, `arrow-up-right` and `logout` in RTL (`components/ui/Icon.tsx:99,107`). Callers that flip again end up pointing the wrong way:
- `pages/NotFound.tsx:27` uses `dir === "rtl" ? "arrow-right" : "arrow-left"`. «بازگشت» therefore points **left** (forward) in Persian (`x-notfound-fa-m.png`). Fix: always use `"arrow-left"`.
- `pages/organizer/EventCheckIn.tsx:282` uses `isRtl ? "chevron-left" : "chevron-right"`. The collapsed "archived points" disclosure points **right**, toward the start of the line, in Persian. Fix: always use `"chevron-right"` (rendered as ‹ in RTL).
- `components/scanner/ScanLog.tsx:38`: "ارسال صف / Sync now" uses `arrow-up-right`, which shows as ↖ in RTL (`scan-fa-tl.jpg`). This is a semantic mismatch, not a direction. Use `upload` or `sync`, which are not mirrored.
- `components/scanner/DirectionToggle.tsx:30`: IN = `arrow-right`, OUT = `logout`. These two glyphs are from different families. Add a `login` icon (mirror of `logout`) so IN and OUT are a symmetric pair.
- Inconsistent but not wrong: navigation rows use `chevron-right` in `layouts/PublicLayout.tsx:191,277` but `arrow-right` in `pages/Me.tsx:109`, `components/attendee/CongressHomeView.tsx:477`, `components/organizer/OrganizerMemberSignIn.tsx:88` and `components/public/PublicEventList.tsx:88` (webfix1). Rule: a **row that opens something** uses a chevron. A **call-to-action button** uses an arrow.
- Correct and to keep: all 11 `arrow-left` "back" links (`GateScanner.tsx:1350,1438`, `PublicBooth.tsx:253,284`, `OrganizerLayout.tsx:285`, `PlatformConsole.tsx:144`, `EventSectionUi.tsx:55`, `OrganizerPageStudio.tsx:607`, `OrganizerKeyGate.tsx:99`, `ReceptionStation.tsx:570`) and the `chevron-down` + `rotate-180` disclosures.

**H5. Numbers and dates are formatted in 20+ places with different results.**
- `components/organizer/sessionTime.ts:76` uses ICU `fa-IR-u-ca-persian` with weekday + year. It renders «۱۴۰۵ آبان ۱۹, سه‌شنبه»: year first, Latin comma (`org-program-fa-m.jpg`, the day headings). `lib/i18n.ts:798` already fixes this with `formatToParts`, but sessionTime doesn't use it.
- `pages/PlatformSms.tsx:474` uses `dateStyle:"short"` and gets «۱۴۰۵/۸/۱۹, ۹:۳۰» (Latin comma).
- `components/scanner/copy.ts:403` `clockTime` is `en-GB`, so Latin `09:34:26` appears in Persian. `ConflictDrawer.tsx:101-102` calls `toLocaleString()` with no locale (browser default, Gregorian).
- Scanner counters render Latin `0` and `1` (`scan-fa-m.jpg`). The exhibitor lead count shows a Latin `2` (`exhibitor-fa-m.jpg`).
- Percentages: `EventTiers.tsx:177` builds `{fmt(pct)}%`, so the Latin `%` follows Persian digits. Use `Intl` `style:"percent"` (gives `٪`).
- Duplicate formatters: `public/format.ts`, `attendee/zonedFormat.ts`, `attendee/congressTime.ts`, `organizer/sessionTime.ts`, `lib/analyticsTime.ts`, `lib/organizerConsole.ts:139`, `lib/i18n.ts:798,835`, `attendee/attendeeCopy.ts:10 n()`, `public/copy num()`, `BoothDirectory.tsx:214`, `OrganizerPanel.tsx:394`, `MobileOtpForm.tsx:162`, and inline `Intl` calls in `ScannerPairingDialog.tsx:37`, `OrganizerSms.tsx:185`, `OrganizerParticipants.tsx:489`, `PlatformOrganizers.tsx:116`, `OrganizerPageStudio.tsx:45`, `ResendPassSms.tsx:75` and `programFiles.ts:190`.

**H6. Decorative noise is everywhere, and every portal repeats the same "ink hero card".**
- Counts at b980385: `eyebrow` 118, `bg-meridian` 33, `CongressSignature` 28 (21 files), `shape-arc` 54, `ArcMotif/ArcStroke` 11, `rule-arc` 6, numbered section indexes in 21 files (`SectionIndex`, `sectionIndex()`, `.pub-index`, `.scanner-index`, `.org-nav-index`, hand-typed `01/02/03` in desk), and gradient hairlines in 12 files including every Dialog.
- Repeated hero cards: organizer overview (`org-overview-fa-m.jpg`: the event name appears 3 times above the fold), desk (`reception-authed-fa-m.jpg`), attendee my-congress (`my-congress-fa-m.jpg`), exhibitor (`exhibitor-fa-m.jpg`) and scanner setup (`scan-unpaired-fa-m.jpg`).
- The indexes mix digit systems on the same screen: desk `01` Latin, scanner `۰۱` Persian, studio `01…07` Latin.

**H7. Field errors are not associated with fields.**
- `components/organizer/WorkspaceUi.tsx:117` `Field` has no `error` prop.
- 43 raw `ui-label` labels sit outside `Field`.
- `aria-invalid` is used in 16 files, but `.ui-input[aria-invalid]` is the only styled error (`index.css:418`); select and textarea show no error.
- `aria-describedby` for errors appears only in `MobileOtpForm`, `ScanPanel` and `SmsTemplateEditor`.

**H8. Shared primitives exist but are bypassed. The same thing is implemented again on every branch.**
- Inline alert boxes: 80 hand-written `border-status-*-border bg-status-*-bg` blocks in 30+ files. New ones keep arriving: b6b `LeadList.tsx:312-356` (6 more), c2 `DeskActions.tsx:82`.
- `Card` (`components/ui/Card.tsx`) has **0 uses**.
- Segmented controls: 9 implementations (`MyProfile.tsx:381` radiogroup, `MyNetwork.tsx:374` tablist, `OrganizerPageStudio.tsx:459` tablist, `reception/ModeSwitch.tsx`, `scanner/DirectionToggle.tsx`, `booth/RatingControl.tsx`, `studio/StudioFields.tsx:82 Choice`, `ProgramExplorer.tsx:33 ChipGroup`, and the b6b `LeadList.tsx:235` view toggle).
- Language toggles: 9 (`PublicLayout`, `AttendeeLayout`, `AttendeeSignIn.tsx:48/74`, `LinkPassEntry.tsx:64`, `ReceptionPortal.tsx:42`, `PlatformConsole.tsx:134`, `OrganizerLayout.tsx:210`, `OrganizerKeyGate.tsx:105`, `ExhibitorPortal.tsx:560`, scanner `LanguageSwitch`).
- Switches: 2 (`attendee/SettingSwitch.tsx`, `OrganizerPageStudio.tsx:624`), plus native checkboxes styled with `accent-aiteb-indigo` (7).
- Section headers: 2 components both called `SectionHeader` (`organizer/WorkspaceUi.tsx:43`, `attendee/SectionHeader.tsx:17`), plus `EditorialSection`, `ModuleHeading`, `BiHeading` and the desk's hand-made headings.
- Empty/error/loading: `ui/PortalState.tsx StatusPanel`, `WorkspaceUi EmptyState`, `EventSectionUi SectionLoadError/SectionNotice`, `CongressSchedule ScheduleEmpty`, `PageSections EmptyBlock`, `scanner SetupPanel`, `MyTickets StatusLine`, `MyProfile MessageLine`.
- Toasts: 3 (`public/EventActions.tsx:121`, b6b `booth/UndoToast.tsx`, `AppUpdatePrompt.tsx:22`).
- Spinners: `scanner-spinner`, b6b `BoothSpinner`, and 12 ad-hoc `animate-spin`.
- Status chips: `Badge`, `reception/ReceptionPass.tsx:61 TicketStatusChip`, `OrganizerParticipants.tsx:494 StatusBadge`, `attendee/PhaseBadge`, `.at-pass-chip`, `booth RatingChip`, `.scanner-policy`.
- Meters: `.org-meter` + `Meter`, and `.pass-meter`.
- QR plates: `.at-qr-plate`, `.org-plate`, `ReceptionPass`, and c2 `.rx-badge-qr`.
- Monograms: `attendee/Monogram`, `booth LeadMonogram`, `network/ContactCard`.
- Custom modal shells beside `Dialog`: `scanner/ConflictDrawer.tsx:59`, `GateScanner.tsx:1482`. `QrFullscreen` is a legitimate exception.
- Focus-ring constants are copied (`ReceptionStation.tsx:472`, `AttendeeLayout.tsx:71`, c2 `deskTypes deskFocusRing`).

### Medium

- **M1. The typography scale is ad hoc.**
  - 187 arbitrary `text-[Npx]`: `13px` 66, `11px` 50, `0.6875rem` 26, plus 12.5 / 13.5 / 11.5 / 15 / 17.
  - Weights include `font-[650|660|680|760|800]`.
  - H1 on phone ranges over 24, 26.4, 28, 32, 33.6 and 38.4 px with weights 600–800 (probe `H1`).
  - 78 places set Persian text at ≤ 11 px. Vazirmatn below 12 px is hard to read.
- **M2. Hard-coded hex values in TSX** (54 hits in 15 files, e.g. `DirectionToggle.tsx:36-42 #0F7A55 #B86E00 #2B1A02 #FFD08A`, `ExhibitorPortal` `inkControl`). There are also unused tokens: `--color-brand-*` (3 uses in all), `--aiteb-magenta/blue/graphite/violet`, `--grad-aiteb-arc`, `--shadow-hairline`, `--animate-shimmer`.
- **M3. Select chevron.** `index.css:432-439` positions it with physical `background-position` and a `[dir=rtl]` override. An `ltr` select inside an RTL page (timezone) keeps the RTL chevron position while its padding follows `ltr`. Use a wrapper with an `Icon` at `end-3`.
- **M4. Focus visibility on ink is inconsistent.** Rail controls show grey `rgb(220,218,236)` / `rgb(185,182,211)` outlines, while nav links show orchid. On light surfaces, inputs show only a 12 %-alpha 4 px ring plus a 1 px indigo border (focus probe in `dialogs.mjs focus`).
- **M5. The scanner shows Persian and English together** (`BiLabel`/`BiHeading`, 12 uses): «ارسال صف / Sync Queue Now», «احراز هویت این دستگاه / Authorize This Device». A language toggle exists, so this doubles the text.
- **M6. The exhibitor placard grid breaks with long locations.** `pages/ExhibitorPortal.tsx:584` uses `grid-cols-[auto_minmax(0,1fr)]` with `break-all` on the slug.
- **M7. Two copy catalogs for the install hint** (`attendee/attendeeCopy.ts:41-42` and `attendee/InstallHint.tsx:13-26`). There are 823 inline `isRtl ? "…" : "…"` ternaries in 51 files.
- **M8. Terminology drifts across portals.** In code (excluding `schema.d.ts`): «بلیت» 52, «رده» 68, «گیت» 51. The decided terms are «نوع کارت ورود», «کارت ورود» and «نقطه ورود». Example: `pages/organizer/EventTiers.tsx` title «رده‌های بلیت و سهمیه‌های پذیرش» (`org-tiers-fa-d.jpg`), `lib/participants.ts:72-136`. The desk heading also says «(Walk-In)» inside the Persian label (`reception-authed-fa-m.jpg`).

### Low

- L1. `Dialog` names its close button by sniffing the nearest `[dir]` (`Dialog.tsx:181`). Pass `closeLabel` instead.
- L2. `Button` has no `loading` state. Callers swap the label text and add their own spinners.
- L3. The manifest `orientation:'portrait'` (`vite.config.ts:56`) locks the installed app. pwa1 changes it to `any`, which is correct, so merge it.
- L4. `.eyebrow` uses `text-transform: uppercase` and `letter-spacing` for Latin text, and a gradient `::before` bar.

---

## 3. Simplification spec (global; it applies to every screen in every portal)

Brand identity to **keep**:
- AIteb indigo as the only action colour.
- The AIteb mark in headers.
- Vazirmatn (fa) and Schibsted Grotesk (en).
- The ink surface for the organizer rail and the scanner, where a dark "instrument" makes sense.
- The per-congress `--event-accent`.
- `CongressSignature` only on (a) the public event hero, (b) the attendee pass card, (c) the event thumbnail in the organizer events list.

**Remove globally:**
1. Numbered section indexes everywhere: `SectionIndex`, `sectionIndex()`, `.pub-index`, `.scanner-index`, `.org-nav-index`, and the desk's `01/02/03`.
2. Eyebrows in product chrome: every `eyebrow` prop or element that is not organizer-authored page content. Authored hero and section eyebrows in the Page Studio document stay as plain small text, with no gradient bar and no uppercase.
3. `bg-meridian`, `bg-meridian-ink`, `.pub-hero-grid`, `.pub-landing-grid`, `.pub-landing-glow`.
4. `rule-arc` and `scanner-rule` under headers. Use a plain 1 px `border-subtle`, or nothing.
5. `ArcMotif` and `ArcStroke` decorations. Keep `AitebLogo`.
6. `CongressSignature` in: the organizer rail mini-card and the overview hero, the desk hero, the attendee my-congress hero, `SignInPrompt`, `Me` cards, the exhibitor header, `PassesPanel`, the CTA block and the `OrganizerKeyGate`.
7. The 3 px gradient hairline at the top of `Dialog` (`Dialog.tsx:164`) and of cards (`CongressHomeView`, `MyProfile`, `BoothQrDialog`).
8. The decorative concentric circles in `StatusPanel` and `EmptyState`.
9. `shape-arc` and `shape-arc-lg` (the asymmetric big corner). Use the uniform card radius.
10. Gradient text (`text-gradient-aiteb`, used on `Home.tsx` only).
11. The "ink hero cards" in product portals: organizer overview, desk, my-congress, exhibitor and scanner setup. Replace each with `PageHeader`: title + one meta line + one primary action. The organizer rail already shows the event, so the overview page header shows only the KPIs and the next actions.
12. Bilingual sub-labels on the scanner (`BiLabel`, `BiHeading`, `.scanner-bi-en`).
13. Long subtitles under page titles. Allow at most one line of ≤ 80 characters. Move explanations into the `hint` of the relevant field or into an `Alert` that appears only when it applies.
14. `.reveal` scroll animations and `animate-rise` on content. Keep `animate-pop` for dialogs and toasts.

**Minimal shared copy (fa / en).** Add it once to the shared catalog (`components/ui/uiCopy.ts`, see WP-DS1):

| key | fa | en |
|---|---|---|
| close | بستن | Close |
| cancel | انصراف | Cancel |
| save | ذخیره | Save |
| delete | حذف | Delete |
| retry | تلاش دوباره | Try again |
| back | بازگشت | Back |
| search | جستجو | Search |
| clearSearch | پاک کردن جستجو | Clear search |
| loading | در حال بارگذاری… | Loading… |
| offline | آفلاین هستید؛ داده‌ها ذخیره‌شده‌اند | You're offline; showing saved data |
| optional | اختیاری | optional |
| signOut | خروج | Sign out |
| undo | بازگرداندن | Undo |
| langToggle (visible) | English | فارسی |
| langToggle (aria) | تغییر زبان به انگلیسی | Switch to Persian |
| install | افزودن به صفحهٔ اصلی | Add to Home Screen |
| copied | کپی شد | Copied |

---

## 4. Consistency spec: one component set for every portal

Every portal uses **only** the following, from `web/src/components/ui/`. Portal folders keep only domain components
(pass card, lead card, viewfinder, studio editors), and those are built from these primitives.

| Component | Spec | Replaces (delete after migration) |
|---|---|---|
| `Button`, `LinkButton`, `IconButton` | Variants: `primary`, `secondary`, `ghost`, `danger`. `tone="ink"` adapts all of them to ink surfaces (orchid focus ring, white/8 % fills). Sizes: `sm` 40 px, `md` 48 px (default), `lg` 56 px (scanner, desk, sticky mobile CTA). Radius `--radius-control` 12 px. Font 15/600 fa, 14/600 en. `loading` prop (spinner + `aria-busy`, width kept). `IconButton` is 44×44 with a required `label`. | `outline` (→ secondary), `ink`/`light` (→ `tone="ink"`), `xl`, studio `IconButton`, `.scanner-tool`, ExhibitorPortal `inkControl`, the Dialog close button markup, `BoothSpinner` |
| `Field` | `label`, `hint`, `error`, `required` or `optional`. Generates the id. Passes `id`, `aria-describedby` and `aria-invalid` to its single child control. The error line is 13 px `status-danger-text` with an `alert` icon, shown under the control. | `WorkspaceUi.Field`, the 43 raw `ui-label` blocks, `FormAlert` for field-level errors |
| `TextInput`, `Textarea`, `Select`, `SearchInput`, `CodeInput` | One look: height 48 (textarea min 96), radius 12, `--border-input` (≥ 3:1), placeholder `text-muted`, focus = 2 px `focus-ring` outline offset 0 plus an indigo border, error = danger border plus a 2 px danger ring, disabled = `surface-panel-subtle`. `Select` wraps the native select with a `chevron-down` icon at `end-3`. `SearchInput` has a search icon at the start and a clear `IconButton` at the end. `size="lg"` (56/18 px) is for the desk command bar. `CodeInput` is `dir="ltr"`, mono, for secrets, keys and tokens only, with the placeholder in the sans font and `dir=auto`. All have `tone="ink"` for the scanner. | `.scanner-input`, `.rx-command-input`, `ui-input font-mono` on non-codes, `ui-input` on textareas |
| `DateTimeField`, `DateField` | **fa:** Jalali day `Select` (۱–۳۱) + month-name `Select` (فروردین…اسفند) + year `TextInput` (۴ digits, Persian digits accepted) + time `TextInput` (`HH:MM`, accepts both digit sets, 24 h). Shows a live read-out line, e.g. «سه‌شنبه ۱۹ آبان ۱۴۰۵، ساعت ۰۸:۳۰ (وقت تهران)». **en:** the same layout with Gregorian month names. Value in and out = the same `datetime-local` string the forms use today, so `sessionTime.ts` conversions stay. Uses `lib/jalali.ts`. No dependency. | the 12 native `datetime-local` inputs |
| `Checkbox`, `Switch` | `Checkbox` is a 20 px custom box in a 44 px label row. `Switch` is the visual of `SettingSwitch` without the extra on/off caption, plus an optional description. | `SettingSwitch`, Studio `role=switch`, `NotifyToggle`, `accent-aiteb-indigo` checkboxes |
| `SegmentedControl` | Radiogroup semantics with arrow-key support. Height 44 (`lg` 52 for scanner/desk). Options are icon + label. `tone="ink"`. | the 9 implementations listed in H8 (`RatingControl` keeps its colours via a `tone` per option) |
| `TabNav` | Route tabs. Horizontal scroll on phones with an end fade. Underline indicator, `aria-current="page"`. | Attendee `TopNav`, the platform tabs, the organizer mobile `.org-nav` strip (the desktop rail stays a vertical list without indexes) |
| `Dialog`, `ConfirmDialog` | Keep the behaviour. Visual: radius 20 desktop / 24 top on the phone sheet, no gradient hairline, no arc corner. Add `closeLabel`, `tone="ink"` and `size="full"` (phone full-height sheet for long forms). | `scanner/ConflictDrawer` shell, the `GateScanner.tsx:1482` storage alert (→ `ConfirmDialog tone="ink"`) |
| `Card` | Use it. Radius 16, `border-default`, `shadow-soft` (no lift on hover unless clickable). Sub-parts: `CardHeader` (title + action), `CardContent`. `tone`: `panel`, `subtle`, `ink`. Delete `shape`. | ad-hoc `rounded-2xl border bg-surface-panel shadow-soft` wrappers (desk sections, LeadList, platform sections) |
| `PageHeader`, `SectionHeader` | `PageHeader`: optional `back` link (`arrow-left`), h1 (fa 24/700 phone, 28/700 desktop), one meta line, actions on the end. `SectionHeader`: h2 18/700 plus an optional action. No eyebrow, index or rule. | both `SectionHeader`s, `EditorialSection` header, `ModuleHeading`, `BiHeading`, the desk headings |
| `Alert` | `tone`: info, success, warning, danger. Optional `title`, `action`, `onDismiss`. `role=status`, or `alert` for danger. 14 px. | `Notice`, `FormAlert`, `SectionNotice`, `SetupPanel`, `StatusLine`, `MessageLine`, and the about 80 inline boxes |
| `Toast` + `useToast()` | One host per app (bottom-centre, above the dock and the safe area). Polite. Optional action (Undo/Copy). Auto-dismiss after 4 s (8 s with an action). | the `EventActions` toast, `UndoToast`, `AppUpdatePrompt` (as a persistent toast with action) |
| `StateBlock` | `kind`: empty, error, offline, forbidden. Icon tile, title, one-line body, one action. No decoration. | `StatusPanel`, `EmptyState`, `SectionLoadError`, `ScheduleEmpty`, `EmptyBlock` |
| `Skeleton`, `Spinner` | `Skeleton` takes rows/blocks presets. `Spinner` comes in sizes 16, 24 and 40 and is `aria-hidden`; the caller provides a status text. | `LoadingBlock`, `.scanner-spinner`, `BoothSpinner`, the ad-hoc `animate-spin` |
| `Badge`, `TicketStatusBadge`, `EventStatusBadge` | Badge radius full, height 24, 12 px/600, optional dot. `TicketStatusBadge` maps active / cancelled / reissued / used in one place with one wording. | `TicketStatusChip`, participants `StatusBadge`, `.at-pass-chip`, `PhaseBadge` (→ `EventStatusBadge` variant) |
| `Meter` | One progress bar: 6 px, or 10 px for `lg`. Tones default, full, muted. Logical fill. | `.pass-meter`, `.org-meter` CSS (moved into `ui`) |
| `MetaList` | `<dl>` grid: label 12 px muted over value 15 px. Stacks to 1 column below 480 px. | booth placard cells, `MetaItem`, the scanner rail cells, the pass field grids |
| `Table` (`.ui-table`) | The `.org-table` rules plus `--stack` on phones. | `.org-table` (rename) |
| `LanguageToggle` | Globe icon + the other language's name. 44 px. `tone="ink"`. One aria string pattern. | the 9 toggles |
| `Avatar` | Initials disc. Optional accent ring for the attendee only. | `Monogram`, `LeadMonogram`, the ContactCard initials |
| `QrPlate` | White plate, quiet zone, never mirrored, `size`. Print-safe. | `.at-qr-plate`, `.org-plate`, the reception QR markup, c2 `.rx-badge-qr` wrapper |
| `Kbd` | Moved from reception. | `ReceptionPass.Kbd` |
| `InstallPrompt` | Generalised `InstallHint` with `persona` copy (pass / scanner / booth). See §6. | `attendee/InstallHint.tsx`, `attendeeCopy.installIos/installAndroid` |
| `Icon` | Keep the set and the auto-mirroring. Add `login` (mirror of `logout`) and `upload` usage for sync. Document the rule: callers never choose a glyph by direction. | — |

**Tokens (`index.css`):**
- **Radius**: move into `@theme` and delete the unlayered `:root --radius-*`. Values: `--radius-sm` 6 (chips inside controls), `--radius-md` 8, `--radius-lg` 12 (**controls**), `--radius-xl` 16 (**cards**), `--radius-2xl` 20 (dialogs, heroes), `--radius-3xl` 24 (phone sheet top). Aliases: `--radius-control: var(--radius-lg)`, `--radius-card: var(--radius-xl)`. Delete `--radius-arc`, `.shape-arc` and `.shape-arc-lg`. In WP-DS0 they temporarily become aliases of `--radius-card`. Ban `rounded-[…]`.
- **Type**: add `@theme` text tokens: `--text-caption` 12, `--text-meta` 13, `--text-body-sm` 14, `--text-body` 16, `--text-title-sm` 18, `--text-title` 24, `--text-title-lg` 28, `--text-display` clamp(32, 5vw, 48). Weights 400 / 500 / 600 / 700 only. In RTL the minimum is 12 px. Ban `text-[Npx]` and `font-[NNN]`.
- **Control heights**: `--control-sm` 40, `--control-md` 48, `--control-lg` 56.
- **Borders**: add `--border-input: #8F8BB3` (3.3:1 on white). Keep `--border-default` for cards and dividers only.
- **Focus**: one rule. Light surfaces get `outline 2px var(--focus-ring)` at offset 2. Ink surfaces get `--focus-ring-ink: var(--aiteb-orchid)` through a `.surface-ink` class on the ink containers (replacing `.org-rail :focus-visible`, `.scanner-root :focus-visible` and the per-control overrides). Inputs also get the outline (not only the 12 % ring).
- **Colour**: delete `--color-brand-*` (replace its 3 uses with action tokens) and the unused `--aiteb-magenta/blue/graphite/violet` theme exports and `--grad-aiteb-arc`. Add the scanner verdict colours (`--scanner-admit`, the direction colours from `DirectionToggle`) as status tokens instead of TSX hex. Ban `[#hex]` in TSX.
- **Fonts**: `font-mono` only through `CodeText` or `CodeInput` (or `codeFontClass`). Never on Persian text or on select/date controls.

**Formatting (`lib/format.ts`, the single module):**
- Functions: `formatNumber`, `formatPercent` (Intl percent → `٪`), `formatCount(n, unit)`, `formatDate(iso, {style: "day"|"dayShort"|"date"|"dateTime"|"time"|"clock"}, locale, tz)`, `formatDateRange`, `formatRelative`, `formatMobile`.
- fa always uses `fa-IR-u-ca-persian` and assembles weekday/day/month/year with `formatToParts` (natural order, Persian comma «،»).
- Times are 24 h with Persian digits.
- Rule: in fa every human-facing number uses Persian digits (counts, clocks, dates, mobile numbers, ranks). Machine codes (QR secrets, slugs, ids, keys, URLs, booth codes, device ids, app version) stay Latin, `dir=ltr`, mono.

---

## 5. Device-fit spec (shared layer)

- **Breakpoints** (one set for all portals): phone < 640, tablet 640–1023, desktop ≥ 1024. The desk and the scanner also need a landscape-tablet layout at 1024–1279 × ≤ 820 in height. Portal reviewers own the layouts; the shared components must work inside a 320 px container.
- **Touch targets**: every interactive element is at least 44×44 (`sm` buttons at 40 px are allowed only in dense desktop tables, with ≥ 8 px spacing). Scanner and desk primaries use `lg` 56 px.
- **Safe areas**: `Toast`, the bottom docks, the phone sheet `Dialog`, and the sticky mobile CTA use `env(safe-area-inset-bottom)` (`pb-safe`). Headers use `pt-safe` in standalone display.
- **Keyboard**: inputs ≥ 16 px (already the case). `SearchInput` uses `enterkeyhint="search"`. `CodeInput` uses `autocapitalize=off spellcheck=false`. `DateTimeField` year/time use `inputmode="numeric"` and accept Persian digits (`asciiDigits`). On phones, dialogs with forms use `size="full"` so the focused field is not hidden by the keyboard; the body scrolls and the actions stay visible at the bottom.
- **Landscape kiosks**: shared components carry no portrait assumptions. `orientation: 'any'` comes from pwa1. `Dialog` max height is `88dvh`.

## 6. Install / PWA (shared `InstallPrompt`)

- **Show** only when all of these hold: the device is touch-primary (`(pointer: coarse)`), the viewport is < 1024 px, the display is not standalone, and the browser can prompt (or it is iOS Safari, which needs the instructions).
- **Attendee**: on the pass page and on `my-congress` after a pass exists (this is the current placement). Copy: «کارت ورود را روی صفحهٔ اصلی گوشی نگه دارید» / "Keep your pass on your home screen".
- **Scanner**: once, right after pairing succeeds, before the first scan. Copy: «اسکنر را به صفحهٔ اصلی اضافه کنید تا تمام‌صفحه و آفلاین کار کند» / "Add the scanner to your home screen for full-screen, offline use". pwa1's `launchTarget` reopens the paired point, so this placement is safe.
- **Exhibitor (booth staff)**: after the first booth sign-in on a phone.
- **Do NOT show** to anonymous public visitors, on desktop, to the desk (usually a laptop or a kiosk browser), to organizer or platform users, during an active scan or desk task, or after a dismissal (keep the existing dismissed key, per persona).
- One dismissible `Card` with a single button. No modal, and no auto-prompt on page load.

---

## 7. Work packages

**Order:**
1. Merge the open branches into `integration/upgrade` first: `ws/b6b-exhibitor`, `ws/c2-desk`, `ws/webfix1-public-attendee`, `ws/webfix2-console`, `origin/ws/team2-pwa1-pwa-settings`. This avoids rebasing every DS package over them.
2. Run **WP-DS0** and **WP-DS2** in parallel, then **WP-DS1**. DS1 needs DS0's tokens; DS2 creates `DateTimeField` in `ui`.
3. Run the portal packages **P1–P7** in parallel.
4. Finish with **WP-Z**.

| WP | Files (exclusive) | Work | Acceptance |
|---|---|---|---|
| **DS0 tokens & base CSS** | `web/src/index.css` | Radius scale moved into `@theme` (H1). Type tokens, control-height tokens, `--border-input`, unified focus (`.surface-ink`). Remove unused tokens. Neutralise decoration centrally: `.eyebrow` → plain 13 px muted with no `::before`/uppercase; `.rule-arc`, `.bg-meridian*` → `display`/`background: none`; `.shape-arc*` → `border-radius: var(--radius-card)`. Class names stay so call sites still compile. `.ui-*` controls → 48 px fixed `block-size`, `--border-input`, a 2 px outline on focus, error styles for select and textarea. Select chevron moved to the component (keep a CSS fallback). | Playwright on 10 screens (fa+en, m+d): `rounded-xl` computed < `rounded-2xl`. Every `.ui-input`, `.ui-select` and non-textarea field is 48±1 px with radius 12. Input border contrast ≥ 3:1 (`contrast.mjs`). No visible `.bg-meridian`/`.rule-arc` background. `npm run build`, `npm run lint` and `npm test` pass. |
| **DS1 primitives** | `web/src/components/ui/**` (except `DateTimeField.tsx`); `components/organizer/WorkspaceUi.tsx`, `components/attendee/SectionHeader.tsx`, `components/attendee/SettingSwitch.tsx`, `components/attendee/Monogram.tsx`, `components/attendee/InstallHint.tsx`, `components/AppUpdatePrompt.tsx`, `components/auth/MobileOtpForm.tsx`, `components/brand/**`, `web/tests/ui*.test.ts` | Build the §4 set. The old modules become thin re-exports or wrappers with the old props (no call-site edits). `MobileOtpForm` → `Field`/`CodeInput`. `AppUpdatePrompt` → `Toast`. `Icon`: add `login`, document the rule. Add `uiCopy.ts`. | A storybook-less fixture route is not needed. Unit tests: Field wires `aria-describedby` and `aria-invalid`; `SegmentedControl` handles arrow keys; Button `loading` sets `aria-busy`. Probe: `Button` heights ∈ {40, 48, 56} and radius 12 on all screens using `buttonClassName`. Build, lint and tests green. |
| **DS2 formatting & dates** | `web/src/lib/format.ts` (new), `lib/i18n.ts` (format functions only → delegate), `components/public/format.ts`, `components/attendee/zonedFormat.ts`, `components/attendee/congressTime.ts`, `components/organizer/sessionTime.ts` (`sessionDateFormats`), `lib/analyticsTime.ts`, `components/scanner/copy.ts` (`clockTime` only), `components/ui/DateTimeField.tsx`, `web/tests/format*.test.ts` | §4 Formatting. The old helpers delegate to `format.ts`. Build `DateTimeField`/`DateField` on `lib/jalali.ts`. | Unit tests: `formatDate(…, "day", "fa")` → «سه‌شنبه ۱۹ آبان ۱۴۰۵». No `,` in any fa output. `clock` in fa uses Persian digits. Percent uses `٪`. `DateTimeField` round-trips «۱۹ آبان ۱۴۰۵ ۰۸:۳۰» ⇄ `2026-11-10T08:30` (Asia/Tehran), including at the Esfand/leap-year edge. |
| **P1 Public** | `pages/Home.tsx`, `PublicEvent.tsx`, `PublicBooth.tsx`, `NotFound.tsx`, `layouts/PublicLayout.tsx`, `components/public/**`, `styles/public.css` | Migrate to DS1. Apply the §3 removals (keep `CongressSignature` only in the event hero). Fix `NotFound.tsx:27`. Rows use chevrons. Delete `.pub-index`, `.pub-hero-grid`, `.pub-landing-*`. | In fa: no visible text node outside `[dir=ltr]` contains `[0-9]`. No mono element contains Arabic script. The NotFound back icon has computed `scale: -1 1` in fa and `none` in en. Screenshots at m and d. |
| **P2 Attendee** | `pages/Me.tsx`, `MyTickets.tsx`, `MyNetwork.tsx`, `MyProfile.tsx`, `AttendeeSignIn.tsx`, `LinkPassEntry.tsx`, `CongressDetails*`, `layouts/AttendeeLayout.tsx`, `components/attendee/**` (not the DS1 files), `components/BoothDirectory.tsx`, `styles/attendee.css` | Migrate. Replace the my-congress hero with `PageHeader` plus the pass card. Use `SegmentedControl`, `TabNav` and `InstallPrompt`. | Same probe. The dock and toast respect the safe area at 360×740. |
| **P3 Organizer** | `pages/Organizer*.tsx`, `pages/organizer/**`, `components/organizer/**` (not `WorkspaceUi`), `components/sms/**`, `styles/organizer.css` | Migrate. Remove the overview hero, the rail mini-card and the indexes. Use `DateTimeField` in the Event, Tier and Session dialogs and in OrganizerEvents. Fix `EventCheckIn.tsx:282`. Remove `font-mono` from the timezone select. Use `formatPercent`. Apply the glossary (M8). | The fa date fields show Jalali months, with no `input[type=datetime-local]` in the DOM. `org-overview-fa-m` shows the event name once above the fold. |
| **P4 Platform** | `pages/Platform*.tsx`, `pages/platformContext.ts` | Migrate (the smallest change set, already closest to target). Date format from `format.ts` (`PlatformSms.tsx:474`). | Same probe. |
| **P5 Desk** | `pages/ReceptionPortal.tsx`, `components/reception/**`, `styles/reception.css` | Migrate. Remove the hero, the `01/02/03` and «(Walk-In)». `SearchInput size="lg"` replaces `.rx-command-input`. `TicketStatusBadge`. `QrPlate`. | Landscape 1180×820 shows search, results, detail and walk-in without page scroll for one result. Same probe. |
| **P6 Scanner** | `pages/GateScanner.tsx`, `components/scanner/**`, `components/QrCameraInput.tsx`, `styles/scanner.css`, `styles/qr-camera.css` | Migrate with `tone="ink"`. Remove `BiLabel`, `SystemReadout` mono for Persian lines, indexes and meridian. Fix `ScanLog.tsx:38` (sync icon) and `DirectionToggle` (login/logout pair and tokens). `ConflictDrawer` → `Dialog tone="ink"`. Show `InstallPrompt` after pairing. | In fa all counters and clocks use Persian digits. No Arabic script in mono. Controls are 48 or 56 px. Screenshots at m, s, tl. |
| **P7 Exhibitor** | `pages/ExhibitorPortal.tsx`, `components/booth/**`, `styles/exhibitor.css` | Migrate (`UndoToast` → `Toast`, `BoothSpinner` → `Spinner`, inline alerts → `Alert`, view toggle → `SegmentedControl`). Placard → `MetaList` (M6). Remove the header `CongressSignature` and arcs. | `exhibitor-fa-m` with the 90-character location: no element exceeds the viewport, and the booth code is on one line. |
| **Z cleanup + guard** | Wrapper deletions in the DS1 files, dead CSS in `index.css`, `web/tests/designGuard.test.ts` | Delete the wrappers and the neutralised classes. Add a grep test that fails on: `rounded-\[`, `text-\[\d`, `font-\[\d`, `\[#[0-9a-f]{3,6}\]` in `.tsx`, `isRtl \? "chevron-`, `dir === "rtl" \? "arrow-`, `bg-meridian`, `SectionIndex`, `eyebrow` (outside `pageDocument`/`PageSections`), `type="datetime-local"`, `new Intl.DateTimeFormat` outside `lib/format.ts`. | The guard test is green. `./scripts/check.sh` passes. A full probe re-run shows ≤ 3 button heights and 1 control radius. |
