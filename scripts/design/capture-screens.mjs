#!/usr/bin/env node
/**
 * Captures the same set of real application screens from the running local demo
 * (scripts/demo/start.ps1) so visual changes can be compared before/after.
 *
 *   node scripts/design/capture-screens.mjs <out-dir> [--only=<substring>]
 *
 * Read-only against the demo: it signs in by SMS code (attendee / representative / reception operator; the
 * development API sends no SMS, so codes are read from its platform-admin outbox), reads `.demo/credentials.json`
 * for organizer keys and scanner credentials (never printed), and only navigates. It never reserves, scans,
 * captures leads or edits data.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'web/package.json'));
const { chromium } = require('playwright');

const outDir = resolve(process.argv[2] ?? 'screens');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
mkdirSync(outDir, { recursive: true });

const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8').replace(/^\uFEFF/, ''));
const creds = readJson('.demo/credentials.json');
const config = readJson('.demo/config.json');
const BASE = process.env.CAPTURE_BASE ?? `http://127.0.0.1:${config.web_port ?? 5190}`;
const ADMIN_TOKEN = config.admin_token;
const [EV1, EV2] = creds.ids.events;
const booth = creds.ids.booths;
const points = creds.ids.points;
const organizerKey = creds.organizers[0].api_key;
const scannerToken = (pointId) => creds.scanner_credentials.find((c) => c.point_id === pointId)?.token;

async function post(path, body) {
  for (;;) {
    const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // A code was requested for this number moments ago (a previous run): wait out the resend limit.
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1000 * Number(r.headers.get('retry-after') ?? 5))); continue; }
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return r.json();
  }
}
async function smsCode(mobile, purpose) {
  await post('/api/auth/otp/request', { mobile, purpose });
  const r = await fetch(`${BASE}/api/platform/sms-outbox?mobile=${mobile}`, { headers: { 'X-Admin-Token': ADMIN_TOKEN } });
  if (!r.ok) throw new Error(`sms outbox -> ${r.status} (is the demo API running with CONGRESS_SMS_PROVIDER=console?)`);
  const code = (await r.json()).map((m) => m.params.CODE).find(Boolean);
  if (!code) throw new Error(`no SMS code recorded for ${mobile}`);
  return code;
}
const userToken = async (mobile) => (await post('/api/auth/otp/verify', { mobile, code: await smsCode(mobile, 'signin') })).access_token;
const deskToken = async (eventId, mobile) => (await post(`/api/events/${eventId}/desk/login`, { mobile, code: await smsCode(mobile, 'desk') })).access_token;

const VIEW = {
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 720 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
};

const operatorOf = (slug) => creds.operators.find((o) => o.event_slug === slug).mobile;
const alice = await userToken(creds.people.alice.mobile);
const rep = await userToken(booth.neurolens.rep_mobile);
const rep2 = await userToken(booth.rhythm.rep_mobile);
const desk1 = await deskToken(EV1.id, operatorOf(EV1.slug));
const desk2 = await deskToken(EV2.id, operatorOf(EV2.slug));

/** name, path, viewport, storage = { local, session }, fullPage (true | 'tall' = grow the viewport to the document) */
const shots = [];
const add = (name, path, view, storage = {}, fullPage = false) => shots.push({ name, path, view, storage, fullPage });
const att = (locale) => ({ local: { congress_attendee_token: alice, congress_attendee_locale: locale } });
const org = (locale) => ({ local: { congress_attendee_locale: locale }, session: { congress_organizer_api_key: organizerKey } });

add('home-desktop', '/', 'desktop', {}, 'tall');
add('home-phone', '/', 'phone', {}, 'tall');
add('public-event-en-desktop', `/e/${EV1.slug}`, 'desktop');
add('public-event-en-desktop-full', `/e/${EV1.slug}`, 'desktop', {}, 'tall');
add('public-event-en-phone-full', `/e/${EV1.slug}`, 'phone', {}, 'tall');
add('public-event-en-wide', `/e/${EV1.slug}`, 'wide');
add('public-event-fa-desktop-full', `/e/${EV2.slug}`, 'desktop', {}, 'tall');
add('public-event-fa-phone-full', `/e/${EV2.slug}`, 'phone', {}, 'tall');
add('public-booth-en-desktop', `/e/${EV1.slug}/booths/${booth.neurolens.id}`, 'desktop', {}, 'tall');
add('public-booth-fa-phone', `/e/${EV2.slug}/booths/${booth.rhythm.id}`, 'phone', {}, 'tall');
add('signin-en-phone', `/c/${EV1.slug}/sign-in`, 'phone', { local: { congress_attendee_locale: 'en' } });
add('signin-fa-desktop', `/c/${EV2.slug}/sign-in`, 'desktop', { local: { congress_attendee_locale: 'fa' } });
add('attendee-congress-en-phone', `/c/${EV1.slug}/my-congress`, 'phone', att('en'), 'tall');
add('attendee-congress-fa-phone', `/c/${EV2.slug}/my-congress`, 'phone', att('fa'), 'tall');
add('attendee-congress-en-desktop', `/c/${EV1.slug}/my-congress`, 'desktop', att('en'), 'tall');
add('attendee-ticket-en-phone', `/c/${EV1.slug}/my-ticket`, 'phone', att('en'), 'tall');
add('attendee-ticket-fa-phone', `/c/${EV2.slug}/my-ticket`, 'phone', att('fa'), 'tall');
add('attendee-ticket-en-desktop', `/c/${EV1.slug}/my-ticket`, 'desktop', att('en'), 'tall');
add('attendee-network-en-phone', `/c/${EV1.slug}/my-network`, 'phone', att('en'), 'tall');
add('attendee-network-fa-phone', `/c/${EV1.slug}/my-network`, 'phone', att('fa'), 'tall');
add('attendee-profile-en-phone', `/c/${EV1.slug}/my-profile`, 'phone', att('en'), 'tall');
add('attendee-details-fa-phone', `/c/${EV2.slug}/details`, 'phone', att('fa'), 'tall');
add('organizer-gate-en-desktop', '/organizer', 'desktop', { local: { congress_attendee_locale: 'en' } });
add('organizer-events-en-desktop', '/organizer', 'desktop', org('en'), 'tall');
add('organizer-events-fa-phone', '/organizer', 'phone', org('fa'), 'tall');
add('organizer-event-en-desktop', `/organizer/events/${EV1.id}`, 'desktop', org('en'), 'tall');
add('organizer-tiers-en-desktop', `/organizer/events/${EV1.id}/tiers`, 'desktop', org('en'), 'tall');
add('organizer-booths-fa-desktop', `/organizer/events/${EV1.id}/booths`, 'desktop', org('fa'), 'tall');
add('organizer-checkin-en-laptop', `/organizer/events/${EV1.id}/check-in`, 'laptop', org('en'), 'tall');
add('organizer-operators-en-desktop', `/organizer/events/${EV1.id}/operators`, 'desktop', org('en'), 'tall');
add('organizer-analytics-en-desktop', `/organizer/events/${EV1.id}/analytics`, 'desktop', org('en'), 'tall');
add('organizer-analytics-fa-phone', `/organizer/events/${EV1.id}/analytics`, 'phone', org('fa'), 'tall');
add('organizer-desk-en-desktop', `/organizer/events/${EV1.id}/desk`, 'desktop', org('en'), 'tall');
add('reception-entry-en-tablet', '/reception', 'tablet', { local: { congress_attendee_locale: 'en' } });
add('reception-en-desktop', `/reception/${EV1.id}`, 'desktop', { local: { congress_attendee_locale: 'en' }, session: { [`congress_desk_token_${EV1.id}`]: desk1 } }, 'tall');
add('reception-fa-tablet', `/reception/${EV2.id}`, 'tablet', { local: { congress_attendee_locale: 'fa' }, session: { [`congress_desk_token_${EV2.id}`]: desk2 } }, 'tall');
add('reception-en-phone', `/reception/${EV1.id}`, 'phone', { local: { congress_attendee_locale: 'en' }, session: { [`congress_desk_token_${EV1.id}`]: desk1 } }, 'tall');
add('exhibitor-en-phone', `/booth/${booth.neurolens.id}`, 'phone', { local: { congress_attendee_token: rep, congress_attendee_locale: 'en' } }, 'tall');
add('exhibitor-fa-phone', `/booth/${booth.rhythm.id}`, 'phone', { local: { congress_attendee_token: rep2, congress_attendee_locale: 'fa' } }, 'tall');
add('exhibitor-en-desktop', `/booth/${booth.neurolens.id}`, 'desktop', { local: { congress_attendee_token: rep, congress_attendee_locale: 'en' } }, 'tall');
add('exhibitor-signin-en-phone', `/booth/${booth.neurolens.id}/sign-in`, 'phone', { local: { congress_attendee_locale: 'en' } });
add('scanner-unpaired-phone', `/scan/${points.lunch}`, 'phone');
add('scanner-ready-phone', `/scan/${points.main}`, 'phone', { session: { [`congress_scanner_token_${points.main}`]: scannerToken(points.main) } }, 'tall');
add('scanner-ready-tablet', `/scan/${points.main}`, 'tablet', { session: { [`congress_scanner_token_${points.main}`]: scannerToken(points.main) } });
add('scanner-ready-fa-phone', `/scan/${points.cardio_main}`, 'phone', { session: { [`congress_scanner_token_${points.cardio_main}`]: scannerToken(points.cardio_main) } });

const browser = await chromium.launch({ channel: 'msedge' });
let failures = 0;
for (const s of shots) {
  if (only && !s.name.includes(only)) continue;
  const context = await browser.newContext({ viewport: VIEW[s.view], deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ local = {}, session = {} }) => {
    if (sessionStorage.getItem('__capture_seeded')) return;
    sessionStorage.setItem('__capture_seeded', '1');
    for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
  }, s.storage);
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    if (s.fullPage === 'tall') {
      // Sticky sidebars and docks: grow the viewport to the document so they render in place.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width: VIEW[s.view].width, height: Math.min(height, 8000) });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: resolve(outDir, `${s.name}.png`), fullPage: s.fullPage === true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`ok   ${s.name}${overflow > 0 ? `  (horizontal overflow ${overflow}px)` : ''}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${s.name}: ${e.message.split('\n')[0]}`);
  }
  await context.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
