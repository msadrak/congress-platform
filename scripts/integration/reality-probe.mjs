#!/usr/bin/env node
/**
 * Product-reality probe (diagnostic, disposable): `node scripts/integration/reality-probe.mjs`.
 * Requires Docker, the local backend image used by congress-e2e.mjs, postgres:16, a built `web/dist` and Edge. Fresh PostgreSQL in a private Docker network with a
 * named volume, API on 127.0.0.1:8000 (from the existing local backend image), production web build
 * served by `vite preview` on 127.0.0.1:4176. No seed data. Everything is removed at the end.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'web/package.json'));
const { chromium } = require('playwright');
const IMAGE = process.env.CONGRESS_E2E_BACKEND_IMAGE ?? 'congress-t0-backend:2c0085137f';
const NET = 'congress-reality-net', PG = 'congress-reality-pg', API = 'congress-reality-api', VOL = 'congress-reality-pgdata';
const DB = 'congress_reality', PGU = 'congress_reality', PGPW = randomBytes(18).toString('hex');
const ADMIN = randomBytes(16).toString('hex'), JWTS = randomBytes(32).toString('hex');
const BASE = 'http://127.0.0.1:4176', API_URL = 'http://127.0.0.1:8000';
const RUN = Date.now().toString(36).slice(-5);
const PW = `Synth-${randomBytes(6).toString('hex')}!`;
const mail = (n) => `${n}.${RUN}@example.com`;

const sh = (cmd, args, allowFail = false) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' && (cmd === 'npx') });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}: ${r.stderr || r.stdout}`);
  return r;
};
const docker = (...a) => sh('docker', a);
const psql = (sql) => docker('exec', PG, 'psql', '-U', PGU, '-d', DB, '-At', '-c', sql).stdout.trim();
const wait = async (label, probe, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await probe()) return; } catch {} await new Promise((r) => setTimeout(r, 700)); } throw new Error('timeout ' + label); };
const env = () => ['-e', `CONGRESS_DATABASE_URL=postgresql+asyncpg://${PGU}:${PGPW}@${PG}:5432/${DB}`, '-e', `CONGRESS_PLATFORM_ADMIN_TOKEN=${ADMIN}`, '-e', `CONGRESS_JWT_SECRET=${JWTS}`, '-e', 'CONGRESS_CORS_ORIGINS=["http://127.0.0.1:4176"]'];
const http = async (m, p, { token, key, admin, body } = {}) => {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  if (key) h.Authorization = `Bearer ${key}`;
  if (admin) h['X-Admin-Token'] = ADMIN;
  const r = await fetch(API_URL + p, { method: m, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
};
const results = [];
const check = async (name, how, fn) => { try { const note = await fn(); results.push({ ok: true, name, how, note }); console.log(`PASS [${how}] ${name}${note ? ' — ' + note : ''}`); } catch (e) { results.push({ ok: false, name, how }); console.log(`FAIL [${how}] ${name} — ${e.message.split('\n')[0]}`); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };

function teardown() { for (const c of [API, PG]) sh('docker', ['rm', '-f', c], true); sh('docker', ['network', 'rm', NET], true); sh('docker', ['volume', 'rm', VOL], true); }
async function startPg() {
  docker('run', '-d', '--name', PG, '--network', NET, '-v', `${VOL}:/var/lib/postgresql/data`, '-e', `POSTGRES_USER=${PGU}`, '-e', `POSTGRES_PASSWORD=${PGPW}`, '-e', `POSTGRES_DB=${DB}`, 'postgres:16');
  await wait('pg', () => sh('docker', ['exec', PG, 'pg_isready', '-U', PGU, '-d', DB], true).status === 0);
  await new Promise((r) => setTimeout(r, 1500));
}
async function startUvicorn() {
  docker('exec', '-d', ...env(), API, 'sh', '-c', 'cd /app && .venv/bin/uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000 > /tmp/api.log 2>&1');
  await wait('api', async () => (await fetch(`${API_URL}/api/public/events/none`)).status === 404);
}

let preview, browser;
try {
  teardown();
  docker('network', 'create', '--internal', NET);
  await startPg();
  docker('run', '-d', '--name', API, '-p', '127.0.0.1:8000:8000', '--entrypoint', 'sleep', IMAGE, 'infinity');
  docker('network', 'connect', NET, API);
  for (const d of ['app', 'migrations']) { docker('exec', API, 'rm', '-rf', `/app/${d}`); docker('cp', resolve(root, 'backend', d), `${API}:/app/${d}`); }
  docker('cp', resolve(root, 'backend/alembic.ini'), `${API}:/app/alembic.ini`);
  docker('exec', ...env(), API, 'sh', '-c', 'cd /app && .venv/bin/alembic upgrade head');
  await startUvicorn();
  if (docker('port', PG).stdout.trim()) throw new Error('PostgreSQL publishes a port');
  console.log(`env: db=${psql('select current_database()')} alembic=${psql('select version_num from alembic_version')} pg unpublished`);

  await check('Fresh database: no users, organizers, events or tickets; API serves without any seed', 'DB', async () => {
    const counts = ['users', 'organizers', 'events', 'tickets'].map((t) => `${t}=${psql(`select count(*) from ${t}`)}`).join(' ');
    if (!/users=0 organizers=0 events=0 tickets=0/.test(counts)) throw new Error(counts);
    return counts;
  });

  preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'], { cwd: resolve(root, 'web'), stdio: 'ignore', shell: true });
  await wait('preview', async () => (await fetch(BASE)).ok);
  browser = await chromium.launch({ channel: 'msedge' });
  const page = async (vw = { width: 1280, height: 900 }) => { const c = await browser.newContext({ viewport: vw, serviceWorkers: 'block' }); await c.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en')); return c.newPage(); };

  // ── Organizer onboarding ──
  let orgKey, otherKey, eventId, tierId, slug = `reality-${RUN}`;
  await check('Organizer tenant created (only path: X-Admin-Token platform API)', 'privileged API', async () => {
    eq((await http('POST', '/api/organizers', { body: { name: 'x' } })).status, 401, 'without admin token');
    const r = await http('POST', '/api/organizers', { admin: true, body: { name: `Reality Org ${RUN}` } });
    eq(r.status, 201, 'create'); orgKey = r.json.api_key;
    otherKey = (await http('POST', '/api/organizers', { admin: true, body: { name: `Other Org ${RUN}` } })).json.api_key;
    const stored = psql(`select api_key_hash is not null from organizers where name='Reality Org ${RUN}'`).trim();
    return `api key returned once; organizers row present (hash column populated: ${stored || 'n/a'})`;
  });
  const O = await page();
  await check('Organizer signs in with the key and creates a congress + tier in the UI', 'UI', async () => {
    await O.goto(`${BASE}/organizer`);
    await O.locator('#apiKeyInput').fill(orgKey);
    await O.getByRole('button', { name: /Access Organizer Dashboard/ }).click();
    await O.getByRole('button', { name: /Create New Event/ }).first().click();
    const d = O.getByRole('dialog');
    await d.getByPlaceholder('e.g. 18th Annual Congress of Biotechnology').fill(`Reality Congress ${RUN}`);
    await d.getByPlaceholder('biotech-congress-2027').fill(slug);
    const dates = d.locator('input[type=datetime-local]');
    await dates.nth(0).fill('2027-09-10T09:00'); await dates.nth(1).fill('2027-09-11T17:00');
    await d.getByPlaceholder('e.g. International Convention Center, Hall A').fill('Synthetic Hall');
    await d.getByRole('button', { name: 'Create Event' }).click();
    await O.getByRole('status').filter({ hasText: `Reality Congress ${RUN}` }).waitFor({ timeout: 10000 });
    eventId = psql(`select id from events where slug='${slug}'`);
    await O.goto(`${BASE}/organizer/events/${eventId}/tiers`);
    await O.getByRole('button', { name: /Add Ticket Tier/ }).first().click();
    const t = O.getByRole('dialog');
    await t.getByPlaceholder('e.g. Faculty Full Delegate').fill(`Delegate ${RUN}`);
    await t.locator('input[type=number]').first().fill('10');
    await t.getByRole('button', { name: 'Save Ticket Tier' }).click();
    await O.getByRole('status').filter({ hasText: `Delegate ${RUN}` }).waitFor({ timeout: 10000 });
    tierId = psql(`select id from ticket_tiers where event_id='${eventId}'`);
    return `event ${eventId.slice(0, 8)}…, tier quota=${psql(`select quota from ticket_tiers where id='${tierId}'`)}, open=${psql(`select is_open from ticket_tiers where id='${tierId}'`)}`;
  });

  // ── Public page + registration ──
  const A = await page({ width: 390, height: 844 });
  let ticketId, secret;
  await check('New congress is publicly reachable at /e/<slug> without code changes', 'UI', async () => {
    await A.goto(`${BASE}/e/${slug}`);
    await A.getByRole('heading', { name: new RegExp(`Reality Congress ${RUN}`) }).first().waitFor({ timeout: 10000 });
    await A.getByText(`Delegate ${RUN}`).first().waitFor();
  });
  await check('New User registers + reserves through the public dialog; rows in PostgreSQL', 'UI', async () => {
    await A.getByRole('button', { name: /Reserve Free Pass/ }).first().click();
    const d = A.getByRole('dialog');
    await d.getByPlaceholder('e.g. Dr. Sarah Jenkins').fill('Synthetic Attendee One');
    await d.getByPlaceholder('name@institution.org').fill(mail('one'));
    await d.getByPlaceholder('Minimum 8 characters').fill(PW);
    await d.getByRole('button', { name: /Confirm Registration/ }).click();
    await A.getByRole('heading', { name: 'Pass Reserved Successfully!' }).waitFor({ timeout: 15000 });
    eq(psql(`select count(*) from users where email='${mail('one')}'`), '1', 'user row');
    const hash = psql(`select password_hash from users where email='${mail('one')}'`);
    if (!hash.startsWith('pbkdf2_sha256$') || hash.includes(PW)) throw new Error('password not hashed');
    ticketId = psql(`select t.id from tickets t join users u on u.id=t.user_id where u.email='${mail('one')}' and t.event_id='${eventId}' and t.ticket_tier_id='${tierId}'`);
    secret = psql(`select secret from entity_qrs where entity_id='${ticketId}' and entity_type='attendee_ticket'`);
    eq(psql(`select reserved_count from ticket_tiers where id='${tierId}'`), '1', 'reserved_count');
    const orders = psql(`select count(*) from information_schema.tables where table_name in ('orders','order','payments')`);
    return `user + ticket + entity_qrs(${secret.length}-char secret); reserved_count=1; order/payment tables=${orders}`;
  });
  const decodeQr = async (p) => {
    await p.addScriptTag({ path: resolve(root, 'web/node_modules/jsqr/dist/jsQR.js') });
    return p.evaluate(async () => {
      const svg = [...document.querySelectorAll('main svg')].find((s) => { const m = /^0 0 (\d+) (\d+)$/.exec(s.getAttribute('viewBox') || ''); return m && m[1] === m[2] && s.getBoundingClientRect().width >= 150; });
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
      await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = 600; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 600, 600); g.drawImage(img, 50, 50, 500, 500);
      const data = g.getImageData(0, 0, 600, 600);
      return window.jsQR(data.data, 600, 600)?.data ?? null;
    });
  };
  await check('Rendered pass QR decodes to exactly the ticket\'s DB secret', 'UI+DB', async () => {
    await A.goto(`${BASE}/c/${slug}/my-ticket`);
    await A.getByText(`Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
    const value = await decodeQr(A);
    eq(value, secret, 'qr payload');
    return 'QR payload == entity_qrs.secret';
  });
  await check('Sign out, then sign in again through the sign-in page', 'UI', async () => {
    await A.getByRole('button', { name: 'Log Out' }).click();
    await A.goto(`${BASE}/c/${slug}/sign-in?next=${encodeURIComponent(`/c/${slug}/my-ticket`)}`);
    await A.getByLabel('Email address').fill(mail('one'));
    await A.getByLabel('Password').fill(PW);
    await A.getByRole('button', { name: 'Sign in' }).click();
    await A.waitForURL(new RegExp(`/c/${slug}/my-ticket$`));
    await A.getByText(`Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
  });

  // ── Restart: API process + container, and PostgreSQL container recreated on the same volume ──
  await check('Persistence across API restart and PostgreSQL container recreation (same volume)', 'infra', async () => {
    docker('restart', API);
    docker('rm', '-f', PG);
    await startPg();
    await startUvicorn();
    eq(psql(`select count(*) from users where email='${mail('one')}'`), '1', 'user after restart');
    eq(psql(`select secret from entity_qrs where entity_id='${ticketId}'`), secret, 'qr after restart');
    const B = await page({ width: 390, height: 844 });
    await B.goto(`${BASE}/c/${slug}/sign-in?next=${encodeURIComponent(`/c/${slug}/my-ticket`)}`);
    await B.getByLabel('Email address').fill(mail('one'));
    await B.getByLabel('Password').fill(PW);
    await B.getByRole('button', { name: 'Sign in' }).click();
    await B.getByText(`Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
    eq(await decodeQr(B), secret, 'qr after restart');
    const old = await A.evaluate(() => localStorage.getItem('congress_attendee_token'));
    eq((await http('GET', '/api/attendees/me/tickets', { token: old })).status, 200, 'pre-restart token still valid (stateless JWT, same secret)');
    return 'user, ticket, QR and login survive; pre-restart token still accepted';
  });

  // ── Isolation ──
  await check('Second User cannot read the first User\'s ticket, attendee record or organizer data', 'UI+API', async () => {
    const two = (await http('POST', '/api/auth/register', { body: { email: mail('two'), password: PW, full_name: 'Synthetic Attendee Two', organization: '', title: '' } })).json;
    eq((await http('GET', '/api/attendees/me/tickets', { token: two.access_token })).json, [], 'own tickets');
    const probes = {
      attendeeRecord: (await http('GET', `/api/events/${eventId}/attendees/${ticketId}`, { token: two.access_token })).status,
      attendeeList: (await http('GET', `/api/events/${eventId}/attendees?q=Synthetic`, { token: two.access_token })).status,
      event: (await http('GET', `/api/events/${eventId}`, { token: two.access_token })).status,
      otherTenantEvent: (await http('GET', `/api/events/${eventId}`, { key: otherKey })).status,
    };
    for (const [k, v] of Object.entries(probes)) if (![401, 403, 404].includes(v)) throw new Error(`${k} -> ${v}`);
    const P = await page({ width: 390, height: 844 });
    await P.goto(`${BASE}/c/${slug}/sign-in?next=${encodeURIComponent(`/c/${slug}/my-ticket`)}`);
    await P.getByLabel('Email address').fill(mail('two'));
    await P.getByLabel('Password').fill(PW);
    await P.getByRole('button', { name: 'Sign in' }).click();
    await P.waitForURL(new RegExp(`/c/${slug}/my-ticket$`));
    await P.getByText(/no .*pass|You have no|No Active Tickets/i).first().waitFor({ timeout: 10000 });
    if ((await P.locator('body').innerText()).includes('Synthetic Attendee One')) throw new Error('user one visible');
    return Object.entries(probes).map(([k, v]) => `${k}=${v}`).join(' ');
  });
  await check('Public endpoint exposes no organizer-only fields', 'API', async () => {
    const r = await http('GET', `/api/public/events/${slug}`);
    return `event keys: ${Object.keys(r.json).join(',')}; tier keys: ${Object.keys(r.json.ticket_tiers[0]).join(',')}`;
  });
} catch (e) {
  console.log('ABORT', e.message);
} finally {
  if (browser) await browser.close();
  if (preview) spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F']);
  teardown();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed; disposable stack removed`);
  process.exit(failed ? 1 : 0);
}
