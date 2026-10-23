import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorCode, localizedApiError, type EventOut } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { Icon } from "../../components/ui/Icon";
import { DialogActions, MetaItem } from "../../components/organizer/WorkspaceUi";
import { eventTimeZone, sessionDateFormats } from "../../components/organizer/sessionTime";
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
  /** Passes reserved across the tiers: a congress that issued tickets is never offered for deletion. */
  reservedCount: number;
  onEdit: () => void;
  onNotice: (notice: SectionNoticeState) => void;
}

/**
 * The congress's settings at a glance (time zone, registration, home listing, archive state) with the actions
 * that change them: edit, archive or unarchive, and delete while it has no tickets.
 */
export function EventSettingsPanel({ event, reservedCount, onEdit, onNotice }: EventSettingsPanelProps) {
  const { client, replaceEvent, locale, isRtl, can } = useEventWorkspace();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  /** Why a delete was refused (localized), while the "archive instead" dialog is open. */
  const [deleteRefused, setDeleteRefused] = useState<string | null>(null);

  const archived = event.archived_at != null;
  const canManage = can("manager");
  const zone = eventTimeZone(event);
  const formats = sessionDateFormats(locale, zone);
  const at = (iso: string) => `${formats.shortDay.format(new Date(iso))} ${formats.time.format(new Date(iso))}`;
  const registrationWindow =
    event.registration_opens_at || event.registration_closes_at
      ? [
          event.registration_opens_at ? `${isRtl ? "از" : "from"} ${at(event.registration_opens_at)}` : "",
          event.registration_closes_at ? `${isRtl ? "تا" : "until"} ${at(event.registration_closes_at)}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : isRtl
        ? "بدون محدودیت زمانی"
        : "No time limit";

  const setArchived = async (next: boolean) => {
    if (!client) return;
    setBusy(true);
    const { data, error } = await client.POST("/api/events/{event_id}/archive", {
      params: { path: { event_id: event.id } },
      body: { archived: next },
    });
    setBusy(false);
    if (data) {
      replaceEvent(data);
      onNotice({
        tone: "ok",
        text: next
          ? isRtl
            ? "همایش بایگانی شد؛ از سایت عمومی برداشته شد و فقط‌خواندنی است."
            : "The congress is archived: it is off the public site and read-only."
          : isRtl
            ? "همایش از بایگانی خارج شد و دوباره قابل ویرایش است."
            : "The congress is unarchived and can be edited again.",
      });
    } else {
      onNotice({ tone: "error", text: localizedApiError(error, locale) });
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
    if (code && ARCHIVE_INSTEAD.includes(code)) setDeleteRefused(localizedApiError(error, locale));
    else onNotice({ tone: "error", text: localizedApiError(error, locale) });
  };

  return (
    <section aria-labelledby="event-settings-title" className="rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-7" data-testid="event-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="event-settings-title" className="flex items-center gap-2 text-base font-bold tracking-tight text-text-primary">
          <Icon name="sliders" size={20} className="text-aiteb-indigo/70" />
          {isRtl ? "تنظیمات همایش" : "Congress settings"}
        </h2>
        {canManage && !archived && (
          <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
            <Icon name="note" size={16} />
            {isRtl ? "ویرایش تنظیمات" : "Edit settings"}
          </Button>
        )}
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetaItem label={isRtl ? "منطقهٔ زمانی" : "Time zone"}>
          <bdi dir="ltr" className="font-mono text-[0.8125rem]">
            {zone}
          </bdi>
        </MetaItem>
        <MetaItem label={isRtl ? "ثبت‌نام" : "Registration"}>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={event.registration_enabled ? "success" : "neutral"} size="sm">
              {event.registration_enabled ? (isRtl ? "باز" : "Open") : isRtl ? "بسته" : "Closed"}
            </Badge>
            {event.registration_enabled && <span className="text-xs font-normal text-text-secondary">{registrationWindow}</span>}
          </span>
        </MetaItem>
        <MetaItem label={isRtl ? "صفحهٔ اصلی عمومی" : "Public home"}>
          {event.listed ? (isRtl ? "در فهرست همایش‌ها" : "Listed") : isRtl ? "فهرست نشده" : "Not listed"}
        </MetaItem>
        <MetaItem label={isRtl ? "وضعیت" : "State"}>
          <Badge variant={archived ? "warning" : "success"} size="sm" icon={archived ? <Icon name="lock" size={12} /> : undefined}>
            {archived ? (isRtl ? "بایگانی‌شده" : "Archived") : isRtl ? "فعال" : "Active"}
          </Badge>
        </MetaItem>
      </dl>

      {canManage && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-5">
          {archived ? (
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void setArchived(false)}>
              <Icon name="sync" size={16} />
              {isRtl ? "خارج کردن از بایگانی" : "Unarchive"}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm("archive")}>
              <Icon name="lock" size={16} />
              {isRtl ? "بایگانی همایش" : "Archive congress"}
            </Button>
          )}
          {reservedCount === 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm("delete")}
              className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
            >
              <Icon name="trash" size={16} />
              {isRtl ? "حذف همایش" : "Delete congress"}
            </Button>
          )}
          <p className="w-full text-xs leading-relaxed text-text-muted">
            {reservedCount === 0
              ? isRtl
                ? "همایشی که هنوز کارت ورودی صادر نکرده است حذف می‌شود؛ پس از صدور کارت ورود فقط می‌توان آن را بایگانی کرد."
                : "A congress that has not issued a ticket can be deleted; once it has, it can only be archived."
              : isRtl
                ? "این همایش کارت ورود صادر کرده است و حذف نمی‌شود؛ برای کنار گذاشتنش آن را بایگانی کنید."
                : "This congress has issued tickets and cannot be deleted; archive it to set it aside."}
          </p>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirm === "archive"}
        title={isRtl ? "این همایش بایگانی شود؟" : "Archive this congress?"}
        description={
          isRtl
            ? "صفحهٔ عمومی و صفحه‌های غرفه‌های آن از دسترس خارج می‌شود، رزرو تازه پذیرفته نمی‌شود و همهٔ تنظیماتش فقط‌خواندنی می‌شود. کارت‌های ورود، ورودها و داده‌ها حفظ می‌شوند و هر زمان می‌توانید آن را از بایگانی خارج کنید."
            : "Its public page and booth pages go offline, it takes no new reservations and all its settings become read-only. Tickets, check-ins and data are kept, and you can unarchive it at any time."
        }
        confirmLabel={isRtl ? "بایگانی" : "Archive"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void setArchived(true);
        }}
      />
      <ConfirmDialog
        isOpen={confirm === "delete"}
        tone="danger"
        title={isRtl ? "این همایش برای همیشه حذف شود؟" : "Delete this congress permanently?"}
        description={
          isRtl
            ? `«${event.name}» همراه با انواع کارت ورود، غرفه‌ها، نقاط ورود، اپراتورها، برنامه، صفحهٔ عمومی و فایل‌هایش حذف می‌شود. این کار برگشت‌پذیر نیست.`
            : `“${event.name}” is deleted with its ticket tiers, booths, check-in points, operators, program, public page and files. This cannot be undone.`
        }
        confirmLabel={isRtl ? "حذف همایش" : "Delete congress"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          void deleteEvent();
        }}
      />
      <Dialog
        isOpen={deleteRefused !== null}
        onClose={() => setDeleteRefused(null)}
        title={isRtl ? "این همایش حذف نمی‌شود" : "This congress cannot be deleted"}
        description={deleteRefused ?? undefined}
        size="sm"
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          {isRtl
            ? "بایگانی، همایش را از سایت عمومی برمی‌دارد و فقط‌خواندنی می‌کند، اما کارت‌های ورود و سوابق آن را نگه می‌دارد."
            : "Archiving takes the congress off the public site and makes it read-only, while keeping its tickets and records."}
        </p>
        <div className="mt-5">
          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setDeleteRefused(null)}>
              {isRtl ? "بستن" : "Close"}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={busy || archived}
              onClick={() => {
                setDeleteRefused(null);
                void setArchived(true);
              }}
            >
              <Icon name="lock" size={16} />
              {isRtl ? "بایگانی به‌جای حذف" : "Archive instead"}
            </Button>
          </DialogActions>
        </div>
      </Dialog>
    </section>
  );
}
