import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Shipping public pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-p', type: 'user', exp: 4102444800 })}.synthetic-signature`;
const slug = 'pub-fixture';
const session = (id: string, title: string, track: string, hall: string, start: string, end: string) => ({
  id, title, track, speakers: 'Dr. Fixture Speaker', description: '', hall_id: hall, hall_name: hall === 'hall-a' ? 'Main Hall' : 'Workshop Room', starts_at: start, ends_at: end,
});
const event = {
  id: 'event-pub', name: 'Public Fixture Congress', slug, starts_at: '2027-05-10T06:00:00Z', ends_at: '2027-05-11T14:00:00Z',
  location: 'Fixture Convention Centre, Tehran', description: 'Synthetic public congress',
  ticket_tiers: [{ id: 'tier-pub', event_id: 'event-pub', name: 'General', quota: 100, reserved_count: 10, is_open: true, created_at: '2027-01-01T00:00:00Z' }],
  venue: [
    { id: 'gate-n', kind: 'entrance', name: 'North Gate', location: 'Valiasr Street, main door' },
    { id: 'hall-a', kind: 'hall', name: 'Main Hall', location: 'Ground floor' },
    { id: 'hall-b', kind: 'hall', name: 'Workshop Room', location: 'First floor' },
  ],
  sessions: [
    session('s1', 'Opening keynote on fixture science', 'Keynote', 'hall-a', '2027-05-10T06:00:00Z', '2027-05-10T07:00:00Z'),
    session('s2', 'Hands-on fixture workshop', 'Workshop', 'hall-b', '2027-05-10T08:00:00Z', '2027-05-10T10:00:00Z'),
    session('s3', 'Closing panel', 'Panel', 'hall-a', '2027-05-11T12:00:00Z', '2027-05-11T13:00:00Z'),
  ],
};
// A long, unbreakable stand location must not widen a phone screen.
const booths = [
  { id: 'booth-1', name: 'Fixture Instruments International Corporation', slug: 'fixture-instruments', location: 'Exhibition Hall B, Second Floor, Stand Number 1204 near the north escalators', description: 'Imaging and diagnostics', website_url: '', brochure_url: '' },
  { id: 'booth-2', name: 'Short Co', slug: 'short-co', location: 'A1', description: '', website_url: '', brochure_url: '' },
];
const heldTicket = { id: 'ticket-held', event_id: 'event-pub', event_name: event.name, event_slug: slug, event_location: event.location, event_starts_at: event.starts_at, event_ends_at: event.ends_at, ticket_tier_id: 'tier-pub', ticket_tier_name: 'General', attendee_name: 'Fixture Attendee', attendee_mobile: '09121234567', status: 'ACTIVE', qr_secret: 'synthetic-held-qr', created_at: '2027-01-01T00:00:00Z' };

async function fixture(page: Page, options: { tickets?: unknown[]; signedIn?: boolean; reserve?: 201 | 409 } = {}) {
  const requests: string[] = [];
  await page.addInitScript(({ signedIn, token }) => {
    localStorage.setItem('congress_attendee_locale', 'en');
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
  }, { signedIn: options.signedIn ?? false, token });
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/api/public/events/${slug}`) return json(200, event);
    if (path === `/api/public/events/${slug}/booths`) return json(200, booths);
    if (path.startsWith('/api/public/events/')) return json(404, { detail: 'Event not found', code: 'EVENT_NOT_FOUND' });
    if (path === '/api/attendees/me/tickets') return json(200, options.tickets ?? []);
    if (path.endsWith('/tickets/reserve')) {
      return options.reserve === 409
        ? json(409, { detail: 'You already hold a ticket for this event', code: 'ALREADY_REGISTERED' })
        : json(201, { id: 'ticket-new', event_id: 'event-pub', ticket_tier_id: 'tier-pub', ticket_tier_name: 'General', attendee_name: 'x', attendee_mobile: '09121234567', status: 'ACTIVE', qr_secret: 'synthetic-new-qr', created_at: '2027-01-01T00:00:00Z' });
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

const dockLink = (page: Page) => page.locator('#passes').getByRole('link', { name: 'Show my pass', exact: true });
const heroCta = (page: Page) => page.getByTestId('hero-cta');

test('program and venue are shown publicly, one day at a time, with map links', async ({ page }) => {
  await fixture(page);
  await page.goto(`/e/${slug}`);
  const program = page.locator('#program');
  await expect(program.getByRole('heading', { name: 'Program', level: 2 })).toBeVisible();
  const days = program.getByRole('group', { name: 'Program days' });
  await expect(days.getByRole('button')).toHaveCount(2);
  await expect(program.getByText('Opening keynote on fixture science')).toBeVisible();
  await expect(program.getByText('Closing panel')).toHaveCount(0);
  await days.getByRole('button', { name: /Day 2/ }).click();
  await expect(program.getByText('Closing panel')).toBeVisible();
  await expect(program.getByText('Opening keynote on fixture science')).toHaveCount(0);
  // Track filter, then the hall link jumps to its venue card.
  await days.getByRole('button', { name: /Day 1/ }).click();
  await program.getByRole('group', { name: 'Tracks' }).getByRole('button', { name: 'Workshop' }).click();
  await expect(program.getByText('Hands-on fixture workshop')).toBeVisible();
  await expect(program.getByText('Opening keynote on fixture science')).toHaveCount(0);
  await expect(program.getByRole('link', { name: 'Workshop Room' })).toHaveAttribute('href', '#venue-hall-b');

  const venue = page.locator('#venue');
  await expect(venue.getByRole('heading', { name: 'Venue', level: 2 })).toBeVisible();
  await expect(venue.getByText('North Gate')).toBeVisible();
  await expect(venue.getByText('Valiasr Street, main door')).toBeVisible();
  await expect(venue.locator('#venue-hall-a')).toContainText('2 sessions');
  const q = encodeURIComponent(event.location);
  await expect(venue.getByRole('link', { name: /Neshan/ })).toHaveAttribute('href', `https://neshan.org/maps/search/${q}`);
  await expect(venue.getByRole('link', { name: /Balad/ })).toHaveAttribute('href', `https://balad.ir/search?query=${q}`);
  await expect(venue.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', `https://www.google.com/maps/search/?api=1&query=${q}`);
  // Both sit before the passes.
  const order = await page.evaluate(() => ['program', 'venue', 'passes'].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1));
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
});

test('actions row adds to calendar, copies the link when Web Share is missing, and opens directions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }));
  await fixture(page);
  await page.goto(`/e/${slug}`);
  const actions = page.getByRole('group', { name: 'Congress actions' });

  const download = page.waitForEvent('download');
  await actions.getByRole('button', { name: 'Add to calendar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${slug}.ics`);
  const ics = (await readFile(await file.path())).toString('utf8').replace(/\r\n /g, '');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics).toContain('DTSTART:20270510T060000Z');
  expect(ics).toContain('DTEND:20270511T140000Z');
  expect(ics).toContain('SUMMARY:Public Fixture Congress');
  expect(ics).toContain(`/e/${slug}`);

  await actions.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/e/${slug}$`));

  await actions.getByRole('button', { name: 'Directions' }).click();
  await expect(actions.getByRole('link', { name: /Neshan/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(actions.getByRole('link', { name: /Neshan/ })).toHaveCount(0);
});

test('a held pass: the hero opens it, the passes block is only the dock, and "pass ready" is said once', async ({ page }) => {
  const requests = await fixture(page, { signedIn: true, tickets: [heldTicket] });
  await page.goto(`/e/${slug}`);
  await expect(heroCta(page)).toHaveAttribute('href', `/c/${slug}/my-ticket`);
  await expect(heroCta(page)).toHaveText('My pass');
  await expect(dockLink(page)).toHaveAttribute('href', `/c/${slug}/my-ticket`);
  await expect(page.locator('#passes fieldset')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reserve free pass/ })).toHaveCount(0);
  await expect(page.getByText('Your pass is ready')).toHaveCount(1);
  // The header is session-aware too.
  await expect(page.getByRole('banner').getByRole('link', { name: 'My pass' })).toHaveAttribute('href', `/c/${slug}/my-ticket`);
  await dockLink(page).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/my-ticket$`));
  expect(requests).toContain('GET /api/attendees/me/tickets');
});

test('one open pass type, signed in: one tap on the hero reserves; the success sheet has two buttons and ✕', async ({ page }) => {
  await fixture(page, { signedIn: true, tickets: [{ ...heldTicket, event_slug: 'other-congress' }] });
  await page.goto(`/e/${slug}`);
  await heroCta(page).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Your pass is ready' })).toBeVisible();
  await expect(sheet.getByRole('img', { name: 'QR code of your pass' })).toBeVisible();
  await expect(sheet).toContainText('We also texted you the link.');
  // Exactly two actions besides the ✕.
  await expect(sheet.getByRole('button')).toHaveCount(3);
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Show my pass' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add to calendar' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(dockLink(page)).toHaveAttribute('href', `/c/${slug}/my-ticket`);
  await expect(heroCta(page)).toHaveAttribute('href', `/c/${slug}/my-ticket`);
});

test('one open pass type, signed out: one tap on the hero opens the reservation dialog, with no description', async ({ page }) => {
  await fixture(page);
  await page.goto(`/e/${slug}`);
  await heroCta(page).click();
  const dialog = page.getByRole('dialog', { name: 'Get your General pass' });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('aria-describedby');
  await expect(dialog.getByTestId('otp-mobile-step')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send code' })).toBeVisible();
});

test('several open pass types: the hero scrolls to the passes', async ({ page }) => {
  await fixture(page);
  await page.route(`**/api/public/events/${slug}`, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...event, ticket_tiers: [...event.ticket_tiers, { ...event.ticket_tiers[0], id: 'tier-2', name: 'Student' }] }) }));
  await page.goto(`/e/${slug}`);
  await expect(heroCta(page)).toHaveAttribute('href', '#passes');
});

test('a duplicate reservation (409) shows the held pass instead of an error', async ({ page }) => {
  await fixture(page, { signedIn: true, reserve: 409 });
  await page.goto(`/e/${slug}`);
  await page.getByRole('button', { name: /Reserve free pass/ }).click();
  await expect(dockLink(page)).toHaveAttribute('href', `/c/${slug}/my-ticket`);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('signed out, the header offers sign-in and no menu; no staff or platform links on the congress page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto(`/e/${slug}`);
  await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
  for (const href of ['/organizer', '/reception', '/platform', '/']) {
    await expect(page.locator(`a[href="${href}"]`)).toHaveCount(0);
  }
  await expect(page.locator('a[href^="/#"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Attendee sign in' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /navigation menu/ })).toHaveCount(0);
  await expect(page.locator('#mobile-nav')).toHaveCount(0);
  // The footer keeps the congress, one line and the pass link: no platform blurb.
  await expect(page.locator('footer')).not.toContainText('Registration opens from each congress');
  await expect(page.locator('footer')).not.toContainText('listed congresses also appear');
});

test('the booth index stacks on a 390 px phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto(`/e/${slug}`);
  const row = page.locator('#exhibition li').first();
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText('Stand Number 1204');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // The stand sits above the exhibitor name on phones.
  const stand = row.getByText(/Exhibition Hall B/);
  const name = row.getByText('Fixture Instruments International Corporation');
  expect((await stand.boundingBox())!.y).toBeLessThan((await name.boundingBox())!.y);
});

test('an unknown congress offers "find my pass" instead of the platform home', async ({ page }) => {
  await fixture(page);
  await page.goto('/e/no-such-congress');
  await expect(page.getByRole('heading', { name: 'Congress not found' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Find my pass' })).toHaveAttribute('href', '/sign-in');
  await expect(page.getByRole('link', { name: 'Return to Platform Home' })).toHaveCount(0);
});

test('the platform home has the attendee entry above the fold and no route patterns', async ({ page }) => {
  await fixture(page);
  await page.goto('/');
  const entry = page.getByTestId('home-passes');
  await expect(entry).toHaveText('Find your pass');
  await expect(entry).toHaveAttribute('href', '/me');
  expect((await entry.boundingBox())!.y).toBeLessThan(915);
  await expect(page.locator('body')).not.toContainText(/\/(e|c)\/:|:slug|:pointId|:id\b/);
});

test('the platform home names the stored passes «کارت‌های ورود من» and has no feature essays', async ({ page }) => {
  await fixture(page, { signedIn: true });
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await page.goto('/');
  await expect(page.getByTestId('home-passes')).toHaveText('کارت‌های ورود من');
  await expect(page.getByTestId('home-passes')).toHaveAttribute('href', '/me');
  for (const id of ['capabilities', 'roles', 'architecture']) await expect(page.locator(`#${id}, a[href="#${id}"]`)).toHaveCount(0);
});
