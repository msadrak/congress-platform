import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * The pass and the link pass on a phone (UX-ATT-PASS, att WP2): the QR is in the first screen and the card is the first
 * thing under the header; the one status line (offline, session ended, a notice) sits under the card; the install row comes
 * before the quiet cancel link; a signed-out visitor gets the phone form right there.
 *
 * Shipping app + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
 */
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const TOKEN = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const EVENT = { id: 'event-alpha', slug: 'alpha', name: 'Alpha Congress', starts_at: at(30), ends_at: at(32), location: 'Fixture Hall' };
const ticket = (extra: Record<string, unknown> = {}) => ({
  id: 'ticket-alpha-0001', event_id: EVENT.id, event_name: EVENT.name, event_slug: EVENT.slug, event_location: EVENT.location,
  event_starts_at: EVENT.starts_at, event_ends_at: EVENT.ends_at, event_timezone: 'Asia/Tehran', ticket_tier_id: 't', ticket_tier_name: 'Delegate',
  attendee_name: 'Sara Fixture', attendee_mobile: '09121234567', status: 'active', qr_secret: 'qr-alpha', created_at: at(-5), ...extra,
});
const MOBILE = '09121234567';
const LINK_CODE = 'good234567';
const LINK_PASS = {
  ticket_id: 'ticket-alpha-0001', status: 'active', issued_at: at(-5), qr_secret: 'qr-alpha', tier_name: 'Delegate pass', expires_at: at(60),
  event: EVENT, attendee: { full_name: 'Sara Fixture', organization: null, title: null },
};

interface Options { tickets?: unknown[]; apiDown?: boolean; expiredLink?: boolean }

async function fixture(page: Page, options: Options = {}) {
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    if (options.apiDown) return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/attendees/me/tickets') return json(200, options.tickets ?? []);
    if (url.pathname === '/api/public/events/alpha') return json(200, { ...EVENT, description: 'About', ticket_tiers: [], venue: [], sessions: [] });
    if (url.pathname === '/api/public/events/alpha/booths') return json(200, []);
    if (url.pathname === '/api/public/passes/resolve') {
      return options.expiredLink
        ? json(410, { detail: 'This link has expired.', code: 'LINK_EXPIRED', event_slug: 'alpha' })
        : json(200, LINK_PASS);
    }
    if (url.pathname === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    if (url.pathname === '/api/auth/otp/request') return json(202, { mobile: MOBILE, code_length: 6, expires_in: 120, resend_after: 60 });
    if (url.pathname === '/api/auth/otp/verify') {
      return json(200, {
        status: 'signed_in', access_token: TOKEN, token_type: 'bearer', signup_token: null,
        user: { id: 'user-1', mobile: MOBILE, full_name: 'Sara Fixture', organization: '', title: '', share_contact_with_peers: false },
      });
    }
    return json(404, { detail: 'Not found' });
  });
}

async function begin(page: Page, { locale = 'en', signedIn = true, cached = false }: { locale?: 'en' | 'fa'; signedIn?: boolean; cached?: boolean } = {}) {
  await page.goto('/');
  await page.evaluate(({ token, locale, signedIn, cached, pass }) => {
    localStorage.clear();
    localStorage.setItem('congress_attendee_locale', locale);
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
    if (cached) {
      localStorage.setItem('congress_cached_tickets_user-1', JSON.stringify({ userId: 'user-1', cachedAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, tickets: [pass] }));
    }
  }, { token: TOKEN, locale, signedIn, cached, pass: ticket() });
}

const WORDS = {
  en: { qr: 'Show the QR code full screen', print: 'Print Pass', passId: 'Pass ID', offline: 'Offline: showing your saved pass', upToDate: /up to date|updating your pass/i },
  fa: { qr: 'نمایش تمام‌صفحه کد QR', print: 'چاپ کارت ورود', passId: 'شناسه کارت ورود', offline: 'آفلاین: نمایش کارت ورود ذخیره‌شده', upToDate: /به‌روز/ },
} as const;

const PIXEL_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('element has no box');
  return found;
};

/** Top of the fixed bottom dock, or the viewport height when there is none. */
const dockTop = (page: Page) => page.evaluate(() => {
  const dock = [...document.querySelectorAll('nav')].find(nav => {
    const style = getComputedStyle(nav);
    return style.position === 'fixed' && nav.getBoundingClientRect().width > 0 && style.visibility !== 'hidden';
  });
  return dock ? dock.getBoundingClientRect().top : innerHeight;
});

const PHONES = [{ width: 360, height: 740 }, { width: 390, height: 844 }];

test.describe('the pass tab on a phone', () => {
  for (const viewport of PHONES) {
    for (const locale of ['en', 'fa'] as const) {
      test(`${viewport.width}×${viewport.height} ${locale}: the QR is in the first screen and nothing sits above the card`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await fixture(page, { tickets: [ticket()] });
        await begin(page, { locale });
        await page.goto('/c/alpha/my-ticket');
        const qr = page.getByRole('button', { name: WORDS[locale].qr });
        await expect(qr).toBeVisible();

        const shape = await box(qr);
        expect(shape.y, 'QR starts inside the screen').toBeGreaterThanOrEqual(0);
        expect(shape.y + shape.height, 'QR ends above the dock').toBeLessThanOrEqual(await dockTop(page));
        expect(shape.x).toBeGreaterThanOrEqual(0);
        expect(shape.x + shape.width).toBeLessThanOrEqual(viewport.width);
        // The card is the first thing under the header: no status line, no hint before it.
        expect(await page.locator('article').evaluate(card => card.previousElementSibling)).toBeNull();
        // The online state says nothing.
        await page.waitForLoadState('networkidle');
        await expect(page.getByTestId('pass-status-line')).toHaveCount(0);
        await expect(page.getByText(WORDS[locale].upToDate)).toHaveCount(0);
      });
    }
  }

  test('the card shows Pass ID, no tap hint, a small expand mark on the QR, and no print button below md', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await fixture(page, { tickets: [ticket()] });
    await begin(page, { locale: 'en' });
    await page.goto('/c/alpha/my-ticket');
    const card = page.locator('article');
    await expect(card.getByText('Pass ID')).toBeVisible();
    await expect(card.getByText(/tap the qr code/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show the QR code full screen' }).getByTestId('pass-qr-expand')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print Pass' })).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('button', { name: 'Print Pass' })).toBeVisible();
  });

  test('Persian: «شناسه کارت ورود» and no banned word on the card', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await fixture(page, { tickets: [ticket()] });
    await begin(page, { locale: 'fa' });
    await page.goto('/c/alpha/my-ticket');
    await expect(page.locator('article').getByText('شناسه کارت ورود')).toBeVisible();
    const banned = String.fromCodePoint(0x628, 0x644, 0x6cc, 0x62a);
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(banned);
  });

  for (const locale of ['en', 'fa'] as const) {
    test(`${locale}: offline shows one warning line, under the card`, async ({ page }) => {
      await page.setViewportSize(PHONES[1]);
      await fixture(page, { apiDown: true });
      await begin(page, { locale, cached: true });
      await page.goto('/c/alpha/my-ticket');
      const line = page.getByTestId('pass-status-line');
      await expect(line).toHaveCount(1);
      await expect(line).toContainText(WORDS[locale].offline);
      expect((await box(line)).y).toBeGreaterThan((await box(page.locator('article'))).y + (await box(page.locator('article'))).height - 1);
      expect(await page.locator('article').evaluate(card => card.previousElementSibling)).toBeNull();
    });
  }

  test('with no saved pass and no connection it asks to connect once, with a retry', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await fixture(page, { apiDown: true });
    await begin(page, { locale: 'en' });
    await page.goto('/c/alpha/my-ticket');
    const error = page.getByTestId('pass-load-error');
    await expect(error).toContainText('Connect once to load your pass');
    await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible();

    await begin(page, { locale: 'fa' });
    await page.goto('/c/alpha/my-ticket');
    await expect(page.getByTestId('pass-load-error')).toContainText('برای بار اول به اینترنت نیاز دارید');
  });

  test.describe('on an Android phone', () => {
    test.use({ userAgent: PIXEL_CHROME, viewport: PHONES[1], hasTouch: true, isMobile: true });

    test('the install row comes before a quiet cancel link, which has no hint under it', async ({ page }) => {
      await fixture(page, { tickets: [ticket()] });
      await begin(page, { locale: 'en' });
      await page.goto('/c/alpha/my-ticket');
      await page.evaluate(() => window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed' }),
      })));
      const row = page.getByTestId('install-hint');
      const cancel = page.getByRole('button', { name: 'Cancel registration' });
      await expect(row).toBeVisible();
      await expect(cancel).toBeVisible();
      expect((await box(row)).y).toBeLessThan((await box(cancel)).y);
      await expect(page.getByText(/until the congress starts/i)).toHaveCount(0);
      // Text only: no filled or outlined button chrome.
      expect(await cancel.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await cancel.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgba(0, 0, 0, 0)');
    });
  });

  test('cancelling asks one short question and says what happens', async ({ page }) => {
    await fixture(page, { tickets: [ticket()] });
    await begin(page, { locale: 'en' });
    await page.goto('/c/alpha/my-ticket');
    await page.getByRole('button', { name: 'Cancel registration' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Cancel registration?');
    await expect(dialog).toContainText("The QR code stops working and your place is released. This can't be undone.");
    await expect(dialog.getByRole('button', { name: 'Keep' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel registration' })).toBeVisible();
  });
});

test.describe('signed out on the pass tab', () => {
  for (const locale of ['en', 'fa'] as const) {
    test(`${locale}: the phone form is right there, with no extra page`, async ({ page }) => {
      await page.setViewportSize(PHONES[1]);
      await fixture(page);
      await begin(page, { locale, signedIn: false });
      await page.goto('/c/alpha/my-ticket');
      await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
      await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(locale === 'en' ? 'Sign in to see your pass' : 'ورود برای دیدن کارت ورود');
    });
  }
});

test.describe('the pass from an SMS link', () => {
  for (const viewport of PHONES) {
    test(`${viewport.width}×${viewport.height}: the QR is in the first screen, the sign-in link is one line under the card`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await fixture(page);
      await begin(page, { locale: 'en', signedIn: false });
      await page.goto(`/t/${LINK_CODE}`);
      await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
      const qr = page.getByRole('button', { name: 'Show the QR code full screen' });
      await expect(qr).toBeVisible();
      const shape = await box(qr);
      expect(shape.y + shape.height).toBeLessThanOrEqual(await dockTop(page));
      expect(await page.locator('article').evaluate(card => card.previousElementSibling)).toBeNull();

      const link = page.getByRole('link', { name: /Sign in for networking/ });
      await expect(link).toHaveAttribute('href', '/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-congress');
      const card = await box(page.locator('article'));
      expect((await box(link)).y).toBeGreaterThan(card.y + card.height - 1);
      await expect(page.getByTestId('link-pass-note')).toHaveCount(0);
    });
  }

  test('an expired link says so, offers the phone form on the page, and keeps the language switch in the header', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await fixture(page, { expiredLink: true });
    await begin(page, { locale: 'en', signedIn: false });
    await page.goto(`/t/${LINK_CODE}`);
    await expect(page.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
    await expect(page.getByText('Sign in to see your pass, or open your latest SMS.')).toBeVisible();
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
    const toggle = page.getByRole('button', { name: 'فارسی' });
    await expect(toggle).toHaveCount(1);
    expect((await box(toggle)).y, 'the language switch is at the top, not under the form').toBeLessThan(80);

    await toggle.click();
    await expect(page.getByRole('heading', { name: 'این پیوند دیگر معتبر نیست' })).toBeVisible();
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  });

  test('signing in from the expired-link page opens the congress pass', async ({ page }) => {
    await fixture(page, { expiredLink: true, tickets: [ticket()] });
    await begin(page, { signedIn: false });
    await page.goto(`/t/${LINK_CODE}`);
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel('Code from the SMS').fill('482913');
    await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
    await expect(page.getByTestId('pass-status')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBe(TOKEN);
  });
});
