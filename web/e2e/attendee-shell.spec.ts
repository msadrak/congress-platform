import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BOOTHS, contactOf, panelApi, signIn, ticketOf } from './attendeePanelFixtures';

/**
 * The attendee shell on a phone (UX-ATT-SHELL, att WP3 + WP4): a header with only the switcher and the avatar, one
 * countdown on Home, the program first on the Program tab, `/me` with a QR shortcut, the network that starts the
 * camera, and a profile that offers Save only after a change.
 *
 * Shipping app + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
 */
const PHONES = [{ width: 360, height: 740 }, { width: 390, height: 844 }];
const BEFORE = new Date('2027-05-07T03:00:00Z');
const DURING = new Date('2027-05-11T06:30:00Z');

/** Visible, interactive controls inside the page header. */
const headerControls = (page: Page) =>
  page.locator('header').first().locator('a:visible, button:visible');

test.describe('the header on a phone', () => {
  for (const viewport of PHONES) {
    for (const locale of ['en', 'fa'] as const) {
      test(`${viewport.width}×${viewport.height} ${locale}: only the congress switcher and the avatar`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await panelApi(page);
        await signIn(page, locale);
        await page.clock.setFixedTime(BEFORE);
        await page.goto('/c/alpha/my-congress');
        await expect(page.getByTestId('profile-entry')).toBeVisible();
        await expect(headerControls(page)).toHaveCount(2);
        await expect(page.locator('header').getByRole('button', { name: /log ?out|خروج/i })).toHaveCount(0);
      });
    }
  }

  test('signed out the header offers the switcher and one sign-in pill', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
    await page.goto('/c/alpha/details');
    await expect(headerControls(page)).toHaveCount(2);
    await expect(page.locator('header').getByRole('link', { name: 'Log In' })).toBeVisible();
  });

  test('language stays one tap away in the switcher menu, and the shield footer is gone', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.clock.setFixedTime(BEFORE);
    await page.goto('/c/alpha/my-congress');
    await expect(page.getByText(/stays on this device for offline use/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Switch congress' }).click();
    await page.getByRole('button', { name: 'فارسی' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  });

  test('desktop keeps the language switch and log out in the header, and log out says what is removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await panelApi(page);
    await signIn(page, 'en');
    await page.clock.setFixedTime(BEFORE);
    await page.goto('/c/alpha/my-congress');
    await expect(page.locator('header').getByRole('button', { name: 'فارسی' })).toBeVisible();
    await page.locator('header').getByRole('button', { name: 'Log Out' }).click();
    await expect(page.getByRole('dialog')).toContainText('Your saved pass is removed from this device.');
  });
});

test.describe('Home', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
  });

  test('before: one countdown (the chip), no install row, no section numbers, a calendar and directions list', async ({ page }) => {
    await panelApi(page);
    await signIn(page, 'en');
    await page.clock.setFixedTime(BEFORE);
    await page.goto('/c/alpha/my-congress');
    const main = page.locator('main');
    await expect(main.getByText(/Starts in 3 days/)).toHaveCount(1);
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    await expect(main.getByText('Add to your home screen')).toHaveCount(0);
    await expect(main.getByText(/^0[1-9]$/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add the congress to your calendar/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show my pass' })).toHaveAttribute('href', '/c/alpha/my-ticket');
  });

  test('during: the pass QR is the first thing in main and inside the first screen', async ({ page }) => {
    await panelApi(page, { contacts: [contactOf(1)] });
    await signIn(page, 'en');
    await page.clock.setFixedTime(DURING);
    await page.goto('/c/alpha/my-congress');
    const qr = page.locator('main svg').first();
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box && box.y + box.height, 'the QR ends above the fold').toBeLessThanOrEqual(PHONES[1].height);
    expect(box?.width, 'the QR is as large as on the pass tab').toBeGreaterThanOrEqual(256);
    const firstIsPass = await page.locator('main').evaluate(main => {
      const first = main.querySelector('section, article, ul, div > section');
      return Boolean(first?.querySelector('svg'));
    });
    expect(firstIsPass).toBe(true);
  });

  test('signed out the phone form is on Home itself', async ({ page }) => {
    await panelApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
    await page.goto('/c/alpha/my-congress');
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
  });
});

test.describe('Program tab', () => {
  test('opens on the program: the first heading is «Program» and the day tabs are in the first screen', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.clock.setFixedTime(BEFORE);
    await page.goto('/c/alpha/details');
    await expect(page.locator('main h1, main h2').first()).toHaveText('Program');
    const tabs = page.getByRole('tablist', { name: 'Program days' });
    await expect(tabs).toBeVisible();
    const box = await tabs.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(PHONES[1].height);
  });

  test('no masthead, fact grid or About; the venue follows the program, with a link to the About on the public page', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.clock.setFixedTime(BEFORE);
    await page.goto('/c/alpha/details');
    await expect(page.getByText('Duration', { exact: true })).toHaveCount(0);
    await expect(page.getByText('About Alpha Congress')).toHaveCount(0);
    const about = page.getByRole('link', { name: 'About the congress' });
    await expect(about).toHaveAttribute('href', '/e/alpha#about');
    const program = await page.getByRole('tablist', { name: 'Program days' }).boundingBox();
    const venue = await page.getByRole('heading', { name: 'Venue' }).boundingBox();
    expect(program && venue && venue.y > program.y).toBe(true);
  });
});

test.describe('/me', () => {
  const live = [ticketOf('ticket-1', 'Delegate', 'qr-delegate')];

  test('title without a lead; the live congress has a QR shortcut next to its card', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page, { tickets: live });
    await signIn(page, 'en');
    await page.clock.setFixedTime(DURING);
    await page.goto('/me');
    await expect(page.getByRole('heading', { level: 1, name: 'My congresses' })).toBeVisible();
    await expect(page.getByText(/Open a congress to see your pass/)).toHaveCount(0);
    const card = page.getByTestId('congress-card');
    await expect(card).toHaveAttribute('href', '/c/alpha/my-congress');
    await expect(page.getByRole('link', { name: /QR code/ })).toHaveAttribute('href', '/c/alpha/my-ticket');
  });

  test('signed out the phone form is under the title', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
    await page.goto('/me');
    await expect(page.getByTestId('otp-mobile-step')).toBeVisible();
    await expect(page.getByText('Find your pass')).toHaveCount(0);
  });

  test('no passes yet: a short title and no paragraph', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page, { tickets: [] });
    await signIn(page, 'en');
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'No passes yet' })).toBeVisible();
    await expect(page.getByText(/To register, get the congress page link/)).toHaveCount(0);
  });

  test('offline with a saved list: one offline chip and no red alert', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page, { tickets: live, override: route => route.abort('connectionfailed') });
    await signIn(page, 'en');
    await page.evaluate(ticket => {
      localStorage.setItem('congress_cached_tickets_user-1', JSON.stringify({ userId: 'user-1', cachedAt: Date.now(), expiresAt: Date.now() + 7 * 86_400_000, tickets: [ticket] }));
    }, live[0]);
    await page.goto('/me');
    await expect(page.getByTestId('congress-card')).toBeVisible();
    await expect(page.getByText('Offline: the list saved on this device')).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('saved booths have no description line; at 1440 px the page has two columns', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await panelApi(page, {
      tickets: live,
      override: (route, request) =>
        request.method === 'GET' && request.path === '/api/attendees/me/bookmarks/booths'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ ...BOOTHS[0], booth_id: 'booth-1', event_name: 'Alpha Congress', event_slug: 'alpha', bookmarked_at: '2027-01-01T00:00:00Z' }]) })
          : undefined,
    });
    await signIn(page, 'en');
    await page.clock.setFixedTime(DURING);
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'Saved Exhibition Booths' })).toBeVisible();
    await expect(page.getByText(/Commercial exhibitors and sponsors/)).toHaveCount(0);
    const columns = page.getByTestId('me-column');
    await expect(columns).toHaveCount(2);
    const [left, right] = await Promise.all([columns.nth(0).boundingBox(), columns.nth(1).boundingBox()]);
    expect(left && right && right.x > left.x + left.width - 1, 'the second column sits beside the first').toBe(true);
  });
});

test.describe('Network', () => {
  test('a short header with a count, no eyebrow and no explanatory sentence under the code', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page, { contacts: [contactOf(1), contactOf(2)] });
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-network');
    await expect(page.getByRole('heading', { level: 1, name: 'My network' })).toBeVisible();
    await expect(page.getByText('Professional network')).toHaveCount(0);
    await expect(page.getByText('2 contacts')).toBeVisible();
    await expect(page.getByText(/Ask your colleague to read this code/)).toHaveCount(0);
  });

  test('?scan=1 starts the camera without a click', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await page.addInitScript(() => {
      const calls = { count: 0 };
      (window as unknown as { __gum: typeof calls }).__gum = calls;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => { calls.count += 1; throw new DOMException('denied', 'NotAllowedError'); } },
      });
      navigator.permissions.query = (async () => ({ state: 'granted' })) as unknown as typeof navigator.permissions.query;
    });
    await panelApi(page);
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-network?scan=1');
    await expect(page.getByRole('tab', { name: 'Scan' })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __gum: { count: number } }).__gum.count)).toBeGreaterThan(0);
  });

  test('no contacts yet: a title and a Scan button, no paragraph', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-network');
    const empty = page.getByTestId('network-empty');
    await expect(empty.getByRole('heading', { name: 'No contacts yet' })).toBeVisible();
    await expect(empty.getByRole('button', { name: 'Scan' })).toBeVisible();
    await expect(empty.locator('p')).toHaveCount(0);
  });
});

test.describe('Profile', () => {
  test('Save appears only after a change and stays in reach on a phone; no pass note under the form', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-profile');
    await expect(page.getByLabel('Full name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(page.getByText(/also update your pass/)).toHaveCount(0);
    await page.getByLabel('Title').fill('Interventional cardiologist');
    const save = page.getByRole('button', { name: 'Save changes' });
    await expect(save).toBeVisible();
    const bar = page.getByTestId('profile-save-bar');
    expect(await bar.evaluate(el => getComputedStyle(el).position)).toBe('sticky');
  });

  test('consent switches show a label, one short line, and no on/off caption', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-profile');
    const peers = page.getByRole('switch', { name: 'Share my mobile number with colleagues' });
    await expect(peers).toBeVisible();
    await expect(page.getByText('Off', { exact: true })).toHaveCount(0);
    await expect(page.getByText('On', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Colleagues who scan your QR code see your mobile number on their contact card/)).toHaveCount(0);
  });

  test('signing out asks first and says the saved pass is removed from this device', async ({ page }) => {
    await page.setViewportSize(PHONES[1]);
    await panelApi(page);
    await signIn(page, 'en');
    await page.goto('/c/alpha/my-profile');
    await page.getByRole('button', { name: 'Sign out' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Your saved pass is removed from this device.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Full name')).toBeVisible();
  });
});
