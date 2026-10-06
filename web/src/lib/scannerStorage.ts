export interface QueuedScan {
  scan_id: string;
  point_id: string;
  qr_secret: string;
  scanned_at: string;
  status: "ADMITTED" | "REJECTED";
  rejection_reason: string | null;
  synced: boolean;
}

const DB_NAME = "congress_scanner_db";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();

  if (typeof window === "undefined" || !window.indexedDB) {
    reject(new Error("IndexedDB is not available in this environment."));
    return promise;
  }

  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("manifests")) {
      db.createObjectStore("manifests", { keyPath: "pointId" });
    }
    if (!db.objectStoreNames.contains("queued_scans")) {
      const scanStore = db.createObjectStore("queued_scans", {
        keyPath: "scan_id",
      });
      scanStore.createIndex("point_id", "point_id", { unique: false });
      scanStore.createIndex("synced", "synced", { unique: false });
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
    const unsynced = all.filter((s) => s.point_id === pointId && !s.synced);
    resolve(unsynced);
  };
  req.onerror = () => reject(req.error);
  return promise;
}

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
