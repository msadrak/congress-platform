import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// SMS short link (ADR 0015) against intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const GOOD = 'good234567';
const GONE = 'gone234567';
const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z', location: 'Fixture Hall', description: 'About Alpha Congress', ticket_tiers: [], venue: [], sessions: [] };
const PASS = {
  ticket_id: 'ticket-alpha-0001', status: 'active', issued_at: '2027-01-01T00:00:00Z', qr_secret: 'qr-alpha', tier_name: 'Delegate pass',
  expires_at: '2099-06-11T15:00:00Z',
  event: { id: EVENT.id, slug: EVENT.slug, name: EVENT.name, starts_at: EVENT.starts_at, ends_at: EVENT.ends_at, location: EVENT.location },
  attendee: { full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist' },
};

type Recorded = { method: string; url: string; body: string | null; auth: string | undefined };

async function fixture(page: Page, options: { apiDown?: boolean } = {}) {
  const requests: Recorded[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), body: request.postData(), auth: request.headers().authorization });
    if (options.apiDown) return route.abort('internetdisconnected');
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/passes/resolve') {
      const { code } = JSON.parse(request.postData() ?? '{}') as { code?: string };
      if (code === GOOD) return json(200, PASS);
      if (code === GONE) return json(410, { detail: 'This link has expired.', code: 'LINK_EXPIRED', event_slug: 'alpha' });
      return json(404, { detail: 'This link is not valid.', code: 'LINK_NOT_FOUND', event_slug: null });
    }
    if (path === '/api/public/events/alpha') return json(200, EVENT);
    if (path === '/api/public/events/alpha/booths') return json(200, []);
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function useLocale(page: Page, locale: 'en' | 'fa') {
  await page.goto('/');
  await page.evaluate(l => localStorage.setItem('congress_attendee_locale', l), locale);
}

test('the SMS link opens the pass without signing in, and the code leaves the address bar', async ({ page }) => {
  const requests = await fixture(page);
  await useLocale(page, 'en');

  await page.goto(`/t/${GOOD}`);

  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  expect(page.url()).not.toContain(GOOD);
  await expect(page.getByText('Opened from your SMS link')).toBeVisible();
  await expect(page.getByText('Sara Fixture').first()).toBeVisible();
  await expect(page.getByText('Delegate pass')).toBeVisible();
  await expect(page.locator('main svg[viewBox^="0 0"]').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Sign in for networking and profile/ })).toHaveAttribute(
    'href', '/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-congress',
  );
  // The code travelled only in the request body, anonymously; no API URL carries it.
  const resolve = requests.filter(r => r.url.endsWith('/api/public/passes/resolve'));
  expect(resolve.map(r => [r.method, JSON.parse(r.body ?? '{}').code, r.auth])).toContainEqual(['POST', GOOD, undefined]);
  expect(requests.every(r => !r.url.includes(GOOD))).toBe(true);
  // The /t/ entry was replaced, not pushed: going back never lands on the code again.
  await page.goBack();
  expect(page.url()).not.toContain(GOOD);
  // The pass is kept on the device: it still shows with the API unreachable.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page, { apiDown: true });
  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByText('Sara Fixture').first()).toBeVisible();
  await expect(page.getByText('Opened from your SMS link')).toBeVisible();
});

test('an expired link shows a friendly page with a sign-in to that congress', async ({ page }) => {
  await fixture(page);
  await useLocale(page, 'en');

  await page.goto(`/t/${GONE}`);

  await expect(page.getByText('This link has expired or is no longer valid')).toBeVisible();
  const signIn = page.getByRole('link', { name: /Sign in to see your pass/ });
  await expect(signIn).toHaveAttribute('href', '/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
  expect(await page.locator('a[href="/"]').count()).toBe(0);

  await page.getByRole('button', { name: 'فارسی' }).click();
  await expect(page.getByText('این پیوند منقضی شده یا دیگر معتبر نیست')).toBeVisible();
});

test('an unknown link offers the general sign-in; a pass is never invented', async ({ page }) => {
  await fixture(page);
  await useLocale(page, 'fa');

  await page.goto('/t/nope234567');

  await expect(page.getByText('این پیوند معتبر نیست')).toBeVisible();
  await expect(page.getByRole('link', { name: /ورود و دیدن کارت ورود/ })).toHaveAttribute('href', '/sign-in?next=%2Fmy-tickets');
  expect(await page.locator('a[href="/"]').count()).toBe(0);
  await page.goto('/c/alpha/my-ticket');
  await expect(page.getByTestId('link-pass-note')).toHaveCount(0);
});
