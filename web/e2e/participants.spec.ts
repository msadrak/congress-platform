import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The shipping Participants page against synthetic, intercepted /api/ responses (not FastAPI/PostgreSQL).
// The browser runs in New York while the congress is in Tehran (+03:30): every time shown must be Tehran's.
// Desktop unless a test says otherwise (the project default is a 412 px phone).
test.use({ timezoneId: 'America/New_York', viewport: { width: 1280, height: 800 } });
const KEY = 'synthetic-b3-organizer';
const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '', timezone: 'Asia/Tehran', archived_at: null as string | null };
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

async function fixture(page: Page, options: { failFirstList?: boolean; deleteConflict?: boolean; role?: 'owner' | 'manager' | 'staff' | 'viewer'; archived?: boolean } = {}) {
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
    scan_history: p.checkin_count
      ? [
          { checkin_point_name: 'Main Gate', status: 'ADMITTED', rejection_reason: null, scanned_at: '2099-05-10T07:30:00Z' },
          { checkin_point_name: 'Lunch', status: 'REJECTED', rejection_reason: 'TIER_NOT_ALLOWED', scanned_at: '2099-05-10T09:30:00Z' },
        ]
      : [],
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
    if (path === '/api/organizer/me') return json(200, { kind: options.role ? 'member' : 'key', role: options.role ?? 'owner', organizer: { id: 'org-1', name: 'Org' }, member: null });
    if (path === '/api/events/event-a') return json(200, { ...EVENT, archived_at: options.archived ? '2099-06-01T00:00:00Z' : null });
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
  // A same-origin static file, not the app: the home page would load its public congress list (an API request) mid-seed.
  await page.goto('/favicon.png');
  await page.evaluate(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
}

const rows = (page: Page) => page.getByTestId('participant-row');
const listCalls = (requests: Recorded[]) => requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a/participants');
const openRow = async (page: Page, name: string) => {
  await rows(page).filter({ hasText: name }).click();
  return page.getByRole('dialog', { name });
};
// The ⋯ menu closes when its button moves, so wait for the drawer's entrance to settle.
const fromMenu = async (page: Page, scope: ReturnType<Page['getByRole']>, item: string) => {
  await expect(async () => {
    if (!(await page.getByRole('menu').isVisible())) await scope.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole('menuitem', { name: item }).click();
};

test('lists participants, searches after typing settles and filters by status', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('heading', { level: 1, name: 'Participants' })).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByTestId('participants-range')).toHaveText('1–3 of 3');
  await expect(rows(page).filter({ hasText: 'Mina Rahimi' }).getByText('Cancelled').filter({ visible: true })).toBeVisible();

  const before = listCalls(requests).length;
  await page.getByTestId('participants-search').pressSequentially('reza', { delay: 30 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Reza Karimi');
  // One request for the settled term, not one per keystroke.
  expect(listCalls(requests).length - before).toBe(1);
  expect(listCalls(requests).at(-1)?.search).toContain('q=reza');

  await page.getByTestId('participants-search').fill('nobody');
  await expect(page.getByText('No participant matches this search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows(page)).toHaveCount(3);

  await page.getByLabel('Status').selectOption('cancelled');
  await expect(rows(page)).toHaveCount(1);
  expect(listCalls(requests).at(-1)?.search).toContain('status=cancelled');
  expect(requests.every(r => r.auth === `Bearer ${KEY}`)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a row click opens the drawer; rows carry no edit button and show the check-ins column', async ({ page }) => {
  await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('columnheader', { name: 'Check-ins' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Registered' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Sara Ahmadi' }).getByTestId('participant-checkins')).toHaveText('1');
  await expect(rows(page).getByRole('button', { name: /Edit|Manage/ })).toHaveCount(0);

  const drawer = await openRow(page, 'Reza Karimi');
  await expect(drawer.getByTestId('participant-drawer')).toBeVisible();
  // The congress clock (Tehran), not the browser's (New York): 08:00 UTC is 11:30 in Tehran.
  await expect(drawer).toContainText('11:30');
  await page.keyboard.press('Escape');
  // The keyboard way in: the name is a button inside the row.
  await rows(page).filter({ hasText: 'Mina Rahimi' }).getByRole('button', { name: /Mina Rahimi/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Mina Rahimi' })).toBeVisible();
});

test('a failed load offers a retry', async ({ page }) => {
  await fixture(page, { failFirstList: true });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('alert')).toContainText('The participant list could not be loaded.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(rows(page)).toHaveCount(3);
});

test('edits the registration details of one congress from the drawer', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  const drawer = await openRow(page, 'Reza Karimi');
  await drawer.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit registration details' });
  await dialog.getByLabel('Full name').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name.')).toBeVisible();
  await dialog.getByLabel('Full name').fill('Reza Karimi-Nejad');
  await dialog.getByLabel('Organization').fill('Tehran Heart Center');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Registration details saved.' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rows(page).filter({ hasText: 'Reza Karimi-Nejad' })).toContainText('Tehran Heart Center');
  const patch = requests.find(r => r.method === 'PATCH');
  expect(patch?.path).toBe('/api/events/event-a/participants/t-2');
  expect(patch?.body).toEqual({ attendee_full_name: 'Reza Karimi-Nejad', attendee_organization: 'Tehran Heart Center', attendee_title: 'Doctor' });
});

test('the drawer shows readable scan history; cancel and reissue go through confirmations', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');

  const drawer = await openRow(page, 'Sara Ahmadi');
  await expect(drawer.getByText('Main Gate')).toBeVisible();
  await expect(drawer.getByText('Admitted')).toBeVisible();
  // The refusal reads in words; the code is only a tooltip.
  await expect(drawer.getByText('Pass type not allowed')).toBeVisible();
  await expect(drawer).not.toContainText('TIER_NOT_ALLOWED');
  // Scanned: deleting is not offered at all, and nothing explains why.
  await fromMenu(page, drawer, 'Transfer pass');
  await page.getByRole('dialog', { name: 'Transfer', exact: true }).getByRole('button', { name: 'Cancel' }).click();
  await drawer.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Cancel pass' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete registration' })).toHaveCount(0);
  await drawer.getByRole('button', { name: 'More actions' }).click();

  await drawer.getByRole('button', { name: 'Reissue pass' }).click();
  const reissue = page.getByRole('dialog', { name: 'Reissue the pass?' });
  await reissue.getByRole('button', { name: 'Reissue', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pass reissued.' })).toBeVisible();
  await expect(drawer.getByText('Last reissued')).toBeVisible();
  expect(requests.find(r => r.path.endsWith('/t-1/reissue'))?.body).toEqual({ notify: true });

  await fromMenu(page, drawer, 'Cancel pass');
  const cancel = page.getByRole('dialog', { name: 'Cancel this pass?' });
  await cancel.getByLabel('Reason').fill('Asked by phone');
  await cancel.getByRole('switch', { name: 'Text the participant that the pass was cancelled' }).click();
  await cancel.getByRole('button', { name: 'Cancel pass' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pass cancelled.' })).toBeVisible();
  expect(requests.find(r => r.path.endsWith('/t-1/cancel'))?.body).toEqual({ reason: 'Asked by phone', notify: false });
  await expect(drawer.getByText('This pass no longer works.')).toBeVisible();
  await expect(drawer.getByText('Asked by phone')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Reissue pass' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(rows(page).filter({ hasText: 'Sara Ahmadi' }).getByText('Cancelled').filter({ visible: true })).toBeVisible();
});

test('transfer asks for the name when the number has no account; delete is confirmed and explains a 409', async ({ page }) => {
  const requests = await fixture(page, { deleteConflict: true });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');

  const drawer = await openRow(page, 'Reza Karimi');
  await fromMenu(page, drawer, 'Transfer pass');
  const transfer = page.getByRole('dialog', { name: 'Transfer', exact: true });
  await transfer.getByLabel('New holder\'s mobile').fill('0912');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(transfer.getByText('Enter a valid mobile number')).toBeVisible();
  await transfer.getByLabel('New holder\'s mobile').fill('09351234567');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(transfer.getByText('This number has no account yet: enter the new holder\'s name.')).toBeVisible();
  await transfer.getByLabel('Full name').fill('Neda Moradi');
  await transfer.getByRole('button', { name: 'Transfer' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pass transferred to Neda Moradi.' })).toBeVisible();
  const neda = page.getByRole('dialog', { name: 'Neda Moradi' });
  await expect(neda).toBeVisible();
  expect(requests.filter(r => r.path.endsWith('/t-2/transfer')).at(-1)?.body).toEqual({ mobile: '09351234567', full_name: 'Neda Moradi' });

  // The new holder has no history: delete is offered in ⋯ and confirmed, but a scan that arrived meanwhile refuses it.
  await fromMenu(page, neda, 'Delete registration');
  const confirm = page.getByRole('dialog', { name: 'Delete this registration?' });
  await confirm.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(neda.getByRole('alert')).toContainText('cancel their pass instead');
  expect(requests.some(r => r.method === 'DELETE' && r.path.endsWith('/t-9'))).toBe(true);
});

test('Persian copy and the Excel export of the filtered list', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page, 'fa');
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByRole('heading', { level: 1, name: 'شرکت‌کنندگان' })).toBeVisible();
  const main = page.locator('#organizer-main-content');
  for (const banned of ['بلیط', 'بلیت', 'CSV']) await expect(main).not.toContainText(banned);
  await expect(page.getByRole('columnheader', { name: 'ورود', exact: true })).toBeVisible();
  await page.getByLabel('نوع کارت ورود').selectOption('tier-2');
  await expect(rows(page)).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'خروجی اکسل' }).click();
  expect((await download).suggestedFilename()).toBe('alpha-participants.csv');
  const csv = requests.find(r => r.path.endsWith('/participants/export-csv'));
  expect(csv?.search).toBe('?tier_id=tier-2');
  // No Latin in mono: mobiles use Persian digits in the sans font.
  const mobile = rows(page).first().locator('bdi[dir="ltr"]').filter({ visible: true }).first();
  await expect(mobile).toHaveText('۰۹۱۲ ۰۰۰ ۰۰۰۲');
  expect(await mobile.evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/Plex Mono/);
});

test('at 390 px rows stack, the first row is above the fold and the filters open in a sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  const first = rows(page).first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
  await expect(page.getByLabel('Status')).toBeHidden();
  await page.getByTestId('participants-filter-button').click();
  const sheet = page.getByRole('dialog', { name: 'Filters' });
  await sheet.getByLabel('Status').selectOption('cancelled');
  await sheet.getByRole('button', { name: 'Show results' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(listCalls(requests).at(-1)?.search).toContain('status=cancelled');
  await expect(page.getByTestId('participants-filter-button')).toHaveText(/Filter \(1\)/);
  // The export waits in ⋯ on a phone.
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export CSV' })).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await first.click();
  await expect(page.getByRole('dialog', { name: 'Mina Rahimi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('staff look participants up without export or changes; a viewer gets a lock with a link to statistics', async ({ page }) => {
  await fixture(page, { role: 'staff' });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0);
  const drawer = await openRow(page, 'Reza Karimi');
  await expect(drawer.getByTestId('participant-drawer')).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Edit|Reissue|More actions/ })).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByText('Your role can\'t see personal details.')).toBeVisible();
  await expect(page.getByRole('search')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open statistics' }).click();
  await expect(page).toHaveURL(/\/analytics$/);
});

test('an archived congress is read-only: banner, no change actions', async ({ page }) => {
  await fixture(page, { archived: true });
  await seed(page);
  await page.goto('/organizer/events/event-a/participants');
  await expect(page.getByTestId('section-archived')).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  const drawer = await openRow(page, 'Reza Karimi');
  await expect(drawer.getByTestId('participant-drawer')).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Edit|Reissue|More actions/ })).toHaveCount(0);
});
