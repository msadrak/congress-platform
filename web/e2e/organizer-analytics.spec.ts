import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The shipping analytics page against synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The browser runs in New York while the event is in Tehran (+03:30): every time shown must be Tehran's.
test.use({ timezoneId: 'America/New_York' });

const KEY = 'synthetic-c5-organizer';
const event = { id: 'event-a', name: 'Alpha Congress', slug: 'event-a', starts_at: '2027-04-10T05:00:00Z', ends_at: '2027-04-11T15:00:00Z', location: 'Hall', description: '' };
const points = [
  { id: 'point-1', event_id: 'event-a', name: 'Main Gate', location: 'North', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null, created_at: '2027-01-01T00:00:00Z' },
  { id: 'point-2', event_id: 'event-a', name: 'Lunch', location: 'Hall B', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null, created_at: '2027-01-01T00:00:01Z' },
];
const tiers = [
  { id: 'tier-1', name: 'Delegate', description: '', quota: 100, reserved_count: 40, is_open: true },
  { id: 'tier-2', name: 'Student', description: '', quota: 20, reserved_count: 5, is_open: true },
];

const hour = (day: string, h: string, count: number, rejected = 0) => ({ day, hour: `${h}:00`, starts_at: `${day}T${h}:00:00+03:30`, count, admitted: count - rejected, rejected });
const ALL_HOURS = [hour('2027-04-10', '08', 10, 1), hour('2027-04-10', '09', 8), hour('2027-04-11', '09', 5), hour('2027-04-11', '11', 7, 2)];

function analyticsFor(day: string | null) {
  const hours = day ? ALL_HOURS.filter(h => h.day === day) : ALL_HOURS;
  const admitted = hours.reduce((n, h) => n + h.admitted, 0);
  const rejected = hours.reduce((n, h) => n + h.rejected, 0);
  return {
    event_id: 'event-a',
    timezone: 'Asia/Tehran',
    days: ['2027-04-10', '2027-04-11'],
    total_tickets: 45,
    tickets_by_status: [{ status: 'active', count: 45 }, { status: 'cancelled', count: 3 }],
    tier_registrations: [
      { tier_id: 'tier-1', tier_name: 'Delegate', quota: 100, active: 40, total: 42 },
      { tier_id: 'tier-2', tier_name: 'Student', quota: 20, active: 5, total: 6 },
    ],
    unique_admitted: 20,
    checkin_rate: 44.4,
    total_scans: admitted + rejected,
    total_admitted: admitted,
    total_rejected: rejected,
    hourly_scans: hours,
    catering_metrics: [],
    gate_breakdown: [{ point_id: 'point-1', point_name: 'Main Gate', location: 'North', policy_type: 'MULTI_ENTRY', total_admitted: admitted, total_rejected: rejected, admissions: admitted, current_occupancy: admitted, hourly_scans: hours }],
  };
}

interface Options { failures?: { status: number; body: unknown }[] }

async function fixture(page: Page, options: Options = {}) {
  const requests: URL[] = [];
  const failures = [...(options.failures ?? [])];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (route.request().headers().authorization !== `Bearer ${KEY}`) return json(401, { detail: 'Invalid API key' });
    switch (url.pathname) {
      case '/api/events': return json(200, [event]);
      case '/api/events/event-a': return json(200, event);
      case '/api/events/event-a/checkin-points': return json(200, points);
      case '/api/events/event-a/ticket-tiers': return json(200, tiers);
      case '/api/events/event-a/analytics/attendance': {
        const failure = failures.shift();
        if (failure) return json(failure.status, failure.body);
        return json(200, analyticsFor(url.searchParams.get('day')));
      }
      case '/api/events/event-a/analytics/export-csv':
      case '/api/events/event-a/analytics/registrations-csv':
        return route.fulfill({ status: 200, contentType: 'text/csv', body: '﻿Ticket ID\n1\n' });
      default: return json(200, []);
    }
  });
  const attendance = () => requests.filter(u => u.pathname.endsWith('/analytics/attendance'));
  return { requests, attendance };
}

async function seed(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
}

const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('the day picker filters the dashboard and hours are on the event clock', async ({ page }) => {
  const { attendance } = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');

  await expect(page.getByTestId('kpi-scans')).toHaveText('30');
  const dayPicker = page.getByRole('combobox', { name: 'Filter by day' });
  await expect(dayPicker.locator('option')).toHaveText(['All days', 'Sat, Apr 10', 'Sun, Apr 11']);
  // All days: one series across both event days, in Tehran time although the browser is in New York.
  await expect(page.getByTestId('hourly-range-event')).toHaveText('(Sat, Apr 10 08:00 – Sun, Apr 11 11:00)');
  await expect(page.getByTestId('analytics-timezone')).toHaveText('Tehran time');
  await expect(page.getByTestId('analytics-timezone')).toHaveAttribute('title', 'Asia/Tehran');
  expect(attendance()[0].searchParams.has('day')).toBe(false);

  await dayPicker.selectOption('2027-04-11');
  await expect(page.getByTestId('kpi-scans')).toHaveText('12');
  await expect(page.getByTestId('hourly-range-event')).toHaveText('(09:00 – 11:00)');
  expect(attendance().at(-1)?.searchParams.get('day')).toBe('2027-04-11');

  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByTestId('kpi-scans')).toHaveText('30');
});

test('polling runs every 30 s while visible and pauses while the tab is hidden', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-04-11T06:00:00Z') });
  const { attendance } = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  await expect(page.getByTestId('kpi-scans')).toHaveText('30');
  await expect(page.getByTestId('analytics-refreshed-at')).toHaveText('09:30:00');
  // "today" is the event's date: 2027-04-11 in Tehran.
  await expect(page.getByRole('combobox', { name: 'Filter by day' }).locator('option').nth(2)).toHaveText('Sun, Apr 11 (today)');
  expect(attendance()).toHaveLength(1);

  await page.clock.runFor(30_000);
  await expect.poll(() => attendance().length).toBe(2);

  await setVisibility(page, 'hidden');
  await expect(page.getByTestId('analytics-polling')).toHaveText('Paused while this tab is hidden');
  await page.clock.runFor(120_000);
  expect(attendance()).toHaveLength(2);

  // Back in view: refreshed at once, then on the 30 s rhythm again.
  await setVisibility(page, 'visible');
  await expect.poll(() => attendance().length).toBe(3);
  await expect(page.getByTestId('analytics-polling')).toHaveText('Live: refreshes every 30 s');
  await page.clock.runFor(30_000);
  await expect.poll(() => attendance().length).toBe(4);

  // Paused by hand: no more requests.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.clock.runFor(90_000);
  expect(attendance()).toHaveLength(4);
});

test('both CSV downloads carry the same filters as the dashboard', async ({ page }) => {
  const { requests } = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  await expect(page.getByTestId('kpi-scans')).toHaveText('30');
  await page.getByRole('combobox', { name: 'Filter by day' }).selectOption('2027-04-11');
  await page.getByRole('combobox', { name: 'Filter by check-in point' }).selectOption('point-1');
  await page.getByRole('combobox', { name: 'Filter by ticket tier' }).selectOption('tier-2');
  await expect(page.getByTestId('kpi-scans')).toHaveText('12');

  for (const [button, path, filename] of [
    ['Export Attendance CSV', '/analytics/export-csv', 'event-a-attendance-2027-04-11.csv'],
    ['Export Registrations CSV', '/analytics/registrations-csv', 'event-a-registrations-2027-04-11.csv'],
  ]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    expect((await download).suggestedFilename()).toBe(filename);
    const sent = requests.filter(u => u.pathname.endsWith(path)).at(-1);
    expect(Object.fromEntries(sent?.searchParams ?? [])).toEqual({ day: '2027-04-11', point_id: 'point-1', ticket_tier_id: 'tier-2' });
  }
});

test('a failed load shows the reason and a retry, never zeros', async ({ page }) => {
  const { attendance } = await fixture(page, {
    failures: [{ status: 400, body: { detail: 'from_time must not be after to_time', code: 'ANALYTICS_RANGE_INVALID' } }],
  });
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  const panel = page.getByTestId('analytics-error');
  await expect(panel).toContainText('Analytics could not be loaded');
  await expect(panel).toContainText('The start of the time range must not be after its end.');
  await expect(page.getByTestId('kpi-scans')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('kpi-scans')).toHaveText('30');
  await expect(panel).toHaveCount(0);
  expect(attendance()).toHaveLength(2);
});

test('Persian shows Solar Hijri days and Persian digits on the event clock', async ({ page }) => {
  await fixture(page);
  await seed(page, 'fa');
  await page.goto('/organizer/events/event-a/analytics');
  await expect(page.getByTestId('kpi-scans')).toHaveText('۳۰');
  await expect(page.getByRole('combobox', { name: 'فیلتر بر اساس روز' }).locator('option')).toHaveText(['همهٔ روزها', 'شنبه ۲۱ فروردین', 'یکشنبه ۲۲ فروردین']);
  await expect(page.getByTestId('hourly-range-event')).toHaveText('(شنبه ۲۱ فروردین ۰۸:۰۰ – یکشنبه ۲۲ فروردین ۱۱:۰۰)');
  await expect(page.getByTestId('analytics-timezone')).toHaveText('وقت تهران');
  await expect(page.locator('body')).not.toContainText('Asia/Tehran');
  // Persian digits keep the sans font: IBM Plex Mono covers only Latin.
  const fonts = await page.getByTestId('analytics-refreshed-at').evaluate(el => getComputedStyle(el).fontFamily);
  expect(fonts).not.toMatch(/Plex Mono/);
});
