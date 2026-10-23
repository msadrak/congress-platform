import { useEffect, useState } from "react";
import type { PublicSession } from "../../api/client";
import { distinctValues, groupSessionsByDay, initialDayKey, liveAndNext } from "../../lib/programSchedule";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { num, publicCopy, type PublicLocale } from "./copy";

const DATE_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR-u-ca-persian" };
const TIME_LOCALE: Record<PublicLocale, string> = { en: "en-GB", fa: "fa-IR" };

/** "Now" for live badges and the now/next card, refreshed every minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

const clock = (iso: string, locale: PublicLocale) =>
  new Intl.DateTimeFormat(TIME_LOCALE[locale], { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const dayLabel = (iso: string, locale: PublicLocale, month: "long" | "short" = "long") =>
  new Intl.DateTimeFormat(DATE_LOCALE[locale], { weekday: month === "long" ? "long" : "short", day: "numeric", month }).format(new Date(iso));

/** Hall name, linked to its card in the venue section when that card is on the page. */
function Hall({ session, hallIds }: { session: PublicSession; hallIds: ReadonlySet<string> }) {
  if (!session.hall_name) return null;
  const content = (
    <>
      <Icon name="pin" size={14} className="shrink-0 text-text-muted" />
      <bdi className="break-words">{session.hall_name}</bdi>
    </>
  );
  return session.hall_id && hallIds.has(session.hall_id) ? (
    <a href={`#venue-${session.hall_id}`} className="inline-flex min-w-0 items-center gap-1.5 underline-offset-4 hover:text-text-primary hover:underline">
      {content}
    </a>
  ) : (
    <span className="inline-flex min-w-0 items-center gap-1.5">{content}</span>
  );
}

function SessionRow({ session, locale, now, hallIds }: { session: PublicSession; locale: PublicLocale; now: number; hallIds: ReadonlySet<string> }) {
  const c = publicCopy[locale];
  const start = Date.parse(session.starts_at);
  const end = Date.parse(session.ends_at);
  const live = start <= now && now < end;
  const ended = end <= now;
  return (
    <li className={`grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 px-4 py-5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-x-8 sm:px-6 ${live ? "bg-event-accent/[0.06]" : ""}`}>
      <p className="flex flex-col pt-0.5 tabular">
        <span className={`text-base font-semibold ${ended ? "text-text-muted" : "text-text-primary"}`}>{clock(session.starts_at, locale)}</span>
        <span className="text-xs text-text-muted">
          <span className="sr-only">{c.until} </span>
          {clock(session.ends_at, locale)}
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
function NowNext({ live, next, locale }: { live: PublicSession[]; next: PublicSession | null; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const line = (session: PublicSession) => (
    <>
      <span dir="auto" className="block text-base font-semibold leading-snug text-white break-words">{session.title}</span>
      <span className="mt-0.5 block text-xs text-ink-300">
        <span className="tabular">{clock(session.starts_at, locale)}–{clock(session.ends_at, locale)}</span>
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
    <div className="grid gap-px overflow-hidden rounded-2xl bg-white/10 text-white shadow-lift sm:grid-cols-2 [border-start-end-radius:var(--radius-arc)]">
      {live.length > 0 && (
        <div className="space-y-3 bg-surface-ink p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-[#3EE0A1]">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#3EE0A1] motion-safe:animate-pulse" />
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
 * filter, and on a program day a now/next card. Halls link to the venue section.
 */
export function PublicProgram({ sessions, locale, hallIds }: { sessions: readonly PublicSession[]; locale: PublicLocale; hallIds: ReadonlySet<string> }) {
  const c = publicCopy[locale];
  const now = useNow();
  const days = groupSessionsByDay(sessions);
  const tracks = distinctValues(sessions.map((s) => s.track));
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const dayKey = chosenDay && days.some((d) => d.key === chosenDay) ? chosenDay : initialDayKey(days, now);
  const day = days.find((d) => d.key === dayKey) ?? days[0];
  if (!day) return null;
  const shown = track ? day.sessions.filter((s) => s.track?.trim() === track) : day.sessions;
  const status = liveAndNext(sessions, now);

  return (
    <div className="space-y-6">
      {status && <NowNext live={status.live} next={status.next} locale={locale} />}

      {days.length > 1 && (
        <div role="group" aria-label={c.programDays} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {days.map((d, i) => (
            <button key={d.key} type="button" aria-pressed={d.key === day.key} onClick={() => setChosenDay(d.key)} className={chip(d.key === day.key)}>
              <span>{c.programDay(num(i + 1, locale))}</span>
              <span className={`text-xs font-medium ${d.key === day.key ? "text-ink-200" : "text-text-muted"}`}>{dayLabel(d.sessions[0].starts_at, locale, "short")}</span>
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

      <section aria-label={dayLabel(day.sessions[0].starts_at, locale)} className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
        <h3 className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle bg-surface-panel-subtle px-4 py-3 sm:px-6">
          <span className="text-base font-semibold tracking-[-0.01em] text-text-primary">{dayLabel(day.sessions[0].starts_at, locale)}</span>
          <span className="text-xs text-text-muted tabular">{c.sessionCount(num(shown.length, locale), shown.length)}</span>
        </h3>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-secondary sm:px-6">{c.noTrackSessions}</p>
        ) : (
          <ol className="divide-y divide-border-subtle">
            {shown.map((s) => (
              <SessionRow key={s.id} session={s} locale={locale} now={now} hallIds={hallIds} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
