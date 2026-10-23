import { buildIcs, icsFileName } from "../../lib/eventLinks";

export interface CalendarEvent {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  ends_at: string;
  location: string;
  description: string;
}

/** The canonical public address of a congress, whatever page (or preview) the visitor is on. */
export function publicEventUrl(slug: string): string {
  return `${window.location.origin}/e/${encodeURIComponent(slug)}`;
}

/** Saves the congress as an `.ics` file, which phones and desktop calendars open as a new event. */
export function downloadCalendarFile(event: CalendarEvent): void {
  const ics = buildIcs({
    uid: `${event.id}@${window.location.host || "congress"}`,
    title: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    location: event.location,
    description: event.description,
    url: publicEventUrl(event.slug),
  });
  saveIcsFile(ics, icsFileName(event.slug));
}

/** Hands an iCalendar document to the browser as a download (phones open it in their calendar app). */
export function saveIcsFile(ics: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
