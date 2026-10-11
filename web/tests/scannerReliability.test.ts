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
      qr_secret: "sec_1",
      ticket_id: "t1",
      attendee_name: "Attendee 1",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    sec_2: {
      qr_secret: "sec_2",
      ticket_id: "t2",
      attendee_name: "Attendee 2",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    sec_3: {
      qr_secret: "sec_3",
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
      qr_secret: "sec_a",
      ticket_id: "t_a",
      attendee_name: "Alice",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    {
      qr_secret: "sec_b",
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
      qr_secret: "sec_a",
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

test("reconstructLocalState: correctly reverts provisional admission when server flagged CONFLICT", () => {
  const manifestTickets: LocalTicket[] = [
    {
      qr_secret: "sec_x",
      ticket_id: "t_x",
      attendee_name: "Xavier",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  ];

  // Scan was rejected by server due to competing device admission
  const localHistory = [
    {
      qr_secret: "sec_x",
      status: "REJECTED" as const,
      sync_state: "CONFLICT",
    },
  ];

  const { ticketMap, currentAdmittedCount } = reconstructLocalState(manifestTickets, localHistory);
  assert.equal(currentAdmittedCount, 0);
  assert.equal(ticketMap["sec_x"].is_admitted, false);
});
