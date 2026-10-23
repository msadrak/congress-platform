import test from "node:test";
import assert from "node:assert/strict";
import { activityAction, activityActor, activityTarget, roleAtLeast, sessionAllows } from "../src/lib/organizerConsole.ts";

test("roles rank owner > manager > staff > viewer, and no role reaches anything", () => {
  assert.equal(roleAtLeast("owner", "manager"), true);
  assert.equal(roleAtLeast("manager", "manager"), true);
  assert.equal(roleAtLeast("staff", "manager"), false);
  assert.equal(roleAtLeast("viewer", "staff"), false);
  assert.equal(roleAtLeast(null, "viewer"), false);
});

test("the console offers an action to roles that reach it, and to a session it does not know yet", () => {
  assert.equal(sessionAllows({ role: "owner" }, "manager"), true);
  assert.equal(sessionAllows({ role: "manager" }, "manager"), true);
  assert.equal(sessionAllows({ role: "staff" }, "manager"), false);
  assert.equal(sessionAllows({ role: "staff" }, "staff"), true);
  assert.equal(sessionAllows({ role: "viewer" }, "staff"), false);
  assert.equal(sessionAllows(null, "owner"), true);
  assert.equal(sessionAllows(undefined, "manager"), true);
  // Not a session at all (e.g. an empty list from a misrouted response): unknown, so offered.
  assert.equal(sessionAllows(JSON.parse("[]"), "manager"), true);
});

test("an automatic row names the route without the prefix and its ids", () => {
  const item = { action: "http.patch", summary: { route: "/api/events/{event_id}/booths/{booth_id}", method: "PATCH", status: 200 } };
  assert.equal(activityTarget(item, "en"), "events › booths");
  assert.equal(activityAction("http.patch", "en"), "edited");
  assert.equal(activityAction("something.new", "fa"), "something.new");
});

test("member rows show the person and the role change in the reader's language", () => {
  const changed = { action: "member.role_changed", summary: { display_name: "Ali", from: "staff", to: "viewer" } };
  assert.equal(activityTarget(changed, "en"), "Ali: Staff → Viewer");
  assert.equal(activityTarget(changed, "fa"), "Ali: کارمند → ناظر");
  const invited = { action: "member.invited", summary: { display_name: "Neda", role: "owner", mobile: "0912***4567" } };
  assert.equal(activityTarget(invited, "en"), "Neda (Owner)");
});

test("people are named by their label; the platform and the key by their localized role", () => {
  assert.equal(activityActor({ actor_type: "organizer_member", actor_label: "Neda" }, "en"), "Neda");
  assert.equal(activityActor({ actor_type: "desk_operator", actor_label: "" }, "en"), "Desk operator");
  assert.equal(activityActor({ actor_type: "platform_admin", actor_label: "Platform admin" }, "fa"), "مدیر پلتفرم");
  assert.equal(activityActor({ actor_type: "organizer_key", actor_label: "Integration key" }, "fa"), "کلید یکپارچه‌سازی");
});
