import { expect, test } from '@playwright/test';
import { createEvent, createOrganizer, organizerSignIn, signInWithCode, uid, uniqueMobile, waitForSms } from './support/live';

test.use({ viewport: { width: 1280, height: 900 } });

test('member roles: owner invites a viewer, who signs in by SMS code, cannot edit, and the invite is in the activity log', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key, { publish: false });
  const viewerMobile = uniqueMobile();
  const viewerName = `ناظر ${uid()}`;

  await test.step('owner (API key) invites a viewer', async () => {
    await organizerSignIn(page, organizer.api_key);
    await page.getByRole('link', { name: 'اعضا' }).click();
    await page.getByRole('button', { name: 'افزودن عضو' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'افزودن عضو' });
    await dialog.getByLabel('نام').fill(viewerName);
    await dialog.getByLabel('شماره موبایل').fill(viewerMobile);
    await dialog.getByRole('radio', { name: /^ناظر/ }).check();
    await dialog.getByRole('button', { name: 'افزودن و ارسال پیامک' }).click();
    await expect(page.getByRole('status').filter({ hasText: viewerName })).toBeVisible();
    await expect(page.getByRole('combobox', { name: `نقش ${viewerName}` })).toHaveValue('viewer');
  });
  const invite = await waitForSms(viewerMobile, 'member_invite');
  expect(invite.text).toContain('«ناظر»');

  const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const viewer = await viewerContext.newPage();

  await test.step('viewer signs in to the console by SMS code', async () => {
    await viewer.goto('/organizer');
    await signInWithCode(viewer, viewerMobile);
    await expect(viewer.getByRole('heading', { name: 'مدیریت همایش‌ها و کنگره‌ها' })).toBeVisible();
    await expect(viewer.getByText(`${viewerName}`)).toBeVisible();
    await expect(viewer.getByRole('article', { name: event.name })).toBeVisible();
  });

  await test.step('viewer cannot create an event: the refusal is explained in Persian', async () => {
    await viewer.getByRole('button', { name: 'ایجاد همایش جدید' }).first().click();
    const dialog = viewer.getByRole('dialog', { name: 'ثبت همایش جدید' });
    await dialog.getByLabel('عنوان رسمی همایش').fill(`همایش ممنوع ${uid()}`);
    await dialog.getByLabel(/شناسه اینترنتی/).fill(`forbidden-${uid()}`);
    await dialog.getByLabel('زمان آغاز همایش').fill('2027-05-10T09:00');
    await dialog.getByLabel('زمان پایان همایش').fill('2027-05-10T17:00');
    await dialog.getByLabel(/محل برگزاری/).fill('سالن');
    await dialog.getByRole('button', { name: 'ثبت و ایجاد همایش' }).click();
    await expect(dialog.getByText('نقش شما در این سازمان اجازهٔ این کار را نمی‌دهد. از مالک یا مدیر سازمان بخواهید.')).toBeVisible();
  });

  await test.step('the activity log records the invite', async () => {
    await page.getByRole('link', { name: 'گزارش فعالیت' }).click();
    await expect(page.getByRole('heading', { name: 'گزارش فعالیت' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: viewerName }).first()).toBeVisible();
  });
  await viewerContext.close();
});
