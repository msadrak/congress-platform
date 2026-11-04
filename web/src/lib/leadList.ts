/**
 * The booth lead list as the exhibitor portal pages through it (`GET /api/booths/{id}/leads/search`): query
 * building, page merging and the local edits applied after a confirmed change. Pure, so it is unit tested
 * (tests/leadList.test.ts); the fetching lives in components/booth/useLeadList.ts.
 */
import type { LeadOut } from "../api/client.ts";
import { apiErrorCode } from "../api/client.ts";
import type { LeadRating } from "../components/booth/rating.ts";

/** Leads per page. The API allows up to 200; a short page keeps a phone's first paint fast. */
export const LEAD_PAGE_SIZE = 20;
/** The API refuses longer search terms (422; `SEARCH_TERM_MAX` in backend/app/routes/leads.py). */
export const LEAD_SEARCH_MAX_LENGTH = 100;
/** Typing pause before the search is sent. */
export const LEAD_SEARCH_DEBOUNCE_MS = 300;

/** "active": the worklist; "deleted": the booth's trash. */
export type LeadView = "active" | "deleted";

export interface LeadQuery {
  q: string;
  rating: LeadRating | "";
  view: LeadView;
}

export interface LeadSearchParams {
  q?: string;
  rating?: LeadRating;
  state: LeadView;
  limit: number;
  cursor?: string;
}

/** Whitespace is collapsed and the term clipped to what the API accepts; the server folds Persian letters and digits. */
export function normalizeLeadSearch(term: string): string {
  return term.replace(/\s+/g, " ").trim().slice(0, LEAD_SEARCH_MAX_LENGTH);
}

/** Query parameters for one page; empty filters are left out so the URL says only what was asked. */
export function leadSearchParams(query: LeadQuery, cursor?: string | null, limit = LEAD_PAGE_SIZE): LeadSearchParams {
  const q = normalizeLeadSearch(query.q);
  return {
    ...(q ? { q } : {}),
    ...(query.rating ? { rating: query.rating } : {}),
    state: query.view,
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

export function hasLeadFilters(query: LeadQuery): boolean {
  return normalizeLeadSearch(query.q) !== "" || query.rating !== "";
}

/** Appends a further page. A lead already shown (the list shifted under a concurrent capture) is not repeated. */
export function appendLeadPage(current: readonly LeadOut[], page: readonly LeadOut[]): LeadOut[] {
  const seen = new Set(current.map((lead) => lead.id));
  return [...current, ...page.filter((lead) => !seen.has(lead.id))];
}

/** A confirmed server copy replaces the shown lead in place. */
export function replaceLead(current: readonly LeadOut[], lead: LeadOut): LeadOut[] {
  return current.map((shown) => (shown.id === lead.id ? lead : shown));
}

/** Leaves the lead out (deleted from the worklist, or restored out of the trash). */
export function withoutLead(current: readonly LeadOut[], leadId: string): LeadOut[] {
  return current.filter((lead) => lead.id !== leadId);
}

/** 403 `BOOTH_STAFF_REQUIRED` on a booth call: this account is not (or no longer) staff of the booth. */
export function isBoothAccessRevoked(status: number, error: unknown): boolean {
  return status === 403 && apiErrorCode(error) === "BOOTH_STAFF_REQUIRED";
}

/**
 * Why the booth workspace is closed to this account for good (on this page):
 * - "removed": 403 `BOOTH_STAFF_REQUIRED`, the representative was taken off the booth's staff;
 * - "suspended": 403 `BOOTH_ACCESS_SUSPENDED`, the platform revoked the congress's organizer, so every
 *   representative is refused until that is lifted.
 */
export type AccessBlock = "removed" | "suspended";

export function accessBlockOf(status: number, error: unknown): AccessBlock | null {
  if (status !== 403) return null;
  const code = apiErrorCode(error);
  return code === "BOOTH_STAFF_REQUIRED" ? "removed" : code === "BOOTH_ACCESS_SUSPENDED" ? "suspended" : null;
}

/** 409 `EVENT_ARCHIVED` on a lead change: the congress is archived, its leads are read-only (reads and export stay). */
export function isEventArchived(status: number, error: unknown): boolean {
  return status === 409 && apiErrorCode(error) === "EVENT_ARCHIVED";
}

/** 400 `CURSOR_INVALID`: the page position is stale; the list must start again from the first page. */
export function isCursorInvalid(status: number, error: unknown): boolean {
  return status === 400 && apiErrorCode(error) === "CURSOR_INVALID";
}

export interface RatingCounts {
  HOT: number;
  WARM: number;
  COLD: number;
}

/** The booth's active total. Every stored lead has one of the three ratings (the API cleans anything else to WARM). */
export function totalOf(counts: RatingCounts): number {
  return counts.HOT + counts.WARM + counts.COLD;
}
