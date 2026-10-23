/**
 * IndexedDB home of the offline lead queue (lib/leadQueue.ts). Same robustness rules as the gate scanner's
 * storage (lib/scannerStorage.ts): one connection per page that closes itself when another tab upgrades the
 * database (`onversionchange`), results read only once a transaction has committed (`oncomplete`), and a
 * blocked upgrade reported instead of hanging.
 */
import type { LeadQueueStore, QueuedLeadScan } from "./leadQueue.ts";

const DB_NAME = "congress_booth_leads_db";
const DB_VERSION = 1;
const SCANS = "queued_lead_scans";
const BY_OWNER_BOOTH = "owner_booth";

/** Another tab still holds an older version of the database open. */
export class LeadQueueBlockedError extends Error {
  constructor() {
    super("Lead storage is being upgraded: close other booth workspace tabs, then reload.");
    this.name = "LeadQueueBlockedError";
  }
}

let connection: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (connection) return connection;
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  if (typeof indexedDB === "undefined") {
    reject(new Error("IndexedDB is not available on this device."));
    return promise;
  }

  let settled = false;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    const store = db.objectStoreNames.contains(SCANS)
      ? request.transaction!.objectStore(SCANS)
      : db.createObjectStore(SCANS, { keyPath: "id" });
    if (!store.indexNames.contains(BY_OWNER_BOOTH)) {
      store.createIndex(BY_OWNER_BOOTH, ["owner", "booth_id"], { unique: false });
    }
  };
  request.onblocked = () => {
    settled = true;
    connection = null;
    reject(new LeadQueueBlockedError());
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
  // A failed open is not cached: the next call tries again.
  promise.catch(() => {
    if (connection === promise) connection = null;
  });
  return promise;
}

/** One transaction; the reader runs only after the transaction committed. */
async function transact<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => () => T): Promise<T> {
  let tx: IDBTransaction;
  try {
    tx = (await openDb()).transaction(SCANS, mode);
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
    connection = null; // closed underneath us (version change): reopen once
    tx = (await openDb()).transaction(SCANS, mode);
  }
  const read = body(tx.objectStore(SCANS));
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  tx.oncomplete = () => resolve(read());
  tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  return promise;
}

export const indexedDbLeadQueue: LeadQueueStore = {
  list(owner, boothId) {
    return transact("readonly", (store) => {
      const req = store.index(BY_OWNER_BOOTH).getAll([owner, boothId]);
      return () => (req.result as QueuedLeadScan[]).sort((a, b) => a.queued_at.localeCompare(b.queued_at));
    });
  },
  async put(scan) {
    await transact("readwrite", (store) => {
      store.put(scan);
      return () => undefined;
    });
  },
  async remove(id) {
    await transact("readwrite", (store) => {
      store.delete(id);
      return () => undefined;
    });
  },
};

/** Asks the browser not to evict this origin's storage: queued scans exist only on this device. */
export async function requestPersistentLeadStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
