import { expect, test } from '@playwright/test';
import { api, createEvent, createOrganizer, createTier, signInWithCode, uid, uniqueMobile, waitForSms } from './support/live';

type ParticipantPage = { items: Array<{ attendee_full_name: string; status: string }>; total: number };

test('attendee: public page, SMS-code sign-up, reserve, pass with QR, short link signed out, self-cancel', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key);
  const tier = await createTier(organizer.api_key, event.id, `کارت عمومی ${uid()}`, 10);
  const mobile = uniqueMobile();
  const fullName = `مریم رضایی ${uid()}`;

  await test.step('the public page offers the tier', async () => {
    await page.goto(`/e/${event.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: event.name })).toBeVisible();
    await expect(page.getByRole('radio', { name: new RegExp(tier.name) })).toBeChecked();
  });

  await test.step('reserve: SMS code from the outbox, profile step for a new number', async () => {
    await page.getByRole('button', { name: 'رزرو رایگان کارت ورود' }).click();
    // The dialog's title follows the step («دریافت کارت ورود …», then «نام شما روی کارت ورود»).
    const dialog = page.getByRole('dialog');
    await signInWithCode(dialog, mobile, fullName);
  });

  await test.step('success sheet shows the pass QR', async () => {
    const sheet = page.getByRole('dialog', { name: 'کارت ورود شما آماده است' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(`نوع کارت ورود: ${tier.name}`)).toBeVisible();
    await expect(sheet.getByRole('img', { name: 'کد QR کارت ورود شما' })).toBeVisible();
    await sheet.getByRole('button', { name: 'نمایش کارت ورود' }).click();
  });

  await test.step('pass page shows the QR, holder and tier', async () => {
    const pass = page.getByRole('article', { name: event.name });
    await expect(pass.getByRole('button', { name: 'نمایش تمام‌صفحه کد QR' })).toBeVisible();
    await expect(pass).toContainText(fullName);
    await expect(pass).toContainText(tier.name);
  });

  const confirmation = await waitForSms(mobile, 'ticket_confirmation');
  expect(confirmation.text).toContain(fullName);
  const link = new URL(/https?:\/\/\S+\/t\/\S+/.exec(confirmation.text)?.[0] ?? '');

  await test.step('the SMS short link opens the pass in a signed-out browser', async () => {
    const stranger = await browser.newContext();
    const linkPage = await stranger.newPage();
    await linkPage.goto(link.pathname);
    await expect(linkPage.getByText('کارت ورود از پیوند پیامک')).toBeVisible();
    const pass = linkPage.getByRole('article', { name: event.name });
    await expect(pass.getByRole('button', { name: 'نمایش تمام‌صفحه کد QR' })).toBeVisible();
    await expect(pass).toContainText(fullName);
    // The code leaves the address bar once the pass is open (ADR 0015).
    await expect(linkPage).not.toHaveURL(/\/t\//);
    await stranger.close();
  });

  await test.step('self-cancel frees the seat', async () => {
    await page.getByRole('button', { name: 'لغو ثبت‌نام' }).click();
    const confirm = page.getByRole('dialog', { name: 'ثبت‌نام لغو شود؟' });
    await confirm.getByRole('button', { name: 'بله، لغو شود' }).click();
    await expect(page.getByText('این کارت ورود لغو شده است').first()).toBeVisible();
  });
  const participants = await api<ParticipantPage>('GET', `/api/events/${event.id}/participants`, { token: organizer.api_key });
  expect(participants.items.map((p) => [p.attendee_full_name, p.status])).toEqual([[fullName, 'cancelled']]);
  const [after] = await api<Array<{ reserved_count: number }>>('GET', `/api/events/${event.id}/ticket-tiers`, { token: organizer.api_key });
  expect(after.reserved_count).toBe(0);
});
