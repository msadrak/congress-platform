import test from "node:test";
import assert from "node:assert/strict";
import {
  activityAction,
  activityActor,
  activityActorKind,
  describeActivity,
  inviterLabel,
  roleAtLeast,
  sessionAllows,
} from "../src/lib/organizerConsole.ts";

const automatic = (method: string, route: string) => ({ action: `http.${method.toLowerCase()}`, summary: { route, method, status: 200 } });

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
});

test("an automatic row reads as a phrase in the reader's language, from its route template", () => {
  const booth = automatic("PATCH", "/api/events/{event_id}/booths/{booth_id}");
  assert.deepEqual(describeActivity(booth, "en"), { action: "edited a booth", target: "" });
  assert.deepEqual(describeActivity(booth, "fa"), { action: "غرفه را ویرایش کرد", target: "" });
  const token = automatic("POST", "/api/checkin-points/{point_id}/token");
  assert.equal(describeActivity(token, "fa").action, "برای نقطه ورود پیوند اتصال اسکنر ساخت");
  const participant = automatic("PATCH", "/api/events/{event_id}/participants/{ticket_id}");
  assert.equal(describeActivity(participant, "fa").action, "اطلاعات شرکت‌کننده را ویرایش کرد");
  const tier = automatic("DELETE", "/api/events/{event_id}/ticket-tiers/{tier_id}");
  assert.equal(describeActivity(tier, "fa").action, "نوع کارت ورود را حذف کرد");
  const exported = { action: "export.download", summary: { route: "/api/events/{event_id}/participants/export-csv", method: "GET", status: 200 } };
  assert.equal(describeActivity(exported, "en").action, "downloaded the participant list (CSV)");
});

test("a route without a label names its subject, and no reader sees the raw template", () => {
  const unknown = automatic("POST", "/api/checkin-points/{point_id}/heartbeat");
  assert.equal(describeActivity(unknown, "fa").action, "ثبت کرد · نقطه ورود");
  assert.equal(describeActivity(unknown, "en").action, "created · check-in point");
  const stranger = automatic("PUT", "/api/widgets/{widget_id}/frobnicate");
  assert.equal(describeActivity(stranger, "fa").action, "موردی را ذخیره کرد");
  assert.doesNotMatch(describeActivity(stranger, "fa").action, /[A-Za-z]/);
  assert.equal(describeActivity(stranger, "en").action, "saved an item");
  assert.doesNotMatch(describeActivity(stranger, "en").action, /widgets|frobnicate|›/);
  // An unknown child of a congress is not "the congress".
  const child = automatic("DELETE", "/api/events/{event_id}/brand-new/{thing_id}");
  assert.equal(describeActivity(child, "fa").action, "موردی را حذف کرد");
  assert.equal(activityAction("something.new", "fa"), "تغییری ثبت کرد");
  assert.equal(activityAction("something.new", "en"), "made a change");
});

test("every labelled route reads without Latin letters in Persian (CSV aside)", () => {
  const routes: [string, string][] = [
    ["POST", "/api/events"],
    ["POST", "/api/events/{event_id}/desk-registrations"],
    ["POST", "/api/events/{event_id}/attendees/qr-lookup"],
    ["PUT", "/api/events/{event_id}/page"],
    ["POST", "/api/events/{event_id}/sms/test"],
    ["DELETE", "/api/events/{event_id}/desk/operators/{operator_id}"],
  ];
  for (const [method, route] of routes) {
    const phrase = describeActivity(automatic(method, route), "fa").action.replace("کد QR", "");
    assert.doesNotMatch(phrase, /[A-Za-z]/, `${method} ${route} → ${phrase}`);
  }
});

test("member rows show the person and the role change in the reader's language", () => {
  const changed = { action: "member.role_changed", summary: { display_name: "Ali", from: "staff", to: "viewer" } };
  assert.deepEqual(describeActivity(changed, "en"), { action: "changed a member's role", target: "Ali: Staff → Viewer" });
  assert.equal(describeActivity(changed, "fa").target, "Ali: کارمند → ناظر");
  const invited = { action: "member.invited", summary: { display_name: "Neda", role: "owner", mobile: "0912***4567" } };
  assert.equal(describeActivity(invited, "en").target, "Neda (Owner)");
});

test("people are named by their label; the platform and the key by their localized role", () => {
  assert.equal(activityActor({ actor_type: "organizer_member", actor_label: "Neda" }, "en"), "Neda");
  assert.equal(activityActor({ actor_type: "desk_operator", actor_label: "" }, "en"), "Desk operator");
  assert.equal(activityActor({ actor_type: "platform_admin", actor_label: "Platform admin" }, "fa"), "مدیر سامانه");
  assert.equal(activityActor({ actor_type: "organizer_key", actor_label: "Integration key" }, "fa"), "کلید سازمان");
  assert.equal(activityActor({ actor_type: "api_key", actor_label: "API key" }, "fa"), "کلید سازمان");
  assert.equal(activityActor({ actor_type: "booth_staff", actor_label: "Reza" }, "fa"), "Reza");
  assert.equal(activityActorKind("booth_staff", "fa"), "نمایندهٔ غرفه");
  assert.equal(activityActorKind("member", "en"), "Member");
  assert.equal(activityActorKind("robot", "fa"), "سامانه");
});

test("who added a member: the key and the platform admin are localized, people keep their name", () => {
  assert.equal(inviterLabel("api-key", "fa"), "کلید سازمان");
  assert.equal(inviterLabel("api-key", "en"), "Organizer key");
  assert.equal(inviterLabel("Integration key", "fa"), "کلید سازمان");
  assert.equal(inviterLabel("Platform admin", "fa"), "مدیر سامانه");
  assert.equal(inviterLabel("Neda Karimi", "fa"), "Neda Karimi");
});
