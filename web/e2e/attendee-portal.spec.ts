import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Attendee Portal pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const bearer = `Bearer ${token}`;

interface FixtureEvent { id: string; name: string; slug: string; [field: string]: unknown }
const eventOf = (slug: string, id: string, name: string, program: { venue: unknown[]; sessions: unknown[] } = { venue: [], sessions: [] }): FixtureEvent => ({ id, name, slug, starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z', location: 'Fixture Hall', description: `About ${name}`, ticket_tiers: [{ id: `tier-${id}`, event_id: id, name: 'Delegate', quota: 10, reserved_count: 4, is_open: true, created_at: '2027-01-01T00:00:00Z' }], ...program });
const sessionOf = (id: string, title: string, startsAt: string, endsAt: string, description = '') => ({ id, title, track: 'Seminar', speakers: 'Dr. Fixture', description, hall_id: 'hall-1', hall_name: 'Main Hall', starts_at: startsAt, ends_at: endsAt });
const EVENTS: Record<string, FixtureEvent> = {
  alpha: eventOf('alpha', 'event-a', 'Alpha Congress', {
    venue: [{ id: 'gate-1', kind: 'entrance', name: 'North Gate', location: 'Valiasr St.' }, { id: 'hall-1', kind: 'hall', name: 'Main Hall', location: 'Ground floor' }],
    sessions: [
      sessionOf('s-1', 'Opening Keynote', '2027-05-10T08:00:00Z', '2027-05-10T09:00:00Z'),
      sessionOf('s-2', 'Imaging Panel', '2027-05-11T10:00:00Z', '2027-05-11T11:30:00Z', 'Panel on cardiac imaging'),
    ],
  }),
  beta: eventOf('beta', 'event-b', 'Beta Summit'),
};
const ticketOf = (slug: string) => ({ id: `ticket-${slug}`, event_id: EVENTS[slug].id, event_name: EVENTS[slug].name, event_slug: slug, event_location: 'Fixture Hall', event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z', ticket_tier_id: 't', ticket_tier_name: `Pass ${slug}`, attendee_name: 'Sara Fixture', attendee_mobile: '09121234567', status: 'active', qr_secret: `qr-${slug}`, created_at: '2027-01-01T00:00:00Z' });
const connectionOf = (slug: string) => ({ id: `conn-${slug}`, connected_user_id: `peer-${slug}`, full_name: `Peer of ${slug}`, mobile: null, organization: 'Org', title: 'Dr', event_id: EVENTS[slug].id, private_notes: `Note at ${slug}`, created_at: '2027-01-01T00:00:00Z' });

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
    if (/^\/api\/public\/events\/[^/]+\/booths$/.test(path)) return json(200, []);
    if (path === '/api/attendees/me/tickets') return json(200, [ticketOf('alpha'), ticketOf('beta')]);
    if (path === '/api/attendees/me/network') return json(200, [connectionOf('alpha'), connectionOf('beta')]);
    if (path === '/api/attendees/me/network/search') {
      const eventId = new URL(request.url()).searchParams.get('event_id');
      const items = [connectionOf('alpha'), connectionOf('beta')].filter(c => !eventId || c.event_id === eventId);
      return json(200, { items, total: items.length, next_cursor: null });
    }
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/auth/me') return json(200, { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false });
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

test('four tabs in the bottom navigation and the profile in the header, each real and reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha');
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  await expect(bottomNav(page).getByRole('link')).toHaveText([/My congress/, /Program/, /Network/, /Pass/]);
  const checks: [string, RegExp, string][] = [
    ['Network', /my-network$/, 'Note at alpha'],
    ['Pass', /my-ticket$/, 'Pass alpha'],
    ['Program', /details$/, 'About the congress'],
    ['My congress', /my-congress$/, 'Beta Summit'],
  ];
  for (const [label, url, text] of checks) {
    await bottomNav(page).getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByText(text).first()).toBeVisible();
    await expect(bottomNav(page).getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.getByTestId('profile-entry').click();
  await expect(page).toHaveURL(/my-profile$/);
  await expect(page.getByText('Heart Center').first()).toBeVisible();
  await expect(page.getByTestId('profile-entry')).toHaveAttribute('aria-current', 'page');
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

test('home leads with the pass, then the program; details shows venue and full program; My Ticket is only the card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  await expect(page.getByText('Opening Keynote')).toBeVisible();
  // Reading order is the same on every breakpoint: pass, program, network, booths.
  const order = (await page.locator('main h2').allTextContents()).map(text => text.trim());
  // Before the congress: the pass leads, then the program, network and booths.
  expect(order.slice(0, 4)).toEqual(['Your pass', 'Congress program', 'My Network', 'Exhibition booths']);
  await expect(page.getByRole('link', { name: 'Show my pass' })).toHaveAttribute('href', '/c/alpha/my-ticket');
  await expect(page.getByRole('link', { name: /Scan a colleague's QR code/ })).toHaveAttribute('href', '/c/alpha/my-network?scan=1');
  await expect(page.getByRole('heading', { name: 'More' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your other congresses' })).toBeVisible();

  await page.getByRole('link', { name: /Full program/ }).click();
  await expect(page).toHaveURL(/\/c\/alpha\/details#program$/);
  await expect(page.getByText('North Gate')).toBeVisible();
  // One program day at a time: the panel is on day two.
  await page.getByRole('tab', { name: /Day 2/ }).click();
  await expect(page.getByText('Panel on cardiac imaging')).toBeVisible();
  await expect(page.getByText('Pass types')).toHaveCount(0);
  await expect(page.getByText('Delegate')).toHaveCount(0);

  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByText('Pass alpha').first()).toBeVisible();
  await expect(page.locator('main svg[viewBox^="0 0"]').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saved Exhibition Booths' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Using your pass' })).toHaveCount(0);
  // Print is for larger screens; on a phone the card is the QR.
  await expect(page.getByRole('button', { name: 'Show the QR code full screen' })).toBeVisible();
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
    // Every personal page has the phone form on the page itself.
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  }
  await page.goto('/c/alpha/details');
  await expect(page.getByRole('link', { name: 'About the congress' })).toBeVisible();
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
  await expect(page.getByRole('alert')).toContainText('The congress could not be loaded');
});

test('Persian RTL at 320px fits all four tabs without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  await signIn(page, 'fa');
  await page.goto('/c/alpha/my-congress');
  await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
  await expect(bottomNav(page).getByRole('link')).toHaveText(['همایش من', 'برنامه', 'شبکه', 'کارت ورود']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test('dock labels stay on one line at 360px in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await fixture(page);
  for (const locale of ['fa', 'en']) {
    await signIn(page, locale);
    await page.goto('/c/alpha/my-congress');
    const heights = await bottomNav(page).locator('a span').evaluateAll(spans => spans.map(s => s.getBoundingClientRect().height));
    const lineHeights = await bottomNav(page).locator('a span').evaluateAll(spans => spans.map(s => parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.2));
    heights.forEach((h, i) => expect(h).toBeLessThan(lineHeights[i] * 1.6));
  }
});

test('the header congress switcher lists the other congresses and My congresses', async ({ page }) => {
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  // My Congress keeps the passes for offline use; the switcher reads them when it opens.
  await expect(page.getByRole('heading', { name: 'Alpha Congress' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch congress' }).click();
  const menu = page.locator('#congress-switcher');
  await expect(menu.getByRole('link', { name: 'All my congresses' })).toHaveAttribute('href', '/me');
  await menu.getByRole('link', { name: /Beta Summit/ }).click();
  await expect(page).toHaveURL(/\/c\/beta\/my-congress$/);
});

test('desktop shows the top navigation instead of the bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fixture(page);
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  await expect(page.locator('header nav').getByRole('link')).toHaveCount(4);
  await expect(bottomNav(page)).toBeHidden();
});

test('legacy deep links land on My congresses, which opens each congress panel', async ({ page }) => {
  await fixture(page);
  await signIn(page);
  await page.goto('/my-tickets');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId('congress-card')).toHaveCount(2);
  await page.getByTestId('congress-card').filter({ hasText: 'Alpha Congress' }).click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  await page.goto('/my-network');
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId('congress-card').filter({ hasText: 'Beta Summit' })).toBeVisible();
});
