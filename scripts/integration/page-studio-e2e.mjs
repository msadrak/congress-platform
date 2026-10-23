#!/usr/bin/env node
/**
 * Page Studio lifecycle on real FastAPI + PostgreSQL (no intercepted responses):
 *
 *   node scripts/integration/page-studio-e2e.mjs [--keep] [--skip-build]
 *
 * A new organizer signs in, creates a congress, designs its public page in Page Studio (logo, cover, hero
 * text in Persian and English, a custom block, reordering, hiding), saves a draft that stays private,
 * previews it, publishes, edits again without publishing, publishes the update, survives a restart of
 * PostgreSQL and the API, and a second organizer is refused everywhere. Screenshots go to
 * docs/product/page-studio-evidence/.
 *
 * Safety: disposable Docker stack with fixed `congress-studio-*` names — PostgreSQL on a private
 * --internal network without a published port, named volumes for its data and for the media root,
 * generated secrets, API in CONGRESS_ENVIRONMENT=staging published on 127.0.0.1 and the web preview on
 * 127.0.0.1, both on free ports picked per run. Everything is removed at the
 * end unless --keep. Requires Docker, the backend image used by congress-e2e.mjs, postgres:16, Edge (or the
 * browser named by CONGRESS_BROWSER_CHANNEL, e.g. chromium or chrome) and
 * the backend virtualenv (to draw the synthetic artwork).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendImage, syncBackendDependencies } from '../lib/backend-image.mjs';
import { freePorts, run, startPreview, stopProcess } from '../lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'web/package.json'));
const { chromium } = require('playwright');
const args = new Set(process.argv.slice(2));
// The hashed test-runner image (built on first use) or CONGRESS_E2E_BACKEND_IMAGE: scripts/lib/backend-image.mjs.
const IMAGE = backendImage();
const NET = 'congress-studio-net', PG = 'congress-studio-pg', API = 'congress-studio-api';
const VOL_PG = 'congress-studio-pgdata', VOL_MEDIA = 'congress-studio-media';
const DB = 'congress_studio', PGU = 'congress_studio', PGPW = randomBytes(18).toString('hex');
const ADMIN = randomBytes(24).toString('hex'), JWTS = randomBytes(32).toString('hex');
const [WEB_PORT, API_PORT] = await freePorts(2);
const BASE = `http://127.0.0.1:${WEB_PORT}`, API_URL = `http://127.0.0.1:${API_PORT}`;
const SHOTS = resolve(root, 'docs/product/page-studio-evidence');
const RUN = Date.now().toString(36).slice(-5);

const sh = (cmd, argv, allowFail = false, opts = {}) => run(cmd, argv, { ...opts, allowFail });
const docker = (...a) => sh('docker', a);
const psql = (sql) => docker('exec', PG, 'psql', '-U', PGU, '-d', DB, '-At', '-c', sql).stdout.trim();
const wait = async (label, probe, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await probe()) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`timeout: ${label}`);
};
const env = () => [
  // Staging (strict) with the console SMS provider: production requires real sms.ir delivery.
  '-e', 'CONGRESS_ENVIRONMENT=staging',
  '-e', 'CONGRESS_SMS_PROVIDER=console',
  '-e', `CONGRESS_DATABASE_URL=postgresql+asyncpg://${PGU}:${PGPW}@${PG}:5432/${DB}`,
  '-e', 'CONGRESS_MEDIA_ROOT=/data/media',
  '-e', `CONGRESS_PLATFORM_ADMIN_TOKEN=${ADMIN}`,
  '-e', `CONGRESS_JWT_SECRET=${JWTS}`,
  '-e', `CONGRESS_CORS_ORIGINS=${JSON.stringify([BASE])}`,
];
const http = async (method, path, { key, admin, body, raw } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = `Bearer ${key}`;
  if (admin) headers['X-Admin-Token'] = ADMIN;
  const r = await fetch(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: r.status, headers: r.headers, bytes: (await r.arrayBuffer()).byteLength };
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push({ ok: true, name, note });
    console.log(`PASS ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name, error: String(e.message).split('\n')[0] });
    console.log(`FAIL ${name} — ${String(e.message).split('\n')[0]}`);
  }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };

function teardown() {
  for (const c of [API, PG]) sh('docker', ['rm', '-f', c], true);
  sh('docker', ['network', 'rm', NET], true);
  for (const v of [VOL_PG, VOL_MEDIA]) sh('docker', ['volume', 'rm', v], true);
}
async function startPg() {
  docker('run', '-d', '--name', PG, '--network', NET, '-v', `${VOL_PG}:/var/lib/postgresql/data`, '-e', `POSTGRES_USER=${PGU}`, '-e', `POSTGRES_PASSWORD=${PGPW}`, '-e', `POSTGRES_DB=${DB}`, 'postgres:16');
  await wait('postgres', () => sh('docker', ['exec', PG, 'pg_isready', '-U', PGU, '-d', DB], true).status === 0);
  await new Promise((r) => setTimeout(r, 1500));
}
async function startApi() {
  docker('exec', '-d', ...env(), API, 'sh', '-c', 'cd /app && .venv/bin/uvicorn app.main:create_app_from_env --factory --host 0.0.0.0 --port 8000 > /tmp/api.log 2>&1');
  await wait('api ready', async () => (await fetch(`${API_URL}/api/ready`)).status === 200);
}

let preview, browser;
try {
  teardown();
  mkdirSync(SHOTS, { recursive: true });
  const art = join(tmpdir(), `congress-studio-art-${RUN}`);
  sh('uv', ['run', 'python', resolve(root, 'scripts/integration/studio-images.py'), art], false, { cwd: resolve(root, 'backend') });

  // ── Disposable stack ──
  docker('network', 'create', '--internal', NET);
  await startPg();
  docker('run', '-d', '--name', API, '-p', `127.0.0.1:${API_PORT}:8000`, '-v', `${VOL_MEDIA}:/data/media`, '--entrypoint', 'sleep', IMAGE, 'infinity');
  for (const d of ['app', 'migrations']) { docker('exec', API, 'rm', '-rf', `/app/${d}`); docker('cp', resolve(root, 'backend', d), `${API}:/app/${d}`); }
  for (const f of ['alembic.ini', 'pyproject.toml', 'uv.lock']) docker('cp', resolve(root, 'backend', f), `${API}:/app/${f}`);
  syncBackendDependencies(API, ['--no-dev']);
  docker('network', 'connect', NET, API);
  docker('exec', ...env(), API, 'sh', '-c', 'cd /app && .venv/bin/alembic upgrade head');
  await startApi();
  if (docker('port', PG).stdout.trim()) throw new Error('PostgreSQL publishes a port');
  console.log(`stack: db=${psql('select current_database()')} alembic=${psql('select version_num from alembic_version')} env=production media=volume:${VOL_MEDIA} api=${API_URL} web=${BASE}`);

  if (!args.has('--skip-build') || !existsSync(resolve(root, 'web/dist'))) sh('npm', ['run', 'build'], false, { cwd: resolve(root, 'web') });
  preview = startPreview({ port: WEB_PORT, apiOrigin: API_URL });
  await wait('web preview', async () => (await fetch(BASE)).ok);
  browser = await chromium.launch({ channel: process.env.CONGRESS_BROWSER_CHANNEL ?? 'msedge' });
  const contextFor = async (viewport, locale = 'en') => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
    await ctx.addInitScript((l) => localStorage.setItem('congress_attendee_locale', l), locale);
    return ctx;
  };
  const shot = (page, name, opts = {}) => page.screenshot({ path: resolve(SHOTS, `${name}.png`), ...opts });

  // 1. Provision two organizers through the supported admin contract.
  const orgA = (await http('POST', '/api/organizers', { admin: true, body: { name: `Studio Organizer ${RUN}` } })).json;
  const orgB = (await http('POST', '/api/organizers', { admin: true, body: { name: `Other Organizer ${RUN}` } })).json;
  const slug = `medsummit-${RUN}`;
  let eventId = '';
  const ids = {};

  // 2–3. Sign in and create the congress in the Organizer UI.
  const O = await (await contextFor({ width: 1600, height: 1000 })).newPage();
  await check('01 organizer signs in and creates a congress in the UI', async () => {
    await O.goto(`${BASE}/organizer`);
    await O.locator('#apiKeyInput').fill(orgA.api_key);
    await O.getByRole('button', { name: /Access Organizer Dashboard/ }).click();
    await O.getByRole('button', { name: /Create New Event/ }).first().click();
    const d = O.getByRole('dialog');
    await d.getByPlaceholder('e.g. 18th Annual Congress of Biotechnology').fill('همایش بین‌المللی پزشکی نوین ۱۴۰۶');
    await d.getByPlaceholder('biotech-congress-2027').fill(slug);
    const dates = d.locator('input[type=datetime-local]');
    await dates.nth(0).fill('2027-11-16T08:30');
    await dates.nth(1).fill('2027-11-18T18:00');
    await d.getByPlaceholder('e.g. International Convention Center, Hall A').fill('مرکز همایش‌های بین‌المللی، تهران');
    await d.getByRole('button', { name: 'Create Event' }).click();
    await O.getByRole('status').filter({ hasText: slug }).or(O.getByRole('status').filter({ hasText: 'پزشکی' })).first().waitFor({ timeout: 15000 });
    eventId = psql(`select id from events where slug='${slug}'`);
    eq(psql(`select published is null from event_pages where event_id='${eventId}'`), 't', 'page starts unpublished');
    // Operational data the page presents (tiers + booths) through the supported organizer API.
    for (const [name, quota] of [['Delegate · نماینده', 400], ['Workshop pass', 60]]) {
      eq((await http('POST', `/api/events/${eventId}/ticket-tiers`, { key: orgA.api_key, body: { name, description: '', quota } })).status, 201, 'tier');
    }
    for (const [name, s] of [['Pars Medical Devices', 'pars-medical'], ['NovaGen Biotech', 'novagen']]) {
      eq((await http('POST', `/api/events/${eventId}/booths`, { key: orgA.api_key, body: { name, slug: s, location: 'Hall A', description: 'Exhibitor', website_url: '', brochure_url: '' } })).status, 201, 'booth');
    }
    return `event ${eventId.slice(0, 8)}…, page draft only`;
  });

  await check('02 the unpublished congress is invisible to anonymous visitors (API 404)', async () => {
    eq((await http('GET', `/api/public/events/${slug}`)).status, 404, 'public event');
    eq((await http('GET', `/api/public/events/${slug}/booths`)).status, 404, 'public booths');
  });

  // 4. Open Page Studio from the workspace navigation.
  await check('03 Page Studio opens from the workspace navigation', async () => {
    await O.goto(`${BASE}/organizer/events/${eventId}`);
    await O.getByRole('link', { name: /Public page/ }).first().click();
    await O.getByTestId('page-studio').waitFor({ timeout: 15000 });
    await O.getByTestId('page-status').filter({ hasText: 'Not published' }).waitFor();
    await O.frameLocator('[data-testid=page-preview-frame]').locator('#congress-title').waitFor({ timeout: 15000 });
    await O.waitForTimeout(800);
    await shot(O, '01-studio-initial-default-page');
  });

  const frame = () => O.frameLocator('[data-testid=page-preview-frame]');
  const contentLanguage = (label) => O.getByRole('group', { name: 'Content language' }).first().getByRole('button', { name: label }).click();
  const uploadVia = async (button, file) => {
    await button.click();
    const library = O.getByRole('dialog', { name: 'Image library' });
    await library.locator('[data-testid=page-image-input]').setInputFiles(file);
    await library.waitFor({ state: 'hidden', timeout: 20000 });
  };

  // 5. Branding: logo, cover, hero text in both languages.
  await check('04 logo and cover uploaded; hero layout, accent and bilingual hero text configured', async () => {
    await O.getByRole('tab', { name: 'Brand & hero' }).click();
    await O.getByRole('radio', { name: 'magenta' }).check({ force: true });
    const logoField = O.locator('div.space-y-1\\.5', { has: O.getByText('Event logo', { exact: true }) });
    await uploadVia(logoField.getByRole('button', { name: /Choose image/ }), join(art, 'logo.png'));
    await O.locator('label', { hasText: 'Cover photo' }).first().click();
    const coverField = O.locator('div.space-y-1\\.5', { has: O.getByText('Hero image', { exact: true }) });
    await uploadVia(coverField.getByRole('button', { name: /Choose image/ }), join(art, 'cover.jpg'));
    await contentLanguage('English');
    await O.getByLabel('Title', { exact: true }).fill('International Congress of Modern Medicine 2027');
    await O.getByLabel('Subtitle').fill('Three days of clinical science, devices and digital health — in Tehran and online.');
    await O.getByLabel('Registration button label').fill('Reserve your free pass');
    await contentLanguage('فارسی');
    await O.getByLabel('Subtitle').fill('سه روز علم بالینی، تجهیزات پزشکی و سلامت دیجیتال — در تهران و به‌صورت برخط.');
    await O.getByLabel('Registration button label').fill('رزرو رایگان کارت ورود');
    const assets = psql(`select count(*) from media_assets where event_id='${eventId}'`);
    eq(assets, '2', 'media rows');
    ids.media = psql(`select string_agg(id::text, ',' order by created_at) from media_assets where event_id='${eventId}'`).split(',');
    eq(psql(`select count(*) from media_assets where event_id='${eventId}' and content_type in ('image/png','image/jpeg') and width <= 2400`), '2', 'normalised images');
    await frame().locator('#congress-title').waitFor();
    await O.waitForTimeout(1500);
    await shot(O, '02-studio-brand-and-hero-fa');
    return `assets ${ids.media.map((i) => i.slice(0, 8)).join(', ')}`;
  });

  // 6–8. Custom block, reorder, hide.
  await check('05 custom text block added (fa + en), FAQ added, blocks reordered and a section hidden', async () => {
    await O.getByRole('tab', { name: 'Sections' }).click();
    await O.getByRole('button', { name: 'Add section' }).click();
    await O.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^Text/ }).click();
    await contentLanguage('فارسی');
    await O.getByLabel('Title', { exact: true }).fill('دسترسی به محل همایش');
    await O.getByLabel('Text', { exact: true }).fill('مرکز همایش‌ها در **ضلع شمالی** پارک قرار دارد.\n\n- مترو: ایستگاه همایش‌ها (خط ۳)\n- پارکینگ رایگان برای شرکت‌کنندگان');
    await contentLanguage('English');
    await O.getByLabel('Title', { exact: true }).fill('Getting to the venue');
    await O.getByLabel('Text', { exact: true }).fill('The convention centre is on the **north side** of the park.\n\n- Metro: Convention Centre station (line 3)\n- Free parking for delegates');
    await O.getByRole('button', { name: 'All sections' }).click();
    await O.getByRole('button', { name: 'Add section' }).click();
    await O.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^FAQ/ }).click();
    await O.getByLabel('Question').fill('Is registration free?');
    await O.getByLabel('Answer').fill('Yes. Every pass is free; seats are limited by each tier’s capacity.');
    await contentLanguage('فارسی');
    await O.getByLabel('Question').fill('آیا ثبت‌نام رایگان است؟');
    await O.getByLabel('Answer').fill('بله. همهٔ کارت‌ها رایگان‌اند و ظرفیت هر رده محدود است.');
    await O.getByRole('button', { name: 'All sections' }).click();
    const row = (id) => O.locator(`li[data-section="${id}"]`);
    for (let i = 0; i < 3; i++) await row('rich-text-1').getByRole('button', { name: 'Move up' }).click();
    await row('passes').getByRole('button', { name: 'Move up' }).click();
    await row('highlights').getByRole('button', { name: 'Hide from visitors' }).click();
    const order = await O.locator('[data-testid=section-list] > li').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    eq(order, ['about', 'rich-text-1', 'passes', 'highlights', 'exhibitors', 'faq-1'], 'editor order');
    await O.getByTestId('save-state').filter({ hasText: 'Unsaved changes' }).waitFor();
    await O.waitForTimeout(1200);
    await shot(O, '03-studio-sections-reordered-hidden');
  });

  // 9. Save the draft.
  await check('06 draft saved: new revision in PostgreSQL, still unpublished', async () => {
    await O.getByRole('button', { name: 'Save draft' }).click();
    await O.getByRole('status').filter({ hasText: 'Draft saved' }).first().waitFor({ timeout: 10000 });
    eq(psql(`select published is null from event_pages where event_id='${eventId}'`), 't', 'still unpublished');
    const order = psql(`select string_agg(s->>'id', ',' order by ord) from event_pages, jsonb_array_elements(draft->'sections') with ordinality as t(s, ord) where event_id='${eventId}'`);
    eq(order, 'about,rich-text-1,passes,highlights,exhibitors,faq-1', 'stored order');
    return `draft_revision=${psql(`select draft_revision from event_pages where event_id='${eventId}'`)}`;
  });

  // 10. The draft does not leak.
  const V = await (await contextFor({ width: 1440, height: 900 }, 'en')).newPage();
  await check('07 draft does not leak: public API, page, booth directory and images all answer 404', async () => {
    eq((await http('GET', `/api/public/events/${slug}`)).status, 404, 'event');
    for (const id of ids.media) eq((await http('GET', `/api/public/media/${id}`, { raw: true })).status, 404, `media ${id}`);
    await V.goto(`${BASE}/e/${slug}`);
    await V.getByRole('heading', { name: 'Event Not Found' }).waitFor({ timeout: 15000 });
    await shot(V, '04-anonymous-draft-not-public');
  });

  // 11. Preview in Persian and English, desktop and mobile.
  await check('08 authenticated preview renders the draft in Persian and English, desktop and mobile', async () => {
    eq((await http('GET', `/api/events/${eventId}/page/preview`)).status, 401, 'anonymous preview');
    for (const [label, lang, text] of [['فارسی', 'fa', 'سه روز علم بالینی'], ['English', 'en', 'Three days of clinical science']]) {
      await contentLanguage(label);
      await frame().getByText(text).first().waitFor({ timeout: 10000 });
      for (const device of ['Desktop', 'Mobile']) {
        await O.getByRole('button', { name: device, exact: true }).click();
        await O.waitForTimeout(1500);
        await shot(O, `05-studio-preview-${lang}-${device.toLowerCase()}`);
      }
    }
    await O.getByRole('button', { name: 'Desktop', exact: true }).click();
  });

  // 12. Publish.
  await check('09 publish through the UI: snapshot stored atomically with its image list', async () => {
    await O.getByRole('button', { name: 'Publish', exact: true }).first().click();
    await O.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    await O.getByRole('status').filter({ hasText: 'Published.' }).waitFor({ timeout: 10000 });
    await O.getByTestId('page-status').filter({ hasText: 'Live' }).waitFor();
    eq(psql(`select published = draft and published_revision = draft_revision from event_pages where event_id='${eventId}'`), 't', 'snapshot = draft');
    eq(psql(`select jsonb_array_length(published_asset_ids) from event_pages where event_id='${eventId}'`), '2', 'published images');
  });

  // 13–14. Anonymous visitor in a separate browser.
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const visit = async (locale, viewport, name) => {
    const ctx = await contextFor(viewport, locale);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/e/${slug}`);
    await p.locator('#congress-title').waitFor({ timeout: 15000 });
    await p.waitForFunction(() => [...document.images].filter((i) => i.src.includes('/api/public/media/')).every((i) => i.complete && i.naturalWidth > 0));
    await p.waitForTimeout(900);
    await shot(p, name, { fullPage: true });
    return p;
  };
  await check('10 anonymous visitor sees the published content, order, branding and images', async () => {
    const p = await anon.newPage();
    await p.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
    await p.goto(`${BASE}/e/${slug}`);
    await p.getByText('Three days of clinical science').waitFor({ timeout: 15000 });
    await p.getByRole('heading', { name: 'International Congress of Modern Medicine 2027' }).waitFor();
    const order = await p.locator('.pub-sheet section[id]').evaluateAll((els) => els.map((e) => e.id));
    eq(order, ['about', 'section-rich-text-1', 'passes', 'exhibition', 'section-faq-1'], 'public order (highlights hidden)');
    const images = await p.evaluate(() => [...document.images].filter((i) => i.src.includes('/api/public/media/')).map((i) => ({ ok: i.complete && i.naturalWidth > 0, w: i.getAttribute('width') })));
    assert(images.length >= 2 && images.every((i) => i.ok && i.w), `images ${JSON.stringify(images)}`);
    const accent = await p.evaluate(() => getComputedStyle(document.querySelector('[style*="--event-accent"]')).getPropertyValue('--event-accent').trim());
    eq(accent.toUpperCase(), '#B8017A', 'magenta accent');
    await p.getByText('Pars Medical Devices').first().waitFor();
    await p.getByRole('button', { name: /Is registration free/ }).or(p.getByText('Is registration free?')).first().waitFor();
    assert((await p.title()).includes('International Congress of Modern Medicine'), `title ${await p.title()}`);
    const media = await http('GET', `/api/public/media/${ids.media[0]}`, { raw: true });
    eq([media.status, media.headers.get('x-content-type-options')], [200, 'nosniff'], 'public image headers');
    await p.close();
    await visit('en', { width: 1440, height: 900 }, '06-public-en-desktop');
    await visit('fa', { width: 1440, height: 900 }, '07-public-fa-desktop');
    await visit('fa', { width: 390, height: 844 }, '08-public-fa-mobile');
    await visit('en', { width: 390, height: 844 }, '09-public-en-mobile');
    return `${images.length} images loaded from /api/public/media`;
  });

  // 15. Edit again without publishing.
  await check('11 later edits stay in the draft until published again', async () => {
    await O.getByRole('tab', { name: 'Brand & hero' }).click();
    await contentLanguage('English');
    await O.getByLabel('Subtitle').fill('Now with a dedicated digital-health track and 40 exhibitors.');
    await O.getByRole('button', { name: 'Save draft' }).click();
    await O.getByRole('status').filter({ hasText: 'Draft saved' }).first().waitFor({ timeout: 10000 });
    await O.getByTestId('page-status').filter({ hasText: 'Draft ahead of live' }).waitFor();
    const live = (await http('GET', `/api/public/events/${slug}`)).json;
    eq(live.page.document.hero.subtitle.en, 'Three days of clinical science, devices and digital health — in Tehran and online.', 'live subtitle unchanged');
    await shot(O, '10-studio-draft-ahead-of-live');
  });

  // 16. Publish the update.
  await check('12 publishing the update replaces the live page', async () => {
    await O.getByRole('button', { name: 'Publish', exact: true }).first().click();
    await O.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
    await O.getByRole('status').filter({ hasText: 'Published.' }).waitFor({ timeout: 10000 });
    const live = (await http('GET', `/api/public/events/${slug}`)).json;
    eq(live.page.document.hero.subtitle.en, 'Now with a dedicated digital-health track and 40 exhibitors.', 'live subtitle');
    eq(live.page.document.hero.subtitle.fa, 'سه روز علم بالینی، تجهیزات پزشکی و سلامت دیجیتال — در تهران و به‌صورت برخط.', 'persian kept');
  });

  // 17. Restart PostgreSQL (container deleted and recreated on its volume) and the API.
  await check('13 page, media and publication survive a PostgreSQL re-creation and an API restart', async () => {
    sh('docker', ['rm', '-f', PG]);
    await startPg();
    docker('restart', API);
    await startApi();
    const live = await http('GET', `/api/public/events/${slug}`);
    eq(live.status, 200, 'public after restart');
    eq(live.json.page.document.sections.map((s) => s.id), ['about', 'rich-text-1', 'passes', 'highlights', 'exhibitors', 'faq-1'], 'order after restart');
    for (const id of ids.media) eq((await http('GET', `/api/public/media/${id}`, { raw: true })).status, 200, `media ${id} after restart`);
    const p = await visit('en', { width: 1440, height: 900 }, '11-public-en-after-restart');
    await p.getByText('Now with a dedicated digital-health track').waitFor();
    return 'pg volume + media volume reused';
  });
  const O2 = O; // the organizer session survives the restart (stateless API key)

  // 18. Organizer B is refused everywhere.
  await check('14 another organizer can neither read, preview, edit, publish nor touch the images', async () => {
    const k = orgB.api_key;
    const state = (await http('GET', `/api/events/${eventId}/page`, { key: orgA.api_key })).json;
    const statuses = [
      (await http('GET', `/api/events/${eventId}/page`, { key: k })).status,
      (await http('GET', `/api/events/${eventId}/page/preview`, { key: k })).status,
      (await http('PUT', `/api/events/${eventId}/page`, { key: k, body: { revision: state.draft_revision, document: state.draft } })).status,
      (await http('POST', `/api/events/${eventId}/page/publish`, { key: k, body: { revision: state.draft_revision } })).status,
      (await http('POST', `/api/events/${eventId}/page/unpublish`, { key: k })).status,
      (await http('GET', `/api/events/${eventId}/media`, { key: k })).status,
      (await http('DELETE', `/api/events/${eventId}/media/${ids.media[0]}`, { key: k })).status,
      (await http('GET', `/api/events/${eventId}/media/${ids.media[0]}/content`, { key: k })).status,
    ];
    eq(statuses, [404, 404, 404, 404, 404, 404, 404, 404], 'organizer B statuses');
    const B = await (await contextFor({ width: 1280, height: 900 })).newPage();
    await B.goto(`${BASE}/organizer`);
    await B.locator('#apiKeyInput').fill(k);
    await B.getByRole('button', { name: /Access Organizer Dashboard/ }).click();
    await B.goto(`${BASE}/organizer/events/${eventId}/page`);
    await B.getByText('The page studio could not be loaded.').waitFor({ timeout: 15000 });
    await B.goto(`${BASE}/organizer/events/${eventId}/page/preview?lang=en`);
    await B.getByText(/Sign in with this congress's organizer key/).waitFor({ timeout: 15000 });
    await shot(B, '12-organizer-b-preview-refused');
    eq(psql(`select published_revision = draft_revision from event_pages where event_id='${eventId}'`), 't', 'A untouched');
  });

  await check('15 the studio shows the live state after reload (persistence through the UI)', async () => {
    await O2.goto(`${BASE}/organizer/events/${eventId}/page`);
    await O2.getByTestId('page-status').filter({ hasText: 'Live' }).waitFor({ timeout: 15000 });
    await O2.waitForTimeout(1500);
    await shot(O2, '13-studio-live-after-restart');
  });
} catch (e) {
  console.log('ABORT', e.message);
  results.push({ ok: false, name: 'run', error: e.message });
} finally {
  writeFileSync(resolve(SHOTS, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  if (browser) await browser.close().catch(() => undefined);
  stopProcess(preview);
  if (!args.has('--keep')) teardown();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
