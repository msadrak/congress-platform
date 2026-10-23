/**
 * Wall-clock helpers for the organizer screens. Event times (program sessions, the event's own dates, the
 * registration and tier sales windows) are shown and entered on the EVENT's clock (its IANA zone), never the
 * browser's: an organizer abroad still plans a Tehran congress in Tehran time.
 */
import { zonedWallTimeToIso } from "../../lib/sessionCsv.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** `datetime-local` value (YYYY-MM-DDTHH:MM, browser time) for an ISO instant; its first 10 characters are the day. */
export function toDateTimeLocal(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const wallFormatters: Record<string, Intl.DateTimeFormat> = {};

/** `datetime-local` value (YYYY-MM-DDTHH:MM) of an instant on the clocks of `timeZone`; "" when it is invalid. */
export function toZonedDateTimeLocal(iso: string | number, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  wallFormatters[timeZone] ??= new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of wallFormatters[timeZone].formatToParts(d)) parts[part.type] = part.value;
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${pad(Number(parts.hour) % 24)}:${parts.minute}`;
}

const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** The wall-clock parts of a `datetime-local` value, or null when it is blank or not a real date and time. */
function wallParts(value: string): [number, number, number, number, number] | null {
  const match = LOCAL_VALUE.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return [year, month, day, hour, minute];
}

/** The ISO instant at which the clocks of `timeZone` show this `datetime-local` value; "" when blank or invalid. */
export function fromZonedDateTimeLocal(value: string, timeZone: string): string {
  const parts = wallParts(value);
  return parts ? zonedWallTimeToIso(timeZone, ...parts) : "";
}

/** Milliseconds between two `datetime-local` values as wall-clock readings (NaN when either is invalid). */
export function wallClockSpan(from: string, to: string): number {
  const a = wallParts(from);
  const b = wallParts(to);
  if (!a || !b) return Number.NaN;
  return Date.UTC(b[0], b[1] - 1, b[2], b[3], b[4]) - Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4]);
}

/** A `datetime-local` value moved by `ms` of wall-clock time; "" when the value is invalid. */
export function shiftDateTimeLocal(value: string, ms: number): string {
  const parts = wallParts(value);
  if (!parts) return "";
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]) + ms);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Locale tags for session dates: the Persian calendar for fa, as elsewhere in the organizer console. `timeZone`
 * (IANA) formats in that zone instead of the browser's. */
export function sessionDateFormats(locale: "fa" | "en", timeZone?: string) {
  const tag = locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(tag, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }),
    shortDay: new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone }),
    time: new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }),
  };
}

/** Default IANA zone of a new event (`backend/app/routes/events.py` DEFAULT_TIMEZONE). */
export const DEFAULT_EVENT_TIMEZONE = "Asia/Tehran";

/** Zones the organizer console offers for a congress; the API accepts any IANA name. */
export const EVENT_TIMEZONES = [
  DEFAULT_EVENT_TIMEZONE,
  "Asia/Dubai",
  "Asia/Baghdad",
  "Asia/Kabul",
  "Asia/Baku",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "UTC",
] as const;

/** The zones to offer in a select that must show `current` (an event saved with a zone outside the list). */
export function timeZoneOptions(current: string): string[] {
  const zones: string[] = [...EVENT_TIMEZONES];
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

/** The event's IANA zone (the server's default for payloads that predate the field). */
export function eventTimeZone(event: object): string {
  return "timezone" in event && typeof event.timezone === "string" && event.timezone ? event.timezone : DEFAULT_EVENT_TIMEZONE;
}
