import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The organizer program (UX plan UX-ORG-2, org spec WP-D) against synthetic, intercepted /api/ responses: three tabs,
// Jalali day headings on the congress clock, the CSV import in a dialog, and no setup control for a viewer or on an
// archived congress. Not FastAPI/PostgreSQL: the backend is covered by backend/tests.
const KEY = 'synthetic-org2-program';
type Role = 'owner' | 'viewer';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function fixture(page: Page, { role = 'owner', archived = false, locale = 'en' }: { role?: Role; archived?: boolean; locale?: string } = {}) {
  const event = {
    id: 'event-p', name: 'Program Congress', slug: 'program-congress', starts_at: '2026-11-10T05:00:00Z', ends_at: '2026-11-11T14:00:00Z',
    location: 'Tehran', description: '', timezone: 'Asia/Tehran', registration_enabled: true, registration_opens_at: null,
    registration_closes_at: null, listed: false, archived_at: archived ? '2026-10-01T00:00:00Z' : null,
  };
  // 06:00Z is 09:30 in Tehran on Tuesday 10 November 2026 (19 Aban 1405).
  const sessions = [{ id: 's-1', event_id: 'event-p', title: 'Opening keynote', track: 'Keynote', speakers: '', description: '', hall_id: 'h-1', hall_name: 'Main hall', starts_at: '2026-11-10T06:00:00Z', ends_at: '2026-11-10T07:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }];
  const places = [
    { id: 'h-1', event_id: 'event-p', kind: 'hall', name: 'Main hall', location: '', position: 0, created_at: '2026-01-01T00:00:00Z' },
    { id: 'h-2', event_id: 'event-p', kind: 'hall', name: 'Hall 2', location: '', position: 1, created_at: '2026-01-01T00:00:01Z' },
  ];
  const files = [{ id: 'f-1', event_id: 'event-p', label: 'Full program', kind: 'image', content_type: 'image/webp', position: 0, is_visible: true, byte_size: 2000, width: 10, height: 10, page_count: null, created_at: '2026-01-01T00:00:00Z', content_url: '/api/events/event-p/program-files/f-1/content' }];
  await page.addInitScript(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (request.headers().authorization !== `Bearer ${KEY}`) return json(401, { detail: 'Invalid API key' });
    if (path === '/api/organizer/me') {
      const member = role === 'owner' ? null : { id: 'm-1', display_name: 'Vera Viewer', mobile: '09120000000', role, created_at: '2026-01-01T00:00:00Z', revoked_at: null, last_sign_in_at: null };
      return json(200, { kind: role === 'owner' ? 'key' : 'member', role, organizer: { id: 'org-1', name: 'Org' }, member });
    }
    if (path === '/api/events') return json(200, [event]);
    if (path === '/api/events/event-p') return json(200, event);
    if (path === '/api/events/event-p/sessions') return json(200, sessions);
    if (path === '/api/events/event-p/venue-places') return json(200, places);
    if (path === '/api/events/event-p/program-files' && request.method() === 'GET') return json(200, files);
    if (path === '/api/events/event-p/program-files/f-1/content') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    return json(200, []);
  });
}

const tabs = (page: Page) => page.getByRole('tablist', { name: /Program sections|بخش‌های برنامه/ }).getByRole('tab');
/** Every control that changes the setup, in any tab. */
const setupControls = (page: Page) =>
  page.getByRole('button', { name: /Add session|Import from Excel|Add hall|Add entrance|^Edit$|More actions|Move |^Hide$|^Show$/ });

test('the program has three tabs, a Jalali day heading and the CSV import in a dialog', async ({ page }) => {
  await fixture(page, { locale: 'fa' });
  await page.goto('/organizer/events/event-p/program');
  await expect(tabs(page)).toHaveText(['جلسه‌ها', 'سالن‌ها و ورودی‌ها', 'فایل‌های برنامه']);
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('program-day')).toHaveText('سه‌شنبه ۱۹ آبان ۱۴۰۵');
  await expect(page.getByTestId('program-session')).toContainText('۰۹:۳۰ – ۱۰:۳۰');

  await page.getByRole('button', { name: 'ورود از اکسل' }).click();
  const dialog = page.getByRole('dialog', { name: 'ورود از اکسل' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'دریافت نمونه' })).toBeVisible();
  await expect(dialog.getByText('نمونهٔ فایل را دریافت کنید، پر کنید و بارگذاری کنید.')).toBeVisible();
  await dialog.getByRole('button', { name: 'انصراف' }).click();
  await expect(dialog).toHaveCount(0);

  // The tab is in the address: «فایل‌ها» and the halls tab open directly.
  await tabs(page).nth(2).click();
  await expect(page).toHaveURL(/\?tab=files$/);
  await expect(page.getByTestId('schedule-file')).toHaveText([/Full program/]);
  await page.goto('/organizer/events/event-p/program?tab=venue');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('venue-hall')).toHaveText([/Main hall/, /Hall 2/]);
});

test('the session dialog enters a Jalali date and time on the congress clock', async ({ page }) => {
  await fixture(page, { locale: 'fa' });
  await page.goto('/organizer/events/event-p/program');
  await page.getByRole('button', { name: 'افزودن جلسه' }).click();
  const dialog = page.getByRole('dialog', { name: 'جلسهٔ جدید' });
  const starts = dialog.getByRole('group', { name: 'شروع' });
  await expect(starts.getByLabel('ماه')).toHaveValue('8');
  await expect(starts.getByLabel('سال')).toHaveValue('۱۴۰۵');
  await expect(starts).toContainText('سه‌شنبه ۱۹ آبان ۱۴۰۵');
  await expect(page.locator('input[type=datetime-local]')).toHaveCount(0);
});

for (const [name, options] of [
  ['a viewer', { role: 'viewer' as const }],
  ['an archived congress', { archived: true }],
] as const) {
  test(`${name} reads every program tab without add, edit, delete or reorder controls`, async ({ page }) => {
    await fixture(page, options);
    await page.goto('/organizer/events/event-p/program');
    await expect(page.getByTestId('program-session')).toHaveCount(1);
    await expect(setupControls(page)).toHaveCount(0);
    await tabs(page).nth(1).click();
    await expect(page.getByTestId('venue-hall')).toHaveCount(2);
    await expect(setupControls(page)).toHaveCount(0);
    await tabs(page).nth(2).click();
    await expect(page.getByTestId('schedule-file')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(page.getByLabel('Upload file')).toHaveCount(0);
    await expect(setupControls(page)).toHaveCount(0);
    if ('archived' in options) await expect(page.getByTestId('section-archived')).toBeVisible();
  });
}
