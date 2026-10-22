import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Attendee Portal pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// Covers the links attendees actually receive (a confirmation SMS once cut the pass link to ".../my-tic…")
// and the header session control: log in when signed out, log out to this congress's sign-in.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const bearer = `Bearer ${token}`;
const TOKEN_KEY = 'congress_attendee_token';

const event = {
  id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z',
  location: 'Fixture Hall', description: 'About Alpha Congress', ticket_tiers: [], venue: [], sessions: [],
};
const ticket = {
  id: 'ticket-alpha', event_id: 'event-a', event_name: 'Alpha Congress', event_slug: 'alpha', event_location: 'Fixture Hall',
  event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z', ticket_tier_id: 't', ticket_tier_name: 'Pass alpha',
  attendee_name: 'Sara Fixture', attendee_mobile: '09121234567', status: 'active', qr_secret: 'qr-alpha', created_at: '2027-01-01T00:00:00Z',
};
const user = { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false };

async function fixture(page: Page) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/events/alpha') return json(200, event);
    if (/^\/api\/public\/events\/[^/]+$/.test(path)) return json(404, { detail: 'Event not found' });
    if (/^\/api\/public\/events\/[^/]+\/booths$/.test(path)) return json(200, []);
    if (request.headers().authorization !== bearer) return json(401, { detail: 'Invalid authorization token' });
    if (path === '/api/auth/me') return json(200, user);
    if (path === '/api/attendees/me/tickets') return json(200, [ticket]);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    return json(404, { detail: 'Not found' });
  });
}

async function seed(page: Page, entries: Record<string, string>) {
  await page.goto('/');
  await page.evaluate(values => { for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v); }, entries);
}
const signedIn = (page: Page) => seed(page, { [TOKEN_KEY]: token, congress_attendee_locale: 'en' });
const anonymous = (page: Page) => seed(page, { congress_attendee_locale: 'en' });

const header = (page: Page) => page.locator('header');
const logoutButton = (page: Page) => header(page).getByRole('button', { name: 'Log Out' });
const loginLink = (page: Page) => header(page).getByRole('link', { name: 'Log In' });

test.describe('links attendees receive', () => {
  test('a pass link cut short by an SMS opens the pass', async ({ page }) => {
    await fixture(page);
    await signedIn(page);
    for (const cut of ['/c/alpha/my-tic', '/c/alpha/my-tic%E2%80%A6', '/c/alpha/my-t...']) {
      await page.goto(cut);
      await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
      await expect(page.getByText('Pass alpha').first()).toBeVisible();
    }
  });

  test('another unknown congress address opens the congress home', async ({ page }) => {
    await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/no-such-page');
    await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  });

  test('an unknown address shows a not-found page that offers back and sign-in, not the platform home', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/no/such/page');
    await expect(page.getByRole('status').getByText('Page not found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Attendee sign-in' })).toHaveAttribute('href', '/sign-in');
    await expect(page.locator('a[href="/"]')).toHaveCount(0);
  });

  test('the not-found page follows the Persian locale and reads right to left', async ({ page }) => {
    await fixture(page);
    await seed(page, { congress_attendee_locale: 'fa' });
    await page.goto('/no-such-page');
    await expect(page.locator('[dir="rtl"][lang="fa"]').getByText('صفحه پیدا نشد')).toBeVisible();
  });
});

test.describe('attendee header session control', () => {
  test('signed out, the header offers log in to this congress and no log out', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/details');
    await expect(loginLink(page)).toHaveAttribute('href', '/c/alpha/sign-in?next=%2Fc%2Falpha%2Fdetails');
    await expect(logoutButton(page)).toHaveCount(0);
  });

  test('a sign-in or sign-out in another tab updates the header', async ({ page, context }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/details');
    await expect(loginLink(page)).toBeVisible();

    const other = await context.newPage();
    await other.goto('/');
    await other.evaluate(([key, value]) => localStorage.setItem(key, value), [TOKEN_KEY, token]);
    await expect(logoutButton(page)).toBeVisible();
    await expect(loginLink(page)).toHaveCount(0);

    await other.evaluate(key => localStorage.removeItem(key), TOKEN_KEY);
    await expect(loginLink(page)).toBeVisible();
  });

  test('log out clears the session and lands on this congress sign-in, not the platform home', async ({ page }) => {
    await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-ticket');
    await expect(page.getByText('Pass alpha').first()).toBeVisible();
    await logoutButton(page).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in$/);
    expect(await page.evaluate(key => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  });

  test('the footer keeps the attribution but no longer links to the platform home', async ({ page }) => {
    await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-congress');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href="/"]')).toHaveCount(0);
    await expect(footer.getByText('Platform Home')).toHaveCount(0);
    await expect(footer.getByRole('link').first()).toBeVisible();
  });
});
