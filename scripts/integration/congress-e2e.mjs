#!/usr/bin/env node
/**
 * One complete congress on a disposable, isolated stack: real browser -> vite preview (production
 * build, service worker enabled) -> FastAPI -> PostgreSQL.
 *
 *   node scripts/integration/congress-e2e.mjs [--keep] [--skip-build] [--skip-scanner-spec]
 *
 * Safety: everything is created with fixed `congress-e2e-*` names on a private --internal Docker
 * network. PostgreSQL has no published port; only the API is published, on 127.0.0.1:8000. The
 * script refuses to continue unless the API's effective database is the dedicated `congress_e2e`
 * database inside its own PostgreSQL container. Nothing outside those containers is touched.
 *
 * Requirements: Docker, a local backend image with the dependencies in /app/.venv
 * (CONGRESS_E2E_BACKEND_IMAGE, default congress-t0-backend:2c0085137f), the postgres:16 image,
 * Node 22+, `npm ci` done in web/, and Microsoft Edge (Playwright channel `msedge`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJourney } from './journey.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
const IMAGE = process.env.CONGRESS_E2E_BACKEND_IMAGE ?? 'congress-t0-backend:2c0085137f';
const PG_IMAGE = process.env.CONGRESS_E2E_PG_IMAGE ?? 'postgres:16';
const NET = 'congress-e2e-net';
const PG = 'congress-e2e-pg';
const API = 'congress-e2e-api';
const DB = 'congress_e2e';
const PG_USER = 'congress_e2e';
const PG_PASSWORD = randomBytes(18).toString('hex');
const ADMIN_TOKEN = randomBytes(24).toString('hex');
const JWT_SECRET = randomBytes(24).toString('hex');
const BASE = 'http://127.0.0.1:4175';
const API_URL = 'http://127.0.0.1:8000';
const SHOT_DIR = resolve(root, 'docs/architecture/portal-redesign/congress-e2e');

const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', shell: process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx'), ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${argv.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`);
  return r;
};
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
  docker('run', '-d', '--name', API, '-p', '127.0.0.1:8000:8000', '--entrypoint', 'sleep', IMAGE, 'infinity');
  docker('network', 'connect', NET, API);
  for (const d of ['app', 'migrations']) {
    docker('exec', API, 'rm', '-rf', `/app/${d}`);
    docker('cp', resolve(root, 'backend', d), `${API}:/app/${d}`);
  }
  for (const f of ['alembic.ini', 'pyproject.toml', 'uv.lock']) docker('cp', resolve(root, 'backend', f), `${API}:/app/${f}`);
  // The image predates some dependencies (Pillow): sync the venv to the lock file while the container is still online.
  docker('exec', '-e', 'UV_PROJECT_ENVIRONMENT=/app/.venv', '-w', '/app', API, 'uv', 'sync', '--frozen', '--no-dev', '--quiet');
  // Production mode: the hardened configuration (explicit database, media volume, generated secrets) must hold.
  const env = ['-e', 'CONGRESS_ENVIRONMENT=production', '-e', `CONGRESS_DATABASE_URL=${dbUrl}`, '-e', 'CONGRESS_MEDIA_ROOT=/tmp/congress-media', '-e', `CONGRESS_PLATFORM_ADMIN_TOKEN=${ADMIN_TOKEN}`, '-e', `CONGRESS_JWT_SECRET=${JWT_SECRET}`, '-e', 'CONGRESS_CORS_ORIGINS=["http://127.0.0.1:4175"]'];
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
  console.log(`environment ok: db=${dbName} alembic=${alembicHead} api=127.0.0.1:8000 (pg unpublished, network ${NET} internal)`);
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  let preview;
  let failed = true;
  try {
    await up();
    if (!args.has('--skip-build') || !existsSync(resolve(root, 'web/dist'))) run('npm', ['run', 'build'], { cwd: resolve(root, 'web') });
    preview = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { cwd: resolve(root, 'web'), stdio: 'ignore', shell: process.platform === 'win32' });
    await waitFor('preview server', async () => (await fetch(BASE)).ok);

    const ctx = { root, BASE, API_URL, ADMIN_TOKEN, JWT_SECRET, SHOT_DIR, psql, docker, dockerQuiet, names: { API, PG, DB } };
    const result = await runJourney(ctx);
    writeFileSync(resolve(SHOT_DIR, 'last-run.json'), JSON.stringify(result, null, 2));
    failed = result.failed > 0;

    if (!args.has('--skip-scanner-spec')) {
      const spec = run('npx', ['playwright', 'test', 'e2e/scanner-real-api.spec.ts', '--retries=0'], {
        cwd: resolve(root, 'web'), allowFail: true,
        env: { ...process.env, PLAYWRIGHT_BASE_URL: BASE, CONGRESS_API_BASE_URL: API_URL, CONGRESS_PLATFORM_ADMIN_TOKEN: ADMIN_TOKEN, CI: '', FORCE_COLOR: '0', NO_COLOR: '1' },
      });
      console.log(`scanner-real-api.spec.ts exit=${spec.status}\n${(spec.stdout || '').split('\n').slice(-6).join('\n')}`);
      if (spec.status !== 0) failed = true;
    }
  } finally {
    if (preview) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F']); else preview.kill(); }
    if (!args.has('--keep')) teardown();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); teardown(); process.exit(2); });
