import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * Design guard (docs/ux-review/ds/SPEC.md §7, row Z). Sizes, radii and colours come from the tokens in
 * index.css (`text-caption`…`text-display`, `rounded-control`/`rounded-card`, the colour tokens); directional
 * icons mirror on their own (`ui/Icon`); dates go through `lib/format.ts` and `ui/DateTimeField`. The rules below
 * catch the ways around that. A line counts once per rule.
 */
interface Rule {
  pattern: RegExp;
  /** `.tsx` only (class names), or every `.ts`/`.tsx` file under src. */
  tsxOnly?: boolean;
  fix: string;
}

const RULES: Readonly<Record<string, Rule>> = {
  radius: { pattern: /\brounded-\[/, tsxOnly: true, fix: "use rounded-control / rounded-card (or the radius scale)" },
  textSize: { pattern: /\btext-\[\d/, tsxOnly: true, fix: "use a type token: text-caption … text-display" },
  fontSize: { pattern: /\bfont-\[\d/, tsxOnly: true, fix: "use font-medium / font-semibold / font-bold" },
  hexColour: { pattern: /\[#[0-9a-fA-F]{3,8}\]/, tsxOnly: true, fix: "use a colour token" },
  chevronTernary: { pattern: /isRtl \? "chevron-/, fix: "pass the logical icon; ui/Icon mirrors it in RTL" },
  arrowTernary: { pattern: /dir === "rtl" \? "arrow-/, fix: "pass the logical icon; ui/Icon mirrors it in RTL" },
  meridian: { pattern: /bg-meridian/, fix: "decoration is gone: delete it" },
  sectionIndex: { pattern: /SectionIndex/, fix: "section numbers are gone: delete it" },
  // The `.eyebrow` class; the page document's organizer-written `eyebrow` field is content and stays.
  eyebrowClass: { pattern: /className=[{`"'][^>]*\beyebrow\b/, fix: "headers carry no eyebrow: delete it" },
  datetimeLocal: { pattern: /type="datetime-local"/, fix: "use DateTimeField / DateField (components/ui/DateTimeField)" },
  intlDateTimeFormat: { pattern: /new Intl\.DateTimeFormat/, fix: "format through lib/format.ts" },
};

/** Files a rule does not apply to. */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  intlDateTimeFormat: ["src/lib/format.ts"],
};

/**
 * UX-ATT-SHELL (team2) is still rewriting these attendee files. Counts may only fall: a rise fails, and so does
 * an entry above the file's real count (lower it, or delete the entry at zero). Never add a file.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "src/components/attendee/CongressDetailsView.tsx": { textSize: 2, meridian: 1, eyebrowClass: 1 },
  "src/components/attendee/CongressHero.tsx": { textSize: 1, meridian: 1, eyebrowClass: 1 },
  "src/components/attendee/CongressHomeView.tsx": { radius: 2, meridian: 2 },
  "src/components/attendee/CongressSchedule.tsx": { textSize: 1, hexColour: 2 },
  "src/components/attendee/ProgramExplorer.tsx": { textSize: 1 },
  // Deleted by UX-ATT-SHELL.
  "src/components/attendee/SignInPrompt.tsx": { radius: 1 },
  "src/components/attendee/network/ContactCard.tsx": { radius: 2, textSize: 1 },
  "src/components/attendee/zonedFormat.ts": { intlDateTimeFormat: 1 },
  "src/layouts/AttendeeLayout.tsx": { radius: 2, textSize: 4 },
  "src/pages/Me.tsx": { textSize: 2, meridian: 1 },
  "src/pages/MyNetwork.tsx": { radius: 1, textSize: 1, meridian: 1, eyebrowClass: 1 },
  "src/pages/MyProfile.tsx": { radius: 1, textSize: 1, meridian: 1, eyebrowClass: 1 },
};

const WEB = new URL("..", import.meta.url).pathname;

function* sourceFiles(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) yield* sourceFiles(join(path, name));
  } else if (/\.tsx?$/.test(path) && !path.endsWith(".d.ts")) {
    yield path;
  }
}

export function countRules(file: string, code: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const lines = code.split("\n");
  for (const [name, rule] of Object.entries(RULES)) {
    if (rule.tsxOnly && !file.endsWith(".tsx")) continue;
    if (EXEMPT[name]?.includes(file)) continue;
    const n = lines.filter((line) => rule.pattern.test(line)).length;
    if (n > 0) counts[name] = n;
  }
  return counts;
}

function scan(): Map<string, Record<string, number>> {
  const found = new Map<string, Record<string, number>>();
  for (const path of sourceFiles(join(WEB, "src"))) {
    const file = relative(WEB, path).split("\\").join("/");
    const counts = countRules(file, readFileSync(path, "utf8"));
    if (Object.keys(counts).length > 0) found.set(file, counts);
  }
  return found;
}

test("no file goes around the design tokens, the icon mirroring or lib/format.ts", () => {
  const errors: string[] = [];
  for (const [file, counts] of scan()) {
    for (const [name, n] of Object.entries(counts)) {
      const allowed = ALLOWED[file]?.[name] ?? 0;
      if (n > allowed) errors.push(`${file}: ${name} ${n} (allowed ${allowed}) → ${RULES[name]!.fix}`);
    }
  }
  assert.deepEqual(errors, []);
});

test("the design guard allowlist only shrinks: lower or delete entries above the real count", () => {
  const found = scan();
  const stale: string[] = [];
  for (const [file, counts] of Object.entries(ALLOWED)) {
    for (const [name, allowed] of Object.entries(counts)) {
      const n = found.get(file)?.[name] ?? 0;
      if (n < allowed) stale.push(`${file}: ${name} ${allowed} → ${n}`);
    }
  }
  assert.deepEqual(stale, [], "lower these entries in ALLOWED (tests/designGuard.test.ts)");
});

test("the design guard sees what it bans and nothing else", () => {
  const count = (code: string, file = "src/pages/Probe.tsx") => countRules(file, code);
  assert.deepEqual(count(`<div className="rounded-[20px] text-[11px] font-[600] bg-[#fff]" />`), { radius: 1, textSize: 1, fontSize: 1, hexColour: 1 });
  assert.deepEqual(count(`<div className="rounded-card text-caption font-semibold bg-surface-panel max-w-[440px]" />`), {});
  assert.deepEqual(count(`const icon = isRtl ? "chevron-left" : "chevron-right";`), { chevronTernary: 1 });
  assert.deepEqual(count(`<span className="eyebrow">x</span>`), { eyebrowClass: 1 });
  assert.deepEqual(count(`<EditorialSection eyebrow={own(section.eyebrow)} title="x" />`), {});
  assert.deepEqual(count(`<input type="datetime-local" />`), { datetimeLocal: 1 });
  assert.deepEqual(count(`const f = new Intl.DateTimeFormat("en-US");`, "src/lib/probe.ts"), { intlDateTimeFormat: 1 });
  assert.deepEqual(count(`const f = new Intl.DateTimeFormat("en-US");`, "src/lib/format.ts"), {});
  assert.deepEqual(count(`const c = "rounded-[20px]";`, "src/lib/probe.ts"), {});
});
