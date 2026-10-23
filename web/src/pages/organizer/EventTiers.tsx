import { useState } from "react";
import { apiErrorCode, localizedApiError, type TicketTierOut } from "../../api/client";
import { formatLocalizedNumber } from "../../lib/i18n";
import { eventSectionNumber } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Dialog } from "../../components/ui/Dialog";
import { Icon } from "../../components/ui/Icon";
import { DialogActions, EmptyState, FormAlert, Meter, SectionHeader, SectionIndex } from "../../components/organizer/WorkspaceUi";
import { eventTimeZone, sessionDateFormats } from "../../components/organizer/sessionTime";
import { TierFormDialog } from "../../components/organizer/TierFormDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/** `/organizer/events/:eventId/tiers`: ticket tiers, their quotas and how full they are. */
export default function EventTiers() {
  const { event, error, eventId, client, locale, t, isRtl, can } = useEventWorkspace();
  const canManage = can("manager");
  const tiers = useEventList(loadTicketTiers);
  const lists = sectionLoad([tiers]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<TicketTierOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TicketTierOut | null>(null);
  const [busyTierId, setBusyTierId] = useState<string | null>(null);
  /** A tier the API refused to delete because it has reservations, with the localized reason. */
  const [deleteRefused, setDeleteRefused] = useState<{ tier: TicketTierOut; reason: string } | null>(null);

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const totalReserved = tiers.items.reduce((n, x) => n + x.reserved_count, 0);
  const totalQuota = tiers.items.reduce((n, x) => n + x.quota, 0);
  const addTier = canManage ? <AddButton label={t.createTierButton} onClick={() => setIsCreateOpen(true)} /> : undefined;
  const formats = sessionDateFormats(locale, eventTimeZone(event));
  const at = (iso: string) => `${formats.shortDay.format(new Date(iso))} ${formats.time.format(new Date(iso))}`;
  const salesWindow = (tier: TicketTierOut) =>
    [
      tier.sales_starts_at ? `${isRtl ? "از" : "From"} ${at(tier.sales_starts_at)}` : "",
      tier.sales_ends_at ? `${isRtl ? "تا" : "until"} ${at(tier.sales_ends_at)}` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const deleteTier = async (tier: TicketTierOut) => {
    if (!client || !eventId) return;
    setBusyTierId(tier.id);
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/ticket-tiers/{tier_id}", {
      params: { path: { event_id: eventId, tier_id: tier.id } },
    });
    setBusyTierId(null);
    if (response.ok) {
      tiers.setItems((prev) => prev.filter((x) => x.id !== tier.id));
      setNotice({ tone: "ok", text: isRtl ? `رده «${tier.name}» حذف شد.` : `Ticket tier “${tier.name}” deleted.` });
    } else if (apiErrorCode(err) === "TIER_HAS_RESERVATIONS") {
      setDeleteRefused({ tier, reason: localizedApiError(err, locale) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(err, locale) });
    }
  };

  const closeTier = async (tier: TicketTierOut) => {
    if (!client || !eventId) return;
    setBusyTierId(tier.id);
    const { data, error: err } = await client.PATCH("/api/events/{event_id}/ticket-tiers/{tier_id}", {
      params: { path: { event_id: eventId, tier_id: tier.id } },
      body: { is_open: false },
    });
    setBusyTierId(null);
    if (data) {
      tiers.setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
      setNotice({ tone: "ok", text: isRtl ? `ثبت‌نام رده «${data.name}» بسته شد.` : `Registration for “${data.name}” is closed.` });
    } else {
      setNotice({ tone: "error", text: localizedApiError(err, locale) });
    }
  };

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("tiers")} eyebrow={<bdi>{event.name}</bdi>} title={t.tiersHeading} description={t.tiersDesc} action={addTier} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {tiers.error ? (
        <FormAlert>{t.sectionLoadFailed}</FormAlert>
      ) : tiers.items.length === 0 ? (
        <EmptyState icon="ticket" title={t.noTiersTitle} action={addTier} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-3 divide-x divide-border-default overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
            {([
              [t.tierQuotaTotal, totalQuota],
              [isRtl ? "رزروشده" : "Reserved", totalReserved],
              [isRtl ? "باقی‌مانده" : "Remaining", Math.max(0, totalQuota - totalReserved)],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0 px-4 py-4 sm:px-6">
                <dt className="truncate text-xs font-semibold text-text-muted">{label}</dt>
                <dd className="org-kpi-value mt-2 text-2xl text-text-primary sm:text-[2rem]">{fmt(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
            <table className="org-table org-table--stack">
              <caption className="sr-only">{t.tiersHeading}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.tierNameLabel}</th>
                  <th scope="col">{isRtl ? "وضعیت" : "Status"}</th>
                  <th scope="col" className="w-[36%]">
                    {isRtl ? "ظرفیت" : "Capacity"}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{isRtl ? "عملیات" : "Actions"}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tiers.items.map((tier, i) => {
                  const reserved = tier.reserved_count ?? 0;
                  const pct = tier.quota > 0 ? Math.min(100, Math.round(((tier.reserved_count ?? 0) / tier.quota) * 100)) : 0;
                  const soldOut = reserved >= tier.quota;
                  return (
                    <tr key={tier.id}>
                      <td>
                        <div className="flex items-start gap-3">
                          <SectionIndex n={i + 1} className="mt-1 text-text-muted" />
                          <div className="min-w-0">
                            <p className="break-words font-semibold text-text-primary">
                              <bdi>{tier.name}</bdi>
                            </p>
                            {tier.description && (
                              <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
                                <bdi>{tier.description}</bdi>
                              </p>
                            )}
                            {(tier.sales_starts_at || tier.sales_ends_at) && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-text-secondary" data-testid="tier-sales-window">
                                <Icon name="clock" size={13} className="shrink-0" />
                                <span>
                                  {isRtl ? "فروش: " : "Sales: "}
                                  {salesWindow(tier)}
                                </span>
                              </p>
                            )}
                            <p className="mt-1 font-mono text-[0.6875rem] text-text-muted">
                              {isRtl ? "شناسه: " : "ID: "}
                              <bdi dir="ltr">{tier.id.slice(0, 8)}</bdi>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td data-label={isRtl ? "وضعیت" : "Status"}>
                        {soldOut ? (
                          <Badge variant="warning" size="sm">
                            {t.tierStatusSoldOut || (isRtl ? "تکمیل ظرفیت" : "Sold Out")}
                          </Badge>
                        ) : !tier.is_open ? (
                          <Badge variant="neutral" size="sm">
                            {t.tierStatusClosed}
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm" dot>
                            {t.tierStatusOpen}
                          </Badge>
                        )}
                      </td>
                      <td data-label={isRtl ? "ظرفیت" : "Capacity"} className="org-cell-wide">
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-3 text-xs text-text-muted">
                            <span>
                              {isRtl ? "رزروشده:" : "Reserved:"} <strong className="tabular text-sm text-text-primary">{fmt(reserved)}</strong> /{" "}
                              {fmt(tier.quota)}
                            </span>
                            <span className="tabular">{fmt(pct)}%</span>
                          </div>
                          <Meter value={pct} label={tier.name} tone={pct >= 100 ? "full" : tier.is_open ? "default" : "muted"} />
                        </div>
                      </td>
                      <td className="text-end">
                        {canManage && (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <Button type="button" variant="secondary" size="sm" onClick={() => setEditingTier(tier)}>
                              <Icon name="note" size={16} />
                              <span>{t.editTierAction || (isRtl ? "ویرایش" : "Edit")}</span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busyTierId === tier.id}
                              onClick={() => setDeleteTarget(tier)}
                              aria-label={isRtl ? `حذف رده ${tier.name}` : `Delete tier ${tier.name}`}
                              className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                            >
                              <Icon name="trash" size={16} />
                              <span>{isRtl ? "حذف" : "Delete"}</span>
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <TierFormDialog
        mode="create"
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          tiers.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: isRtl ? `رده «${created.name}» ایجاد شد.` : `Ticket tier “${created.name}” created.` });
        }}
      />
      <TierFormDialog
        mode="edit"
        tier={editingTier}
        onClose={() => setEditingTier(null)}
        onSaved={(saved) => {
          tiers.setItems((prev) => prev.map((tr) => (tr.id === saved.id ? saved : tr)));
          setEditingTier(null);
          setNotice({ tone: "ok", text: isRtl ? `رده «${saved.name}» ذخیره شد.` : `Ticket tier “${saved.name}” saved.` });
        }}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        tone="danger"
        title={isRtl ? "حذف این رده بلیت؟" : "Delete this ticket tier?"}
        description={
          deleteTarget
            ? isRtl
              ? `رده «${deleteTarget.name}» حذف می‌شود. رده‌ای که رزرو دارد حذف نمی‌شود؛ آن را ببندید.`
              : `“${deleteTarget.name}” is deleted. A tier that has reservations cannot be deleted; close it instead.`
            : ""
        }
        confirmLabel={isRtl ? "حذف رده" : "Delete tier"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void deleteTier(target);
        }}
      />
      <Dialog
        isOpen={deleteRefused !== null}
        onClose={() => setDeleteRefused(null)}
        title={isRtl ? "این رده حذف نمی‌شود" : "This tier cannot be deleted"}
        description={deleteRefused?.reason}
        size="sm"
      >
        <p className="text-sm leading-relaxed text-text-secondary">
          {isRtl
            ? "با بستن رده، رزرو تازه پذیرفته نمی‌شود و بلیت‌های صادرشده معتبر می‌مانند."
            : "Closing the tier stops new reservations while the passes already issued stay valid."}
        </p>
        <div className="mt-5">
          <DialogActions>
            <Button type="button" variant="ghost" size="md" onClick={() => setDeleteRefused(null)}>
              {isRtl ? "بستن پیام" : "Dismiss"}
            </Button>
            {deleteRefused?.tier.is_open && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => {
                  const target = deleteRefused.tier;
                  setDeleteRefused(null);
                  void closeTier(target);
                }}
              >
                {isRtl ? "بستن ثبت‌نام این رده" : "Close this tier instead"}
              </Button>
            )}
          </DialogActions>
        </div>
      </Dialog>
    </div>
  );
}
