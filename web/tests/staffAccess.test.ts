import test from "node:test";
import assert from "node:assert/strict";
import type { AccessEvent } from "../src/api/client.ts";
import { hasBoothRole, staffDestinations } from "../src/lib/staffAccess.ts";

const event = (slug: string, name: string, extra: Partial<AccessEvent> = {}): AccessEvent => ({
  event_id: `event-${slug}`,
  event_slug: slug,
  event_name: name,
  roles: [],
  ticket_ids: [],
  desk_operator_ids: [],
  booth_ids: [],
  partner_ids: [],
  ...extra,
});

test("attendee-only access has no staff destinations and needs no booth names", () => {
  const access = { events: [event("a", "Alpha", { roles: ["ATTENDEE"], ticket_ids: ["t1"] })] };
  assert.equal(hasBoothRole(access), false);
  assert.deepEqual(staffDestinations(access), { booths: [], desks: [] });
});

test("booths are named from the booth list and desks come from reception roles, sorted by congress", () => {
  const access = {
    events: [
      event("z", "Zeta congress", { roles: ["RECEPTION"], desk_operator_ids: ["op-1"] }),
      event("a", "Alpha congress", { roles: ["ATTENDEE", "PARTNER"], ticket_ids: ["t"], booth_ids: ["b2", "b1"] }),
    ],
  };
  assert.equal(hasBoothRole(access), true);
  const result = staffDestinations(access, [
    { id: "b1", name: "Aria Med", location: "Hall A" },
    { id: "b2", name: "Bita Lab", location: "" },
    { id: "other", name: "Not mine any more", location: "" },
  ]);
  assert.deepEqual(result.booths.map((b) => [b.id, b.name, b.eventSlug]), [["b1", "Aria Med", "a"], ["b2", "Bita Lab", "a"]]);
  assert.deepEqual(result.desks, [{ eventId: "event-z", eventName: "Zeta congress", eventSlug: "z" }]);
});

test("a booth the list does not name keeps an empty name", () => {
  const access = { events: [event("a", "Alpha", { roles: ["PARTNER"], booth_ids: ["b9"] })] };
  assert.deepEqual(staffDestinations(access, []).booths, [
    { id: "b9", name: "", location: "", eventId: "event-a", eventName: "Alpha", eventSlug: "a" },
  ]);
});
