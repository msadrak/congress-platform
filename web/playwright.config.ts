import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4174',
  },
  projects: [
    {
      name: 'msedge',
      use: {
        browserName: 'chromium',
        channel: 'msedge',
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
