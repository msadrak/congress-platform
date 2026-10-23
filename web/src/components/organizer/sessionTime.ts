/** Local wall-clock helpers for the program screens: inputs show the organizer's own time zone. */

const pad = (n: number) => String(n).padStart(2, "0");

/** `datetime-local` value (YYYY-MM-DDTHH:MM, local time) for an ISO instant; its first 10 characters are the local day. */
export function toDateTimeLocal(iso: string | number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
