/**
 * Where an installed app lands when it is opened from the home screen.
 *
 * One manifest serves every portal, so the installed icon cannot name a scanner point at build time (the
 * point ids do not exist yet, and a runtime-generated manifest would need `manifest-src blob:` in the
 * production CSP). Instead the manifest starts at `/?source=pwa` — a URL only a home-screen launch
 * opens — and `handleHomeScreenLaunch` turns it into the right address before the app renders:
 *
 * - a phone paired as a gate scanner (a credential exists in the scanner token store) reopens its own
 *   point, so an operator never lands on the marketing page between two shifts;
 * - every other device gets the plain home page, with the marker removed from the address.
 *
 * It is a rewrite of the address, not a redirect: nothing is fetched, nothing reloads, and it works
 * offline. `pwaRegistration.ts` runs it first thing (main.tsx imports that module before the router
 * exists); keep it ahead of anything that reads `window.location` when the router is created.
 *
 * iOS adds a page to the home screen at the address it was on, so an iOS scanner reopens at
 * `/scan/<point>` directly; the credential there belongs to the installed app's own storage.
 */

/** Must equal `start_url` in `web/pwa-manifest.ts` (`tests/pwaManifest.test.ts` pins both). */
export const HOME_SCREEN_START_URL = "/?source=pwa";

const MARKER_PARAM = "source";
const MARKER_VALUE = "pwa";

/** Point ids end up in a path; accept only the characters ids are made of. */
const POINT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Longest start-up waits for storage before the app opens on the home page instead. */
const STORAGE_TIMEOUT_MS = 1500;

/** Owned by `scannerTokenStore.ts`; read-only here, so the two must agree on the names. */
const TOKEN_DB_NAME = "congress_scanner_tokens";
const TOKEN_STORE_NAME = "tokens";

interface LaunchLocation {
  pathname: string;
  search: string;
}

/** True only on the root path with the marker: ordinary visits and deep links are never rewritten. */
export function isHomeScreenLaunch(location: LaunchLocation): boolean {
  return location.pathname === "/" && new URLSearchParams(location.search).get(MARKER_PARAM) === MARKER_VALUE;
}

/** The launch address without the marker; other parameters and the hash stay. */
export function homeScreenCleanPath(location: LaunchLocation & { hash: string }): string {
  const params = new URLSearchParams(location.search);
  params.delete(MARKER_PARAM);
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

export function scannerLaunchPath(pointId: string): string {
  return `/scan/${encodeURIComponent(pointId)}`;
}

/**
 * The point to reopen among the persisted scanner credentials: the most recently paired one. An entry
 * with an unreadable pairing time still counts (a deactivated or expired credential must reach the
 * scanner screen to be finished or re-paired) but ranks last. Values come from storage, so each is
 * checked before it becomes part of a path.
 */
export function pickScannerPoint(credentials: readonly unknown[]): string | null {
  let best: { pointId: string; pairedAt: number } | null = null;
  for (const credential of credentials) {
    if (typeof credential !== "object" || credential === null) continue;
    if (!("pointId" in credential) || typeof credential.pointId !== "string" || !POINT_ID.test(credential.pointId)) continue;
    const parsed = "stored_at" in credential && typeof credential.stored_at === "string" ? Date.parse(credential.stored_at) : Number.NaN;
    const pairedAt = Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    if (best === null || pairedAt > best.pairedAt) best = { pointId: credential.pointId, pairedAt };
  }
  return best?.pointId ?? null;
}

export interface LaunchEnv {
  location: LaunchLocation & { hash: string };
  replaceUrl(path: string): void;
  readScannerCredentials(): Promise<unknown[]>;
  timeoutMs: number;
}

/**
 * Applies a home-screen launch. Resolves to the scanner path the app was moved to, or null when it
 * stayed on the home page (or this was not a launch). Never rejects and never waits longer than
 * `timeoutMs`: a storage failure must not keep the app from starting.
 */
export async function handleHomeScreenLaunch(env: LaunchEnv = browserLaunchEnv()): Promise<string | null> {
  if (!isHomeScreenLaunch(env.location)) return null;
  const pointId = await withTimeout(
    Promise.resolve()
      .then(() => env.readScannerCredentials())
      .then(pickScannerPoint),
    env.timeoutMs
  ).catch(() => null);
  if (pointId === null) {
    env.replaceUrl(homeScreenCleanPath(env.location));
    return null;
  }
  const path = scannerLaunchPath(pointId);
  env.replaceUrl(path);
  return path;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  const { promise, resolve, reject } = Promise.withResolvers<T | null>();
  const timer = setTimeout(() => resolve(null), ms);
  work.then(resolve, reject).finally(() => clearTimeout(timer));
  return promise;
}

function browserLaunchEnv(): LaunchEnv {
  return {
    location: window.location,
    replaceUrl: (path) => window.history.replaceState(window.history.state, "", path),
    readScannerCredentials: readPersistedScannerCredentials,
    timeoutMs: STORAGE_TIMEOUT_MS,
  };
}

/**
 * Every persisted scanner credential, or none. This must never create the database: opening a name that
 * does not exist yet makes an empty one, and `scannerTokenStore` (which opens version 1 and creates its
 * object store only in `onupgradeneeded`) would then never get a store. A fresh database therefore
 * aborts its own creation — the device was simply never paired.
 */
function readPersistedScannerCredentials(): Promise<unknown[]> {
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  if (typeof indexedDB === "undefined") {
    resolve([]);
    return promise;
  }
  let request: IDBOpenDBRequest;
  try {
    request = indexedDB.open(TOKEN_DB_NAME);
  } catch {
    resolve([]);
    return promise;
  }
  request.onupgradeneeded = () => request.transaction?.abort();
  request.onerror = (event) => {
    event.preventDefault();
    resolve([]);
  };
  request.onsuccess = () => {
    const db = request.result;
    try {
      if (!db.objectStoreNames.contains(TOKEN_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }
      const all = db.transaction(TOKEN_STORE_NAME, "readonly").objectStore(TOKEN_STORE_NAME).getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result);
      };
      all.onerror = () => {
        db.close();
        resolve([]);
      };
    } catch {
      db.close();
      resolve([]);
    }
  };
  return promise;
}
