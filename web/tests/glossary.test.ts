import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Persian UI terms (GLOSSARY.md, "Persian UI terms"; docs/ux-review/UX_PLAN.md T1–T4). Each banned spelling
// with the word to write instead.
const LETTER = "ء-غف-يٱ-ۓۺ-ۼ";
const BANNED: ReadonlyArray<{ term: string; pattern: RegExp; fix: string }> = [
  // Whole word only: «کرده» and «گسترده» are fine.
  { term: "رده", pattern: new RegExp(`(?<![${LETTER}‌])رده(?![${LETTER}])`), fix: "«نوع کارت ورود»" },
  ...(
    [
      ["بلیط", "«کارت ورود»"],
      ["بلیت", "«کارت ورود»"],
      ["نشست", "«جلسه» (program) or a phrasing with «ورود» (sign-in)"],
      ["گیت", "«نقطه ورود»"],
      ["توکن", "«کد اتصال» / «پیوند اتصال»"],
      ["اسلاگ", "«نشانی صفحه»"],
      ["کیوآر", "«کد QR»"],
      ["کنسول", "«پنل برگزارکننده»"],
      ["پرتال", "the portal's name (T3)"],
      ["پورتال", "the portal's name (T3)"],
      ["پیشخوان", "the portal's name (T3)"],
      ["فضای کاری", "the portal's name (T3)"],
      ["ایستگاه", "«میز پذیرش» / «نقطه ورود»"],
      ["سرنخ", "«لید»"],
      ["لینک", "«پیوند»"],
      ["تلاش مجدد", "«تلاش دوباره»"],
      ["بارگیری", "«بارگذاری» / «دریافت»"],
      ["جست‌وجو", "«جستجو»"],
      ["تایید", "«تأیید»"],
      ["ابطال", "«لغو دسترسی»"],
      ["نمایید", "«کنید»"],
      ["گردید", "a plain verb («شد»)"],
    ] as const
  ).map(([term, fix]) => ({ term, pattern: new RegExp(term), fix })),
];

const WEB = new URL("..", import.meta.url).pathname;
const REPO = new URL("../..", import.meta.url).pathname;
const ROOTS = [join(WEB, "src"), join(WEB, "index.html"), join(REPO, "backend/app/sms/templates.py")];

/**
 * Files that still carry a banned term, with the terms they carry. It may only shrink: each portal package
 * removes its files' entries (an entry whose term is gone fails this test until it is deleted), and no file
 * or term is ever added. Paths are relative to the repository root.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  "web/src/components/attendee/attendeeCopy.ts": ["بلیت", "نشست", "گردید"],
  "web/src/components/organizer/BoothStaffDialog.tsx": ["پورتال"],
  "web/src/components/organizer/EventEditDialog.tsx": ["اسلاگ"],
  "web/src/components/organizer/OperatorFormDialog.tsx": ["گیت"],
  "web/src/components/organizer/OrganizerKeyGate.tsx": ["فضای کاری", "نشست"],
  "web/src/components/organizer/ScannerPairingDialog.tsx": ["کنسول", "لینک"],
  "web/src/components/organizer/studio/studioCopy.ts": ["جست‌وجو", "فضای کاری"],
  "web/src/components/public/copy.ts": ["بلیت", "گیت", "سرنخ", "نشست"],
  "web/src/components/public/homeCopy.ts": ["گیت", "سرنخ", "فضای کاری", "جست‌وجو", "پرتال"],
  "web/src/components/reception/AttendeeCard.tsx": ["تلاش مجدد"],
  "web/src/components/reception/AttendeeSearch.tsx": ["تلاش مجدد"],
  "web/src/components/reception/DeskAuthGate.tsx": ["نشست", "گردید"],
  "web/src/components/reception/MintedDialog.tsx": ["لینک"],
  "web/src/components/reception/ModeSwitch.tsx": ["نشست"],
  "web/src/components/reception/ReceptionStation.tsx": ["تلاش مجدد"],
  "web/src/components/reception/ResendPassSms.tsx": ["لینک"],
  "web/src/components/reception/WalkInForm.tsx": ["لینک"],
  "web/src/components/scanner/copy.ts": ["توکن", "ابطال", "کنسول"],
  "web/src/components/sms/SmsTemplateEditor.tsx": ["رده", "بلیت", "لینک"],
  "web/src/lib/attendeeSession.ts": ["نشست"],
  "web/src/lib/organizerConsole.ts": ["جست‌وجو", "کنسول", "نشست", "بارگیری"],
  "web/src/lib/participants.ts": ["بلیت", "گیت"],
  "web/src/pages/AttendeeSignIn.tsx": ["فضای کاری", "پرتال", "سرنخ"],
  "web/src/pages/OrganizerEvents.tsx": ["بلیت"],
  "web/src/pages/OrganizerLayout.tsx": ["فضای کاری", "کنسول"],
  "web/src/pages/OrganizerPanel.tsx": ["بلیت"],
  "web/src/pages/OrganizerSms.tsx": ["بلیت"],
  "web/src/pages/ReceptionPortal.tsx": ["ایستگاه", "نمایید"],
  "web/src/pages/organizer/EventOperators.tsx": ["نشست"],
};

function* files(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) yield* files(join(path, name));
  } else if (/\.(tsx?|css|html|json|py)$/.test(path)) {
    yield path;
  }
}

function scan(): Map<string, Map<string, string[]>> {
  const found = new Map<string, Map<string, string[]>>();
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const path = relative(REPO, file);
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const { term, pattern } of BANNED) {
            if (!pattern.test(line)) continue;
            const terms = found.get(path) ?? new Map<string, string[]>();
            found.set(path, terms);
            terms.set(term, [...(terms.get(term) ?? []), String(i + 1)]);
          }
        });
    }
  }
  return found;
}

test("the app uses the Persian UI terms", () => {
  const found = scan();
  const errors: string[] = [];
  for (const [path, terms] of found) {
    for (const [term, lines] of terms) {
      if (ALLOWED[path]?.includes(term)) continue;
      const fix = BANNED.find((b) => b.term === term)?.fix;
      errors.push(`${path}:${lines.join(",")}: «${term}» → ${fix}`);
    }
  }
  assert.deepEqual(errors, [], "banned Persian terms");
});

test("the glossary allowlist only shrinks: entries whose term is gone must be deleted", () => {
  const found = scan();
  const stale: string[] = [];
  for (const [path, terms] of Object.entries(ALLOWED)) {
    for (const term of terms) if (!found.get(path)?.has(term)) stale.push(`${path}: «${term}»`);
  }
  assert.deepEqual(stale, [], "delete these entries from ALLOWED in tests/glossary.test.ts");
});

test("«رده» matches only as a whole word", () => {
  const { pattern } = BANNED[0]!;
  for (const ok of ["کرده", "گسترده", "پرده", "برده‌اند", "آورده شد"]) assert.doesNotMatch(ok, pattern, ok);
  for (const bad of ["رده", "رده‌ها", "ردهٔ بلیت", "این رده", "(رده)", "«رده»"]) assert.match(bad, pattern, bad);
});
