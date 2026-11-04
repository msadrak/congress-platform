import test from "node:test";
import assert from "node:assert/strict";
import type { AttendeeTicketDetail } from "../src/api/client.ts";
import type { LinkPass } from "../src/lib/linkPass.ts";
import {
  canSelfCancel,
  congressTiming,
  groupCongresses,
  isCancelledStatus,
  knownCongressName,
  passSwitchLabels,
  passesForCongress,
} from "../src/lib/attendeePasses.ts";

const NOW = Date.parse("2027-05-11T12:00:00Z");

function ticket(id: string, slug: string, startsAt: string, endsAt: string, extra: Partial<AttendeeTicketDetail> = {}): AttendeeTicketDetail {
  return {
    id, event_id: `event-${slug}`, event_name: `Congress ${slug}`, event_slug: slug, event_location: "Hall",
    event_starts_at: startsAt, event_ends_at: endsAt, event_timezone: "Asia/Tehran", ticket_tier_id: "tier", ticket_tier_name: "Delegate",
    attendee_name: "Sara", attendee_mobile: null, status: "active", qr_secret: `qr-${id}`, created_at: "2027-01-01T00:00:00Z",
    ...extra,
  };
}

function linkPass(id: string, slug: string, startsAt: string, endsAt: string): LinkPass {
  return {
    ticket_id: id, status: "active", issued_at: "2027-01-02T00:00:00Z", qr_secret: `qr-${id}`, tier_name: "Guest",
    expires_at: "2099-01-01T00:00:00Z",
    event: { id: `event-${slug}`, slug, name: `Congress ${slug}`, starts_at: startsAt, ends_at: endsAt, location: "Hall" },
    attendee: { full_name: "Sara", organization: null, title: null },
  } as LinkPass;
}

test("a congress is upcoming before it starts, live while it runs and past after it ends", () => {
  assert.equal(congressTiming("2027-05-12T08:00:00Z", "2027-05-13T08:00:00Z", NOW), "upcoming");
  assert.equal(congressTiming("2027-05-10T08:00:00Z", "2027-05-12T08:00:00Z", NOW), "live");
  assert.equal(congressTiming("2027-05-11T12:00:00Z", "2027-05-11T13:00:00Z", NOW), "live");
  assert.equal(congressTiming("2027-05-01T08:00:00Z", "2027-05-02T08:00:00Z", NOW), "past");
  assert.equal(congressTiming("nonsense", "nonsense", NOW), "upcoming");
});

test("status is read case-insensitively; only cancelled passes stop working", () => {
  assert.equal(isCancelledStatus("cancelled"), true);
  assert.equal(isCancelledStatus("CANCELLED"), true);
  assert.equal(isCancelledStatus("active"), false);
  assert.equal(isCancelledStatus("ACTIVE"), false);
});

test("congresses are grouped by timing, one card per congress with its pass count", () => {
  const groups = groupCongresses(
    [
      ticket("a1", "alpha", "2027-06-01T08:00:00Z", "2027-06-02T08:00:00Z"),
      ticket("a2", "alpha", "2027-06-01T08:00:00Z", "2027-06-02T08:00:00Z"),
      ticket("b1", "beta", "2027-05-20T08:00:00Z", "2027-05-21T08:00:00Z"),
      ticket("l1", "live", "2027-05-10T08:00:00Z", "2027-05-12T08:00:00Z"),
      ticket("p1", "old", "2026-05-10T08:00:00Z", "2026-05-12T08:00:00Z"),
      ticket("p2", "older", "2025-05-10T08:00:00Z", "2025-05-12T08:00:00Z"),
      ticket("c1", "gone", "2027-06-01T08:00:00Z", "2027-06-02T08:00:00Z", { status: "cancelled" }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(groups.upcoming.map((c) => [c.slug, c.passCount]), [["beta", 1], ["alpha", 2]]);
  assert.deepEqual(groups.live.map((c) => c.slug), ["live"]);
  assert.deepEqual(groups.past.map((c) => c.slug), ["old", "older"]);
  assert.equal([...groups.upcoming, ...groups.live, ...groups.past].some((c) => c.slug === "gone"), false);
});

test("link passes join the list without duplicating a pass the account already holds", () => {
  const groups = groupCongresses(
    [ticket("a1", "alpha", "2027-06-01T08:00:00Z", "2027-06-02T08:00:00Z")],
    [linkPass("a1", "alpha", "2027-06-01T08:00:00Z", "2027-06-02T08:00:00Z"), linkPass("s1", "sms", "2027-07-01T08:00:00Z", "2027-07-02T08:00:00Z")],
    NOW,
  );
  assert.deepEqual(groups.upcoming.map((c) => [c.slug, c.passCount, c.fromLink]), [["alpha", 1, false], ["sms", 1, true]]);
});

test("the pass page shows this congress's working passes newest first, cancelled ones apart", () => {
  const { active, cancelled } = passesForCongress(
    [
      ticket("old", "alpha", "x", "x", { created_at: "2027-01-01T00:00:00Z" }),
      ticket("new", "alpha", "x", "x", { created_at: "2027-02-01T00:00:00Z" }),
      ticket("off", "alpha", "x", "x", { status: "cancelled" }),
      ticket("other", "beta", "x", "x"),
    ],
    "alpha",
  );
  assert.deepEqual(active.map((t) => t.id), ["new", "old"]);
  assert.deepEqual(cancelled.map((t) => t.id), ["off"]);
});

test("switcher labels carry tier and issue date and stay distinct", () => {
  const date = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(
    passSwitchLabels(
      [
        { ticket_tier_name: "Delegate", created_at: "2027-01-01T08:00:00Z" },
        { ticket_tier_name: "Workshop", created_at: "2027-01-01T09:00:00Z" },
        { ticket_tier_name: "Delegate", created_at: "2027-01-01T10:00:00Z" },
      ],
      date,
    ),
    ["Delegate · 2027-01-01 (1)", "Workshop · 2027-01-01", "Delegate · 2027-01-01 (2)"],
  );
});

test("self-cancel is offered only for a working pass before the congress starts", () => {
  assert.equal(canSelfCancel({ status: "active", event_starts_at: "2027-05-12T08:00:00Z" }, NOW), true);
  assert.equal(canSelfCancel({ status: "active", event_starts_at: "2027-05-10T08:00:00Z" }, NOW), false);
  assert.equal(canSelfCancel({ status: "cancelled", event_starts_at: "2027-05-12T08:00:00Z" }, NOW), false);
  assert.equal(canSelfCancel({ status: "active", event_starts_at: "bad" }, NOW), false);
});

test("the offline header finds the congress name in a cached or link pass", () => {
  const cached = [ticket("a1", "alpha", "x", "x")];
  assert.equal(knownCongressName("alpha", cached), "Congress alpha");
  assert.equal(knownCongressName("sms", cached, [linkPass("s1", "sms", "x", "x")]), "Congress sms");
  assert.equal(knownCongressName("none", cached), null);
});
