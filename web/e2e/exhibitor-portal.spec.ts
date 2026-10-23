import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

// Shipping Exhibitor pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is web/e2e-live/exhibitor.spec.ts.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (sub: string) => `${b64({ alg: 'HS256' })}.${b64({ sub, type: 'user', exp: 4102444800 })}.sig`;
const STAFF = jwt('staff-a');
const OUTSIDER = jwt('outsider');
const NEW_STAFF = jwt('staff-a-new');
const ORGANIZER_KEY = 'synthetic-ms05-organizer';
const bearer = (token: string) => `Bearer ${token}`;

interface FixtureLead { id: string; booth_id: string; ticket_id: string; attendee_name: string; attendee_mobile: string | null; organization: string; title: string; ticket_tier_name: string; rating: string; tags: string[]; notes: string; created_at: string; updated_at: string; deleted_at: string | null }
const leadOf = (id: string, booth: string, name: string, rating = 'WARM', notes = ''): FixtureLead => ({ id, booth_id: booth, ticket_id: `ticket-${id}`, attendee_name: name, attendee_mobile: '09121231111', organization: 'Heart Center', title: 'Cardiologist', ticket_tier_name: 'General', rating, tags: [], notes, created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z', deleted_at: null });

type Recorded = { method: string; path: string; query: URLSearchParams; auth: string | undefined; body: unknown };
interface Options {
  scanAborts?: boolean;
  scanDelayMs?: number;
  patchAborts?: boolean;
  /** Further booth-a leads ("Visitor 01" …), older than the two named ones. */
  extraLeads?: number;
  /** Flip `removed` to answer booth-a calls with 403 BOOTH_STAFF_REQUIRED, as for a removed representative. */
  control?: { removed: boolean; suspended?: boolean; archived?: boolean };
  /** Stand name shown in the menu. */
  boothLocation?: string;
  /** `GET /api/booths/{id}` says the congress is archived (BoothOut.event_archived). */
  eventArchived?: boolean;
}
const REMOVED = { detail: 'You are not authorized to access this booth portal', code: 'BOOTH_STAFF_REQUIRED' };
const SUSPENDED = { detail: 'Booth access for this congress is suspended', code: 'BOOTH_ACCESS_SUSPENDED' };
const ARCHIVED = { detail: 'This congress is archived: its leads are read-only', code: 'EVENT_ARCHIVED' };

const BOOTH = (id: string) => ({ id, event_id: id === 'booth-a' ? 'event-1' : 'event-2', name: id === 'booth-a' ? 'Alpha Devices Booth' : 'Beta Labs Booth', slug: id === 'booth-a' ? 'alpha-devices' : 'beta-labs', location: 'Hall 1 · A-12', description: '', website_url: '', brochure_url: '', qr_secret: 'booth-qr', created_at: '2099-01-01T00:00:00Z', event_archived: false });

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const leads: Record<string, FixtureLead[]> = {
    'booth-a': [leadOf('lead-1', 'booth-a', 'Lead One', 'HOT', 'Wants a demo'), leadOf('lead-2', 'booth-a', 'Lead Two', 'COLD')],
    'booth-b': [leadOf('lead-9', 'booth-b', 'Secret Competitor Lead')],
  };
  // Lead Two did not share its mobile with exhibitors (the API then sends null).
  leads['booth-a'][1].attendee_mobile = null;
  for (let n = 1; n <= (options.extraLeads ?? 0); n++) {
    const extra = leadOf(`lead-x${n}`, 'booth-a', `Visitor ${String(n).padStart(2, '0')}`, ['HOT', 'WARM', 'COLD'][n % 3]);
    extra.created_at = new Date(Date.UTC(2098, 0, 1) - n * 60_000).toISOString();
    leads['booth-a'].push(extra);
  }
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const auth = request.headers().authorization;
    const raw = request.postData();
    requests.push({ method, path, query: url.searchParams, auth, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/auth/otp/request') return json(202, { mobile: JSON.parse(raw ?? '{}').mobile, code_length: 6, expires_in: 120, resend_after: 60 });
    if (path === '/api/auth/otp/verify') {
      const body = JSON.parse(raw ?? '{}') as { mobile: string; code: string };
      if (body.code !== CODE) return json(401, { detail: 'The code is wrong or has expired.' });
      const user = { id: 'u', mobile: body.mobile, full_name: 'Rep', organization: '', title: '', share_contact_with_peers: false };
      return json(200, { status: 'signed_in', access_token: body.mobile === OUTSIDER_MOBILE ? OUTSIDER : STAFF, token_type: 'bearer', user, signup_token: null });
    }
    if (path === '/api/auth/me') return json(200, { id: 'u', mobile: STAFF_MOBILE, full_name: 'Rep', organization: '', title: '', share_contact_with_peers: false });
    const isStaff = auth === bearer(STAFF) || auth === bearer(NEW_STAFF);
    if (path === '/api/me/access') {
      if (!auth) return json(401, { detail: 'Missing authorization token' });
      return json(200, { user_id: 'u', events: isStaff ? [{ event_id: 'event-1', event_slug: 'alpha-congress', event_name: 'Alpha Congress 2099', roles: ['BOOTH_STAFF'], ticket_ids: [], desk_operator_ids: [], booth_ids: ['booth-a'], partner_ids: [] }] : [] });
    }
    if (path === '/api/booths/me') return json(200, isStaff && !options.control?.removed ? [BOOTH('booth-a')] : []);
    const booth = path.match(/^\/api\/booths\/([^/]+)(\/.*)?$/);
    if (!booth) return json(404, { detail: 'Not found' });
    const [, id, rest = ''] = booth;
    if (!auth) return json(401, { detail: 'Missing authorization token' });
    if (!isStaff || id !== 'booth-a') return json(403, { detail: 'You are not authorized to access this booth portal' });
    if (options.control?.removed) return json(403, REMOVED);
    if (options.control?.suspended) return json(403, SUSPENDED);
    // An archived congress: lead changes are refused, reads, search and export stay open.
    if (options.control?.archived && (rest === '/leads/scan' || (/^\/leads\/[^/]+(\/restore)?$/.test(rest) && method !== 'GET'))) return json(409, ARCHIVED);
    const active = () => leads[id].filter(l => !l.deleted_at);
    if (rest === '') return json(200, { ...BOOTH(id), ...(options.boothLocation ? { location: options.boothLocation } : {}), ...(options.eventArchived ? { event_archived: true } : {}) });
    if (rest === '/leads' && method === 'GET') return json(200, active());
    if (rest === '/leads/search' && method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const rating = url.searchParams.get('rating');
      const state = url.searchParams.get('state') ?? 'active';
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const cursor = url.searchParams.get('cursor');
      if (cursor !== null && !/^\d+$/.test(cursor)) return json(400, { detail: 'Invalid page cursor', code: 'CURSOR_INVALID' });
      const matching = leads[id]
        .filter(l => (state === 'all' ? true : state === 'deleted' ? Boolean(l.deleted_at) : !l.deleted_at))
        .filter(l => !rating || l.rating === rating)
        .filter(l => !q || [l.attendee_name, l.organization, l.title, l.notes].join(' ').toLowerCase().includes(q) || (l.attendee_mobile ?? '').includes(q))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const start = Number(cursor ?? 0);
      const items = matching.slice(start, start + limit);
      return json(200, { items, total: matching.length, next_cursor: start + limit < matching.length ? String(start + limit) : null });
    }
    if (rest === '/leads/export-csv') {
      const rows = url.searchParams.get('include_deleted') === 'true' ? leads[id] : active();
      return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: `lead,booth\n${rows.map(l => `${l.attendee_name},${id}`).join('\n')}\n` });
    }
    const restore = rest.match(/^\/leads\/([^/]+)\/restore$/);
    if (restore && method === 'POST') {
      const found = leads[id].find(l => l.id === restore[1]);
      if (!found) return json(404, { detail: 'Lead not found', code: 'LEAD_NOT_FOUND' });
      found.deleted_at = null;
      return json(200, found);
    }
    if (rest === '/leads/scan') {
      if (options.scanDelayMs) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, options.scanDelayMs);
        await promise;
      }
      if (options.scanAborts) return route.abort('failed');
      const body = JSON.parse(raw ?? '{}') as { qr_secret: string; rating?: string; tags?: string[]; notes?: string };
      if (body.qr_secret === 'bad-code') return json(404, { detail: 'Invalid or unrecognized attendee badge QR' });
      if (body.qr_secret === 'other-event') return json(400, { detail: 'Attendee ticket is for a different event' });
      const known = leads[id].find(l => l.ticket_id === `ticket-${body.qr_secret}`);
      if (known) {
        known.deleted_at = null;
        if (body.rating) known.rating = body.rating;
        if (body.tags) known.tags = body.tags;
        if (body.notes) known.notes = body.notes;
        return json(200, known);
      }
      const created = leadOf(`lead-${leads[id].length + 10}`, id, `Captured ${body.qr_secret}`, body.rating ?? 'WARM', body.notes ?? '');
      created.ticket_id = `ticket-${body.qr_secret}`;
      created.created_at = '2099-06-01T00:00:00Z';
      leads[id].unshift(created);
      return json(201, created);
    }
    const patch = rest.match(/^\/leads\/([^/]+)$/);
    if (patch && method === 'DELETE') {
      const found = leads[id].find(l => l.id === patch[1]);
      if (!found) return json(404, { detail: 'Lead not found', code: 'LEAD_NOT_FOUND' });
      found.deleted_at ??= '2099-01-02T00:00:00Z';
      return route.fulfill({ status: 204 });
    }
    if (patch && method === 'PATCH') {
      if (options.patchAborts) return route.abort('failed');
      const found = leads[id].find(l => l.id === patch[1]);
      if (!found) return json(404, { detail: 'Lead not found' });
      Object.assign(found, JSON.parse(raw ?? '{}'));
      return json(200, found);
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, token?: string, locale = 'en') {
  // A same-origin static file, not the app: the home page would load its public congress list (an API request) mid-seed.
  await page.goto('/favicon.png');
  await page.evaluate(({ token, locale, key }) => {
    localStorage.setItem('congress_attendee_locale', locale);
    sessionStorage.setItem('congress_organizer_api_key', key);
    if (token) localStorage.setItem('congress_attendee_token', token);
  }, { token: token ?? '', locale, key: ORGANIZER_KEY });
}
const storedToken = (page: Page) => page.evaluate(() => localStorage.getItem('congress_attendee_token'));
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const CODE = '482913';
const STAFF_MOBILE = '09121112222';
const OUTSIDER_MOBILE = '09129990000';
async function signInWithCode(page: Page, mobile = STAFF_MOBILE) {
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code from the SMS').fill(CODE);
}
const codeInput = (page: Page) => page.getByLabel('Pass QR code');
const openCapture = (page: Page) => page.getByRole('button', { name: 'Capture lead' }).first().click();
const saveLead = (page: Page) => page.getByRole('button', { name: 'Save lead' }).click();
const scansOf = (requests: Recorded[]) => requests.filter(r => r.path.endsWith('/leads/scan'));
const card = (page: Page, name: string) => page.getByRole('article').filter({ hasText: name });
const menuItem = async (page: Page, name: string) => {
  await page.getByRole('button', { name: /^(Menu|منو)$/ }).click();
  return page.getByRole('menuitem', { name, exact: true });
};
/** A barcode gun: the whole code within milliseconds, then Enter. */
const gunScan = async (page: Page, code: string) => {
  await page.keyboard.type(code, { delay: 4 });
  await page.keyboard.press('Enter');
};
const pill = (page: Page) => page.getByRole('banner').locator('[data-status]');
/** Opens the collapsed pending-queue row. */
const expandPending = async (page: Page) => {
  const toggle = page.getByTestId('pending-sync').locator('button[aria-expanded]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
};

test.describe('entry and access', () => {
  test('signed out: sign-in path returns to the same booth, unsafe destinations are ignored, no Organizer fallback', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page);
    requests.length = 0;
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('heading', { name: 'Sign in to the booth' })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/booth\/booth-a\/sign-in\?next=%2Fbooth%2Fbooth-a$/);
    await expect(page.getByRole('heading', { name: 'Sign in to your booth workspace' })).toBeVisible();
    await signInWithCode(page);
    await expect(page).toHaveURL(/\/booth\/booth-a$/);
    await expect(page.getByText('Lead One').first()).toBeVisible();
    expect(requests.find(r => r.path === '/api/auth/otp/verify')?.auth).toBeUndefined();
    expect(requests.filter(r => r.path.startsWith('/api/booths/')).every(r => r.auth === bearer(STAFF))).toBe(true);
    expect(requests.some(r => r.auth === bearer(ORGANIZER_KEY))).toBe(false);

    await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    for (const next of ['/organizer', 'https://evil.example/', '//evil.example', '/booth/booth-a/../../organizer']) {
      await page.goto(`/booth/booth-a/sign-in?next=${encodeURIComponent(next)}`);
      await signInWithCode(page);
      await expect(page).toHaveURL(/\/booth\/booth-a$/);
      await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    }
  });

  test('a signed-in User without BoothStaff is denied, keeps the session and sees no leads', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, OUTSIDER);
    requests.length = 0;
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('heading', { name: 'No access to this booth' })).toBeVisible();
    await expect(page.getByText('Lead One')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in with another account' })).toHaveAttribute('href', /\/booth\/booth-a\/sign-in/);
    expect(await storedToken(page)).toBe(OUTSIDER);
    expect(requests.every(r => r.auth === bearer(OUTSIDER))).toBe(true);
  });

  test('the bar names the booth and congress, the menu links the public profile and records the launch; booth B is not reachable', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('heading', { level: 1, name: 'Alpha Devices Booth' })).toBeVisible();
    await expect(page.getByRole('banner')).toContainText('Alpha Congress 2099');
    // The home-screen icon reopens this booth.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('congress_operator_launch') ?? 'null')?.path)).toBe('/booth/booth-a');
    await (await menuItem(page, 'Public booth profile')).click();
    await expect(page).toHaveURL(/\/e\/alpha-congress\/booths\/booth-a$/);
    await page.goto('/booth/booth-b');
    await expect(page.getByRole('heading', { name: 'No access to this booth' })).toBeVisible();
    await expect(page.getByText('Secret Competitor Lead')).toHaveCount(0);
    await expect(page.getByText('Alpha Devices Booth')).toHaveCount(0);
  });

  test('a delayed 401 for an old token cannot remove a newer session', async ({ page }) => {
    await fixture(page);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route('**/api/booths/booth-a/leads/search*', async route => {
      if (route.request().headers().authorization !== bearer(STAFF)) return route.fallback();
      started.resolve();
      await release.promise;
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid authorization token' }) });
    });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await started.promise;
    await page.evaluate(token => localStorage.setItem('congress_attendee_token', token), NEW_STAFF);
    const late = page.waitForResponse(r => r.url().includes('/booth-a/leads/search') && r.status() === 401);
    release.resolve();
    await late;
    await page.waitForTimeout(400);
    expect(await storedToken(page)).toBe(NEW_STAFF);
  });
});

test.describe('capture and qualification', () => {
  test('a typed code saves at once; the result rates in one tap; a re-scan keeps the rating; next attendee', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await openCapture(page);
    // A desktop pointer: the code field is open and focused for a keyboard or a gun.
    await expect(codeInput(page)).toBeFocused();
    await codeInput(page).fill('new-attendee');
    await saveLead(page);
    const result = page.getByTestId('capture-result');
    await expect(result).toContainText('New lead');
    await expect(result).toContainText('Captured new-attendee');
    // Nothing the operator did not choose is sent: the badge alone.
    expect(scansOf(requests)[0].body).toEqual({ qr_secret: 'new-attendee' });

    // Focus lands on «Next», so Enter continues and a keyboard-wedge reader is not lost.
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(codeInput(page)).toBeFocused();
    await codeInput(page).fill('new-attendee');
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toContainText('Already a lead');
    expect(scansOf(requests)[1].body).toEqual({ qr_secret: 'new-attendee' });
    // One tap on a rating chip saves it.
    await page.getByRole('dialog').getByRole('button', { name: /High/ }).click();
    await expect.poll(() => requests.filter(r => r.method === 'PATCH').map(r => r.body)).toEqual([{ rating: 'HOT' }]);
    await expect(page.getByRole('dialog').getByRole('button', { name: /High/ })).toHaveAttribute('aria-pressed', 'true');
    expect(scansOf(requests).length).toBe(2);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(card(page, 'Captured new-attendee')).toHaveCount(1);
    await expect(card(page, 'Captured new-attendee')).toContainText('High');
  });

  test('invalid and other-congress badges show a red result, and «Next» goes on', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('bad-code');
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toHaveAttribute('data-result', 'invalid');
    await expect(page.getByRole('alert')).toContainText('Invalid code');
    await page.getByRole('button', { name: 'Next' }).click();
    await codeInput(page).fill('other-event');
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toHaveAttribute('data-result', 'other');
    await expect(page.getByRole('alert')).toContainText('Other congress');
  });

  test('a double submit sends one request', async ({ page }) => {
    const requests = await fixture(page, { scanDelayMs: 500 });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('fast-double');
    await page.getByRole('button', { name: 'Save lead' }).dblclick();
    await expect(page.getByTestId('capture-result')).toBeVisible();
    expect(scansOf(requests).length).toBe(1);
  });

  test('a dropped connection claims no success, keeps the code and never retries by itself', async ({ page }) => {
    const requests = await fixture(page, { scanAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('lost-signal');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('Connection lost');
    await expect(page.getByTestId('capture-result')).toHaveCount(0);
    await expect(codeInput(page)).toHaveValue('lost-signal');
    await page.waitForTimeout(800);
    expect(scansOf(requests).length).toBe(1);
  });

  test('qualify from the list: tapping the card opens it, rating saved, counts follow, failure keeps the form', async ({ page }) => {
    const requests = await fixture(page, { patchAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Lead Two', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Lead Two' });
    await dialog.getByRole('button', { name: /High/ }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Connection lost');
    await expect(dialog.getByRole('button', { name: /High/ })).toHaveAttribute('aria-pressed', 'true');

    await page.unrouteAll();
    await fixture(page);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Lead updated.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, 'Lead Two')).toContainText('High');
    expect(requests.filter(r => r.method === 'PATCH').length).toBe(1);
  });

  test('«Note» on the capture result: one dialog at a time, and a typed but un-added tag is saved', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('new-attendee');
    await saveLead(page);
    await page.getByTestId('capture-result').getByRole('button', { name: 'Note' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole('heading', { name: 'Captured new-attendee' })).toBeVisible();
    await dialog.getByLabel('New tag').fill('Call Monday');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Lead updated.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(requests.find(r => r.method === 'PATCH')?.body).toMatchObject({ tags: expect.arrayContaining(['Call Monday']) });
  });

  test('search and rating filters ask the server and keep the booth totals in view', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const searches = () => requests.filter(r => r.path === '/api/booths/booth-a/leads/search' && r.query.get('limit') !== '1');
    await page.getByPlaceholder('Name, mobile or organization').fill('lead two');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 1 leads')).toBeVisible();
    await expect(page.getByText('2 in this booth')).toBeVisible();
    expect(searches().at(-1)?.query.get('q')).toBe('lead two');
    await page.getByPlaceholder('Name, mobile or organization').fill('zzz');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('No matching leads')).toBeVisible();
    await page.getByPlaceholder('Name, mobile or organization').fill('');
    await page.getByRole('button', { name: /High/ }).first().click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 1 leads')).toBeVisible();
    expect(searches().at(-1)?.query.get('rating')).toBe('HOT');
    expect(searches().at(-1)?.query.has('q')).toBe(false);
    // The chips keep the booth-wide counts.
    await expect(page.getByRole('button', { name: /^All/ })).toContainText('2');
  });

  test('CSV export from the menu asks only for this booth and downloads its file', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await (await menuItem(page, 'Export CSV')).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('alpha-devices-leads.csv');
    expect(await readFile(await file.path(), 'utf8')).toContain('Lead One,booth-a');
    expect(requests.filter(r => r.path.includes('export-csv')).map(r => r.path)).toEqual(['/api/booths/booth-a/leads/export-csv']);
    expect(requests.some(r => r.path.includes('booth-b'))).toBe(false);
    await expect(page.getByTestId('toast')).toContainText('Download started.');
  });

  test('the lead list failing shows an error with retry and never stale leads', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.route('**/api/booths/booth-a/leads/search*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }));
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('alert').filter({ hasText: 'lead list could not be loaded' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Alpha Devices Booth').first()).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
  });
});

test.describe('fast capture (ops WP-F)', () => {
  test('390×844: the first lead card starts above 400 px, in both languages', async ({ page }) => {
    await fixture(page);
    for (const locale of ['fa', 'en']) {
      await seed(page, STAFF, locale);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/booth/booth-a');
      const first = page.getByRole('article').first();
      await expect(first).toBeVisible();
      expect((await first.boundingBox())!.y).toBeLessThan(400);
      expect(await overflow(page)).toBe(0);
    }
  });

  test('a gun scan with nothing open captures directly: one POST, the result says «New lead»', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await gunScan(page, 'qrsecretgun00001abcdefghij');
    await expect(page.getByTestId('capture-result')).toContainText('New lead');
    await expect(page.getByTestId('capture-result')).toContainText('Captured qrsecretgun00001abcdefghij');
    expect(scansOf(requests).map(r => r.body)).toEqual([{ qr_secret: 'qrsecretgun00001abcdefghij' }]);
    // The next visitor's gun scan, straight from the result.
    await gunScan(page, 'qrsecretgun00002abcdefghij');
    await expect(page.getByTestId('capture-result')).toContainText('Captured qrsecretgun00002abcdefghij');
    expect(scansOf(requests)).toHaveLength(2);
  });

  test('offline: the status pill in the bar says so', async ({ page, context }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await expect(pill(page)).toHaveAttribute('data-status', 'online');
    await context.setOffline(true);
    await expect(pill(page)).toHaveAttribute('data-status', 'offline');
    await expect(pill(page)).toBeInViewport();
    await expect(pill(page)).toContainText('Offline');
    await context.setOffline(false);
  });

  test('the pending queue never shows a full badge code, only its last four characters', async ({ page, context }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await context.setOffline(true);
    await gunScan(page, 'qrsecretlead0001abcdefghij');
    await expect(page.getByTestId('capture-queued')).toContainText('Saved offline');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(pill(page)).toContainText('1 queued');
    await expandPending(page);
    const row = page.getByTestId('pending-scan');
    await expect(row).toContainText('…ghij');
    await expect(row.getByRole('button', { name: 'Discard scan …ghij' })).toBeVisible();
    const screen = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[aria-label],[title]')].map(e => `${e.getAttribute('aria-label')} ${e.getAttribute('title')}`).join(' '));
    expect(screen).not.toMatch(/qrsecret[a-z0-9]{8,}/);
    await context.setOffline(false);
  });

  test('copy: no «(Rating)», «(CSV)», «کیوآر», «پیشخوان», «پرتال» or «✓» on the Persian booth screens', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF, 'fa');
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const banned = /\(Rating\)|\(CSV\)|کیوآر|پیشخوان|پرتال|✓/;
    expect(await page.locator('body').innerText()).not.toMatch(banned);
    await page.getByRole('button', { name: 'منو' }).click();
    expect(await page.locator('body').innerText()).not.toMatch(banned);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'ثبت لید' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(banned);
    await page.keyboard.press('Escape');
    await card(page, 'Lead Two').getByRole('button', { name: 'Lead Two', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Lead Two' })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(banned);
  });

  test('lead times read on the congress clock with Persian digits', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF, 'fa');
    await page.goto('/booth/booth-a');
    // 2099-01-01T00:00Z is 03:30 in Tehran.
    await expect(card(page, 'Lead One').getByTestId('lead-time')).toContainText('۰۳:۳۰');
    await expect(card(page, 'Lead One').getByTestId('lead-time')).not.toContainText(/[0-9]/);
  });
});

test.describe('touch phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('the capture sheet focuses no field (the keyboard would cover the camera) and holds the screen awake', async ({ page }) => {
    await fixture(page);
    await page.addInitScript(() => {
      const w = window as unknown as { __wakeLocks: number };
      w.__wakeLocks = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: { request: async () => { w.__wakeLocks += 1; return { released: false, release: async () => undefined }; } },
      });
    });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await page.getByTestId('capture-dock').getByRole('button', { name: 'Capture lead' }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toMatch(/INPUT|TEXTAREA/);
    await expect(codeInput(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wakeLocks: number }).__wakeLocks)).toBeGreaterThan(0);
    // «Enter code» opens the field without focusing it for the keyboard.
    await page.getByRole('button', { name: 'Enter code' }).tap();
    await expect(codeInput(page)).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  });
});

test.describe('camera input', () => {
  const installCamera = (page: Page) => page.addInitScript(() => {
    const w = window as unknown as { __stopped: number; __streams: number; __deny: boolean; __code: string; __holdGum: (() => void) | null };
    w.__stopped = 0; w.__streams = 0; w.__deny = false; w.__code = ''; w.__holdGum = null;
    const makeStream = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      setInterval(() => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 64); }, 30);
      const stream = canvas.captureStream(15);
      w.__streams += 1;
      stream.getTracks().forEach(track => { const orig = track.stop.bind(track); track.stop = () => { w.__stopped += 1; orig(); }; });
      return stream;
    };
    navigator.mediaDevices.getUserMedia = async () => {
      if (w.__deny) throw new DOMException('denied', 'NotAllowedError');
      if (w.__holdGum) await new Promise<void>(resolve => { w.__holdGum = resolve; });
      return makeStream();
    };
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class { async detect() { return w.__code ? [{ rawValue: w.__code }] : []; } };
  });
  const state = (page: Page) => page.evaluate(() => { const w = window as unknown as { __stopped: number; __streams: number }; return { stopped: w.__stopped, streams: w.__streams }; });

  test('a decoded badge is saved at once, and the camera is released', async ({ page }) => {
    const requests = await fixture(page);
    await installCamera(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    // A desktop pointer and no granted permission: the camera waits for the button.
    expect((await state(page)).streams).toBe(0);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __code: string }).__code = 'camera-badge'; });
    await expect(page.getByTestId('capture-result')).toContainText('Captured camera-badge');
    await expect.poll(async () => (await state(page)).stopped).toBeGreaterThan(0);
    expect(scansOf(requests).map(r => r.body)).toEqual([{ qr_secret: 'camera-badge' }]);
  });

  test.describe('on a phone with camera permission granted', () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test('one tap: the camera starts by itself and a decode saves the lead', async ({ page, context }) => {
      const requests = await fixture(page);
      await installCamera(page);
      await context.grantPermissions(['camera']);
      await seed(page, STAFF);
      await page.goto('/booth/booth-a');
      await expect(page.getByText('Lead One').first()).toBeVisible();
      await page.getByTestId('capture-dock').getByRole('button', { name: 'Capture lead' }).tap();
      await expect(page.getByLabel('Camera preview')).toBeVisible();
      await page.evaluate(() => { (window as unknown as { __code: string }).__code = 'one-tap-badge'; });
      await expect(page.getByTestId('capture-result')).toContainText('New lead');
      expect(scansOf(requests).map(r => r.body)).toEqual([{ qr_secret: 'one-tap-badge' }]);
    });
  });

  test('denied permission falls back to manual entry', async ({ page }) => {
    await fixture(page);
    await installCamera(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await page.evaluate(() => { (window as unknown as { __deny: boolean }).__deny = true; });
    await openCapture(page);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
    await codeInput(page).fill('manual-after-denial');
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toContainText('Captured manual-after-denial');
  });

  test('closing the sheet stops the camera, including a stream that resolves late', async ({ page }) => {
    await fixture(page);
    await installCamera(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await state(page)).stopped).toBeGreaterThan(0);

    const before = (await state(page)).stopped;
    await page.evaluate(() => { (window as unknown as { __holdGum: (() => void) | null }).__holdGum = () => undefined; });
    await openCapture(page);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(() => { const w = window as unknown as { __holdGum: (() => void) | null }; w.__holdGum?.(); w.__holdGum = null; });
    await expect.poll(async () => (await state(page)).stopped).toBeGreaterThan(before);
  });
});

test.describe('layout and language', () => {
  test('phone: the capture dock, no horizontal overflow', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);
    const dock = page.getByTestId('capture-dock').getByRole('button', { name: 'Capture lead' });
    await expect(dock).toBeInViewport();
    expect((await dock.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await dock.click();
    await expect(codeInput(page)).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });

  test('a long stand name never squeezes the booth code at 390 px, in both languages', async ({ page }) => {
    await fixture(page, { boothLocation: 'Main Exhibition Hall, North Wing, Second Floor, Stand A-12 beside the café' });
    for (const locale of ['en', 'fa']) {
      await seed(page, STAFF, locale);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/booth/booth-a');
      await page.getByRole('button', { name: /^(Menu|منو)$/ }).click();
      const code = page.getByTestId('booth-code');
      await expect(code).toHaveText('alpha-devices');
      const box = (await code.boundingBox())!;
      const lineHeight = await code.evaluate(el => parseFloat(getComputedStyle(el).lineHeight) || 21);
      expect(box.height).toBeLessThanOrEqual(lineHeight * 1.5);
      expect(await overflow(page)).toBe(0);
      await page.keyboard.press('Escape');
    }
  });

  test('server errors without a known code reach Persian readers in Persian, never as English detail', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF, 'fa');
    await page.route('**/api/booths/booth-a/leads/search*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }));
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('alert').filter({ hasText: 'فهرست لیدها بارگذاری نشد.' })).toBeVisible();
    await expect(page.getByText('Server error')).toHaveCount(0);
  });

  test('Persian RTL at 320px fits for the panel, the capture sheet and the sign-in page', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF, 'fa');
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/booth/booth-a');
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByText('Lead One').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByRole('button', { name: 'ثبت لید' }).last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    await page.goto('/booth/booth-a/sign-in');
    await expect(page.getByRole('heading', { name: 'ورود به فضای کاری غرفه' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
});

test.describe('paged list, trash and offline capture', () => {
  const pages = (requests: Recorded[]) => requests.filter(r => r.path === '/api/booths/booth-a/leads/search' && r.query.get('limit') !== '1');

  test('search with load more: pages by cursor, counts "N of total", stacks at 390 px', async ({ page }) => {
    const requests = await fixture(page, { extraLeads: 43 });
    await seed(page, STAFF);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('article')).toHaveCount(20);
    await expect(page.getByText('Showing 20 of 45 leads')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByRole('button', { name: /Load more leads/ }).click();
    await expect(page.getByRole('article')).toHaveCount(40);
    expect(pages(requests).at(-1)?.query.get('cursor')).toBe('20');
    await page.getByRole('button', { name: /Load more leads/ }).click();
    await expect(page.getByRole('article')).toHaveCount(45);
    await expect(page.getByText('Showing 45 of 45 leads')).toBeVisible();
    await expect(page.getByRole('button', { name: /Load more leads/ })).toHaveCount(0);

    // A new search starts again from the first page, without a cursor.
    await page.getByPlaceholder('Name, mobile or organization').fill('Visitor 1');
    await expect(page.getByText('Showing 10 of 10 leads')).toBeVisible();
    const last = pages(requests).at(-1)!;
    expect(last.query.get('q')).toBe('Visitor 1');
    expect(last.query.has('cursor')).toBe(false);
    expect(await overflow(page)).toBe(0);
  });

  test('typing is debounced into one search request', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const before = pages(requests).length;
    await page.getByPlaceholder('Name, mobile or organization').pressSequentially('one', { delay: 40 });
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(pages(requests).slice(before).map(r => r.query.get('q'))).toEqual(['one']);
  });

  test('a lead without a shared mobile says «Number hidden»; one with consent shows its number', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(card(page, 'Lead One').getByRole('link', { name: /Call Lead One/ })).toBeVisible();
    await expect(card(page, 'Lead One').getByTestId('lead-number-hidden')).toHaveCount(0);
    await expect(card(page, 'Lead Two').getByTestId('lead-number-hidden')).toHaveText('Number hidden');
    await expect(card(page, 'Lead Two').getByRole('link', { name: /Call/ })).toHaveCount(0);
  });

  test('delete then undo: DELETE, the card leaves with an undo toast, undo restores it', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await expect(card(page, 'Lead Two')).toHaveCount(0);
    const toast = page.getByTestId('undo-toast');
    await expect(toast).toContainText('Lead Two moved to the trash.');
    expect(requests.filter(r => r.method === 'DELETE').map(r => r.path)).toEqual(['/api/booths/booth-a/leads/lead-2']);
    await expect(page.getByRole('radio', { name: /^Trash/ })).toContainText('1');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(card(page, 'Lead Two')).toBeVisible();
    await expect(toast).toHaveCount(0);
    expect(requests.filter(r => r.method === 'POST' && r.path.endsWith('/restore')).map(r => r.path)).toEqual(['/api/booths/booth-a/leads/lead-2/restore']);
    await expect(page.getByTestId('toast')).toContainText('Lead Two was restored.');
  });

  test('trash view lists deleted leads and restores one', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await page.getByTestId('undo-toast').getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: /^Trash/ }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(card(page, 'Lead Two')).toContainText('Deleted');
    expect(pages(requests).at(-1)?.query.get('state')).toBe('deleted');
    // A deleted lead is not opened for qualification.
    await expect(card(page, 'Lead Two').getByRole('button', { name: 'Lead Two', exact: true })).toHaveCount(0);
    await card(page, 'Lead Two').getByRole('button', { name: 'Restore lead Lead Two' }).click();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('The trash is empty')).toBeVisible();
    await page.getByRole('radio', { name: /^Leads/ }).click();
    await expect(card(page, 'Lead Two')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(2);
  });

  test('export can include deleted leads (include_deleted=true)', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await expect(card(page, 'Lead Two')).toHaveCount(0);
    const download = page.waitForEvent('download');
    await (await menuItem(page, 'Export CSV with deleted')).click();
    const file = await download;
    expect(await readFile(await file.path(), 'utf8')).toContain('Lead Two,booth-a');
    const exports = requests.filter(r => r.path.endsWith('/export-csv'));
    expect(exports.map(r => r.query.get('include_deleted'))).toEqual(['true']);

    const plain = page.waitForEvent('download');
    await (await menuItem(page, 'Export CSV')).click();
    expect(await readFile(await (await plain).path(), 'utf8')).not.toContain('Lead Two');
    expect(requests.filter(r => r.path.endsWith('/export-csv')).at(-1)?.query.has('include_deleted')).toBe(false);
  });

  test('a representative removed mid-session sees a clear screen, and nothing retries', async ({ page }) => {
    const control = { removed: false };
    const requests = await fixture(page, { control });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    control.removed = true;
    await page.getByPlaceholder('Name, mobile or organization').fill('lead');
    await expect(page.getByRole('heading', { name: 'Your access to this booth was removed' })).toBeVisible();
    await expect(page.getByText('Contact the organizer if this is a mistake.')).toBeVisible();
    await expect(page.getByText('Lead One')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Try again/ })).toHaveCount(0);
    expect(await storedToken(page)).toBe(STAFF);
    const after = requests.filter(r => r.path.startsWith('/api/booths/booth-a')).length;
    await page.waitForTimeout(1500);
    expect(requests.filter(r => r.path.startsWith('/api/booths/booth-a')).length).toBe(after);
  });

  test('offline capture is queued on the device, shown as pending, and synced when back online', async ({ page, context }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    // What needs the server is disabled while offline; capture stays available (it queues).
    await expect(card(page, 'Lead One').getByRole('button', { name: 'Delete lead Lead One' })).toBeDisabled();
    await expect(await menuItem(page, 'Export CSV')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    await openCapture(page);
    await codeInput(page).fill('offline-attendee');
    await saveLead(page);
    const queued = page.getByTestId('capture-queued');
    await expect(queued).toContainText('Saved offline');
    // A rating chosen on the result travels with the waiting scan.
    await queued.getByRole('button', { name: /High/ }).click();
    await expect(queued.getByRole('button', { name: /High/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Next' }).click();
    await codeInput(page).fill('bad-code');
    await saveLead(page);
    await expect(page.getByTestId('capture-queued')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    const pending = page.getByTestId('pending-sync');
    await expect(pending).toContainText('2 waiting to send');
    await expandPending(page);
    await expect(pending.getByTestId('pending-scan')).toHaveCount(2);
    await expect(pending).toContainText('…ndee');
    await expect(pending).not.toContainText('offline-attendee');
    await expect(pending).toContainText('Waiting for a connection');
    expect(scansOf(requests)).toEqual([]);

    // The queue survives leaving the page (IndexedDB). The page is left while still offline, so it cannot
    // start sending before it is gone.
    await page.goto('about:blank');
    await context.setOffline(false);
    await page.goto('/booth/booth-a');
    // Back online: the good scan is sent with exactly its chosen rating; the refused one stays, explained.
    await expect(card(page, 'Captured offline-attendee')).toBeVisible();
    await expandPending(page);
    await expect(pending.getByTestId('pending-scan')).toHaveCount(1);
    const failed = pending.getByTestId('pending-scan');
    await expect(failed).toHaveAttribute('data-state', 'failed');
    await expect(failed).toContainText('…code');
    await expect(failed).toContainText('Invalid pass QR code.');
    expect(scansOf(requests).map(r => r.body)).toEqual(expect.arrayContaining([{ qr_secret: 'offline-attendee', rating: 'HOT' }, { qr_secret: 'bad-code' }]));
    expect(scansOf(requests).filter(r => (r.body as { qr_secret: string }).qr_secret === 'offline-attendee')).toHaveLength(1);

    await failed.getByRole('button', { name: 'Discard scan …code' }).click();
    await expect(pending).toHaveCount(0);
  });

  test('going back online without a reload sends the queue at once', async ({ page, context }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await context.setOffline(true);
    await openCapture(page);
    await codeInput(page).fill('later-attendee');
    await saveLead(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('pending-sync')).toContainText('1 waiting to send');
    await context.setOffline(false);
    await expect(card(page, 'Captured later-attendee')).toBeVisible();
    await expect(page.getByTestId('pending-sync')).toHaveCount(0);
    await expect(page.getByTestId('toast')).toContainText('1 saved lead(s) sent.');
    expect(scansOf(requests).map(r => r.body)).toEqual([{ qr_secret: 'later-attendee' }]);
  });

  test('after a dropped connection the operator can keep the scan on the device instead', async ({ page }) => {
    const requests = await fixture(page, { scanAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('lost-signal');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('Connection lost');
    await page.getByRole('button', { name: 'Save on this device' }).click();
    await expect(page.getByTestId('capture-queued')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    // Online, so the queue tries at once; the aborted answer leaves it waiting for a backoff retry.
    await expandPending(page);
    await expect(page.getByTestId('pending-scan')).toContainText('…gnal');
    await expect.poll(() => scansOf(requests).length).toBeGreaterThanOrEqual(2);
  });
});

test.describe('suspended organizer and archived congress', () => {
  const boothCalls = (requests: Recorded[]) => requests.filter(r => r.path.startsWith('/api/booths/booth-a')).length;

  async function queueOffline(page: Page, context: BrowserContext, code: string) {
    await context.setOffline(true);
    await openCapture(page);
    await codeInput(page).fill(code);
    await saveLead(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('pending-sync')).toContainText('1 waiting to send');
  }

  test('a suspended organizer: a final screen from the first load, nothing retries', async ({ page }) => {
    const requests = await fixture(page, { control: { removed: false, suspended: true } });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('heading', { name: 'Booth temporarily unavailable' })).toBeVisible();
    await expect(page.getByText('Access is paused. Contact the organizer.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No access to this booth' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Try again|Capture lead/ })).toHaveCount(0);
    expect(await storedToken(page)).toBe(STAFF);
    const after = boothCalls(requests);
    await page.waitForTimeout(1500);
    expect(boothCalls(requests)).toBe(after);
  });

  test('suspended mid-session while scans wait offline: the screen keeps the unsent count, sync stops', async ({ page, context }) => {
    const control = { removed: false, suspended: false };
    const requests = await fixture(page, { control });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await queueOffline(page, context, 'waiting-attendee');
    control.suspended = true;
    await context.setOffline(false);
    await expect(page.getByRole('heading', { name: 'Booth temporarily unavailable' })).toBeVisible();
    await expect(page.getByTestId('access-suspended')).toContainText('1 unsent scan(s) remain on this device');
    const scans = scansOf(requests).length;
    expect(scans).toBe(1);
    await page.waitForTimeout(1500);
    expect(scansOf(requests).length).toBe(scans);
  });

  test('event_archived from the booth: no capture dock or button, pill «Archived», a gun scan sends nothing; search and export work', async ({ page }) => {
    const requests = await fixture(page, { eventArchived: true });
    await seed(page, STAFF);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/booth/booth-a');
      await expect(page.getByText('Lead One').first()).toBeVisible();
      await expect(pill(page)).toHaveAttribute('data-status', 'archived');
      await expect(pill(page)).toContainText('Archived');
      await expect(page.getByTestId('capture-dock')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Capture lead' })).toHaveCount(0);
    }
    await expect(page.getByTestId('archived-notice')).toContainText('Archived: view and export only.');
    await expect(card(page, 'Lead One').getByRole('button', { name: 'Delete lead Lead One' })).toBeDisabled();
    await expect(card(page, 'Lead One').getByRole('button', { name: 'Lead One', exact: true })).toHaveCount(0);
    await gunScan(page, 'qrsecretlate0001abcdefghij');
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(scansOf(requests)).toEqual([]);

    await page.getByPlaceholder('Name, mobile or organization').fill('lead one');
    await expect(page.getByRole('article')).toHaveCount(1);
    const download = page.waitForEvent('download');
    await (await menuItem(page, 'Export CSV')).click();
    expect(await readFile(await (await download).path(), 'utf8')).toContain('Lead One,booth-a');
  });

  test('archived after loading (409 on a change): exhibitor wording, changes disabled, the dock goes', async ({ page }) => {
    const requests = await fixture(page, { control: { removed: false, archived: true } });
    await seed(page, STAFF);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/booth/booth-a');
    await expect(page.getByTestId('capture-dock')).toBeVisible();
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await expect(page.getByTestId('archived-notice')).toContainText('Archived: view and export only.');
    await expect(page.getByRole('alert')).toContainText("leads can't be captured or changed");
    // The shared organizer wording for EVENT_ARCHIVED is not shown to exhibitors.
    await expect(page.getByText('Unarchive it')).toHaveCount(0);
    await expect(card(page, 'Lead Two')).toBeVisible();
    await expect(card(page, 'Lead One').getByRole('button', { name: 'Delete lead Lead One' })).toBeDisabled();
    await expect(page.getByTestId('capture-dock')).toHaveCount(0);
    await expect(pill(page)).toHaveAttribute('data-status', 'archived');
    expect(requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
  });

  test('an archived congress in Persian reads exhibitor wording', async ({ page }) => {
    await fixture(page, { eventArchived: true });
    await seed(page, STAFF, 'fa');
    await page.goto('/booth/booth-a');
    await expect(page.getByTestId('archived-notice')).toContainText('همایش بایگانی شده؛ فقط مشاهده و خروجی ممکن است.');
    await expect(pill(page)).toContainText('بایگانی‌شده');
  });

  test('scans queued offline meet an archived congress: kept, marked archived, never retried', async ({ page, context }) => {
    const control = { removed: false, archived: false };
    const requests = await fixture(page, { control });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await queueOffline(page, context, 'late-attendee');
    control.archived = true;
    await context.setOffline(false);
    await expect(page.getByTestId('archived-notice')).toBeVisible();
    await expandPending(page);
    const item = page.getByTestId('pending-scan');
    await expect(item).toHaveAttribute('data-state', 'failed');
    await expect(item).toContainText('The congress is archived; this scan is not sent.');
    const scans = () => scansOf(requests).length;
    expect(scans()).toBe(1);
    await page.waitForTimeout(2500);
    expect(scans()).toBe(1);
    await expect(item).toHaveCount(1);
  });
});
