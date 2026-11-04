/**
 * Grouping and "now / next" for the public congress program. Pure (no DOM, no React) so it is unit
 * tested under `node --test`. Days are calendar days in the congress's `timeZone` when given (the venue's
 * days, wherever the visitor is), otherwise the visitor's local days.
 */
import { zonedDayKey } from "./congressPhase.ts";

export interface TimedSession {
  starts_at: string;
  ends_at: string;
}

export interface ProgramDay<T extends TimedSession> {
  /** Calendar day, `YYYY-MM-DD`. */
  key: string;
  sessions: T[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of a moment as `YYYY-MM-DD`. */
export function localDayKey(value: string | number | Date): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayKey = (value: string | number | Date, timeZone?: string) => (timeZone ? zonedDayKey(value, timeZone) : localDayKey(value));

/** Sessions sorted by start (then end) and grouped by calendar day, days in order. */
export function groupSessionsByDay<T extends TimedSession>(sessions: readonly T[], timeZone?: string): ProgramDay<T>[] {
  const sorted = [...sessions].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || Date.parse(a.ends_at) - Date.parse(b.ends_at),
  );
  const days: ProgramDay<T>[] = [];
  for (const session of sorted) {
    const key = dayKey(session.starts_at, timeZone);
    const last = days.at(-1);
    if (last?.key === key) last.sessions.push(session);
    else days.push({ key, sessions: [session] });
  }
  return days;
}

/** Sessions running at `now` and the next one to start, both only on today's program day. */
export function liveAndNext<T extends TimedSession>(sessions: readonly T[], now: number, timeZone?: string): { live: T[]; next: T | null } | null {
  const today = groupSessionsByDay(sessions, timeZone).find((day) => day.key === dayKey(now, timeZone));
  if (!today) return null;
  const live = today.sessions.filter((s) => Date.parse(s.starts_at) <= now && now < Date.parse(s.ends_at));
  const next = today.sessions.find((s) => Date.parse(s.starts_at) > now) ?? null;
  if (live.length === 0 && !next) return null;
  return { live, next };
}

/** The day to open first: today when it is a program day, else the first day still to come, else the first. */
export function initialDayKey<T extends TimedSession>(days: readonly ProgramDay<T>[], now: number, timeZone?: string): string | null {
  if (days.length === 0) return null;
  const today = dayKey(now, timeZone);
  return (days.find((d) => d.key === today) ?? days.find((d) => d.key > today) ?? days[0]).key;
}

/** Distinct non-empty values (tracks, halls) in first-seen order. */
export function distinctValues(values: readonly (string | null | undefined)[]): string[] {
  const seen: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}
