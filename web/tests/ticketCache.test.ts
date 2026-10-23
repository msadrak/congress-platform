import test from "node:test";
import assert from "node:assert/strict";
import {
  loadOwnerScopedTickets,
  saveOwnerScopedTickets,
  clearOwnerScopedTickets,
  extractJwtClaims,
  getAuthenticatedUserId,
  LEGACY_CACHED_TICKETS_KEY,
  CACHED_TICKETS_KEY_PREFIX,
} from "../src/lib/ticketCache.ts";
import type { AttendeeTicketDetail } from "../src/api/client.ts";
// Helper to construct a mock JWT token with given sub and exp claims
function makeMockJwt(sub: string, expSeconds: number = Math.floor(Date.now() / 1000) + 3600): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub, exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.mockSignature`;
}

// In-memory Storage mock implementing standard Web Storage API
class MockStorage implements Storage {
  private store: Map<string, string> = new Map();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const mockTicket: AttendeeTicketDetail = {
  id: "ticket-uuid-001",
  event_id: "event-uuid-001",
  event_name: "Annual Medical Congress",
  event_slug: "annual-med-2027",
  ticket_tier_id: "tier-uuid-001",
  ticket_tier_name: "Full Delegate",
  status: "active",
  qr_secret: "SECRET12345",
  created_at: "2027-04-10T08:00:00Z",
};

test("extractJwtClaims and getAuthenticatedUserId extract valid sub", () => {
  const token = makeMockJwt("user-alice-123");
  const claims = extractJwtClaims(token);
  assert.equal(claims?.sub, "user-alice-123");
  assert.equal(getAuthenticatedUserId(token), "user-alice-123");

  assert.equal(extractJwtClaims(null), null);
  assert.equal(extractJwtClaims("invalid-token"), null);
  assert.equal(getAuthenticatedUserId(null), null);
});

test("loadOwnerScopedTickets fails closed for unauthenticated requests", () => {
  const storage = new MockStorage();
  // Simulate an unscoped legacy entry in storage
  storage.setItem(LEGACY_CACHED_TICKETS_KEY, JSON.stringify([mockTicket]));

  const resultNoToken = loadOwnerScopedTickets(null, Date.now(), storage);
  assert.equal(resultNoToken.status, "unauthorized");
  assert.deepEqual(resultNoToken.tickets, []);

  // Legacy key must be purged
  assert.equal(storage.getItem(LEGACY_CACHED_TICKETS_KEY), null);

  const resultEmptyToken = loadOwnerScopedTickets("", Date.now(), storage);
  assert.equal(resultEmptyToken.status, "unauthorized");
});

test("saveOwnerScopedTickets stores under user-scoped key and loadOwnerScopedTickets retrieves it", () => {
  const storage = new MockStorage();
  const tokenAlice = makeMockJwt("user-alice-123");

  const saved = saveOwnerScopedTickets(tokenAlice, [mockTicket], 1000, 5000, storage);
  assert.equal(saved, true);

  // Key in storage must include Alice's ID
  assert.ok(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-alice-123`));
  assert.equal(storage.getItem(LEGACY_CACHED_TICKETS_KEY), null);

  const loaded = loadOwnerScopedTickets(tokenAlice, 2000, storage);
  assert.equal(loaded.status, "valid");
  if (loaded.status === "valid") {
    assert.equal(loaded.userId, "user-alice-123");
    assert.equal(loaded.tickets.length, 1);
    assert.equal(loaded.tickets[0].id, "ticket-uuid-001");
  }
});

test("account switching strictly prevents cross-user cache access", () => {
  const storage = new MockStorage();
  const tokenAlice = makeMockJwt("user-alice-123");
  const tokenBob = makeMockJwt("user-bob-456");

  // Alice saves her pass
  saveOwnerScopedTickets(tokenAlice, [mockTicket], 1000, 10000, storage);

  // Bob logs into the same device and accesses his tickets
  const bobResult = loadOwnerScopedTickets(tokenBob, 2000, storage);
  assert.equal(bobResult.status, "empty");
  assert.deepEqual(bobResult.tickets, []);

  // Bob must NOT see Alice's ticket
  const bobHasAliceData = bobResult.tickets.some((t: AttendeeTicketDetail) => t.id === "ticket-uuid-001");
  assert.equal(bobHasAliceData, false);

  // Alice's data still exists under her scoped key
  const aliceResult = loadOwnerScopedTickets(tokenAlice, 2000, storage);
  assert.equal(aliceResult.status, "valid");
});

test("cache expiration enforces TTL policy and purges expired pass", () => {
  const storage = new MockStorage();
  const token = makeMockJwt("user-ttl-789");

  // Save at t=1000 with 3000ms TTL (expires at 4000)
  saveOwnerScopedTickets(token, [mockTicket], 1000, 3000, storage);

  // Read at t=3500 (before expiration) -> valid
  const resultBefore = loadOwnerScopedTickets(token, 3500, storage);
  assert.equal(resultBefore.status, "valid");

  // Read at t=4500 (after expiration) -> expired & purged
  const resultAfter = loadOwnerScopedTickets(token, 4500, storage);
  assert.equal(resultAfter.status, "expired");
  assert.deepEqual(resultAfter.tickets, []);

  // Key is removed from storage
  assert.equal(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-ttl-789`), null);
});

const DAY = 86_400_000;
const NOW = Date.parse("2027-01-01T00:00:00Z");
const endingIn = (days: number, id = "ticket-uuid-001"): AttendeeTicketDetail => ({
  ...mockTicket,
  id,
  event_ends_at: new Date(NOW + days * DAY).toISOString(),
});

test("a saved pass stays until its congress ends, not for a fixed 7 days", () => {
  const storage = new MockStorage();
  const token = makeMockJwt("user-early-1");

  // The attendee signs in two months before the congress; the home-screen icon must still open the pass at the gate.
  saveOwnerScopedTickets(token, [endingIn(60)], NOW, undefined, storage);

  assert.equal(loadOwnerScopedTickets(token, NOW + 30 * DAY, storage).status, "valid");
  assert.equal(loadOwnerScopedTickets(token, NOW + 59 * DAY, storage).status, "valid");
  assert.equal(loadOwnerScopedTickets(token, NOW + 61 * DAY, storage).status, "expired");
  assert.equal(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-early-1`), null);
});

test("with several congresses the pass is kept until the last one ends", () => {
  const storage = new MockStorage();
  const token = makeMockJwt("user-two-2");

  saveOwnerScopedTickets(token, [endingIn(10, "a"), endingIn(90, "b"), endingIn(40, "c")], NOW, undefined, storage);

  assert.equal(loadOwnerScopedTickets(token, NOW + 89 * DAY, storage).status, "valid");
  assert.equal(loadOwnerScopedTickets(token, NOW + 91 * DAY, storage).status, "expired");
});

test("a congress that is over, or has no usable end date, keeps the 7-day window and never less", () => {
  const token = makeMockJwt("user-late-3");
  const cases: Array<[string, AttendeeTicketDetail[]]> = [
    ["already over", [endingIn(-30)]],
    ["no end date", [mockTicket]],
    ["unreadable end date", [{ ...mockTicket, event_ends_at: "soon" }]],
    ["no passes", []],
  ];
  for (const [label, tickets] of cases) {
    const storage = new MockStorage();
    saveOwnerScopedTickets(token, tickets, NOW, undefined, storage);
    assert.equal(loadOwnerScopedTickets(token, NOW + 6 * DAY, storage).status === "expired", false, `${label}: still there after 6 days`);
    assert.equal(loadOwnerScopedTickets(token, NOW + 8 * DAY, storage).status, "expired", `${label}: gone after 8 days`);
  }
});

test("an explicit lifetime still wins over the congress end", () => {
  const storage = new MockStorage();
  const token = makeMockJwt("user-ttl-4");

  saveOwnerScopedTickets(token, [endingIn(60)], NOW, 3 * DAY, storage);

  assert.equal(loadOwnerScopedTickets(token, NOW + 2 * DAY, storage).status, "valid");
  assert.equal(loadOwnerScopedTickets(token, NOW + 4 * DAY, storage).status, "expired");
});

test("clearOwnerScopedTickets purges owner cache on logout", () => {
  const storage = new MockStorage();
  const token = makeMockJwt("user-logout-999");

  saveOwnerScopedTickets(token, [mockTicket], 1000, 10000, storage);
  assert.ok(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-logout-999`));

  clearOwnerScopedTickets(token, storage);
  assert.equal(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-logout-999`), null);

  const result = loadOwnerScopedTickets(token, 2000, storage);
  assert.equal(result.status, "empty");
});

test("tampered or mismatched envelope is rejected and invalidated", () => {
  const storage = new MockStorage();
  const tokenAlice = makeMockJwt("user-alice-123");

  // Maliciously inject Bob's userId into Alice's storage key
  const tamperedEnvelope = {
    userId: "user-bob-456", // mismatch!
    cachedAt: 1000,
    expiresAt: 10000,
    tickets: [mockTicket],
  };
  storage.setItem(`${CACHED_TICKETS_KEY_PREFIX}user-alice-123`, JSON.stringify(tamperedEnvelope));

  const result = loadOwnerScopedTickets(tokenAlice, 2000, storage);
  assert.equal(result.status, "unauthorized");
  assert.deepEqual(result.tickets, []);

  // Storage key must be cleared
  assert.equal(storage.getItem(`${CACHED_TICKETS_KEY_PREFIX}user-alice-123`), null);
});
