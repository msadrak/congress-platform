import { useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import { localizedApiError, type BoothOut } from "../../api/client";
import { eventSectionNumber } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Icon } from "../../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { BoothFormDialog } from "../../components/organizer/BoothFormDialog";
import { BoothQrDialog } from "../../components/organizer/BoothQrDialog";
import { BoothStaffDialog } from "../../components/organizer/BoothStaffDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadBooths, sectionLoad, useEventList } from "./eventLists";

/** `/organizer/events/:eventId/booths`: exhibition booths, their representatives and standee QR codes. */
export default function EventBooths() {
  const { event, error, eventId, client, locale, t, isRtl, can } = useEventWorkspace();
  const canManage = can("manager");
  // Listing a booth's representatives needs the staff role (backend/app/roles.py).
  const canSeeStaff = can("staff");
  const booths = useEventList(loadBooths);
  const lists = sectionLoad([booths]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBooth, setEditingBooth] = useState<BoothOut | null>(null);
  const [assigningBooth, setAssigningBooth] = useState<BoothOut | null>(null);
  const [selectedBoothQr, setSelectedBoothQr] = useState<BoothOut | null>(null);
  const [deleteBoothTarget, setDeleteBoothTarget] = useState<BoothOut | null>(null);
  const [deletingBoothId, setDeletingBoothId] = useState<string | null>(null);

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const handleDeleteBooth = async (booth: BoothOut) => {
    if (!eventId || !client) return;
    setDeletingBoothId(booth.id);
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/booths/{booth_id}", {
      params: { path: { event_id: eventId, booth_id: booth.id } },
    });
    setDeletingBoothId(null);
    if (response.ok) {
      booths.setItems((prev) => prev.filter((b) => b.id !== booth.id));
      setNotice({ tone: "ok", text: isRtl ? `غرفه «${booth.name}» حذف شد.` : `Booth “${booth.name}” deleted.` });
    } else {
      setNotice({ tone: "error", text: isRtl ? `غرفه حذف نشد: ${localizedApiError(err, locale)}` : `The booth was not deleted: ${localizedApiError(err, locale)}` });
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const addBooth = canManage ? <AddButton label={t.createBoothButton} onClick={() => setIsCreateOpen(true)} /> : undefined;
  // The card's thumbnail encodes the public booth page; the printable standee (with its bookmark secret) is
  // fetched from the API by BoothQrDialog.
  const boothPageUrl = (booth: BoothOut) => `${window.location.origin}/e/${encodeURIComponent(event.slug)}/booths/${booth.id}`;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("booths")} eyebrow={<bdi>{event.name}</bdi>} title={t.boothsHeading} description={t.boothsDesc} action={addBooth} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {booths.error ? (
        <FormAlert>{t.sectionLoadFailed}</FormAlert>
      ) : booths.items.length === 0 ? (
        <EmptyState icon="booth" title={t.noBoothsTitle} action={addBooth} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {booths.items.map((b) => (
            <div key={b.id} className="flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
              <div className="flex flex-1 gap-4 p-5 sm:p-6">
                <div aria-hidden="true" className="org-plate size-[4.5rem] shrink-0 rounded-lg p-1.5 ring-1 ring-border-default">
                  <QRCode value={boothPageUrl(b)} size={64} level="M" viewBox="0 0 256 256" fgColor="#0F172A" bgColor="#FFFFFF" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {b.location && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="neutral" size="sm" icon={<Icon name="pin" size={12} />}>
                        <bdi>{b.location}</bdi>
                      </Badge>
                    </div>
                  )}
                  <h3 className="break-words text-base font-bold leading-snug text-text-primary">
                    <bdi>{b.name}</bdi>
                  </h3>
                  <p className="font-mono text-[0.6875rem] text-text-muted">
                    <bdi dir="ltr">/booth/{b.id.slice(0, 8)}</bdi>
                  </p>
                  {b.description && (
                    <p className="line-clamp-2 pt-1 text-xs leading-relaxed text-text-secondary">
                      <bdi>{b.description}</bdi>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-3.5 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  {canSeeStaff && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setAssigningBooth(b)}>
                      <Icon name={canManage ? "user-plus" : "users"} size={16} />
                      <span>{canManage ? t.assignStaffButton : isRtl ? "نمایندگان" : "Representatives"}</span>
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedBoothQr(b)}>
                    <Icon name="qr" size={16} />
                    <span>{t.standeeQrButton}</span>
                  </Button>
                  {canManage && (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingBooth(b)} aria-label={isRtl ? `ویرایش غرفه ${b.name}` : `Edit booth ${b.name}`}>
                        <Icon name="note" size={16} />
                        <span>{isRtl ? "ویرایش" : "Edit"}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deletingBoothId === b.id}
                        onClick={() => setDeleteBoothTarget(b)}
                        aria-label={isRtl ? `حذف غرفه ${b.name}` : `Delete booth ${b.name}`}
                        className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                      >
                        <Icon name="trash" size={16} />
                        <span>{isRtl ? "حذف" : "Delete"}</span>
                      </Button>
                    </>
                  )}
                </div>
                <Link
                  to={`/e/${event.slug}/booths/${b.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-1 text-[13px] font-semibold text-action-primary hover:underline"
                >
                  {t.viewBoothAction}
                  <Icon name="arrow-up-right" size={14} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <BoothFormDialog
        mode="create"
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          booths.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: isRtl ? `غرفه «${created.name}» ایجاد شد.` : `Booth “${created.name}” created.` });
        }}
      />

      <BoothStaffDialog booth={assigningBooth} onClose={() => setAssigningBooth(null)} />

      <BoothQrDialog booth={selectedBoothQr} eventName={event.name} onClose={() => setSelectedBoothQr(null)} />

      <BoothFormDialog
        mode="edit"
        booth={editingBooth}
        onClose={() => setEditingBooth(null)}
        onSaved={(saved) => {
          booths.setItems((prev) => prev.map((b) => (b.id === saved.id ? saved : b)));
          setEditingBooth(null);
          setNotice({ tone: "ok", text: isRtl ? `غرفه «${saved.name}» ذخیره شد.` : `Booth “${saved.name}” saved.` });
        }}
      />

      {/* Confirmations render last so they always stack above any open form dialog. */}
      <ConfirmDialog
        isOpen={deleteBoothTarget !== null}
        tone="danger"
        title={isRtl ? "حذف این غرفه؟" : "Delete this booth?"}
        description={
          deleteBoothTarget
            ? isRtl
              ? `غرفه «${deleteBoothTarget.name}» برای همیشه حذف می‌شود؛ همراه با نمایندگان تخصیص‌یافته، نشان‌گذاری‌های شرکت‌کنندگان و همهٔ لیدهای ثبت‌شدهٔ آن. کیوآرکد استند آن هم دیگر کار نمی‌کند. این کار برگشت‌پذیر نیست.`
              : `“${deleteBoothTarget.name}” is permanently deleted together with its staff assignments, attendees' saved bookmarks and all captured leads. Its standee QR code stops working. This cannot be undone.`
            : ""
        }
        confirmLabel={isRtl ? "حذف غرفه" : "Delete booth"}
        cancelLabel={cancelLabel}
        onCancel={() => setDeleteBoothTarget(null)}
        onConfirm={() => {
          const target = deleteBoothTarget;
          setDeleteBoothTarget(null);
          if (target) void handleDeleteBooth(target);
        }}
      />
    </div>
  );
}
