import { expect, test } from '@playwright/test';
import { panelApi, signIn } from './attendeePanelFixtures';

// Booth staff and desk operators reach their portals from `/me` and the panel's congress switcher, driven by
// `/api/me/access` (+ `/api/booths/me` for booth names). Synthetic, intercepted /api/ responses.
const ACCESS = {
  user_id: 'user-1',
  events: [
    { event_id: 'event-a', event_slug: 'alpha', event_name: 'Alpha Congress', roles: ['ATTENDEE', 'PARTNER'], ticket_ids: ['ticket-1'], desk_operator_ids: [], booth_ids: ['booth-7'], partner_ids: [] },
    { event_id: 'event-b', event_slug: 'beta', event_name: 'Beta Summit', roles: ['RECEPTION'], ticket_ids: [], desk_operator_ids: ['op-1'], booth_ids: [], partner_ids: [] },
  ],
};
const MY_BOOTHS = [{ id: 'booth-7', event_id: 'event-a', name: 'Aria Med', slug: 'aria', location: 'Hall B, stand 12', description: '', website_url: '', brochure_url: '', qr_secret: 'secret', created_at: '2027-01-01T00:00:00Z' }];

test('an exhibitor and desk operator without a pass sees their booths and desk on /me, not only "not registered"', async ({ page }) => {
  const requests = await panelApi(page, {
    tickets: [],
    override: (route, r) => {
      if (r.path === '/api/me/access') return route.fulfill({ json: ACCESS });
      if (r.path === '/api/booths/me') return route.fulfill({ json: MY_BOOTHS });
      return undefined;
    },
  });
  await signIn(page);
  await page.goto('/me');

  const staff = page.getByTestId('staff-section');
  await expect(staff.getByRole('heading', { name: 'My booths' })).toBeVisible();
  await expect(staff.getByRole('link', { name: 'Open booth workspace: Aria Med' })).toHaveAttribute('href', '/booth/booth-7');
  await expect(staff.getByText('Hall B, stand 12')).toBeVisible();
  await expect(staff.getByRole('heading', { name: 'Reception desk' })).toBeVisible();
  await expect(staff.getByRole('link', { name: 'Open reception desk: Beta Summit' })).toHaveAttribute('href', '/reception/event-b');
  await expect(page.getByText("You haven't registered for a congress yet")).toHaveCount(0);
  await expect(page.getByText("You haven't reserved a pass for a congress yet.")).toBeVisible();
  // The booth link carries the attendee session to the exhibitor portal's own sign-in check.
  expect(requests.filter((r) => r.path === '/api/booths/me')).toHaveLength(1);
  for (const r of requests.filter((x) => x.path === '/api/me/access' || x.path === '/api/booths/me')) expect(r.auth).toMatch(/^Bearer /);

  await page.getByRole('link', { name: 'Open reception desk: Beta Summit' }).click();
  await expect(page).toHaveURL(/\/reception\/event-b$/);
});

test('a plain attendee sees no staff section and the booth list is never fetched', async ({ page }) => {
  const requests = await panelApi(page, {
    override: (route, r) =>
      r.path === '/api/me/access'
        ? route.fulfill({ json: { user_id: 'user-1', events: [{ ...ACCESS.events[0], roles: ['ATTENDEE'], booth_ids: [] }] } })
        : undefined,
  });
  await signIn(page);
  await page.goto('/me');
  await expect(page.getByTestId('congress-card')).toHaveCount(1);
  await expect(page.getByTestId('staff-section')).toHaveCount(0);
  expect(requests.some((r) => r.path === '/api/booths/me')).toBe(false);
});

test('a failed role lookup says so and retries', async ({ page }) => {
  let failures = 1;
  await panelApi(page, {
    override: (route, r) => {
      if (r.path !== '/api/me/access') return undefined;
      if (failures-- > 0) return route.fulfill({ status: 503, json: { detail: 'Service unavailable' } });
      return route.fulfill({ json: ACCESS });
    },
  });
  await signIn(page);
  await page.goto('/me');
  const alert = page.getByRole('alert').filter({ hasText: "Couldn't load your booths and reception desks." });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('staff-section')).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('the panel congress switcher lists the booth and the reception desk', async ({ page }) => {
  await panelApi(page, {
    override: (route, r) => {
      if (r.path === '/api/me/access') return route.fulfill({ json: ACCESS });
      if (r.path === '/api/booths/me') return route.fulfill({ json: MY_BOOTHS });
      return undefined;
    },
  });
  await signIn(page);
  await page.goto('/c/alpha/my-ticket');
  await page.getByRole('button', { name: 'Switch congress' }).click();
  const menu = page.locator('#congress-switcher');
  await expect(menu.getByRole('link', { name: /Aria Med/ })).toHaveAttribute('href', '/booth/booth-7');
  await expect(menu.getByRole('link', { name: /Beta Summit/ })).toHaveAttribute('href', '/reception/event-b');
  await expect(menu.getByRole('link', { name: 'All my congresses' })).toHaveAttribute('href', '/me');
});

test('Persian /me names the booths and the desk «غرفه‌های من» and «میز پذیرش»', async ({ page }) => {
  await panelApi(page, {
    tickets: [],
    override: (route, r) => {
      if (r.path === '/api/me/access') return route.fulfill({ json: ACCESS });
      if (r.path === '/api/booths/me') return route.fulfill({ json: MY_BOOTHS });
      return undefined;
    },
  });
  await signIn(page, 'fa');
  await page.goto('/me');
  const staff = page.getByTestId('staff-section');
  await expect(staff.getByRole('heading', { name: 'غرفه‌های من' })).toBeVisible();
  await expect(staff.getByRole('heading', { name: 'میز پذیرش' })).toBeVisible();
});
