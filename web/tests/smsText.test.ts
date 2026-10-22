import test from "node:test";
import assert from "node:assert/strict";
import { placeholdersIn, renderSms, smsSize, unknownPlaceholders } from "../src/lib/smsText.ts";

test("Persian text costs 70 characters per SMS, 67 per part once it is split", () => {
  assert.deepEqual(smsSize(""), { encoding: "gsm", characters: 0, parts: 0, perPart: 160 });
  assert.deepEqual(smsSize("س".repeat(70)), { encoding: "unicode", characters: 70, parts: 1, perPart: 70 });
  assert.deepEqual(smsSize("س".repeat(71)), { encoding: "unicode", characters: 71, parts: 2, perPart: 67 });
  assert.equal(smsSize("Code 123 کد").encoding, "unicode");
});

test("Latin-only text uses the 160-character GSM alphabet; extension characters count twice", () => {
  assert.deepEqual(smsSize("a".repeat(160)), { encoding: "gsm", characters: 160, parts: 1, perPart: 160 });
  assert.deepEqual(smsSize("a".repeat(161)), { encoding: "gsm", characters: 161, parts: 2, perPart: 153 });
  assert.equal(smsSize("{code}").characters, 8);
});

test("placeholders render like the API: flattened, shortened, unknown tokens left visible", () => {
  const body = "{name} عزیز، {event}\n{link} {oops}";
  const out = renderSms(body, { name: "Dr.\n  Sara", event: "E".repeat(80), link: "https://x/c/a/my-ticket" });
  assert.equal(out, `Dr. Sara عزیز، ${"E".repeat(59)}…\nhttps://x/c/a/my-ticket {oops}`);
  assert.deepEqual(placeholdersIn(body), ["name", "event", "link", "oops"]);
  assert.deepEqual(unknownPlaceholders(body, ["name", "event", "link"]), ["oops"]);
});
