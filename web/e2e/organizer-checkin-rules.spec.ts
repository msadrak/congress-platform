import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Organizer check-in points: the point rules (tier filter, daily window, entry/exit, required point, session door),
 * the device health strip and device list (scans not sent, offline, update needed, remove access), archive and
 * delete, and what each role and an archived congress are offered (org spec WP-E).
 *
 * Shipping organizer pages + synthetic, intercepted /api/ responses (backend/tests/test_gate_rules.py covers the
 * server).
 */

type Role = 'owner' | 'manager' | 'staff' | 'viewer';
interface Options {
  role?: Role;
  locale?: 'fa' | 'en';
  archived?: boolean;
  /** The device-credential request answers this status. */
  tokenStatus?: number;
}

const EVENT = {
  id: 'event-r', name: 'Rules Congress', slug: 'rules', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall',
  description: '', timezone: 'Asia/Tehran', archived_at: null as string | null,
};
const TIERS = [
  { id: 'tier-g', name: 'General', description: '', quota: 100, reserved_count: 0, is_open: true },
  { id: 'tier-v', name: 'VIP', description: '', quota: 10, reserved_count: 0, is_open: true },
];
const SESSIONS = [{ id: 'session-1', event_id: 'event-r', title: 'Opening keynote', track: '', speakers: '', description: '', hall_id: null, hall_name: '', starts_at: '2099-05-10T07:30:00Z', ends_at: '2099-05-10T08:30:00Z', created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' }];
const pointOf = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, event_id: 'event-r', name, location: '', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null,
  created_at: '2099-01-01T00:00:00Z', reset_window: 'EVENT', tracks_occupancy: false, requires_point_id: null, session_id: null, archived_at: null, ...extra,
});

type Recorded = { method: string; path: string; body: unknown };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const role = options.role ?? 'owner';
  const event = { ...EVENT, archived_at: options.archived ? '2099-01-02T00:00:00Z' : null };
  const points = [pointOf('point-entrance', 'Entrance'), pointOf('point-used', 'Old Gate')];
  const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const devices = [
    {
      id: 'device-1', checkin_point_id: 'point-entrance', event_id: 'event-r', device_name: 'Door tablet', is_revoked: false, revoked_at: null,
      created_at: '2099-01-01T00:00:00Z', last_seen_at: elevenMinutesAgo, unsynced_count: 4, app_version: 'web-scanner/2', last_heartbeat_at: elevenMinutesAgo, stale: true,
    },
    {
      id: 'device-2', checkin_point_id: 'point-entrance', event_id: 'event-r', device_name: 'Door phone', is_revoked: false, revoked_at: null,
      created_at: '2099-01-01T00:00:00Z', last_seen_at: new Date().toISOString(), unsynced_count: 0, app_version: null, last_heartbeat_at: null, stale: false,
    },
  ];
  await page.addInitScript((locale) => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-rules-organizer');
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
    if (path === '/api/checkin-points/point-entrance/devices') return json(200, devices);
    if (path === '/api/checkin-points/point-entrance/devices/device-1/revoke') {
      devices[0] = { ...devices[0], is_revoked: true, revoked_at: '2099-05-10T08:00:00Z', stale: false };
      return json(200, devices[0]);
    }
    if (path === '/api/checkin-points/point-entrance/token') {
      if (options.tokenStatus) return json(options.tokenStatus, { detail: 'Internal Server Error' });
      return json(201, { scanner_token: 'secret-token', device_id: 'device-3', point_id: 'point-entrance', event_id: 'event-r', expires_at: '2099-05-17T08:00:00Z' });
    }
    const base = '/api/events/event-r';
    if (path === base) return json(200, event);
    if (path === `${base}/ticket-tiers`) return json(200, TIERS);
    if (path === `${base}/sessions`) return json(200, SESSIONS);
    if (path === `${base}/checkin-points` && method === 'GET') return json(200, points);
    if (path === `${base}/checkin-points` && method === 'POST') {
      const created = pointOf(`point-${points.length + 1}`, body.name, body);
      points.push(created);
      return json(201, created);
    }
    const one = path.match(/^\/api\/events\/event-r\/checkin-points\/([^/]+)(\/archive|\/unarchive)?$/);
    if (one) {
      const index = points.findIndex((p) => p.id === one[1]);
      if (one[2] === '/archive') points[index] = { ...points[index], archived_at: '2099-05-11T00:00:00Z' };
      else if (one[2] === '/unarchive') points[index] = { ...points[index], archived_at: null };
      else if (method === 'DELETE') {
        if (one[1] === 'point-used') {
          return json(409, { detail: 'This check-in point has recorded scans; archive it instead', code: 'CHECKIN_POINT_HAS_SCANS' });
        }
        points.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      return json(200, points[index]);
    }
    return json(200, []);
  });
  return requests;
}

const card = (page: Page, name: string) => page.getByRole('article').filter({ has: page.getByRole('heading', { name }) });
const openMenu = async (page: Page, name: string) => card(page, name).getByRole('button', { name: `More actions for ${name}` }).click();

test('a new point combines a tier filter, a daily window, entry/exit, a required point and a session door', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  await page.getByRole('button', { name: 'New check-in point' }).click();
  const dialog = page.getByRole('dialog', { name: 'New check-in point' });
  // The advanced settings start collapsed.
  const advanced = dialog.getByRole('button', { name: 'Advanced settings' });
  await expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByTestId('point-advanced')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox', { name: 'VIP' })).toHaveCount(0);

  await dialog.getByLabel('Name').fill('Hall A Door');
  await dialog.getByLabel('Entry rule').selectOption('CAPACITY_CAPPED');
  await dialog.getByLabel(/^Capacity/).fill('120');
  await advanced.click();
  await dialog.getByRole('checkbox', { name: 'VIP' }).check();
  await dialog.getByRole('checkbox', { name: /Track entry and exit/ }).check();
  await dialog.getByLabel('Reset window').selectOption('DAY');
  await dialog.getByLabel('Required point').selectOption('point-entrance');
  await dialog.getByLabel('Session door').selectOption('session-1');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByText('Check-in point “Hall A Door” added.')).toBeVisible();
  const created = requests.find((r) => r.method === 'POST' && r.path === '/api/events/event-r/checkin-points');
  expect(created?.body).toMatchObject({
    name: 'Hall A Door', policy_type: 'CAPACITY_CAPPED', allowed_tier_ids: ['tier-v'], max_capacity: 120,
    tracks_occupancy: true, reset_window: 'DAY', requires_point_id: 'point-entrance', session_id: 'session-1',
  });
  const point = card(page, 'Hall A Door');
  await expect(point.getByText('Resets daily')).toBeVisible();
  await expect(point.getByText('Max 120 inside')).toBeVisible();
  await expect(point.getByText('Opening keynote')).toBeVisible();
  await openMenu(page, 'Hall A Door');
  await expect(page.getByRole('menuitem', { name: 'Export session attendance' })).toBeVisible();
});

test('editing a point starts with the advanced settings collapsed and says the rule locks', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  await openMenu(page, 'Entrance');
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit check-in point' });
  await expect(dialog.getByRole('button', { name: 'Advanced settings' })).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByText('The entry rule locks after the first scan.')).toBeVisible();
});

test('the health strip counts offline devices and unsent scans without opening a point', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  const health = page.getByTestId('device-health');
  await expect(health).toContainText('2 active');
  await expect(health.getByTestId('device-health-stale')).toHaveText('1 offline');
  await expect(health).toContainText('4 scans not sent yet');
  await expect(card(page, 'Entrance').getByTestId('point-devices')).toContainText('2 devices');
  await expect(card(page, 'Entrance').getByTestId('point-devices')).toContainText('1 offline');
  await health.getByTestId('device-health-stale').click();
  await expect(card(page, 'Entrance')).toBeFocused();
});

test('the device list shows unsent scans, offline and update needed, and removing access is confirmed', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  await card(page, 'Entrance').getByRole('button', { name: 'Devices' }).click();
  const dialog = page.getByRole('dialog', { name: 'Devices at “Entrance”' });
  const tablet = dialog.getByTestId('device-row').filter({ hasText: 'Door tablet' });
  await expect(tablet.getByTestId('device-report')).toContainText('4 scans not sent yet');
  await expect(tablet.getByTestId('device-stale')).toHaveText('Offline');
  // The fixture device reports an older build than this console: an update is asked for, with no build hash.
  await expect(tablet.getByTestId('device-version-mismatch')).toHaveText('Update needed');
  await expect(dialog).not.toContainText('web-scanner');

  // Removing access is a menu item (never a solid red button) and asks first.
  await expect(dialog.locator('button.bg-status-danger-solid')).toHaveCount(0);
  await tablet.getByRole('button', { name: 'More actions for Door tablet' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove access for “Door tablet”?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some((r) => r.path.endsWith('/revoke'))).toBe(false);
  await tablet.getByRole('button', { name: 'More actions for Door tablet' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: 'Remove access for “Door tablet”?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(tablet.getByText('Access removed')).toBeVisible();
  expect(requests.some((r) => r.method === 'POST' && r.path === '/api/checkin-points/point-entrance/devices/device-1/revoke')).toBe(true);
});

test('pairing shows the link once, with the install hint under it', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  await card(page, 'Entrance').getByRole('button', { name: 'Devices' }).click();
  const dialog = page.getByRole('dialog', { name: 'Devices at “Entrance”' });
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByText('Give the device a name.')).toBeVisible();
  await dialog.getByLabel('Device name').fill('Hall phone');
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByTestId('pairing-link')).toHaveText(/\/scan\/point-entrance\?token=secret-token$/);
  await expect(dialog.getByTestId('pairing-install-hint')).toHaveText('After opening the link on the device, add it to the home screen.');
});

test('a pairing failure in Persian is a Persian sentence, never the English detail', async ({ page }) => {
  await fixture(page, { locale: 'fa', tokenStatus: 500 });
  await page.goto('/organizer/events/event-r/check-in');
  await card(page, 'Entrance').getByRole('button', { name: 'دستگاه‌ها' }).click();
  const dialog = page.getByRole('dialog', { name: 'دستگاه‌های «Entrance»' });
  await dialog.getByLabel('نام دستگاه').fill('گوشی سالن');
  await dialog.getByRole('button', { name: 'ساخت پیوند اتصال' }).click();
  await expect(dialog.getByText('در سرور خطایی رخ داد. کمی بعد دوباره تلاش کنید.')).toBeVisible();
  await expect(dialog).not.toContainText('Internal Server Error');
});

test('a point with scans is archived, not deleted; an unused point is deleted after confirmation', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-r/check-in');
  await openMenu(page, 'Old Gate');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete “Old Gate”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('This check-in point has recorded scans and cannot be deleted; archive it instead.')).toBeVisible();

  await openMenu(page, 'Old Gate');
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('Check-in point “Old Gate” archived; its scanners stopped.')).toBeVisible();
  await expect(card(page, 'Old Gate')).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived points (1)' }).click();
  const archived = card(page, 'Old Gate');
  await expect(archived.getByText('Archived', { exact: true })).toBeVisible();
  await expect(archived.getByRole('button', { name: 'Devices' })).toHaveCount(0);
  expect(requests.some((r) => r.method === 'POST' && r.path.endsWith('/point-used/archive'))).toBe(true);

  await openMenu(page, 'Entrance');
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog', { name: 'Delete “Entrance”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Check-in point “Entrance” deleted.')).toBeVisible();
});

test('a viewer reads the points without any action', async ({ page }) => {
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-r/check-in');
  await expect(card(page, 'Entrance')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New check-in point' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Devices' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open scanner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await expect(page.getByTestId('device-health')).toHaveCount(0);
});

test('staff get Devices and Open scanner only', async ({ page }) => {
  await fixture(page, { role: 'staff' });
  await page.goto('/organizer/events/event-r/check-in');
  const entrance = card(page, 'Entrance');
  await expect(entrance.getByRole('button', { name: 'Devices' })).toBeVisible();
  await expect(entrance.getByRole('link', { name: 'Open scanner' })).toHaveAttribute('href', '/scan/point-entrance');
  await expect(page.getByRole('button', { name: 'New check-in point' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await expect(page.getByTestId('device-health')).toContainText('1 offline');
});

test('an archived congress is read-only', async ({ page }) => {
  const requests = await fixture(page, { archived: true });
  await page.goto('/organizer/events/event-r/check-in');
  await expect(page.getByTestId('section-archived')).toBeVisible();
  await expect(card(page, 'Entrance')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New check-in point' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Devices' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open scanner' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  expect(requests.some((r) => r.path.endsWith('/devices'))).toBe(false);
});

test('the Persian page shows no internal ids and uses the decided terms', async ({ page }) => {
  await fixture(page, { locale: 'fa' });
  await page.goto('/organizer/events/event-r/check-in');
  await expect(page.getByRole('heading', { name: 'نقطه‌های ورود', level: 1 })).toBeVisible();
  await expect(card(page, 'Entrance')).toBeVisible();
  const main = page.locator('main');
  await expect(main).not.toContainText('شناسه');
  await expect(main).not.toContainText(/G-0\d/);
  await expect(main).not.toContainText(/گیت|رده|بلیت|توکن/);
  await expect(page.getByTestId('device-health')).toContainText('۱ قطع');
});
