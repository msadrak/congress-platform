import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hidCharacter, normalizeScannedCode, qrHash } from "../src/lib/scannerInput.ts";

test("normalizeScannedCode: Persian and Arabic-Indic digits become Latin, trimmed and lower case", () => {
  assert.equal(normalizeScannedCode("  SEC-۱۲۳۴-٥٦٧٨\n"), "sec-1234-5678");
  assert.equal(normalizeScannedCode("AbC"), "abc");
  assert.equal(normalizeScannedCode("   "), "");
});

test("normalizeScannedCode: at most 64 characters, like the server", () => {
  assert.equal(normalizeScannedCode("x".repeat(80)).length, 64);
});

test("hidCharacter: physical keys win over the active layout (a Persian layout types ش for KeyA)", () => {
  assert.equal(hidCharacter({ code: "KeyA", key: "ش" }), "a");
  assert.equal(hidCharacter({ code: "KeyA", key: "A", shiftKey: true }), "A");
  assert.equal(hidCharacter({ code: "Digit5", key: "۵" }), "5");
  assert.equal(hidCharacter({ code: "Numpad7", key: "7" }), "7");
  assert.equal(hidCharacter({ code: "Minus", key: "-" }), "-");
  assert.equal(hidCharacter({ code: "Minus", key: "_", shiftKey: true }), "_");
  assert.equal(hidCharacter({ code: "Digit2", key: "@", shiftKey: true }), "@");
});

test("hidCharacter: falls back to the typed character with Latin digits; ignores non-character keys", () => {
  assert.equal(hidCharacter({ code: "", key: "۹" }), "9");
  assert.equal(hidCharacter({ key: "z" }), "z");
  assert.equal(hidCharacter({ code: "ShiftLeft", key: "Shift", shiftKey: true }), null);
  assert.equal(hidCharacter({ code: "Tab", key: "Tab" }), null);
});

test("qrHash: sha256 of '<event_id>:<normalized code>', the backend's manifest_qr_hash", async () => {
  const eventId = "4f1c2b7e-0000-4000-8000-000000000001";
  const expected = createHash("sha256").update(`${eventId}:sec-1234`).digest("hex");
  assert.equal(await qrHash(eventId, "sec-1234"), expected);
  // Any input path (camera, HID, manual entry with Persian digits) hashes to the same key.
  assert.equal(await qrHash(eventId, " SEC-۱۲۳۴ "), expected);
});
