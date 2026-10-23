import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The public hero image on phones and desktops (client issue: the landing-page image was cropped, hidden
// and laid out differently per device), plus its Page Studio controls. Synthetic, intercepted /api/.
const EVENT = { id: 'event-h', name: 'Hero Congress', slug: 'hero-congress', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hero Hall', description: 'Operational description' };
const TIERS = [{ id: 'tier-1', name: 'Delegate', description: '', quota: 100, reserved_count: 10, is_open: true }];
const KEY = 'synthetic-hero-organizer';
const t = (en = '', fa = '') => ({ en, fa });
const section = (type: string, id: string) => ({ type, id, visible: true, eyebrow: t(), title: t() });
const IMAGES = {
  wide: { width: 2400, height: 900, fill: '#1f6fb2' },
  tall: { width: 1080, height: 1350, fill: '#7b5cff' },
};
type ImageName = keyof typeof IMAGES;
const asset = (name: ImageName, url = `/api/public/media/${name}`) => ({ id: name, url, width: IMAGES[name].width, height: IMAGES[name].height, content_type: 'image/svg+xml' });
const svg = (name: ImageName) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGES[name].width}" height="${IMAGES[name].height}"><rect width="100%" height="100%" fill="${IMAGES[name].fill}"/><text x="40" y="160" font-size="120" fill="#fff">${name}</text></svg>`;

function documentWith(hero: Record<string, unknown>) {
  return {
    version: 1,
    primary_locale: 'en',
    branding: { accent: 'auto', logo_asset_id: null },
    hero: { layout: 'signature', eyebrow: t(), title: t(), subtitle: t('Three days of talks and workshops.'), cta_label: t(), cover_asset_id: null, ...hero },
    seo: { title: t(), description: t(), share_image_asset_id: null },
    sections: [section('about', 'about'), section('passes', 'passes'), section('exhibitors', 'exhibitors')],
  };
}

async function publicPage(page: Page, hero: Record<string, unknown>, images: ImageName[]) {
  await page.addInitScript(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const media = path.match(/^\/api\/public\/media\/(wide|tall)$/);
    if (media) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(media[1] as ImageName) });
    const body = path.endsWith(`/${EVENT.slug}`)
      ? { ...EVENT, ticket_tiers: TIERS, venue: [], sessions: [], page: { document: documentWith(hero), assets: images.map((name) => asset(name)) } }
      : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`/e/${EVENT.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(EVENT.name);
}

/** Hero images other than the organizer logo, with their geometry once loaded and revealed. */
async function heroImages(page: Page) {
  const hero = page.locator('section[aria-labelledby="congress-title"]');
  await expect(hero.locator('img[data-loaded="true"]')).toHaveCount(1);
  return hero.locator('img').evaluateAll((imgs) =>
    imgs.map((img) => {
      const el = img as HTMLImageElement;
      const box = el.getBoundingClientRect();
      return { width: box.width, height: box.height, top: box.top, bottom: box.bottom, current: el.currentSrc, fit: getComputedStyle(el).objectFit, priority: el.getAttribute('fetchpriority') };
    }),
  );
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

for (const viewport of [PHONE, { width: 768, height: 1024 }, DESKTOP]) {
  test(`banner shows the whole image at its own proportions at ${viewport.width} px, without page overflow`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await publicPage(page, { layout: 'banner', cover_asset_id: 'wide' }, ['wide']);
    const [image, ...others] = await heroImages(page);
    expect(others).toHaveLength(0);
    expect(image.fit).toBe('fill');
    expect(image.priority).toBe('high');
    expect(Math.abs(image.width / image.height - 2400 / 900)).toBeLessThan(0.02);
    const contentWidth = Math.min(viewport.width, 1280) - (viewport.width >= 1024 ? 80 : viewport.width >= 640 ? 48 : 32);
    expect(Math.abs(image.width - contentWidth)).toBeLessThanOrEqual(1);
    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(image.bottom).toBeLessThanOrEqual(title!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}

test('a tall banner is capped in height without being cropped', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await publicPage(page, { layout: 'banner', cover_asset_id: 'tall' }, ['tall']);
  const [image] = await heroImages(page);
  expect(Math.abs(image.width / image.height - 1080 / 1350)).toBeLessThan(0.02);
  expect(image.height).toBeLessThanOrEqual(DESKTOP.height * 0.6 + 1);
});

for (const viewport of [PHONE, DESKTOP]) {
  test(`split keeps its framed image (one <img>) at ${viewport.width} px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await publicPage(page, { layout: 'split', cover_asset_id: 'wide', focal_x: 10, focal_y: 90 }, ['wide']);
    const images = await heroImages(page);
    expect(images).toHaveLength(1);
    const title = (await page.getByRole('heading', { level: 1 }).boundingBox())!;
    if (viewport === PHONE) expect(images[0].bottom).toBeLessThanOrEqual(title.y);
    else expect(images[0].top).toBeGreaterThan(0);
    expect(images[0].width).toBeLessThan(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const position = await page.locator('section[aria-labelledby="congress-title"] img').evaluate((img) => getComputedStyle(img).objectPosition);
    expect(position).toBe('10% 90%');
  });
}

test('cover uses the phone image below md and the main image above, anchored at the focal point', async ({ page }) => {
  const hero = { layout: 'cover', cover_asset_id: 'wide', mobile_cover_asset_id: 'tall', focal_x: 20, focal_y: 40 };
  await page.setViewportSize(PHONE);
  await publicPage(page, hero, ['wide', 'tall']);
  let [image, ...others] = await heroImages(page);
  expect(others).toHaveLength(0);
  expect(image.current).toContain('/api/public/media/tall');
  expect(image.top).toBeLessThan(80); // under the header, filling the open band above the text
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);

  await page.setViewportSize(DESKTOP);
  await page.reload();
  [image, ...others] = await heroImages(page);
  expect(others).toHaveLength(0);
  expect(image.current).toContain('/api/public/media/wide');
  const position = await page.locator('section[aria-labelledby="congress-title"] img').evaluate((img) => getComputedStyle(img).objectPosition);
  expect(position).toBe('20% 40%');
});

test('Page Studio: a first image switches to the banner; cover gets a focal point and a phone image', async ({ page }) => {
  const saves: Array<{ document: ReturnType<typeof documentWith> }> = [];
  let state = { event_id: EVENT.id, draft: documentWith({}), draft_revision: 1, draft_updated_at: '2099-01-01T10:00:00Z', is_published: true, published_revision: 1, published_at: '2099-01-01T10:00:00Z', has_unpublished_changes: false };
  const library = (['wide', 'tall'] as const).map((name) => ({ id: name, content_type: 'image/svg+xml', width: IMAGES[name].width, height: IMAGES[name].height, byte_size: 1000, created_at: '2099-01-01T10:00:00Z' }));
  await page.addInitScript((key) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', 'en');
  }, KEY);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const content = path.match(/\/media\/(wide|tall)\/content$/);
    if (content) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(content[1] as ImageName) });
    if (path === `/api/events/${EVENT.id}`) return json(200, EVENT);
    if (path === `/api/events/${EVENT.id}/media`) return json(200, library);
    if (path === `/api/events/${EVENT.id}/page/preview`) return json(200, { ...EVENT, ticket_tiers: TIERS, venue: [], sessions: [], page: { document: state.draft, assets: [] }, booths: [] });
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'GET') return json(200, state);
    if (path === `/api/events/${EVENT.id}/page` && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}');
      saves.push(body);
      state = { ...state, draft: body.document, draft_revision: body.revision + 1, has_unpublished_changes: true };
      return json(200, state);
    }
    return json(200, []);
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/organizer/events/${EVENT.id}/page`);
  await page.getByRole('tab', { name: 'Brand & hero' }).click();

  const layout = (name: string) => page.getByRole('radio', { name: new RegExp(`^${name}`) });
  await expect(layout('Signature')).toBeChecked();
  await page.getByRole('button', { name: 'Choose image' }).nth(1).click();
  await page.getByRole('dialog').getByRole('button', { name: /2400×900/ }).first().click();
  await expect(layout('Banner')).toBeChecked();
  await expect(page.getByRole('group', { name: 'Focal point' })).toHaveCount(0);

  await layout('Cover photo').check({ force: true });
  const focal = page.getByRole('group', { name: 'Focal point' });
  await expect(focal).toBeVisible();
  const horizontal = focal.getByRole('slider').first();
  await horizontal.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(focal.locator('output').first()).toHaveText('55%');
  await expect(page.getByText('Phone image (optional)')).toBeVisible();

  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved' }).first()).toBeVisible();
  expect(saves.at(-1)!.document.hero).toMatchObject({ layout: 'cover', cover_asset_id: 'wide', focal_x: 55, focal_y: 50, mobile_cover_asset_id: null });
});
