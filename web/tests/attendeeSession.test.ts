import { strict as assert } from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

// A browser-like global with an in-memory localStorage, installed before the session module loads.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

const storage = new MemoryStorage();
const storageListeners = new Set<(event: { key: string | null }) => void>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: storage,
    addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === "storage") storageListeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
      if (type === "storage") storageListeners.delete(listener);
    },
  },
});

const session = await import("../src/lib/attendeeSession.ts");
const { ATTENDEE_TOKEN_STORAGE, createApiClient } = await import("../src/api/client.ts");
const { CACHED_TICKETS_KEY_PREFIX, saveOwnerScopedTickets } = await import("../src/lib/ticketCache.ts");

let serial = 0;
/** A distinct token per call (module state remembers rejected tokens), for the user `sub`. */
function jwt(sub: string): string {
  serial += 1;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600, n: serial })).toString("base64url");
  return `${header}.${payload}.sig`;
}
const cacheKey = (sub: string) => `${CACHED_TICKETS_KEY_PREFIX}${sub}`;
/** Signs `sub` in and caches one pass for it, as My Tickets does. */
function signInWithPass(sub: string): string {
  const token = jwt(sub);
  session.storeAttendeeToken(token);
  assert.equal(saveOwnerScopedTickets(token, []), true);
  return token;
}

beforeEach(() => {
  session.signOutAttendee();
  storage.clear();
});

describe("attendee session policy", () => {
  it("1: a 401 for the stored token removes the token and its owner's passes, and notifies", () => {
    const token = signInWithPass("user-a");
    let notified = 0;
    const unsubscribe = session.subscribeAttendeeSession(() => notified++);
    assert.equal(session.rejectAttendeeToken(token), true);
    unsubscribe();
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), null);
    assert.equal(storage.getItem(cacheKey("user-a")), null);
    assert.equal(session.isAttendeeSessionExpired(), true);
    assert.equal(notified, 1);
  });

  it("2: a late 401 for a token another tab replaced leaves the newer session and its passes", () => {
    const old = jwt("user-a");
    session.storeAttendeeToken(old);
    const newer = signInWithPass("user-b");
    assert.equal(session.rejectAttendeeToken(old), false);
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), newer);
    assert.notEqual(storage.getItem(cacheKey("user-b")), null);
    assert.equal(session.isAttendeeSessionExpired(), false);
  });

  it("3: signing out clears the passes even when the token was removed first", () => {
    signInWithPass("user-a");
    storage.removeItem(ATTENDEE_TOKEN_STORAGE);
    session.signOutAttendee();
    assert.equal(storage.getItem(cacheKey("user-a")), null);
    assert.equal(session.isAttendeeSessionExpired(), false);
  });

  it("4: My Tickets keeps the session only while it shows the owner's cached pass", () => {
    const kept = signInWithPass("user-a");
    assert.equal(session.keepPassOnExpiredSession(kept, true), true);
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), kept);
    assert.notEqual(storage.getItem(cacheKey("user-a")), null);

    assert.equal(session.keepPassOnExpiredSession(kept, false), false);
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), null);
    assert.equal(storage.getItem(cacheKey("user-a")), null);
  });

  it("5: an account switch clears the previous owner's passes; a renewed token for the same owner keeps them", () => {
    signInWithPass("user-a");
    session.storeAttendeeToken(jwt("user-a"));
    assert.notEqual(storage.getItem(cacheKey("user-a")), null);
    session.storeAttendeeToken(jwt("user-b"));
    assert.equal(storage.getItem(cacheKey("user-a")), null);
  });

  it("a new sign-in ends the expired state", () => {
    session.rejectAttendeeToken(signInWithPass("user-a"));
    assert.equal(session.isAttendeeSessionExpired(), true);
    session.storeAttendeeToken(jwt("user-a"));
    assert.equal(session.isAttendeeSessionExpired(), false);
  });

  it("classifies a response as current, expired or changed", () => {
    const token = signInWithPass("user-a");
    assert.equal(session.attendeeResponseState(token, 200), "current");
    assert.equal(session.attendeeResponseState(token, 401), "expired");
    session.rejectAttendeeToken(token);
    // The API client already removed it: a 401 for it still reads as this tab's expiry.
    assert.equal(session.attendeeResponseState(token, 401), "expired");
    session.storeAttendeeToken(jwt("user-b"));
    assert.equal(session.attendeeResponseState(token, 200), "changed");
    assert.equal(session.attendeeResponseState(jwt("user-c"), 401), "changed");
  });

  it("another tab's change reaches subscribers through the storage event", () => {
    let notified = 0;
    const unsubscribe = session.subscribeAttendeeSession(() => notified++);
    for (const listener of storageListeners) listener({ key: ATTENDEE_TOKEN_STORAGE });
    for (const listener of storageListeners) listener({ key: "unrelated" });
    unsubscribe();
    assert.equal(notified, 1);
    assert.equal(storageListeners.size, 0);
  });
});

describe("user client 401 middleware", () => {
  const answering = (status: number) => ({
    baseUrl: "http://fixture.test",
    fetch: async () => Response.json({ detail: "x" }, { status }),
  });

  it("a 401 for the stored token rejects it through the registered handler", async () => {
    const token = signInWithPass("user-a");
    const { response } = await createApiClient({ kind: "user", token }, answering(401)).GET("/api/auth/me");
    assert.equal(response.status, 401);
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), null);
    assert.equal(storage.getItem(cacheKey("user-a")), null);
  });

  it("other statuses and onUnauthorized: null leave the session alone", async () => {
    const token = signInWithPass("user-a");
    await createApiClient({ kind: "user", token }, answering(403)).GET("/api/auth/me");
    await createApiClient({ kind: "user", token }, { ...answering(401), onUnauthorized: null }).GET("/api/auth/me");
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), token);
  });

  it("a late 401 for a replaced token does not remove the newer one", async () => {
    const old = jwt("user-a");
    session.storeAttendeeToken(old);
    const newer = jwt("user-b");
    session.storeAttendeeToken(newer);
    await createApiClient({ kind: "user", token: old }, answering(401)).GET("/api/auth/me");
    assert.equal(storage.getItem(ATTENDEE_TOKEN_STORAGE), newer);
  });
});
