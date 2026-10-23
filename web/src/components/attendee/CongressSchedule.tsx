import { Link } from "react-router-dom";
import type { PublicSession } from "../../api/client";
import { daysBetween, zonedDayKey } from "../../lib/congressPhase";
import type { AttendeeLocale } from "../../lib/i18n";
import { nowAndNext } from "../../lib/programExplorer";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";
import { homeCopy, n, programCopy } from "./attendeeCopy";
import { useNow } from "./useNow";
import { formatClock, formatDayLabel } from "./zonedFormat";

/** Sessions shown for one day on the home module; the full program lives on the details page. */
const UPCOMING_LIMIT = 4;

const iconButton =
  "press grid size-11 shrink-0 place-items-center rounded-xl border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

interface SessionRowProps {
  session: PublicSession;
  locale: AttendeeLocale;
  now: number;
  timeZone?: string;
  /** Speakers and description (the full program); the home shows the compact row. */
  detailed: boolean;
  starred?: boolean;
  onToggleStar?: () => void;
  onCalendar?: () => void;
}

export function SessionRow({ session, locale, now, timeZone, detailed, starred = false, onToggleStar, onCalendar }: SessionRowProps) {
  const c = programCopy[locale];
  const start = Date.parse(session.starts_at);
  const end = Date.parse(session.ends_at);
  const live = start <= now && now < end;
  // Ended sessions recede (muted text, still AA) so the next one stands out.
  const ended = end <= now;
  const actions = onToggleStar || onCalendar;
  return (
    <li
      className={`relative grid gap-x-3 py-4 sm:gap-x-5 ${actions ? "grid-cols-[4rem_minmax(0,1fr)_auto] sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]" : "grid-cols-[4.25rem_minmax(0,1fr)] sm:grid-cols-[5.5rem_minmax(0,1fr)]"} ${live ? "bg-event-accent/[0.05]" : ""}`}
    >
      {starred && <span aria-hidden="true" className="absolute inset-y-3 -start-px w-[3px] rounded-e-full bg-[image:var(--grad-aiteb)]" />}
      <p className="flex flex-col ps-1 pt-0.5 text-sm tabular">
        <span className={`font-semibold ${ended ? "text-text-muted" : "text-text-primary"}`}>{formatClock(session.starts_at, locale, timeZone)}</span>
        <span className="text-xs text-text-muted">
          <span className="sr-only">{c.until} </span>
          {formatClock(session.ends_at, locale, timeZone)}
        </span>
        {ended && <span className="sr-only">{c.ended}</span>}
      </p>
      <div className="min-w-0 space-y-1.5">
        {(live || session.track) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {live && (
              <Badge variant="success" size="sm" dot>
                {c.live}
              </Badge>
            )}
            {session.track && (
              <Badge variant="accent" size="sm">
                <bdi>{session.track}</bdi>
              </Badge>
            )}
          </div>
        )}
        <p dir="auto" className={`text-[15px] font-semibold leading-snug tracking-[-0.01em] break-words ${ended ? "text-text-muted" : "text-text-primary"}`}>
          {session.title}
        </p>
        {(session.hall_name || (detailed && session.speakers)) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
            {session.hall_name && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="pin" size={14} className="shrink-0 text-ink-400" />
                <bdi className="break-words">{session.hall_name}</bdi>
              </span>
            )}
            {detailed && session.speakers && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Icon name="mic" size={14} className="shrink-0 text-ink-400" />
                <bdi className="break-words">{session.speakers}</bdi>
              </span>
            )}
          </p>
        )}
        {detailed && session.description && (
          <p dir="auto" className="max-w-prose whitespace-pre-line text-sm leading-relaxed text-text-secondary break-words">
            {session.description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-col gap-1.5 sm:flex-row">
          {onToggleStar && (
            <button
              type="button"
              aria-pressed={starred}
              aria-label={starred ? c.agendaRemove(session.title) : c.agendaAdd(session.title)}
              onClick={onToggleStar}
              className={`${iconButton} ${starred ? "border-event-accent/30 bg-event-accent-soft text-event-accent" : "border-border-default bg-surface-panel text-ink-400 hover:border-border-strong hover:text-text-primary"}`}
            >
              <Icon name="star" size={19} fill={starred ? "currentColor" : "none"} />
            </button>
          )}
          {onCalendar && (
            <button
              type="button"
              aria-label={c.addToCalendar(session.title)}
              onClick={onCalendar}
              className={`${iconButton} border-border-default bg-surface-panel text-ink-400 hover:border-border-strong hover:text-text-primary`}
            >
              <Icon name="calendar" size={18} />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function ScheduleEmpty({ locale }: { locale: AttendeeLocale }) {
  return (
    <p className="flex items-center gap-2.5 rounded-2xl border border-dashed border-border-strong p-5 text-sm text-text-secondary">
      <Icon name="calendar" size={18} className="shrink-0 text-ink-400" />
      {programCopy[locale].empty}
    </p>
  );
}

function FullProgramLink({ to, count, locale }: { to: string; count: number; locale: AttendeeLocale }) {
  return (
    <Link
      to={to}
      className="group inline-flex min-h-11 items-center gap-1.5 self-start rounded text-sm font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {homeCopy[locale].fullProgram} ({programCopy[locale].sessionCount(n(count, locale))})
      <Icon name="arrow-right" size={16} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}

interface UpcomingSessionsProps {
  sessions: readonly PublicSession[];
  locale: AttendeeLocale;
  timeZone?: string;
  /** The full program (details page). */
  fullScheduleTo: string;
}

/** Home module: today's sessions, or the next day that has any (venue calendar), with a link to the full program. */
export function UpcomingSessions({ sessions, locale, timeZone, fullScheduleTo }: UpcomingSessionsProps) {
  const now = useNow(60_000);
  const fa = locale === "fa";
  if (sessions.length === 0) return <ScheduleEmpty locale={locale} />;

  const fullLink = <FullProgramLink to={fullScheduleTo} count={sessions.length} locale={locale} />;
  const remaining = sessions.filter((s) => Date.parse(s.ends_at) >= now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  if (remaining.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2.5 rounded-2xl border border-border-default bg-surface-panel-subtle p-4 text-sm text-text-secondary">
          <Icon name="check-circle" size={18} className="shrink-0 text-ink-400" />
          {fa ? "همهٔ جلسات این همایش برگزار شده‌اند." : "All sessions of this congress have taken place."}
        </p>
        {fullLink}
      </div>
    );
  }

  const key = zonedDayKey(remaining[0].starts_at, timeZone);
  const day = remaining.filter((s) => zonedDayKey(s.starts_at, timeZone) === key);
  const shown = day.slice(0, UPCOMING_LIMIT);
  const more = day.length - shown.length;
  const offset = daysBetween(zonedDayKey(now, timeZone), key);
  const label = offset === 0 ? (fa ? "امروز" : "Today") : offset === 1 ? (fa ? "فردا" : "Tomorrow") : fa ? "روز بعدی برنامه" : "Next program day";

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-text-muted">
        <Icon name="calendar" size={15} className="text-event-accent" />
        <span className="text-text-primary">{label}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDayLabel(remaining[0].starts_at, locale, timeZone)}</span>
      </p>
      <ol className="divide-y divide-border-subtle border-b border-border-subtle">
        {shown.map((s) => (
          <SessionRow key={s.id} session={s} locale={locale} now={now} timeZone={timeZone} detailed={false} />
        ))}
      </ol>
      {more > 0 && (
        <p className="text-xs text-text-muted">
          {fa ? `و ${n(more, locale)} جلسهٔ دیگر در همین روز` : `and ${more} more session${more === 1 ? "" : "s"} that day`}
        </p>
      )}
      {fullLink}
    </div>
  );
}

/** Home module during the congress: what runs now and what starts next. */
export function NowNextSessions({ sessions, locale, timeZone, fullScheduleTo }: UpcomingSessionsProps) {
  const now = useNow(30_000);
  const c = homeCopy[locale];
  if (sessions.length === 0) return <ScheduleEmpty locale={locale} />;
  const { live, next } = nowAndNext(sessions, now);
  const nextOtherDay = next && zonedDayKey(next.starts_at, timeZone) !== zonedDayKey(now, timeZone);

  const line = (session: PublicSession, showDay = false) => (
    <>
      <span dir="auto" className="block text-base font-semibold leading-snug text-white break-words">{session.title}</span>
      <span className="mt-1 block text-xs text-ink-300">
        {showDay && <>{formatDayLabel(session.starts_at, locale, timeZone, "short")} · </>}
        <span className="tabular">
          {formatClock(session.starts_at, locale, timeZone)}–{formatClock(session.ends_at, locale, timeZone)}
        </span>
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
    <div className="flex flex-col gap-3">
      <div className="grid gap-px overflow-hidden rounded-2xl bg-white/10 text-white shadow-lift sm:grid-cols-2 [border-start-end-radius:var(--radius-arc)]">
        <div className="space-y-3 bg-surface-ink p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-[#3EE0A1]">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#3EE0A1] motion-safe:animate-pulse" />
            {c.nowTitle}
          </p>
          {live.length > 0 ? (
            <ul className="space-y-3">
              {live.map((s) => (
                <li key={s.id}>{line(s)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-300">{c.nothingNow}</p>
          )}
        </div>
        <div className="space-y-3 bg-surface-ink p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-ink-300">
            <Icon name="clock" size={14} />
            {c.nextTitle}
          </p>
          {next ? line(next, Boolean(nextOtherDay)) : <p className="text-sm text-ink-300">{c.noMoreToday}</p>}
        </div>
      </div>
      <FullProgramLink to={fullScheduleTo} count={sessions.length} locale={locale} />
    </div>
  );
}
