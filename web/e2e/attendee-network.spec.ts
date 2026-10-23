import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { contactOf, panelApi, signIn, type Recorded } from './attendeePanelFixtures';

const many = Array.from({ length: 25 }, (_, i) => contactOf(i + 1));

async function typeCode(page: Page, code = 'peer-secret-1') {
  await page.getByRole('tab', { name: 'Scan' }).click();
  await page.getByRole('button', { name: 'No camera? Enter the code' }).click();
  await page.getByLabel("Colleague's pass code").fill(code);
  await page.getByRole('button', { name: 'Add to My Network' }).click();
}

const refuseScan = (status: number, body: object, headers: Record<string, string> = {}) => (route: Route, request: Recorded) =>
  request.path === '/api/attendees/me/network/scan'
    ? route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
    : undefined;

test('my code shows the attendee’s own pass QR; the privacy switch lives in the profile', async ({ page }) => {
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await expect(page.getByRole('tab', { name: 'My code' })).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('svg title')).toHaveText('My code');
  await expect(panel.getByText('Sara Fixture')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /My Profile/ }).last()).toHaveAttribute('href', '/c/alpha/my-profile');
});

test('without an active pass, my code points to registration', async ({ page }) => {
  await panelApi(page, { tickets: [] });
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await expect(page.getByText('You need an active pass for this congress to network here.')).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('link', { name: /Get a pass/ })).toHaveAttribute('href', '/e/alpha');
});

test('a scanned contact is highlighted first; the list searches, loads more and removes after confirmation', async ({ page }) => {
  const requests = await panelApi(page, { contacts: [...many] });
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await expect(page.getByText('25 contacts')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByText('20 of 25')).toBeVisible();
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect(page.getByRole('article')).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  expect(requests.filter(r => r.path === '/api/attendees/me/network/search').map(r => r.search.get('cursor'))).toEqual([null, '20']);
  expect(requests.filter(r => r.path === '/api/attendees/me/network/search').every(r => r.search.get('event_id') === 'event-a')).toBe(true);

  await typeCode(page);
  await expect(page.getByRole('status').filter({ hasText: 'New Colleague was added to your network.' })).toBeVisible();
  const first = page.getByRole('article').first();
  await expect(first.getByRole('heading', { name: 'New Colleague' })).toBeVisible();
  await expect(first.getByText('New', { exact: true })).toBeVisible();
  await expect(page.getByText('26 contacts')).toBeVisible();

  await page.getByLabel('Search contacts').fill('Peer 3');
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(requests.some(r => r.path === '/api/attendees/me/network/search' && r.search.get('q') === 'Peer 3')).toBe(true);

  await page.getByRole('button', { name: 'Remove Peer 3 from my network' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Peer 3 and your private note about them are removed from your network.');
  await dialog.getByRole('button', { name: 'Remove contact' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Peer 3 was removed from your network.' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  expect(requests.some(r => r.method === 'DELETE' && r.path === '/api/attendees/me/network/conn-3')).toBe(true);
});

test('cancelling the removal keeps the contact and sends nothing', async ({ page }) => {
  const requests = await panelApi(page, { contacts: [contactOf(1)] });
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await page.getByRole('button', { name: 'Remove Peer 1 from my network' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  expect(requests.some(r => r.method === 'DELETE')).toBe(false);
});

test('a rate-limited scan counts down Retry-After and holds the scanner', async ({ page }) => {
  await panelApi(page, { override: refuseScan(429, { detail: 'Too many scans', code: 'CONNECTION_SCAN_RATE_LIMITED' }, { 'Retry-After': '90' }) });
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await typeCode(page);
  await expect(page.getByRole('status').filter({ hasText: /Too many scans\. Try again in 1:(30|29|28)\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to My Network' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Scan with camera' })).toBeDisabled();
});

test('a scan without an active pass explains it and links to registration', async ({ page }) => {
  await panelApi(page, { override: refuseScan(403, { detail: 'An active ticket is required', code: 'ACTIVE_TICKET_REQUIRED' }) });
  await signIn(page);
  await page.goto('/c/alpha/my-network');
  await typeCode(page);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('You need an active pass for this congress to do that.');
  await expect(alert.getByRole('link', { name: /Get a pass/ })).toHaveAttribute('href', '/e/alpha');
});

for (const [code, status, text] of [
  ['BADGE_OWN', 409, 'You cannot scan your own pass.'],
  ['BADGE_OTHER_EVENT', 409, 'This pass belongs to another congress and was not saved.'],
  ['BADGE_NOT_FOUND', 404, 'This QR code is not an attendee pass.'],
] as const) {
  test(`scan refusal ${code} is shown in the reader's language`, async ({ page }) => {
    await panelApi(page, { override: refuseScan(status, { detail: 'English detail', code }) });
    await signIn(page);
    await page.goto('/c/alpha/my-network');
    await typeCode(page);
    await expect(page.getByRole('alert')).toContainText(text);
  });
}

test('Persian: the scan refusal is Persian and the page fits 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await panelApi(page, { override: refuseScan(409, { detail: 'English detail', code: 'BADGE_OWN' }) });
  await signIn(page, 'fa');
  await page.goto('/c/alpha/my-network');
  await page.getByRole('tab', { name: 'اسکن' }).click();
  await page.getByRole('button', { name: 'دوربین ندارید؟ کد را وارد کنید' }).click();
  await page.getByLabel('کد کارت ورود همکار').fill('peer-secret-1');
  await page.getByRole('button', { name: 'افزودن به شبکهٔ من' }).click();
  await expect(page.getByRole('alert')).toContainText('نمی‌توانید کارت ورود خودتان را اسکن کنید.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});
