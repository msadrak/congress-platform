/**
 * Timetable (program) CSV for the organizer's bulk session import. Parsed in the browser so the
 * organizer sees every row and its problems before anything is sent; the API re-validates and
 * imports all-or-nothing. Pure: no DOM, no React.
 *
 * Format: one header row (case-insensitive; English or Persian names, any order), then one
 * session per row. Cells may be quoted (RFC 4180: commas, line breaks and `""` inside quotes).
 * A UTF-8 BOM and CRLF line endings (Excel's "CSV UTF-8") are accepted; `;` or tab separators are
 * detected from the header row (separators inside quoted header cells do not count).
 *
 * Dates, read as wall-clock times in the event's time zone (or the browser's when none is given):
 * - `YYYY-MM-DD HH:MM` (also `/` or `.` between the parts, optional seconds);
 * - Solar Hijri (Jalali) dates in the same shape, such as `1405/08/11 09:00`;
 * - Excel's US display format `M/D/YYYY H:MM`, optionally with seconds and `AM`/`PM`;
 * - ISO-8601 with an offset (`2026-11-02T09:00:00+03:30`), which keeps its own offset.
 * Persian/Arabic digits are accepted.
 */

import { zonedWallTimeToIso } from "./format.ts";
import { isValidJalali, jalaliToGregorian } from "./jalali.ts";

/** Moved to `lib/format.ts`; re-exported for the existing callers. */
export { zonedWallTimeToIso };

export const SESSION_CSV_FIELDS = ["title", "track", "hall", "speakers", "description", "starts_at", "ends_at"] as const;
export type SessionCsvField = (typeof SESSION_CSV_FIELDS)[number];

export const REQUIRED_SESSION_CSV_FIELDS: readonly SessionCsvField[] = ["title", "starts_at", "ends_at"];

/** The API accepts at most this many sessions per import. */
export const MAX_SESSION_IMPORT_ROWS = 500;

/** Character limits of the API's session fields. */
export const SESSION_FIELD_LIMITS = { title: 200, track: 80, hall: 120, speakers: 300, description: 4000 } as const;
type LimitedField = keyof typeof SESSION_FIELD_LIMITS;
type DateField = "starts_at" | "ends_at";

/** One session as the import endpoint expects it (`EventSessionImportRow`). */
export interface SessionImportRow {
  title: string;
  track: string;
  hall: string;
  speakers: string;
  description: string;
  starts_at: string;
  ends_at: string;
}

export type SessionRowProblem =
  | { code: "required"; field: "title" | DateField }
  | { code: "too_long"; field: LimitedField; max: number }
  | { code: "invalid_date"; field: DateField }
  /** The session ends before, or at the same moment as, it starts. */
  | { code: "ends_before_start" };

export interface SessionCsvOptions {
  /** IANA zone the wall-clock times are in (the event's, e.g. `Asia/Tehran`); the browser's when omitted. */
  timeZone?: string;
}

export interface ParsedSessionRow {
  /** 1-based position among the data rows: the number the API uses in "Row N: …" errors. */
  row: number;
  /** Line of the file where this record starts (the header is line 1). */
  line: number;
  /** Trimmed cell text as written in the file. */
  values: Record<SessionCsvField, string>;
  /** The row ready to send, or null when it has problems. */
  session: SessionImportRow | null;
  problems: SessionRowProblem[];
}

export type SessionCsvResult =
  | { ok: true; rows: ParsedSessionRow[]; ignoredColumns: string[] }
  | { ok: false; error: "no_rows" }
  | { ok: false; error: "missing_columns"; missing: SessionCsvField[] }
  | { ok: false; error: "too_many_rows"; count: number; max: number }
  | { ok: false; error: "unterminated_quote"; line: number };

const HEADER_ALIASES: Record<SessionCsvField, readonly string[]> = {
  title: ["title", "session", "session title", "name", "topic", "عنوان", "موضوع", "عنوان جلسه", "نام جلسه", "عنوان برنامه"],
  track: ["track", "category", "type", "session type", "نوع", "نوع برنامه", "نوع جلسه", "دسته", "دسته‌بندی", "محور", "ترک"],
  hall: ["hall", "room", "venue", "location", "سالن", "محل", "مکان", "محل برگزاری", "اتاق"],
  speakers: ["speakers", "speaker", "presenter", "presenters", "سخنران", "سخنرانان", "ارائه‌دهنده", "ارائه‌دهندگان", "مدرس"],
  description: ["description", "details", "abstract", "notes", "توضیحات", "شرح", "خلاصه"],
  starts_at: ["starts_at", "start", "starts", "start time", "start at", "begin", "from", "شروع", "زمان شروع", "آغاز", "زمان آغاز", "از"],
  ends_at: ["ends_at", "end", "ends", "end time", "end at", "finish", "to", "پایان", "زمان پایان", "تا"],
};

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits to ASCII. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function normalizeHeader(value: string): string {
  return toLatinDigits(value)
    .normalize("NFC")
    .replace(/\(.*?\)/g, "")
    .replace(/[\u200c\u200e\u200f*]/g, " ")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .trim();
}

const FIELD_BY_HEADER = new Map<string, SessionCsvField>(
  SESSION_CSV_FIELDS.flatMap((field) => HEADER_ALIASES[field].map((alias) => [normalizeHeader(alias), field] as const)),
);

interface CsvRecord {
  line: number;
  cells: string[];
}

const DELIMITERS = [",", ";", "\t"] as const;

/**
 * The separator used by the header row: `,` unless `;` or tab clearly is. Quote-aware: a `,` inside a
 * quoted header cell (`"Start, local";End`) is not a separator, and a quoted cell may span lines.
 */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      // `""` inside quotes is an escaped quote and leaves the state unchanged.
      if (quoted && text[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      break;
    } else if (!quoted && ch in counts) {
      counts[ch] += 1;
    }
  }
  let best = ",";
  for (const candidate of DELIMITERS) if (counts[candidate] > counts[best]) best = candidate;
  return best;
}

/** RFC 4180 records. Returns the line of an opening quote that is never closed. */
function readRecords(text: string, delimiter: string): { records: CsvRecord[] } | { unterminatedAt: number } {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        cell += "\n";
        line += 1;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    // A quote opens a quoted field only at its start (spaces before it are dropped).
    if (ch === '"' && !fieldWasQuoted && cell.trim() === "") {
      quoted = true;
      fieldWasQuoted = true;
      quoteLine = line;
      cell = "";
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      cells.push(cell);
      cell = "";
      fieldWasQuoted = false;
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = "";
      fieldWasQuoted = false;
      line += 1;
      recordLine = line;
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (quoted) return { unterminatedAt: quoteLine };
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  return { records };
}

const YEAR_FIRST = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const EXCEL_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP])\.?M\.?)?$/i;
const ZONED_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
/** Solar Hijri years a congress timetable can use (1300 AP is 1921). */
const JALALI_YEARS = { min: 1300, max: 1499 };

function validParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  // Day 0 of the next month is the last day of this month.
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * ISO-8601 instant for a timetable cell. Wall-clock times are read in `timeZone` (the event's), or in the
 * browser's zone when it is omitted; ISO cells with an offset keep their own.
 */
export function parseSessionDateTime(raw: string, timeZone?: string): { iso: string } | { error: "invalid_date" } {
  const invalid = { error: "invalid_date" } as const;
  const value = toLatinDigits(raw).trim();

  const zoned = ZONED_DATE_TIME.exec(value);
  if (zoned) {
    const [year, month, day, hour, minute] = zoned.slice(1, 6).map(Number);
    const second = zoned[6] ? Number(zoned[6]) : 0;
    if (!validParts(year, month, day, hour, minute, second)) return invalid;
    const offset = zoned[7].toUpperCase() === "Z" ? "Z" : zoned[7].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
    const ms = Date.parse(`${zoned[1]}-${zoned[2]}-${zoned[3]}T${zoned[4]}:${zoned[5]}:${String(second).padStart(2, "0")}${offset}`);
    return Number.isNaN(ms) ? invalid : { iso: new Date(ms).toISOString() };
  }

  let year: number, month: number, day: number, hour: number, minute: number, second: number;
  const yearFirst = YEAR_FIRST.exec(value);
  const excel = yearFirst ? null : EXCEL_US.exec(value);
  if (yearFirst) {
    [year, month, day, hour, minute] = yearFirst.slice(1, 6).map(Number);
    second = yearFirst[6] ? Number(yearFirst[6]) : 0;
    if (year >= JALALI_YEARS.min && year <= JALALI_YEARS.max) {
      if (!isValidJalali(year, month, day)) return invalid;
      [year, month, day] = jalaliToGregorian(year, month, day);
    }
  } else if (excel) {
    [month, day, year, hour, minute] = excel.slice(1, 6).map(Number);
    second = excel[6] ? Number(excel[6]) : 0;
    const meridiem = excel[7]?.toUpperCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return invalid;
      hour = (hour % 12) + (meridiem === "P" ? 12 : 0);
    }
  } else {
    return invalid;
  }
  if (year < 1700 || !validParts(year, month, day, hour, minute, second)) return invalid;
  if (timeZone) return { iso: zonedWallTimeToIso(timeZone, year, month, day, hour, minute, second) };
  return { iso: new Date(year, month - 1, day, hour, minute, second).toISOString() };
}

function validateRow(
  values: Record<SessionCsvField, string>,
  timeZone: string | undefined,
): { session: SessionImportRow | null; problems: SessionRowProblem[] } {
  const problems: SessionRowProblem[] = [];
  if (!values.title) problems.push({ code: "required", field: "title" });
  for (const field of Object.keys(SESSION_FIELD_LIMITS) as LimitedField[]) {
    const max = SESSION_FIELD_LIMITS[field];
    // Code points, as the API counts them.
    if (Array.from(values[field]).length > max) problems.push({ code: "too_long", field, max });
  }
  const instants: Partial<Record<DateField, string>> = {};
  for (const field of ["starts_at", "ends_at"] as const) {
    if (!values[field]) {
      problems.push({ code: "required", field });
      continue;
    }
    const parsed = parseSessionDateTime(values[field], timeZone);
    if ("iso" in parsed) instants[field] = parsed.iso;
    else problems.push({ code: parsed.error, field });
  }
  if (instants.starts_at && instants.ends_at && Date.parse(instants.ends_at) <= Date.parse(instants.starts_at)) {
    problems.push({ code: "ends_before_start" });
  }
  if (problems.length > 0 || !instants.starts_at || !instants.ends_at) return { session: null, problems };
  return {
    session: {
      title: values.title,
      track: values.track,
      hall: values.hall,
      speakers: values.speakers,
      description: values.description,
      starts_at: instants.starts_at,
      ends_at: instants.ends_at,
    },
    problems,
  };
}

export function parseSessionCsv(input: string, options: SessionCsvOptions = {}): SessionCsvResult {
  const text = input.replace(/^\uFEFF/, "");
  const read = readRecords(text, detectDelimiter(text));
  if ("unterminatedAt" in read) return { ok: false, error: "unterminated_quote", line: read.unterminatedAt };
  const records = read.records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const header = records.shift();
  if (!header) return { ok: false, error: "no_rows" };

  const columns = new Map<SessionCsvField, number>();
  const ignoredColumns: string[] = [];
  header.cells.forEach((name, index) => {
    const field = FIELD_BY_HEADER.get(normalizeHeader(name));
    if (field && !columns.has(field)) columns.set(field, index);
    else if (name.trim()) ignoredColumns.push(name.trim());
  });
  const missing = REQUIRED_SESSION_CSV_FIELDS.filter((field) => !columns.has(field));
  if (missing.length > 0) return { ok: false, error: "missing_columns", missing };
  if (records.length === 0) return { ok: false, error: "no_rows" };
  if (records.length > MAX_SESSION_IMPORT_ROWS) {
    return { ok: false, error: "too_many_rows", count: records.length, max: MAX_SESSION_IMPORT_ROWS };
  }

  const rows = records.map((record, index): ParsedSessionRow => {
    const cell = (field: SessionCsvField) => {
      const column = columns.get(field);
      return column === undefined ? "" : (record.cells[column] ?? "").trim();
    };
    const values: Record<SessionCsvField, string> = {
      title: cell("title"),
      track: cell("track"),
      hall: cell("hall"),
      speakers: cell("speakers"),
      description: cell("description"),
      starts_at: cell("starts_at"),
      ends_at: cell("ends_at"),
    };
    return { row: index + 1, line: record.line, values, ...validateRow(values, options.timeZone) };
  });
  return { ok: true, rows, ignoredColumns };
}

/** Quotes a cell only when it holds a separator, quote or line break (RFC 4180). */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * A ready-to-fill template: canonical header and two example sessions on `day` (YYYY-MM-DD).
 * Starts with a BOM so Excel opens the Persian text as UTF-8.
 */
export function sessionCsvTemplate(locale: "fa" | "en", day: string): string {
  const examples: string[][] =
    locale === "fa"
      ? [
          ["مراسم افتتاحیه", "سخنرانی", "سالن اصلی", "دکتر سارا احمدی، دکتر علی رضایی", "خوش‌آمدگویی و معرفی برنامهٔ همایش", `${day} 09:00`, `${day} 10:00`],
          ["کارگاه تصویربرداری پزشکی", "کارگاه", "سالن ۲", "دکتر مریم کریمی", "", `${day} 10:30`, `${day} 12:30`],
        ]
      : [
          ["Opening ceremony", "Keynote", "Main hall", "Dr. Sara Ahmadi, Dr. Ali Rezaei", "Welcome and programme overview", `${day} 09:00`, `${day} 10:00`],
          ["Medical imaging workshop", "Workshop", "Hall 2", "Dr. Maryam Karimi", "", `${day} 10:30`, `${day} 12:30`],
        ];
  return `\uFEFF${[[...SESSION_CSV_FIELDS], ...examples].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
