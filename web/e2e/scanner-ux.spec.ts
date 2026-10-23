import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectScannerOnline, gateScreen, manualScan, verdictTitle, wireManifest, type FixtureTicket } from './scannerFixtures';

/**
 * The scanner's screen (docs/ux-review/ops/SPEC.md §3.1–3.2, WP-D): one screen without page scroll on a phone and a
 * kiosk, verdicts readable at arm's length, Persian digits, unpair only in the menu, pairing by scanning the pairing
 * QR code inside the app, the wake lock, and the remembered camera that restarts after the screen locks.
 *
 * Synthetic, intercepted /api/ responses.
 */

const POINT = 'ux-point';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.ux-signature`;
const PHONE = { width: 390, height: 844 };
const KIOSK = { width: 1180, height: 820 };

const ticket = (secret: string, name: string, admitted = false): FixtureTicket => ({
  qr_secret: secret, ticket_id: `t-${secret}`, attendee_name: name, ticket_tier_id: 'tier', ticket_tier_name: 'عمومی',
  is_admitted: admitted, admission_count: admitted ? 1 : 0,
});
const SARA = ticket('secsara000001', 'سارا محمدی');
const ALI = ticket('secali0000002', 'علی رضایی', true);

async function fakeServer(page: Page) {
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const admitted = new Set([ALI.qr_secret]);
  const decide = (s: { scan_id: string; qr_secret: string; direction?: string }) => {
    const known = [SARA, ALI].find((t) => t.qr_secret === s.qr_secret);
    const base = { scan_id: s.scan_id, qr_secret: s.qr_secret, clock_skew: false, direction: s.direction ?? 'IN', attendee_name: known?.attendee_name, ticket_tier_name: known?.ticket_tier_name };
    if (!known) return { ...base, status: 'REJECTED', rejection_reason: 'INVALID_TICKET' };
    if (admitted.has(s.qr_secret)) return { ...base, status: 'REJECTED', rejection_reason: 'ALREADY_ADMITTED' };
    admitted.add(s.qr_secret);
    return { ...base, status: 'ADMITTED', rejection_reason: null };
  };
  await page.route('**/api/checkin-points/*/manifest*', (route) => route.fulfill(json({
    ...wireManifest({ checkin_point: { id: POINT, name: 'درِ اصلی سالن همایش', location: null, policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null }, tickets: [SARA, ALI] }),
    admission_window: 'event', event_timezone: 'Asia/Tehran',
  })));
  await page.route('**/api/checkin-points/*/scan', (route) => route.fulfill(json(decide(route.request().postDataJSON()))));
  await page.route('**/api/checkin-points/*/scans/batch', (route) => {
    const posted = route.request().postDataJSON() as { scans: Array<{ scan_id: string; qr_secret: string }> };
    return route.fulfill(json({ results: posted.scans.map(decide) }));
  });
  await page.route('**/api/checkin-points/*/devices/self/heartbeat', (route) => route.fulfill(json({ id: 'device', unsynced_count: 0 })));
}

async function openScanner(page: Page, locale: 'fa' | 'en', { paired = true } = {}) {
  await page.addInitScript((value) => localStorage.setItem('congress_attendee_locale', value), locale);
  await fakeServer(page);
  await page.goto(paired ? `/scan/${POINT}?token=${TOKEN}` : `/scan/${POINT}`);
  if (paired) await expectScannerOnline(page, 'درِ اصلی سالن همایش');
}

/** A camera that "sees" whatever the test puts in front of it, and a counter of the streams the page asked for. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const win: Window & { __seen?: string[]; __streams?: number; BarcodeDetector?: unknown } = window;
    win.__seen = [];
    win.__streams = 0;
    win.BarcodeDetector = class {
      async detect() { const next = win.__seen?.[0]; return next ? [{ rawValue: next }] : []; }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      win.__streams = (win.__streams ?? 0) + 1;
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      const paint = () => { ctx?.fillRect(0, 0, 64, 64); requestAnimationFrame(paint); };
      paint();
      return canvas.captureStream(15);
    };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (async (descriptor: PermissionDescriptor) =>
      descriptor.name === ('camera' as PermissionName) ? ({ state: 'granted' } as PermissionStatus) : query(descriptor)) as typeof navigator.permissions.query;
  });
}
const showToCamera = (page: Page, value: string) => page.evaluate((v) => {
  const win: Window & { __seen?: string[] } = window;
  win.__seen = [v];
}, value);
const streamsOpened = (page: Page) => page.evaluate(() => (window as Window & { __streams?: number }).__streams ?? 0);

for (const locale of ['fa', 'en'] as const) {
  test(`${locale}: the live screen fits a phone and a kiosk without scrolling`, async ({ page }) => {
    for (const viewport of [PHONE, KIOSK]) {
      await page.setViewportSize(viewport);
      await openScanner(page, locale);
      const [scroll, height] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
      expect(scroll).toBeLessThanOrEqual(height);
      // Unpairing lives in the ⋮ menu only.
      await expect(page.getByRole('button', { name: /unpair|قطع اتصال/i })).toHaveCount(0);
    }
  });
}

test('fa: verdicts are one word, big enough at arm\'s length, and use the decided terms', async ({ page }) => {
  for (const [viewport, minPx] of [[PHONE, 44], [KIOSK, 64]] as const) {
    await page.setViewportSize(viewport);
    await openScanner(page, 'fa');
    await manualScan(page, SARA.qr_secret);
    await expect(verdictTitle(page)).toHaveText('مجاز');
    const size = await verdictTitle(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(minPx);
    const verdict = page.getByTestId('scanner-verdict');
    await expect(verdict).toContainText(SARA.attendee_name);
    expect((await verdict.innerText()).match(/مجاز|Admit/g)).toHaveLength(1);
    await expect(page.locator('body')).not.toContainText(/بلیت|سطح دسترسی/);

    await expect(verdictTitle(page)).toHaveCount(0, { timeout: 5000 });
    await manualScan(page, ALI.qr_secret);
    await expect(verdictTitle(page)).toHaveText('تکراری');
    await expect(verdict).toContainText(ALI.attendee_name);
    // No «رد شد» line above the word (as a whole line: «وارد شده» in the reason contains the letters).
    expect((await verdict.innerText()).split('\n').map((line) => line.trim())).not.toContain('رد شد');
  }
});

test('fa: times and counts use Persian digits', async ({ page }) => {
  await page.setViewportSize(KIOSK);
  await openScanner(page, 'fa');
  await manualScan(page, SARA.qr_secret);
  const log = page.getByRole('region', { name: 'آخرین اسکن‌ها' });
  await expect(log.getByRole('listitem')).toHaveCount(1);
  await expect(log).toContainText(/[۰-۹]{2}:[۰-۹]{2}/);
  expect(await page.locator('body').innerText()).not.toMatch(/[0-9]{2}:[0-9]{2}/);
});

test('fa: the menu holds sound, language, the queue, the version and unpair', async ({ page }) => {
  await openScanner(page, 'fa');
  await page.getByRole('button', { name: 'منو' }).click();
  const menu = page.getByRole('menu');
  for (const item of ['خاموش کردن صدا', 'English', 'آخرین اسکن‌ها', 'تازه‌سازی فهرست', 'ارسال صف', 'قطع اتصال دستگاه']) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await expect(menu).toContainText(/web-scanner\/2\+/);
  await menu.getByRole('menuitem', { name: 'قطع اتصال دستگاه' }).click();
  await expect(page.getByRole('dialog', { name: 'اتصال این دستگاه قطع شود؟' })).toBeVisible();
});

test('the live scanner keeps the screen awake', async ({ page }) => {
  await page.addInitScript(() => {
    const win: Window & { __wakeLocks?: number } = window;
    win.__wakeLocks = 0;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: async () => { win.__wakeLocks = (win.__wakeLocks ?? 0) + 1; return { released: false, release: async () => undefined }; } },
    });
  });
  await openScanner(page, 'fa');
  await expect.poll(() => page.evaluate(() => (window as Window & { __wakeLocks?: number }).__wakeLocks)).toBeGreaterThan(0);
});

test('fa: an unpaired device pairs by scanning the pairing QR code, which must name this point', async ({ page }) => {
  await fakeCamera(page);
  await openScanner(page, 'fa', { paired: false });
  await expect(gateScreen(page, 'unpaired')).toBeVisible();
  // Persian only, apart from the language switch and the folded technical details.
  const english = await page.locator('[lang="en"]:visible').evaluateAll((els) => els.filter((el) => !el.closest('details') && el.tagName !== 'BUTTON').length);
  expect(english).toBe(0);

  await page.getByRole('button', { name: 'اسکن کد QR اتصال' }).click();
  await showToCamera(page, `http://127.0.0.1/scan/another-point?token=${TOKEN}`);
  await expect(page.getByRole('alert')).toHaveText('این کد QR برای نقطهٔ ورود دیگری است.');
  await showToCamera(page, `${new URL(page.url()).origin}/scan/${POINT}?token=${TOKEN}`);
  await expectScannerOnline(page, 'درِ اصلی سالن همایش');
});

test('the camera choice is remembered per point, and a camera killed by a locked screen starts again', async ({ page }) => {
  await fakeCamera(page);
  await openScanner(page, 'en');
  await page.getByRole('button', { name: 'Turn on camera' }).click();
  await expect(page.getByRole('button', { name: 'Turn off camera' })).toBeVisible();
  expect(await page.evaluate((p) => localStorage.getItem(`congress_scanner_camera_${p}`), POINT)).toBe('on');

  // Reopened: the camera starts by itself.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Turn off camera' })).toBeVisible({ timeout: 10000 });
  const before = await streamsOpened(page);

  // The screen locked and the track ended; back on the page, a new stream is opened.
  await page.evaluate(() => {
    const video = document.querySelector('video');
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) stream.getVideoTracks().forEach((track) => track.stop());
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => streamsOpened(page)).toBe(before + 1);

  // Turned off by the operator: not started again next time.
  await page.getByRole('button', { name: 'Turn off camera' }).click();
  expect(await page.evaluate((p) => localStorage.getItem(`congress_scanner_camera_${p}`), POINT)).toBeNull();
});
