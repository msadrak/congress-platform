/**
 * Playwright E2E tests: the installed app (PWA-1, UX-F5).
 *
 * The manifest ships `orientation: any`, a stable `id` and a start URL only a home-screen launch opens;
 * that launch reopens the scanner point the device is paired with, else the attendee's pass (one upcoming
 * congress) or My Congress (several), all before the app renders and offline too. Sign-in carries on with a
 * stored session when the server cannot be reached, and the install row follows one set of rules (iOS steps
 * with no offline promise, the native prompt on Android, never installed, never on a desktop). Needs the
 * production build (the manifest and service worker are not served by the dev server):
 * `CONGRESS_E2E_PREVIEW=1`, as CI runs it.
 *
 * Shipping app + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { wireManifest } from './scannerFixtures';

const POINT_ID = 'pwa-launch-gate';
const tokenPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 })).toString('base64url');
const TOKEN = `e30.${tokenPayload}.pwa-launch-signature`;

const MANIFEST = {
  checkin_point: { id: POINT_ID, name: 'Launch Gate', location: 'Main', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null },
  tickets: [],
};

async function mockApi(page: Page) {
  // Registered first, so it is the fallback: Playwright tries the most recently added route first.
  await page.route(/^https?:\/\/[^/]+\/api\//, route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Not found' }) }));
  await page.route('**/api/checkin-points/*/manifest*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wireManifest(MANIFEST)) }));
}

const storedToken = (page: Page) => page.evaluate(pointId => new Promise<string | null>(resolve => {
  const open = indexedDB.open('congress_scanner_tokens', 1);
  open.onerror = () => resolve(null);
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('tokens')) { db.close(); resolve(null); return; }
    const get = db.transaction('tokens', 'readonly').objectStore('tokens').get(pointId);
    get.onsuccess = () => { db.close(); resolve(get.result ? get.result.token : null); };
    get.onerror = () => { db.close(); resolve(null); };
  };
}), POINT_ID);

const databaseNames = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map(db => db.name));

/** The pairing link an organizer hands to a phone: stores the credential, then strips the token. */
async function pairScanner(page: Page) {
  await page.goto(`/scan/${POINT_ID}?token=${TOKEN}`);
  await expect(page.getByText('Launch Gate')).toBeVisible();
  await expect.poll(() => storedToken(page)).toBe(TOKEN);
}

const onPath = (path: string, search = '') => (url: URL) => url.pathname === path && url.search === search;

test.describe('manifest', () => {
  test('lets the screen rotate, keeps the installed identity and starts at the launch URL', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.orientation).toBe('any');
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/?source=pwa');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  test('is linked from the page and every icon it names is served', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    const manifest = await (await page.request.get('/manifest.webmanifest')).json();
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const served = await page.request.get(icon.src);
      expect(served.ok(), icon.src).toBe(true);
      expect(served.headers()['content-type'], icon.src).toContain('image/png');
    }
  });
});

test.describe('home-screen launch', () => {
  test('an unpaired device lands on the home page with a clean address and nothing is created for it', async ({ page }) => {
    await mockApi(page);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath('/'));
    expect(await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBeGreaterThan(0);
    // Reading for a credential must not create the token database: it would be empty, and pairing
    // (which creates its object store only when the database is new) would stop working for good.
    expect(await databaseNames(page)).not.toContain('congress_scanner_tokens');

    await pairScanner(page);
  });

  test('a paired scanner reopens its own point', async ({ page }) => {
    await mockApi(page);
    await pairScanner(page);

    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath(`/scan/${POINT_ID}`));
    await expect(page.getByText('Launch Gate')).toBeVisible();
    expect(await storedToken(page)).toBe(TOKEN);
  });

  test('an ordinary visit to the home page is never redirected, even on a paired scanner', async ({ page }) => {
    await mockApi(page);
    await pairScanner(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(onPath('/'));
    await expect(page.getByText('Launch Gate')).toHaveCount(0);
  });

  test('keeps other query parameters when it only cleans the address', async ({ page }) => {
    await mockApi(page);
    await page.goto('/?utm=venue&source=pwa');
    await expect(page).toHaveURL(onPath('/', '?utm=venue'));
  });

  test('reopens the point with no network at all (served from the precache)', async ({ context }) => {
    const page = await context.newPage();
    await mockApi(page);
    await pairScanner(page);
    // `ready` resolves once a worker is active, i.e. after install finished precaching the shell.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.goto('/?source=pwa', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(onPath(`/scan/${POINT_ID}`));
    await expect(page.getByText('Launch Gate')).toBeVisible({ timeout: 10000 });
    await context.setOffline(false);
  });
});

// ---- UX-F5: the icon opens the pass, offline sign-in, and when the install row shows -------------------------------

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const ATTENDEE_TOKEN = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const congressPass = (slug: string) => ({
  id: `ticket-${slug}`, event_id: `event-${slug}`, event_name: `${slug[0].toUpperCase()}${slug.slice(1)} Congress`, event_slug: slug,
  event_location: 'Fixture Hall', event_starts_at: inDays(30), event_ends_at: inDays(32), event_timezone: 'Asia/Tehran',
  ticket_tier_id: 't', ticket_tier_name: 'Delegate', attendee_name: 'Sara Fixture', attendee_mobile: null, status: 'active',
  qr_secret: `qr-${slug}`, created_at: inDays(-5),
});

/** The server cannot be reached at all: an installed app opened in a hall with no signal. */
const apiDown = (page: Page) => page.route(/^https?:\/\/[^/]+\/api\//, route => route.abort('internetdisconnected'));

/** An attendee who signed in once and holds cached passes (what a phone has after using the pass page online). */
async function holdPasses(page: Page, slugs: string[], locale: 'en' | 'fa' = 'en') {
  await page.goto('/');
  await page.evaluate(({ token, tickets, locale }) => {
    localStorage.clear();
    localStorage.setItem('congress_attendee_locale', locale);
    localStorage.setItem('congress_attendee_token', token);
    localStorage.setItem('congress_cached_tickets_user-1', JSON.stringify({
      userId: 'user-1', cachedAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, tickets,
    }));
  }, { token: ATTENDEE_TOKEN, tickets: slugs.map(congressPass), locale });
}

const qrButton = (page: Page) => page.getByRole('button', { name: 'Show the QR code full screen' });

test.describe('home-screen launch for an attendee', () => {
  test('one upcoming congress: the icon opens its pass, with the QR, while the server is unreachable', async ({ page }) => {
    await apiDown(page);
    await holdPasses(page, ['alpha']);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath('/c/alpha/my-ticket'));
    await expect(qrButton(page)).toBeVisible({ timeout: 2000 });
  });

  test('several congresses: the icon opens My Congress', async ({ page }) => {
    await apiDown(page);
    await holdPasses(page, ['alpha', 'beta']);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath('/me'));
  });

  test('signed in but no pass yet: the icon opens My Congress', async ({ page }) => {
    await apiDown(page);
    await holdPasses(page, []);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath('/me'));
  });

  test('nothing stored on the device: the home page, with a clean address', async ({ page }) => {
    await apiDown(page);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath('/'));
  });

  test('a paired scanner still opens its own point, even on a phone that also holds a pass', async ({ page }) => {
    await mockApi(page);
    await pairScanner(page);
    await holdPasses(page, ['alpha']);
    await page.goto('/?source=pwa');
    await expect(page).toHaveURL(onPath(`/scan/${POINT_ID}`));
  });

  test('airplane mode: the installed app opens the pass from the precache and the saved pass', async ({ context }) => {
    const page = await context.newPage();
    await holdPasses(page, ['alpha']);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.waitForTimeout(2000);

    await context.setOffline(true);
    await page.goto('/?source=pwa', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(onPath('/c/alpha/my-ticket'));
    await expect(qrButton(page)).toBeVisible({ timeout: 10000 });
    await context.setOffline(false);
  });
});

test.describe('sign-in with a stored session', () => {
  test('carries on to the destination when the server cannot be reached (no phone form)', async ({ page }) => {
    await apiDown(page);
    await holdPasses(page, ['alpha']);
    await page.goto('/sign-in');
    await expect(page).toHaveURL(onPath('/me'));
    await expect(page.getByTestId('otp-mobile-step')).toHaveCount(0);
  });

  test('honours the address it was sent from', async ({ page }) => {
    await apiDown(page);
    await holdPasses(page, ['alpha']);
    await page.goto('/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await expect(page).toHaveURL(onPath('/c/alpha/my-ticket'));
    await expect(qrButton(page)).toBeVisible();
  });

  test('without a stored session the phone form is still shown, offline or not', async ({ page }) => {
    await apiDown(page);
    await page.goto('/sign-in');
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  });
});

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.12.108 (iPhone14,5; iOS 17_4; en_US; en; scale=3.00; 1170x2532; 566000000)';
const PIXEL_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const fireInstallPrompt = (page: Page) => page.evaluate(() => {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: () => { (window as unknown as { __prompted: number }).__prompted = ((window as unknown as { __prompted?: number }).__prompted ?? 0) + 1; return Promise.resolve(); },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });
  window.dispatchEvent(event);
});

async function openPassPage(page: Page, locale: 'en' | 'fa' = 'en') {
  await apiDown(page);
  await holdPasses(page, ['alpha'], locale);
  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByTestId('pass-status')).toBeVisible();
}

test.describe('install row on iOS Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('offers the steps, makes no offline promise, and the sheet has three steps', async ({ page }) => {
    for (const [locale, offline] of [['en', /offline|internet/i], ['fa', /اینترنت|آفلاین/]] as const) {
      await openPassPage(page, locale);
      const row = page.getByTestId('install-hint');
      await expect(row).toBeVisible();
      await expect(row).not.toContainText(offline);
      await page.getByTestId('install-how').click();
      const steps = page.getByTestId('install-ios-step');
      await expect(steps).toHaveCount(3);
      await expect(page.getByTestId('install-ios-steps')).not.toContainText(offline);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('install-ios-steps')).toHaveCount(0);
    }
  });

  test('"Not now" is remembered', async ({ page }) => {
    await openPassPage(page);
    await page.getByTestId('install-hint').getByRole('button', { name: 'Not now' }).click();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('pass-status')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });

  test('never inside the installed iOS app (navigator.standalone)', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
    await openPassPage(page);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });

  test('never on My Congress, the congress home or the public pages', async ({ page }) => {
    await openPassPage(page);
    await expect(page.getByTestId('install-hint')).toBeVisible();
    for (const path of ['/me', '/c/alpha/my-congress', '/c/alpha/my-network', '/c/alpha/my-profile', '/']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('install-hint'), path).toHaveCount(0);
    }
  });
});

test.describe('install row in an iOS in-app browser', () => {
  test.use({ userAgent: IPHONE_INSTAGRAM, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('offers nothing: there is no way to add to the home screen from there', async ({ page }) => {
    await openPassPage(page);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });
});

test.describe('install row on Android Chrome', () => {
  test.use({ userAgent: PIXEL_CHROME, viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

  test('shows only once the browser offers installation, uses the native prompt, and hides after it', async ({ page }) => {
    await openPassPage(page);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    await fireInstallPrompt(page);
    const row = page.getByTestId('install-hint');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('install-action')).toHaveText('Add');
    await row.getByTestId('install-action').click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('congress_install_hint_dismissed'))).toBe('1');
  });

  test('hides when the app gets installed some other way', async ({ page }) => {
    await openPassPage(page);
    await fireInstallPrompt(page);
    await expect(page.getByTestId('install-hint')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });

  test('is in Persian for a Persian pass page', async ({ page }) => {
    await openPassPage(page, 'fa');
    await fireInstallPrompt(page);
    const row = page.getByTestId('install-hint');
    await expect(row).toContainText('افزودن کارت ورود به صفحهٔ اصلی');
    await expect(row.getByTestId('install-action')).toHaveText('افزودن');
  });

  test('never offers anything inside the installed app (display-mode: standalone)', async ({ page }) => {
    // Chrome ignores `display-mode` in CDP `Emulation.setEmulatedMedia`, so the query itself is answered here.
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        const list = real(query);
        if (!/display-mode:\s*standalone/.test(query)) return list;
        return new Proxy(list, {
          get(target, property) {
            if (property === 'matches') return true;
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
    });
    await openPassPage(page);
    await fireInstallPrompt(page);
    await expect(page.getByTestId('pass-status')).toBeVisible();
    expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });
});

test.describe('install row on a desktop', () => {
  test('never shows, even when the browser offers installation', async ({ page }) => {
    await openPassPage(page);
    await fireInstallPrompt(page);
    await expect(page.getByTestId('pass-status')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });
});

test.describe('full-screen pass QR', () => {
  // The screen must stay awake while the QR is held up at the gate. `QrFullscreen` moves onto `useWakeLock`
  // in UX-ATT-PASS; this keeps the behaviour pinned across that change.
  test('holds a screen wake lock while open and releases it on close', async ({ page }) => {
    await page.addInitScript(() => {
      const record = { requests: [] as string[], released: 0 };
      (window as unknown as { __wake: typeof record }).__wake = record;
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async (type: string) => {
            record.requests.push(type);
            const sentinel = { released: false, release: async () => { sentinel.released = true; record.released += 1; } };
            return sentinel;
          },
        },
      });
    });
    await openPassPage(page);
    await qrButton(page).click();
    await expect(page.getByTestId('qr-fullscreen')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: { requests: string[] } }).__wake.requests)).toEqual(['screen']);
    await page.getByTestId('qr-fullscreen').click();
    await expect(page.getByTestId('qr-fullscreen')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __wake: { released: number } }).__wake.released)).toBe(1);
  });
});
