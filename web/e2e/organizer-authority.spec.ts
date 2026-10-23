import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Organizer pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const keyA = 'synthetic-t05-organizer-a';
const keyB = 'synthetic-t05-organizer-b';
const userToken = 'synthetic-t05-user';
const deskToken = 'synthetic-t05-desk';
const scannerToken = 'synthetic-t05-scanner';

const eventNames: Record<string, string> = { 'event-a': 'Event A', 'event-b': 'Event B', 'event-new': 'Created Event' };
const eventOf = (id: string, name = eventNames[id]) => ({ id, name, slug: id, starts_at: '2027-04-10T08:00:00Z', ends_at: '2027-04-10T18:00:00Z', location: 'Fixture Hall', description: 'Synthetic fixture' });
const analytics = { event_id: 'event-a', timezone: 'Asia/Tehran', days: ['2027-04-10'], total_tickets: 10, tickets_by_status: [{ status: 'active', count: 10 }], tier_registrations: [], unique_admitted: 5, checkin_rate: 0.5, total_scans: 7, total_admitted: 5, total_rejected: 2, hourly_scans: [], catering_metrics: [], gate_breakdown: [] };

type Recorded = { method: string; path: string; auth: string | undefined };
type Options = { listStatus?: number; createStatus?: number; foreignStatus?: number; tierStatus?: number };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
});

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path, auth: request.headers().authorization });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/events') {
      if (request.method() === 'POST') return json(options.createStatus ?? 201, options.createStatus === 401 ? { detail: 'Invalid API key' } : eventOf('event-new'));
      return json(options.listStatus ?? 200, options.listStatus === 401 ? { detail: 'Invalid API key' } : [eventOf('event-a'), eventOf('event-b')]);
    }
    const match = path.match(/^\/api\/events\/([^/]+)(\/.*)?$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, id, rest = ''] = match;
    if (id.startsWith('event-foreign')) {
      const status = options.foreignStatus ?? 404;
      return json(status, { detail: status === 404 ? 'Event not found' : status === 403 ? 'Forbidden' : 'Server error' });
    }
    if (rest === '') return json(200, eventOf(id));
    if (rest === '/ticket-tiers' && request.method() === 'POST') {
      const status = options.tierStatus ?? 201;
      return json(status, status === 401 ? { detail: 'Invalid API key' } : { id: 'tier-new', name: 'New Tier', description: '', quota: 100, reserved_count: 0, is_open: true });
    }
    if (rest === '/analytics/attendance') return json(200, { ...analytics, event_id: id });
    if (rest === '/analytics/export-csv') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'ticket,state\n1,admitted\n' });
    return json(200, []);
  });
  return requests;
}

// Other credential families are stored under their real keys; the Organizer key is optional.
async function seed(page: Page, organizerKey?: string) {
  await page.goto('/');
  await page.evaluate(({ organizerKey, userToken, deskToken, scannerToken }) => {
    if (organizerKey) sessionStorage.setItem('congress_organizer_api_key', organizerKey);
    localStorage.setItem('congress_attendee_token', userToken);
    sessionStorage.setItem('congress_desk_token_event-a', deskToken);
    return new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('congress_scanner_tokens', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('tokens', { keyPath: 'pointId' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('tokens', 'readwrite');
        tx.objectStore('tokens').put({ pointId: 'point-fixture', token: scannerToken, stored_at: new Date().toISOString() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, { organizerKey, userToken, deskToken, scannerToken });
}

async function otherCredentialsIntact(page: Page) {
  const intact = await page.evaluate(({ userToken, deskToken, scannerToken }) => new Promise<boolean>(resolve => {
    const sessions = localStorage.getItem('congress_attendee_token') === userToken && sessionStorage.getItem('congress_desk_token_event-a') === deskToken;
    const open = indexedDB.open('congress_scanner_tokens', 1);
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('tokens', 'readonly').objectStore('tokens').get('point-fixture');
      read.onsuccess = () => { db.close(); resolve(sessions && read.result?.token === scannerToken); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), { userToken, deskToken, scannerToken });
  expect(intact).toBe(true);
}

const storedKey = (page: Page) => page.evaluate(() => sessionStorage.getItem('congress_organizer_api_key'));

type Group = ReturnType<Page['getByRole']>;
/** Fills a DateTimeField (day, month, year, time) with a `datetime-local` value, in English. */
async function fillDateTime(group: Group, value: string) {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  await group.getByLabel('Day').selectOption(String(Number(day)));
  await group.getByLabel('Month').selectOption(String(Number(month)));
  await group.getByLabel('Year').fill(year);
  await group.getByLabel('Time').fill(time);
}

async function createEvent(page: Page) {
  await page.getByRole('button', { name: 'New congress' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Congress name' }).fill('Created Event');
  await fillDateTime(dialog.getByRole('group', { name: 'Starts' }), '2027-05-01T09:00');
  await fillDateTime(dialog.getByRole('group', { name: 'Ends' }), '2027-05-01T17:00');
  await dialog.getByRole('textbox', { name: 'Venue' }).fill('Fixture Hall');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /^(Account menu|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}

test('without an organizer key the gate appears and no protected request is sent', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  requests.length = 0;
  for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/analytics']) {
    await page.goto(path);
    // Without any credential the gate opens on member sign-in (ADR 0016); the API key is one click away.
    await expect(page.getByRole('heading', { name: 'Sign in to the organizer console' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use organizer key' })).toBeVisible();
  }
  expect(requests).toEqual([]);
  await otherCredentialsIntact(page);
});

test('list, detail, analytics and CSV export transmit only the organizer key with every other credential stored', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, keyA);
  requests.length = 0;
  await page.goto('/organizer');
  await expect(page.getByText('Event A', { exact: true }).first()).toBeVisible();
  await page.goto('/organizer/events/event-a');
  await expect(page.getByTestId('active-event')).toHaveText('Event A');
  await page.goto('/organizer/events/event-a/analytics');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Attendance CSV' }).click();
  expect((await download).suggestedFilename()).toBe('event-a-attendance.csv');
  const paths = requests.map(r => `${r.method} ${r.path}`);
  for (const expected of ['GET /api/events', 'GET /api/events/event-a', 'GET /api/events/event-a/ticket-tiers', 'GET /api/events/event-a/checkin-points', 'GET /api/events/event-a/desk/operators', 'GET /api/events/event-a/analytics/attendance', 'GET /api/events/event-a/analytics/export-csv']) {
    expect(paths).toContain(expected);
  }
  expect(requests.every(r => r.auth === `Bearer ${keyA}`)).toBe(true);
  expect(await storedKey(page)).toBe(keyA);
  await otherCredentialsIntact(page);
});

test('event creation sends only the organizer key and shows the created event', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, keyA);
  await page.goto('/organizer');
  await createEvent(page);
  await expect(page.getByText('Created Event', { exact: true }).first()).toBeVisible();
  const posts = requests.filter(r => r.method === 'POST');
  expect(posts.map(r => r.path)).toEqual(['/api/events']);
  expect(requests.every(r => r.auth === `Bearer ${keyA}`)).toBe(true);
  await otherCredentialsIntact(page);
});

for (const trigger of ['load', 'mutation'] as const) {
  test(`401 on ${trigger} clears only the sent organizer key and never retries with another credential`, async ({ page }) => {
    const requests = await fixture(page, trigger === 'load' ? { listStatus: 401 } : { createStatus: 401 });
    await seed(page, keyA);
    requests.length = 0;
    await page.goto('/organizer');
    if (trigger === 'mutation') {
      await expect(page.getByText('Event A', { exact: true }).first()).toBeVisible();
      await createEvent(page);
    }
    await expect(page.getByRole('heading', { name: 'Use organizer key' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('The organizer key was not accepted.');
    expect(await storedKey(page)).toBeNull();
    // Development StrictMode may repeat the initial load; none of it may carry another credential.
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.every(r => r.auth === `Bearer ${keyA}`)).toBe(true);
    await otherCredentialsIntact(page);
  });
}

for (const tierStatus of [201, 401]) {
  test(`ticket tier creation on the detail page (${tierStatus}) uses only the organizer key and ${tierStatus === 401 ? 'clears only that key' : 'updates the tier list'}`, async ({ page }) => {
    const requests = await fixture(page, { tierStatus });
    await seed(page, keyA);
    requests.length = 0;
    await page.goto('/organizer/events/event-a');
    await expect(page.getByTestId('active-event')).toHaveText('Event A');
    await page.getByRole('navigation', { name: 'Congress sections' }).getByRole('link', { name: /Pass types/ }).click();
    await page.getByRole('button', { name: 'Add Ticket Tier' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('e.g. Faculty Full Delegate').fill('New Tier');
    await dialog.getByRole('button', { name: 'Save Ticket Tier' }).click();
    if (tierStatus === 201) {
      await expect(page.getByText('New Tier').first()).toBeVisible();
      expect(await storedKey(page)).toBe(keyA);
    } else {
      await expect(page.getByRole('heading', { name: 'Use organizer key' })).toBeVisible();
      expect(await storedKey(page)).toBeNull();
    }
    expect(requests.filter(r => r.method === 'POST').map(r => r.path)).toEqual(['/api/events/event-a/ticket-tiers']);
    expect(requests.every(r => r.auth === `Bearer ${keyA}`)).toBe(true);
    await otherCredentialsIntact(page);
  });
}

for (const status of [404, 403, 500]) {
  test(`foreign or failing event ${status} exposes no event data and keeps every session`, async ({ page }) => {
    const requests = await fixture(page, { foreignStatus: status });
    await seed(page, keyA);
    requests.length = 0;
    await page.goto('/organizer/events/event-foreign');
    await expect(page.getByRole('heading', { name: 'Failed to Load Event' })).toBeVisible();
    await expect(page.getByText(status === 404 ? 'Event not found' : status === 403 ? 'Forbidden' : 'Server error')).toBeVisible();
    await expect(page.getByText('Event A')).toHaveCount(0);
    await page.goto('/organizer/events/event-foreign/analytics');
    await expect(page.getByText('Event A')).toHaveCount(0);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every(r => r.auth === `Bearer ${keyA}`)).toBe(true);
    expect(await storedKey(page)).toBe(keyA);
    await otherCredentialsIntact(page);
  });
}

test('a late 401 for key A cannot clear key B and later actions use only key B', async ({ page }) => {
  const requests = await fixture(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/events', async route => {
    if (route.request().method() === 'GET' && route.request().headers().authorization === `Bearer ${keyA}`) {
      started.resolve();
      await release.promise;
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid API key' }) });
    }
    return route.fallback();
  });
  await seed(page, keyA);
  requests.length = 0;
  await page.goto('/organizer');
  await started.promise;
  await signOut(page);
  // Only what is sent from here on counts (the console asked who key A was before signing out).
  requests.length = 0;
  await page.getByRole('button', { name: 'Use organizer key' }).click();
  await expect(page.getByRole('heading', { name: 'Use organizer key' })).toBeVisible();
  await page.locator('#apiKeyInput').fill(keyB);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Event A', { exact: true }).first()).toBeVisible();
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/events') && response.status() === 401);
  release.resolve();
  await lateResponse;
  await expect(page.getByText('Event A', { exact: true }).first()).toBeVisible();
  expect(await storedKey(page)).toBe(keyB);
  await createEvent(page);
  await expect(page.getByText('Created Event', { exact: true }).first()).toBeVisible();
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(requests.every(r => r.auth === `Bearer ${keyB}`)).toBe(true);
  await otherCredentialsIntact(page);
});

for (const suffix of ['', '/analytics']) {
  test(`a delayed event A response never replaces event B on ${suffix === '' ? 'the detail' : 'the analytics'} page`, async ({ page }) => {
    await fixture(page);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route('**/api/events/event-a', async route => {
      started.resolve();
      await release.promise;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(eventOf('event-a', 'Event A Stale')) });
    });
    // Records any moment the stale name was rendered, even transiently.
    await page.addInitScript(() => {
      new MutationObserver(() => { if (document.body?.textContent?.includes('Event A Stale')) sessionStorage.setItem('t05_saw_stale', '1'); })
        .observe(document, { subtree: true, childList: true, characterData: true });
    });
    await seed(page, keyA);
    await page.goto(`/organizer/events/event-a${suffix}`);
    await started.promise;
    await page.evaluate(path => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/organizer/events/event-b${suffix}`);
    await expect(page.getByText('Event B', { exact: true }).first()).toBeVisible();
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/events/event-a'));
    release.resolve();
    await lateResponse;
    await expect(page.getByText('Event B', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Event A Stale')).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('t05_saw_stale'))).toBeNull();
  });
}
