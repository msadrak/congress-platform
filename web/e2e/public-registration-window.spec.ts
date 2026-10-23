import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The public congress page follows the registration window, tier sales windows and the congress's time zone.
// Shipping pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-w', type: 'user', exp: 4102444800 })}.synthetic-signature`;
const slug = 'window-fixture';
/** Fixed page clock: 1 May 2027, 08:00 UTC (11:30 in Tehran). */
const NOW = Date.parse('2027-05-01T08:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const tier = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, event_id: 'event-w', name, description: '', quota: 100, reserved_count: 10, is_open: true, sales_starts_at: null, sales_ends_at: null, ...extra,
});
const baseEvent = {
  id: 'event-w', name: 'Window Fixture Congress', slug,
  // 21:00 UTC is 00:30 the next day in Tehran: the venue's dates are 11–12 May.
  starts_at: '2027-05-10T21:00:00Z', ends_at: '2027-05-12T13:30:00Z',
  location: 'Fixture Hall, Tehran', description: 'Synthetic congress', timezone: 'Asia/Tehran',
  ticket_tiers: [tier('tier-a', 'General')],
  venue: [{ id: 'hall-a', kind: 'hall', name: 'Main Hall', location: 'Ground floor' }],
  sessions: [{ id: 's1', title: 'Midnight opening', track: '', speakers: '', description: '', hall_id: 'hall-a', hall_name: 'Main Hall', starts_at: '2027-05-10T21:00:00Z', ends_at: '2027-05-10T22:00:00Z' }],
  program_files: [],
  registration_enabled: true, registration_opens_at: null, registration_closes_at: null, registration_open: true,
};

async function fixture(page: Page, event: Record<string, unknown>, options: { signedIn?: boolean; reserve?: { status: number; body: unknown } } = {}) {
  const requests: string[] = [];
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ signedIn, token }) => {
    localStorage.setItem('congress_attendee_locale', 'en');
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
  }, { signedIn: options.signedIn ?? false, token });
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push(`${request.method()} ${path}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/api/public/events/${slug}`) return json(200, { ...baseEvent, ...event });
    if (path === `/api/public/events/${slug}/booths`) return json(200, []);
    if (path === '/api/attendees/me/tickets') return json(200, []);
    if (path.endsWith('/tickets/reserve') && options.reserve) return json(options.reserve.status, options.reserve.body);
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

const chip = (page: Page) => page.getByTestId('registration-status');
const reserveButton = (page: Page) => page.locator('#passes').getByRole('button').last();

test.describe('registration window', () => {
  test.use({ timezoneId: 'Asia/Tehran' });

  test('not open yet: the chip, the pass card and the dock say when, and nothing opens a sign-in sheet', async ({ page }) => {
    const requests = await fixture(page, { registration_opens_at: '2027-05-02T05:30:00Z', registration_open: false });
    await page.goto(`/e/${slug}`);
    await expect(chip(page)).toHaveAttribute('data-status', 'opens');
    await expect(chip(page)).toContainText('Registration opens');
    await expect(chip(page)).toContainText('09:00');
    const card = page.locator('[data-availability]').first();
    await expect(card).toHaveAttribute('data-availability', 'opens');
    await expect(card).toContainText('Reservations open');
    await expect(card.getByRole('radio')).toBeDisabled();
    await expect(reserveButton(page)).toBeDisabled();
    await expect(reserveButton(page)).toContainText('Opens');
    await reserveButton(page).click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests.filter((r) => r.includes('/reserve') || r.includes('/auth/'))).toEqual([]);
  });

  test('the dock enables itself when the window opens while the page is open', async ({ page }) => {
    await fixture(page, { registration_opens_at: iso(60_000), registration_open: false });
    await page.goto(`/e/${slug}`);
    await expect(reserveButton(page)).toBeDisabled();
    await page.clock.fastForward('01:30');
    await expect(chip(page)).toHaveAttribute('data-status', 'open');
    await expect(reserveButton(page)).toBeEnabled();
    await reserveButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Confirm your mobile number' })).toBeVisible();
  });

  test('closed by the organizer, closed by its window, or ended: every pass is closed and the dock is disabled', async ({ page }) => {
    await fixture(page, { registration_enabled: false, registration_open: false });
    await page.goto(`/e/${slug}`);
    await expect(chip(page)).toHaveAttribute('data-status', 'closed');
    await expect(chip(page)).toHaveText('Registration Closed');
    await expect(page.locator('#passes')).toContainText('Registration for this congress is closed.');
    await expect(reserveButton(page)).toBeDisabled();
  });

  test('a congress that has ended says so on its passes', async ({ page }) => {
    await fixture(page, { starts_at: iso(-3 * DAY), ends_at: iso(-DAY), registration_open: false });
    await page.goto(`/e/${slug}`);
    await expect(chip(page)).toHaveAttribute('data-status', 'closed');
    await expect(page.locator('#passes')).toContainText('This congress has ended.');
    await expect(reserveButton(page)).toBeDisabled();
  });

  test('tier sales windows: a later tier waits, an ended one is closed, the open one is selected with its closing time', async ({ page }) => {
    await fixture(page, {
      registration_closes_at: '2027-05-08T20:30:00Z',
      ticket_tiers: [
        tier('tier-early', 'Early bird', { sales_ends_at: iso(-HOUR) }),
        tier('tier-late', 'Late', { sales_starts_at: iso(2 * DAY) }),
        tier('tier-general', 'General'),
      ],
    });
    await page.goto(`/e/${slug}`);
    await expect(chip(page)).toHaveAttribute('data-status', 'open');
    const cards = page.locator('[data-availability]');
    await expect(cards.nth(0)).toHaveAttribute('data-availability', 'closed');
    await expect(cards.nth(0)).toContainText('Sales Ended');
    await expect(cards.nth(1)).toHaveAttribute('data-availability', 'opens');
    await expect(cards.nth(1)).toContainText('Not open yet');
    await expect(cards.nth(2).getByRole('radio')).toBeChecked();
    // 20:30 UTC on 8 May is 00:00 on 9 May in Tehran.
    await expect(page.getByTestId('registration-closes')).toContainText('Registration closes Sun 9 May, 00:00');
    await expect(reserveButton(page)).toBeEnabled();
  });

  test('a reservation refused because registration has not opened shows clear copy and reloads availability', async ({ page }) => {
    const requests = await fixture(page, {}, {
      signedIn: true,
      reserve: { status: 409, body: { detail: 'Registration is not open yet; it opens at 2027-05-02T05:30:00+00:00.', code: 'REGISTRATION_NOT_OPEN' } },
    });
    await page.goto(`/e/${slug}`);
    await reserveButton(page).click();
    await expect(page.getByRole('alert')).toContainText('Registration for this congress has not opened yet');
    await expect.poll(() => requests.filter((r) => r === `GET /api/public/events/${slug}`).length).toBeGreaterThan(1);
  });
});

test.describe('congress time zone', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('a visitor in another zone sees venue dates and times with a zone note', async ({ page }) => {
    await fixture(page, {});
    await page.goto(`/e/${slug}`);
    const hero = page.locator('section[aria-labelledby="congress-title"]');
    await expect(hero).toContainText(/11\s*–\s*12 May 2027/);
    await expect(hero).toContainText('Starts Tue 11 May, 00:30');
    await expect(page.getByTestId('venue-zone-note')).toContainText('Times are congress time (GMT+3:30)');
    const program = page.locator('#program');
    await expect(program.getByText('00:30', { exact: true })).toBeVisible();
    await expect(program.getByRole('region', { name: /11 May/ })).toBeVisible();
    await expect(page.getByTestId('program-zone-note')).toBeVisible();
  });
});

test.describe('congress time zone, visitor at the venue', () => {
  test.use({ timezoneId: 'Asia/Tehran' });

  test('no zone note when the device is in the congress zone', async ({ page }) => {
    await fixture(page, {});
    await page.goto(`/e/${slug}`);
    await expect(page.locator('section[aria-labelledby="congress-title"]')).toContainText('Starts Tue 11 May, 00:30');
    await expect(page.getByTestId('venue-zone-note')).toHaveCount(0);
    await expect(page.getByTestId('program-zone-note')).toHaveCount(0);
  });
});
