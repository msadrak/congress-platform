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
    if (rest === 'desk/tiers') return json(200, [{ id: 'tier-1', name: 'VIP', description: '', quota: 100, reserved_count: 1, is_open: true }]);
    if (rest === 'desk/checkin-points') {
      return json(200, [
        { id: 'point-lunch', event_id: EVENT, name: 'Lunch', location: '', policy_type: 'SINGLE_USE', allowed_tier_ids: [], max_capacity: null, created_at: '2099-01-01T00:00:00Z' },
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
      const verdict = { scan_id: body.scan_id, status: again ? 'REJECTED' : 'ADMITTED', rejection_reason: again ? 'ALREADY_ADMITTED' : null, checkin_point_id: body.checkin_point_id, checkin_point_name: 'Lunch', attendee_name: card.attendee_name, ticket_tier_name: 'VIP' };
      card.scan_history.unshift({ checkin_point_name: 'Lunch', status: verdict.status, rejection_reason: verdict.rejection_reason, scanned_at: '2099-01-01T10:00:00Z', recorded_by: 'Sara' });
      return json(200, verdict);
    }
    return json(404, { detail: 'Not found' });
  });
  return { requests, card };
}

async function openDesk(page: Page) {
  await page.goto('/');
  await page.evaluate(({ event, token }) => {
    localStorage.setItem('congress_attendee_locale', 'en');
    sessionStorage.setItem(`congress_desk_token_${event}`, token);
  }, { event: EVENT, token: TOKEN });
  await page.addInitScript(() => { (window as unknown as { __prints: number }).__prints = 0; window.print = () => { (window as unknown as { __prints: number }).__prints += 1; }; });
  await page.goto(`/reception/${EVENT}`);
  await expect(page.getByTestId('reception-operator')).toContainText('Sara');
}

const search = (page: Page) => page.getByRole('searchbox');
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: number }).__prints);

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

test('the desk admits at a point with the gate rules and shows a single-use refusal', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await search(page).fill(SECRET);
  await search(page).press('Enter');
  const panel = page.getByTestId('desk-admit');
  await expect(panel.getByLabel('Admit at')).toHaveValue('point-lunch');
  await panel.getByRole('button', { name: 'Admit' }).click();
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Admitted at Lunch.');
  await expect(page.getByText('At the desk: Sara').first()).toBeVisible();

  await page.getByTestId('desk-admit').getByRole('button', { name: 'Admit' }).click();
  await expect(page.getByTestId('desk-admit-verdict')).toContainText('Already admitted at this point (single use).');
  const admits = fx.requests.filter(r => r.path.endsWith('/admit'));
  expect(admits).toHaveLength(2);
  expect(admits[0].body).toMatchObject({ checkin_point_id: 'point-lunch' });
});

test('the printed badge shows name, title, organization, tier and QR, and printing is recorded', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await search(page).fill(SECRET);
  await search(page).press('Enter');
  await expect(page.getByTestId('badge-print-state')).toContainText('not been printed yet');

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

  await page.getByRole('button', { name: 'Print Badge Pass' }).click();
  await expect.poll(() => prints(page)).toBe(1);
  expect(fx.requests.filter(r => r.path.endsWith('/prints'))).toHaveLength(1);
  await expect(page.getByTestId('badge-print-state')).toContainText('Printed 1 time');
  await expect(page.getByRole('button', { name: 'Reprint Badge' })).toBeVisible();
});

test('editing the registration after printing flags the badge for reprinting', async ({ page }) => {
  const fx = await deskFixture(page);
  await openDesk(page);
  await search(page).fill(SECRET);
  await search(page).press('Enter');
  await page.getByRole('button', { name: 'Print Badge Pass' }).click();
  await expect(page.getByTestId('badge-print-state')).toContainText('Printed 1 time');

  await page.getByRole('button', { name: 'Edit details' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit registration details' });
  await dialog.getByLabel('Title').fill('Professor');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('badge-print-state')).toContainText('Needs reprint');
  expect(fx.requests.find(r => r.method === 'PATCH')?.body).toEqual({ attendee_full_name: 'Neda Amini', attendee_organization: 'Heart Center', attendee_title: 'Professor' });
  await expect(page.getByTestId('badge-print')).toContainText('Professor · Heart Center');

  await page.getByRole('button', { name: 'Reprint Badge' }).click();
  await expect(page.getByTestId('badge-print-state')).toContainText('Printed 2 times');
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
