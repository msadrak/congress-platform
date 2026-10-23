#!/usr/bin/env node
/**
 * A disposable API + PostgreSQL stack for load tests on this computer (no Caddy, no persistent data):
 *
 *   node scripts/load/local-stack.mjs up [--build]   start it; prints the URLs and the admin token
 *   node scripts/load/local-stack.mjs logs            API log tail
 *   node scripts/load/local-stack.mjs down            remove containers and network (all data is gone)
 *
 * Uses its own container/network names (congress-load-*), so it never touches the staging project or the
 * local demo database. The API runs with CONGRESS_ENVIRONMENT=development: SMS uses the `console` provider
 * (nothing is sent) and the dev-only SMS outbox is available to setup.mjs. The image defaults to the staging
 * API image (LOAD_API_IMAGE, default congress-platform/api:staging); --build builds backend/ of this checkout
 * instead. State (names, port, token) is kept in .fixture/stack.json.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort, run } from '../lib/process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const STATE = resolve(here, '.fixture/stack.json');
const [command, ...flags] = process.argv.slice(2);
const sh = (args, opts = {}) => run('docker', args, opts);

async function up() {
  if (existsSync(STATE)) throw new Error(`A load stack is already recorded in ${STATE}: run \`down\` first.`);
  const id = randomBytes(3).toString('hex');
  const names = { net: `congress-load-net-${id}`, db: `congress-load-db-${id}`, api: `congress-load-api-${id}` };
  let image = process.env.LOAD_API_IMAGE ?? 'congress-platform/api:staging';
  if (flags.includes('--build')) {
    image = `congress-load-api:${id}`;
    console.log(`building ${image} from backend/ …`);
    sh(['build', '-t', image, resolve(root, 'backend')], { stdio: 'inherit' });
  }
  const port = await freePort();
  const state = { ...names, image, port, adminToken: randomBytes(24).toString('hex'), built: flags.includes('--build') };
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });

  const password = randomBytes(12).toString('hex');
  const dbUrl = `postgresql+asyncpg://congress:${password}@${names.db}:5432/congress`;
  sh(['network', 'create', names.net]);
  sh(['run', '-d', '--name', names.db, '--network', names.net, '-e', 'POSTGRES_USER=congress', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=congress', 'postgres:16-alpine']);
  for (let i = 0; i < 60 && sh(['exec', names.db, 'pg_isready', '-U', 'congress', '-h', '127.0.0.1'], { allowFail: true }).status !== 0; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const env = [
    '-e', 'CONGRESS_ENVIRONMENT=development',
    '-e', `CONGRESS_DATABASE_URL=${dbUrl}`,
    '-e', `CONGRESS_PLATFORM_ADMIN_TOKEN=${state.adminToken}`,
    '-e', `CONGRESS_JWT_SECRET=${randomBytes(32).toString('hex')}`,
    '-e', 'CONGRESS_MEDIA_ROOT=/tmp/media',
    '-e', 'CONGRESS_SMS_PROVIDER=console',
  ];
  console.log('migrating …');
  sh(['run', '--rm', '--network', names.net, ...env, image, 'alembic', 'upgrade', 'head'], { stdio: 'inherit' });
  sh(['run', '-d', '--name', names.api, '--network', names.net, '-p', `127.0.0.1:${port}:8000`, ...env, image]);
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(`http://127.0.0.1:${port}/api/ready`).then((r) => r.ok, () => false);
    if (ok) break;
    if (i === 59) throw new Error('The API did not become ready; see `node scripts/load/local-stack.mjs logs`.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`load stack up (image ${image})
  host URL (setup.mjs):      http://127.0.0.1:${port}
  k6 URL (inside network):   http://${names.api}:8000   with K6_NETWORK=${names.net}
  admin token:               ${state.adminToken}`);
}

function down() {
  if (!existsSync(STATE)) return console.log('no load stack recorded');
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  for (const name of [state.api, state.db]) sh(['rm', '-f', name], { allowFail: true });
  sh(['network', 'rm', state.net], { allowFail: true });
  if (state.built) sh(['image', 'rm', state.image], { allowFail: true });
  rmSync(STATE);
  console.log('load stack removed');
}

if (command === 'up') {
  await up().catch((error) => {
    console.error(error.message);
    down();
    process.exitCode = 1;
  });
} else if (command === 'down') down();
else if (command === 'logs') {
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  sh(['logs', '--tail', '200', state.api], { stdio: 'inherit', allowFail: true });
} else {
  console.error('usage: node scripts/load/local-stack.mjs up [--build] | logs | down');
  process.exitCode = 2;
}
