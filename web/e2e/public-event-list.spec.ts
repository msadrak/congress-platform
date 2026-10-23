import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The platform's public list of congresses (`GET /api/public/events`) on the home page and on a signed-out or
// empty `/me`. Synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const summary = (n: number, startDays: number, endDays: number) => ({
  id: `event-${n}`, name: `Listed Congress ${n}`, slug: `listed-${n}`, starts_at: at(startDays), ends_at: at(endDays), location: `Hall ${n}, Tehran`, timezone: 'Asia/Tehran',
});
// Upcoming and running first (soonest first), then past ones, as the API orders them.
const ALL = [summary(1, -1, 1), summary(2, 5, 6), summary(3, 9, 10), summary(4, 12, 13), summary(5, 20, 21), summary(6, 30, 31), summary(7, 40, 41), summary(8, -30, -29)];

async function fixture(page: Page, options: { items?: typeof ALL; status?: number; locale?: 'en' | 'fa' } = {}) {
  const queries: string[] = [];
  const items = options.items ?? ALL;
  await page.addInitScript((locale) => localStorage.setItem('congress_attendee_locale', locale), options.locale ?? 'en');
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/public/events') {
      queries.push(url.search);
      if (options.status) return json(options.status, { detail: 'Server error' });
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json(200, { items: items.slice(offset, offset + limit), total: items.length, limit, offset });
    }
    return json(404, { detail: 'Not found' });
  });
  return queries;
}

/** The home list sits below the hero and loads once scrolled to. */
const scrollToList = (page: Page) => page.getByTestId('public-event-list-sentinel').scrollIntoViewIfNeeded();

test('a home visit that never scrolls to the list asks nothing of the API', async ({ page }) => {
  const queries = await fixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  expect(queries).toEqual([]);
  await expect(page.getByTestId('public-event-list')).toHaveCount(0);
});

test('the home page lists upcoming congresses a page at a time, linking to each congress page, never past ones', async ({ page }) => {
  const queries = await fixture(page);
  await page.goto('/');
  await scrollToList(page);
  const list = page.getByTestId('public-event-list');
  await expect(list.getByRole('heading', { name: 'Upcoming congresses', level: 2 })).toBeVisible();
  const cards = list.getByTestId('public-event-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toHaveAttribute('href', '/e/listed-1');
  await expect(cards.first()).toContainText('Taking place now');
  await expect(cards.nth(1)).toContainText('Starts in 5 days');
  await list.getByRole('button', { name: 'Show more congresses' }).click();
  await expect(cards).toHaveCount(7);
  await expect(list.getByText('Listed Congress 8')).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Show more congresses' })).toHaveCount(0);
  expect(queries).toEqual(['?limit=6&offset=0', '?limit=6&offset=6']);
  // The footer no longer claims there is no public list.
  await expect(page.locator('footer')).not.toContainText('no public event directory');
});

test('with nothing listed the home page shows no empty band', async ({ page }) => {
  await fixture(page, { items: [summary(9, -30, -29)] });
  await page.goto('/');
  await scrollToList(page);
  await expect(page.getByRole('heading', { name: 'Six environments, one congress' })).toBeVisible();
  await expect(page.getByTestId('public-event-list')).toHaveCount(0);
  await expect(page.locator('#congresses')).toBeHidden();
});

test('a failed list load says so and can be retried', async ({ page }) => {
  await fixture(page, { status: 500 });
  await page.goto('/');
  await scrollToList(page);
  const list = page.getByTestId('public-event-list');
  await expect(list.getByRole('alert')).toContainText("Couldn't load the list of congresses.");
  await expect(list.getByRole('button', { name: 'Try Again' })).toBeVisible();
});

test('signed out, /me offers the upcoming congresses as well as signing in', async ({ page }) => {
  await fixture(page);
  await page.goto('/me');
  await expect(page.getByRole('link', { name: 'Sign in to see your pass' })).toBeVisible();
  const list = page.getByTestId('public-event-list');
  await expect(list.getByRole('heading', { name: 'Upcoming congresses' })).toBeVisible();
  await list.getByRole('link', { name: 'Open Listed Congress 2' }).click();
  await expect(page).toHaveURL(/\/e\/listed-2$/);
});

test('Persian home lists the congresses in Persian', async ({ page }) => {
  await fixture(page, { locale: 'fa', items: [summary(2, 5, 6)] });
  await page.goto('/');
  await scrollToList(page);
  const list = page.getByTestId('public-event-list');
  await expect(list.getByRole('heading', { name: 'همایش‌های پیش رو' })).toBeVisible();
  await expect(list.getByTestId('public-event-card')).toContainText('۵ روز تا آغاز');
});
