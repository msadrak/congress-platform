import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { storedScans, wireManifest } from './scannerFixtures';

/**
 * Scanner synchronization and capacity regressions.
 *
 * Synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL. The real-backend scanner journey is
 * scripts/integration/congress-e2e.mjs and the live suite (web/e2e-live/scanner.spec.ts).
 *
 * Every assertion reads resulting state: the records in the scanner's IndexedDB and what the fake
 * server received (including how many batch requests were in flight at once). Timer-driven cases pause
 * Playwright's fake clock, so the 5 s sync timer fires only when the test advances time.
 *
 * The single-scan endpoint (POST /scan, the online path) is unreachable unless a test turns it on, so
 * scans take the local-decision-and-queue path that the synchronization cases are about.
 */

const POINT_ID = 'sync-cap-point';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.sync-cap-signature`;
const REVOKED = { detail: 'Scanner device token has been revoked' };

type Policy = 'SINGLE_USE' | 'CAPACITY_CAPPED';
interface LocalTicketFixture {
  qr_secret: string; ticket_id: string; attendee_name: string; ticket_tier_id: string; ticket_tier_name: string;
  is_admitted: boolean; admission_count: number;
}
const ticket = (n: number, admitted = false): LocalTicketFixture => ({
  qr_secret: `secticket000${n}`,
  ticket_id: `t${n}`,
  attendee_name: `Attendee ${n}`,
  ticket_tier_id: 'tier',
  ticket_tier_name: 'General',
  is_admitted: admitted,
  admission_count: admitted ? 1 : 0,
});
const code = (n: number) => `secticket000${n}`;
interface Manifest {
  checkin_point: { id: string; name: string; location: string; policy_type: Policy; allowed_tier_ids: string[]; max_capacity: number | null };
  tickets: LocalTicketFixture[];
}
const manifestFor = (policy: Policy, maxCapacity: number | null, admitted: number[] = []): Manifest => ({
  checkin_point: { id: POINT_ID, name: 'Sync Gate', location: 'Hall', policy_type: policy, allowed_tier_ids: [], max_capacity: maxCapacity },
  tickets: [1, 2, 3, 4, 5].map((n) => ticket(n, admitted.includes(n))),
});

const scanOf = async (page: Page, n: number) => (await storedScans(page)).filter((s) => s.qr_secret === code(n));
const outcomes = async (page: Page) =>
  Object.fromEntries((await storedScans(page)).map((s) => [s.qr_secret, s.rejection_reason ?? s.status]));

interface FakeServer {
  state: {
    manifest: Manifest; batches: string[][]; inFlight: number; maxInFlight: number;
    mode: 'ok' | 'revoked' | 'error'; admitted: Set<string>; hold: Promise<void> | null;
    scanMode: 'ok' | 'down'; singleScans: string[];
  };
  install: (page: Page) => Promise<void>;
  holdBatches: () => void;
  release: () => void;
}

/** A fake gate server: records every batch, how many were in flight at once, and can hold or fail them. */
function fakeServer(): FakeServer {
  const state: FakeServer['state'] = {
    manifest: manifestFor('SINGLE_USE', null),
    batches: [],
    inFlight: 0,
    maxInFlight: 0,
    mode: 'ok',
    admitted: new Set<string>(),
    hold: null,
    scanMode: 'down',
    singleScans: [],
  };
  let release = () => {};
  const install = async (page: Page) => {
    await page.route('**/api/checkin-points/*/manifest*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wireManifest(state.manifest)) }));
    // Server-side rules, as the backend applies them: single admission per ticket, and the room cap.
    const decide = (s: { scan_id: string; qr_secret: string }) => {
      for (const t of state.manifest.tickets) if (t.is_admitted) state.admitted.add(t.qr_secret);
      const cap = state.manifest.checkin_point.policy_type === 'CAPACITY_CAPPED' ? state.manifest.checkin_point.max_capacity : null;
      const reject = (reason: string) => ({ scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'REJECTED', rejection_reason: reason, clock_skew: false });
      if (state.admitted.has(s.qr_secret)) return reject('ALREADY_ADMITTED');
      if (cap !== null && state.admitted.size >= cap) return reject('CAPACITY_REACHED');
      state.admitted.add(s.qr_secret);
      return { scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'ADMITTED', attendee_name: 'Attendee', ticket_tier_name: 'General', clock_skew: false };
    };
    await page.route('**/api/checkin-points/*/scan', (route) => {
      if (state.scanMode === 'down') return route.abort('internetdisconnected');
      const posted = route.request().postDataJSON() as { scan_id: string; qr_secret: string };
      state.singleScans.push(posted.scan_id);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(decide(posted)) });
    });
    await page.route('**/api/checkin-points/*/scans/batch', async (route) => {
      const posted = route.request().postDataJSON() as { scans: Array<{ scan_id: string; qr_secret: string }> };
      state.batches.push(posted.scans.map((s) => s.scan_id));
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      if (state.hold) await state.hold;
      state.inFlight -= 1;
      if (state.mode === 'revoked') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(REVOKED) });
      if (state.mode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'unavailable' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: posted.scans.map(decide) }) });
    });
  };
  const holdBatches = () => {
    state.hold = new Promise<void>((resolve) => { release = () => { state.hold = null; resolve(); }; });
  };
  return { state, install, holdBatches, release: () => release() };
}

async function openScanner(page: Page, server: FakeServer, { fakeClock = false } = {}) {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  if (fakeClock) await page.clock.install();
  await server.install(page);
  await page.goto(`/scan/${POINT_ID}?token=${TOKEN}`);
  await expect(page.getByText('Sync Gate')).toBeVisible();
  await expect(page.getByText(/Manifest synced/)).toBeVisible();
  // From here on page timers (the 5 s sync timer included) only fire when the test advances time.
  if (fakeClock) await page.clock.pauseAt(Date.now() + 1000);
}

const manual = async (page: Page, n: number) => {
  await page.getByPlaceholder("Paste the badge's QR code").fill(code(n));
  await page.getByRole('button', { name: 'Check Ticket' }).click();
};
/** A USB/Bluetooth HID reader: a burst of keystrokes ending in Enter, outside any input field. */
const hid = async (page: Page, n: number) => {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.type(code(n));
  await page.keyboard.press('Enter');
};
const timerTick = (page: Page) => page.clock.runFor(5000);
const goOffline = async (context: BrowserContext, page: Page) => {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
};

test.describe('scanner synchronization', () => {
  test('a device blocked mid-session stops syncing on every later timer tick and keeps its records', async ({ page }) => {
    const server = fakeServer();
    await openScanner(page, server, { fakeClock: true });
    server.state.mode = 'revoked';
    await manual(page, 1);
    await expect(page.getByText(/device deauthorized/i)).toBeVisible();
    expect(server.state.batches).toHaveLength(1);

    for (let i = 0; i < 3; i++) await timerTick(page);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    expect(server.state.batches).toHaveLength(1);
    const [record] = await scanOf(page, 1);
    expect(record).toMatchObject({ synced: false, sync_state: 'PROVISIONAL' });
  });

  test('a reconnect during a running sync joins it instead of sending a second batch', async ({ page }) => {
    const server = fakeServer();
    await openScanner(page, server, { fakeClock: true });
    server.holdBatches();
    await manual(page, 1);
    await expect.poll(() => server.state.inFlight).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await timerTick(page);
    expect(server.state.maxInFlight).toBe(1);

    server.release();
    await expect.poll(async () => (await scanOf(page, 1))[0]?.sync_state).toBe('CONFIRMED');
    expect(server.state.maxInFlight).toBe(1);
    expect(server.state.batches.flat()).toHaveLength(1);
  });

  test('reconnect and timer firing together send queued offline scans exactly once', async ({ context, page }) => {
    const server = fakeServer();
    await openScanner(page, server, { fakeClock: true });
    await goOffline(context, page);
    await hid(page, 1);
    await hid(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);

    server.holdBatches();
    await context.setOffline(false); // fires the browser's online event
    await timerTick(page);
    await expect.poll(() => server.state.batches.length).toBe(1);
    expect(server.state.maxInFlight).toBe(1);

    server.release();
    await expect.poll(async () => (await storedScans(page)).map((s) => s.sync_state)).toEqual(['CONFIRMED', 'CONFIRMED']);
    await timerTick(page);
    expect(server.state.batches.flat().sort()).toEqual((await storedScans(page)).map((s) => s.scan_id).sort());
    expect(server.state.maxInFlight).toBe(1);
  });

  test('a failed sync is retried on the next tick and then confirms the queued scan', async ({ page }) => {
    const server = fakeServer();
    await openScanner(page, server, { fakeClock: true });
    server.state.mode = 'error';
    await manual(page, 1);
    await expect.poll(() => server.state.batches.length).toBe(1);
    expect((await scanOf(page, 1))[0]).toMatchObject({ synced: false, sync_state: 'PROVISIONAL' });

    server.state.mode = 'ok';
    await timerTick(page);
    await expect.poll(async () => (await scanOf(page, 1))[0]?.sync_state).toBe('CONFIRMED');
    await expect(page.getByText(/device deauthorized/i)).toHaveCount(0);
  });

  test('revocation with queued offline scans keeps every record unsynced and stops retrying', async ({ context, page }) => {
    const server = fakeServer();
    await openScanner(page, server, { fakeClock: true });
    await goOffline(context, page);
    await hid(page, 1);
    await hid(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);

    server.state.mode = 'revoked';
    await context.setOffline(false);
    await expect(page.getByText(/device deauthorized/i)).toBeVisible();
    for (let i = 0; i < 3; i++) await timerTick(page);

    expect(server.state.batches).toHaveLength(1);
    const records = await storedScans(page);
    expect(records).toHaveLength(2);
    expect(records.every((r) => !r.synced && r.sync_state === 'PROVISIONAL')).toBe(true);
  });

  test('a scan made during a running sync is sent right after it, once, and admitted tickets stay admitted', async ({ page }) => {
    const server = fakeServer();
    server.state.manifest = manifestFor('SINGLE_USE', null, [3]);
    await openScanner(page, server, { fakeClock: true });
    server.holdBatches();
    await manual(page, 1);
    await expect.poll(() => server.state.inFlight).toBe(1);
    await manual(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);

    server.release();
    // No timer tick: the follow-up pass alone delivers the second scan.
    await expect.poll(async () => (await storedScans(page)).map((s) => s.sync_state).sort()).toEqual(['CONFIRMED', 'CONFIRMED']);
    const ids = server.state.batches.flat();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(2);
    expect(server.state.maxInFlight).toBe(1);

    // Already admitted on the server before the shift, and admitted here: both are refused locally.
    await manual(page, 3);
    await page.clock.runFor(2000);
    await manual(page, 1);
    await expect.poll(async () => (await storedScans(page)).length).toBe(4);
    expect((await scanOf(page, 3)).map((s) => s.rejection_reason)).toEqual(['ALREADY_ADMITTED']);
    expect((await scanOf(page, 1)).map((s) => s.rejection_reason ?? s.status).sort()).toEqual(['ADMITTED', 'ALREADY_ADMITTED']);
  });
});

test.describe('scanner capacity', () => {
  test('a HID reader sees admissions from a manifest refresh made after its listener was registered', async ({ page }) => {
    const server = fakeServer();
    await openScanner(page, server);
    // Another gate admitted ticket 1; the refreshed manifest says so.
    server.state.manifest = manifestFor('SINGLE_USE', null, [1]);
    const refresh = page.getByRole('button', { name: /Refresh Cache/i });
    await refresh.click();
    await expect(refresh).toBeEnabled(); // the refresh (fetch, cache, rebuild) has finished

    // Hold the server's answers so every record below shows the scanner's own local decision.
    server.holdBatches();
    await hid(page, 1);
    await expect.poll(async () => (await storedScans(page)).length).toBe(1);
    await hid(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);
    expect(await outcomes(page)).toEqual({ [code(1)]: 'ALREADY_ADMITTED', [code(2)]: 'ADMITTED' });
  });

  test('online, manual entry, HID bursts and camera reads are all decided by the server against one room count', async ({ page }) => {
    const server = fakeServer();
    server.state.manifest = manifestFor('CAPACITY_CAPPED', 3);
    server.state.scanMode = 'ok';
    // A camera whose detector reads the queued badges one by one.
    await page.addInitScript(() => {
      const queue: string[] = [];
      const win: Window & { __presentBadge?: (c: string) => void; BarcodeDetector?: unknown } = window;
      win.__presentBadge = (c) => queue.push(c);
      win.BarcodeDetector = class {
        async detect() { const next = queue.shift(); return next ? [{ rawValue: next }] : []; }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const paint = () => { ctx?.fillRect(0, 0, 64, 64); requestAnimationFrame(paint); };
        paint();
        return canvas.captureStream(15);
      };
    });
    await openScanner(page, server);
    await page.getByRole('button', { name: /camera/i }).first().click();

    await manual(page, 1);
    await expect.poll(async () => (await storedScans(page)).length).toBe(1);
    await hid(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);
    await hid(page, 3); // fills the room
    await expect.poll(async () => (await storedScans(page)).length).toBe(3);
    await page.evaluate((c) => {
      const win: Window & { __presentBadge?: (c: string) => void } = window;
      win.__presentBadge?.(c);
    }, code(4));
    await expect.poll(async () => (await storedScans(page)).length, { timeout: 15000 }).toBe(4);
    await hid(page, 5);
    await expect.poll(async () => (await storedScans(page)).length).toBe(5);

    expect(await outcomes(page)).toEqual({
      [code(1)]: 'ADMITTED',
      [code(2)]: 'ADMITTED',
      [code(3)]: 'ADMITTED',
      [code(4)]: 'CAPACITY_REACHED',
      [code(5)]: 'CAPACITY_REACHED',
    });
    // Each verdict came from the server and nothing is left to upload.
    expect(server.state.singleScans).toHaveLength(5);
    expect(server.state.batches).toHaveLength(0);
    expect((await storedScans(page)).every((s) => s.synced)).toBe(true);
  });

  test('offline, a capacity-capped gate fails closed, also after an offline reload', async ({ context, page }) => {
    const server = fakeServer();
    server.state.manifest = manifestFor('CAPACITY_CAPPED', 2);
    await openScanner(page, server);
    // The offline reload is served by the app's service worker: wait until it is active.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await goOffline(context, page);

    // A disconnected gate cannot know the room's count across gates: nobody is admitted automatically.
    await hid(page, 1);
    await hid(page, 2);
    await expect.poll(async () => (await storedScans(page)).length).toBe(2);
    expect(await outcomes(page)).toEqual({ [code(1)]: 'CAPACITY_UNAVAILABLE_OFFLINE', [code(2)]: 'CAPACITY_UNAVAILABLE_OFFLINE' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Sync Gate')).toBeVisible({ timeout: 10000 });
    await hid(page, 3);
    await expect.poll(async () => (await storedScans(page)).length).toBe(3);
    expect((await outcomes(page))[code(3)]).toBe('CAPACITY_UNAVAILABLE_OFFLINE');
    expect((await storedScans(page)).every((s) => !s.synced)).toBe(true);
  });
});
