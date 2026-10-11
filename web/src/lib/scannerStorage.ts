export type ScanSyncState =
  | "PROVISIONAL"
  | "CONFIRMED"
  | "LOCAL_REJECTED"
  | "CONFLICT";

export interface QueuedScan {
  scan_id: string;
  point_id: string;
  qr_secret: string;
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

const DB_NAME = "congress_scanner_db";
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();

  if (typeof window === "undefined" || !window.indexedDB) {
    reject(new Error("IndexedDB is not supported in this runtime environment."));
    return promise;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("manifests")) {
      db.createObjectStore("manifests", { keyPath: "pointId" });
    }

    let scanStore: IDBObjectStore;
    if (!db.objectStoreNames.contains("queued_scans")) {
      scanStore = db.createObjectStore("queued_scans", {
        keyPath: "scan_id",
      });
      scanStore.createIndex("point_id", "point_id", { unique: false });
      scanStore.createIndex("synced", "synced", { unique: false });
      scanStore.createIndex("sync_state", "sync_state", { unique: false });
    } else {
      scanStore = request.transaction!.objectStore("queued_scans");
      if (!scanStore.indexNames.contains("sync_state")) {
        scanStore.createIndex("sync_state", "sync_state", { unique: false });
      }
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

export async function saveCachedManifest(
  pointId: string,
  manifest: unknown
): Promise<void> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("manifests", "readwrite");
  const store = tx.objectStore("manifests");
  const req = store.put({ pointId, manifest, cached_at: new Date().toISOString() });
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
  return promise;
}

export async function getCachedManifest(
  pointId: string
): Promise<unknown | null> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<unknown | null>();
  const tx = db.transaction("manifests", "readonly");
  const store = tx.objectStore("manifests");
  const req = store.get(pointId);
  req.onsuccess = () => {
    resolve(req.result ? req.result.manifest : null);
  };
  req.onerror = () => reject(req.error);
  return promise;
}

export async function getCachedManifestMeta(
  pointId: string
): Promise<{ manifest: unknown; cached_at: string } | null> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<{ manifest: unknown; cached_at: string } | null>();
  const tx = db.transaction("manifests", "readonly");
  const store = tx.objectStore("manifests");
  const req = store.get(pointId);
  req.onsuccess = () => {
    resolve(
      req.result
        ? { manifest: req.result.manifest, cached_at: req.result.cached_at ?? "" }
        : null
    );
  };
  req.onerror = () => reject(req.error);
  return promise;
}

export async function saveQueuedScan(scan: QueuedScan): Promise<void> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("queued_scans", "readwrite");
  const store = tx.objectStore("queued_scans");
  const req = store.put(scan);
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
  return promise;
}

export async function getUnsyncedScans(pointId: string): Promise<QueuedScan[]> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<QueuedScan[]>();
  const tx = db.transaction("queued_scans", "readonly");
  const store = tx.objectStore("queued_scans");
  const req = store.getAll();
  req.onsuccess = () => {
    const all: QueuedScan[] = req.result || [];
    // Only return unsynced scans that are not already resolved conflicts
    const unsynced = all.filter(
      (s) => s.point_id === pointId && !s.synced && s.sync_state !== "CONFLICT"
    );
    resolve(unsynced);
  };
  req.onerror = () => reject(req.error);
  return promise;
}

export async function getAllScansForPoint(pointId: string): Promise<QueuedScan[]> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<QueuedScan[]>();
  const tx = db.transaction("queued_scans", "readonly");
  const store = tx.objectStore("queued_scans");
  const req = store.getAll();
  req.onsuccess = () => {
    const all: QueuedScan[] = req.result || [];
    const forPoint = all.filter((s) => s.point_id === pointId);
    resolve(forPoint);
  };
  req.onerror = () => reject(req.error);
  return promise;
}

export async function getConflictsForPoint(pointId: string): Promise<QueuedScan[]> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<QueuedScan[]>();
  const tx = db.transaction("queued_scans", "readonly");
  const store = tx.objectStore("queued_scans");
  const req = store.getAll();
  req.onsuccess = () => {
    const all: QueuedScan[] = req.result || [];
    const conflicts = all.filter(
      (s) => s.point_id === pointId && s.sync_state === "CONFLICT" && !s.conflict_acknowledged
    );
    resolve(conflicts);
  };
  req.onerror = () => reject(req.error);
  return promise;
}

export async function acknowledgeConflict(scanId: string): Promise<void> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("queued_scans", "readwrite");
  const store = tx.objectStore("queued_scans");
  const getReq = store.get(scanId);
  getReq.onsuccess = () => {
    if (getReq.result) {
      const record = getReq.result as QueuedScan;
      record.conflict_acknowledged = true;
      store.put(record);
    }
    resolve();
  };
  getReq.onerror = () => reject(getReq.error);
  return promise;
}

export async function reconcileBatchOutcomes(
  pointId: string,
  serverResults: ServerScanResult[]
): Promise<ReconciliationReport> {
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<ReconciliationReport>();
  const tx = db.transaction("queued_scans", "readwrite");
  const store = tx.objectStore("queued_scans");

  const resultsMap: Record<string, ServerScanResult> = {};
  for (const r of serverResults) {
    resultsMap[r.scan_id] = r;
  }
  const conflicts: QueuedScan[] = [];
  let confirmedCount = 0;
  let conflictCount = 0;

  const getAllReq = store.getAll();
  getAllReq.onsuccess = () => {
    const all: QueuedScan[] = getAllReq.result || [];
    const now = new Date().toISOString();

    for (const scan of all) {
      if (scan.point_id !== pointId) continue;
      const serverRes = resultsMap[scan.scan_id];
      if (!serverRes) continue;

      scan.synced = true;
      scan.reconciled_at = now;
      if (serverRes.attendee_name) scan.attendee_name = serverRes.attendee_name;
      if (serverRes.ticket_tier_name) scan.ticket_tier_name = serverRes.ticket_tier_name;

      if (serverRes.status === "ADMITTED") {
        scan.status = "ADMITTED";
        scan.sync_state = "CONFIRMED";
        scan.rejection_reason = null;
        confirmedCount += 1;
      } else {
        // Server rejected this scan (conflict with another device or rule violation)
        scan.status = "REJECTED";
        scan.sync_state = "CONFLICT";
        scan.rejection_reason = serverRes.rejection_reason || "SERVER_REJECTED";
        scan.conflict_acknowledged = false;
        conflictCount += 1;
        conflicts.push(scan);
      }

      store.put(scan);
    }

    resolve({ confirmedCount, conflictCount, conflicts });
  };
  getAllReq.onerror = () => reject(getAllReq.error);
  return promise;
}

// Deprecated backward-compatible wrapper
export async function markScansSyncedInDb(scanIds: string[]): Promise<void> {
  if (scanIds.length === 0) return;
  const db = await openDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("queued_scans", "readwrite");
  const store = tx.objectStore("queued_scans");

  let completed = 0;
  for (const id of scanIds) {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      if (getReq.result) {
        getReq.result.synced = true;
        store.put(getReq.result);
      }
      completed += 1;
      if (completed === scanIds.length) {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  }
  return promise;
}
