/**
 * Organizer participants register: the pure helpers behind the page (its copy lives in copy/organizerData.ts).
 * The page edits a registration's own details for one congress, never the person's shared account.
 */
import type { CopyShape } from "../copy/useCopy.ts";
import { organizerDataCopy } from "../copy/organizerData.ts";
import { normalizeIranMobile } from "./mobile.ts";

export type ParticipantStatusFilter = "" | "active" | "cancelled";

export interface ParticipantListState {
  q: string;
  tierId: string;
  status: ParticipantStatusFilter;
  page: number;
  pageSize: number;
}

/** Query parameters for GET /participants (and its CSV export): empty filters are left out. */
export function participantListQuery(state: ParticipantListState): {
  q?: string;
  tier_id?: string;
  status?: "active" | "cancelled";
  limit: number;
  offset: number;
} {
  const q = state.q.trim();
  return {
    ...(q ? { q } : {}),
    ...(state.tierId ? { tier_id: state.tierId } : {}),
    ...(state.status ? { status: state.status } : {}),
    limit: state.pageSize,
    offset: Math.max(0, state.page) * state.pageSize,
  };
}

/** 1-based range shown under the table ("21–40 of 57") and whether the pager buttons apply. */
export function pageRange(offset: number, shown: number, total: number): { from: number; to: number; hasPrev: boolean; hasNext: boolean } {
  return {
    from: shown === 0 ? 0 : offset + 1,
    to: offset + shown,
    hasPrev: offset > 0,
    hasNext: offset + shown < total,
  };
}

/** Last page that still has rows after the total shrank (a cancel filter, a delete). */
export function clampPage(page: number, pageSize: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return Math.min(Math.max(0, page), last);
}

export type TransferProblem = "mobileInvalid" | "nameRequired";

/** First problem in the transfer form; `fullName` may be empty when the number already has an account. */
export function transferProblem(form: { mobile: string; fullName: string }, nameRequired: boolean): TransferProblem | null {
  if (!normalizeIranMobile(form.mobile)) return "mobileInvalid";
  if (nameRequired && !form.fullName.trim()) return "nameRequired";
  return null;
}

/** Fill `{name}` tokens in a copy string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => (key in values ? String(values[key]) : token));
}

/** The page's copy (`copy/organizerData.ts`); the layout reads `navLabel` for its navigation. */
export type ParticipantsCopy = CopyShape<typeof organizerDataCopy.fa.participants>;
export const PARTICIPANTS_COPY: Record<"fa" | "en", ParticipantsCopy> = {
  fa: organizerDataCopy.fa.participants,
  en: organizerDataCopy.en.participants,
};

/** Who cancelled a pass, as the organizer reads it. */
export function cancelledByLabel(actor: string | null | undefined, copy: ParticipantsCopy): string {
  if (actor === "attendee") return copy.actorAttendee;
  if (actor === "account_deleted") return copy.actorAccountDeleted;
  if (actor === "organizer") return copy.actorOrganizer;
  return actor ?? "";
}

/** The stored cancellation reason; the system's own reasons are translated. */
export function cancelReasonLabel(reason: string | null | undefined, copy: ParticipantsCopy): string {
  return reason === "transferred" ? copy.reasonTransferred : (reason ?? "");
}
