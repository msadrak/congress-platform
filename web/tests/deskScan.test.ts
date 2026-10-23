import test from "node:test";
import assert from "node:assert/strict";
import { badgeCode } from "../src/lib/deskScan.ts";
import { admitReasonText, badgeAffiliation, badgePrintState } from "../src/lib/deskBadge.ts";

const SECRET = "mzxw6ytboi2dqnrzgezdgnbvgy"; // 26 base32 characters, like a pass QR secret

test("badgeCode: a scanned pass secret is recognised and normalized like the scanner", () => {
  assert.equal(badgeCode(SECRET), SECRET);
  assert.equal(badgeCode(`  ${SECRET.toUpperCase()}\n`), SECRET);
  assert.equal(badgeCode("MZXW6YTBOI۲DQNRZGEZDGNBVGY"), SECRET);
});

test("badgeCode: names, mobile numbers and short words are searched, not looked up", () => {
  assert.equal(badgeCode("Alice Rahimi"), null);
  assert.equal(badgeCode("09121234567"), null);
  assert.equal(badgeCode("۰۹۱۲۱۲۳۴۵۶۷"), null);
  assert.equal(badgeCode("علی رحیمی"), null);
  assert.equal(badgeCode("cardiology"), null);
});

test("badge print state: never printed, current, or out of date after a change", () => {
  assert.equal(badgePrintState({ print_count: 0, needs_reprint: false }), "never");
  assert.equal(badgePrintState({ print_count: 2, needs_reprint: false }), "printed");
  assert.equal(badgePrintState({ print_count: 1, needs_reprint: true }), "stale");
});

test("desk admission refusals read in the operator's language; unknown codes stay visible", () => {
  assert.match(admitReasonText("ALREADY_ADMITTED", "en"), /single use/);
  assert.match(admitReasonText("CAPACITY_REACHED", "fa"), /ظرفیت/);
  assert.match(admitReasonText("TIER_NOT_ALLOWED", "fa"), /نوع کارت ورود/);
  // Product glossary: the attendee's ticket is «کارت ورود», a check-in point «نقطه ورود».
  for (const code of ["ALREADY_ADMITTED", "CAPACITY_REACHED", "TIER_NOT_ALLOWED", "TICKET_INACTIVE", "INVALID_TICKET", "EVENT_MISMATCH"]) {
    assert.doesNotMatch(admitReasonText(code, "fa"), /بلیت|بلیط|گیت|رده/, code);
  }
  assert.equal(admitReasonText("SOMETHING_NEW", "en"), "SOMETHING_NEW");
  assert.equal(admitReasonText(null, "fa"), "");
});

test("badge affiliation: title and organization, whichever are set", () => {
  assert.equal(badgeAffiliation("Cardiologist", "Heart Center"), "Cardiologist · Heart Center");
  assert.equal(badgeAffiliation("", " Heart Center "), "Heart Center");
  assert.equal(badgeAffiliation("", ""), "");
});
