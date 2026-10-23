import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { wireManifest } from './scannerFixtures';

// Shipping /scan/:pointId page + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// Offline reload, queue and reconciliation behavior stays covered by scanner-offline.spec.ts.
const POINT_ID = 'test-point-authority';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const SCANNER_TOKEN = `e30.${tokenPayload}.scanner-signature`;
const userToken = 'synthetic-t08-user';
const organizerKey = 'synthetic-t08-organizer';
const deskToken = 'synthetic-t08-desk';
const bearer = (token: string) => `Bearer ${token}`;

const MANIFEST = {
  checkin_point: { id: POINT_ID, name: 'Authority Gate', location: 'Main', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null },
  tickets: [{ qr_secret: 'ticket-a-001', ticket_id: 't1', attendee_name: 'Alice', ticket_tier_id: 'tier-general', ticket_tier_name: 'General', is_admitted: false, admission_count: 0 }],
};

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
type Options = { manifestStatus?: number; revokeStatus?: number };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path, auth: request.headers().authorization, body: request.postDataJSON() });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/manifest')) return options.manifestStatus ? json(options.manifestStatus, { detail: 'Scanner device token has been revoked' }) : json(200, wireManifest(MANIFEST));
    if (path.endsWith('/scans/batch')) {
      const posted = request.postDataJSON() as { scans: { scan_id: string; qr_secret: string }[] };
      return json(200, { results: posted.scans.map(s => ({ scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'ADMITTED', attendee_name: 'Alice', ticket_tier_name: 'General' })) });
    }
    if (path.endsWith('/scan')) {
      const posted = request.postDataJSON() as { scan_id: string; qr_secret: string };
      return json(200, { scan_id: posted.scan_id, qr_secret: posted.qr_secret, status: 'ADMITTED', attendee_name: 'Alice', ticket_tier_name: 'General', clock_skew: false });
    }
    if (path.endsWith('/devices/self/revoke')) return options.revokeStatus ? json(options.revokeStatus, { detail: 'Server error' }) : json(200, { is_revoked: true });
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seedHumanSessions(page: Page) {
  await page.goto('/');
  await page.evaluate(({ userToken, organizerKey, deskToken }) => {
    localStorage.setItem('congress_attendee_token', userToken);
    sessionStorage.setItem('congress_organizer_api_key', organizerKey);
    sessionStorage.setItem('congress_desk_token_event-a', deskToken);
  }, { userToken, organizerKey, deskToken });
}

async function injectScan(page: Page, scanId: string) {
  await page.evaluate(({ pointId, scanId }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('congress_scanner_db');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('queued_scans', 'readwrite');
      tx.objectStore('queued_scans').put({ scan_id: scanId, point_id: pointId, qr_secret: 'ticket-a-001', attendee_name: 'Alice', status: 'ADMITTED', sync_state: 'PROVISIONAL', scanned_at: '2027-01-01T10:00:00.000Z' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { pointId: POINT_ID, scanId });
}

const scanCount = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const open = indexedDB.open('congress_scanner_db');
  open.onerror = () => resolve(-1);
  open.onsuccess = () => {
    const count = open.result.transaction('queued_scans', 'readonly').objectStore('queued_scans').count();
    count.onsuccess = () => resolve(count.result);
    count.onerror = () => resolve(-1);
  };
}));

const storedScannerToken = (page: Page) => page.evaluate(pointId => new Promise<string | null>(resolve => {
  const open = indexedDB.open('congress_scanner_tokens', 1);
  open.onerror = () => resolve(null);
  open.onsuccess = () => {
    const get = open.result.transaction('tokens', 'readonly').objectStore('tokens').get(pointId);
    get.onsuccess = () => resolve(get.result?.token ?? null);
    get.onerror = () => resolve(null);
  };
}), POINT_ID);

async function pair(page: Page) {
  await page.goto(`/scan/${POINT_ID}?token=${SCANNER_TOKEN}`);
  await expect(page.getByText('Authority Gate')).toBeVisible();
}

async function unpair(page: Page) {
  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
}

test('manifest, batch and self-revoke send only the scanner token, with the device verdict and unchanged URL', async ({ page }) => {
  const requests = await fixture(page);
  await seedHumanSessions(page);
  requests.length = 0;
  await pair(page);
  await injectScan(page, 'authority-scan-001');
  await unpair(page);
  await expect(page.getByText(/Server revocation confirmed/i)).toBeVisible({ timeout: 15000 });
  const paths = requests.map(r => `${r.method} ${r.path.replace(POINT_ID, ':point')}`);
  expect(paths).toEqual(expect.arrayContaining(['GET /api/checkin-points/:point/manifest', 'POST /api/checkin-points/:point/scans/batch', 'POST /api/checkin-points/:point/devices/self/revoke']));
  expect(requests.every(r => r.auth === bearer(SCANNER_TOKEN))).toBe(true);
  const batch = requests.find(r => r.path.endsWith('/scans/batch'));
  expect(batch?.body).toEqual({
    scans: [{ scan_id: 'authority-scan-001', qr_secret: 'ticket-a-001', scanned_at: '2027-01-01T10:00:00.000Z', client_verdict: 'PROVISIONAL', client_rejection_reason: null }],
  });
  expect(page.url()).toContain(`/scan/${POINT_ID}`);
  // Revocation confirmed: the device token is gone, and so is the uploaded scan history.
  expect(await storedScannerToken(page)).toBeNull();
  expect(await scanCount(page)).toBe(0);
});

test('without a scanner credential no request is sent and human sessions are never attached', async ({ page }) => {
  const requests = await fixture(page);
  await seedHumanSessions(page);
  requests.length = 0;
  await page.goto(`/scan/${POINT_ID}`);
  await expect(page.getByText(/Pair this scanner with a valid device token/i)).toBeVisible();
  // A queued scan makes the background sync try to send; with no device credential it must not.
  await injectScan(page, 'authority-scan-003');
  await page.waitForTimeout(6500);
  expect(requests).toEqual([]);
  expect(await scanCount(page)).toBe(1);
});

test('a revoked device (401) blocks admissions and never retries with another credential', async ({ page }) => {
  const requests = await fixture(page, { manifestStatus: 401 });
  await seedHumanSessions(page);
  requests.length = 0;
  await page.goto(`/scan/${POINT_ID}?token=${SCANNER_TOKEN}`);
  await expect(page.getByText(/revoked/i).first()).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(r => r.auth === bearer(SCANNER_TOKEN))).toBe(true);
  expect(await storedScannerToken(page)).toBe(SCANNER_TOKEN);
});

test('failed self-revoke keeps the credential and the scan records and sends only the scanner token', async ({ page }) => {
  const requests = await fixture(page, { revokeStatus: 500 });
  await seedHumanSessions(page);
  requests.length = 0;
  await pair(page);
  await injectScan(page, 'authority-scan-002');
  await unpair(page);
  await expect(page.getByText(/server revocation was not confirmed \(HTTP 500\)/i)).toBeVisible({ timeout: 15000 });
  expect(await storedScannerToken(page)).toBe(SCANNER_TOKEN);
  expect(await scanCount(page)).toBe(1);
  const revoke = requests.filter(r => r.path.endsWith('/devices/self/revoke'));
  expect(revoke).toHaveLength(1);
  expect(requests.every(r => r.auth === bearer(SCANNER_TOKEN))).toBe(true);
});
