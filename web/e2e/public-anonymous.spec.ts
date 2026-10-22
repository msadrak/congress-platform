import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping React pages + synthetic HTTP responses: not FastAPI/PostgreSQL E2E.
const event = { id: 'event-fixture', name: 'T04 Fixture Congress', slug: 't04-fixture', starts_at: '2027-04-10T08:00:00Z', ends_at: '2027-04-10T18:00:00Z', location: 'Fixture Hall', description: 'Synthetic public transport fixture', ticket_tiers: [{ id: 'tier-fixture', event_id: 'event-fixture', name: 'General', quota: 100, reserved_count: 0, is_open: true, created_at: '2027-01-01T00:00:00Z' }] };
const booth = { id: 'booth-fixture', name: 'T04 Fixture Booth', slug: 'fixture-booth', location: 'A1', description: 'Fixture company', website_url: '', brochure_url: '', event_name: event.name, event_slug: event.slug, is_bookmarked: true };
const userToken = 'synthetic-t04-user';
const MOBILE = '09121234567';
const CODE = '482913';
const fixtureUser = { id: 'user-fixture', mobile: MOBILE, full_name: 'Fixture User', organization: '', title: '', share_contact_with_peers: false };

async function enterCode(page: Page, scope = page.locator('body')) {
  await scope.getByLabel('Mobile number').fill(MOBILE);
  await scope.getByRole('button', { name: 'Send code' }).click();
  await scope.getByLabel('Code from the SMS').fill(CODE);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
});

async function storeCredentials(page: Page, user = true) {
  await page.evaluate(({ user, userToken }) => {
    if (user) localStorage.setItem('congress_attendee_token', userToken);
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-t04-organizer');
    sessionStorage.setItem('congress_desk_token_event-fixture', 'synthetic-t04-desk');
    localStorage.setItem('congress_attendee_locale', 'en');
  }, { user, userToken });
  // Browser fixture writes the shipping IndexedDB shape; Node cannot import a
  // browser module into the isolated page execution context.
  await page.evaluate(async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const request = indexedDB.open('congress_scanner_tokens', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tokens', { keyPath: 'pointId' });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('tokens', 'readwrite');
      tx.objectStore('tokens').put({ pointId: 'point-fixture', token: 'synthetic-t04-scanner', stored_at: new Date().toISOString() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    await promise;
  });
}

async function fixture(page: Page, options: { saved?: boolean; listStatus?: number; mutationStatus?: number; loginStatus?: number; publicStatus?: number; newNumber?: boolean } = {}) {
  const requests: { path: string; method: string; anonymous: boolean; userOnly: boolean }[] = [];
  let saved = options.saved ?? false;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization;
    requests.push({ path, method: request.method(), anonymous: authorization === undefined, userOnly: authorization === `Bearer ${userToken}` });
    let status = 200;
    let body: unknown = [];
    if (path.startsWith('/api/public/')) { status = options.publicStatus ?? 200; body = status === 404 ? { detail: 'Event not found' } : path.includes('/booths/') ? booth : event; }
    else if (path === '/api/attendees/me/bookmarks/booths') { status = options.listStatus ?? 200; body = status === 401 ? { detail: 'Invalid authorization token' } : saved ? [{ ...booth, booth_id: booth.id, bookmarked_at: '2027-01-01T00:00:00Z' }] : []; }
    else if (path.includes('/bookmarks/booths/')) { status = options.mutationStatus ?? (request.method() === 'POST' ? 201 : 200); saved = request.method() === 'POST'; body = status === 401 ? { detail: 'Invalid authorization token' } : { bookmarked: saved, booth_id: booth.id }; }
    else if (path === '/api/auth/otp/request') { status = 202; body = { mobile: MOBILE, code_length: 6, expires_in: 120, resend_after: 60 }; }
    else if (path === '/api/auth/otp/verify') {
      status = options.loginStatus ?? 200;
      body = status === 401 ? { detail: 'The code is wrong or has expired.' }
        : options.newNumber ? { status: 'profile_required', access_token: null, token_type: 'bearer', user: null, signup_token: 'synthetic-signup' }
        : { status: 'signed_in', access_token: userToken, token_type: 'bearer', user: fixtureUser, signup_token: null };
    }
    else if (path === '/api/auth/otp/complete') { status = 201; body = { access_token: userToken, token_type: 'bearer', user: fixtureUser }; }
    else if (path.endsWith('/tickets/reserve')) { status = 201; body = { id: 'ticket-fixture', event_id: event.id, ticket_tier_id: 'tier-fixture', user_id: 'user-fixture', qr_secret: 'synthetic-ticket-qr', created_at: '2027-01-01T00:00:00Z' }; }
    else if (path.endsWith('/desk/login')) { status = 401; body = { detail: 'The code is wrong or has expired.' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return requests;
}

async function unchangedAlternatives(page: Page) {
  expect(await page.evaluate(() => sessionStorage.getItem('congress_organizer_api_key') === 'synthetic-t04-organizer' && sessionStorage.getItem('congress_desk_token_event-fixture') === 'synthetic-t04-desk')).toBe(true);
}

for (const saved of [false, true]) test(`public Booth ignores optional saved bit; protected list=${saved} and toggles with only User`, async ({ page }) => {
  const requests = await fixture(page, { saved });
  await page.goto('/');
  await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  const button = page.getByRole('button', { name: saved ? 'Saved in Passes' : 'Bookmark Booth' });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('button', { name: saved ? 'Bookmark Booth' : 'Saved in Passes' })).toBeEnabled();
  expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.anonymous)).toBe(true);
  expect(requests.filter(r => r.path.includes('/bookmarks/')).every(r => r.userOnly)).toBe(true);
  expect(requests.some(r => r.method === (saved ? 'DELETE' : 'POST'))).toBe(true);
  await unchangedAlternatives(page);
});

test('expired bookmark list does not fail anonymous public read or use another credential', async ({ page }) => {
  const requests = await fixture(page, { listStatus: 401 });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  await expect(page.getByRole('heading', { name: booth.name })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('401');
  // Development StrictMode mounts effects twice; neither request is an auth retry.
  const initialLists = requests.filter(r => r.path.includes('/bookmarks/')).length;
  expect(initialLists).toBeGreaterThanOrEqual(1);
  expect(initialLists).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Bookmark Booth' }).click();
  await expect(page.getByRole('status')).toContainText('Please sign in');
  expect(requests.filter(r => r.path.includes('/bookmarks/')).length).toBe(initialLists);
  expect(requests.filter(r => r.path.includes('/bookmarks/')).every(r => r.userOnly)).toBe(true);
  await unchangedAlternatives(page);
});

test('unauthorized mutation clears only exact User session without retry or optimistic saved state', async ({ page }) => {
  const requests = await fixture(page, { mutationStatus: 401 });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  await page.getByRole('button', { name: 'Bookmark Booth' }).click();
  await expect(page.getByRole('status')).toContainText('401');
  expect(requests.filter(r => r.method === 'POST').length).toBe(1);
  expect(requests.filter(r => r.method === 'POST').every(r => r.userOnly)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token') === null)).toBe(true);
  await unchangedAlternatives(page);
});

test('public 404 remains visible and anonymous with every credential stored', async ({ page }) => {
  const requests = await fixture(page, { publicStatus: 404 });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/missing');
  await expect(page.getByText('Event not found', { exact: true })).toBeVisible();
  await page.goto('/e/missing/booths/missing');
  await expect(page.getByText('Event not found', { exact: true })).toBeVisible();
  expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.anonymous)).toBe(true);
});

for (const loginStatus of [200, 401]) test(`User SMS sign-in ${loginStatus} is anonymous with all sessions stored; reservation/navigation preserved`, async ({ page }) => {
  const requests = await fixture(page, { loginStatus });
  await page.goto('/e/t04-fixture');
  await page.getByRole('button', { name: /Reserve Free Pass/ }).click();
  await storeCredentials(page);
  await enterCode(page, page.getByRole('dialog'));
  if (loginStatus === 401) {
    await expect(page.getByRole('dialog').getByText('The code is wrong or has expired.')).toBeVisible();
    expect(await page.evaluate(token => localStorage.getItem('congress_attendee_token') === token, userToken)).toBe(true);
    expect(requests.some(r => r.path.endsWith('/tickets/reserve'))).toBe(false);
  } else {
    await expect(page.getByRole('heading', { name: 'Pass Reserved Successfully!' })).toBeVisible();
    expect(requests.filter(r => r.path.endsWith('/tickets/reserve')).every(r => r.userOnly)).toBe(true);
  }
  expect(requests.filter(r => r.path === '/api/auth/otp/verify').length).toBe(1);
  expect(requests.filter(r => r.path.startsWith('/api/auth/otp/')).every(r => r.anonymous)).toBe(true);
  await unchangedAlternatives(page);
  if (loginStatus === 200) {
    await page.getByRole('button', { name: 'Open My Tickets & QR Pass →' }).click();
    await expect(page).toHaveURL(/\/my-tickets$/);
  }
});

test('a new number signs up anonymously with non-User sessions stored and stores the returned User for reservation', async ({ page }) => {
  const requests = await fixture(page, { newNumber: true });
  await page.goto('/e/t04-fixture');
  await page.getByRole('button', { name: /Reserve Free Pass/ }).click();
  await storeCredentials(page, false);
  const dialog = page.getByRole('dialog');
  await enterCode(page, dialog);
  await dialog.getByLabel('Full name').fill('Fixture User');
  await dialog.getByRole('button', { name: 'Create my account' }).click();
  await expect(page.getByRole('heading', { name: 'Pass Reserved Successfully!' })).toBeVisible();
  expect(requests.filter(r => r.path === '/api/auth/otp/complete').length).toBe(1);
  expect(requests.filter(r => r.path.startsWith('/api/auth/otp/')).every(r => r.anonymous)).toBe(true);
  expect(requests.filter(r => r.path.endsWith('/tickets/reserve')).every(r => r.userOnly)).toBe(true);
  await unchangedAlternatives(page);
  await page.getByRole('button', { name: 'Open My Tickets & QR Pass →' }).click();
  await expect(page).toHaveURL(/\/my-tickets$/);
});

test('desk entry 401 is anonymous with credentials populated after form mount', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-fixture/desk');
  await expect(page.getByLabel('Mobile number')).toBeVisible();
  await storeCredentials(page);
  await enterCode(page);
  await expect(page.getByRole('alert')).toContainText('The code is wrong or has expired');
  expect(requests.find(r => r.path === '/api/auth/otp/request')?.anonymous).toBe(true);
  expect(requests.filter(r => r.path.endsWith('/desk/login')).length).toBe(1);
  expect(requests.filter(r => r.path.endsWith('/desk/login')).every(r => r.anonymous)).toBe(true);
  await unchangedAlternatives(page);
});

test('without User session, other stored credentials cannot authorize bookmark mutation', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/'); await storeCredentials(page, false);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  await page.getByRole('button', { name: 'Bookmark Booth' }).click();
  await expect(page.getByRole('status')).toContainText('Please sign in');
  expect(requests.some(r => r.path.includes('/bookmarks/'))).toBe(false);
});

test('late public and saved-state responses cannot replace the next slug/Booth', async ({ page }) => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await fixture(page, { saved: true });
  let listCalls = 0;
  await page.route('**/api/attendees/me/bookmarks/booths', async route => {
    const first = ++listCalls === 1;
    if (first) await release.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(first ? [] : [{ ...booth, booth_id: booth.id }]) });
  });
  await page.route('**/api/public/events/slow/booths/old', async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...booth, name: 'Stale Booth', event_slug: 'slow', id: 'old' }) });
  });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/slow/booths/old');
  await started.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/e/t04-fixture/booths/booth-fixture');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: booth.name })).toBeVisible();
  const lateResponse = page.waitForResponse(response => response.url().includes('/api/public/events/slow/'));
  release.resolve();
  await lateResponse;
  await expect(page.getByRole('heading', { name: 'Stale Booth' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved in Passes' })).toBeEnabled();
});

test('late login after slug change does not reserve the old event or reopen stale dialogs', async ({ page }) => {
  const requests = await fixture(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/auth/otp/verify', async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'signed_in', access_token: userToken, token_type: 'bearer', user: fixtureUser, signup_token: null }) });
  });
  await page.route('**/api/public/events/other', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...event, slug: 'other', name: 'Next Congress' }) });
  });
  await page.goto('/e/t04-fixture');
  await page.getByRole('button', { name: /Reserve Free Pass/ }).click();
  await enterCode(page, page.getByRole('dialog'));
  await started.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/e/other');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Next Congress', exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/otp/verify'));
  release.resolve();
  await lateResponse;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reserve Free Pass/ })).toBeEnabled();
  expect(requests.some(r => r.path.endsWith('/tickets/reserve'))).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token') === null)).toBe(true);
});

// Bookmark session races. Another tab is simulated by writing the shared localStorage entry.
declare global {
  interface Window { __sawSaved?: boolean }
}
const userTokenB = 'synthetic-t04-user-b';
const listPath = '**/api/attendees/me/bookmarks/booths';
const savedList = [{ ...booth, booth_id: booth.id, bookmarked_at: '2027-01-01T00:00:00Z' }];

async function watchSavedState(page: Page) {
  // Records any moment "Saved in Passes" was rendered, even transiently.
  await page.addInitScript(() => {
    const mark = () => { if (document.body?.textContent?.includes('Saved in Passes')) window.__sawSaved = true; };
    new MutationObserver(mark).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}
const sawSaved = (page: Page) => page.evaluate(() => window.__sawSaved === true);
const storedToken = (page: Page) => page.evaluate(() => localStorage.getItem('congress_attendee_token'));
const switchToken = (page: Page, token: string) => page.evaluate(token => localStorage.setItem('congress_attendee_token', token), token);

// Token A's lookup is held until released; token B's lookup answers immediately with an empty list.
async function holdTokenALookup(page: Page, answerA: { status: number; body: unknown }) {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const lookups: { auth: string | undefined; status: number }[] = [];
  await page.route(listPath, async route => {
    const auth = route.request().headers().authorization;
    if (auth === `Bearer ${userToken}`) {
      started.resolve();
      await release.promise;
      lookups.push({ auth, status: answerA.status });
      return route.fulfill({ status: answerA.status, contentType: 'application/json', body: JSON.stringify(answerA.body) });
    }
    lookups.push({ auth, status: 200 });
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  return { started: started.promise, release: release.resolve, lookups };
}

test('R1 delayed saved-state response from token A never appears for token B', async ({ page }) => {
  await fixture(page);
  await watchSavedState(page);
  const held = await holdTokenALookup(page, { status: 200, body: savedList });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  await held.started;
  await expect(page.getByRole('heading', { name: booth.name })).toBeVisible();
  await switchToken(page, userTokenB);
  held.release();
  // A's late response triggers a re-render that reloads the saved state for B.
  await expect.poll(() => held.lookups.some(l => l.auth === `Bearer ${userTokenB}`)).toBe(true);
  await expect(page.getByRole('button', { name: 'Bookmark Booth' })).toBeEnabled();
  expect(await sawSaved(page)).toBe(false);
  expect(await storedToken(page)).toBe(userTokenB);
});

test('R2 delayed 401 for token A cannot delete token B or any other credential', async ({ page }) => {
  await fixture(page);
  await watchSavedState(page);
  const held = await holdTokenALookup(page, { status: 401, body: { detail: 'Invalid authorization token' } });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  await held.started;
  await expect(page.getByRole('heading', { name: booth.name })).toBeVisible();
  await switchToken(page, userTokenB);
  held.release();
  await expect.poll(() => held.lookups.some(l => l.auth === `Bearer ${userTokenB}`)).toBe(true);
  await expect(page.getByRole('button', { name: 'Bookmark Booth' })).toBeEnabled();
  expect(held.lookups.some(l => l.status === 401)).toBe(true);
  expect(await storedToken(page)).toBe(userTokenB);
  await expect(page.getByRole('status')).toHaveCount(0);
  await unchangedAlternatives(page);
});

test('R3 mutation completing after navigation cannot change the next booth', async ({ page }) => {
  const requests = await fixture(page);
  await watchSavedState(page);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const heldMutations: string[] = [];
  await page.route('**/api/attendees/me/bookmarks/booths/booth-x', async route => {
    heldMutations.push(`${route.request().method()} ${route.request().headers().authorization}`);
    started.resolve();
    await release.promise;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ bookmarked: true, booth_id: 'booth-x' }) });
  });
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-x');
  const button = page.getByRole('button', { name: 'Bookmark Booth' });
  await expect(button).toBeEnabled();
  await button.click();
  await started.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/e/t04-fixture/booths/booth-y');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('button', { name: 'Bookmark Booth' })).toBeEnabled();
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/bookmarks/booths/booth-x'));
  release.resolve();
  await lateResponse;
  await expect(page.getByRole('button', { name: 'Bookmark Booth' })).toBeEnabled();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await sawSaved(page)).toBe(false);
  // The request already in flight cannot be recalled; nothing else is dispatched for either booth.
  expect(heldMutations).toEqual([`POST Bearer ${userToken}`]);
  expect(requests.filter(r => r.method === 'POST' || r.method === 'DELETE')).toEqual([]);
  expect(await storedToken(page)).toBe(userToken);
});

test('R4 click after a cross-tab token switch dispatches no mutation with the stale token', async ({ page }) => {
  const requests = await fixture(page);
  await watchSavedState(page);
  await page.goto('/'); await storeCredentials(page);
  await page.goto('/e/t04-fixture/booths/booth-fixture');
  const button = page.getByRole('button', { name: 'Bookmark Booth' });
  await expect(button).toBeEnabled();
  await switchToken(page, userTokenB);
  await button.click();
  await expect(page.getByRole('status')).toContainText('session changed');
  expect(requests.filter(r => r.method === 'POST' || r.method === 'DELETE')).toEqual([]);
  expect(await storedToken(page)).toBe(userTokenB);
  expect(await sawSaved(page)).toBe(false);
  await expect(page.getByRole('button', { name: 'Bookmark Booth' })).toBeEnabled();
  await unchangedAlternatives(page);
});
