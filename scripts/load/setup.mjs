#!/usr/bin/env node
/**
 * Creates the synthetic data the k6 scenarios in scripts/load/ need, through the public API only:
 *
 *   node scripts/load/setup.mjs --base-url http://localhost:8000 --admin-token <token> [options]
 *   node scripts/load/setup.mjs --restore-otp-limits [--base-url … --admin-token …]
 *
 * Options (defaults in brackets):
 *   --gates <n>            check-in points with one scanner token each, plus one backlog point [10]
 *   --tickets <n>          gate tickets issued at the front desk (no SMS, no sign-in) [300]
 *   --attendees <n>        attendees signed in by SMS code, for reservation-burst.js [500]
 *   --relax-otp-limits     raise the per-IP sign-in code budget and lift the platform SMS caps (platform
 *                          console) so one load generator can sign hundreds of attendees in and the burst
 *                          scenarios stay under the caps; undo with --restore-otp-limits
 *   --concurrency <n>      parallel setup requests [8]
 *   --out <path>           fixture file [scripts/load/.fixture/fixture.json]
 *
 * The admin token defaults to $CONGRESS_PLATFORM_ADMIN_TOKEN. Signing attendees in needs their codes: in a
 * non-production environment with the `console` SMS provider, GET /api/platform/sms-outbox (admin token)
 * returns the code each number "received"; production never registers that route, so --attendees 0 there.
 * The event is made reservable the way an organizer does it: an open registration window and a published
 * Page Studio page (an unpublished event answers 404 EVENT_NOT_FOUND to attendees). Before signing anyone in,
 * the budgets are checked (per-IP code budget, platform SMS caps, test-mode SMS), so a run fails up front
 * with the option to use instead of half-way through with 429/503.
 * Writes organizer/scanner/attendee credentials into the fixture: keep it out of git (.fixture/ is ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    'base-url': { type: 'string', default: process.env.BASE_URL ?? 'http://localhost:8000' },
    'admin-token': { type: 'string', default: process.env.CONGRESS_PLATFORM_ADMIN_TOKEN ?? '' },
    gates: { type: 'string', default: '10' },
    tickets: { type: 'string', default: '300' },
    attendees: { type: 'string', default: '500' },
    concurrency: { type: 'string', default: '8' },
    out: { type: 'string', default: resolve(here, '.fixture/fixture.json') },
    'relax-otp-limits': { type: 'boolean', default: false },
    'restore-otp-limits': { type: 'boolean', default: false },
  },
});

const BASE = args['base-url'].replace(/\/+$/, '');
const ADMIN = args['admin-token'];
const count = (name) => {
  const n = Number.parseInt(args[name], 10);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
};
const GATES = count('gates'), TICKETS = count('tickets'), ATTENDEES = count('attendees');
const CONCURRENCY = Math.max(1, count('concurrency'));
if (ATTENDEES > 10_000) throw new Error('--attendees is limited to 10000 per run (4-digit index in the synthetic number)');
// Synthetic numbers in the unassigned 0900 range: 0900 + run block (500-998) + attendee index. otp-burst.js
// uses blocks 000-499 and scripts/staging/verify.mjs 999, so runs within the hour rarely share a number.
const RUN = String(500 + (Math.floor(Date.now() / 1000) % 499));
const SLUG = `load-${Date.now().toString(36)}`;
const RELAXED_IP_BUDGET = 100_000;

if (!ADMIN) throw new Error('Pass --admin-token or set CONGRESS_PLATFORM_ADMIN_TOKEN.');

async function api(method, path, { body, token, admin = false, expect = [200, 201, 202] } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers['X-Admin-Token'] = ADMIN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!expect.includes(response.status)) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

/** Runs `task(i)` for i in [0, n) with at most CONCURRENCY in flight; results keep their order. */
async function pool(n, task, label) {
  const results = new Array(n);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      results[i] = await task(i);
      if (++done % 100 === 0 || done === n) console.log(`  ${label}: ${done}/${n}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
  return results;
}

async function restoreOtpLimits() {
  const rules = await api('GET', '/api/platform/sign-in', { admin: true });
  console.log(`per-IP SMS budget now ${rules.otp_sends_per_ip_per_hour}/hour (${rules.sources?.otp_sends_per_ip_per_hour ?? 'environment'})`);
  const restored = await api('PUT', '/api/platform/sign-in', { admin: true, body: { reset: ['otp_sends_per_ip_per_hour'] } });
  console.log(`restored to the environment default: ${restored.otp_sends_per_ip_per_hour}/hour`);
  const sms = await api('PUT', '/api/platform/sms', { admin: true, body: { reset: ['hourly_cap', 'daily_cap'] } });
  console.log(`platform SMS caps restored to the environment defaults: ${sms.hourly_cap}/hour, ${sms.daily_cap}/day (0 = no cap)`);
}

async function relaxOtpLimits() {
  const before = await api('GET', '/api/platform/sign-in', { admin: true });
  if (before.sources?.otp_sends_per_ip_per_hour === 'console' && before.otp_sends_per_ip_per_hour !== RELAXED_IP_BUDGET) {
    console.warn(`note: the per-IP budget was set in the platform console (${before.otp_sends_per_ip_per_hour}/hour); --restore-otp-limits resets it to the environment default`);
  }
  await api('PUT', '/api/platform/sign-in', { admin: true, body: { otp_sends_per_ip_per_hour: RELAXED_IP_BUDGET } });
  console.log(`per-IP SMS budget raised to ${RELAXED_IP_BUDGET}/hour (was ${before.otp_sends_per_ip_per_hour}); undo with --restore-otp-limits`);
  const sms = await api('GET', '/api/platform/sms', { admin: true });
  if (Object.values(sms.caps_source ?? {}).includes('console')) {
    console.warn(`note: an SMS cap was set in the platform console (${sms.hourly_cap}/hour, ${sms.daily_cap}/day); --restore-otp-limits resets both to the environment defaults`);
  }
  await api('PUT', '/api/platform/sms', { admin: true, body: { hourly_cap: 0, daily_cap: 0 } });
  console.log(`platform SMS caps lifted for the run (were ${sms.hourly_cap}/hour, ${sms.daily_cap}/day)`);
  return before.otp_sends_per_ip_per_hour;
}

/**
 * Fails before any account is created when signing ATTENDEES in would run into a limit: the per-IP code budget
 * (one load generator is one address) or the platform SMS caps (sign-in codes now, plus one confirmation per
 * reservation during the burst). requireTestModeSms() runs first: only test mode exposes the codes, and
 * anything else would send real SMS.
 */
async function requireTestModeSms() {
  if (ATTENDEES === 0) return;
  const sms = await api('GET', '/api/platform/sms', { admin: true });
  if (sms.effective !== 'console') {
    throw new Error(`SMS is not in test mode here (effective: ${sms.effective}): signing ${ATTENDEES} attendees in would send real SMS. Use --attendees 0, or set CONGRESS_SMS_PROVIDER=console / test mode in the platform console.`);
  }
}

async function checkSmsHeadroom(relaxed) {
  if (ATTENDEES === 0 || relaxed) return;
  const rules = await api('GET', '/api/platform/sign-in', { admin: true });
  const problems = [];
  if (ATTENDEES > rules.otp_sends_per_ip_per_hour) {
    problems.push(`${ATTENDEES} sign-in codes from one address exceed the per-IP budget (${rules.otp_sends_per_ip_per_hour}/hour)`);
  }
  const health = await api('GET', '/api/platform/sms/outbox', { admin: true });
  // Codes now, then one ticket confirmation per reservation in reservation-burst.js.
  const needed = 2 * ATTENDEES;
  for (const [label, cap, used] of [['hourly', health.hourly_cap, health.sent_last_hour], ['daily', health.daily_cap, health.sent_last_day]]) {
    if (cap > 0 && used + needed > cap) problems.push(`${used} SMS in the last ${label === 'hourly' ? 'hour' : 'day'} + ~${needed} for this run exceed the ${label} platform cap (${cap})`);
  }
  if (problems.length) throw new Error(`${problems.join('; ')}. Re-run with --relax-otp-limits (undo afterwards with --restore-otp-limits) or fewer --attendees.`);
}

/** What an organizer does before attendees can reserve: an open registration window and a published page. */
async function makeReservable(key, event) {
  const opens = new Date(Date.now() - 3_600_000).toISOString();
  await api('PATCH', `/api/events/${event.id}`, {
    token: key,
    body: { registration_enabled: true, registration_opens_at: opens, registration_closes_at: event.starts_at },
  });
  const page = await api('GET', `/api/events/${event.id}/page`, { token: key });
  await api('POST', `/api/events/${event.id}/page/publish`, { token: key, body: { revision: page.draft_revision } });
  const visible = await api('GET', `/api/public/events/${event.slug}`);
  if (!visible.registration_open) throw new Error(`The event is published but registration is not open: ${JSON.stringify(visible).slice(0, 300)}`);
}

/** Sign in by SMS code, reading the code from the dev-only outbox; completes the profile of a new number. */
async function signIn(mobile, i) {
  await api('POST', '/api/auth/otp/request', { body: { mobile, purpose: 'signin' } });
  let messages;
  try {
    messages = await api('GET', `/api/platform/sms-outbox?mobile=${mobile}`, { admin: true });
  } catch (error) {
    throw new Error(`Cannot read sign-in codes (${error.message}). The outbox exists only outside production and while SMS is in test mode (console provider); use --attendees 0 otherwise.`);
  }
  const code = messages.find((m) => m.code)?.code;
  if (!code) throw new Error(`No sign-in code recorded for ${mobile}`);
  const verified = await api('POST', '/api/auth/otp/verify', { body: { mobile, code } });
  if (verified.status === 'signed_in') return verified.access_token;
  const completed = await api('POST', '/api/auth/otp/complete', {
    body: { signup_token: verified.signup_token, full_name: `Load Attendee ${i + 1}`, organization: 'Load Test', title: 'Attendee' },
  });
  return completed.access_token;
}

async function main() {
  if (args['restore-otp-limits']) return restoreOtpLimits();
  const started = Date.now();
  await api('GET', '/api/health');
  await requireTestModeSms();
  const previousIpBudget = args['relax-otp-limits'] ? await relaxOtpLimits() : undefined;
  await checkSmsHeadroom(previousIpBudget !== undefined);

  const organizer = await api('POST', '/api/organizers', { admin: true, body: { name: `Load Test ${SLUG}` } });
  const key = organizer.api_key;
  const starts = new Date(Date.now() + 30 * 86_400_000);
  const event = await api('POST', '/api/events', {
    token: key,
    body: {
      name: `Load Test Congress ${SLUG}`,
      slug: SLUG,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 2 * 86_400_000).toISOString(),
      location: 'Load test hall',
    },
  });
  const tier = (name, quota) => api('POST', `/api/events/${event.id}/ticket-tiers`, { token: key, body: { name, quota } });
  const reservationTier = await tier('Load Reservation Pass', Math.max(ATTENDEES * 2, 1000));
  const gateTier = await tier('Load Gate Pass', Math.max(TICKETS * 2, 100));
  await makeReservable(key, event);
  console.log(`event ${event.id} (${SLUG}) published, registration open; tiers ${reservationTier.id} (reservations) and ${gateTier.id} (gate tickets)`);

  const point = async (name) => {
    const created = await api('POST', `/api/events/${event.id}/checkin-points`, { token: key, body: { name } });
    const issued = await api('POST', `/api/checkin-points/${created.id}/token`, { token: key, body: { device_name: `${name} scanner` } });
    return { point_id: created.id, device_id: issued.device_id, scanner_token: issued.scanner_token };
  };
  const gates = await pool(GATES, (i) => point(`Load Gate ${i + 1}`), 'gates');
  const backlogGate = await point('Load Backlog Gate');

  const qrSecrets = await pool(TICKETS, async (i) => {
    const registered = await api('POST', `/api/events/${event.id}/desk-registrations`, {
      token: key,
      body: { full_name: `Load Gate Attendee ${i + 1}`, ticket_tier_id: gateTier.id },
    });
    return registered.qr_secret;
  }, 'gate tickets');

  const attendeeTokens = await pool(ATTENDEES, (i) => signIn(`0900${RUN}${String(i).padStart(4, '0')}`, i), 'attendees signed in');

  const fixture = {
    created_at: new Date().toISOString(),
    base_url: BASE,
    organizer_id: organizer.id,
    organizer_api_key: key,
    event_id: event.id,
    event_slug: SLUG,
    reservation_tier_id: reservationTier.id,
    gate_tier_id: gateTier.id,
    gates,
    backlog_gate: backlogGate,
    qr_secrets: qrSecrets,
    attendee_tokens: attendeeTokens,
    otp_limits_relaxed: previousIpBudget !== undefined,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(`fixture written to ${args.out} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
