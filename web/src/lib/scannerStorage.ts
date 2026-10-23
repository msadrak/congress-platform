export type ScanSyncState =
  | "PROVISIONAL"
  | "CONFIRMED"
  | "LOCAL_REJECTED"
  | "CONFLICT";

export interface QueuedScan {
  scan_id: string;
  point_id: string;
  /** The scanned code as uploaded (normalized). Kept only until the record is purged. */
  qr_secret: string;
  /** Manifest key of the scanned code; records from older scanners lack it. */
  qr_hash?: string;
  scanned_at: string;
  status: "ADMITTED" | "REJECTED";
  rejection_reason: string | null;
  synced: boolean;
  sync_state: ScanSyncState;
  attendee_name?: string | null;
  ticket_tier_name?: string | null;
  conflict_acknowledged?: boolean;
  reconciled_at?: string | null;
}

export interface ServerScanResult {
  scan_id: string;
  qr_secret: string;
  status: string;
  rejection_reason?: string | null;
  attendee_name?: string | null;
  ticket_tier_name?: string | null;
}

export interface ReconciliationReport {
  confirmedCount: number;
  conflictCount: number;
  conflicts: QueuedScan[];
}

export interface CachedManifestRecord {
  manifest: unknown;
  /** Time of the last successful manifest fetch (full or delta): the offline window's baseline. */
  cached_at: string;
}

/** Synced scans are deleted once older than this; unsynced scans stay until uploaded or discarded. */
export const SYNCED_SCAN_RETENTION_MS = 24 * 60 * 60 * 1000;

const DB_NAME = "congress_scanner_db";
const DB_VERSION = 3;
const SCANS = "queued_scans";
const MANIFESTS = "manifests";

/** Another scanner tab still holds the previous database version open. */
export class ScannerStorageBlockedError extends Error {
  constructor() {
    super("Scanner storage is being upgraded: close other scanner tabs or windows, then reload.");
    this.name = "ScannerStorageBlockedError";
  }
}

// One connection per page. It closes itself when another tab upgrades the database, and the next call
// reopens it at the new version.
let connection: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (connection) return connection;
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();

  if (typeof window === "undefined" || !window.indexedDB) {
    reject(new Error("IndexedDB is not supported in this runtime environment."));
    return promise;
  }

  let settled = false;
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(MANIFESTS)) {
      db.createObjectStore(MANIFESTS, { keyPath: "pointId" });
    }
    const scanStore = db.objectStoreNames.contains(SCANS)
      ? request.transaction!.objectStore(SCANS)
      : db.createObjectStore(SCANS, { keyPath: "scan_id" });
    if (!scanStore.indexNames.contains("point_id")) scanStore.createIndex("point_id", "point_id", { unique: false });
    if (!scanStore.indexNames.contains("synced")) scanStore.createIndex("synced", "synced", { unique: false });
    if (!scanStore.indexNames.contains("sync_state")) scanStore.createIndex("sync_state", "sync_state", { unique: false });
    if (!scanStore.indexNames.contains("point_scanned_at")) {
      scanStore.createIndex("point_scanned_at", ["point_id", "scanned_at"], { unique: false });
    }
  };

  request.onblocked = () => {
    settled = true;
    connection = null;
    reject(new ScannerStorageBlockedError());
  };
  request.onsuccess = () => {
    const db = request.result;
    if (settled) {
      db.close();
      return;
    }
    settled = true;
    db.onversionchange = () => {
      db.close();
      connection = null;
    };
    db.onclose = () => {
      connection = null;
    };
    resolve(db);
  };
  request.onerror = () => {
    settled = true;
    connection = null;
    reject(request.error);
  };
  connection = promise;
  return promise;
}

/**
 * Runs one transaction. `body` issues its requests and returns a reader for the result, which is read
 * only once the transaction has committed (`oncomplete`), never when a request merely succeeded.
 */
async function transact<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => () => T
): Promise<T> {
  let tx: IDBTransaction;
  try {
    tx = (await openDb()).transaction(stores, mode);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
    connection = null; // closed underneath us (version change): reopen once
    tx = (await openDb()).transaction(stores, mode);
  }
  const read = body(tx);
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  tx.oncomplete = () => resolve(read());
  tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  return promise;
}

function pointScans(tx: IDBTransaction, pointId: string): IDBRequest<QueuedScan[]> {
  return tx.objectStore(SCANS).index("point_id").getAll(pointId);
}

const byScannedAt = (a: QueuedScan, b: QueuedScan) => a.scanned_at.localeCompare(b.scanned_at);

export async function saveCachedManifest(pointId: string, manifest: unknown, fetchedAt: string): Promise<void> {
  await transact(MANIFESTS, "readwrite", (tx) => {
    tx.objectStore(MANIFESTS).put({ pointId, manifest, cached_at: fetchedAt });
    return () => undefined;
  });
}

export async function getCachedManifestMeta(pointId: string): Promise<CachedManifestRecord | null> {
  return transact(MANIFESTS, "readonly", (tx) => {
    const req = tx.objectStore(MANIFESTS).get(pointId);
    return () => (req.result ? { manifest: req.result.manifest, cached_at: req.result.cached_at ?? "" } : null);
  });
}

export async function saveQueuedScan(scan: QueuedScan): Promise<void> {
  await transact(SCANS, "readwrite", (tx) => {
    tx.objectStore(SCANS).put(scan);
    return () => undefined;
  });
}

/** Scans still to upload, oldest first (conflicts are already answered by the server). */
export async function getUnsyncedScans(pointId: string): Promise<QueuedScan[]> {
  return transact(SCANS, "readonly", (tx) => {
    const req = pointScans(tx, pointId);
    return () => req.result.filter((s) => !s.synced && s.sync_state !== "CONFLICT").sort(byScannedAt);
  });
}

export async function getAllScansForPoint(pointId: string): Promise<QueuedScan[]> {
  return transact(SCANS, "readonly", (tx) => {
    const req = pointScans(tx, pointId);
    return () => req.result.sort(byScannedAt);
  });
}

/** The latest `limit` scans at this point, newest first, read from the time index. */
export async function getRecentScans(pointId: string, limit: number): Promise<QueuedScan[]> {
  return transact(SCANS, "readonly", (tx) => {
    const recent: QueuedScan[] = [];
    const range = IDBKeyRange.bound([pointId, ""], [pointId, "￿"]);
    const req = tx.objectStore(SCANS).index("point_scanned_at").openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      recent.push(cursor.value);
      if (recent.length < limit) cursor.continue();
    };
    return () => recent;
  });
}

export async function getConflictsForPoint(pointId: string): Promise<QueuedScan[]> {
  return transact(SCANS, "readonly", (tx) => {
    const req = pointScans(tx, pointId);
    return () => req.result.filter((s) => s.sync_state === "CONFLICT" && !s.conflict_acknowledged).sort(byScannedAt);
  });
}

export async function acknowledgeConflict(scanId: string): Promise<void> {
  await transact(SCANS, "readwrite", (tx) => {
    const store = tx.objectStore(SCANS);
    const getReq = store.get(scanId);
    getReq.onsuccess = () => {
      if (getReq.result) store.put({ ...getReq.result, conflict_acknowledged: true });
    };
    return () => undefined;
  });
}

/**
 * Removes this point's attendee data from the device after unpairing, revocation or an authorization
 * block: the cached manifest and every synced scan. Unsynced scans stay (they are the only copy) until
 * they are uploaded or an operator discards them. Returns how many were kept.
 */
export async function wipePointData(pointId: string): Promise<number> {
  return transact([MANIFESTS, SCANS], "readwrite", (tx) => {
    tx.objectStore(MANIFESTS).delete(pointId);
    const store = tx.objectStore(SCANS);
    let kept = 0;
    const req = store.index("point_id").openCursor(pointId);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (cursor.value.synced) cursor.delete();
      else kept += 1;
      cursor.continue();
    };
    return () => kept;
  });
}

/** Operator-confirmed: drop this point's unsynced scans (they will never reach the server). */
export async function discardUnsyncedScans(pointId: string): Promise<number> {
  return transact(SCANS, "readwrite", (tx) => {
    let discarded = 0;
    const req = tx.objectStore(SCANS).index("point_id").openCursor(pointId);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (!cursor.value.synced) {
        cursor.delete();
        discarded += 1;
      }
      cursor.continue();
    };
    return () => discarded;
  });
}

/** Deletes synced scans older than the retention window (unacknowledged conflicts wait for review). */
export async function purgeExpiredScans(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - SYNCED_SCAN_RETENTION_MS).toISOString();
  return transact(SCANS, "readwrite", (tx) => {
    let purged = 0;
    const req = tx.objectStore(SCANS).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const scan: QueuedScan = cursor.value;
      const awaitingReview = scan.sync_state === "CONFLICT" && !scan.conflict_acknowledged;
      if (scan.synced && !awaitingReview && scan.scanned_at < cutoff) {
        cursor.delete();
        purged += 1;
      }
      cursor.continue();
    };
    return () => purged;
  });
}

/** Asks the browser not to evict the scanner's storage under pressure (unsynced scans live only here). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** The verdict a locally decided scan carries to the server: a device rejection is final there. */
export function clientVerdictFor(scan: QueuedScan): {
  client_verdict: "PROVISIONAL" | "REJECTED";
  client_rejection_reason: string | null;
} {
  return scan.status === "REJECTED"
    ? { client_verdict: "REJECTED", client_rejection_reason: (scan.rejection_reason ?? "UNSPECIFIED").slice(0, 48) }
    : { client_verdict: "PROVISIONAL", client_rejection_reason: null };
}

/**
 * Applies the server's verdict to one queued scan (mutates it).
 * - server ADMITTED -> confirmed;
 * - server REJECTED a scan this device had admitted provisionally -> conflict (needs review);
 * - server REJECTED a scan this device had already rejected -> the two agree, there is nothing to
 *   review and the record keeps its rejection (it must never be treated as a conflict, which would
 *   also make a later reload forget the ticket's genuine admission).
 */
export function applyServerVerdict(scan: QueuedScan, serverRes: ServerScanResult, now: string): "confirmed" | "conflict" | "agreed" {
  scan.synced = true;
  scan.reconciled_at = now;
  if (serverRes.attendee_name) scan.attendee_name = serverRes.attendee_name;
  if (serverRes.ticket_tier_name) scan.ticket_tier_name = serverRes.ticket_tier_name;

  if (serverRes.status === "ADMITTED") {
    scan.status = "ADMITTED";
    scan.sync_state = "CONFIRMED";
    scan.rejection_reason = null;
    return "confirmed";
  }
  if (scan.status === "REJECTED" && scan.sync_state !== "CONFLICT") {
    scan.sync_state = "LOCAL_REJECTED";
    scan.rejection_reason = scan.rejection_reason || serverRes.rejection_reason || "SERVER_REJECTED";
    return "agreed";
  }
  scan.status = "REJECTED";
  scan.sync_state = "CONFLICT";
  scan.rejection_reason = serverRes.rejection_reason || "SERVER_REJECTED";
  scan.conflict_acknowledged = false;
  return "conflict";
}

export async function reconcileBatchOutcomes(
  pointId: string,
  serverResults: ServerScanResult[]
): Promise<ReconciliationReport> {
  const resultsMap: Record<string, ServerScanResult> = {};
  for (const r of serverResults) resultsMap[r.scan_id] = r;
  return transact(SCANS, "readwrite", (tx) => {
    const store = tx.objectStore(SCANS);
    const report: ReconciliationReport = { confirmedCount: 0, conflictCount: 0, conflicts: [] };
    const req = store.index("point_id").getAll(pointId);
    req.onsuccess = () => {
      const now = new Date().toISOString();
      for (const scan of req.result) {
        const serverRes = resultsMap[scan.scan_id];
        if (!serverRes) continue;
        const verdict = applyServerVerdict(scan, serverRes, now);
        if (verdict === "confirmed") report.confirmedCount += 1;
        if (verdict === "conflict") {
          report.conflictCount += 1;
          report.conflicts.push(scan);
        }
        store.put(scan);
      }
    };
    return () => report;
  });
}
