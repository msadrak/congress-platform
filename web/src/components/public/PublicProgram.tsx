import { useEffect, useState } from "react";
import type { PublicSession } from "../../api/client";
import { distinctValues, groupSessionsByDay, initialDayKey, liveAndNext } from "../../lib/programSchedule";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { safeTimeZone } from "../../lib/congressPhase";
import { formatDate, formatTime } from "../../lib/format";
import { num, publicCopy, type PublicLocale } from "./copy";
import { venueZoneNote } from "./format";

/** "Now" for live badges and the now/next card, refreshed every minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Clock time at the venue (`timeZone`: the congress's zone, already validated). */
const clock = (iso: string, locale: PublicLocale, timeZone: string | undefined) => formatTime(iso, locale, timeZone);

/** «سه‌شنبه ۱۹ آبان» / "Tuesday 10 November", or «۱۹ آبان» / "10 Nov" on the day buttons. */
const dayLabel = (iso: string, locale: PublicLocale, timeZone: string | undefined, month: "long" | "short" = "long") =>
  formatDate(iso, month === "long" ? "heading" : "short", locale, timeZone);

/** Hall name, linked to its card in the venue section when that card is on the page (a full 44px target). */
function Hall({ session, hallIds }: { session: PublicSession; hallIds: ReadonlySet<string> }) {
  if (!session.hall_name) return null;
  const content = (
    <>
      <Icon name="pin" size={14} className="shrink-0 text-text-muted" />
      <bdi className="break-words">{session.hall_name}</bdi>
    </>
  );
  return session.hall_id && hallIds.has(session.hall_id) ? (
    <a
      href={`#venue-${session.hall_id}`}
      className="-my-3 inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded underline-offset-4 hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      {content}
    </a>
  ) : (
    <span className="inline-flex min-w-0 items-center gap-1.5">{content}</span>
  );
}

function SessionRow({ session, locale, now, hallIds, timeZone }: { session: PublicSession; locale: PublicLocale; now: number; hallIds: ReadonlySet<string>; timeZone: string | undefined }) {
  const c = publicCopy[locale];
  const start = Date.parse(session.starts_at);
  const end = Date.parse(session.ends_at);
  const live = start <= now && now < end;
  const ended = end <= now;
  return (
    <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 px-4 py-5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-x-8 sm:px-6 ${live ? "bg-event-accent/[0.06]" : ""}`}>
      <p className="flex flex-col pt-0.5 tabular">
        <span className={`text-base font-semibold ${ended ? "text-text-muted" : "text-text-primary"}`}>{clock(session.starts_at, locale, timeZone)}</span>
        <span className="text-xs text-text-muted">
          <span className="sr-only">{c.until} </span>
          {clock(session.ends_at, locale, timeZone)}
        </span>
        {ended && <span className="sr-only">{c.sessionEnded}</span>}
      </p>
      <div className="min-w-0 space-y-2">
        {(live || session.track) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {live && (
              <Badge variant="success" size="sm" dot>
                {c.liveNow}
              </Badge>
            )}
            {session.track && (
              <Badge variant="accent" size="sm">
                <bdi>{session.track}</bdi>
              </Badge>
            )}
          </div>
        )}
        <h4 dir="auto" className={`text-base font-semibold leading-snug tracking-[-0.01em] break-words sm:text-lg ${ended ? "text-text-muted" : "text-text-primary"}`}>
          {session.title}
        </h4>
        {(session.hall_name || session.speakers) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
            <Hall session={session} hallIds={hallIds} />
            {session.speakers && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="mic" size={14} className="shrink-0 text-text-muted" />
                <bdi className="break-words">{session.speakers}</bdi>
              </span>
            )}
          </p>
        )}
        {session.description && (
          <p dir="auto" className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-text-secondary break-words">
            {session.description}
          </p>
        )}
      </div>
    </li>
  );
}

/** On a program day: what is on now and what starts next, on ink so it reads as live status. */
function NowNext({ live, next, locale, timeZone }: { live: PublicSession[]; next: PublicSession | null; locale: PublicLocale; timeZone: string | undefined }) {
  const c = publicCopy[locale];
  const line = (session: PublicSession) => (
    <>
      <span dir="auto" className="block text-base font-semibold leading-snug text-white break-words">{session.title}</span>
      <span className="mt-0.5 block text-xs text-ink-300">
        <span className="tabular">{clock(session.starts_at, locale, timeZone)}–{clock(session.ends_at, locale, timeZone)}</span>
        {session.hall_name && (
          <>
            {" · "}
            <bdi>{session.hall_name}</bdi>
          </>
        )}
      </span>
    </>
  );
  return (
    <div className="surface-ink grid gap-px overflow-hidden rounded-card bg-white/10 text-white sm:grid-cols-2">
      {live.length > 0 && (
        <div className="space-y-3 bg-surface-ink p-5">
          <p className="flex items-center gap-2 text-caption font-semibold text-white">
            <span aria-hidden="true" className="size-2 rounded-full bg-status-success-solid motion-safe:animate-pulse" />
            {c.liveNow}
          </p>
          <ul className="space-y-3">
            {live.map((s) => (
              <li key={s.id}>{line(s)}</li>
            ))}
          </ul>
        </div>
      )}
      {next && (
        <div className={`space-y-3 bg-surface-ink p-5 ${live.length === 0 ? "sm:col-span-2" : ""}`}>
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-300">
            <Icon name="clock" size={14} />
            {c.upNext}
          </p>
          {line(next)}
        </div>
      )}
    </div>
  );
}

const chip = (active: boolean) =>
  `press inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
    active
      ? "border-transparent bg-surface-ink text-white"
      : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
  }`;

/**
 * The public congress program: one day at a time (day buttons when there are several), optional track
 * filter, and on a program day a now/next card. Halls link to the venue section. Days and times are the
 * venue's (`timeZone`, the congress's zone), with a note when this device is in another zone.
 */
export function PublicProgram({ sessions, locale, hallIds, timeZone }: {
  sessions: readonly PublicSession[];
  locale: PublicLocale;
  hallIds: ReadonlySet<string>;
  timeZone?: string;
}) {
  const c = publicCopy[locale];
  const now = useNow();
  const tz = safeTimeZone(timeZone);
  const days = groupSessionsByDay(sessions, tz);
  const tracks = distinctValues(sessions.map((s) => s.track));
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const dayKey = chosenDay && days.some((d) => d.key === chosenDay) ? chosenDay : initialDayKey(days, now, tz);
  const day = days.find((d) => d.key === dayKey) ?? days[0];
  if (!day) return null;
  const shown = track ? day.sessions.filter((s) => s.track?.trim() === track) : day.sessions;
  const status = liveAndNext(sessions, now, tz);
  const zone = venueZoneNote(tz, day.sessions[0].starts_at);

  return (
    <div className="space-y-6">
      {zone && (
        <p data-testid="program-zone-note" className="flex items-center gap-1.5 text-xs text-text-muted">
          <Icon name="clock" size={14} className="shrink-0" />
          {c.zoneNote(zone)}
        </p>
      )}
      {status && <NowNext live={status.live} next={status.next} locale={locale} timeZone={tz} />}

      {days.length > 1 && (
        <div role="group" aria-label={c.programDays} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {days.map((d, i) => (
            <button key={d.key} type="button" aria-pressed={d.key === day.key} onClick={() => setChosenDay(d.key)} className={chip(d.key === day.key)}>
              <span>{c.programDay(num(i + 1, locale))}</span>
              <span className={`text-xs font-medium ${d.key === day.key ? "text-ink-200" : "text-text-muted"}`}>{dayLabel(d.sessions[0].starts_at, locale, tz, "short")}</span>
            </button>
          ))}
        </div>
      )}

      {tracks.length > 1 && (
        <div role="group" aria-label={c.tracksLabel} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {[null, ...tracks].map((value) => (
            <button key={value ?? "all"} type="button" aria-pressed={track === value} onClick={() => setTrack(value)} className={chip(track === value)}>
              {value === null ? c.allTracks : <bdi>{value}</bdi>}
            </button>
          ))}
        </div>
      )}

      <section aria-label={dayLabel(day.sessions[0].starts_at, locale, tz)} className="overflow-hidden rounded-card border border-border-default bg-surface-panel shadow-soft">
        <h3 className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle bg-surface-panel-subtle px-4 py-3 sm:px-6">
          <span className="text-base font-semibold tracking-[-0.01em] text-text-primary">{dayLabel(day.sessions[0].starts_at, locale, tz)}</span>
          <span className="text-xs text-text-muted tabular">{c.sessionCount(num(shown.length, locale), shown.length)}</span>
        </h3>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-secondary sm:px-6">{c.noTrackSessions}</p>
        ) : (
          <ol className="divide-y divide-border-subtle">
            {shown.map((s) => (
              <SessionRow key={s.id} session={s} locale={locale} now={now} hallIds={hallIds} timeZone={tz} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
