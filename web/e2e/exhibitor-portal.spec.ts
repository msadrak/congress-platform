import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Exhibitor pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in EXHIBITOR_PORTAL_MILESTONE_RESULT.md.
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
  control?: { removed: boolean };
}
const REMOVED = { detail: 'You are not authorized to access this booth portal', code: 'BOOTH_STAFF_REQUIRED' };

const BOOTH = (id: string) => ({ id, event_id: id === 'booth-a' ? 'event-1' : 'event-2', name: id === 'booth-a' ? 'Alpha Devices Booth' : 'Beta Labs Booth', slug: id === 'booth-a' ? 'alpha-devices' : 'beta-labs', location: 'Hall 1 · A-12', description: '', website_url: '', brochure_url: '', qr_secret: 'booth-qr', created_at: '2099-01-01T00:00:00Z' });

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
    const active = () => leads[id].filter(l => !l.deleted_at);
    if (rest === '') return json(200, BOOTH(id));
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
  await page.goto('/');
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
const codeInput = (page: Page) => page.getByPlaceholder('e.g. ABC123XYZ...');
const openCapture = (page: Page) => page.getByRole('button', { name: /Capture Lead/ }).first().click();
const saveLead = (page: Page) => page.getByRole('button', { name: 'Save Lead' }).click();

test.describe('entry and access', () => {
  test('signed out: sign-in path returns to the same booth, unsafe destinations are ignored, no Organizer fallback', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page);
    requests.length = 0;
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('heading', { name: 'Exhibitor Staff Sign In' })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole('link', { name: /Sign In to Booth Workspace/ }).click();
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
    await expect(page.getByRole('heading', { name: 'Commercial Access Restricted' })).toBeVisible();
    await expect(page.getByText('Lead One')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in with a different account' })).toHaveAttribute('href', /\/booth\/booth-a\/sign-in/);
    expect(await storedToken(page)).toBe(OUTSIDER);
    expect(requests.every(r => r.auth === bearer(OUTSIDER))).toBe(true);
  });

  test('the workspace names the booth and congress and links the public profile; booth B is not reachable for booth A staff', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Alpha Devices Booth').first()).toBeVisible();
    await expect(page.getByTestId('booth-event')).toContainText('Alpha Congress 2099');
    await expect(page.getByRole('link', { name: 'Public booth profile' })).toHaveAttribute('href', '/e/alpha-congress/booths/booth-a');
    await page.goto('/booth/booth-b');
    await expect(page.getByRole('heading', { name: 'Commercial Access Restricted' })).toBeVisible();
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
  test('scan → confirm who → keep qualification on re-scan → next attendee', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    await openCapture(page);
    await expect(codeInput(page)).toBeFocused();
    await codeInput(page).fill('new-attendee');
    await saveLead(page);
    const result = page.getByTestId('capture-result');
    await expect(result).toContainText('Lead saved.');
    await expect(result).toContainText('Captured new-attendee');
    const scans = () => requests.filter(r => r.path.endsWith('/leads/scan'));
    // Nothing the operator did not choose is sent: the badge alone.
    expect(scans()[0].body).toEqual({ qr_secret: 'new-attendee' });

    // Focus lands on the next step, so Enter continues and a keyboard-wedge reader is not lost.
    await expect(result.getByRole('button', { name: /Next attendee/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(codeInput(page)).toBeFocused();
    // Re-scan with a deliberate rating only.
    await codeInput(page).fill('new-attendee');
    await page.getByRole('dialog').getByRole('button', { name: /Hot/ }).click();
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toContainText('already a lead');
    expect(scans()[1].body).toEqual({ qr_secret: 'new-attendee', rating: 'HOT' });
    expect(scans().length).toBe(2);
    await page.getByTestId('capture-result').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Captured new-attendee')).toHaveCount(1);
  });

  test('invalid and other-congress badges are explained and the typed code is kept', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('bad-code');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('not valid');
    await expect(codeInput(page)).toHaveValue('bad-code');
    await codeInput(page).fill('other-event');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('different congress');
    await expect(page.getByTestId('capture-result')).toHaveCount(0);
  });

  test('a double submit sends one request', async ({ page }) => {
    const requests = await fixture(page, { scanDelayMs: 500 });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('fast-double');
    await page.getByRole('button', { name: 'Save Lead' }).dblclick();
    await expect(page.getByTestId('capture-result')).toBeVisible();
    expect(requests.filter(r => r.path.endsWith('/leads/scan')).length).toBe(1);
  });

  test('a dropped connection claims no success, keeps the code and never retries by itself', async ({ page }) => {
    const requests = await fixture(page, { scanAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('lost-signal');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('not known whether the lead was saved');
    await expect(page.getByTestId('capture-result')).toHaveCount(0);
    await expect(codeInput(page)).toHaveValue('lost-signal');
    await page.waitForTimeout(800);
    expect(requests.filter(r => r.path.endsWith('/leads/scan')).length).toBe(1);
  });

  test('qualify from the list: rating and tag saved, counts follow, failure keeps the form', async ({ page }) => {
    const requests = await fixture(page, { patchAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    const card = page.getByRole('article').filter({ hasText: 'Lead Two' });
    await card.getByRole('button', { name: 'Qualify & Follow Up' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Hot/ }).click();
    await dialog.getByRole('button', { name: 'Save Qualification Changes' }).click();
    await expect(dialog.getByRole('alert')).toContainText('not confirmed');
    await expect(dialog.getByRole('button', { name: /Hot/ })).toBeVisible();

    await page.unrouteAll();
    await fixture(page);
    await dialog.getByRole('button', { name: 'Save Qualification Changes' }).click();
    await expect(dialog.getByText('Lead qualification updated successfully.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByText(/Hot|HOT/).first()).toBeVisible();
    expect(requests.filter(r => r.method === 'PATCH').length).toBe(1);
  });

  test('qualify from the capture result: one dialog at a time, and a typed but un-added tag is saved', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('new-attendee');
    await saveLead(page);
    await page.getByTestId('capture-result').getByRole('button', { name: 'Qualify & Follow Up' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCount(1);
    await expect(dialog.getByRole('heading', { name: /Captured new-attendee/ })).toBeVisible();
    await dialog.getByLabel('Type custom tag and press Enter...').fill('Call Monday');
    await dialog.getByRole('button', { name: 'Save Qualification Changes' }).click();
    await expect(dialog.getByText('Lead qualification updated successfully.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(requests.find(r => r.method === 'PATCH')?.body).toMatchObject({ tags: expect.arrayContaining(['Call Monday']) });
  });

  // Changed with the paged lead list: search and rating now go to the server (`/leads/search`), and the count
  // reads "N of <matching>" plus the booth total, instead of filtering a full list in the browser.
  test('search and rating filters ask the server and keep the booth totals in view', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const searches = () => requests.filter(r => r.path === '/api/booths/booth-a/leads/search' && r.query.get('limit') !== '1');
    await page.getByPlaceholder(/Search/).fill('lead two');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 1 leads')).toBeVisible();
    await expect(page.getByText('2 in this booth')).toBeVisible();
    expect(searches().at(-1)?.query.get('q')).toBe('lead two');
    await page.getByPlaceholder(/Search/).fill('zzz');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('No captured leads match')).toBeVisible();
    await page.getByPlaceholder(/Search/).fill('');
    await page.getByRole('button', { name: /Hot/ }).first().click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 1 leads')).toBeVisible();
    expect(searches().at(-1)?.query.get('rating')).toBe('HOT');
    expect(searches().at(-1)?.query.has('q')).toBe(false);
    // The chips keep the booth-wide counts.
    await expect(page.getByRole('button', { name: /All Ratings/ })).toContainText('2');
  });

  test('CSV export asks only for this booth and downloads its file', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('alpha-devices-leads.csv');
    expect(await readFile(await file.path(), 'utf8')).toContain('Lead One,booth-a');
    expect(requests.filter(r => r.path.includes('export-csv')).map(r => r.path)).toEqual(['/api/booths/booth-a/leads/export-csv']);
    expect(requests.some(r => r.path.includes('booth-b'))).toBe(false);
  });

  test('the lead list failing shows an error with retry and never stale leads', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.route('**/api/booths/booth-a/leads/search*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }));
    await page.goto('/booth/booth-a');
    await expect(page.getByRole('alert').filter({ hasText: 'lead list could not be loaded' })).toBeVisible();
    await expect(page.getByText('Alpha Devices Booth').first()).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
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

  test('opt-in camera decodes one badge into the code field, then releases the camera', async ({ page }) => {
    const requests = await fixture(page);
    await installCamera(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    expect((await state(page)).streams).toBe(0);
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByLabel('Camera preview')).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __code: string }).__code = 'camera-badge'; });
    await expect(codeInput(page)).toHaveValue('camera-badge');
    await expect.poll(async () => (await state(page)).stopped).toBeGreaterThan(0);
    await expect(page.getByLabel('Camera preview')).toBeHidden();
    // Decoding alone captured nothing.
    expect(requests.filter(r => r.path.endsWith('/leads/scan'))).toEqual([]);
    await saveLead(page);
    await expect(page.getByTestId('capture-result')).toContainText('Captured camera-badge');
    expect(requests.filter(r => r.path.endsWith('/leads/scan')).length).toBe(1);
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

  test('closing the dialog stops the camera, including a stream that resolves late', async ({ page }) => {
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
  test('phone: sticky capture button, no horizontal overflow', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);
    const sticky = page.getByRole('button', { name: /Capture Lead/ }).last();
    await expect(sticky).toBeVisible();
    expect((await sticky.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await sticky.click();
    await expect(codeInput(page)).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });

  test('Persian RTL at 320px fits for the workspace, the capture dialog and the sign-in page', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF, 'fa');
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/booth/booth-a');
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByText('Lead One').first()).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.getByRole('button', { name: /ثبت لید/ }).last().click();
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
  const card = (page: Page, name: string) => page.getByRole('article').filter({ hasText: name });

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
    await page.getByPlaceholder(/Search/).fill('Visitor 1');
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
    await page.getByPlaceholder(/Search/).pressSequentially('one', { delay: 40 });
    await expect(page.getByRole('article')).toHaveCount(1);
    await page.waitForTimeout(500);
    expect(pages(requests).slice(before).map(r => r.query.get('q'))).toEqual(['one']);
  });

  test('a lead without a shared mobile says so; one with consent shows its number', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(card(page, 'Lead One').getByTestId('lead-consent')).toHaveText('Contact shared');
    await expect(card(page, 'Lead One').getByRole('link', { name: /Call Lead One/ })).toBeVisible();
    await expect(card(page, 'Lead Two').getByTestId('lead-consent')).toContainText('No consent to share');
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
    await expect(page.getByRole('button', { name: /^Trash/ })).toContainText('1');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(card(page, 'Lead Two')).toBeVisible();
    await expect(toast).toHaveCount(0);
    expect(requests.filter(r => r.method === 'POST' && r.path.endsWith('/restore')).map(r => r.path)).toEqual(['/api/booths/booth-a/leads/lead-2/restore']);
    await expect(page.getByText('Lead Two was restored.').first()).toBeVisible();
  });

  test('trash view lists deleted leads and restores one', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await page.getByTestId('undo-toast').getByRole('button', { name: 'Dismiss' }).click();
    await page.getByRole('button', { name: /^Trash/ }).click();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(card(page, 'Lead Two')).toContainText('Deleted');
    expect(pages(requests).at(-1)?.query.get('state')).toBe('deleted');
    await expect(card(page, 'Lead Two').getByRole('button', { name: /Qualify/ })).toHaveCount(0);
    await card(page, 'Lead Two').getByRole('button', { name: 'Restore lead Lead Two' }).click();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByText('The trash is empty')).toBeVisible();
    await page.getByRole('button', { name: /^Leads/ }).click();
    await expect(card(page, 'Lead Two')).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(2);
  });

  test('export can include deleted leads (include_deleted=true)', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await card(page, 'Lead Two').getByRole('button', { name: 'Delete lead Lead Two' }).click();
    await expect(card(page, 'Lead Two')).toHaveCount(0);
    await page.getByLabel('Include deleted leads').check();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await download;
    expect(await readFile(await file.path(), 'utf8')).toContain('Lead Two,booth-a');
    const exports = requests.filter(r => r.path.endsWith('/export-csv'));
    expect(exports.map(r => r.query.get('include_deleted'))).toEqual(['true']);
    await expect(page.getByText(/including deleted leads/).first()).toBeVisible();

    await page.getByLabel('Include deleted leads').uncheck();
    const plain = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
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
    await page.getByPlaceholder(/Search/).fill('lead');
    await expect(page.getByRole('heading', { name: 'Your access to this booth was removed' })).toBeVisible();
    await expect(page.getByTestId('access-removed')).toContainText('removed you from this booth');
    await expect(page.getByText('Lead One')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Retry/ })).toHaveCount(0);
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

    await openCapture(page);
    await codeInput(page).fill('offline-attendee');
    await page.getByRole('dialog').getByRole('button', { name: /Hot/ }).click();
    await saveLead(page);
    await expect(page.getByTestId('capture-queued')).toContainText('Saved on this device');
    await page.getByTestId('capture-queued').getByRole('button', { name: /Next attendee/ }).click();
    await codeInput(page).fill('bad-code');
    await saveLead(page);
    await expect(page.getByTestId('capture-queued')).toBeVisible();
    await page.getByTestId('capture-queued').getByRole('button', { name: 'Done' }).click();

    const pending = page.getByTestId('pending-sync');
    await expect(pending.getByTestId('pending-scan')).toHaveCount(2);
    await expect(pending).toContainText('offline-attendee');
    await expect(pending).toContainText('Waiting for a connection');
    const scans = () => requests.filter(r => r.path.endsWith('/leads/scan'));
    expect(scans()).toEqual([]);

    // The queue survives a reload (IndexedDB).
    await context.setOffline(false);
    await page.reload();
    // Back online: the good scan is sent with exactly its chosen qualification; the refused one stays, explained.
    await expect(card(page, 'Captured offline-attendee')).toBeVisible();
    await expect(pending.getByTestId('pending-scan')).toHaveCount(1);
    const failed = pending.getByTestId('pending-scan');
    await expect(failed).toHaveAttribute('data-state', 'failed');
    await expect(failed).toContainText('bad-code');
    await expect(failed).toContainText('not valid');
    expect(scans().map(r => r.body)).toEqual(expect.arrayContaining([{ qr_secret: 'offline-attendee', rating: 'HOT' }, { qr_secret: 'bad-code' }]));
    expect(scans().filter(r => (r.body as { qr_secret: string }).qr_secret === 'offline-attendee')).toHaveLength(1);

    await failed.getByRole('button', { name: 'Discard scan bad-code' }).click();
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
    await page.getByTestId('capture-queued').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('pending-scan')).toHaveCount(1);
    await context.setOffline(false);
    await expect(card(page, 'Captured later-attendee')).toBeVisible();
    await expect(page.getByTestId('pending-sync')).toHaveCount(0);
    await expect(page.getByText('1 lead(s) saved on this device were sent.').first()).toBeVisible();
    expect(requests.filter(r => r.path.endsWith('/leads/scan')).map(r => r.body)).toEqual([{ qr_secret: 'later-attendee' }]);
  });

  test('after a dropped connection the operator can keep the scan on the device instead', async ({ page }) => {
    const requests = await fixture(page, { scanAborts: true });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await openCapture(page);
    await codeInput(page).fill('lost-signal');
    await saveLead(page);
    await expect(page.getByRole('alert')).toContainText('not known whether the lead was saved');
    await page.getByRole('button', { name: 'Save on this device and send later' }).click();
    await expect(page.getByTestId('capture-queued')).toBeVisible();
    await page.getByTestId('capture-queued').getByRole('button', { name: 'Done' }).click();
    // Online, so the queue tries at once; the aborted answer leaves it waiting for a backoff retry.
    await expect(page.getByTestId('pending-scan')).toContainText('lost-signal');
    await expect.poll(() => requests.filter(r => r.path.endsWith('/leads/scan')).length).toBeGreaterThanOrEqual(2);
  });
});
