# UX-ATT spec: public visitor, attendee, mobile PWA

Reviewed ref: `ws/webfix1-public-attendee` @ b6e1dbe (worktree `.claude/worktrees/ux-att`). Install behaviour also checked against `origin/ws/team2-pwa1-pwa-settings` @ f608e92 (`web/pwa-manifest.ts`, `web/src/lib/launchTarget.ts`).
Rendering: Vite + Playwright (Chrome) with a mock API that follows the current `schema.d.ts`, on port 47610. Viewports: 390×844, 360×740, 820×1180, 1180×820, 1440×900. Persian first, English sampled. Clock fixed for the before/during/after phases.
Screenshots: `/private/tmp/claude-501/-Users-mahdi-AITeb-Congress/e0633dca-6f77-4db9-8d0d-5bfdf63eb3a9/scratchpad/ux-review/att/shots/` (written `shots/<name>` below; `-s1`, `-s2` … are the following screen-heights). Contact sheets are in the parent folder (`sh-*.jpg`).
All `file:line` references are relative to `web/src/` at b6e1dbe.

---

## 1. Persona and scenario inventory

**Public visitor (not signed in)**
- V1 `/` platform home → congress list → `/e/:slug`. V1b: arrives from search, wants their pass → "Find your pass".
- V2 `/e/:slug` hero layouts (signature, cover, and so on) → about / highlights / program (day tabs, track chips, PDF) / venue (entrances, halls, map links) / passes / speakers / booths / FAQ / CTA band.
- V3 Registration states: open; not open yet (`registration_opens_at`); closed (`closes_at` passed); disabled by the organizer; every type sold out; one type sold out; tier sales window; congress live; congress past.
- V4 `/e/:slug/booths/:id`, plus `?b=` from a standee QR (signed out and signed in; already bookmarked).
- V5 Errors: unknown or unpublished slug (404), archived (404), API down, booth 404, unknown route (`NotFound`).
- V6 Language switch on public pages; share, calendar, directions.

**Attendee**
- A1 Reserve while signed out: dialog → mobile → code (auto-submits) → new-number profile step → success sheet. Branches: wrong code, code rate limit (429 countdown), SMS uncertain, signup token expired.
- A2 Reserve while signed in: dock button → success; already registered (409); tier sold out; network error; session expired (401 → dialog).
- A3 Success sheet → pass / calendar / close.
- A4 Confirmation SMS → `/t/:code` → pass shown signed out (link pass, stored on the device); expired link (410).
- A5 `/sign-in` and `/c/:slug/sign-in`: new number + profile, known number, already signed in (continues after 2 s), offline with a stored session.
- A6 `/me`: no congress; one; several (live, upcoming, past); only link passes; staff cards (booth, reception desk); saved booths; offline with a cache; signed out.
- A7 Congress panel `/c/:slug/*`: Home (before, during, after, signed out), Program (`details`: explorer, my agenda), Network (my code, scan, contacts, notes, vCard, empty), Pass (active, several passes, cancelled, offline cached, session expired, full-screen QR, print, self-cancel), Profile (edit, consents, language, export, sign out, delete).
- A8 Congress switcher in the header; language switch; sign out (confirmed).

**Mobile PWA**
- P1 Android Chrome: `beforeinstallprompt` is captured early (`lib/installPrompt.ts`) and offered on the pass page.
- P2 iOS Safari: manual Add to Home Screen; the home-screen app does not share Safari's storage.
- P3 Launch from the home-screen icon: Android uses `start_url` `/?source=pwa` (PWA-1), and `launchTarget.ts` rewrites it to `/` unless the device is a paired scanner. iOS reopens the URL it was added from.
- P4 Standalone display: safe areas, no browser back button, offline launch.

---

## 2. Findings (ranked)

### Critical

**C1. A home-screen launch does not reach the offline pass, and signing in offline is a dead end.**
- With PWA-1, an attendee who installed from the pass page and taps the icon lands on `/`, the organizer marketing page (`launchTarget.ts`: anything that is not a paired scanner goes to `/`). The hero's attendee button goes to `/sign-in`.
- When offline, `AttendeeSignIn.tsx:118` treats a failed `/api/auth/me` as "no session" and shows the phone form, even though a token and a cached pass are stored (`shots/launch-signin-offline-fa-m.jpg`, `launch-home-offline-fa-m.jpg`).
- The only working route is ☰ → "کارت‌های ورود من" → `/me` → congress → Pass tab: 4 or more taps at the gate, with no network. This is the most important attendee moment.

**C2. On iOS the install hint promises offline use that the installed app cannot keep.**
- `InstallHint.tsx:16-18` says "opens with one tap, even without internet". The iOS home-screen app starts with empty storage: no token and no link pass.
- The first launch shows `SignInPrompt`, which is one more tap to the sign-in page (`MyTickets.tsx:333-345`). If the attendee is offline at that point, nothing works.

### High

**H1. The Program tab does not open on the program.** `/c/:slug/details` repeats the hero, a decorative artwork, a fact grid (time, venue, duration, again), About and Venue. The sessions start about 3 screens down (`CongressDetailsView.tsx:119-168`, `shots/details-prog-fa-m*.jpg`). The tab label is «برنامه».

**H2. The install offer exists twice, with different behaviour.**
- `InstallHint` on the pass page is a good prompt.
- The congress Home "before" checklist adds a second offer, "افزودن به صفحهٔ اصلی گوشی / چطور؟", with static iOS and Android instructions (`CongressHomeView.tsx:153-168`, `attendeeCopy.ts:40-43,84-88`). It also shows in standalone mode, ignores `beforeinstallprompt` and is never dismissible.

**H3. On the pass (gate) screen, the QR competes with chrome.**
- Above the card is a status line "به‌روز و آماده نشان دادن در ورودی" even when everything is fine (`MyTickets.tsx:24,426-435`).
- On a link pass, a two-line info banner sits above the QR (`MyTickets.tsx:304-316`, `shots/tlink-fa-m.jpg`).
- The card has a print button on phones (`DigitalPassCard.tsx:59`) and a hint "برای بزرگ‌نمایی، کد QR را لمس کنید".
- Self-cancel (destructive) sits directly under the card with an explanation (`MyTickets.tsx:452-465`).
- The same offline/shared-device footer appears on every attendee page (`AttendeeLayout.tsx:54,70,418-424`).

**H4. The reservation path is long on mobile.**
- The hero CTA only scrolls to `#passes`, which is about 5 screen-heights down at 390 px (`CongressHero.tsx:255-266`). The visitor then taps the reserve dock, and only then does the dialog open.
- In the not-open, closed, sold-out and disabled states, the hero still shows the organizer's CTA label, which scrolls to a section where nothing can be done (`shots/event-notopen-fa-m.jpg`, `event-soldout-fa-m.jpg`).
- After a reservation the hero still says "get a pass".

**H5. The passes block stays a picker after the attendee already holds a pass.**
- The full tier list (radio selected, a sold-out stub) stays on screen. Below it come three statements of the same fact: the box "کارت ورود فعال دارید / شما برای این همایش یک کارت ورود فعال دارید", then the dock "کارت ورود شما آماده است", then "مشاهدهٔ کارت ورود" (`PassesPanel.tsx:106-118,139-145`, `shots/event-heldpass-fa-m.jpg`).
- A sold-out stub shows "تکمیل ظرفیت" and "ظرفیت این نوع کارت ورود تکمیل شده است." side by side.

**H6. Too many header controls in the attendee shell (mobile).**
- The header has four controls: congress switcher, language, profile avatar and a sign-out icon (`AttendeeLayout.tsx:342-408`). Below it sits a four-tab dock.
- Sign-out and language already live in Profile (`shots/profile-fa-m-s2.jpg`).
- A one-tap icon that wipes the offline pass, sitting next to the profile avatar, invites accidents. It is confirmed, but it is still noise.

**H7. Reservation dialog and success sheet copy is three times longer than it needs to be.**
- Dialog: title, a 2-line description, then a mobile hint that repeats the description (`copy.ts:445-446`, `MobileOtpForm.tsx:52`).
- The profile step keeps the dialog title «تأیید شماره موبایل» and submits with "ساخت حساب" instead of "receive my pass".
- Success sheet: title, description, body and SMS line (4 statements), then 3 buttons, including "ماندن در صفحهٔ همایش", which duplicates ✕ (`PublicEvent.tsx:361-416`, `shots/reserve-success-fa-m.jpg`).

**H8. Old ticket wording reaches attendees.** The decided term is «کارت ورود», but these strings still say «بلیت»:
- `lib/i18n.ts:31` «شناسه رهگیری بلیت» on every pass card.
- `lib/i18n.ts:391` on the expired SMS link.
- `lib/i18n.ts:38`.
- `lib/errorMessages.ts:17,22,23` (shown on self-cancel errors).
- English mixes "Ticket Reference ID" with "Pass".

### Medium

- **M1** `/` (`Home.tsx`): the mobile visitor sees a marketing hero and a six-environment panel. The congress list only starts after about 2 screens (`shots/home-fa-m-s1.jpg`). The lifecycle and venue-engineering sections are feature essays (`homeCopy.ts`). A signed-in attendee still gets "find your pass" → `/sign-in`.
- **M2** `/me`:
  - A live congress card opens Home rather than the QR: one extra tap at the gate (`Me.tsx:87-133`).
  - The lead sentence is redundant.
  - The reception-desk card says «میز پذیرش» twice (kicker and heading).
  - The staff section has an explanatory lead.
  - Offline, "غرفه‌ها و میزهای پذیرش شما بارگذاری نشد" + retry shows above the offline list (`shots/me-offline-cached-fa-m.jpg`).
  - Signed out, it shows a card that links to `/sign-in` instead of the form (`Me.tsx:466-476`).
- **M3** Congress Home "before":
  - The hero repeats the congress name, date and venue already in the header.
  - Two countdowns: a chip "۱۸ روز تا آغاز" and a big days/hours/minutes block (`CongressHomeView.tsx:82-100,444-446`).
  - "During": the QR comes after the full hero. During the congress the QR must be first on screen.
- **M4** Network:
  - Home's "اسکن کد QR همکار" opens `?scan=1`, which still needs a second tap on "اسکن با دوربین" (`shots/network-scanq-fa-m.jpg`).
  - The "my code" tab carries an explanatory sentence.
  - The header has an eyebrow, a title and a count.
- **M5** Booth page with `?b=` (standee):
  - Signed out, two stacked cards each have a primary button: "ورود با شمارهٔ موبایل" and "نشان‌کردن غرفه". The second cannot work signed out.
  - Signed in and already saved: a green banner, a card that says the same, and a button.
  - The location renders as a 3-line display headline.
  - An empty "بروشور دیجیتال هنوز منتشر نشده است" card (`PublicBooth.tsx:292-370,462`, `shots/booth-standee-*.jpg`).
- **M6** Public footer and menu:
  - Two policy paragraphs in the footer on every public page (`copy.ts:302,313`).
  - The event-page ☰ menu holds only "ورود شرکت‌کنندگان" and "شبکه ارتباطی" (duplicating the header pill). Signed in, it shows "کارت ورود من" twice (header and menu).
- **M7** Hero fact grid on `/e/:slug`: numbered «۰۱–۰۴» labels, "زمان‌بندی" repeating the dates, and "۱ از ۲ نوع کارت ورود باز است". Numeric indices in `font-mono` with Persian digits appear throughout (`monoFa` hits on `/`, `/e/:slug`, panel `ModuleHeading`/`SectionHeader`).
- **M8** Reservation dialog profile step: no sticky submit. At 360×740 with the keyboard up, "ساخت حساب" falls under the keyboard. `MobileOtpForm` supports `stickySubmit`, but `PublicEvent.tsx:344` does not pass it.
- **M9** The language switch sits in four different places and styles: an ink pill in the sign-in header, a globe in the public header, a globe+label in the attendee header, and a bottom text link on the expired-link page (`shots/tlink-expired-fa-m.jpg`).
- **M10** `/me` on desktop (1440) is a narrow single column floating in empty space. On tablet, the pass page is a small card in a large page (`shots/me-fa-d.jpg`, `pass-fa-t.jpg`).

### Low

- **L1** Self-cancel confirm body is 3 sentences (`MyTickets.tsx:40`). The delete-account dialog is long, which is acceptable for an irreversible action.
- **L2** Profile: the note "این تغییرات روی کارت ورود همایش‌های پیش رو…" and the switch captions «خاموش» under each toggle are redundant with the switch state.
- **L3** Sign-in page: subtitle "کارت‌های ورود و شبکه ارتباطی شما در یک‌جا." and mobile hint "یک کد ورود یک‌بارمصرف…". The desktop art panel carries a marketing tagline.
- **L4** English: dates read "Thu, Oct 1, 2026" next to "10 – 12 November 2026" on the same card (`DigitalPassCard`). Pick the long form everywhere.
- **L5** Error alerts are hand-rolled in 21 files (`border-status-danger-border bg-status-danger-bg …`) instead of one component.

---

## 3. Simplification spec (per screen)

Copy is given as fa / en. "Remove" means delete the element and its copy key.

### `/` Home (`pages/Home.tsx`, `public/homeCopy.ts`, `public/PublicEventList.tsx`)
- **Keep:** the hero (title, lead, 2 buttons) and the congress list.
- **Move:** the congress list directly under the hero on every breakpoint; it is no longer lazily placed below the instrument panel.
- **Primary action:** organizer button stays; the secondary button depends on the device:
  - device has a session or a link pass: «کارت‌های ورود من» / "My passes" → `/me`;
  - otherwise: «کارت ورود خود را پیدا کنید» / "Find your pass" → `/me`. `/me` shows the inline form (see `/me`).
- **Remove:**
  - `highlights` checklist;
  - the instrument panel on mobile (`max-lg:hidden`) and `panelNote`;
  - `rolesLead` and `registerTitle/registerBody` aside;
  - the whole "lifecycle" section (`phases`) and the "venue engineering" section (`principles`).
  - Role cards keep name + one-line `audience`; each body is cut to ≤ 1 sentence.

### `/e/:slug` public congress (`PublicEvent.tsx`, `public/CongressHero.tsx`, `public/page/PassesPanel.tsx`, `public/PassStub.tsx`, `public/copy.ts`, `layouts/PublicLayout.tsx`)

**Hero CTA (one primary action):**

| State | Hero CTA |
|---|---|
| Holds a pass (`heldPass`) | «کارت ورود من» / "My pass" → `/c/:slug/my-ticket` |
| Open, exactly one open tier | «دریافت کارت ورود» / "Get your pass"; opens the reservation dialog directly for that tier (signed in: reserves directly) |
| Open, several open tiers | same label, scrolls to `#passes` |
| Opens later | no button; status chip «ثبت‌نام از {date}» / "Registration opens {date}" |
| Closed, full or disabled | no button; status chip only («ثبت‌نام بسته است» / «ظرفیت تکمیل شد»); the "Booths" secondary stays |

The organizer `cta_label` applies only in the open state.

**Fact grid:** remove the «۰۱–۰۴» indices. Keep three facts: date (with day count), venue, passes («رایگان»). Remove the "زمان‌بندی" start/end cell; times go into the calendar file only. At 360–390 px show date and venue only.

**Passes panel:**
- Holds a pass: render only the dock row "«کارت ورود شما آماده است» [نمایش کارت ورود]". Hide the tier fieldset, remove the `activePass*` box, remove `digitalNote` and the "already registered?" line.
- No pass: tiers + dock. Remove `digitalNote`. Keep «قبلاً ثبت‌نام کرده‌اید؟ مشاهدهٔ کارت ورود» only when signed out.
- Sold-out stub: show only the side label «تکمیل ظرفیت» and drop the inline sentence.

**Reservation dialog:**
- Title «دریافت کارت ورود {tier}» / "Get your {tier} pass". No description.
- Mobile step: remove the hint under the field (the button says it); button «ارسال کد» / "Send code".
- Code step: unchanged.
- Profile step: title «نام شما روی کارت ورود» / "Name on your pass"; drop `profileLead`. Organization and title stay optional. Submit «دریافت کارت ورود» / "Get my pass", sticky on mobile (`stickySubmit`).

**Success sheet:**
- Title «کارت ورود شما آماده است» / "Your pass is ready". Drop the description and `successBody`.
- Keep the QR tile. One line: «پیوند آن هم پیامک شد.» / "We also texted you the link."
- Primary «نمایش کارت ورود» / "Show my pass"; text button «افزودن به تقویم» / "Add to calendar".
- Remove «ماندن در صفحهٔ همایش» (✕ and the backdrop close).

**Header and menu (public):**
- Event page: brand mark + name, language, one pill («ورود» or «کارت ورود من»). Remove ☰ on event and booth pages; it only duplicates the pill.
- Platform pages: keep ☰ but remove "شبکه ارتباطی" for signed-out visitors.

**Footer:** remove `footerPrivate` and the long blurb (`copy.ts:302,313` and the English equivalents). Keep attribution + "My passes" link.

**Error / 404:** keep. Drop `notFoundHelp` (the button below already says it). Body: «این همایش پیدا نشد یا منتشر نشده است.» / "This congress doesn't exist or isn't published."

### Booth page (`pages/PublicBooth.tsx`)
- **Primary action:**
  - with `?b=` signed out: one card «برای نشان‌کردن این غرفه وارد شوید» + [«ورود و نشان‌کردن» / "Sign in and save"]. Hide the generic bookmark card.
  - signed in: one toggle button «نشان‌کردن غرفه» ↔ «نشان‌شده ✓» / "Save booth" ↔ "Saved ✓".
  - Remove the green "already saved" banner, the `standeeBody` sentence and the "this booth is saved in your pass" line.
- Location: `text-xl font-semibold` under the name, not a display headline. The placard style is kept only for short Latin codes (`latinCode`).
- Remove the "brochure not yet published" empty card. Show the brochure only when it exists.
- "در محل از این غرفه بازدید می‌کنید؟": one line «کارت ورود خود را به غرفه‌دار نشان دهید.» / "Show your pass to the booth staff."

### `/sign-in` (`pages/AttendeeSignIn.tsx`)
- **Offline / network error with a stored token:** continue to the destination; never show the phone form (fix C1).
- Remove the subtitle and the mobile hint.
- Title: «ورود با شمارهٔ موبایل» / "Sign in with your mobile".
- Desktop art panel: remove the tagline, keep the art + congress name.
- "No pass yet": per congress «رزرو کارت ورود» → `/e/:slug`; generic «همایش‌ها» → `/#congresses`.

### `/t/:code` link pass and the pass tab (`pages/MyTickets.tsx`, `pages/LinkPassEntry.tsx`, `attendee/DigitalPassCard.tsx`, `attendee/QrFullscreen.tsx`)

Order on screen: [switcher if several] → **card with QR** → status line only if needed → install row → (divider) → «لغو ثبت‌نام» text button.

- **Status line:** show only offline («آفلاین؛ کارت ذخیره‌شده» / "Offline · saved pass"), session expired and notices. Remove the "up to date" line.
- **Link pass note:** below the card, one line «برای شبکه‌سازی وارد شوید» / "Sign in for networking", as a link.
- **Card:**
  - remove the tap hint (the QR keeps `role=button` and its aria-label, plus a small expand glyph in the QR corner);
  - print button `max-md:hidden`;
  - «شناسه رهگیری بلیت» → «شناسه کارت ورود» / "Pass ID".
- **Self-cancel:** a text-only danger button at the end of the page, no hint.
  - Confirm: title «ثبت‌نام لغو شود؟»; body «کد QR باطل و جای شما آزاد می‌شود. برگشت‌پذیر نیست.» / "Your QR code stops working and your place is released. This can't be undone."
  - Buttons «لغو ثبت‌نام» / «انصراف».
- **Expired link (410):**
  - title «این پیوند دیگر معتبر نیست» / "This link is no longer valid";
  - body «برای دیدن کارت ورود وارد شوید.» / "Sign in to see your pass.";
  - inline phone form;
  - language control in the standard header position.
- **Signed out on `/c/:slug/my-ticket`:** render the inline `MobileOtpForm` (title «ورود برای دیدن کارت ورود»), not a prompt card plus a link.

### Attendee shell (`layouts/AttendeeLayout.tsx`)
- **Mobile header:** congress switcher (it already contains "همه همایش‌های من") + profile avatar. Signed out: «ورود» pill.
  - Remove language and sign-out from the header below `md`; they stay in Profile and in the switcher menu (already present).
  - Desktop: keep language and sign-out.
- **Footer:** remove the shield sentence (`copy.footer`). Its content moves into the sign-out confirm body. Keep attribution only on `/me`.
- **Dock:** unchanged (4 tabs).

### Congress Home (`attendee/CongressHomeView.tsx`, `attendee/CongressHero.tsx`, `attendee/attendeeCopy.ts`)
- **Before:**
  - compact hero: name is in the header, so the hero shows only the phase chip + date · venue, one line each, with no artwork on mobile;
  - then the pass summary with the primary «نمایش کارت ورود» / "Show my pass";
  - then one countdown: keep the chip and remove the big countdown block;
  - checklist: calendar and directions only (remove the install row, H2);
  - then the program preview, network and booths as today.
- **During:** the QR card is the first element, above the hero; the hero collapses to the phase chip. Then now/next, booths, network.
- **After:** unchanged apart from removing the `ModuleHeading` indices.
- Remove the section indices («۰۱ ۰۲ …») from every attendee `ModuleHeading`/`SectionHeader`.

### Program tab (`attendee/CongressDetailsView.tsx`, `pages/CongressDetails.tsx`)
- First element: `ProgramExplorer` (day tabs, search, "برنامهٔ من", filters). Title «برنامه» / "Program".
- After the program: venue (entrances, halls, map links) and the PDF files.
- Remove: the hero/artwork block, the duplicate fact grid (time, venue, duration, count) and About (it lives on the public page; link «دربارهٔ همایش» → `/e/:slug#about`).

### `/me` (`pages/Me.tsx`)
- **Title** «همایش‌های من» / "My congresses"; remove `lead`.
- **Live card:** add an inline button «کد QR» → `/c/:slug/my-ticket` (the card body still opens Home). Upcoming and past cards are unchanged; location stays one line, truncated.
- **Signed out:** inline `MobileOtpForm` under the title, then the upcoming congress list. Remove `findTitle/findBody/registerHint`.
- **Empty:** title «هنوز کارت ورودی ندارید» / "No passes yet"; no body; congress list below.
- **Staff:** heading «کار من» / "Work"; remove `staffLead`. Reception card: kicker = congress name, title «میز پذیرش».
- **Offline:** hide `staffFailed` and saved-booth errors while `navigator.onLine === false`; show one offline chip.
- **Saved booths:** remove the description sentence.
- **≥ 1024 px:** two columns (congresses | work + saved booths).

### Network (`pages/MyNetwork.tsx`, `attendee/network/*`)
- Header: title «شبکهٔ من» + count; remove the eyebrow.
- My code: remove the explanatory sentence; keep name + tier under the QR.
- Scan: with `?scan=1`, start the camera immediately; tapping «اسکن» opens the camera in one step. Keep "enter the code" as the fallback link.
- Empty: «هنوز مخاطبی ندارید» + [«اسکن»]; remove the sentence.

### Profile (`pages/MyProfile.tsx`)
- Remove the propagation note under the form. The consent switches show only the label and the switch (drop the «خاموش» captions and shorten the descriptions to ≤ 1 line).
- Save button: render only when there are unsaved changes, sticky on mobile.
- Keep language, export, sign out and delete. Sign-out confirm body: «کارت ورود ذخیره‌شده از این دستگاه پاک می‌شود.» / "Your saved pass is removed from this device."

---

## 4. Consistency spec

- **Alerts and notices:** add one `components/ui/Notice.tsx` (tones: info / success / warning / danger; icon; optional action; `role=alert` for danger, `status` otherwise). It replaces:
  - `MyTickets.tsx` `StatusLine`;
  - the hand-rolled alert boxes in `PublicEvent.tsx:347-356`, `PassesPanel.tsx:120-129`, `MobileOtpForm` problem/lock boxes, and `Me.tsx` failures.
  - The organizer `WorkspaceUi.Notice` can later re-export it; that is outside this scope.
- **Sign-in prompt:** `attendee/SignInPrompt.tsx` + `StatusPanel` (`PortalState.tsx`) + `/me` "find" card are three versions of the same thing. Replace them all with an inline `MobileOtpForm` inside a `Card` with a single title.
- **Install:** exactly one component, `InstallHint`. Remove the checklist row in `CongressHomeView`.
- **Section headings:** no numeric indices in the attendee panel. Public `EditorialSection` keeps its eyebrow but loses the «۰۱» counter on mobile. Never `font-mono` on Persian digits.
- **Language control:** one control (globe + other language name) at the end of every header: public, attendee, sign-in and the link-error page.
- **Dialogs:** reservation, success and confirm all use `ui/Dialog` (bottom sheet below `sm`). Close by ✕ or backdrop only, never a "stay" button. Destructive confirms use `ConfirmDialog` with a ≤ 2-line body.
- **Buttons:** one primary per screen: hero CTA, dock button, «نمایش کارت ورود», «ارسال کد». Every other action is secondary, ghost or text.
- **Terminology:** «کارت ورود» everywhere for the attendee: replace «بلیت» at `i18n.ts:31,38,391` and `errorMessages.ts:17,22,23`. Use «نوع کارت ورود» for the tier. English "pass" everywhere, never "ticket".
- **Dates:** one formatter, the `congressTime.ts` long form, for issue date and range in both locales.

---

## 5. Device fit

- **Phone (360–430):**
  - One column. The QR is ≥ 260 px and above the fold on every pass entry (`/t/:code`, the pass tab, Home during). The dock is safe-area padded (already `attendee.css`).
  - Bottom-sheet dialogs get `max-h-[90dvh]` with internal scroll; the submit stays sticky above the keyboard (`useKeyboardInset`, already in `MobileOtpForm`).
  - Code input keeps `autocomplete=one-time-code` + auto-submit. Phone input keeps `inputmode=tel`.
  - Touch targets ≥ 44 px: verified, apart from the 1×1 skip link, which is fine.
- **Tablet (768–1180):** pass card max 420 px, centred, with the dock as a top nav (already). `/e/:slug` hero facts in 3 columns. Booth list 2 columns.
- **Desktop (≥ 1024):** `/me` 2 columns; the program explorer uses its sticky day bar; the sign-in split panel is kept without the tagline.
- **Landscape phone:** the full-screen QR must fit `min(80vh, 80vw)`. The dock hides when the full-screen QR is open (already a dialog).
- **Standalone:** headers already use `pt-safe` and the dock uses `pb-safe`. Every attendee screen has an in-app way back: the switcher → `/me`. Public booth pages keep their "back to congress" link. Add a back link on `/e/:slug` when the visitor came from `/me` (`location.state.from`); no browser chrome is assumed.

---

## 6. Install / PWA spec

- **Offer it only:**
  - on the pass tab or the `/t/:code` pass, below the card;
  - when the pass is active and the congress has not ended;
  - on a phone (`pointer: coarse` and width < 768);
  - not in standalone;
  - not dismissed (keep `congress_install_hint_dismissed`).
- **Never** on `/`, `/e/:slug`, the reservation sheet, Home, `/me`, network or profile. Never as a modal or a toast; never more than one offer per screen.
- **Android/Chromium:** a compact row «افزودن کارت ورود به صفحهٔ اصلی» / "Add your pass to the home screen" with [«افزودن» / "Add"] (native prompt) and ✕. Hide when `beforeinstallprompt` has not fired, or after `appinstalled`.
- **iOS Safari:** the same row; [«چطور؟» / "How?"] opens a small sheet:
  1. «دکمهٔ اشتراک‌گذاری را بزنید» / "Tap Share";
  2. «افزودن به صفحهٔ اصلی» / "Add to Home Screen";
  3. «یک بار آن را باز کنید و با شماره موبایل وارد شوید» / "Open it once and sign in with your mobile".

  Do not promise offline in the row. iOS in-app browsers (Instagram, Telegram, CriOS before iOS 16.4) get no row.
- **Launch target** (amend PWA-1 `launchTarget.ts` after it merges): paired scanner → its point (unchanged). Otherwise, an attendee token or link passes on the device lead to:
  - exactly one live or upcoming congress with an active pass → `/c/:slug/my-ticket`;
  - otherwise → `/me`.

  Nothing on the device → `/`. All decided from localStorage (works offline).
- **Offline first run (iOS):** the installed app opening `/c/:slug/my-ticket` with no session shows the inline phone form directly. Offline with no pass → «برای بار اول به اینترنت نیاز دارید» / "Connect once to load your pass".

---

## 7. Work packages

Each package lists the files it alone may edit; file lists do not overlap. **WP0 first**; WP1 after PWA-1 merges; WP2–WP6 run in parallel after WP0.

### WP0: shared foundations
- **Files:** new `components/ui/Notice.tsx`; `lib/i18n.ts` (attendee keys only: `ticketIdLabel`, `noTicketsTitle`, `linkExpiredTitle/Desc`, `offlineNotice`, `linkPassNote*`, `unauthenticated*`); `lib/errorMessages.ts` (TICKET_* wording); new `tests/notice.test.tsx`.
- **Acceptance:**
  - `rg "بلیت" src/lib/i18n.ts src/lib/errorMessages.ts` hits only organizer/participant keys;
  - Notice renders `role=alert` for danger;
  - lint, typecheck and unit tests pass.

### WP1: PWA launch, install, offline sign-in (critical; after PWA-1 merge)
- **Files:** `lib/launchTarget.ts`, `tests/launchTarget.test.ts`, `lib/installPrompt.ts`, `components/attendee/InstallHint.tsx`, `pages/AttendeeSignIn.tsx`, `e2e/pwa-launch.spec.ts`.
- **Acceptance (Playwright):**
  - token + cached pass for one upcoming congress, `/?source=pwa`, API aborted → URL `/c/:slug/my-ticket` and the QR is visible within 2 s;
  - two congresses → `/me`;
  - nothing stored → `/`;
  - `/sign-in` with token + API aborted → navigates to its destination (no `otp-mobile-step` visible);
  - iOS UA → the install row has no "offline" wording and the "How?" sheet has 3 steps;
  - `display-mode: standalone` (CDP `Emulation.setEmulatedMedia`) → no `install-hint`;
  - desktop viewport → no `install-hint`.

### WP2: pass and link pass
- **Files:** `pages/MyTickets.tsx`, `pages/LinkPassEntry.tsx`, `components/attendee/DigitalPassCard.tsx`, `components/attendee/QrFullscreen.tsx`, `components/attendee/SignInPrompt.tsx`.
- **Acceptance at 360×740 and 390×844, fa + en:**
  - `/t/:code` and the pass tab → the QR's bounding box is fully inside the first viewport, and no element above the card except the header;
  - no "up to date" text online; offline shows one warning line;
  - the self-cancel button comes after the install row;
  - print button hidden below md;
  - "Pass ID" / «شناسه کارت ورود» shown;
  - signed out on `/c/:slug/my-ticket` → `otp-mobile-step` visible without extra navigation.

### WP3: attendee shell, Home and Program
- **Files:** `layouts/AttendeeLayout.tsx`, `styles/attendee.css`, `components/attendee/CongressHomeView.tsx`, `components/attendee/CongressHero.tsx`, `components/attendee/attendeeCopy.ts`, `components/attendee/SectionHeader.tsx`, `components/attendee/CongressDetailsView.tsx`, `pages/CongressDetails.tsx`, `pages/MyCongress.tsx`.
- **Acceptance:**
  - mobile header has ≤ 2 controls besides the switcher;
  - Home before → exactly one countdown element and no install row;
  - Home during (clock 2026-11-10T08:10Z) → the QR is the first `main` landmark child and within the first viewport;
  - Program tab → the first heading in `main` is «برنامه», and the day tabs are within the first viewport at 390×844;
  - no `font-mono` Persian digits (harness `monoPersian` empty).

### WP4: `/me`, Network, Profile
- **Files:** `pages/Me.tsx`, `pages/MyNetwork.tsx`, `components/attendee/network/*`, `pages/MyProfile.tsx`, `components/attendee/SettingSwitch.tsx`.
- **Acceptance:**
  - live card has a QR link to `/c/:slug/my-ticket`;
  - signed-out `/me` shows `otp-mobile-step`;
  - offline cached `/me` shows no danger alert;
  - `/c/:slug/my-network?scan=1` calls `getUserMedia` without a click (stub `navigator.mediaDevices`);
  - profile Save is absent until a field changes;
  - 1440 px `/me` has 2 columns.

### WP5: public congress, reservation, booth, public shell
- **Files:**
  - `pages/PublicEvent.tsx`, `pages/PublicBooth.tsx`, `layouts/PublicLayout.tsx`;
  - `components/public/CongressHero.tsx`, `components/public/page/PassesPanel.tsx`, `components/public/PassStub.tsx`, `components/public/copy.ts`, `components/public/EditorialSection.tsx`;
  - `components/auth/MobileOtpForm.tsx` (signin purpose only: `verifyLabel`/profile labels via props, the sticky submit in the dialog).
- **Acceptance:**
  - one open tier, signed out: tapping the hero CTA opens the dialog (1 tap);
  - held pass: hero CTA href = `/c/:slug/my-ticket`, no tier fieldset in `#passes`, exactly one "pass ready" text;
  - not-open / closed / sold-out: no hero `a[href="#passes"]`;
  - dialog has no description paragraph;
  - profile step button «دریافت کارت ورود»;
  - success sheet has exactly 2 buttons + ✕;
  - standee signed out → one primary button;
  - footer has no `footerPrivate` text;
  - event page has no ☰ at 390 px.

### WP6: platform home
- **Files:** `pages/Home.tsx`, `components/public/homeCopy.ts`, `components/public/PublicEventList.tsx`.
- **Acceptance:**
  - at 390×844 the "upcoming congresses" heading is within 1.5 viewports;
  - the lifecycle and venue-engineering sections are gone;
  - with a stored token the secondary hero button text is «کارت‌های ورود من» → `/me`.

### Final screenshot check
Run the harness group set `pub`, `res`, `att`, `more`, `pwa` (`scen.mjs`) and compare against this review's `shots/`. Requirements:
- every `*-fa-m` screen has no `OVERFLOW`, no `latin` hits outside brand/URLs, no `monoFa`;
- every primary-action screen has exactly one `variant="primary"` button in view.
