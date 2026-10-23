import { expect, test } from '@playwright/test';
import { BOOTHS, contactOf, panelApi, signIn, ticketOf } from './attendeePanelFixtures';

// My Congress follows the congress's dates in its own time zone (Asia/Tehran): before, during, after.
const twoPasses = [ticketOf('ticket-1', 'Delegate', 'qr-delegate'), ticketOf('ticket-2', 'Workshop add-on', 'qr-workshop')];
const headings = (page: import('@playwright/test').Page) => page.locator('main h2').allTextContents();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('before: one countdown chip, every pass, the checklist, zero contacts in words and 44 px booth saves', async ({ page }) => {
  await panelApi(page, { tickets: twoPasses });
  await signIn(page);
  // Three days and 2½ hours before 09:00 Tehran on 10 May.
  await page.clock.setFixedTime(new Date('2027-05-07T03:00:00Z'));
  await page.goto('/c/alpha/my-congress');

  // One countdown: the phase chip (days only).
  await expect(page.getByText('Starts in 3 days')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  expect((await headings(page)).slice(0, 3)).toEqual(['Your passes', 'Congress program', 'My Network']);
  await expect(page.getByText('Workshop add-on')).toBeVisible();
  await expect(page.getByText('Delegate', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Show my pass' })).toHaveAttribute('href', '/c/alpha/my-ticket');

  // Checklist: the calendar file and directions in the map apps (the install hint lives under the pass).
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Add the congress to your calendar/ }).click();
  expect((await download).suggestedFilename()).toBe('alpha.ics');
  await expect(page.getByText('Calendar file downloaded')).toBeVisible();
  await page.getByText('Directions to the venue').click();
  await expect(page.getByRole('link', { name: /Neshan/ })).toHaveAttribute('href', /neshan\.org\/maps\/search\/Milad/);

  // Zero is a sentence, never a bare 0.
  await expect(page.getByText('No contacts yet')).toBeVisible();
  const save = page.getByRole('button', { name: 'Save Zeta Pharma' });
  expect((await save.boundingBox())?.height).toBeGreaterThanOrEqual(44);
});

test('during: the pass QR comes first and opens the pass; now and next follow the venue clock', async ({ page }) => {
  await panelApi(page, { tickets: twoPasses, contacts: [contactOf(1), contactOf(2), contactOf(3)] });
  await signIn(page);
  // 10:00 Tehran on 11 May: the imaging panel runs, the workshop is next.
  await page.clock.setFixedTime(new Date('2027-05-11T06:30:00Z'));
  await page.goto('/c/alpha/my-congress');

  await expect(page.getByText(/Live now · Day 2 of 3/)).toBeVisible();
  // The pass QR comes before the program (the page's first h2 is the program, after the pass links).
  expect((await headings(page))[0]).toBe('Congress program');
  const passes = page.getByRole('link', { name: /Show my pass:/ });
  await expect(passes).toHaveCount(2);
  await expect(passes.first().locator('svg').first()).toBeVisible();
  await expect(page.getByText('Show this QR code at the entrance').first()).toBeVisible();

  const program = page.getByRole('region', { name: 'Congress program' });
  await expect(program.getByText('Imaging Panel')).toBeVisible();
  await expect(program.getByText('AI Workshop')).toBeVisible();
  await expect(page.getByText('3 contacts')).toBeVisible();

  await passes.first().click();
  await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
});

test('after: thanks and a summary, no countdown', async ({ page }) => {
  await panelApi(page, { contacts: [contactOf(1), contactOf(2)] });
  await signIn(page);
  await page.clock.setFixedTime(new Date('2027-05-13T08:00:00Z'));
  await page.goto('/c/alpha/my-congress');

  await expect(page.getByRole('heading', { name: 'Thank you for attending Alpha Congress' })).toBeVisible();
  await expect(page.getByText('2 contacts')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Program & files' })).toHaveAttribute('href', '/c/alpha/details#program');
});

test('Persian: zero contacts read as words, no overflow at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await panelApi(page);
  await signIn(page, 'fa');
  await page.clock.setFixedTime(new Date('2027-05-07T03:00:00Z'));
  await page.goto('/c/alpha/my-congress');
  await expect(page.getByText('هنوز مخاطبی ندارید')).toBeVisible();
  await expect(page.getByText(/روز تا آغاز/)).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

const longBooth = [{ ...BOOTHS[0], location: 'Exhibition Hall C, North Wing, Ground Floor, Stand B12-B14 beside the main entrance' }];
for (const lang of ['fa', 'en'] as const) {
  for (const width of [360, 390]) {
    test(`a long booth location never widens the page (${lang}, ${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await panelApi(page, {
        override: (route, request) =>
          request.path === '/api/public/events/alpha/booths'
            ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(longBooth) })
            : undefined,
      });
      await signIn(page, lang);
      await page.clock.setFixedTime(new Date('2027-05-07T03:00:00Z'));
      await page.goto('/c/alpha/my-congress');
      await expect(page.getByText(longBooth[0].location)).toBeAttached();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
}

test('a booth save without an active pass explains why and links to a pass', async ({ page }) => {
  const requests = await panelApi(page, {
    override: (route, request) =>
      request.method === 'POST' && request.path.startsWith('/api/attendees/me/bookmarks/booths/')
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'An active ticket is required', code: 'ACTIVE_TICKET_REQUIRED' }) })
        : undefined,
  });
  await signIn(page);
  await page.goto('/c/alpha/my-congress');
  await page.getByRole('button', { name: 'Save Zeta Pharma' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('You need an active pass for this congress to save booths.');
  await expect(alert.getByRole('link', { name: /Get a pass/ })).toHaveAttribute('href', '/e/alpha');
  expect(requests.find(r => r.method === 'POST' && r.path === '/api/attendees/me/bookmarks/booths/booth-1')?.search.get('event_id')).toBe('event-a');
});
