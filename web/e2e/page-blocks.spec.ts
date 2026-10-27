import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Page Studio layout and media blocks (columns, video, gallery, links, section style, link CTA, custom
// accent) on the shipping public page and in the studio, with synthetic, intercepted /api/ responses.
const slug = 'blocks-fixture';
const t = (en = '', fa = '') => ({ en, fa });
const style = (patch: Record<string, string> = {}) => ({ background: 'none', width: 'normal', align: 'start', text_size: 'md', direction: 'auto', ...patch });
const section = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ type, id, visible: true, eyebrow: t(), title: t(), style: style(), ...extra });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const asset = (id: string, width = 160, height = 90) => ({ id, url: `/api/public/media/${id}`, width, height, content_type: 'image/png' });

const DOC = {
  version: 1,
  primary_locale: 'en',
  branding: { accent: 'custom', accent_color: '#0B6E4F', logo_asset_id: null },
  hero: { layout: 'signature', eyebrow: t(), title: t(), subtitle: t(), cta_label: t(), cover_asset_id: null },
  seo: { title: t(), description: t(), share_image_asset_id: null },
  sections: [
    section('about', 'about', { body: t('About the fixture congress') }),
    section('columns', 'columns-1', {
      title: t('Two days, two tracks'),
      layout: 'wide_start',
      surface: 'cards',
      style: style({ background: 'ink' }),
      items: [
        { icon: 'calendar', image_asset_id: null, image_alt: t(), title: t('Day one'), body: t('## Morning\n1. Opening\n2. Keynote'), button_label: t(), button_url: '' },
        { icon: null, image_asset_id: null, image_alt: t(), title: t('Day two'), body: t('==Workshops== all day'), button_label: t('Submit an abstract'), button_url: 'https://forms.example.org/abstracts' },
      ],
    }),
    section('rich_text', 'text-1', {
      title: t('Mixed languages'),
      body: t('Keynote by دکتر احمدی on imaging.\n\nسخنرانی دربارهٔ AI در پزشکی.'),
    }),
    section('rich_text', 'text-2', { title: t('Forced direction'), body: t('Left text forced right'), style: style({ direction: 'rtl', align: 'center', text_size: 'lg' }) }),
    section('video', 'video-1', { title: t("Last year's opening"), provider: 'aparat', video_id: 'Xy12z', poster_asset_id: 'poster', layout: 'full', caption: t(), body: t() }),
    section('gallery', 'gallery-1', { title: t('Sponsors'), layout: 'logos', columns: 4, items: [{ image_asset_id: 'logo', alt: t('Fixture Pharma'), caption: t(), url: 'https://sponsor.example.org' }] }),
    section('links', 'links-1', {
      layout: 'buttons',
      lead: t(),
      items: [
        { kind: 'telegram', url: 'https://t.me/congress', label: t() },
        { kind: 'email', url: 'mailto:info@example.org', label: t('Write to us') },
        { kind: 'website', url: 'javascript:alert(1)', label: t('Never shown') },
      ],
    }),
    section('passes', 'passes', { lead: t() }),
    section('exhibitors', 'exhibitors', { lead: t() }),
    section('cta', 'cta-1', { layout: 'accent', title: t('Call for papers'), body: t(), button_label: t('Submit now'), target: 'url', url: 'https://forms.example.org/abstracts' }),
  ],
};
const EVENT = {
  id: 'event-b', name: 'Blocks Fixture Congress', slug, starts_at: '2099-05-10T06:00:00Z', ends_at: '2099-05-11T14:00:00Z',
  location: 'Fixture Hall', description: 'Synthetic', ticket_tiers: [], venue: [], sessions: [],
  page: { document: DOC, assets: [asset('poster'), asset('logo', 80, 40)] },
};

async function publicFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  // The player itself is never fetched for real in tests.
  await page.route('https://www.aparat.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }));
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === `/api/public/events/${slug}`) return json(200, EVENT);
    if (path === `/api/public/events/${slug}/booths`) return json(200, []);
    if (path.startsWith('/api/public/media/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path === '/api/attendees/me/tickets') return json(200, []);
    return json(404, { detail: 'Not found' });
  });
}

test('columns, styled text, video, gallery, links and a link call to action render from the document', async ({ page }) => {
  await publicFixture(page);
  await page.goto(`/e/${slug}`);

  const columns = page.locator('#section-columns-1');
  await expect(columns.getByRole('heading', { name: 'Two days, two tracks', level: 2 })).toBeVisible();
  await expect(page.locator('[data-section-style="ink"]')).toContainText('Day one');
  await expect(columns.getByRole('heading', { name: 'Morning', level: 3 })).toBeVisible();
  await expect(columns.locator('ol > li')).toHaveText([/^1\.\s*Opening$/, /^2\.\s*Keynote$/]);
  await expect(columns.locator('mark')).toHaveText('Workshops');
  await expect(columns.getByRole('link', { name: 'Submit an abstract' })).toHaveAttribute('href', 'https://forms.example.org/abstracts');

  // Each paragraph reads in the script most of it is written in; a forced direction wins.
  const mixed = page.locator('#section-text-1');
  await expect(mixed.getByText('Keynote by')).toHaveAttribute('dir', 'ltr');
  await expect(mixed.getByText('سخنرانی')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#section-text-2').getByText('Left text forced right')).toHaveAttribute('dir', 'rtl');

  // The custom accent paints the page.
  const accent = await page.locator('#section-cta-1').getByRole('link', { name: 'Submit now' }).evaluate((el) => getComputedStyle(el.closest('[style*="--event-accent"]') ?? document.body).getPropertyValue('--event-accent'));
  expect(accent.trim().toUpperCase()).toBe('#0B6E4F');
  await expect(page.locator('#section-cta-1').getByRole('link', { name: 'Submit now' })).toHaveAttribute('href', 'https://forms.example.org/abstracts');
  // …down to the accent utilities visitors actually see (#0B6E4F), not only the variable.
  await expect(page.locator('#section-links-1').getByRole('link', { name: 'Telegram channel' }).locator('svg')).toHaveCSS('color', 'rgb(11, 110, 79)');

  // Video: nothing is loaded from the provider until play is pressed.
  const video = page.locator('#section-video-1');
  await expect(video.locator('iframe')).toHaveCount(0);
  await expect(video.getByRole('link', { name: /Watch on Aparat/ })).toHaveAttribute('href', 'https://www.aparat.com/v/Xy12z');
  await video.getByRole('button', { name: "Play video: Last year's opening" }).click();
  await expect(video.locator('iframe')).toHaveAttribute('src', 'https://www.aparat.com/video/video/embed/videohash/Xy12z/vt/frame?autoplay=true');

  const gallery = page.locator('#section-gallery-1');
  await expect(gallery.getByRole('link', { name: 'Fixture Pharma' })).toHaveAttribute('href', 'https://sponsor.example.org/');

  const links = page.locator('#section-links-1');
  await expect(links.getByRole('heading', { name: 'Stay in touch' })).toBeVisible();
  await expect(links.getByRole('link', { name: 'Telegram channel' })).toHaveAttribute('href', 'https://t.me/congress');
  await expect(links.getByRole('link', { name: 'Telegram channel' })).toHaveAttribute('target', '_blank');
  await expect(links.getByRole('link', { name: 'Write to us' })).toHaveAttribute('href', 'mailto:info@example.org');
  await expect(links.getByText('Never shown')).toHaveCount(0);
});

test('the new blocks never widen a phone screen', async ({ page }) => {
  await publicFixture(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/e/${slug}`);
  await expect(page.locator('#section-links-1')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

const KEY = 'synthetic-page-blocks-organizer';

async function studioFixture(page: Page) {
  const saves: Array<{ revision: number; document: typeof DOC }> = [];
  const draft = { ...DOC, branding: { accent: 'auto', accent_color: null, logo_asset_id: null }, sections: DOC.sections.filter((s) => ['about', 'passes', 'exhibitors'].includes(s.type)) };
  let state = { event_id: EVENT.id, draft, draft_revision: 1, draft_updated_at: '2099-01-01T10:00:00Z', is_published: false, published_revision: null, published_at: null, has_unpublished_changes: true };
  await page.addInitScript((key) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', 'en');
  }, KEY);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.headers().authorization !== `Bearer ${KEY}`) return json(401, { detail: 'Invalid API key' });
    if (path === `/api/events/${EVENT.id}`) return json(200, { ...EVENT, page: undefined });
    if (path === `/api/events/${EVENT.id}/media`) return json(200, []);
    if (path === `/api/events/${EVENT.id}/page/preview`) return json(200, { ...EVENT, page: { document: state.draft, assets: [] }, booths: [] });
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'GET') return json(200, state);
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}');
      saves.push(body);
      state = { ...state, draft: body.document, draft_revision: body.revision + 1 };
      return json(200, state);
    }
    return json(200, []);
  });
  return saves;
}

test('organizers paste a video and channel links, format text with the toolbar, and style a section', async ({ page }) => {
  const saves = await studioFixture(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/organizer/events/${EVENT.id}/page`);
  const frame = page.frameLocator('[data-testid=page-preview-frame]');

  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^Video/ }).click();
  const videoField = page.getByLabel('Video link');
  await videoField.fill('vimeo.com/123');
  await expect(page.getByText('This is not a YouTube or Aparat video address.')).toBeVisible();
  await videoField.fill('https://youtu.be/dQw4w9WgXcQ?si=share');
  await expect(page.getByText('YouTube video found.')).toBeVisible();
  await expect(frame.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'All sections' }).click();

  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^Links & channels/ }).click();
  await page.getByLabel('Link address').fill('t.me/fixture_congress');
  await expect(page.getByText('Recognised as Telegram.')).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Telegram channel' })).toHaveAttribute('href', 'https://t.me/fixture_congress');
  await page.getByRole('button', { name: 'All sections' }).click();

  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('dialog', { name: 'Add a section' }).getByRole('button', { name: /^Text/ }).click();
  const body = page.getByLabel('Text', { exact: true });
  await body.fill('Welcome everyone');
  await body.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 7));
  await page.getByRole('toolbar', { name: 'Text formatting' }).getByRole('button', { name: 'Bold' }).click();
  await expect(body).toHaveValue('**Welcome** everyone');
  await expect(frame.locator('strong', { hasText: 'Welcome' })).toBeVisible();
  await page.getByText('Appearance').click();
  await page.getByRole('group', { name: 'Background' }).getByText('Dark').click();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' }).first()).toBeVisible();
  const sent = saves[0].document.sections as Array<Record<string, unknown>>;
  expect(sent.find((s) => s.type === 'video')).toMatchObject({ provider: 'youtube', video_id: 'dQw4w9WgXcQ' });
  expect(sent.find((s) => s.type === 'links')).toMatchObject({ items: [{ kind: 'telegram', url: 'https://t.me/fixture_congress' }] });
  expect(sent.find((s) => s.type === 'rich_text')).toMatchObject({ body: { en: '**Welcome** everyone' }, style: { background: 'ink' } });
});
