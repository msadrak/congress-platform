/**
 * Live-stack helpers: the API the specs provision through, SMS codes from the dev-only outbox, and the few UI steps
 * every persona shares (the SMS-code form, the organizer key gate). Set up by scripts/integration/live-e2e.mjs.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';

export const API_URL = process.env.LIVE_E2E_API_URL ?? process.env.LIVE_E2E_BASE_URL ?? '';
export const ADMIN_TOKEN = process.env.LIVE_E2E_ADMIN_TOKEN ?? '';

type ApiOptions = {
  /** Bearer credential: an organizer API key, or a user, desk, scanner or member token. */
  token?: string;
  admin?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
  /** Accepted statuses; anything else throws with the response body. */
  expect?: number[];
};

export type ApiResult<T> = { status: number; json: T; text: string };

/** One API call; throws unless the status is expected (2xx by default). */
export async function call<T = unknown>(method: string, path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.admin) headers['X-Admin-Token'] = ADMIN_TOKEN;
  const response = await fetch(`${API_URL}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  const ok = options.expect ? options.expect.includes(response.status) : response.status >= 200 && response.status < 300;
  if (!ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 500)}`);
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json: json as T, text };
}

export const api = async <T = unknown>(method: string, path: string, options: ApiOptions = {}): Promise<T> => (await call<T>(method, path, options)).json;

/** A short unique suffix for names and slugs (parallel workers never collide). */
export const uid = (): string => randomUUID().slice(0, 8);

/** A synthetic mobile number in the unassigned 0900 range, unique per call. */
export const uniqueMobile = (): string => `0900${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

/** Latin digits as Persian digits, as the UI prints numbers. */
export const persianDigits = (value: string | number): string => String(value).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));

type RecordedSms = { mobile: string; kind: string; text: string; code: string | null; sent_at: string };

/** Every SMS the console provider "sent" to `mobile`, newest first. */
export const outbox = (mobile: string): Promise<RecordedSms[]> => api<RecordedSms[]>('GET', `/api/platform/sms-outbox?mobile=${mobile}`, { admin: true });

/** The newest sign-in code sent to `mobile` after `since` (waits for it). */
export async function smsCode(mobile: string, since: number): Promise<string> {
  let code: string | null | undefined;
  await expect.poll(async () => {
    code = (await outbox(mobile)).find((m) => m.code && Date.parse(m.sent_at) >= since - 1000)?.code;
    return code;
  }, { message: `a sign-in code for ${mobile}`, timeout: 15_000 }).toBeTruthy();
  return code!;
}

/** Waits for an SMS of `kind` to `mobile` matching `predicate`, returning it. */
export async function waitForSms(mobile: string, kind: string, predicate: (sms: RecordedSms) => boolean = () => true): Promise<RecordedSms> {
  let found: RecordedSms | undefined;
  await expect.poll(async () => {
    found = (await outbox(mobile)).find((m) => m.kind === kind && predicate(m));
    return Boolean(found);
  }, { message: `a ${kind} SMS to ${mobile}`, timeout: 20_000 }).toBe(true);
  return found!;
}

/**
 * The shared SMS-code form (attendee, desk, booth, member sign-in): mobile, «ارسال کد», then the code, which submits
 * itself. A new number then lands on the profile step; pass `fullName` to complete it.
 */
export async function signInWithCode(scope: Page | Locator, mobile: string, fullName?: string): Promise<void> {
  const since = Date.now();
  await scope.getByLabel('شماره موبایل').fill(mobile);
  await scope.getByRole('button', { name: 'ارسال کد' }).click();
  const codeField = scope.getByLabel('کد پیامک‌شده');
  await expect(codeField).toBeVisible();
  await codeField.fill(await smsCode(mobile, since));
  if (fullName) {
    await scope.getByLabel('نام و نام خانوادگی').fill(fullName);
    await scope.getByRole('button', { name: 'ساخت حساب' }).click();
  }
}

/** Opens the organizer console with an API key through the real key gate. */
export async function organizerSignIn(page: Page, apiKey: string): Promise<void> {
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'کلید API' }).click();
  await page.getByLabel('کلید دسترسی (API Key)').fill(apiKey);
  await page.getByRole('button', { name: 'ورود به پیشخوان مدیریت' }).click();
  await expect(page.getByRole('heading', { name: 'مدیریت همایش‌ها و کنگره‌ها' })).toBeVisible();
}

// ── Provisioning through the API ──

export type Organizer = { id: string; api_key: string; name: string };
export type LiveEvent = { id: string; slug: string; name: string; timezone: string };
export type Tier = { id: string; name: string; quota: number };

export const createOrganizer = (name = `سازمان آزمون ${uid()}`): Promise<Organizer> =>
  api<Organizer>('POST', '/api/organizers', { admin: true, body: { name } });

const DAY = 86_400_000;

/**
 * An event 30 days ahead with registration open now (the window started yesterday), optionally with its public page
 * published (reserving needs a published page).
 */
export async function createEvent(apiKey: string, { name, publish = true }: { name?: string; publish?: boolean } = {}): Promise<LiveEvent> {
  const id = uid();
  const starts = new Date(Date.now() + 30 * DAY);
  starts.setUTCHours(5, 30, 0, 0);
  const event = await api<LiveEvent>('POST', '/api/events', {
    token: apiKey,
    body: {
      name: name ?? `همایش آزمون ${id}`,
      slug: `live-${id}`,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + DAY + 8 * 3_600_000).toISOString(),
      location: 'سالن همایش‌های آزمون',
      timezone: 'Asia/Tehran',
      registration_opens_at: new Date(Date.now() - DAY).toISOString(),
    },
  });
  if (publish) await publishPage(apiKey, event.id);
  return event;
}

export async function publishPage(apiKey: string, eventId: string): Promise<void> {
  const page = await api<{ draft_revision: number }>('GET', `/api/events/${eventId}/page`, { token: apiKey });
  await api('POST', `/api/events/${eventId}/page/publish`, { token: apiKey, body: { revision: page.draft_revision } });
}

export const createTier = (apiKey: string, eventId: string, name = `کارت عمومی ${uid()}`, quota = 50): Promise<Tier> =>
  api<Tier>('POST', `/api/events/${eventId}/ticket-tiers`, { token: apiKey, body: { name, quota } });

/** An attendee signed in through the API (signed up when new); returns the user token. */
export async function attendeeToken(mobile: string, fullName: string): Promise<string> {
  const since = Date.now();
  await api('POST', '/api/auth/otp/request', { body: { mobile, purpose: 'signin' }, expect: [202] });
  const verified = await api<{ status: string; access_token?: string; signup_token?: string }>('POST', '/api/auth/otp/verify', { body: { mobile, code: await smsCode(mobile, since) } });
  if (verified.status === 'signed_in') return verified.access_token!;
  const completed = await api<{ access_token: string }>('POST', '/api/auth/otp/complete', { body: { signup_token: verified.signup_token, full_name: fullName } });
  return completed.access_token;
}

export type Reservation = { id: string; qr_secret: string };

/** A ticket for `mobile` (signed up as `fullName`), reserved through the attendee API. */
export async function reserveTicket(eventId: string, tierId: string, mobile: string, fullName: string): Promise<Reservation & { token: string }> {
  const token = await attendeeToken(mobile, fullName);
  const ticket = await api<Reservation>('POST', `/api/events/${eventId}/tickets/reserve`, { token, body: { ticket_tier_id: tierId } });
  return { ...ticket, token };
}
