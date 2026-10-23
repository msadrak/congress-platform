import test from "node:test";
import assert from "node:assert/strict";
import {
  nextChange,
  registrationSummary,
  registrationWindow,
  tierAvailability,
  tierWindow,
  type RegistrationFields,
  type TierFields,
} from "../src/lib/registrationWindow.ts";

const NOW = Date.parse("2027-05-01T08:00:00Z");
const event = (extra: Partial<RegistrationFields> = {}): RegistrationFields => ({
  ends_at: "2027-05-11T14:00:00Z",
  registration_enabled: true,
  registration_opens_at: null,
  registration_closes_at: null,
  registration_open: true,
  ...extra,
});
const tier = (extra: Partial<TierFields> = {}): TierFields => ({ quota: 100, reserved_count: 10, is_open: true, ...extra });

test("a congress window follows the API's order: ended, switched off, closed, not yet, open", () => {
  assert.deepEqual(registrationWindow(event(), NOW), { kind: "open", closesAt: null });
  assert.deepEqual(registrationWindow(event({ ends_at: "2027-04-30T00:00:00Z", registration_enabled: false }), NOW), { kind: "closed", reason: "ended" });
  assert.deepEqual(registrationWindow(event({ registration_enabled: false, registration_open: false }), NOW), { kind: "closed", reason: "event" });
  assert.deepEqual(
    registrationWindow(event({ registration_closes_at: "2027-04-30T00:00:00Z", registration_open: false }), NOW),
    { kind: "closed", reason: "event" },
  );
  assert.deepEqual(
    registrationWindow(event({ registration_opens_at: "2027-05-02T06:30:00Z", registration_open: false }), NOW),
    { kind: "opens", at: "2027-05-02T06:30:00Z" },
  );
  assert.deepEqual(
    registrationWindow(event({ registration_closes_at: "2027-05-05T00:00:00Z" }), NOW),
    { kind: "open", closesAt: "2027-05-05T00:00:00Z" },
  );
});

test("a congress that opened after the page loaded is open; a server 'closed' without a visible reason stays closed", () => {
  // Loaded before opening (server said false), the opening instant has since passed on this device.
  assert.deepEqual(registrationWindow(event({ registration_opens_at: "2027-05-01T07:59:00Z", registration_open: false }), NOW), { kind: "open", closesAt: null });
  assert.deepEqual(registrationWindow(event({ registration_open: false }), NOW), { kind: "closed", reason: "event" });
  // The server already said open although this device's clock is behind the opening: trust the server.
  assert.deepEqual(registrationWindow(event({ registration_opens_at: "2027-05-01T08:05:00Z", registration_open: true }), NOW), { kind: "open", closesAt: null });
});

test("payloads without window fields mean no restriction", () => {
  assert.deepEqual(registrationWindow({ ends_at: "2027-05-11T14:00:00Z" }, NOW), { kind: "open", closesAt: null });
  assert.deepEqual(tierWindow({ quota: 5, is_open: true }, NOW), { kind: "open", closesAt: null });
});

test("a tier is full before closed, closed before its sales window", () => {
  assert.deepEqual(tierWindow(tier({ reserved_count: 100, is_open: false }), NOW), { kind: "full" });
  assert.deepEqual(tierWindow(tier({ is_open: false, sales_starts_at: "2027-06-01T00:00:00Z" }), NOW), { kind: "closed", reason: "tier" });
  assert.deepEqual(tierWindow(tier({ sales_ends_at: "2027-05-01T08:00:00Z" }), NOW), { kind: "closed", reason: "sales" });
  assert.deepEqual(tierWindow(tier({ sales_starts_at: "2027-05-03T05:00:00Z" }), NOW), { kind: "opens", at: "2027-05-03T05:00:00Z" });
  assert.deepEqual(
    tierWindow(tier({ sales_starts_at: "2027-04-01T00:00:00Z", sales_ends_at: "2027-05-04T00:00:00Z" }), NOW),
    { kind: "open", closesAt: "2027-05-04T00:00:00Z" },
  );
});

test("a closed or not-yet-open congress decides for every tier that is not full", () => {
  const notYet = event({ registration_opens_at: "2027-05-02T00:00:00Z", registration_open: false });
  assert.deepEqual(tierAvailability(notYet, tier(), NOW), { kind: "opens", at: "2027-05-02T00:00:00Z" });
  assert.deepEqual(tierAvailability(notYet, tier({ sales_starts_at: "2027-05-03T00:00:00Z" }), NOW), { kind: "opens", at: "2027-05-03T00:00:00Z" });
  assert.deepEqual(tierAvailability(notYet, tier({ sales_starts_at: "2027-04-03T00:00:00Z" }), NOW), { kind: "opens", at: "2027-05-02T00:00:00Z" });
  assert.deepEqual(tierAvailability(notYet, tier({ reserved_count: 100 }), NOW), { kind: "full" });
  assert.deepEqual(tierAvailability(notYet, tier({ is_open: false }), NOW), { kind: "closed", reason: "tier" });
  const ended = event({ ends_at: "2027-04-01T00:00:00Z" });
  assert.deepEqual(tierAvailability(ended, tier(), NOW), { kind: "closed", reason: "ended" });
  // Open congress: the earlier of the two closing instants.
  const closing = event({ registration_closes_at: "2027-05-06T00:00:00Z" });
  assert.deepEqual(tierAvailability(closing, tier({ sales_ends_at: "2027-05-04T00:00:00Z" }), NOW), { kind: "open", closesAt: "2027-05-04T00:00:00Z" });
  assert.deepEqual(tierAvailability(closing, tier(), NOW), { kind: "open", closesAt: "2027-05-06T00:00:00Z" });
});

test("the summary is open, opens at the earliest tier, full, or closed", () => {
  assert.deepEqual(registrationSummary(event(), [tier({ is_open: false }), tier()], NOW), { kind: "open" });
  assert.deepEqual(
    registrationSummary(event(), [tier({ sales_starts_at: "2027-05-04T00:00:00Z" }), tier({ sales_starts_at: "2027-05-03T00:00:00Z" })], NOW),
    { kind: "opens", at: "2027-05-03T00:00:00Z" },
  );
  assert.deepEqual(registrationSummary(event(), [tier({ reserved_count: 100 }), tier({ is_open: false })], NOW), { kind: "full" });
  assert.deepEqual(registrationSummary(event(), [tier({ is_open: false })], NOW), { kind: "closed", reason: "tiers" });
  assert.deepEqual(registrationSummary(event(), [], NOW), { kind: "closed", reason: "tiers" });
  assert.deepEqual(registrationSummary(event({ registration_enabled: false, registration_open: false }), [tier()], NOW), { kind: "closed", reason: "event" });
  assert.deepEqual(registrationSummary(event({ ends_at: "2027-04-01T00:00:00Z" }), [tier()], NOW), { kind: "closed", reason: "ended" });
  assert.deepEqual(
    registrationSummary(event({ registration_opens_at: "2027-05-02T00:00:00Z", registration_open: false }), [], NOW),
    { kind: "opens", at: "2027-05-02T00:00:00Z" },
  );
});

test("the next change is the earliest future opening or closing", () => {
  assert.equal(
    nextChange([{ kind: "opens", at: "2027-05-03T00:00:00Z" }, { kind: "open", closesAt: "2027-05-02T00:00:00Z" }, { kind: "full" }], NOW),
    Date.parse("2027-05-02T00:00:00Z"),
  );
  assert.equal(nextChange([{ kind: "open", closesAt: null }, { kind: "closed", reason: "tier" }], NOW), null);
});
