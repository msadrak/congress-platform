import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { api, createEvent, createOrganizer, createTier, organizerSignIn, reserveTicket, signInWithCode, uid, uniqueMobile } from './support/live';

/** RFC 4180 rows (quoted cells, doubled quotes), without the UTF-8 BOM. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('exhibitor: booth and staff set up by the organizer, staff signs in, captures and qualifies leads, CSV shows mobiles only with consent', async ({ page, browser }) => {
  const organizer = await createOrganizer();
  const event = await createEvent(organizer.api_key);
  const tier = await createTier(organizer.api_key, event.id);
  const boothName = `شرکت داروسازی ${uid()}`;
  const boothSlug = `pharma-${uid()}`;
  const staffMobile = uniqueMobile();
  const staffName = `نماینده غرفه ${uid()}`;
  const withheld = { name: `رضا کریمی ${uid()}`, mobile: uniqueMobile() };
  const sharing = { name: `سارا نوری ${uid()}`, mobile: uniqueMobile() };
  const privateTicket = await reserveTicket(event.id, tier.id, withheld.mobile, withheld.name);
  const sharingTicket = await reserveTicket(event.id, tier.id, sharing.mobile, sharing.name);
  // Exhibitors see a mobile only with the attendee's consent (default off).
  await api('PATCH', '/api/auth/me', { token: sharingTicket.token, body: { share_contact_with_exhibitors: true } });

  await test.step('organizer creates the booth and assigns its staff by mobile', async () => {
    await organizerSignIn(page, organizer.api_key);
    await page.goto(`/organizer/events/${event.id}/booths`);
    await page.getByRole('button', { name: 'افزودن غرفه جدید' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'ثبت غرفه نمایشگاهی جدید' });
    await dialog.getByLabel('نام شرکت یا غرفه').fill(boothName);
    await dialog.getByLabel('شناسه اینترنتی غرفه (Slug)').fill(boothSlug);
    await dialog.getByRole('button', { name: 'ثبت غرفه نمایشگاهی' }).click();
    await expect(page.getByRole('status').filter({ hasText: boothName })).toBeVisible();
    await page.getByRole('button', { name: 'تخصیص نماینده غرفه' }).click();
    const staff = page.getByRole('dialog', { name: 'تخصیص کارشناس به غرفه' });
    await staff.getByLabel('نام نماینده').fill(staffName);
    await staff.getByLabel('شماره موبایل کارشناس').fill(staffMobile);
    await staff.getByRole('button', { name: 'تخصیص دسترسی نماینده' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'نماینده تخصیص یافت' })).toBeVisible();
  });
  const [booth] = await api<Array<{ id: string }>>('GET', `/api/events/${event.id}/booths`, { token: organizer.api_key });

  const staffContext = await browser.newContext({ acceptDownloads: true });
  const portal = await staffContext.newPage();

  await test.step('staff signs in to the booth portal by SMS code', async () => {
    await portal.goto(`/booth/${booth.id}`);
    await portal.getByRole('link', { name: 'ورود به حساب غرفه' }).click();
    await signInWithCode(portal, staffMobile);
    await expect(portal.getByRole('heading', { level: 1, name: boothName })).toBeVisible();
  });

  const capture = async (code: string, holder: string) => {
    await portal.getByRole('button', { name: 'ثبت لید' }).first().click();
    const dialog = portal.getByRole('dialog', { name: 'ثبت لید' });
    await dialog.getByLabel('کد نشان بازدیدکننده').fill(code);
    await dialog.getByRole('button', { name: 'ذخیرهٔ لید' }).click();
    await expect(dialog.getByRole('status')).toHaveText('لید ذخیره شد.');
    await expect(dialog).toContainText(holder);
    return dialog;
  };

  await test.step('capture a lead and qualify it', async () => {
    const dialog = await capture(privateTicket.qr_secret, withheld.name);
    await dialog.getByRole('button', { name: 'تعیین وضعیت و پیگیری' }).click();
    const qualify = portal.getByRole('dialog', { name: `تعیین وضعیت و پیگیری لید: ${withheld.name}` });
    await qualify.getByRole('button', { name: /علاقه زیاد/ }).click();
    await qualify.getByRole('button', { name: 'ارسال پیش‌فاکتور' }).click();
    await qualify.getByLabel('یادداشت‌های محرمانه غرفه').fill('سه دستگاه می‌خواهد؛ جمعه پیگیری شود.');
    await qualify.getByRole('button', { name: 'ذخیره تغییرات لید' }).click();
    await expect(qualify).toBeHidden();
  });

  await test.step('capture a second lead from an attendee who shares contact details', async () => {
    const dialog = await capture(sharingTicket.qr_secret, sharing.name);
    await dialog.getByRole('button', { name: 'پایان' }).click();
    await expect(portal.getByRole('button', { name: /علاقه زیاد ۱/ })).toBeVisible();
  });

  await test.step('CSV export: qualification saved, mobile only with consent', async () => {
    const [download] = await Promise.all([portal.waitForEvent('download'), portal.getByRole('button', { name: 'دریافت فایل اکسل (CSV)' }).click()]);
    const [header, ...rows] = parseCsv(await readFile((await download.path())!, 'utf8')).filter((r) => r.some(Boolean));
    const col = (name: string) => header.indexOf(name);
    const byName = Object.fromEntries(rows.map((r) => [r[col('Attendee Name')], r]));
    expect(Object.keys(byName).sort()).toEqual([withheld.name, sharing.name].sort());
    expect(byName[withheld.name][col('Attendee Mobile')]).toBe('');
    expect(byName[sharing.name][col('Attendee Mobile')]).toBe(sharing.mobile);
    expect(byName[withheld.name][col('Interest Rating')]).toBe('HOT');
    expect(byName[withheld.name][col('Follow-Up Tags')]).toContain('ارسال پیش‌فاکتور');
    expect(byName[withheld.name][col('Notes')]).toBe('سه دستگاه می‌خواهد؛ جمعه پیگیری شود.');
  });
  await staffContext.close();
});
