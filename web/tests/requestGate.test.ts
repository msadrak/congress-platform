import test from "node:test";
import assert from "node:assert/strict";
import { createRequestGate } from "../src/lib/requestGate.ts";
import { timeZoneLabel } from "../src/lib/format.ts";

test("only the newest request may write its answer", () => {
  const gate = createRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isLatest(first), false);
  assert.equal(gate.isLatest(second), true);
});

test("an unmount drops answers in flight, and a StrictMode remount works again (analytics stayed a skeleton)", () => {
  const gate = createRequestGate();
  // Development StrictMode: mount (request 1), simulated unmount, mount again (request 2).
  const beforeCleanup = gate.begin();
  gate.invalidate();
  assert.equal(gate.isLatest(beforeCleanup), false);
  const afterRemount = gate.begin();
  assert.equal(gate.isLatest(afterRemount), true);
  // A real unmount: the late answer is dropped.
  gate.invalidate();
  assert.equal(gate.isLatest(afterRemount), false);
});

test("an event's time zone reads as a place, never as a raw IANA name in Persian", () => {
  assert.equal(timeZoneLabel("Asia/Tehran", "fa"), "وقت تهران");
  assert.equal(timeZoneLabel("Asia/Tehran", "en"), "Tehran time");
  for (const zone of ["Europe/Istanbul", "Asia/Dubai", "Not/A_Zone"]) {
    const label = timeZoneLabel(zone, "fa");
    assert.doesNotMatch(label, /[A-Za-z]/, `${zone} → ${label}`);
    assert.ok(label.length > 0);
  }
  assert.notEqual(timeZoneLabel("Asia/Dubai", "en"), "Asia/Dubai");
});
