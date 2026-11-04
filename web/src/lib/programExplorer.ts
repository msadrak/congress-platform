/**
 * The attendee program: sessions grouped by the congress's calendar days, filtered by track, hall, a
 * search and the personal agenda, plus "now / next". Pure (no DOM, no React) for `node --test`.
 */
import { zonedDayKey } from "./congressPhase.ts";

export interface ProgramSession {
  id: string;
  title: string;
  track: string;
  hall_name: string;
  speakers: string;
  description: string;
  starts_at: string;
  ends_at: string;
}

export interface ZonedDay<T> {
  /** Calendar day in the congress's zone, `YYYY-MM-DD`. */
  key: string;
  sessions: T[];
}

const byTime = <T extends Pick<ProgramSession, "starts_at" | "ends_at">>(a: T, b: T) =>
  Date.parse(a.starts_at) - Date.parse(b.starts_at) || Date.parse(a.ends_at) - Date.parse(b.ends_at);

/** Sessions in time order, grouped by calendar day in `timeZone`. */
export function groupByZonedDay<T extends Pick<ProgramSession, "starts_at" | "ends_at">>(sessions: readonly T[], timeZone?: string): ZonedDay<T>[] {
  const days: ZonedDay<T>[] = [];
  for (const session of [...sessions].sort(byTime)) {
    const key = zonedDayKey(session.starts_at, timeZone);
    const last = days.at(-1);
    if (last?.key === key) last.sessions.push(session);
    else days.push({ key, sessions: [session] });
  }
  return days;
}

/** The day to open first: today when it is a program day, else the next one to come, else the first. */
export function initialZonedDay<T>(days: readonly ZonedDay<T>[], now: number, timeZone?: string): string | null {
  if (days.length === 0) return null;
  const today = zonedDayKey(now, timeZone);
  return (days.find((d) => d.key === today) ?? days.find((d) => d.key > today) ?? days[0]).key;
}

/**
 * Text as typed on any keyboard: Arabic yeh/kaf become Persian, Persian and Arabic digits ASCII, the
 * zero-width non-joiner a space, short vowels dropped, case folded.
 */
export function foldSearchText(text: string): string {
  return text
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[ً-ْٰ]/g, "")
    .replace(/‌/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface ProgramFilter {
  track?: string | null;
  hall?: string | null;
  query?: string;
  /** Only these session ids (the personal agenda); omitted means every session. */
  onlyIds?: readonly string[] | null;
}

/** Sessions matching every given filter; the search covers title, speakers, track, hall and description. */
export function filterSessions<T extends ProgramSession>(sessions: readonly T[], filter: ProgramFilter): T[] {
  const needle = foldSearchText(filter.query ?? "");
  const track = filter.track?.trim() || null;
  const hall = filter.hall?.trim() || null;
  return sessions.filter((s) => {
    if (track && s.track.trim() !== track) return false;
    if (hall && s.hall_name.trim() !== hall) return false;
    if (filter.onlyIds && !filter.onlyIds.includes(s.id)) return false;
    if (needle && !foldSearchText(`${s.title} ${s.speakers} ${s.track} ${s.hall_name} ${s.description}`).includes(needle)) return false;
    return true;
  });
}

/** Sessions running at `now`, and the next one to start (any later day). */
export function nowAndNext<T extends Pick<ProgramSession, "starts_at" | "ends_at">>(sessions: readonly T[], now: number): { live: T[]; next: T | null } {
  const sorted = [...sessions].sort(byTime);
  return {
    live: sorted.filter((s) => Date.parse(s.starts_at) <= now && now < Date.parse(s.ends_at)),
    next: sorted.find((s) => Date.parse(s.starts_at) > now) ?? null,
  };
}
