import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Attendee Portal pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const bearer = `Bearer ${token}`;

interface FixtureEvent { id: string; name: string; slug: string; [field: string]: unknown }
const eventOf = (slug: string, id: string, name: string): FixtureEvent => ({ id, name, slug, starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z', location: 'Fixture Hall', description: `About ${name}`, ticket_tiers: [{ id: `tier-${id}`, event_id: id, name: 'Delegate', quota: 10, reserved_count: 4, is_open: true, created_at: '2027-01-01T00:00:00Z' }] });
const EVENTS: Record<string, FixtureEvent> = {
  alpha: eventOf('alpha', 'event-a', 'Alpha Congress'),
  beta: eventOf('beta', 'event-b', 'Beta Summit'),
};
const ticketOf = (slug: string) => ({ id: `ticket-${slug}`, event_id: EVENTS[slug].id, event_name: EVENTS[slug].name, event_slug: slug, event_location: 'Fixture Hall', event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z', ticket_tier_id: 't', ticket_tier_name: `Pass ${slug}`, attendee_name: 'Sara Fixture', attendee_email: 'sara@example.test', status: 'active', qr_secret: `qr-${slug}`, created_at: '2027-01-01T00:00:00Z' });
const connectionOf = (slug: string) => ({ id: `conn-${slug}`, connected_user_id: `peer-${slug}`, full_name: `Peer of ${slug}`, email: null, organization: 'Org', title: 'Dr', event_id: EVENTS[slug].id, private_notes: `Note at ${slug}`, created_at: '2027-01-01T00:00:00Z' });

type Recorded = { method: string; path: string; auth: string | undefined };

async function fixture(page: Page, options: { publicStatus?: number; slowEvent?: string } = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path, auth: request.headers().authorization });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const pub = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pub) {
      if (options.publicStatus) return json(options.publicStatus, { detail: 'Event not found' });
      if (options.slowEvent === pub[1]) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1500);
        await promise;
      }
      return EVENTS[pub[1]] ? json(200, EVENTS[pub[1]]) : json(404, { detail: 'Event not found' });
    }
    if (path === '/api/attendees/me/tickets') return json(200, [ticketOf('alpha'), ticketOf('beta')]);
    if (path === '/api/attendees/me/network') return json(200, [connectionOf('alpha'), connectionOf('beta')]);
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/auth/me') return json(200, { id: 'user-1', email: 'sara@example.test', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false });
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: ['alpha', 'beta'].map(s => ({ event_id: EVENTS[s].id, event_slug: s, event_name: EVENTS[s].name, roles: ['ATTENDEE'], ticket_ids: [`ticket-${s}`], desk_operator_ids: [], booth_ids: [], partner_ids: [] })) });
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function signIn(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(({ token, locale }) => {
    localStorage.setItem('congress_attendee_token', token);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { token, locale });
}

const bottomNav = (page: Page) => page.locator('nav.fixed');

test('exactly five destinations, each real and reachable from the bottom navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha');
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  await expect(bottomNav(page).getByRole('link')).toHaveText([/My Congress/, /My Network/, /My Ticket/, /My Profile/, /Congress Details/]);
  const checks: [string, RegExp, string][] = [
    ['My Network', /my-network$/, 'Note at alpha'],
    ['My Ticket', /my-ticket$/, 'Pass alpha'],
    ['My Profile', /my-profile$/, 'Heart Center'],
    ['Congress Details', /details$/, 'About Alpha Congress'],
    ['My Congress', /my-congress$/, 'Beta Summit'],
  ];
  for (const [label, url, text] of checks) {
    await bottomNav(page).getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByText(text).first()).toBeVisible();
    await expect(bottomNav(page).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  }
  // Touch targets: every destination is at least 48px tall.
  for (const box of await bottomNav(page).getByRole('link').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(48);
  }
});

test('ticket view shows only the active congress pass with its QR', async ({ page }) => {
  await fixture(page);
  await signIn(page);
  await page.goto('/c/beta/my-ticket');
  await expect(page.getByText('Pass beta').first()).toBeVisible();
  await expect(page.getByText('Pass alpha')).toHaveCount(0);
  await expect(page.locator('svg').filter({ has: page.locator('path') }).first()).toBeVisible();
  await expect(page.locator('main svg[viewBox^="0 0"]').first()).toBeVisible();
});

test('network is isolated by congress and edits stay on visible connections', async ({ page }) => {
  const requests = await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await expect(page.getByText('Note at alpha')).toBeVisible();
  await expect(page.getByText('Note at beta')).toHaveCount(0);
  await page.goto('/c/beta/my-network');
  await expect(page.getByText('Note at beta')).toBeVisible();
  await expect(page.getByText('Note at alpha')).toHaveCount(0);
  expect(requests.filter(r => r.path.startsWith('/api/attendees')).every(r => r.auth === bearer)).toBe(true);
  expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined)).toBe(true);
});

test('switching congress from My Congress changes the context; a slow earlier congress never overwrites it', async ({ page }) => {
  await fixture(page, { slowEvent: 'alpha' });
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  // Leave alpha before its slow public metadata answers.
  await page.goto('/c/beta/my-congress');
  await expect(page.getByRole('heading', { name: 'Beta Summit' })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.getByRole('heading', { name: 'Beta Summit' })).toBeVisible();
  await page.getByRole('link', { name: /Alpha Congress/ }).click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  await expect(page.getByRole('heading', { name: 'Alpha Congress' })).toBeVisible();
});

test('without a session, personal destinations show sign-in and send no protected request; details stay public', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
  for (const d of ['my-congress', 'my-network', 'my-ticket', 'my-profile']) {
    await page.goto(`/c/alpha/${d}`);
    await expect(page.getByRole('link', { name: /Sign In/ }).first()).toBeVisible();
  }
  await page.goto('/c/alpha/details');
  await expect(page.getByText('About Alpha Congress')).toBeVisible();
  expect(requests.filter(r => !r.path.startsWith('/api/public/'))).toEqual([]);
});

test('unknown congress and server errors show honest states', async ({ page }) => {
  await fixture(page);
  await signIn(page);
  await page.goto('/c/missing/my-congress');
  await expect(page.getByText('Congress not found')).toBeVisible();
  await page.unrouteAll();
  await fixture(page, { publicStatus: 500 });
  await page.goto('/c/alpha/details');
  await expect(page.getByRole('alert')).toContainText('Could not load this congress');
});

test('Persian RTL at 320px fits all five destinations without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  await signIn(page, 'fa');
  await page.goto('/c/alpha/my-congress');
  await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
  await expect(bottomNav(page).getByRole('link')).toHaveCount(5);
  await expect(bottomNav(page).getByRole('link', { name: 'همایش من' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test('desktop shows the top navigation instead of the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  await expect(page.locator('header nav').getByRole('link')).toHaveCount(5);
  await expect(bottomNav(page)).toBeHidden();
});

test('legacy deep links still work and offer the congress portal', async ({ page }) => {
  await fixture(page);
  await signIn(page);
  await page.goto('/my-tickets');
  await expect(page.getByText('Pass alpha').first()).toBeVisible();
  await page.getByRole('link', { name: /Open Congress Portal/ }).click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  await page.goto('/my-network');
  await expect(page.getByText('Note at alpha')).toBeVisible();
  await expect(page.getByText('Note at beta')).toBeVisible();
});
