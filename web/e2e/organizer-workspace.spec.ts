import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Organizer pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in ORGANIZER_PORTAL_MILESTONE_RESULT.md.
const KEY = 'synthetic-ms03-organizer';
const bearer = `Bearer ${KEY}`;

interface FixtureEvent { id: string; name: string; slug: string; starts_at: string; ends_at: string; location: string; description: string }
interface FixtureTier { id: string; name: string; description: string; quota: number; reserved_count: number; is_open: boolean }

const eventOf = (id: string, name: string, starts: string, ends: string): FixtureEvent => ({ id, name, slug: id, starts_at: starts, ends_at: ends, location: `${name} Hall`, description: `About ${name}` });
const EVENTS: Record<string, FixtureEvent> = {
  'event-a': eventOf('event-a', 'Alpha Congress', '2099-05-10T07:00:00Z', '2099-05-12T15:00:00Z'),
  'event-b': eventOf('event-b', 'Beta Summit', '2020-05-10T07:00:00Z', '2020-05-12T15:00:00Z'),
};
const tierOf = (id: string, name: string, quota: number, reserved: number, open = true): FixtureTier => ({ id, name, description: '', quota, reserved_count: reserved, is_open: open });

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  tiersA?: FixtureTier[];
  revokeStatus?: number;
  slowTiersOf?: string;
}

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const events: Record<string, FixtureEvent> = { ...EVENTS };
  const tiers: Record<string, FixtureTier[]> = {
    'event-a': options.tiersA ?? [tierOf('tier-a1', 'Alpha Delegate', 100, 40), tierOf('tier-a2', 'Alpha Student', 20, 20, false)],
    'event-b': [tierOf('tier-b1', 'Beta Delegate', 50, 5)],
  };
  const operators = [{ id: 'op-1', event_id: 'event-a', user_id: 'u1', operator_name: 'Operator One', email: 'op1@example.test', is_revoked: false, created_at: '2099-01-01T00:00:00Z' }];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    requests.push({ method, path, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/events') return json(200, Object.values(events));
    const match = path.match(/^\/api\/events\/([^/]+)(\/.*)?$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, id, rest = ''] = match;
    if (!events[id]) return json(404, { detail: 'Event not found' });
    if (rest === '' && method === 'GET') return json(200, events[id]);
    if (rest === '' && method === 'PATCH') {
      events[id] = { ...events[id], ...JSON.parse(raw ?? '{}') };
      return json(200, events[id]);
    }
    if (rest === '/ticket-tiers' && method === 'GET') {
      if (options.slowTiersOf === id) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1500);
        await promise;
      }
      return json(200, tiers[id]);
    }
    const tierPatch = rest.match(/^\/ticket-tiers\/([^/]+)$/);
    if (tierPatch && method === 'PATCH') {
      const index = tiers[id].findIndex(t => t.id === tierPatch[1]);
      tiers[id][index] = { ...tiers[id][index], ...JSON.parse(raw ?? '{}') };
      return json(200, tiers[id][index]);
    }
    if (rest === '/desk/operators') return json(200, id === 'event-a' ? operators : []);
    if (rest === '/desk/operators/op-1/revoke') {
      if (options.revokeStatus) return json(options.revokeStatus, { detail: 'Server error' });
      operators[0] = { ...operators[0], is_revoked: true };
      return json(200, operators[0]);
    }
    if (rest === '/desk/me') return json(200, { operator_id: null, operator_name: 'Organizer Admin', event_id: id, event_name: events[id].name, event_slug: id, is_organizer_admin: true });
    if (rest === '/desk/tiers') return json(200, tiers[id]);
    if (rest === '/attendees') return json(200, []);
    if (rest === '/analytics/attendance') return json(200, { event_id: id, total_tickets: 60, unique_admitted: 30, checkin_rate: 50, total_scans: 44, total_admitted: 40, total_rejected: 4, catering_metrics: [], gate_breakdown: [] });
    if (rest === '/analytics/export-csv') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'ticket,state\n1,admitted\n' });
    return json(200, []);
  });
  return requests;
}

async function seed(page: Page, options: { desk?: boolean; locale?: string } = {}) {
  await page.goto('/');
  await page.evaluate(({ desk, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-ms03-organizer');
    if (desk) sessionStorage.setItem('congress_desk_token_event-a', 'synthetic-ms03-desk-event-a');
    localStorage.setItem('congress_attendee_locale', locale);
  }, { desk: options.desk ?? false, locale: options.locale ?? 'en' });
}

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Event workspace' });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('events overview lists authorized events with a status derived from their own dates', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer');
  await expect(page.getByRole('link', { name: 'Alpha Congress' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta Summit' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Alpha Congress' }).getByText('Upcoming')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Beta Summit' }).getByText('Ended')).toBeVisible();
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('one workspace navigation addresses every section of the selected event by URL', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  await expect(workspaceNav(page).getByRole('link')).toHaveText([/Overview/, /Ticket Tiers/, /Check-In Gates/, /Exhibition Booths/, /Desk Staff/, /Analytics/, /Front Desk/]);
  await expect(workspaceNav(page).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');

  const eventReads = () => requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a').length;
  const before = eventReads();
  const sections: [RegExp, RegExp, string][] = [
    [/Ticket Tiers/, /\/tiers$/, 'Alpha Delegate'],
    [/Check-In Gates/, /\/check-in$/, 'Check-in'],
    [/Exhibition Booths/, /\/booths$/, 'booth'],
    [/Desk Staff/, /\/operators$/, 'Operator One'],
  ];
  for (const [label, url, text] of sections) {
    await workspaceNav(page).getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(workspaceNav(page).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
  // Moving between sections reuses the loaded event: no refetch.
  expect(eventReads()).toBe(before);

  await page.goto('/organizer/events/event-a/booths');
  await expect(workspaceNav(page).getByRole('link', { name: /Exhibition Booths/ })).toHaveAttribute('aria-current', 'page');
  await workspaceNav(page).getByRole('link', { name: /Analytics/ }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('overview shows real capacity from the tiers and no invented figures', async ({ page }) => {
  await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText('60 / 120', { exact: false }).first()).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Alpha Student' });
  await expect(row.getByText('Closed')).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByText(/revenue|\$/i)).toHaveCount(0);
});

test('an event without tiers says so and points to ticket tiers', async ({ page }) => {
  await fixture(page, { tiersA: [] });
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText(/No ticket tier is defined yet/)).toBeVisible();
});

test('switching events through the list never shows the previous event data', async ({ page }) => {
  await fixture(page, { slowTiersOf: 'event-a' });
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('link', { name: /Events List/ }).click();
  await page.getByRole('link', { name: 'Beta Summit' }).first().click();
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await expect(page.getByText('Alpha Delegate')).toHaveCount(0);
  await expect(page.getByText('Alpha Congress')).toHaveCount(0);
  await workspaceNav(page).getByRole('link', { name: /Ticket Tiers/ }).click();
  await expect(page.getByText('Beta Delegate').first()).toBeVisible();
});

test('editing an event setting persists, announces success and updates the workspace context', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await page.getByRole('button', { name: /Edit Event/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Alpha Congress Renamed');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event settings saved' })).toBeVisible();
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress Renamed');
  const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/events/event-a');
  expect(patch?.auth).toBe(bearer);
  expect(patch?.body).toMatchObject({ name: 'Alpha Congress Renamed' });
});

test('closing a ticket tier needs confirmation; cancelling sends nothing', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('button', { name: /Edit Tier/ }).first().click();
  const edit = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
  await edit.getByRole('combobox').selectOption('closed');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  const confirm = page.getByRole('dialog', { name: 'Close this ticket tier?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(requests.some(r => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'))).toBe(false);

  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByRole('dialog', { name: 'Close this ticket tier?' }).getByRole('button', { name: 'Close tier' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  const patch = requests.find(r => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'));
  expect(patch?.auth).toBe(bearer);
  expect(patch?.body).toMatchObject({ is_open: false });
});

for (const failing of [false, true]) {
  test(`revoking an operator asks first and ${failing ? 'reports a failure instead of staying silent' : 'confirms the result'}`, async ({ page }) => {
    const requests = await fixture(page, failing ? { revokeStatus: 500 } : {});
    await seed(page);
    await page.goto('/organizer/events/event-a/operators');
    await page.getByRole('button', { name: 'Revoke Access' }).click();
    const confirm = page.getByRole('dialog', { name: 'Revoke operator access?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(requests.some(r => r.path.endsWith('/revoke'))).toBe(false);

    await page.getByRole('button', { name: 'Revoke Access' }).click();
    await page.getByRole('dialog', { name: 'Revoke operator access?' }).getByRole('button', { name: 'Revoke Access' }).click();
    if (failing) await expect(page.getByRole('alert').filter({ hasText: 'Could not revoke access' })).toBeVisible();
    else await expect(page.getByRole('status').filter({ hasText: 'Access revoked for Operator One' })).toBeVisible();
  });
}

test('analytics keeps its export and says the CSV is not filtered', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  await expect(page.getByText('Filters change this view only')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Attendance CSV' }).click();
  expect((await download).suggestedFilename()).toBe('event-a-attendance.csv');
  expect(requests.find(r => r.path.endsWith('/export-csv'))?.auth).toBe(bearer);
});

test('reception shows which authority is acting when both credentials exist', async ({ page }) => {
  await fixture(page);
  await seed(page, { desk: true });
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByTestId('desk-active-mode')).toHaveText('Acting as: reception operator');
  await page.getByRole('button', { name: 'Organizer mode' }).click();
  await expect(page.getByTestId('desk-active-mode')).toHaveText('Acting as: organizer');
  await expect(workspaceNav(page).getByRole('link', { name: /Front Desk/ })).toHaveAttribute('aria-current', 'page');
});

test('mobile and tablet layouts have no horizontal overflow; the workspace nav scrolls inside itself', async ({ page }) => {
  await fixture(page);
  await seed(page);
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/tiers', '/organizer/events/event-a/analytics']) {
      await page.goto(path);
      await expect(page.getByTestId('active-event').or(page.getByRole('heading', { name: 'Events List' }).or(page.getByRole('heading').first())).first()).toBeVisible();
      expect(await overflow(page), `${width}px ${path}`).toBe(0);
    }
  }
});

test('Persian RTL at 320px: workspace is right-to-left and fits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  await seed(page, { locale: 'fa' });
  for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/analytics']) {
    await page.goto(path);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    expect(await overflow(page), path).toBe(0);
  }
  await page.goto('/organizer/events/event-a');
  await expect(page.getByRole('navigation', { name: 'فضای کاری همایش' }).getByRole('link', { name: 'نمای کلی' })).toBeVisible();
});
