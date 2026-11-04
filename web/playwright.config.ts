import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL,
  },
  // Opt-in (CI): serve the existing production build (npm run build first) at baseURL for the run. Without it the
  // specs expect a server that is already running there, e.g. `npm run preview -- --host 127.0.0.1 --port 4174`.
  webServer: process.env.CONGRESS_E2E_PREVIEW === '1'
    ? {
      command: `npx vite preview --host 127.0.0.1 --port ${new URL(baseURL).port} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60000,
    }
    : undefined,
  projects: [
    {
      name: 'msedge',
      use: {
        browserName: 'chromium',
        // Microsoft Edge by default; CONGRESS_BROWSER_CHANNEL=chromium uses Playwright's own Chromium
        // (`npx playwright install chromium`), as CI does.
        channel: process.env.CONGRESS_BROWSER_CHANNEL ?? 'msedge',
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
