import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLocalScan,
  type LocalPolicyConfig,
  type LocalTicket,
} from "../src/lib/scannerEngine.ts";

test("evaluateLocalScan - MULTI_ENTRY admits ticket repeatedly", () => {
  const tickets: Record<string, LocalTicket> = {
    valid_secret_1: {
      qr_secret: "valid_secret_1",
      ticket_id: "t1",
      attendee_name: "Dr. Reza",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  };

  const policy: LocalPolicyConfig = {
    policy_type: "MULTI_ENTRY",
    allowed_tier_ids: [],
  };

  const res1 = evaluateLocalScan(tickets, policy, "valid_secret_1");
  assert.equal(res1.status, "ADMITTED");
  assert.equal(res1.rejection_reason, null);
  assert.equal(res1.ticket?.attendee_name, "Dr. Reza");
  assert.equal(tickets["valid_secret_1"].admission_count, 1);

  // Scan again at multi-entry
  const res2 = evaluateLocalScan(tickets, policy, "valid_secret_1");
  assert.equal(res2.status, "ADMITTED");
  assert.equal(tickets["valid_secret_1"].admission_count, 2);
});

test("evaluateLocalScan - SINGLE_USE rejects second scan with ALREADY_ADMITTED", () => {
  const tickets: Record<string, LocalTicket> = {
    lunch_pass_secret: {
      qr_secret: "lunch_pass_secret",
      ticket_id: "t2",
      attendee_name: "Sara Alavi",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  };

  const policy: LocalPolicyConfig = {
    policy_type: "SINGLE_USE",
    allowed_tier_ids: [],
  };

  // First scan at lunch: admitted
  const res1 = evaluateLocalScan(tickets, policy, "lunch_pass_secret");
  assert.equal(res1.status, "ADMITTED");
  assert.equal(res1.rejection_reason, null);
  assert.equal(tickets["lunch_pass_secret"].is_admitted, true);
  assert.equal(tickets["lunch_pass_secret"].admission_count, 1);

  // Second scan at lunch: rejected
  const res2 = evaluateLocalScan(tickets, policy, "lunch_pass_secret");
  assert.equal(res2.status, "REJECTED");
  assert.equal(res2.rejection_reason, "ALREADY_ADMITTED");
  assert.equal(res2.ticket?.attendee_name, "Sara Alavi");
});

test("evaluateLocalScan - TIER_RESTRICTED enforces allowed tier list", () => {
  const tickets: Record<string, LocalTicket> = {
    vip_secret: {
      qr_secret: "vip_secret",
      ticket_id: "t_vip",
      attendee_name: "VIP Speaker",
      ticket_tier_id: "tier_vip",
      ticket_tier_name: "VIP",
      admission_count: 0,
      is_admitted: false,
    },
    gen_secret: {
      qr_secret: "gen_secret",
      ticket_id: "t_gen",
      attendee_name: "Regular Attendee",
      ticket_tier_id: "tier_gen",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  };

  const policy: LocalPolicyConfig = {
    policy_type: "TIER_RESTRICTED",
    allowed_tier_ids: ["tier_vip"],
  };

  // VIP attendee -> admitted
  const resVip = evaluateLocalScan(tickets, policy, "vip_secret");
  assert.equal(resVip.status, "ADMITTED");

  // General attendee at VIP gate -> rejected
  const resGen = evaluateLocalScan(tickets, policy, "gen_secret");
  assert.equal(resGen.status, "REJECTED");
  assert.equal(resGen.rejection_reason, "TIER_NOT_ALLOWED");
});

test("evaluateLocalScan - unknown QR secret returns INVALID_TICKET", () => {
  const tickets: Record<string, LocalTicket> = {};
  const policy: LocalPolicyConfig = {
    policy_type: "MULTI_ENTRY",
    allowed_tier_ids: [],
  };

  const res = evaluateLocalScan(tickets, policy, "unknown_secret_999");
  assert.equal(res.status, "REJECTED");
  assert.equal(res.rejection_reason, "INVALID_TICKET");
  assert.equal(res.ticket, null);
});

test("evaluateLocalScan - CAPACITY_CAPPED rejects when room capacity exceeded", () => {
  const tickets: Record<string, LocalTicket> = {
    sec_1: {
      qr_secret: "sec_1",
      ticket_id: "t1",
      attendee_name: "Person 1",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
    sec_2: {
      qr_secret: "sec_2",
      ticket_id: "t2",
      attendee_name: "Person 2",
      ticket_tier_id: "tier_1",
      ticket_tier_name: "General",
      admission_count: 0,
      is_admitted: false,
    },
  };

  const policy: LocalPolicyConfig = {
    policy_type: "CAPACITY_CAPPED",
    allowed_tier_ids: [],
    max_capacity: 1,
    current_admitted_count: 0,
  };

  const res1 = evaluateLocalScan(tickets, policy, "sec_1");
  assert.equal(res1.status, "ADMITTED");
  policy.current_admitted_count = 1;

  const res2 = evaluateLocalScan(tickets, policy, "sec_2");
  assert.equal(res2.status, "REJECTED");
  assert.equal(res2.rejection_reason, "CAPACITY_REACHED");
});
