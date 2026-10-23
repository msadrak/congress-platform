/**
 * Offline lead capture: badge scans taken while the booth device has no connection wait in a device queue
 * (IndexedDB, lib/leadQueueStorage.ts) and are sent once it is back online.
 *
 * Idempotency: the scan API takes no client id, but it keeps one lead per booth and ticket and a repeated scan
 * only re-applies the qualification it carries (backend/app/routes/leads.py). Sending a queued scan twice (a lost
 * response, two tabs) therefore never creates a second lead. The queue also folds two queued scans of the same
 * badge into one record, so the operator sees each pending attendee once.
 *
 * Pure: the store and the request are injected, so the logic is unit tested (tests/leadQueue.test.ts).
 */
import type { LeadOut, LeadScanInput } from "../api/client.ts";
import type { LeadRating } from "../components/booth/rating.ts";

export interface QueuedLeadScan {
  /** Client id of the queued record (never sent: the API de-duplicates by ticket). */
  id: string;
  /** The signed-in account that captured it; another account on the device never sends or sees it. */
  owner: string;
  booth_id: string;
  /** The scanned code as typed or decoded, trimmed. */
  qr_secret: string;
  /** Only the qualification the operator chose travels, exactly as an online scan. */
  rating?: LeadRating;
  tags?: string[];
  notes?: string;
  queued_at: string;
  attempts: number;
  /** Epoch ms before which no retry is sent. */
  next_attempt_at: number;
  state: "pending" | "failed";
  /** Why the server refused it (state "failed"). */
  failure?: QueueFailure | null;
}

export type QueueFailure =
  /** 404: not an active attendee badge. */
  | { kind: "invalid_badge" }
  /** 400: a badge of another congress. */
  | { kind: "other_event" }
  /** Any other refusal; `code` is the API's stable error code when it sent one. */
  | { kind: "refused"; status: number; code?: string; detail?: string };

export interface LeadQueueStore {
  list(owner: string, boothId: string): Promise<QueuedLeadScan[]>;
  put(scan: QueuedLeadScan): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What one send attempt returned: an HTTP answer, or no answer at all. */
export type SendResult =
  | { network: true }
  | { network: false; status: number; data?: LeadOut; code?: string; detail?: string };

export type SyncOutcome =
  | { kind: "synced"; lead: LeadOut; existed: boolean }
  | { kind: "retry" }
  | { kind: "failed"; failure: QueueFailure }
  /** 401: the session ended; everything waits for the next sign-in of the same account. */
  | { kind: "session_expired" }
  /** 403 BOOTH_STAFF_REQUIRED: this account was removed from the booth; nothing more is sent. */
  | { kind: "access_revoked" };

/** Retries back off from 2 s to at most a minute. */
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 60_000;

export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

const sameBadge = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Adds a scan to the queue, or folds it into a queued scan of the same badge (same owner and booth): the newer
 * choice of rating, tags and non-empty notes wins, as it would on the server, and the record is due again.
 */
export function enqueueLeadScan(
  queued: readonly QueuedLeadScan[],
  input: LeadScanInput,
  context: { id: string; owner: string; boothId: string; now: Date },
): { scan: QueuedLeadScan; merged: boolean } {
  const qr = input.qr_secret.trim();
  const existing = queued.find(
    (scan) => scan.owner === context.owner && scan.booth_id === context.boothId && sameBadge(scan.qr_secret, qr),
  );
  const rating = input.rating === "HOT" || input.rating === "WARM" || input.rating === "COLD" ? input.rating : undefined;
  const notes = input.notes?.trim() || undefined;
  if (existing) {
    return {
      merged: true,
      scan: {
        ...existing,
        ...(rating ? { rating } : {}),
        ...(input.tags ? { tags: [...input.tags] } : {}),
        ...(notes ? { notes } : {}),
        state: "pending",
        failure: null,
        attempts: 0,
        next_attempt_at: context.now.getTime(),
      },
    };
  }
  return {
    merged: false,
    scan: {
      id: context.id,
      owner: context.owner,
      booth_id: context.boothId,
      qr_secret: qr,
      ...(rating ? { rating } : {}),
      ...(input.tags ? { tags: [...input.tags] } : {}),
      ...(notes ? { notes } : {}),
      queued_at: context.now.toISOString(),
      attempts: 0,
      next_attempt_at: context.now.getTime(),
      state: "pending",
      failure: null,
    },
  };
}

/** The request body of a queued scan: exactly what the online capture would have sent. */
export function scanBody(scan: QueuedLeadScan): LeadScanInput {
  return {
    qr_secret: scan.qr_secret,
    ...(scan.rating ? { rating: scan.rating } : {}),
    ...(scan.tags ? { tags: scan.tags } : {}),
    ...(scan.notes ? { notes: scan.notes } : {}),
  };
}

/** How one answer moves a queued scan on. */
export function classifySend(result: SendResult): SyncOutcome {
  if (result.network) return { kind: "retry" };
  const { status, data, code, detail } = result;
  if ((status === 200 || status === 201) && data) return { kind: "synced", lead: data, existed: status === 200 };
  if (status === 401) return { kind: "session_expired" };
  if (status === 403 && code === "BOOTH_STAFF_REQUIRED") return { kind: "access_revoked" };
  // No answer worth keeping yet: the server or a proxy is struggling, or asks to slow down.
  if (status >= 500 || status === 408 || status === 429 || status === 0) return { kind: "retry" };
  if (status === 404 && !code) return { kind: "failed", failure: { kind: "invalid_badge" } };
  if (status === 400 && !code) return { kind: "failed", failure: { kind: "other_event" } };
  return { kind: "failed", failure: { kind: "refused", status, ...(code ? { code } : {}), ...(detail ? { detail } : {}) } };
}

/** Scans to send now, oldest first: pending and due. Failed scans wait for the operator. */
export function dueScans(queued: readonly QueuedLeadScan[], nowMs: number): QueuedLeadScan[] {
  return queued
    .filter((scan) => scan.state === "pending" && scan.next_attempt_at <= nowMs)
    .sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

/** When the next pending retry falls due, or null when nothing is waiting. */
export function nextRetryAt(queued: readonly QueuedLeadScan[]): number | null {
  const times = queued.filter((scan) => scan.state === "pending").map((scan) => scan.next_attempt_at);
  return times.length ? Math.min(...times) : null;
}

export interface SyncReport {
  synced: { scan: QueuedLeadScan; lead: LeadOut; existed: boolean }[];
  failed: QueuedLeadScan[];
  retrying: QueuedLeadScan[];
  /** Why the run stopped before the end of the queue, if it did. */
  stopped: "session_expired" | "access_revoked" | "offline" | "server_error" | null;
}

/**
 * Sends the due scans one by one, oldest first. A synced scan leaves the queue; a refused one stays, marked with
 * its reason; a scan without an answer waits for its backoff. The run stops at the first sign that sending more
 * is pointless (no network, session ended, access revoked), leaving the rest untouched.
 */
export async function syncLeadQueue(options: {
  owner: string;
  boothId: string;
  store: LeadQueueStore;
  send: (scan: QueuedLeadScan) => Promise<SendResult>;
  now: () => number;
}): Promise<SyncReport> {
  const { owner, boothId, store, send, now } = options;
  const report: SyncReport = { synced: [], failed: [], retrying: [], stopped: null };
  const due = dueScans(await store.list(owner, boothId), now());
  for (const scan of due) {
    const result = await send(scan);
    const outcome = classifySend(result);
    if (outcome.kind === "synced") {
      await store.remove(scan.id);
      report.synced.push({ scan, lead: outcome.lead, existed: outcome.existed });
    } else if (outcome.kind === "failed") {
      const failed: QueuedLeadScan = { ...scan, state: "failed", failure: outcome.failure, attempts: scan.attempts + 1 };
      await store.put(failed);
      report.failed.push(failed);
    } else if (outcome.kind === "retry") {
      const attempts = scan.attempts + 1;
      const waiting: QueuedLeadScan = { ...scan, attempts, next_attempt_at: now() + retryDelayMs(attempts) };
      await store.put(waiting);
      report.retrying.push(waiting);
      // Without a network every further send fails the same way; with a struggling server, back off as a whole.
      report.stopped = result.network ? "offline" : "server_error";
      break;
    } else {
      report.stopped = outcome.kind;
      break;
    }
  }
  return report;
}

/** The operator asks to try a refused or waiting scan again now. */
export function retryNow(scan: QueuedLeadScan, nowMs: number): QueuedLeadScan {
  return { ...scan, state: "pending", failure: null, attempts: 0, next_attempt_at: nowMs };
}
