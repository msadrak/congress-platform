import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicSession } from "../../api/client";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";

/** Sessions shown for one day on the home module; the full program lives on the details page. */
const UPCOMING_LIMIT = 4;
const DAY_MS = 86_400_000;

/** "Now" for live-session badges, refreshed every minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Local calendar day of a timestamp, as a grouping key. */
function dayKey(value: string | number): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, locale: AttendeeLocale): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

function clock(iso: string, locale: AttendeeLocale): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Sessions grouped by local calendar day, in the API's order (by start time). */
function groupByDay(sessions: readonly PublicSession[]): { key: string; sessions: PublicSession[] }[] {
  const groups: { key: string; sessions: PublicSession[] }[] = [];
  for (const session of sessions) {
    const key = dayKey(session.starts_at);
    const group = groups.find((g) => g.key === key);
    if (group) group.sessions.push(session);
    else groups.push({ key, sessions: [session] });
  }
  return groups;
}

function SessionItem({ session, locale, now, detailed }: { session: PublicSession; locale: AttendeeLocale; now: number; detailed: boolean }) {
  const fa = locale === "fa";
  const live = Date.parse(session.starts_at) <= now && now <= Date.parse(session.ends_at);
  // Ended sessions recede (muted text, still AA) so the next one stands out.
  const ended = Date.parse(session.ends_at) < now;
  return (
    <li className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-4 py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <p className="flex flex-col pt-0.5 text-sm tabular">
        <span className={`font-semibold ${ended ? "text-text-muted" : "text-text-primary"}`}>{clock(session.starts_at, locale)}</span>
        <span className="text-xs text-text-muted">
          <span className="sr-only">{fa ? "تا" : "until"} </span>
          {clock(session.ends_at, locale)}
        </span>
        {ended && <span className="sr-only">{fa ? "پایان‌یافته" : "Ended"}</span>}
      </p>
      <div className="min-w-0 space-y-1.5">
        {(live || session.track) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {live && (
              <Badge variant="success" size="sm" dot>
                {fa ? "در حال برگزاری" : "Now"}
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
    </li>
  );
}

function ScheduleEmpty({ locale }: { locale: AttendeeLocale }) {
  return (
    <p className="flex items-center gap-2.5 rounded-2xl border border-dashed border-border-strong p-5 text-sm text-text-secondary">
      <Icon name="calendar" size={18} className="shrink-0 text-ink-400" />
      {locale === "fa" ? "برنامه جلسات هنوز اعلام نشده است." : "The session program has not been announced yet."}
    </p>
  );
}

interface UpcomingSessionsProps {
  sessions: readonly PublicSession[];
  locale: AttendeeLocale;
  /** The full program (details page). */
  fullScheduleTo: string;
}

/** Home module: today's sessions, or the next day that has any, with a link to the full program. */
export function UpcomingSessions({ sessions, locale, fullScheduleTo }: UpcomingSessionsProps) {
  const now = useNow();
  const fa = locale === "fa";
  if (sessions.length === 0) return <ScheduleEmpty locale={locale} />;

  const fullLink = (
    <Link
      to={fullScheduleTo}
      className="group inline-flex min-h-11 items-center gap-1.5 self-start rounded text-sm font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {fa ? `برنامه کامل (${formatLocalizedNumber(sessions.length, locale)} جلسه)` : `Full program (${sessions.length} session${sessions.length === 1 ? "" : "s"})`}
      <Icon name="arrow-right" size={16} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );

  const remaining = sessions.filter((s) => Date.parse(s.ends_at) >= now);
  if (remaining.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2.5 rounded-2xl border border-border-default bg-surface-panel-subtle p-4 text-sm text-text-secondary">
          <Icon name="check-circle" size={18} className="shrink-0 text-ink-400" />
          {fa ? "همه جلسات این همایش برگزار شده‌اند." : "All sessions of this congress have taken place."}
        </p>
        {fullLink}
      </div>
    );
  }

  const key = dayKey(remaining[0].starts_at);
  const day = remaining.filter((s) => dayKey(s.starts_at) === key);
  const shown = day.slice(0, UPCOMING_LIMIT);
  const more = day.length - shown.length;
  const label =
    key === dayKey(now)
      ? fa ? "امروز" : "Today"
      : key === dayKey(now + DAY_MS)
        ? fa ? "فردا" : "Tomorrow"
        : fa ? "روز بعدی برنامه" : "Next program day";

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-text-muted">
        <Icon name="calendar" size={15} className="text-event-accent" />
        <span className="text-text-primary">{label}</span>
        <span aria-hidden="true">·</span>
        <span>{dayLabel(remaining[0].starts_at, locale)}</span>
      </p>
      <ol className="divide-y divide-border-subtle border-b border-border-subtle">
        {shown.map((s) => (
          <SessionItem key={s.id} session={s} locale={locale} now={now} detailed={false} />
        ))}
      </ol>
      {more > 0 && (
        <p className="text-xs text-text-muted">
          {fa ? `و ${formatLocalizedNumber(more, locale)} جلسه دیگر در همین روز` : `and ${more} more session${more === 1 ? "" : "s"} that day`}
        </p>
      )}
      {fullLink}
    </div>
  );
}

/** The complete program grouped by day: time range, title, track, hall, speakers and description. */
export function FullSchedule({ sessions, locale }: { sessions: readonly PublicSession[]; locale: AttendeeLocale }) {
  const now = useNow();
  const fa = locale === "fa";
  if (sessions.length === 0) return <ScheduleEmpty locale={locale} />;
  const groups = groupByDay(sessions);
  return (
    <div className="space-y-10">
      {groups.map((group, i) => (
        <section key={group.key} aria-label={dayLabel(group.sessions[0].starts_at, locale)} className="space-y-2">
          <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {groups.length > 1 && (
              <span className="text-xs font-semibold text-event-accent">
                {fa ? `روز ${formatLocalizedNumber(i + 1, locale)}` : `Day ${i + 1}`}
              </span>
            )}
            <span className="text-base font-semibold tracking-[-0.01em] text-text-primary">{dayLabel(group.sessions[0].starts_at, locale)}</span>
            <span className="text-xs text-text-muted">
              {fa ? `${formatLocalizedNumber(group.sessions.length, locale)} جلسه` : `${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}`}
            </span>
          </h3>
          <ol className="divide-y divide-border-default border-y border-border-default">
            {group.sessions.map((s) => (
              <SessionItem key={s.id} session={s} locale={locale} now={now} detailed />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
