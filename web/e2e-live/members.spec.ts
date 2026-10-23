import { expect, test } from '@playwright/test';
import { call, createEvent, createOrganizer, organizerSignIn, signInWithCode, uid, uniqueMobile, waitForSms } from './support/live';

test.use({ viewport: { width: 1280, height: 900 } });

test('member roles: owner invites a viewer, who signs in by SMS code, cannot edit, and the invite is in the activity log', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key, { publish: false });
  const viewerMobile = uniqueMobile();
  const viewerName = `ناظر ${uid()}`;

  await test.step('owner (API key) invites a viewer', async () => {
    await organizerSignIn(page, organizer.api_key);
    await page.getByRole('link', { name: 'اعضا' }).click();
    await page.getByRole('button', { name: 'عضو جدید' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'عضو جدید' });
    await dialog.getByRole('textbox', { name: 'نام', exact: true }).fill(viewerName);
    await dialog.getByRole('textbox', { name: 'شماره موبایل' }).fill(viewerMobile);
    await dialog.getByRole('radio', { name: /^ناظر/ }).check();
    await dialog.getByRole('button', { name: 'افزودن', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: viewerName })).toBeVisible();
    await expect(page.getByTestId('members-table').getByRole('row').filter({ hasText: viewerName })).toContainText('ناظر');
  });
  const invite = await waitForSms(viewerMobile, 'member_invite');
  expect(invite.text).toContain('«ناظر»');

  const viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const viewer = await viewerContext.newPage();

  await test.step('viewer signs in to the console by SMS code', async () => {
    await viewer.goto('/organizer');
    await signInWithCode(viewer, viewerMobile);
    await expect(viewer.getByRole('heading', { name: 'همایش‌ها', level: 1 })).toBeVisible();
    await expect(viewer.getByText(`${viewerName}`)).toBeVisible();
    await expect(viewer.getByRole('article', { name: event.name })).toBeVisible();
  });

  await test.step('viewer is not offered event creation, and the server refuses it for their role', async () => {
    // The console hides what a viewer can never do (components/organizer/roleAccess.ts); the server still decides.
    await expect(viewer.getByRole('button', { name: 'همایش جدید' })).toHaveCount(0);
    const token = await viewer.evaluate(() => sessionStorage.getItem('congress_organizer_api_key'));
    expect(token).toBeTruthy();
    const refused = await call<{ code?: string }>('POST', '/api/events', {
      token: token ?? '',
      expect: [403],
      body: { name: `همایش ممنوع ${uid()}`, slug: `forbidden-${uid()}`, starts_at: '2027-05-10T05:30:00Z', ends_at: '2027-05-10T13:30:00Z', location: 'سالن' },
    });
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('ROLE_FORBIDDEN');
  });

  await test.step('the activity log records the invite', async () => {
    await page.getByRole('link', { name: 'گزارش فعالیت' }).click();
    await expect(page.getByRole('heading', { name: 'گزارش فعالیت' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: viewerName }).first()).toBeVisible();
  });
  await viewerContext.close();
});
