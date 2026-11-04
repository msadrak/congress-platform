import type { Page, Route } from '@playwright/test';

/**
 * Shared fixtures for the attendee panel specs (home, program, network, profile, booth standee): shipping
 * pages + synthetic, intercepted /api/ responses, not FastAPI/PostgreSQL E2E.
 */

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'user-1', type: 'user', exp: 4102444800 })}.sig`;
export const bearer = `Bearer ${token}`;

/** 10–12 May 2027, 09:00 Tehran on day one to 17:00 Tehran on day three. */
export const STARTS = '2027-05-10T05:30:00Z';
export const ENDS = '2027-05-12T13:30:00Z';

export const session = (id: string, title: string, startsAt: string, endsAt: string, track: string, hall: string, extra: Partial<{ speakers: string; description: string }> = {}) => ({
  id, title, track, speakers: extra.speakers ?? '', description: extra.description ?? '', hall_id: `hall-${hall}`, hall_name: hall, starts_at: startsAt, ends_at: endsAt,
});

export const SESSIONS = [
  session('s-keynote', 'Opening Keynote', '2027-05-10T06:00:00Z', '2027-05-10T07:00:00Z', 'Plenary', 'Main Hall', { speakers: 'Dr. Karimi' }),
  session('s-imaging', 'Imaging Panel', '2027-05-11T06:00:00Z', '2027-05-11T07:00:00Z', 'Imaging', 'Hall B', { description: 'Panel on cardiac imaging' }),
  session('s-workshop', 'AI Workshop', '2027-05-11T08:00:00Z', '2027-05-11T09:00:00Z', 'Imaging', 'Main Hall'),
  session('s-closing', 'Closing Ceremony', '2027-05-12T12:00:00Z', '2027-05-12T13:00:00Z', 'Plenary', 'Main Hall'),
];

export const EVENT = {
  id: 'event-a', name: 'Alpha Congress', slug: 'alpha', starts_at: STARTS, ends_at: ENDS, timezone: 'Asia/Tehran',
  location: 'Milad Tower Conference Hall, Tehran', description: 'About Alpha Congress',
  ticket_tiers: [{ id: 'tier-a', event_id: 'event-a', name: 'Delegate', quota: 10, reserved_count: 4, is_open: true, created_at: '2027-01-01T00:00:00Z' }],
  venue: [{ id: 'gate-1', kind: 'entrance', name: 'North Gate', location: 'Valiasr St.' }, { id: 'hall-Main Hall', kind: 'hall', name: 'Main Hall', location: 'Ground floor' }],
  sessions: SESSIONS,
  program_files: [],
  registration_enabled: true, registration_opens_at: null, registration_closes_at: null, registration_open: true,
};

export const ticketOf = (id: string, tier: string, qr: string, status = 'active') => ({
  id, event_id: 'event-a', event_name: 'Alpha Congress', event_slug: 'alpha', event_location: EVENT.location,
  event_starts_at: STARTS, event_ends_at: ENDS, ticket_tier_id: 'tier-a', ticket_tier_name: tier, attendee_name: 'Sara Fixture',
  attendee_mobile: '09121234567', status, qr_secret: qr, created_at: '2027-01-01T00:00:00Z',
});

export const contactOf = (n: number, extra: Partial<{ private_notes: string; full_name: string }> = {}) => ({
  id: `conn-${n}`, connected_user_id: `peer-${n}`, full_name: extra.full_name ?? `Peer ${n}`, mobile: null, organization: `Org ${n}`, title: 'Dr',
  event_id: 'event-a', private_notes: extra.private_notes ?? '', created_at: '2027-05-10T08:00:00Z',
});

export const BOOTHS = [{ id: 'booth-1', name: 'Zeta Pharma', slug: 'zeta', location: 'B12', description: 'Cardiology devices', website_url: '', brochure_url: '' }];

export const USER = { id: 'user-1', mobile: '09121234567', full_name: 'Sara Fixture', organization: 'Heart Center', title: 'Cardiologist', share_contact_with_peers: false, share_contact_with_exhibitors: false };

export interface Recorded { method: string; path: string; search: URLSearchParams; auth: string | undefined; body: unknown }

export interface PanelOptions {
  tickets?: ReturnType<typeof ticketOf>[];
  contacts?: ReturnType<typeof contactOf>[];
  /** Page size for /network/search (the cursor is the next offset). */
  pageSize?: number;
  /** Answers instead of the default for a request (`METHOD /path`); return undefined to fall through. */
  override?: (route: Route, request: Recorded) => Promise<void> | undefined;
}

/** Installs the attendee API: tickets, network (search with paging), profile, bookmarks and the public event. */
export async function panelApi(page: Page, options: PanelOptions = {}) {
  const requests: Recorded[] = [];
  const contacts = [...(options.contacts ?? [])];
  const pageSize = options.pageSize ?? 20;
  const user = { ...USER };
  const saved = new Set<string>();
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const raw = request.postData();
    const recorded: Recorded = { method, path, search: url.searchParams, auth: request.headers().authorization, body: raw ? JSON.parse(raw) : undefined };
    requests.push(recorded);
    const json = (status: number, body: unknown, headers?: Record<string, string>) => route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    if (options.override) {
      const handled = options.override(route, recorded);
      if (handled) return handled;
    }
    if (path === '/api/public/events/alpha') return json(200, EVENT);
    if (path === '/api/public/events/alpha/booths') return json(200, BOOTHS);
    if (path === '/api/attendees/me/tickets') return json(200, options.tickets ?? [ticketOf('ticket-1', 'Delegate', 'qr-delegate')]);
    if (path === '/api/me/access') return json(200, { user_id: 'user-1', events: [] });
    if (path === '/api/attendees/me/bookmarks/booths' && method === 'GET') return json(200, [...saved].map(id => ({ booth_id: id, name: id, slug: id, location: '', description: '', website_url: '', brochure_url: '', event_name: 'Alpha Congress', event_slug: 'alpha', bookmarked_at: '2027-01-01T00:00:00Z' })));
    const bookmark = path.match(/^\/api\/attendees\/me\/bookmarks\/booths\/(booth-[^/]+)$/);
    if (bookmark) {
      if (method === 'POST') saved.add(bookmark[1]); else saved.delete(bookmark[1]);
      return json(method === 'POST' ? 201 : 200, { bookmarked: method === 'POST', booth_id: bookmark[1] });
    }
    if (path === '/api/attendees/me/network/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const matching = contacts.filter(c => !q || `${c.full_name} ${c.organization} ${c.private_notes}`.toLowerCase().includes(q));
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      const items = matching.slice(offset, offset + pageSize);
      return json(200, { items, total: matching.length, next_cursor: offset + pageSize < matching.length ? String(offset + pageSize) : null });
    }
    if (path === '/api/attendees/me/network/scan') {
      const created = { ...contactOf(99, { full_name: 'New Colleague' }), created_at: '2027-05-11T07:30:00Z' };
      contacts.unshift(created);
      return json(201, created);
    }
    const connection = path.match(/^\/api\/attendees\/me\/network\/(conn-\d+)$/);
    if (connection) {
      const index = contacts.findIndex(c => c.id === connection[1]);
      if (index < 0) return json(404, { detail: 'Connection not found', code: 'CONNECTION_NOT_FOUND' });
      if (method === 'DELETE') {
        contacts.splice(index, 1);
        return route.fulfill({ status: 204 });
      }
      contacts[index] = { ...contacts[index], private_notes: (recorded.body as { private_notes: string }).private_notes };
      return json(200, contacts[index]);
    }
    if (path === '/api/attendees/me/network/privacy') {
      if (method === 'PATCH') user.share_contact_with_peers = (recorded.body as { share_contact_with_peers: boolean }).share_contact_with_peers;
      return json(200, { share_contact_with_peers: user.share_contact_with_peers });
    }
    if (path === '/api/auth/me/export') return json(200, { profile: user, tickets: [], connections: contacts });
    if (path === '/api/auth/me') {
      if (method === 'PATCH') Object.assign(user, recorded.body);
      if (method === 'DELETE') return route.fulfill({ status: 204 });
      return json(200, user);
    }
    return json(404, { detail: 'Not found' });
  });
  return requests;
}

/** Signed in as user-1, in `locale`. */
export async function signIn(page: Page, locale: 'en' | 'fa' = 'en') {
  await page.goto('/');
  await page.evaluate(({ token, locale }) => {
    localStorage.setItem('congress_attendee_token', token);
    localStorage.setItem('congress_attendee_locale', locale);
  }, { token, locale });
}
