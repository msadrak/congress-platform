import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Shipping pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, type: 'user', exp: 4102444800 })}.synthetic-signature`;
const tokenA = jwt('user-a');
const tokenB = jwt('user-b');
const organizerKey = 'synthetic-t06-organizer';
const deskToken = 'synthetic-t06-desk';
const scannerToken = 'synthetic-t06-scanner';
const bearer = (token: string) => `Bearer ${token}`;

const ownerOf = (auth: string | undefined) => (auth === bearer(tokenB) ? 'B' : 'A');
const ticketOf = (owner: string) => ({ id: `ticket-${owner}`, event_id: 'event-1', event_name: `Event of ${owner}`, event_slug: 't06-fixture', event_location: 'Hall', event_starts_at: '2027-04-10T08:00:00Z', event_ends_at: '2027-04-10T18:00:00Z', ticket_tier_id: 'tier-1', ticket_tier_name: 'General', attendee_name: `Attendee ${owner}`, attendee_mobile: '09121234567', status: 'ACTIVE', qr_secret: `synthetic-qr-${owner}`, created_at: '2027-01-01T00:00:00Z' });
const savedBooth = (owner: string) => ({ booth_id: `booth-saved-${owner}`, name: `Saved Booth ${owner}`, slug: 'saved', location: 'A1', description: 'x', website_url: '', brochure_url: '', event_name: `Event of ${owner}`, event_slug: 't06-fixture', bookmarked_at: '2027-01-01T00:00:00Z' });
const connectionOf = (owner: string) => ({ id: `conn-${owner}`, connected_user_id: `peer-${owner}`, full_name: 'Jane Doe', mobile: null, organization: `Org of ${owner}`, title: 'Dr', event_id: 'event-1', private_notes: `Peer of ${owner}`, created_at: '2027-01-01T00:00:00Z' });
const boothOf = (id: string) => ({ id, event_id: 'event-1', name: `Booth ${id}`, slug: `slug-${id}`, location: 'B1', description: 'x', website_url: '', brochure_url: '', qr_secret: 'synthetic-booth-qr', created_at: '2027-01-01T00:00:00Z' });
const leadOf = (id: string, name = 'Lead One') => ({ id, booth_id: 'booth-1', ticket_id: 'ticket-9', attendee_name: name, attendee_mobile: '09121230000', organization: 'Lead Org', title: 'Buyer', ticket_tier_name: 'General', rating: 'WARM', tags: [], notes: '', created_at: '2027-01-01T00:00:00Z', updated_at: '2027-01-01T00:00:00Z' });
const publicEvent = { id: 'event-1', name: 'T06 Fixture Congress', slug: 't06-fixture', starts_at: '2027-04-10T08:00:00Z', ends_at: '2027-04-10T18:00:00Z', location: 'Fixture Hall', description: 'Synthetic', ticket_tiers: [{ id: 'tier-1', event_id: 'event-1', name: 'General', quota: 100, reserved_count: 0, is_open: true, created_at: '2027-01-01T00:00:00Z' }], venue: [], sessions: [] };

type Recorded = { method: string; path: string; auth: string | undefined };
type Options = { ticketsStatus?: number; noTickets?: boolean; networkStatus?: number; vcardStatus?: number; boothStatus?: number; reserveStatus?: number };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
});

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const auth = request.headers().authorization;
    const method = request.method();
    requests.push({ method, path, auth });
    const owner = ownerOf(auth);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const denied = (status: number) => json(status, { detail: status === 401 ? 'Invalid authorization token' : status === 403 ? 'You are not authorized to access this booth portal' : status === 404 ? 'Not found' : 'Server error' });
    if (path === '/api/public/events/t06-fixture') return json(200, publicEvent);
    if (path === '/api/attendees/me/tickets') return options.ticketsStatus ? denied(options.ticketsStatus) : json(200, options.noTickets ? [] : [ticketOf(owner)]);
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, [savedBooth(owner)]);
    if (path.startsWith('/api/attendees/me/bookmarks/booths/')) return json(200, { bookmarked: false, booth_id: path.split('/').pop() });
    if (path === '/api/attendees/me/network/search') return options.networkStatus ? denied(options.networkStatus) : json(200, { items: [connectionOf(owner)], total: 1, next_cursor: null });
    if (path === '/api/attendees/me/network') return options.networkStatus ? denied(options.networkStatus) : json(200, [connectionOf(owner)]);
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path.endsWith('/vcard')) return options.vcardStatus ? denied(options.vcardStatus) : route.fulfill({ status: 200, contentType: 'text/vcard', body: `BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nNOTE:${owner}\nEND:VCARD\n` });
    if (path.startsWith('/api/attendees/me/network/')) return json(200, { ...connectionOf(owner), private_notes: 'Updated note' });
    if (path.endsWith('/tickets/reserve')) return options.reserveStatus && options.reserveStatus !== 201 ? denied(options.reserveStatus) : json(201, { id: 'ticket-new', event_id: 'event-1', ticket_tier_id: 'tier-1', ticket_tier_name: 'General', attendee_name: 'x', attendee_mobile: '09121239999', status: 'ACTIVE', qr_secret: 'synthetic-qr-new', created_at: '2027-01-01T00:00:00Z' });
    const booth = path.match(/^\/api\/booths\/([^/]+)(\/.*)?$/);
    if (booth) {
      const [, id, rest = ''] = booth;
      if (options.boothStatus) return denied(options.boothStatus);
      if (rest === '') return json(200, boothOf(id));
      if (rest === '/leads/export-csv') return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: 'name,notes\nZoë Müller,café\n' });
      if (rest === '/leads/scan') return json(201, leadOf('lead-new', 'Captured Lead'));
      if (rest === '/leads/search') return json(200, { items: [leadOf('lead-1')], total: 1, next_cursor: null });
      if (rest.startsWith('/leads/')) return json(200, { ...leadOf('lead-1'), rating: 'HOT' });
      if (rest === '/leads') return json(200, [leadOf('lead-1')]);
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

// Every other credential family is stored under its real key; the User token is optional.
async function seed(page: Page, user?: string) {
  // A same-origin static file, not the app: the home page would load its public congress list (an API request) mid-seed.
  await page.goto('/favicon.png');
  await page.evaluate(({ user, organizerKey, deskToken, scannerToken }) => {
    if (user) localStorage.setItem('congress_attendee_token', user);
    sessionStorage.setItem('congress_organizer_api_key', organizerKey);
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
  }, { user, organizerKey, deskToken, scannerToken });
}

async function otherCredentialsIntact(page: Page) {
  const intact = await page.evaluate(({ organizerKey, deskToken, scannerToken }) => new Promise<boolean>(resolve => {
    const sessions = sessionStorage.getItem('congress_organizer_api_key') === organizerKey && sessionStorage.getItem('congress_desk_token_event-a') === deskToken;
    const open = indexedDB.open('congress_scanner_tokens', 1);
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('tokens', 'readonly').objectStore('tokens').get('point-fixture');
      read.onsuccess = () => { db.close(); resolve(sessions && read.result?.token === scannerToken); };
      read.onerror = () => { db.close(); resolve(false); };
    };
  }), { organizerKey, deskToken, scannerToken });
  expect(intact).toBe(true);
}

const storedUser = (page: Page) => page.evaluate(() => localStorage.getItem('congress_attendee_token'));
const switchUser = (page: Page, token: string) => page.evaluate(token => localStorage.setItem('congress_attendee_token', token), token);
const personal = (requests: Recorded[]) => requests.filter(r => !r.path.startsWith('/api/public/'));
const onlyUser = (requests: Recorded[], token: string) => requests.length > 0 && requests.every(r => r.auth === bearer(token));
// Congress panel pages also read the congress's public metadata, always anonymously.
const panelOnlyUser = (requests: Recorded[], token: string) => requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined) && onlyUser(requests.filter(r => !r.path.startsWith('/api/public/')), token);

// Records any moment one of the texts was rendered, even transiently.
async function watchText(page: Page, texts: string[]) {
  await page.addInitScript(texts => {
    const check = () => { for (const text of texts) if (document.body?.textContent?.includes(text)) sessionStorage.setItem(`saw:${text}`, '1'); };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true });
  }, texts);
}
const sawText = (page: Page, text: string) => page.evaluate(text => sessionStorage.getItem(`saw:${text}`) === '1', text);

// Holds the response of a request made under `auth` until released; other requests pass through.
async function hold(page: Page, pathEnd: string, auth: string, status: number, body: unknown, method = 'GET') {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(url => url.pathname.endsWith(pathEnd), async route => {
    if (route.request().method() !== method || route.request().headers().authorization !== auth) return route.fallback();
    started.resolve();
    await release.promise;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { started: started.promise, release: release.resolve };
}

const seedCache = (page: Page, owner: string) => page.evaluate(({ owner, ticket }) => localStorage.setItem(`congress_cached_tickets_user-${owner.toLowerCase()}`, JSON.stringify({ userId: `user-${owner.toLowerCase()}`, cachedAt: Date.now(), expiresAt: Date.now() + 86_400_000, tickets: [ticket] })), { owner, ticket: ticketOf(owner) });

test('without a User token, my congresses, pass, network and booth portal show sign-in and send nothing protected', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  requests.length = 0;
  for (const path of ['/me', '/c/t06-fixture/my-ticket', '/c/t06-fixture/my-network', '/booth/booth-1']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: /Sign In|Sign in|Staff Sign In|Find your pass/ }).first()).toBeVisible();
  }
  // Only the congress's public metadata (the panel header) is read.
  expect(requests.filter(r => !r.path.startsWith('/api/public/'))).toEqual([]);
  await otherCredentialsIntact(page);
});

test('tickets and bookmark removal send only the User token with every other credential stored', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/me');
  await expect(page.getByText('Event of A').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove Bookmark' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'removed' })).toBeVisible();
  expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(['GET /api/attendees/me/tickets', 'GET /api/attendees/me/bookmarks/booths', 'DELETE /api/attendees/me/bookmarks/booths/booth-saved-A']));
  expect(onlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('ticket-list 401 with a valid owner cache keeps the labelled pass, the token and every other session', async ({ page }) => {
  const requests = await fixture(page, { ticketsStatus: 401 });
  await seed(page, tokenA);
  await seedCache(page, 'A');
  requests.length = 0;
  await page.goto('/c/t06-fixture/my-ticket');
  await expect(page.getByText('Event of A').first()).toBeVisible();
  // One status line: the signed-out session (which also says the copy is the saved one).
  await expect(page.getByText('Signed out; showing the saved pass.')).toBeVisible();
  await expect(page.getByTestId('pass-status-line')).toHaveCount(1);
  expect(await storedUser(page)).toBe(tokenA);
  expect(panelOnlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('ticket-list 401 without a cache clears exactly the sent token and shows sign-in', async ({ page }) => {
  const requests = await fixture(page, { ticketsStatus: 401 });
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/c/t06-fixture/my-ticket');
  await expect(page.getByRole('heading', { name: 'Sign in to see your pass' })).toBeVisible();
  await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  expect(await storedUser(page)).toBeNull();
  expect(panelOnlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('ticket-list 500 without a cache shows the error and keeps the session', async ({ page }) => {
  const requests = await fixture(page, { ticketsStatus: 500 });
  await seed(page, tokenA);
  await page.goto('/c/t06-fixture/my-ticket');
  await expect(page.getByRole('alert')).toContainText('Server error');
  expect(await storedUser(page)).toBe(tokenA);
  expect(onlyUser(requests.filter(r => r.path.startsWith('/api/attendees')), tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('R2 a delayed ticket list for token A never appears under token B', async ({ page }) => {
  await fixture(page);
  await watchText(page, ['Event of A']);
  const held = await hold(page, '/api/attendees/me/tickets', bearer(tokenA), 200, [ticketOf('A')]);
  await seed(page, tokenA);
  await page.goto('/c/t06-fixture/my-ticket');
  await held.started;
  await switchUser(page, tokenB);
  held.release();
  await expect(page.getByText('Event of B').first()).toBeVisible();
  expect(await sawText(page, 'Event of A')).toBe(false);
  expect(await storedUser(page)).toBe(tokenB);
});

test('R3 a delayed 401 for token A cannot remove token B', async ({ page }) => {
  await fixture(page);
  const held = await hold(page, '/api/attendees/me/tickets', bearer(tokenA), 401, { detail: 'Invalid authorization token' });
  await seed(page, tokenA);
  await page.goto('/c/t06-fixture/my-ticket');
  await held.started;
  await switchUser(page, tokenB);
  held.release();
  await expect(page.getByText('Event of B').first()).toBeVisible();
  expect(await storedUser(page)).toBe(tokenB);
  await expect(page.getByText('Signed out; showing the saved pass.')).toHaveCount(0);
  await otherCredentialsIntact(page);
});

test('R1 removing a bookmark after the session changed dispatches nothing', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, tokenA);
  await page.goto('/me');
  await expect(page.getByRole('button', { name: 'Remove Bookmark' }).first()).toBeVisible();
  await switchUser(page, tokenB);
  requests.length = 0;
  await page.getByRole('button', { name: 'Remove Bookmark' }).first().click();
  await expect(page.getByText('session changed')).toBeVisible();
  expect(requests.filter(r => r.method === 'DELETE')).toEqual([]);
  expect(await storedUser(page)).toBe(tokenB);
});

test('owner isolation: user B never sees user A cached passes, even when B cannot load', async ({ page }) => {
  await fixture(page, { ticketsStatus: 500 });
  await watchText(page, []);
  await seed(page, tokenA);
  await seedCache(page, 'A');
  await page.goto('/me');
  await expect(page.getByText('Event of A').first()).toBeVisible();
  // The cached pass renders before A's live data; wait for A's bookmarks so the session switch
  // happens after that response (a response for A arriving after the switch is correctly ignored,
  // which would leave no button to click and made this test timing-dependent).
  await expect(page.getByRole('button', { name: /Remove Bookmark/ }).first()).toBeVisible();
  await switchUser(page, tokenB);
  // Any state change re-renders the page, which re-reads the stored session.
  await page.getByRole('button', { name: 'Remove Bookmark' }).first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
  await expect(page.getByText('Event of A')).toHaveCount(0);
  expect(await storedUser(page)).toBe(tokenB);
});

async function openNetwork(page: Page, options: Options = {}) {
  const requests = await fixture(page, options);
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/c/t06-fixture/my-network');
  return requests;
}

test('network list, note update and vCard download send only the User token; vCard bytes and name are preserved', async ({ page }) => {
  const requests = await openNetwork(page);
  await expect(page.getByText('Peer of A').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit note' }).first().click();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Note saved.' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download contact card/ }).first().click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('jane-doe.vcf');
  expect(await readFile(await file.path(), 'utf8')).toBe('BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nNOTE:A\nEND:VCARD\n');
  expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(['GET /api/attendees/me/network/search', 'PATCH /api/attendees/me/network/conn-A', 'GET /api/attendees/me/network/conn-A/vcard']));
  expect(panelOnlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('R6 vCard download after the session changed sends no request and saves no file', async ({ page }) => {
  const requests = await openNetwork(page);
  await expect(page.getByText('Peer of A').first()).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await switchUser(page, tokenB);
  requests.length = 0;
  await page.getByRole('button', { name: /Download contact card/ }).first().click();
  // The blocked click re-renders the page, which reloads the list for the current session (B).
  await expect(page.getByText('Peer of B').first()).toBeVisible();
  expect(requests.filter(r => r.path.endsWith('/vcard'))).toEqual([]);
  expect(personal(requests).every(r => r.auth === bearer(tokenB))).toBe(true);
  expect(downloads).toBe(0);
  expect(await storedUser(page)).toBe(tokenB);
});

test('R6 a vCard response arriving after the session changed is not saved', async ({ page }) => {
  await fixture(page);
  const vcard = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(url => url.pathname.endsWith('/vcard'), async route => {
    vcard.resolve();
    await release.promise;
    await route.fulfill({ status: 200, contentType: 'text/vcard', body: 'BEGIN:VCARD\nEND:VCARD\n' });
  });
  await seed(page, tokenA);
  await page.goto('/c/t06-fixture/my-network');
  await expect(page.getByText('Peer of A').first()).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByRole('button', { name: /Download contact card/ }).first().click();
  await vcard.promise;
  await switchUser(page, tokenB);
  const late = page.waitForResponse(response => response.url().endsWith('/vcard'));
  release.resolve();
  await late;
  await page.waitForTimeout(600);
  expect(downloads).toBe(0);
  expect(await storedUser(page)).toBe(tokenB);
});

test('network 401 clears exactly the sent token; vCard 404 keeps the session and shows the failure', async ({ page }) => {
  const unauthorized = await openNetwork(page, { networkStatus: 401 });
  await expect(page.getByRole('heading', { name: 'Sign In to Attendee Portal' })).toBeVisible();
  expect(await storedUser(page)).toBeNull();
  expect(panelOnlyUser(unauthorized, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('vCard 404 keeps the session and shows the failure', async ({ page }) => {
  const requests = await openNetwork(page, { vcardStatus: 404 });
  await expect(page.getByText('Peer of A').first()).toBeVisible();
  await page.getByRole('button', { name: /Download contact card/ }).first().click();
  await expect(page.getByRole('alert')).toContainText('Failed to download');
  expect(await storedUser(page)).toBe(tokenA);
  expect(panelOnlyUser(requests, tokenA)).toBe(true);
});

test('R2 a delayed network list for token A never appears under token B', async ({ page }) => {
  await fixture(page);
  await watchText(page, ['Peer of A']);
  const held = await hold(page, '/api/attendees/me/network/search', bearer(tokenA), 200, { items: [connectionOf('A')], total: 1, next_cursor: null });
  await seed(page, tokenA);
  await page.goto('/c/t06-fixture/my-network');
  await held.started;
  await switchUser(page, tokenB);
  held.release();
  await expect(page.getByText('Peer of B').first()).toBeVisible();
  expect(await sawText(page, 'Peer of A')).toBe(false);
  expect(await storedUser(page)).toBe(tokenB);
});

/** The booth panel's CSV export is in its ⋮ menu. */
async function exportCsv(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Export CSV', exact: true }).click();
}

test('booth staff workflow: load, capture, qualify and UTF-8 CSV export use only the User token', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/booth/booth-1');
  await expect(page.getByText('Lead One').first()).toBeVisible();
  await page.getByRole('button', { name: 'Capture lead' }).first().click();
  await page.getByLabel('Pass QR code').fill('synthetic-badge');
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByTestId('capture-result').getByText('New lead')).toBeVisible();
  // «Note» closes the capture sheet first; the qualification dialog closes itself after saving.
  await page.getByTestId('capture-result').getByRole('button', { name: 'Note' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Lead updated.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await exportCsv(page);
  const file = await download;
  expect(file.suggestedFilename()).toBe('slug-booth-1-leads.csv');
  expect(await readFile(await file.path(), 'utf8')).toBe('name,notes\nZoë Müller,café\n');
  expect(requests.map(r => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(['GET /api/booths/booth-1', 'GET /api/booths/booth-1/leads/search', 'POST /api/booths/booth-1/leads/scan', 'PATCH /api/booths/booth-1/leads/lead-new', 'GET /api/booths/booth-1/leads/export-csv']));
  expect(onlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('a User without BoothStaff gets 403 without losing the session or borrowing another credential', async ({ page }) => {
  const requests = await fixture(page, { boothStatus: 403 });
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/booth/booth-other');
  await expect(page.getByRole('heading', { name: 'No access to this booth' })).toBeVisible();
  await expect(page.getByText('Lead One')).toHaveCount(0);
  expect(await storedUser(page)).toBe(tokenA);
  expect(onlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('booth 401 clears exactly the sent token and shows sign-in', async ({ page }) => {
  const requests = await fixture(page, { boothStatus: 401 });
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/booth/booth-1');
  await expect(page.getByRole('heading', { name: 'Sign in to the booth' })).toBeVisible();
  expect(await storedUser(page)).toBeNull();
  expect(onlyUser(requests, tokenA)).toBe(true);
  await otherCredentialsIntact(page);
});

test('R4 a delayed booth A response never replaces booth B', async ({ page }) => {
  await fixture(page);
  await watchText(page, ['Stale Booth']);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route('**/api/booths/booth-a', async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...boothOf('booth-a'), name: 'Stale Booth' }) });
  });
  await seed(page, tokenA);
  await page.goto('/booth/booth-a');
  await started.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/booth/booth-b');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByText('Booth booth-b').first()).toBeVisible();
  const late = page.waitForResponse(response => response.url().endsWith('/api/booths/booth-a'));
  release.resolve();
  await late;
  await page.waitForTimeout(400);
  expect(await sawText(page, 'Stale Booth')).toBe(false);
  await expect(page.getByText('Booth booth-b').first()).toBeVisible();
});

test('R6 exporting leads after the session changed sends no request', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, tokenA);
  await page.goto('/booth/booth-1');
  await expect(page.getByText('Lead One').first()).toBeVisible();
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await switchUser(page, tokenB);
  requests.length = 0;
  await exportCsv(page);
  await expect(page.getByText('session changed')).toBeVisible();
  // The blocked click re-renders the page, which reloads the booth for the current session (B).
  expect(requests.filter(r => r.path.endsWith('/export-csv'))).toEqual([]);
  expect(requests.every(r => r.auth === bearer(tokenB))).toBe(true);
  expect(downloads).toBe(0);
  expect(await storedUser(page)).toBe(tokenB);
});

test('account switch: user B never sees user A leads, and B is denied without a fallback', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/booths/booth-1**', async route => {
    if (route.request().headers().authorization === bearer(tokenB)) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'You are not authorized to access this booth portal' }) });
    }
    return route.fallback();
  });
  await seed(page, tokenA);
  await page.goto('/booth/booth-1');
  await expect(page.getByText('Lead One').first()).toBeVisible();
  await switchUser(page, tokenB);
  await exportCsv(page);
  await expect(page.getByRole('heading', { name: 'No access to this booth' })).toBeVisible();
  await expect(page.getByText('Lead One')).toHaveCount(0);
  expect(await storedUser(page)).toBe(tokenB);
});

test('ticket reservation sends only the User token and shows success', async ({ page }) => {
  // Users without a pass for this congress yet: a held pass turns the dock into "View My Pass".
  const requests = await fixture(page, { noTickets: true });
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/e/t06-fixture');
  await page.getByRole('button', { name: /Reserve free pass/ }).click();
  await expect(page.getByRole('heading', { name: 'Your pass is ready' })).toBeVisible();
  const reserve = requests.filter(r => r.path.endsWith('/tickets/reserve'));
  expect(reserve).toHaveLength(1);
  expect(reserve[0].auth).toBe(bearer(tokenA));
  expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined)).toBe(true);
  await otherCredentialsIntact(page);
});

test('reservation 401 clears exactly the sent token and reopens sign-in', async ({ page }) => {
  const requests = await fixture(page, { reserveStatus: 401, noTickets: true });
  await seed(page, tokenA);
  requests.length = 0;
  await page.goto('/e/t06-fixture');
  await page.getByRole('button', { name: /Reserve free pass/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Your session has expired');
  expect(await storedUser(page)).toBeNull();
  expect(requests.filter(r => r.path.endsWith('/tickets/reserve')).map(r => r.auth)).toEqual([bearer(tokenA)]);
  await otherCredentialsIntact(page);
});

test('R2 a reservation answered after the session changed shows no success for the new session', async ({ page }) => {
  await fixture(page, { noTickets: true });
  await watchText(page, ['Your pass is ready']);
  const held = await hold(page, '/tickets/reserve', bearer(tokenA), 201, { id: 'ticket-new', event_id: 'event-1', ticket_tier_id: 'tier-1', ticket_tier_name: 'General', attendee_name: 'x', attendee_mobile: '09121239999', status: 'ACTIVE', qr_secret: 'synthetic-qr-new', created_at: '2027-01-01T00:00:00Z' }, 'POST');
  await seed(page, tokenA);
  await page.goto('/e/t06-fixture');
  await page.getByRole('button', { name: /Reserve free pass/ }).click();
  await held.started;
  await switchUser(page, tokenB);
  const late = page.waitForResponse(response => response.url().endsWith('/tickets/reserve'));
  held.release();
  await late;
  await page.waitForTimeout(500);
  expect(await sawText(page, 'Your pass is ready')).toBe(false);
  expect(await storedUser(page)).toBe(tokenB);
});

test('account switch: user A leads are not shown to user B when B leads cannot load', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/booths/booth-1/leads/search*', async route => {
    if (route.request().headers().authorization === bearer(tokenB)) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Server error' }) });
    }
    return route.fallback();
  });
  await seed(page, tokenA);
  await page.goto('/booth/booth-1');
  await expect(page.getByText('Lead One').first()).toBeVisible();
  await switchUser(page, tokenB);
  await exportCsv(page);
  await expect(page.getByText('Booth booth-1').first()).toBeVisible();
  await expect(page.getByText('Lead One')).toHaveCount(0);
  expect(await storedUser(page)).toBe(tokenB);
});
