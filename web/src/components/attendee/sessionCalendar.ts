import { buildIcs, icsFileName } from "../../lib/eventLinks";
import { publicEventUrl, saveIcsFile } from "../public/calendarDownload";

interface CalendarSession {
  id: string;
  title: string;
  hall_name: string;
  speakers: string;
  description: string;
  starts_at: string;
  ends_at: string;
}

/** One program session as an `.ics` download (times in UTC), placed at its hall in the congress venue. */
export function downloadSessionCalendar(session: CalendarSession, event: { slug: string; name: string; location: string }): void {
  const location = [session.hall_name, event.location].filter((part) => part.trim()).join(" — ");
  const description = [event.name, session.speakers, session.description].filter((part) => part.trim()).join("\n");
  const ics = buildIcs({
    uid: `${session.id}@${window.location.host || "congress"}`,
    title: session.title,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    location,
    description,
    url: publicEventUrl(event.slug),
  });
  saveIcsFile(ics, icsFileName(`${event.slug}-${session.id.slice(0, 8)}`));
}
