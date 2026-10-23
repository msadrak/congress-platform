import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Organizer pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in ORGANIZER_PORTAL_MILESTONE_RESULT.md.
const KEY = 'synthetic-ms03-organizer';
const bearer = `Bearer ${KEY}`;

interface FixtureEvent { id: string; name: string; slug: string; starts_at: string; ends_at: string; location: string; description: string }
interface FixtureTier { id: string; name: string; description: string; quota: number; reserved_count: number; is_open: boolean }

const eventOf = (id: string, name: string, starts: string, ends: string): FixtureEvent => ({ id, name, slug: id, starts_at: starts, ends_at: ends, location: `${name} Hall`, description: `About ${name}` });
const EVENTS: Record<string, FixtureEvent> = {
  'event-a': eventOf('event-a', 'Alpha Congress', '2099-05-10T07:00:00Z', '2099-05-12T15:00:00Z'),
  'event-b': eventOf('event-b', 'Beta Summit', '2020-05-10T07:00:00Z', '2020-05-12T15:00:00Z'),
};
const tierOf = (id: string, name: string, quota: number, reserved: number, open = true): FixtureTier => ({ id, name, description: '', quota, reserved_count: reserved, is_open: open });

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  tiersA?: FixtureTier[];
  revokeStatus?: number;
  slowTiersOf?: string;
}

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const events: Record<string, FixtureEvent> = { ...EVENTS };
  const tiers: Record<string, FixtureTier[]> = {
    'event-a': options.tiersA ?? [tierOf('tier-a1', 'Alpha Delegate', 100, 40), tierOf('tier-a2', 'Alpha Student', 20, 20, false)],
    'event-b': [tierOf('tier-b1', 'Beta Delegate', 50, 5)],
  };
  const points = [{ id: 'point-a1', event_id: 'event-a', name: 'Main Gate', location: 'North entrance', policy_type: 'MULTI_ENTRY', allowed_tier_ids: [], max_capacity: null, created_at: '2099-01-01T00:00:00Z' }];
  const devices = [{ id: 'device-old', checkin_point_id: 'point-a1', event_id: 'event-a', device_name: 'Old tablet', is_revoked: false, revoked_at: null, created_at: '2099-01-01T00:00:00Z', last_seen_at: null }];
  const SMS_DEFAULT = '{name} عزیز، ثبت‌نام شما در «{event}» تأیید شد.\nکارت ورود: {link}';
  let smsTemplate = { kind: 'ticket_confirmation', body: SMS_DEFAULT, is_custom: false, default_body: SMS_DEFAULT, placeholders: ['name', 'event', 'tier', 'location', 'link'], required: [] };
  const smsLog: Record<string, unknown>[] = [{ id: 'm-0', kind: 'ticket_confirmation', mobile: '0912***2233', body: 'Sara عزیز…', status: 'pending', attempts: 0, last_error: null, created_at: '2099-01-01T00:00:00Z', sent_at: null }];
  const operators = [{ id: 'op-1', event_id: 'event-a', user_id: 'u1', operator_name: 'Operator One', mobile: '09121110001', is_revoked: false, created_at: '2099-01-01T00:00:00Z' }];
  const places = [
    { id: 'place-hall', event_id: 'event-a', kind: 'hall', name: 'Main hall', location: 'Ground floor', position: 0, created_at: '2099-01-01T00:00:00Z' },
    { id: 'place-hall2', event_id: 'event-a', kind: 'hall', name: 'Hall 2', location: '', position: 1, created_at: '2099-01-01T00:00:01Z' },
  ];
  const sessionOf = (n: number, body: Record<string, unknown>) => {
    const hall = places.find(p => p.id === body.hall_id || (body.hall && p.name.toLowerCase() === String(body.hall).toLowerCase()));
    return { id: `session-${n}`, event_id: 'event-a', track: '', speakers: '', description: '', ...body, hall_id: hall?.id ?? null, hall_name: hall?.name ?? '', created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:00:00Z' };
  };
  let sessions = [sessionOf(1, { title: 'Opening keynote', track: 'Keynote', hall_id: 'place-hall', starts_at: '2099-05-10T07:30:00Z', ends_at: '2099-05-10T08:30:00Z' })];
  const booths = [{ id: 'booth-a1', event_id: 'event-a', name: 'Acme Biotech', slug: 'acme', location: 'Hall B, Stand 4', description: '', website_url: '', brochure_url: '', qr_secret: 'qr-a1', created_at: '2099-01-01T00:00:00Z' }];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    requests.push({ method, path, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/events') return json(200, Object.values(events));
    const point = path.match(/^\/api\/checkin-points\/point-a1(\/.*)$/);
    if (point) {
      const [, sub] = point;
      if (sub === '/devices' && method === 'GET') return json(200, devices);
      if (sub === '/token' && method === 'POST') {
        const created = { ...devices[0], id: 'device-new', device_name: JSON.parse(raw ?? '{}').device_name, is_revoked: false, created_at: '2099-01-02T00:00:00Z' };
        devices.unshift(created);
        return json(201, { scanner_token: 'synthetic.scanner.token', token_type: 'Bearer', point_id: 'point-a1', event_id: 'event-a', device_id: created.id, expires_at: '2099-01-09T00:00:00Z' });
      }
      const revoke = sub.match(/^\/devices\/([^/]+)\/revoke$/);
      if (revoke && method === 'POST') {
        const index = devices.findIndex(d => d.id === revoke[1]);
        devices[index] = { ...devices[index], is_revoked: true, revoked_at: '2099-01-02T00:00:00Z' };
        return json(200, devices[index]);
      }
    }
    const match = path.match(/^\/api\/events\/([^/]+)(\/.*)?$/);
    if (!match) return json(404, { detail: 'Not found' });
    const [, id, rest = ''] = match;
    if (!events[id]) return json(404, { detail: 'Event not found' });
    if (rest === '' && method === 'GET') return json(200, events[id]);
    if (rest === '' && method === 'PATCH') {
      events[id] = { ...events[id], ...JSON.parse(raw ?? '{}') };
      return json(200, events[id]);
    }
    if (rest === '/ticket-tiers' && method === 'GET') {
      if (options.slowTiersOf === id) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1500);
        await promise;
      }
      return json(200, tiers[id]);
    }
    const tierPatch = rest.match(/^\/ticket-tiers\/([^/]+)$/);
    if (tierPatch && method === 'PATCH') {
      const index = tiers[id].findIndex(t => t.id === tierPatch[1]);
      tiers[id][index] = { ...tiers[id][index], ...JSON.parse(raw ?? '{}') };
      return json(200, tiers[id][index]);
    }
    if (rest === '/checkin-points') return json(200, id === 'event-a' ? points : []);
    if (rest === '/sms') return json(200, { delivery: 'console', templates: [smsTemplate], sample: { name: 'نام شرکت‌کننده', event: events[id].name, tier: 'Alpha Delegate', location: events[id].location, link: `http://test/c/${id}/my-ticket` } });
    if (rest === '/sms/templates/ticket_confirmation') {
      if (method === 'PUT') smsTemplate = { ...smsTemplate, body: JSON.parse(raw ?? '{}').body.trim(), is_custom: true };
      else smsTemplate = { ...smsTemplate, body: SMS_DEFAULT, is_custom: false };
      return json(200, smsTemplate);
    }
    if (rest === '/sms/test') {
      const body = JSON.parse(raw ?? '{}');
      const text = String(body.body).replace('{name}', 'نام شرکت‌کننده').replace('{event}', events[id].name).replace('{link}', `http://test/c/${id}/my-ticket`);
      smsLog.unshift({ id: `m-${smsLog.length}`, kind: 'test', mobile: '0935***4567', body: text, status: 'sent', attempts: 1, last_error: null, created_at: '2099-01-02T00:00:00Z', sent_at: '2099-01-02T00:00:00Z' });
      return json(200, { status: 'sent', text, error: null, test_mode: true });
    }
    if (rest.startsWith('/sms/messages')) return json(200, smsLog);
    if (rest === '/desk/operators') return json(200, id === 'event-a' ? operators : []);
    if (rest === '/desk/operators/op-1/revoke') {
      if (options.revokeStatus) return json(options.revokeStatus, { detail: 'Server error' });
      operators[0] = { ...operators[0], is_revoked: true };
      return json(200, operators[0]);
    }
    if (rest === '/desk/me') return json(200, { operator_id: null, operator_name: 'Organizer Admin', event_id: id, event_name: events[id].name, event_slug: id, is_organizer_admin: true });
    if (rest === '/desk/tiers') return json(200, tiers[id]);
    if (rest === '/attendees') return json(200, []);
    if (rest === '/analytics/attendance') return json(200, { event_id: id, total_tickets: 60, unique_admitted: 30, checkin_rate: 50, total_scans: 44, total_admitted: 40, total_rejected: 4, catering_metrics: [], gate_breakdown: [] });
    if (rest === '/analytics/export-csv') return route.fulfill({ status: 200, contentType: 'text/csv', body: 'ticket,state\n1,admitted\n' });
    if (id === 'event-a') {
      if (rest === '/venue-places' && method === 'GET') return json(200, places);
      if (rest === '/venue-places' && method === 'POST') {
        const body = JSON.parse(raw ?? '{}');
        const created = { id: `place-${places.length + 1}`, event_id: id, location: '', ...body, position: places.filter(p => p.kind === body.kind).length, created_at: '2099-01-02T00:00:00Z' };
        places.push(created);
        return json(201, created);
      }
      const place = rest.match(/^\/venue-places\/([^/]+)$/);
      if (place && method === 'PATCH') {
        const index = places.findIndex(p => p.id === place[1]);
        places[index] = { ...places[index], ...JSON.parse(raw ?? '{}') };
        return json(200, places[index]);
      }
      if (rest === '/sessions' && method === 'GET') return json(200, sessions);
      if (rest === '/sessions' && method === 'POST') {
        const created = sessionOf(sessions.length + 1, JSON.parse(raw ?? '{}'));
        sessions.push(created);
        return json(201, created);
      }
      if (rest === '/sessions/import' && method === 'POST') {
        const body = JSON.parse(raw ?? '{}');
        const removed = body.replace ? sessions.length : 0;
        const known = new Set(places.map(p => p.name.toLowerCase()));
        const newHalls = [...new Set<string>(body.sessions.map((s: { hall: string }) => s.hall).filter((h: string) => h && !known.has(h.toLowerCase())))];
        newHalls.forEach((name, i) => places.push({ id: `place-new-${i}`, event_id: id, kind: 'hall', name, location: '', position: places.length, created_at: '2099-01-02T00:00:00Z' }));
        sessions = [...(body.replace ? [] : sessions), ...body.sessions.map((s: Record<string, unknown>, i: number) => sessionOf(100 + i, s))];
        return json(200, { created: body.sessions.length, removed, halls_created: newHalls.length });
      }
      if (rest === '/booths' && method === 'GET') return json(200, booths);
      const booth = rest.match(/^\/booths\/([^/]+)$/);
      if (booth && method === 'PATCH') {
        const body = JSON.parse(raw ?? '{}');
        if (body.slug === 'taken') return json(409, { detail: 'Booth slug already exists' });
        const index = booths.findIndex(b => b.id === booth[1]);
        booths[index] = { ...booths[index], ...body };
        return json(200, booths[index]);
      }
      if (booth && method === 'DELETE') {
        booths.splice(booths.findIndex(b => b.id === booth[1]), 1);
        return route.fulfill({ status: 204 });
      }
    }
    return json(200, []);
  });
  return requests;
}

async function seed(page: Page, options: { desk?: boolean; locale?: string } = {}) {
  await page.goto('/');
  await page.evaluate(({ desk, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-ms03-organizer');
    if (desk) sessionStorage.setItem('congress_desk_token_event-a', 'synthetic-ms03-desk-event-a');
    localStorage.setItem('congress_attendee_locale', locale);
  }, { desk: options.desk ?? false, locale: options.locale ?? 'en' });
}

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Event workspace' });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('events overview lists authorized events with a status derived from their own dates', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer');
  await expect(page.getByRole('link', { name: 'Alpha Congress' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta Summit' })).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Alpha Congress' }).getByText('Upcoming')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Beta Summit' }).getByText('Ended')).toBeVisible();
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('one workspace navigation addresses every section of the selected event by URL', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  await expect(workspaceNav(page).getByRole('link')).toHaveText([/Overview/, /Program/, /Venue/, /Ticket Tiers/, /Check-In Gates/, /Exhibition Booths/, /Desk Staff/, /Public page/, /Attendee panel/, /SMS/, /Participants/, /Analytics/, /Front Desk/]);
  await expect(workspaceNav(page).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');

  const eventReads = () => requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a').length;
  const before = eventReads();
  const sections: [RegExp, RegExp, string][] = [
    [/Ticket Tiers/, /\/tiers$/, 'Alpha Delegate'],
    [/Check-In Gates/, /\/check-in$/, 'Check-in'],
    [/Exhibition Booths/, /\/booths$/, 'booth'],
    [/Desk Staff/, /\/operators$/, 'Operator One'],
  ];
  for (const [label, url, text] of sections) {
    await workspaceNav(page).getByRole('link', { name: label }).click();
    await expect(page).toHaveURL(url);
    await expect(workspaceNav(page).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
  // Moving between sections reuses the loaded event: no refetch.
  expect(eventReads()).toBe(before);

  await page.goto('/organizer/events/event-a/booths');
  await expect(workspaceNav(page).getByRole('link', { name: /Exhibition Booths/ })).toHaveAttribute('aria-current', 'page');
  await workspaceNav(page).getByRole('link', { name: /Analytics/ }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('overview shows real capacity from the tiers and no invented figures', async ({ page }) => {
  await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText('60 / 120', { exact: false }).first()).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Alpha Student' });
  await expect(row.getByText('Closed')).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByText(/revenue|\$/i)).toHaveCount(0);
});

test('an event without tiers says so and points to ticket tiers', async ({ page }) => {
  await fixture(page, { tiersA: [] });
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText(/No ticket tier is defined yet/)).toBeVisible();
});

test('switching events through the list never shows the previous event data', async ({ page }) => {
  await fixture(page, { slowTiersOf: 'event-a' });
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('link', { name: /Events List/ }).click();
  await page.getByRole('link', { name: 'Beta Summit' }).first().click();
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await expect(page.getByText('Alpha Delegate')).toHaveCount(0);
  await expect(page.getByText('Alpha Congress')).toHaveCount(0);
  await workspaceNav(page).getByRole('link', { name: /Ticket Tiers/ }).click();
  await expect(page.getByText('Beta Delegate').first()).toBeVisible();
});

test('editing an event setting persists, announces success and updates the workspace context', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await page.getByRole('button', { name: /Edit Event/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Alpha Congress Renamed');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event settings saved' })).toBeVisible();
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress Renamed');
  const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/events/event-a');
  expect(patch?.auth).toBe(bearer);
  expect(patch?.body).toMatchObject({ name: 'Alpha Congress Renamed' });
});

test.describe('in a non-UTC time zone', () => {
  test.use({ timezoneId: 'Asia/Tehran' });

  test('edit event shows local wall time, names the missing field, and an unchanged save keeps the instants', async ({ page }) => {
    const requests = await fixture(page);
    await seed(page);
    await page.goto('/organizer/events/event-a');
    await page.getByRole('button', { name: /Edit Event/ }).click();
    const dialog = page.getByRole('dialog');
    // 07:00Z is 10:30 in Tehran (UTC+03:30).
    await expect(dialog.getByLabel(/Start Date & Time/)).toHaveValue('2099-05-10T10:30');
    await expect(dialog.getByLabel(/End Date & Time/)).toHaveValue('2099-05-12T18:30');

    const name = dialog.getByRole('textbox').first();
    await name.fill('');
    await dialog.getByRole('button', { name: /Save/ }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter the event name.');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(requests.some(r => r.method === 'PATCH')).toBe(false);

    await name.fill('Alpha Congress');
    await dialog.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Event settings saved' })).toBeVisible();
    const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/events/event-a');
    expect(patch?.body).toMatchObject({ starts_at: '2099-05-10T07:00:00.000Z', ends_at: '2099-05-12T15:00:00.000Z' });
  });
});

test('closing a ticket tier needs confirmation; cancelling sends nothing', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('button', { name: /Edit Tier/ }).first().click();
  const edit = page.getByRole('dialog').filter({ has: page.getByRole('combobox') });
  await edit.getByRole('combobox').selectOption('closed');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  const confirm = page.getByRole('dialog', { name: 'Close this ticket tier?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(requests.some(r => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'))).toBe(false);

  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByRole('dialog', { name: 'Close this ticket tier?' }).getByRole('button', { name: 'Close tier' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  const patch = requests.find(r => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'));
  expect(patch?.auth).toBe(bearer);
  expect(patch?.body).toMatchObject({ is_open: false });
});

for (const failing of [false, true]) {
  test(`revoking an operator asks first and ${failing ? 'reports a failure instead of staying silent' : 'confirms the result'}`, async ({ page }) => {
    const requests = await fixture(page, failing ? { revokeStatus: 500 } : {});
    await seed(page);
    await page.goto('/organizer/events/event-a/operators');
    await page.getByRole('button', { name: 'Revoke Access' }).click();
    const confirm = page.getByRole('dialog', { name: 'Revoke operator access?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(requests.some(r => r.path.endsWith('/revoke'))).toBe(false);

    await page.getByRole('button', { name: 'Revoke Access' }).click();
    await page.getByRole('dialog', { name: 'Revoke operator access?' }).getByRole('button', { name: 'Revoke Access' }).click();
    if (failing) await expect(page.getByRole('alert').filter({ hasText: 'Could not revoke access' })).toBeVisible();
    else await expect(page.getByRole('status').filter({ hasText: 'Access revoked for Operator One' })).toBeVisible();
  });
}

test('pairing a scanner device issues a point token, shows its pairing link once and can revoke devices', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/check-in');
  await page.getByRole('article').filter({ hasText: 'Main Gate' }).getByRole('button', { name: 'Pair device' }).click();
  const dialog = page.getByRole('dialog', { name: 'Pair a scanner device' });
  await expect(dialog.getByText('Old tablet')).toBeVisible();
  await expect(dialog.getByText('1 active')).toBeVisible();

  // A nameless device is refused locally; nothing is issued.
  await dialog.getByRole('textbox', { name: /Device name/ }).fill('   ');
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Give the device a name');
  expect(requests.some(r => r.path.endsWith('/token'))).toBe(false);

  await dialog.getByRole('textbox', { name: /Device name/ }).fill('Gate phone 1');
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByText('Device ready to pair.')).toBeVisible();
  const origin = new URL(page.url()).origin;
  await expect(dialog.getByTestId('pairing-link')).toHaveText(`${origin}/scan/point-a1?token=synthetic.scanner.token`);
  await expect(dialog.getByRole('img', { name: 'Scanner pairing link QR code' })).toBeVisible();
  await expect(dialog.getByText('2 active')).toBeVisible();
  const issue = requests.find(r => r.method === 'POST' && r.path === '/api/checkin-points/point-a1/token');
  expect(issue?.auth).toBe(bearer);
  expect(issue?.body).toEqual({ device_name: 'Gate phone 1' });
  // Opened on 127.0.0.1: the console warns that the link cannot work on a phone.
  await expect(dialog.getByRole('note')).toContainText('localhost');

  // Revoking the device whose link is on screen asks first, then withdraws the link.
  await dialog.getByRole('button', { name: 'Revoke Gate phone 1' }).click();
  const confirm = page.getByRole('dialog', { name: 'Revoke this device?' });
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  expect(requests.some(r => r.path.endsWith('/revoke'))).toBe(false);

  await dialog.getByRole('button', { name: 'Revoke Gate phone 1' }).click();
  await page.getByRole('dialog', { name: 'Revoke this device?' }).getByRole('button', { name: 'Revoke device' }).click();
  await expect(dialog.getByText('1 active')).toBeVisible();
  await expect(dialog.getByTestId('pairing-link')).toHaveCount(0);
  const revoke = requests.find(r => r.path === '/api/checkin-points/point-a1/devices/device-new/revoke');
  expect(revoke?.auth).toBe(bearer);
});

test('SMS: the organizer edits the confirmation with placeholders, sees the preview and SMS count, saves, tests and resets', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  await expect(page.getByRole('heading', { name: 'SMS', level: 1 })).toBeVisible();
  await expect(page.getByTestId('sms-delivery')).toContainText('Test mode');
  await expect(page.getByText('Default text')).toBeVisible();
  await expect(page.getByTestId('sms-preview')).toContainText('نام شرکت‌کننده عزیز، ثبت‌نام شما در «Alpha Congress» تأیید شد.');
  await expect(page.getByTestId('sms-size')).toContainText('2 SMS (Persian/Unicode, 67 per SMS)');
  await expect(page.getByRole('button', { name: 'Save text' })).toBeDisabled();
  await expect(page.getByText('Queued')).toBeVisible();

  const editor = page.getByLabel('Message text');
  await editor.fill('Hello {nmae}');
  await expect(page.getByRole('alert')).toContainText('Unknown placeholder: {nmae}');
  await expect(page.getByRole('button', { name: 'Save text' })).toBeDisabled();
  await editor.fill('Hello ');
  await page.getByRole('button', { name: /Attendee name/ }).click();
  await editor.press('End');
  await editor.pressSequentially(' — ');
  await page.getByRole('button', { name: /Pass link/ }).click();
  await expect(editor).toHaveValue('Hello {name} — {link}');
  await expect(page.getByTestId('sms-preview')).toHaveText('Hello نام شرکت‌کننده — http://test/c/event-a/my-ticket');

  await page.getByLabel('Send a test to').fill('۰۹۳۵ ۱۲۳ ۴۵۶۷');
  await page.getByRole('button', { name: 'Send test SMS' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test mode: the message was only recorded' })).toBeVisible();
  const test = requests.find(r => r.path === '/api/events/event-a/sms/test');
  expect(test?.body).toEqual({ mobile: '09351234567', kind: 'ticket_confirmation', body: 'Hello {name} — {link}' });
  expect(test?.auth).toBe(bearer);
  await expect(page.getByText('0935***4567')).toBeVisible();

  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByText('Custom for this congress')).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path.endsWith('/sms/templates/ticket_confirmation'))?.body).toEqual({ body: 'Hello {name} — {link}' });

  await page.getByRole('button', { name: 'Use the default text' }).click();
  await page.getByRole('dialog', { name: 'Use the default text?' }).getByRole('button', { name: 'Use default' }).click();
  await expect(page.getByText('Default text', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(/عزیز/);
  expect(requests.some(r => r.method === 'DELETE' && r.path.endsWith('/sms/templates/ticket_confirmation'))).toBe(true);
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('program: sessions are grouped by day, added in local time, and a CSV timetable is checked before it is imported', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  await workspaceNav(page).getByRole('link', { name: /Program/ }).click();
  await expect(page).toHaveURL(/\/program$/);
  await expect(workspaceNav(page).getByRole('link', { name: /Program/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('program-session')).toHaveText([/Opening keynote/]);
  await expect(page.getByTestId('program-session')).toContainText('Main hall');

  await page.getByRole('button', { name: 'Add session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add session' });
  await dialog.getByLabel('Title').fill('Imaging workshop');
  await dialog.getByLabel('Starts').fill('2099-05-10T11:00');
  // Moving the start keeps the default one-hour length.
  await expect(dialog.getByLabel('Ends')).toHaveValue('2099-05-10T12:00');
  await dialog.getByLabel('Hall').selectOption({ label: 'Hall 2' });
  await dialog.getByRole('button', { name: 'Add session' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('program-session')).toHaveCount(2);
  const startsAt = await page.evaluate(() => new Date('2099-05-10T11:00').toISOString());
  expect(requests.find(r => r.method === 'POST' && r.path === '/api/events/event-a/sessions')?.body).toMatchObject({ title: 'Imaging workshop', hall_id: 'place-hall2', starts_at: startsAt });

  await page.getByRole('button', { name: 'Upload timetable' }).click();
  const panel = page.getByTestId('timetable-import');
  const csv = '\uFEFFعنوان,شروع,پایان,سالن\r\n"Panel, part 1",2099-05-11 09:00,2099-05-11 10:00,Hall B\r\nBroken,2099-05-11 11:00,2099-05-11 10:00,\r\n';
  await panel.getByLabel('Choose a CSV file').setInputFiles({ name: 'program.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(panel.getByText('1 of 2 rows need fixing')).toBeVisible();
  await expect(panel.getByText('Row 2 (line 3): ends before it starts')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Import 2 sessions' })).toBeDisabled();

  await panel.getByLabel('Choose a CSV file').setInputFiles({ name: 'program.csv', mimeType: 'text/csv', buffer: Buffer.from('title,starts_at,ends_at,hall\n"Panel, part 1",2099-05-11 09:00,2099-05-11 10:00,Hall B\n') });
  await expect(panel.getByText('These halls will be created: Hall B')).toBeVisible();
  await panel.getByLabel(/Replace the existing program/).check();
  await panel.getByRole('button', { name: 'Replace with 1 session' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 session imported; 2 previous sessions removed; 1 new hall created.' })).toBeVisible();
  await expect(page.getByTestId('program-session')).toHaveText([/Panel, part 1/]);
  expect(requests.find(r => r.path === '/api/events/event-a/sessions/import')?.body).toMatchObject({ replace: true, sessions: [{ title: 'Panel, part 1', hall: 'Hall B', track: '' }] });
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('venue and booths: entrances are added, halls reordered, and a booth is edited, then deleted after an explicit warning', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/venue');
  await expect(page.getByTestId('venue-hall')).toHaveText([/Main hall/, /Hall 2/]);
  await page.getByRole('button', { name: 'Add entrance' }).click();
  const add = page.getByRole('dialog', { name: 'Add entrance' });
  await add.getByLabel('Name').fill('North gate');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('venue-entrance')).toHaveText([/North gate/]);
  await page.getByRole('button', { name: 'Move “Hall 2” up' }).click();
  await expect(page.getByTestId('venue-hall')).toHaveText([/Hall 2/, /Main hall/]);
  expect(requests.filter(r => r.method === 'PATCH' && r.path.includes('/venue-places/'))).toHaveLength(2);
  await page.getByRole('button', { name: 'Delete Main hall' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this hall?' })).toContainText('Its 1 session stays in the program without a hall.');
  await page.getByRole('dialog', { name: 'Delete this hall?' }).getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/organizer/events/event-a/booths');
  await page.getByRole('button', { name: 'Edit booth Acme Biotech' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit booth' });
  await edit.getByLabel('Booth Slug').fill('taken');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit.getByRole('alert')).toContainText('Another booth already uses this slug');
  await edit.getByLabel('Booth Slug').fill('acme-imaging');
  await edit.getByLabel('Company / Booth Name').fill('Acme Imaging');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Acme Imaging' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete booth Acme Imaging' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this booth?' });
  await expect(confirm).toContainText("staff assignments, attendees' saved bookmarks and all captured leads");
  await confirm.getByRole('button', { name: 'Delete booth' }).click();
  await expect(page.getByText('No exhibition booths registered yet')).toBeVisible();
  expect(requests.some(r => r.method === 'DELETE' && r.path === '/api/events/event-a/booths/booth-a1')).toBe(true);
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('analytics keeps its export and says the CSV is not filtered', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  await expect(page.getByText('Filters change this view only')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Attendance CSV' }).click();
  expect((await download).suggestedFilename()).toBe('event-a-attendance.csv');
  expect(requests.find(r => r.path.endsWith('/export-csv'))?.auth).toBe(bearer);
});

test('reception shows which authority is acting when both credentials exist', async ({ page }) => {
  await fixture(page);
  await seed(page, { desk: true });
  await page.goto('/organizer/events/event-a/desk');
  await expect(page.getByTestId('desk-active-mode')).toHaveText('Acting as: reception operator');
  await page.getByRole('button', { name: 'Organizer', exact: true }).click();
  await expect(page.getByTestId('desk-active-mode')).toHaveText('Acting as: organizer');
  await expect(workspaceNav(page).getByRole('link', { name: /Front Desk/ })).toHaveAttribute('aria-current', 'page');
});

test('mobile and tablet layouts have no horizontal overflow; the workspace nav scrolls inside itself', async ({ page }) => {
  await fixture(page);
  await seed(page);
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/tiers', '/organizer/events/event-a/analytics']) {
      await page.goto(path);
      await expect(page.getByTestId('active-event').or(page.getByRole('heading', { name: 'Events List' }).or(page.getByRole('heading').first())).first()).toBeVisible();
      expect(await overflow(page), `${width}px ${path}`).toBe(0);
    }
  }
});

test('Persian RTL at 320px: workspace is right-to-left and fits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  await seed(page, { locale: 'fa' });
  for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/analytics']) {
    await page.goto(path);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    expect(await overflow(page), path).toBe(0);
  }
  await page.goto('/organizer/events/event-a');
  await expect(page.getByRole('navigation', { name: 'فضای کاری همایش' }).getByRole('link', { name: 'نمای کلی' })).toBeVisible();
});
