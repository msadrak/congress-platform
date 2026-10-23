import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiErrorCode, createApiClient, formatApiError, type LeadOut, type LeadScanInput, type LeadScanRequest } from "../../api/client";
import { isStoredAttendeeToken } from "../../lib/attendeeSession";
import {
  enqueueLeadScan,
  nextRetryAt,
  retryNow,
  scanBody,
  syncLeadQueue,
  type LeadQueueStore,
  type QueuedLeadScan,
  type SendResult,
} from "../../lib/leadQueue";
import { indexedDbLeadQueue, requestPersistentLeadStorage } from "../../lib/leadQueueStorage";
import { getAuthenticatedUserId } from "../../lib/ticketCache";

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own view of the connection (true without one: a captive portal still fails a send, which retries). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

interface LeadQueueOptions {
  boothId: string | undefined;
  token: string | null;
  /** False once access was revoked: nothing more is sent. */
  enabled: boolean;
  onSynced: (synced: { scan: QueuedLeadScan; lead: LeadOut; existed: boolean }[]) => void;
  onAccessRevoked: () => void;
  store?: LeadQueueStore;
}

export interface LeadQueueState {
  /** This account's queued scans for this booth, oldest first. */
  scans: QueuedLeadScan[];
  online: boolean;
  /** The id of the scan being sent right now. */
  sendingId: string | null;
  /** The device cannot keep scans (no IndexedDB, private mode, blocked upgrade). */
  storageError: boolean;
  /** Queues a scan; resolves false when the device could not store it. */
  enqueue: (input: LeadScanInput) => Promise<boolean>;
  syncNow: () => void;
  retry: (id: string) => void;
  discard: (id: string) => void;
}

/**
 * The booth device's offline lead queue: scans captured without a connection are stored (lib/leadQueueStorage.ts)
 * and sent, oldest first, when the browser is back online, on load, and on a backoff timer. Only the account that
 * captured a scan ever sends or sees it. Two tabs never send at once (Web Locks, where available).
 */
export function useLeadQueue({ boothId, token, enabled, onSynced, onAccessRevoked, store = indexedDbLeadQueue }: LeadQueueOptions): LeadQueueState {
  const owner = getAuthenticatedUserId(token);
  const online = useOnline();
  const [scans, setScans] = useState<QueuedLeadScan[]>([]);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onSynced, onAccessRevoked });
  useEffect(() => {
    callbacks.current = { onSynced, onAccessRevoked };
  });
  const live = useRef({ boothId, token, owner, enabled });
  useEffect(() => {
    live.current = { boothId, token, owner, enabled };
  });

  const refresh = useCallback(async (): Promise<QueuedLeadScan[]> => {
    if (!owner || !boothId) {
      setScans([]);
      return [];
    }
    try {
      const listed = await store.list(owner, boothId);
      // A newer session or booth replaced this one meanwhile: its own refresh shows its queue.
      if (live.current.owner === owner && live.current.boothId === boothId) setScans(listed);
      setStorageError(false);
      return listed;
    } catch {
      setStorageError(true);
      return [];
    }
  }, [owner, boothId, store]);

  const sync = useCallback(async () => {
    const { boothId: booth, token: sessionToken, owner: who, enabled: allowed } = live.current;
    if (!booth || !sessionToken || !who || !allowed || !navigator.onLine) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    window.clearTimeout(timer.current);
    const send = async (scan: QueuedLeadScan): Promise<SendResult> => {
      // The session changed (sign-out, another account): nothing is sent with or for it.
      if (!isStoredAttendeeToken(sessionToken) || !live.current.enabled) return { network: false, status: 401 };
      setSendingId(scan.id);
      try {
        const { data, error, response } = await createApiClient({ kind: "user", token: sessionToken }).POST(
          "/api/booths/{booth_id}/leads/scan",
          { params: { path: { booth_id: booth } }, body: scanBody(scan) as LeadScanRequest },
        );
        const code = apiErrorCode(error);
        return {
          network: false,
          status: response.status,
          ...(data ? { data } : {}),
          ...(code ? { code } : {}),
          ...(error ? { detail: formatApiError(error) } : {}),
        };
      } catch {
        return { network: true };
      } finally {
        setSendingId(null);
      }
    };
    const run = async () => {
      const report = await syncLeadQueue({ owner: who, boothId: booth, store, send, now: Date.now });
      if (report.synced.length) callbacks.current.onSynced(report.synced);
      if (report.stopped === "access_revoked") callbacks.current.onAccessRevoked();
    };
    try {
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (locks?.request) {
        await locks.request(`congress-lead-sync:${who}:${booth}`, { ifAvailable: true }, async (lock) => {
          if (lock) await run();
        });
      } else {
        await run();
      }
    } catch {
      setStorageError(true);
    } finally {
      running.current = false;
    }
    const remaining = await refresh();
    if (again.current) {
      again.current = false;
      void sync();
      return;
    }
    const due = nextRetryAt(remaining);
    if (due !== null && live.current.enabled) {
      timer.current = window.setTimeout(() => void sync(), Math.max(250, due - Date.now()));
    }
  }, [refresh, store]);

  // Load this account's queue for the booth, and send what is waiting.
  useEffect(() => {
    if (!enabled) return;
    void refresh().then((listed) => {
      if (listed.length) void sync();
    });
  }, [enabled, refresh, sync]);

  // Back online: send at once.
  useEffect(() => {
    if (online && enabled) void sync();
  }, [online, enabled, sync]);

  useEffect(() => {
    if (!enabled) window.clearTimeout(timer.current);
  }, [enabled]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enqueue = useCallback(async (input: LeadScanInput): Promise<boolean> => {
    if (!owner || !boothId) return false;
    try {
      const current = await store.list(owner, boothId);
      const { scan } = enqueueLeadScan(current, input, { id: crypto.randomUUID(), owner, boothId, now: new Date() });
      await store.put(scan);
      void requestPersistentLeadStorage();
      await refresh();
      if (navigator.onLine) void sync();
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  }, [owner, boothId, store, refresh, sync]);

  const retry = useCallback((id: string) => {
    const scan = scans.find((s) => s.id === id);
    if (!scan) return;
    void store.put(retryNow(scan, Date.now())).then(refresh).then(() => sync(), () => setStorageError(true));
  }, [scans, store, refresh, sync]);

  const discard = useCallback((id: string) => {
    void store.remove(id).then(refresh, () => setStorageError(true));
  }, [store, refresh]);

  return { scans, online, sendingId, storageError, enqueue, syncNow: () => void sync(), retry, discard };
}
