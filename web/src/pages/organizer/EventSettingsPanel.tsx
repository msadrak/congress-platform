import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorCode, localizedApiError, type EventOut } from "../../api/client";
import { formatDate, timeZoneLabel } from "../../lib/format";
import { organizerCopy } from "../../copy/organizer";
import { commonCopy } from "../../copy/common";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { MetaList } from "../../components/ui/MetaList";
import { RowActions, type RowAction } from "../../components/ui/RowActions";
import { DialogActions } from "../../components/organizer/WorkspaceUi";
import { eventTimeZone } from "../../components/organizer/sessionTime";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import type { SectionNoticeState } from "./EventSectionUi";

/** Codes of a delete the API refused because the congress has history: it can only be archived. */
const ARCHIVE_INSTEAD = ["EVENT_HAS_TICKETS", "EVENT_HAS_RECORDS"];

/** Navigation state the events list reads to announce a deleted congress. */
export interface DeletedEventNotice {
  deletedEventName: string;
}

interface EventSettingsPanelProps {
  event: EventOut;
  /** Passes reserved across the pass types: a congress that issued passes is never offered for deletion. */
  reservedCount: number;
  onEdit: () => void;
  onNotice: (notice: SectionNoticeState) => void;
}

/**
 * The congress settings at a glance (time zone, registration, home listing) and the one place that changes
 * them: edit and archive, and delete (in ⋯, confirmed) while it has no passes. Unarchiving lives on the
 * archived banner of the section gate.
 */
export function EventSettingsPanel({ event, reservedCount, onEdit, onNotice }: EventSettingsPanelProps) {
  const { client, replaceEvent, locale, can, canEdit } = useEventWorkspace();
  const copy = organizerCopy[locale].settings;
  const status = commonCopy[locale].status;
  const navigate = useNavigate();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Why a delete was refused (localized), while the "archive instead" dialog is open. */
  const [deleteRefused, setDeleteRefused] = useState<string | null>(null);

  const archived = event.archived_at != null;
  const zone = eventTimeZone(event);
  const at = (iso: string | null) => (iso ? formatDate(iso, "dayTime", locale, zone) : "");
  const registrationWindow = copy.window(at(event.registration_opens_at), at(event.registration_closes_at)) || copy.noLimit;

  const archive = async () => {
    if (!client) return;
    setBusy(true);
    const { data, error, response } = await client.POST("/api/events/{event_id}/archive", {
      params: { path: { event_id: event.id } },
      body: { archived: true },
    });
    setBusy(false);
    if (data) {
      replaceEvent(data);
      onNotice({ tone: "ok", text: copy.archived });
    } else {
      onNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
    }
  };

  const deleteEvent = async () => {
    if (!client) return;
    setBusy(true);
    const { error, response } = await client.DELETE("/api/events/{event_id}", { params: { path: { event_id: event.id } } });
    setBusy(false);
    if (response.ok) {
      const state: DeletedEventNotice = { deletedEventName: event.name };
      navigate("/organizer", { state });
      return;
    }
    const code = apiErrorCode(error);
    if (code && ARCHIVE_INSTEAD.includes(code) && !archived) setDeleteRefused(localizedApiError(error, locale, response.status));
    else onNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
  };

  const actions: RowAction[] = [
    ...(canEdit
      ? [
          { label: commonCopy[locale].edit, icon: "note" as const, onSelect: onEdit, disabled: busy },
          { label: copy.archive, icon: "lock" as const, onSelect: () => setConfirmArchive(true), disabled: busy },
        ]
      : []),
    ...(can("manager") && reservedCount === 0
      ? [
          {
            label: copy.deleteAction,
            icon: "trash" as const,
            onSelect: () => void deleteEvent(),
            disabled: busy,
            destructive: { title: copy.deleteTitle, description: copy.deleteBody(event.name), confirmLabel: commonCopy[locale].delete },
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="event-settings-title" className="rounded-card border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6" data-testid="event-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="event-settings-title" className="text-title-sm font-bold text-text-primary">
          {copy.title}
        </h2>
        {actions.length > 0 && <RowActions actions={actions} menuLabel={copy.moreActions} />}
      </div>

      <MetaList
        className="mt-4"
        columns={3}
        items={[
          { label: copy.timeZone, value: <span title={zone}>{timeZoneLabel(zone, locale)}</span> },
          {
            label: copy.registration,
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={event.registration_enabled ? "success" : "neutral"} size="sm">
                  {event.registration_enabled ? status.open : status.closed}
                </Badge>
                {event.registration_enabled && <span className="text-meta font-normal text-text-secondary">{registrationWindow}</span>}
              </span>
            ),
          },
          { label: copy.home, value: event.listed ? copy.listed : copy.notListed },
        ]}
      />

      <ConfirmDialog
        isOpen={confirmArchive}
        title={copy.archiveTitle}
        description={copy.archiveBody}
        confirmLabel={copy.archive}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          void archive();
        }}
      />
      <Dialog isOpen={deleteRefused !== null} onClose={() => setDeleteRefused(null)} title={copy.refusedTitle} size="sm">
        <p className="text-body-sm leading-relaxed text-text-secondary">{deleteRefused}</p>
        <div className="mt-5">
          <DialogActions>
            <Button type="button" variant="ghost" onClick={() => setDeleteRefused(null)}>
              {commonCopy[locale].close}
            </Button>
            <Button
              type="button"
              variant="primary"
              icon="lock"
              loading={busy}
              onClick={() => {
                setDeleteRefused(null);
                void archive();
              }}
            >
              {copy.archiveInstead}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </section>
  );
}
