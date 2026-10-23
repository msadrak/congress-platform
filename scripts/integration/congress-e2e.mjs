#!/usr/bin/env node
/**
 * One complete congress on a disposable, isolated stack: real browser -> vite preview (production
 * build, service worker enabled) -> FastAPI -> PostgreSQL.
 *
 *   node scripts/integration/congress-e2e.mjs [--keep] [--skip-build]
 *
 * The per-persona Playwright journeys against a live stack are web/e2e-live (scripts/integration/live-e2e.mjs);
 * this script is the older single-run journey with database cross-checks.
 *
 * Safety: everything is created with fixed `congress-e2e-*` names on a private --internal Docker
 * network. PostgreSQL has no published port; only the API is published, on 127.0.0.1 at a free port
 * picked per run (the preview server gets another one), so nothing collides with other stacks. The
 * script refuses to continue unless the API's effective database is the dedicated `congress_e2e`
 * database inside its own PostgreSQL container. Nothing outside those containers is touched.
 *
 * Requirements: Docker, a local backend image with the dependencies in /app/.venv
 * (CONGRESS_E2E_BACKEND_IMAGE, default: the hashed test-runner image, built on first use), the postgres:16 image,
 * Node 22+, `npm ci` done in web/, and Microsoft Edge (Playwright channel `msedge`).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendImage, syncBackendDependencies } from '../lib/backend-image.mjs';
import { freePorts, run, startPreview, stopProcess } from '../lib/process.mjs';
import { runJourney } from './journey.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
// The hashed test-runner image (built on first use) or CONGRESS_E2E_BACKEND_IMAGE: scripts/lib/backend-image.mjs.
const IMAGE = backendImage();
const PG_IMAGE = process.env.CONGRESS_E2E_PG_IMAGE ?? 'postgres:16';
const NET = 'congress-e2e-net';
const PG = 'congress-e2e-pg';
const API = 'congress-e2e-api';
const DB = 'congress_e2e';
const PG_USER = 'congress_e2e';
const PG_PASSWORD = randomBytes(18).toString('hex');
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const JWT_SECRET = randomBytes(24).toString('hex');
const [WEB_PORT, API_PORT] = await freePorts(2);
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const SHOT_DIR = resolve(root, 'docs/architecture/portal-redesign/congress-e2e');

const docker = (...argv) => run('docker', argv);
const dockerQuiet = (...argv) => run('docker', argv, { allowFail: true });

const psql = (sql) => docker('exec', PG, 'psql', '-U', PG_USER, '-d', DB, '-At', '-F', '|', '-c', sql).stdout.trim();

function teardown() {
  for (const c of [API, PG]) dockerQuiet('rm', '-f', c);
  dockerQuiet('network', 'rm', NET);
}

async function waitFor(label, probe, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await probe()) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function up() {
  for (const image of [IMAGE, PG_IMAGE]) {
    if (dockerQuiet('image', 'inspect', image).status !== 0) throw new Error(`Docker image not found locally: ${image}`);
  }
  teardown();
  docker('network', 'create', '--internal', NET);
  // No published port: PostgreSQL is reachable only from containers on the private network.
  docker('run', '-d', '--name', PG, '--network', NET, '-e', `POSTGRES_USER=${PG_USER}`, '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`, '-e', 'POSTGRES_DB=postgres', PG_IMAGE);
  await waitFor('PostgreSQL', () => dockerQuiet('exec', PG, 'pg_isready', '-U', PG_USER).status === 0);
  await new Promise((r) => setTimeout(r, 1500));
  docker('exec', PG, 'psql', '-U', PG_USER, '-d', 'postgres', '-c', `CREATE DATABASE ${DB}`);

  const dbUrl = `postgresql+asyncpg://${PG_USER}:${PG_PASSWORD}@${PG}:5432/${DB}`;
  docker('run', '-d', '--name', API, '-p', `127.0.0.1:${API_PORT}:8000`, '--entrypoint', 'sleep', IMAGE, 'infinity');
  docker('network', 'connect', NET, API);
  for (const d of ['app', 'migrations']) {
    docker('exec', API, 'rm', '-rf', `/app/${d}`);
    docker('cp', resolve(root, 'backend', d), `${API}:/app/${d}`);
  }
  for (const f of ['alembic.ini', 'pyproject.toml', 'uv.lock']) docker('cp', resolve(root, 'backend', f), `${API}:/app/${f}`);
  // The image predates some dependencies (Pillow): sync the venv to the lock file while the container is still online.
  syncBackendDependencies(API, ['--no-dev']);
  // Staging mode: the hardened configuration (explicit database, media volume, generated secrets) must hold. Not
  // production, which requires real sms.ir delivery: the console provider records SMS for the journey to read, and
  // the send limits are relaxed because the journey signs the same numbers in repeatedly within seconds.
  const env = ['-e', 'CONGRESS_ENVIRONMENT=staging', '-e', 'CONGRESS_SMS_PROVIDER=console', '-e', 'CONGRESS_OTP_RESEND_COOLDOWN_SECONDS=0', '-e', 'CONGRESS_OTP_SENDS_PER_MOBILE_PER_HOUR=1000', '-e', 'CONGRESS_OTP_SENDS_PER_IP_PER_HOUR=10000', '-e', `CONGRESS_DATABASE_URL=${dbUrl}`, '-e', 'CONGRESS_MEDIA_ROOT=/tmp/congress-media', '-e', `CONGRESS_PLATFORM_ADMIN_TOKEN=${ADMIN_TOKEN}`, '-e', `CONGRESS_JWT_SECRET=${JWT_SECRET}`, '-e', `CONGRESS_CORS_ORIGINS=${JSON.stringify([BASE])}`];
  docker('exec', ...env, API, 'sh', '-c', 'cd /app && .venv/bin/alembic upgrade head');
  docker('exec', '-d', ...env, API, 'sh', '-c', 'cd /app && .venv/bin/uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000 > /tmp/api.log 2>&1');
  await waitFor('API', async () => (await fetch(`${API_URL}/api/ready`)).status === 200);

  // Effective-connection check before anything destructive: the API's own settings and the
  // database the fixtures will use must be the dedicated one in the private container.
  const cfg = docker('exec', ...env, API, 'sh', '-c', 'cd /app && .venv/bin/python -c "from app.config import Settings; print(Settings().database_url)"').stdout.trim();
  const dbName = psql('select current_database()');
  const alembicHead = psql('select version_num from alembic_version');
  if (!cfg.includes(`@${PG}:5432/${DB}`) || dbName !== DB) throw new Error(`Refusing to continue: effective database is ${cfg} / ${dbName}`);
  const published = docker('port', PG).stdout.trim();
  if (published) throw new Error('PostgreSQL unexpectedly publishes a port');
  console.log(`environment ok: db=${dbName} alembic=${alembicHead} api=${API_URL} web=${BASE} (pg unpublished, network ${NET} internal)`);
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  let preview;
  let failed = true;
  try {
    await up();
    if (!args.has('--skip-build') || !existsSync(resolve(root, 'web/dist'))) run('npm', ['run', 'build'], { cwd: resolve(root, 'web') });
    preview = startPreview({ port: WEB_PORT, apiOrigin: API_URL });
    await waitFor('preview server', async () => (await fetch(BASE)).ok);

    const ctx = { root, BASE, API_URL, ADMIN_TOKEN, JWT_SECRET, SHOT_DIR, psql, docker, dockerQuiet, names: { API, PG, DB }, otpCooldownMs: 0 };
    const result = await runJourney(ctx);
    writeFileSync(resolve(SHOT_DIR, 'last-run.json'), JSON.stringify(result, null, 2));
    failed = result.failed > 0;
  } finally {
    stopProcess(preview);
    if (!args.has('--keep')) teardown();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); teardown(); process.exit(2); });
