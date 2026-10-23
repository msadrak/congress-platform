import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Reception desk completion (badge QR lookup, admit at a point, badge printing, edits, operator restore) on the
// shipping pages with synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E (backend:
// tests/test_desk_completion.py).
const EVENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'synthetic-c2-desk';
const SECRET = 'mzxw6ytboi2dqnrzgezdgnbvgy';

type Recorded = { method: string; path: string; body: unknown };

interface Card {
  ticket_id: string; attendee_id: string; attendee_name: string; attendee_mobile: string | null; organization: string; title: string;
  ticket_tier_id: string; ticket_tier_name: string; qr_secret: string; status: string; created_at: string; issued_by: string | null;
  cancelled_at: string | null; cancelled_reason: string | null; print_count: number; last_printed_at: string | null; needs_reprint: boolean;
  scan_history: { checkin_point_name: string; status: string; rejection_reason: string | null; scanned_at: string; recorded_by: string | null }[];
}

async function deskFixture(page: Page) {
  const requests: Recorded[] = [];
  const card: Card = {
    ticket_id: 'ticket-1', attendee_id: 'att-1', attendee_name: 'Neda Amini', attendee_mobile: '09121230001', organization: 'Heart Center',
    title: 'Cardiologist', ticket_tier_id: 'tier-1', ticket_tier_name: 'VIP', qr_secret: SECRET, status: 'active', created_at: '2099-01-01T00:00:00Z',
    issued_by: null, cancelled_at: null, cancelled_reason: null, print_count: 0, last_printed_at: null, needs_reprint: false, scan_history: [],
  };
  const admitted = new Set<string>();
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ method, path, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    const match = path.match(/^\/api\/events\/([^/]+)\/(.*)$/);
    if (!match || match[1] !== EVENT) return json(404, { detail: 'Not found' });
    const rest = match[2];
    if (request.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { detail: 'Invalid desk token' });
    if (rest === 'desk/me') return json(200, { operator_id: 'op-1', operator_name: 'Sara', event_id: EVENT, event_name: 'Gamma Congress', event_slug: 'gamma', is_organizer_admin: false });
    if (rest === 'desk/tiers') {
      return json(200, [
        { id: 'tier-1', name: 'VIP', description: '', quota: 100, reserved_count: 1, is_open: true },
        { id: 'tier-2', name: 'Student', description: '', quota: 50, reserved_count: 50, is_open: true },
      ]);
    }
    if (rest === 'desk/checkin-points') {
      return json(200, [
        { id: 'point-lunch', event_id: EVENT, name: 'Lunch', location: '', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null, created_at: '2099-01-01T00:00:00Z' },
        { id: 'point-hall', event_id: EVENT, name: 'Hall B', location: '', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null, created_at: '2099-01-01T00:00:00Z' },
      ]);
    }
    const item = { ...card, attendee_id: card.attendee_id, checkin_count: card.scan_history.filter(s => s.status === 'ADMITTED').length };
    if (rest === 'attendees' && method === 'GET') return json(200, []);
    if (rest === 'attendees/qr-lookup') {
      return body.qr === SECRET ? json(200, item) : json(404, { detail: 'No ticket of this congress has this QR code', code: 'ATTENDEE_QR_NOT_FOUND' });
    }
    if (rest === 'attendees/ticket-1' && method === 'GET') return json(200, card);
    if (rest === 'attendees/ticket-1' && method === 'PATCH') {
      if (body.attendee_full_name) card.attendee_name = body.attendee_full_name;
      if (body.attendee_organization !== undefined) card.organization = body.attendee_organization;
      if (body.attendee_title !== undefined) card.title = body.attendee_title;
      card.needs_reprint = card.print_count > 0;
      return json(200, card);
    }
    if (rest === 'attendees/ticket-1/prints') {
      card.print_count += 1;
      card.last_printed_at = '2099-01-01T09:00:00Z';
      card.needs_reprint = false;
      return json(201, { print_id: `print-${card.print_count}`, reason: card.print_count === 1 ? 'first' : 'reprint', printed_at: card.last_printed_at, printed_by: 'Sara', print_count: card.print_count });
    }
    if (rest === 'attendees/ticket-1/admit') {
      const again = admitted.has(body.checkin_point_id);
      admitted.add(body.checkin_point_id);
      const pointName = body.checkin_point_id === 'point-hall' ? 'Hall B' : 'Lunch';
      const verdict = { scan_id: body.scan_id, status: again ? 'REJECTED' : 'ADMITTED', rejection_reason: again ? 'ALREADY_ADMITTED' : null, checkin_point_id: body.checkin_point_id, checkin_point_name: pointName, attendee_name: card.attendee_name, ticket_tier_name: 'VIP' };
      card.scan_history.unshift({ checkin_point_name: pointName, status: verdict.status, rejection_reason: verdict.rejection_reason, scanned_at: '2099-01-01T10:00:00Z', recorded_by: 'Sara' });
      return json(200, verdict);
    }
    return json(404, { detail: 'Not found' });
  });
  return { requests, card };
}

async function openDesk(page: Page, locale: 'en' | 'fa' = 'en') {
  await page.goto('/');
  await page.evaluate(({ event, token, locale }) => {
    localStorage.setItem('congress_attendee_locale', locale);
    sessionStorage.setItem(`congress_desk_token_${event}`, token);
  }, { event: EVENT, token: TOKEN, locale });
  await page.addInitScript(() => { (window as unknown as { __prints: number }).__prints = 0; window.print = () => { (window as unknown as { __prints: number }).__prints += 1; }; });
  await page.goto(`/reception/${EVENT}`);
  await expect(page.getByText('Sara', { exact: true })).toBeVisible();
}

const search = (page: Page) => page.getByRole('searchbox');
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);
const card = (page: Page) => page.getByRole('region', { name: 'Neda Amini' });
const actionBar = (page: Page) => page.getByTestId('desk-action-bar');
/** A barcode gun: the code typed at 4 ms per key, then Enter. */
async function gunScan(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 4 });
  await page.keyboard.press('Enter');
}
async function openCard(page: Page) {
  await search(page).fill(SECRET);
  await search(page).press('Enter');
  await expect(card(page)).toBeVisible();
}

test('a badge scanned into the search box by a barcode gun opens the attendee, even under a Persian layout', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await search(page).focus();
  // A gun sends physical keys fast; the layout turns them into Persian letters in the box.
  for (const ch of SECRET) {
    const code = /[a-z]/.test(ch) ? `Key${ch.toUpperCase()}` : `Digit${ch}`;
    await page.keyboard.down(code);
    await page.keyboard.up(code);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Neda Amini', level: 2 })).toBeVisible();
  const lookup = fx.requests.find(r => r.path.endsWith('/attendees/qr-lookup'));
  expect(lookup?.body).toEqual({ qr: SECRET });
  expect(lookup?.path).not.toContain(SECRET);
  await expect(search(page)).toHaveValue('');

  // An unknown badge says so instead of searching names.
  await search(page).fill('ZZZZZZZZZZZZZZZZZZZZZZZZZZ');
  await search(page).press('Enter');
  await expect(page.getByTestId('badge-lookup-notice')).toContainText('belongs to no ticket of this congress');
});

test('F-D1: a gun scan with the cursor in the desk registration form opens the card and never issues a pass', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await page.getByRole('button', { name: 'Desk registration' }).click();
  const form = page.getByRole('dialog', { name: 'Desk registration' });
  const name = form.getByLabel('Full name');
  await name.fill('Maryam');
  await name.focus();
  await gunScan(page, SECRET);
  await expect(page.getByRole('heading', { name: 'Neda Amini', level: 2 })).toBeVisible();
  expect(fx.requests.filter(r => r.path.endsWith('/desk-registrations'))).toHaveLength(0);
  expect(fx.requests.filter(r => r.path.endsWith('/attendees/qr-lookup')).map(r => r.body)).toEqual([{ qr: SECRET }]);

  // With the focus on the card, a scan is not lost either.
  await page.getByRole('heading', { name: 'Neda Amini', level: 2 }).click();
  await gunScan(page, SECRET);
  await expect.poll(() => fx.requests.filter(r => r.path.endsWith('/attendees/qr-lookup')).length).toBe(2);
  await expect(card(page)).toBeVisible();
  expect(fx.requests.filter(r => r.path.endsWith('/desk-registrations'))).toHaveLength(0);

  // The draft is untouched by the scans' keys.
  await actionBar(page).getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Desk registration' }).click();
  await expect(form.getByLabel('Full name')).toHaveValue('Maryam');
});

test('the desk admits with one button per point, remembers the last point and shows the verdict banner', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  const admit = page.getByTestId('desk-admit');
  await admit.getByRole('button', { name: 'Admit at Lunch' }).click();
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Admitted');
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Lunch');
  await card(page).getByText('Details').click();
  await expect(page.getByText('At the desk: Sara').first()).toBeVisible();

  await admit.getByRole('button', { name: 'Admit at Lunch' }).click();
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Already admitted here (single use).');
  const admits = fx.requests.filter(r => r.path.endsWith('/admit'));
  expect(admits).toHaveLength(2);
  expect(admits[0].body).toMatchObject({ checkin_point_id: 'point-lunch' });

  await admit.getByRole('button', { name: 'Admit at Hall B' }).click();
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Hall B');
  expect(await page.evaluate(event => localStorage.getItem(`congress_desk_point_${event}`), EVENT)).toBe('point-hall');
  // The verdict leaves after 3 s, like the gate's.
  await expect(page.getByTestId('desk-admit-verdict')).toHaveCount(0, { timeout: 5000 });
});

test('the printed badge shows name, title, organization, tier and QR; Print leads until printed, then Admit at the last point', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await page.evaluate(event => localStorage.setItem(`congress_desk_point_${event}`, 'point-hall'), EVENT);
  await openCard(page);
  await expect(page.getByTestId('badge-print-state')).toContainText('Not printed');
  await expect(actionBar(page).getByRole('button', { name: 'Print pass' })).toHaveClass(/bg-action-primary/);

  const badge = page.getByTestId('badge-print');
  await expect(badge).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Neda Amini');
  await expect(badge).toContainText('Cardiologist · Heart Center');
  await expect(badge).toContainText('VIP');
  await expect(badge.locator('svg')).toBeVisible();
  const width = await badge.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(76 * 96 / 25.4 + 1); // at most 76 mm: fits an 80 mm thermal roll
  await page.emulateMedia({ media: 'screen' });

  await actionBar(page).getByRole('button', { name: 'Print pass' }).click();
  await expect.poll(() => prints(page)).toBe(1);
  expect(fx.requests.filter(r => r.path.endsWith('/prints'))).toHaveLength(1);
  await expect(page.getByTestId('badge-print-state')).toHaveCount(0);
  await expect(actionBar(page).getByRole('button', { name: 'Reprint' })).not.toHaveClass(/bg-action-primary/);
  await expect(actionBar(page).getByRole('button', { name: 'Admit at Hall B' })).toHaveClass(/bg-action-primary/);
  await expect(actionBar(page).getByRole('button', { name: 'Admit at Lunch' })).not.toHaveClass(/bg-action-primary/);
});

test('editing the registration after printing flags the badge for reprinting; the actions live in the ⋯ menu', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  await actionBar(page).getByRole('button', { name: 'Print pass' }).click();
  await expect(page.getByTestId('badge-print-state')).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions for Neda Amini' }).click();
  for (const item of ['Resend pass link', 'Edit', 'Transfer', 'Reissue', 'Cancel pass']) await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit details' });
  await dialog.getByLabel('Title').fill('Professor');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('toast')).toContainText('Details saved.');
  await expect(page.getByTestId('badge-print-state')).toContainText('Changed since last print; reprint.');
  expect(fx.requests.find(r => r.method === 'PATCH')?.body).toEqual({ attendee_full_name: 'Neda Amini', attendee_organization: 'Heart Center', attendee_title: 'Professor' });
  await expect(page.getByTestId('badge-print')).toContainText('Professor · Heart Center');

  await actionBar(page).getByRole('button', { name: 'Reprint' }).click();
  await expect.poll(() => prints(page)).toBe(2);
  await expect(page.getByTestId('badge-print-state')).toHaveCount(0);

  // Destructive items ask first; cancelling the question sends nothing.
  await page.getByRole('button', { name: 'More actions for Neda Amini' }).click();
  await page.getByRole('menuitem', { name: 'Cancel pass' }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel this pass?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fx.requests.filter(r => r.path.endsWith('/cancel'))).toHaveLength(0);
});

test('Esc is «Next»: the card closes and the cursor is back in the search', async ({ page }) => {
  await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue('');
});

test('desk registration: pass types show seats left, a full type is disabled, and the button says what it does', async ({ page }) => {
  await deskFixture(page);
  await openDesk(page);
  await page.getByRole('button', { name: 'Desk registration' }).click();
  const form = page.getByRole('dialog', { name: 'Desk registration' });
  const type = form.getByLabel('Pass type');
  await expect(type.locator('option', { hasText: 'VIP · 99 left' })).toHaveJSProperty('disabled', false);
  await expect(type.locator('option', { hasText: 'Student · Full' })).toHaveJSProperty('disabled', true);
  await expect(type).toHaveValue('tier-1');
  await expect(form.getByRole('button', { name: 'Issue pass' })).toBeVisible();
  await expect(page.getByText(/Walk-In/)).toHaveCount(0);
});

test('fa: scan history shows Persian clock times; the station carries no clear-form wording, pass id or section numbers', async ({ page }) => {
  const fx = await deskFixture(page);
  fx.card.scan_history.push({ checkin_point_name: 'Lunch', status: 'ADMITTED', rejection_reason: null, scanned_at: '2099-01-01T06:30:00Z', recorded_by: null });
  await openDesk(page, 'fa');
  await openCard(page);
  await card(page).getByText('جزئیات').click();
  const history = page.getByTestId('scan-history');
  await expect(history.getByRole('listitem').first()).toHaveText(/[۰-۹]{2}:[۰-۹]{2}/);
  for (const locale of ['fa', 'en'] as const) {
    if (locale === 'en') {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'منو' }).click();
      await page.getByRole('menuitem', { name: 'English' }).click();
      await openCard(page);
    }
    const text = await page.locator('body').innerText();
    for (const banned of ['پاکسازی فرم', 'Pass ID', 'Walk-In']) expect(text, `${locale}: ${banned}`).not.toContain(banned);
    // Section numbers «01 02 03» are gone (a mobile number may still contain the digits).
    expect(text, `${locale}: section numbers`).not.toMatch(/(?:^|\s)0[1-3](?:\s|$)/);
  }
});

test('1180×820 kiosk: list 38 % and card 62 %, Print inside the viewport after a search', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  const print = actionBar(page).getByRole('button', { name: 'Print pass' });
  const box = (await print.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(820);
  const pane = (await page.locator('.rx-pane').boundingBox())!;
  expect(Math.round((pane.width / 1180) * 100)).toBeGreaterThanOrEqual(60);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(820);
});

test('390×844 phone: the card opens as a full-screen sheet with Print visible without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  const sheet = (await page.locator('.rx-pane').boundingBox())!;
  expect(sheet).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  const box = (await actionBar(page).getByRole('button', { name: 'Print pass' }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test('an archived congress keeps lookups but has no desk registration, no action bar and an «Archived» pill', async ({ page }) => {
  await deskFixture(page);
  await page.route(/\/desk\/me$/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ operator_id: 'op-1', operator_name: 'Sara', event_id: EVENT, event_name: 'Gamma Congress', event_slug: 'gamma', is_organizer_admin: false, is_archived: true }),
  }));
  await openDesk(page);
  await expect(page.locator('[data-status="archived"]')).toContainText('Archived');
  await openCard(page);
  await expect(page.getByRole('heading', { name: 'Neda Amini', level: 2 })).toBeVisible();
  await expect(actionBar(page)).toHaveCount(0);
  await expect(page.getByTestId('desk-admit')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /More actions/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desk registration' })).toHaveCount(0);
});

test('offline: the pill says so and the action bar is disabled with one line; no install prompt on the desk', async ({ page, context }) => {
  await deskFixture(page);
  await openDesk(page);
  await openCard(page);
  await expect(page.locator('[data-status="online"]')).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator('[data-status="offline"]')).toBeVisible();
  await expect(actionBar(page)).toContainText('No connection');
  await expect(actionBar(page).getByRole('button', { name: 'Print pass' })).toBeDisabled();
  await expect(actionBar(page).getByRole('button', { name: 'Next' })).toBeEnabled();
  await context.setOffline(false);
  await expect(page.getByText(/Add to Home Screen|Install/)).toHaveCount(0);
});

test('the operators page shows the reception address with a QR code and restores a revoked operator', async ({ page }) => {
  const requests: Recorded[] = [];
  const operator = { id: 'op-1', event_id: 'event-a', user_id: 'u1', operator_name: 'Operator One', mobile: '09121110001', is_revoked: true, revoked_at: '2099-01-01T00:00:00Z', created_at: '2099-01-01T00:00:00Z' };
  const event = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '' };
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requests.push({ method: request.method(), path, body: undefined });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path === '/api/events') return json(200, [event]);
    if (path === '/api/events/event-a') return json(200, event);
    if (path === '/api/events/event-a/desk/operators') return json(200, [operator]);
    if (path === '/api/events/event-a/desk/operators/op-1/restore') {
      operator.is_revoked = false;
      operator.revoked_at = null as unknown as string;
      return json(200, operator);
    }
    return json(200, []);
  });
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-c2-organizer');
    localStorage.setItem('congress_attendee_locale', 'en');
  });
  await page.goto('/organizer/events/event-a/operators');

  const link = page.getByTestId('reception-link');
  await expect(link).toContainText(`/reception/event-a`);
  await expect(link.getByRole('img', { name: 'Reception address QR code' })).toBeVisible();
  await expect(link.getByRole('button', { name: 'Copy link' })).toBeVisible();

  await page.getByRole('button', { name: 'Restore access' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Access restored for Operator One' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revoke Access' })).toBeVisible();
  expect(requests.filter(r => r.method === 'POST').map(r => r.path)).toEqual(['/api/events/event-a/desk/operators/op-1/restore']);
});
