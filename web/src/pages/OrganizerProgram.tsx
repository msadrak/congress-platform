import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { localizedApiError, type EventOut, type EventSessionCreate, type EventSessionImport, type EventSessionOut, type VenuePlaceOut } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { RowActions } from "../components/ui/RowActions";
import { EmptyState } from "../components/ui/StateBlock";
import { SectionHeader } from "../components/organizer/WorkspaceUi";
import { SessionFormDialog } from "../components/organizer/SessionFormDialog";
import { ScheduleFilesManager } from "../components/organizer/ScheduleFilesManager";
import { TimetableImport } from "../components/organizer/TimetableImport";
import { eventTimeZone, toZonedDateTimeLocal } from "../components/organizer/sessionTime";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { rovingTarget } from "../components/ui/rovingKeys";
import { commonCopy } from "../copy/common";
import { organizerProgramCopy } from "../copy/organizerProgram";
import { formatDate, formatNumber } from "../lib/format";
import { eventWorkspacePath } from "../lib/organizerWorkspace";
import { EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./organizer/EventSectionUi";
import { loadSessions, loadVenuePlaces, sectionLoad, useEventList, type EventList } from "./organizer/eventLists";
import { VenueDirectory } from "./OrganizerVenue";

const TABS = ["sessions", "venue", "files"] as const;
type ProgramTab = (typeof TABS)[number];
const isTab = (value: string | null): value is ProgramTab => TABS.some((tab) => tab === value);

/** The API's program order: start, then title, then id. */
const bySchedule = (a: EventSessionOut, b: EventSessionOut) =>
  Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

/**
 * `/organizer/events/:eventId/program`: the congress program in three tabs, sessions, halls and entrances, and
 * schedule files (`?tab=venue`, `?tab=files`). Viewers and archived congresses read it without any edit control.
 */
export default function OrganizerProgram() {
  const { locale } = useEventWorkspace();
  const c = organizerProgramCopy[locale];
  const sessions = useEventList(loadSessions);
  const places = useEventList(loadVenuePlaces);
  const lists = sectionLoad([sessions, places]);
  const [search, setSearch] = useSearchParams();
  const requested = search.get("tab");
  const tab: ProgramTab = isTab(requested) ? requested : "sessions";
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const select = (next: ProgramTab) => {
    setSearch(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "sessions") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const target = rovingTarget({ key: event.key, index, disabled: TABS.map(() => false), rtl });
    if (target === null) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
    select(TABS[target]);
  };

  return (
    <div className="space-y-6">
      <SectionHeader title={c.title} />
      <div role="tablist" aria-label={c.tabsLabel} className="flex overflow-x-auto border-b border-border-subtle [scrollbar-width:none]">
        {TABS.map((key, index) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-${key}`}
            aria-selected={tab === key}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => select(key)}
            onKeyDown={(event) => onTabKey(event, index)}
            className="relative inline-flex min-h-11 shrink-0 cursor-pointer items-center px-3 text-body-sm font-semibold whitespace-nowrap text-text-muted transition-colors hover:text-text-primary aria-selected:text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-selected:after:bg-action-primary"
          >
            {c.tabs[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-${tab}`} className="space-y-6">
        <EventSectionGate listsLoaded={lists.loaded}>
          {(event) => (
            <>
              <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />
              {tab === "sessions" && <SessionsTab event={event} sessions={sessions} places={places} />}
              {tab === "venue" && <VenueDirectory places={places} sessions={sessions} />}
              {tab === "files" && <ScheduleFilesManager />}
            </>
          )}
        </EventSectionGate>
      </div>
    </div>
  );
}

function SessionsTab({ event, sessions, places }: { event: EventOut; sessions: EventList<EventSessionOut>; places: EventList<VenuePlaceOut> }) {
  const { eventId, client, canEdit, locale } = useEventWorkspace();
  const c = organizerProgramCopy[locale].sessions;
  const common = commonCopy[locale];
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  /** The session in the form dialog: "new" to add one, null when closed. */
  const [editing, setEditing] = useState<EventSessionOut | "new" | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Sessions are shown, grouped and entered on the event's clock, whatever the browser's zone.
  const timeZone = eventTimeZone(event);
  const halls = useMemo(() => places.items.filter((p) => p.kind === "hall"), [places.items]);
  const tracks = useMemo(() => {
    const used = [...new Set(sessions.items.map((s) => s.track.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return [...used, ...c.trackSuggestions.filter((s) => !used.includes(s))];
  }, [sessions.items, c.trackSuggestions]);
  const days = useMemo(() => {
    const groups: Record<string, EventSessionOut[]> = {};
    for (const s of sessions.items) {
      const day = toZonedDateTimeLocal(s.starts_at, timeZone).slice(0, 10);
      (groups[day] ??= []).push(s);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [sessions.items, timeZone]);

  const fmt = (n: number) => formatNumber(n, locale);
  const eventDay = toZonedDateTimeLocal(event.starts_at, timeZone).slice(0, 10);
  const path = { event_id: eventId };

  const saveSession = async (body: EventSessionCreate): Promise<string | null> => {
    if (!client) return common.generic;
    const target = editing;
    const result =
      target && target !== "new"
        ? await client.PATCH("/api/events/{event_id}/sessions/{session_id}", {
            params: { path: { event_id: eventId, session_id: target.id } },
            body,
          })
        : await client.POST("/api/events/{event_id}/sessions", { params: { path }, body });
    if (!result.data) return localizedApiError(result.error, locale, result.response.status);
    const saved = result.data;
    sessions.setItems((prev) => [...prev.filter((s) => s.id !== saved.id), saved].sort(bySchedule));
    setEditing(null);
    setNotice({ tone: "ok", text: target === "new" ? c.added(saved.title) : c.saved(saved.title) });
    return null;
  };

  const deleteSession = async (session: EventSessionOut) => {
    if (!client) return;
    const { error, response } = await client.DELETE("/api/events/{event_id}/sessions/{session_id}", {
      params: { path: { event_id: eventId, session_id: session.id } },
    });
    if (response.ok) {
      sessions.setItems((prev) => prev.filter((s) => s.id !== session.id));
      setNotice({ tone: "ok", text: c.deleted(session.title) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
    }
  };

  const importTimetable = async (body: EventSessionImport) => {
    if (!client) return { error: common.generic };
    const { data, error, response } = await client.POST("/api/events/{event_id}/sessions/import", { params: { path }, body });
    return data ? { result: data } : { error: localizedApiError(error, locale, response.status) };
  };

  const timeRange = (s: EventSessionOut) => {
    const endsOtherDay = toZonedDateTimeLocal(s.ends_at, timeZone).slice(0, 10) !== toZonedDateTimeLocal(s.starts_at, timeZone).slice(0, 10);
    const end = `${endsOtherDay ? `${formatDate(s.ends_at, "short", locale, timeZone)} ` : ""}${formatDate(s.ends_at, "time", locale, timeZone)}`;
    return c.timeRange(formatDate(s.starts_at, "time", locale, timeZone), end);
  };

  const addButton = (
    <Button type="button" variant="primary" icon="plus" onClick={() => setEditing("new")}>
      {c.add}
    </Button>
  );

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>
            {c.import}
          </Button>
          {addButton}
        </div>
      )}

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

      {sessions.items.length === 0 ? (
        <EmptyState icon="calendar" title={c.emptyTitle} body={canEdit ? c.emptyBody : undefined} />
      ) : (
        <div className="space-y-8">
          <p className="text-body-sm text-text-secondary">{c.summary(fmt(sessions.items.length), fmt(days.length))}</p>
          {days.map(([day, daySessions]) => (
            <section key={day} aria-labelledby={`program-day-${day}`} className="space-y-3">
              <h2 id={`program-day-${day}`} data-testid="program-day" className="text-title-sm font-bold text-text-primary">
                {formatDate(daySessions[0].starts_at, "day", locale, timeZone)}
              </h2>
              <ol className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-default bg-surface-panel">
                {daySessions.map((s) => (
                  <li key={s.id} data-testid="program-session" className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4 sm:px-5">
                    <p className="text-body-sm font-semibold text-text-primary">
                      <bdi className="tabular">{timeRange(s)}</bdi>
                    </p>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-body-sm font-bold text-text-primary">
                          <bdi>{s.title}</bdi>
                        </h3>
                        {s.track && (
                          <Badge variant="brand" size="sm">
                            <bdi>{s.track}</bdi>
                          </Badge>
                        )}
                      </div>
                      <p className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-text-secondary">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="pin" size={14} className="shrink-0" />
                          {s.hall_name ? <bdi>{s.hall_name}</bdi> : <span className="text-text-muted">{c.noHall}</span>}
                        </span>
                        {s.speakers && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <Icon name="mic" size={14} className="shrink-0" />
                            <bdi className="break-words">{s.speakers}</bdi>
                          </span>
                        )}
                      </p>
                      {s.description && (
                        <p dir="auto" className="line-clamp-2 whitespace-pre-line break-words text-meta leading-relaxed text-text-muted">
                          {s.description}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <RowActions
                        visible={1}
                        menuLabel={c.more(s.title)}
                        actions={[
                          { label: common.edit, icon: "note", onSelect: () => setEditing(s) },
                          {
                            label: common.delete,
                            icon: "trash",
                            onSelect: () => void deleteSession(s),
                            destructive: { title: c.deleteTitle(s.title), description: c.deleteBody, confirmLabel: common.delete },
                          },
                        ]}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {importOpen && (
        <TimetableImport
          existingCount={sessions.items.length}
          halls={halls}
          templateDay={eventDay}
          fileBase={event.slug}
          timeZone={timeZone}
          locale={locale}
          onImport={importTimetable}
          onClose={() => setImportOpen(false)}
          onDone={(result) => {
            setImportOpen(false);
            sessions.reload();
            places.reload();
            setNotice({
              tone: "ok",
              text: c.imported(fmt(result.created), result.removed ? fmt(result.removed) : null, result.halls_created ? fmt(result.halls_created) : null),
            });
          }}
        />
      )}

      {editing && (
        <SessionFormDialog
          key={editing === "new" ? "new" : editing.id}
          session={editing === "new" ? null : editing}
          halls={halls}
          tracks={tracks}
          defaultDay={eventDay}
          timeZone={timeZone}
          venuePath={`${eventWorkspacePath(eventId, "/program")}?tab=venue`}
          locale={locale}
          onSave={saveSession}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
