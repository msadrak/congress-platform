import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionCsv, sessionCsvTemplate } from "../src/lib/sessionCsv.ts";

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

test("invalid, Jalali and reversed dates are reported per row; rows keep the API's numbering and the file line", () => {
  const csv = [
    "title,starts_at,ends_at",
    "Fine,2026-11-02 09:00,2026-11-02 09:00",
    "",
    "Bad day,2026-02-30 09:00,2026-03-01 10:00",
    "Jalali,1405/08/11 09:00,1405/08/11 10:00",
    "Reversed,2026-11-02 11:00,2026-11-02 10:00",
    ",11/02/2026 9:00,",
  ].join("\n");
  const result = parseSessionCsv(csv);
  assert.ok(result.ok);
  assert.deepEqual(
    result.rows.map((r) => [r.row, r.line, r.problems]),
    [
      [1, 2, []],
      [2, 4, [{ code: "invalid_date", field: "starts_at" }]],
      [3, 5, [{ code: "jalali_date", field: "starts_at" }, { code: "jalali_date", field: "ends_at" }]],
      [4, 6, [{ code: "ends_before_start" }]],
      [5, 7, [{ code: "required", field: "title" }, { code: "invalid_date", field: "starts_at" }, { code: "required", field: "ends_at" }]],
    ],
  );
  assert.equal(result.rows[1].session, null);
});
