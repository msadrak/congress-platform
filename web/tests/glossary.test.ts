import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Persian glossary: «بلیت» (ticket), «کارت ورود» (pass), «کد QR». The forbidden spellings are built from code
// points so this file never contains them itself.
const FORBIDDEN: Record<string, string> = {
  // ب ل ی ط: the misspelling of «بلیت»
  [String.fromCodePoint(0x628, 0x644, 0x6cc, 0x637)]: "write «بلیت»",
  // ک ی و آ ر: transliterated "QR"
  [String.fromCodePoint(0x6a9, 0x6cc, 0x648, 0x622, 0x631)]: "write «کد QR»",
};

const ROOTS = [new URL("../src", import.meta.url).pathname, new URL("../index.html", import.meta.url).pathname];

function* files(path: string): Generator<string> {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) yield* files(join(path, name));
  } else if (/\.(tsx?|css|html|json)$/.test(path)) {
    yield path;
  }
}

test("the web app follows the Persian glossary", () => {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [word, fix] of Object.entries(FORBIDDEN)) {
          if (line.includes(word)) found.push(`${relative(process.cwd(), file)}:${i + 1}: ${fix}`);
        }
      });
    }
  }
  assert.deepEqual(found, []);
});
