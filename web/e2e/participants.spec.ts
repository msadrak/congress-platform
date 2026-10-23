import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The shipping Participants page against synthetic, intercepted /api/ responses (not FastAPI/PostgreSQL).
const KEY = 'synthetic-b3-organizer';
const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '' };
const TIERS = [
  { id: 'tier-1', name: 'Delegate', description: '', quota: 100, reserved_count: 3, is_open: true },
  { id: 'tier-2', name: 'Student', description: '', quota: 50, reserved_count: 1, is_open: true },
];

interface Participant {
  ticket_id: string; user_id: string; attendee_full_name: string; attendee_organization: string; attendee_title: string;
  mobile: string | null; ticket_tier_id: string; ticket_tier_name: string; status: 'active' | 'cancelled';
  created_at: string; updated_at: string; cancelled_at: string | null; cancelled_reason: string | null; cancelled_by: string | null;
  reissued_at: string | null; issued_by: string | null; checkin_count: number; lead_count: number; can_delete: boolean; account_deleted: boolean;
}

const person = (n: number, name: string, extra: Partial<Participant> = {}): Participant => ({
  ticket_id: `t-${n}`, user_id: `u-${n}`, attendee_full_name: name, attendee_organization: 'Acme', attendee_title: 'Doctor',
  mobile: `0912000000${n}`, ticket_tier_id: 'tier-1', ticket_tier_name: 'Delegate', status: 'active',
  created_at: `2099-01-0${n}T08:00:00Z`, updated_at: `2099-01-0${n}T08:00:00Z`, cancelled_at: null, cancelled_reason: null,
  cancelled_by: null, reissued_at: null, issued_by: null, checkin_count: 0, lead_count: 0, can_delete: true, account_deleted: false,
  ...extra,
});

type Recorded = { method: string; path: string; search: string; auth: string | undefined; body: unknown };

async function fixture(page: Page, options: { failFirstList?: boolean; deleteConflict?: boolean } = {}) {
  const requests: Recorded[] = [];
  const people: Participant[] = [
    person(1, 'Sara Ahmadi', { checkin_count: 1, can_delete: false }),
    person(2, 'Reza Karimi', { ticket_tier_id: 'tier-2', ticket_tier_name: 'Student' }),
    person(3, 'Mina Rahimi', { status: 'cancelled', cancelled_at: '2099-01-04T08:00:00Z', cancelled_reason: 'Duplicate', cancelled_by: 'organizer' }),
  ];
  let failList = options.failFirstList ?? false;
  const detail = (p: Participant) => ({
    ...p,
    qr_secret: p.status === 'active' ? `qr-${p.ticket_id}` : null,
    scan_history: p.checkin_count ? [{ checkin_point_name: 'Main Gate', status: 'ADMITTED', rejection_reason: null, scanned_at: '2099-05-10T07:30:00Z' }] : [],
  });
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, search: url.search, auth: request.headers().authorization, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path === '/api/events/event-a') return json(200, EVENT);
    if (path === '/api/events/event-a/ticket-tiers') return json(200, TIERS);
    if (path === '/api/events/event-a/participants' && method === 'GET') {
      if (failList) {
        failList = false;
        return json(500, { detail: 'Server error' });
      }
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const status = url.searchParams.get('status');
      const tier = url.searchParams.get('tier_id');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const matches = people.filter(p =>
        (!q || p.attendee_full_name.toLowerCase().includes(q) || (p.mobile ?? '').includes(q)) &&
        (!status || p.status === status) && (!tier || p.ticket_tier_id === tier));
      return json(200, { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset });
    }
    if (path === '/api/events/event-a/participants/export-csv') {
      return route.fulfill({ status: 200, contentType: 'text/csv', body: 'Ticket ID,Full Name\n' });
    }
    const item = path.match(/^\/api\/events\/event-a\/participants\/([^/]+)(\/[a-z]+)?$/);
    if (item) {
      const index = people.findIndex(p => p.ticket_id === item[1]);
      if (index < 0) return json(404, { detail: 'Participant not found', code: 'PARTICIPANT_NOT_FOUND' });
      const p = people[index];
      const action = item[2] ?? '';
      if (action === '' && method === 'GET') return json(200, detail(p));
      if (action === '' && method === 'PATCH') {
        people[index] = { ...p, ...body };
        return json(200, detail(people[index]));
      }
      if (action === '' && method === 'DELETE') {
        if (options.deleteConflict) return json(409, { detail: 'Cancel instead', code: 'PARTICIPANT_HAS_HISTORY' });
        people.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      if (action === '/cancel') {
        if (p.status !== 'active') return json(409, { detail: 'Already cancelled', code: 'TICKET_STATE_CONFLICT' });
        people[index] = { ...p, status: 'cancelled', cancelled_at: '2099-01-09T08:00:00Z', cancelled_reason: body.reason || null, cancelled_by: 'organizer' };
        return json(200, detail(people[index]));
      }
      if (action === '/reissue') {
        people[index] = { ...p, reissued_at: '2099-01-09T09:00:00Z' };
        return json(200, detail(people[index]));
      }
      if (action === '/transfer') {
        if (!body.full_name) return json(422, { detail: 'This number has no account yet', code: 'FULL_NAME_REQUIRED' });
        people[index] = { ...p, status: 'cancelled', cancelled_reason: 'transferred', cancelled_by: 'organizer', cancelled_at: '2099-01-09T10:00:00Z' };
        const moved = person(9, body.full_name, { mobile: body.mobile, ticket_tier_id: p.ticket_tier_id, ticket_tier_name: p.ticket_tier_name });
        people.unshift(moved);
        return json(200, detail(moved));
      }
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
}

const rows = (page: Page) => page.getByTestId('participant-row');
const listCalls = (requests: Recorded[]) => requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a/participants');

test('lists participants, searches after typing settles and filters by status', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('heading', { level: 1, name: 'Participants' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Event workspace' }).getByRole('link', { name: /Participants/ })).toHaveAttribute('aria-current', 'page');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('participants-range')).toHaveText('1–3 of 3');
  await expect(rows(page).filter({ hasText: 'Mina Rahimi' }).getByText('Cancelled')).toBeVisible();

  const before = listCalls(requests).length;
  await page.getByTestId('participants-search').pressSequentially('reza', { delay: 30 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Reza Karimi');
  // One request for the settled term, not one per keystroke.
  expect(listCalls(requests).length - before).toBe(1);
  expect(listCalls(requests).at(-1)?.search).toContain('q=reza');

  await page.getByTestId('participants-search').fill('nobody');
  await expect(page.getByText('No participant matches this search and these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows(page)).toHaveCount(3);

  await page.getByLabel('Status').selectOption('cancelled');
  await expect(rows(page)).toHaveCount(1);
  expect(listCalls(requests).at(-1)?.search).toContain('status=cancelled');
  expect(requests.every(r => r.auth === `Bearer ${KEY}`)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a failed load offers a retry', async ({ page }) => {
  await fixture(page, { failFirstList: true });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('alert')).toContainText('The participant list could not be loaded.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(3);
});

test('edits the registration details of one congress', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await page.getByRole('button', { name: 'Edit: Reza Karimi' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit registration details' });
  await dialog.getByLabel('Full name').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await dialog.getByLabel('Full name').fill('Reza Karimi-Nejad');
  await dialog.getByLabel('Organization').fill('Tehran Heart Center');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Registration details saved.' })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Reza Karimi-Nejad' })).toContainText('Tehran Heart Center');
  const patch = requests.find(r => r.method === 'PATCH');
  expect(patch?.path).toBe('/api/events/event-a/participants/t-2');
  expect(patch?.body).toEqual({ attendee_full_name: 'Reza Karimi-Nejad', attendee_organization: 'Tehran Heart Center', attendee_title: 'Doctor' });
});

test('the drawer shows scan history; cancel and reissue go through confirmations', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');

  await page.getByRole('button', { name: 'Manage: Sara Ahmadi' }).click();
  const drawer = page.getByRole('dialog', { name: 'Sara Ahmadi' });
  await expect(drawer.getByText('Main Gate')).toBeVisible();
  await expect(drawer.getByText('Admitted')).toBeVisible();
  // Scanned: deleting is not offered, cancelling is.
  await expect(drawer.getByRole('button', { name: 'Delete registration' })).toHaveCount(0);
  await expect(drawer.getByText('cancel the ticket instead')).toBeVisible();

  await drawer.getByRole('button', { name: 'Reissue pass' }).click();
  const reissue = page.getByRole('dialog', { name: 'Reissue the pass?' });
  await reissue.getByRole('button', { name: 'Reissue', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pass reissued.' })).toBeVisible();
  await expect(drawer.getByText('Last reissued')).toBeVisible();
  expect(requests.find(r => r.path.endsWith('/t-1/reissue'))?.body).toEqual({ notify: true });

  await drawer.getByRole('button', { name: 'Cancel ticket' }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel this ticket?' });
  await cancel.getByLabel('Reason (optional)').fill('Asked by phone');
  await cancel.getByLabel('Text the participant that the ticket was cancelled').uncheck();
  await cancel.getByRole('button', { name: 'Cancel ticket' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ticket cancelled.' })).toBeVisible();
  expect(requests.find(r => r.path.endsWith('/t-1/cancel'))?.body).toEqual({ reason: 'Asked by phone', notify: false });
  await expect(drawer.getByText('This ticket\'s pass and QR code no longer work.')).toBeVisible();
  await expect(drawer.getByText('Asked by phone')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Reissue pass' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(rows(page).filter({ hasText: 'Sara Ahmadi' }).getByText('Cancelled')).toBeVisible();
});

test('transfer asks for the name when the number has no account; delete explains a 409', async ({ page }) => {
  const requests = await fixture(page, { deleteConflict: true });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');

  await page.getByRole('button', { name: 'Manage: Reza Karimi' }).click();
  const drawer = page.getByRole('dialog', { name: 'Reza Karimi' });
  await drawer.getByRole('button', { name: 'Transfer ticket' }).click();
  const transfer = page.getByRole('dialog', { name: 'Transfer the ticket to someone else' });
  await transfer.getByLabel('New holder\'s mobile').fill('0912');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(transfer.getByText('Enter a valid Iranian mobile number')).toBeVisible();
  await transfer.getByLabel('New holder\'s mobile').fill('09351234567');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(transfer.getByText('This number has no account yet: enter the new holder\'s name.')).toBeVisible();
  await transfer.getByLabel('Full name').fill('Neda Moradi');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Ticket transferred to Neda Moradi.' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Neda Moradi' })).toBeVisible();
  expect(requests.filter(r => r.path.endsWith('/t-2/transfer')).at(-1)?.body).toEqual({ mobile: '09351234567', full_name: 'Neda Moradi' });

  // The new holder has no history: delete is offered, but a scan that arrived meanwhile refuses it.
  const neda = page.getByRole('dialog', { name: 'Neda Moradi' });
  await neda.getByRole('button', { name: 'Delete registration' }).click();
  const remove = page.getByRole('dialog', { name: 'Delete this registration?' });
  await remove.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(remove.getByRole('alert')).toContainText('cancel the ticket instead');
  await expect(remove.getByRole('button', { name: 'Cancel ticket' })).toBeVisible();
});

test('Persian copy and CSV export of the filtered list', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, 'fa');
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('heading', { level: 1, name: 'شرکت‌کنندگان' })).toBeVisible();
  // This page follows the glossary (بلیت, never بلیط); the shared navigation copy is outside its scope.
  await expect(page.locator('#organizer-main-content')).not.toContainText('بلیط');
  await page.getByLabel('نوع بلیت').selectOption('tier-2');
  await expect(rows(page)).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'خروجی CSV' }).click();
  expect((await download).suggestedFilename()).toBe('alpha-participants.csv');
  const csv = requests.find(r => r.path.endsWith('/participants/export-csv'));
  expect(csv?.search).toBe('?tier_id=tier-2');
});
