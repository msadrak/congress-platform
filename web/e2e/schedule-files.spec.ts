import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping Organizer and Attendee pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The backend contract (raw-body upload, sandboxed public serving) is covered by backend/tests/test_program_files.py.
const KEY = 'synthetic-b4-organizer';
const bearer = `Bearer ${KEY}`;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

const EVENT = {
  id: 'event-a',
  name: 'Alpha Congress',
  slug: 'alpha',
  starts_at: '2099-05-10T05:30:00Z',
  ends_at: '2099-05-12T14:30:00Z',
  location: 'Alpha Hall',
  description: 'About Alpha',
  timezone: 'Asia/Tehran',
  registration_enabled: true,
  registration_opens_at: null,
  registration_closes_at: null,
  listed: false,
  archived_at: null,
};

interface StoredFile {
  id: string;
  event_id: string;
  label: string;
  kind: 'pdf' | 'image';
  content_type: string;
  position: number;
  is_visible: boolean;
  byte_size: number;
  width: number | null;
  height: number | null;
  page_count: number | null;
  created_at: string;
  content_url: string;
  bytes: Buffer;
}

type Recorded = { method: string; path: string; search: string; auth: string | undefined; contentType: string | undefined; size: number };

async function fixture(page: Page, options: { rejectPdf?: boolean } = {}) {
  const requests: Recorded[] = [];
  const files: StoredFile[] = [];
  let next = 1;
  const out = ({ bytes: _bytes, ...file }: StoredFile) => file;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = request.postDataBuffer();
    requests.push({ method, path, search: url.search, auth: request.headers().authorization, contentType: request.headers()['content-type'], size: body?.length ?? 0 });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    const sorted = () => [...files].sort((a, b) => a.position - b.position);

    if (path === '/api/public/events/alpha') {
      const visible = sorted().filter(f => f.is_visible);
      return json(200, {
        ...EVENT,
        page: null,
        ticket_tiers: [],
        venue: [],
        sessions: [],
        registration_open: true,
        program_files: visible.map(f => ({ id: f.id, label: f.label, kind: f.kind, content_type: f.content_type, byte_size: f.byte_size, width: f.width, height: f.height, page_count: f.page_count, url: `/api/public/program-files/${f.id}` })),
      });
    }
    const publicFile = path.match(/^\/api\/public\/program-files\/([^/]+)$/);
    if (publicFile) {
      const file = files.find(f => f.id === publicFile[1] && f.is_visible);
      if (!file) return json(404, { detail: 'Schedule file not found' });
      return route.fulfill({
        status: 200,
        contentType: file.content_type,
        headers: { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': file.kind === 'pdf' ? 'sandbox' : "default-src 'none'; sandbox" },
        body: file.bytes,
      });
    }
    if (path.startsWith('/api/public/')) return json(200, []);

    if (path === '/api/events') return json(200, [EVENT]);
    if (path === '/api/events/event-a') return json(200, EVENT);
    if (path === '/api/events/event-a/program-files' && method === 'GET') return json(200, sorted().map(out));
    if (path === '/api/events/event-a/program-files' && method === 'POST') {
      const type = request.headers()['content-type'];
      if (type === 'application/pdf' && options.rejectPdf) return json(415, { detail: 'PDFs with scripts, launch actions or embedded files are not accepted.', code: 'PROGRAM_FILE_PDF_REJECTED' });
      const id = `file-${next++}`;
      const isPdf = type === 'application/pdf';
      const file: StoredFile = {
        id,
        event_id: 'event-a',
        label: url.searchParams.get('label') ?? '',
        kind: isPdf ? 'pdf' : 'image',
        content_type: isPdf ? 'application/pdf' : 'image/webp',
        position: files.length,
        is_visible: true,
        byte_size: body?.length ?? 0,
        width: isPdf ? null : 1200,
        height: isPdf ? null : 800,
        page_count: isPdf ? 1 : null,
        created_at: `2099-01-01T00:00:0${next}Z`,
        content_url: `/api/events/event-a/program-files/${id}/content`,
        bytes: isPdf ? PDF : PNG,
      };
      files.push(file);
      return json(201, out(file));
    }
    const one = path.match(/^\/api\/events\/event-a\/program-files\/([^/]+)$/);
    if (one) {
      const index = files.findIndex(f => f.id === one[1]);
      if (index < 0) return json(404, { detail: 'Schedule file not found', code: 'PROGRAM_FILE_NOT_FOUND' });
      if (method === 'PATCH') {
        files[index] = { ...files[index], ...JSON.parse(body?.toString() ?? '{}') };
        return json(200, out(files[index]));
      }
      if (method === 'DELETE') {
        files.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
    }
    return json(200, []);
  });
  return { requests, files };
}

async function seed(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
}

test('the organizer uploads a PDF and an image; attendees see the image inline and a PDF button', async ({ page }) => {
  const { requests, files } = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/program');
  const section = page.getByTestId('schedule-files');
  await expect(section.getByText('No schedule file yet.')).toBeVisible();

  await section.getByLabel('Label').fill('Full programme');
  await section.locator('input[type=file]').setInputFiles({ name: 'programme.pdf', mimeType: 'application/pdf', buffer: PDF });
  await section.getByRole('button', { name: 'Upload' }).click();
  await expect(section.getByText('“Full programme” uploaded.')).toBeVisible();

  // The label is suggested from the file name when left empty.
  await section.locator('input[type=file]').setInputFiles({ name: 'hall_map.png', mimeType: 'image/png', buffer: PNG });
  await expect(section.getByLabel('Label')).toHaveValue('hall map');
  await section.getByRole('button', { name: 'Upload' }).click();
  await expect(section.getByTestId('schedule-file')).toHaveCount(2);
  await expect(section.getByTestId('schedule-file').nth(1)).toContainText('1,200×800');

  const uploads = requests.filter(r => r.method === 'POST');
  expect(uploads.map(r => [r.search, r.contentType, r.size, r.auth])).toEqual([
    ['?label=Full%20programme', 'application/pdf', PDF.length, bearer],
    ['?label=hall%20map', 'image/png', PNG.length, bearer],
  ]);

  // Move the image first, then hide and show it again.
  await section.getByRole('button', { name: 'Move hall map up' }).click();
  await expect(section.getByTestId('schedule-file').first()).toContainText('hall map');
  expect(files.find(f => f.label === 'hall map')?.position).toBe(0);
  await section.getByRole('button', { name: 'Hide hall map' }).click();
  await expect(section.getByTestId('schedule-file').first().getByText('Hidden')).toBeVisible();

  // Attendee details, in Persian: only visible files; the hidden image is not offered.
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await page.goto('/c/alpha/details');
  const shown = page.getByTestId('public-schedule-files');
  const pdfButton = shown.getByRole('link', { name: /مشاهدهٔ برنامه \(PDF\)/ });
  await expect(pdfButton).toBeVisible();
  await expect(pdfButton).toHaveAttribute('href', '/api/public/program-files/file-1');
  await expect(pdfButton).toHaveAttribute('target', '_blank');
  await expect(shown.getByRole('img')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await page.goto('/organizer/events/event-a/program');
  await page.getByTestId('schedule-files').getByRole('button', { name: 'Show hall map' }).click();
  await expect(page.getByTestId('schedule-files').getByText('Hidden')).toHaveCount(0);

  await page.goto('/c/alpha/details');
  const image = page.getByTestId('public-schedule-files').getByRole('img', { name: 'hall map' });
  await expect(image).toBeVisible();
  expect(await image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Tap opens the full-size image in a new tab.
  const link = page.getByTestId('public-schedule-files').getByRole('link', { name: /hall map/ });
  await expect(link).toHaveAttribute('href', '/api/public/program-files/file-2');
  // The schedule files are the program here: no "no sessions" placeholder beside them.
  expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined)).toBe(true);
});

test('refused uploads show coded, localized errors and delete asks first', async ({ page }) => {
  await fixture(page, { rejectPdf: true });
  await seed(page, 'fa');
  await page.goto('/organizer/events/event-a/program');
  const section = page.getByTestId('schedule-files');

  await section.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await section.getByRole('button', { name: 'بارگذاری' }).click();
  await expect(section.getByText('فقط فایل PDF یا تصویر PNG، JPEG یا WebP پذیرفته می‌شود.')).toBeVisible();

  await section.locator('input[type=file]').setInputFiles({ name: 'scripted.pdf', mimeType: 'application/pdf', buffer: PDF });
  await section.getByRole('button', { name: 'بارگذاری' }).click();
  await expect(section.getByText(/این PDF پذیرفته نشد/)).toBeVisible();

  // Each new file replaces the label suggested from the previous one.
  await section.locator('input[type=file]').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: PNG });
  await expect(section.getByLabel('عنوان فایل')).toHaveValue('map');
  await section.getByRole('button', { name: 'بارگذاری' }).click();
  await expect(section.getByTestId('schedule-file')).toHaveCount(1);
  await section.getByRole('button', { name: 'حذف map' }).click();
  await page.getByRole('button', { name: 'حذف فایل' }).click();
  await expect(section.getByTestId('schedule-file')).toHaveCount(0);
  await expect(section.getByText('فایل «map» حذف شد.')).toBeVisible();
});
