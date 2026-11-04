import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLocalScan,
  reconstructLocalState,
  type LocalPolicyConfig,
  type LocalTicket,
} from "../src/lib/scannerEngine.ts";

test("P1-LOCAL-CAPACITY: evaluateLocalScan maintains stateful capacity counter", () => {
  const tickets: Record<string, LocalTicket> = {
    sec_1: {
      qr_hash: "sec_1",
      ticket_id: "t1",
      attendee_name: "Attendee 1",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    sec_2: {
      qr_hash: "sec_2",
      ticket_id: "t2",
      attendee_name: "Attendee 2",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    sec_3: {
      qr_hash: "sec_3",
      ticket_id: "t3",
      attendee_name: "Attendee 3",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  };

  const policy: LocalPolicyConfig = {
    policy_type: "CAPACITY_CAPPED",
    allowed_tier_ids: [],
    max_capacity: 2,
    current_admitted_count: 0,
  };

  // Scan 1 -> ADMITTED (count = 1)
  const res1 = evaluateLocalScan(tickets, policy, "sec_1");
  assert.equal(res1.status, "ADMITTED");
  assert.equal(res1.current_admitted_count, 1);
  assert.equal(policy.current_admitted_count, 1);

  // Scan 2 -> ADMITTED (count = 2)
  const res2 = evaluateLocalScan(tickets, policy, "sec_2");
  assert.equal(res2.status, "ADMITTED");
  assert.equal(res2.current_admitted_count, 2);
  assert.equal(policy.current_admitted_count, 2);

  // Scan 3 -> REJECTED (capacity 2 reached)
  const res3 = evaluateLocalScan(tickets, policy, "sec_3");
  assert.equal(res3.status, "REJECTED");
  assert.equal(res3.rejection_reason, "CAPACITY_REACHED");
  assert.equal(res3.current_admitted_count, 2);
  assert.equal(policy.current_admitted_count, 2);
});

test("P2-SNAPSHOT-RESET: reconstructLocalState preserves admitted tickets and capacity across refresh", () => {
  const manifestTickets: LocalTicket[] = [
    {
      qr_hash: "sec_a",
      ticket_id: "t_a",
      attendee_name: "Alice",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    {
      qr_hash: "sec_b",
      ticket_id: "t_b",
      attendee_name: "Bob",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  ];

  // Local scan history stored in IndexedDB before refresh
  const localHistory = [
    {
      qr_hash: "sec_a",
      status: "ADMITTED" as const,
      sync_state: "PROVISIONAL",
    },
  ];

  // Reconstruct state on page load / refresh
  const { ticketMap, currentAdmittedCount } = reconstructLocalState(manifestTickets, localHistory);

  assert.equal(currentAdmittedCount, 1);
  assert.equal(ticketMap["sec_a"].is_admitted, true);
  assert.equal(ticketMap["sec_a"].admission_count, 1);
  assert.equal(ticketMap["sec_b"].is_admitted, false);
  assert.equal(ticketMap["sec_b"].admission_count, 0);

  // Now scan sec_a again under SINGLE_USE policy:
  const singleUsePolicy: LocalPolicyConfig = {
    policy_type: "SINGLE_USE",
    allowed_tier_ids: [],
    current_admitted_count: currentAdmittedCount,
  };

  const repeatScan = evaluateLocalScan(ticketMap, singleUsePolicy, "sec_a");
  assert.equal(repeatScan.status, "REJECTED");
  assert.equal(repeatScan.rejection_reason, "ALREADY_ADMITTED");
});

test("reconstructLocalState: a conflict never reverts the ticket's admission on the server", () => {
  const ticket = (admitted: boolean): LocalTicket => ({
    qr_hash: "sec_x",
    ticket_id: "t_x",
    attendee_name: "Xavier",
    ticket_tier_id: "tier_1",
    ticket_tier_name: "General",
    admission_count: admitted ? 1 : 0,
    is_admitted: admitted,
  });
  // Another gate admitted the ticket first: the server rejected this device's provisional admission.
  const conflict = { qr_hash: "sec_x", status: "REJECTED" as const, sync_state: "CONFLICT", rejection_reason: "ALREADY_ADMITTED" };

  // Before the next manifest refresh: the conflict itself proves the server's admission.
  const stale = reconstructLocalState([ticket(false)], [conflict]);
  assert.equal(stale.currentAdmittedCount, 1);
  assert.equal(stale.ticketMap["sec_x"].is_admitted, true);
  const rescan = evaluateLocalScan(stale.ticketMap, { policy_type: "SINGLE_USE", allowed_tier_ids: [], is_offline: true }, "sec_x");
  assert.equal(rescan.rejection_reason, "ALREADY_ADMITTED");

  // After the refresh the manifest says so too; replay must not take it away.
  const fresh = reconstructLocalState([ticket(true)], [conflict]);
  assert.equal(fresh.currentAdmittedCount, 1);
  assert.equal(fresh.ticketMap["sec_x"].is_admitted, true);
  assert.equal(fresh.ticketMap["sec_x"].admission_count, 1);
});

test("reconstructLocalState: a conflict for another reason does not count this device's admission", () => {
  const ticket: LocalTicket = {
    qr_hash: "sec_y", ticket_id: "t_y", attendee_name: "Yasmin", ticket_tier_id: "tier_1",
    ticket_tier_name: "General", admission_count: 0, is_admitted: false,
  };
  const { ticketMap, currentAdmittedCount } = reconstructLocalState(
    [ticket],
    [{ qr_hash: "sec_y", status: "REJECTED", sync_state: "CONFLICT", rejection_reason: "CAPACITY_REACHED" }]
  );
  assert.equal(currentAdmittedCount, 0);
  assert.equal(ticketMap["sec_y"].is_admitted, false);
});

test("reconstructLocalState: replays in scanned_at order and skips scans without a manifest hash", () => {
  const ticket: LocalTicket = {
    qr_hash: "sec_z", ticket_id: "t_z", attendee_name: "Zahra", ticket_tier_id: "tier_1",
    ticket_tier_name: "General", admission_count: 0, is_admitted: false,
  };
  const { ticketMap, currentAdmittedCount } = reconstructLocalState(
    [ticket],
    [
      { qr_hash: "sec_z", scanned_at: "2026-10-10T10:05:00Z", status: "ADMITTED", sync_state: "CONFIRMED" },
      { qr_hash: "sec_z", scanned_at: "2026-10-10T10:00:00Z", status: "ADMITTED", sync_state: "PROVISIONAL" },
      { scanned_at: "2026-10-10T10:01:00Z", status: "ADMITTED", sync_state: "PROVISIONAL" },
    ]
  );
  assert.equal(currentAdmittedCount, 1);
  assert.equal(ticketMap["sec_z"].admission_count, 2);
});

import { applyServerVerdict, type QueuedScan } from "../src/lib/scannerStorage.ts";

const queued = (over: Partial<QueuedScan>): QueuedScan => ({
  scan_id: "s1", point_id: "p1", qr_secret: "sec_1", qr_hash: "sec_1", scanned_at: "2099-01-01T00:00:00Z",
  status: "ADMITTED", rejection_reason: null, synced: false, sync_state: "PROVISIONAL", ...over,
});

test("verdict: a provisional admission the server rejects is a conflict", () => {
  const scan = queued({});
  assert.equal(applyServerVerdict(scan, { scan_id: "s1", qr_secret: "sec_1", status: "REJECTED", rejection_reason: "ALREADY_ADMITTED" }, "now"), "conflict");
  assert.equal(scan.sync_state, "CONFLICT");
  assert.equal(scan.status, "REJECTED");
  assert.equal(scan.conflict_acknowledged, false);
});

test("verdict: a rejection the device already made and the server confirms is not a conflict", () => {
  const scan = queued({ status: "REJECTED", rejection_reason: "ALREADY_ADMITTED", sync_state: "LOCAL_REJECTED" });
  assert.equal(applyServerVerdict(scan, { scan_id: "s1", qr_secret: "sec_1", status: "REJECTED", rejection_reason: "ALREADY_ADMITTED" }, "now"), "agreed");
  assert.equal(scan.sync_state, "LOCAL_REJECTED");
  assert.equal(scan.synced, true);
  assert.equal(scan.rejection_reason, "ALREADY_ADMITTED");
});

test("verdict: a locally rejected scan the server admits (stale manifest) becomes confirmed", () => {
  const scan = queued({ status: "REJECTED", rejection_reason: "NOT_IN_LOCAL_MANIFEST", sync_state: "LOCAL_REJECTED" });
  assert.equal(applyServerVerdict(scan, { scan_id: "s1", qr_secret: "sec_1", status: "ADMITTED", attendee_name: "Late Ticket" }, "now"), "confirmed");
  assert.equal(scan.status, "ADMITTED");
  assert.equal(scan.rejection_reason, null);
});

test("a server-confirmed duplicate rejection never makes reconstructLocalState forget the genuine admission", () => {
  const ticket: LocalTicket = { qr_hash: "sec_1", ticket_id: "t1", attendee_name: "A", ticket_tier_id: "tier", ticket_tier_name: "General", admission_count: 0, is_admitted: false };
  const first = queued({ scan_id: "a", sync_state: "CONFIRMED" });
  const duplicate = queued({ scan_id: "b", status: "REJECTED", rejection_reason: "ALREADY_ADMITTED", sync_state: "LOCAL_REJECTED" });
  applyServerVerdict(duplicate, { scan_id: "b", qr_secret: "sec_1", status: "REJECTED", rejection_reason: "ALREADY_ADMITTED" }, "now");
  const state = reconstructLocalState([ticket], [first, duplicate]);
  assert.equal(state.ticketMap["sec_1"].is_admitted, true);
});

import { clientVerdictFor } from "../src/lib/scannerStorage.ts";
import { applyServerScan } from "../src/lib/scannerEngine.ts";

test("upload: a local rejection is sent as a final REJECTED verdict, a local admission as PROVISIONAL", () => {
  assert.deepEqual(clientVerdictFor(queued({})), { client_verdict: "PROVISIONAL", client_rejection_reason: null });
  assert.deepEqual(
    clientVerdictFor(queued({ status: "REJECTED", rejection_reason: "NOT_IN_LOCAL_MANIFEST", sync_state: "LOCAL_REJECTED" })),
    { client_verdict: "REJECTED", client_rejection_reason: "NOT_IN_LOCAL_MANIFEST" }
  );
  const long = clientVerdictFor(queued({ status: "REJECTED", rejection_reason: "X".repeat(80) }));
  assert.equal(long.client_rejection_reason?.length, 48);
});

test("verdict: a device rejection the server recorded as LOCAL_REJECTED stays a rejection, never a conflict", () => {
  const scan = queued({ status: "REJECTED", rejection_reason: "TIER_NOT_ALLOWED", sync_state: "LOCAL_REJECTED" });
  const verdict = applyServerVerdict(
    scan,
    { scan_id: "s1", qr_secret: "sec_1", status: "REJECTED", rejection_reason: "LOCAL_REJECTED:TIER_NOT_ALLOWED" },
    "now"
  );
  assert.equal(verdict, "agreed");
  assert.equal(scan.status, "REJECTED");
  assert.equal(scan.sync_state, "LOCAL_REJECTED");
  assert.equal(scan.rejection_reason, "TIER_NOT_ALLOWED");
});

const serverTicket = (): LocalTicket => ({
  qr_hash: "h1", ticket_id: "t1", attendee_name: "Ali", ticket_tier_id: "tier", ticket_tier_name: "General",
  admission_count: 0, is_admitted: false,
});

test("online: a server admission marks the ticket admitted, so a later offline re-scan of a single-use ticket is rejected", () => {
  const state = { ticketMap: { h1: serverTicket() }, admittedCount: 0 };
  const shown = applyServerScan(state, "h1", { status: "ADMITTED", attendee_name: "Ali", ticket_tier_name: "General" });
  assert.equal(shown.status, "ADMITTED");
  assert.equal(shown.is_provisional, false);
  assert.equal(shown.current_admitted_count, 1);
  assert.equal(state.ticketMap.h1.is_admitted, true);
  const rescan = evaluateLocalScan(state.ticketMap, { policy_type: "SINGLE_USE", allowed_tier_ids: [], is_offline: true }, "h1");
  assert.equal(rescan.rejection_reason, "ALREADY_ADMITTED");
});

test("online: an ALREADY_ADMITTED verdict records the admission elsewhere without counting one here", () => {
  const state = { ticketMap: { h1: serverTicket() }, admittedCount: 3 };
  const shown = applyServerScan(state, "h1", { status: "REJECTED", rejection_reason: "ALREADY_ADMITTED" });
  assert.equal(shown.status, "REJECTED");
  assert.equal(shown.rejection_reason, "ALREADY_ADMITTED");
  assert.equal(shown.current_admitted_count, 3);
  assert.equal(state.ticketMap.h1.is_admitted, true);
  assert.equal(state.ticketMap.h1.admission_count, 0);
});

test("online: a code the manifest does not hold yet shows the attendee the server named", () => {
  const state = { ticketMap: {}, admittedCount: 0 };
  const shown = applyServerScan(state, "walkin", { status: "ADMITTED", attendee_name: "Walk-in", ticket_tier_name: "Day pass" });
  assert.equal(shown.ticket?.attendee_name, "Walk-in");
  assert.equal(shown.ticket?.ticket_tier_name, "Day pass");
  const unknown = applyServerScan(state, "nope", { status: "REJECTED", rejection_reason: null });
  assert.equal(unknown.ticket, null);
  assert.equal(unknown.rejection_reason, "SERVER_REJECTED");
});
