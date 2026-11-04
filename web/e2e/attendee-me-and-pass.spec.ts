import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// `/me` and the pass page against intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
// The misspelling the glossary forbids, built from code points (tests/glossary.test.ts keeps it out of src).
const FORBIDDEN = String.fromCodePoint(0x628, 0x644, 0x6cc, 0x637);

interface Congress { id: string; slug: string; name: string; starts_at: string; ends_at: string }
const CONGRESSES: Record<string, Congress> = {
  live: { id: 'event-live', slug: 'live', name: 'Live Congress', starts_at: at(-1), ends_at: at(1) },
  alpha: { id: 'event-alpha', slug: 'alpha', name: 'Alpha Congress', starts_at: at(30), ends_at: at(32) },
  beta: { id: 'event-beta', slug: 'beta', name: 'Beta Summit', starts_at: at(10), ends_at: at(11) },
  old: { id: 'event-old', slug: 'old', name: 'Old Congress', starts_at: at(-60), ends_at: at(-58) },
  gone: { id: 'event-gone', slug: 'gone', name: 'Gone Congress', starts_at: at(40), ends_at: at(41) },
};
const publicEvent = (c: Congress) => ({ id: c.id, name: c.name, slug: c.slug, starts_at: c.starts_at, ends_at: c.ends_at, location: 'Fixture Hall', description: `About ${c.name}`, ticket_tiers: [], venue: [], sessions: [] });
const ticketOf = (slug: string, id: string, extra: Record<string, unknown> = {}) => {
  const c = CONGRESSES[slug];
  return { id, event_id: c.id, event_name: c.name, event_slug: slug, event_location: 'Fixture Hall', event_starts_at: c.starts_at, event_ends_at: c.ends_at, ticket_tier_id: 't', ticket_tier_name: 'Delegate', attendee_name: 'Sara Fixture', attendee_mobile: '09121234567', status: 'active', qr_secret: `qr-${id}`, created_at: '2026-09-01T08:00:00Z', ...extra };
};

type Recorded = { method: string; path: string; query: string };
interface Options {
  tickets?: unknown[];
  ticketStatuses?: number[];
  cancel?: { status: number; body: unknown };
  publicDown?: boolean;
}

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const statuses = [...(options.ticketStatuses ?? [])];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({ method: request.method(), path, query: url.search });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const pub = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pub) {
      if (options.publicDown) return route.abort('internetdisconnected');
      return CONGRESSES[pub[1]] ? json(200, publicEvent(CONGRESSES[pub[1]])) : json(404, { detail: 'Event not found' });
    }
    if (/^\/api\/public\/events\/[^/]+\/booths$/.test(path)) return json(200, []);
    if (path === '/api/attendees/me/tickets') {
      const status = statuses.shift() ?? 200;
      if (status !== 200) return json(status, { detail: 'Server error' });
      const tickets = (options.tickets ?? []) as { status: string }[];
      return json(200, url.searchParams.get('include_cancelled') === 'true' ? tickets : tickets.filter(t => t.status !== 'cancelled'));
    }
    if (path.endsWith('/cancel') && options.cancel) return json(options.cancel.status, options.cancel.body);
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/attendees/me/network/privacy') return json(200, { share_contact_with_peers: false });
    if (path === '/api/auth/me') return json(200, { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false });
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function begin(page: Page, { locale = 'en', signedIn = true }: { locale?: 'en' | 'fa'; signedIn?: boolean } = {}) {
  // A same-origin static file, not the app: the home page would load its public congress list (an API request) mid-seed.
  await page.goto('/favicon.png');
  await page.evaluate(({ token, locale, signedIn }) => {
    localStorage.clear();
    localStorage.setItem('congress_attendee_locale', locale);
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
  }, { token, locale, signedIn });
}

test('/me groups the congresses into live, upcoming and past, one card each, cancelled ones hidden', async ({ page }) => {
  await fixture(page, {
    tickets: [
      ticketOf('alpha', 'a1'), ticketOf('alpha', 'a2', { ticket_tier_name: 'Workshop' }), ticketOf('beta', 'b1'),
      ticketOf('live', 'l1'), ticketOf('old', 'o1'), ticketOf('gone', 'g1', { status: 'cancelled' }),
    ],
  });
  await begin(page);
  await page.goto('/me');
  await expect(page.getByRole('heading', { level: 1, name: 'My congresses' })).toBeVisible();
  await expect(page.locator('main h2')).toHaveText(['Happening now', 'Upcoming', 'Past']);
  const section = (name: string) => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(section('Happening now').getByTestId('congress-card')).toHaveText([/Live Congress/]);
  await expect(section('Upcoming').getByTestId('congress-card')).toHaveText([/Beta Summit/, /Alpha Congress/]);
  await expect(section('Past').getByTestId('congress-card')).toHaveText([/Old Congress/]);
  await expect(page.getByText('Gone Congress')).toHaveCount(0);
  const alpha = page.getByTestId('congress-card').filter({ hasText: 'Alpha Congress' });
  await expect(alpha).toContainText('2 passes');
  await expect(alpha).toHaveAttribute('href', '/c/alpha/my-congress');
});

test('/my-tickets and /my-network redirect to /me', async ({ page }) => {
  await fixture(page, { tickets: [ticketOf('alpha', 'a1')] });
  await begin(page);
  for (const old of ['/my-tickets', '/my-network']) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId('congress-card')).toHaveText([/Alpha Congress/]);
  }
});

test('signed out, /me lists the pass opened from an SMS link and offers sign-in', async ({ page }) => {
  const requests = await fixture(page);
  await begin(page, { signedIn: false });
  const c = CONGRESSES.alpha;
  await page.evaluate(pass => localStorage.setItem(`congress_link_pass_${pass.ticket_id}`, JSON.stringify({ savedAt: Date.now(), pass })), {
    ticket_id: 'ticket-link-1', status: 'active', issued_at: '2026-09-01T08:00:00Z', qr_secret: 'qr-link', tier_name: 'Delegate pass', expires_at: at(60),
    event: { id: c.id, slug: c.slug, name: c.name, starts_at: c.starts_at, ends_at: c.ends_at, location: 'Fixture Hall' },
    attendee: { full_name: 'Sara Fixture', organization: null, title: null },
  });
  requests.length = 0;
  await page.goto('/me');
  const card = page.getByTestId('congress-card');
  await expect(card).toHaveText([/Alpha Congress/]);
  await expect(card).toContainText('From your SMS link');
  await expect(card).toHaveAttribute('href', '/c/alpha/my-ticket');
  await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  expect(requests).toEqual([]);
  await card.click();
  await expect(page.getByRole('link', { name: /Sign in for networking/ })).toBeVisible();
  await expect(page.getByText('Delegate pass')).toBeVisible();
});

test('pass page: a failed load is an error with retry, never "no pass", and Persian shows no raw English', async ({ page }) => {
  const requests = await fixture(page, { tickets: [ticketOf('alpha', 'a1', { ticket_tier_name: 'Delegate' })], ticketStatuses: [500] });
  await begin(page, { locale: 'fa' });
  await page.goto('/c/alpha/my-ticket');
  const error = page.getByTestId('pass-load-error');
  await expect(error).toContainText('کارت ورود بارگذاری نشد');
  await expect(error).not.toContainText('Server error');
  await expect(page.getByTestId('pass-empty')).toHaveCount(0);
  expect(requests.find(r => r.path === '/api/attendees/me/tickets')?.query).toContain('include_cancelled=true');
  await error.getByRole('button', { name: 'تلاش دوباره' }).click();
  await expect(page.getByTestId('pass-status')).toHaveText('معتبر');
  await expect(page.getByText('Sara Fixture').first()).toBeVisible();
});

test('pass page: no pass for this congress offers to reserve one', async ({ page }) => {
  await fixture(page, { tickets: [ticketOf('beta', 'b1')] });
  await begin(page, { locale: 'fa' });
  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByTestId('pass-empty')).toContainText('برای این همایش کارت ورود ندارید');
  await expect(page.getByRole('link', { name: 'رزرو کارت ورود' })).toHaveAttribute('href', '/e/alpha');
  await expect(page.getByTestId('pass-load-error')).toHaveCount(0);
});

test('pass page: a cancelled pass is explained and shows no QR', async ({ page }) => {
  await fixture(page, { tickets: [ticketOf('alpha', 'a1', { status: 'cancelled', qr_secret: '' })] });
  await begin(page);
  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByTestId('pass-cancelled')).toContainText('This pass has been cancelled');
  await expect(page.getByTestId('pass-status')).toHaveText('Cancelled');
  await expect(page.getByTestId('pass-qr-cancelled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show the QR code full screen' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reserve a pass' })).toHaveAttribute('href', '/e/alpha');
});

test('pass page: QR first, holder and tier under it; tapping opens a full-screen QR that tap and Back close', async ({ page }) => {
  await fixture(page, { tickets: [ticketOf('alpha', 'a1', { ticket_tier_name: 'Delegate' })] });
  await begin(page);
  await page.goto('/c/alpha/my-ticket');
  const qr = page.getByRole('button', { name: 'Show the QR code full screen' });
  await expect(qr).toBeVisible();
  // Reading order: QR, then holder, then tier, then the congress name.
  const order = await page.locator('article').evaluate(card => {
    const text = card.textContent ?? '';
    return ['Sara Fixture', 'Delegate', 'Alpha Congress'].map(s => text.indexOf(s));
  });
  expect(order[0]).toBeGreaterThanOrEqual(0);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // Online and up to date says nothing: no status line.
  await expect(page.getByTestId('pass-status-line')).toHaveCount(0);

  await qr.click();
  const full = page.getByTestId('qr-fullscreen');
  await expect(full).toBeVisible();
  await expect(full.locator('svg')).toBeVisible();
  await full.click();
  await expect(full).toHaveCount(0);
  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);

  await qr.click();
  await expect(full).toBeVisible();
  await page.goBack();
  await expect(full).toHaveCount(0);
  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  await expect(qr).toBeVisible();
});

test('pass page: several passes for one congress get a switcher with tier and date labels', async ({ page }) => {
  await fixture(page, {
    tickets: [
      ticketOf('alpha', 'a1', { ticket_tier_name: 'Delegate', created_at: '2026-09-01T08:00:00Z' }),
      ticketOf('alpha', 'a2', { ticket_tier_name: 'Workshop', created_at: '2026-09-02T08:00:00Z' }),
    ],
  });
  await begin(page);
  await page.goto('/c/alpha/my-ticket');
  const switcher = page.getByRole('group', { name: 'Your passes' });
  await expect(switcher.getByRole('button')).toHaveText([/Workshop · .*2026/, /Delegate · .*2026/]);
  await switcher.getByRole('button', { name: /Delegate/ }).click();
  await expect(switcher.getByRole('button', { name: /Delegate/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article')).toContainText('Delegate');
});

test('pass page: self-cancel asks first, then shows the cancelled pass', async ({ page }) => {
  const requests = await fixture(page, {
    tickets: [ticketOf('alpha', 'a1')],
    cancel: { status: 200, body: ticketOf('alpha', 'a1', { status: 'cancelled', qr_secret: '' }) },
  });
  await begin(page);
  await page.goto('/c/alpha/my-ticket');
  await page.getByRole('button', { name: 'Cancel registration' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('your place is released');
  await dialog.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(requests.filter(r => r.method === 'POST')).toEqual([]);
  await page.getByRole('button', { name: 'Cancel registration' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel registration' }).click();
  await expect(page.getByTestId('pass-notice')).toContainText('Your registration has been cancelled.');
  await expect(page.getByTestId('pass-cancelled')).toBeVisible();
  expect(requests.filter(r => r.method === 'POST').map(r => r.path)).toEqual(['/api/attendees/me/tickets/a1/cancel']);
  // The offline copy no longer holds the cancelled pass.
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem('congress_cached_tickets_user-1') ?? '{}').tickets);
  expect(cached).toEqual([]);
});

test('pass page: a refused self-cancel shows the coded reason in Persian', async ({ page }) => {
  await fixture(page, {
    tickets: [ticketOf('alpha', 'a1')],
    cancel: { status: 409, body: { detail: 'The congress has started; ask the organizer to cancel the registration.', code: 'EVENT_STARTED' } },
  });
  await begin(page, { locale: 'fa' });
  await page.goto('/c/alpha/my-ticket');
  await page.getByRole('button', { name: 'لغو ثبت‌نام' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'لغو ثبت‌نام' }).click();
  await expect(page.getByTestId('pass-notice')).toContainText('همایش آغاز شده است');
  await expect(page.getByTestId('pass-status')).toHaveText('معتبر');
});

test('pass page offline: the header names the congress from the saved pass instead of a skeleton', async ({ page }) => {
  await fixture(page, { publicDown: true, ticketStatuses: [500] });
  await begin(page);
  await page.evaluate(ticket => {
    localStorage.setItem('congress_cached_tickets_user-1', JSON.stringify({ userId: 'user-1', cachedAt: Date.now(), expiresAt: Date.now() + 86_400_000, tickets: [ticket] }));
  }, ticketOf('alpha', 'a1'));
  await page.goto('/c/alpha/my-ticket');
  await expect(page.locator('header').getByText('Alpha Congress')).toBeVisible();
  await expect(page.locator('header .skeleton')).toHaveCount(0);
  await expect(page.getByTestId('pass-status-line')).toContainText('Offline: showing your saved pass');
});

test('attendee pages in Persian never render the misspelled word for ticket', async ({ page }) => {
  await fixture(page, { tickets: [ticketOf('alpha', 'a1'), ticketOf('beta', 'b1')] });
  await begin(page, { locale: 'fa' });
  for (const path of ['/me', '/c/alpha/my-congress', '/c/alpha/details', '/c/alpha/my-network', '/c/alpha/my-ticket', '/c/alpha/my-profile', '/c/gone/my-ticket']) {
    await page.goto(path);
    await expect(page.locator('main')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.body.innerText), path).not.toContain(FORBIDDEN);
  }
  await begin(page, { locale: 'fa', signedIn: false });
  await page.goto('/me');
  await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(FORBIDDEN);
});
