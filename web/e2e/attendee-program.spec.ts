import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { panelApi, signIn } from './attendeePanelFixtures';

// The visitor is in London; the congress (and its program clock) is in Tehran.
test.use({ timezoneId: 'Europe/London' });

const AGENDA_KEY = 'congress_agenda_user-1_event-a';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2027-05-07T08:00:00Z'));
});

test('day tabs, hall and track chips and search narrow the program; times are the venue clock', async ({ page }) => {
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/details');

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole('tab', { name: /Day 1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tablist', { name: 'Program days' }).locator('..')).toHaveCSS('position', 'sticky');
  await expect(page.getByText('Opening Keynote')).toBeVisible();

  await page.getByRole('tab', { name: /Day 2/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('Imaging Panel')).toBeVisible();
  await expect(panel.getByText('AI Workshop')).toBeVisible();
  // 06:00 UTC is 09:30 at the venue (07:00 in London), and the page says which clock it uses.
  await expect(panel.getByText('09:30', { exact: true })).toBeVisible();
  await expect(page.getByText(/Times are venue time \(GMT\+3:30\)/)).toBeVisible();

  await page.getByRole('group', { name: 'Hall' }).getByRole('button', { name: 'Main Hall' }).click();
  await expect(panel.getByText('AI Workshop')).toBeVisible();
  await expect(panel.getByText('Imaging Panel')).toHaveCount(0);
  await page.getByRole('group', { name: 'Hall' }).getByRole('button', { name: 'All halls' }).click();

  await page.getByRole('group', { name: 'Track' }).getByRole('button', { name: 'Plenary' }).click();
  await expect(panel.getByText('No session matches these filters.')).toBeVisible();
  // The day tabs count the matches, so the other days show where the plenary sessions are.
  await expect(page.getByRole('tab', { name: /Day 1/ })).toContainText('1');
  await panel.getByRole('button', { name: 'Clear filters' }).click();

  await page.getByLabel('Search the program').fill('cardiac');
  await expect(panel.getByText('Imaging Panel')).toBeVisible();
  await expect(panel.getByText('AI Workshop')).toHaveCount(0);
});

test('the personal agenda is starred, kept per attendee and congress, and filters the program', async ({ page }) => {
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/details');
  await page.getByRole('tab', { name: /Day 2/ }).click();

  const star = page.getByRole('button', { name: 'Add “AI Workshop” to my agenda' });
  await star.click();
  await expect(page.getByRole('button', { name: 'Remove “AI Workshop” from my agenda' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(key => localStorage.getItem(key), AGENDA_KEY)).toBe('["s-workshop"]');

  await page.reload();
  await page.getByRole('tab', { name: /Day 2/ }).click();
  await expect(page.getByRole('button', { name: 'Remove “AI Workshop” from my agenda' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /My agenda/ }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('AI Workshop')).toBeVisible();
  await expect(panel.getByText('Imaging Panel')).toHaveCount(0);
  await page.getByRole('tab', { name: /Day 1/ }).click();
  await expect(panel.getByText('No session matches these filters.')).toBeVisible();
});

test('blocked storage keeps the agenda for the visit and says so', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('congress_agenda_')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/details');
  await page.getByRole('button', { name: 'Add “Opening Keynote” to my agenda' }).click();
  await expect(page.getByRole('button', { name: 'Remove “Opening Keynote” from my agenda' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'could not be saved on this device' })).toBeVisible();
});

test('each session downloads as an .ics in UTC; the venue offers Neshan, Balad and Google directions', async ({ page }) => {
  await panelApi(page);
  await signIn(page);
  await page.goto('/c/alpha/details');
  await page.getByRole('tab', { name: /Day 2/ }).click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Add “AI Workshop” to calendar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('alpha-s-worksh.ics');
  const ics = await readFile(await file.path(), 'utf8');
  expect(ics).toContain('DTSTART:20270511T080000Z');
  expect(ics).toContain('DTEND:20270511T090000Z');
  expect(ics).toContain('SUMMARY:AI Workshop');
  expect(ics).toContain('LOCATION:Main Hall — Milad Tower Conference Hall\\, Tehran');

  const venue = page.getByRole('region', { name: 'Venue' });
  await expect(venue.getByRole('link', { name: /Neshan/ })).toHaveAttribute('href', /^https:\/\/neshan\.org\/maps\/search\//);
  await expect(venue.getByRole('link', { name: /Balad/ })).toHaveAttribute('href', /^https:\/\/balad\.ir\/search\?query=/);
  await expect(venue.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\//);
});
