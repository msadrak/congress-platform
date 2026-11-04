import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { expectScannerOnline, manifestExists, manualScan, storedScans, unpairFromMenu, verdictReason, verdictTitle, wireManifest, type FixtureManifest, type FixtureTicket } from './scannerFixtures';

/**
 * Gate scanner correctness: server-decided online scans, device verdicts that survive a sync, conflicts
 * that keep a ticket admitted, manifest deltas and the local data wipe on unpair.
 *
 * Synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL (backend/tests/test_scanner_correctness.py
 * covers the server side of the same rules).
 */

const POINT_ID = 'correctness-point';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.correctness-signature`;

const code = (n: number) => `secticket000${n}`;
const WALK_IN = 'secwalkin0042';
const ticket = (secret: string, name: string): FixtureTicket => ({
  qr_secret: secret, ticket_id: `t-${secret}`, attendee_name: name, ticket_tier_id: 'tier', ticket_tier_name: 'General',
  is_admitted: false, admission_count: 0,
});
const MANIFEST: FixtureManifest = {
  checkin_point: { id: POINT_ID, name: 'Correctness Gate', location: 'Hall', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null },
  tickets: [ticket(code(1), 'Attendee 1'), ticket(code(2), 'Attendee 2')],
};

interface ScanBody { scan_id: string; qr_secret: string; scanned_at: string; client_verdict?: string | null; client_rejection_reason?: string | null }
type ScanResult = { scan_id: string; qr_secret: string; status: string; rejection_reason?: string | null; attendee_name?: string; ticket_tier_name?: string; clock_skew: boolean };

/** A fake gate server with the backend's rules: idempotent by scan_id, single admission, final device rejections. */
function fakeServer() {
  const state = {
    scanMode: 'ok' as 'ok' | 'down' | 'slow',
    /** Codes another gate already admitted. */
    admitted: new Set<string>(),
    /** Codes whose ticket was cancelled after the manifest was cached. */
    inactive: new Set<string>(),
    decided: new Map<string, ScanResult>(),
    batches: [] as ScanBody[][],
    singleScans: [] as ScanBody[],
    manifestUrls: [] as string[],
    delta: null as FixtureTicket[] | null,
    hold: null as Promise<void> | null,
  };
  let release = () => {};
  const decide = (s: ScanBody): ScanResult => {
    const known = state.decided.get(s.scan_id);
    if (known) return known;
    const base = { scan_id: s.scan_id, qr_secret: s.qr_secret, clock_skew: false };
    const tickets = [...MANIFEST.tickets, ...(state.delta ?? [])];
    const found = tickets.find((t) => t.qr_secret === s.qr_secret);
    let result: ScanResult;
    if (s.client_verdict === 'REJECTED') {
      result = { ...base, status: 'REJECTED', rejection_reason: `LOCAL_REJECTED:${s.client_rejection_reason ?? 'UNSPECIFIED'}` };
    } else if (!found) {
      result = { ...base, status: 'REJECTED', rejection_reason: 'INVALID_TICKET' };
    } else if (state.inactive.has(s.qr_secret)) {
      result = { ...base, status: 'REJECTED', rejection_reason: 'TICKET_INACTIVE' };
    } else if (state.admitted.has(s.qr_secret)) {
      result = { ...base, status: 'REJECTED', rejection_reason: 'ALREADY_ADMITTED' };
    } else {
      state.admitted.add(s.qr_secret);
      result = { ...base, status: 'ADMITTED', attendee_name: found.attendee_name, ticket_tier_name: found.ticket_tier_name };
    }
    state.decided.set(s.scan_id, result);
    return result;
  };
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  const install = async (page: Page) => {
    await page.route('**/api/checkin-points/*/manifest*', (route) => {
      const url = new URL(route.request().url());
      state.manifestUrls.push(url.search);
      if (url.searchParams.get('since') && state.delta) {
        return route.fulfill(json({ ...wireManifest({ ...MANIFEST, tickets: state.delta }, { cursor: '2026-10-23T11:00:00+00:00' }), is_delta: true }));
      }
      return route.fulfill(json(wireManifest(MANIFEST)));
    });
    await page.route('**/api/checkin-points/*/scans/batch', async (route) => {
      const posted = route.request().postDataJSON() as { scans: ScanBody[] };
      state.batches.push(posted.scans);
      if (state.hold) await state.hold;
      return route.fulfill(json({ results: posted.scans.map(decide) }));
    });
    await page.route('**/api/checkin-points/*/scan', async (route) => {
      if (state.scanMode === 'down') return route.abort('internetdisconnected');
      const posted = route.request().postDataJSON() as ScanBody;
      state.singleScans.push(posted);
      if (state.scanMode === 'slow') await new Promise((resolve) => setTimeout(resolve, 4000));
      // The scanner may have given up waiting (aborted) by now.
      return route.fulfill(json(decide(posted))).catch(() => undefined);
    });
    await page.route('**/api/checkin-points/*/devices/self/revoke', (route) => route.fulfill(json({ is_revoked: true })));
  };
  const holdBatches = () => {
    state.hold = new Promise<void>((resolve) => { release = () => { state.hold = null; resolve(); }; });
  };
  return { state, install, holdBatches, release: () => release() };
}
type FakeServer = ReturnType<typeof fakeServer>;

async function openScanner(page: Page, server: FakeServer, { fakeClock = false } = {}) {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  if (fakeClock) await page.clock.install();
  await server.install(page);
  await page.goto(`/scan/${POINT_ID}?token=${TOKEN}`);
  await expectScannerOnline(page, 'Correctness Gate');
  if (fakeClock) await page.clock.pauseAt(Date.now() + 1000);
}

const manual = manualScan;
const goOffline = async (context: BrowserContext, page: Page) => {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
};
const scansOf = async (page: Page, value: string) => (await storedScans(page)).filter((s) => s.qr_secret === value);

test('an online scan shows the server verdict, even when the cached manifest would admit', async ({ page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  server.state.inactive.add(code(2)); // cancelled after the manifest was cached

  await manual(page, code(2));
  await expect(verdictTitle(page)).toHaveText('Rejected');
  await expect(verdictReason(page)).toHaveText('Pass cancelled');
  await expect.poll(async () => (await scansOf(page, code(2)))[0]).toMatchObject({ status: 'REJECTED', rejection_reason: 'TICKET_INACTIVE', synced: true });
  expect(server.state.singleScans).toHaveLength(1);
  expect(server.state.batches).toHaveLength(0);
});

test('a scan the server is too slow to answer is admitted provisionally and uploaded under the same scan_id', async ({ page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  server.state.scanMode = 'slow';

  await manual(page, code(1));
  await expect(verdictTitle(page)).toHaveText('Admitted (offline)', { timeout: 5000 });
  await expect.poll(() => server.state.batches.length, { timeout: 10000 }).toBeGreaterThan(0);
  const [single] = server.state.singleScans;
  const uploaded = server.state.batches.flat().find((s) => s.qr_secret === code(1));
  expect(uploaded).toMatchObject({ scan_id: single.scan_id, client_verdict: 'PROVISIONAL', client_rejection_reason: null });
  await expect.poll(async () => (await scansOf(page, code(1)))[0]?.sync_state).toBe('CONFIRMED');
});

test('a scan the device rejected offline stays rejected after sync, and is never a conflict', async ({ context, page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  await goOffline(context, page);

  await manual(page, 'secnotonlist01');
  await expect.poll(async () => (await scansOf(page, 'secnotonlist01'))[0]).toMatchObject({ status: 'REJECTED', rejection_reason: 'NOT_IN_LOCAL_MANIFEST', synced: false });

  await context.setOffline(false);
  await expect.poll(async () => (await scansOf(page, 'secnotonlist01'))[0]?.synced, { timeout: 10000 }).toBe(true);
  expect(server.state.batches.flat()[0]).toMatchObject({ qr_secret: 'secnotonlist01', client_verdict: 'REJECTED', client_rejection_reason: 'NOT_IN_LOCAL_MANIFEST' });
  expect((await scansOf(page, 'secnotonlist01'))[0]).toMatchObject({ status: 'REJECTED', sync_state: 'LOCAL_REJECTED', rejection_reason: 'NOT_IN_LOCAL_MANIFEST' });
  await expect(page.locator('[data-status="conflicts"]')).toHaveCount(0);
});

test('after a conflict, a re-scan of the single-use ticket is rejected', async ({ context, page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  await goOffline(context, page);
  await manual(page, code(1));
  await expect.poll(async () => (await scansOf(page, code(1)))[0]?.sync_state).toBe('PROVISIONAL');

  // Another gate admitted the same ticket meanwhile: the upload comes back as a conflict.
  server.state.admitted.add(code(1));
  await context.setOffline(false);
  await expect.poll(async () => (await scansOf(page, code(1)))[0]?.sync_state, { timeout: 10000 }).toBe('CONFLICT');
  await expect(page.locator('[data-status="conflicts"]')).toHaveText('1 conflict');

  // The device's own admission did not count, but the ticket is admitted: presenting it again is refused.
  await goOffline(context, page);
  await page.waitForTimeout(1600); // the first verdict has cleared
  await manual(page, code(1));
  await expect.poll(async () => (await scansOf(page, code(1))).length).toBe(2);
  const states = (await scansOf(page, code(1))).map((s) => `${s.sync_state}:${s.rejection_reason}`).sort();
  expect(states).toEqual(['CONFLICT:ALREADY_ADMITTED', 'LOCAL_REJECTED:ALREADY_ADMITTED']);
});

test('a walk-in ticket issued after pairing is admitted once the manifest delta brings it', async ({ page }) => {
  const server = fakeServer();
  server.state.scanMode = 'down'; // decide locally, so the records show what the device knows
  await openScanner(page, server, { fakeClock: true });
  server.holdBatches();

  await manual(page, WALK_IN);
  await expect.poll(async () => (await scansOf(page, WALK_IN))[0]?.rejection_reason).toBe('NOT_IN_LOCAL_MANIFEST');

  server.state.delta = [ticket(WALK_IN, 'Walk-in Guest')];
  await page.clock.runFor(30_000); // the manifest poll
  await expect.poll(() => server.state.manifestUrls.some((q) => q.includes('since='))).toBe(true);

  await manual(page, WALK_IN);
  await expect.poll(async () => (await scansOf(page, WALK_IN)).length).toBe(2);
  const outcomes = (await scansOf(page, WALK_IN)).map((s) => s.rejection_reason ?? s.status).sort();
  expect(outcomes).toEqual(['ADMITTED', 'NOT_IN_LOCAL_MANIFEST']);
  await expect(page.getByText('Walk-in Guest').first()).toBeVisible();
});

test('a barcode gun under a Persian keyboard layout sends the code it printed', async ({ page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  await page.evaluate((value) => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const ch of value) {
      const isDigit = /[0-9]/.test(ch);
      // What a Persian layout reports for the physical key the gun pressed.
      const key = isDigit ? '۰۱۲۳۴۵۶۷۸۹'[Number(ch)] : 'ش';
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code: isDigit ? `Digit${ch}` : `Key${ch.toUpperCase()}` }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));
  }, code(1));
  await expect.poll(() => server.state.singleScans.map((s) => s.qr_secret)).toEqual([code(1)]);
  await expect.poll(async () => (await scansOf(page, code(1)))[0]?.sync_state).toBe('CONFIRMED');
});

test('a confirmed unpair wipes the cached manifest and the scans from the device', async ({ page }) => {
  const server = fakeServer();
  await openScanner(page, server);
  await manual(page, code(1));
  await expect.poll(async () => (await scansOf(page, code(1)))[0]?.sync_state).toBe('CONFIRMED');
  expect(await manifestExists(page, POINT_ID)).toBe(true);

  await unpairFromMenu(page);
  await expect(page.getByRole('heading', { name: 'Unpaired' })).toBeVisible({ timeout: 10000 });
  expect(await manifestExists(page, POINT_ID)).toBe(false);
  expect(await storedScans(page)).toEqual([]);
  await expect(page.getByText('Correctness Gate')).toHaveCount(0);
});

test('a check-in point scans in one tab only; a second tab takes over when the first closes', async ({ context, page }) => {
  const server = fakeServer();
  await openScanner(page, server);

  const second = await context.newPage();
  await server.install(second);
  await second.goto(`/scan/${POINT_ID}`);
  await expect(second.getByRole('heading', { name: 'Open in another tab' })).toBeVisible();
  await expect(second.getByText('Correctness Gate')).toHaveCount(0);

  await page.close();
  await expect(second.getByText('Correctness Gate')).toBeVisible({ timeout: 10000 });
  await expect(second.getByRole('heading', { name: 'Open in another tab' })).toHaveCount(0);
  await second.close();
});
