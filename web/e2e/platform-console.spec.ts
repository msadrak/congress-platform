import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping platform console + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E
// (backend/tests/test_platform_console.py covers the real API).
const TOKEN = 'synthetic-platform-admin-token';
const KEY = 'sk_live_abcdefghijklmnop1234';
const OTP_DEFAULT = 'کد ورود همایش: {code}\nتا {minutes} دقیقه معتبر است؛ آن را به کسی ندهید.';
const CONFIRMATION_DEFAULT = '{name} عزیز، ثبت‌نام شما در «{event}» تأیید شد.\nکارت ورود: {link}';

type Recorded = { method: string; path: string; auth: string | undefined; admin: string | undefined; body: unknown };

async function fixture(page: Page, options: { statusCode?: number; environment?: string; members?: Record<string, unknown>[] } = {}) {
  const requests: Recorded[] = [];
  let sms = { mode: 'console', mode_source: 'environment', effective: 'console', api_key_set: false, api_key_hint: null as string | null, api_key_source: null as string | null, api_key_unreadable: false, line_number: null as number | null, line_number_source: null as string | null, console_allowed: true, hourly_cap: 2000, daily_cap: 20000, caps_source: { hourly_cap: 'environment', daily_cap: 'environment' } as Record<string, string> };
  let signIn = { otp_length: 6, otp_ttl_seconds: 120, otp_resend_cooldown_seconds: 60, otp_sends_per_mobile_per_hour: 5, otp_sends_per_ip_per_hour: 100, otp_sends_per_trusted_ip_per_hour: 2000, otp_trusted_networks: [] as string[], sources: { otp_length: 'environment', otp_ttl_seconds: 'environment', otp_resend_cooldown_seconds: 'environment', otp_sends_per_mobile_per_hour: 'environment', otp_sends_per_ip_per_hour: 'environment', otp_sends_per_trusted_ip_per_hour: 'environment', otp_trusted_networks: 'environment' } as Record<string, string> };
  const templates: Record<string, Record<string, unknown>> = {
    otp: { kind: 'otp', body: OTP_DEFAULT, is_custom: false, default_body: OTP_DEFAULT, placeholders: ['code', 'minutes'], required: ['code'] },
    ticket_confirmation: { kind: 'ticket_confirmation', body: CONFIRMATION_DEFAULT, is_custom: false, default_body: CONFIRMATION_DEFAULT, placeholders: ['name', 'event', 'tier', 'location', 'link'], required: [] },
  };
  const organizers = [{ id: 'org-1', name: 'Alpha Society', created_at: '2099-01-01T00:00:00Z', revoked_at: null as string | null, key_rotated_at: null as string | null }];
  const members: Record<string, unknown>[] = [...(options.members ?? [])];
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    const headers = request.headers();
    requests.push({ method, path, auth: headers.authorization, admin: headers['x-admin-token'], body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (options.statusCode) return json(options.statusCode, { detail: 'blocked' });
    if (headers['x-admin-token'] !== TOKEN) return json(401, { detail: 'Invalid admin token' });
    if (path === '/api/platform/status') return json(200, { environment: options.environment ?? 'staging', public_origin: 'https://congress.example.org', sms, sign_in: signIn });
    if (path === '/api/platform/sms' && method === 'PUT') {
      if (body.mode) sms = { ...sms, mode: body.mode, mode_source: 'console' };
      if (body.api_key) sms = { ...sms, api_key_set: true, api_key_hint: `…${body.api_key.slice(-4)}`, api_key_source: 'console' };
      if (body.line_number) sms = { ...sms, line_number: body.line_number, line_number_source: 'console' };
      for (const cap of ['hourly_cap', 'daily_cap'] as const) {
        if (body[cap] !== undefined) sms = { ...sms, [cap]: body[cap], caps_source: { ...sms.caps_source, [cap]: 'console' } };
        if ((body.reset as string[]).includes(cap)) sms = { ...sms, [cap]: cap === 'hourly_cap' ? 2000 : 20000, caps_source: { ...sms.caps_source, [cap]: 'environment' } };
      }
      sms = { ...sms, effective: sms.mode === 'console' ? 'console' : sms.api_key_set && sms.line_number ? 'smsir' : 'unconfigured' };
      return json(200, sms);
    }
    if (path === '/api/platform/sms/outbox') return json(200, { counts: { pending: 3, sending: 0, sent: 41, failed: 2, unknown: 1, resolved: 0 }, oldest_pending_at: '2099-01-01T08:00:00Z', sent_last_hour: 12, sent_last_day: 44, hourly_cap: sms.hourly_cap, daily_cap: sms.daily_cap });
    if (path === '/api/platform/sms/check') return json(200, { ok: true, credit: 125000, lines: [30001234, 50002222], line_ok: body.line_number === 30001234, error: null });
    if (path === '/api/platform/sms/test') return json(200, { status: 'sent', text: String(body.body).replace('{code}', '111111'), error: null, test_mode: false });
    if (path === '/api/platform/sms-templates') return json(200, Object.values(templates));
    const kind = path.match(/^\/api\/platform\/sms-templates\/([a-z_]+)$/)?.[1];
    if (kind) {
      templates[kind] = method === 'PUT' ? { ...templates[kind], body: body.body.trim(), is_custom: true } : { ...templates[kind], body: templates[kind].default_body, is_custom: false };
      return json(200, templates[kind]);
    }
    if (path === '/api/platform/sign-in' && method === 'PUT') {
      for (const [k, v] of Object.entries(body)) if (k !== 'reset') { (signIn as Record<string, unknown>)[k] = v; signIn.sources[k] = 'console'; }
      for (const k of body.reset as string[]) { (signIn as Record<string, unknown>)[k] = k === 'otp_length' ? 6 : (signIn as Record<string, unknown>)[k]; signIn.sources[k] = 'environment'; }
      signIn = { ...signIn };
      return json(200, signIn);
    }
    if (path === '/api/organizers' && method === 'GET') return json(200, organizers);
    if (path === '/api/organizers' && method === 'POST') {
      organizers.push({ id: 'org-2', name: body.name, created_at: '2099-01-02T00:00:00Z', revoked_at: null, key_rotated_at: null });
      return json(201, { id: 'org-2', name: body.name, api_key: 'new-organizer-key-0001' });
    }
    if (path === '/api/organizers/org-1/rotate-key') {
      organizers[0].key_rotated_at = '2099-01-03T00:00:00Z';
      return json(200, { id: 'org-1', name: 'Alpha Society', api_key: 'rotated-organizer-key-0002' });
    }
    if (path === '/api/organizers/org-1/members' && method === 'GET') return json(200, members);
    if (path === '/api/organizers/org-1/members' && method === 'POST') {
      if (members.some(m => m.mobile === body.mobile && !m.revoked_at)) return json(409, { detail: 'This number is already a member', code: 'MEMBER_EXISTS' });
      const added = { id: `m-${members.length + 1}`, display_name: body.display_name, mobile: body.mobile, role: body.role, invited_by: 'Platform admin', created_at: '2099-01-05T00:00:00Z', revoked_at: null };
      members.push(added);
      return json(201, added);
    }
    if (path === '/api/organizers/org-1/revoke') {
      organizers[0].revoked_at = '2099-01-04T00:00:00Z';
      return json(200, organizers[0]);
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function openConsole(page: Page, locale = 'en') {
  await page.goto('/');
  await page.evaluate(l => localStorage.setItem('congress_attendee_locale', l), locale);
  await page.goto('/platform');
  await page.getByLabel('Platform admin token').fill(TOKEN);
  await page.getByRole('button', { name: 'Open the console' }).click();
}

test('the token gate explains a wrong token and a blocked network, and keeps the token for this tab only', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'en'));
  await page.goto('/platform');
  await page.getByLabel('Platform admin token').fill('wrong');
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page.getByRole('alert')).toContainText('was not accepted');

  await page.getByLabel('Platform admin token').fill(TOKEN);
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page.getByRole('heading', { name: 'SMS', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('congress_platform_admin_token'))).toBe(TOKEN);
  expect(await page.evaluate(() => localStorage.getItem('congress_platform_admin_token'))).toBeNull();
  expect(requests.filter(r => r.admin === TOKEN).every(r => r.auth === undefined)).toBe(true);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Platform admin token')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('congress_platform_admin_token'))).toBeNull();

  await page.unrouteAll();
  await fixture(page, { statusCode: 404 });
  await page.getByLabel('Platform admin token').fill(TOKEN);
  await page.getByRole('button', { name: 'Open the console' }).click();
  await expect(page.getByRole('alert')).toContainText('CONGRESS_ADMIN_ALLOW');
});

test('the SMS gateway is checked and saved from the console; the key is never shown again', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  await expect(page.getByTestId('gateway-state')).toContainText('Test mode');

  await page.getByLabel('Live delivery through sms.ir').check();
  await page.getByLabel('sms.ir API key').fill(KEY);
  await page.getByLabel('Service line number').fill('۳۰۰۰۱۲۳۴');
  await page.getByRole('button', { name: 'Check connection & credit' }).click();
  await expect(page.getByTestId('gateway-check')).toContainText('Account credit: 125,000');
  await expect(page.getByTestId('gateway-check')).toContainText('30001234, 50002222');
  expect(requests.find(r => r.path === '/api/platform/sms/check')?.body).toEqual({ api_key: KEY, line_number: 30001234 });

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('gateway-state')).toContainText('Live');
  await expect(page.getByLabel('sms.ir API key')).toHaveValue('');
  await expect(page.getByText('Saved …1234')).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/platform/sms')?.body).toEqual({ mode: 'smsir', api_key: KEY, line_number: 30001234, reset: [] });
  expect(await page.locator('body').innerText()).not.toContain(KEY);
});

test('the sign-in text must keep {code}; it is saved and tested from the console', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  const otp = page.getByRole('region', { name: 'Sign-in code SMS (every congress)' });
  await expect(otp.getByTestId('sms-preview')).toContainText('کد ورود همایش: 111111');
  const editor = otp.getByLabel('Message text');
  await editor.fill('AITeb code');
  await expect(otp.getByText('Required placeholder: {code}')).toBeVisible();
  await expect(otp.getByRole('button', { name: 'Save text' })).toBeDisabled();
  await editor.fill('AITeb code ');
  await otp.getByRole('button', { name: /Sign-in code/ }).click();
  await expect(editor).toHaveValue('AITeb code {code}');
  await otp.getByLabel('Send a test to').fill('09121112233');
  await otp.getByRole('button', { name: 'Send test SMS' }).click();
  await expect(otp.getByRole('status').filter({ hasText: 'Test message sent through sms.ir.' })).toBeVisible();
  expect(requests.find(r => r.path === '/api/platform/sms/test')?.body).toEqual({ mobile: '09121112233', kind: 'otp', body: 'AITeb code {code}' });
  await otp.getByRole('button', { name: 'Save text' }).click();
  await expect(otp.getByText('Custom text')).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/platform/sms-templates/otp')?.body).toEqual({ body: 'AITeb code {code}' });
});

test('sign-in rules are saved and can go back to the .env value', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  await page.getByRole('link', { name: 'Sign-in' }).click();
  await page.getByLabel('Code digits').fill('9');
  await expect(page.getByRole('alert')).toContainText('outside the allowed range');
  await page.getByLabel('Code digits').fill('4');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved and applied.' })).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/platform/sign-in')?.body).toEqual({ otp_length: 4, reset: [] });
  // An inline text action, but a full 44 px tap target.
  expect((await page.getByRole('button', { name: 'Use .env' }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Use .env' }).click();
  await expect(page.getByLabel('Code digits')).toHaveValue('6');
  await expect(page.getByRole('status').filter({ hasText: '“Code digits” now follows the .env value.' })).toBeVisible();
});

test('venue networks get their own budget from the sign-in rules', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  await page.getByRole('link', { name: 'Sign-in' }).click();
  await page.getByTestId('trusted-networks').fill('203.0.113.0/24\n192.0.2.7');
  await page.getByLabel('Codes per venue network address per hour').fill('3000');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved and applied.' })).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/platform/sign-in')?.body).toEqual({
    otp_sends_per_trusted_ip_per_hour: 3000, otp_trusted_networks: ['203.0.113.0/24', '192.0.2.7'], reset: [],
  });
});

test('the SMS page shows outbox counts and saves the platform caps', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  await page.getByRole('link', { name: 'SMS' }).click();
  const outbox = page.getByRole('region', { name: 'Outbox and SMS caps' });
  await expect(outbox.getByTestId('outbox-counts')).toContainText('Failed2');
  await expect(outbox).toContainText('12 / 2,000');
  await outbox.getByLabel('SMS per hour (cap)').fill('500');
  await outbox.getByRole('button', { name: 'Save caps' }).click();
  await expect(outbox.getByRole('status').filter({ hasText: 'Caps saved and applied immediately.' })).toBeVisible();
  expect(requests.find(r => r.method === 'PUT' && r.path === '/api/platform/sms')?.body).toEqual({ hourly_cap: 500, daily_cap: 20000, reset: [] });
  await outbox.getByRole('button', { name: 'Use the .env values' }).click();
  await expect(outbox.getByLabel('SMS per hour (cap)')).toHaveValue('2000');
});

test('organizers are created, rotated and revoked from the console; keys are shown once', async ({ page }) => {
  await fixture(page);
  await openConsole(page);
  await page.getByRole('link', { name: 'Organizers' }).click();
  await expect(page.getByText('Alpha Society')).toBeVisible();
  await expect(page).toHaveTitle('Organizers · Platform console');
  await page.getByLabel('New organizer name').fill('Beta Union');
  await page.getByRole('button', { name: 'Create and issue key' }).click();
  await expect(page.getByTestId('issued-key')).toContainText('new-organizer-key-0001');
  await page.getByRole('button', { name: 'Handed over, hide it' }).click();
  await expect(page.getByText('new-organizer-key-0001')).toHaveCount(0);

  await page.getByRole('button', { name: 'Rotate key' }).first().click();
  await page.getByRole('dialog', { name: 'Issue a new key?' }).getByRole('button', { name: 'Issue new key' }).click();
  await expect(page.getByTestId('issued-key')).toContainText('rotated-organizer-key-0002');

  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await page.getByRole('dialog', { name: 'Revoke this organizer?' }).getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Revoked')).toBeVisible();
  await page.getByRole('button', { name: 'Reinstate with a new key' }).click();
  const reinstate = page.getByRole('dialog', { name: 'Reinstate this organizer?' });
  await expect(reinstate).toContainText('can sign in again with a new key, shown once.');
  await expect(reinstate.getByRole('button', { name: 'Reinstate' })).toBeVisible();
  await reinstate.getByRole('button', { name: 'Cancel' }).click();
});

test('a request that gets no response says so and ends its spinner', async ({ page }) => {
  await fixture(page);
  await openConsole(page);
  const offline = 'Could not reach the server. Check your connection and try again.';
  // Routes registered later take precedence over the fixture's.
  await page.route('**/api/platform/sign-in', route => route.abort('internetdisconnected'));
  await page.route('**/api/platform/sms', route => route.abort('internetdisconnected'));
  await page.route('**/api/organizers', route => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback()));

  await page.getByRole('link', { name: 'Sign-in' }).click();
  await page.getByLabel('Code digits').fill('4');
  await page.getByRole('button', { name: 'Save rules' }).click();
  await expect(page.getByRole('alert')).toContainText(offline);
  await expect(page.getByRole('button', { name: 'Save rules' })).toBeEnabled();

  await page.getByRole('link', { name: 'SMS' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('alert').filter({ hasText: offline })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeEnabled();

  await page.getByRole('link', { name: 'Organizers' }).click();
  await page.getByLabel('New organizer name').fill('Beta Union');
  await page.getByRole('button', { name: 'Create and issue key' }).click();
  await expect(page.getByRole('alert').filter({ hasText: offline })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and issue key' })).toBeEnabled();
});

test('Persian RTL at 320px: the console is right-to-left and fits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await fixture(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await page.goto('/platform');
  await page.getByLabel('توکن مدیر سامانه').fill(TOKEN);
  await page.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(page.getByRole('heading', { name: 'پیامک', level: 1 })).toBeVisible();
  for (const path of ['/platform', '/platform/sign-in', '/platform/organizers']) {
    await page.goto(path);
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBe(0);
  }
});

test('the platform admin lists an organizer\'s members and adds its first owner', async ({ page }) => {
  const requests = await fixture(page);
  await openConsole(page);
  await page.getByRole('link', { name: 'Organizers' }).click();
  await expect(page.getByText('members sign in to the console with their mobile number and an SMS code')).toBeVisible();
  await expect(page.getByText('The API key is an integration key')).toBeVisible();

  await page.getByRole('button', { name: 'Members of “Alpha Society”' }).click();
  const dialog = page.getByRole('dialog', { name: 'Members of “Alpha Society”' });
  await expect(dialog.getByText('No members yet. Add the first owner.')).toBeVisible();
  await expect(dialog.getByLabel('Role')).toHaveValue('owner');
  await dialog.getByLabel('Full name').fill('Neda Karimi');
  await dialog.getByLabel('Mobile number').fill('0912 345 6789');
  await dialog.getByRole('button', { name: 'Add and send SMS' }).click();
  await expect(dialog.getByRole('status')).toContainText('Neda Karimi was added');
  const list = dialog.getByTestId('platform-members');
  await expect(list).toContainText('Neda Karimi');
  await expect(list).toContainText('0912 345 6789');
  await expect(list).toContainText('Owner');
  await expect(list).toContainText('Added by Platform admin');
  expect(requests.find(r => r.method === 'POST' && r.path === '/api/organizers/org-1/members')?.body).toEqual({ display_name: 'Neda Karimi', mobile: '09123456789', role: 'owner' });

  await dialog.getByLabel('Full name').fill('Someone Else');
  await dialog.getByLabel('Mobile number').fill('12');
  await dialog.getByRole('button', { name: 'Add and send SMS' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter a valid mobile number');
});

test('Persian console: localized environment, members and coded errors, no raw English', async ({ page }) => {
  await fixture(page, {
    environment: 'production',
    members: [{ id: 'm-1', display_name: 'مهدی کلانی', mobile: '09121112233', role: 'owner', invited_by: 'api-key', created_at: '2099-01-02T00:00:00Z', revoked_at: null }],
  });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('congress_attendee_locale', 'fa'));
  await page.goto('/platform');
  await page.getByLabel('توکن مدیر سامانه').fill(TOKEN);
  await page.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(page.getByTestId('platform-environment')).toHaveText('محیط اصلی');

  await page.getByRole('link', { name: 'برگزارکنندگان' }).click();
  await page.getByRole('button', { name: 'اعضای «Alpha Society»' }).click();
  const dialog = page.getByRole('dialog', { name: 'اعضای «Alpha Society»' });
  const list = dialog.getByTestId('platform-members');
  await expect(list).toContainText('افزوده‌شده به دست کلید API');
  await expect(list).toContainText('۰۹۱۲ ۱۱۱ ۲۲۳۳');
  await expect(list).toContainText('مالک');
  await expect(list).not.toContainText('api-key');
  // Persian digits keep the sans font (IBM Plex Mono covers only Latin).
  expect(await list.getByText('۰۹۱۲ ۱۱۱ ۲۲۳۳').evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/Plex Mono/);

  await dialog.getByLabel('نام و نام خانوادگی').fill('نفر دوم');
  await dialog.getByLabel('شماره موبایل').fill('09121112233');
  await dialog.getByRole('button', { name: 'افزودن و ارسال پیامک' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('این شماره هم‌اکنون عضو این سازمان است.');
});
