import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL. The real-backend scanner
// journey is scripts/integration/congress-e2e.mjs.
const POINT_ID = 'rapid-point-001';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.rapid-signature`;

const MANIFEST = {
  checkin_point: { id: POINT_ID, name: 'Rapid Gate', location: 'Door', policy_type: 'SINGLE_USE' as const, allowed_tier_ids: [], max_capacity: null },
  tickets: [
    { qr_secret: 'secalice0001', ticket_id: 't1', attendee_name: 'Alice', ticket_tier_id: 'tier', ticket_tier_name: 'General', is_admitted: false, admission_count: 0 },
    { qr_secret: 'secbob000002', ticket_id: 't2', attendee_name: 'Bob', ticket_tier_id: 'tier', ticket_tier_name: 'General', is_admitted: false, admission_count: 0 },
  ],
};

interface StoredScan { qr_secret: string; status: string; sync_state: string; rejection_reason: string | null }

const storedScans = (page: Page) => page.evaluate(() => new Promise<StoredScan[]>((resolve) => {
  const req = indexedDB.open('congress_scanner_db', 2);
  req.onsuccess = () => {
    const all = req.result.transaction('queued_scans', 'readonly').objectStore('queued_scans').getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => resolve([]);
  };
  req.onerror = () => resolve([]);
}));

async function openScanner(page: Page) {
  const admitted = new Set<string>();
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await page.route('**/api/checkin-points/*/manifest', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFEST) }));
  // A faithful single-gate server: first scan of a ticket is admitted, any later one is rejected.
  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    const posted = route.request().postDataJSON() as { scans: Array<{ scan_id: string; qr_secret: string }> };
    const results = posted.scans.map((s) => {
      const repeat = admitted.has(s.qr_secret);
      admitted.add(s.qr_secret);
      return repeat
        ? { scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'REJECTED', rejection_reason: 'ALREADY_ADMITTED' }
        : { scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'ADMITTED', attendee_name: s.qr_secret === 'secalice0001' ? 'Alice' : 'Bob', ticket_tier_name: 'General' };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
  });
  await page.goto(`/scan/${POINT_ID}?token=${TOKEN}`);
  await expect(page.getByText('Rapid Gate')).toBeVisible();
  await expect(page.getByText(/Manifest synced/)).toBeVisible();
  await page.waitForLoadState('networkidle');
}

const submit = async (page: Page, code: string) => {
  await page.getByPlaceholder(/Enter Ticket QR Secret/).fill(code);
  await page.getByRole('button', { name: /Evaluate Code/ }).click();
};

test('a different badge scanned right after another is evaluated and recorded, never dropped', async ({ page }) => {
  await openScanner(page);
  await submit(page, 'secalice0001');
  await submit(page, 'secbob000002'); // well inside the previous result's display window
  await expect.poll(async () => (await storedScans(page)).map((s) => s.qr_secret).sort()).toEqual(['secalice0001', 'secbob000002']);
  const scans = await storedScans(page);
  expect(scans.every((s) => s.status === 'ADMITTED')).toBe(true);
  // The result on screen is the latest badge's, not the earlier one's.
  await expect(page.getByText('Bob').first()).toBeVisible();
});

test('the same badge presented again while its result is showing is not recorded twice', async ({ page }) => {
  await openScanner(page);
  await submit(page, 'secalice0001');
  await submit(page, 'secalice0001');
  await page.waitForTimeout(600);
  expect((await storedScans(page)).filter((s) => s.qr_secret === 'secalice0001')).toHaveLength(1);
});

test('a duplicate the gate rejected and the server confirms is not reported as a sync conflict', async ({ page }) => {
  await openScanner(page);
  await submit(page, 'secalice0001');
  await expect.poll(async () => (await storedScans(page))[0]?.sync_state).toBe('CONFIRMED');
  await page.waitForTimeout(2000); // let the first result clear before presenting the badge again
  await submit(page, 'secalice0001');
  await expect.poll(async () => (await storedScans(page)).map((s) => s.sync_state).sort(), { timeout: 15000 }).toEqual(['CONFIRMED', 'LOCAL_REJECTED']);
  await expect(page.getByRole('button', { name: /Conflicts|تداخل/ })).toHaveCount(0);
});
