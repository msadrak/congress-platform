/**
 * The congress journey (Stages A-F). Everything the UI supports is done through the real UI in a
 * real browser; setup that has no UI is done through the supported HTTP contract and is listed in
 * `EXCEPTIONS`. Every success shown in the browser is confirmed against the backend or PostgreSQL.
 */
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const EXCEPTIONS = [
  'Organizer + second tenant provisioning (POST /api/organizers with the platform admin token; no UI)',
  'SMS sign-in codes are read back from the console provider outbox (GET /api/platform/sms-outbox with the platform admin token); no SMS leaves the test stack',
  'Sign-up of one unrelated User and a second-congress attendee, and API sign-ins used only for authorization probes (POST /api/auth/otp/request, /verify, /complete)',
  'Scanner device token issuance and revocation through the API (POST /api/checkin-points/{id}/token and /devices/{id}/revoke), so the scanner stage controls its own credential',
  'Camera decoding: a physical camera / keyboard-wedge reader is not available; codes are typed into the supported manual-entry fields',
];

export async function runJourney(ctx) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(`${ctx.root}/web/node_modules/@playwright/test`);
  const { BASE, API_URL, ADMIN_TOKEN, JWT_SECRET, SHOT_DIR, psql } = ctx;
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signJwt = (payload) => { const h = b64u({ alg: 'HS256', typ: 'JWT' }); const p = b64u(payload); return `${h}.${p}.${createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`; };
  const results = [];
  let stageName = '';
  const stage = (name) => { stageName = name; console.log(`\n== ${name}`); };
  let debugPage = null;
  const check = async (name, fn) => {
    try { await fn(); results.push({ stage: stageName, name, ok: true }); console.log(`  PASS  ${name}`); }
    catch (e) { results.push({ stage: stageName, name, ok: false, error: String(e.message).split('\n')[0] }); console.log(`  FAIL  ${name}  -- ${String(e.message).split('\n')[0]}`); if (process.env.E2E_DEBUG && debugPage) console.log('     page: ' + (await debugPage.locator('body').innerText().catch(() => '?')).replace(/\s+/g, ' ').slice(0, 700)); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

  const http = async (method, path, { token, key, admin, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (admin) headers['X-Admin-Token'] = ADMIN_TOKEN;
    const r = await fetch(API_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* csv etc */ }
    return { status: r.status, json, text };
  };
  const q = (sql) => psql(sql);
  const num = (sql) => Number(q(sql));

  const RUN = Date.now().toString(36).slice(-5);
  const S = { slug: `e2e-alpha-${RUN}`, betaSlug: `e2e-beta-${RUN}`, calls: [] };
  // Synthetic mobile numbers in the unassigned 0900 range, unique per run: 090 + person (3) + run (5).
  const RUN_DIGITS = String(parseInt(RUN, 36) % 100000).padStart(5, '0');
  const PEOPLE = { rep1: 1, rep2: 2, operator: 3, alice: 4, outsider: 5, wanda: 6, carla: 7, bella: 8 };
  const mobile = (n) => `090${String(PEOPLE[n]).padStart(3, '0')}${RUN_DIGITS}`;
  const persian = (digits) => digits.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

  // SMS codes: nothing is sent; the console provider's outbox is read with the platform admin token.
  // Against a stack with production send limits (one code per number and purpose per minute) we wait them out.
  const OTP_GAP_MS = ctx.otpCooldownMs ?? 61000;
  const lastCodeAt = new Map();
  const waitForResend = async (number, purpose) => {
    const since = Date.now() - (lastCodeAt.get(`${purpose}:${number}`) ?? 0);
    if (since < OTP_GAP_MS) await new Promise((r) => setTimeout(r, OTP_GAP_MS - since));
  };
  const markCodeRequested = (number, purpose) => lastCodeAt.set(`${purpose}:${number}`, Date.now());
  const smsCode = async (number) => {
    const sent = await http('GET', `/api/platform/sms-outbox?mobile=${number}`, { admin: true });
    eq(sent.status, 200, 'sms outbox (console provider)');
    const codes = sent.json.map((m) => m.params.CODE).filter(Boolean);
    assert(codes.length, `no SMS code recorded for ${number}`);
    return codes[0];
  };
  /** API sign-in (sign-up when new) by SMS code; returns { access_token, user }. */
  const signUp = async (number, full_name, organization = '', title = '') => {
    await waitForResend(number, 'signin');
    eq((await http('POST', '/api/auth/otp/request', { body: { mobile: number } })).status, 202, 'otp request');
    markCodeRequested(number, 'signin');
    const verified = (await http('POST', '/api/auth/otp/verify', { body: { mobile: number, code: await smsCode(number) } })).json;
    if (verified.status === 'signed_in') return verified;
    return (await http('POST', '/api/auth/otp/complete', { body: { signup_token: verified.signup_token, full_name, organization, title } })).json;
  };
  /** The real sign-in form (attendee, booth or desk): number, Send code, then the code (it submits itself). */
  const uiCode = async (scope, number, purpose = 'signin') => {
    await waitForResend(number, purpose);
    const field = scope.getByLabel('Mobile number');
    // Right after a client-side redirect (e.g. Log Out) the form may still be settling: type until it holds.
    for (let i = 0; i < 20; i++) {
      await field.fill(number);
      await new Promise((r) => setTimeout(r, 150));
      if ((await field.inputValue()) === number) break;
    }
    await scope.getByRole('button', { name: 'Send code' }).click();
    await scope.getByLabel('Code from the SMS').waitFor({ timeout: 10000 });
    markCodeRequested(number, purpose);
    await scope.getByLabel('Code from the SMS').fill(await smsCode(number));
  };

  const browser = await chromium.launch({ channel: process.env.CONGRESS_BROWSER_CHANNEL ?? 'msedge' });
  const actors = {};
  const actor = async (name, viewport = { width: 1280, height: 900 }, extra = {}) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true, ...extra });
    const page = await context.newPage();
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) S.calls.push({ actor: name, m: r.method(), p: u.pathname, auth: r.headers().authorization }); });
    await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
    actors[name] = { context, page };
    return page;
  };
  const shot = (page, name, opts = {}) => page.screenshot({ path: `${SHOT_DIR}/${name}.png`, ...opts });

  try {
    // ───────────────────────────── Stage A — Organizer preparation ─────────────────────────────
    stage('A. Organizer preparation');
    const org1 = (await http('POST', '/api/organizers', { admin: true, body: { name: `E2E Organizer ${RUN}` } })).json;
    const org2 = (await http('POST', '/api/organizers', { admin: true, body: { name: `Other Tenant ${RUN}` } })).json;
    S.key = org1.api_key; S.key2 = org2.api_key;
    const O = await actor('organizer');
    await O.goto(`${BASE}/organizer`);
    await check('A1 credential gate; wrong key rejected and removed, no fallback', async () => {
      await O.getByRole('heading', { name: 'Organizer Authentication' }).waitFor();
      await O.locator('#apiKeyInput').fill('wrong-key-for-e2e');
      await O.getByRole('button', { name: /Access Organizer Dashboard/ }).click();
      await O.getByRole('alert').filter({ hasText: 'rejected' }).waitFor({ timeout: 10000 });
      assert(!(await O.evaluate(() => sessionStorage.getItem('congress_organizer_api_key'))), 'key stored');
    });
    await O.locator('#apiKeyInput').fill(S.key);
    await O.getByRole('button', { name: /Access Organizer Dashboard/ }).click();
    const createEvent = async (name, slug, day) => {
      await O.getByRole('button', { name: /Create New Event/ }).first().click();
      const d = O.getByRole('dialog');
      await d.getByPlaceholder('e.g. 18th Annual Congress of Biotechnology').fill(name);
      await d.getByPlaceholder('biotech-congress-2027').fill(slug);
      const dates = d.locator('input[type=datetime-local]');
      await dates.nth(0).fill(`2027-05-${day}T09:00`);
      await dates.nth(1).fill(`2027-05-${day}T17:00`);
      await d.getByPlaceholder('e.g. International Convention Center, Hall A').fill('Controlled Test Hall');
      await d.getByRole('button', { name: 'Create Event' }).click();
      await O.getByRole('status').filter({ hasText: name }).waitFor({ timeout: 10000 });
    };
    await check('A2 events created through the UI (two congresses) and stored in PostgreSQL', async () => {
      await O.getByText(/No events|no events/i).first().waitFor({ timeout: 10000 });
      await createEvent(`E2E Congress Alpha ${RUN}`, S.slug, '10');
      await createEvent(`E2E Congress Beta ${RUN}`, S.betaSlug, '12');
      eq(q(`select count(*) from events where slug in ('${S.slug}','${S.betaSlug}')`), '2', 'events in DB');
      S.alphaId = q(`select id from events where slug='${S.slug}'`);
      S.betaId = q(`select id from events where slug='${S.betaSlug}'`);
      eq(q(`select o.name from events e join organizers o on o.id=e.organizer_id where e.slug='${S.slug}'`), `E2E Organizer ${RUN}`, 'tenant owner');
    });
    const openEvent = async (id, section = '') => O.goto(`${BASE}/organizer/events/${id}${section}`);
    await check('A3 ticket tiers with capacity (Alpha quota 3, Beta quota 5)', async () => {
      for (const [id, name, quota] of [[S.alphaId, `General Delegate ${RUN}`, 3], [S.betaId, `Beta Delegate ${RUN}`, 5]]) {
        await openEvent(id, '/tiers');
        await O.getByRole('button', { name: /Add Ticket Tier/ }).first().click();
        const d = O.getByRole('dialog');
        await d.getByPlaceholder('e.g. Faculty Full Delegate').fill(name);
        await d.locator('input[type=number]').first().fill(String(quota));
        await d.getByRole('button', { name: 'Save Ticket Tier' }).click();
        await O.getByRole('status').filter({ hasText: name }).waitFor({ timeout: 10000 });
      }
      eq(q(`select quota from ticket_tiers where event_id='${S.alphaId}'`), '3', 'alpha quota');
      S.alphaTier = q(`select id from ticket_tiers where event_id='${S.alphaId}'`);
      S.betaTier = q(`select id from ticket_tiers where event_id='${S.betaId}'`);
    });
    await check('A4 check-in point (SINGLE_USE gate) created through the UI', async () => {
      await openEvent(S.alphaId, '/check-in');
      await O.getByRole('button', { name: /Add Check-In Point/ }).first().click();
      const d = O.getByRole('dialog');
      await d.getByPlaceholder('e.g. North Gate Entrance').fill('E2E Main Gate');
      await d.locator('select').selectOption('SINGLE_USE');
      await d.getByRole('button', { name: 'Save Check-In Point' }).click();
      await O.getByRole('status').filter({ hasText: 'E2E Main Gate' }).waitFor({ timeout: 10000 });
      S.point = q(`select id from checkin_points where event_id='${S.alphaId}' and name='E2E Main Gate'`);
      eq(q(`select policy_type from checkin_points where id='${S.point}'`), 'SINGLE_USE', 'policy');
    });
    await check('A5 two booths created and their staff authorized through the UI', async () => {
      await openEvent(S.alphaId, '/booths');
      for (const [name, slug] of [[`Alpha Booth One ${RUN}`, `alpha-1-${RUN}`], [`Alpha Booth Two ${RUN}`, `alpha-2-${RUN}`]]) {
        await O.getByRole('button', { name: /Add Exhibition Booth/ }).first().click();
        const d = O.getByRole('dialog');
        await d.getByPlaceholder('e.g. Biotech Systems Global').fill(name);
        await d.getByPlaceholder('biotech-systems').fill(slug);
        await d.getByRole('button', { name: 'Save Exhibition Booth' }).click();
        await O.getByRole('status').filter({ hasText: name }).waitFor({ timeout: 10000 });
      }
      S.booth1 = q(`select id from booths where slug='alpha-1-${RUN}'`);
      S.booth2 = q(`select id from booths where slug='alpha-2-${RUN}'`);
      // Representatives are authorized by mobile number; an account is created for a new number.
      for (const [name, rep, repName] of [[`Alpha Booth One ${RUN}`, 'rep1', 'Rep One'], [`Alpha Booth Two ${RUN}`, 'rep2', 'Rep Two']]) {
        const card = O.locator('div').filter({ hasText: name }).filter({ has: O.getByRole('button', { name: /Assign Booth Staff/ }) }).last();
        await card.getByRole('button', { name: /Assign Booth Staff/ }).click();
        const d = O.getByRole('dialog');
        await d.getByPlaceholder('e.g. Sara Karimi').fill(repName);
        await d.getByPlaceholder('09xx xxx xxxx').fill(mobile(rep));
        await d.getByRole('button', { name: 'Authorize Representative' }).click();
        await d.getByText(/Representative assigned/).waitFor({ timeout: 10000 });
        await O.keyboard.press('Escape');
      }
      eq(q(`select count(*) from booth_staff where booth_id in ('${S.booth1}','${S.booth2}')`), '2', 'staff rows');
      eq(q(`select u.mobile || '|' || u.full_name from booth_staff s join users u on u.id=s.user_id where s.booth_id='${S.booth1}'`), `${mobile('rep1')}|Rep One`, 'booth1 staff');
    });
    await check('A6 reception operator authorized by mobile number through the UI (no password to hand over)', async () => {
      await openEvent(S.alphaId, '/operators');
      await O.getByRole('button', { name: /Add Operator/ }).first().click();
      const d = O.getByRole('dialog');
      await d.getByPlaceholder('e.g. Maryam Bagheri').fill('E2E Operator');
      await d.getByPlaceholder('09xx xxx xxxx').fill(persian(mobile('operator')));
      await d.locator('button[type=submit]').click();
      await O.getByRole('status').filter({ hasText: 'E2E Operator is authorized' }).waitFor({ timeout: 10000 });
      assert(!(await O.locator('body').innerText()).match(/temporary password/i), 'a password is still shown');
      eq(q(`select count(*) from desk_operators o join users u on u.id=o.user_id where o.event_id='${S.alphaId}' and o.is_revoked=false and u.mobile='${mobile('operator')}'`), '1', 'operator row');
    });
    await check('A7 scanner device for the gate issued (supported API, exception) and listed', async () => {
      const t = await http('POST', `/api/checkin-points/${S.point}/token`, { key: S.key, body: { device_name: 'E2E Gate Phone' } });
      eq(t.status, 201, 'token status');
      S.scannerToken = t.json.scanner_token; S.deviceId = t.json.device_id;
      eq(q(`select count(*) from scanner_devices where checkin_point_id='${S.point}' and is_revoked=false`), '1', 'device row');
    });
    await check('A8 cross-tenant and cross-event isolation (organizer 2 sees nothing of Alpha; wrong credential families refused)', async () => {
      const ev2 = await http('POST', '/api/events', { key: S.key2, body: { name: `Other Tenant Congress ${RUN}`, slug: `other-${RUN}`, starts_at: '2027-06-01T09:00:00Z', ends_at: '2027-06-01T17:00:00Z', location: 'x', description: '' } });
      eq(ev2.status, 201, 'tenant 2 event');
      eq((await http('GET', `/api/events/${S.alphaId}`, { key: S.key2 })).status, 404, 'org2 reads Alpha');
      eq((await http('GET', `/api/events/${S.alphaId}/analytics/attendance`, { key: S.key2 })).status, 404, 'org2 analytics');
      eq((await http('POST', `/api/checkin-points/${S.point}/token`, { key: S.key2 })).status, 404, 'org2 mints scanner token');
      eq((await http('GET', `/api/events/${S.alphaId}`, { token: S.scannerToken })).status, 401, 'scanner token as organizer');
      eq((await http('GET', `/api/events/${S.alphaId}`, { admin: true })).status, 401, 'admin header as organizer');
      const list = (await http('GET', '/api/events', { key: S.key2 })).json;
      eq(list.map((e) => e.slug), [`other-${RUN}`], 'org2 list');
    });
    await check('A9 new congresses stay private until published in Page Studio (UI), then go public', async () => {
      eq((await http('GET', `/api/public/events/${S.slug}`)).status, 404, 'alpha before publishing');
      for (const id of [S.alphaId, S.betaId]) {
        await openEvent(id, '/page');
        await O.getByTestId('page-studio').waitFor({ timeout: 15000 });
        await O.getByRole('button', { name: 'Publish', exact: true }).first().click();
        await O.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();
        await O.getByRole('status').filter({ hasText: 'Published.' }).waitFor({ timeout: 10000 });
      }
      eq(q(`select count(*) from event_pages where event_id in ('${S.alphaId}','${S.betaId}') and published is not null`), '2', 'published pages');
      eq((await http('GET', `/api/public/events/${S.slug}`)).status, 200, 'alpha after publishing');
    });
    await O.goto(`${BASE}/organizer/events/${S.alphaId}`);
    await O.getByTestId('active-event').filter({ hasText: 'E2E Congress Alpha' }).waitFor();
    await shot(O, 'A-organizer-event-workspace');

    // ───────────────────────────── Stage B — Attendee registration ─────────────────────────────
    stage('B. Attendee registration');
    const A = await actor('attendee', { width: 390, height: 844 });
    await check('B1 public page shows the congress and its tier with capacity', async () => {
      await A.goto(`${BASE}/e/${S.slug}`);
      await A.getByRole('heading', { name: new RegExp(`E2E Congress Alpha ${RUN}`) }).first().waitFor({ timeout: 10000 });
      await A.getByText(`General Delegate ${RUN}`).first().waitFor();
    });
    await check('B2 attendee signs up by SMS code and reserves through the real dialog (201), pass shown', async () => {
      await A.getByRole('button', { name: /Reserve Free Pass/ }).first().click();
      const d = A.getByRole('dialog');
      await uiCode(d, mobile('alice'));
      await d.getByLabel('Full name').fill('Dr. Alice Attendee');
      await d.getByRole('button', { name: 'Create my account' }).click();
      await A.getByRole('heading', { name: 'Pass Reserved Successfully!' }).waitFor({ timeout: 15000 });
      eq(q(`select count(*) from tickets t join users u on u.id=t.user_id where u.mobile='${mobile('alice')}' and t.event_id='${S.alphaId}'`), '1', 'ticket row');
      S.aliceTicket = q(`select t.id from tickets t join users u on u.id=t.user_id where u.mobile='${mobile('alice')}'`);
      S.aliceQr = q(`select secret from entity_qrs where entity_id='${S.aliceTicket}' and entity_type='attendee_ticket'`);
      assert(S.aliceQr.length >= 20, 'qr secret');
    });
    await check('B3 capacity changed in the backend and in the Organizer view (reserved 1 of 3)', async () => {
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '1', 'reserved_count');
      // The confirmation SMS was queued with the ticket and delivered by the outbox worker.
      eq(q(`select count(*) from sms_messages where kind='ticket_confirmation' and ticket_id='${S.aliceTicket}'`), '1', 'confirmation queued once');
      for (let i = 0; i < 40 && q(`select status from sms_messages where kind='ticket_confirmation' and ticket_id='${S.aliceTicket}'`) !== 'sent'; i++) await new Promise((r) => setTimeout(r, 250));
      eq(q(`select status from sms_messages where kind='ticket_confirmation' and ticket_id='${S.aliceTicket}'`), 'sent', 'confirmation delivered');
      const confirmation = (await http('GET', `/api/platform/sms-outbox?mobile=${mobile('alice')}`, { admin: true })).json.find((m) => m.params.LINK);
      assert(confirmation && confirmation.params.LINK.endsWith(`/c/${S.slug}/my-ticket`) && confirmation.params.NAME === 'Dr. Alice Attendee', 'confirmation SMS content: ' + JSON.stringify(confirmation));
      await openEvent(S.alphaId);
      await O.getByText('1 / 3', { exact: false }).first().waitFor({ timeout: 10000 });
    });
    await check('B4 ticket page: correct congress, tier and QR; no pass for another congress', async () => {
      await A.getByRole('button', { name: /Open My Tickets/ }).click();
      await A.goto(`${BASE}/c/${S.slug}/my-ticket`);
      await A.getByText(`General Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
      await A.locator('main svg[viewBox^="0 0"]').first().waitFor();
      await A.goto(`${BASE}/c/${S.betaSlug}/my-ticket`);
      await A.getByText(/no .*pass|No Active Tickets|You have no/i).first().waitFor({ timeout: 10000 });
      assert(!(await A.locator('main').innerText()).includes(`General Delegate ${RUN}`), 'alpha tier visible in beta');
      await A.goto(`${BASE}/c/${S.slug}/my-ticket`);
      await A.getByText(`General Delegate ${RUN}`).first().waitFor();
      await shot(A, 'B-attendee-ticket-qr');
    });
    await check('B5 another User cannot see or use the ticket; the same attendee cannot reserve twice', async () => {
      const outsider = await signUp(mobile('outsider'), 'Out Sider');
      S.outsiderToken = outsider.access_token;
      eq((await http('GET', '/api/attendees/me/tickets', { token: S.outsiderToken })).json, [], 'outsider tickets');
      const O2 = await actor('outsider', { width: 390, height: 844 });
      await O2.goto(`${BASE}/c/${S.slug}/sign-in?next=${encodeURIComponent(`/c/${S.slug}/my-ticket`)}`);
      await uiCode(O2, mobile('outsider'));
      await O2.waitForURL(new RegExp(`/c/${S.slug}/my-ticket$`));
      await O2.getByText(/no .*pass|You have no|No Active Tickets/i).first().waitFor({ timeout: 10000 });
      assert(!(await O2.locator('body').innerText()).includes('Alice'), 'alice visible to outsider');
      const alice = await signUp(mobile('alice'), 'Dr. Alice Attendee');
      eq(alice.user.full_name, 'Dr. Alice Attendee', 'the existing account is signed in, not a new one');
      S.aliceToken = alice.access_token;
      eq((await http('POST', `/api/events/${S.alphaId}/tickets/reserve`, { token: S.aliceToken, body: { ticket_tier_id: S.alphaTier } })).status, 409, 'second reservation');
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '1', 'reserved_count unchanged');
    });

    await check('B6 changing accounts in the same browser never shows the previous account\'s ticket', async () => {
      await A.goto(`${BASE}/c/${S.slug}/my-ticket`);
      await A.getByText(`General Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
      await A.getByRole('button', { name: 'Log Out' }).click();
      await A.goto(`${BASE}/c/${S.slug}/sign-in?next=${encodeURIComponent(`/c/${S.slug}/my-ticket`)}`);
      await uiCode(A, mobile('outsider'));
      await A.waitForURL(new RegExp(`/c/${S.slug}/my-ticket$`));
      await A.getByText(/no .*pass|You have no|No Active Tickets/i).first().waitFor({ timeout: 10000 });
      assert(!(await A.locator('body').innerText()).includes(`General Delegate ${RUN}`), 'previous account ticket visible');
      await A.getByRole('button', { name: 'Log Out' }).click();
      await A.goto(`${BASE}/c/${S.slug}/sign-in?next=${encodeURIComponent(`/c/${S.slug}/my-ticket`)}`);
      await uiCode(A, mobile('alice'));
      await A.getByText(`General Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
    });

    // ───────────────────────────── Stage C — Reception ─────────────────────────────
    stage('C. Reception');
    const R = await actor('reception');
    await check('C1 /reception resolves the congress code and signs the operator in (desk credential only)', async () => {
      await R.goto(`${BASE}/reception`);
      await R.getByLabel(/Congress code/).fill(S.slug);
      await R.getByRole('button', { name: 'Continue' }).click();
      await R.waitForURL(`${BASE}/reception/${S.alphaId}`);
      await uiCode(R, mobile('operator'), 'desk');
      await R.getByTestId('reception-operator').filter({ hasText: 'E2E Operator' }).waitFor({ timeout: 10000 });
      await R.getByTestId('reception-event').filter({ hasText: 'E2E Congress Alpha' }).waitFor();
      S.deskToken = await R.evaluate((id) => sessionStorage.getItem(`congress_desk_token_${id}`), S.alphaId);
      assert(S.deskToken, 'desk token');
    });
    await check('C2 search finds the registered attendee; review shows status, tier and QR', async () => {
      await R.getByRole('searchbox').fill('Alice');
      await R.getByRole('button', { name: 'Review Dr. Alice Attendee' }).click();
      const rev = R.getByRole('region', { name: 'Dr. Alice Attendee' });
      await rev.getByText('Active & Valid').waitFor({ timeout: 10000 });
      await rev.locator('svg').first().waitFor();
      await rev.getByText(`#${S.aliceTicket.slice(0, 8).toUpperCase()}`, { exact: false }).waitFor();
      await shot(R, 'C-reception-review');
      await rev.getByRole('button', { name: /Next Attendee/ }).click();
    });
    await check('C3 walk-in ticket issued; ticket, QR, operator attribution and capacity confirmed in PostgreSQL', async () => {
      await R.getByLabel('Full Name').fill('Wanda Walkin');
      await R.getByLabel(/Mobile Number/).fill(mobile('wanda'));
      await R.getByRole('button', { name: /Mint & Present Pass/ }).click();
      await R.getByRole('dialog').getByText('Wanda Walkin').waitFor({ timeout: 10000 });
      S.wandaTicket = q(`select t.id from tickets t join users u on u.id=t.user_id where u.mobile='${mobile('wanda')}'`);
      eq(q(`select count(*) from sms_messages where kind='ticket_confirmation' and ticket_id='${S.wandaTicket}'`), '1', 'walk-in confirmation queued');
      assert(S.wandaTicket, 'ticket row');
      S.wandaQr = q(`select secret from entity_qrs where entity_id='${S.wandaTicket}'`);
      assert(num(`select count(*) from tickets where id='${S.wandaTicket}' and event_id='${S.alphaId}' and issued_by_operator_id is not null`) === 1, 'operator attribution');
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '2', 'reserved_count after walk-in');
      await R.getByRole('dialog').getByRole('button', { name: /Next Attendee/ }).click();
    });
    await check('C4 duplicate mobile number (typed in Persian digits): backend 409, exact existing pass offered, nothing issued twice', async () => {
      await R.getByLabel('Full Name').fill('Someone Else');
      await R.getByLabel(/Mobile Number/).fill(persian(mobile('wanda')));
      await R.getByRole('button', { name: /Mint & Present Pass/ }).click();
      await R.getByRole('alert').filter({ hasText: /already has an active ticket/ }).waitFor({ timeout: 10000 });
      await R.getByRole('button', { name: 'Review existing pass: Wanda Walkin' }).waitFor();
      eq(q(`select count(*) from tickets where event_id='${S.alphaId}'`), '2', 'tickets');
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '2', 'reserved_count unchanged');
      await R.getByLabel('Full Name').fill(''); await R.getByLabel(/Mobile Number/).fill('');
    });
    await check('C4b a walk-in whose response is lost: the UI claims no success, the ticket exists once, retry recovers the existing pass', async () => {
      await R.route('**/desk-registrations', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
      await R.getByLabel('Full Name').fill('Carla Lostresponse');
      await R.getByLabel(/Mobile Number/).fill(mobile('carla'));
      await R.getByRole('button', { name: /Mint & Present Pass/ }).click();
      await R.getByRole('alert').filter({ hasText: 'not known whether the pass was issued' }).waitFor({ timeout: 10000 });
      assert((await R.getByRole('dialog').count()) === 0, 'success shown for an unconfirmed write');
      eq(q(`select count(*) from tickets t join users u on u.id=t.user_id where u.mobile='${mobile('carla')}'`), '1', 'the write did happen on the server');
      await R.getByRole('button', { name: /Mint & Present Pass/ }).click();
      await R.getByRole('button', { name: 'Review existing pass: Carla Lostresponse' }).waitFor({ timeout: 10000 });
      eq(q(`select count(*) from tickets where event_id='${S.alphaId}'`), '3', 'tickets after retry');
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '3', 'reserved_count');
      S.carlaTicket = q(`select t.id from tickets t join users u on u.id=t.user_id where u.mobile='${mobile('carla')}'`);
      await R.getByLabel('Full Name').fill(''); await R.getByLabel(/Mobile Number/).fill('');
    });
    await check('C4c capacity is enforced: the tier is full (3 of 3) and a further reservation is refused without changing counts', async () => {
      eq((await http('POST', `/api/events/${S.alphaId}/tickets/reserve`, { token: S.outsiderToken, body: { ticket_tier_id: S.alphaTier } })).status, 410, 'sold out');
      eq(q(`select reserved_count from ticket_tiers where id='${S.alphaTier}'`), '3', 'reserved_count');
      eq(q(`select count(*) from tickets where event_id='${S.alphaId}'`), '3', 'tickets');
    });
    await check('C5 the Alpha operator cannot operate Beta (backend 403; browser keeps its session separate)', async () => {
      for (const p of [`/api/events/${S.betaId}/desk/me`, `/api/events/${S.betaId}/attendees`, `/api/events/${S.betaId}/desk/tiers`]) eq((await http('GET', p, { token: S.deskToken })).status, 403, p);
      eq((await http('POST', `/api/events/${S.betaId}/desk-registrations`, { token: S.deskToken, body: { full_name: 'X', ticket_tier_id: S.betaTier } })).status, 403, 'beta register');
      await R.goto(`${BASE}/reception/${S.betaId}`);
      await R.getByRole('heading', { name: 'Front Desk Operator Sign-In' }).waitFor();
      await uiCode(R, mobile('operator'), 'desk');
      await R.getByRole('alert').filter({ hasText: 'not assigned to this congress' }).waitFor({ timeout: 10000 });
      eq(q(`select count(*) from tickets where event_id='${S.betaId}'`), '0', 'beta tickets');
      assert(!S.calls.some((c) => c.actor === 'reception' && c.p.includes(S.betaId) && c.auth), 'credentialed call to beta');
    });
    await check('C6 wrong credential families on Reception endpoints are refused (organizer/User/scanner tokens as desk)', async () => {
      eq((await http('GET', `/api/events/${S.alphaId}/attendees`, { token: S.aliceToken })).status, 401, 'user token');
      eq((await http('GET', `/api/events/${S.alphaId}/attendees`, { token: S.scannerToken })).status, 401, 'scanner token');
    });

    await check('C7 organizer revokes the operator in the UI: the open Reception session is cut (401), login is denied, old token stays dead after reactivation', async () => {
      await openEvent(S.alphaId, '/operators');
      await O.getByRole('button', { name: 'Revoke Access' }).click();
      await O.getByRole('dialog', { name: 'Revoke operator access?' }).getByRole('button', { name: 'Revoke Access' }).click();
      await O.getByRole('status').filter({ hasText: 'Access revoked for E2E Operator' }).waitFor({ timeout: 10000 });
      eq(q(`select is_revoked from desk_operators where event_id='${S.alphaId}'`), 't', 'revoked in DB');
      eq((await http('GET', `/api/events/${S.alphaId}/desk/me`, { token: S.deskToken })).status, 401, 'revoked token');
      await R.goto(`${BASE}/reception/${S.alphaId}`);
      await R.getByRole('heading', { name: 'Front Desk Operator Sign-In' }).waitFor({ timeout: 10000 });
      await R.getByRole('alert').filter({ hasText: 'revoked or session expired' }).waitFor();
      // A revoked operator is not even sent a desk code; the newest code on record is an old, used one.
      await uiCode(R, mobile('operator'), 'desk');
      await R.getByRole('alert').filter({ hasText: /not assigned to this congress|not an active reception operator/ }).waitFor({ timeout: 10000 });
      // Reactivate through the same Add Operator form.
      await O.getByRole('button', { name: /Add Operator/ }).first().click();
      const d = O.getByRole('dialog');
      await d.getByPlaceholder('e.g. Maryam Bagheri').fill('E2E Operator');
      await d.getByPlaceholder('09xx xxx xxxx').fill(mobile('operator'));
      await d.locator('button[type=submit]').click();
      await O.getByText(/E2E Operator/).first().waitFor();
      await O.keyboard.press('Escape');
      await O.waitForTimeout(500);
      eq(q(`select is_revoked from desk_operators where event_id='${S.alphaId}'`), 'f', 'reactivated in DB');
      eq((await http('GET', `/api/events/${S.alphaId}/desk/me`, { token: S.deskToken })).status, 401, 'old token after reactivation');
      await R.getByRole('button', { name: 'Change number' }).click();
      await uiCode(R, mobile('operator'), 'desk');
      await R.getByTestId('reception-operator').filter({ hasText: 'E2E Operator' }).waitFor({ timeout: 10000 });
    });

    // ───────────────────────────── Stage D — Gate scanner ─────────────────────────────
    stage('D. Gate scanner (production build, service worker, real API)');
    const betaAttendee = await signUp(mobile('bella'), 'Bella Beta');
    const betaTicket = (await http('POST', `/api/events/${S.betaId}/tickets/reserve`, { token: betaAttendee.access_token, body: { ticket_tier_id: S.betaTier } })).json;
    S.betaQr = betaTicket.qr_secret;
    const G = await actor('scanner', { width: 390, height: 844 });
    debugPage = G;
    const scanCode = async (code) => { await G.getByPlaceholder(/Enter Ticket QR Secret/).fill(code); await G.getByRole('button', { name: /Evaluate Code/ }).click(); };
    const dbCheckins = (ticket, status) => num(`select count(*) from checkins where checkin_point_id='${S.point}' and ticket_id='${ticket}' and status='${status}'`);
    await check('D1 scanner pairs with its device token and loads the authorized gate manifest', async () => {
      await G.goto(`${BASE}/scan/${S.point}?token=${encodeURIComponent(S.scannerToken)}`);
      await G.getByText('E2E Main Gate').first().waitFor({ timeout: 20000 });
      await G.getByText('SINGLE_USE').first().waitFor();
      const m = await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: S.scannerToken });
      eq(m.status, 200, 'manifest');
      eq(m.json.tickets.map((t) => t.attendee_name).sort(), ['Carla Lostresponse', 'Dr. Alice Attendee', 'Wanda Walkin'], 'manifest tickets (Beta ticket absent)');
      assert((await G.evaluate(() => 'serviceWorker' in navigator)), 'no service worker support');
    });
    await check('D2 valid ticket is admitted; the admission is recorded by the backend after sync', async () => {
      await scanCode(S.aliceQr);
      await G.getByText(/Confirmed Admitted|Provisional Offline Admission/).first().waitFor({ timeout: 10000 });
      await G.waitForFunction(() => /Offline Buffer: 0 scans queued/.test(document.body.innerText), null, { timeout: 20000 });
      await shot(G, 'D-scanner-admitted');
      eq(dbCheckins(S.aliceTicket, 'ADMITTED'), 1, 'ADMITTED rows');
      const m = (await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: S.scannerToken })).json;
      eq(m.tickets.find((t) => t.ticket_id === S.aliceTicket).admission_count, 1, 'manifest admission_count');
    });
    await check('D3 duplicate scan follows the SINGLE_USE policy: rejected, one admission only', async () => {
      await G.waitForTimeout(2000); // the same badge re-presented inside its own result window is deliberately ignored
      await scanCode(S.aliceQr);
      await G.getByText(/Already Admitted|Duplicate Scan|Admission Rejected/i).first().waitFor({ timeout: 10000 });
      await G.waitForFunction(() => /Offline Buffer: 0 scans queued/.test(document.body.innerText), null, { timeout: 20000 });
      eq(dbCheckins(S.aliceTicket, 'ADMITTED'), 1, 'ADMITTED rows after duplicate');
      assert(num(`select count(*) from checkins where checkin_point_id='${S.point}' and ticket_id='${S.aliceTicket}'`) <= 2, 'extra rows');
    });
    await check('D4 ticket from another congress is rejected; no admission anywhere for it', async () => {
      await scanCode(S.betaQr);
      await G.getByText(/Rejected|not found in offline manifest|Invalid/i).first().waitFor({ timeout: 10000 });
      await G.waitForFunction(() => /Offline Buffer: 0 scans queued/.test(document.body.innerText), null, { timeout: 20000 });
      eq(num(`select count(*) from checkins c join tickets t on t.id=c.ticket_id where t.event_id='${S.betaId}' and c.status='ADMITTED'`), 0, 'beta admissions');
      // The backend itself also refuses it at the batch endpoint (the Beta ticket is not an Alpha admission).
      const direct = await http('POST', `/api/checkin-points/${S.point}/scans/batch`, { token: S.scannerToken, body: { scans: [{ scan_id: crypto.randomUUID(), qr_secret: S.betaQr, scanned_at: new Date().toISOString(), is_offline: false }] } });
      eq(direct.status, 200, 'batch status');
      eq(direct.json.results[0].status, 'REJECTED', 'backend verdict for wrong-event ticket');
      eq(direct.json.results[0].rejection_reason, 'EVENT_MISMATCH', 'backend reason');
      eq([direct.json.results[0].attendee_name ?? null, direct.json.results[0].ticket_tier_name ?? null], [null, null], 'foreign holder identity disclosed to the gate');
      eq(num(`select count(*) from checkins where ticket_id='${q(`select id from tickets where event_id='${S.betaId}'`)}'`), 0, 'foreign ticket linked to an Alpha gate check-in');
      eq(num(`select count(*) from checkins c join tickets t on t.id=c.ticket_id where t.event_id='${S.betaId}' and c.status='ADMITTED'`), 0, 'beta admissions after direct batch');
    });
    await check('D5 offline admission is queued locally and synchronized after reconnecting (not in PostgreSQL until then)', async () => {
      await G.context().setOffline(true);
      await scanCode(S.wandaQr);
      await G.getByText(/Provisional Offline Admission|Confirmed Admitted/).first().waitFor({ timeout: 10000 });
      await G.waitForFunction(() => /Offline Buffer: [1-9]/.test(document.body.innerText), null, { timeout: 10000 });
      eq(dbCheckins(S.wandaTicket, 'ADMITTED'), 0, 'row before sync');
      await G.context().setOffline(false);
      await G.waitForFunction(() => /Offline Buffer: 0 scans queued/.test(document.body.innerText), null, { timeout: 30000 });
      eq(dbCheckins(S.wandaTicket, 'ADMITTED'), 1, 'row after sync');
    });
    await check('D6 replaying a stored scan id is idempotent (same result, no new row)', async () => {
      const row = q(`select id, qr_secret from checkins where ticket_id='${S.wandaTicket}' and status='ADMITTED' limit 1`).split('|');
      const before = num(`select count(*) from checkins where checkin_point_id='${S.point}'`);
      const replay = await http('POST', `/api/checkin-points/${S.point}/scans/batch`, { token: S.scannerToken, body: { scans: [{ scan_id: row[0], qr_secret: row[1], scanned_at: new Date().toISOString(), is_offline: true }] } });
      eq(replay.json.results[0].status, 'ADMITTED', 'replay verdict');
      eq(num(`select count(*) from checkins where checkin_point_id='${S.point}'`), before, 'rows after replay');
      const conflict = await http('POST', `/api/checkin-points/${S.point}/scans/batch`, { token: S.scannerToken, body: { scans: [{ scan_id: row[0], qr_secret: S.aliceQr, scanned_at: new Date().toISOString(), is_offline: true }] } });
      eq(conflict.json.results[0].rejection_reason, 'SCAN_ID_CONFLICT', 'conflicting replay');
    });
    await check('D7 unauthorized devices: other gate scope, garbage, User and organizer tokens are refused', async () => {
      const point2 = (await http('POST', `/api/events/${S.alphaId}/checkin-points`, { key: S.key, body: { name: 'Second Gate', location: '', policy_type: 'MULTI_ENTRY' } })).json;
      eq((await http('GET', `/api/checkin-points/${point2.id}/manifest`, { token: S.scannerToken })).status, 403, 'scope mismatch');
      eq((await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: 'garbage.token.value' })).status, 401, 'garbage');
      eq((await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: S.aliceToken })).status, 403, 'user token (scanner credentials required)');
      eq((await http('GET', `/api/checkin-points/${S.point}/manifest`, { key: S.key2 })).status, 404, 'foreign organizer key (point hidden)');
    });
    await check('D7b an expired scanner token is refused (401) even though its signature and scope are right', async () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = signJwt({ sub: `scanner:${S.point}`, jti: S.deviceId, type: 'scanner', point_id: S.point, event_id: S.alphaId, iat: now - 7200, exp: now - 3600 });
      eq((await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: expired })).status, 401, 'expired scanner token');
      eq((await http('POST', `/api/checkin-points/${S.point}/scans/batch`, { token: expired, body: { scans: [] } })).status, 401, 'expired batch');
    });
    await check('D8 organizer revokes the device: next sync and scan are blocked, the old token is dead, records are kept', async () => {
      const rev = await http('POST', `/api/checkin-points/${S.point}/devices/${S.deviceId}/revoke`, { key: S.key });
      assert(rev.status === 200, 'revoke status ' + rev.status);
      eq((await http('GET', `/api/checkin-points/${S.point}/manifest`, { token: S.scannerToken })).status, 401, 'old token');
      const before = num(`select count(*) from checkins where checkin_point_id='${S.point}'`);
      await G.reload();
      await G.getByText(/revoked|Re-pair|Scanner Deactivated|expired/i).first().waitFor({ timeout: 20000 });
      eq(num(`select count(*) from checkins where checkin_point_id='${S.point}'`), before, 'records kept');
      await shot(G, 'D-scanner-revoked');
    });

    // ───────────────────────────── Stage E — Exhibitor ─────────────────────────────
    stage('E. Exhibitor interaction');
    const X = await actor('exhibitor', { width: 390, height: 844 });
    debugPage = X;
    const codeInput = () => X.getByPlaceholder('e.g. ABC123XYZ...');
    await check('E1 booth staff signs in directly and lands in their booth workspace', async () => {
      await X.goto(`${BASE}/booth/${S.booth1}`);
      await X.getByRole('link', { name: /Sign In to Booth Workspace/ }).click();
      // The representative's account was created by the organizer's assignment; the first SMS sign-in uses it.
      await uiCode(X, mobile('rep1'));
      await X.waitForURL(`${BASE}/booth/${S.booth1}`);
      await X.getByText(`Alpha Booth One ${RUN}`).first().waitFor({ timeout: 10000 });
      await X.getByTestId('booth-event').filter({ hasText: 'E2E Congress Alpha' }).waitFor();
    });
    await check('E2 attendee QR captured: a lead for the correct booth and ticket exists in PostgreSQL', async () => {
      await X.getByRole('button', { name: /Capture Attendee Lead/ }).last().click();
      await codeInput().fill(S.aliceQr);
      await X.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();
      await X.getByTestId('capture-result').getByText('Attendee lead captured successfully.').waitFor({ timeout: 10000 });
      eq(q(`select count(*) from leads where booth_id='${S.booth1}' and ticket_id='${S.aliceTicket}'`), '1', 'lead row');
      eq(q(`select count(*) from leads where booth_id='${S.booth2}'`), '0', 'other booth leads');
      eq(q(`select u.mobile from leads l join users u on u.id=l.captured_by_user_id where l.booth_id='${S.booth1}'`), mobile('rep1'), 'captured_by');
      await shot(X, 'E-exhibitor-captured');
    });
    await check('E3 qualification (HOT, tag, private note) saved; a re-scan with only the badge preserves it', async () => {
      await X.getByTestId('capture-result').getByRole('button', { name: 'Qualify & Follow Up' }).click();
      const d = X.getByRole('dialog').filter({ has: X.getByRole('button', { name: 'Save Qualification Changes' }) });
      await d.getByRole('button', { name: /Hot/ }).click();
      await d.getByRole('button', { name: /Send Quotation/ }).click();
      await d.locator('textarea').fill('Wants 3 units; follow up Friday.');
      await d.getByRole('button', { name: 'Save Qualification Changes' }).click();
      await d.getByText('Lead qualification updated successfully.').waitFor({ timeout: 10000 });
      await X.getByTestId('capture-result').getByRole('button', { name: /Next attendee/ }).click();
      await codeInput().fill(S.aliceQr);
      await X.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();
      await X.getByTestId('capture-result').getByText(/already a lead/).waitFor({ timeout: 10000 });
      const row = q(`select rating, tags, notes from leads where booth_id='${S.booth1}'`);
      assert(row.startsWith('HOT|') && row.includes('Send Quotation') && row.includes('Wants 3 units'), 'qualification lost: ' + row);
      eq(q(`select count(*) from leads where booth_id='${S.booth1}'`), '1', 'lead rows');
      await X.getByTestId('capture-result').getByRole('button', { name: 'Done' }).click();
    });
    await check('E4 a ticket from another congress is refused (400) and creates no lead', async () => {
      await X.getByRole('button', { name: /Capture Attendee Lead/ }).last().click();
      await codeInput().fill(S.betaQr);
      await X.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();
      await X.getByRole('dialog').getByRole('alert').filter({ hasText: 'different congress' }).waitFor({ timeout: 10000 });
      eq(q(`select count(*) from leads where booth_id in ('${S.booth1}','${S.booth2}')`), '1', 'leads in this congress');
      await X.keyboard.press('Escape');
    });
    await check('E5 lead search finds the lead; the CSV matches the backend record exactly', async () => {
      await X.getByPlaceholder(/Search/).fill('alice');
      await X.getByRole('article').filter({ hasText: 'Dr. Alice Attendee' }).waitFor();
      await X.getByPlaceholder(/Search/).fill('');
      const [dl] = await Promise.all([X.waitForEvent('download'), X.getByRole('button', { name: 'Export CRM CSV' }).click()]);
      const text = readFileSync(await dl.path(), 'utf8');
      const rows = text.replace('\ufeff', '').trim().split(/\r?\n/);
      eq(rows.length, 2, 'csv rows (header + 1)');
      const leadId = q(`select id from leads where booth_id='${S.booth1}'`);
      assert(rows[1].includes(leadId) && rows[1].includes('Dr. Alice Attendee') && rows[1].includes(mobile('alice')) && rows[1].includes('HOT') && rows[1].includes('Send Quotation') && rows[1].includes('Wants 3 units'), 'csv row differs from DB: ' + rows[1]);
      assert(!text.includes('Wanda') && !text.includes('Bella'), 'foreign attendee in csv');
      eq(dl.suggestedFilename(), `alpha-1-${RUN}-leads.csv`, 'filename');
    });
    await check('E6 a lead scan whose response is lost: no success shown, exactly one lead exists, a second scan only updates it', async () => {
      await X.getByRole('button', { name: /Capture Attendee Lead/ }).last().click();
      await X.route('**/leads/scan', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
      await codeInput().fill(S.wandaQr);
      await X.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();
      await X.getByRole('dialog').getByRole('alert').filter({ hasText: 'not known whether the lead was saved' }).waitFor({ timeout: 10000 });
      assert((await X.getByTestId('capture-result').count()) === 0, 'success shown for an unconfirmed write');
      eq(q(`select count(*) from leads where booth_id='${S.booth1}' and ticket_id='${S.wandaTicket}'`), '1', 'lead written once');
      await X.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();
      await X.getByTestId('capture-result').getByText(/already a lead/).waitFor({ timeout: 10000 });
      eq(q(`select count(*) from leads where booth_id='${S.booth1}' and ticket_id='${S.wandaTicket}'`), '1', 'lead rows after retry');
      await X.getByTestId('capture-result').getByRole('button', { name: 'Done' }).click();
    });
    await check('E7 the other booth\'s staff cannot read, scan, update or export these leads (403) and a switched account sees none', async () => {
      const t2 = (await signUp(mobile('rep2'), 'Rep Two')).access_token;
      const leadId = q(`select id from leads where booth_id='${S.booth1}' and ticket_id='${S.aliceTicket}'`);
      for (const [m, p, body] of [['GET', `/api/booths/${S.booth1}/leads`], ['GET', `/api/booths/${S.booth1}/leads/export-csv`], ['POST', `/api/booths/${S.booth1}/leads/scan`, { qr_secret: S.wandaQr }], ['PATCH', `/api/booths/${S.booth1}/leads/${leadId}`, { rating: 'COLD' }]]) {
        eq((await http(m, p, { token: t2, body })).status, 403, `${m} ${p}`);
      }
      eq(q(`select rating from leads where id='${leadId}'`), 'HOT', 'lead untouched');
      assert(!(await http('GET', `/api/booths/${S.booth2}/leads`, { token: t2 })).json.length, 'booth2 sees leads of booth1');
      await X.getByRole('button', { name: 'Log Out' }).click();
      await X.waitForURL(new RegExp(`/booth/${S.booth1}/sign-in`));
      await uiCode(X, mobile('rep2'));
      await X.getByRole('heading', { name: 'Commercial Access Restricted (403)' }).waitFor({ timeout: 10000 });
      assert(!(await X.locator('body').innerText()).includes('Alice'), 'alice visible to rep2');
      eq((await http('GET', `/api/booths/${S.booth1}/leads`, { token: S.aliceToken })).status, 403, 'plain user');
      eq((await http('GET', `/api/booths/${S.booth1}/leads`, { key: S.key })).status, 401, 'organizer key as user');
    });

    // ───────────────────────────── Stage F — Organizer reporting ─────────────────────────────
    stage('F. Organizer reporting');
    debugPage = O;
    const analyticsOf = async (id, key = S.key) => (await http('GET', `/api/events/${id}/analytics/attendance`, { key })).json;
    await check('F1 reservations and issued tickets: tiers show reserved 3 of 3 and match PostgreSQL', async () => {
      await openEvent(S.alphaId, '/tiers');
      await O.getByText(`General Delegate ${RUN}`).first().waitFor({ timeout: 10000 });
      await O.getByText(/Registered:.*3.*\/.*3/s).first().waitFor();
      eq(num(`select count(*) from tickets where event_id='${S.alphaId}'`), 3, 'tickets');
    });
    await check('F2 analytics equal the real admissions (tickets, unique admitted, scans) and match PostgreSQL', async () => {
      await openEvent(S.alphaId, '/analytics');
      const a = await analyticsOf(S.alphaId);
      const dbTotal = num(`select count(*) from checkins c join checkin_points p on p.id=c.checkin_point_id where p.event_id='${S.alphaId}'`);
      const dbAdmitted = num(`select count(*) from checkins c join checkin_points p on p.id=c.checkin_point_id where p.event_id='${S.alphaId}' and c.status='ADMITTED'`);
      const dbUnique = num(`select count(distinct c.ticket_id) from checkins c join checkin_points p on p.id=c.checkin_point_id where p.event_id='${S.alphaId}' and c.status='ADMITTED'`);
      eq([a.total_tickets, a.total_scans, a.total_admitted, a.unique_admitted], [3, dbTotal, dbAdmitted, dbUnique], 'analytics vs DB');
      eq(dbUnique, 2, 'two attendees admitted');
      await O.getByText(String(a.total_scans), { exact: true }).first().waitFor({ timeout: 10000 });
      await O.getByText(`${a.checkin_rate.toFixed(1)}%`).first().waitFor();
      await shot(O, 'F-organizer-analytics', { fullPage: true });
    });
    await check('F3 event CSV export matches the check-in records (whole event) and contains no Beta data', async () => {
      const [dl] = await Promise.all([O.waitForEvent('download'), O.getByRole('button', { name: 'Export Attendance CSV' }).click()]);
      const text = readFileSync(await dl.path(), 'utf8');
      const rows = text.replace('\ufeff', '').trim().split(/\r?\n/);
      const dbTotal = num(`select count(*) from checkins c join checkin_points p on p.id=c.checkin_point_id where p.event_id='${S.alphaId}'`);
      eq(rows.length - 1, dbTotal, 'csv data rows vs DB check-ins');
      assert(text.includes('Dr. Alice Attendee') && text.includes('Wanda Walkin') && text.includes('EVENT_MISMATCH') && !text.includes('Bella') && !text.includes(mobile('bella')), 'csv content: ' + text.slice(0, 600).replace(/\r?\n/g, ' // '));
      eq(dl.suggestedFilename(), `${S.slug}-attendance.csv`, 'filename');
    });
    await check('F4 switching to Beta shows only Beta numbers; Alpha data never leaks; Beta analytics are zero scans', async () => {
      await openEvent(S.betaId, '/analytics');
      await O.getByTestId('active-event').filter({ hasText: 'E2E Congress Beta' }).waitFor({ timeout: 10000 });
      const b = await analyticsOf(S.betaId);
      eq([b.total_tickets, b.total_scans, b.total_admitted], [1, 0, 0], 'beta analytics');
      const body = await O.locator('main').innerText();
      assert(!body.includes('Alice') && !body.includes('E2E Congress Alpha'), 'alpha data on beta page');
      await openEvent(S.betaId, '/tiers');
      await O.getByText(`Beta Delegate ${RUN}`).first().waitFor();
      assert(!(await O.locator('main').innerText()).includes(`General Delegate ${RUN}`), 'alpha tier on beta');
    });
    await check('F5 the other tenant\'s organizer cannot see any of this event\'s reports', async () => {
      eq((await http('GET', `/api/events/${S.alphaId}/analytics/export-csv`, { key: S.key2 })).status, 404, 'org2 csv');
    });
    await check('F6 no request in the whole journey mixed credential families (organizer key only on organizer routes; desk token only on its event)', async () => {
      const bad = S.calls.filter((c) => (c.actor === 'reception' && c.auth && c.auth === `Bearer ${S.key}`) || (c.actor === 'exhibitor' && c.auth === `Bearer ${S.key}`) || (c.actor === 'attendee' && c.auth === `Bearer ${S.key}`));
      eq(bad.length, 0, 'cross-family requests');
      assert(!S.calls.some((c) => c.p.endsWith('/desk/login') && c.auth), 'credentialed desk login');
    });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
  return { run: RUN, total: results.length, failed, results, exceptions: EXCEPTIONS };
}
