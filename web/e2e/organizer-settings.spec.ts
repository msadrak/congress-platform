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
}

type Recorded = { method: string; path: string; body: unknown };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const role = options.role ?? 'owner';
  let eventFails = options.eventFailsOnce ?? false;
  let event: Record<string, unknown> = {
    id: 'event-s', name: 'Settings Congress', slug: 'settings-congress', starts_at: '2099-05-10T05:30:00Z', ends_at: '2099-05-12T14:30:00Z',
    location: 'Tehran Hall', description: 'About', timezone: 'Asia/Tehran', registration_enabled: true, registration_opens_at: null,
    registration_closes_at: null, listed: false, archived_at: null,
  };
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
    if (path === '/api/events') return json(200, [event]);
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

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Event workspace' });

test('event settings edit the time zone, registration window and home listing on the congress clock', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s');
  const settings = page.getByTestId('event-settings');
  await expect(settings).toContainText('Asia/Tehran');
  await expect(settings).toContainText('Not listed');
  await settings.getByRole('button', { name: 'Edit settings' }).click();
  const dialog = page.getByRole('dialog', { name: /Edit/ });
  // 05:30Z is 09:00 in Tehran, whatever the browser's zone.
  await expect(dialog.getByLabel(/Start Date & Time/)).toHaveValue('2099-05-10T09:00');
  await dialog.getByLabel('Registration closes (optional)').fill('2099-05-09T18:00');
  await dialog.getByLabel(/List on the public home/).check();
  await dialog.getByLabel('Congress time zone').selectOption('Europe/Istanbul');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event settings saved' })).toBeVisible();
  const patch = requests.find((r) => r.method === 'PATCH' && r.path === '/api/events/event-s');
  // The typed wall times are read in the newly chosen zone (Istanbul, UTC+3).
  expect(patch?.body).toMatchObject({ timezone: 'Europe/Istanbul', listed: true, registration_enabled: true, starts_at: '2099-05-10T06:00:00.000Z', registration_closes_at: '2099-05-09T15:00:00.000Z' });
  await expect(settings).toContainText('Listed');
});

test('closing the settings dialog with unsaved edits asks before discarding them', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s');
  await page.getByTestId('event-settings').getByRole('button', { name: 'Edit settings' }).click();
  const dialog = page.getByRole('dialog', { name: /Edit/ });
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
  await page.getByRole('button', { name: 'Archive congress' }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive this congress?' });
  await expect(confirm).toContainText('read-only');
  await confirm.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('archived-banner')).toContainText('archived');
  await expect(page.getByRole('button', { name: /Edit Event/ })).toHaveCount(0);
  expect(requests.find((r) => r.path === '/api/events/event-s/archive')?.body).toEqual({ archived: true });

  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByTestId('archived-banner')).toHaveCount(0);
  expect(requests.filter((r) => r.path === '/api/events/event-s/archive').at(-1)?.body).toEqual({ archived: false });
});

test('a delete refused for tickets is explained and offers to archive instead', async ({ page }) => {
  const requests = await fixture(page, { deleteStatus: 409 });
  await page.goto('/organizer/events/event-s');
  await page.getByRole('button', { name: 'Delete congress' }).click();
  await page.getByRole('dialog', { name: 'Delete this congress permanently?' }).getByRole('button', { name: 'Delete congress' }).click();
  const refused = page.getByRole('dialog', { name: 'This congress cannot be deleted' });
  await expect(refused).toContainText('This congress has issued passes and cannot be deleted; archive it instead.');
  await refused.getByRole('button', { name: 'Archive instead' }).click();
  await expect(page.getByTestId('archived-banner')).toBeVisible();
  expect(requests.some((r) => r.method === 'DELETE' && r.path === '/api/events/event-s')).toBe(true);
  expect(requests.find((r) => r.path === '/api/events/event-s/archive')?.body).toEqual({ archived: true });
});

test('deleting a congress without tickets returns to the events list with a notice', async ({ page }) => {
  await fixture(page);
  await page.goto('/organizer/events/event-s');
  await page.getByRole('button', { name: 'Delete congress' }).click();
  await page.getByRole('dialog', { name: 'Delete this congress permanently?' }).getByRole('button', { name: 'Delete congress' }).click();
  await expect(page).toHaveURL(/\/organizer$/);
  await expect(page.getByRole('status').filter({ hasText: 'Congress “Settings Congress” deleted.' })).toBeVisible();
});

test('a congress that issued tickets is never offered for deletion', async ({ page }) => {
  await fixture(page, { reserved: 3 });
  await page.goto('/organizer/events/event-s');
  await expect(page.getByRole('button', { name: 'Archive congress' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete congress' })).toHaveCount(0);
});

test('a tier is deleted after a confirmation; one with reservations offers to close instead', async ({ page }) => {
  const requests = await fixture(page, { tierDeleteStatus: 409 });
  await page.goto('/organizer/events/event-s/tiers');
  await page.getByRole('button', { name: 'Delete tier Delegate' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this ticket tier?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some((r) => r.method === 'DELETE')).toBe(false);

  await page.getByRole('button', { name: 'Delete tier Delegate' }).click();
  await page.getByRole('dialog', { name: 'Delete this ticket tier?' }).getByRole('button', { name: 'Delete tier' }).click();
  const refused = page.getByRole('dialog', { name: 'This tier cannot be deleted' });
  await expect(refused).toContainText('close its registration instead');
  await refused.getByRole('button', { name: 'Close this tier instead' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Registration for “Delegate” is closed.' })).toBeVisible();
  expect(requests.find((r) => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'))?.body).toEqual({ is_open: false });
});

test('a tier sales window is entered on the congress clock', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/tiers');
  await page.getByRole('button', { name: /Edit Tier/ }).click();
  const edit = page.getByRole('dialog').filter({ has: page.getByLabel('Sales start') });
  await edit.getByLabel('Sales start').fill('2099-04-01T09:00');
  await edit.getByLabel('Sales end').fill('2099-04-01T08:00');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit.getByRole('alert')).toHaveText('Sales must end after they start.');
  await edit.getByLabel('Sales end').fill('2099-05-09T21:00');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  // Tehran is UTC+03:30.
  expect(requests.find((r) => r.method === 'PATCH')?.body).toMatchObject({ sales_starts_at: '2099-04-01T05:30:00.000Z', sales_ends_at: '2099-05-09T17:30:00.000Z' });
  await expect(page.getByTestId('tier-sales-window')).toBeVisible();
});

test('booth representatives are listed and removed after a confirmation; assigning sends an invite', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Assign Booth Staff' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await expect(dialog).toContainText('texts an invitation with the booth portal link');
  await dialog.getByRole('button', { name: 'Remove Sara Karimi' }).click();
  await page.getByRole('dialog', { name: 'Remove this representative?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByRole('status')).toContainText('Sara Karimi no longer has access');
  expect(requests.some((r) => r.method === 'DELETE' && r.path === '/api/events/event-s/booths/booth-1/staff/staff-1')).toBe(true);
});

test('the standee QR encodes the standee URL, warns while unpublished and prints', async ({ page }) => {
  await fixture(page, { pagePublished: false });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Standee QR' }).click();
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
  await page.getByRole('button', { name: 'Standee QR' }).click();
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
    await page.getByRole('button', { name: 'Edit Opening keynote' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit session' });
    await expect(edit.getByLabel('Starts')).toHaveValue('2099-05-10T11:00');
    await expect(edit.getByTestId('session-time-zone')).toContainText('Asia/Tehran');
    await edit.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Add session' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add session' });
    await dialog.getByLabel('Title').fill('Imaging workshop');
    await dialog.getByLabel('Starts').fill('2099-05-10T14:00');
    await expect(dialog.getByLabel('Ends')).toHaveValue('2099-05-10T15:00');
    await dialog.getByRole('button', { name: 'Add session' }).click();
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
  await expect(page.getByRole('button', { name: /Edit Event/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive congress' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete congress' })).toHaveCount(0);
  await expect(workspaceNav(page).getByRole('link', { name: /Desk Staff/ })).toHaveCount(0);
  await expect(workspaceNav(page).getByRole('link', { name: /Participants/ })).toHaveCount(0);

  await workspaceNav(page).getByRole('link', { name: /Ticket Tiers/ }).click();
  await expect(page.getByText('Delegate').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit Tier|Delete tier|Add Ticket Tier/ })).toHaveCount(0);

  await workspaceNav(page).getByRole('link', { name: /Exhibition Booths/ }).click();
  await expect(page.getByText('Acme Biotech')).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit booth|Delete booth|Assign Booth Staff|Representatives|Add Exhibition Booth/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Standee QR' })).toBeVisible();

  await workspaceNav(page).getByRole('link', { name: /Program/ }).click();
  await expect(page.getByTestId('program-session')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Add session|Upload timetable|Edit Opening|Delete Opening/ })).toHaveCount(0);
});

test('staff see booth representatives but cannot change them', async ({ page }) => {
  await fixture(page, { role: 'staff' });
  await page.goto('/organizer/events/event-s/booths');
  await page.getByRole('button', { name: 'Representatives' }).click();
  const dialog = page.getByRole('dialog', { name: 'Booth representatives' });
  await expect(dialog.getByTestId('booth-staff-list').getByRole('listitem')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Authorize Representative' })).toHaveCount(0);
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
