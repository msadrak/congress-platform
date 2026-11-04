import test from "node:test";
import assert from "node:assert/strict";
import { formatPassDateRange, formatPassIssuedDate } from "../src/lib/passDates.ts";
import { formatLocalizedDate } from "../src/lib/i18n.ts";

// 00:00 on 10 April 2027 in Tehran (UTC+3:30), to 21:30 on 12 April there. Other zones see other days.
const STARTS = "2027-04-09T20:30:00Z";
const ENDS = "2027-04-12T18:00:00Z";
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

test("the dates are the congress's own days, whatever zone the phone is in", () => {
  assert.match(formatPassDateRange(STARTS, ENDS, "en", "Asia/Tehran"), /^10\D+12 April 2027$/);
  assert.match(formatPassDateRange(STARTS, ENDS, "en", "Pacific/Honolulu"), /^9\D+12 April 2027$/);
  assert.match(formatPassDateRange(STARTS, ENDS, "en", "Pacific/Auckland"), /^10\D+13 April 2027$/);
});

test("Persian dates are Solar Hijri days of the congress's zone", () => {
  assert.match(formatPassDateRange(STARTS, ENDS, "fa", "Asia/Tehran"), /^۲۱ \S+ ۲۳ فروردین ۱۴۰۶$/);
  assert.match(formatPassDateRange(STARTS, ENDS, "fa", "Pacific/Honolulu"), /^۲۰ \S+ ۲۳ فروردین ۱۴۰۶$/);
});

test("without a usable zone the dates are read in the device's zone, as before", () => {
  for (const zone of [undefined, null, "", "Not/AZone", "tehran"]) {
    for (const locale of ["fa", "en"] as const) {
      assert.equal(formatPassDateRange(STARTS, ENDS, locale, zone), formatPassDateRange(STARTS, ENDS, locale, deviceZone), `${locale} ${String(zone)}`);
    }
  }
});

test("an unreadable date shows its raw text instead of throwing", () => {
  assert.equal(formatPassDateRange("soon", ENDS, "en", "Asia/Tehran"), `soon – ${ENDS}`);
  assert.equal(formatPassDateRange(STARTS, "", "fa", "Asia/Tehran"), `${STARTS} – `);
});

test("the issued date is the day in the congress's zone too", () => {
  assert.equal(formatPassIssuedDate(STARTS, "fa", "Asia/Tehran"), formatLocalizedDate(STARTS, "fa", "Asia/Tehran"));
  assert.match(formatPassIssuedDate(STARTS, "fa", "Asia/Tehran"), /۲۱ فروردین ۱۴۰۶/);
  assert.match(formatPassIssuedDate(STARTS, "fa", "Pacific/Honolulu"), /۲۰ فروردین ۱۴۰۶/);
  assert.match(formatPassIssuedDate(STARTS, "en", "Asia/Tehran"), /10 Apr 2027/);
  assert.match(formatPassIssuedDate(STARTS, "en", "Pacific/Honolulu"), /9 Apr 2027/);
  for (const zone of [undefined, null, "Not/AZone"]) {
    assert.equal(formatPassIssuedDate(STARTS, "en", zone), formatLocalizedDate(STARTS, "en", deviceZone), String(zone));
  }
  assert.equal(formatPassIssuedDate("not a date", "en", "Asia/Tehran"), "not a date");
});
