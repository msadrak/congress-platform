import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Reception Desk page + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const organizerKey = 'synthetic-t07-organizer';
const deskA = 'synthetic-t07-desk-event-a';
const deskB = 'synthetic-t07-desk-event-b';
const userToken = 'synthetic-t07-user';
const bearer = (token: string) => `Bearer ${token}`;

const eventName = (id: string) => `Fixture ${id}`;
const tier = { id: 'tier-1', name: 'General', description: '', quota: 100, reserved_count: 0, is_open: true };
const meOf = (id: string, auth: string | undefined) => auth === bearer(organizerKey)
  ? { operator_id: null, operator_name: 'Organizer Admin', event_id: id, event_name: eventName(id), event_slug: id, is_organizer_admin: true }
  : { operator_id: 'op-1', operator_name: 'Operator One', event_id: id, event_name: eventName(id), event_slug: id, is_organizer_admin: false };

type Recorded = { method: string; path: string; auth: string | undefined };
type Options = { meStatus?: (auth: string | undefined) => number | undefined; registerStatus?: number };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
});

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const auth = request.headers().authorization;
    requests.push({ method: request.method(), path, auth });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const error = (status: number) => json(status, { detail: status === 401 ? 'Invalid desk token' : status === 403 ? 'Wrong event' : status === 404 ? 'Event not found' : status === 409 ? 'Duplicate registration' : 'Server error' });
    const match = path.match(/^\/api\/events\/([^/]+)\/(.*)$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, id, rest] = match;
    if (rest === 'desk/login') return json(200, { access_token: deskB, token_type: 'bearer', event_id: id, event_name: eventName(id), event_slug: id, operator: { id: 'op-2', operator_name: 'Operator Two' } });
    if (rest === 'desk/me') { const status = options.meStatus?.(auth); return status ? error(status) : json(200, meOf(id, auth)); }
    if (rest === 'desk/tiers') return json(200, [tier]);
    if (rest === 'desk-registrations') return options.registerStatus ? error(options.registerStatus) : json(201, { ticket_id: 'ticket-walkin-1', attendee_name: 'Walk In', attendee_mobile: null, organization: '', title: '', ticket_tier_name: 'General', qr_secret: 'synthetic-walkin-qr', issued_by: auth === bearer(organizerKey) ? null : 'Operator One', created_at: '2027-01-01T00:00:00Z' });
    if (rest.startsWith('attendees')) return json(200, []);
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, credentials: { organizer?: boolean; eventA?: boolean; eventB?: boolean } = {}) {
  await page.goto('/');
  await page.evaluate(({ credentials, organizerKey, deskA, deskB, userToken }) => {
    if (credentials.organizer) sessionStorage.setItem('congress_organizer_api_key', organizerKey);
    if (credentials.eventA) sessionStorage.setItem('congress_desk_token_event-a', deskA);
    if (credentials.eventB) sessionStorage.setItem('congress_desk_token_event-b', deskB);
    localStorage.setItem('congress_attendee_token', userToken);
  }, { credentials, organizerKey, deskA, deskB, userToken });
}

const store = (page: Page) => page.evaluate(() => ({
  organizer: sessionStorage.getItem('congress_organizer_api_key'),
  eventA: sessionStorage.getItem('congress_desk_token_event-a'),
  eventB: sessionStorage.getItem('congress_desk_token_event-b'),
  user: localStorage.getItem('congress_attendee_token'),
}));
const only = (requests: Recorded[], token: string) => requests.length > 0 && requests.every(r => r.auth === bearer(token));

async function issueWalkIn(page: Page) {
  await page.getByRole('button', { name: 'Desk registration' }).click();
  const form = page.getByRole('dialog', { name: 'Desk registration' });
  await form.getByLabel('Full name').fill('Walk In');
  await form.getByRole('button', { name: 'Issue pass' }).click();
}
const issued = (page: Page) => page.getByRole('dialog', { name: 'Issued' });
/** Organizer administration only: the desk's mode choice lives in the ⋮ menu. */
async function chooseMode(page: Page, mode: 'Organizer mode' | 'Operator mode') {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: mode }).click();
}

test('without any desk or organizer credential the operator gate appears and nothing is sent', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  requests.length = 0;
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByRole('heading', { name: 'Sign in to the desk' })).toBeVisible();
  expect(requests).toEqual([]);
});

test('operator mode with an organizer key and a desk token present sends the desk JWT alone', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, { organizer: true, eventA: true, eventB: true });
  requests.length = 0;
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByText('Operator One')).toBeVisible();
  await issueWalkIn(page);
  await expect(issued(page)).toContainText('Walk In');
  // The attendee search is debounced (200 ms); wait for it instead of racing it.
  await expect.poll(() => requests.some(r => r.path.endsWith('/attendees'))).toBe(true);
  expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(['GET /api/events/event-a/desk/me', 'GET /api/events/event-a/desk/tiers', 'GET /api/events/event-a/attendees', 'POST /api/events/event-a/desk-registrations']));
  expect(only(requests, deskA)).toBe(true);
  expect(await store(page)).toEqual({ organizer: organizerKey, eventA: deskA, eventB: deskB, user: userToken });
});

test('organizer mode is a deliberate choice and sends only the owning key', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, { organizer: true, eventA: true });
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByText('Operator One')).toBeVisible();
  await expect.poll(() => requests.some(r => r.path.endsWith('/attendees'))).toBe(true);
  requests.length = 0;
  await chooseMode(page, 'Organizer mode');
  await expect(page.getByText('Organizer Admin')).toBeVisible();
  await issueWalkIn(page);
  await expect(issued(page)).toContainText('Walk In');
  expect(requests.filter(r => r.path.endsWith('desk-registrations')).length).toBe(1);
  expect(only(requests, organizerKey)).toBe(true);
  expect(await store(page)).toEqual({ organizer: organizerKey, eventA: deskA, eventB: null, user: userToken });
});

test('organizer-only start opens organizer mode without borrowing any desk credential', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, { organizer: true });
  requests.length = 0;
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByText('Organizer Admin')).toBeVisible();
  expect(only(requests, organizerKey)).toBe(true);
});

test('a rejected organizer key in organizer mode leaves the desk token untouched and never falls back', async ({ page }) => {
  const requests = await fixture(page, { meStatus: auth => (auth === bearer(organizerKey) ? 401 : undefined) });
  await seed(page, { organizer: true, eventA: true });
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByText('Operator One')).toBeVisible();
  // Let the debounced operator-mode search finish so it is not counted after the switch.
  await expect.poll(() => requests.some(r => r.path.endsWith('/attendees'))).toBe(true);
  requests.length = 0;
  await chooseMode(page, 'Organizer mode');
  await expect(page.getByRole('heading', { name: 'Organizer mode needs the organizer key' })).toBeVisible();
  expect(await store(page)).toEqual({ organizer: null, eventA: deskA, eventB: null, user: userToken });
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(r => r.auth === bearer(organizerKey))).toBe(true);
  // Switching back is an explicit user action, and only then is the desk token used.
  requests.length = 0;
  await page.getByRole('button', { name: 'Operator sign-in' }).click();
  await expect(page.getByText('Operator One')).toBeVisible();
  expect(only(requests, deskA)).toBe(true);
});

test('a rejected desk token clears only that event session and never falls back to the organizer key', async ({ page }) => {
  const requests = await fixture(page, { meStatus: auth => (auth === bearer(deskA) ? 401 : undefined) });
  await seed(page, { organizer: true, eventA: true, eventB: true });
  requests.length = 0;
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByRole('heading', { name: 'Sign in to the desk' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Access removed or signed out.');
  expect(await store(page)).toEqual({ organizer: organizerKey, eventA: null, eventB: deskB, user: userToken });
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(r => r.auth === bearer(deskA))).toBe(true);
});

for (const status of [403, 404, 500]) {
  test(`desk/me ${status} keeps every credential, shows the failure and retries with the same authority`, async ({ page }) => {
    let failing = true;
    const requests = await fixture(page, { meStatus: () => (failing ? status : undefined) });
    await seed(page, { organizer: true, eventA: true });
    requests.length = 0;
    await page.goto('/organizer/events/event-a/desk');
    await expect(page.getByText(status === 403 ? 'Wrong event' : status === 404 ? 'Event not found' : 'Server error')).toBeVisible();
    expect(await store(page)).toEqual({ organizer: organizerKey, eventA: deskA, eventB: null, user: userToken });
    expect(only(requests, deskA)).toBe(true);
    failing = false;
    requests.length = 0;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Operator One')).toBeVisible();
    expect(only(requests, deskA)).toBe(true);
  });
}

test('an event A desk token is never sent for event B, and a late event A response never shows in event B', async ({ page }) => {
  const requests = await fixture(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/events/event-a/desk/me', async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...meOf('event-a', bearer(deskA)), operator_name: 'Stale Operator' }) });
  });
  await page.addInitScript(() => {
    new MutationObserver(() => { if (document.body?.textContent?.includes('Stale Operator')) sessionStorage.setItem('t07_saw_stale', '1'); })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  await seed(page, { organizer: false, eventA: true });
  requests.length = 0;
  await page.goto('/organizer/events/event-a/desk');
  await started.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/organizer/events/event-b/desk');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Sign in to the desk' })).toBeVisible();
  const late = page.waitForResponse(response => response.url().endsWith('/api/events/event-a/desk/me'));
  release.resolve();
  await late;
  await page.waitForTimeout(400);
  await expect(page.getByText('Stale Operator')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('t07_saw_stale'))).toBeNull();
  expect(requests.filter(r => r.path.includes('/event-b/'))).toEqual([]);
  expect((await store(page)).eventA).toBe(deskA);
});

test('a late 401 for an old desk token cannot clear the newly signed-in operator session', async ({ page }) => {
  await fixture(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/events/event-a/desk/me', async route => {
    if (route.request().headers().authorization !== bearer(deskA)) return route.fallback();
    started.resolve();
    await release.promise;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid desk token' }) });
  });
  await seed(page, { eventA: true });
  await page.goto('/organizer/events/event-a/desk');
  await started.promise;
  // The held request keeps the page loading, so the stored operator session is replaced directly.
  await page.evaluate(deskB => sessionStorage.setItem('congress_desk_token_event-a', deskB), deskB);
  const late = page.waitForResponse(response => response.url().endsWith('/desk/me') && response.status() === 401);
  release.resolve();
  await late;
  await page.waitForTimeout(400);
  expect((await store(page)).eventA).toBe(deskB);
});

test('walk-in issuance errors (409) keep the operator session', async ({ page }) => {
  const requests = await fixture(page, { registerStatus: 409 });
  await seed(page, { organizer: true, eventA: true });
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByText('Operator One')).toBeVisible();
  requests.length = 0;
  await issueWalkIn(page);
  await expect(page.getByText('Duplicate registration')).toBeVisible();
  expect(only(requests, deskA)).toBe(true);
  expect(await store(page)).toEqual({ organizer: organizerKey, eventA: deskA, eventB: null, user: userToken });
});
