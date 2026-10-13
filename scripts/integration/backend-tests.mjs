#!/usr/bin/env node
/**
 * Backend pytest + mypy on disposable infrastructure: `node scripts/integration/backend-tests.mjs [pytest args]`.
 *
 * Why: the WSL runner used by scripts/check.bat has an oscillating wall clock (see
 * docs/reviews/PRODUCT_REALITY_AND_CUSTOMIZATION_AUDIT.md §D), which turns into random 401s
 * (PyJWT ImmatureSignatureError). This runner uses Docker Desktop's VM, whose clock follows the host
 * steadily, and records clock steps and JWT decode failures beside the run.
 *
 * Safety: a fresh PostgreSQL container on a private --internal network (no published port, random
 * password, no volume) holds the only database the suite can reach: `congress_test`. The test harness
 * additionally refuses any target that is not a marked `*_test` database. Everything is removed at the end.
 *
 * Requirements: Docker and the local backend image (CONGRESS_E2E_BACKEND_IMAGE, default
 * congress-t0-backend:2c0085137f, which provides Python 3.11 and uv). Dependencies are synced from
 * backend/uv.lock inside the container before it joins the private network.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = process.env.CONGRESS_E2E_BACKEND_IMAGE ?? 'congress-t0-backend:2c0085137f';
const PG_IMAGE = process.env.CONGRESS_E2E_PG_IMAGE ?? 'postgres:16';
const RUN = randomBytes(3).toString('hex');
const NET = `congress-pytest-net-${RUN}`, PG = `congress-pytest-pg-${RUN}`, RUNNER = `congress-pytest-runner-${RUN}`;
const PG_USER = 'congress', PG_PASSWORD = randomBytes(18).toString('hex');
const pytestArgs = process.argv.slice(2);

const sh = (cmd, args, { allowFail = false, inherit = false } = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe' });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}: ${r.stderr || r.stdout}`);
  return r;
};
const docker = (...a) => sh('docker', a);
const teardown = () => {
  for (const c of [RUNNER, PG]) sh('docker', ['rm', '-f', c], { allowFail: true });
  sh('docker', ['network', 'rm', NET], { allowFail: true });
};

let status = 1;
try {
  docker('network', 'create', '--internal', NET);
  docker('run', '-d', '--name', PG, '--network', NET, '-e', `POSTGRES_USER=${PG_USER}`, '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`, '-e', 'POSTGRES_DB=postgres', PG_IMAGE);

  docker('run', '-d', '--name', RUNNER, '--entrypoint', 'sleep', IMAGE, 'infinity');
  docker('exec', RUNNER, 'rm', '-rf', '/app/app', '/app/migrations', '/app/tests');
  for (const item of ['app', 'migrations', 'tests', 'alembic.ini', 'pyproject.toml', 'uv.lock']) {
    docker('cp', resolve(root, 'backend', item), `${RUNNER}:/app/${item}`);
  }
  docker('cp', resolve(root, 'scripts/diagnostics'), `${RUNNER}:/diagnostics`);
  console.log('syncing backend dependencies from uv.lock …');
  sh('docker', ['exec', '-e', 'UV_PROJECT_ENVIRONMENT=/app/.venv', '-w', '/app', RUNNER, 'uv', 'sync', '--frozen', '--quiet'], { inherit: true });
  docker('network', 'disconnect', 'bridge', RUNNER);
  docker('network', 'connect', NET, RUNNER);

  for (let i = 0; i < 60 && sh('docker', ['exec', PG, 'pg_isready', '-U', PG_USER, '-h', '127.0.0.1'], { allowFail: true }).status !== 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const hostUtc = new Date().toISOString();
  const runnerUtc = docker('exec', RUNNER, 'date', '-u', '+%Y-%m-%dT%H:%M:%S').stdout.trim();
  console.log(`clock: host ${hostUtc} / runner ${runnerUtc}`);

  const env = [
    '-e', `CONGRESS_TEST_DATABASE_URL=postgresql+asyncpg://${PG_USER}:${PG_PASSWORD}@${PG}:5432/congress_test`,
    '-e', `CONGRESS_TEST_ADMIN_DSN=postgresql://${PG_USER}:${PG_PASSWORD}@${PG}:5432/postgres`,
    '-e', 'PYTHONPATH=/diagnostics',
  ];
  console.log('mypy …');
  const mypy = sh('docker', ['exec', '-w', '/app', RUNNER, '.venv/bin/mypy'], { allowFail: true, inherit: true });
  console.log('pytest …');
  const script = [
    '(python3 /diagnostics/clockmon.py 3600 &)',
    `.venv/bin/pytest -q -p jwtdiag ${pytestArgs.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
    'code=$?',
    'echo "--- clock steps (>50 ms) during the run: $(cat /tmp/clockmon.log 2>/dev/null | wc -l)"',
    'echo "--- JWT decode failures: $(cat /tmp/jwtdiag.log 2>/dev/null | grep -c reason) (intentional negative cases included); ImmatureSignatureError (clock skew): $(cat /tmp/jwtdiag.log 2>/dev/null | grep -c ImmatureSignatureError)"',
    'exit $code',
  ].join('; ');
  const pytest = sh('docker', ['exec', ...env, '-w', '/app', RUNNER, 'sh', '-c', script], { allowFail: true, inherit: true });
  status = mypy.status === 0 && pytest.status === 0 ? 0 : 1;
  console.log(`mypy exit=${mypy.status} pytest exit=${pytest.status}`);
} catch (e) {
  console.error(e.message);
  status = 2;
} finally {
  teardown();
}
process.exit(status);
