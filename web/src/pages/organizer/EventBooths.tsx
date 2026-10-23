import { useState } from "react";
import { localizedApiError, type BoothOut, type EventOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { RowActions, type RowAction } from "../../components/ui/RowActions";
import { EmptyState, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { BoothFormDialog } from "../../components/organizer/BoothFormDialog";
import { BoothQrDialog } from "../../components/organizer/BoothQrDialog";
import { BoothStaffDialog } from "../../components/organizer/BoothStaffDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadBooths, sectionLoad, useEventList } from "./eventLists";

/**
 * `/organizer/events/:eventId/booths`: exhibition booths, their representatives and standee QR codes. Staff see
 * the representatives; managers change booths and representatives; an archived congress is read-only.
 */
export default function EventBooths() {
  const { eventId, client, locale, can, canEdit } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].booths;
  const common = commonCopy[locale];
  const booths = useEventList(loadBooths);
  const lists = sectionLoad([booths]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBooth, setEditingBooth] = useState<BoothOut | null>(null);
  const [staffBooth, setStaffBooth] = useState<BoothOut | null>(null);
  const [qrBooth, setQrBooth] = useState<BoothOut | null>(null);
  const [deletingBoothId, setDeletingBoothId] = useState<string | null>(null);

  const deleteBooth = async (booth: BoothOut) => {
    if (!client) return;
    setDeletingBoothId(booth.id);
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/booths/{booth_id}", {
      params: { path: { event_id: eventId, booth_id: booth.id } },
    });
    setDeletingBoothId(null);
    if (response.ok) {
      booths.setItems((prev) => prev.filter((b) => b.id !== booth.id));
      setNotice({ tone: "ok", text: copy.deleted(booth.name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
    }
  };

  const body = (ev: EventOut) => {
    const addBooth = canEdit ? <AddButton label={copy.add} onClick={() => setIsCreateOpen(true)} /> : undefined;
    const boothPage = (booth: BoothOut) => `/e/${encodeURIComponent(ev.slug)}/booths/${booth.id}`;

    const menu = (booth: BoothOut): RowAction[] => {
      const items: RowAction[] = [{ label: copy.view, icon: "arrow-up-right", onSelect: () => window.open(boothPage(booth), "_blank", "noopener") }];
      if (canEdit) {
        items.push({ label: common.edit, icon: "note", onSelect: () => setEditingBooth(booth) });
        items.push({
          label: common.delete,
          icon: "trash",
          disabled: deletingBoothId === booth.id,
          onSelect: () => void deleteBooth(booth),
          destructive: { title: copy.deleteTitle(booth.name), description: copy.deleteBody, confirmLabel: common.delete },
        });
      }
      return items;
    };

    return (
      <div className="space-y-6">
        <SectionHeader title={copy.title} action={addBooth} />

        <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
        <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

        {booths.error ? null : booths.items.length === 0 ? (
          <EmptyState icon="booth" title={copy.empty} action={addBooth} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {booths.items.map((b) => (
              <article key={b.id} aria-labelledby={`booth-title-${b.id}`} className="flex flex-col rounded-card border border-border-default bg-surface-panel">
                <div className="flex-1 space-y-1.5 p-5">
                  <h3 id={`booth-title-${b.id}`} className="break-words text-body font-bold text-text-primary">
                    <bdi>{b.name}</bdi>
                  </h3>
                  {b.location && (
                    <Badge variant="neutral" size="sm" icon={<Icon name="pin" size={12} />}>
                      <bdi>{b.location}</bdi>
                    </Badge>
                  )}
                  {b.description && (
                    <p className="line-clamp-2 text-caption text-text-secondary">
                      <bdi>{b.description}</bdi>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {can("staff") && (
                      <Button type="button" variant="secondary" size="sm" icon="users" onClick={() => setStaffBooth(b)}>
                        {copy.representatives}
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" icon="qr" onClick={() => setQrBooth(b)}>
                      {copy.qr}
                    </Button>
                  </div>
                  <RowActions visible={0} menuLabel={copy.moreActions(b.name)} actions={menu(b)} />
                </div>
              </article>
            ))}
          </div>
        )}

        <BoothQrDialog booth={qrBooth} eventName={ev.name} onClose={() => setQrBooth(null)} />
      </div>
    );
  };

  return (
    <>
      <EventSectionGate listsLoaded={lists.loaded}>{body}</EventSectionGate>
      <BoothFormDialog
        mode="create"
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          booths.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: copy.created(created.name) });
        }}
      />
      <BoothFormDialog
        mode="edit"
        booth={editingBooth}
        onClose={() => setEditingBooth(null)}
        onSaved={(saved) => {
          booths.setItems((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
          setEditingBooth(null);
          setNotice({ tone: "ok", text: copy.saved(saved.name) });
        }}
      />
      <BoothStaffDialog booth={staffBooth} onClose={() => setStaffBooth(null)} />
    </>
  );
}
