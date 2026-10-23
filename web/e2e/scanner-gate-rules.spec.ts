import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { hashCode, storedScans, wireManifest, type FixtureManifest, type FixtureTicket } from './scannerFixtures';

/**
 * Gate rules on the web scanner: the Entry/Exit switch of a point that tracks occupancy, daily single-use windows
 * (catering) decided offline across a day boundary, and the device heartbeat.
 *
 * Synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL (backend/tests/test_gate_rules.py covers the
 * server side; web/tests/scannerParity.test.ts runs the shared rule scenarios against the local engine).
 */

const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.gate-rules-signature`;

/** The scanner's window key: the calendar date in Tehran. */
const tehranDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const TODAY = tehranDate(new Date());
const YESTERDAY = tehranDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

const ticket = (secret: string, name: string, extra: Record<string, unknown> = {}): FixtureTicket & Record<string, unknown> => ({
  qr_secret: secret, ticket_id: `t-${secret}`, attendee_name: name, ticket_tier_id: 'tier', ticket_tier_name: 'General',
  is_admitted: false, admission_count: 0, ...extra,
});

interface Posted { scan_id: string; qr_secret: string; direction?: string; client_verdict?: string | null }

function gate(point: FixtureManifest['checkin_point'] & Record<string, unknown>, tickets: FixtureTicket[], manifestExtra: Record<string, unknown>) {
  const state = { singles: [] as Posted[], batches: [] as Posted[][], heartbeats: [] as Record<string, unknown>[], heartbeatStatus: 200 };
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const decide = (s: Posted) => ({
    scan_id: s.scan_id, qr_secret: s.qr_secret, status: 'ADMITTED', rejection_reason: null, clock_skew: false,
    direction: s.direction ?? 'IN', attendee_name: tickets.find((t) => t.qr_secret === s.qr_secret)?.attendee_name, ticket_tier_name: 'General',
  });
  const install = async (page: Page) => {
    await page.route('**/api/checkin-points/*/manifest*', (route) =>
      route.fulfill(json({ ...wireManifest({ checkin_point: point, tickets }), ...manifestExtra })));
    await page.route('**/api/checkin-points/*/scan', (route) => {
      const posted = route.request().postDataJSON() as Posted;
      state.singles.push(posted);
      return route.fulfill(json(decide(posted)));
    });
    await page.route('**/api/checkin-points/*/scans/batch', (route) => {
      const posted = route.request().postDataJSON() as { scans: Posted[] };
      state.batches.push(posted.scans);
      return route.fulfill(json({ results: posted.scans.map(decide) }));
    });
    await page.route('**/api/checkin-points/*/devices/self/heartbeat', (route) => {
      state.heartbeats.push(route.request().postDataJSON() as Record<string, unknown>);
      return state.heartbeatStatus === 200
        ? route.fulfill(json({ id: 'device', unsynced_count: 0 }))
        : route.fulfill(json({ detail: 'Scanner device token has been revoked', code: 'SCANNER_REVOKED' }, state.heartbeatStatus));
    });
  };
  return { state, install };
}

async function open(page: Page, install: (page: Page) => Promise<void>, pointId: string, name: string) {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await install(page);
  await page.goto(`/scan/${pointId}?token=${TOKEN}`);
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText(/Manifest synced/)).toBeVisible();
}

const manual = async (page: Page, value: string) => {
  await page.getByPlaceholder("Paste the badge's QR code").fill(value);
  await page.getByRole('button', { name: 'Check Ticket' }).click();
};
const goOffline = async (context: BrowserContext, page: Page) => {
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
};

test('an occupancy point offers Entry/Exit; exit mode is unmistakable and its scans are exits, online and offline', async ({ page, context }) => {
  const POINT = 'occupancy-point';
  const inside = ticket('secinside0001', 'Inside Person', { is_inside: true, presence_at: '2025-01-01T08:00:00+00:00', is_admitted: true, admission_count: 1, last_admitted_window: 'event' });
  const other = ticket('secinside0002', 'Second Person', { is_inside: true, presence_at: '2025-01-01T08:00:00+00:00', is_admitted: true, admission_count: 1, last_admitted_window: 'event' });
  const server = gate(
    { id: POINT, name: 'Hall A Door', location: 'Hall A', policy_type: 'CAPACITY_CAPPED', allowed_tier_ids: [], max_capacity: 100, tracks_occupancy: true, reset_window: 'EVENT' },
    [inside, other],
    { admission_window: 'event', event_timezone: 'Asia/Tehran', occupancy: 2 },
  );
  await open(page, server.install, POINT, 'Hall A Door');
  await expect(page.getByTestId('scanner-occupancy')).toContainText('2');

  const modes = page.getByRole('group', { name: 'Scan mode' });
  await expect(modes.getByRole('button', { name: 'Entry' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Exit mode: scans record people leaving')).toHaveCount(0);
  await modes.getByRole('button', { name: 'Exit' }).click();
  await expect(modes.getByRole('button', { name: 'Exit' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Exit mode: scans record people leaving')).toBeVisible();

  await manual(page, inside.qr_secret);
  await expect(page.locator('.scanner-takeover-title')).toHaveText('Exit recorded');
  expect(server.state.singles.at(-1)).toMatchObject({ qr_secret: inside.qr_secret, direction: 'OUT' });
  await expect(page.getByTestId('scanner-occupancy')).toContainText('1');

  // Offline: the exit is decided locally (provisionally), queued as an exit and uploaded as one.
  await goOffline(context, page);
  await manual(page, other.qr_secret);
  await expect(page.locator('.scanner-takeover-title')).toHaveText('Exit recorded provisionally (offline)');
  await expect.poll(async () => (await storedScans(page)).find((s) => s.qr_secret === other.qr_secret)).toMatchObject({ sync_state: 'PROVISIONAL' });
  const queued = (await storedScans(page)).find((s) => s.qr_secret === other.qr_secret) as unknown as { direction: string };
  expect(queued.direction).toBe('OUT');
  // Someone who is not inside cannot leave.
  await manual(page, inside.qr_secret);
  await expect(page.locator('.scanner-takeover-reason')).toHaveText('Not inside: exit not recorded');

  await context.setOffline(false);
  await expect.poll(() => server.state.batches.flat().find((s) => s.qr_secret === other.qr_secret)?.direction, { timeout: 15000 }).toBe('OUT');

  // The mode survives a reload of the tab.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Scan mode' }).getByRole('button', { name: 'Exit' })).toHaveAttribute('aria-pressed', 'true');
});

test('daily catering: offline, yesterday\'s meal does not count today, and a second meal today is refused', async ({ page, context }) => {
  const POINT = 'catering-point';
  const ate = ticket('seclunch0001', 'Lunch Guest', { is_admitted: false, admission_count: 1, last_admitted_window: YESTERDAY });
  const server = gate(
    { id: POINT, name: 'Lunch Hall', location: 'Floor 2', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null, reset_window: 'DAY' },
    [ate],
    // A manifest fetched yesterday still says "admitted" for yesterday: the device must not trust it today.
    { admission_window: YESTERDAY, event_timezone: 'Asia/Tehran', occupancy: null, tickets: [{ ...wireManifest({ checkin_point: { id: POINT, name: '', location: null, policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null }, tickets: [ate] }).tickets[0], is_admitted: true }] },
  );
  await open(page, server.install, POINT, 'Lunch Hall');
  await expect(page.getByText('Once per day')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Scan mode' })).toHaveCount(0);

  await goOffline(context, page);
  await manual(page, ate.qr_secret);
  await expect(page.locator('.scanner-takeover-title')).toHaveText('Admitted (offline)');
  // The same badge is read again only once its verdict has cleared.
  await expect(page.locator('.scanner-takeover-title')).toHaveCount(0);
  await manual(page, ate.qr_secret);
  await expect(page.locator('.scanner-takeover-title')).toHaveText('Duplicate — do not admit');
  expect(hashCode(ate.qr_secret)).toHaveLength(64);
  expect(TODAY).not.toBe(YESTERDAY);
});

test('the scanner sends a heartbeat with its unsynced scans and version, and stops on a revoked credential', async ({ page }) => {
  const POINT = 'heartbeat-point';
  const server = gate(
    { id: POINT, name: 'Heartbeat Gate', location: 'Lobby', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null },
    [ticket('secbeat0001', 'Beat Person')],
    { admission_window: 'event', event_timezone: 'Asia/Tehran', occupancy: null },
  );
  server.state.heartbeatStatus = 401;
  await open(page, server.install, POINT, 'Heartbeat Gate');
  await expect.poll(() => server.state.heartbeats.length, { timeout: 15000 }).toBe(1);
  expect(server.state.heartbeats[0]).toEqual({ unsynced_count: 0, app_version: 'web-scanner/2' });
  // A refused credential blocks the device like any scanner call: no retry with the dead token.
  await expect(page.getByText('Device Deauthorized').first()).toBeVisible();
  await page.waitForTimeout(6000);
  expect(server.state.heartbeats).toHaveLength(1);
});
