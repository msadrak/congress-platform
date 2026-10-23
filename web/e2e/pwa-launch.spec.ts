/**
 * Playwright E2E tests: the installed app (PWA-1).
 *
 * The manifest ships `orientation: any`, a stable `id` and a start URL only a home-screen launch opens;
 * that launch reopens the scanner point the device is paired with (before the app renders, offline too)
 * and is otherwise invisible. Needs the production build (the manifest and service worker are not served
 * by the dev server): `CONGRESS_E2E_PREVIEW=1`, as CI runs it.
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
