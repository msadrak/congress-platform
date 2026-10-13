import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Reception pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in RECEPTION_PORTAL_MILESTONE_RESULT.md.
const EVENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORGANIZER_KEY = 'synthetic-ms04-organizer';
const USER_TOKEN = 'synthetic-ms04-user';
const PASSWORD = 'operator-password-1';
const tokenOf = (n: number) => `synthetic-ms04-desk-a-${n}`;

interface FixtureAttendee { ticket_id: string; attendee_id: string; attendee_name: string; attendee_email: string; organization: string; title: string; ticket_tier_id: string; ticket_tier_name: string; qr_secret: string; status: string; checkin_count: number; issued_by: string | null; created_at: string }
const attendee = (event: string, n: number, name: string, email: string, status = 'active'): FixtureAttendee => ({
  ticket_id: `ticket-${event}-${n}`, attendee_id: `att-${event}-${n}`, attendee_name: name, attendee_email: email, organization: 'Heart Center', title: 'Cardiologist',
  ticket_tier_id: 'tier-1', ticket_tier_name: 'General', qr_secret: `qr-${event}-${n}`, status, checkin_count: n === 1 ? 2 : 0, issued_by: null, created_at: '2099-01-01T00:00:00Z',
});
const EVENT_NAMES: Record<string, string> = { [EVENT_A]: 'Alpha Congress', [EVENT_B]: 'Beta Summit' };

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  registerFails?: boolean;
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
      attendee(EVENT_A, 1, 'Alice Rahimi', 'alice@example.test'),
      attendee(EVENT_A, 2, 'Alicia Moradi', 'alicia@example.test'),
      attendee(EVENT_A, 3, 'Bob Karimi', 'bob@example.test', 'revoked'),
    ],
    [EVENT_B]: [attendee(EVENT_B, 1, 'Alice Foreign', 'alice-foreign@example.test')],
  };
  const issuedTokens: string[] = [];
  let validToken = '';
  let revokedGeneration = 0;
  let loginCount = 0;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const auth = request.headers().authorization;
    const raw = request.postData();
    requests.push({ method, path, auth, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    const pub = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pub) {
      if (pub[1] === 'alpha') return json(200, { id: EVENT_A, name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-01-01T00:00:00Z', ends_at: '2099-01-02T00:00:00Z', location: 'Hall', description: '', ticket_tiers: [] });
      return json(404, { detail: 'Event not found' });
    }
    const match = path.match(/^\/api\/events\/([^/]+)\/(.*)$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, event, rest] = match;
    if (rest === 'desk/login') {
      if (options.loginStatus) return json(options.loginStatus, { detail: 'denied' });
      const body = JSON.parse(raw ?? '{}') as { email: string; password: string };
      if (event !== EVENT_A) return json(403, { detail: 'Not assigned' });
      if (body.password !== PASSWORD) return json(401, { detail: 'Invalid email or password' });
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
      return json(200, attendees[event].filter(a => !q || `${a.attendee_name} ${a.attendee_email}`.toLowerCase().includes(q)));
    }
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
      const body = JSON.parse(raw ?? '{}') as { full_name: string; email?: string };
      const email = (body.email ?? `walkin-${attendees[event].length}@alpha.local`).toLowerCase();
      if (attendees[event].some(a => a.attendee_email === email)) return json(409, { detail: 'Attendee already has an active ticket for this congress' });
      const created = attendee(event, attendees[event].length + 1, body.full_name, email);
      attendees[event].push(created);
      return json(201, { ticket_id: created.ticket_id, attendee_name: created.attendee_name, attendee_email: email, organization: '', title: '', ticket_tier_name: 'General', qr_secret: created.qr_secret, issued_by: 'Operator One', created_at: created.created_at });
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

async function signIn(page: Page, password = PASSWORD) {
  await page.getByLabel(/Operator Email/).fill('Operator@Example.test');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In to Desk' }).click();
}
const search = (page: Page) => page.getByRole('searchbox');
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
  await expect(page.getByTestId('reception-operator')).toContainText('Operator One');
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
    await expect(page.getByRole('alert')).toContainText('No congress with that code');
    await page.getByLabel(/Congress code/).fill('https://example.test/e/alpha');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(new RegExp(`/reception/${EVENT_A}$`));
    await expect(page.getByRole('heading', { name: 'Front Desk Operator Sign-In' })).toBeVisible();
    expect(fx.requests.every(r => r.path.startsWith('/api/public/') && r.auth === undefined)).toBe(true);

    await page.goto('/reception/e/alpha');
    await expect(page).toHaveURL(new RegExp(`/reception/${EVENT_A}$`));
    await page.goto('/reception/not-a-uuid');
    await expect(page.getByRole('heading', { name: 'This reception link is not valid' })).toBeVisible();
  });

  test('the portal has no Organizer navigation, mode switch or key use even when an organizer key is stored', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page, { organizer: true });
    fx.requests.length = 0;
    await page.goto(`/reception/${EVENT_A}`);
    await expect(page.getByRole('heading', { name: 'Front Desk Operator Sign-In' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Organizer/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Organizer mode/ })).toHaveCount(0);
    expect(fx.requests).toEqual([]);
    await signIn(page);
    await expect(page.getByTestId('reception-operator')).toBeVisible();
    await expect(page.getByRole('link', { name: /Organizer|Event Settings/ })).toHaveCount(0);
    const protectedCalls = fx.requests.filter(r => r.path !== `/api/events/${EVENT_A}/desk/login`);
    expect(protectedCalls.length).toBeGreaterThan(0);
    expect(protectedCalls.every(r => r.auth === `Bearer ${fx.issuedTokens[0]}`)).toBe(true);
    expect(fx.requests.find(r => r.path.endsWith('/desk/login'))?.auth).toBeUndefined();
    expect((await stored(page)).organizer).toBe(ORGANIZER_KEY);
  });

  test('operator signs in, sees congress and operator context, and the password is never stored', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page);
    await expect(page.getByTestId('reception-event')).toHaveText('Alpha Congress');
    await expect(page.getByTestId('reception-operator')).toContainText('Operator One');
    expect(fx.requests.find(r => r.path.endsWith('/desk/login'))?.body).toMatchObject({ email: 'operator@example.test' });
    const snapshot = await stored(page);
    expect(snapshot.desk).toBe(fx.issuedTokens[0]);
    expect(snapshot.all).not.toContain(PASSWORD);
    await page.reload();
    await expect(page.getByTestId('reception-operator')).toContainText('Operator One');
  });

  test('wrong password, revoked or unassigned account, and network failure are distinct and store nothing', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page, 'wrong-password');
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    expect((await stored(page)).desk).toBeNull();

    await page.unrouteAll();
    await fixture(page, { loginStatus: 403 });
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText('not assigned to this congress');

    await page.unrouteAll();
    await page.route(/\/desk\/login$/, route => route.abort('failed'));
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText('Could not reach the server');
    expect((await stored(page)).desk).toBeNull();
  });

  test('another event is a separate workspace: the event A session is never sent for event B', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await page.goto(`/reception/${EVENT_A}`);
    await signIn(page);
    await expect(page.getByTestId('reception-operator')).toBeVisible();
    fx.requests.length = 0;
    await page.goto(`/reception/${EVENT_B}`);
    await expect(page.getByRole('heading', { name: 'Front Desk Operator Sign-In' })).toBeVisible();
    expect(fx.requests.filter(r => r.path.includes(EVENT_B))).toEqual([]);
    await signIn(page);
    await expect(page.getByRole('alert')).toContainText('not assigned to this congress');
    expect((await stored(page)).desk).toBe(fx.issuedTokens[0]);
  });
});

test.describe('search, review and next attendee', () => {
  test('search shows only this congress, review shows pass and history, print issues nothing, next attendee resets', async ({ page }) => {
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
    await expect(review.getByText('Active & Valid')).toBeVisible();
    await expect(review.getByText('Main Gate')).toBeVisible();
    await expect(review.locator('svg').first()).toBeVisible();
    await expect(review.getByRole('heading', { name: 'Alice Rahimi', level: 2 })).toBeFocused();

    const writesBefore = fx.requests.filter(r => r.method === 'POST').length;
    await review.getByRole('button', { name: /Print Badge Pass/ }).click();
    expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
    expect(fx.requests.filter(r => r.method === 'POST').length).toBe(writesBefore);

    await review.getByRole('button', { name: /Next Attendee/ }).click();
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
    await expect(page.getByRole('alert')).toContainText('not found in this congress');
    await expect(page.getByText('qr-')).toHaveCount(0);
  });

  test('no results offer an explicit walk-in prefilled from the query; failed search says so', async ({ page }) => {
    await fixture(page);
    await seed(page);
    await openSignedIn(page);
    await search(page).fill('Zed Newcomer');
    await expect(page.getByText('No attendee found matching this search.')).toBeVisible();
    await page.getByRole('button', { name: /Register “Zed Newcomer” as walk-in/ }).click();
    await expect(page.getByLabel('Full Name')).toHaveValue('Zed Newcomer');
    await expect(page.getByLabel('Full Name')).toBeFocused();

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

test.describe('walk-in issuance', () => {
  test('a backend-confirmed pass is shown, a double submit sends one request, and next attendee returns to search', async ({ page }) => {
    const fx = await fixture(page, { registerDelayMs: 600 });
    await seed(page);
    await openSignedIn(page);
    await page.getByLabel('Full Name').fill('Walk In Person');
    await page.getByLabel(/Email Address/).fill('walkin@example.test');
    const submit = page.getByRole('button', { name: /Mint & Present Pass/ });
    await submit.dblclick();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Walk In Person');
    await expect(dialog.locator('svg').first()).toBeVisible();
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    await dialog.getByRole('button', { name: /Next Attendee/ }).click();
    await expect(page.getByLabel('Full Name')).toHaveValue('');
    await expect(search(page)).toBeFocused();
    await search(page).fill('walkin@');
    await expect(page.getByRole('button', { name: 'Review Walk In Person' })).toBeVisible();
  });

  test('a duplicate email offers the exact existing pass without selecting it or resubmitting', async ({ page }) => {
    const fx = await fixture(page);
    await seed(page);
    await openSignedIn(page);
    await page.getByLabel('Full Name').fill('Someone Else');
    await page.getByLabel(/Email Address/).fill('ALICE@example.test');
    await page.getByRole('button', { name: /Mint & Present Pass/ }).click();
    await expect(page.getByRole('alert')).toContainText('already has an active ticket');
    const offer = page.getByRole('button', { name: 'Review existing pass: Alice Rahimi' });
    await expect(offer).toBeVisible();
    await expect(page.getByRole('button', { name: /Review existing pass: Alicia/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toHaveCount(0);
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    await offer.click();
    await expect(page.getByRole('region', { name: 'Alice Rahimi' })).toBeVisible();
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
    await expect(page.getByLabel('Full Name')).toHaveValue('Someone Else');
  });

  test('a dropped connection keeps the entry, claims no success, and warns to check before retrying', async ({ page }) => {
    await fixture(page, { registerFails: true });
    await seed(page);
    await openSignedIn(page);
    await page.getByLabel('Full Name').fill('Lost Connection');
    await page.getByRole('button', { name: /Mint & Present Pass/ }).click();
    await expect(page.getByRole('alert')).toContainText('not known whether the pass was issued');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Full Name')).toHaveValue('Lost Connection');
    expect((await stored(page)).desk).not.toBeNull();
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
    await page.getByLabel('Full Name').fill('Unsent Draft');
    const firstToken = fx.issuedTokens[0];

    fx.revokeAll();
    await search(page).fill('alic');
    await expect(page.getByRole('heading', { name: 'Front Desk Operator Sign-In' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('revoked or session expired');
    await expect(page.getByRole('alert')).toContainText('unsent walk-in entry is kept');
    await expect(page.getByText('qr-')).toHaveCount(0);
    await expect(page.getByText('Alice Rahimi')).toHaveCount(0);
    const snapshot = await stored(page);
    expect(snapshot.desk).toBeNull();
    expect(snapshot.organizer).toBe(ORGANIZER_KEY);

    const postsBefore = fx.requests.filter(r => r.path.endsWith('desk-registrations')).length;
    await signIn(page);
    await expect(page.getByTestId('reception-operator')).toBeVisible();
    await expect(page.getByLabel('Full Name')).toHaveValue('Unsent Draft');
    await expect(page.getByRole('status').filter({ hasText: 'nothing is submitted until you press' })).toBeVisible();
    expect(fx.issuedTokens.length).toBe(2);
    expect(fx.issuedTokens[1]).not.toBe(firstToken);
    expect(fx.requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(postsBefore);
    // The old token stays dead; every later request uses the new one.
    const afterLogin = fx.requests.slice(fx.requests.map(r => r.path).lastIndexOf(`/api/events/${EVENT_A}/desk/login`) + 1);
    expect(afterLogin.length).toBeGreaterThan(0);
    expect(afterLogin.every(r => r.auth === `Bearer ${fx.issuedTokens[1]}`)).toBe(true);
  });

  test('sign out removes only this event session and clears the draft and retrieved data', async ({ page }) => {
    await fixture(page);
    await seed(page, { organizer: true });
    await openSignedIn(page);
    await page.getByLabel('Full Name').fill('Draft To Clear');
    await page.getByRole('button', { name: /Sign Out/ }).click();
    await expect(page.getByRole('heading', { name: 'Front Desk Operator Sign-In' })).toBeVisible();
    const snapshot = await stored(page);
    expect(snapshot.desk).toBeNull();
    expect(snapshot.organizer).toBe(ORGANIZER_KEY);
    expect(snapshot.user).toBe(USER_TOKEN);
    await signIn(page);
    await expect(page.getByLabel('Full Name')).toHaveValue('');
  });
});

test.describe('layout and language', () => {
  test('tablet and mobile have no horizontal overflow and keep search first', async ({ page }) => {
    await fixture(page);
    await seed(page);
    for (const [width, height] of [[768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/reception/${EVENT_A}`);
      await expect(page.getByLabel(/Operator Email/)).toBeVisible();
      expect(await overflow(page), `${width}px login`).toBe(0);
      await signIn(page);
      await expect(page.getByTestId('reception-operator')).toBeVisible();
      await search(page).fill('alic');
      await expect(page.getByRole('button', { name: 'Review Alice Rahimi' })).toBeVisible();
      expect(await overflow(page), `${width}px workspace`).toBe(0);
      const searchTop = (await search(page).boundingBox())!.y;
      const walkInTop = (await page.getByLabel('Full Name').boundingBox())!.y;
      if (width < 1024) expect(searchTop).toBeLessThan(walkInTop);
      await page.evaluate(() => sessionStorage.clear());
    }
  });

  test('Persian RTL at 320px is right-to-left, fits and uses Persian labels', async ({ page }) => {
    await fixture(page);
    await seed(page, { locale: 'fa' });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/reception/${EVENT_A}`);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ورود به ایستگاه میز پذیرش' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByLabel(/ایمیل اپراتور/).fill('operator@example.test');
    await page.getByLabel('کلمه عبور').fill(PASSWORD);
    await page.getByRole('button', { name: 'ورود به میز پذیرش' }).click();
    await expect(page.getByTestId('reception-operator')).toBeVisible();
    await search(page).fill('alic');
    await expect(page.getByRole('button', { name: 'بررسی Alice Rahimi' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
});
