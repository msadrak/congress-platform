import test from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseSessionCsv, parseSessionDateTime, sessionCsvTemplate, zonedWallTimeToIso } from "../src/lib/sessionCsv.ts";

const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();

test("Excel CSV UTF-8: BOM, CRLF, Persian headers in any order, quoted commas, line breaks and quotes", () => {
  const csv =
    "\uFEFFپایان,عنوان,سخنرانان,Notes ,سالن,شروع,Extra\r\n" +
    '2026-11-02 10:00,"افتتاحیه، خوش‌آمد","دکتر الف، دکتر ب","خط اول\r\nخط دوم با ""نقل‌قول""",Main hall,۲۰۲۶-۱۱-۰۲ ۰۹:۰۰,x\r\n' +
    "\r\n" +
    ",,,,,,\r\n";
  const result = parseSessionCsv(csv);
  assert.ok(result.ok);
  assert.deepEqual(result.ignoredColumns, ["Extra"]);
  assert.equal(result.rows.length, 1);
  const [row] = result.rows;
  assert.deepEqual(row.problems, []);
  assert.deepEqual(row.session, {
    title: "افتتاحیه، خوش‌آمد",
    track: "",
    hall: "Main hall",
    speakers: "دکتر الف، دکتر ب",
    description: 'خط اول\nخط دوم با "نقل‌قول"',
    starts_at: local(2026, 11, 2, 9, 0),
    ends_at: local(2026, 11, 2, 10, 0),
  });
});

test("the template round-trips through the parser", () => {
  const result = parseSessionCsv(sessionCsvTemplate("fa", "2026-11-02"));
  assert.ok(result.ok);
  assert.deepEqual(result.ignoredColumns, []);
  assert.deepEqual(result.rows.map((r) => r.session?.hall), ["سالن اصلی", "سالن ۲"]);
});

test("semicolon-separated files (European Excel) are detected from the header", () => {
  const result = parseSessionCsv("Title;Track;Start;End\nKeynote;Seminar;2026-11-02T09:00:00+03:30;2026-11-02T10:00Z\n");
  assert.ok(result.ok);
  assert.equal(result.rows[0].session?.track, "Seminar");
  assert.equal(result.rows[0].session?.starts_at, "2026-11-02T05:30:00.000Z");
  assert.equal(result.rows[0].session?.ends_at, "2026-11-02T10:00:00.000Z");
});

test("missing required columns are named before any row is read", () => {
  assert.deepEqual(parseSessionCsv("Title,Hall,Start\nA,B,2026-11-02 09:00\n"), { ok: false, error: "missing_columns", missing: ["ends_at"] });
  assert.deepEqual(parseSessionCsv("title,starts_at,ends_at\r\n"), { ok: false, error: "no_rows" });
  assert.deepEqual(parseSessionCsv('title,starts_at,ends_at\nA,"2026-11-02 09:00,2026-11-02 10:00\n'), { ok: false, error: "unterminated_quote", line: 2 });
});

test("invalid, equal and reversed dates are reported per row; rows keep the API's numbering and the file line", () => {
  const csv = [
    "title,starts_at,ends_at",
    "Fine,2026-11-02 09:00,2026-11-02 09:30",
    "",
    "Bad day,2026-02-30 09:00,2026-03-01 10:00",
    "Bad Jalali day,1404/12/30 09:00,1405/01/01 10:00",
    "Reversed,2026-11-02 11:00,2026-11-02 10:00",
    "Zero length,2026-11-02 11:00,2026-11-02 11:00",
    ",11/02/2026 9:00,",
    "Ancient,1000-01-01 09:00,13/01/2026 10:00",
  ].join("\n");
  const result = parseSessionCsv(csv);
  assert.ok(result.ok);
  assert.deepEqual(
    result.rows.map((r) => [r.row, r.line, r.problems]),
    [
      [1, 2, []],
      [2, 4, [{ code: "invalid_date", field: "starts_at" }]],
      [3, 5, [{ code: "invalid_date", field: "starts_at" }]],
      [4, 6, [{ code: "ends_before_start" }]],
      [5, 7, [{ code: "ends_before_start" }]],
      [6, 8, [{ code: "required", field: "title" }, { code: "required", field: "ends_at" }]],
      [7, 9, [{ code: "invalid_date", field: "starts_at" }, { code: "invalid_date", field: "ends_at" }]],
    ],
  );
  assert.equal(result.rows[1].session, null);
});

test("times are read in the event time zone, whatever the browser's zone", () => {
  const csv = "title,starts_at,ends_at\nKeynote,2026-11-02 09:00,2026-11-02 10:30\nLate,2026-11-02T09:00:00Z,2026-11-02 23:59\n";
  const result = parseSessionCsv(csv, { timeZone: "Asia/Tehran" });
  assert.ok(result.ok);
  // Iran keeps +03:30 all year since 2022.
  assert.equal(result.rows[0].session?.starts_at, "2026-11-02T05:30:00.000Z");
  assert.equal(result.rows[0].session?.ends_at, "2026-11-02T07:00:00.000Z");
  // An explicit offset wins over the event zone.
  assert.equal(result.rows[1].session?.starts_at, "2026-11-02T09:00:00.000Z");
  assert.equal(result.rows[1].session?.ends_at, "2026-11-02T20:29:00.000Z");

  const berlin = parseSessionCsv("title,starts_at,ends_at\nSummer,2026-07-01 09:00,2026-07-01 10:00\nWinter,2026-12-01 09:00,2026-12-01 10:00\n", {
    timeZone: "Europe/Berlin",
  });
  assert.ok(berlin.ok);
  assert.equal(berlin.rows[0].session?.starts_at, "2026-07-01T07:00:00.000Z");
  assert.equal(berlin.rows[1].session?.starts_at, "2026-12-01T08:00:00.000Z");
});

test("Excel's M/D/YYYY H:MM display format, with optional seconds and AM/PM", () => {
  const tz = { timeZone: "Asia/Tehran" };
  const at = (cell: string) => parseSessionDateTime(cell, tz.timeZone);
  assert.deepEqual(at("11/2/2026 9:00"), { iso: "2026-11-02T05:30:00.000Z" });
  assert.deepEqual(at("11/02/2026 09:00:30"), { iso: "2026-11-02T05:30:30.000Z" });
  assert.deepEqual(at("11/2/2026 1:15 PM"), { iso: "2026-11-02T09:45:00.000Z" });
  assert.deepEqual(at("11/2/2026 12:00 am"), { iso: "2026-11-01T20:30:00.000Z" });
  assert.deepEqual(at("11/2/2026 12:00 P.M."), { iso: "2026-11-02T08:30:00.000Z" });
  assert.deepEqual(at("11/2/2026 13:00 PM"), { error: "invalid_date" });
  assert.deepEqual(at("2/30/2026 9:00"), { error: "invalid_date" });
  assert.deepEqual(at("۱۱/۲/۲۰۲۶ ۹:۰۰"), { iso: "2026-11-02T05:30:00.000Z" });
});

test("Solar Hijri (Jalali) dates convert to the Gregorian day in the event zone", () => {
  const result = parseSessionCsv("عنوان,شروع,پایان\nافتتاحیه,۱۴۰۵/۰۸/۰۱ ۰۹:۰۰,1405-08-01 10:00\nپایانی,1405.8.11 17:00,1405/08/11 18:00\n", {
    timeZone: "Asia/Tehran",
  });
  assert.ok(result.ok);
  assert.deepEqual(result.rows[0].problems, []);
  // 1 Aban 1405 is 23 October 2026.
  assert.equal(result.rows[0].session?.starts_at, "2026-10-23T05:30:00.000Z");
  assert.equal(result.rows[0].session?.ends_at, "2026-10-23T06:30:00.000Z");
  assert.equal(result.rows[1].session?.starts_at, "2026-11-02T13:30:00.000Z");
  // Esfand 30 exists only in leap years: 1403 is one, 1404 is not.
  assert.ok("iso" in parseSessionDateTime("1403/12/30 09:00", "Asia/Tehran"));
  assert.deepEqual(parseSessionDateTime("1404/12/30 09:00", "Asia/Tehran"), { error: "invalid_date" });
  assert.deepEqual(parseSessionDateTime("1405/07/31 09:00", "Asia/Tehran"), { error: "invalid_date" });
});

test("delimiter sniffing ignores separators inside quoted header cells", () => {
  assert.equal(detectDelimiter('"Title, full";Start;End\n'), ";");
  assert.equal(detectDelimiter('"Title; long",Start,End\n'), ",");
  assert.equal(detectDelimiter('"Title\n;;;;",Start,End\n'), ",");
  assert.equal(detectDelimiter('"He said ""a,b,c""";Start;End'), ";");
  assert.equal(detectDelimiter("Title\tStart\tEnd\n"), "\t");
  assert.equal(detectDelimiter("Title\n"), ",");

  const result = parseSessionCsv('"Title";"Start (local, Tehran)";End\n"Keynote; opening";2026-11-02 09:00;2026-11-02 10:00\n', {
    timeZone: "Asia/Tehran",
  });
  assert.ok(result.ok);
  assert.equal(result.rows[0].values.title, "Keynote; opening");
  assert.equal(result.rows[0].session?.starts_at, "2026-11-02T05:30:00.000Z");
});

test("zonedWallTimeToIso around daylight-saving changes", () => {
  // Berlin: 2026-03-29 02:30 does not exist (clocks jump 02:00 → 03:00): read with the winter offset.
  // 2026-10-25 02:30 happens twice: the earlier (summer-time) instant wins.
  assert.equal(zonedWallTimeToIso("Europe/Berlin", 2026, 3, 29, 2, 30), "2026-03-29T01:30:00.000Z");
  assert.equal(zonedWallTimeToIso("Europe/Berlin", 2026, 10, 25, 2, 30), "2026-10-25T00:30:00.000Z");
  assert.equal(zonedWallTimeToIso("UTC", 2026, 1, 1, 0, 0), "2026-01-01T00:00:00.000Z");
});
