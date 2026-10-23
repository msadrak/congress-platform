import { expect, test } from '@playwright/test';
import { ADMIN_TOKEN, api, createOrganizer, organizerSignIn, reserveTicket, uid, uniqueMobile, type LiveEvent, type Tier } from './support/live';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** `YYYY-MM-DD` of `date` in `timeZone`. */
const dayIn = (date: Date, timeZone: string): string => new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

test('organizer: platform admin provisions the organizer, who sets up and publishes a congress and sees a registration', async ({ page, browser }) => {
  const id = uid();
  const orgName = `سازمان برگزارکننده ${id}`;
  const eventName = `کنگره زنده ${id}`;
  const slug = `live-org-${id}`;
  const tierName = `کارت حضور ${id}`;
  // Istanbul is UTC+3 all year: the stored instants prove the form reads times in the event's own timezone.
  const zone = 'Europe/Istanbul';
  const DAY = 86_400_000;
  const eventDay = dayIn(new Date(Date.now() + 40 * DAY), zone);
  const opensDay = dayIn(new Date(Date.now() - DAY), zone);
  const closesDay = dayIn(new Date(Date.now() + 39 * DAY), zone);

  await test.step('platform admin creates the organizer and receives its key once', async () => {
    await page.goto('/platform/organizers');
    await page.getByLabel('توکن مدیر سامانه').fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: 'ورود به پنل' }).click();
    await page.getByLabel('نام برگزارکننده جدید').fill(orgName);
    await page.getByRole('button', { name: 'ساخت و صدور کلید' }).click();
    await expect(page.getByTestId('issued-key')).toContainText(orgName);
  });
  const apiKey = (await page.getByTestId('issued-key').locator('p[dir=ltr]').innerText()).trim();
  expect(apiKey.length).toBeGreaterThan(20);

  await test.step('key gate: a wrong key is refused, the issued key opens the console', async () => {
    await page.goto('/organizer');
    await page.getByRole('button', { name: 'کلید API' }).click();
    await page.getByLabel('کلید دسترسی (API Key)').fill(`wrong-${apiKey}`);
    await page.getByRole('button', { name: 'ورود به پیشخوان مدیریت' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('کلید دسترسی (API Key)').fill(apiKey);
    await page.getByRole('button', { name: 'ورود به پیشخوان مدیریت' }).click();
    await expect(page.getByRole('heading', { name: 'مدیریت همایش‌ها و کنگره‌ها' })).toBeVisible();
  });

  await test.step('create the event with its timezone and registration window', async () => {
    await page.getByRole('button', { name: 'ایجاد همایش جدید' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'ثبت همایش جدید' });
    await dialog.getByLabel('عنوان رسمی همایش').fill(eventName);
    await dialog.getByLabel(/شناسه اینترنتی/).fill(slug);
    await dialog.getByLabel('منطقهٔ زمانی همایش').selectOption(zone);
    await dialog.getByLabel('زمان آغاز همایش').fill(`${eventDay}T09:00`);
    await dialog.getByLabel('زمان پایان همایش').fill(`${eventDay}T17:00`);
    await dialog.getByLabel(/محل برگزاری/).fill('مرکز همایش‌های آزمون');
    await dialog.getByLabel('شروع ثبت‌نام (اختیاری)').fill(`${opensDay}T08:00`);
    await dialog.getByLabel('پایان ثبت‌نام (اختیاری)').fill(`${closesDay}T20:00`);
    await dialog.getByRole('button', { name: 'ثبت و ایجاد همایش' }).click();
    await expect(page.getByRole('status').filter({ hasText: eventName })).toBeVisible();
  });
  const event = (await api<Array<LiveEvent & { starts_at: string; registration_opens_at: string; registration_closes_at: string }>>('GET', '/api/events', { token: apiKey }))[0];
  expect(event).toMatchObject({ slug, timezone: zone });
  expect(new Date(event.starts_at).toISOString()).toBe(new Date(`${eventDay}T06:00:00Z`).toISOString());
  expect(new Date(event.registration_opens_at).toISOString()).toBe(new Date(`${opensDay}T05:00:00Z`).toISOString());
  expect(new Date(event.registration_closes_at).toISOString()).toBe(new Date(`${closesDay}T17:00:00Z`).toISOString());

  const workspace = page.getByRole('navigation', { name: 'فضای کاری همایش' });
  await page.getByRole('link', { name: eventName }).first().click();

  await test.step('add a pass type (ticket tier)', async () => {
    // Structure-based: the pass-type wording is being renamed («نوع کارت ورود»), the form's shape is not.
    await expect(workspace).toBeVisible();
    await page.goto(`/organizer/events/${event.id}/tiers`);
    await page.getByRole('main').getByRole('button', { name: /افزودن/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(tierName);
    await dialog.getByRole('spinbutton').fill('25');
    await dialog.locator('button[type=submit]').click();
    await expect(page.getByRole('status').filter({ hasText: tierName })).toBeVisible();
  });
  const tiers = await api<Tier[]>('GET', `/api/events/${event.id}/ticket-tiers`, { token: apiKey });
  expect(tiers.map((t) => [t.name, t.quota])).toEqual([[tierName, 25]]);

  await test.step('publish the Page Studio page: the public page goes live', async () => {
    const anonymous = await browser.newContext();
    const visitor = await anonymous.newPage();
    expect((await visitor.goto(`/api/public/events/${slug}`))?.status()).toBe(404);
    await workspace.getByRole('link', { name: 'صفحهٔ عمومی' }).click();
    await page.getByRole('button', { name: 'انتشار', exact: true }).first().click();
    await page.getByRole('dialog', { name: 'این صفحه منتشر شود؟' }).getByRole('button', { name: 'انتشار', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'منتشر شد' })).toBeVisible();
    await visitor.goto(`/e/${slug}`);
    await expect(visitor.getByRole('heading', { name: eventName }).first()).toBeVisible();
    await expect(visitor.getByText(tierName).first()).toBeVisible();
    await anonymous.close();
  });

  await test.step('program: a session and a PDF schedule file', async () => {
    await workspace.getByRole('link', { name: 'برنامهٔ همایش' }).click();
    await page.getByRole('button', { name: 'افزودن جلسه' }).click();
    const dialog = page.getByRole('dialog', { name: 'افزودن جلسه' });
    await dialog.getByLabel('عنوان').fill('سخنرانی افتتاحیه');
    await dialog.getByLabel('زمان شروع').fill(`${eventDay}T09:30`);
    await dialog.getByLabel('زمان پایان').fill(`${eventDay}T10:30`);
    await dialog.getByLabel('سخنرانان').fill('دکتر سارا احمدی');
    await dialog.getByRole('button', { name: 'افزودن جلسه' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('سخنرانی افتتاحیه').first()).toBeVisible();

    const files = page.getByRole('region', { name: 'فایل‌های برنامه' });
    await files.locator('input[type=file]').setInputFiles({ name: 'program.pdf', mimeType: 'application/pdf', buffer: PDF });
    await files.getByLabel('عنوان فایل').fill('برنامهٔ کامل');
    await files.getByRole('button', { name: 'بارگذاری', exact: true }).click();
    await expect(files.getByTestId('schedule-file')).toHaveCount(1);
    await expect(files.getByTestId('schedule-file')).toContainText('برنامهٔ کامل');
  });
  const sessions = await api<Array<{ title: string }>>('GET', `/api/events/${event.id}/sessions`, { token: apiKey });
  expect(sessions.map((s) => s.title)).toEqual(['سخنرانی افتتاحیه']);
  const files = await api<Array<{ label: string; kind: string }>>('GET', `/api/events/${event.id}/program-files`, { token: apiKey });
  expect(files.map((f) => [f.label, f.kind])).toEqual([['برنامهٔ کامل', 'pdf']]);

  await test.step('participants: a registration from the public page is listed', async () => {
    const [tier] = tiers;
    const attendee = `شرکت‌کننده ${id}`;
    await reserveTicket(event.id, tier.id, uniqueMobile(), attendee);
    await workspace.getByRole('link', { name: 'شرکت‌کنندگان' }).click();
    await expect(page.getByText(attendee).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'جستجو' }).fill('هیچ‌کس-نیست');
    await expect(page.getByText(attendee)).toHaveCount(0);
  });
});

// Known gap, owned by ws/b6a-organizer-ui ("program times in event timezone", docs/handover/UPGRADE_HANDOVER.md §5):
// the session form reads its times on the browser's clock, so an organizer in Tehran planning an Istanbul congress
// stores 09:30 Istanbul as 09:30 Tehran (06:00Z instead of 06:30Z). Marked as failing; when the fix lands this test
// reports "expected to fail but passed": remove the `test.fail` line then.
test('organizer: program session times are entered on the event clock, not the browser clock', async ({ page }) => {
  test.fail(true, 'session form uses the browser timezone (fixed on ws/b6a-organizer-ui)');
  const organizer = await createOrganizer();
  const id = uid();
  const DAY = 86_400_000;
  const eventDay = dayIn(new Date(Date.now() + 40 * DAY), 'Europe/Istanbul');
  const event = await api<LiveEvent>('POST', '/api/events', {
    token: organizer.api_key,
    body: { name: `کنگره استانبول ${id}`, slug: `live-ist-${id}`, starts_at: `${eventDay}T06:00:00Z`, ends_at: `${eventDay}T14:00:00Z`, location: 'Istanbul', timezone: 'Europe/Istanbul' },
  });
  await organizerSignIn(page, organizer.api_key);
  await page.goto(`/organizer/events/${event.id}/program`);
  await page.getByRole('button', { name: 'افزودن جلسه' }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن جلسه' });
  await dialog.getByLabel('عنوان').fill('جلسهٔ صبح');
  await dialog.getByLabel('زمان شروع').fill(`${eventDay}T09:30`);
  await dialog.getByLabel('زمان پایان').fill(`${eventDay}T10:30`);
  await dialog.getByRole('button', { name: 'افزودن جلسه' }).click();
  await expect(dialog).toBeHidden();
  const [session] = await api<Array<{ starts_at: string }>>('GET', `/api/events/${event.id}/sessions`, { token: organizer.api_key });
  expect(new Date(session.starts_at).toISOString()).toBe(new Date(`${eventDay}T06:30:00Z`).toISOString());
});
