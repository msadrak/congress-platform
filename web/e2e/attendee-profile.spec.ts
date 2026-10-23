import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { bearer, panelApi, signIn } from './attendeePanelFixtures';

test('name, organization and title are edited through PATCH /api/auth/me with the pass note', async ({ page }) => {
  const requests = await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/my-profile');
  await expect(page.getByText('These changes also update your pass for upcoming congresses')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();

  await page.getByLabel('Full name').fill('Dr. Sara Fixture');
  await page.getByLabel('Title').fill('Interventional cardiologist');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Your details were saved.' })).toBeVisible();
  const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/auth/me');
  expect(patch?.auth).toBe(bearer);
  expect(patch?.body).toEqual({ full_name: 'Dr. Sara Fixture', organization: 'Heart Center', title: 'Interventional cardiologist' });
  await expect(page.getByRole('heading', { level: 1, name: 'Dr. Sara Fixture' })).toBeVisible();

  // An empty name is refused before any request.
  const before = requests.length;
  await page.getByLabel('Full name').fill('   ');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Enter your full name.');
  expect(requests.filter(r => r.method === 'PATCH').length).toBe(requests.slice(0, before).filter(r => r.method === 'PATCH').length);
});

test('the exhibitor consent switch saves through the profile; the knob moves toward the reading end', async ({ page }) => {
  const requests = await panelApi(page);
  await signIn(page, 'fa');
  await page.goto('/c/alpha/my-profile');
  const exhibitors = page.getByRole('switch', { name: 'نمایش اطلاعات تماس به غرفه‌داران' });
  await expect(exhibitors).toHaveAttribute('aria-checked', 'false');
  const knob = exhibitors.locator('span');
  const offX = (await knob.boundingBox())?.x ?? 0;
  await exhibitors.click();
  await expect(exhibitors).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status').filter({ hasText: 'تنظیم ذخیره شد.' })).toBeVisible();
  expect(requests.find(r => r.method === 'PATCH' && r.path === '/api/auth/me')?.body).toEqual({ share_contact_with_exhibitors: true });
  // Persian reads right to left: "on" moves the knob left.
  await expect.poll(async () => (await knob.boundingBox())?.x ?? 0).toBeLessThan(offX);

  await page.reload();
  await expect(page.getByRole('switch', { name: 'نمایش اطلاعات تماس به غرفه‌داران' })).toHaveAttribute('aria-checked', 'true');
});

test('language, data export and sign-out', async ({ page }) => {
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/my-profile');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('my-congress-data.json');
  expect(JSON.parse(await readFile(await file.path(), 'utf8')).profile.full_name).toBe('Sara Fixture');

  await page.getByRole('radio', { name: 'فارسی' }).click();
  await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
  await expect(page.getByRole('radio', { name: 'فارسی' })).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('congress_attendee_locale'))).toBe('fa');

  await page.getByRole('button', { name: 'خروج از حساب' }).last().click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
  expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
});

test('deleting the account needs the typed word, explains the consequences and ends the session', async ({ page }) => {
  const requests = await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/my-profile');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Passes for congresses that have not ended are cancelled and stop working.');
  await expect(dialog).toContainText('Your contacts, private notes and saved booths are deleted.');
  const confirm = dialog.getByRole('button', { name: 'Delete account for good' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('To confirm, type “DELETE”').fill('delete');
  await expect(confirm).toBeEnabled();

  // Cancel first: nothing is sent.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some(r => r.method === 'DELETE')).toBe(false);

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('dialog').getByLabel('To confirm, type “DELETE”').fill('DELETE');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete account for good' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your account was deleted' })).toBeVisible();
  expect(requests.find(r => r.method === 'DELETE' && r.path === '/api/auth/me')?.auth).toBe(bearer);
  expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
});
