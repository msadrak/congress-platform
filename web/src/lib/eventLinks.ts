/**
 * Links a visitor takes away from a public congress page: an iCalendar file for their calendar app and
 * map searches for the venue. Pure (no DOM), so it is unit tested under `node --test`.
 */

export interface CalendarEntry {
  /** Stable across downloads so calendar apps update the entry instead of duplicating it. */
  uid: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location?: string;
  description?: string;
  url?: string;
  /** When the file was made (DTSTAMP); defaults to now. */
  stamp?: Date;
}

/** `20261118T053000Z`: the API sends no time zone, so every time is written in UTC. */
export function icsDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date: ${String(value)}`);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/**
 * Folds a content line at 75 octets (RFC 5545 §3.1). Persian letters take two UTF-8 octets, so the
 * limit is counted in bytes and a line is only ever broken between whole characters.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    // Continuation lines start with a space, which counts towards their 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** A one-event iCalendar document (CRLF line endings, folded lines) for "Add to calendar". */
export function buildIcs(entry: CalendarEntry): string {
  const description = [entry.description?.trim(), entry.url].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AIteb//Congress Platform//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${entry.uid}`,
    `DTSTAMP:${icsDate(entry.stamp ?? new Date())}`,
    `DTSTART:${icsDate(entry.startsAt)}`,
    `DTEND:${icsDate(entry.endsAt)}`,
    `SUMMARY:${escapeIcsText(entry.title)}`,
    ...(entry.location ? [`LOCATION:${escapeIcsText(entry.location)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeIcsText(description)}`] : []),
    ...(entry.url ? [`URL:${entry.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** A safe download name for the calendar file: `<slug>.ics`. */
export function icsFileName(slug: string): string {
  const base = slug.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "congress"}.ics`;
}

export type MapProvider = "neshan" | "balad" | "google";

export interface MapLink {
  provider: MapProvider;
  href: string;
}

/**
 * Search links for an address in the map apps attendees in Iran use (Neshan, Balad) and Google Maps.
 * Each opens that app's search results for the text; nothing is geocoded here.
 */
export function mapSearchLinks(query: string): MapLink[] {
  const q = query.replace(/\s+/g, " ").trim();
  if (!q) return [];
  const encoded = encodeURIComponent(q);
  return [
    { provider: "neshan", href: `https://neshan.org/maps/search/${encoded}` },
    { provider: "balad", href: `https://balad.ir/search?query=${encoded}` },
    { provider: "google", href: `https://www.google.com/maps/search/?api=1&query=${encoded}` },
  ];
}
