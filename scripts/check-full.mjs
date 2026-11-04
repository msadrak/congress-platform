#!/usr/bin/env node
/**
 * The CI-only checks, run locally by `./scripts/check.sh --full` / `scripts\check.bat --full` after the fast gate:
 *
 *   node scripts/check-full.mjs [--skip <name>[,<name>…]]
 *
 *   playwright  every web/e2e spec against the production build (CONGRESS_E2E_PREVIEW=1) in the browser named by
 *               CONGRESS_BROWSER_CHANNEL (default here: chrome; CI uses Playwright's chromium)
 *   caddy       `caddy validate` of deploy/staging/Caddyfile in every edge mode (scripts/ci/validate-caddyfile.mjs)
 *   k6          `k6 inspect` of every scripts/load scenario (scripts/load/k6.mjs inspect)
 *   pip-audit   backend/uv.lock runtime dependencies; high/critical fail (scripts/ci/pip-audit-gate.mjs). Local uv
 *               when on PATH, else inside the backend test image (scripts/lib/backend-image.mjs)
 *   npm-audit   web production dependencies, `npm audit --omit=dev --audit-level=high`
 *   images      docker build of backend/Dockerfile, deploy/web/Dockerfile and deploy/db/Dockerfile, tagged
 *               congress-check/{api,web,db}:local (overwritten each run, never pushed)
 *
 * Every check runs even when an earlier one fails; the summary lists each result and the exit code is 1 when any
 * failed. Needs Docker (Caddy, k6, images, and pip-audit without uv) and network access (audits, image builds).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureBackendTestImage } from './lib/backend-image.mjs';
import { run } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { skip: { type: 'string', default: '' } } });
const skipped = new Set(args.skip.split(',').map((s) => s.trim()).filter(Boolean));
const sh = (cmd, argv, opts = {}) => run(cmd, argv, { allowFail: true, stdio: 'inherit', cwd: root, ...opts }).status === 0;
const have = (cmd) => run(cmd, ['--version'], { allowFail: true }).status === 0;

function playwright() {
  const web = join(root, 'web');
  try {
    readFileSync(join(web, 'dist/index.html'));
  } catch {
    if (!sh('npm', ['run', 'build'], { cwd: web })) return false;
  }
  return sh('npx', ['playwright', 'test'], {
    cwd: web,
    env: { CONGRESS_E2E_PREVIEW: '1', CONGRESS_BROWSER_CHANNEL: process.env.CONGRESS_BROWSER_CHANNEL || 'chrome' },
  });
}

function pipAudit() {
  const out = mkdtempSync(join(tmpdir(), 'congress-pip-audit-'));
  try {
    const report = join(out, 'pip-audit.json');
    if (have('uv')) {
      const requirements = join(out, 'requirements.txt');
      const backend = join(root, 'backend');
      if (!sh('uv', ['export', '--frozen', '--no-dev', '--no-emit-project', '--format', 'requirements-txt', '--output-file', requirements], { cwd: backend })) return false;
      // pip-audit exits non-zero on any finding; the gate decides by severity.
      sh('uvx', ['pip-audit', '--disable-pip', '--requirement', requirements, '--progress-spinner', 'off', '--format', 'json', '--output', report]);
    } else {
      const image = ensureBackendTestImage();
      // backend/ read-only; only the report is written, into a temporary folder.
      sh('docker', ['run', '--rm', '-v', `${join(root, 'backend')}:/src:ro`, '-v', `${out}:/out`, '-w', '/src', image, 'sh', '-c',
        'uv export --frozen --no-dev --no-emit-project --format requirements-txt --output-file /tmp/requirements.txt'
        + ' && uvx pip-audit --disable-pip --requirement /tmp/requirements.txt --progress-spinner off --format json --output /out/pip-audit.json'
        + '; chmod a+r /out/pip-audit.json 2>/dev/null; true'], { env: { MSYS_NO_PATHCONV: '1' } });
    }
    return sh('node', ['scripts/ci/pip-audit-gate.mjs', report]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const build = (name, context, dockerfile) => sh('docker', ['build', '-t', `congress-check/${name}:local`, '-f', dockerfile, context]);

const CHECKS = {
  playwright,
  caddy: () => sh('node', ['scripts/ci/validate-caddyfile.mjs']),
  k6: () => sh('node', ['scripts/load/k6.mjs', 'inspect']),
  'pip-audit': pipAudit,
  'npm-audit': () => sh('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: join(root, 'web') }),
  images: () => [
    build('api', 'backend', 'backend/Dockerfile'),
    build('web', '.', 'deploy/web/Dockerfile'),
    build('db', 'deploy/db', 'deploy/db/Dockerfile'),
  ].every(Boolean),
};

const unknown = [...skipped].filter((name) => !(name in CHECKS));
if (unknown.length) {
  console.error(`unknown --skip ${unknown.join(', ')}; checks: ${Object.keys(CHECKS).join(', ')}`);
  process.exit(2);
}
const results = [];
for (const [name, fn] of Object.entries(CHECKS)) {
  if (skipped.has(name)) {
    results.push([name, 'skipped']);
    continue;
  }
  console.log(`\n  -> [full] ${name}`);
  let ok = false;
  try {
    ok = fn();
  } catch (error) {
    console.error(error.message);
  }
  results.push([name, ok ? 'ok' : 'FAILED']);
}
console.log('\n  Full checks:');
for (const [name, result] of results) console.log(`    ${name.padEnd(11)} ${result}`);
process.exitCode = results.some(([, result]) => result === 'FAILED') ? 1 : 0;
