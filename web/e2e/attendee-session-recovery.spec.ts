import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping attendee pages + synthetic, intercepted /api/ responses: the session policy
// (lib/attendeeSession.ts), network failures that end their spinner, and scroll on navigation.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const TOKEN_KEY = 'congress_attendee_token';
const CACHE_KEY = 'congress_cached_tickets_user-1';
const OWNER_KEY = 'congress_ticket_cache_owner';

const event = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z', location: 'Fixture Hall', description: 'About Alpha Congress', ticket_tiers: [], venue: [], sessions: [] };
const ticket = { id: 'ticket-alpha', event_id: 'event-a', event_name: 'Alpha Congress', event_slug: 'alpha', event_location: 'Fixture Hall', event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z', ticket_tier_id: 't', ticket_tier_name: 'Cached Delegate Pass', attendee_name: 'Sara Fixture', attendee_mobile: '09121234567', status: 'active', qr_secret: 'qr-alpha', created_at: '2027-01-01T00:00:00Z' };

/** Public reads succeed; every request that carries the attendee token gets `authorized`. */
async function fixture(page: Page, authorized: 'ok' | 401) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/events/alpha') return json(200, event);
    if (/^\/api\/public\/events\/alpha\/booths$/.test(path)) return json(200, []);
    if (request.headers().authorization && authorized === 401) return json(401, { detail: 'Token expired' });
    if (path === '/api/attendees/me/tickets') return json(200, [ticket]);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/attendees/me/network/search') return json(200, { items: [], total: 0, next_cursor: null });
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/auth/me') return json(200, { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false });
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    return json(404, { detail: 'Not found' });
  });
}

/** Signed in as user-1 with that owner's offline pass cached, as My Tickets leaves it. */
async function signedInWithCachedPass(page: Page) {
  await page.goto('/');
  await page.evaluate(({ token, ticket, TOKEN_KEY, CACHE_KEY, OWNER_KEY }) => {
    localStorage.setItem('congress_attendee_locale', 'en');
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: 'user-1', cachedAt: Date.now(), expiresAt: Date.now() + 86_400_000, tickets: [ticket] }));
    localStorage.setItem(OWNER_KEY, 'user-1');
  }, { token, ticket, TOKEN_KEY, CACHE_KEY, OWNER_KEY });
}

const stored = (page: Page) => page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [TOKEN_KEY, CACHE_KEY, OWNER_KEY]);

test('a 401 on My Congress removes the token and the cached pass, and shows the signed-out state', async ({ page }) => {
  await fixture(page, 401);
  await signedInWithCachedPass(page);
  await page.goto('/c/alpha/my-congress');
  await expect(page.locator('header').getByRole('link', { name: 'Log In' })).toBeVisible();
  await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  expect(await stored(page)).toEqual([null, null, null]);
  // No pass from the removed cache stays on screen.
  await expect(page.getByText('Cached Delegate Pass')).toHaveCount(0);
});

test('My Network: a list that gets no response says so and stops loading', async ({ page }) => {
  await fixture(page, 'ok');
  await page.route('**/api/attendees/me/network/search?*', route => route.abort('internetdisconnected'));
  await signedInWithCachedPass(page);
  await page.goto('/c/alpha/my-network');
  await expect(page.getByRole('alert')).toContainText('Could not reach the server.');
  await expect(page.getByRole('status', { name: 'Contacts' })).toHaveCount(0);
  // A network failure is not a rejected session.
  expect((await stored(page))[0]).toBe(token);
});

test('a new page opens at its top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, 'ok');
  await signedInWithCachedPass(page);
  await page.goto('/c/alpha/details');
  await expect(page.getByRole('link', { name: 'About the congress' })).toBeVisible();
  // Every page is tall enough to scroll (the style outlives client-side navigation).
  await page.evaluate(() => {
    document.body.style.minHeight = '6000px';
    window.scrollTo(0, 2400);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);

  await page.getByTestId('profile-entry').click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-profile$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
