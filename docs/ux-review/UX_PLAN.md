# UX implementation plan (UX-IMPL)

Source: five read-only reviews made on 2026-10-23 against `integration/upgrade` plus the then-open branches:
design system (`ds`), attendee and public (`att`), organizer and platform (`org`), on-site operators (`ops`), copy and i18n (`copy`).
The full specs are in `docs/ux-review/<area>/SPEC.md`. **This file decides wherever they disagree.** Each package below
says which spec sections it applies.

Goal (product owner): every persona and scenario is complete, easy and friendly. The UI is simple and minimal, with
unnecessary text removed. It looks and behaves the same everywhere, fits each device, and offers the installable app
on mobile where it helps.

## 1. Decisions (product owner accepted the recommended options, 2026-10-23)

| # | Decision |
|---|---|
| T1 | Persian terms: «نوع کارت ورود» (pass type), «کارت ورود» (pass), «جلسه» (session), «نقطه ورود» (check-in point), «کد QR», «ثبت‌نام حضوری» (walk-in). Never «بلیط/بلیت», «رده», «گیت», «نشست», «توکن», «اسلاگ», «کیوآر». |
| T2 | «لید» for a captured booth visitor; shown only in the booth panel. |
| T3 | Portal names: پنل برگزارکننده · پنل غرفه · میز پذیرش · اسکنر نقطهٔ ورود · همایش من · مدیریت سامانه. Never use «کنسول/پرتال/پورتال/پیشخوان/فضای کاری/ایستگاه». |
| T4 | «قانون ورود» (admission policy), «کلید سازمان» (organizer key; behind a secondary link on sign-in), «ذخیره» (bookmark), «پیوند» (link, also in SMS), «پیوند اتصال / کد اتصال» (scanner pairing). Sign-in is always phrased with «ورود», never «نشست». |
| T5 | English: congress · pass · pass type · check-in point · session · program (US spelling) · reception desk · booth panel · organizer console. |
| T6 | Install prompts: attendees who hold a pass (mobile, not standalone, not dismissed, after the pass has rendered once). Scanner after pairing, but on iOS on the unpaired screen, because pairing must happen inside the installed app. Booth after the first capture. **Never** on public pages, the organizer console, platform admin, or the desk. |
| T7 | Sessions are unchanged. The desk and organizer sessions stay per tab (`sessionStorage`), so they have no install prompt. Persisting them is a separate security decision and is out of scope. |
| T8 | The scanner verdict timing is unchanged (1.5 s admitted / 3 s other). |
| T9 | Persian dates are Jalali everywhere, including inputs. Times are always in the congress time zone. Numbers use Persian digits in fa (Latin only inside `dir=ltr` codes and URLs). |
| T10 | One localization mechanism: typed per-area modules `web/src/copy/<area>.ts` (copy §5). No new inline `isRtl ? "…" : "…"`, enforced by a ratchet test. |

## 2. Phases and packages

Every package has an **exclusive file list for its phase**. A file may be owned by different packages in different
phases, because each phase merges before the next starts on it. Packages marked ⏩ start as soon as their stated
dependency is merged; they don't wait for the whole phase.

### Phase 0: foundations (in parallel)

| ID | Applies | Files (exclusive) | Work | Acceptance |
|---|---|---|---|---|
| **UX-F1 tokens** | ds §4 tokens, DS0 | `web/src/index.css` | Radius scale into `@theme`; type and control-height tokens; `--border-input` (≥ 3:1); one focus style; neutralise decoration centrally (`.eyebrow`, `.rule-arc`, `.bg-meridian*`, `.shape-arc*`); `.ui-*` controls 48 px. Class names stay. | as ds DS0 |
| **UX-F2 format & dates** | ds DS2; org §4 one formatter; ops F-X7 | new `lib/format.ts`; `lib/i18n.ts` **format functions only**; `components/public/format.ts`; `components/attendee/{zonedFormat,congressTime}.ts`; `lib/passDates.ts`; `components/organizer/sessionTime.ts`; `lib/analyticsTime.ts`; `components/scanner/copy.ts` (`clockTime` only); new `components/ui/DateTimeField.tsx` (+`DateField`, on `lib/jalali.ts`); `tests/format*.test.ts`, `tests/dateTimeField*.test.ts` | One `formatDate/Time/Range/Number/Percent/Mobile` set in the congress zone; the old helpers delegate. Jalali `DateTimeField`. | ds DS2 + org WP-A(a): «سه‌شنبه ۱۹ آبان ۱۴۰۵», no `,` in fa, `٪`, Persian digits in clock, round-trip at the Esfand and leap-year edge |
| **UX-F3 copy foundation** | copy §3, §5, §4.1, §4.9, §4.11, COPY-0; att WP0 wording | `tests/glossary.test.ts`; new `tests/copyGuard.test.ts` + `tests/copy-baseline.json`; `tests/apiErrorCodes.test.ts`; new `web/src/copy/common.ts` + `useCopy`; `lib/i18n.ts` **dictionary and locale hook only** (one locale state that also sets `<html lang dir>`); `lib/errorMessages.ts`; `api/client.ts` (fa fallback: keep POLISH-2's generic sentence and make sure it is Persian); `GLOSSARY.md`; `docs/CODING_STANDARDS.md` | Guards with a baseline and a shrinking per-file allowlist (bans per T1–T4, whole-word «رده»). Error codes `SMS_TEMPLATE_INVALID` and `TRUSTED_NETWORK_INVALID` added. 66 dead keys removed. Glossary terms fixed in the dictionary (`tierLabel` etc.). | copy COPY-0; `<html lang>` = fa on Persian screens |
| **UX-F5 PWA, launch, device** (critical) | att WP1 + §6; ops WP-B + §6; copy §8 | `lib/launchTarget.ts`, `lib/installPrompt.ts`, `lib/pwaRegistration.ts`, `web/pwa-manifest.ts`, `web/vite.config.ts`, `components/attendee/InstallHint.tsx` (the one install component for attendees, scanner and booth), `components/AppUpdatePrompt.tsx` (+`useAppUpdate`; hidden on `/scan`, `/booth`, `/reception`), `pages/AttendeeSignIn.tsx`, new `hooks/{useWakeLock,useHidScanner}.ts`, `components/QrCameraInput.tsx` (`autoStart`, `continuous`), `e2e/pwa-launch.spec.ts`, `tests/{launchTarget,hidScanner,wakeLock,installPrompt}.test.ts` | The home-screen icon opens the pass (one upcoming congress) or `/me` (several), offline too. After that: the paired scanner point, then booth, then desk (PWA-1 already does the scanner). Offline sign-in continues with the stored session. Honest iOS copy. One install component. Wake-lock and HID hooks. | att WP1 list + ops WP-B unit tests |
| **UX-F6 operator shell** | ops §4, WP-A | new `components/operator/*` (`OperatorBar`, `StatusPill`, `OperatorMenu`, `OperatorGate`, `VerdictBanner`, `InstallRow` (wraps F5's install component; may use a stub until F5 merges)), new `components/ui/Toast.tsx`, new `styles/operator.css`, new `copy/operator.ts`, tests | Shared bar, status pill, ⋮ menu, blocked/setup template, verdict banner, toast. | ops WP-A |
| **UX-F7 backend** | ops WP-C; copy COPY-SMS §4.10 | `backend/app/routes/booths.py` (`BoothOut.event_archived`), `backend/app/sms/templates.py` (defaults only), the backend tests that assert those, `web/src/api/schema.d.ts` (regenerated) | No migration. Deploy note: only the defaults change; saved template overrides are untouched. | ops WP-C, copy COPY-SMS |
| ⏩ **UX-F4 primitives** (after F1) | ds §4, DS1; att `Notice`; org `RowActions` | `components/ui/**` (except `DateTimeField.tsx`, `Toast.tsx`), new `components/ui/{Notice,RowActions}.tsx`, `components/attendee/{SectionHeader,SettingSwitch,Monogram}.tsx`, `components/brand/**`, `tests/ui*.test.ts` | One component set: Button 40/48/56, Field with linked errors, Select, SegmentedControl, TabNav, Dialog/Sheet, Badge/status chip, empty/error/loading, Spinner, PageHeader, MetaList, Icon (directional rules). Old modules stay as thin wrappers. | ds DS1 |
| ⏩ **UX-F8 organizer scaffold** (after F4) | org §4, WP-A | `components/organizer/{EventWorkspaceProvider,eventWorkspaceContext,roleAccess,WorkspaceUi}.tsx/ts`, `pages/organizer/EventSectionUi.tsx`, new `components/organizer/RolePicker.tsx` | `canEdit` (manager+ and not archived). `EventSectionGate`. `SectionHeader` with no index or description. Network errors are returned as results, so offline shows an error with retry instead of an endless skeleton (org C2 for the provider). | org WP-A (a)(c) |

### Phase 1: portals (in parallel; each starts once the foundations it needs are merged)
Each package applies, for its files, the ds portal migration (P1–P7), its portal UX spec and the copy deck section. It
moves its strings into `copy/<area>.ts`, so its `copy-baseline.json` entries drop to 0, and it updates its own e2e and
e2e-live specs (prefer role and test-id locators).

| ID | Needs | Applies | Files (exclusive) |
|---|---|---|---|
| **UX-SCAN** | F1–F6 | ops §3.1–3.2, WP-D; ds P6; copy §4.6 | `pages/GateScanner.tsx`, `components/scanner/**`, `styles/scanner.css`, `styles/qr-camera.css`, `e2e/*scanner*.spec.ts`, `e2e/scannerFixtures.ts`, `e2e-live/scanner.spec.ts` |
| **UX-DESK** | F1–F6 | ops §3.3–3.4, WP-E (F-D1 critical); ds P5; copy §4.5 | `pages/ReceptionPortal.tsx`, `pages/OrganizerDesk.tsx`, `components/reception/**`, `styles/reception.css`, `lib/deskBadge.ts`, `copy/desk.ts`, `e2e/{reception-portal,desk-completion,desk-authority}.spec.ts`, `e2e-live/desk.spec.ts` |
| **UX-BOOTH** | F1–F7 | ops §3.5–3.8, WP-F; ds P7; copy §4.7 | `pages/ExhibitorPortal.tsx`, `components/booth/**`, `styles/exhibitor.css`, `lib/lead*.ts`, `copy/booth.ts`, `e2e/exhibitor*.spec.ts`, `e2e-live/exhibitor.spec.ts` |
| **UX-ATT-PASS** | F1–F5 | att WP2; copy §4.3 (pass) | `pages/MyTickets.tsx`, `pages/LinkPassEntry.tsx`, `components/attendee/{DigitalPassCard,QrFullscreen,SignInPrompt}.tsx`, `e2e/{sms-link-pass,pass-*}.spec.ts` |
| **UX-ATT-SHELL** | F1–F5 | att WP3 + WP4; ds P2; copy §4.3 | `layouts/AttendeeLayout.tsx`, `styles/attendee.css`, `components/attendee/**` (not owned by F4/F5/ATT-PASS), `pages/{Me,MyNetwork,MyProfile,MyCongress,CongressDetails}.tsx`, `lib/attendeeSession.ts`, `copy/attendee.ts`, `e2e/attendee-*.spec.ts`, `e2e-live/attendee.spec.ts` |
| **UX-PUB** | F1–F4 | att WP5 + WP6; ds P1; copy §4.2 | `pages/{Home,PublicEvent,PublicBooth,NotFound}.tsx`, `layouts/PublicLayout.tsx`, `components/public/**`, `styles/public.css`, `components/BoothDirectory.tsx`, `components/auth/MobileOtpForm.tsx`, `copy/public.ts`, `e2e/public-*.spec.ts` |
| **UX-ORG-1 shell & congress** | F1–F4, F8 | org WP-B + WP-C + members/activity part of WP-I; copy §4.4 shell; ds P3 | `pages/OrganizerLayout.tsx`, `lib/organizerWorkspace.ts`, `styles/organizer.css`, `App.tsx` (redirects `/venue` → program tab, `/panel` → Page Studio preview), `components/organizer/{OrganizerKeyGate,OrganizerMemberSignIn,EventEditDialog,useGuardedClose}.tsx`, `components/organizer/eventTiming.ts`, `pages/OrganizerEvents.tsx`, `pages/organizer/{EventOverview,EventSettingsPanel}.tsx`, `pages/{OrganizerMembers,OrganizerActivity}.tsx`, `lib/organizerConsole.ts`, `copy/organizer.ts`, `e2e/organizer-{workspace,authority,members,settings}.spec.ts`, `e2e-live/{organizer,members}.spec.ts` |
| **UX-ORG-2 program & page** | F1–F4, F8 | org WP-D + WP-G; copy §4.4 program/studio | `pages/{OrganizerProgram,OrganizerVenue,OrganizerPageStudio,OrganizerPanel,OrganizerPagePreview}.tsx`, `components/organizer/studio/**`, `components/organizer/{ScheduleFilesManager,TimetableImport,SessionFormDialog}.tsx`, `copy/organizerProgram.ts`, `e2e/{page-studio,schedule-files,organizer-program*}.spec.ts` |
| **UX-ORG-3 congress-day setup** | F1–F4, F8 | org WP-E + WP-F (C1 roles critical); copy §4.4 | `pages/organizer/{EventCheckIn,EventOperators,EventTiers,EventBooths}.tsx`, `components/organizer/{CheckInPointFormDialog,ScannerPairingDialog,checkInPolicy,OperatorFormDialog,TierFormDialog,BoothFormDialog,BoothStaffDialog,BoothQrDialog}.*`, `copy/organizerSetup.ts`, `e2e/organizer-checkin-rules.spec.ts` |
| **UX-ORG-4 data** | F1–F4, F8 | org WP-H + analytics part of WP-I; copy §4.4 | `pages/{OrganizerParticipants,OrganizerSms,OrganizerAnalytics}.tsx`, `lib/participants.ts`, `components/sms/**`, `copy/organizerData.ts`, `e2e/{participants,organizer-analytics}.spec.ts` |
| **UX-PLAT** | F1–F4, F8 (RolePicker) | org WP-J; ds P4; copy §4.8 | `pages/Platform*.tsx`, `pages/platformContext.ts`, `copy/platform.ts`, `e2e/platform-console.spec.ts` |

If a phase-1 package needs a change in a phase-0 file, it lists it in its report and the coordinator applies it at
merge. Do not edit another package's files.

### Phase 2: cleanup and guard (one package, after phase 1)
**UX-Z**: delete the wrappers and neutralised classes (ds Z). Add `tests/designGuard.test.ts` (ds Z grep list,
including `type="datetime-local"` and `new Intl.DateTimeFormat` outside `lib/format.ts`). Bring the copy baseline to 0
and empty the glossary allowlist. Delete the leftover dictionary keys. Rerun the full screenshot harness (fa+en, m/s/t/tl/d):
no overflow, no Latin outside `dir=ltr`, no Persian in mono fonts, one primary button per screen. `./scripts/check.sh --full`.

## 3. Critical items: do them first inside their package
1. **F5**: the home-screen icon opens the offline pass; offline sign-in; honest iOS install copy (att C1, C2).
2. **UX-DESK**: a barcode-gun scan into the walk-in name field must not create a pass (ops F-D1); gun scans work whatever has focus.
3. **UX-SCAN**: the installed scanner can pair by scanning the pairing QR (ops F-S1); wake lock, and the camera restarts after the screen locks (ops F-X1).
4. **UX-ORG-3**: check-in respects roles; viewers see no edit actions (org C1). **F8 + ORG-1**: offline shows an error with retry instead of an endless skeleton (org C2).
5. **F2 + portal packages**: Jalali date inputs, no Persian in monospace fonts (ds critical); Persian errors never show English (copy F2, via F3).
6. **UX-BOOTH**: never display the full badge QR secret (ops F-B3).

## 4. How every package works
- Branch `ws/ux-<id>` from the current `origin/integration/upgrade` tip, in its own worktree under
  `/Users/mahdi/AITeb-Congress/.claude/worktrees/ux-<id>`. Symlink `web/node_modules` to `/Users/mahdi/AITeb-Congress/web/node_modules`.
- Read this plan, `docs/ux-review/<area>/SPEC.md` for the sections named above, `docs/CODING_STANDARDS.md`, and `skills/…UI-UX & Design Review.md` (the rubric). The review screenshots are in the coordinator's scratchpad, if present.
- Prefer deleting over adding. No new features and no new dependencies.
- Gates before reporting: web `npm test && npm run lint && npx tsc -b && npx vite build --configLoader runner`; mock Playwright for the package's specs plus a smoke of the rest (`npx vite preview --configLoader runner --port <own> --strictPort`, `PLAYWRIGHT_BASE_URL=… CONGRESS_BROWSER_CHANNEL=chrome npx playwright test`). Backend packages: `node scripts/integration/backend-tests.mjs` and `node scripts/gen-api.mjs --check`. Read the real exit codes.
- Screenshots of the package's screens (fa + en, phone + desktop, plus kiosk for operators). JPEG, small; no traces or videos. Delete `web/dist` afterwards.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push the branch with `git push -u origin ws/ux-<id>`. Never deploy, and never touch Docker containers you didn't create.
- Report: what changed, the acceptance results with exit codes, screenshot paths, files outside the package's list it needed, and anything left over.
