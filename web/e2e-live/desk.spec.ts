import { expect, test } from '@playwright/test';
import { api, createEvent, createOrganizer, createTier, organizerSignIn, outbox, reserveTicket, signInWithCode, uid, uniqueMobile, waitForSms } from './support/live';

type ParticipantPage = { items: Array<{ attendee_full_name: string; ticket_id: string }> };

test.use({ viewport: { width: 1280, height: 900 } });

test('desk: operator added by the organizer signs in by SMS code, searches, issues a walk-in once despite a lost response, resends a pass', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key);
  const tier = await createTier(organizer.api_key, event.id, `کارت پذیرش ${uid()}`, 20);
  const operatorMobile = uniqueMobile();
  const operatorName = `اپراتور ${uid()}`;
  const attendeeMobile = uniqueMobile();
  const attendeeName = `علی محمدی ${uid()}`;
  await reserveTicket(event.id, tier.id, attendeeMobile, attendeeName);

  await test.step('organizer authorizes the operator by mobile number', async () => {
    await organizerSignIn(page, organizer.api_key);
    await page.goto(`/organizer/events/${event.id}/operators`);
    await page.getByRole('button', { name: 'افزودن اپراتور جدید' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'ثبت اپراتور میز پذیرش' });
    await dialog.getByLabel('نام کامل اپراتور').fill(operatorName);
    await dialog.getByLabel('شماره موبایل').fill(operatorMobile);
    await dialog.getByRole('button', { name: 'صدور دسترسی اپراتور' }).click();
    await expect(page.getByRole('status').filter({ hasText: operatorName })).toBeVisible();
  });

  const deskContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desk = await deskContext.newPage();

  await test.step('desk sign-in by SMS code', async () => {
    await desk.goto(`/reception/${event.id}`);
    await expect(desk.getByRole('heading', { name: 'ورود به میز پذیرش' })).toBeVisible();
    await signInWithCode(desk, operatorMobile);
    await expect(desk.getByRole('heading', { level: 1, name: event.name })).toBeVisible();
    await expect(desk.getByText(operatorName)).toBeVisible();
  });

  await test.step('search finds the registered attendee', async () => {
    await desk.getByRole('searchbox', { name: 'جستجوی شرکت‌کنندگان' }).fill(attendeeName.split(' ').at(-1)!);
    const results = desk.getByRole('region', { name: 'نتایج جستجو' });
    await expect(results.getByRole('button', { name: `بررسی ${attendeeName}` })).toBeVisible();
    await expect(results.getByRole('listitem')).toHaveCount(1);
  });

  await test.step('resend the pass link to the attendee', async () => {
    const before = (await outbox(attendeeMobile)).length;
    await desk.getByRole('button', { name: `بررسی ${attendeeName}` }).click();
    await desk.getByRole('button', { name: `گزینه‌های بیشتر برای ${attendeeName}` }).click();
    await desk.getByRole('menuitem', { name: 'ارسال دوبارهٔ پیوند کارت ورود' }).click();
    await expect(desk.getByTestId('toast')).toContainText('حالت آزمایشی: پیامک فقط ثبت شد');
    await desk.keyboard.press('Escape');
    await expect.poll(async () => (await outbox(attendeeMobile)).length).toBe(before + 1);
    const [latest] = await outbox(attendeeMobile);
    expect(latest.text).toMatch(/\/t\/\S+/);
  });

  await test.step('walk-in whose response is lost: the retry returns the same pass, never a second one', async () => {
    const walkIn = `مهمان حضوری ${uid()}`;
    const walkInMobile = uniqueMobile();
    const keys: string[] = [];
    await desk.route('**/desk-registrations', async (route) => {
      keys.push(route.request().headers()['idempotency-key'] ?? '');
      if (keys.length === 1) {
        await route.fetch();
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });
    // Desk registration («ثبت‌نام حضوری») is a dialog opened next to the search.
    await desk.getByRole('button', { name: 'ثبت‌نام حضوری' }).click();
    const form = desk.getByRole('dialog', { name: 'ثبت‌نام حضوری' });
    await form.getByLabel('نام و نام خانوادگی').fill(walkIn);
    await form.getByLabel(/موبایل/).fill(walkInMobile);
    await form.getByRole('button', { name: 'صدور کارت ورود' }).click();
    await expect(form.getByText('اتصال قطع شد. دوباره «صدور» را بزنید', { exact: false })).toBeVisible();
    await expect(desk.getByRole('dialog', { name: 'صادر شد' })).toHaveCount(0);
    await form.getByRole('button', { name: 'صدور کارت ورود' }).click();
    await expect(desk.getByRole('dialog', { name: 'صادر شد' }).getByText(walkIn).first()).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);

    const participants = await api<ParticipantPage>('GET', `/api/events/${event.id}/participants`, { token: organizer.api_key });
    expect(participants.items.filter((p) => p.attendee_full_name === walkIn)).toHaveLength(1);
    // The walk-in's pass link is texted once, for the one ticket.
    const confirmation = await waitForSms(walkInMobile, 'ticket_confirmation');
    expect(confirmation.text).toContain(walkIn);
    expect((await outbox(walkInMobile)).filter((m) => m.kind === 'ticket_confirmation')).toHaveLength(1);
  });

  const [tierAfter] = await api<Array<{ reserved_count: number }>>('GET', `/api/events/${event.id}/ticket-tiers`, { token: organizer.api_key });
  expect(tierAfter.reserved_count).toBe(2);
  await deskContext.close();
});
