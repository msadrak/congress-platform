import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SERIES_HOURS,
  bucketSeries,
  formatClock,
  formatDay,
  formatHour,
  todayIn,
  type HourBucket,
} from "../src/lib/analyticsTime.ts";

// Fixed instants only; nothing here may depend on the machine's own time zone or clock.
const TEHRAN = "Asia/Tehran"; // +03:30, no daylight saving time
const bucket = (starts_at: string, count: number, rejected = 0): HourBucket => ({
  day: starts_at.slice(0, 10),
  hour: `${starts_at.slice(11, 13)}:00`,
  starts_at,
  count,
  admitted: count - rejected,
  rejected,
});

test("todayIn is the event's local date, which turns over at local midnight, not UTC's", () => {
  assert.equal(todayIn(TEHRAN, new Date("2027-04-10T20:15:00Z")), "2027-04-10"); // 23:45 in Tehran
  assert.equal(todayIn(TEHRAN, new Date("2027-04-10T20:45:00Z")), "2027-04-11"); // 00:15 in Tehran
  assert.equal(todayIn("UTC", Date.parse("2027-04-10T20:45:00Z")), "2027-04-10");
});

test("formatHour renders on the event's clock with the page's digits", () => {
  assert.equal(formatHour("2027-04-10T08:00:00+03:30", TEHRAN, "en"), "08:00");
  assert.equal(formatHour("2027-04-10T08:00:00+03:30", TEHRAN, "fa"), "۰۸:۰۰");
  // The same instant read in another zone: proof the zone argument, not the browser, decides.
  assert.equal(formatHour("2027-04-10T08:00:00+03:30", "UTC", "en"), "04:30");
  assert.equal(formatHour(Date.parse("2027-04-10T20:30:00Z"), TEHRAN, "en"), "00:00");
  assert.equal(formatHour("not a time", TEHRAN, "en"), "not a time");
});

test("formatClock shows seconds on the event's clock", () => {
  assert.equal(formatClock(new Date("2027-04-10T04:30:05Z"), TEHRAN, "en"), "08:00:05");
  assert.equal(formatClock(new Date("2027-04-10T04:30:05Z"), TEHRAN, "fa"), "۰۸:۰۰:۰۵");
});

test("formatDay uses the Solar Hijri calendar in Persian and the Gregorian one in English", () => {
  assert.equal(formatDay("2027-04-11", "en"), "Sun 11 Apr");
  assert.equal(formatDay("2027-04-11", "fa"), "یکشنبه ۲۲ فروردین");
  assert.equal(formatDay("bad", "en"), "bad");
});

test("bucketSeries fills the empty hours of a day with zero, in time order", () => {
  const series = bucketSeries(
    [bucket("2027-04-10T11:00:00+03:30", 4, 1), bucket("2027-04-10T08:00:00+03:30", 2)],
    TEHRAN,
  );
  assert.deepEqual(series.map((p) => [p.hour, p.count]), [["08:00", 2], ["09:00", 0], ["10:00", 0], ["11:00", 4]]);
  assert.equal(series[1].starts_at, "2027-04-10T09:00:00+03:30");
  assert.equal(series[1].at, Date.parse("2027-04-10T05:30:00Z"));
  assert.deepEqual([series[3].admitted, series[3].rejected], [3, 1]);
});

test("bucketSeries runs across local midnight into the next event day", () => {
  const series = bucketSeries(
    [bucket("2027-04-11T01:00:00+03:30", 3), bucket("2027-04-10T22:00:00+03:30", 2)],
    TEHRAN,
  );
  assert.deepEqual(
    series.map((p) => `${p.day} ${p.hour} ${p.count}`),
    ["2027-04-10 22:00 2", "2027-04-10 23:00 0", "2027-04-11 00:00 0", "2027-04-11 01:00 3"],
  );
  assert.equal(series[2].starts_at, "2027-04-11T00:00:00+03:30");
});

test("bucketSeries merges buckets of the same hour (several gates) without changing its input", () => {
  const input = [bucket("2027-04-10T08:00:00+03:30", 2, 1), bucket("2027-04-10T08:00:00+03:30", 5)];
  const series = bucketSeries(input, TEHRAN);
  assert.deepEqual(series.map((p) => [p.count, p.admitted, p.rejected]), [[7, 6, 1]]);
  assert.equal(input[0].count, 2);
});

test("bucketSeries leaves unreadable times and very long spans sparse", () => {
  const unreadable = [bucket("2027-04-10T08:00:00+03:30", 1), { ...bucket("2027-04-10T10:00:00+03:30", 1), starts_at: "" }];
  assert.equal(bucketSeries(unreadable, TEHRAN).length, 2);
  const longSpan = [bucket("2027-04-01T08:00:00+03:30", 1), bucket("2027-04-30T08:00:00+03:30", 1)];
  assert.ok((29 * 24 + 1) > MAX_SERIES_HOURS);
  assert.equal(bucketSeries(longSpan, TEHRAN).length, 2);
  assert.deepEqual(bucketSeries([], TEHRAN), []);
});
