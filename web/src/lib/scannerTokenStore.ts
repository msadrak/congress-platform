/**
 * Persistent scanner device token storage.
 *
 * Uses a separate IndexedDB database from the scan storage so that
 * token persistence does not trigger version upgrades on the scan DB.
 *
 * Security notes:
 * - Tokens persist across browser restarts to enable offline scanner recovery.
 * - This is an intentional tradeoff: without the token, the scanner cannot
 *   re-authenticate after a browser restart, but with it, anyone with
 *   physical device access can use the scanner until the token is revoked.
 * - Tokens are scoped per check-in point ID.
 * - The organizer can revoke scanner tokens server-side at any time.
 * - clearPersistedToken() should be called on explicit logout.
 */

const TOKEN_DB_NAME = "congress_scanner_tokens";
const TOKEN_DB_VERSION = 1;

function openTokenDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();

  if (typeof window === "undefined" || !window.indexedDB) {
    reject(new Error("IndexedDB is not supported."));
    return promise;
  }

  const request = indexedDB.open(TOKEN_DB_NAME, TOKEN_DB_VERSION);

  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("tokens")) {
      db.createObjectStore("tokens", { keyPath: "pointId" });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

export interface PersistedScannerCredential {
  pointId: string;
  token: string;
  stored_at: string;
  device_id?: string | null;
  token_issued_at?: string | null;
  token_expires_at?: string | null;
  deactivation_pending?: boolean;
}

/**
 * Persist a scanner token for a check-in point across browser restarts.
 */
export async function persistScannerToken(
  pointId: string,
  token: string,
  meta?: {
    device_id?: string | null;
    token_issued_at?: string | null;
    token_expires_at?: string | null;
  }
): Promise<void> {
  const db = await openTokenDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("tokens", "readwrite");
  const store = tx.objectStore("tokens");
  const req = store.put({
    pointId,
    token,
    stored_at: new Date().toISOString(),
    device_id: meta?.device_id ?? null,
    token_issued_at: meta?.token_issued_at ?? null,
    token_expires_at: meta?.token_expires_at ?? null,
    deactivation_pending: false,
  });
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
  return promise;
}

/** Persist local admission shutdown until server revocation is confirmed. */
export async function markScannerDeactivationPending(pointId: string): Promise<void> {
  const credential = await getPersistedScannerCredential(pointId);
  if (!credential) return;
  const db = await openTokenDb();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const tx = db.transaction("tokens", "readwrite");
  const req = tx.objectStore("tokens").put({
    ...credential,
    deactivation_pending: true,
  });
  req.onsuccess = () => resolve();
  req.onerror = () => reject(req.error);
  return promise;
}

/**
 * Retrieve the persisted scanner token for a check-in point.
 * Returns null if no token is stored.
 */
export async function getPersistedScannerToken(
  pointId: string
): Promise<string | null> {
  const credential = await getPersistedScannerCredential(pointId);
  return credential ? credential.token : null;
}

/**
 * Retrieve the full persisted scanner credential, including device binding
 * and token validity metadata used for offline authorization limits.
 */
export async function getPersistedScannerCredential(
  pointId: string
): Promise<PersistedScannerCredential | null> {
  try {
    const db = await openTokenDb();
    const { promise, resolve, reject } = Promise.withResolvers<PersistedScannerCredential | null>();
    const tx = db.transaction("tokens", "readonly");
    const store = tx.objectStore("tokens");
    const req = store.get(pointId);
    req.onsuccess = () => {
      resolve(req.result ? (req.result as PersistedScannerCredential) : null);
    };
    req.onerror = () => reject(req.error);
    return promise;
  } catch {
    return null;
  }
}

/**
 * Clear the persisted scanner token (explicit logout / deauthorization).
 */
export async function clearPersistedToken(pointId: string): Promise<void> {
  try {
    const db = await openTokenDb();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const tx = db.transaction("tokens", "readwrite");
    const store = tx.objectStore("tokens");
    const req = store.delete(pointId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    return promise;
  } catch {
    // Best-effort cleanup
  }
}
