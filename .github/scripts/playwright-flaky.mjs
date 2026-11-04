#!/usr/bin/env node
/**
 * Flake report for a Playwright run with retries (CI runs `--retries=1`):
 *
 *   node .github/scripts/playwright-flaky.mjs <playwright-json-report>
 *
 * A test that failed and then passed on its retry is "flaky": the job stays green, but each one is printed as
 * a GitHub warning annotation and listed in the job summary ($GITHUB_STEP_SUMMARY) so it is fixed rather than
 * hidden by the retry. Always exits 0; failing tests already fail the Playwright step.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.log(`no Playwright JSON report at ${file ?? '(none given)'}; nothing to report`);
  process.exit(0);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
const flaky = [];
const walk = (suite, titles) => {
  const here = suite.title ? [...titles, suite.title] : titles;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'flaky') flaky.push({ file: spec.file, line: spec.line, title: [...here, spec.title].join(' › ') });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here);
};
for (const suite of report.suites ?? []) walk(suite, []);

const stats = report.stats ?? {};
const line = `Playwright: ${stats.expected ?? '?'} passed, ${stats.unexpected ?? '?'} failed, ${stats.flaky ?? flaky.length} flaky, ${stats.skipped ?? '?'} skipped`;
console.log(line);
for (const f of flaky) console.log(`::warning file=web/e2e/${f.file},line=${f.line}::Flaky (passed only on retry): ${f.title}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const body = flaky.length
    ? `### Flaky Playwright tests (passed only on retry)\n\n${line}\n\n${flaky.map((f) => `- \`${f.file}:${f.line}\` ${f.title}`).join('\n')}\n`
    : `### Playwright\n\n${line}; no flaky tests.\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, body);
}
