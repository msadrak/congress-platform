import React, { useState } from "react";
import { localizedApiError, type EventSessionOut, type VenuePlaceKind, type VenuePlaceOut } from "../api/client";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { RowActions } from "../components/ui/RowActions";
import { Field } from "../components/ui/Field";
import { TextInput, Textarea } from "../components/ui/Input";
import { EmptyState } from "../components/ui/StateBlock";
import { SectionHeader } from "../components/ui/PageHeader";
import { FormAlert } from "../components/organizer/WorkspaceUi";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { commonCopy } from "../copy/common";
import { organizerProgramCopy } from "../copy/organizerProgram";
import { formatNumber } from "../lib/format";
import { SectionNotice, type SectionNoticeState } from "./organizer/EventSectionUi";
import type { EventList } from "./organizer/eventLists";

/** The API's order within a kind: position, then creation. */
const byPosition = (a: VenuePlaceOut, b: VenuePlaceOut) => a.position - b.position || a.created_at.localeCompare(b.created_at);

interface VenueDirectoryProps {
  places: EventList<VenuePlaceOut>;
  /** The program's sessions: halls show how many use them, and keep their hall name current. */
  sessions: EventList<EventSessionOut>;
}

/** Halls and entrances of the venue: a tab of the program. Viewers and archived congresses only read it. */
export function VenueDirectory({ places, sessions }: VenueDirectoryProps) {
  const { eventId, client, canEdit, locale } = useEventWorkspace();
  const c = organizerProgramCopy[locale].venue;
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  /** The place in the form dialog: a kind to add one, an existing place to edit it, null when closed. */
  const [editing, setEditing] = useState<VenuePlaceOut | { kind: VenuePlaceKind } | null>(null);
  /** Places with a request in flight (reorder, delete): their controls are disabled meanwhile. */
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const fmt = (n: number) => formatNumber(n, locale);
  const setBusy = (ids: string[], busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (busy) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const sessionsIn = (hallId: string) => sessions.items.filter((s) => s.hall_id === hallId).length;

  const savePlace = async (target: VenuePlaceOut | { kind: VenuePlaceKind }, name: string, location: string): Promise<string | null> => {
    if (!client) return commonCopy[locale].generic;
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
    if (!result.data) return localizedApiError(result.error, locale, result.response.status);
    const saved = result.data;
    places.setItems((prev) => [...prev.filter((p) => p.id !== saved.id), saved]);
    if ("id" in target && saved.kind === "hall") {
      // Sessions show their hall's name: keep it current without reloading the program.
      sessions.setItems((prev) => prev.map((s) => (s.hall_id === saved.id ? { ...s, hall_name: saved.name } : s)));
    }
    setEditing(null);
    setNotice({ tone: "ok", text: c.saved(saved.name) });
    return null;
  };

  const move = async (list: VenuePlaceOut[], index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (!client || target < 0 || target >= list.length || list.some((p) => busyIds.has(p.id))) return;
    const order = [...list];
    [order[index], order[target]] = [order[target], order[index]];
    // Positions become the list order, so gaps or ties left by earlier changes cannot block a swap.
    const changes = order.map((place, position) => ({ place, position })).filter(({ place, position }) => place.position !== position);
    const ids = changes.map((change) => change.place.id);
    // The row moves right away; a failure reloads the server's order.
    const moved: Record<string, number> = {};
    for (const { place, position } of changes) moved[place.id] = position;
    places.setItems((prev) => prev.map((p) => (p.id in moved ? { ...p, position: moved[p.id] } : p)));
    setBusy(ids, true);
    const results = await Promise.all(
      changes.map(({ place, position }) =>
        client.PATCH("/api/events/{event_id}/venue-places/{place_id}", {
          params: { path: { event_id: eventId, place_id: place.id } },
          body: { position },
        }),
      ),
    );
    setBusy(ids, false);
    const failed = results.find((r) => !r.data);
    if (failed) {
      setNotice({ tone: "error", text: c.orderFailed(localizedApiError(failed.error, locale, failed.response.status)) });
      places.reload();
      return;
    }
    const updated: Record<string, VenuePlaceOut> = {};
    for (const r of results) if (r.data) updated[r.data.id] = r.data;
    places.setItems((prev) => prev.map((p) => updated[p.id] ?? p));
  };

  const deletePlace = async (place: VenuePlaceOut) => {
    if (!client) return;
    setBusy([place.id], true);
    const { error, response } = await client.DELETE("/api/events/{event_id}/venue-places/{place_id}", {
      params: { path: { event_id: eventId, place_id: place.id } },
    });
    setBusy([place.id], false);
    if (!response.ok) {
      setNotice({ tone: "error", text: c.deleteFailed(localizedApiError(error, locale, response.status)) });
      return;
    }
    places.setItems((prev) => prev.filter((p) => p.id !== place.id));
    sessions.setItems((prev) => prev.map((s) => (s.hall_id === place.id ? { ...s, hall_id: null, hall_name: "" } : s)));
    setNotice({ tone: "ok", text: c.deleted(place.name) });
  };

  const renderList = (kind: VenuePlaceKind) => {
    const list = places.items.filter((p) => p.kind === kind).sort(byPosition);
    const headingId = `venue-${kind}-title`;
    const hall = kind === "hall";
    return (
      <section aria-labelledby={headingId} className="space-y-3">
        <SectionHeader
          id={headingId}
          title={`${hall ? c.halls : c.entrances} (${fmt(list.length)})`}
          action={
            canEdit ? (
              <Button type="button" variant={hall ? "primary" : "secondary"} size="md" icon="plus" onClick={() => setEditing({ kind })}>
                {hall ? c.addHall : c.addEntrance}
              </Button>
            ) : undefined
          }
        />
        {list.length === 0 ? (
          <EmptyState icon={hall ? "congress" : "gate"} title={hall ? c.noHalls : c.noEntrances} />
        ) : (
          <ol className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-default bg-surface-panel">
            {list.map((place, index) => {
              const busy = busyIds.has(place.id);
              const used = hall ? sessionsIn(place.id) : 0;
              return (
                <li key={place.id} data-testid={`venue-${kind}`} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-5">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="break-words text-body-sm font-semibold text-text-primary">
                      <bdi>{place.name}</bdi>
                    </p>
                    {(place.location || hall) && (
                      <p className="break-words text-meta text-text-secondary">
                        {place.location && <bdi>{place.location}</bdi>}
                        {place.location && hall && " · "}
                        {hall && c.sessionsIn(fmt(used))}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton
                        icon="arrow-up"
                        label={c.moveUp(place.name)}
                        size="sm"
                        disabled={busy || index === 0}
                        onClick={() => void move(list, index, -1)}
                      />
                      <IconButton
                        icon="arrow-down"
                        label={c.moveDown(place.name)}
                        size="sm"
                        disabled={busy || index === list.length - 1}
                        onClick={() => void move(list, index, 1)}
                      />
                      <RowActions
                        visible={1}
                        menuLabel={c.more(place.name)}
                        actions={[
                          { label: commonCopy[locale].edit, icon: "note", disabled: busy, onSelect: () => setEditing(place) },
                          {
                            label: commonCopy[locale].delete,
                            icon: "trash",
                            disabled: busy,
                            onSelect: () => void deletePlace(place),
                            destructive: {
                              title: c.deleteTitle(place.name),
                              description: hall ? c.deleteHallBody(used ? fmt(used) : null) : c.deleteEntranceBody,
                              confirmLabel: commonCopy[locale].delete,
                            },
                          },
                        ]}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-8">
      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      {renderList("hall")}
      {renderList("entrance")}
      {editing && (
        <VenuePlaceDialog
          key={"id" in editing ? editing.id : `new-${editing.kind}`}
          place={"id" in editing ? editing : null}
          kind={editing.kind}
          onSave={(name, location) => savePlace(editing, name, location)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function VenuePlaceDialog({
  place,
  kind,
  onSave,
  onClose,
}: {
  /** The place being edited, or null to add one. */
  place: VenuePlaceOut | null;
  kind: VenuePlaceKind;
  /** Resolves to an error message, or null when saved (the caller closes the dialog). */
  onSave: (name: string, location: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { locale } = useEventWorkspace();
  const c = organizerProgramCopy[locale].venue;
  const common = commonCopy[locale];
  const [name, setName] = useState(place?.name ?? "");
  const [location, setLocation] = useState(place?.location ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const hall = kind === "hall";
  const title = place ? (hall ? c.editHall : c.editEntrance) : hall ? c.newHall : c.newEntrance;

  const close = () => {
    if (!submitting) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setNameError(c.nameRequired);
      return;
    }
    setNameError(null);
    setSubmitting(true);
    const failure = await onSave(name.trim(), location.trim());
    setSubmitting(false);
    if (failure) setError(failure);
  };

  return (
    <Dialog
      isOpen
      onClose={close}
      title={title}
      size="md"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={submitting} onClick={close}>
            {common.cancel}
          </Button>
          <Button type="submit" form="venue-place-form" variant="primary" loading={submitting}>
            {place ? common.save : common.add}
          </Button>
        </div>
      }
    >
      <form id="venue-place-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label={c.name} required error={nameError}>
          <TextInput type="text" required maxLength={120} value={name} placeholder={hall ? c.namePlaceholder : undefined} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={c.location}>
          <Textarea rows={2} maxLength={300} value={location} placeholder={c.locationPlaceholder} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        {error && <FormAlert>{error}</FormAlert>}
      </form>
    </Dialog>
  );
}
