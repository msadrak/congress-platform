import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Organizer members, roles and the activity log (ADR 0016) against the shipping console pages with synthetic,
// intercepted /api/ responses: not FastAPI/PostgreSQL E2E (backend/tests cover the server side).
const CODE = '246810';
const MOBILE = '09121234567';
const organizers = {
  acme: { id: 'org-acme', name: 'Acme Congress Co' },
  beta: { id: 'org-beta', name: 'Beta Events' },
};
type Role = 'owner' | 'manager' | 'staff' | 'viewer';
type Recorded = { method: string; path: string; auth: string | undefined; body: unknown; query: string };

const member = (id: string, name: string, role: Role, extra: Record<string, unknown> = {}) => ({
  id, display_name: name, mobile: '0912100' + id.slice(-4).padStart(4, '0'), role, invited_by: 'Platform admin',
  created_at: '2026-10-01T08:00:00Z', revoked_at: null, ...extra,
});
const session = (role: Role, organizer = organizers.acme) => ({
  kind: 'member', role, organizer, member: member('m-0001', 'Neda Karimi', role, { mobile: MOBILE }),
});
const audit = (id: string, action: string, extra: Record<string, unknown> = {}) => ({
  id, at: '2026-10-22T09:30:00Z', actor_type: 'organizer_member', actor_label: 'Neda Karimi', action,
  event_id: null, entity_type: null, entity_id: null, summary: {}, ip: '10.0.0.7', request_id: 'req-1', ...extra,
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
});

async function fixture(page: Page, role: Role, options: { lastOwner?: boolean; activity?: unknown[]; members?: ReturnType<typeof member>[] } = {}) {
  const requests: Recorded[] = [];
  let members = options.members ?? [member('m-0001', 'Neda Karimi', role, { mobile: MOBILE }), member('m-0002', 'Ali Rad', 'staff')];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, auth: request.headers().authorization, body, query: url.search });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

    if (path === '/api/auth/otp/request') return json(202, { mobile: body.mobile, code_length: 6, expires_in: 120, resend_after: 60 });
    if (path === '/api/organizer/login') {
      if (body.code !== CODE) return json(401, { detail: 'The code is wrong or has expired.' });
      return json(200, {
        status: 'choose_organizer', access_token: null, token_type: 'bearer', session: null, selection_token: 'select-fixture',
        organizers: [{ organizer: organizers.acme, role: 'viewer' }, { organizer: organizers.beta, role }],
      });
    }
    if (path === '/api/organizer/session') {
      return json(200, { status: 'signed_in', access_token: 'member-token', token_type: 'bearer', session: session(role, organizers.beta), selection_token: null, organizers: [] });
    }
    if (path === '/api/organizer/me') return json(200, session(role));
    if (path === '/api/organizer/logout') return route.fulfill({ status: 204, body: '' });
    if (path === '/api/events') return json(200, [{ id: 'event-a', name: 'Cardiology 2027', slug: 'cardio', starts_at: '2027-04-10T08:00:00Z', ends_at: '2027-04-10T18:00:00Z', location: 'Hall', description: '' }]);
    if (path === '/api/organizer/members' && method === 'GET') {
      if (role === 'viewer' || role === 'staff') return json(403, { detail: 'Your role does not allow this', code: 'ROLE_FORBIDDEN' });
      return json(200, members);
    }
    if (path === '/api/organizer/members' && method === 'POST') {
      const added = member('m-0003', body.display_name, body.role, { mobile: body.mobile, invited_by: 'Neda Karimi' });
      members = [...members, added];
      return json(201, added);
    }
    const one = path.match(/^\/api\/organizer\/members\/([^/]+)(\/revoke)?$/);
    if (one) {
      if (options.lastOwner) return json(409, { detail: 'Add another owner first', code: 'LAST_OWNER' });
      const target = members.find(m => m.id === one[1])!;
      const saved = one[2] ? { ...target, revoked_at: '2026-10-23T10:00:00Z' } : { ...target, ...body };
      members = members.map(m => (m.id === saved.id ? saved : m));
      return json(200, saved);
    }
    if (path === '/api/organizer/activity') {
      if (options.activity) return json(200, { items: options.activity, next_before: null });
      if (url.searchParams.get('before') === 'cursor-1') {
        return json(200, { items: [audit('a-3', 'organizer.key_rotated', { actor_type: 'platform_admin', actor_label: 'Platform admin', ip: null })], next_before: null });
      }
      const items = [
        audit('a-1', 'member.role_changed', { summary: { display_name: 'Ali Rad', from: 'staff', to: 'viewer' } }),
        audit('a-2', 'http.patch', { event_id: 'event-a', actor_type: 'desk_operator', actor_label: 'Sara', summary: { route: '/api/events/{event_id}/booths/{booth_id}', method: 'PATCH', status: 200 } }),
      ];
      return json(200, { items, next_before: 'cursor-1' });
    }
    return json(200, []);
  });
  return requests;
}

async function seedSession(page: Page, token = 'member-token') {
  await page.goto('/');
  await page.evaluate(value => sessionStorage.setItem('congress_organizer_api_key', value), token);
}

test('a member signs in with an SMS code, picks an organizer and works with their session', async ({ page }) => {
  const requests = await fixture(page, 'manager');
  await page.goto('/organizer');

  await expect(page.getByRole('heading', { name: 'Sign in to the organizer console' })).toBeVisible();
  await page.getByLabel('Mobile number').fill(MOBILE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code from the SMS').fill(CODE);

  await expect(page.getByRole('heading', { name: 'Which organization?' })).toBeVisible();
  await page.getByRole('button', { name: /Beta Events/ }).click();

  await expect(page.getByRole('link', { name: /Members/ })).toBeVisible();
  expect(requests.find(r => r.path === '/api/auth/otp/request')?.body).toEqual({ mobile: MOBILE, purpose: 'organizer' });
  expect(requests.find(r => r.path === '/api/organizer/session')?.body).toEqual({ selection_token: 'select-fixture', organizer_id: 'org-beta' });
  expect(await page.evaluate(() => sessionStorage.getItem('congress_organizer_api_key'))).toBe('member-token');
  expect(requests.filter(r => r.path === '/api/events').every(r => r.auth === 'Bearer member-token')).toBe(true);

  await page.getByRole('button', { name: /^(Account menu|Menu)$/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to the organizer console' })).toBeVisible();
  expect(requests.some(r => r.path === '/api/organizer/logout' && r.auth === 'Bearer member-token')).toBe(true);
  expect(await page.evaluate(() => sessionStorage.getItem('congress_organizer_api_key'))).toBeNull();
});

test('the organizer key stays available behind a secondary link', async ({ page }) => {
  await fixture(page, 'owner');
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'Use organizer key' }).click();
  await expect(page.locator('#apiKeyInput')).toBeVisible();
  await expect(page.getByText('For integrations; acts as owner.')).toBeVisible();
});

test('an owner adds a member, changes a role and removes a member', async ({ page }) => {
  const requests = await fixture(page, 'owner');
  await seedSession(page);
  await page.goto('/organizer/members');

  const table = page.getByTestId('members-table');
  await expect(table.getByText('Ali Rad')).toBeVisible();
  // Role meanings live in the role picker, not in cards under the table.
  await expect(page.getByText('Reception, scanners and participant lookup')).toHaveCount(0);
  await page.getByRole('button', { name: 'New member' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Maryam Bagheri');
  await dialog.getByRole('textbox', { name: 'Mobile number' }).fill('0912 555 1234');
  await dialog.getByRole('radio', { name: /Manager/ }).check();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Maryam Bagheri was added' })).toBeVisible();
  expect(requests.find(r => r.path === '/api/organizer/members' && r.method === 'POST')?.body).toEqual({ display_name: 'Maryam Bagheri', mobile: '09125551234', role: 'manager' });

  // A role change goes through the role picker and asks first; cancelling changes nothing.
  await page.getByRole('button', { name: 'Actions for Ali Rad' }).click();
  await page.getByRole('menuitem', { name: 'Change role' }).click();
  const roleDialog = page.getByRole('dialog', { name: 'Role of Ali Rad' });
  await roleDialog.getByRole('radio', { name: /Viewer/ }).click();
  await page.getByRole('dialog', { name: "Change Ali Rad's role to Viewer?" }).getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some(r => r.method === 'PATCH')).toBe(false);
  await roleDialog.getByRole('radio', { name: /Viewer/ }).click();
  await page.getByRole('dialog', { name: "Change Ali Rad's role to Viewer?" }).getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByText("Ali Rad's role changed; they need to sign in again.")).toBeVisible();
  expect(requests.find(r => r.method === 'PATCH')?.body).toEqual({ role: 'viewer' });

  await page.getByRole('button', { name: 'Actions for Maryam Bagheri' }).click();
  await page.getByRole('menuitem', { name: 'Remove access' }).click();
  await page.getByRole('dialog', { name: "Remove Maryam Bagheri's access?" }).getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByText('Maryam Bagheri removed.')).toBeVisible();
  await expect(table.getByRole('row', { name: /Maryam Bagheri/ }).getByText('Access removed')).toBeVisible();
});

test('refusals arrive in the reader\'s language: the last owner and a role that may not manage members', async ({ page }) => {
  await fixture(page, 'owner', { lastOwner: true });
  await seedSession(page);
  await page.goto('/organizer/members');
  await page.getByRole('button', { name: 'Actions for Neda Karimi' }).click();
  await page.getByRole('menuitem', { name: 'Change role' }).click();
  await page.getByRole('dialog', { name: 'Role of Neda Karimi' }).getByRole('radio', { name: /Manager/ }).click();
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByRole('alert')).toContainText('Add another owner before removing or demoting the last one.');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page, 'staff');
  await page.goto('/organizer/members');
  await expect(page.getByRole('heading', { name: "Your role can't see the members" })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Congresses' }).last()).toBeVisible();
  await expect(page.getByRole('link', { name: /Activity/ })).toHaveCount(0);
});

test('the activity log reads who did what, filters by congress and pages back', async ({ page }) => {
  const requests = await fixture(page, 'manager');
  await seedSession(page);
  await page.goto('/organizer/activity');

  const list = page.getByTestId('activity-list');
  await expect(list.getByText("changed a member's role")).toBeVisible();
  await expect(list.getByText('Ali Rad: Staff → Viewer')).toBeVisible();
  await expect(list.getByText('edited a booth')).toBeVisible();
  await expect(list).not.toContainText('events › booths');
  await expect(list.getByText('Cardiology 2027')).toBeVisible();
  await page.getByRole('button', { name: 'Older entries' }).click();
  await expect(list.getByText('rotated the organizer key')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Older entries' })).toHaveCount(0);

  await page.getByLabel('Congress').selectOption('event-a');
  await expect.poll(() => requests.some(r => r.path === '/api/organizer/activity' && r.query.includes('event_id=event-a'))).toBe(true);
});

test('Persian activity and members never show route templates or the raw key label', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await fixture(page, 'owner', {
    activity: [
      audit('a-1', 'http.post', { event_id: 'event-a', actor_type: 'organizer_key', actor_label: 'Integration key', ip: null, summary: { route: '/api/checkin-points/{point_id}/token', method: 'POST', status: 201 } }),
      audit('a-2', 'http.patch', { event_id: 'event-a', summary: { route: '/api/events/{event_id}/participants/{ticket_id}', method: 'PATCH', status: 200 } }),
      audit('a-3', 'export.download', { actor_type: 'booth_staff', actor_label: 'رضا', summary: { route: '/api/booths/{booth_id}/leads/export-csv', method: 'GET', status: 200 } }),
      audit('a-4', 'http.delete', { summary: { route: '/api/events/{event_id}/brand-new/{thing_id}', method: 'DELETE', status: 204 } }),
    ],
    members: [member('m-0001', 'Neda Karimi', 'owner', { mobile: MOBILE, invited_by: 'api-key' })],
  });
  await seedSession(page);
  await page.goto('/organizer/activity');
  const list = page.getByTestId('activity-list');
  await expect(list).toContainText('کلید سازمان');
  await expect(list).toContainText('برای نقطه ورود پیوند اتصال اسکنر ساخت');
  await expect(list).toContainText('اطلاعات شرکت‌کننده را ویرایش کرد');
  await expect(list).toContainText('نمایندهٔ غرفه');
  await expect(list).toContainText('خروجی اکسل لیدهای غرفه را دریافت کرد');
  await expect(list).toContainText('موردی را حذف کرد');
  const text = await list.innerText();
  for (const raw of ['checkin-points', 'participants', 'brand-new', '›', 'Integration key', 'booth_staff', 'API']) expect(text).not.toContain(raw);

  await page.goto('/organizer/members');
  const table = page.getByTestId('members-table');
  await expect(table).toContainText('Neda Karimi');
  await expect(table).not.toContainText('api-key');
  await expect(table).toContainText('۰۹۱۲ ۱۲۳ ۴۵۶۷');
});

test('the activity log in English never shows a raw route either', async ({ page }) => {
  await fixture(page, 'owner', {
    activity: [audit('a-1', 'http.delete', { summary: { route: '/api/events/{event_id}/brand-new/{thing_id}', method: 'DELETE', status: 204 } })],
  });
  await seedSession(page);
  await page.goto('/organizer/activity');
  const list = page.getByTestId('activity-list');
  await expect(list).toContainText('deleted an item');
  for (const raw of ['brand-new', 'thing', '›', '{']) await expect(list).not.toContainText(raw);
});

for (const path of ['/organizer', '/organizer/members']) {
  test(`offline, ${path} shows an alert with a retry within 3 s and no page error`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await seedSession(page);
    await page.route(/^https?:\/\/[^/]+\/api\//, (route) => route.abort('internetdisconnected'));
    await page.goto(path);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 3000 });
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
