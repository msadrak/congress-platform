import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Organizer workspace settings, tiers, booths, program times and roles against synthetic, intercepted /api/
// responses (not FastAPI/PostgreSQL). Backend behaviour is covered by backend/tests.
const KEY = 'synthetic-b6a-organizer';
type Role = 'owner' | 'manager' | 'staff' | 'viewer';

interface Options {
  role?: Role;
  reserved?: number;
  deleteStatus?: number;
  tierDeleteStatus?: number;
  pagePublished?: boolean;
  /** The first GET of the event answers 500. */
  eventFailsOnce?: boolean;
  /** The congress is running now (live tiles) instead of in 2099 (setup checklist). */
  inProgress?: boolean;
  archived?: boolean;
}

type Recorded = { method: string; path: string; body: unknown };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const role = options.role ?? 'owner';
  let eventFails = options.eventFailsOnce ?? false;
  let event: Record<string, unknown> = {
    id: 'event-s', name: 'Settings Congress', slug: 'settings-congress', starts_at: '2099-05-10T05:30:00Z', ends_at: '2099-05-12T14:30:00Z',
    location: 'Tehran Hall', description: 'About', timezone: 'Asia/Tehran', registration_enabled: true, registration_opens_at: null,
    registration_closes_at: null, listed: false, archived_at: options.archived ? '2099-01-02T00:00:00Z' : null,
    ...(options.inProgress ? { starts_at: new Date(Date.now() - 3_600_000).toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString() } : {}),
  };
  const archivedEvent = { ...event, id: 'event-old', name: 'Old Congress', slug: 'old-congress', archived_at: '2098-01-01T00:00:00Z' };
  const points = [{ id: 'point-1', event_id: 'event-s', name: 'Main door', location: '', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null, created_at: '2099-01-01T00:00:00Z' }];
  const device = (id: string, stale: boolean, unsynced: number) => ({ id, checkin_point_id: 'point-1', event_id: 'event-s', device_name: id, is_revoked: false, revoked_at: null, created_at: '2099-01-01T00:00:00Z', last_seen_at: null, unsynced_count: unsynced, app_version: null, last_heartbeat_at: null, stale });
  const tiers = [{ id: 'tier-1', name: 'Delegate', description: '', quota: 100, reserved_count: options.reserved ?? 0, is_open: true, sales_starts_at: null, sales_ends_at: null }];
  const booths = [{ id: 'booth-1', event_id: 'event-s', name: 'Acme Biotech', slug: 'acme', location: 'Hall B', description: '', website_url: '', brochure_url: '', qr_secret: 'secret-1', created_at: '2099-01-01T00:00:00Z' }];
  let staff = [
    { id: 'staff-1', booth_id: 'booth-1', user_id: 'u-1', mobile: '09121112233', full_name: 'Sara Karimi' },
    { id: 'staff-2', booth_id: 'booth-1', user_id: 'u-2', mobile: '09124445566', full_name: 'Ali Rad' },
  ];
  const sessions = [{ id: 'session-1', event_id: 'event-s', title: 'Opening keynote', track: '', speakers: '', description: '', hall_id: null, hall_name: '', starts_at: '2099-05-10T07:30:00Z', ends_at: '2099-05-10T08:30:00Z', created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' }];
  await page.addInitScript((key) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', 'en');
  }, KEY);
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
    if (path === '/api/events') return json(200, [event, archivedEvent]);
    if (path === '/api/checkin-points/point-1/devices') return json(200, [device('phone-1', false, 0), device('phone-2', true, 0), device('phone-3', false, 4)]);
    if (path === '/api/events/event-s/checkin-points') return json(200, points);
    if (path === '/api/events/event-s/analytics/attendance') return json(200, { event_id: 'event-s', timezone: 'Asia/Tehran', days: [], total_tickets: 120, tickets_by_status: [], tier_registrations: [], unique_admitted: 70, checkin_rate: 0.58, total_scans: 90, total_admitted: 80, total_rejected: 10, hourly_scans: [], catering_metrics: [], gate_breakdown: [{ point_id: 'point-1', point_name: 'Main door', location: '', policy_type: 'MULTI_ENTRY', total_admitted: 80, total_rejected: 10, admissions: 80, current_occupancy: 55, hourly_scans: [] }] });
    if (path === '/api/events/event-s/sms/messages') return json(200, [{ id: 'sms-1', kind: 'ticket_confirmation', mobile: '0912***0001', body: null, status: 'failed', attempts: 3, last_error: 'gateway', created_at: '2099-01-01T00:00:00Z', sent_at: null, can_retry: true, can_resolve: false }]);
    if (path === '/api/events/event-s/page') return json(200, { event_id: 'event-s', draft: {}, draft_revision: 1, draft_updated_at: '2099-01-01T00:00:00Z', is_published: false, published_revision: null, published_at: null, has_unpublished_changes: true });
    const base = '/api/events/event-s';
    if (path === base && method === 'GET') {
      if (eventFails) {
        eventFails = false;
        return json(500, { detail: 'Internal Server Error' });
      }
      return json(200, event);
    }
    if (path === base && method === 'PATCH') {
      event = { ...event, ...body };
      return json(200, event);
    }
    if (path === base && method === 'DELETE') {
      if (options.deleteStatus) return json(options.deleteStatus, { detail: 'This event has 3 ticket(s) and cannot be deleted; archive it instead.', code: 'EVENT_HAS_TICKETS' });
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/archive`) {
      event = { ...event, archived_at: body.archived ? '2099-01-02T00:00:00Z' : null };
      return json(200, event);
    }
    if (path === `${base}/ticket-tiers` && method === 'GET') return json(200, tiers);
    if (path === `${base}/ticket-tiers` && method === 'POST') return json(201, { ...tiers[0], ...body, id: 'tier-new', reserved_count: 0 });
    const tier = path.match(/\/ticket-tiers\/([^/]+)$/);
    if (tier && method === 'PATCH') {
      Object.assign(tiers[0], body);
      return json(200, tiers[0]);
    }
    if (tier && method === 'DELETE') {
      if (options.tierDeleteStatus) return json(options.tierDeleteStatus, { detail: 'Ticket tier has reservations', code: 'TIER_HAS_RESERVATIONS' });
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/booths`) return json(200, booths);
    if (path === `${base}/booths/booth-1/staff` && method === 'GET') return json(200, staff);
    const staffMember = path.match(/\/booths\/booth-1\/staff\/([^/]+)$/);
    if (staffMember && method === 'DELETE') {
      staff = staff.filter((s) => s.id !== staffMember[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === `${base}/booths/booth-1/standee`) {
      return json(200, { url: 'https://congress.example/e/settings-congress/booths/booth-1?b=secret-1', booth_id: 'booth-1', qr_secret: 'secret-1', page_published: options.pagePublished ?? false });
    }
    if (path === `${base}/sessions` && method === 'GET') return json(200, sessions);
    if (path === `${base}/sessions` && method === 'POST') return json(201, { ...sessions[0], ...body, id: 'session-2' });
    if (path === `${base}/desk/operators` && role !== 'owner' && role !== 'manager') return json(403, { detail: 'Your role does not allow this', code: 'ROLE_FORBIDDEN' });
    return json(200, []);
  });
  return requests;
}

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Congress sections' });

type Group = ReturnType<Page['getByRole']>;
const pad = (v: string) => v.padStart(2, '0');
/** A DateTimeField (day, month, year, time) read as a `datetime-local` value, in English. */
async function dateTimeValue(group: Group): Promise<string> {
  const [day, month, year, time] = await Promise.all([group.getByLabel('Day').inputValue(), group.getByLabel('Month').inputValue(), group.getByLabel('Year').inputValue(), group.getByLabel('Time').inputValue()]);
  return `${year}-${pad(month)}-${pad(day)}T${time}`;
}
/** Fills a DateTimeField with a `datetime-local` value. */
async function fillDateTime(group: Group, value: string) {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-');
  await group.getByLabel('Day').selectOption(String(Number(day)));
  await group.getByLabel('Month').selectOption(String(Number(month)));
  await group.getByLabel('Year').fill(year);
  await group.getByLabel('Time').fill(time);
}
/** Opens the settings card's ⋯ menu and picks an item. */
async function settingsMenu(page: Page, item: string) {
  await page.getByTestId('event-settings').getByRole('button', { name: 'More congress actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('event settings edit the time zone, registration window and home listing on the congress clock', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s');
  const settings = page.getByTestId('event-settings');
  await expect(settings).toContainText('Tehran time');
  await expect(settings).not.toContainText('Asia/Tehran');
  await expect(settings).toContainText('Not listed');
  await settings.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit congress' });
  // 05:30Z is 09:00 in Tehran, whatever the browser's zone; the date is entered in the reader's calendar.
  expect(await dateTimeValue(dialog.getByRole('group', { name: 'Starts' }))).toBe('2099-05-10T09:00');
  await expect(dialog.locator('input[type="datetime-local"]')).toHaveCount(0);
  await fillDateTime(dialog.getByRole('group', { name: /Registration closes/ }), '2099-05-09T18:00');
  await dialog.getByRole('switch', { name: 'Show on the home page list' }).click();
  await dialog.getByLabel('Time zone').selectOption('Europe/Istanbul');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Congress settings saved' })).toBeVisible();
  const patch = requests.find((r) => r.method === 'PATCH' && r.path === '/api/events/event-s');
  // The typed wall times are read in the newly chosen zone (Istanbul, UTC+3).
  expect(patch?.body).toMatchObject({ timezone: 'Europe/Istanbul', listed: true, registration_enabled: true, starts_at: '2099-05-10T06:00:00.000Z', registration_closes_at: '2099-05-09T15:00:00.000Z' });
  await expect(settings).toContainText('Listed');
});

test('closing the settings dialog with unsaved edits asks before discarding them', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s');
  await page.getByTestId('event-settings').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit congress' });
  await dialog.getByRole('textbox').first().fill('Renamed');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByRole('textbox').first()).toHaveValue('Renamed');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests.some((r) => r.method === 'PATCH')).toBe(false);
});

test('archiving asks first, explains the read-only effect, and can be undone', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s');
  await page.getByTestId('event-settings').getByRole('button', { name: 'Archive' }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive this congress?' });
  await expect(confirm).toContainText('read-only');
  await confirm.getByRole('button', { name: 'Archive' }).click();
  // One archived banner (the section gate's), with Unarchive for a manager; no edit control is left.
  await expect(page.getByTestId('section-archived')).toHaveCount(1);
  await expect(page.getByTestId('section-archived')).toContainText('Archived');
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  await expect(page.getByTestId('organizer-topbar').or(page.locator('aside.org-rail')).getByText('Archived').first()).toBeAttached();
  expect(requests.find((r) => r.path === '/api/events/event-s/archive')?.body).toEqual({ archived: true });

  await page.getByTestId('section-archived').getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByTestId('section-archived')).toHaveCount(0);
  expect(requests.filter((r) => r.path === '/api/events/event-s/archive').at(-1)?.body).toEqual({ archived: false });
});

test('a delete refused for tickets is explained and offers to archive instead', async ({ page }) => {
  const requests = await fixture(page, { deleteStatus: 409 });
  await page.goto('/organizer/events/event-s');
  await settingsMenu(page, 'Delete congress');
  await page.getByRole('dialog', { name: 'Delete this congress?' }).getByRole('button', { name: 'Delete' }).click();
  const refused = page.getByRole('dialog', { name: "This congress can't be deleted" });
  await expect(refused).toContainText('This congress has issued passes and cannot be deleted; archive it instead.');
  await refused.getByRole('button', { name: 'Archive instead' }).click();
  await expect(page.getByTestId('section-archived')).toBeVisible();
  expect(requests.some((r) => r.method === 'DELETE' && r.path === '/api/events/event-s')).toBe(true);
  expect(requests.find((r) => r.path === '/api/events/event-s/archive')?.body).toEqual({ archived: true });
});

test('deleting a congress without tickets returns to the events list with a notice', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-s');
  await settingsMenu(page, 'Delete congress');
  await page.getByRole('dialog', { name: 'Delete this congress?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/organizer$/);
  await expect(page.getByRole('status').filter({ hasText: 'Congress “Settings Congress” deleted.' })).toBeVisible();
});

test('a congress that issued tickets is never offered for deletion', async ({ page }) => {
  await fixture(page, { reserved: 3 });
  await page.goto('/organizer/events/event-s');
  await expect(page.getByTestId('event-settings').getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More congress actions' })).toHaveCount(0);
});

test('a tier is deleted after a confirmation; a refusal for reservations says to close it instead', async ({ page }) => {
  const requests = await fixture(page, { tierDeleteStatus: 409 });
  await page.goto('/organizer/events/event-s/tiers');
  const deleteDelegate = async () => {
    await page.getByRole('button', { name: 'More actions for Delegate' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
  };
  await deleteDelegate();
  const confirm = page.getByRole('dialog', { name: 'Delete “Delegate”?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false);

  await deleteDelegate();
  await page.getByRole('dialog', { name: 'Delete “Delegate”?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'close its registration instead' })).toBeVisible();
  expect(requests.some((r) => r.method === 'DELETE' && r.path.includes('/ticket-tiers/'))).toBe(true);
});

test('a tier sales window is entered on the congress clock', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/tiers');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit pass type' });
  const enter = async (label: string, day: string, month: string, time: string) => {
    const field = edit.getByRole('group', { name: label });
    await field.getByLabel('Day').selectOption(day);
    await field.getByLabel('Month').selectOption({ label: month });
    await field.getByLabel('Year').fill('2099');
    await field.getByLabel('Time').fill(time);
  };
  await enter('Reservations open', '1', 'April', '09:00');
  await enter('Reservations close', '1', 'April', '08:00');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit.getByText('Reservations must close after they open.')).toBeVisible();
  await enter('Reservations close', '9', 'May', '21:00');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  // Tehran is UTC+03:30.
  expect(requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({ sales_starts_at: '2099-04-01T05:30:00.000Z', sales_ends_at: '2099-05-09T17:30:00.000Z' });
  await expect(page.getByTestId('tier-sales-window')).toBeVisible();
});

test('booth representatives are listed and removed after a confirmation; assigning sends an invite', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Representatives' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await expect(dialog).toContainText("We'll text them the booth panel link.");
  await dialog.getByRole('button', { name: 'More actions for Sara Karimi' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: 'Remove access for “Sara Karimi”?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('status')).toContainText('Sara Karimi no longer has access');
  expect(requests.some((r) => r.method === 'DELETE' && r.path === '/api/events/event-s/booths/booth-1/staff/staff-1')).toBe(true);
});

test('the standee QR encodes the standee URL, warns while unpublished and prints', async ({ page }) => {
  await fixture(page, { pagePublished: false });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Booth QR code' }).click();
  const standee = page.getByTestId('booth-standee');
  await expect(standee).toHaveAttribute('data-qr-value', 'https://congress.example/e/settings-congress/booths/booth-1?b=secret-1');
  await expect(page.getByTestId('standee-url')).toHaveText('https://congress.example/e/settings-congress/booths/booth-1?b=secret-1');
  await expect(page.getByTestId('standee-unpublished')).toContainText('not published');

  await page.emulateMedia({ media: 'print' });
  await expect(standee).toBeVisible();
  const box = await standee.boundingBox();
  expect(box && box.width > 100 && box.height > 200).toBe(true);
  const qrVisible = await standee.locator('svg').evaluate((el) => getComputedStyle(el).visibility === 'visible');
  expect(qrVisible).toBe(true);
  const restHidden = await page.getByTestId('standee-unpublished').evaluate((el) => getComputedStyle(el).visibility === 'hidden');
  expect(restHidden).toBe(true);
});

test('a published page shows no standee warning', async ({ page }) => {
  await fixture(page, { pagePublished: true });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Booth QR code' }).click();
  await expect(page.getByTestId('booth-standee')).toBeVisible();
  await expect(page.getByTestId('standee-unpublished')).toHaveCount(0);
});

test.describe('with the browser in another time zone', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('program sessions are shown and entered on the event clock', async ({ page }) => {
    const requests = await fixture(page);
    await page.goto('/organizer/events/event-s/program');
    // 07:30Z is 11:00 in Tehran (and 03:30 in New York).
    await expect(page.getByTestId('program-session')).toContainText('11:00 – 12:00');
    await page.getByTestId('program-session').filter({ hasText: 'Opening keynote' }).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit session' });
    const starts = edit.getByRole('group', { name: 'Starts' });
    await expect(starts.getByLabel('Time')).toHaveValue('11:00');
    await expect(starts.getByLabel('Year')).toHaveValue('2099');
    await expect(starts).toContainText('Tehran time');
    await edit.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add session' }).click();
    const dialog = page.getByRole('dialog', { name: 'New session' });
    await dialog.getByLabel('Title').fill('Imaging workshop');
    await dialog.getByRole('group', { name: 'Starts' }).getByLabel('Time').fill('14:00');
    await expect(dialog.getByRole('group', { name: 'Ends' }).getByLabel('Time')).toHaveValue('15:00');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests.find((r) => r.method === 'POST' && r.path === '/api/events/event-s/sessions')?.body).toMatchObject({
      starts_at: '2099-05-10T10:30:00.000Z',
      ends_at: '2099-05-10T11:30:00.000Z',
    });
  });
});

test('a viewer sees the setup without any edit control', async ({ page }) => {
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-s');
  await expect(page.getByTestId('event-settings')).toBeVisible();
  await expect(page.getByTestId('console-identity')).toContainText('Viewer');
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More congress actions' })).toHaveCount(0);
  // The viewer's navigation: only what the role may open, with no gaps or numbers.
  await expect(workspaceNav(page).getByRole('link')).toHaveText(['Overview', 'Check-in points', 'Statistics', 'Program', 'Pass types', 'Booths', 'Public page', 'SMS']);

  await workspaceNav(page).getByRole('link', { name: /Pass types/ }).click();
  await expect(page.getByText('Delegate').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit$|More actions|New pass type/ })).toHaveCount(0);

  await workspaceNav(page).getByRole('link', { name: /Booths/ }).click();
  await expect(page.getByText('Acme Biotech')).toBeVisible();
  await expect(page.getByRole('button', { name: /Representatives|New booth/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Booth QR code' })).toBeVisible();

  await workspaceNav(page).getByRole('link', { name: /Program/ }).click();
  await expect(page.getByTestId('program-session')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Add session|Import from Excel|^Edit$|More actions/ })).toHaveCount(0);
});

test('staff see booth representatives but cannot change them', async ({ page }) => {
  await fixture(page, { role: 'staff' });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Representatives' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Add and text' })).toHaveCount(0);
});

test('a viewer is told the participant list is not for their role, with no search or export', async ({ page }) => {
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-s/participants');
  await expect(page.getByText('Your role can\'t see personal details.')).toBeVisible();
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /CSV/ })).toHaveCount(0);
});

test('a congress that failed to load offers a retry', async ({ page }) => {
  await fixture(page, { eventFailsOnce: true });
  await page.goto('/organizer/events/event-s');
  await expect(page.getByText('This congress could not be loaded. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('event-settings')).toBeVisible();
});

test('the congress list: one link per card plus the public page icon, archived ones in a collapsed group', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer');
  const active = page.getByTestId('events-active').getByRole('article');
  await expect(active).toHaveCount(1);
  await expect(active.getByRole('link')).toHaveCount(2);
  await expect(active.getByRole('link', { name: 'Settings Congress', exact: true })).toHaveAttribute('href', '/organizer/events/event-s');
  await expect(active.getByRole('link', { name: 'Public page of Settings Congress' })).toHaveAttribute('href', '/e/settings-congress');
  const archived = page.getByTestId('events-archived');
  await expect(archived).not.toHaveAttribute('open');
  await expect(page.getByRole('link', { name: 'Old Congress' })).toBeHidden();
  await archived.getByText('Archived (1)').click();
  await expect(page.getByRole('link', { name: 'Old Congress' })).toBeVisible();
  // An archived congress has no public page to open.
  await expect(archived.getByRole('article').getByRole('link')).toHaveCount(1);
});

test('the create dialog marks the first invalid field and moves focus to it', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'New congress' }).click();
  const dialog = page.getByRole('dialog', { name: 'New congress' });
  await dialog.getByRole('textbox', { name: 'Congress name' }).fill('Created');
  await expect(dialog.getByRole('textbox', { name: 'Page address' })).toHaveValue('created');
  await dialog.getByRole('button', { name: 'Add' }).click();
  const day = dialog.getByRole('group', { name: 'Starts' }).getByLabel('Day');
  await expect(day).toHaveAttribute('aria-invalid', 'true');
  await expect(day).toBeFocused();
  await expect(dialog.getByRole('group', { name: 'Starts' })).toContainText('Enter the start time.');
  expect(requests.some((r) => r.method === 'POST' && r.path === '/api/events')).toBe(false);
});

test('before the congress the overview is a setup checklist; one edit control', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-s');
  const checklist = page.getByTestId('setup-checklist');
  await expect(checklist).toBeVisible();
  await expect(checklist.getByRole('listitem')).toHaveText([/Program.*Done/, /Pass types.*Done/, /Check-in points.*Done/, /Publish the public page.*Publish/, /Desk operators.*Add/]);
  await expect(page.getByTestId('live-tile')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Publish public page' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(1);
});

test('during the congress the overview shows four live tiles and the failed SMS', async ({ page }) => {
  await fixture(page, { inProgress: true });
  await page.goto('/organizer/events/event-s');
  const tiles = page.getByTestId('live-tile');
  await expect(tiles).toHaveCount(4);
  await expect(tiles).toHaveText([/Admitted\s*70/, /Registered\s*120/, /Inside now\s*55/, /Scanners offline or unsent\s*2/]);
  await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
  await expect(page.getByTestId('failed-sms')).toHaveText('1 SMS not delivered');
  await expect(page.getByRole('link', { name: 'Open reception desk' })).toHaveAttribute('href', '/organizer/events/event-s/desk');
});

for (const role of ['manager', 'viewer'] as const) {
  test(`an archived congress shows one banner${role === 'manager' ? ' with Unarchive for a manager' : ', without Unarchive for a viewer'}`, async ({ page }) => {
    await fixture(page, { role, archived: true });
    await page.goto('/organizer/events/event-s');
    const banner = page.getByTestId('section-archived');
    await expect(banner).toHaveCount(1);
    await expect(banner.getByRole('button', { name: 'Unarchive' })).toHaveCount(role === 'manager' ? 1 : 0);
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
  });
}
