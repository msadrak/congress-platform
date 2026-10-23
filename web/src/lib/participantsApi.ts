/**
 * Organizer participants API (backend/app/routes/participants.py), organizer key only.
 *
 * TODO(gen:api): replace with generated types. `web/src/api/schema.d.ts` could not be regenerated when this page
 * was written, so the request/response shapes below are hand-copied from the Pydantic models and the calls use
 * fetch directly. Once `npm run gen:api` has run, use `components["schemas"]["ParticipantOut"]` (etc.) and
 * `createApiClient(...)` instead and delete this module.
 */
import { ApiResponseError } from "../api/client.ts";
import { participantListQuery, type ParticipantListState } from "./participants.ts";

// TODO(gen:api): replace with generated types.
export type ParticipantStatus = "active" | "cancelled";

// TODO(gen:api): replace with generated types.
export interface ParticipantOut {
  ticket_id: string;
  user_id: string;
  attendee_full_name: string;
  attendee_organization: string;
  attendee_title: string;
  /** The account's sign-in number; null for a walk-in without one or a deleted account. */
  mobile: string | null;
  ticket_tier_id: string;
  ticket_tier_name: string;
  status: ParticipantStatus;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  /** organizer | attendee | account_deleted */
  cancelled_by: string | null;
  reissued_at: string | null;
  /** Front-desk operator who issued a walk-in ticket. */
  issued_by: string | null;
  checkin_count: number;
  lead_count: number;
  /** Hard delete is only for a registration made by mistake: no scans and no exhibitor leads. */
  can_delete: boolean;
  account_deleted: boolean;
}

// TODO(gen:api): replace with generated types.
export interface ScanOut {
  checkin_point_name: string;
  status: string;
  rejection_reason: string | null;
  scanned_at: string;
}

// TODO(gen:api): replace with generated types.
export interface ParticipantDetail extends ParticipantOut {
  /** Only while the ticket is active. */
  qr_secret: string | null;
  scan_history: ScanOut[];
}

// TODO(gen:api): replace with generated types.
export interface ParticipantPage {
  items: ParticipantOut[];
  total: number;
  limit: number;
  offset: number;
}

// TODO(gen:api): replace with generated types.
export interface ParticipantUpdate {
  attendee_full_name?: string;
  attendee_organization?: string;
  attendee_title?: string;
}

// TODO(gen:api): replace with generated types.
export interface ParticipantCancel {
  reason: string;
  notify: boolean;
}

// TODO(gen:api): replace with generated types.
export interface ParticipantTransfer {
  mobile: string;
  full_name?: string;
  organization?: string;
  title?: string;
}

export interface ParticipantsApiOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Calls for one event. HTTP failures throw `ApiResponseError` (status + body, so `localizedApiError` reads the
 * code); a failure to reach the server throws the native error. */
export function createParticipantsApi(token: string, eventId: string, options: ParticipantsApiOptions = {}) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const root = `${options.baseUrl ?? ""}/api/events/${encodeURIComponent(eventId)}/participants`;
  const headers = { Authorization: `Bearer ${token}` };

  const queryString = (state: ParticipantListState, paged: boolean) => {
    const { limit, offset, ...filters } = participantListQuery(state);
    const params = new URLSearchParams(
      Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    if (paged) {
      params.set("limit", String(limit));
      params.set("offset", String(offset));
    }
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  async function send(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const response = await doFetch(`${root}${path}`, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      throw new ApiResponseError(response.status, body);
    }
    return response;
  }
  const json = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> =>
    (await (await send(path, init)).json()) as T;
  const item = (ticketId: string) => `/${encodeURIComponent(ticketId)}`;

  return {
    list: (state: ParticipantListState) => json<ParticipantPage>(queryString(state, true)),
    get: (ticketId: string) => json<ParticipantDetail>(item(ticketId)),
    update: (ticketId: string, body: ParticipantUpdate) => json<ParticipantDetail>(item(ticketId), { method: "PATCH", body }),
    cancel: (ticketId: string, body: ParticipantCancel) =>
      json<ParticipantDetail>(`${item(ticketId)}/cancel`, { method: "POST", body }),
    reissue: (ticketId: string, notify: boolean) =>
      json<ParticipantDetail>(`${item(ticketId)}/reissue`, { method: "POST", body: { notify } }),
    transfer: (ticketId: string, body: ParticipantTransfer) =>
      json<ParticipantDetail>(`${item(ticketId)}/transfer`, { method: "POST", body }),
    remove: async (ticketId: string): Promise<void> => {
      await send(item(ticketId), { method: "DELETE" });
    },
    /** Every registration matching the list filters (not just the current page), as CSV. */
    exportCsv: async (state: ParticipantListState): Promise<Blob> => (await send(`/export-csv${queryString(state, false)}`)).blob(),
  };
}

export type ParticipantsApi = ReturnType<typeof createParticipantsApi>;
