import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { api, call, createEvent, createOrganizer, createTier, organizerSignIn, uid } from './support/live';

type ManifestTicket = { qr_hash: string; ticket_id: string; attendee_name: string; admission_count: number };
type Manifest = { tickets: ManifestTicket[] };
type DeskTicket = { ticket_id: string; qr_secret: string };

const qrHash = (eventId: string, secret: string) => createHash('sha256').update(`${eventId}:${secret.trim().toLowerCase().slice(0, 64)}`).digest('hex');

/** Creates a check-in point and issues a pairing link through the organizer console; returns the link. */
async function pairingLink(page: Page, eventId: string, gate: string, policy: 'SINGLE_USE' | 'MULTI_ENTRY'): Promise<URL> {
  await page.goto(`/organizer/events/${eventId}/check-in`);
  // Structure-based: the check-in point wording is being renamed («نقطه ورود»), the form's shape is not.
  await page.getByRole('main').getByRole('button', { name: /افزودن/ }).first().click();
  const pointDialog = page.getByRole('dialog');
  await pointDialog.getByRole('textbox').first().fill(gate);
  // The policy select is the one offering this policy (the dialog also has required-point and session selects).
  await pointDialog.getByRole('combobox').filter({ has: page.locator(`option[value="${policy}"]`) }).selectOption(policy);
  await pointDialog.locator('button[type=submit]').click();
  const card = page.getByRole('article', { name: gate });
  await card.getByRole('button', { name: 'اتصال دستگاه' }).click();
  const pairDialog = page.getByRole('dialog', { name: 'اتصال دستگاه اسکنر' });
  await pairDialog.getByLabel('نام دستگاه').fill(`تلفن ${gate}`);
  await pairDialog.getByRole('button', { name: 'صدور لینک اتصال' }).click();
  const ready = pairDialog.getByRole('region', { name: 'دستگاه آماده اتصال است.' });
  const link = (await ready.getByText(/\/scan\/.+\?token=/).innerText()).trim();
  await pairDialog.getByRole('button', { name: 'بستن' }).click();
  return new URL(link);
}

/** Types a badge code into the manual entry field, as a barcode wedge would. */
async function scan(scanner: Page, code: string): Promise<void> {
  await scanner.getByRole('textbox', { name: /رمز کد QR کارت/ }).fill(code);
  await scanner.getByRole('button', { name: 'بررسی ورود' }).click();
}

test('scanner: paired by link, hashed manifest, server-decided admission, single-use rejection, offline queue synced', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key);
  const tier = await createTier(organizer.api_key, event.id);
  const issue = (name: string) => api<DeskTicket>('POST', `/api/events/${event.id}/desk-registrations`, { token: organizer.api_key, body: { full_name: name, ticket_tier_id: tier.id } });
  const reza = `رضا کریمی ${uid()}`;
  const sara = `سارا نوری ${uid()}`;
  const rezaTicket = await issue(reza);
  const saraTicket = await issue(sara);

  await organizerSignIn(page, organizer.api_key);
  const gate = `ورودی شمالی ${uid()}`;
  const link = await pairingLink(page, event.id, gate, 'SINGLE_USE');
  const pointId = link.pathname.split('/').at(-1)!;
  const scannerToken = link.searchParams.get('token')!;

  const device = await browser.newContext();
  const scanner = await device.newPage();
  let manifestBody = '';

  await test.step('pairing link opens the gate and downloads a hashed manifest', async () => {
    const manifestResponse = scanner.waitForResponse((r) => r.url().includes(`/api/checkin-points/${pointId}/manifest`) && r.status() === 200);
    await scanner.goto(`${link.pathname}${link.search}`);
    manifestBody = await (await manifestResponse).text();
    await expect(scanner.getByRole('heading', { level: 1, name: gate })).toBeVisible();
    await expect(scanner.getByText('فقط یک بار ورود')).toBeVisible();
    // The token leaves the address bar once stored.
    await expect(scanner).not.toHaveURL(/token=/);
  });
  const manifest = JSON.parse(manifestBody) as Manifest;
  expect(manifest.tickets.map((t) => t.qr_hash).sort()).toEqual([qrHash(event.id, rezaTicket.qr_secret), qrHash(event.id, saraTicket.qr_secret)].sort());
  for (const secret of [rezaTicket.qr_secret, saraTicket.qr_secret]) expect(manifestBody).not.toContain(secret);

  // The recent-scans log is the only list on the scanner screen.
  const log = scanner.getByRole('main').getByRole('list');
  const verdict = scanner.getByRole('alert');

  await test.step('online scan: the server admits the ticket', async () => {
    const serverScan = scanner.waitForResponse((r) => r.url().endsWith(`/api/checkin-points/${pointId}/scan`));
    await scan(scanner, rezaTicket.qr_secret);
    expect(await (await serverScan).json()).toMatchObject({ status: 'ADMITTED' });
    await expect(verdict.getByRole('heading', { name: 'ورود مجاز و تایید شده' })).toBeVisible();
    await expect(verdict).toContainText(reza);
    await expect(log.getByRole('listitem').filter({ hasText: reza })).toContainText('تأیید سرور');
  });

  await test.step('the same single-use ticket is rejected', async () => {
    await expect(verdict).toBeHidden();
    const serverScan = scanner.waitForResponse((r) => r.url().endsWith(`/api/checkin-points/${pointId}/scan`));
    await scan(scanner, rezaTicket.qr_secret);
    expect(await (await serverScan).json()).toMatchObject({ status: 'REJECTED' });
    await expect(verdict.getByRole('heading', { name: 'تکراری — ورود ممنوع' })).toBeVisible();
  });

  await test.step('offline scan is queued on the device, then synced', async () => {
    await device.setOffline(true);
    await scan(scanner, saraTicket.qr_secret);
    await expect(verdict).toContainText(sara);
    await expect(scanner.getByRole('banner')).toContainText(/صف\s*1\s*در صف/);
    const stillQueued = await api<Manifest>('GET', `/api/checkin-points/${pointId}/manifest`, { token: scannerToken });
    expect(stillQueued.tickets.find((t) => t.attendee_name === sara)?.admission_count).toBe(0);
    await device.setOffline(false);
    await expect(scanner.getByRole('banner')).toContainText(/صف\s*0\s*در صف/, { timeout: 20_000 });
    await expect(log.getByRole('listitem').filter({ hasText: sara })).toContainText('تأیید سرور');
  });

  const after = await api<Manifest>('GET', `/api/checkin-points/${pointId}/manifest`, { token: scannerToken });
  const admissions = Object.fromEntries(after.tickets.map((t) => [t.attendee_name, t.admission_count]));
  expect([admissions[reza], admissions[sara]]).toEqual([1, 1]);
  await device.close();
});

// Formerly web/e2e/scanner-real-api.spec.ts (English copy, skipped without a live API).
test('scanner: unpairing revokes the device on the server and its token stops working', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key, { publish: false });
  await organizerSignIn(page, organizer.api_key);
  const gate = `ورودی آزاد ${uid()}`;
  const link = await pairingLink(page, event.id, gate, 'MULTI_ENTRY');
  const pointId = link.pathname.split('/').at(-1)!;
  const scannerToken = link.searchParams.get('token')!;

  const device = await browser.newContext();
  const scanner = await device.newPage();
  await scanner.goto(`${link.pathname}${link.search}`);
  await expect(scanner.getByRole('heading', { level: 1, name: gate })).toBeVisible();
  await expect(scanner.getByText('ورود مجدد مجاز')).toBeVisible();

  await scanner.getByRole('button', { name: /قطع اتصال این اسکنر/ }).click();
  await scanner.getByRole('button', { name: /تأیید قطع اتصال/ }).click();
  await expect(scanner.getByRole('heading', { name: /اسکنر غیرفعال شد/ })).toBeVisible();
  await expect(scanner.getByText(/ابطال در سرور تأیید شد/)).toBeVisible();

  const devices = await api<Array<{ is_revoked: boolean }>>('GET', `/api/checkin-points/${pointId}/devices`, { token: organizer.api_key });
  expect(devices.map((d) => d.is_revoked)).toEqual([true]);
  expect((await call('GET', `/api/checkin-points/${pointId}/manifest`, { token: scannerToken, expect: [401] })).status).toBe(401);
  await device.close();
});
