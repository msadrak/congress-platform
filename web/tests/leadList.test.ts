import test from "node:test";
import assert from "node:assert/strict";
import type { LeadOut } from "../src/api/client.ts";
import {
  LEAD_PAGE_SIZE,
  LEAD_SEARCH_MAX_LENGTH,
  accessBlockOf,
  appendLeadPage,
  hasLeadFilters,
  isBoothAccessRevoked,
  isCursorInvalid,
  isEventArchived,
  leadSearchParams,
  normalizeLeadSearch,
  replaceLead,
  totalOf,
  withoutLead,
} from "../src/lib/leadList.ts";

const lead = (id: string, extra: Partial<LeadOut> = {}): LeadOut => ({
  id,
  booth_id: "booth",
  ticket_id: `t-${id}`,
  attendee_name: `Lead ${id}`,
  attendee_mobile: null,
  organization: "",
  title: "",
  ticket_tier_name: "General",
  rating: "WARM",
  tags: [],
  notes: "",
  created_at: "2099-01-01T00:00:00Z",
  updated_at: "2099-01-01T00:00:00Z",
  ...extra,
});

test("search params carry only the filters that are set", () => {
  assert.deepEqual(leadSearchParams({ q: "", rating: "", view: "active" }), { state: "active", limit: LEAD_PAGE_SIZE });
  assert.deepEqual(leadSearchParams({ q: "  دکتر   رضایی ", rating: "HOT", view: "deleted" }, "c1", 5), {
    q: "دکتر رضایی",
    rating: "HOT",
    state: "deleted",
    limit: 5,
    cursor: "c1",
  });
  assert.equal("cursor" in leadSearchParams({ q: "", rating: "", view: "active" }, null), false);
});

test("the search term is collapsed and clipped to what the API accepts", () => {
  assert.equal(normalizeLeadSearch("  a \n b\t"), "a b");
  assert.equal(normalizeLeadSearch("x".repeat(500)).length, LEAD_SEARCH_MAX_LENGTH);
  assert.equal(hasLeadFilters({ q: "   ", rating: "", view: "active" }), false);
  assert.equal(hasLeadFilters({ q: "", rating: "COLD", view: "active" }), true);
  assert.equal(hasLeadFilters({ q: "۰۹۱۲", rating: "", view: "deleted" }), true);
});

test("a further page never repeats a lead already shown", () => {
  const merged = appendLeadPage([lead("1"), lead("2")], [lead("2"), lead("3")]);
  assert.deepEqual(merged.map((l) => l.id), ["1", "2", "3"]);
});

test("local edits replace or drop exactly one lead", () => {
  const list = [lead("1"), lead("2")];
  const replaced = replaceLead(list, lead("2", { rating: "HOT" }));
  assert.equal(replaced[1].rating, "HOT");
  assert.equal(replaced[0], list[0]);
  assert.deepEqual(withoutLead(list, "1").map((l) => l.id), ["2"]);
  assert.deepEqual(withoutLead(list, "missing").map((l) => l.id), ["1", "2"]);
});

test("revoked access and a stale cursor are recognised by code, never by text", () => {
  assert.equal(isBoothAccessRevoked(403, { detail: "x", code: "BOOTH_STAFF_REQUIRED" }), true);
  assert.equal(isBoothAccessRevoked(403, { detail: "You are not authorized to access this booth portal" }), false);
  assert.equal(isBoothAccessRevoked(404, { detail: "x", code: "BOOTH_STAFF_REQUIRED" }), false);
  assert.equal(isCursorInvalid(400, { detail: "Invalid page cursor", code: "CURSOR_INVALID" }), true);
  assert.equal(isCursorInvalid(400, { detail: "Invalid page cursor" }), false);
});

test("the booth total is the sum of the three ratings", () => {
  assert.equal(totalOf({ HOT: 2, WARM: 5, COLD: 1 }), 8);
});

test("a removed representative and a suspended organizer close the workspace; an archived congress only stops changes", () => {
  assert.equal(accessBlockOf(403, { detail: "x", code: "BOOTH_STAFF_REQUIRED" }), "removed");
  assert.equal(accessBlockOf(403, { detail: "x", code: "BOOTH_ACCESS_SUSPENDED" }), "suspended");
  assert.equal(accessBlockOf(403, { detail: "Booth access for this congress is suspended" }), null);
  assert.equal(accessBlockOf(409, { detail: "x", code: "BOOTH_ACCESS_SUSPENDED" }), null);
  assert.equal(isEventArchived(409, { detail: "x", code: "EVENT_ARCHIVED" }), true);
  assert.equal(isEventArchived(409, { detail: "x", code: "LEAD_DELETED" }), false);
  assert.equal(isEventArchived(403, { detail: "x", code: "EVENT_ARCHIVED" }), false);
});
