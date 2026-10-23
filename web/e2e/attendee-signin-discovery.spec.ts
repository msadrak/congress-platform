import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Shipping pages + synthetic, intercepted /api/ responses: not FastAPI/PostgreSQL E2E.
// The real-backend journey is recorded in ATTENDEE_COMPLETION_MILESTONE.md.
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
const bearer = `Bearer ${token}`;
const MOBILE = '09121234567';
const CODE = '482913';

interface FixtureEvent { id: string; name: string; slug: string; [field: string]: unknown }
interface FixtureBooth { id: string; name: string; slug: string; location: string; description: string; website_url: string; brochure_url: string }

const event = (slug: string, id: string, name: string): FixtureEvent => ({
  id, name, slug, starts_at: '2027-05-10T07:00:00Z', ends_at: '2027-05-12T15:00:00Z',
  location: 'Fixture Hall', description: `About ${name}`, ticket_tiers: [], venue: [], sessions: [],
});
const EVENTS: Record<string, FixtureEvent> = {
  alpha: event('alpha', 'event-a', 'Alpha Congress'),
  beta: event('beta', 'event-b', 'Beta Summit'),
};
const booth = (id: string, name: string): FixtureBooth => ({
  id, name, slug: id, location: `Hall ${name}`, description: `${name} description`,
  website_url: 'https://example.test', brochure_url: '',
});
const BOOTHS: Record<string, FixtureBooth[]> = {
  alpha: [booth('booth-1', 'Zeta Pharma'), booth('booth-2', 'Alpha Devices')],
  beta: [booth('booth-9', 'Beta Only Booth')],
};
const ticket = {
  id: 'ticket-alpha', event_id: 'event-a', event_name: 'Alpha Congress', event_slug: 'alpha',
  event_location: 'Fixture Hall', event_starts_at: '2027-05-10T07:00:00Z', event_ends_at: '2027-05-12T15:00:00Z',
  ticket_tier_id: 't', ticket_tier_name: 'Pass alpha', attendee_name: 'Sara Fixture',
  attendee_mobile: MOBILE, status: 'active', qr_secret: 'qr-alpha', created_at: '2027-01-01T00:00:00Z',
};
const user = { id: 'user-1', mobile: MOBILE, full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false };

type Recorded = { method: string; path: string; auth: string | undefined; body: unknown };
interface Options {
  requestStatus?: number;
  requestCode?: string;
  /** sms.ir did not confirm the send in time. */
  uncertain?: boolean;
  retryAfter?: string;
  verifyStatus?: number;
  verifyAbort?: boolean;
  newNumber?: boolean;
  bookmarkFails?: boolean;
  privacyFails?: boolean;
  scanStatus?: number;
}

async function fixture(page: Page, options: Options = {}) {
  const requests: Recorded[] = [];
  const saved = new Set<string>();
  let share = false;
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const raw = request.postData();
    requests.push({ method, path, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined });
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/auth/otp/request') {
      if (options.requestStatus) return route.fulfill({ status: options.requestStatus, contentType: 'application/json', headers: { 'Retry-After': options.retryAfter ?? '42' }, body: JSON.stringify({ detail: 'no', code: options.requestCode }) });
      return json(202, { mobile: JSON.parse(raw ?? '{}').mobile, code_length: 6, expires_in: 120, resend_after: 60, delivery: options.uncertain ? 'uncertain' : 'sent' });
    }
    if (path === '/api/auth/otp/verify') {
      if (options.verifyAbort) return route.abort('failed');
      if (options.verifyStatus) return route.fulfill({ status: options.verifyStatus, contentType: 'application/json', headers: { 'Retry-After': options.retryAfter ?? '42' }, body: '{"detail":"Too many attempts"}' });
      if (JSON.parse(raw ?? '{}').code !== CODE) return json(401, { detail: 'The code is wrong or has expired.' });
      return options.newNumber
        ? json(200, { status: 'profile_required', access_token: null, token_type: 'bearer', user: null, signup_token: 'signup-fixture' })
        : json(200, { status: 'signed_in', access_token: token, token_type: 'bearer', user, signup_token: null });
    }
    if (path === '/api/auth/otp/complete') {
      const body = JSON.parse(raw ?? '{}');
      return json(201, { access_token: token, token_type: 'bearer', user: { ...user, full_name: body.full_name, organization: body.organization } });
    }
    const pubEvent = path.match(/^\/api\/public\/events\/([^/]+)$/);
    if (pubEvent) return EVENTS[pubEvent[1]] ? json(200, EVENTS[pubEvent[1]]) : json(404, { detail: 'Event not found' });
    const pubBooths = path.match(/^\/api\/public\/events\/([^/]+)\/booths$/);
    if (pubBooths) return BOOTHS[pubBooths[1]] ? json(200, BOOTHS[pubBooths[1]]) : json(404, { detail: 'Event not found' });

    if (request.headers().authorization !== bearer) return json(401, { detail: 'Invalid authorization token' });
    if (path === '/api/auth/me') return json(200, { ...user, share_contact_with_peers: share });
    if (path === '/api/attendees/me/tickets') return json(200, [ticket]);
    if (path === '/api/attendees/me/network') return json(200, []);
    if (path === '/api/attendees/me/network/search') return json(200, { items: [], total: 0, next_cursor: null });
    if (path === '/api/attendees/me/network/c' && method === 'PATCH') {
      return json(200, { id: 'c', connected_user_id: 'p', full_name: 'Peer', mobile: null, organization: '', title: '', event_id: 'event-a', private_notes: JSON.parse(raw ?? '{}').private_notes, created_at: '2027-01-01T00:00:00Z' });
    }
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    if (path === '/api/attendees/me/network/scan') {
      return options.scanStatus === 409
        ? json(409, { detail: 'This badge belongs to a different congress' })
        : json(options.scanStatus ?? 201, { id: 'c', connected_user_id: 'p', full_name: 'Peer', mobile: null, organization: '', title: '', event_id: 'event-a', private_notes: '', created_at: '2027-01-01T00:00:00Z' });
    }
    if (path === '/api/attendees/me/network/privacy') {
      if (method === 'PATCH') {
        if (options.privacyFails) return json(500, { detail: 'boom' });
        const update: { share_contact_with_peers: boolean } = JSON.parse(raw ?? '{}');
        share = update.share_contact_with_peers;
      }
      return json(200, { share_contact_with_peers: share });
    }
    if (path === '/api/attendees/me/bookmarks/booths') {
      return json(200, [...saved].map(id => ({ booth_id: id, name: id, slug: id, location: '', description: '', website_url: '', brochure_url: '', event_name: 'Alpha Congress', event_slug: 'alpha', bookmarked_at: '2027-01-01T00:00:00Z' })));
    }
    const bm = path.match(/^\/api\/attendees\/me\/bookmarks\/booths\/([^/]+)$/);
    if (bm) {
      if (options.bookmarkFails) return json(500, { detail: 'boom' });
      if (method === 'POST') saved.add(bm[1]); else saved.delete(bm[1]);
      return json(method === 'POST' ? 201 : 200, { bookmarked: method === 'POST', booth_id: bm[1] });
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

async function seed(page: Page, entries: Record<string, string>) {
  await page.goto('/');
  await page.evaluate(values => { for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v); }, entries);
}
const signedIn = (page: Page) => seed(page, { congress_attendee_token: token, congress_attendee_locale: 'en' });
const anonymous = (page: Page) => seed(page, { congress_attendee_locale: 'en' });

async function signInWithCode(page: Page, mobile: string = MOBILE, code: string = CODE) {
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  // The whole code submits itself, as when the phone autofills it from the SMS.
  await page.getByLabel('Code from the SMS').fill(code);
}

test.describe('direct attendee sign-in', () => {
  test('an unconfirmed send says the code may still arrive; a platform SMS cap is named', async ({ page }) => {
    await fixture(page, { uncertain: true });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByTestId('otp-delivery-uncertain')).toContainText('The code may still arrive');

    await page.unrouteAll();
    await fixture(page, { requestStatus: 503, requestCode: 'SMS_HOURLY_CAP_REACHED' });
    await page.goto('/c/alpha/sign-in');
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('alert')).toContainText('SMS limit for this hour');
  });

  test('signed-out portal page leads to sign-in and returns to the same destination', async ({ page }) => {
    const requests = await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/my-profile');
    // The page has the phone form itself; the header's log in is the way to the full sign-in page.
    await page.locator('header').getByRole('link', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in\?next=%2Fc%2Falpha%2Fmy-profile$/);
    // The sign-in page's own heading: the page being left has a «Sign in» heading and the congress name too.
    await expect(page.getByRole('heading', { name: 'Sign in to your attendee portal' })).toBeVisible();
    await expect(page.getByText('Alpha Congress').first()).toBeVisible();

    await signInWithCode(page, '۰۹۱۲ ۱۲۳ ۴۵۶۷');  // Persian digits and spaces, as typed on a phone
    await expect(page).toHaveURL(/\/c\/alpha\/my-profile$/);
    await expect(page.getByText('Heart Center')).toBeVisible();

    const sent = requests.find(r => r.path === '/api/auth/otp/request');
    expect(sent?.body).toEqual({ mobile: MOBILE, purpose: 'signin' });
    const verify = requests.find(r => r.path === '/api/auth/otp/verify');
    expect(verify?.auth).toBeUndefined();
    expect(verify?.body).toEqual({ mobile: MOBILE, code: CODE });
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(CODE);
  });

  test('a missing or invalid number is reported without a request; a wrong code and a network failure are distinct', async ({ page }) => {
    const requests = await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');

    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter your mobile number.')).toBeVisible();
    await page.getByLabel('Mobile number').fill('021 1234 5678');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText('Enter a valid Iranian mobile number')).toBeVisible();
    expect(requests.some(r => r.path === '/api/auth/otp/request')).toBe(false);

    await signInWithCode(page, MOBILE, '000000');
    await expect(page.getByText('The code is wrong or has expired.')).toBeVisible();
    await expect(page).toHaveURL(/sign-in$/);
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();

    await page.unrouteAll();
    await fixture(page, { verifyAbort: true });
    await page.getByLabel('Code from the SMS').fill(CODE);
    await expect(page.getByRole('alert')).toContainText('Could not reach the server');
  });

  test('a new number completes a short profile, then continues to the destination', async ({ page }) => {
    const requests = await fixture(page, { newNumber: true });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-profile');
    await signInWithCode(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Complete your profile');
    await expect(page.getByText('This is your first sign-in with this number.')).toBeVisible();
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await page.getByLabel('Full name').fill('Neda Karimi');
    await page.getByLabel('Organization (optional)').fill('Heart Center');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/my-profile$/);
    expect(requests.find(r => r.path === '/api/auth/otp/complete')?.body).toEqual({
      signup_token: 'signup-fixture', full_name: 'Neda Karimi', organization: 'Heart Center', title: '',
    });
  });

  test('too many codes requested shows how long to wait', async ({ page }) => {
    await fixture(page, { requestStatus: 429 });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByTestId('otp-rate-limit')).toContainText(/You can ask for a new one in \u2066?0:4[12]\u2069?\./);
    await expect(page.getByTestId('otp-announcer')).toHaveText('Too many codes requested. You can ask for a new one in 42 seconds.');
    // The language toggle re-renders the message rather than keeping the English text.
    await page.getByRole('button', { name: 'تغییر زبان به فارسی' }).click();
    await expect(page.getByTestId('otp-rate-limit')).toContainText('دیگر می‌توانید کد تازه بگیرید');
  });

  test('a 429 locks only the throttled action with a live countdown, then unlocks it', async ({ page }) => {
    const requests = await fixture(page, { requestStatus: 429, retryAfter: '4' });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await page.getByLabel('Mobile number').fill(MOBILE);
    const send = page.getByRole('button', { name: 'Send code' });
    await send.click();
    await expect(send).toHaveAttribute('aria-disabled', 'true');
    await expect(send).toBeFocused();  // aria-disabled keeps the button focusable, unlike disabled
    await expect(page.getByTestId('otp-rate-limit')).toContainText('0:0');
    // Activating the locked button (Playwright's click would wait for it to unlock) sends nothing.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    expect(requests.filter(r => r.path === '/api/auth/otp/request')).toHaveLength(1);

    await expect(send).not.toHaveAttribute('aria-disabled', 'true', { timeout: 6000 });
    await expect(page.getByTestId('otp-rate-limit')).toHaveCount(0);
    await expect(page.getByTestId('otp-announcer')).toHaveText('You can try again now.');
    await send.click();
    await expect.poll(() => requests.filter(r => r.path === '/api/auth/otp/request').length).toBe(2);
  });

  test('a 429 on the code locks checking but not changing the number', async ({ page }) => {
    await fixture(page, { verifyStatus: 429, retryAfter: '120' });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await signInWithCode(page);
    const verify = page.getByRole('button', { name: 'Continue' });
    await expect(verify).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('otp-rate-limit')).toContainText(/You can try again in \u2066?(2:00|1:59)\u2069?\./);
    await page.getByRole('button', { name: 'Change number' }).click();
    await expect(page.getByRole('button', { name: 'Send code' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('a pasted SMS fills only the code and submits it; editing clears an error', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    const field = page.getByLabel('Code from the SMS');
    await field.fill('000000');
    await expect(page.getByText('The code is wrong or has expired.')).toBeVisible();
    await field.press('Backspace');
    await expect(page.getByText('The code is wrong or has expired.')).toHaveCount(0);

    await field.fill('');
    await field.evaluate((input, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, 'کد ورود شما: ۴۸۲۹۱۳\nاعتبار ۲ دقیقه');
    await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);
  });

  test('the new-number profile keeps its heading and button in view on a short screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await fixture(page, { newNumber: true });
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await signInWithCode(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Complete your profile');
    await expect(page.getByRole('button', { name: 'Create my account' })).toBeInViewport({ ratio: 1 });
    await page.getByLabel('Full name').fill('Neda Karimi');
    await expect(page.getByRole('button', { name: 'Create my account' })).toBeInViewport({ ratio: 1 });
  });

  test('the code field stays on screen with a short (keyboard-sized) viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/sign-in');
    await page.getByLabel('Mobile number').fill(MOBILE);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByLabel('Code from the SMS')).toBeInViewport({ ratio: 1 });
  });

  test('the sign-in page never links to the platform root', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    for (const path of ['/c/alpha/sign-in', '/sign-in', '/booth/booth-1/sign-in', '/c/nope/sign-in']) {
      await page.goto(path);
      await expect(page.getByLabel('Mobile number')).toBeVisible();
      await expect(page.locator('a[href="/"]')).toHaveCount(0);
    }
    await page.goto('/c/alpha/sign-in');
    await expect(page.getByRole('link', { name: /Alpha Congress|Attendee Portal/ }).first()).toHaveAttribute('href', '/e/alpha');
  });

  test('external and unknown return destinations are ignored', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    for (const next of ['https://evil.example/', '//evil.example', '/organizer', '/c/alpha/../../organizer']) {
      await page.goto(`/c/alpha/sign-in?next=${encodeURIComponent(next)}`);
      await signInWithCode(page);
      await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/);
      await page.evaluate(() => localStorage.removeItem('congress_attendee_token'));
    }
  });

  test('a valid existing session is kept and can continue or be replaced explicitly', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await expect(page.getByTestId('existing-session')).toContainText('Sara Fixture');
    await expect(page.getByTestId('existing-session')).toContainText('0912 123 4567');
    await expect(page.getByLabel('Mobile number')).toHaveCount(0);
    expect(requests.find(r => r.path === '/api/auth/me')?.auth).toBe(bearer);
    await page.getByRole('link', { name: /Continue/ }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/);

    await page.goto('/c/alpha/sign-in');
    await page.getByRole('button', { name: 'Not you? Sign out' }).click();
    await expect(page.getByLabel('Mobile number')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
  });

  test('a valid existing session continues on its own to the safe destination', async ({ page }) => {
    await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await expect(page.getByTestId('existing-session')).toContainText('Taking you there in a moment');
    await expect(page).toHaveURL(/\/c\/alpha\/my-ticket$/, { timeout: 5000 });

    // An unsafe `next` still lands on the congress fallback.
    await page.goto(`/c/alpha/sign-in?next=${encodeURIComponent('https://evil.example/')}`);
    await expect(page).toHaveURL(/\/c\/alpha\/my-congress$/, { timeout: 5000 });

    // Reaching for the card stops the timer.
    await page.goto('/c/alpha/sign-in?next=%2Fc%2Falpha%2Fmy-ticket');
    await page.getByTestId('existing-session').getByText('Sara Fixture').click();
    await page.waitForTimeout(2600);
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in/);
  });

  test('a rejected stored session shows the form instead of a false signed-in state', async ({ page }) => {
    await fixture(page);
    await seed(page, { congress_attendee_token: 'stale-token', congress_attendee_locale: 'en' });
    await page.goto('/c/alpha/sign-in');
    await expect(page.getByLabel('Mobile number')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('congress_attendee_token'))).toBeNull();
  });

  test('the event page header offers sign-in straight to that congress', async ({ page }) => {
    await fixture(page);
    await anonymous(page);
    await page.goto('/e/alpha');
    await page.getByRole('link', { name: 'Attendee Sign In' }).click();
    await expect(page).toHaveURL(/\/c\/alpha\/sign-in\?next=/);
  });

  test('Persian RTL sign-in at 320px has no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await fixture(page);
    await seed(page, { congress_attendee_locale: 'fa' });
    await page.goto('/c/alpha/sign-in');
    await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
    await expect(page.getByLabel('شماره موبایل')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  });
});

test.describe('booth directory in My Congress', () => {
  test('anonymous visitors see only this congress booths without credentials', async ({ page }) => {
    const requests = await fixture(page);
    await anonymous(page);
    await page.goto('/c/alpha/my-congress');
    const directory = page.getByRole('region', { name: /Exhibition booths/ });
    await expect(directory.getByText('Alpha Devices', { exact: true })).toBeVisible();
    await expect(directory.getByText('Zeta Pharma', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta Only Booth')).toHaveCount(0);
    await expect(directory.getByRole('link', { name: /View booth/ }).first()).toHaveAttribute('href', /\/e\/alpha\/booths\/booth-/);
    await expect(directory.getByRole('button')).toHaveCount(0);
    expect(requests.every(r => r.path.startsWith('/api/public/') && r.auth === undefined)).toBe(true);
  });

  test('a signed-in attendee saves and removes a booth with user authority; failures leave state unchanged', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-congress');
    const save = page.getByRole('button', { name: 'Save Alpha Devices' });
    await save.click();
    const saved = page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' });
    await expect(saved).toBeEnabled();
    expect(requests.find(r => r.method === 'POST' && r.path.endsWith('/booth-2'))?.auth).toBe(bearer);
    expect(requests.filter(r => r.path.startsWith('/api/public/')).every(r => r.auth === undefined)).toBe(true);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Alpha Devices from saved booths' }).click();
    await expect(page.getByRole('button', { name: 'Save Alpha Devices' })).toBeEnabled();

    await page.unrouteAll();
    await fixture(page, { bookmarkFails: true });
    await page.reload();
    await page.getByRole('button', { name: 'Save Zeta Pharma' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not update');
    await expect(page.getByRole('button', { name: 'Save Zeta Pharma' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Remove Zeta Pharma from saved booths' })).toHaveCount(0);
  });

  test('an empty congress and a failing directory are honest states', async ({ page }) => {
    await fixture(page);
    EVENTS.gamma = event('gamma', 'event-g', 'Gamma Forum');
    BOOTHS.gamma = [];
    await anonymous(page);
    await page.goto('/c/gamma/my-congress');
    await expect(page.getByText('No booths have been listed for this congress yet.')).toBeVisible();
    delete EVENTS.gamma;
    delete BOOTHS.gamma;

    await page.unrouteAll();
    await fixture(page);
    // Registered last, so it takes precedence over the fixture route.
    await page.route(/\/api\/public\/events\/alpha\/booths$/, route => route.fulfill({ status: 500, body: '{}' }));
    await page.goto('/c/alpha/my-congress');
    await expect(page.getByRole('alert')).toContainText('could not be loaded');
  });
});

test.describe('My Profile', () => {
  test('the contact-sharing switch persists through the API', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await page.goto('/c/alpha/my-profile');
    await expect(page.getByLabel('Organization')).toHaveValue('Heart Center');

    const toggle = page.getByRole('switch', { name: /Share my mobile number with colleagues/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('status').filter({ hasText: 'Setting saved.' })).toBeVisible();
    const patch = requests.find(r => r.method === 'PATCH');
    expect(patch?.auth).toBe(bearer);
    expect(patch?.body).toEqual({ share_contact_with_peers: true });

    await page.reload();
    await expect(page.getByRole('switch', { name: /Share my mobile number with colleagues/ })).toHaveAttribute('aria-checked', 'true');
    expect(requests.some(r => r.method === 'PATCH' && r.path !== '/api/attendees/me/network/privacy')).toBe(false);
  });

  test('a failed update keeps the previous value and says so', async ({ page }) => {
    await fixture(page, { privacyFails: true });
    await signedIn(page);
    await page.goto('/c/alpha/my-profile');
    const toggle = page.getByRole('switch', { name: /Share my mobile number with colleagues/ });
    await toggle.click();
    await expect(page.getByRole('alert')).toContainText('not saved');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});

declare global {
  interface Window { __cameraRequests?: number; __cameraTracks?: MediaStreamTrack[] }
}

/** A fake camera (painted canvas stream) and a native QR detector that sees `decoded` (or nothing). */
async function fakeCamera(page: Page, decoded: string | null) {
  await page.addInitScript(value => {
    window.__cameraRequests = 0;
    window.__cameraTracks = [];
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          window.__cameraRequests = (window.__cameraRequests ?? 0) + 1;
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 48;
          const context = canvas.getContext('2d');
          let dark = false;
          const paint = () => {
            dark = !dark;
            if (!context) return;
            context.fillStyle = dark ? '#111' : '#eee';
            context.fillRect(0, 0, canvas.width, canvas.height);
          };
          paint();
          setInterval(paint, 50);
          const stream = canvas.captureStream(10);
          window.__cameraTracks?.push(...stream.getTracks());
          return stream;
        },
      },
    });
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: class {
        async detect() { return value ? [{ rawValue: value }] : []; }
      },
    });
  }, decoded);
}

test.describe('event-scoped badge scan', () => {
  async function scan(page: Page) {
    await page.goto('/c/alpha/my-network');
    await page.getByRole('tab', { name: 'Scan' }).click();
    await page.getByRole('button', { name: 'No camera? Enter the code' }).click();
    await page.getByLabel("Colleague's pass code").fill('some-peer-secret');
    await page.getByRole('button', { name: 'Add to My Network' }).click();
  }

  test('the congress id is sent and an other-congress badge shows an error', async ({ page }) => {
    const requests = await fixture(page, { scanStatus: 409 });
    await signedIn(page);
    await scan(page);
    await expect(page.getByRole('alert')).toContainText('belongs to another congress and was not saved');
    expect(requests.find(r => r.path === '/api/attendees/me/network/scan')?.body).toMatchObject({ event_id: 'event-a' });
  });

  test('a typed code saves the connection and names the new contact', async ({ page }) => {
    const requests = await fixture(page);
    await signedIn(page);
    await scan(page);
    await expect(page.getByRole('status').filter({ hasText: 'Peer was added to your network.' })).toBeVisible();
    expect(requests.find(r => r.path === '/api/attendees/me/network/scan')?.body).toEqual({ qr_secret: 'some-peer-secret', private_notes: '', event_id: 'event-a' });
  });

  test('re-scanning an existing contact says they are already connected', async ({ page }) => {
    await fixture(page, { scanStatus: 200 });
    await signedIn(page);
    await scan(page);
    await expect(page.getByRole('status').filter({ hasText: 'Peer is already in your network.' })).toBeVisible();
  });

  test('?scan=1 opens the scan sheet once; a scanned pass QR connects with one tap and the note follows', async ({ page }) => {
    const requests = await fixture(page);
    await fakeCamera(page, 'Peer-Secret');
    await signedIn(page);
    await page.goto('/c/alpha/my-network?scan=1');
    await expect(page.getByRole('tab', { name: 'Scan' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/c\/alpha\/my-network$/);
    // The camera waits for the user's tap: no permission request on open.
    expect(await page.evaluate(() => window.__cameraRequests)).toBe(0);

    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Peer was added to your network.' })).toBeVisible();
    expect(requests.find(r => r.path === '/api/attendees/me/network/scan')?.body).toEqual({ qr_secret: 'Peer-Secret', private_notes: '', event_id: 'event-a' });
    expect(await page.evaluate(() => (window.__cameraTracks ?? []).map(track => track.readyState))).toEqual(['ended']);

    // The private note is written after the scan, then saved on the new connection.
    await page.getByLabel('Private note about this meeting').fill('Met at the poster session');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Note saved.' }).first()).toBeVisible();
    expect(requests.find(r => r.method === 'PATCH' && r.path === '/api/attendees/me/network/c')?.body).toEqual({ private_notes: 'Met at the poster session' });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'No contacts yet' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'My code' })).toHaveAttribute('aria-selected', 'true');
  });

  test('leaving the scan sheet releases a live camera', async ({ page }) => {
    await fixture(page);
    await fakeCamera(page, null);
    await signedIn(page);
    await page.goto('/c/alpha/my-network');
    await page.getByRole('tab', { name: 'Scan' }).click();
    await page.getByRole('button', { name: 'Scan with camera' }).click();
    await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible();
    await page.getByRole('tab', { name: 'My code' }).click();
    await expect(page.getByRole('button', { name: 'Stop camera' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window.__cameraTracks ?? []).map(track => track.readyState))).toEqual(['ended']);
  });
});
