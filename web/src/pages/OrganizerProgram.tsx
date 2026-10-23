import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type EventOut,
  type EventSessionCreate,
  type EventSessionImport,
  type EventSessionOut,
  type VenuePlaceOut,
} from "../api/client";
import { eventTimeZone } from "../api/lifecycleTypes";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { formatLocalizedNumber } from "../lib/i18n";
import { eventSectionNumber, eventWorkspacePath } from "../lib/organizerWorkspace";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { EmptyState, FormAlert, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";
import { SessionFormDialog } from "../components/organizer/SessionFormDialog";
import { ScheduleFilesManager } from "../components/organizer/ScheduleFilesManager";
import { TimetableImport } from "../components/organizer/TimetableImport";
import { sessionDateFormats, toDateTimeLocal } from "../components/organizer/sessionTime";

/** The API's program order: start, then title, then id. */
const bySchedule = (a: EventSessionOut, b: EventSessionOut) =>
  Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerProgram() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerProgramContent key={eventId} />;
}

function OrganizerProgramContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, reportEvent, locale, isRtl } = useOutletContext<OrganizerOutletContext>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [sessions, setSessions] = useState<EventSessionOut[]>([]);
  const [halls, setHalls] = useState<VenuePlaceOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** The session in the form dialog: "new" to add one, null when closed. */
  const [editing, setEditing] = useState<EventSessionOut | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventSessionOut | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);
  const rejected = useCallback(
    (status: number) => {
      if (status === 401 && apiKey) onKeyRejected(apiKey);
    },
    [apiKey, onKeyRejected],
  );

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!client || !eventId) return;
    let active = true;
    (async () => {
      const path = { event_id: eventId };
      const [ev, list, places] = await Promise.all([
        client.GET("/api/events/{event_id}", { params: { path } }),
        client.GET("/api/events/{event_id}/sessions", { params: { path } }),
        client.GET("/api/events/{event_id}/venue-places", { params: { path } }),
      ]);
      [ev, list, places].forEach((r) => rejected(r.response.status));
      if (!active) return;
      if (ev.data) setEvent(ev.data);
      if (list.data) setSessions(list.data);
      if (places.data) setHalls(places.data.filter((p) => p.kind === "hall"));
      const failure = ev.error ?? list.error ?? places.error;
      if (failure) setLoadError(formatApiError(failure));
      setLoading(false);
    })().catch(() => {
      if (active) {
        setLoadError(isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
    // Load once per event and key; the copy language does not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, eventId, rejected]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const formats = useMemo(() => sessionDateFormats(locale), [locale]);
  const tracks = useMemo(() => {
    const used = [...new Set(sessions.map((s) => s.track.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const suggested = isRtl ? ["سخنرانی", "سمینار", "کارگاه", "پنل", "نمایشگاه"] : ["Keynote", "Seminar", "Workshop", "Panel", "Exhibition"];
    return [...used, ...suggested.filter((s) => !used.includes(s))];
  }, [sessions, isRtl]);
  const days = useMemo(() => {
    const groups = new Map<string, EventSessionOut[]>();
    for (const s of sessions) {
      const day = toDateTimeLocal(s.starts_at).slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), s]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sessions]);

  if (loading) {
    return (
      <div role="status" aria-label={isRtl ? "در حال بارگذاری" : "Loading"} className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-64" />
      </div>
    );
  }
  if (loadError || !event || !client || !eventId || !apiKey) {
    return <FormAlert>{loadError ?? (isRtl ? "برنامهٔ همایش بارگذاری نشد." : "The program could not be loaded.")}</FormAlert>;
  }

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const eventDay = toDateTimeLocal(event.starts_at).slice(0, 10);
  const path = { event_id: eventId };

  const reloadProgram = async () => {
    const [list, places] = await Promise.all([
      client.GET("/api/events/{event_id}/sessions", { params: { path } }),
      client.GET("/api/events/{event_id}/venue-places", { params: { path } }),
    ]);
    rejected(list.response.status);
    rejected(places.response.status);
    if (list.data) setSessions(list.data);
    if (places.data) setHalls(places.data.filter((p) => p.kind === "hall"));
  };

  const saveSession = async (body: EventSessionCreate): Promise<string | null> => {
    const target = editing;
    const result =
      target && target !== "new"
        ? await client.PATCH("/api/events/{event_id}/sessions/{session_id}", {
            params: { path: { event_id: eventId, session_id: target.id } },
            body,
          })
        : await client.POST("/api/events/{event_id}/sessions", { params: { path }, body });
    rejected(result.response.status);
    if (!result.data) return formatApiError(result.error);
    const saved = result.data;
    setSessions((prev) => [...prev.filter((s) => s.id !== saved.id), saved].sort(bySchedule));
    setEditing(null);
    setNotice({
      tone: "ok",
      text: target === "new" ? (isRtl ? `جلسهٔ «${saved.title}» افزوده شد.` : `Session “${saved.title}” added.`) : isRtl ? `جلسهٔ «${saved.title}» ذخیره شد.` : `Session “${saved.title}” saved.`,
    });
    return null;
  };

  const deleteSession = async (session: EventSessionOut) => {
    setDeletingId(session.id);
    const { error, response } = await client.DELETE("/api/events/{event_id}/sessions/{session_id}", {
      params: { path: { event_id: eventId, session_id: session.id } },
    });
    rejected(response.status);
    setDeletingId(null);
    if (response.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      setNotice({ tone: "ok", text: isRtl ? `جلسهٔ «${session.title}» حذف شد.` : `Session “${session.title}” deleted.` });
    } else {
      setNotice({ tone: "error", text: isRtl ? `جلسه حذف نشد: ${formatApiError(error)}` : `The session was not deleted: ${formatApiError(error)}` });
    }
  };

  const importTimetable = async (body: EventSessionImport) => {
    const { data, error, response } = await client.POST("/api/events/{event_id}/sessions/import", { params: { path }, body });
    rejected(response.status);
    return data ? { result: data } : { error: formatApiError(error) };
  };

  const timeRange = (s: EventSessionOut) => {
    const start = new Date(s.starts_at);
    const end = new Date(s.ends_at);
    const endsOtherDay = toDateTimeLocal(s.ends_at).slice(0, 10) !== toDateTimeLocal(s.starts_at).slice(0, 10);
    return `${formats.time.format(start)} – ${endsOtherDay ? `${formats.shortDay.format(end)} ` : ""}${formats.time.format(end)}`;
  };

  const headerActions = (
    <>
      <Button type="button" variant="secondary" size="md" onClick={() => setImportOpen(true)} disabled={importOpen} aria-expanded={importOpen}>
        <Icon name="upload" size={18} />
        <span>{isRtl ? "بارگذاری جدول زمانی" : "Upload timetable"}</span>
      </Button>
      <Button type="button" variant="primary" size="md" onClick={() => setEditing("new")}>
        <Icon name="plus" size={18} />
        <span>{isRtl ? "افزودن جلسه" : "Add session"}</span>
      </Button>
    </>
  );

  return (
    <div className="space-y-8">
      <SectionHeader
        index={eventSectionNumber("program")}
        eyebrow={<bdi>{event.name}</bdi>}
        title={isRtl ? "برنامهٔ همایش" : "Program"}
        description={
          isRtl
            ? "جلسه‌ها، کارگاه‌ها و سخنرانی‌ها با زمان، سالن و سخنران. برنامه بدون نیاز به انتشار، بلافاصله در صفحهٔ همایش و پنل شرکت‌کنندگان نمایش داده می‌شود."
            : "Sessions, workshops and talks with their time, hall and speakers. The program is live for attendees on the congress page and in their panel as soon as you save; there is no publish step."
        }
        action={headerActions}
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
          {notice.text}
        </Notice>
      )}

      {importOpen && (
        <TimetableImport
          existingCount={sessions.length}
          halls={halls}
          templateDay={eventDay}
          fileBase={event.slug}
          timeZone={eventTimeZone(event)}
          locale={locale}
          isRtl={isRtl}
          onImport={importTimetable}
          onCancel={() => setImportOpen(false)}
          onDone={(result) => {
            setImportOpen(false);
            void reloadProgram();
            const parts = isRtl
              ? [`${fmt(result.created)} جلسه وارد شد`, result.removed ? `${fmt(result.removed)} جلسهٔ قبلی حذف شد` : "", result.halls_created ? `${fmt(result.halls_created)} سالن جدید ساخته شد` : ""]
              : [
                  `${result.created} ${result.created === 1 ? "session" : "sessions"} imported`,
                  result.removed ? `${result.removed} previous ${result.removed === 1 ? "session" : "sessions"} removed` : "",
                  result.halls_created ? `${result.halls_created} new ${result.halls_created === 1 ? "hall" : "halls"} created` : "",
                ];
            setNotice({ tone: "ok", text: `${parts.filter(Boolean).join(isRtl ? "؛ " : "; ")}.` });
          }}
        />
      )}

      {sessions.length === 0 ? (
        <EmptyState icon="calendar" title={isRtl ? "هنوز جلسه‌ای در برنامه نیست." : "The program has no sessions yet."}>
          {isRtl
            ? "جلسه‌ها را یکی‌یکی اضافه کنید یا جدول زمانی را به‌صورت فایل CSV از اکسل بارگذاری کنید."
            : "Add sessions one by one, or upload the whole timetable as a CSV file from Excel."}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          <p className="text-sm text-text-secondary">
            {isRtl
              ? `${fmt(sessions.length)} جلسه در ${fmt(days.length)} روز`
              : `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"} over ${days.length} ${days.length === 1 ? "day" : "days"}`}
          </p>
          {days.map(([day, daySessions]) => (
            <section key={day} aria-labelledby={`program-day-${day}`} className="space-y-3">
              <h2 id={`program-day-${day}`} className="flex items-center gap-2 text-base font-bold text-text-primary">
                <Icon name="calendar" size={18} className="text-aiteb-indigo/70" />
                {formats.day.format(new Date(daySessions[0].starts_at))}
              </h2>
              <ol className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
                {daySessions.map((s) => (
                  <li key={s.id} data-testid="program-session" className="grid gap-3 px-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start sm:px-5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                      <Icon name="clock" size={15} className="shrink-0 text-text-muted" />
                      <bdi className="tabular">{timeRange(s)}</bdi>
                    </p>
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-bold text-text-primary">
                          <bdi>{s.title}</bdi>
                        </h3>
                        {s.track && (
                          <Badge variant="brand" size="sm" icon={<Icon name="tag" size={11} />}>
                            <bdi>{s.track}</bdi>
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="pin" size={13} className="shrink-0" />
                          {s.hall_name ? <bdi>{s.hall_name}</bdi> : <span className="text-text-muted">{isRtl ? "بدون سالن" : "No hall"}</span>}
                        </span>
                        {s.speakers && (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <Icon name="mic" size={13} className="shrink-0" />
                            <bdi className="break-words">{s.speakers}</bdi>
                          </span>
                        )}
                      </div>
                      {s.description && (
                        <p dir="auto" className="line-clamp-2 whitespace-pre-line break-words text-xs leading-relaxed text-text-muted">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 sm:justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={isRtl ? `ویرایش ${s.title}` : `Edit ${s.title}`}>
                        <Icon name="note" size={16} />
                        <span>{isRtl ? "ویرایش" : "Edit"}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deletingId === s.id}
                        onClick={() => setDeleteTarget(s)}
                        aria-label={isRtl ? `حذف ${s.title}` : `Delete ${s.title}`}
                      >
                        <Icon name="trash" size={16} />
                        <span>{isRtl ? "حذف" : "Delete"}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      <ScheduleFilesManager apiKey={apiKey} eventId={eventId} locale={locale} isRtl={isRtl} onStatus={rejected} />

      {editing && (
        <SessionFormDialog
          key={editing === "new" ? "new" : editing.id}
          session={editing === "new" ? null : editing}
          halls={halls}
          tracks={tracks}
          defaultDay={eventDay}
          venuePath={eventWorkspacePath(eventId, "/venue")}
          isRtl={isRtl}
          onSave={saveSession}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        tone="danger"
        title={isRtl ? "حذف این جلسه؟" : "Delete this session?"}
        description={
          deleteTarget
            ? isRtl
              ? `«${deleteTarget.title}» از برنامهٔ همایش و پنل شرکت‌کنندگان حذف می‌شود.`
              : `“${deleteTarget.title}” is removed from the congress program and the attendee panel.`
            : ""
        }
        confirmLabel={isRtl ? "حذف جلسه" : "Delete session"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void deleteSession(target);
        }}
      />
    </div>
  );
}
