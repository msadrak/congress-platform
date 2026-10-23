#!/usr/bin/env node
/**
 * The live-stack Playwright suite (web/e2e-live): real browser -> vite preview (production build) -> FastAPI ->
 * PostgreSQL, all disposable.
 *
 *   node scripts/integration/live-e2e.mjs [--keep | --up-only] [--skip-build] [-- <playwright args>]
 *
 *   --keep        after the run, keep the stack up (this script keeps serving the web build until Ctrl-C; the
 *                 containers stay after that too) and print how to rerun specs against it and how to remove it
 *   --up-only     start the stack and keep it, without running the specs (implies --keep)
 *   --skip-build  serve the existing web/dist instead of building it (built anyway when missing)
 *   -- …          passed to `playwright test`, e.g. `-- e2e-live/attendee.spec.ts --headed`
 *
 * The stack: PostgreSQL on a private --internal Docker network (no published port), the API in the backend test
 * image (scripts/lib/backend-image.mjs; this checkout's backend/ copied in, migrated with Alembic) published on
 * 127.0.0.1, and `vite preview` proxying same-origin /api to it (web/vite.config.ts, CONGRESS_API_ORIGIN). The API
 * runs in development mode with the console SMS provider, so nothing is sent and sign-in codes are read from the
 * dev-only outbox (GET /api/platform/sms-outbox) with a fixed platform admin token. Ports come from 47400-47409.
 *
 * Safety: container and network names carry a random run id (congress-live-<id>-*), so parallel runs and other
 * projects sharing Docker are never touched; only those containers and that network are removed, always, unless
 * --keep. Requirements: Docker, Node 22+, `npm ci` in web/, a Playwright browser (CONGRESS_BROWSER_CHANNEL: CI uses
 * Playwright's chromium, locally e.g. `chrome`).
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendImage, syncBackendDependencies } from '../lib/backend-image.mjs';
import { run, startPreview, stopProcess } from '../lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const web = resolve(root, 'web');
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const flags = new Set(split === -1 ? argv : argv.slice(0, split));
const playwrightArgs = split === -1 ? [] : argv.slice(split + 1);
const UP_ONLY = flags.has('--up-only');
const KEEP = UP_ONLY || flags.has('--keep');

const RUN = randomBytes(3).toString('hex');
const NET = `congress-live-${RUN}-net`;
const PG = `congress-live-${RUN}-pg`;
const API = `congress-live-${RUN}-api`;
const PG_IMAGE = process.env.CONGRESS_E2E_PG_IMAGE ?? 'postgres:16';
const PG_USER = 'congress';
const PG_PASSWORD = randomBytes(18).toString('hex');
const DB = 'congress_live_e2e';
// Fixed on purpose (development mode only, never leaves this machine): a kept stack can be driven by hand.
const ADMIN_TOKEN = 'live-e2e-platform-admin-token-not-a-secret';
const PORT_RANGE = [47400, 47409];

const docker = (...args) => run('docker', args);
const dockerQuiet = (...args) => run('docker', args, { allowFail: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let tornDown = false;
function teardown() {
  if (tornDown) return;
  tornDown = true;
  for (const c of [API, PG]) dockerQuiet('rm', '-f', c);
  dockerQuiet('network', 'rm', NET);
}

/** The first `count` ports in 47400-47409 that accept a 127.0.0.1 listener right now. */
async function portsInRange(count) {
  const free = [];
  for (let port = PORT_RANGE[0]; port <= PORT_RANGE[1] && free.length < count; port++) {
    const ok = await new Promise((resolveOk) => {
      const server = createServer();
      server.once('error', () => resolveOk(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolveOk(true)));
    });
    if (ok) free.push(port);
  }
  if (free.length < count) throw new Error(`Need ${count} free ports in ${PORT_RANGE.join('-')}, found ${free.length}`);
  return free;
}

async function waitFor(label, probe, ms = 90_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await probe()) return; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function apiLogTail() {
  const log = dockerQuiet('exec', API, 'tail', '-n', '80', '/tmp/api.log');
  return log.status === 0 ? log.stdout : '(no API log)';
}

async function up({ webPort, apiPort }) {
  const image = backendImage();
  if (dockerQuiet('image', 'inspect', PG_IMAGE).status !== 0) {
    console.log(`pulling ${PG_IMAGE} …`);
    run('docker', ['pull', PG_IMAGE], { stdio: 'inherit' });
  }
  const base = `http://127.0.0.1:${webPort}`;
  docker('network', 'create', '--internal', NET);
  docker('run', '-d', '--name', PG, '--network', NET, '-e', `POSTGRES_USER=${PG_USER}`, '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`, '-e', `POSTGRES_DB=${DB}`, PG_IMAGE);

  // The API container starts on the default bridge (for the published port and the dependency sync), then joins the
  // private network to reach PostgreSQL.
  docker('run', '-d', '--name', API, '-p', `127.0.0.1:${apiPort}:8000`, '--entrypoint', 'sleep', image, 'infinity');
  docker('exec', API, 'rm', '-rf', '/app/app', '/app/migrations');
  for (const item of ['app', 'migrations', 'alembic.ini', 'pyproject.toml', 'uv.lock']) docker('cp', resolve(root, 'backend', item), `${API}:/app/${item}`);
  syncBackendDependencies(API, ['--no-dev']);
  docker('network', 'connect', NET, API);
  await waitFor('PostgreSQL', () => dockerQuiet('exec', PG, 'pg_isready', '-U', PG_USER, '-d', DB, '-h', '127.0.0.1').status === 0);

  const env = {
    CONGRESS_ENVIRONMENT: 'development',
    CONGRESS_SMS_PROVIDER: 'console',
    CONGRESS_DATABASE_URL: `postgresql+asyncpg://${PG_USER}:${PG_PASSWORD}@${PG}:5432/${DB}`,
    CONGRESS_MEDIA_ROOT: '/tmp/congress-media',
    CONGRESS_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN,
    CONGRESS_JWT_SECRET: randomBytes(32).toString('hex'),
    CONGRESS_PUBLIC_ORIGIN: base,
    CONGRESS_CORS_ORIGINS: JSON.stringify([base]),
    // Specs sign many numbers in within seconds from one IP: no resend wait, generous budgets.
    CONGRESS_OTP_RESEND_COOLDOWN_SECONDS: '0',
    CONGRESS_OTP_SENDS_PER_MOBILE_PER_HOUR: '1000',
    CONGRESS_OTP_SENDS_PER_IP_PER_HOUR: '100000',
    CONGRESS_SMS_HOURLY_CAP: '0',
    CONGRESS_SMS_DAILY_CAP: '0',
    // Queued SMS (ticket confirmations, resent passes) go out within a second.
    CONGRESS_SMS_OUTBOX_POLL_SECONDS: '0.5',
  };
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  docker('exec', ...envArgs, '-w', '/app', API, '.venv/bin/alembic', 'upgrade', 'head');
  docker('exec', '-d', ...envArgs, '-w', '/app', API, 'sh', '-c', '.venv/bin/uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000 > /tmp/api.log 2>&1');
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  await waitFor('API', async () => (await fetch(`${apiUrl}/api/ready`)).status === 200).catch((error) => {
    console.error(apiLogTail());
    throw error;
  });
  return { base, apiUrl };
}

async function main() {
  const started = Date.now();
  const [webPort, apiPort] = await portsInRange(2);
  let preview;
  process.on('SIGINT', () => { stopProcess(preview); if (!KEEP) teardown(); process.exit(130); });
  let status = 1;
  try {
    const { base, apiUrl } = await up({ webPort, apiPort });
    console.log(`stack up in ${((Date.now() - started) / 1000).toFixed(0)} s: web ${base} -> api ${apiUrl} (run ${RUN})`);
    if (!flags.has('--skip-build') || !existsSync(resolve(web, 'dist/index.html'))) {
      console.log('building web/dist …');
      run(process.execPath, [resolve(web, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'runner', '--logLevel', 'warn'], { cwd: web, stdio: 'inherit' });
    }
    preview = startPreview({ port: webPort, apiOrigin: apiUrl });
    await waitFor('preview server', async () => (await fetch(base)).ok);
    await waitFor('API through the preview proxy', async () => (await fetch(`${base}/api/ready`)).ok);

    const liveEnv = { LIVE_E2E_BASE_URL: base, LIVE_E2E_API_URL: apiUrl, LIVE_E2E_ADMIN_TOKEN: ADMIN_TOKEN };
    if (!UP_ONLY) {
      const tests = run('npx', ['playwright', 'test', '-c', 'playwright.live.config.ts', ...playwrightArgs], { cwd: web, allowFail: true, stdio: 'inherit', env: liveEnv });
      status = tests.status ?? 1;
      if (status !== 0) console.error(`\nAPI log tail:\n${apiLogTail()}`);
    } else status = 0;
    if (KEEP) {
      console.log(`\nStack kept (run ${RUN}). Rerun specs against it from web/:\n  ${Object.entries(liveEnv).map(([k, v]) => `${k}=${v}`).join(' ')} npx playwright test -c playwright.live.config.ts`);
      console.log(`API log: docker exec ${API} tail -f /tmp/api.log`);
      console.log(`Remove the stack: docker rm -f ${API} ${PG} && docker network rm ${NET}`);
      console.log('Serving the web build until Ctrl-C (the containers stay) …');
      await new Promise(() => {});
    }
  } finally {
    stopProcess(preview);
    if (!KEEP) teardown();
  }
  console.log(`live e2e finished in ${((Date.now() - started) / 1000).toFixed(0)} s (exit ${status})`);
  process.exit(status);
}

main().catch((error) => {
  console.error(error);
  if (!KEEP) teardown();
  process.exit(2);
});
