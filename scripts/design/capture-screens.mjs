#!/usr/bin/env node
/**
 * Captures the same set of real application screens from the running local demo
 * (scripts/demo/start.ps1) so visual changes can be compared before/after.
 *
 *   node scripts/design/capture-screens.mjs <out-dir> [--only=<substring>]
 *
 * Read-only against the demo: it signs in (attendee / representative / reception operator),
 * reads `.demo/credentials.json` for organizer keys and scanner credentials (never printed),
 * and only navigates. It never reserves, scans, captures leads or edits data.
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
const PASSWORD = creds.password;
const [EV1, EV2] = creds.ids.events;
const booth = creds.ids.booths;
const points = creds.ids.points;
const organizerKey = creds.organizers[0].api_key;
const scannerToken = (pointId) => creds.scanner_credentials.find((c) => c.point_id === pointId)?.token;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}
const userToken = async (email) => (await post('/api/auth/login', { email, password: PASSWORD })).access_token;
const deskToken = async (eventId, email) => (await post(`/api/events/${eventId}/desk/login`, { email, password: PASSWORD })).access_token;

const VIEW = {
  phone: { width: 390, height: 844 },
  small: { width: 320, height: 720 },
  tablet: { width: 768, height: 1024 },
  laptop: { width: 1024, height: 768 },
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 1080 },
};

const alice = await userToken('alice.rahimi@example.com');
const rep = await userToken(booth.neurolens.rep_email);
const rep2 = await userToken(booth.rhythm.rep_email);
const desk1 = await deskToken(EV1.id, 'reception.ai@example.com');
const desk2 = await deskToken(EV2.id, 'reception.cardio@example.com');

/** name, path, viewport, storage = { local, session }, fullPage */
const shots = [];
const add = (name, path, view, storage = {}, fullPage = false) => shots.push({ name, path, view, storage, fullPage });
const att = (locale) => ({ local: { congress_attendee_token: alice, congress_attendee_locale: locale } });
const org = (locale) => ({ local: { congress_attendee_locale: locale }, session: { congress_organizer_api_key: organizerKey } });

add('home-desktop', '/', 'desktop', {}, true);
add('home-phone', '/', 'phone', {}, true);
add('public-event-en-desktop', `/e/${EV1.slug}`, 'desktop');
add('public-event-en-desktop-full', `/e/${EV1.slug}`, 'desktop', {}, true);
add('public-event-en-phone-full', `/e/${EV1.slug}`, 'phone', {}, true);
add('public-event-en-wide', `/e/${EV1.slug}`, 'wide');
add('public-event-fa-desktop-full', `/e/${EV2.slug}`, 'desktop', {}, true);
add('public-event-fa-phone-full', `/e/${EV2.slug}`, 'phone', {}, true);
add('public-booth-en-desktop', `/e/${EV1.slug}/booths/${booth.neurolens.id}`, 'desktop', {}, true);
add('public-booth-fa-phone', `/e/${EV2.slug}/booths/${booth.rhythm.id}`, 'phone', {}, true);
add('signin-en-phone', `/c/${EV1.slug}/sign-in`, 'phone', { local: { congress_attendee_locale: 'en' } });
add('signin-fa-desktop', `/c/${EV2.slug}/sign-in`, 'desktop', { local: { congress_attendee_locale: 'fa' } });
add('attendee-congress-en-phone', `/c/${EV1.slug}/my-congress`, 'phone', att('en'), true);
add('attendee-congress-fa-phone', `/c/${EV2.slug}/my-congress`, 'phone', att('fa'), true);
add('attendee-congress-en-desktop', `/c/${EV1.slug}/my-congress`, 'desktop', att('en'), true);
add('attendee-ticket-en-phone', `/c/${EV1.slug}/my-ticket`, 'phone', att('en'), true);
add('attendee-ticket-fa-phone', `/c/${EV2.slug}/my-ticket`, 'phone', att('fa'), true);
add('attendee-ticket-en-desktop', `/c/${EV1.slug}/my-ticket`, 'desktop', att('en'), true);
add('attendee-network-en-phone', `/c/${EV1.slug}/my-network`, 'phone', att('en'), true);
add('attendee-network-fa-phone', `/c/${EV1.slug}/my-network`, 'phone', att('fa'), true);
add('attendee-profile-en-phone', `/c/${EV1.slug}/my-profile`, 'phone', att('en'), true);
add('attendee-details-fa-phone', `/c/${EV2.slug}/details`, 'phone', att('fa'), true);
add('organizer-gate-en-desktop', '/organizer', 'desktop', { local: { congress_attendee_locale: 'en' } });
add('organizer-events-en-desktop', '/organizer', 'desktop', org('en'), true);
add('organizer-events-fa-phone', '/organizer', 'phone', org('fa'), true);
add('organizer-event-en-desktop', `/organizer/events/${EV1.id}`, 'desktop', org('en'), true);
add('organizer-tiers-en-desktop', `/organizer/events/${EV1.id}/tiers`, 'desktop', org('en'), true);
add('organizer-booths-fa-desktop', `/organizer/events/${EV1.id}/booths`, 'desktop', org('fa'), true);
add('organizer-checkin-en-laptop', `/organizer/events/${EV1.id}/check-in`, 'laptop', org('en'), true);
add('organizer-operators-en-desktop', `/organizer/events/${EV1.id}/operators`, 'desktop', org('en'), true);
add('organizer-analytics-en-desktop', `/organizer/events/${EV1.id}/analytics`, 'desktop', org('en'), true);
add('organizer-analytics-fa-phone', `/organizer/events/${EV1.id}/analytics`, 'phone', org('fa'), true);
add('organizer-desk-en-desktop', `/organizer/events/${EV1.id}/desk`, 'desktop', org('en'), true);
add('reception-entry-en-tablet', '/reception', 'tablet', { local: { congress_attendee_locale: 'en' } });
add('reception-en-desktop', `/reception/${EV1.id}`, 'desktop', { local: { congress_attendee_locale: 'en' }, session: { [`congress_desk_token_${EV1.id}`]: desk1 } }, true);
add('reception-fa-tablet', `/reception/${EV2.id}`, 'tablet', { local: { congress_attendee_locale: 'fa' }, session: { [`congress_desk_token_${EV2.id}`]: desk2 } }, true);
add('reception-en-phone', `/reception/${EV1.id}`, 'phone', { local: { congress_attendee_locale: 'en' }, session: { [`congress_desk_token_${EV1.id}`]: desk1 } }, true);
add('exhibitor-en-phone', `/booth/${booth.neurolens.id}`, 'phone', { local: { congress_attendee_token: rep, congress_attendee_locale: 'en' } }, true);
add('exhibitor-fa-phone', `/booth/${booth.rhythm.id}`, 'phone', { local: { congress_attendee_token: rep2, congress_attendee_locale: 'fa' } }, true);
add('exhibitor-en-desktop', `/booth/${booth.neurolens.id}`, 'desktop', { local: { congress_attendee_token: rep, congress_attendee_locale: 'en' } }, true);
add('exhibitor-signin-en-phone', `/booth/${booth.neurolens.id}/sign-in`, 'phone', { local: { congress_attendee_locale: 'en' } });
add('scanner-unpaired-phone', `/scan/${points.lunch}`, 'phone');
add('scanner-ready-phone', `/scan/${points.main}`, 'phone', { session: { [`congress_scanner_token_${points.main}`]: scannerToken(points.main) } }, true);
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
    await page.screenshot({ path: resolve(outDir, `${s.name}.png`), fullPage: s.fullPage });
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
