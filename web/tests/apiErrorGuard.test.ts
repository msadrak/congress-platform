import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// UI code shows API errors with `localizedApiError(error, locale)` (docs/CODING_STANDARDS.md §2.F), never the
// server's English `detail` through `formatApiError(...)`, which belongs to web/src/api/client.ts.
const SRC = new URL("../src", import.meta.url).pathname;
const UI_ROOTS = ["pages", "components", "layouts"].map((dir) => join(SRC, dir));

// Files that still call formatApiError. Empty since UX-SCAN and UX-ORG-3; never add a file to it.
const NOT_YET_CONVERTED: readonly string[] = [];

function* sourceFiles(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) yield* sourceFiles(join(path, name));
  } else if (/\.tsx?$/.test(path)) {
    yield path;
  }
}

function filesCallingFormatApiError(): string[] {
  const found: string[] = [];
  for (const root of UI_ROOTS) {
    for (const file of sourceFiles(root)) {
      if (/\bformatApiError\s*\(/.test(readFileSync(file, "utf8"))) found.push(relative(SRC, file).split("\\").join("/"));
    }
  }
  return found.sort();
}

test("UI code shows API errors with localizedApiError, not formatApiError", () => {
  const offenders = filesCallingFormatApiError().filter((file) => !NOT_YET_CONVERTED.includes(file));
  assert.deepEqual(offenders, [], "use localizedApiError(error, locale) from web/src/api/client.ts in these files");
});

test("the formatApiError allow-list only names files that still need converting", () => {
  const calling = new Set(filesCallingFormatApiError());
  const stale = NOT_YET_CONVERTED.filter((file) => !calling.has(file));
  assert.deepEqual(stale, [], "these files no longer call formatApiError: remove them from NOT_YET_CONVERTED");
});
