import test from "node:test";
import assert from "node:assert/strict";
import {
  fromZonedDateTimeLocal,
  shiftDateTimeLocal,
  timeZoneOptions,
  toZonedDateTimeLocal,
  wallClockSpan,
} from "../src/components/organizer/sessionTime.ts";

test("an instant is shown on the event's clock, whatever the browser's zone", () => {
  // 07:00Z is 10:30 in Tehran (UTC+03:30), 09:00 in Berlin summer time and 03:00 in New York.
  assert.equal(toZonedDateTimeLocal("2099-05-10T07:00:00Z", "Asia/Tehran"), "2099-05-10T10:30");
  assert.equal(toZonedDateTimeLocal("2099-05-10T07:00:00Z", "UTC"), "2099-05-10T07:00");
  assert.equal(toZonedDateTimeLocal("2026-07-01T07:00:00Z", "Europe/Berlin"), "2026-07-01T09:00");
  // Midnight is 00, never 24; the day moves with the zone.
  assert.equal(toZonedDateTimeLocal("2099-05-09T20:30:00Z", "Asia/Tehran"), "2099-05-10T00:00");
  assert.equal(toZonedDateTimeLocal("not a date", "UTC"), "");
});

test("a wall time typed for the event is read in the event's zone", () => {
  assert.equal(fromZonedDateTimeLocal("2099-05-10T10:30", "Asia/Tehran"), "2099-05-10T07:00:00.000Z");
  assert.equal(fromZonedDateTimeLocal("2026-07-01T09:00", "Europe/Berlin"), "2026-07-01T07:00:00.000Z");
  assert.equal(fromZonedDateTimeLocal("2026-01-15T09:00", "Europe/Berlin"), "2026-01-15T08:00:00.000Z");
  // Round trip.
  const iso = "2099-05-12T15:00:00.000Z";
  assert.equal(fromZonedDateTimeLocal(toZonedDateTimeLocal(iso, "Asia/Tehran"), "Asia/Tehran"), iso);
});

test("blank or impossible wall times are refused rather than guessed", () => {
  assert.equal(fromZonedDateTimeLocal("", "Asia/Tehran"), "");
  assert.equal(fromZonedDateTimeLocal("2099-02-30T10:00", "Asia/Tehran"), "");
  assert.equal(fromZonedDateTimeLocal("2099-05-10T24:00", "Asia/Tehran"), "");
  assert.equal(fromZonedDateTimeLocal("2099-05-10", "Asia/Tehran"), "");
});

test("wall-clock spans and shifts keep a session's length across midnight and month ends", () => {
  assert.equal(wallClockSpan("2099-05-10T09:00", "2099-05-10T10:30"), 90 * 60_000);
  assert.ok(Number.isNaN(wallClockSpan("", "2099-05-10T10:30")));
  assert.equal(shiftDateTimeLocal("2099-05-10T23:30", 3_600_000), "2099-05-11T00:30");
  assert.equal(shiftDateTimeLocal("2099-05-31T23:00", 2 * 3_600_000), "2099-06-01T01:00");
  assert.equal(shiftDateTimeLocal("garbage", 1), "");
});

test("the zone select always offers the event's own zone", () => {
  assert.equal(timeZoneOptions("Asia/Tehran")[0], "Asia/Tehran");
  assert.deepEqual(timeZoneOptions("Asia/Tokyo").slice(0, 2), ["Asia/Tokyo", "Asia/Tehran"]);
  assert.equal(timeZoneOptions("Asia/Tokyo").filter((z) => z === "Asia/Tokyo").length, 1);
});
