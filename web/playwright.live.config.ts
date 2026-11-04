import { defineConfig } from '@playwright/test';

/**
 * The live-stack suite (e2e-live/): real FastAPI + PostgreSQL behind the production build. Run it with
 * `node scripts/integration/live-e2e.mjs`, which starts the disposable stack and sets LIVE_E2E_* for this config.
 * Every spec provisions its own organizer and event through the API, so specs are independent and run in parallel.
 */
const baseURL = process.env.LIVE_E2E_BASE_URL;
if (!baseURL) throw new Error('LIVE_E2E_BASE_URL is not set: run the suite with `node scripts/integration/live-e2e.mjs`.');

export default defineConfig({
  testDir: './e2e-live',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: Number(process.env.LIVE_E2E_WORKERS ?? 3),
  // A real stack has real timing; one retry in CI absorbs a slow container, and a retried pass is reported as flaky.
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-live-report' }]] : 'list',
  outputDir: 'test-results-live',
  use: {
    baseURL,
    locale: 'fa-IR',
    timezoneId: 'Asia/Tehran',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // CI uses Playwright's Chromium; locally CONGRESS_BROWSER_CHANNEL=chrome (or msedge) uses an installed browser.
        channel: process.env.CONGRESS_BROWSER_CHANNEL ?? 'chromium',
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
