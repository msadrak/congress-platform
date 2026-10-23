import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic, intercepted /api/ responses. Venue Wi-Fi drops on congress day: a section whose congress can't be
// reached must end in an error with a retry within seconds, never an endless skeleton (org spec C2).
const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '', timezone: 'Asia/Tehran', archived_at: null };

async function api(page: Page, mode: { offline: boolean; eventStatus?: number }) {
  await page.route(/^https?:\/\/[^/]+\/api\//, route => {
    if (mode.offline) return route.abort('internetdisconnected');
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/organizer/me') return json(200, { kind: 'key', role: 'owner', organizer: { id: 'org-1', name: 'Org' }, member: null });
    if (path === '/api/events/event-a') return mode.eventStatus ? json(mode.eventStatus, { detail: 'Event not found', code: 'EVENT_NOT_FOUND' }) : json(200, EVENT);
    return json(200, []);
  });
}

async function seed(page: Page, locale: 'fa' | 'en') {
  await page.addInitScript(value => {
    sessionStorage.setItem('congress_organizer_api_key', 'synthetic-offline-organizer');
    localStorage.setItem('congress_attendee_locale', value);
  }, locale);
}

for (const section of ['', '/tiers', '/check-in']) {
  test(`offline, /organizer/events/:id${section} shows an alert with a retry within 3 s, and the retry recovers`, async ({ page }) => {
    const mode = { offline: true };
    await api(page, mode);
    await seed(page, 'en');
    await page.goto(`/organizer/events/event-a${section}`);
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't load the congress" });
    await expect(alert).toBeVisible({ timeout: 3000 });
    await expect(alert).toContainText("Can't connect");
    const retry = alert.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();

    mode.offline = false;
    await retry.click();
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load the congress" })).toHaveCount(0);
    await expect(page.getByTestId('active-event')).toHaveText('Alpha Congress');
  });
}

test('offline in Persian: the alert offers «تلاش دوباره»', async ({ page }) => {
  await api(page, { offline: true });
  await seed(page, 'fa');
  await page.goto('/organizer/events/event-a');
  const alert = page.getByRole('alert').filter({ hasText: 'همایش بارگذاری نشد' });
  await expect(alert).toBeVisible({ timeout: 3000 });
  await expect(alert.getByRole('button', { name: 'تلاش دوباره' })).toBeVisible();
});

test('a congress that does not exist says so, with no retry', async ({ page }) => {
  await api(page, { offline: false, eventStatus: 404 });
  await seed(page, 'en');
  await page.goto('/organizer/events/event-a');
  await expect(page.getByRole('heading', { name: 'Congress not found', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'All congresses' }).last()).toBeVisible();
});
