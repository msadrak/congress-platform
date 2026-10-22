import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4174';
const apiBaseURL = process.env.CONGRESS_API_BASE_URL ?? baseURL;

test('R01: Real PostgreSQL scanner pairing, manifest access, self-revocation, and denial', async ({ page, request }) => {
  const adminToken = process.env.CONGRESS_PLATFORM_ADMIN_TOKEN;
  test.skip(!adminToken, 'Set CONGRESS_PLATFORM_ADMIN_TOKEN to run against the real FastAPI/PostgreSQL service.');

  const organizerResponse = await request.post(`${apiBaseURL}/api/organizers`, {
    headers: { 'X-Admin-Token': adminToken! },
    data: { name: `Task 05E acceptance ${randomUUID()}` },
  });
  expect(organizerResponse.status()).toBe(201);
  const organizer = await organizerResponse.json() as { api_key: string };
  const auth = { Authorization: `Bearer ${organizer.api_key}` };

  const slug = `task-05e-${randomUUID()}`;
  const eventResponse = await request.post(`${apiBaseURL}/api/events`, {
    headers: auth,
    data: {
      name: 'Task 05E Scanner Acceptance Event',
      slug,
      starts_at: '2027-04-10T08:00:00Z',
      ends_at: '2027-04-10T18:00:00Z',
      location: 'Acceptance environment',
      description: 'Real browser to FastAPI and PostgreSQL scanner lifecycle check.',
    },
  });
  expect(eventResponse.status()).toBe(201);
  const event = await eventResponse.json() as { id: string };

  const pointResponse = await request.post(`${apiBaseURL}/api/events/${event.id}/checkin-points`, {
    headers: auth,
    data: { name: 'Task 05E Real Gate', location: 'Acceptance desk', policy_type: 'MULTI_ENTRY' },
  });
  expect(pointResponse.status()).toBe(201);
  const point = await pointResponse.json() as { id: string };

  const tokenResponse = await request.post(`${apiBaseURL}/api/checkin-points/${point.id}/token`, {
    headers: auth,
    data: { device_name: 'Task 05E Playwright Scanner' },
  });
  expect(tokenResponse.status()).toBe(201);
  const issued = await tokenResponse.json() as { scanner_token: string; device_id: string };

  // Exercise the built UI against the same live API used by the setup requests.
  await page.route('**/api/**', async (route) => {
    const requestURL = new URL(route.request().url());
    const apiURL = new URL(apiBaseURL);
    requestURL.protocol = apiURL.protocol;
    requestURL.host = apiURL.host;
    await route.fulfill({ response: await route.fetch({ url: requestURL.toString() }) });
  });

  await page.goto(`/scan/${point.id}?token=${encodeURIComponent(issued.scanner_token)}`);
  await expect(page.getByText('Task 05E Real Gate')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Re-entry allowed')).toBeVisible();

  await page.getByRole('button', { name: /Unpair This Scanner/i }).click();
  await page.getByRole('button', { name: /Confirm Unpair/i }).click();
  await expect(page.getByRole('heading', { name: 'Scanner Deactivated' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Server revocation confirmed/i)).toBeVisible();

  const listedResponse = await request.get(`${apiBaseURL}/api/checkin-points/${point.id}/devices`, { headers: auth });
  expect(listedResponse.status()).toBe(200);
  const devices = await listedResponse.json() as Array<{ id: string; is_revoked: boolean }>;
  expect(devices.find((device) => device.id === issued.device_id)?.is_revoked).toBe(true);

  const oldCredentialResponse = await request.get(`${apiBaseURL}/api/checkin-points/${point.id}/manifest`, {
    headers: { Authorization: `Bearer ${issued.scanner_token}` },
  });
  expect(oldCredentialResponse.status()).toBe(401);
});
