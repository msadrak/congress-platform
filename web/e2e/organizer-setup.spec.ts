import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Organizer congress-day setup besides check-in: pass types, booths (representatives, standee QR) and the reception
 * desk (operators), per role and on an archived congress (org spec WP-E operators + WP-F). Synthetic, intercepted
 * /api/ responses; backend/tests cover the server.
 */

type Role = 'owner' | 'manager' | 'staff' | 'viewer';
interface Options {
  role?: Role;
  locale?: 'fa' | 'en';
  archived?: boolean;
  /** The standee address answers this status instead of the address. */
  standeeStatus?: number;
}
type Recorded = { method: string; path: string; body: unknown };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const role = options.role ?? 'owner';
  const event = {
    id: 'event-s', name: 'Setup Congress', slug: 'setup-congress', starts_at: '2099-05-10T05:30:00Z', ends_at: '2099-05-12T14:30:00Z',
    location: 'Tehran Hall', description: '', timezone: 'Asia/Tehran', archived_at: options.archived ? '2099-01-02T00:00:00Z' : null,
  };
  const tiers = [
    { id: 'tier-1', name: 'Delegate', description: '', quota: 800, reserved_count: 412, is_open: true, sales_starts_at: null, sales_ends_at: null },
    { id: 'tier-2', name: 'Student', description: '', quota: 50, reserved_count: 0, is_open: true, sales_starts_at: null, sales_ends_at: null },
  ];
  const booths = [{ id: 'booth-1', event_id: 'event-s', name: 'Acme Biotech', slug: 'acme', location: 'Hall B', description: '', website_url: '', brochure_url: '', qr_secret: 'secret-1', created_at: '2099-01-01T00:00:00Z' }];
  let staff = [
    { id: 'staff-1', booth_id: 'booth-1', user_id: 'u-1', mobile: '09121112233', full_name: 'Sara Karimi' },
    { id: 'staff-2', booth_id: 'booth-1', user_id: 'u-2', mobile: '09124445566', full_name: 'Ali Rad' },
  ];
  const operators = [{ id: 'op-1', event_id: 'event-s', user_id: 'u1', operator_name: 'Operator One', mobile: '09121110001', is_revoked: false, created_at: '2099-01-01T00:00:00Z' }];
  await page.addInitScript((locale) => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-setup-organizer');
    localStorage.setItem('congress_attendee_locale', locale);
  }, options.locale ?? 'en');
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path === '/api/organizer/me') {
      const member = role === 'owner' ? null : { id: 'm-1', display_name: 'Vera Member', mobile: '09120000000', role, created_at: '2099-01-01T00:00:00Z', revoked_at: null, last_sign_in_at: null };
      return json(200, { kind: role === 'owner' ? 'key' : 'member', role, organizer: { id: 'org-1', name: 'Org' }, member });
    }
    if (path === '/api/events') return json(200, [event]);
    const base = '/api/events/event-s';
    if (path === base) return json(200, event);
    if (path === `${base}/ticket-tiers` && method === 'GET') return json(200, tiers);
    const tier = path.match(/\/ticket-tiers\/([^/]+)$/);
    if (tier && method === 'PATCH') {
      const index = tiers.findIndex((t) => t.id === tier[1]);
      tiers[index] = { ...tiers[index], ...body };
      return json(200, tiers[index]);
    }
    if (tier && method === 'DELETE') {
      tiers.splice(tiers.findIndex((t) => t.id === tier[1]), 1);
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/booths`) return json(200, booths);
    if (path === `${base}/booths/booth-1/staff` && method === 'GET') return json(200, staff);
    const member = path.match(/\/booths\/booth-1\/staff\/([^/]+)$/);
    if (member && method === 'DELETE') {
      staff = staff.filter((s) => s.id !== member[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/booths/booth-1/standee`) {
      if (options.standeeStatus) return json(options.standeeStatus, { detail: 'Not Found' });
      return json(200, { url: 'https://congress.example/e/setup-congress/booths/booth-1?b=secret-1', booth_id: 'booth-1', qr_secret: 'secret-1', page_published: false });
    }
    if (path === `${base}/desk/operators`) {
      if (role !== 'owner' && role !== 'manager') return json(403, { detail: 'Your role does not allow this', code: 'ROLE_FORBIDDEN' });
      return json(200, operators);
    }
    if (path === `${base}/desk/operators/op-1/revoke`) {
      operators[0] = { ...operators[0], is_revoked: true };
      return json(200, operators[0]);
    }
    return json(200, []);
  });
  return requests;
}

const row = (page: Page, name: string) => page.getByTestId('tier-row').filter({ hasText: name });

test('a pass type with reservations is closed, never deleted; one without is deleted after a confirmation', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/tiers');
  await expect(page.getByRole('heading', { name: 'Pass types', level: 1 })).toBeVisible();
  // No KPI strip above the table.
  await expect(page.locator('main dl')).toHaveCount(0);
  await expect(row(page, 'Delegate')).toContainText('412 of 800');

  await row(page, 'Delegate').getByRole('button', { name: 'More actions for Delegate' }).click();
  await expect(page.getByRole('menuitem', { name: 'Close registration' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Close registration' }).click();
  await page.getByRole('dialog', { name: 'Close registration for “Delegate”?' }).getByRole('button', { name: 'Close registration' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Registration for “Delegate” is closed.' })).toBeVisible();
  expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({ is_open: false });

  await row(page, 'Student').getByRole('button', { name: 'More actions for Student' }).click();
  await expect(page.getByRole('menuitem', { name: 'Close registration' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete “Student”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'Student')).toHaveCount(0);
  expect(requests.some((r) => r.method === 'DELETE' && r.path.endsWith('/ticket-tiers/tier-2'))).toBe(true);
});

test('the Persian pass-type form enters the reservation window in Jalali on the congress clock', async ({ page }) => {
  const requests = await fixture(page, { locale: 'fa' });
  await page.goto('/organizer/events/event-s/tiers');
  await row(page, 'Delegate').getByRole('button', { name: 'ویرایش' }).click();
  const dialog = page.getByRole('dialog', { name: 'ویرایش نوع کارت ورود' });
  await expect(dialog.locator('input[type="datetime-local"]')).toHaveCount(0);
  const start = dialog.getByRole('group', { name: 'آغاز رزرو' });
  await start.getByLabel('روز').selectOption('1');
  await start.getByLabel('ماه').selectOption({ label: 'فروردین' });
  await start.getByLabel('سال').fill('1478');
  await start.getByLabel('ساعت').fill('09:00');
  await start.getByLabel('ساعت').blur();
  await dialog.getByRole('button', { name: 'ذخیره' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ذخیره شد' })).toBeVisible();
  // 1 Farvardin 1478 is 20 March 2099; 09:00 in Tehran is 05:30 UTC.
  expect(requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({ sales_starts_at: '2099-03-20T05:30:00.000Z', sales_ends_at: null });
  await expect(page.locator('main')).not.toContainText('شناسه');
});

test('booth representatives are removed only after a confirmation', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Representatives' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'More actions for Sara Karimi' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: 'Remove access for “Sara Karimi”?' }).getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  await dialog.getByRole('button', { name: 'More actions for Sara Karimi' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: 'Remove access for “Sara Karimi”?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('status')).toContainText('Sara Karimi no longer has access to this booth.');
  expect(requests.some((r) => r.method === 'DELETE' && r.path === '/api/events/event-s/booths/booth-1/staff/staff-1')).toBe(true);
});

test('a standee failure in Persian is a Persian sentence', async ({ page }) => {
  await fixture(page, { locale: 'fa', standeeStatus: 404 });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'کد QR غرفه' }).click();
  const dialog = page.getByRole('dialog', { name: 'کد QR غرفه' });
  await expect(dialog.getByRole('alert')).toHaveText('مورد درخواستی پیدا نشد.');
  await expect(dialog).not.toContainText('Not Found');
});

test('the standee QR encodes the standee address and warns while the page is unpublished', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Booth QR code' }).click();
  await expect(page.getByTestId('booth-standee')).toHaveAttribute('data-qr-value', 'https://congress.example/e/setup-congress/booths/booth-1?b=secret-1');
  await expect(page.getByTestId('standee-unpublished')).toContainText('not published');
});

test('a viewer reads pass types and booths without any change control', async ({ page }) => {
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-s/tiers');
  await expect(row(page, 'Delegate')).toBeVisible();
  await expect(page.getByRole('button', { name: /New pass type|Edit|More actions/ })).toHaveCount(0);

  await page.goto('/organizer/events/event-s/booths');
  await expect(page.getByText('Acme Biotech')).toBeVisible();
  await expect(page.getByRole('button', { name: /New booth|Representatives/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Booth QR code' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Acme Biotech' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['View booth page']);
});

test('staff see booth representatives but cannot change them, and open the desk without the operator list', async ({ page }) => {
  await fixture(page, { role: 'staff' });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Representatives' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add and text' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).last().click();

  await page.goto('/organizer/events/event-s/operators');
  await expect(page.getByRole('link', { name: 'Open reception desk' })).toHaveAttribute('href', '/organizer/events/event-s/desk');
  await expect(page.getByTestId('reception-link')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Desk operators' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a manager removes an operator\'s access after a confirmation', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/operators');
  await expect(page.getByRole('heading', { name: 'Reception desk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Operator One' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: 'Remove access for “Operator One”?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByText('Access removed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore access' })).toBeVisible();
  expect(requests.some((r) => r.method === 'POST' && r.path.endsWith('/op-1/revoke'))).toBe(true);
});

test('an archived congress is read-only on pass types, booths and the desk', async ({ page }) => {
  await fixture(page, { archived: true });
  for (const section of ['tiers', 'booths', 'operators']) {
    await page.goto(`/organizer/events/event-s/${section}`);
    await expect(page.getByTestId('section-archived')).toBeVisible();
    await expect(page.getByRole('button', { name: /^New |^Edit$|Restore access/ })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: 'Open reception desk' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /More actions for Operator One/ })).toHaveCount(0);
  await page.goto('/organizer/events/event-s/tiers');
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'More actions for Acme Biotech' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['View booth page']);
});
