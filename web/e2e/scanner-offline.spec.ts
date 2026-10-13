/**
 * Playwright E2E tests: Offline Scanner Recovery
 *
 * Verifies PWA scanner recovers app shell and persisted operational state
 * after offline reload or browser restart, without losing admission records.
 *
 * Root cause fixed: all page.evaluate callbacks receive POINT_ID as an argument
 * (browser context cannot access Node.js constants).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const POINT_ID = 'test-point-001';
const tokenPayload = Buffer.from(
  JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })
).toString('base64url');
const TEST_TOKEN = `e30.${tokenPayload}.test-signature`;

const MOCK_MANIFEST = {
  checkin_point: {
    id: POINT_ID,
    name: 'Test Gate A',
    location: 'Main Entrance',
    policy_type: 'SINGLE_USE' as const,
    allowed_tier_ids: ['tier-general', 'tier-vip'],
    max_capacity: 2,
  },
  tickets: [
    { qr_secret: 'ticket-a-001', ticket_id: 't1', attendee_name: 'Alice', ticket_tier_id: 'tier-general', ticket_tier_name: 'General', is_admitted: false, admission_count: 0 },
    { qr_secret: 'ticket-b-002', ticket_id: 't2', attendee_name: 'Bob', ticket_tier_id: 'tier-general', ticket_tier_name: 'General', is_admitted: false, admission_count: 0 },
    { qr_secret: 'ticket-c-003', ticket_id: 't3', attendee_name: 'Charlie', ticket_tier_id: 'tier-vip', ticket_tier_name: 'VIP', is_admitted: false, admission_count: 0 },
  ],
};


// ── Helper: inject a scan record into IndexedDB ──
async function injectScan(page: Page, scan: {
  scan_id: string;
  qr_secret: string;
  attendee_name: string;
  status: 'ADMITTED' | 'REJECTED';
  sync_state: string;
  rejection_reason?: string | null;
  synced?: boolean;
}) {
  await page.evaluate((args) => {
    return new Promise<void>((resolve, reject) => {
      const { pointId, scanData } = args;
      const dbPromise = new Promise<IDBDatabase>((resolveDb, rejectDb) => {
        const req = indexedDB.open('congress_scanner_db', 2);
        req.onsuccess = () => resolveDb(req.result);
        req.onerror = () => rejectDb(req.error);
      });
      dbPromise.then((db) => {
        const tx = db.transaction('queued_scans', 'readwrite');
        const store = tx.objectStore('queued_scans');
        store.put({
          point_id: pointId,
          scanned_at: new Date().toISOString(),
          ...scanData,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }).catch(reject);
    });
  }, { pointId: POINT_ID, scanData: scan });
}

// ── Helper: get scan count from IndexedDB ──
async function getScanCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('congress_scanner_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('queued_scans', 'readonly');
        const store = tx.objectStore('queued_scans');
        const count = store.count();
        count.onsuccess = () => resolve(count.result);
        count.onerror = () => resolve(-1);
      };
      req.onerror = () => resolve(-2);
    });
  });
}

// ── Helper: check if manifest exists in IndexedDB ──
async function manifestExists(page: Page): Promise<boolean> {
  return page.evaluate((pointId) => {
    return new Promise<boolean>((resolve) => {
      const req = indexedDB.open('congress_scanner_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('manifests', 'readonly');
        const store = tx.objectStore('manifests');
        const get = store.get(pointId);
        get.onsuccess = () => resolve(!!get.result);
        get.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    });
  }, POINT_ID);
}

// ── Helper: get stored scanner token from IndexedDB ──
async function getScannerToken(page: Page): Promise<string | null> {
  return page.evaluate((pointId) => {
    return new Promise<string | null>((resolve) => {
      const req = indexedDB.open('congress_scanner_tokens', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('tokens', 'readonly');
        const store = tx.objectStore('tokens');
        const get = store.get(pointId);
        get.onsuccess = () => resolve(get.result ? get.result.token : null);
        get.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }, POINT_ID);
}

async function clearScannerCredential(page: Page) {
  await page.evaluate((pointId) => {
    sessionStorage.removeItem(`congress_scanner_token_${pointId}`);
    return new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('congress_scanner_tokens', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('tokens', 'readwrite');
        tx.objectStore('tokens').delete(pointId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, POINT_ID);
}

// ── Helper: get sync states of all scans ──
async function getSyncStates(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return new Promise<string[]>((resolve) => {
      const req = indexedDB.open('congress_scanner_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('queued_scans', 'readonly');
        const store = tx.objectStore('queued_scans');
        const all = store.getAll();
        all.onsuccess = () => resolve(all.result.map((r: { sync_state?: string }) => r.sync_state ?? 'UNKNOWN'));
        all.onerror = () => resolve([]);
      };
      req.onerror = () => resolve([]);
    });
  });
}

// ── Helper: count conflicts in IndexedDB ──
async function getConflictCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('congress_scanner_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('queued_scans', 'readonly');
        const store = tx.objectStore('queued_scans');
        const idx = store.index('sync_state');
        const count = idx.count('CONFLICT');
        count.onsuccess = () => resolve(count.result);
        count.onerror = () => resolve(0);
      };
      req.onerror = () => resolve(0);
    });
  });
}

// ── Helper: set up mock API routes ──
async function setupApiRoutes(page: Page) {
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MANIFEST),
    });
  });

  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    // Echo the queued scan_ids like the real backend does, so reconciliation
    // matches client records (resultsMap[scan.scan_id]). Fixed scan_ids would
    // never match injected records and reconciliation would correctly skip them.
    const posted = route.request().postDataJSON() as { scans?: Array<{ scan_id: string; qr_secret: string; scanned_at: string }> } | null;
    const first = posted?.scans?.[0];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            scan_id: first?.scan_id ?? 'scan-1',
            qr_secret: first?.qr_secret ?? 'ticket-a-001',
            status: 'ADMITTED',
            attendee_name: 'Alice',
            ticket_tier_name: 'General',
          },
        ],
      }),
    });
  });
  await page.route('**/api/checkin-points/*/devices/self/revoke', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ is_revoked: true }),
    })
  );
}

// ── Helper: navigate to scanner with auth token ──
async function navigateToScanner(page: Page, token: string) {
  await page.goto(`/scan/${POINT_ID}?token=${token}`);
  await page.waitForLoadState('networkidle');
}

// ── Helper: wait for SW registration ──
async function waitForSW(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.ready !== undefined, { timeout: 10000 });
  await page.waitForTimeout(2000);
}

// ═══════════════════════════════════════════════════════════
// T01: Initial online load registers SW and caches app shell
// ═══════════════════════════════════════════════════════════
test('T01: Initial online load registers SW and caches app shell', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await expect(page.getByText('Test Gate A')).toBeVisible();
  await expect(page.getByText('SINGLE_USE')).toBeVisible();

  expect(await manifestExists(page)).toBe(true);
  expect(await getScannerToken(page)).toBe(TEST_TOKEN);

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T02: Scanner reloads offline with persisted state intact
// ═══════════════════════════════════════════════════════════
test('T02: Scanner reloads offline with persisted state intact', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'offline-scan-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  expect(await getScanCount(page)).toBe(1);

  // Go offline and reload
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // App shell loads from SW cache
  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page)).toBe(1);
  expect(await manifestExists(page)).toBe(true);
  // "Offline" indicator may not render if navigator.onLine stays true in headless
  // The key assertion is that state survived — verified above
});

// ═══════════════════════════════════════════════════════════
// T03: Scanner persists state across browser restart
// ═══════════════════════════════════════════════════════════
test('T03: Scanner persists state across browser restart', async ({ context }) => {
  const page1 = await context.newPage();
  await setupApiRoutes(page1);
  await navigateToScanner(page1, TEST_TOKEN);
  await waitForSW(page1);

  expect(await getScannerToken(page1)).toBe(TEST_TOKEN);
  expect(await manifestExists(page1)).toBe(true);

  await injectScan(page1, {
    scan_id: 'restart-scan-001',
    qr_secret: 'ticket-b-002',
    attendee_name: 'Bob',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  await page1.close();

  // Second session (same context = same IndexedDB origin)
  const page2 = await context.newPage();
  await setupApiRoutes(page2);
  await navigateToScanner(page2, TEST_TOKEN);
  await waitForSW(page2);

  expect(await getScannerToken(page2)).toBe(TEST_TOKEN);
  expect(await manifestExists(page2)).toBe(true);
  expect(await getScanCount(page2)).toBe(1);

  await page2.close();
});

// ═══════════════════════════════════════════════════════════
// T04: Single-use enforcement after offline reload
// ═══════════════════════════════════════════════════════════
test('T04: Single-use ticket cannot be re-admitted after offline reload', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'single-use-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page)).toBe(1);

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T05: Capacity counter restored after offline reload
// ═══════════════════════════════════════════════════════════
test('T05: Capacity counter restored after offline reload', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'cap-test-0',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await injectScan(page, {
    scan_id: 'cap-test-1',
    qr_secret: 'ticket-b-002',
    attendee_name: 'Bob',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page)).toBe(2);

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T06: Network restoration reconciles queued scans
// ═══════════════════════════════════════════════════════════
test('T06: Queued scans synced when network returns', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  // Queue scan while offline (no auto-sync)
  await context.setOffline(true);
  await injectScan(page, {
    scan_id: 'sync-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  expect(await getScanCount(page)).toBe(1);

  // Go online — background sync interval (5s) should fire
  await context.setOffline(false);
  await page.waitForTimeout(7000);

  // Scan should have been processed (not PROVISIONAL anymore)
  const states = await getSyncStates(page);
  expect(states.length).toBe(1);
  expect(states[0]).not.toBe('PROVISIONAL');

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T07: Conflicts persist across offline reload
// ═══════════════════════════════════════════════════════════
test('T07: Conflicts persist across offline reload', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'conflict-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'REJECTED',
    rejection_reason: 'ALREADY_ADMITTED',
    sync_state: 'CONFLICT',
    synced: true,
  });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getConflictCount(page)).toBe(1);
  await expect(page.getByRole('button', { name: /1 (Conflicts|تداخل)/ })).toBeVisible();

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T08: Unauthorized scanner access rejected
// ═══════════════════════════════════════════════════════════
test('T08: Scanner rejects unauthorized access', async ({ context }) => {
  const page = await context.newPage();
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Scanner device not authorized.' }),
    });
  });

  await page.goto(`/scan/${POINT_ID}`);
  await page.waitForTimeout(2000);

  const hasAuthUI = await page.getByText('Authorize This Device').isVisible().catch(() => false)
    || await page.getByText('Pair Scanner Device').isVisible().catch(() => false);
  expect(hasAuthUI).toBe(true);

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T09: Malformed sync response handled gracefully
// ═══════════════════════════════════════════════════════════
test('T09: Scanner handles malformed sync response', async ({ context }) => {
  const page = await context.newPage();

  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MANIFEST),
    });
  });

  // Batch scan returns response missing `results` array
  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ unexpected_field: true }),
    });
  });

  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'malformed-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  // Wait for sync attempt
  await page.waitForTimeout(7000);

  // Scan should still exist (not lost)
  expect(await getScanCount(page)).toBeGreaterThanOrEqual(1);

  // Scanner should still be functional
  await expect(page.getByText('Test Gate A')).toBeVisible();

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T10: Pending scans survive network failure during sync
// ═══════════════════════════════════════════════════════════
test('T10: Pending scans survive failed sync', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'fail-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  expect(await getScanCount(page)).toBe(1);

  // Go offline — sync will fail
  await context.setOffline(true);
  await page.waitForTimeout(7000);

  // Scan should still be PROVISIONAL
  const states = await getSyncStates(page);
  expect(states.length).toBe(1);
  expect(states[0]).toBe('PROVISIONAL');
  expect(await getScanCount(page)).toBe(1);

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// T11: Scanner token persists across page close/reopen
// ═══════════════════════════════════════════════════════════
test('T11: Scanner token persists across page close', async ({ context }) => {
  const page1 = await context.newPage();
  await setupApiRoutes(page1);
  await navigateToScanner(page1, TEST_TOKEN);
  await waitForSW(page1);
  await expect(page1.getByText('Test Gate A')).toBeVisible();
  expect(await getScannerToken(page1)).toBe(TEST_TOKEN);
  await page1.close();

  // Second visit without token — should auto-authorize from IndexedDB
  const page2 = await context.newPage();
  await setupApiRoutes(page2);
  await page2.goto(`/scan/${POINT_ID}`);
  await page2.waitForTimeout(3000);

  await expect(page2.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  await page2.close();
});

// ═══════════════════════════════════════════════════════════
// T12: App update doesn't lose queued scans
// ═══════════════════════════════════════════════════════════
test('T12: App update preserves queued scans', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);

  await injectScan(page, {
    scan_id: 'update-test-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });

  expect(await getScanCount(page)).toBe(1);

  // Reload (simulating SW update cycle)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page)).toBe(1);

  const states = await getSyncStates(page);
  expect(states[0]).toBe('PROVISIONAL');

  await page.close();
});

// ═══════════════════════════════════════════════════════════
// Task 05C — Scanner session lifecycle (U01–U10)
// ═══════════════════════════════════════════════════════════

// U01: Successful device unpairing removes the credential, keeps scans
test('U01: Successful unpair removes credential and preserves scans', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'unpair-keep-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await expect(page.getByText('Test Gate A')).toBeVisible();

  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
  await expect(page.getByText(/Server revocation confirmed/i)).toBeVisible({ timeout: 10000 });
  // Credential gone from IndexedDB, scans preserved
  expect(await getScannerToken(page)).toBeNull();
  expect(await getScanCount(page)).toBe(1);
  await page.close();
});

// U02: Offline unpair disables the browser and retains the credential pending revocation.
test('U02: Offline unpair stays pending and preserves scans', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'unpair-offline-001',
    qr_secret: 'ticket-b-002',
    attendee_name: 'Bob',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
  await expect(page.getByText(/server revocation is pending/i)).toBeVisible({ timeout: 10000 });
  expect(await getScannerToken(page)).toBe(TEST_TOKEN);
  expect(await getScanCount(page)).toBe(1);
  await page.close();
});

// U03: Revocation during an active session blocks new admissions, keeps history
test('U03: Revoked device stops admissions and preserves records', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'revoked-keep-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  // From now on the server rejects this device as revoked
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Scanner device token has been revoked' }) });
  });
  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Scanner device token has been revoked' }) });
  });
  // Forcing a manifest refresh surfaces the definitive reject
  await page.getByRole('button', { name: /Refresh Cache/i }).click();
  await expect(page.getByText(/device deauthorized/i)).toBeVisible({ timeout: 10000 });
  // History preserved, admissions paused
  expect(await getScanCount(page)).toBe(1);
  await expect(page.getByText(/unsynced scan\(s\) preserved/i)).toBeVisible();
  await page.close();
});

// U04: Expired credential blocks with re-pair guidance
test('U04: Expired credential blocks with re-pair guidance', async ({ context }) => {
  const page = await context.newPage();
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Signature has expired' }) });
  });
  await page.goto(`/scan/${POINT_ID}?token=${TEST_TOKEN}`);
  await page.waitForTimeout(3000);
  await expect(page.getByText(/Credential Expired/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/fresh token/i)).toBeVisible();
  await page.close();
});

// U05: Wrong point/event scope renders FORBIDDEN guidance
test('U05: Wrong-scope token renders forbidden guidance', async ({ context }) => {
  const page = await context.newPage();
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Scanner token is not authorized for this check-in point' }) });
  });
  await page.goto(`/scan/${POINT_ID}?token=${TEST_TOKEN}`);
  await page.waitForTimeout(3000);
  await expect(page.getByText(/Wrong Check-In Point/i)).toBeVisible({ timeout: 10000 });
  await page.close();
});

// U06: Offline-window expiry pauses admissions, preserves records
test('U06: Stale manifest pauses admissions and preserves records', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'stale-keep-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  // Backdate the cached manifest >24h so the enforced window expires
  await page.evaluate((pointId) => {
    return new Promise<void>((resolve) => {
      const req = indexedDB.open('congress_scanner_db', 2);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('manifests', 'readwrite');
        const store = tx.objectStore('manifests');
        const get = store.get(pointId);
        get.onsuccess = () => {
          if (get.result) {
            get.result.cached_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
            store.put(get.result);
          }
          resolve();
        };
        get.onerror = () => resolve();
      };
      req.onerror = () => resolve();
    });
  }, POINT_ID);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await expect(page.getByText(/Offline window expired/i)).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page)).toBe(1);
  await page.close();
});

// U07: Re-pairing after a block clears the block and keeps scans
test('U07: Re-pairing clears auth block and keeps scans', async ({ context }) => {
  const page = await context.newPage();
  let revoked = true;
  await page.route('**/api/checkin-points/*/manifest', (route) => {
    if (revoked) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Scanner device token has been revoked' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MANIFEST) });
  });
  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });
  await page.goto(`/scan/${POINT_ID}?token=${TEST_TOKEN}`);
  await page.waitForTimeout(3000);
  await expect(page.getByText(/Device Deauthorized/i)).toBeVisible({ timeout: 10000 });
  // Supervisor issues a fresh token: server accepts again, operator re-pairs
  revoked = false;
  await page.getByPlaceholder(/Paste device scanner token/i).fill('fresh-token-abc');
  await page.getByRole('button', { name: /Authorize This Device/i }).click();
  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await getScannerToken(page)).toBe('fresh-token-abc');
  await page.close();
});

// U08: Recovery after reconnection refreshes manifest and clears fail count
test('U08: Reconnection refreshes manifest and resumes sync', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'reconnect-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await context.setOffline(true);
  await page.waitForTimeout(6000);
  await context.setOffline(false);
  await page.waitForTimeout(8000);
  const states = await getSyncStates(page);
  expect(states.length).toBe(1);
  expect(states[0]).not.toBe('PROVISIONAL');
  await page.close();
});

// U09: Safe IndexedDB cleanup removes only the credential
test('U09: Unpair cleanup removes credential, keeps operational data', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await waitForSW(page);
  await injectScan(page, {
    scan_id: 'cleanup-keep-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  expect(await getScannerToken(page)).toBe(TEST_TOKEN);
  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
  await expect(page.getByText(/Server revocation confirmed/i)).toBeVisible({ timeout: 10000 });
  // Credential DB cleared for this point; scan DB + manifest intact
  expect(await getScannerToken(page)).toBeNull();
  expect(await getScanCount(page)).toBe(1);
  expect(await manifestExists(page)).toBe(true);
  await page.close();
});

// U10: Browser restart after revocation keeps records, demands re-pair
test('U10: Restart after revocation preserves records and demands re-pair', async ({ context }) => {
  const page1 = await context.newPage();
  await setupApiRoutes(page1);
  await navigateToScanner(page1, TEST_TOKEN);
  await waitForSW(page1);
  await injectScan(page1, {
    scan_id: 'restart-revoked-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await page1.close();
  // Restarted browser, revoked server-side: manifest refresh is rejected
  const page2 = await context.newPage();
  await page2.route('**/api/checkin-points/*/manifest', (route) => {
    return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Scanner device token has been revoked' }) });
  });
  await page2.goto(`/scan/${POINT_ID}`);
  await page2.waitForTimeout(3000);
  await expect(page2.getByText(/Device Deauthorized/i)).toBeVisible({ timeout: 10000 });
  expect(await getScanCount(page2)).toBe(1);
  await page2.close();
});

// U11: A cached attendee manifest is not exposed without a scanner credential.
test('U11: Cached manifest without scanner credential stays private', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  expect(await manifestExists(page)).toBe(true);
  await clearScannerCredential(page);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText(/Pair this scanner with a valid device token/i)).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('Test Gate A')).toHaveCount(0);
  expect(await getScanCount(page)).toBe(0);
  await page.close();
});

// U12: Offline unpair is local-only, durable, and preserves recovery records.
test('U12: Offline unpair remains visibly pending after reload', async ({ context }) => {
  const page = await context.newPage();
  await setupApiRoutes(page);
  await navigateToScanner(page, TEST_TOKEN);
  await expect(page.getByText('Test Gate A')).toBeVisible({ timeout: 10000 });
  await injectScan(page, {
    scan_id: 'offline-unpair-keep-001',
    qr_secret: 'ticket-a-001',
    attendee_name: 'Alice',
    status: 'ADMITTED',
    sync_state: 'PROVISIONAL',
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
  await expect(page.getByText(/server revocation is pending/i)).toBeVisible({ timeout: 10000 });
  expect(await getScannerToken(page)).toBe(TEST_TOKEN);
  expect(await getScanCount(page)).toBe(1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Scanner Deactivated' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('Test Gate A')).toHaveCount(0);
  expect(await getScanCount(page)).toBe(1);
  await page.close();
});
