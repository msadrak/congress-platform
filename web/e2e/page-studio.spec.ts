import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Page Studio + public page with synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL.
// The real-backend lifecycle is scripts/integration/page-studio-e2e.mjs (PAGE_STUDIO_MILESTONE_RESULT.md).
const KEY = 'synthetic-page-studio-organizer';
const EVENT = { id: 'event-s', name: 'Studio Congress', slug: 'studio-congress', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Studio Hall', description: 'Operational description' };
const TIERS = [{ id: 'tier-1', name: 'Delegate', description: '', quota: 100, reserved_count: 10, is_open: true }];
const t = (en = '', fa = '') => ({ en, fa });
const baseSection = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ type, id, visible: true, eyebrow: t(), title: t(), ...extra });
const DOC = {
  version: 1,
  primary_locale: 'auto',
  branding: { accent: 'auto', logo_asset_id: null },
  hero: { layout: 'signature', eyebrow: t(), title: t(), subtitle: t(), cta_label: t(), cover_asset_id: null },
  seo: { title: t(), description: t(), share_image_asset_id: null },
  sections: [
    baseSection('about', 'about', { body: t() }),
    baseSection('highlights', 'highlights', { layout: 'list', items: [{ icon: 'qr', title: t('Digital pass', 'کارت دیجیتال'), body: t('Fast entry', 'ورود سریع') }] }),
    baseSection('passes', 'passes', { lead: t() }),
    baseSection('exhibitors', 'exhibitors', { lead: t() }),
  ],
};

type Saved = { revision: number; document: typeof DOC };

async function studioFixture(page: Page, { saveStatus = 200 }: { saveStatus?: number } = {}) {
  const saves: Saved[] = [];
  let state = { event_id: EVENT.id, draft: DOC, draft_revision: 3, draft_updated_at: '2099-01-01T10:00:00Z', is_published: false, published_revision: null as number | null, published_at: null as string | null, has_unpublished_changes: true };
  await page.addInitScript((key) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', 'en');
  }, KEY);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.headers().authorization !== `Bearer ${KEY}`) return json(401, { detail: 'Invalid API key' });
    if (path === `/api/events/${EVENT.id}`) return json(200, EVENT);
    if (path === `/api/events/${EVENT.id}/media`) return json(200, []);
    if (path === `/api/events/${EVENT.id}/page/preview`) return json(200, { ...EVENT, ticket_tiers: TIERS, page: { document: state.draft, assets: [] }, booths: [] });
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'GET') return json(200, state);
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}') as Saved;
      saves.push(body);
      if (saveStatus !== 200) return json(saveStatus, { detail: 'The page was changed elsewhere (now at revision 4).' });
      state = { ...state, draft: body.document, draft_revision: body.revision + 1 };
      return json(200, state);
    }
    return json(200, []);
  });
  return saves;
}

test('editing shows unsaved state, previews live in the frame, and saves the revision it was based on', async ({ page }) => {
  const saves = await studioFixture(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/organizer/events/${EVENT.id}/page`);
  await expect(page.getByTestId('page-status')).toHaveText('Not published');
  await page.getByRole('tab', { name: 'Brand & hero' }).click();
  await page.getByLabel('Subtitle').fill('A congress for clinicians');
  await expect(page.getByTestId('save-state')).toHaveText('Unsaved changes');
  await expect(page.frameLocator('[data-testid=page-preview-frame]').getByText('A congress for clinicians')).toBeVisible();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' }).first()).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0].revision).toBe(3);
  expect(saves[0].document.hero.subtitle).toEqual({ fa: '', en: 'A congress for clinicians' });
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

test('a save that lost a concurrent-edit race asks to reload instead of overwriting', async ({ page }) => {
  await studioFixture(page, { saveStatus: 409 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/organizer/events/${EVENT.id}/page`);
  await page.getByRole('tab', { name: 'Brand & hero' }).click();
  await page.getByLabel('Subtitle').fill('Late edit');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'saved from another window' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload latest' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

test('blocks are added, reordered, hidden and removed; core sections can only be hidden', async ({ page }) => {
  const saves = await studioFixture(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/organizer/events/${EVENT.id}/page`);
  const rows = page.locator('[data-testid=section-list] > li');
  await expect(rows).toHaveCount(4);
  for (const core of ['about', 'passes', 'exhibitors']) {
    await expect(page.locator(`li[data-section="${core}"]`).getByRole('button', { name: 'Remove section' })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^Agenda/ }).click();
  await page.getByLabel('Title', { exact: true }).last().fill('Opening keynote');
  await page.getByRole('button', { name: 'All sections' }).click();
  await page.locator('li[data-section="agenda-1"]').getByRole('button', { name: 'Move up' }).click();
  await page.locator('li[data-section="highlights"]').getByRole('button', { name: 'Hide from visitors' }).click();
  await expect(page.locator('li[data-section="highlights"]')).toContainText('Hidden');
  await expect(rows).toHaveCount(5);
  expect(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-section')))).toEqual(['about', 'highlights', 'passes', 'agenda-1', 'exhibitors']);

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' }).first()).toBeVisible();
  const sent = saves[0].document.sections as Array<{ id: string; visible: boolean; type: string }>;
  expect(sent.map((s) => [s.id, s.visible])).toEqual([['about', true], ['highlights', false], ['passes', true], ['agenda-1', true], ['exhibitors', true]]);

  await page.locator('li[data-section="agenda-1"]').getByRole('button', { name: 'Remove section' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove section' }).click();
  await expect(rows).toHaveCount(4);
});

test('the public page follows the published document: order, hidden sections, language fallback and branding', async ({ page }) => {
  const published = {
    ...DOC,
    branding: { accent: 'orchid', logo_asset_id: null },
    hero: { ...DOC.hero, subtitle: t('', 'زیرعنوان فقط فارسی'), title: t('Custom Hero Title') },
    sections: [
      baseSection('passes', 'passes', { lead: t() }),
      baseSection('rich_text', 'venue', { layout: 'split', title: t('Venue'), body: t('Take **line 3**.\n\n<script>alert(1)</script>') }),
      { ...baseSection('highlights', 'highlights', { layout: 'list', items: [{ icon: 'qr', title: t('Hidden item'), body: t() }] }), visible: false },
      baseSection('about', 'about', { body: t() }),
      baseSection('exhibitors', 'exhibitors', { lead: t() }),
    ],
  };
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/booths') ? [] : { ...EVENT, ticket_tiers: TIERS, page: { document: published, assets: [] } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/e/${EVENT.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Custom Hero Title');
  const subtitle = page.getByText('زیرعنوان فقط فارسی');
  await expect(subtitle).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('.pub-sheet section[id]').evaluateAll((els) => els.map((e) => e.id))).toEqual(['passes', 'section-venue', 'about', 'exhibition']);
  await expect(page.getByText('Hidden item')).toHaveCount(0);
  await expect(page.locator('#section-venue strong')).toHaveText('line 3');
  await expect(page.locator('#section-venue')).toContainText('<script>alert(1)</script>');
  await expect(page.locator('#section-venue script')).toHaveCount(0);
  await expect(page.getByText('Designed & developed by')).toBeVisible();
  const accent = await page.evaluate(() => getComputedStyle(document.querySelector('[style*="--event-accent"]')!).getPropertyValue('--event-accent').trim());
  expect(accent.toUpperCase()).toBe('#8E1BA8');
  await expect(page).toHaveTitle('Custom Hero Title');
});
