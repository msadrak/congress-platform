import test from "node:test";
import assert from "node:assert/strict";
import type { LeadOut } from "../src/api/client.ts";
import {
  RETRY_MAX_MS,
  classifySend,
  dueScans,
  enqueueLeadScan,
  nextRetryAt,
  retryDelayMs,
  retryNow,
  scanBody,
  syncLeadQueue,
  type LeadQueueStore,
  type QueuedLeadScan,
  type SendResult,
} from "../src/lib/leadQueue.ts";

const NOW = new Date("2099-01-01T10:00:00Z");
const ctx = (id: string, now = NOW) => ({ id, owner: "user-a", boothId: "booth-a", now });

const leadFor = (qr: string): LeadOut => ({
  id: `lead-${qr}`,
  booth_id: "booth-a",
  ticket_id: `ticket-${qr}`,
  attendee_name: `Attendee ${qr}`,
  attendee_mobile: null,
  organization: "",
  title: "",
  ticket_tier_name: "General",
  rating: "WARM",
  tags: [],
  notes: "",
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
});

class MemoryStore implements LeadQueueStore {
  rows = new Map<string, QueuedLeadScan>();
  async list(owner: string, boothId: string) {
    return [...this.rows.values()].filter((s) => s.owner === owner && s.booth_id === boothId);
  }
  async put(scan: QueuedLeadScan) {
    this.rows.set(scan.id, structuredClone(scan));
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

function queued(id: string, qr: string, minutes: number, extra: Partial<QueuedLeadScan> = {}): QueuedLeadScan {
  const at = new Date(NOW.getTime() + minutes * 60_000);
  return { ...enqueueLeadScan([], { qr_secret: qr }, ctx(id, at)).scan, ...extra };
}

test("a new scan is queued with only the qualification that was chosen", () => {
  const { scan, merged } = enqueueLeadScan([], { qr_secret: "  ABC123 ", rating: "HOT", notes: "  " }, ctx("q1"));
  assert.equal(merged, false);
  assert.equal(scan.qr_secret, "ABC123");
  assert.equal(scan.rating, "HOT");
  assert.equal("notes" in scan, false);
  assert.equal("tags" in scan, false);
  assert.equal(scan.state, "pending");
  assert.equal(scan.next_attempt_at, NOW.getTime());
  assert.deepEqual(scanBody(scan), { qr_secret: "ABC123", rating: "HOT" });
});

test("a second scan of the same badge folds into the queued one; newer choices win, notes only when given", () => {
  const first = enqueueLeadScan([], { qr_secret: "abc123", rating: "COLD", notes: "met at 10" }, ctx("q1")).scan;
  const failed = { ...first, state: "failed" as const, failure: { kind: "invalid_badge" as const }, attempts: 3 };
  const { scan, merged } = enqueueLeadScan([failed], { qr_secret: "ABC123 ", tags: ["Demo"] }, ctx("q2"));
  assert.equal(merged, true);
  assert.equal(scan.id, "q1");
  assert.equal(scan.rating, "COLD");
  assert.deepEqual(scan.tags, ["Demo"]);
  assert.equal(scan.notes, "met at 10");
  assert.equal(scan.state, "pending");
  assert.equal(scan.failure, null);
  assert.equal(scan.attempts, 0);
});

test("another account's or booth's queued scan of the same badge is never merged", () => {
  const other = { ...enqueueLeadScan([], { qr_secret: "abc" }, ctx("q1")).scan, owner: "user-b" };
  const elsewhere = { ...enqueueLeadScan([], { qr_secret: "abc" }, ctx("q2")).scan, booth_id: "booth-b" };
  const { merged, scan } = enqueueLeadScan([other, elsewhere], { qr_secret: "abc" }, ctx("q3"));
  assert.equal(merged, false);
  assert.equal(scan.id, "q3");
});

test("answers are classified: synced, retry, refused, session ended, access revoked", () => {
  const ok = (status: number): SendResult => ({ network: false, status, data: leadFor("x") });
  assert.deepEqual(classifySend(ok(201)), { kind: "synced", lead: leadFor("x"), existed: false });
  assert.deepEqual(classifySend(ok(200)), { kind: "synced", lead: leadFor("x"), existed: true });
  assert.deepEqual(classifySend({ network: true }), { kind: "retry" });
  for (const status of [500, 502, 503, 408, 429]) assert.deepEqual(classifySend({ network: false, status }), { kind: "retry" }, String(status));
  assert.deepEqual(classifySend({ network: false, status: 401 }), { kind: "session_expired" });
  assert.deepEqual(classifySend({ network: false, status: 403, code: "BOOTH_STAFF_REQUIRED" }), { kind: "access_revoked" });
  assert.deepEqual(classifySend({ network: false, status: 404, detail: "Invalid or unrecognized attendee badge QR" }), { kind: "failed", failure: { kind: "invalid_badge" } });
  assert.deepEqual(classifySend({ network: false, status: 400, detail: "Attendee ticket is for a different event" }), { kind: "failed", failure: { kind: "other_event" } });
  assert.deepEqual(classifySend({ network: false, status: 404, code: "BOOTH_NOT_FOUND", detail: "Booth not found" }), {
    kind: "failed",
    failure: { kind: "refused", status: 404, code: "BOOTH_NOT_FOUND", detail: "Booth not found" },
  });
  assert.deepEqual(classifySend({ network: false, status: 422 }), { kind: "failed", failure: { kind: "refused", status: 422 } });
});

test("retries back off and are capped", () => {
  assert.equal(retryDelayMs(1), 2_000);
  assert.equal(retryDelayMs(2), 4_000);
  assert.equal(retryDelayMs(3), 8_000);
  assert.equal(retryDelayMs(30), RETRY_MAX_MS);
});

test("only due pending scans are sent, oldest first; failed scans wait for the operator", () => {
  const scans = [
    queued("c", "c", 2),
    queued("a", "a", 0),
    queued("late", "l", 1, { next_attempt_at: NOW.getTime() + 60 * 60_000 }),
    queued("f", "f", -1, { state: "failed" }),
  ];
  assert.deepEqual(dueScans(scans, NOW.getTime() + 10 * 60_000).map((s) => s.id), ["a", "c"]);
  assert.equal(nextRetryAt(scans), NOW.getTime());
  assert.equal(nextRetryAt([scans[3]]), null);
  const retried = retryNow({ ...scans[3], attempts: 4, failure: { kind: "other_event" } }, 123);
  assert.equal(retried.state, "pending");
  assert.equal(retried.failure, null);
  assert.equal(retried.attempts, 0);
  assert.equal(retried.next_attempt_at, 123);
});

test("sync: synced scans leave the queue, refusals stay with their reason, per item", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "good", 0));
  await store.put(queued("2", "bad-code", 1));
  await store.put(queued("3", "again", 2));
  const sent: string[] = [];
  const report = await syncLeadQueue({
    owner: "user-a",
    boothId: "booth-a",
    store,
    now: () => NOW.getTime() + 10 * 60_000,
    send: async (scan) => {
      sent.push(scan.qr_secret);
      if (scan.qr_secret === "bad-code") return { network: false, status: 404 };
      return { network: false, status: scan.qr_secret === "again" ? 200 : 201, data: leadFor(scan.qr_secret) };
    },
  });
  assert.deepEqual(sent, ["good", "bad-code", "again"]);
  assert.deepEqual(report.synced.map((s) => [s.scan.id, s.existed]), [["1", false], ["3", true]]);
  assert.equal(report.stopped, null);
  const left = await store.list("user-a", "booth-a");
  assert.equal(left.length, 1);
  assert.equal(left[0].id, "2");
  assert.equal(left[0].state, "failed");
  assert.deepEqual(left[0].failure, { kind: "invalid_badge" });
});

test("sync: no network stops the run and backs off; the rest stay untouched", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "a", 0));
  await store.put(queued("2", "b", 1));
  const now = NOW.getTime() + 5 * 60_000;
  let calls = 0;
  const report = await syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => now,
    send: async () => {
      calls += 1;
      return { network: true };
    },
  });
  assert.equal(calls, 1);
  assert.equal(report.stopped, "offline");
  const [first, second] = (await store.list("user-a", "booth-a")).sort((x, y) => x.id.localeCompare(y.id));
  assert.equal(first.attempts, 1);
  assert.equal(first.next_attempt_at, now + retryDelayMs(1));
  assert.equal(first.state, "pending");
  assert.equal(second.attempts, 0);
});

test("sync: a sent scan whose answer was lost is sent again later and the server's one-lead-per-ticket rule keeps one lead", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "abc", 0));
  const serverLeads = new Map<string, LeadOut>();
  let dropAnswer = true;
  const send = async (scan: QueuedLeadScan): Promise<SendResult> => {
    const existed = serverLeads.has(scan.qr_secret);
    serverLeads.set(scan.qr_secret, leadFor(scan.qr_secret));
    if (dropAnswer) {
      dropAnswer = false;
      return { network: true };
    }
    return { network: false, status: existed ? 200 : 201, data: leadFor(scan.qr_secret) };
  };
  let clock = NOW.getTime();
  await syncLeadQueue({ owner: "user-a", boothId: "booth-a", store, send, now: () => clock });
  clock += retryDelayMs(1);
  const report = await syncLeadQueue({ owner: "user-a", boothId: "booth-a", store, send, now: () => clock });
  assert.equal(report.synced.length, 1);
  assert.equal(report.synced[0].existed, true);
  assert.equal(serverLeads.size, 1);
  assert.equal((await store.list("user-a", "booth-a")).length, 0);
});

test("sync: a revoked booth access or an ended session stops everything and keeps the scans", async () => {
  for (const [answer, stopped] of [
    [{ network: false, status: 403, code: "BOOTH_STAFF_REQUIRED" }, "access_revoked"],
    [{ network: false, status: 401 }, "session_expired"],
  ] as const) {
    const store = new MemoryStore();
    await store.put(queued("1", "a", 0));
    await store.put(queued("2", "b", 1));
    let calls = 0;
    const report = await syncLeadQueue({
      owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime() + 60_000,
      send: async () => {
        calls += 1;
        return answer;
      },
    });
    assert.equal(report.stopped, stopped);
    assert.equal(calls, 1);
    const left = await store.list("user-a", "booth-a");
    assert.equal(left.length, 2);
    assert.ok(left.every((s) => s.state === "pending" && s.attempts === 0));
  }
});

test("sync: a struggling server backs the whole queue off", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "a", 0));
  await store.put(queued("2", "b", 1));
  const report = await syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime() + 60_000,
    send: async () => ({ network: false, status: 503 }),
  });
  assert.equal(report.stopped, "server_error");
  assert.equal(report.retrying.length, 1);
});

test("sync only ever reads this account's queue for this booth", async () => {
  const store = new MemoryStore();
  await store.put({ ...queued("1", "a", 0), owner: "user-b" });
  await store.put({ ...queued("2", "b", 0), booth_id: "booth-b" });
  const report = await syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime(),
    send: async () => assert.fail("nothing of this account is queued"),
  });
  assert.equal(report.synced.length + report.failed.length + report.retrying.length, 0);
});

test("a suspended organizer and an archived congress are classified by code", () => {
  assert.deepEqual(classifySend({ network: false, status: 403, code: "BOOTH_ACCESS_SUSPENDED" }), { kind: "access_suspended" });
  assert.deepEqual(classifySend({ network: false, status: 409, code: "EVENT_ARCHIVED" }), { kind: "failed", failure: { kind: "event_archived" } });
});

test("sync: a suspension stops the run and leaves the queue untouched", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "a", 0));
  await store.put(queued("2", "b", 1));
  let calls = 0;
  const report = await syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime() + 60_000,
    send: async () => {
      calls += 1;
      return { network: false, status: 403, code: "BOOTH_ACCESS_SUSPENDED" };
    },
  });
  assert.equal(report.stopped, "access_suspended");
  assert.equal(calls, 1);
  assert.ok((await store.list("user-a", "booth-a")).every((s) => s.state === "pending" && s.attempts === 0));
});

test("sync: an archived congress marks every due scan 'congress closed' after one refusal and retries none by itself", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "a", 0));
  await store.put(queued("2", "b", 1));
  await store.put(queued("3", "c", 2));
  let calls = 0;
  const run = () => syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime() + 60_000,
    send: async () => {
      calls += 1;
      return { network: false, status: 409, code: "EVENT_ARCHIVED" };
    },
  });
  const report = await run();
  assert.equal(report.stopped, "event_archived");
  assert.equal(calls, 1);
  const left = await store.list("user-a", "booth-a");
  assert.equal(left.length, 3);
  assert.ok(left.every((s) => s.state === "failed" && s.failure?.kind === "event_archived"));
  assert.equal(nextRetryAt(left), null);
  await run();
  assert.equal(calls, 1);
});

test("sync: a scan sent before the congress was archived stays sent", async () => {
  const store = new MemoryStore();
  await store.put(queued("1", "first", 0));
  await store.put(queued("2", "second", 1));
  const report = await syncLeadQueue({
    owner: "user-a", boothId: "booth-a", store, now: () => NOW.getTime() + 60_000,
    send: async (scan) => scan.qr_secret === "first"
      ? { network: false, status: 201, data: leadFor("first") }
      : { network: false, status: 409, code: "EVENT_ARCHIVED" },
  });
  assert.equal(report.synced.length, 1);
  const left = await store.list("user-a", "booth-a");
  assert.deepEqual(left.map((s) => [s.id, s.state]), [["2", "failed"]]);
});
