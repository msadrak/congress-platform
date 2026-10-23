import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type * as TS from "typescript";

/*
 * Copy ratchet (docs/ux-review/copy/SPEC.md §5; CODING_STANDARDS.md §1.E). User-facing strings belong in the typed
 * per-area modules `src/copy/<area>.ts`; this test counts, per file, what is still written elsewhere or in a form the
 * copy rules forbid, and compares the counts with `copy-baseline.json`. A count may only fall: a rise, or a new file
 * with a count, fails. When a count falls, lower the baseline with
 *   UPDATE_COPY_BASELINE=1 node --experimental-strip-types --test tests/copyGuard.test.ts
 * (it only ever lowers counts and drops files that reached zero; it never raises one or adds a file).
 */
const ts: typeof TS = createRequire(import.meta.url)("typescript");

const WEB = new URL("..", import.meta.url).pathname;
const SRC = join(WEB, "src");
const BASELINE = join(WEB, "tests/copy-baseline.json");

const PERSIAN = /[؀-ۿ]/;
/** `isRtl ? "…"`, `isFa ? "…"`, `locale === "fa" ? "…"` (also as a property: `props.isRtl`). */
const LOCALE_CONDITION = /(?:^|\.)(?:isRtl|isFa)$|(?:^|\.)locale\s*===\s*["']fa["']$/;
/** Developer vocabulary a Persian reader should not see (platform admin is allowed technical terms). */
const DEV_TERM = /API|token|Slug|IANA|JWT|localhost|HTTP|manifest|SessionStorage|Walk-In|\(Hot\)|\(Rating\)/;

type Counter = "ternary" | "persian" | "devTerm" | "asciiEllipsis" | "checkmark";
const COUNTERS: Readonly<Record<Counter, string>> = {
  ternary: "inline locale ternaries with a string (`isRtl ? \"…\" : \"…\"`): move the text into src/copy/<area>.ts",
  persian: "Persian text in a .tsx file: move it into src/copy/<area>.ts",
  devTerm: "developer terms (API, token, Slug, HTTP…) inside a Persian string",
  asciiEllipsis: "\"...\" inside a Persian string: write «…»",
  checkmark: "a string that starts with ✓: say it in words",
};
type Counts = Partial<Record<Counter, number>>;

function* sourceFiles(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) yield* sourceFiles(join(path, name));
  } else if (/\.tsx?$/.test(path) && !path.endsWith(".d.ts")) {
    yield path;
  }
}

const unwrap = (node: TS.Expression): TS.Expression => (ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node);

function isText(node: TS.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

/** The literal text of a string, template (its fixed parts) or JSX text node. */
function textOf(node: TS.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("");
  if (ts.isJsxText(node)) return node.text.trim() || undefined;
  return undefined;
}

/** The counts for one source file (`file` is relative to web/). */
function countText(file: string, code: string): Counts {
  const inCopyModule = file.startsWith("src/copy/");
  const platform = /^src\/pages\/Platform/.test(file);
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const counts: Counts = {};
  const add = (counter: Counter) => {
    counts[counter] = (counts[counter] ?? 0) + 1;
  };
  const visit = (node: TS.Node): void => {
    if (!inCopyModule && ts.isConditionalExpression(node)) {
      const condition = unwrap(node.condition).getText(source).replace(/\s+/g, " ");
      if (LOCALE_CONDITION.test(condition) && isText(unwrap(node.whenTrue))) add("ternary");
    }
    const text = textOf(node);
    if (text !== undefined) {
      if (text.trimStart().startsWith("✓")) add("checkmark");
      if (PERSIAN.test(text)) {
        if (!inCopyModule && file.endsWith(".tsx")) add("persian");
        if (!platform && DEV_TERM.test(text)) add("devTerm");
        if (text.includes("...")) add("asciiEllipsis");
      }
      if (ts.isTemplateExpression(node)) {
        // The spans' expressions may hold strings of their own.
        for (const span of node.templateSpans) ts.forEachChild(span, visit);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return counts;
}

function current(): Record<string, Counts> {
  const all: Record<string, Counts> = {};
  for (const path of sourceFiles(SRC)) {
    const file = relative(WEB, path);
    const counts = countText(file, readFileSync(path, "utf8"));
    if (Object.keys(counts).length > 0) all[file] = counts;
  }
  return all;
}

const sorted = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

test("copy only moves into src/copy: no file's count rises above copy-baseline.json", (t) => {
  const baseline: Record<string, Counts> = JSON.parse(readFileSync(BASELINE, "utf8"));
  const now = current();
  const rose: string[] = [];
  const fell: string[] = [];
  for (const file of new Set([...Object.keys(now), ...Object.keys(baseline)])) {
    for (const counter of Object.keys(COUNTERS) as Counter[]) {
      const before = baseline[file]?.[counter] ?? 0;
      const after = now[file]?.[counter] ?? 0;
      if (after > before) rose.push(`${file}: ${counter} ${before} → ${after} (${COUNTERS[counter]})`);
      if (after < before) fell.push(`${file}: ${counter} ${before} → ${after}`);
    }
  }
  if (process.env.UPDATE_COPY_BASELINE === "1" && fell.length > 0) {
    const lowered: Record<string, Counts> = {};
    for (const [file, counts] of Object.entries(baseline)) {
      const kept: Counts = {};
      for (const [counter, before] of Object.entries(counts) as [Counter, number][]) {
        const value = Math.min(before, now[file]?.[counter] ?? 0);
        if (value > 0) kept[counter] = value;
      }
      if (Object.keys(kept).length > 0) lowered[file] = kept;
    }
    writeFileSync(BASELINE, `${JSON.stringify(sorted(lowered), null, 2)}\n`);
    t.diagnostic(`copy-baseline.json lowered: ${fell.join("; ")}`);
  } else if (fell.length > 0) {
    t.diagnostic(`lower the baseline (UPDATE_COPY_BASELINE=1): ${fell.join("; ")}`);
  }
  assert.deepEqual(rose, [], "new inline copy: put user-facing strings in src/copy/<area>.ts (GLOSSARY.md, CODING_STANDARDS.md §1.E)");
});

test("the copy guard sees the forms it counts", () => {
  const count = (code: string, file = "src/pages/Probe.tsx") => countText(file, code);
  assert.deepEqual(count(`const a = isRtl ? "سلام" : "Hello";`), { ternary: 1, persian: 1 });
  assert.deepEqual(count("const a = props.locale === 'fa' ? `${n} نفر` : `${n} people`;"), { ternary: 1, persian: 1 });
  assert.deepEqual(count(`const a = (isRtl) ? ("x") : "y";`), { ternary: 1 });
  assert.deepEqual(count(`const a = isRtl ? <b>x</b> : null;`), {});
  assert.deepEqual(count(`const el = <p>کلید API را وارد کنید...</p>;`), { persian: 1, devTerm: 1, asciiEllipsis: 1 });
  assert.deepEqual(count(`const s = "✓ Lead saved.";`), { checkmark: 1 });
  assert.deepEqual(count(`const fa = { a: "کلید API" };`, "src/pages/PlatformSms.tsx"), { persian: 1 });
  assert.deepEqual(count(`const fa = { a: "سلام...", b: isRtl ? "x" : "y" };`, "src/copy/probe.ts"), { asciiEllipsis: 1 });
  assert.deepEqual(count(`const fa = { a: "سلام" };`, "src/lib/probe.ts"), {});
});
