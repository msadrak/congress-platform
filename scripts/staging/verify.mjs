#!/usr/bin/env node
/**
 * End-to-end verification of a running local staging stack (deploy/staging):
 *
 *   node scripts/staging/verify.mjs [--fresh] [--rebuild] [--evidence-dir <dir>]
 *
 *   --fresh               also check that the database holds no accounts or demo data (a just-created stack)
 *   --rebuild             also run the disruptive steps: rebuild the API image and re-create its container, then
 *                         stop and start the whole stack. Off by default: verify never rebuilds or stops a stack
 *                         it did not start unless asked.
 *   --evidence-dir <dir>  where screenshots and JSON results go [.staging/evidence/<project>, ignored by git]
 *
 * The Compose project is CONGRESS_STACK_PROJECT (default congress-staging), the same variable stack.mjs reads.
 * Uses only synthetic records created here. Steps: empty-database check (--fresh), HTTPS with the local CA,
 * proxy/cache/security headers, every portal through Caddy (its page title from the UI's copy modules,
 * web/src/copy), the live-suite journeys (web/e2e-live: organizer + Page Studio publish, attendee registration and
 * pass, reception desk, exhibitor leads, member roles), the live scanner spec (pairing, hashed manifest, admission,
 * offline queue, unpairing), server-rendered metadata without JavaScript, media surviving an API image rebuild and
 * data surviving stop/start (--rebuild), and backup + restore into a separate disposable project.
 *
 * The browser is Edge unless CONGRESS_BROWSER_CHANNEL says otherwise (`chrome`, or `chromium` after
 * `npx playwright install chromium`), here and in the live specs. Needs `npm ci` in web/ and
 * CONGRESS_SMS_PROVIDER=console (sign-in codes are read back from the console outbox).
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { run } from '../lib/process.mjs';
import { backup, compose, persistentPaths, psql, readEnv, restoreVerify, smsCode } from './stack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = resolve(root, 'web');
const require = createRequire(resolve(WEB, 'package.json'));
const { chromium } = require('playwright');
const { values: args } = parseArgs({
  options: {
    fresh: { type: 'boolean', default: false },
    rebuild: { type: 'boolean', default: false },
    'evidence-dir': { type: 'string' },
  },
});
const PROJECT = process.env.CONGRESS_STACK_PROJECT?.trim() || 'congress-staging';
const env = readEnv();
const HTTPS_BASE = env.CONGRESS_PUBLIC_ORIGIN;
const HTTP_BASE = `http://localhost:${env.CONGRESS_HTTP_PORT || 18080}`;
// Evidence stays out of the repository by default (.staging/ is ignored); --evidence-dir puts it elsewhere.
const SHOTS = resolve(args['evidence-dir'] ?? join(root, '.staging/evidence', PROJECT));
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
  return { status: r.status, json, text, headers: r.headers };
};

// SMS sign-in on the staging stack: requires CONGRESS_SMS_PROVIDER=console (nothing is sent; the code is read
// inside the API container by `stack.mjs sms-code`).
const otpSignIn = async (number, full_name) => {
  const request = () => api('POST', '/api/auth/otp/request', { body: { mobile: number } });
  let sent = await request();
  // The same number again within the resend cooldown (60 s by default; step 12 signs in soon after step 08): wait
  // out its Retry-After (the limiter counts in buckets, so it may take one more round). A longer block, such as an
  // hourly budget, fails here.
  const retryAfter = () => Number(sent.headers.get('retry-after'));
  for (let round = 0; round < 4 && sent.status === 429 && retryAfter() > 0 && retryAfter() <= 120; round++) {
    await new Promise((ok) => setTimeout(ok, retryAfter() * 1000 + 1000));
    sent = await request();
  }
  eq(sent.status, 202, `otp request${sent.json?.code ? ` (${sent.json.code}, Retry-After ${retryAfter()} s)` : ''}`);
  const verified = (await api('POST', '/api/auth/otp/verify', { body: { mobile: number, code: smsCode(number) } })).json;
  if (verified.status === 'signed_in') return verified;
  return (await api('POST', '/api/auth/otp/complete', { body: { signup_token: verified.signup_token, full_name, organization: '', title: '' } })).json;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const fresh = args.fresh;
const skip = (name, reason) => {
  results.push({ ok: true, skipped: true, name, note: reason });
  console.log(`SKIP ${name} — ${reason}`);
};
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

/**
 * The UI's own words (web/src/copy/<name>.ts, loaded through Vite's module runner), so the portal checks follow a
 * change of wording instead of going stale. Returns { <name>: <module exports> }.
 */
async function loadCopy(names) {
  const { runnerImport } = await import(pathToFileURL(require.resolve('vite')).href);
  const load = async (name) => [name, (await runnerImport(join(WEB, `src/copy/${name}.ts`), { configFile: false, root: WEB, logLevel: 'silent' })).module];
  return Object.fromEntries(await Promise.all(names.map(load)));
}

const LIVE_SPECS = join(WEB, 'e2e-live');
const SCANNER_SPEC = 'scanner.spec.ts';
/**
 * Runs web/e2e-live specs (the per-persona journeys CI runs on a disposable stack, scripts/integration/live-e2e.mjs)
 * against this stack. The browser uses the localhost HTTP listener, a secure context for the service worker and
 * the offline steps (the test browser does not trust the local CA). Every spec provisions its own organizer with
 * the platform admin token and reads sign-in codes from the console SMS outbox. Playwright's JSON report goes to
 * <evidence>/<report>.json; returns "N passed".
 */
function liveSpecs(report, specs) {
  const file = join(SHOTS, `${report}.json`);
  const r = run('npx', ['playwright', 'test', '-c', 'playwright.live.config.ts', '--retries=0', '--reporter=list,json', ...specs.map((s) => `e2e-live/${s}`)], {
    cwd: WEB, allowFail: true,
    env: { LIVE_E2E_BASE_URL: HTTP_BASE, LIVE_E2E_API_URL: HTTP_BASE, LIVE_E2E_ADMIN_TOKEN: env.CONGRESS_PLATFORM_ADMIN_TOKEN, PLAYWRIGHT_JSON_OUTPUT_FILE: file, CONGRESS_BROWSER_CHANNEL: process.env.CONGRESS_BROWSER_CHANNEL ?? 'msedge', CI: '', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  writeFileSync(join(SHOTS, `${report}.log`), `${r.stdout ?? ''}${r.stderr ?? ''}`);
  let json = null;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no report: the run did not start */ }
  const failed = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) if (!spec.ok) failed.push(spec.title);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of json?.suites ?? []) walk(suite);
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = json?.stats ?? {};
  if (r.status !== 0 || !json || unexpected || flaky || failed.length || !expected) {
    const why = failed.length ? `failed: ${failed.join(' | ')}` : (r.stdout || r.stderr || '').trim().split('\n').slice(-6).join(' ');
    throw new Error(`${why.slice(0, 400)} (log: ${join(SHOTS, `${report}.log`)})`);
  }
  return `${expected} passed${skipped ? `, ${skipped} skipped` : ''} (${specs.join(', ')})`;
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
    const copy = await loadCopy(['public', 'organizer', 'platform', 'desk', 'signIn', 'attendee', 'booth', 'operator']);
    const fa = (module, name) => copy[module][name].fa;
    const zero = '00000000-0000-0000-0000-000000000000';
    const otpForm = (page) => page.getByTestId('otp-mobile-step');
    // [path, path after client redirects, page title (the one h1), a second landmark or null]. Signed out and unpaired.
    const routes = [
      ['/', '/', fa('public', 'homeCopy').title, (page) => page.getByTestId('public-event-list')],
      ['/organizer', '/organizer', fa('organizer', 'organizerCopy').signIn.title, otpForm],
      ['/platform', '/platform', fa('platform', 'platformCopy').portal, (page) => page.locator('main form')],
      ['/reception', '/reception', fa('desk', 'deskCopy').title, (page) => page.locator('main form')],
      ['/sign-in', '/sign-in', fa('signIn', 'signInCopy').title, otpForm],
      ['/my-tickets', '/me', fa('attendee', 'attendeeCopy').me.title, otpForm],
      [`/booth/${zero}`, `/booth/${zero}`, fa('booth', 'boothCopy').signInTitle, null],
      [`/scan/${zero}`, `/scan/${zero}`, fa('operator', 'operatorCopy').gate.unpaired.title, null],
    ];
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) errors.push(m.text()); });
    for (const [path, landed, title, landmark] of routes) {
      await page.goto(HTTPS_BASE + path);
      try {
        await page.getByRole('heading', { level: 1, name: title, exact: true }).waitFor({ timeout: 15000 });
        if (landmark) await landmark(page).first().waitFor({ timeout: 15000 });
      } catch {
        const h1 = await page.locator('h1').allInnerTexts().catch(() => []);
        throw new Error(`${path}: expected the page title «${title}»${landmark ? ' and its landmark' : ''}, found h1 ${JSON.stringify(h1)}`);
      }
      eq(new URL(page.url()).pathname, landed, `${path} lands on`);
    }
    const secure = await page.evaluate(() => ({ secure: window.isSecureContext, sw: 'serviceWorker' in navigator, media: Boolean(navigator.mediaDevices?.getUserMedia) }));
    eq(secure, { secure: true, sw: true, media: true }, 'scanner secure context');
    await page.screenshot({ path: join(SHOTS, 'scanner-https.png') });
    await ctx.close();
    assert(errors.length === 0, `page errors: ${errors.join(' | ').slice(0, 300)}`);
    return `${routes.length} routes; isSecureContext, serviceWorker and getUserMedia available on HTTPS`;
  });

  await check('06 live-suite journeys on staging (organizer + Page Studio publish, attendee registration and pass, reception desk, exhibitor leads, member roles)', async () => {
    const specs = readdirSync(LIVE_SPECS).filter((n) => n.endsWith('.spec.ts') && n !== SCANNER_SPEC).sort();
    return liveSpecs('live-journeys', specs);
  });

  await check('07 live scanner spec on staging (pairing link, hashed manifest, admission, single-use, offline queue, unpairing)', async () => {
    return liveSpecs('live-scanner', [SCANNER_SPEC]);
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

  const REBUILD_ONLY = 'needs --rebuild (rebuilds the API image and stops/starts the stack)';
  if (!args.rebuild) skip('11 media and data survive an API image rebuild and container re-creation', REBUILD_ONLY);
  else await check('11 media and data survive an API image rebuild and container re-creation', async () => {
    compose(PROJECT, ['build', 'api']);
    compose(PROJECT, ['up', '-d', '--no-deps', '--force-recreate', '--wait', 'api']);
    eq(sha((await httpsGet(`/api/public/media/${S.asset}`)).body), S.mediaSha, 'image bytes after rebuild');
    eq((await api('GET', `/api/public/events/${S.slug}`)).status, 200, 'page after rebuild');
  });

  if (!args.rebuild) skip('12 stop and start the whole stack: event, attendee, ticket, publication and media intact', REBUILD_ONLY);
  else await check('12 stop and start the whole stack: event, attendee, ticket, publication and media intact', async () => {
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
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${results.length - failed - skipped}/${results.length - skipped} staging checks passed${skipped ? ` (${skipped} skipped)` : ''}; evidence in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
