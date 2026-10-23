import test from "node:test";
import assert from "node:assert/strict";
import { sessionAllows } from "../src/components/organizer/roleAccess.ts";

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
