/**
 * Where an installed app lands when it is opened from the home screen.
 *
 * One manifest serves every portal, so the installed icon cannot name a destination at build time (point
 * ids and passes do not exist yet, and a runtime-generated manifest would need `manifest-src blob:` in the
 * production CSP). Instead the manifest starts at `/?source=pwa` — a URL only a home-screen launch
 * opens — and `handleHomeScreenLaunch` turns it into the right address before the app renders, from what
 * this device holds (`chooseLaunchPath` is the whole decision, in this order):
 *
 * 1. a phone paired as a gate scanner (a credential exists in the scanner token store) reopens its own
 *    point, so an operator never lands on the marketing page between two shifts;
 * 2. an attendee holding an active pass for exactly one live or upcoming congress opens that pass
 *    (`/c/<slug>/my-ticket`); passes for several congresses open `/me`;
 * 3. otherwise the last booth or desk used on this device (`recordOperatorLaunch`, written by each tool
 *    once it is ready). Booth staff sign in with an attendee token, so the token alone must not turn
 *    their icon into `/me`;
 * 4. otherwise `/me` for a device that holds an attendee session or link pass, else the home page.
 *
 * It is a rewrite of the address, not a redirect: nothing is fetched, nothing reloads, and it works
 * offline (the attendee part reads localStorage only). `pwaRegistration.ts` runs it first thing (main.tsx
 * imports that module before the router exists); keep it ahead of anything that reads `window.location`
 * when the router is created.
 *
 * iOS adds a page to the home screen at the address it was on, so an iOS scanner reopens at
 * `/scan/<point>` directly; the credential there belongs to the installed app's own storage.
 */
import { ATTENDEE_TOKEN_STORAGE } from "../api/client.ts";
import { loadLinkPasses } from "./linkPass.ts";
import { isCancelledStatus } from "./attendeePasses.ts";
import { CACHED_TICKETS_KEY_PREFIX, getAuthenticatedUserId } from "./ticketCache.ts";

/** Must equal `start_url` in `web/pwa-manifest.ts` (`tests/pwaManifest.test.ts` pins both). */
export const HOME_SCREEN_START_URL = "/?source=pwa";

const MARKER_PARAM = "source";
const MARKER_VALUE = "pwa";

/** Point ids, congress slugs and booth or event ids end up in a path; accept only the characters they are made of. */
const PATH_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
    if (!("pointId" in credential) || typeof credential.pointId !== "string" || !PATH_ID.test(credential.pointId)) continue;
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
  /** localStorage, where the attendee session, cached passes, link passes and the operator record live. */
  storage?: Storage | null;
  now?: () => number;
}

/**
 * Applies a home-screen launch. Resolves to the address the app was moved to, or null when it stayed on the
 * home page (or this was not a launch). Never rejects and never waits longer than `timeoutMs`: a storage
 * failure must not keep the app from starting.
 */
export async function handleHomeScreenLaunch(env: LaunchEnv = browserLaunchEnv()): Promise<string | null> {
  if (!isHomeScreenLaunch(env.location)) return null;
  const scannerPointId = await withTimeout(
    Promise.resolve()
      .then(() => env.readScannerCredentials())
      .then(pickScannerPoint),
    env.timeoutMs
  ).catch(() => null);
  const now = env.now?.() ?? Date.now();
  const path = chooseLaunchPath({ scannerPointId, ...readDeviceLaunchState(env.storage ?? null, now) }, now);
  env.replaceUrl(path ?? homeScreenCleanPath(env.location));
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
    storage: browserStorage(),
    now: Date.now,
  };
}

/** A working or cancelled pass the device knows about, reduced to what the decision needs. */
export interface LaunchPass {
  slug: string;
  endsAt: string;
  status: string;
}

export type OperatorKind = "scan" | "booth" | "desk";

export interface OperatorLaunch {
  kind: OperatorKind;
  path: string;
  at: number;
}

export interface DeviceLaunchState {
  passes: LaunchPass[];
  operator: OperatorLaunch | null;
  /** An attendee session or a link pass is on this device. */
  hasAttendeeIdentity: boolean;
}

/** Slugs of the congresses (live or upcoming) the device holds an active pass for. Unusable dates count as ahead. */
function liveCongressSlugs(passes: readonly LaunchPass[], now: number): string[] {
  const slugs = new Set<string>();
  for (const pass of passes) {
    if (!PATH_ID.test(pass.slug) || isCancelledStatus(pass.status)) continue;
    const ends = Date.parse(pass.endsAt);
    if (Number.isNaN(ends) || now <= ends) slugs.add(pass.slug);
  }
  return [...slugs];
}

/** The address a home-screen launch opens, or null for the plain home page. See the header for the order. */
export function chooseLaunchPath(device: DeviceLaunchState & { scannerPointId: string | null }, now: number): string | null {
  if (device.scannerPointId !== null) return scannerLaunchPath(device.scannerPointId);
  const slugs = liveCongressSlugs(device.passes, now);
  if (slugs.length === 1) return `/c/${slugs[0]}/my-ticket`;
  if (slugs.length > 1) return "/me";
  // Scanner records are the scanner credentials' business (step 1); only booth and desk are reopened from here.
  if (device.operator && device.operator.kind !== "scan") return device.operator.path;
  return device.hasAttendeeIdentity ? "/me" : null;
}

/** localStorage, or null where it is blocked (some privacy modes throw on access). */
function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The passes the signed-in attendee cached for offline use. Read raw, without the cache's 7-day clock
 * (`ticketCache.ts`): this only picks the address, and the pass page itself decides what an old cache may
 * still show. Only the token's own owner key is read, so another account's passes are never touched.
 */
function cachedPasses(storage: Storage, token: string | null): LaunchPass[] {
  const userId = getAuthenticatedUserId(token);
  if (!userId) return [];
  let envelope: unknown;
  try {
    envelope = JSON.parse(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}${userId}`) ?? "null");
  } catch {
    return [];
  }
  if (typeof envelope !== "object" || envelope === null || !("tickets" in envelope) || !Array.isArray(envelope.tickets)) return [];
  const passes: LaunchPass[] = [];
  for (const ticket of envelope.tickets as unknown[]) {
    if (typeof ticket !== "object" || ticket === null) continue;
    if (!("event_slug" in ticket) || typeof ticket.event_slug !== "string") continue;
    if (!("event_ends_at" in ticket) || typeof ticket.event_ends_at !== "string") continue;
    if (!("status" in ticket) || typeof ticket.status !== "string") continue;
    passes.push({ slug: ticket.event_slug, endsAt: ticket.event_ends_at, status: ticket.status });
  }
  return passes;
}

/** What this device holds that decides the launch. localStorage only, so it works offline; never throws. */
export function readDeviceLaunchState(storage: Storage | null, now: number): DeviceLaunchState {
  const none: DeviceLaunchState = { passes: [], operator: null, hasAttendeeIdentity: false };
  if (!storage) return none;
  try {
    const token = storage.getItem(ATTENDEE_TOKEN_STORAGE);
    const linkPasses = loadLinkPasses(undefined, now, storage);
    return {
      passes: [
        ...cachedPasses(storage, token),
        ...linkPasses.map((pass) => ({ slug: pass.event.slug, endsAt: pass.event.ends_at, status: pass.status })),
      ],
      operator: readOperatorLaunch(storage),
      hasAttendeeIdentity: Boolean(token) || linkPasses.length > 0,
    };
  } catch {
    return none;
  }
}

/**
 * The last operator tool used on this device: `{kind, path, at}`, written by each tool once it is ready (a
 * scanner paired, a booth loaded, the desk signed in) so a home-screen launch can reopen it.
 */
export const OPERATOR_LAUNCH_KEY = "congress_operator_launch";

/** The path each tool may record. The value comes back from storage and ends up in the address bar. */
const OPERATOR_PATHS: Record<OperatorKind, RegExp> = {
  scan: /^\/scan\/[A-Za-z0-9_-]{1,64}$/,
  booth: /^\/booth\/[A-Za-z0-9_-]{1,64}$/,
  desk: /^\/reception\/[A-Za-z0-9_-]{1,64}$/,
};

function isOperatorKind(value: unknown): value is OperatorKind {
  return value === "scan" || value === "booth" || value === "desk";
}

/** Remember the tool and path to reopen. A path that does not belong to the tool is refused, not stored. */
export function recordOperatorLaunch(kind: OperatorKind, path: string, now: number = Date.now(), storage: Storage | null = browserStorage()): void {
  if (!storage || !OPERATOR_PATHS[kind].test(path)) return;
  try {
    storage.setItem(OPERATOR_LAUNCH_KEY, JSON.stringify({ kind, path, at: now }));
  } catch {
    // storage full or blocked: the launch falls back to the home page
  }
}

export function readOperatorLaunch(storage: Storage | null = browserStorage()): OperatorLaunch | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(OPERATOR_LAUNCH_KEY) ?? "null");
    if (typeof value !== "object" || value === null) return null;
    if (!("kind" in value) || !isOperatorKind(value.kind)) return null;
    if (!("path" in value) || typeof value.path !== "string" || !OPERATOR_PATHS[value.kind].test(value.path)) return null;
    if (!("at" in value) || typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
    return { kind: value.kind, path: value.path, at: value.at };
  } catch {
    return null;
  }
}

/** The scanner, booth and desk screens, where operators are mid-task and the app must not interrupt them. */
export function isOperatorRoute(pathname: string): boolean {
  return /^\/(?:scan|booth|reception)(?:\/|$)/.test(pathname);
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
