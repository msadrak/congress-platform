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
    if (rest === '/analytics/attendance') return json(200, { event_id: id, timezone: 'Asia/Tehran', days: ['2099-05-10', '2099-05-11', '2099-05-12'], total_tickets: 60, tickets_by_status: [{ status: 'active', count: 60 }], tier_registrations: [], unique_admitted: 30, checkin_rate: 50, total_scans: 44, total_admitted: 40, total_rejected: 4, hourly_scans: [], catering_metrics: [], gate_breakdown: [] });
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
  // A same-origin static file, not the app: the home page would load its public congress list (an API request) mid-seed.
  await page.goto('/favicon.png');
  await page.evaluate(({ desk, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-ms03-organizer');
    if (desk) sessionStorage.setItem('congress_desk_token_event-a', 'synthetic-ms03-desk-event-a');
    localStorage.setItem('congress_attendee_locale', locale);
  }, { desk: options.desk ?? false, locale: options.locale ?? 'en' });
}

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Congress sections' });
const NAV = [/Overview/, /Participants/, /Check-in points/, /Reception desk/, /Statistics/, /Program/, /Pass types/, /Booths/, /Public page/, /SMS/];

/** Reads or fills a DateTimeField (day, month, year, time) as a `datetime-local` value, in English. */
async function dateTimeValue(group: ReturnType<Page['getByRole']>): Promise<string> {
  const pad = (v: string) => v.padStart(2, '0');
  const [day, month, year, time] = await Promise.all([group.getByLabel('Day').inputValue(), group.getByLabel('Month').inputValue(), group.getByLabel('Year').inputValue(), group.getByLabel('Time').inputValue()]);
  return `${year}-${pad(month)}-${pad(day)}T${time}`;
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('events overview lists authorized events with a status derived from their own dates', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer');
  await expect(page.getByRole('link', { name: 'Alpha Congress', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta Summit', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Congresses · Organizer console');
  await expect(page.getByRole('article').filter({ hasText: 'Alpha Congress' }).getByText('Upcoming')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'Beta Summit' }).getByText('Ended')).toBeVisible();
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('one workspace navigation addresses every section of the selected event by URL', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  // Overview, then the congress-day group, then setup: no numbers anywhere in the navigation.
  await expect(workspaceNav(page).getByRole('link')).toHaveText(NAV);
  await expect(workspaceNav(page).getByRole('group', { name: 'Congress day' })).toBeVisible();
  await expect(workspaceNav(page).getByRole('group', { name: 'Setup' })).toBeVisible();
  const numbered = await workspaceNav(page).evaluate((nav) => Array.from(nav.querySelectorAll('*')).filter((el) => /^\d{2}$/.test((el.textContent ?? '').trim())).length);
  expect(numbered).toBe(0);
  await expect(workspaceNav(page).getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');

  const eventReads = () => requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a').length;
  const before = eventReads();
  const sections: [RegExp, RegExp, string][] = [
    [/Pass types/, /\/tiers$/, 'Alpha Delegate'],
    [/Check-in points/, /\/check-in$/, 'Check-in'],
    [/Booths/, /\/booths$/, 'booth'],
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
  await expect(workspaceNav(page).getByRole('link', { name: /Booths/ })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Booths · Alpha Congress');
  // Desk operators have no item of their own: the reception desk item stands for them.
  await page.goto('/organizer/events/event-a/operators');
  await expect(page.getByText('Operator One')).toBeVisible();
  await expect(workspaceNav(page).getByRole('link', { name: /Reception desk/ })).toHaveAttribute('aria-current', 'page');
  await workspaceNav(page).getByRole('link', { name: /Statistics/ }).click();
  await expect(page).toHaveURL(/\/analytics$/);
  await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('overview shows real capacity from the tiers and no invented figures', async ({ page }) => {
  await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText('60 of 120 reserved')).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Alpha Student' });
  await expect(row.getByText('Closed')).toBeVisible();
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.getByText(/revenue|\$/i)).toHaveCount(0);
});

test('an event without pass types says so', async ({ page }) => {
  await fixture(page, { tiersA: [] });
  await seed(page);
  await page.goto('/organizer/events/event-a');
  await expect(page.getByText('No pass types yet; registration needs one.')).toBeVisible();
  await expect(page.getByTestId('setup-checklist').getByRole('listitem').filter({ hasText: 'Pass types' }).getByRole('link', { name: 'Add' })).toBeVisible();
});

test('switching events through the list never shows the previous event data', async ({ page }) => {
  await fixture(page, { slowTiersOf: 'event-a' });
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('link', { name: 'Congresses' }).first().click();
  await page.getByRole('link', { name: 'Beta Summit', exact: true }).click();
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('active-event')).toHaveText('Beta Summit');
  await expect(page.getByText('Alpha Delegate')).toHaveCount(0);
  await expect(page.getByText('Alpha Congress')).toHaveCount(0);
  await workspaceNav(page).getByRole('link', { name: /Pass types/ }).click();
  await expect(page.getByText('Beta Delegate').first()).toBeVisible();
});

test('editing an event setting persists, announces success and updates the workspace context', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a');
  // The settings card holds the overview's one edit control.
  await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(1);
  await page.getByTestId('event-settings').getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('Alpha Congress Renamed');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Congress settings saved' })).toBeVisible();
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
    await page.getByTestId('event-settings').getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    // 07:00Z is 10:30 in Tehran (UTC+03:30).
    expect(await dateTimeValue(dialog.getByRole('group', { name: 'Starts' }))).toBe('2099-05-10T10:30');
    expect(await dateTimeValue(dialog.getByRole('group', { name: 'Ends' }))).toBe('2099-05-12T18:30');

    const name = dialog.getByRole('textbox', { name: 'Congress name' });
    await name.fill('');
    await dialog.getByRole('button', { name: /Save/ }).click();
    // The error sits under the field, is linked to it, and the field gets focus.
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toBeFocused();
    await expect(page.locator(`#${await name.getAttribute('aria-describedby')}`)).toHaveText('Enter the congress name.');
    expect(requests.some(r => r.method === 'PATCH')).toBe(false);

    await name.fill('Alpha Congress');
    await dialog.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Congress settings saved' })).toBeVisible();
    const patch = requests.find(r => r.method === 'PATCH' && r.path === '/api/events/event-a');
    expect(patch?.body).toMatchObject({ starts_at: '2099-05-10T07:00:00.000Z', ends_at: '2099-05-12T15:00:00.000Z' });
  });
});

test('closing a ticket tier needs confirmation; cancelling sends nothing', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/tiers');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const edit = page.getByRole('dialog', { name: 'Edit pass type' });
  await edit.getByLabel('Registration').selectOption('closed');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Close registration for this pass type?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(requests.some(r => r.method === 'PATCH' && r.path.includes('/ticket-tiers/'))).toBe(false);

  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: 'Close registration for this pass type?' }).getByRole('button', { name: 'Close registration' }).click();
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
    const revoke = async () => {
      await page.getByRole('button', { name: 'More actions for Operator One' }).click();
      await page.getByRole('menuitem', { name: 'Remove access' }).click();
    };
    await revoke();
    const confirm = page.getByRole('dialog', { name: 'Remove access for “Operator One”?' });
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(requests.some(r => r.path.endsWith('/revoke'))).toBe(false);

    await revoke();
    await page.getByRole('dialog', { name: 'Remove access for “Operator One”?' }).getByRole('button', { name: 'Remove access' }).click();
    if (failing) await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
    else await expect(page.getByRole('status').filter({ hasText: 'Operator One can no longer use the desk.' })).toBeVisible();
  });
}

test('pairing a scanner device issues a point token, shows its pairing link once and can revoke devices', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/check-in');
  await page.getByRole('article').filter({ hasText: 'Main Gate' }).getByRole('button', { name: 'Devices' }).click();
  const dialog = page.getByRole('dialog', { name: 'Devices at “Main Gate”' });
  await expect(dialog.getByText('Old tablet')).toBeVisible();
  await expect(dialog.getByTestId('device-row')).toHaveCount(1);

  // A nameless device is refused locally; nothing is issued.
  await dialog.getByRole('textbox', { name: /Device name/ }).fill('   ');
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByText('Give the device a name.')).toBeVisible();
  expect(requests.some(r => r.path.endsWith('/token'))).toBe(false);

  await dialog.getByRole('textbox', { name: /Device name/ }).fill('Gate phone 1');
  await dialog.getByRole('button', { name: 'Create pairing link' }).click();
  await expect(dialog.getByText('The pairing link is ready.')).toBeVisible();
  const origin = new URL(page.url()).origin;
  await expect(dialog.getByTestId('pairing-link')).toHaveText(`${origin}/scan/point-a1?token=synthetic.scanner.token`);
  await expect(dialog.getByRole('img', { name: 'Pairing link QR code' })).toBeVisible();
  await expect(dialog.getByTestId('device-row')).toHaveCount(2);
  const issue = requests.find(r => r.method === 'POST' && r.path === '/api/checkin-points/point-a1/token');
  expect(issue?.auth).toBe(bearer);
  expect(issue?.body).toEqual({ device_name: 'Gate phone 1' });

  // Removing the access of the device whose link is on screen asks first, then withdraws the link.
  const removeAccess = async () => {
    await dialog.getByRole('button', { name: 'More actions for Gate phone 1' }).click();
    await page.getByRole('menuitem', { name: 'Remove access' }).click();
  };
  await removeAccess();
  const confirm = page.getByRole('dialog', { name: 'Remove access for “Gate phone 1”?' });
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  expect(requests.some(r => r.path.endsWith('/revoke'))).toBe(false);

  await removeAccess();
  await page.getByRole('dialog', { name: 'Remove access for “Gate phone 1”?' }).getByRole('button', { name: 'Remove access' }).click();
  await expect(dialog.getByTestId('device-row').filter({ hasText: 'Gate phone 1' })).toContainText('Access removed');
  await expect(dialog.getByTestId('pairing-link')).toHaveCount(0);
  const revoke = requests.find(r => r.path === '/api/checkin-points/point-a1/devices/device-new/revoke');
  expect(revoke?.auth).toBe(bearer);
});

// The SMS section's tests live in e2e/organizer-sms.spec.ts (UX-ORG-4).

test('program: sessions are grouped by day, added in the event time zone, and a CSV timetable is checked before it is imported', async ({ page }) => {
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
  const dialog = page.getByRole('dialog', { name: 'New session' });
  await dialog.getByLabel('Title').fill('Imaging workshop');
  await dialog.getByRole('group', { name: 'Starts' }).getByLabel('Time').fill('11:00');
  // Moving the start keeps the default one-hour length.
  await expect(dialog.getByRole('group', { name: 'Ends' }).getByLabel('Time')).toHaveValue('12:00');
  await dialog.getByLabel('Hall').selectOption({ label: 'Hall 2' });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('program-session')).toHaveCount(2);
  // Read on the event's clock (no zone in the fixture: the default Asia/Tehran, UTC+03:30), not the browser's.
  expect(requests.find(r => r.method === 'POST' && r.path === '/api/events/event-a/sessions')?.body).toMatchObject({ title: 'Imaging workshop', hall_id: 'place-hall2', starts_at: '2099-05-10T07:30:00.000Z' });

  await page.getByRole('button', { name: 'Import from Excel' }).click();
  const panel = page.getByRole('dialog', { name: 'Import from Excel' });
  const csv = '\uFEFFعنوان,شروع,پایان,سالن\r\n"Panel, part 1",2099-05-11 09:00,2099-05-11 10:00,Hall B\r\nBroken,2099-05-11 11:00,2099-05-11 10:00,\r\n';
  await panel.getByLabel('Choose a CSV file').setInputFiles({ name: 'program.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(panel.getByText('1 of 2 rows need fixing')).toBeVisible();
  await expect(panel.getByText('Row 2 (line 3): must end after it starts')).toBeVisible();
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

test('the old venue and panel addresses lead to the program and the public page preview', async ({ page }) => {
  await fixture(page);
  await seed(page);
  // The former venue page is the program's halls tab.
  await page.goto('/organizer/events/event-a/venue');
  await expect(page).toHaveURL(/\/organizer\/events\/event-a\/program\?tab=venue$/);
  await expect(workspaceNav(page).getByRole('link', { name: /Program/ })).toHaveAttribute('aria-current', 'page');
  await page.goto('/organizer/events/event-a/panel');
  await expect(page).toHaveURL(/\/organizer\/events\/event-a\/page\?preview=panel$/);
  await expect(workspaceNav(page).getByRole('link', { name: /Public page/ })).toHaveAttribute('aria-current', 'page');
});

test('venue: entrances are added and halls reordered in the program\'s halls tab; delete warns first', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/program?tab=venue');
  await expect(page.getByRole('tab', { name: 'Halls & entrances' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('venue-hall')).toHaveText([/Main hall/, /Hall 2/]);
  await page.getByRole('button', { name: 'Add entrance' }).click();
  const add = page.getByRole('dialog', { name: 'New entrance' });
  await add.getByLabel('Name').fill('North gate');
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('venue-entrance')).toHaveText([/North gate/]);
  await page.getByRole('button', { name: 'Move “Hall 2” up' }).click();
  await expect(page.getByTestId('venue-hall')).toHaveText([/Hall 2/, /Main hall/]);
  expect(requests.filter(r => r.method === 'PATCH' && r.path.includes('/venue-places/'))).toHaveLength(2);
  await page.getByRole('button', { name: 'More actions for “Main hall”' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete “Main hall”?' })).toContainText('Its 1 session stays in the program without a hall.');
  await page.getByRole('dialog', { name: 'Delete “Main hall”?' }).getByRole('button', { name: 'Cancel' }).click();
});

test('booths: a booth is edited, then deleted after an explicit warning', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/booths');
  await page.getByRole('button', { name: 'More actions for Acme Biotech' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit booth' });
  await edit.getByLabel('Page address').fill('taken');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toContainText('Another booth uses this address.');
  await edit.getByLabel('Page address').fill('acme-imaging');
  await edit.getByLabel('Company').fill('Acme Imaging');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Acme Imaging' })).toBeVisible();

  await page.getByRole('button', { name: 'More actions for Acme Imaging' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete “Acme Imaging”?' });
  await expect(confirm).toContainText('deleted permanently, and its QR code stops working');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No booths yet')).toBeVisible();
  expect(requests.some(r => r.method === 'DELETE' && r.path === '/api/events/event-a/booths/booth-a1')).toBe(true);
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('analytics keeps its export behind the one Export menu', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/analytics');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'Entries' }).click();
  expect((await download).suggestedFilename()).toBe('event-a-attendance.csv');
  expect(requests.find(r => r.path.endsWith('/export-csv'))?.auth).toBe(bearer);
});

test('reception shows which authority is acting when both credentials exist', async ({ page }) => {
  await fixture(page);
  await seed(page, { desk: true });
  await page.goto('/organizer/events/event-a/desk');
  const deskMenu = page.locator('#organizer-main-content').getByRole('button', { name: 'Menu' });
  await deskMenu.click();
  await page.getByRole('menuitem', { name: 'Organizer mode' }).click();
  await deskMenu.click();
  await expect(page.getByRole('menuitem', { name: 'Operator mode' })).toBeVisible();
  await expect(workspaceNav(page).getByRole('link', { name: /Reception desk/ })).toHaveAttribute('aria-current', 'page');
});

test('mobile and tablet layouts have no horizontal overflow; the workspace nav scrolls inside itself', async ({ page }) => {
  await fixture(page);
  await seed(page);
  for (const [width, height] of [[390, 844], [768, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const path of ['/organizer', '/organizer/events/event-a', '/organizer/events/event-a/tiers', '/organizer/events/event-a/analytics']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
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
  await expect(page.getByRole('navigation', { name: 'بخش‌های همایش' }).getByRole('link', { name: 'نمای کلی' })).toBeVisible();
});

test.describe('the shell fits every device', () => {
  test('at 1280×800 every section link is visible without scrolling the rail', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fixture(page);
    await seed(page);
    await page.goto('/organizer/events/event-a');
    await expect(workspaceNav(page).getByRole('link')).toHaveText(NAV);
    const rail = page.locator('aside.org-rail');
    expect(await rail.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    for (const link of await workspaceNav(page).getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box && box.y >= 0 && box.y + box.height <= 800).toBe(true);
    }
    // Identity, language and sign-out share one 56 px row with a menu.
    const account = page.getByTestId('console-identity');
    expect(Math.round((await account.boundingBox())?.height ?? 0)).toBe(56);
    await account.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'فارسی' })).toBeVisible();
  });

  test('from 1024 to 1279 px the rail is icons, each link still named', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await fixture(page);
    await seed(page);
    await page.goto('/organizer/events/event-a');
    const link = workspaceNav(page).getByRole('link', { name: 'Statistics' });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.width ?? 0).toBeLessThanOrEqual(64);
    await expect(link).toHaveAttribute('title', 'Statistics');
    await expect(page.getByTestId('organizer-topbar')).toContainText('Alpha Congress');
  });

  for (const [width, height] of [[390, 844], [820, 1180]]) {
    test(`at ${width}×${height} the in-congress header is at most 104 px, congress-day tabs first`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await fixture(page);
      await seed(page);
      await page.goto('/organizer/events/event-a');
      await expect(workspaceNav(page).getByRole('link')).toHaveText(NAV);
      const bar = (await page.getByTestId('organizer-topbar').boundingBox())?.height ?? 0;
      const strip = (await page.locator('aside.org-rail').boundingBox())?.height ?? 0;
      expect(Math.round(bar)).toBe(56);
      expect(bar + strip).toBeLessThanOrEqual(104);
      await expect(page.getByTestId('organizer-topbar')).toContainText('Alpha Congress');
    });
  }

  test('at 390×844 the sign-in shows Send code above the fold, the organizer key behind a link', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
    await page.goto('/organizer');
    const send = page.getByRole('button', { name: 'Send code' });
    await expect(send).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Use organizer key' })).toBeVisible();
    const words = (await page.locator('main').innerText()).split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(30);
  });
});
