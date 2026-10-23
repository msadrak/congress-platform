import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  admissionWindowKey,
  evaluateLocalScan,
  reconstructLocalState,
  type LocalPolicyConfig,
  type LocalTicket,
  type ScanDirection,
} from "../src/lib/scannerEngine.ts";

/** The scenarios backend/tests/test_gate_rules.py runs against the server; the local engine must agree. */
interface Step {
  ticket: string;
  at?: string;
  direction?: ScanDirection;
  expect?: string;
  parent?: boolean;
}
interface Scenario {
  name: string;
  point: {
    policy_type: LocalPolicyConfig["policy_type"];
    reset_window?: string;
    allowed_tiers?: string[];
    tracks_occupancy?: boolean;
    max_capacity?: number;
    requires_parent?: boolean;
  };
  tickets: Record<string, string>;
  start: string;
  steps: Step[];
}
const fixture: { timezone: string; scenarios: Scenario[] } = JSON.parse(
  readFileSync(new URL("../../backend/tests/fixtures/gate_parity.json", import.meta.url), "utf8")
);

for (const scenario of fixture.scenarios) {
  test(`parity: ${scenario.name}`, () => {
    const spec = scenario.point;
    const tickets: Record<string, LocalTicket> = {};
    for (const [key, tier] of Object.entries(scenario.tickets)) {
      tickets[key] = {
        qr_hash: key,
        ticket_id: key,
        attendee_name: key,
        ticket_tier_id: tier,
        ticket_tier_name: tier,
        is_admitted: false,
        admission_count: 0,
        last_admitted_window: null,
        is_inside: false,
        presence_at: null,
        prerequisite_met: !spec.requires_parent,
      };
    }
    const policy: LocalPolicyConfig = {
      policy_type: spec.policy_type,
      allowed_tier_ids: spec.allowed_tiers ?? [],
      max_capacity: spec.max_capacity ?? null,
      tracks_occupancy: spec.tracks_occupancy ?? false,
      requires_point: spec.requires_parent ?? false,
      current_admitted_count: 0,
      current_occupancy: 0,
      is_offline: false,
    };
    const start = Date.parse(scenario.start);
    scenario.steps.forEach((step, index) => {
      if (step.parent) {
        tickets[step.ticket].prerequisite_met = true;
        return;
      }
      const at = step.at ?? new Date(start + index * 60_000).toISOString();
      const result = evaluateLocalScan(
        tickets,
        {
          ...policy,
          direction: step.direction ?? "IN",
          admission_window: admissionWindowKey(spec.reset_window, fixture.timezone, at),
          scanned_at: at,
        },
        step.ticket
      );
      policy.current_admitted_count = result.current_admitted_count;
      policy.current_occupancy = result.current_occupancy;
      const verdict = result.status === "ADMITTED" ? "ADMITTED" : result.rejection_reason;
      assert.equal(verdict, step.expect, `${scenario.name} step ${index}`);
      assert.equal(result.direction, step.direction ?? "IN");
    });
  });
}

test("admission windows are dates in the event's time zone, not UTC", () => {
  assert.equal(admissionWindowKey("EVENT", "Asia/Tehran", "2025-11-10T20:31:00Z"), "event");
  assert.equal(admissionWindowKey("DAY", "Asia/Tehran", "2025-11-10T20:29:00Z"), "2025-11-10");
  assert.equal(admissionWindowKey("DAY", "Asia/Tehran", "2025-11-10T20:31:00Z"), "2025-11-11");
  assert.equal(admissionWindowKey("DAY", "UTC", "2025-11-10T20:31:00Z"), "2025-11-10");
});

const manifestTicket = (overrides: Partial<LocalTicket> = {}): LocalTicket => ({
  qr_hash: "h1",
  ticket_id: "t1",
  attendee_name: "Ali",
  ticket_tier_id: "tier",
  ticket_tier_name: "General",
  is_admitted: true,
  admission_count: 1,
  last_admitted_window: "2025-11-10",
  is_inside: false,
  presence_at: null,
  ...overrides,
});

test("a manifest from yesterday does not count yesterday's meal today", () => {
  const today = { window: "2025-11-11", manifestWindow: "2025-11-10", resetWindow: "DAY", timeZone: "Asia/Tehran" };
  const { ticketMap, currentAdmittedCount } = reconstructLocalState([manifestTicket()], [], today);
  assert.equal(ticketMap.h1.is_admitted, false);
  assert.equal(currentAdmittedCount, 0);
  const lunch = evaluateLocalScan(
    ticketMap,
    { policy_type: "SINGLE_USE", allowed_tier_ids: [], is_offline: true, admission_window: "2025-11-11" },
    "h1"
  );
  assert.equal(lunch.outcome, "PROVISIONAL");
  const again = evaluateLocalScan(
    ticketMap,
    { policy_type: "SINGLE_USE", allowed_tier_ids: [], is_offline: true, admission_window: "2025-11-11" },
    "h1"
  );
  assert.equal(again.rejection_reason, "ALREADY_ADMITTED");
});

test("replay counts only this window's scans and the server's later presence wins", () => {
  const context = { window: "2025-11-11", manifestWindow: "2025-11-11", resetWindow: "DAY", timeZone: "Asia/Tehran" };
  const ticket = manifestTicket({ last_admitted_window: "2025-11-10", is_admitted: false, is_inside: true, presence_at: "2025-11-11T06:00:00Z" });
  const { ticketMap, currentAdmittedCount, occupancy } = reconstructLocalState(
    [ticket],
    [
      // Yesterday (Tehran): ignored.
      { qr_hash: "h1", scanned_at: "2025-11-10T10:00:00.000Z", status: "ADMITTED", sync_state: "CONFIRMED" },
      // An exit before the server's latest entry: does not move the ticket out.
      { qr_hash: "h1", scanned_at: "2025-11-11T05:00:00.000Z", status: "ADMITTED", sync_state: "CONFIRMED", direction: "OUT" },
    ],
    context
  );
  assert.equal(ticketMap.h1.is_admitted, false);
  assert.equal(currentAdmittedCount, 0);
  assert.equal(ticketMap.h1.is_inside, true);
  assert.equal(occupancy, 1);

  const left = reconstructLocalState(
    [ticket],
    [{ qr_hash: "h1", scanned_at: "2025-11-11T07:00:00.000Z", status: "ADMITTED", sync_state: "PROVISIONAL", direction: "OUT" }],
    context
  );
  assert.equal(left.ticketMap.h1.is_inside, false);
  assert.equal(left.occupancy, 0);
});

test("offline at a capped occupancy point: exits are recorded, new entries fail closed", () => {
  const tickets: Record<string, LocalTicket> = { h1: manifestTicket({ is_inside: true }), h2: manifestTicket({ qr_hash: "h2", is_inside: false }) };
  const base: LocalPolicyConfig = {
    policy_type: "CAPACITY_CAPPED",
    allowed_tier_ids: [],
    max_capacity: 10,
    tracks_occupancy: true,
    current_occupancy: 1,
    is_offline: true,
    fail_closed_offline_capacity: true,
  };
  const exit = evaluateLocalScan(tickets, { ...base, direction: "OUT" }, "h1");
  assert.equal(exit.outcome, "PROVISIONAL");
  assert.equal(exit.direction, "OUT");
  assert.equal(exit.current_occupancy, 0);
  const entry = evaluateLocalScan(tickets, { ...base, current_occupancy: 0 }, "h2");
  assert.equal(entry.rejection_reason, "CAPACITY_UNAVAILABLE_OFFLINE");
});
