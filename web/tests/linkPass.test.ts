import test from "node:test";
import assert from "node:assert/strict";
import {
  LINK_PASS_KEY_PREFIX,
  clearLinkPass,
  isLinkPass,
  linkOutcome,
  linkPassCard,
  loadLinkPasses,
  saveLinkPass,
  type LinkPass,
} from "../src/lib/linkPass.ts";
import { CACHED_TICKETS_KEY_PREFIX, loadOwnerScopedTickets } from "../src/lib/ticketCache.ts";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
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
    this.store.set(key, value);
  }
}

const NOW = Date.parse("2027-04-01T00:00:00Z");

function pass(overrides: Partial<LinkPass> = {}, slug = "spring"): LinkPass {
  return {
    ticket_id: `ticket-${slug}`,
    status: "active",
    issued_at: "2027-01-10T09:00:00Z",
    qr_secret: `qr-${slug}`,
    tier_name: "Delegate",
    expires_at: "2027-05-12T18:00:00Z",
    event: {
      id: `event-${slug}`,
      slug,
      name: "Spring Congress",
      starts_at: "2027-04-10T08:00:00Z",
      ends_at: "2027-04-12T18:00:00Z",
      location: "Tehran",
    },
    attendee: { full_name: "Dr. Neda Karimi", organization: "Heart Center", title: "Cardiologist" },
    ...overrides,
  };
}

test("a resolved pass is kept per ticket and found by its congress without any sign-in", () => {
  const storage = new MemoryStorage();
  assert.equal(saveLinkPass(pass(), NOW, storage), true);
  assert.equal(saveLinkPass(pass({}, "autumn"), NOW, storage), true);

  assert.deepEqual(loadLinkPasses("spring", NOW, storage), [pass()]);
  assert.deepEqual(loadLinkPasses("autumn", NOW, storage).map((p) => p.ticket_id), ["ticket-autumn"]);
  assert.equal(loadLinkPasses(undefined, NOW, storage).length, 2);
  assert.deepEqual(loadLinkPasses("winter", NOW, storage), []);
  assert.ok(storage.getItem(`${LINK_PASS_KEY_PREFIX}ticket-spring`));
});

test("saving the same ticket again replaces its pass", () => {
  const storage = new MemoryStorage();
  saveLinkPass(pass({ tier_name: "Old" }), NOW, storage);
  saveLinkPass(pass({ tier_name: "VIP" }), NOW, storage);
  assert.deepEqual(loadLinkPasses("spring", NOW, storage).map((p) => p.tier_name), ["VIP"]);
  assert.equal(storage.length, 1);
});

test("a link pass lives until the link expires, then it is removed", () => {
  const storage = new MemoryStorage();
  saveLinkPass(pass(), NOW, storage);
  const expiry = Date.parse("2027-05-12T18:00:00Z");

  assert.equal(loadLinkPasses("spring", expiry - 1, storage).length, 1);
  assert.deepEqual(loadLinkPasses("spring", expiry, storage), []);
  assert.equal(storage.length, 0);
  // An already expired pass is never stored.
  assert.equal(saveLinkPass(pass({ expires_at: "2027-03-01T00:00:00Z" }), NOW, storage), false);
  assert.equal(saveLinkPass(pass({ expires_at: "not a date" }), NOW, storage), false);
  assert.equal(storage.length, 0);
});

test("malformed or mislabelled entries are dropped instead of shown", () => {
  const storage = new MemoryStorage();
  storage.setItem(`${LINK_PASS_KEY_PREFIX}broken`, "{not json");
  storage.setItem(`${LINK_PASS_KEY_PREFIX}empty`, JSON.stringify({ savedAt: NOW, pass: { ticket_id: "x" } }));
  // Stored under another ticket's key: never trusted.
  storage.setItem(`${LINK_PASS_KEY_PREFIX}ticket-other`, JSON.stringify({ savedAt: NOW, pass: pass() }));
  storage.setItem("unrelated", "kept");

  assert.deepEqual(loadLinkPasses("spring", NOW, storage), []);
  assert.deepEqual([storage.key(0), storage.length], ["unrelated", 1]);
});

test("the link pass is independent of the signed-in owner's ticket cache", () => {
  const storage = new MemoryStorage();
  saveLinkPass(pass(), NOW, storage);
  // No token: the owner-scoped cache still fails closed and never sees the link pass.
  assert.equal(loadOwnerScopedTickets(null, NOW, storage).status, "unauthorized");
  assert.equal(Array.from({ length: storage.length }, (_, i) => storage.key(i)).some((k) => k?.startsWith(CACHED_TICKETS_KEY_PREFIX)), false);

  clearLinkPass("ticket-spring", storage);
  assert.deepEqual(loadLinkPasses("spring", NOW, storage), []);
});

test("unavailable or failing storage never throws", () => {
  assert.equal(saveLinkPass(pass(), NOW, null), false);
  assert.deepEqual(loadLinkPasses("spring", NOW, null), []);
  const full = new MemoryStorage();
  full.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.equal(saveLinkPass(pass(), NOW, full), false);
  clearLinkPass("ticket-spring", null);
});

test("the pass card shows the link pass without the mobile number", () => {
  const card = linkPassCard(pass());
  assert.deepEqual(card, {
    id: "ticket-spring",
    event_name: "Spring Congress",
    event_slug: "spring",
    event_location: "Tehran",
    event_starts_at: "2027-04-10T08:00:00Z",
    event_ends_at: "2027-04-12T18:00:00Z",
    ticket_tier_name: "Delegate",
    attendee_name: "Dr. Neda Karimi",
    qr_secret: "qr-spring",
    created_at: "2027-01-10T09:00:00Z",
    status: "active",
  });
  assert.equal(isLinkPass(pass()), true);
  assert.equal(isLinkPass({ ...pass(), qr_secret: "" }), false);
  assert.equal(isLinkPass(null), false);
});

test("resolve outcomes map to the friendly pages", () => {
  assert.equal(linkOutcome(410), "expired");
  assert.equal(linkOutcome(404), "invalid");
  assert.equal(linkOutcome(422), "invalid");
  assert.equal(linkOutcome(429), "throttled");
  assert.equal(linkOutcome(503), "offline");
  assert.equal(linkOutcome(null), "offline");
});
