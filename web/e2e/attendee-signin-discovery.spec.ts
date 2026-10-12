import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in ATTENDEE_COMPLETION_MILESTONE.md.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const bearer = `Bearer ${token}`;
const PASSWORD = 'correct-horse-battery';

interface FixtureEvent { id: string; name: string; slug: string; [field: string]: unknown }
interface FixtureBooth { id: string; name: string; slug: string; location: string; description: string; website_url: string; brochure_url: string }

const event = (slug: string, id: string, name: string): FixtureEvent => ({
  id, name, slug, starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z',
  location: 'Fixture Hall', description: `About ${name}`, ticket_tiers: [],
});
const EVENTS: Record<string, FixtureEvent> = {
  alpha: event('alpha', 'event-a', 'Alpha Congress'),
  beta: event('beta', 'event-b', 'Beta Summit'),
};
const booth = (id: string, name: string): FixtureBooth => ({
  id, name, slug: id, location: `Hall ${name}`, description: `${name} description`,
  website_url: 'https://example.test', brochure_url: '',
});
const BOOTHS: Record<string, FixtureBooth[]> = {
  alpha: [booth('booth-1', 'Zeta Pharma'), booth('booth-2', 'Alpha Devices')],
  beta: [booth('booth-9', 'Beta Only Booth')],
};
const ticket = {
  id: 'ticket-alpha', event_id: 'event-a', event_name: 'Alpha Congress', event_slug: 'alpha',
  event_location: 'Fixture Hall', event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z',
  ticket_tier_id: 't', ticket_tier_name: 'Pass alpha', attendee_name: 'Sara Fixture',
  attendee_email: 'sara@example.test', status: 'active', qr_secret: 'qr-alpha', created_at: '2027-01-01T00:00:00Z',
};
const user = { id: 'user-1', email: 'sara@example.test', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false };

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  loginStatus?: number;
  loginAbort?: boolean;
  bookmarkFails?: boolean;
  privacyFails?: boolean;
  scanStatus?: number;
}

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const saved = new Set<string>();
  let share = false;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    requests.push({ method, path, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/login') {
      if (options.loginAbort) return route.abort('failed');
      if (options.loginStatus && options.loginStatus !== 200) return json(options.loginStatus, { detail: 'Invalid email or password' });
      return json(200, { access_token: token, token_type: 'bearer', user });
    }
    const pubEvent = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pubEvent) return EVENTS[pubEvent[1]] ? json(200, EVENTS[pubEvent[1]]) : json(404, { detail: 'Event not found' });
    const pubBooths = path.match(/^\/api\/public\/events\/([^/]+)\/booths$/);
    if (pubBooths) return BOOTHS[pubBooths[1]] ? json(200, BOOTHS[pubBooths[1]]) : json(404, { detail: 'Event not found' });

    if (request.headers().authorization !== bearer) return json(401, { detail: 'Invalid authorization token' });
    if (path === '/api/auth/me') return json(200, { ...user, share_contact_with_peers: share });
    if (path === '/api/attendees/me/tickets') return json(200, [ticket]);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    if (path === '/api/attendees/me/network/scan') {
      return options.scanStatus === 409
        ? json(409, { detail: 'This badge belongs to a different congress' })
        : json(201, { id: 'c', connected_user_id: 'p', full_name: 'Peer', email: null, organization: '', title: '', event_id: 'event-a', private_notes: '', created_at: '2027-01-01T00:00:00Z' });
    }
    if (path === '/api/attendees/me/network/privacy') {
      if (method === 'PATCH') {
        if (options.privacyFails) return json(500, { detail: 'boom' });
        const update: { share_contact_with_peers: boolean } = JSON.parse(raw ?? '{}');
        share = update.share_contact_with_peers;
      }
      return json(200, { share_contact_with_peers: share });
    }
    if (path === '/api/attendees/me/bookmarks/booths') {
      return json(200, [...saved].map(id => ({ booth_id: id, name: id, slug: id, location: '', description: '', website_url: '', brochure_url: '', event_name: 'Alpha Congress', event_slug: 'alpha', bookmarked_at: '2027-01-01T00:00:00Z' })));
    }
    const bm = path.match(/^\/api\/attendees\/me\/bookmarks\/booths\/([^/]+)$/);
    if (bm) {
      if (options.bookmarkFails) return json(500, { detail: 'boom' });
      if (method === 'POST') saved.add(bm[1]); else saved.delete(bm[1]);
      return json(method === 'POST' ? 201 : 200, { bookmarked: method === 'POST', booth_id: bm[1] });
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, entries: Record<string, string>) {
  await page.goto('/');
  await page.evaluate(values => { for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v); }, entries);
}
const signedIn = (page: Page) => seed(page, { congress_attendee_token: token, congress_attendee_locale: 'en' });
const anonymous = (page: Page) => seed(page, { congress_attendee_locale: 'en' });

async function fillAndSubmit(page: Page, email: string, password: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('direct attendee sign-in', () => {
  test('signed-out portal page leads to sign-in and returns to the same destination', async ({ page }) => {
    const requests = await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/my-profile');
    await page.getByRole('link', { name: /Sign In/ }).first().click();
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in\?next=%2Fc%2Falpha%2Fmy-profile$/);
    await expect(page.getByText('Alpha Congress').first()).toBeVisible();

    await fillAndSubmit(page, 'sara@example.test', PASSWORD);
    await expect(page).toHaveURL(/\/c\/alpha\/my-profile$/);
    await expect(page.getByText('Heart Center')).toBeVisible();

    const login = requests.find(r => r.path === '/api/auth/login');
    expect(login?.auth).toBeUndefined();
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(PASSWORD);
  });

  test('missing fields are reported without a request; wrong credentials and network failure are distinct', async ({ page }) => {
    const requests = await fixture(page, { loginStatus: 401 });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');

    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByLabel('Password').fill('x');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    expect(requests.some(r => r.path === '/api/auth/login')).toBe(false);

    await fillAndSubmit(page, 'sara@example.test', 'wrong-password');
    await expect(page.getByRole('alert')).toContainText('incorrect');
    await expect(page).toHaveURL(/sign-in$/);
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();

    await page.unrouteAll();
    await fixture(page, { loginAbort: true });
    await fillAndSubmit(page, 'sara@example.test', PASSWORD);
    await expect(page.getByRole('alert')).toContainText('Could not reach the server');
  });

  test('external and unknown return destinations are ignored', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    for (const next of ['https://evil.example/', '//evil.example', '/organizer', '/c/alpha/../../organizer']) {
      await page.goto(`/c/alpha/sign-in?next=${encodeURIComponent(next)}`);
      await fillAndSubmit(page, 'sara@example.test', PASSWORD);
      await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
      await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    }
  });

  test('a valid existing session is kept and can continue or be replaced explicitly', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await expect(page.getByTestId('existing-session')).toContainText('sara@example.test');
    await expect(page.getByLabel('Password')).toHaveCount(0);
    expect(requests.find(r => r.path === '/api/auth/me')?.auth).toBe(bearer);
    await page.getByRole('link', { name: /Continue/ }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);

    await page.goto('/c/alpha/sign-in');
    await page.getByRole('button', { name: 'Use a different account' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
  });

  test('a rejected stored session shows the form instead of a false signed-in state', async ({ page }) => {
    await fixture(page);
    await seed(page, { congress_attendee_token: 'stale-token', congress_attendee_locale: 'en' });
    await page.goto('/c/alpha/sign-in');
    await expect(page.getByLabel('Password')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
  });

  test('the event page header offers sign-in straight to that congress', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/e/alpha');
    await page.getByRole('link', { name: 'Attendee Sign In' }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in\?next=/);
  });

  test('Persian RTL sign-in at 320px has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await fixture(page);
    await seed(page, { congress_attendee_locale: 'fa' });
    await page.goto('/c/alpha/sign-in');
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByLabel('نشانی ایمیل')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
});

test.describe('booth directory in My Congress', () => {
  test('anonymous visitors see only this congress booths without credentials', async ({ page }) => {
    const requests = await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/my-congress');
    const directory = page.getByRole('region', { name: /Exhibition booths/ });
    await expect(directory.getByText('Alpha Devices', { exact: true })).toBeVisible();
    await expect(directory.getByText('Zeta Pharma', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta Only Booth')).toHaveCount(0);
    await expect(directory.getByRole('link', { name: /View booth/ }).first()).toHaveAttribute('href', /\/e\/alpha\/booths\/booth-/);
    await expect(directory.getByRole('button')).toHaveCount(0);
    expect(requests.every(r => r.path.startsWith('/api/public/') && r.auth === undefined)).toBe(true);
  });

  test('a signed-in attendee saves and removes a booth with user authority; failures leave state unchanged', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-congress');
    const save = page.getByRole('button', { name: 'Save Alpha Devices' });
    await save.click();
    const saved = page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' });
    await expect(saved).toHaveAttribute('aria-pressed', 'true');
    expect(requests.find(r => r.method === 'POST' && r.path.endsWith('/booth-2'))?.auth).toBe(bearer);
    expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined)).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' }).click();
    await expect(page.getByRole('button', { name: 'Save Alpha Devices' })).toHaveAttribute('aria-pressed', 'false');

    await page.unrouteAll();
    await fixture(page, { bookmarkFails: true });
    await page.reload();
    await page.getByRole('button', { name: 'Save Zeta Pharma' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not update');
    await expect(page.getByRole('button', { name: 'Save Zeta Pharma' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('an empty congress and a failing directory are honest states', async ({ page }) => {
    await fixture(page);
    EVENTS.gamma = event('gamma', 'event-g', 'Gamma Forum');
    BOOTHS.gamma = [];
    await anonymous(page);
    await page.goto('/c/gamma/my-congress');
    await expect(page.getByText('No booths have been listed for this congress yet.')).toBeVisible();
    delete EVENTS.gamma;
    delete BOOTHS.gamma;

    await page.unrouteAll();
    await fixture(page);
    // Registered last, so it takes precedence over the fixture route.
    await page.route(/\/api\/public\/events\/alpha\/booths$/, route => route.fulfill({ status: 500, body: '{}' }));
    await page.goto('/c/alpha/my-congress');
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
  });
});

test.describe('My Profile', () => {
  test('identity is read-only while the contact-sharing switch persists through the API', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-profile');
    await expect(page.getByText('Heart Center')).toBeVisible();
    await expect(page.getByText('Read-only')).toBeVisible();
    await expect(page.locator('main input')).toHaveCount(0);

    const toggle = page.getByRole('switch', { name: /Share email address/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'updated successfully' })).toBeVisible();
    const patch = requests.find(r => r.method === 'PATCH');
    expect(patch?.auth).toBe(bearer);
    expect(patch?.body).toEqual({ share_contact_with_peers: true });

    await page.reload();
    await expect(page.getByRole('switch', { name: /Share email address/ })).toHaveAttribute('aria-checked', 'true');
    expect(requests.some(r => r.method === 'PATCH' && r.path !== '/api/attendees/me/network/privacy')).toBe(false);
  });

  test('a failed update keeps the previous value and says so', async ({ page }) => {
    await fixture(page, { privacyFails: true });
    await signedIn(page);
    await page.goto('/c/alpha/my-profile');
    const toggle = page.getByRole('switch', { name: /Share email address/ });
    await toggle.click();
    await expect(page.getByRole('alert')).toContainText('not saved');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('event-scoped badge scan', () => {
  async function scan(page: Page) {
    await page.goto('/c/alpha/my-network');
    await page.getByRole('button', { name: /connect|scan|add/i }).first().click();
    await page.getByRole('dialog').getByRole('textbox').first().fill('some-peer-secret');
    await page.getByRole('dialog').getByRole('button', { name: /connect|save|add/i }).last().click();
  }

  test('the congress id is sent and an other-congress badge shows an error', async ({ page }) => {
    const requests = await fixture(page, { scanStatus: 409 });
    await signedIn(page);
    await scan(page);
    await expect(page.getByRole('dialog')).toContainText('belongs to another congress and was not saved');
    expect(requests.find(r => r.path === '/api/attendees/me/network/scan')?.body).toMatchObject({ event_id: 'event-a' });
  });
});
