import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// The organizer SMS section against synthetic, intercepted /api/ responses (not FastAPI/PostgreSQL).
// The browser runs in New York while the congress is in Tehran (+03:30): every time shown must be Tehran's.
test.use({ timezoneId: 'America/New_York', viewport: { width: 1280, height: 800 } });

const KEY = 'synthetic-org4-sms';
const bearer = `Bearer ${KEY}`;
const EVENT = { id: 'event-a', name: 'Alpha Congress', slug: 'event-a', starts_at: '2099-05-10T07:00:00Z', ends_at: '2099-05-12T15:00:00Z', location: 'Hall', description: '', timezone: 'Asia/Tehran', archived_at: null as string | null };
const SMS_DEFAULT = '{name} عزیز، ثبت‌نام شما در «{event}» تأیید شد.\nکارت ورود: {link}';

type Message = Record<string, unknown>;
const message = (id: string, extra: Message = {}): Message => ({
  id, kind: 'ticket_confirmation', mobile: '0912***0001', body: 'Sara عزیز…', status: 'sent', attempts: 1, last_error: null,
  created_at: '2099-01-01T08:00:00Z', sent_at: '2099-01-01T08:00:00Z', link_opened_at: null, can_retry: false, can_resolve: false, ...extra,
});

interface Options { delivery?: 'smsir' | 'console' | 'unconfigured'; log?: Message[]; role?: 'owner' | 'manager' | 'staff' | 'viewer'; archived?: boolean }
type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  let template = { kind: 'ticket_confirmation', body: SMS_DEFAULT, is_custom: false, default_body: SMS_DEFAULT, placeholders: ['name', 'event', 'tier', 'location', 'link'], required: [] };
  const log: Message[] = [...(options.log ?? [message('m-0', { status: 'pending', sent_at: null })])];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    requests.push({ method, path, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/api/organizer/me') return json(200, { kind: options.role ? 'member' : 'key', role: options.role ?? 'owner', organizer: { id: 'org-1', name: 'Org' }, member: null });
    if (path === '/api/events/event-a') return json(200, { ...EVENT, archived_at: options.archived ? '2099-06-01T00:00:00Z' : null });
    if (path === '/api/events/event-a/sms') {
      return json(200, { delivery: options.delivery ?? 'console', templates: [template], sample: { name: 'نام شرکت‌کننده', event: EVENT.name, tier: 'Delegate', location: EVENT.location, link: 'http://test/t/abc' } });
    }
    if (path === '/api/events/event-a/sms/templates/ticket_confirmation') {
      if (method === 'PUT') template = { ...template, body: JSON.parse(raw ?? '{}').body.trim(), is_custom: true };
      else template = { ...template, body: SMS_DEFAULT, is_custom: false };
      return json(200, template);
    }
    if (path === '/api/events/event-a/sms/test') {
      const text = JSON.parse(raw ?? '{}').body;
      log.unshift(message(`m-${log.length}`, { kind: 'test', mobile: '0935***4567', body: text }));
      return json(200, { status: 'sent', test_mode: true, error: null });
    }
    const action = path.match(/^\/api\/events\/event-a\/sms\/messages\/([^/]+)\/(retry|resolve)$/);
    if (action) {
      const index = log.findIndex(m => m.id === action[1]);
      log[index] = { ...log[index], status: action[2] === 'resolve' ? 'resolved' : 'pending', last_error: null, can_retry: false, can_resolve: false };
      return json(200, log[index]);
    }
    if (path === '/api/events/event-a/sms/messages') {
      const before = url.searchParams.get('before');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const start = before ? log.findIndex(m => m.id === before) + 1 : 0;
      return json(200, log.slice(start, start + limit));
    }
    return json(200, []);
  });
  return requests;
}

async function seed(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(({ key, locale }) => {
    sessionStorage.setItem('congress_organizer_api_key', key);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { key: KEY, locale });
}

const logList = (page: Page) => page.getByTestId('sms-log');

test('the organizer edits the confirmation with placeholders, sees the preview and SMS count, saves, tests and resets', async ({ page }) => {
  const requests = await fixture(page);
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  await expect(page.getByRole('heading', { name: 'SMS', level: 1 })).toBeVisible();
  await expect(page.getByTestId('sms-delivery')).toContainText('Test mode: nothing is sent.');
  await expect(page.getByText('Default text')).toBeVisible();
  await expect(page.getByTestId('sms-preview')).toContainText('نام شرکت‌کننده عزیز، ثبت‌نام شما در «Alpha Congress» تأیید شد.');
  await expect(page.getByTestId('sms-size')).toHaveText(/^\d+ characters · \d+ SMS$/);
  await expect(page.getByRole('button', { name: 'Save text' })).toBeDisabled();
  await expect(logList(page).getByText('Waiting to send')).toBeVisible();

  const editor = page.getByLabel('Message text');
  await editor.fill('Hello {nmae}');
  await expect(page.getByRole('alert').filter({ hasText: 'Unknown placeholder' })).toContainText('Unknown placeholder: {nmae}');
  await expect(page.getByRole('button', { name: 'Save text' })).toBeDisabled();
  await editor.fill('Hello ');
  await page.getByRole('button', { name: /Attendee name/ }).click();
  await editor.press('End');
  await editor.pressSequentially(' — ');
  await page.getByRole('button', { name: /Pass link/ }).click();
  await expect(editor).toHaveValue('Hello {name} — {link}');
  // The pass link is inserted whole, never shortened like the other values.
  await expect(page.getByTestId('sms-preview')).toHaveText('Hello نام شرکت‌کننده — http://test/t/abc');

  await expect(page.getByText('Only to this congress\'s operators, booth staff or pass holders; 10 per hour.')).toBeVisible();
  await page.getByLabel('Send a test to').fill('۰۹۳۵ ۱۲۳ ۴۵۶۷');
  await page.getByRole('button', { name: 'Send test SMS' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test mode: the message was only recorded' })).toBeVisible();
  const test = requests.find(r => r.path === '/api/events/event-a/sms/test');
  expect(test?.body).toEqual({ mobile: '09351234567', kind: 'ticket_confirmation', body: 'Hello {name} — {link}' });
  await expect(logList(page).getByText('0935***4567')).toBeVisible();

  await page.getByRole('button', { name: 'Save text' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await expect(page.getByText('Custom for this congress')).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path.endsWith('/sms/templates/ticket_confirmation'))?.body).toEqual({ body: 'Hello {name} — {link}' });

  await page.getByRole('button', { name: 'Use the default text' }).click();
  await page.getByRole('dialog', { name: 'Use the default text?' }).getByRole('button', { name: 'Use default' }).click();
  await expect(page.getByText('Default text', { exact: true })).toBeVisible();
  await expect(editor).toHaveValue(/عزیز/);
  expect(requests.some(r => r.method === 'DELETE' && r.path.endsWith('/sms/templates/ticket_confirmation'))).toBe(true);
  expect(requests.every(r => r.auth === bearer)).toBe(true);
});

test('the log shows readable kinds and failures, never gateway text or raw keys, in congress time', async ({ page }) => {
  await fixture(page, {
    delivery: 'smsir',
    log: [
      message('m-failed', { status: 'failed', last_error: 'smsir: 401 Unauthorized', attempts: 6, can_retry: true }),
      message('m-otp', { kind: 'otp', mobile: '0912***0002' }),
      message('m-new', { kind: 'brand_new_kind', mobile: '0912***0003' }),
      message('m-gone', { kind: 'ticket_reissued', status: 'failed', last_error: 'ACCOUNT_DELETED', mobile: '0912***0004' }),
    ],
  });
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  await expect(logList(page).getByRole('listitem')).toHaveCount(4);
  // Live delivery needs no banner.
  await expect(page.getByTestId('sms-delivery')).toHaveCount(0);
  const text = await page.locator('#organizer-main-content').innerText();
  for (const raw of ['smsir', 'sms.ir', '401', 'otp', 'brand_new_kind', 'ticket_confirmation', 'ACCOUNT_DELETED']) expect(text, raw).not.toContain(raw);
  const failed = logList(page).getByRole('listitem').filter({ hasText: '0912***0001' });
  await expect(failed.getByTestId('sms-failure')).toHaveText('Not delivered: gateway error.');
  await expect(failed.getByTestId('sms-failure')).toHaveAttribute('title', 'smsir: 401 Unauthorized');
  await expect(logList(page).getByRole('listitem').filter({ hasText: '0912***0002' })).toContainText('Sign-in code');
  await expect(logList(page).getByRole('listitem').filter({ hasText: '0912***0003' })).toContainText('SMS');
  await expect(logList(page).getByRole('listitem').filter({ hasText: '0912***0004' })).toContainText('Not sent: the account was deleted.');
  // 08:00 UTC is 11:30 in Tehran (the browser is in New York).
  await expect(failed).toContainText('11:30');

  // Persian: the same, with Persian digits and Jalali dates.
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await page.reload();
  await expect(logList(page).getByRole('listitem')).toHaveCount(4);
  const fa = await page.locator('#organizer-main-content').innerText();
  for (const raw of ['smsir', 'sms.ir', 'otp', 'brand_new_kind', 'بلیت']) expect(fa, raw).not.toContain(raw);
  await expect(logList(page).getByRole('listitem').filter({ hasText: '۰۹۱۲***۰۰۰۱' })).toContainText('ارسال نشد؛ درگاه پیامک خطا داد.');
  await expect(logList(page).getByRole('listitem').filter({ hasText: '۰۹۱۲***۰۰۰۱' })).toContainText('۱۱:۳۰');
});

test('a failed confirmation is sent again; an unknown one is resent only after a warning, or resolved', async ({ page }) => {
  const requests = await fixture(page, {
    log: [
      message('m-failed', { status: 'failed', attempts: 6, last_error: 'HTTP_400', can_retry: true }),
      message('m-unknown', { mobile: '0912***0002', status: 'unknown', last_error: 'TIMEOUT', can_retry: true, can_resolve: true }),
    ],
  });
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  const failed = logList(page).getByRole('listitem').filter({ hasText: '0912***0001' });
  const unknown = logList(page).getByRole('listitem').filter({ hasText: '0912***0002' });
  await expect(unknown.getByTestId('sms-failure')).toHaveText('May have arrived: the gateway did not answer.');

  await failed.getByRole('button', { name: 'Send again' }).click();
  await expect(failed.getByText('Waiting to send')).toBeVisible();
  expect(requests.find(r => r.path.endsWith('/m-failed/retry'))?.body).toEqual({ confirm_duplicate: false });

  await unknown.getByRole('button', { name: 'Send again' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send this message again?' });
  await expect(dialog).toContainText('may deliver it twice');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(requests.some(r => r.path.endsWith('/m-unknown/retry'))).toBe(false);

  await unknown.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(unknown.getByText('Resolved')).toBeVisible();
  await expect(unknown.getByRole('button', { name: 'Send again' })).toHaveCount(0);
});

test('older messages load page by page after the last one shown', async ({ page }) => {
  const log = Array.from({ length: 52 }, (_, i) => message(`m-${i}`, { kind: 'test', mobile: `0912***${String(i).padStart(4, '0')}` }));
  const requests = await fixture(page, { log });
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  await expect(logList(page).getByRole('listitem')).toHaveCount(50);
  await page.getByRole('button', { name: 'Older messages' }).click();
  await expect(logList(page).getByRole('listitem')).toHaveCount(52);
  await expect(logList(page).getByText('0912***0051')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Older messages' })).toHaveCount(0);
  const pages = requests.filter(r => r.method === 'GET' && r.path === '/api/events/event-a/sms/messages');
  expect(pages).toHaveLength(2);
});

test('an unconfigured gateway is the only other banner; viewers and archived congresses get the text read-only', async ({ page }) => {
  await fixture(page, { delivery: 'unconfigured' });
  await seed(page);
  await page.goto('/organizer/events/event-a/sms');
  await expect(page.getByTestId('sms-delivery')).toHaveText('SMS isn\'t set up yet; messages wait in the queue.');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page, { role: 'viewer' });
  await page.goto('/organizer/events/event-a/sms');
  await expect(page.getByRole('heading', { name: 'Registration confirmation SMS' })).toBeVisible();
  await expect(page.getByLabel('Message text')).toHaveCount(0);
  await expect(page.getByTestId('sms-log')).toHaveCount(0);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page, { archived: true, log: [message('m-failed', { status: 'failed', last_error: 'HTTP_400', can_retry: true })] });
  await page.goto('/organizer/events/event-a/sms');
  await expect(page.getByTestId('section-archived')).toBeVisible();
  await expect(page.getByLabel('Message text')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send test SMS' })).toHaveCount(0);
  await expect(logList(page).getByRole('listitem')).toHaveCount(1);
  await expect(logList(page).getByRole('button', { name: 'Send again' })).toHaveCount(0);
});
