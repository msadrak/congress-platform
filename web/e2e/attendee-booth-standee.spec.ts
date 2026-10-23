import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { token } from './attendeePanelFixtures';

// The standee QR opens `/e/<slug>/booths/<id>?b=<secret>`: one tap saves the booth for a signed-in attendee.
const booth = { id: 'booth-1', name: 'Zeta Pharma', slug: 'zeta', location: 'B12', description: 'Cardiology devices', website_url: '', brochure_url: '', event_name: 'Alpha Congress', event_slug: 'alpha', is_bookmarked: false };
const URL_WITH_CODE = '/e/alpha/booths/booth-1?b=k7m2q9xa4d';

async function api(page: Page, scan: { status: number; body: object } = { status: 201, body: { bookmarked: true, booth_id: 'booth-1', name: 'Zeta Pharma', event_slug: 'alpha' } }) {
  const requests: { method: string; path: string; body: unknown; auth?: string }[] = [];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const raw = request.postData();
    requests.push({ method: request.method(), path, body: raw ? JSON.parse(raw) : undefined, auth: request.headers().authorization });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/public/events/alpha/booths/booth-1') return json(200, booth);
    if (path === '/api/attendees/me/bookmarks/booths') return json(200, []);
    if (path === '/api/attendees/me/bookmarks/booths/scan') return json(scan.status, scan.body);
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, signedIn: boolean) {
  await page.goto('/');
  await page.evaluate(({ token, signedIn }) => {
    localStorage.setItem('congress_attendee_locale', 'en');
    if (signedIn) localStorage.setItem('congress_attendee_token', token);
  }, { token, signedIn });
}

test('signed in: one tap saves the booth by its code, then the code leaves the address', async ({ page }) => {
  const requests = await api(page);
  await seed(page, true);
  await page.goto(URL_WITH_CODE);
  await expect(page.getByText('Save this booth in one tap')).toBeVisible();
  await page.getByRole('button', { name: 'Save this booth' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zeta Pharma was added to your saved booths.' })).toBeVisible();
  expect(requests.find(r => r.path === '/api/attendees/me/bookmarks/booths/scan')?.body).toEqual({ code: 'k7m2q9xa4d' });
  expect(requests.find(r => r.path === '/api/attendees/me/bookmarks/booths/scan')?.auth).toBe(`Bearer ${token}`);
  await expect(page).toHaveURL(/\/e\/alpha\/booths\/booth-1$/);
});

test('signed out: sign in and come back to the same address, code included', async ({ page }) => {
  const requests = await api(page);
  await seed(page, false);
  await page.goto(URL_WITH_CODE);
  await expect(page.getByText('Sign in to save this booth')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with your mobile' })).toHaveAttribute('href', `/c/alpha/sign-in?next=${encodeURIComponent(URL_WITH_CODE)}`);
  expect(requests.some(r => r.path.includes('/bookmarks/'))).toBe(false);
});

test('without an active pass the save is explained with a link to a pass', async ({ page }) => {
  await api(page, { status: 403, body: { detail: 'An active ticket is required', code: 'ACTIVE_TICKET_REQUIRED' } });
  await seed(page, true);
  await page.goto(URL_WITH_CODE);
  await page.getByRole('button', { name: 'Save this booth' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('You need an active pass for this congress to save booths.');
  await expect(alert.getByRole('link', { name: /Get a pass/ })).toHaveAttribute('href', '/e/alpha');
  // The code stays, so the attendee can try again after registering.
  await expect(page).toHaveURL(/\?b=k7m2q9xa4d$/);
});

test('an unknown standee code is reported in the page language', async ({ page }) => {
  await api(page, { status: 404, body: { detail: 'Booth QR not found', code: 'BOOTH_QR_NOT_FOUND' } });
  await seed(page, true);
  await page.goto(URL_WITH_CODE);
  await page.getByRole('button', { name: 'Save this booth' }).click();
  await expect(page.getByRole('alert')).toContainText('This QR code does not belong to a booth.');
});
