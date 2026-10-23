import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type EventOut,
  type EventSessionOut,
  type VenuePlaceKind,
  type VenuePlaceOut,
} from "../api/client";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { formatLocalizedNumber } from "../lib/i18n";
import { eventSectionNumber } from "../lib/organizerWorkspace";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog } from "../components/ui/Dialog";
import { Icon, type IconName } from "../components/ui/Icon";
import { DialogActions, EmptyState, Field, FormAlert, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";

/** The API's order within a kind: position, then creation. */
const byPosition = (a: VenuePlaceOut, b: VenuePlaceOut) => a.position - b.position || a.created_at.localeCompare(b.created_at);

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerVenue() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerVenueContent key={eventId} />;
}

function OrganizerVenueContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, reportEvent, locale, isRtl } = useOutletContext<OrganizerOutletContext>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [places, setPlaces] = useState<VenuePlaceOut[]>([]);
  const [sessions, setSessions] = useState<EventSessionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** The place in the form dialog: a kind to add one, an existing place to edit it, null when closed. */
  const [editing, setEditing] = useState<VenuePlaceOut | { kind: VenuePlaceKind } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VenuePlaceOut | null>(null);
  /** Places with a request in flight (reorder, delete): their controls are disabled meanwhile. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  // A 401 reaches the organizer layout's key gate through the API client (registerUnauthorizedHandler).
  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);

  const loadPlaces = useCallback(async () => {
    if (!client || !eventId) return;
    const { data } = await client.GET("/api/events/{event_id}/venue-places", { params: { path: { event_id: eventId } } });
    if (data) setPlaces(data);
  }, [client, eventId]);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!client || !eventId) return;
    let active = true;
    (async () => {
      const path = { event_id: eventId };
      const [ev, list, program] = await Promise.all([
        client.GET("/api/events/{event_id}", { params: { path } }),
        client.GET("/api/events/{event_id}/venue-places", { params: { path } }),
        client.GET("/api/events/{event_id}/sessions", { params: { path } }),
      ]);
      if (!active) return;
      if (ev.data) setEvent(ev.data);
      if (list.data) setPlaces(list.data);
      if (program.data) setSessions(program.data);
      const failure = ev.error ?? list.error;
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
  }, [client, eventId]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  if (loading) {
    return (
      <div role="status" aria-label={isRtl ? "در حال بارگذاری" : "Loading"} className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-64" />
      </div>
    );
  }
  if (loadError || !event || !client || !eventId) {
    return <FormAlert>{loadError ?? (isRtl ? "سالن‌ها و ورودی‌ها بارگذاری نشد." : "The venue directory could not be loaded.")}</FormAlert>;
  }

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const setBusy = (ids: string[], busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const sessionsIn = (hallId: string) => sessions.filter((s) => s.hall_id === hallId).length;
  const kindCopy = (kind: VenuePlaceKind) =>
    kind === "hall"
      ? { one: isRtl ? "سالن" : "hall", title: isRtl ? "سالن‌ها" : "Halls", empty: isRtl ? "هنوز سالنی تعریف نشده است." : "No hall yet." }
      : { one: isRtl ? "ورودی" : "entrance", title: isRtl ? "ورودی‌ها" : "Entrances", empty: isRtl ? "هنوز ورودی‌ای تعریف نشده است." : "No entrance yet." };

  const savePlace = async (target: VenuePlaceOut | { kind: VenuePlaceKind }, name: string, location: string): Promise<string | null> => {
    const result =
      "id" in target
        ? await client.PATCH("/api/events/{event_id}/venue-places/{place_id}", {
            params: { path: { event_id: eventId, place_id: target.id } },
            body: { name, location },
          })
        : await client.POST("/api/events/{event_id}/venue-places", {
            params: { path: { event_id: eventId } },
            body: { kind: target.kind, name, location },
          });
    if (!result.data) return formatApiError(result.error);
    const saved = result.data;
    setPlaces((prev) => [...prev.filter((p) => p.id !== saved.id), saved]);
    if ("id" in target && saved.kind === "hall") {
      // Sessions show their hall's name: keep it current without reloading the program.
      setSessions((prev) => prev.map((s) => (s.hall_id === saved.id ? { ...s, hall_name: saved.name } : s)));
    }
    setEditing(null);
    setNotice({ tone: "ok", text: isRtl ? `«${saved.name}» ذخیره شد.` : `“${saved.name}” saved.` });
    return null;
  };

  const move = async (list: VenuePlaceOut[], index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length || list.some((p) => busyIds.has(p.id))) return;
    const order = [...list];
    [order[index], order[target]] = [order[target], order[index]];
    // Positions become the list order, so gaps or ties left by earlier changes cannot block a swap.
    const changes = order.map((place, position) => ({ place, position })).filter(({ place, position }) => place.position !== position);
    const ids = changes.map((c) => c.place.id);
    // The row moves right away; a failure reloads the server's order.
    const moved = new Map(changes.map(({ place, position }) => [place.id, position] as const));
    setPlaces((prev) => prev.map((p) => (moved.has(p.id) ? { ...p, position: moved.get(p.id) ?? p.position } : p)));
    setBusy(ids, true);
    const results = await Promise.all(
      changes.map(({ place, position }) =>
        client.PATCH("/api/events/{event_id}/venue-places/{place_id}", {
          params: { path: { event_id: eventId, place_id: place.id } },
          body: { position },
        }),
      ),
    ).catch(() => null);
    setBusy(ids, false);
    const failed = results ? results.find((r) => !r.data) : undefined;
    if (!results || failed) {
      const reason = failed ? formatApiError(failed.error) : isRtl ? "اتصال برقرار نشد." : "No connection.";
      setNotice({ tone: "error", text: isRtl ? `ترتیب ذخیره نشد: ${reason}` : `The order was not saved: ${reason}` });
      await loadPlaces();
      return;
    }
    const updated = new Map<string, VenuePlaceOut>(results.flatMap((r) => (r.data ? [[r.data.id, r.data] as const] : [])));
    setPlaces((prev) => prev.map((p) => updated.get(p.id) ?? p));
  };

  const deletePlace = async (place: VenuePlaceOut) => {
    setBusy([place.id], true);
    const { error, response } = await client.DELETE("/api/events/{event_id}/venue-places/{place_id}", {
      params: { path: { event_id: eventId, place_id: place.id } },
    });
    setBusy([place.id], false);
    if (!response.ok) {
      setNotice({ tone: "error", text: isRtl ? `حذف نشد: ${formatApiError(error)}` : `Not deleted: ${formatApiError(error)}` });
      return;
    }
    setPlaces((prev) => prev.filter((p) => p.id !== place.id));
    setSessions((prev) => prev.map((s) => (s.hall_id === place.id ? { ...s, hall_id: null, hall_name: "" } : s)));
    setNotice({ tone: "ok", text: isRtl ? `«${place.name}» حذف شد.` : `“${place.name}” deleted.` });
  };

  const renderList = (kind: VenuePlaceKind, icon: IconName, description: string) => {
    const list = places.filter((p) => p.kind === kind).sort(byPosition);
    const copy = kindCopy(kind);
    const headingId = `venue-${kind}-title`;
    return (
      <section aria-labelledby={headingId} className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 id={headingId} className="flex items-center gap-2 text-lg font-bold text-text-primary">
              <Icon name={icon} size={20} className="text-aiteb-indigo/70" />
              {copy.title}
              <span className="text-sm font-semibold text-text-muted">({fmt(list.length)})</span>
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{description}</p>
          </div>
          <Button type="button" variant="secondary" size="md" onClick={() => setEditing({ kind })}>
            <Icon name="plus" size={18} />
            {isRtl ? `افزودن ${copy.one}` : `Add ${copy.one}`}
          </Button>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={icon} title={copy.empty} />
        ) : (
          <ol className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
            {list.map((place, index) => {
              const busy = busyIds.has(place.id);
              const used = kind === "hall" ? sessionsIn(place.id) : 0;
              return (
                <li key={place.id} data-testid={`venue-${kind}`} className="flex flex-wrap items-start gap-3 px-4 py-3.5 sm:flex-nowrap sm:items-center sm:px-5">
                  <span aria-hidden="true" className="mt-0.5 font-mono text-[0.6875rem] font-medium text-aiteb-indigo sm:mt-0">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-words text-sm font-bold text-text-primary">
                      <bdi>{place.name}</bdi>
                    </p>
                    {place.location && (
                      <p dir="auto" className="break-words text-xs leading-relaxed text-text-secondary">
                        {place.location}
                      </p>
                    )}
                    {kind === "hall" && (
                      <p className="text-xs text-text-muted">{isRtl ? `${fmt(used)} جلسه در این سالن` : `${used} ${used === 1 ? "session" : "sessions"} in this hall`}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-disabled={busy || index === 0}
                      onClick={() => void move(list, index, -1)}
                      aria-label={isRtl ? `انتقال «${place.name}» به بالا` : `Move “${place.name}” up`}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                    >
                      <Icon name="arrow-up" size={16} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-disabled={busy || index === list.length - 1}
                      onClick={() => void move(list, index, 1)}
                      aria-label={isRtl ? `انتقال «${place.name}» به پایین` : `Move “${place.name}” down`}
                      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
                    >
                      <Icon name="arrow-down" size={16} />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(place)} aria-label={isRtl ? `ویرایش ${place.name}` : `Edit ${place.name}`}>
                      <Icon name="note" size={16} />
                      <span className="hidden sm:inline">{isRtl ? "ویرایش" : "Edit"}</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteTarget(place)} aria-label={isRtl ? `حذف ${place.name}` : `Delete ${place.name}`}>
                      <Icon name="trash" size={16} />
                      <span className="hidden sm:inline">{isRtl ? "حذف" : "Delete"}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    );
  };

  const deleteUsed = deleteTarget?.kind === "hall" ? sessionsIn(deleteTarget.id) : 0;
  const deleteDescription = !deleteTarget
    ? ""
    : deleteTarget.kind === "hall"
      ? isRtl
        ? `«${deleteTarget.name}» از فهرست سالن‌ها حذف می‌شود. ${deleteUsed ? `${fmt(deleteUsed)} جلسهٔ این سالن در برنامه باقی می‌ماند اما دیگر سالنی ندارد.` : "جلسه‌های برنامه حذف نمی‌شوند."}`
        : `“${deleteTarget.name}” is removed from the halls. ${deleteUsed ? `Its ${deleteUsed} ${deleteUsed === 1 ? "session stays" : "sessions stay"} in the program without a hall.` : "No session is deleted."}`
      : isRtl
        ? `«${deleteTarget.name}» از فهرست ورودی‌ها حذف می‌شود.`
        : `“${deleteTarget.name}” is removed from the entrances.`;

  return (
    <div className="space-y-10">
      <SectionHeader
        index={eventSectionNumber("venue")}
        eyebrow={<bdi>{event.name}</bdi>}
        title={isRtl ? "سالن‌ها و ورودی‌ها" : "Venue"}
        description={
          isRtl
            ? "ورودی‌ها و سالن‌های محل برگزاری با نشانی و راهنمای دسترسی. شرکت‌کنندگان این فهرست را بلافاصله در صفحهٔ همایش و پنل خود می‌بینند."
            : "The venue's entrances and halls with directions. Attendees see this directory on the congress page and in their panel as soon as you save."
        }
      />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
          {notice.text}
        </Notice>
      )}

      {renderList(
        "entrance",
        "gate",
        isRtl ? "درهای ورود به محل همایش؛ مثلاً «ورودی اصلی، خیابان آزادی»." : "Doors into the venue, e.g. “Main entrance, Azadi Street”.",
      )}
      {renderList(
        "hall",
        "congress",
        isRtl
          ? "سالن‌هایی که جلسه‌های برنامه در آن‌ها برگزار می‌شود؛ مثلاً «سالن اصلی، طبقهٔ همکف»."
          : "Rooms where program sessions take place, e.g. “Main hall, ground floor”.",
      )}

      {editing && (
        <VenuePlaceDialog
          key={"id" in editing ? editing.id : `new-${editing.kind}`}
          place={"id" in editing ? editing : null}
          kindLabel={kindCopy(editing.kind).one}
          isRtl={isRtl}
          onSave={(name, location) => savePlace(editing, name, location)}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        tone="danger"
        title={deleteTarget?.kind === "hall" ? (isRtl ? "حذف این سالن؟" : "Delete this hall?") : isRtl ? "حذف این ورودی؟" : "Delete this entrance?"}
        description={deleteDescription}
        confirmLabel={isRtl ? "حذف" : "Delete"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void deletePlace(target);
        }}
      />
    </div>
  );
}

function VenuePlaceDialog({
  place,
  kindLabel,
  isRtl,
  onSave,
  onClose,
}: {
  /** The place being edited, or null to add one. */
  place: VenuePlaceOut | null;
  kindLabel: string;
  isRtl: boolean;
  /** Resolves to an error message, or null when saved (the caller closes the dialog). */
  onSave: (name: string, location: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(place?.name ?? "");
  const [location, setLocation] = useState(place?.location ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(isRtl ? "نام را وارد کنید." : "Enter a name.");
      return;
    }
    setSubmitting(true);
    const failure = await onSave(name.trim(), location.trim());
    setSubmitting(false);
    if (failure) setError(failure);
  };

  return (
    <Dialog isOpen onClose={close} title={place ? (isRtl ? `ویرایش ${kindLabel}` : `Edit ${kindLabel}`) : isRtl ? `افزودن ${kindLabel}` : `Add ${kindLabel}`} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label={isRtl ? "نام" : "Name"} required>
          <input type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className="ui-input" />
        </Field>
        <Field
          label={isRtl ? "محل و راهنمای دسترسی" : "Location and directions"}
          hint={isRtl ? "مثلاً طبقه، ضلع ساختمان یا نزدیک‌ترین ورودی." : "For example the floor, side of the building or nearest entrance."}
        >
          <textarea rows={2} maxLength={300} value={location} onChange={(e) => setLocation(e.target.value)} className="ui-textarea" />
        </Field>
        {error && <FormAlert>{error}</FormAlert>}
        <DialogActions>
          <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={close}>
            {isRtl ? "انصراف" : "Cancel"}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting ? (isRtl ? "در حال ذخیره…" : "Saving…") : isRtl ? "ذخیره" : "Save"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
