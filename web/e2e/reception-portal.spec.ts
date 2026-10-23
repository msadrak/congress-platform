import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Reception pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in RECEPTION_PORTAL_MILESTONE_RESULT.md.
const EVENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORGANIZER_KEY = 'synthetic-ms04-organizer';
const USER_TOKEN = 'synthetic-ms04-user';
const CODE = '482913';
const OPERATOR_MOBILE = '09121110001';
const tokenOf = (n: number) => `synthetic-ms04-desk-a-${n}`;

interface FixtureAttendee { ticket_id: string; attendee_id: string; attendee_name: string; attendee_mobile: string | null; organization: string; title: string; ticket_tier_id: string; ticket_tier_name: string; qr_secret: string; status: string; checkin_count: number; issued_by: string | null; created_at: string }
const attendee = (event: string, n: number, name: string, mobile: string | null, status = 'active'): FixtureAttendee => ({
  ticket_id: `ticket-${event}-${n}`, attendee_id: `att-${event}-${n}`, attendee_name: name, attendee_mobile: mobile, organization: 'Heart Center', title: 'Cardiologist',
  ticket_tier_id: 'tier-1', ticket_tier_name: 'General', qr_secret: `qr-${event}-${n}`, status, checkin_count: n === 1 ? 2 : 0, issued_by: null, created_at: '2099-01-01T00:00:00Z',
});
const EVENT_NAMES: Record<string, string> = { [EVENT_A]: 'Alpha Congress', [EVENT_B]: 'Beta Summit' };

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown; idempotencyKey?: string };
interface Options {
  registerFails?: boolean;
  /** The first walk-in request is processed, then its response is lost (the connection drops). */
  registerResponseLostOnce?: boolean;
  registerDelayMs?: number;
  loginStatus?: number;
}
interface Fixture {
  requests: Recorded[];
  revokeAll: () => void;
  issuedTokens: string[];
}

async function fixture(page: Page, options: Options = {}): Promise<Fixture> {
  const requests: Recorded[] = [];
  const attendees: Record<string, FixtureAttendee[]> = {
    [EVENT_A]: [
      attendee(EVENT_A, 1, 'Alice Rahimi', '09121230001'),
      attendee(EVENT_A, 2, 'Alicia Moradi', '09121230002'),
      attendee(EVENT_A, 3, 'Bob Karimi', '09121230003', 'revoked'),
    ],
    [EVENT_B]: [attendee(EVENT_B, 1, 'Alice Foreign', '09121230009')],
  };
  const issuedTokens: string[] = [];
  let validToken = '';
  let revokedGeneration = 0;
  let loginCount = 0;
  const issuedByKey: Record<string, unknown> = {};
  let responseLost = false;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const auth = request.headers().authorization;
    const raw = request.postData();
    requests.push({ method, path, auth, body: raw ? JSON.parse(raw) : undefined, idempotencyKey: request.headers()['idempotency-key'] });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/otp/request') return json(202, { mobile: JSON.parse(raw ?? '{}').mobile, code_length: 6, expires_in: 120, resend_after: 60 });
    const pub = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pub) {
      if (pub[1] === 'alpha') return json(200, { id: EVENT_A, name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-01-01T00:00:00Z', ends_at: '2099-01-02T00:00:00Z', location: 'Hall', description: '', ticket_tiers: [], venue: [], sessions: [] });
      return json(404, { detail: 'Event not found' });
    }
    const match = path.match(/^\/api\/events\/([^/]+)\/(.*)$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, event, rest] = match;
    if (rest === 'desk/login') {
      if (options.loginStatus) return json(options.loginStatus, { detail: 'denied' });
      const body = JSON.parse(raw ?? '{}') as { mobile: string; code: string };
      if (body.code !== CODE) return json(401, { detail: 'The code is wrong or has expired.' });
      if (event !== EVENT_A) return json(403, { detail: 'Not assigned' });
      loginCount += 1;
      validToken = tokenOf(loginCount + revokedGeneration);
      issuedTokens.push(validToken);
      return json(200, { access_token: validToken, token_type: 'bearer', event_id: event, event_name: EVENT_NAMES[event], event_slug: 'alpha', operator: { id: 'op-1', operator_name: 'Operator One' } });
    }
    if (auth !== `Bearer ${validToken}` || !validToken) return json(401, { detail: 'Invalid desk token' });
    if (event !== EVENT_A) return json(403, { detail: 'Wrong event' });
    if (rest === 'desk/me') return json(200, { operator_id: 'op-1', operator_name: 'Operator One', event_id: event, event_name: EVENT_NAMES[event], event_slug: 'alpha', is_organizer_admin: false });
    if (rest === 'desk/tiers') return json(200, [{ id: 'tier-1', name: 'General', description: '', quota: 100, reserved_count: 3, is_open: true }]);
    if (rest === 'attendees' && method === 'GET') {
      const q = (new URL(request.url()).searchParams.get('q') ?? '').toLowerCase();
      return json(200, attendees[event].filter(a => !q || `${a.attendee_name} ${a.attendee_mobile ?? ''}`.toLowerCase().includes(q)));
    }
    const prints = rest.match(/^attendees\/([^/]+)\/prints$/);
    if (prints && method === 'POST') return json(201, { print_id: 'print-1', reason: 'first', printed_at: '2099-01-01T09:00:00Z', printed_by: 'Operator One', print_count: 1 });
    const detail = rest.match(/^attendees\/([^/]+)$/);
    if (detail) {
      const found = attendees[event].find(a => a.ticket_id === detail[1]);
      return found ? json(200, { ...found, scan_history: found.checkin_count ? [{ checkin_point_name: 'Main Gate', scanned_at: '2099-01-01T08:00:00Z', status: 'ADMITTED' }] : [] }) : json(404, { detail: 'Ticket not found' });
    }
    if (rest === 'desk-registrations') {
      if (options.registerDelayMs) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, options.registerDelayMs);
        await promise;
      }
      if (options.registerFails) return route.abort('failed');
      const key = request.headers()['idempotency-key'];
      const replay = key ? issuedByKey[key] : undefined;
      if (replay) return json(201, replay);
      const body = JSON.parse(raw ?? '{}') as { full_name: string; mobile?: string | null };
      const mobile = body.mobile ?? null;
      if (mobile && attendees[event].some(a => a.attendee_mobile === mobile)) return json(409, { detail: 'Attendee already has an active ticket for this congress' });
      const created = attendee(event, attendees[event].length + 1, body.full_name, mobile);
      attendees[event].push(created);
      const issued = { ticket_id: created.ticket_id, attendee_name: created.attendee_name, attendee_mobile: mobile, organization: '', title: '', ticket_tier_name: 'General', qr_secret: created.qr_secret, issued_by: 'Operator One', created_at: created.created_at };
      if (key) issuedByKey[key] = issued;
      if (options.registerResponseLostOnce && !responseLost) {
        responseLost = true;
        return route.abort('failed');
      }
      return json(201, issued);
    }
    return json(404, { detail: 'Not found' });
  });
  return {
    requests,
    issuedTokens,
    revokeAll: () => { revokedGeneration += 1; validToken = ''; },
  };
}

async function seed(page: Page, options: { locale?: string; organizer?: boolean; token?: string } = {}) {
  await page.goto('/');
  await page.evaluate(({ locale, organizer, token, eventA, key, user }) => {
    localStorage.setItem('congress_attendee_locale', locale);
    localStorage.setItem('congress_attendee_token', user);
    if (organizer) sessionStorage.setItem('congress_organizer_api_key', key);
    if (token) sessionStorage.setItem(`congress_desk_token_${eventA}`, token);
  }, { locale: options.locale ?? 'en', organizer: options.organizer ?? false, token: options.token ?? '', eventA: EVENT_A, key: ORGANIZER_KEY, user: USER_TOKEN });
}

/** From the mobile step: request a desk code, then type it (a complete code submits itself). */
async function signIn(page: Page, code = CODE) {
  await page.getByLabel('Mobile number').fill(OPERATOR_MOBILE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await enterCode(page, code);
}
/** On the code step: type another code. */
async function enterCode(page: Page, code = CODE) {
  await page.getByLabel('Code from the SMS').fill(code);
}
const search = (page: Page) => page.getByRole('searchbox');
const SIGN_IN = 'Sign in to the desk';
/** The desk registration dialog, opened from the button next to the search. */
async function openWalkIn(page: Page) {
  await page.getByRole('button', { name: 'Desk registration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Desk registration' });
  await expect(dialog).toBeVisible();
  return dialog;
}
const issued = (page: Page) => page.getByRole('dialog', { name: 'Issued' });
const stored = (page: Page) => page.evaluate(({ eventA }) => ({
  desk: sessionStorage.getItem(`congress_desk_token_${eventA}`),
  organizer: sessionStorage.getItem('congress_organizer_api_key'),
  user: localStorage.getItem('congress_attendee_token'),
  all: JSON.stringify({ ...sessionStorage, ...localStorage }),
}), { eventA: EVENT_A });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function openSignedIn(page: Page, fx?: Fixture) {
  await page.goto(`/reception/${EVENT_A}`);
  await signIn(page);
  await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
  return fx;
}

test.describe('independent entry and sign-in', () => {
  test('a congress code resolves through the public endpoint; unknown and invalid codes are explained', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page, { organizer: true });
    fx.requests.length = 0;
    await page.goto('/reception');
    await page.getByLabel(/Congress code/).fill('nope');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('No congress has this code.')).toBeVisible();
    await page.getByLabel(/Congress code/).fill('https://example.test/e/alpha');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/reception/${EVENT_A}$`));
    await expect(page.getByRole('heading', { name: SIGN_IN })).toBeVisible();
    expect(fx.requests.every(r => r.path.startsWith('/api/public/') && r.auth === undefined)).toBe(true);

    await page.goto('/reception/e/alpha');
    await expect(page).toHaveURL(new RegExp(`/reception/${EVENT_A}$`));
    await page.goto('/reception/not-a-uuid');
    await expect(page.getByRole('heading', { name: "This desk link isn't valid" })).toBeVisible();
  });

  test('the portal has no Organizer navigation, mode switch or key use even when an organizer key is stored', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page, { organizer: true });
    fx.requests.length = 0;
    await page.goto(`/reception/${EVENT_A}`);
    await expect(page.getByRole('heading', { name: SIGN_IN })).toBeVisible();
    await expect(page.getByRole('link', { name: /Organizer/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Organizer', exact: true })).toHaveCount(0);
    expect(fx.requests).toEqual([]);
    await signIn(page);
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Organizer|Congress settings/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('menuitem', { name: /Organizer mode|Congress settings/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const protectedCalls = fx.requests.filter(r => r.path !== `/api/events/${EVENT_A}/desk/login` && r.path !== '/api/auth/otp/request');
    expect(fx.requests.find(r => r.path === '/api/auth/otp/request')?.auth).toBeUndefined();
    expect(protectedCalls.length).toBeGreaterThan(0);
    expect(protectedCalls.every(r => r.auth === `Bearer ${fx.issuedTokens[0]}`)).toBe(true);
    expect(fx.requests.find(r => r.path.endsWith('/desk/login'))?.auth).toBeUndefined();
    expect((await stored(page)).organizer).toBe(ORGANIZER_KEY);
  });

  test('operator signs in with an SMS code, sees congress and operator context, and the code is never stored', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Alpha Congress' })).toBeVisible();
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
    expect(fx.requests.find(r => r.path === '/api/auth/otp/request')?.body).toEqual({ mobile: OPERATOR_MOBILE, purpose: 'desk' });
    expect(fx.requests.find(r => r.path.endsWith('/desk/login'))?.body).toEqual({ mobile: OPERATOR_MOBILE, code: CODE });
    const snapshot = await stored(page);
    expect(snapshot.desk).toBe(fx.issuedTokens[0]);
    expect(snapshot.all).not.toContain(CODE);
    // Signed in, the desk is what the home-screen icon reopens.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('congress_operator_launch') ?? 'null')?.path)).toBe(`/reception/${EVENT_A}`);
    await page.reload();
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
  });

  test('wrong code, revoked or unassigned number, and network failure are distinct and store nothing', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page, '000000');
    await expect(page.getByRole('alert')).toContainText('The code is wrong or has expired');
    expect((await stored(page)).desk).toBeNull();

    await page.unrouteAll();
    await fixture(page, { loginStatus: 403 });
    await enterCode(page);
    await expect(page.getByRole('alert')).toContainText("isn't an operator of this congress");

    await page.unrouteAll();
    await page.route(/\/desk\/login$/, route => route.abort('failed'));
    // Retrying the same code: the operator presses the button (the field did not change, so no auto-submit).
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not reach the server');
    expect((await stored(page)).desk).toBeNull();
  });

  test('another event is a separate workspace: the event A session is never sent for event B', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page);
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
    fx.requests.length = 0;
    await page.goto(`/reception/${EVENT_B}`);
    await expect(page.getByRole('heading', { name: SIGN_IN })).toBeVisible();
    expect(fx.requests.filter(r => r.path.includes(EVENT_B))).toEqual([]);
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText("isn't an operator of this congress");
    expect((await stored(page)).desk).toBe(fx.issuedTokens[0]);
  });
});

test.describe('search, review and next attendee', () => {
  test('search shows only this congress, review shows pass and history, print only records the print, next attendee resets', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await page.addInitScript(() => { (window as unknown as { __prints: number }).__prints = 0; window.print = () => { (window as unknown as { __prints: number }).__prints += 1; }; });
    await openSignedIn(page);
    await search(page).fill('alic');
    await expect(page.getByRole('button', { name: 'Review Alice Rahimi' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Alicia Moradi' })).toBeVisible();
    await expect(page.getByText('Alice Foreign')).toHaveCount(0);

    await page.getByRole('button', { name: 'Review Alice Rahimi' }).click();
    const review = page.getByRole('region', { name: 'Alice Rahimi' });
    await expect(review.getByText('Active', { exact: true })).toBeVisible();
    await expect(review.getByText('Main Gate')).toBeVisible();
    await expect(review.locator('svg').first()).toBeVisible();
    await expect(review.getByRole('heading', { name: 'Alice Rahimi', level: 2 })).toBeFocused();

    const writesBefore = fx.requests.filter(r => r.method === 'POST').length;
    await review.getByRole('button', { name: 'Print pass' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
    // Printing issues nothing: its only write is the print record (reprint tracking).
    const writes = fx.requests.filter(r => r.method === 'POST').slice(writesBefore);
    expect(writes.map(r => r.path)).toEqual([`/api/events/${EVENT_A}/attendees/ticket-${EVENT_A}-1/prints`]);
    // Printed and current: no print line, Reprint stays available.
    await expect(review.getByTestId('badge-print-state')).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Reprint' })).toBeVisible();

    await review.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toHaveCount(0);
    await expect(search(page)).toHaveValue('');
    await expect(search(page)).toBeFocused();
  });

  test('a ticket outside the event answers 404 and no attendee data is shown', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await openSignedIn(page);
    await search(page).fill('alice');
    await page.route(new RegExp(`/api/events/${EVENT_A}/attendees/ticket-${EVENT_A}-1$`), route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Ticket not found' }) }));
    await page.getByRole('button', { name: 'Review Alice Rahimi' }).click();
    await expect(page.getByRole('alert')).toContainText("isn't in this congress");
    await expect(page.getByText('qr-')).toHaveCount(0);
  });

  test('no results offer an explicit walk-in prefilled from the query; failed search says so', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await openSignedIn(page);
    await search(page).fill('Zed Newcomer');
    await expect(page.getByText('No one found.')).toBeVisible();
    await page.getByRole('button', { name: 'Register “Zed Newcomer” at the desk' }).click();
    const dialog = page.getByRole('dialog', { name: 'Desk registration' });
    await expect(dialog.getByLabel('Full name')).toHaveValue('Zed Newcomer');
    await expect(dialog.getByLabel('Full name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.route(/\/attendees\?/, route => route.abort('failed'));
    await search(page).fill('another');
    await expect(page.getByRole('alert').filter({ hasText: 'Search failed' })).toBeVisible();
  });

  test('keyboard: "/" jumps to search and Enter opens the focused result', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await openSignedIn(page);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(search(page)).toBeFocused();
    await search(page).fill('alice r');
    const result = page.getByRole('button', { name: 'Review Alice Rahimi' });
    await expect(result).toBeVisible();
    await result.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toBeVisible();
  });
});

test.describe('desk registration', () => {
  test('a backend-confirmed pass is shown with Print first, a double submit sends one request, and Next returns to search', async ({ page }) => {
    const fx = await fixture(page, { registerDelayMs: 600 });
    await seed(page);
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Walk In Person');
    await form.getByLabel(/Mobile/).fill('0912 777 0001');
    await form.getByRole('button', { name: 'Issue pass' }).dblclick();
    const dialog = issued(page);
    await expect(dialog).toContainText('Walk In Person');
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    // Print is the one primary action; Next is secondary.
    await expect(dialog.getByRole('button', { name: 'Print pass' })).toHaveClass(/bg-action-primary/);
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(search(page)).toBeFocused();
    await search(page).fill('7770001');
    await expect(page.getByRole('button', { name: 'Review Walk In Person' })).toBeVisible();
    await expect((await openWalkIn(page)).getByLabel('Full name')).toHaveValue('');
  });

  test('a duplicate mobile number offers the exact existing pass without selecting it or resubmitting', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Someone Else');
    await form.getByLabel(/Mobile/).fill('۰۹۱۲ ۱۲۳ ۰۰۰۱');  // Alice's number in Persian digits
    await form.getByRole('button', { name: 'Issue pass' }).click();
    await expect(form.getByRole('alert')).toContainText('already has an active ticket');
    const offer = form.getByRole('button', { name: 'Review existing pass: Alice Rahimi' });
    await expect(offer).toBeVisible();
    await expect(form.getByRole('button', { name: /Review existing pass: Alicia/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toHaveCount(0);
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    await offer.click();
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toBeVisible();
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    await expect((await openWalkIn(page)).getByLabel('Full name')).toHaveValue('Someone Else');
  });

  test('a dropped connection keeps the entry, claims no success, and says a retry is safe', async ({ page }) => {
    await fixture(page, { registerFails: true });
    await seed(page);
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Lost Connection');
    await form.getByRole('button', { name: 'Issue pass' }).click();
    await expect(form.getByRole('alert')).toContainText('Connection lost. Press Issue again; no duplicate is created.');
    await expect(issued(page)).toHaveCount(0);
    await expect(form.getByLabel('Full name')).toHaveValue('Lost Connection');
    await expect(page.locator('[data-status="offline"]')).toBeVisible();
    expect((await stored(page)).desk).not.toBeNull();
  });

  test('retrying after a dropped connection resends the same Idempotency-Key and shows the one pass issued', async ({ page }) => {
    const fx = await fixture(page, { registerResponseLostOnce: true });
    await seed(page);
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Retry Person');
    const submit = form.getByRole('button', { name: 'Issue pass' });
    await submit.click();
    await expect(form.getByRole('alert')).toContainText('no duplicate is created');
    await submit.click();
    await expect(issued(page)).toContainText('Retry Person');
    const posts = fx.requests.filter(r => r.path.endsWith('desk-registrations'));
    expect(posts).toHaveLength(2);
    expect(posts[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);

    // The next attendee is a new submission with a new key.
    await issued(page).getByRole('button', { name: 'Next' }).click();
    const next = await openWalkIn(page);
    await next.getByLabel('Full name').fill('Second Person');
    await next.getByRole('button', { name: 'Issue pass' }).click();
    await expect(issued(page)).toContainText('Second Person');
    const third = fx.requests.filter(r => r.path.endsWith('desk-registrations'))[2];
    expect(third.idempotencyKey).not.toBe(posts[0].idempotencyKey);
  });

  test('changing the entry after a dropped connection sends a new Idempotency-Key', async ({ page }) => {
    const fx = await fixture(page, { registerFails: true });
    await seed(page);
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('First Spelling');
    const submit = form.getByRole('button', { name: 'Issue pass' });
    await submit.click();
    await expect(form.getByRole('alert')).toContainText('Connection lost');
    await submit.click();
    await expect.poll(() => fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(2);
    await form.getByLabel('Full name').fill('Corrected Spelling');
    await submit.click();
    await expect.poll(() => fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(3);
    const keys = fx.requests.filter(r => r.path.endsWith('desk-registrations')).map(r => r.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

test.describe('session loss', () => {
  test('a revoked session stops operations, hides retrieved data, keeps the draft and never resubmits after sign-in', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page, { organizer: true });
    await openSignedIn(page);
    await search(page).fill('alice');
    await page.getByRole('button', { name: 'Review Alice Rahimi' }).click();
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toBeVisible();
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Unsent Draft');
    await form.getByRole('button', { name: 'Cancel' }).click();
    const firstToken = fx.issuedTokens[0];

    fx.revokeAll();
    await search(page).fill('alic');
    await expect(page.getByRole('heading', { name: SIGN_IN })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Access removed or signed out.');
    await expect(page.getByRole('alert')).toContainText("Your form is kept and won't be sent automatically.");
    await expect(page.getByText('qr-')).toHaveCount(0);
    await expect(page.getByText('Alice Rahimi')).toHaveCount(0);
    const snapshot = await stored(page);
    expect(snapshot.desk).toBeNull();
    expect(snapshot.organizer).toBe(ORGANIZER_KEY);

    const postsBefore = fx.requests.filter(r => r.path.endsWith('desk-registrations')).length;
    await signIn(page);
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'the registration form was kept' })).toBeVisible();
    await expect((await openWalkIn(page)).getByLabel('Full name')).toHaveValue('Unsent Draft');
    expect(fx.issuedTokens.length).toBe(2);
    expect(fx.issuedTokens[1]).not.toBe(firstToken);
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(postsBefore);
    // The old token stays dead; every later request uses the new one.
    const afterLogin = fx.requests.slice(fx.requests.map(r => r.path).lastIndexOf(`/api/events/${EVENT_A}/desk/login`) + 1);
    expect(afterLogin.length).toBeGreaterThan(0);
    expect(afterLogin.every(r => r.auth === `Bearer ${fx.issuedTokens[1]}`)).toBe(true);
  });

  test('sign out (from the menu, confirmed) removes only this event session and clears the draft and retrieved data', async ({ page }) => {
    await fixture(page);
    await seed(page, { organizer: true });
    await openSignedIn(page);
    const form = await openWalkIn(page);
    await form.getByLabel('Full name').fill('Draft To Clear');
    await form.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('dialog', { name: 'Sign out of the desk?' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: SIGN_IN })).toBeVisible();
    const snapshot = await stored(page);
    expect(snapshot.desk).toBeNull();
    expect(snapshot.organizer).toBe(ORGANIZER_KEY);
    expect(snapshot.user).toBe(USER_TOKEN);
    await signIn(page);
    await expect((await openWalkIn(page)).getByLabel('Full name')).toHaveValue('');
  });
});

test.describe('layout and language', () => {
  test('tablet and mobile have no horizontal overflow and keep search first', async ({ page }) => {
    await fixture(page);
    await seed(page);
    for (const [width, height] of [[768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/reception/${EVENT_A}`);
      await expect(page.getByLabel('Mobile number')).toBeVisible();
      expect(await overflow(page), `${width}px login`).toBe(0);
      await signIn(page);
      await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
      await search(page).fill('alic');
      await expect(page.getByRole('button', { name: 'Review Alice Rahimi' })).toBeVisible();
      expect(await overflow(page), `${width}px workspace`).toBe(0);
      const searchBox = (await search(page).boundingBox())!;
      const firstResult = (await page.getByRole('button', { name: 'Review Alice Rahimi' }).boundingBox())!;
      expect(searchBox.y).toBeLessThan(firstResult.y);
      await page.evaluate(() => sessionStorage.clear());
    }
  });

  test('Persian RTL at 320px is right-to-left, fits and uses Persian labels', async ({ page }) => {
    await fixture(page);
    await seed(page, { locale: 'fa' });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/reception/${EVENT_A}`);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ورود به میز پذیرش' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByLabel('شماره موبایل').fill('۰۹۱۲۱۱۱۰۰۰۱');
    await page.getByRole('button', { name: 'ارسال کد' }).click();
    await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeVisible();
    await page.getByLabel('کد پیامک‌شده').fill('۴۸۲۹۱۳');
    await expect(page.getByText('Operator One', { exact: true })).toBeVisible();
    await search(page).fill('alic');
    await expect(page.getByRole('button', { name: 'بررسی Alice Rahimi' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
});
