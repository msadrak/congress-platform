#!/usr/bin/env node
/**
 * End-to-end verification of the running local staging stack (deploy/staging, project congress-staging):
 *
 *   node scripts/staging/verify.mjs [--fresh]
 *
 * Uses only synthetic records created here. Steps: empty-database check (--fresh), HTTPS with the local CA,
 * proxy/cache/security headers, every portal through Caddy, the full congress journey (organizer, Page
 * Studio publish, registration, reception, scanner incl. offline, exhibitor leads, analytics/CSV,
 * cross-tenant), the real-API scanner spec, server-rendered metadata without JavaScript, media surviving an
 * API image rebuild, data surviving stop/start, and backup + restore into a separate disposable project.
 * Evidence: docs/deployment/staging-evidence/.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJourney } from '../integration/journey.mjs';
import { run } from '../lib/process.mjs';
import { backup, compose, persistentPaths, psql, readEnv, restoreVerify, smsCode } from './stack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'web/package.json'));
const { chromium } = require('playwright');
const PROJECT = 'congress-staging';
const env = readEnv();
const HTTPS_BASE = env.CONGRESS_PUBLIC_ORIGIN;
const HTTP_BASE = `http://localhost:${env.CONGRESS_HTTP_PORT || 18080}`;
const SHOTS = resolve(root, 'docs/deployment/staging-evidence');
const RUN = Date.now().toString(36).slice(-5);
// Synthetic attendee number in the unassigned 0900 range, unique per run.
const ATTENDEE_MOBILE = `0900999${String(parseInt(RUN, 36) % 10000).padStart(4, '0')}`;
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push({ ok: true, name, note: note ?? null });
    console.log(`PASS ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    results.push({ ok: false, name, error: String(e.message).split('\n')[0] });
    console.log(`FAIL ${name} — ${String(e.message).split('\n')[0]}`);
  }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };
const q = (sql) => psql(PROJECT, sql);

// HTTPS client that trusts exactly Caddy's local root CA (no verification is switched off).
let CA = null;
const httpsGet = (path, headers = {}) =>
  new Promise((ok, fail) => {
    const req = https.get(new URL(path, HTTPS_BASE), { ca: CA, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
  });
const api = async (method, path, { key, admin, body, raw, type } = {}) => {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (admin) headers['X-Admin-Token'] = env.CONGRESS_PLATFORM_ADMIN_TOKEN;
  if (body !== undefined) headers['Content-Type'] = type ?? 'application/json';
  const r = await fetch(HTTP_BASE + path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};

// SMS sign-in on the staging stack: requires CONGRESS_SMS_PROVIDER=console (nothing is sent; the code is read
// inside the API container by `stack.mjs sms-code`).
const otpSignIn = async (number, full_name) => {
  eq((await api('POST', '/api/auth/otp/request', { body: { mobile: number } })).status, 202, 'otp request');
  const verified = (await api('POST', '/api/auth/otp/verify', { body: { mobile: number, code: smsCode(number) } })).json;
  if (verified.status === 'signed_in') return verified;
  return (await api('POST', '/api/auth/otp/complete', { body: { signup_token: verified.signup_token, full_name, organization: '', title: '' } })).json;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const fresh = process.argv.includes('--fresh');
/** The single Alembic head of this checkout, from backend/migrations/versions (the revision nothing builds on). */
function alembicHead(dir = join(root, 'backend/migrations/versions')) {
  const chain = Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.py')).map((n) => {
    const text = readFileSync(join(dir, n), 'utf8');
    const value = (name) => text.match(new RegExp(`^${name}(?::[^=]*)? = (?:['"]([^'"]+)['"]|None)`, 'm'));
    const revision = value('revision')?.[1];
    if (!revision) throw new Error(`${n}: no revision`);
    return [revision, value('down_revision')?.[1] ?? null];
  }));
  const parents = new Set(Object.values(chain));
  const heads = Object.keys(chain).filter((r) => !parents.has(r));
  if (heads.length !== 1) throw new Error(`expected one Alembic head in ${dir}, found ${heads.join(', ') || 'none'}`);
  return heads[0];
}

const S = {};
let browser;
try {
  await check('00 stack healthy: db, migrate (exit 0), api, web', async () => {
    const rows = JSON.parse(`[${compose(PROJECT, ['ps', '-a', '--format', 'json']).stdout.trim().split(/\r?\n/).join(',')}]`);
    const by = Object.fromEntries(rows.map((r) => [r.Service, r]));
    for (const s of ['db', 'api', 'web']) eq(by[s]?.Health, 'healthy', `${s} health`);
    eq([by.migrate?.State, by.migrate?.ExitCode], ['exited', 0], 'migrate');
    const head = alembicHead();
    eq(q('select version_num from alembic_version'), head, 'schema');
    const ports = rows.flatMap((r) => (r.Publishers ?? []).filter((p) => p.PublishedPort).map((p) => `${r.Service}:${p.URL}:${p.PublishedPort}`));
    assert(ports.every((p) => p.startsWith('web:127.0.0.1:')), `published ports ${ports}`);
    return `alembic ${head}; published only ${ports.join(', ')}`;
  });

  if (fresh) {
    await check('01 fresh deployment holds no accounts or demo data', async () => {
      const counts = ['organizers', 'users', 'events', 'tickets', 'media_assets'].map((t) => `${t}=${q(`select count(*) from ${t}`)}`).join(' ');
      assert(/^(\w+=0 ?)+$/.test(counts), counts);
      return counts;
    });
  }

  await check('02 HTTPS through Caddy with a certificate chained to the local CA', async () => {
    CA = readFileSync(join(root, '.staging/caddy-root.crt'));
    const home = await httpsGet('/');
    eq(home.status, 200, 'home');
    assert(String(home.headers['content-type']).startsWith('text/html'), 'html');
    const ready = await httpsGet('/api/ready');
    eq([ready.status, JSON.parse(ready.body).status], [200, 'ready'], 'ready');
    return `TLS verified against .staging/caddy-root.crt`;
  });

  await check('03 SPA deep links, cache rules and security headers', async () => {
    const deep = await httpsGet('/organizer/events/00000000-0000-0000-0000-000000000000/page');
    eq(deep.status, 200, 'deep link');
    assert(deep.body.toString().includes('<div id="root">'), 'spa shell');
    const sw = await httpsGet('/sw.js');
    eq([sw.status, sw.headers['cache-control']], [200, 'no-cache'], 'sw.js');
    eq((await httpsGet('/index.html')).headers['cache-control'], 'no-cache', 'index.html');
    const asset = /\/assets\/[^"]+\.js/.exec((await httpsGet('/')).body.toString())[0];
    const a = await httpsGet(asset);
    eq([a.status, a.headers['cache-control']], [200, 'public, max-age=31536000, immutable'], 'hashed asset');
    assert(String(a.headers['content-type']).includes('javascript'), 'js mime');
    for (const h of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options']) assert(deep.headers[h], `missing ${h}`);
    assert(!deep.headers.server, 'Server header exposed');
    return `CSP + nosniff + referrer + permissions(camera=self) + frame; ${asset} immutable`;
  });

  await check('04 bundle and responses carry no privileged credentials', async () => {
    const home = (await httpsGet('/')).body.toString();
    const scripts = [...home.matchAll(/\/assets\/[^"]+\.js/g)].map((m) => m[0]);
    for (const s of scripts) {
      const body = (await httpsGet(s)).body.toString();
      for (const secret of [env.CONGRESS_PLATFORM_ADMIN_TOKEN, env.CONGRESS_JWT_SECRET, env.POSTGRES_PASSWORD]) assert(!body.includes(secret), `secret in ${s}`);
    }
    const logs = compose(PROJECT, ['logs', '--no-color']).stdout;
    for (const secret of [env.CONGRESS_PLATFORM_ADMIN_TOKEN, env.CONGRESS_JWT_SECRET, env.POSTGRES_PASSWORD]) assert(!logs.includes(secret), 'secret in logs');
    return `${scripts.length} entry scripts and all container logs checked`;
  });

  browser = await chromium.launch({ channel: process.env.CONGRESS_BROWSER_CHANNEL ?? 'msedge' });
  await check('05 every portal renders through the proxy (HTTPS), scanner runs in a secure context', async () => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errors.push(m.text()); });
    const routes = [['/', /Congress Platform/], ['/organizer', /Organizer Authentication/], ['/reception', /reception|Reception/], ['/sign-in', /Sign in/i], ['/my-tickets', /pass|Sign in/i], ['/booth/00000000-0000-0000-0000-000000000000', /booth|Sign in/i], ['/scan/00000000-0000-0000-0000-000000000000', /scanner|Scanner|pair/i]];
    for (const [path, text] of routes) {
      await page.goto(HTTPS_BASE + path);
      await page.getByText(text).first().waitFor({ timeout: 15000 });
    }
    const secure = await page.evaluate(() => ({ secure: window.isSecureContext, sw: 'serviceWorker' in navigator, media: Boolean(navigator.mediaDevices?.getUserMedia) }));
    eq(secure, { secure: true, sw: true, media: true }, 'scanner secure context');
    await page.screenshot({ path: join(SHOTS, 'scanner-https.png') });
    await ctx.close();
    assert(errors.length === 0, `page errors: ${errors.join(' | ').slice(0, 300)}`);
    return `${routes.length} routes; isSecureContext, serviceWorker and getUserMedia available on HTTPS`;
  });

  // The full congress journey (UI in a real browser) against the staging stack. Browsers use the
  // localhost HTTP listener (a secure context) because the test browser does not trust the local CA;
  // service-worker/offline steps need a trusted origin.
  let journey = { failed: 1 };
  await check('06 full congress journey on staging (organizer, Page Studio, registration, reception, scanner + offline, leads, analytics, isolation)', async () => {
    journey = await runJourney({ root, BASE: HTTP_BASE, API_URL: HTTP_BASE, ADMIN_TOKEN: env.CONGRESS_PLATFORM_ADMIN_TOKEN, JWT_SECRET: env.CONGRESS_JWT_SECRET, SHOT_DIR: SHOTS, psql: (sql) => q(sql) });
    writeFileSync(join(SHOTS, 'journey-last-run.json'), JSON.stringify(journey, null, 2));
    assert(journey.failed === 0, `${journey.failed} journey checks failed`);
    return `${journey.total - journey.failed}/${journey.total}`;
  });

  await check('07 real-API scanner spec (pairing, manifest, self-revocation) on staging', async () => {
    const r = run('npx', ['playwright', 'test', 'e2e/scanner-real-api.spec.ts', '--retries=0'], {
      cwd: resolve(root, 'web'), allowFail: true,
      env: { PLAYWRIGHT_BASE_URL: HTTP_BASE, CONGRESS_API_BASE_URL: HTTP_BASE, CONGRESS_PLATFORM_ADMIN_TOKEN: env.CONGRESS_PLATFORM_ADMIN_TOKEN, CI: '', FORCE_COLOR: '0' },
    });
    assert(r.status === 0, (r.stdout || r.stderr).split('\n').slice(-8).join(' '));
    return (r.stdout.match(/\d+ passed/) ?? ['?'])[0];
  });

  await check('08 Page Studio on staging: new organizer publishes a branded page; attendee gets a ticket', async () => {
    const org = (await api('POST', '/api/organizers', { admin: true, body: { name: `Staging Organizer ${RUN}` } })).json;
    S.key = org.api_key;
    S.slug = `staging-${RUN}`;
    const ev = await api('POST', '/api/events', { key: S.key, body: { name: `Staging Congress ${RUN}`, slug: S.slug, starts_at: '2027-10-01T08:00:00Z', ends_at: '2027-10-02T17:00:00Z', location: 'Staging Hall', description: 'Synthetic staging congress' } });
    eq(ev.status, 201, 'event');
    S.eventId = ev.json.id;
    const tier = await api('POST', `/api/events/${S.eventId}/ticket-tiers`, { key: S.key, body: { name: 'Delegate', description: '', quota: 50 } });
    S.booth = (await api('POST', `/api/events/${S.eventId}/booths`, { key: S.key, body: { name: 'Staging Booth', slug: 'staging-booth', location: 'Hall B', description: 'A booth on staging', website_url: '', brochure_url: '' } })).json;
    const png = readFileSync(join(root, 'web/public/pwa-512x512.png'));
    const media = await api('POST', `/api/events/${S.eventId}/media`, { key: S.key, raw: png, type: 'image/png', body: '' });
    eq(media.status, 201, 'upload');
    S.asset = media.json.id;
    const state = (await api('GET', `/api/events/${S.eventId}/page`, { key: S.key })).json;
    const doc = { ...state.draft, primary_locale: 'en', hero: { ...state.draft.hero, layout: 'cover', cover_asset_id: S.asset, subtitle: { en: 'Staging subtitle', fa: '' } }, seo: { title: { en: `Staging SEO <${RUN}>`, fa: '' }, description: { en: 'Published staging description & more', fa: '' }, share_image_asset_id: S.asset } };
    eq((await api('PUT', `/api/events/${S.eventId}/page`, { key: S.key, body: { revision: state.draft_revision, document: doc } })).status, 200, 'save');
    eq((await api('POST', `/api/events/${S.eventId}/page/publish`, { key: S.key, body: { revision: state.draft_revision + 1 } })).status, 200, 'publish');
    const user = await otpSignIn(ATTENDEE_MOBILE, 'Staging Attendee');
    eq((await api('POST', `/api/events/${S.eventId}/tickets/reserve`, { key: user.access_token, body: { ticket_tier_id: tier.json.id } })).status, 201, 'reserve');
    // A second, never-published congress whose draft must not leak.
    const secret = await api('POST', '/api/events', { key: S.key, body: { name: `Secret Draft Congress ${RUN}`, slug: `secret-${RUN}`, starts_at: '2027-11-01T08:00:00Z', ends_at: '2027-11-02T17:00:00Z', location: 'Hidden', description: 'Unannounced' } });
    S.secretSlug = `secret-${RUN}`;
    eq(secret.status, 201, 'secret event');
    S.mediaSha = sha((await httpsGet(`/api/public/media/${S.asset}`)).body);
    S.ticketCount = q(`select count(*) from tickets where event_id='${S.eventId}'`);
    eq(S.ticketCount, '1', 'ticket row');
    return `event ${S.eventId.slice(0, 8)}…, image ${S.asset.slice(0, 8)}…, 1 ticket`;
  });

  await check('09 crawler view (no JavaScript): published metadata in the HTML of /e/<slug>; drafts never leak', async () => {
    const html = (await httpsGet(`/e/${S.slug}`, { 'User-Agent': 'facebookexternalhit/1.1' })).body.toString();
    assert(html.includes(`<title>Staging SEO &lt;${RUN}&gt;</title>`), 'title');
    assert(html.includes('<meta property="og:description" content="Published staging description &amp; more" />'), 'description');
    const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    eq(image, `${HTTPS_BASE}/api/public/media/${S.asset}`, 'og:image');
    const img = await httpsGet(new URL(image).pathname);
    eq([img.status, img.headers['content-type']], [200, 'image/png'], 'og:image fetch');
    assert(html.includes(`<link rel="canonical" href="${HTTPS_BASE}/e/${S.slug}" />`), 'canonical');
    assert(html.includes('<div id="root">') && /\/assets\/index-[^"]+\.js/.test(html), 'SPA still boots');
    const hidden = (await httpsGet(`/e/${S.secretSlug}`)).body.toString();
    assert(!hidden.includes('Secret Draft') && !hidden.includes('Unannounced') && hidden.includes('noindex'), 'unpublished leaked');
    const unknown = (await httpsGet('/e/no-such-congress')).body.toString();
    eq(/<head>[\s\S]*<\/head>/.exec(hidden)[0], /<head>[\s\S]*<\/head>/.exec(unknown)[0], 'unpublished == unknown');
    const boothHtml = (await httpsGet(`/e/${S.slug}/booths/${S.booth.id}`)).body.toString();
    assert(boothHtml.includes(`<title>Staging Booth · Staging Congress ${RUN}</title>`), 'booth title');
    writeFileSync(join(SHOTS, 'crawler-head.html'), /<head>[\s\S]*<\/head>/.exec(html)[0]);
    return 'title, description, og:image (absolute HTTPS, 200), canonical; unpublished == unknown (noindex)';
  });

  await check('10 browser renders the published page through HTTPS (SPA intact after head injection)', async () => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
    const page = await ctx.newPage();
    await page.goto(`${HTTPS_BASE}/e/${S.slug}`);
    await page.getByText('Staging subtitle').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => [...document.images].some((i) => i.src.includes('/api/public/media/') && i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: join(SHOTS, 'public-page-https.png'), fullPage: true });
    await ctx.close();
  });

  await check('11 media and data survive an API image rebuild and container re-creation', async () => {
    compose(PROJECT, ['build', 'api']);
    compose(PROJECT, ['up', '-d', '--no-deps', '--force-recreate', '--wait', 'api']);
    eq(sha((await httpsGet(`/api/public/media/${S.asset}`)).body), S.mediaSha, 'image bytes after rebuild');
    eq((await api('GET', `/api/public/events/${S.slug}`)).status, 200, 'page after rebuild');
  });

  await check('12 stop and start the whole stack: event, attendee, ticket, publication and media intact', async () => {
    const before = q("select count(*)||'/'||(select count(*) from users)||'/'||(select count(*) from tickets)||'/'||(select count(*) from event_pages where published is not null)||'/'||(select count(*) from media_assets) from events");
    compose(PROJECT, ['stop']);
    compose(PROJECT, ['up', '-d', '--wait', '--wait-timeout', '300']);
    const after = q("select count(*)||'/'||(select count(*) from users)||'/'||(select count(*) from tickets)||'/'||(select count(*) from event_pages where published is not null)||'/'||(select count(*) from media_assets) from events");
    eq(after, before, 'events/users/tickets/published/media');
    eq(sha((await httpsGet(`/api/public/media/${S.asset}`)).body), S.mediaSha, 'image bytes after restart');
    const login = await otpSignIn(ATTENDEE_MOBILE, 'Staging Attendee');
    eq(login.user.full_name, 'Staging Attendee', 'attendee SMS sign-in after restart');
    const tickets = await api('GET', '/api/attendees/me/tickets', { key: login.access_token });
    eq(tickets.json.length, 1, 'attendee ticket after restart');
    return `events/users/tickets/published/media = ${after}`;
  });

  await check('13 backup (database + media) and restore into a separate disposable stack', async () => {
    const b = backup(PROJECT);
    S.backup = b.name;
    const checks = await restoreVerify(b.name);
    writeFileSync(join(SHOTS, 'backup-manifest.json'), JSON.stringify({ ...b.manifest, media_sha256: `${b.manifest.media_sha256.length} files` }, null, 2));
    return `${b.name}: ${checks.length}/${checks.length} restore checks`;
  });

  await check('14 staging persistent data untouched by the restore test', async () => {
    const { postgres, media, caddyData } = persistentPaths();
    for (const [label, p] of [['postgres', postgres], ['media', media], ['caddy data', caddyData]]) {
      assert(existsSync(p), `${label} dir missing: ${p}`);
    }
    const restores = join(root, '.staging/restores');
    if (existsSync(restores)) {
      const left = readdirSync(restores).filter((n) => n.startsWith('congress-restore-'));
      assert(left.length === 0, `restore data left behind: ${left.join(', ')}`);
    }
    eq((await api('GET', `/api/public/events/${S.slug}`)).status, 200, 'staging still serves');
  });

  await check('15 access logs keep pass-link codes and pairing tokens out (URL and Referer); request ids at the edge', async () => {
    const code = `leakprobe${RUN}`;
    const token = `leaktoken${RUN}`;
    const pass = await fetch(`${HTTP_BASE}/t/${code}`, { headers: { Referer: `${HTTP_BASE}/t/${code}` } });
    eq(pass.headers.get('referrer-policy'), 'no-referrer', '/t/<code> Referrer-Policy');
    const scan = await fetch(`${HTTP_BASE}/scan/p1?token=${token}`, { headers: { Referer: `${HTTP_BASE}/scan/p1?token=${token}` } });
    eq(scan.headers.get('referrer-policy'), 'no-referrer', '/scan/<point> Referrer-Policy');
    const ready = await fetch(`${HTTP_BASE}/api/ready`, { headers: { Referer: `${HTTP_BASE}/t/${code}` } });
    assert(/^[A-Za-z0-9._:-]{8,128}$/.test(ready.headers.get('x-request-id') ?? ''), 'no request id on an API answer');
    const logs = compose(PROJECT, ['logs', '--since', '5m', '--no-color', 'web', 'api']).stdout;
    assert(!logs.includes(code) && !logs.includes(token), 'a code or token reached a log');
    assert(logs.includes(ready.headers.get('x-request-id')), 'the edge request id is not in the logs');
    return 'Referer dropped, no-referrer on secret URLs, request id shared by edge and API';
  });
} catch (e) {
  results.push({ ok: false, name: 'run', error: e.message });
  console.log('ABORT', e.message);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  writeFileSync(join(SHOTS, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} staging checks passed`);
  process.exit(failed ? 1 : 0);
}
