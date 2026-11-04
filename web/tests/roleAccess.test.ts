import test from "node:test";
import assert from "node:assert/strict";
import { canEditEvent, sessionAllows } from "../src/components/organizer/roleAccess.ts";

test("the console offers an action to roles that reach it (owner > manager > staff > viewer)", () => {
  assert.equal(sessionAllows({ role: "owner" }, "manager"), true);
  assert.equal(sessionAllows({ role: "manager" }, "manager"), true);
  assert.equal(sessionAllows({ role: "staff" }, "manager"), false);
  assert.equal(sessionAllows({ role: "staff" }, "staff"), true);
  assert.equal(sessionAllows({ role: "viewer" }, "staff"), false);
  assert.equal(sessionAllows({ role: "viewer" }, "viewer"), true);
});

test("a session it does not know yet, or an answer without a known role, is offered everything", () => {
  assert.equal(sessionAllows(null, "owner"), true);
  assert.equal(sessionAllows(undefined, "manager"), true);
  assert.equal(sessionAllows(JSON.parse("[]"), "manager"), true);
  assert.equal(sessionAllows(JSON.parse('{"role":"constructor"}'), "owner"), true);
});

test("canEdit: a manager or owner on a congress that is not archived", () => {
  const live = { archived_at: null };
  assert.equal(canEditEvent({ role: "owner" }, live), true);
  assert.equal(canEditEvent({ role: "manager" }, live), true);
  assert.equal(canEditEvent({ role: "manager" }, {}), true);
  // The API key session (owner) before /api/organizer/me answers.
  assert.equal(canEditEvent(null, live), true);
});

test("canEdit is false for a viewer or staff, for an archived congress, and before the congress loads", () => {
  const live = { archived_at: null };
  const archived = { archived_at: "2026-10-01T08:00:00Z" };
  assert.equal(canEditEvent({ role: "viewer" }, live), false);
  assert.equal(canEditEvent({ role: "staff" }, live), false);
  assert.equal(canEditEvent({ role: "owner" }, archived), false);
  assert.equal(canEditEvent({ role: "manager" }, archived), false);
  assert.equal(canEditEvent(null, archived), false);
  assert.equal(canEditEvent({ role: "owner" }, null), false);
  assert.equal(canEditEvent({ role: "owner" }, undefined), false);
});
