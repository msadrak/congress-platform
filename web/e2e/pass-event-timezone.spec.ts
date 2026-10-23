import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// A pass shows its dates in the congress's own zone (`event_timezone`), not the phone's. Intercepted /api/
// responses: not FastAPI/PostgreSQL E2E. The phone is in Los Angeles; the congress starts at 00:00 on 10 April in
// Tehran (UTC+3:30), which is still 9 April there. Year 2099 keeps the congress ahead of the clock for good.
test.use({ timezoneId: 'America/Los_Angeles' });

const STARTS = '2099-04-09T20:30:00Z';
const ENDS = '2099-04-12T18:00:00Z';
const ISSUED = '2098-12-31T22:00:00Z'; // 1 January 01:30 in Tehran, 31 December 14:00 in Los Angeles
const CODE = 'zone234567';
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;

const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: STARTS, ends_at: ENDS, location: 'Fixture Hall', description: 'About Alpha Congress', ticket_tiers: [], venue: [], sessions: [] };
// A server that sends the zone, and one that does not (a pass saved by an older version of the app).
const withZone = (zone: string | undefined) => (zone ? { event_timezone: zone } : {});
const linkPass = (zone?: string) => ({
  ticket_id: 'ticket-zone-0001', status: 'active', issued_at: ISSUED, qr_secret: 'qr-zone', tier_name: 'Delegate pass',
  expires_at: '2099-06-11T15:00:00Z',
  event: { id: EVENT.id, slug: EVENT.slug, name: EVENT.name, starts_at: STARTS, ends_at: ENDS, location: EVENT.location },
  attendee: { full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist' },
  ...withZone(zone),
});
const ticket = (zone?: string) => ({
  id: 'ticket-zone-0001', event_id: EVENT.id, event_name: EVENT.name, event_slug: EVENT.slug, event_location: EVENT.location,
  event_starts_at: STARTS, event_ends_at: ENDS, ...withZone(zone), ticket_tier_id: 't', ticket_tier_name: 'Delegate',
  attendee_name: 'Sara Fixture', attendee_mobile: null, status: 'active', qr_secret: 'qr-zone', created_at: ISSUED,
});

async function fixture(page: Page, options: { pass?: unknown; tickets?: unknown[] }) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/passes/resolve') return json(200, options.pass);
    if (path === '/api/public/events/alpha') return json(200, EVENT);
    if (path === '/api/public/events/alpha/booths') return json(200, []);
    if (path === '/api/attendees/me/tickets') return json(200, options.tickets ?? []);
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/auth/me') return json(200, { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false });
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    return json(404, { detail: 'Not found' });
  });
}

async function begin(page: Page, locale: 'en' | 'fa', signedIn: boolean) {
  await page.goto('/');
  await page.evaluate(({ token, locale, signedIn }) => {
    localStorage.clear();
    localStorage.setItem('congress_attendee_locale', locale);
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
  }, { token, locale, signedIn });
}

const card = (page: Page) => page.locator('.print-pass');
// "9 – 12 April 2099" (the browser spaces the dash); the card's text runs on from the congress name without a
// separator, so the day is told from the text before it by "not a digit", not by a word boundary.
const range = (from: number, to: number) => new RegExp(`(?<!\\d)${from}\\D+${to} April 2099`);

test('an SMS-link pass shows the congress days of its own zone, not the phone\'s', async ({ page }) => {
  await fixture(page, { pass: linkPass('Asia/Tehran') });
  await begin(page, 'en', false);

  await page.goto(`/t/${CODE}`);

  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  await expect(card(page)).toContainText(range(10, 12));
  await expect(card(page)).not.toContainText(range(9, 12));
  await expect(card(page)).toContainText('Jan 1, 2099');
  await expect(card(page)).not.toContainText('Dec 31, 2098');
});

test('Persian readers get the Solar Hijri days of the congress\'s zone', async ({ page }) => {
  await fixture(page, { pass: linkPass('Asia/Tehran') });
  await begin(page, 'fa', false);

  await page.goto(`/t/${CODE}`);

  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  await expect(card(page)).toContainText(/۲۲\D+۲۴ فروردین ۱۴۷۸/);
  await expect(card(page)).not.toContainText(/۲۱\D+۲۴ فروردین ۱۴۷۸/);
});

test('a pass without a zone (saved by an older version) is read in the phone\'s zone, as before', async ({ page }) => {
  await fixture(page, { pass: linkPass() });
  await begin(page, 'en', false);

  await page.goto(`/t/${CODE}`);

  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  await expect(card(page)).toContainText(range(9, 12));
  await expect(card(page)).toContainText('Dec 31, 2098');
});

test('a signed-in pass uses the zone the server names for its congress', async ({ page }) => {
  // Auckland is neither the phone's zone nor Tehran: 10 to 13 April only if the card follows `event_timezone`.
  await fixture(page, { tickets: [ticket('Pacific/Auckland')] });
  await begin(page, 'en', true);

  await page.goto('/c/alpha/my-ticket');

  await expect(card(page)).toContainText(range(10, 13));
  await expect(card(page)).toContainText('Jan 1, 2099');
});

test('a signed-in pass from a server that sends no zone is read in the phone\'s zone', async ({ page }) => {
  await fixture(page, { tickets: [ticket()] });
  await begin(page, 'en', true);

  await page.goto('/c/alpha/my-ticket');

  await expect(card(page)).toContainText(range(9, 12));
  await expect(card(page)).toContainText('Dec 31, 2098');
});

test('an unknown zone name never breaks the pass', async ({ page }) => {
  await fixture(page, { tickets: [ticket('Mars/Olympus_Mons')] });
  await begin(page, 'en', true);

  await page.goto('/c/alpha/my-ticket');

  await expect(card(page)).toContainText('Sara Fixture');
  await expect(card(page)).toContainText(range(9, 12));
});
