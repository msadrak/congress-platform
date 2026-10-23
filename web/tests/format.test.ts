import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHour, formatDay } from "../src/lib/analyticsTime.ts";
import { sessionDateFormats } from "../src/components/organizer/sessionTime.ts";
import {
  formatClock,
  formatDate,
  formatDateRange,
  formatEventDate,
  formatMobile,
  formatNumber,
  formatPercent,
  formatTime,
  timeZoneLabel,
  type DateStyle,
} from "../src/lib/format.ts";
import { formatLocalizedDate, formatLocalizedNumber } from "../src/lib/i18n.ts";
import { formatPassDateRange, formatPassIssuedDate } from "../src/lib/passDates.ts";

const TEHRAN = "Asia/Tehran";
/** 09:30 on Tuesday 19 Aban 1405 (10 November 2026) in Tehran. */
const AT = "2026-11-10T06:00:00Z";
const STYLES: DateStyle[] = ["day", "weekday", "heading", "short", "long", "dayTime", "time", "clock"];

test("a congress day reads «سه‌شنبه ۱۹ آبان ۱۴۰۵» in natural order", () => {
  assert.equal(formatDate(AT, "day", "fa", TEHRAN), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(formatEventDate(AT, "fa", { timeZone: TEHRAN, style: "day" }), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(formatDate(AT, "day", "en", TEHRAN), "Tue, Nov 10, 2026");
});

test("each style in both languages", () => {
  const expected: Record<DateStyle, [string, string]> = {
    day: ["سه‌شنبه ۱۹ آبان ۱۴۰۵", "Tue, Nov 10, 2026"],
    weekday: ["سه‌شنبه ۱۹ آبان", "Tue, Nov 10"],
    heading: ["سه‌شنبه ۱۹ آبان", "Tuesday 10 November"],
    short: ["۱۹ آبان", "10 Nov"],
    long: ["۱۹ آبان ۱۴۰۵", "10 November 2026"],
    dayTime: ["سه‌شنبه ۱۹ آبان، ۰۹:۳۰", "Tue 10 Nov, 09:30"],
    time: ["۰۹:۳۰", "09:30"],
    clock: ["۰۹:۳۰:۰۰", "09:30:00"],
  };
  for (const style of STYLES) {
    assert.equal(formatDate(AT, style, "fa", TEHRAN), expected[style][0], style);
    assert.equal(formatDate(AT, style, "en", TEHRAN), expected[style][1], style);
  }
});

test("dates and times are on the congress's clock", () => {
  // 20:30 UTC on 9 November is midnight on 10 November in Tehran.
  const midnight = "2026-11-09T20:30:00Z";
  assert.equal(formatDate(midnight, "day", "fa", TEHRAN), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(formatDate(midnight, "day", "fa", "UTC"), "دوشنبه ۱۸ آبان ۱۴۰۵");
  assert.equal(formatTime(midnight, "fa", TEHRAN), "۰۰:۰۰");
  assert.equal(formatTime(midnight, "en", "UTC"), "20:30");
  assert.equal(formatTime("2027-07-01T10:00:00Z", "en", "Europe/Berlin"), "12:00");
  assert.equal(formatTime("2027-01-01T10:00:00Z", "en", "Europe/Berlin"), "11:00");
});

test("a missing or unknown zone falls back to the reader's own", () => {
  for (const zone of [undefined, null, "", "Not/AZone"]) {
    assert.equal(formatDate(AT, "dayTime", "fa", zone), formatDate(AT, "dayTime", "fa", Intl.DateTimeFormat().resolvedOptions().timeZone));
  }
});

test("Persian clocks use Persian digits", () => {
  assert.equal(formatClock("2026-11-10T05:04:26Z", "fa", TEHRAN), "۰۸:۳۴:۲۶");
  assert.equal(formatClock("2026-11-10T05:04:26Z", "en", TEHRAN), "08:34:26");
});

test("no Latin comma and no Latin digit in any Persian output", () => {
  const instants = ["2026-11-10T06:00:00Z", "2025-03-20T20:29:59Z", "2027-01-01T00:00:00Z", Date.UTC(2026, 5, 1, 12)];
  const outputs: string[] = [];
  for (const at of instants) {
    for (const style of STYLES) for (const zone of [TEHRAN, "UTC", "America/New_York"]) outputs.push(formatDate(at, style, "fa", zone));
  }
  outputs.push(
    formatDateRange("2026-11-10T06:00:00Z", "2026-11-12T06:00:00Z", "fa", TEHRAN),
    formatDateRange("2026-11-10T06:00:00Z", "2027-03-25T06:00:00Z", "fa", TEHRAN),
    formatNumber(1234567.5, "fa"),
    formatNumber(-42, "fa"),
    formatPercent(0.43, "fa"),
    formatPercent(0.4256, "fa", 1),
    formatLocalizedNumber(5000, "fa"),
    formatMobile("09123456789", "fa"),
    timeZoneLabel(TEHRAN, "fa"),
  );
  for (const text of outputs) {
    assert.doesNotMatch(text, /,/, text);
    assert.doesNotMatch(text, /[0-9]/, text);
  }
});

test("ranges", () => {
  assert.equal(formatDateRange("2026-11-10T06:00:00Z", "2026-11-12T06:00:00Z", "fa", TEHRAN), "۱۹ تا ۲۱ آبان ۱۴۰۵");
  assert.match(formatDateRange("2026-11-10T06:00:00Z", "2026-11-12T06:00:00Z", "en", TEHRAN), /^10\D+12 November 2026$/);
  assert.equal(formatDateRange(AT, AT, "fa", TEHRAN), "۱۹ آبان ۱۴۰۵");
  assert.equal(formatDateRange("soon", AT, "en", TEHRAN), `soon – ${AT}`);
});

test("numbers and percentages", () => {
  assert.equal(formatNumber(5000, "fa"), "۵٬۰۰۰");
  assert.equal(formatNumber(0.5, "fa"), "۰٫۵");
  assert.equal(formatNumber(5000, "en"), "5,000");
  assert.equal(formatNumber(7, "fa", { minimumIntegerDigits: 2 }), "۰۷");
  assert.equal(formatPercent(0.43, "fa"), "۴۳٪");
  assert.equal(formatPercent(0.4256, "fa", 1), "۴۲٫۶٪");
  assert.equal(formatPercent(0.43, "en"), "43%");
});

test("mobile numbers and zone names", () => {
  assert.equal(formatMobile("09123456789", "fa"), "۰۹۱۲ ۳۴۵ ۶۷۸۹");
  assert.equal(formatMobile("09123456789", "en"), "0912 345 6789");
  assert.equal(timeZoneLabel(TEHRAN, "fa"), "وقت تهران");
});

test("the older helpers give the same text as lib/format", () => {
  assert.equal(formatLocalizedDate(AT, "fa", TEHRAN), formatDate(AT, "day", "fa", TEHRAN));
  assert.equal(formatLocalizedNumber(12345, "fa"), formatNumber(12345, "fa"));
  assert.equal(formatPassIssuedDate(AT, "fa", TEHRAN), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(formatPassDateRange(AT, "2026-11-12T06:00:00Z", "fa", TEHRAN), "۱۹ تا ۲۱ آبان ۱۴۰۵");
  assert.equal(formatHour(AT, TEHRAN, "fa"), "۰۹:۳۰");
  assert.equal(formatDay("2026-11-10", "fa"), "سه‌شنبه ۱۹ آبان");
  // The organizer's program day headings (org H3): no reversed order, no Latin comma.
  const session = sessionDateFormats("fa", TEHRAN);
  assert.equal(session.day.format(new Date(AT)), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(session.shortDay.format(new Date(AT)), "۱۹ آبان");
  assert.equal(session.time.format(new Date(AT)), "۰۹:۳۰");
});
