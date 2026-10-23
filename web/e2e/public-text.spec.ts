import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Persian public pages: Persian digits outside left-to-right codes, never Persian in the monospace font, the back
// arrow follows the reading direction, and no install prompt. Synthetic, intercepted /api/ responses.
const slug = 'fa-fixture';
const event = {
  id: 'event-fa', name: 'همایش قلب تهران', slug, starts_at: '2027-05-10T06:00:00Z', ends_at: '2027-05-11T14:00:00Z',
  location: 'مرکز همایش‌های تهران', description: 'همایش سالانه', timezone: 'Asia/Tehran',
  ticket_tiers: [{ id: 'tier-fa', event_id: 'event-fa', name: 'عمومی', description: '', quota: 800, reserved_count: 412, is_open: true, created_at: '2027-01-01T00:00:00Z' }],
  venue: [{ id: 'hall-a', kind: 'hall', name: 'سالن اصلی', location: 'طبقهٔ همکف' }],
  sessions: [{ id: 's1', title: 'افتتاحیه', track: '', speakers: '', description: '', hall_id: 'hall-a', hall_name: 'سالن اصلی', starts_at: '2027-05-10T06:00:00Z', ends_at: '2027-05-10T07:00:00Z' }],
};
const booth = { id: 'booth-fa', name: 'آریا طب', slug: 'arya', location: 'سالن ۲، غرفهٔ ۱۲', description: 'تجهیزات پزشکی', website_url: '', brochure_url: '', event_name: event.name, event_slug: slug, is_bookmarked: false };

async function fixture(page: Page, locale: 'fa' | 'en' = 'fa') {
  await page.addInitScript((l) => localStorage.setItem('congress_attendee_locale', l), locale);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/events') return json(200, { items: [{ id: event.id, name: event.name, slug, starts_at: event.starts_at, ends_at: event.ends_at, location: event.location, timezone: event.timezone }], total: 1, limit: 6, offset: 0 });
    if (path === `/api/public/events/${slug}`) return json(200, event);
    if (path === `/api/public/events/${slug}/booths`) return json(200, [booth]);
    if (path === `/api/public/events/${slug}/booths/${booth.id}`) return json(200, booth);
    return json(404, { detail: 'Not found' });
  });
}

/** Visible text outside `dir="ltr"` islands that has Latin digits, and monospace elements that hold Persian. */
const textProblems = (page: Page) =>
  page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[aria-hidden="true"], .sr-only');
    };
    const latinDigits: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim() ?? '';
      const parent = node.parentElement;
      if (!text || !parent || !/[0-9]/.test(text) || parent.closest('[dir="ltr"], script, style') || !visible(parent)) continue;
      latinDigits.push(text.slice(0, 40));
    }
    const monoPersian = [...document.querySelectorAll('.font-mono')].filter((el) => visible(el) && /[؀-ۿ]/.test(el.textContent ?? '')).map((el) => (el.textContent ?? '').slice(0, 40));
    return { latinDigits, monoPersian };
  });

for (const [name, path] of [['home', '/'], ['congress page', `/e/${slug}`], ['booth page', `/e/${slug}/booths/${booth.id}`], ['unknown address', '/no/such/page']] as const) {
  test(`Persian ${name}: Persian digits, no Persian in mono`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await textProblems(page)).toEqual({ latinDigits: [], monoPersian: [] });
  });
}

for (const locale of ['fa', 'en'] as const) {
  test(`the "back" arrow on the unknown-address page points backwards in ${locale}`, async ({ page }) => {
    await fixture(page, locale);
    await page.goto('/no/such/page');
    const icon = page.getByTestId('not-found-back').locator('svg');
    await expect(icon).toBeVisible();
    expect(await icon.evaluate((el) => getComputedStyle(el).scale)).toBe(locale === 'fa' ? '-1 1' : 'none');
  });
}

test('public pages never offer the installable app, even when the browser can install', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  for (const path of ['/', `/e/${slug}`, `/e/${slug}/booths/${booth.id}`]) {
    await page.goto(path);
    await page.evaluate(() => {
      const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
      window.dispatchEvent(event);
    });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('install-hint'), path).toHaveCount(0);
  }
});
