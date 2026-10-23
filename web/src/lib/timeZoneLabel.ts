import type { AttendeeLocale } from "./i18n";

/** Names for the zones congresses are held in, as people say them. */
const KNOWN: Record<string, Record<AttendeeLocale, string>> = {
  "Asia/Tehran": { fa: "وقت تهران", en: "Tehran time" },
};

const LATIN = /[A-Za-z]/;

function intlName(timeZone: string, locale: AttendeeLocale, style: "longGeneric" | "shortOffset"): string | null {
  try {
    const part = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { timeZone, timeZoneName: style })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value.trim() || null;
  } catch {
    return null;
  }
}

/**
 * An event's IANA time zone as a label for the reader ("Asia/Tehran" → «وقت تهران» / "Tehran time"): known zones
 * by name, others by the browser's localized zone name, then its UTC offset. A Persian reader never gets the raw
 * IANA name or other Latin text; the caller can still show it as a tooltip.
 */
export function timeZoneLabel(timeZone: string, locale: AttendeeLocale): string {
  const known = KNOWN[timeZone];
  if (known) return known[locale];
  for (const style of ["longGeneric", "shortOffset"] as const) {
    const name = intlName(timeZone, locale, style);
    if (name && (locale === "en" || !LATIN.test(name))) return name;
  }
  return locale === "fa" ? "وقت محل همایش" : timeZone;
}
