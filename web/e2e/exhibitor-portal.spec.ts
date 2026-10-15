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

interface FixtureLead { id: string; booth_id: string; ticket_id: string; attendee_name: string; attendee_mobile: string | null; organization: string; title: string; ticket_tier_name: string; rating: string; tags: string[]; notes: string; created_at: string; updated_at: string }
const leadOf = (id: string, booth: string, name: string, rating = 'WARM', notes = ''): FixtureLead => ({ id, booth_id: booth, ticket_id: `ticket-${id}`, attendee_name: name, attendee_mobile: '09121231111', organization: 'Heart Center', title: 'Cardiologist', ticket_tier_name: 'General', rating, tags: [], notes, created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' });

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  scanAborts?: boolean;
  scanDelayMs?: number;
  patchAborts?: boolean;
}

const BOOTH = (id: string) => ({ id, event_id: id === 'booth-a' ? 'event-1' : 'event-2', name: id === 'booth-a' ? 'Alpha Devices Booth' : 'Beta Labs Booth', slug: id === 'booth-a' ? 'alpha-devices' : 'beta-labs', location: 'Hall 1 · A-12', description: '', website_url: '', brochure_url: '', qr_secret: 'booth-qr', created_at: '2099-01-01T00:00:00Z' });

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const leads: Record<string, FixtureLead[]> = {
    'booth-a': [leadOf('lead-1', 'booth-a', 'Lead One', 'HOT', 'Wants a demo'), leadOf('lead-2', 'booth-a', 'Lead Two', 'COLD')],
    'booth-b': [leadOf('lead-9', 'booth-b', 'Secret Competitor Lead')],
  };
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const auth = request.headers().authorization;
    const raw = request.postData();
    requests.push({ method, path, auth, body: raw ? JSON.parse(raw) : undefined });
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
    const booth = path.match(/^\/api\/booths\/([^/]+)(\/.*)?$/);
    if (!booth) return json(404, { detail: 'Not found' });
    const [, id, rest = ''] = booth;
    if (!auth) return json(401, { detail: 'Missing authorization token' });
    if (!isStaff || id !== 'booth-a') return json(403, { detail: 'You are not authorized to access this booth portal' });
    if (rest === '') return json(200, BOOTH(id));
    if (rest === '/leads' && method === 'GET') return json(200, leads[id]);
    if (rest === '/leads/export-csv') return route.fulfill({ status: 200, contentType: 'text/csv; charset=utf-8', body: `lead,booth\n${leads[id].map(l => `${l.attendee_name},${id}`).join('\n')}\n` });
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
        if (body.rating) known.rating = body.rating;
        if (body.tags) known.tags = body.tags;
        if (body.notes) known.notes = body.notes;
        return json(200, known);
      }
      const created = leadOf(`lead-${leads[id].length + 10}`, id, `Captured ${body.qr_secret}`, body.rating ?? 'WARM', body.notes ?? '');
      created.ticket_id = `ticket-${body.qr_secret}`;
      leads[id].unshift(created);
      return json(201, created);
    }
    const patch = rest.match(/^\/leads\/([^/]+)$/);
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
const openCapture = (page: Page) => page.getByRole('button', { name: /Capture Attendee Lead/ }).first().click();
const saveLead = (page: Page) => page.getByRole('button', { name: 'Record Lead to Booth CRM' }).click();

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
    await expect(page.getByRole('heading', { name: 'Commercial Access Restricted (403)' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Commercial Access Restricted (403)' })).toBeVisible();
    await expect(page.getByText('Secret Competitor Lead')).toHaveCount(0);
    await expect(page.getByText('Alpha Devices Booth')).toHaveCount(0);
  });

  test('a delayed 401 for an old token cannot remove a newer session', async ({ page }) => {
    await fixture(page);
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await page.route('**/api/booths/booth-a/leads', async route => {
      if (route.request().headers().authorization !== bearer(STAFF)) return route.fallback();
      started.resolve();
      await release.promise;
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Invalid authorization token' }) });
    });
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await started.promise;
    await page.evaluate(token => localStorage.setItem('congress_attendee_token', token), NEW_STAFF);
    const late = page.waitForResponse(r => r.url().endsWith('/booth-a/leads') && r.status() === 401);
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
    await expect(result).toContainText('Attendee lead captured successfully.');
    await expect(result).toContainText('Captured new-attendee');
    const scans = () => requests.filter(r => r.path.endsWith('/leads/scan'));
    // Nothing the operator did not choose is sent: the badge alone.
    expect(scans()[0].body).toEqual({ qr_secret: 'new-attendee' });

    await result.getByRole('button', { name: /Next attendee/ }).click();
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
    await page.getByRole('button', { name: 'Record Lead to Booth CRM' }).dblclick();
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

  test('search and rating filters narrow the list without hiding the booth totals or sending another request', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const before = requests.length;
    await page.getByPlaceholder(/Search/).fill('lead two');
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByText('Showing 1 of 2 leads')).toBeVisible();
    await page.getByPlaceholder(/Search/).fill('zzz');
    await expect(page.getByRole('article')).toHaveCount(0);
    await page.getByPlaceholder(/Search/).fill('');
    await page.getByRole('button', { name: /Hot/ }).first().click();
    await expect(page.getByRole('article')).toHaveCount(1);
    expect(requests.length).toBe(before);
    await expect(page.getByText('Showing 1 of 2 leads')).toBeVisible();
  });

  test('CSV export asks only for this booth and downloads its file', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page, STAFF);
    await page.goto('/booth/booth-a');
    await expect(page.getByText('Lead One').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CRM CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('alpha-devices-leads.csv');
    expect(await readFile(await file.path(), 'utf8')).toContain('Lead One,booth-a');
    expect(requests.filter(r => r.path.includes('export-csv')).map(r => r.path)).toEqual(['/api/booths/booth-a/leads/export-csv']);
    expect(requests.some(r => r.path.includes('booth-b'))).toBe(false);
  });

  test('the lead list failing shows an error with retry and never stale leads', async ({ page }) => {
    await fixture(page);
    await seed(page, STAFF);
    await page.route('**/api/booths/booth-a/leads', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Server error"}' }));
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
    const sticky = page.getByRole('button', { name: /Capture Attendee Lead/ }).last();
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
    await page.getByRole('button', { name: /ثبت|مشتری/ }).last().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    await page.goto('/booth/booth-a/sign-in');
    await expect(page.getByRole('heading', { name: 'ورود به فضای کاری غرفه' })).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
});
