import test from "node:test";
import assert from "node:assert/strict";
import { mergeManifest, upgradeLegacyManifest } from "../src/lib/scannerManifest.ts";
import type { CheckInManifest } from "../src/api/client.ts";

type Ticket = CheckInManifest["tickets"][number];
const ticket = (hash: string, admitted = false): Ticket => ({
  qr_hash: hash, ticket_id: `t-${hash}`, attendee_name: hash.toUpperCase(), ticket_tier_id: "tier",
  ticket_tier_name: "General", admission_count: admitted ? 1 : 0, is_admitted: admitted,
});
const point = (over: Partial<CheckInManifest["checkin_point"]> = {}): CheckInManifest["checkin_point"] => ({
  id: "p1", event_id: "e1", name: "Gate", location: null, policy_type: "SINGLE_USE", allowed_tier_ids: [],
  max_capacity: null, ...over,
} as CheckInManifest["checkin_point"]);
const manifest = (over: Partial<CheckInManifest> = {}): CheckInManifest => ({
  checkin_point: point(), event_id: "e1", generated_at: "2026-10-10T10:00:00Z", tickets: [],
  cursor: "c1", is_delta: false, removed_qr_hashes: [], ...over,
});

test("mergeManifest: a full manifest replaces the cache", () => {
  const full = manifest({ tickets: [ticket("a")] });
  const merged = mergeManifest(manifest({ tickets: [ticket("old")] }), full);
  assert.equal(merged.needsFull, false);
  assert.deepEqual(merged.manifest, full);
});

test("mergeManifest: a delta removes, then upserts by qr_hash, and takes the new cursor", () => {
  const cached = manifest({ tickets: [ticket("a"), ticket("b"), ticket("c")] });
  const delta = manifest({
    is_delta: true, cursor: "c2", tickets: [ticket("b", true), ticket("walkin")], removed_qr_hashes: ["c"],
  });
  const { manifest: merged, needsFull } = mergeManifest(cached, delta);
  assert.equal(needsFull, false);
  assert.equal(merged.cursor, "c2");
  assert.equal(merged.is_delta, false);
  const byHash = Object.fromEntries(merged.tickets.map((t) => [t.qr_hash, t]));
  assert.deepEqual(Object.keys(byHash).sort(), ["a", "b", "walkin"]);
  assert.equal(byHash.b.is_admitted, true);
});

test("mergeManifest: a delta without a cache, or after the point's policy or tiers changed, asks for a full fetch", () => {
  const delta = manifest({ is_delta: true, tickets: [ticket("a")] });
  assert.equal(mergeManifest(null, delta).needsFull, true);
  const cached = manifest({ tickets: [ticket("x")] });
  assert.equal(mergeManifest(cached, { ...delta, checkin_point: point({ policy_type: "MULTI_ENTRY" }) }).needsFull, true);
  assert.equal(
    mergeManifest(cached, { ...delta, checkin_point: point({ policy_type: "TIER_RESTRICTED", allowed_tier_ids: ["t1"] }) }).needsFull,
    true
  );
  // Same tiers in another order are the same rules.
  const tiered = manifest({ checkin_point: point({ policy_type: "TIER_RESTRICTED", allowed_tier_ids: ["t1", "t2"] }) });
  assert.equal(
    mergeManifest(tiered, { ...delta, checkin_point: point({ policy_type: "TIER_RESTRICTED", allowed_tier_ids: ["t2", "t1"] }) }).needsFull,
    false
  );
});

test("upgradeLegacyManifest: raw secrets are replaced by hashes and the cursor is cleared", async () => {
  const legacyTicket = { qr_secret: "SEC-1", ticket_id: "t1", attendee_name: "A", ticket_tier_id: "tier", ticket_tier_name: "G", admission_count: 0, is_admitted: false };
  const legacy = { ...manifest({ cursor: "old" }), tickets: [legacyTicket] } as unknown as CheckInManifest;
  const { manifest: upgraded, upgraded: changed } = await upgradeLegacyManifest(legacy, async (eventId, code) => `${eventId}|${code}`);
  assert.equal(changed, true);
  assert.equal(upgraded.cursor, "");
  assert.equal(upgraded.tickets[0].qr_hash, "e1|SEC-1");
  assert.equal("qr_secret" in upgraded.tickets[0], false);
});

test("upgradeLegacyManifest: a current manifest is left as is", async () => {
  const current = manifest({ tickets: [ticket("a")] });
  const result = await upgradeLegacyManifest(current, async () => "unused");
  assert.equal(result.upgraded, false);
  assert.equal(result.manifest, current);
});
