import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PublicSession } from "../../api/client";
import type { AttendeeLocale } from "../../lib/i18n";
import { safeTimeZone } from "../../lib/congressPhase";
import { distinctValues } from "../../lib/programSchedule";
import { filterSessions, groupByZonedDay, initialZonedDay } from "../../lib/programExplorer";
import { Icon } from "../ui/Icon";
import { attendeeCopy } from "../../copy/attendee";
import { n } from "./attendeeCopy";
import { ScheduleEmpty, SessionRow } from "./CongressSchedule";
import { downloadSessionCalendar } from "./sessionCalendar";
import type { PersonalAgenda } from "./useAgenda";
import { useNow } from "./useNow";
import { venueZoneLabel } from "../../lib/format";
import { formatDayLabel } from "./zonedFormat";

const chip = (active: boolean) =>
  `press inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
    active
      ? "border-transparent bg-surface-ink text-white"
      : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
  }`;

/** The arrow keys that move to the next and the previous day tab: the tabs read right to left in Persian. */
const ARROWS = { fa: ["ArrowLeft", "ArrowRight"], en: ["ArrowRight", "ArrowLeft"] } as const;

const chipRow = "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0";

interface ProgramExplorerProps {
  sessions: readonly PublicSession[];
  locale: AttendeeLocale;
  /** The congress's IANA zone: days and clock times are the venue's. */
  timeZone?: string;
  event: { slug: string; name: string; location: string };
  agenda: PersonalAgenda;
}

function ChipGroup({ label, all, values, value, onChange }: { label: string; all: string; values: string[]; value: string | null; onChange: (value: string | null) => void }) {
  return (
    <div role="group" aria-label={label} className={chipRow}>
      {[null, ...values].map((v) => (
        <button key={v ?? "all"} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={chip(value === v)}>
          {v === null ? all : <bdi>{v}</bdi>}
        </button>
      ))}
    </div>
  );
}

/**
 * The full program for attendees: sticky day tabs, track and hall chips, a search, the personal agenda
 * (★, kept on this device) and an `.ics` per session. Days and times are the venue's.
 */
export function ProgramExplorer({ sessions, locale, timeZone, event, agenda }: ProgramExplorerProps) {
  const c = attendeeCopy[locale].program;
  const now = useNow(60_000);
  const tz = safeTimeZone(timeZone);
  const panelId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const days = useMemo(() => groupByZonedDay(sessions, tz), [sessions, tz]);
  const tracks = useMemo(() => distinctValues(sessions.map((s) => s.track)), [sessions]);
  const halls = useMemo(() => distinctValues(sessions.map((s) => s.hall_name)), [sessions]);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  const [hall, setHall] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [agendaOnly, setAgendaOnly] = useState(false);

  if (sessions.length === 0) return <ScheduleEmpty locale={locale} />;

  const dayKey = chosenDay && days.some((d) => d.key === chosenDay) ? chosenDay : initialZonedDay(days, now, tz);
  const dayIndex = Math.max(0, days.findIndex((d) => d.key === dayKey));
  const day = days[dayIndex];
  const filter = { track, hall, query, onlyIds: agendaOnly ? agenda.ids : null };
  const matching = days.map((d) => filterSessions(d.sessions, filter));
  const shown = matching[dayIndex];
  const filtering = track !== null || hall !== null || query.trim() !== "" || agendaOnly;
  const clearFilters = () => {
    setTrack(null);
    setHall(null);
    setQuery("");
    setAgendaOnly(false);
  };

  // Arrow keys move between day tabs (roving focus), Home/End jump to the ends.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const [forward, backward] = ARROWS[locale];
    let next = index;
    if (e.key === forward) next = (index + 1) % days.length;
    else if (e.key === backward) next = (index - 1 + days.length) % days.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = days.length - 1;
    else return;
    e.preventDefault();
    setChosenDay(days[next].key);
    tabRefs.current[next]?.focus();
  };

  const zone = venueZoneLabel(tz, day.sessions[0].starts_at, locale);

  return (
    <div className="space-y-5">
      {days.length > 1 && (
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 border-b border-border-subtle bg-surface-page/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <div role="tablist" aria-label={c.days} className="flex gap-2 overflow-x-auto pb-0.5">
            {days.map((d, i) => {
              const selected = i === dayIndex;
              return (
                <button
                  key={d.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${i}`}
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setChosenDay(d.key)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={chip(selected)}
                >
                  <span>{c.day(n(i + 1, locale))}</span>
                  <span className={`text-xs font-medium ${selected ? "text-ink-200" : "text-text-muted"}`}>{formatDayLabel(d.sessions[0].starts_at, locale, tz, "short")}</span>
                  {filtering && (
                    <span className={`rounded-full px-1.5 text-caption tabular ${selected ? "bg-white/15 text-white" : "bg-surface-panel-subtle text-text-muted"}`}>
                      {n(matching[i].length, locale)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-sm sm:flex-1">
            <label htmlFor={`${panelId}-search`} className="sr-only">{c.search}</label>
            <Icon name="search" size={18} className="pointer-events-none absolute inset-y-0 start-3.5 my-auto text-ink-400" />
            <input
              id={`${panelId}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.searchPlaceholder}
              className="ui-input ps-10"
            />
          </div>
          <button type="button" aria-pressed={agendaOnly} onClick={() => setAgendaOnly((v) => !v)} className={`${chip(agendaOnly)} self-start`}>
            <Icon name="star" size={17} fill={agendaOnly ? "currentColor" : "none"} className={agendaOnly ? "text-aiteb-orchid" : "text-event-accent"} />
            {c.myAgenda}
            {agenda.ids.length > 0 && <span className="tabular text-xs">({n(agenda.ids.length, locale)})</span>}
          </button>
        </div>
        {tracks.length > 1 && <ChipGroup label={c.tracks} all={c.allTracks} values={tracks} value={track} onChange={setTrack} />}
        {halls.length > 1 && <ChipGroup label={c.halls} all={c.allHalls} values={halls} value={hall} onChange={setHall} />}
        {!agenda.persisted && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning-text">
            <Icon name="info" size={15} className="mt-px shrink-0" />
            {c.agendaNotSaved}
          </p>
        )}
      </div>

      <section
        id={panelId}
        role={days.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={days.length > 1 ? `${panelId}-tab-${dayIndex}` : undefined}
        aria-label={days.length > 1 ? undefined : formatDayLabel(day.sessions[0].starts_at, locale, tz)}
        className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft"
      >
        <h3 className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle bg-surface-panel-subtle px-4 py-3 sm:px-6">
          <span className="text-base font-semibold tracking-[-0.01em] text-text-primary">{formatDayLabel(day.sessions[0].starts_at, locale, tz)}</span>
          <span className="text-xs text-text-muted tabular">{c.sessionCount(n(shown.length, locale))}</span>
        </h3>
        {shown.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-6 text-sm text-text-secondary sm:px-6">
            <p>{agendaOnly && agenda.ids.length === 0 ? c.agendaEmpty : c.noMatch}</p>
            <button type="button" onClick={clearFilters} className="inline-flex min-h-12 items-center gap-1.5 rounded-lg px-2 font-semibold text-action-primary underline-offset-4 hover:underline cursor-pointer">
              <Icon name="x" size={16} />
              {c.clearFilters}
            </button>
          </div>
        ) : (
          <ol className="divide-y divide-border-subtle px-3 sm:px-5">
            {shown.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                locale={locale}
                now={now}
                timeZone={tz}
                detailed
                starred={agenda.has(s.id)}
                onToggleStar={() => agenda.toggle(s.id)}
                onCalendar={() => downloadSessionCalendar(s, event)}
              />
            ))}
          </ol>
        )}
      </section>
      {zone && <p className="text-xs text-text-muted">{c.timesIn(zone)}</p>}
    </div>
  );
}
