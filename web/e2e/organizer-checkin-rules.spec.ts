import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Organizer check-in settings: the new point rules (tier filter, daily window, entry/exit, required point, session
 * door), the device dashboard (unsynced scans, version, stale warning) and archive/delete.
 *
 * Shipping organizer pages + synthetic, intercepted /api/ responses (backend/tests/test_gate_rules.py covers the
 * server).
 */

const EVENT = { id: 'event-r', name: 'Rules Congress', slug: 'rules', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '' };
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

async function fixture(page: Page) {
  const requests: Recorded[] = [];
  const points = [pointOf('point-entrance', 'Entrance'), pointOf('point-used', 'Old Gate')];
  const tenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const devices = [{
    id: 'device-1', checkin_point_id: 'point-entrance', event_id: 'event-r', device_name: 'Door tablet', is_revoked: false, revoked_at: null,
    created_at: '2099-01-01T00:00:00Z', last_seen_at: tenMinutesAgo, unsynced_count: 4, app_version: 'web-scanner/2', last_heartbeat_at: tenMinutesAgo, stale: true,
  }];
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path === '/api/events') return json(200, [EVENT]);
    if (path === '/api/checkin-points/point-entrance/devices') return json(200, devices);
    const base = '/api/events/event-r';
    if (path === base) return json(200, EVENT);
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

async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-rules-organizer');
    localStorage.setItem('congress_attendee_locale', 'en');
  });
}

test('a new point combines a tier filter, a daily window, entry/exit, a required point and a session door', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-r/check-in');
  await page.getByRole('button', { name: /New Check-In Point|Create|Add/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Hall A Door');
  await dialog.getByRole('combobox').first().selectOption('CAPACITY_CAPPED');
  await dialog.getByRole('checkbox', { name: 'VIP' }).check();
  await dialog.getByRole('spinbutton').fill('120');
  await dialog.getByRole('checkbox', { name: /Track entry and exit/ }).check();
  await dialog.getByLabel('Reset window').selectOption('DAY');
  await dialog.getByLabel('Required point').selectOption('point-entrance');
  await dialog.getByLabel('Session door').selectOption('session-1');
  await dialog.getByRole('button', { name: /Save|Create/ }).last().click();

  await expect(page.getByText('Check-in point “Hall A Door” created.')).toBeVisible();
  const created = requests.find((r) => r.method === 'POST' && r.path === '/api/events/event-r/checkin-points');
  expect(created?.body).toMatchObject({
    name: 'Hall A Door', policy_type: 'CAPACITY_CAPPED', allowed_tier_ids: ['tier-v'], max_capacity: 120,
    tracks_occupancy: true, reset_window: 'DAY', requires_point_id: 'point-entrance', session_id: 'session-1',
  });
  const card = page.getByRole('article').filter({ hasText: 'Hall A Door' });
  await expect(card.getByText('Each day')).toBeVisible();
  await expect(card.getByText('Max inside')).toBeVisible();
  await expect(card.getByText('Opening keynote')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Attendance CSV' })).toBeVisible();
});

test('the device list shows unsynced scans, the app version and a stale warning', async ({ page }) => {
  await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-r/check-in');
  await page.getByRole('article').filter({ hasText: 'Entrance' }).getByRole('button', { name: 'Pair device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pair a scanner device' });
  await expect(dialog.getByTestId('device-report')).toHaveText(/4 unsynced scan\(s\) · web-scanner\/2/);
  await expect(dialog.getByText(/Not in touch for over 10 minutes/)).toBeVisible();
});

test('a point with scans is archived, not deleted; an unused point is deleted after confirmation', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-r/check-in');
  const used = page.getByRole('article').filter({ hasText: 'Old Gate' });
  await used.getByRole('button', { name: 'Delete Old Gate' }).click();
  await page.getByRole('dialog', { name: 'Delete this check-in point?' }).getByRole('button', { name: 'Delete point' }).click();
  await expect(page.getByText('This check-in point has recorded scans and cannot be deleted; archive it instead.')).toBeVisible();

  await used.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText(/archived: its scanners stop/)).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Old Gate' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived points (1)' }).click();
  const archived = page.getByRole('article').filter({ hasText: 'Old Gate' });
  await expect(archived.getByText('Archived', { exact: true })).toBeVisible();
  await expect(archived.getByRole('button', { name: 'Pair device' })).toHaveCount(0);
  expect(requests.some((r) => r.method === 'POST' && r.path.endsWith('/point-used/archive'))).toBe(true);

  await page.getByRole('article').filter({ hasText: 'Entrance' }).getByRole('button', { name: 'Delete Entrance' }).click();
  await page.getByRole('dialog', { name: 'Delete this check-in point?' }).getByRole('button', { name: 'Delete point' }).click();
  await expect(page.getByText('Check-in point “Entrance” deleted.')).toBeVisible();
});
