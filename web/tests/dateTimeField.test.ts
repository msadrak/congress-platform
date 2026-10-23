import { before, test } from "node:test";
import { register } from "node:module";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fromZonedDateTimeLocal, toZonedDateTimeLocal } from "../src/components/organizer/sessionTime.ts";
import type { DateFieldProps } from "../src/components/ui/DateTimeField.tsx";
import { dateDraft, describeWallValue, draftValue, formatWallValue, monthLength, parseTimeOfDay } from "../src/lib/format.ts";

const TEHRAN = "Asia/Tehran";
const BERLIN = "Europe/Berlin";

test("«۱۹ آبان ۱۴۰۵ ۰۸:۳۰» round-trips with 2026-11-10T08:30", () => {
  assert.deepEqual(dateDraft("2026-11-10T08:30", "fa"), { year: "1405", month: 8, day: 19, time: "08:30" });
  assert.equal(formatWallValue("2026-11-10T08:30", "fa"), "۱۹ آبان ۱۴۰۵ ۰۸:۳۰");
  // As typed: Persian digits in the year and the time.
  assert.equal(draftValue({ year: "۱۴۰۵", month: 8, day: 19, time: "۰۸:۳۰" }, "fa", true), "2026-11-10T08:30");
  assert.equal(draftValue(dateDraft("2026-11-10T08:30", "fa"), "fa", true), "2026-11-10T08:30");
  // The instant is the congress's 08:30, wherever the organizer is.
  assert.equal(fromZonedDateTimeLocal("2026-11-10T08:30", TEHRAN), "2026-11-10T05:00:00.000Z");
  assert.equal(toZonedDateTimeLocal("2026-11-10T05:00:00.000Z", TEHRAN), "2026-11-10T08:30");
});

test("English uses the Gregorian calendar", () => {
  assert.deepEqual(dateDraft("2026-11-10T08:30", "en"), { year: "2026", month: 11, day: 10, time: "08:30" });
  assert.equal(formatWallValue("2026-11-10T08:30", "en"), "10 November 2026 08:30");
  assert.equal(draftValue({ year: "2024", month: 2, day: 29, time: "" }, "en", false), "2024-02-29");
  assert.equal(draftValue({ year: "2023", month: 2, day: 29, time: "" }, "en", false), "");
});

test("Esfand has 30 days only in a leap year", () => {
  assert.equal(monthLength(1403, 12, "fa"), 30);
  assert.equal(monthLength(1404, 12, "fa"), 29);
  assert.equal(draftValue({ year: "1403", month: 12, day: 30, time: "23:59" }, "fa", true), "2025-03-20T23:59");
  assert.deepEqual(dateDraft("2025-03-20T23:59", "fa"), { year: "1403", month: 12, day: 30, time: "23:59" });
  assert.equal(draftValue({ year: "1404", month: 1, day: 1, time: "00:00" }, "fa", true), "2025-03-21T00:00");
  assert.equal(draftValue({ year: "1404", month: 12, day: 30, time: "08:00" }, "fa", true), "");
  assert.equal(draftValue({ year: "1404", month: 12, day: 29, time: "08:00" }, "fa", true), "2026-03-20T08:00");
  assert.equal(draftValue({ year: "1405", month: 1, day: 1, time: "08:00" }, "fa", true), "2026-03-21T08:00");
  // Every day across the year boundaries survives the trip through the Jalali draft.
  for (let day = Date.UTC(2025, 2, 10); day <= Date.UTC(2026, 2, 31); day += 86_400_000) {
    const value = `${new Date(day).toISOString().slice(0, 10)}T12:00`;
    assert.equal(draftValue(dateDraft(value, "fa"), "fa", true), value);
  }
});

test("incomplete or impossible entries are empty, as a native input reports them", () => {
  assert.equal(draftValue({ year: "140", month: 8, day: 19, time: "08:30" }, "fa", true), "");
  assert.equal(draftValue({ year: "1405", month: 0, day: 19, time: "08:30" }, "fa", true), "");
  assert.equal(draftValue({ year: "1405", month: 8, day: 19, time: "" }, "fa", true), "");
  assert.equal(draftValue({ year: "1405", month: 8, day: 19, time: "" }, "fa", false), "2026-11-10");
  assert.equal(draftValue({ year: "1405", month: 7, day: 31, time: "08:30" }, "fa", true), "");
  assert.deepEqual(dateDraft("", "fa"), { year: "", month: 0, day: 0, time: "" });
  assert.deepEqual(dateDraft("2026-02-30T08:00", "en"), { year: "", month: 0, day: 0, time: "" });
});

test("times are 24 h and accept both digit sets", () => {
  assert.equal(parseTimeOfDay("۸:۳۰"), "08:30");
  assert.equal(parseTimeOfDay("0830"), "08:30");
  assert.equal(parseTimeOfDay("23:59"), "23:59");
  assert.equal(parseTimeOfDay("24:00"), null);
  assert.equal(parseTimeOfDay("8:60"), null);
  assert.equal(parseTimeOfDay(""), null);
});

test("a zone without daylight saving and one with it", () => {
  // Tehran has kept +03:30 all year since 2022: every wall time exists exactly once.
  for (const value of ["2027-03-21T00:30", "2027-03-22T00:30", "2027-09-21T23:30", "2026-11-10T08:30"]) {
    assert.equal(toZonedDateTimeLocal(fromZonedDateTimeLocal(value, TEHRAN), TEHRAN), value);
  }
  // Berlin: ordinary times round-trip on both sides of the changes.
  for (const value of ["2027-03-27T02:30", "2027-03-28T01:30", "2027-03-28T03:30", "2027-10-31T03:30", "2026-11-10T08:30"]) {
    assert.equal(toZonedDateTimeLocal(fromZonedDateTimeLocal(value, BERLIN), BERLIN), value);
  }
  // 02:30 on 28 March 2027 never shows on Berlin's clocks: the read-out says what it becomes.
  assert.match(describeWallValue("2027-03-28T02:30", "en", BERLIN), /, 03:30 \(/);
  // 02:30 on 31 October 2027 shows twice: the first one is meant.
  assert.equal(fromZonedDateTimeLocal("2027-10-31T02:30", BERLIN), "2027-10-31T00:30:00.000Z");
  assert.match(describeWallValue("2027-10-31T02:30", "en", BERLIN), /, 02:30 \(/);
});

test("the read-out names the day, the time and the congress's zone", () => {
  assert.equal(describeWallValue("2026-11-10T08:30", "fa", TEHRAN), "سه‌شنبه ۱۹ آبان ۱۴۰۵، ساعت ۰۸:۳۰ (وقت تهران)");
  assert.equal(describeWallValue("2026-11-10T08:30", "en", TEHRAN), "Tue, Nov 10, 2026, 08:30 (Tehran time)");
  assert.equal(describeWallValue("2026-11-10", "fa"), "سه‌شنبه ۱۹ آبان ۱۴۰۵");
  assert.equal(describeWallValue("", "fa", TEHRAN), "");
});

renderChecks();

/** Render checks of the field itself (the .tsx compiles through tests/support/tsxLoader.mjs). */
function renderChecks() {
  let fields: { DateTimeField: FunctionComponent<DateFieldProps>; DateField: FunctionComponent<DateFieldProps> };

  before(async () => {
    register("./support/tsxLoader.mjs", import.meta.url);
    fields = (await import("../src/components/ui/DateTimeField.tsx")) as typeof fields;
  });

  const render = (component: FunctionComponent<DateFieldProps>, props: Omit<DateFieldProps, "onChange">) =>
    renderToStaticMarkup(createElement(component, { ...props, onChange: () => undefined }));

  test("fa: Jalali day, month and year, Persian digits, no native datetime picker", () => {
    const html = render(fields.DateTimeField, { label: "شروع", value: "2026-11-10T08:30", locale: "fa", timeZone: TEHRAN, required: true });
    assert.match(html, /<legend class="ui-label">شروع/);
    assert.match(html, /<option value="19" selected="">۱۹<\/option>/);
    assert.match(html, /<option value="8" selected="">آبان<\/option>/);
    assert.match(html, /aria-label="سال"[^>]*value="۱۴۰۵"/);
    assert.match(html, /aria-label="ساعت"[^>]*dir="ltr"[^>]*value="۰۸:۳۰"/);
    assert.match(html, /aria-required="true"/);
    assert.ok(html.includes("سه‌شنبه ۱۹ آبان ۱۴۰۵، ساعت ۰۸:۳۰ (وقت تهران)"));
    assert.doesNotMatch(html, /datetime-local|font-mono/);
    // Visible text and typed values: Persian digits only.
    assert.doesNotMatch(html.replace(/<[^>]*>/g, " "), /[0-9]/);
    assert.doesNotMatch((html.match(/ value="[^"]*"/g) ?? []).filter((v) => !/^ value="\d*"$/.test(v)).join(""), /[0-9]/);
  });

  test("en: Gregorian month names and Latin digits; errors are linked to every control", () => {
    const html = render(fields.DateTimeField, { label: "Starts", value: "2026-11-10T08:30", locale: "en", timeZone: TEHRAN, error: "Required" });
    assert.match(html, /<option value="11" selected="">November<\/option>/);
    assert.match(html, /aria-label="Year"[^>]*value="2026"/);
    assert.ok(html.includes("Tue, Nov 10, 2026, 08:30 (Tehran time)"));
    const errorId = /<p id="([^"]+)"[^>]*>Required<\/p>/.exec(html)?.[1];
    assert.ok(errorId);
    const controls = html.match(/<(select|input)\b[^>]*>/g) ?? [];
    assert.equal(controls.length, 4);
    for (const control of controls) {
      assert.match(control, /aria-invalid="true"/);
      assert.ok(control.includes(errorId), control);
    }
  });

  test("DateField has no time control", () => {
    const html = render(fields.DateField, { label: "روز", value: "2026-11-10", locale: "fa" });
    assert.equal((html.match(/<(select|input)\b/g) ?? []).length, 3);
    assert.ok(html.includes("سه‌شنبه ۱۹ آبان ۱۴۰۵"));
  });
}
