import { useState } from "react";
import { apiErrorCode, localizedApiError, type EventOut, type TicketTierOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { formatDate, formatNumber, formatPercent } from "../../lib/format";
import { Icon } from "../../components/ui/Icon";
import { RowActions, type RowAction } from "../../components/ui/RowActions";
import { StatusChip } from "../../components/ui/StatusChip";
import { EmptyState, Meter, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { eventTimeZone } from "../../components/organizer/sessionTime";
import { TierFormDialog } from "../../components/organizer/TierFormDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/**
 * `/organizer/events/:eventId/tiers`: pass types, their capacity and how full they are. A type with reservations
 * can only be closed; one without can be deleted. Managers change them; an archived congress is read-only.
 */
export default function EventTiers() {
  const { eventId, client, locale, canEdit } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].tiers;
  const common = commonCopy[locale];
  const tiers = useEventList(loadTicketTiers);
  const lists = sectionLoad([tiers]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<TicketTierOut | null>(null);
  const [busyTierId, setBusyTierId] = useState<string | null>(null);

  const deleteTier = async (tier: TicketTierOut) => {
    if (!client) return;
    setBusyTierId(tier.id);
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/ticket-tiers/{tier_id}", {
      params: { path: { event_id: eventId, tier_id: tier.id } },
    });
    setBusyTierId(null);
    if (response.ok) {
      tiers.setItems((prev) => prev.filter((x) => x.id !== tier.id));
      setNotice({ tone: "ok", text: copy.deleted(tier.name) });
      return;
    }
    setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
    // Someone reserved it meanwhile: reload, so the row offers closing instead.
    if (apiErrorCode(err) === "TIER_HAS_RESERVATIONS") tiers.reload();
  };

  const closeTier = async (tier: TicketTierOut) => {
    if (!client) return;
    setBusyTierId(tier.id);
    const { data, error: err, response } = await client.PATCH("/api/events/{event_id}/ticket-tiers/{tier_id}", {
      params: { path: { event_id: eventId, tier_id: tier.id } },
      body: { is_open: false },
    });
    setBusyTierId(null);
    if (!data) {
      setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
      return;
    }
    tiers.setItems((prev) => prev.map((x) => (x.id === data.id ? data : x)));
    setNotice({ tone: "ok", text: copy.closed(data.name) });
  };

  const body = (ev: EventOut) => {
    const zone = eventTimeZone(ev);
    const num = (n: number) => formatNumber(n, locale);
    const at = (iso: string) => formatDate(iso, "dayTime", locale, zone);
    const addTier = canEdit ? <AddButton label={copy.add} onClick={() => setIsCreateOpen(true)} /> : undefined;

    const actions = (tier: TicketTierOut): RowAction[] => {
      const busy = busyTierId === tier.id;
      const list: RowAction[] = [{ label: common.edit, icon: "note", onSelect: () => setEditingTier(tier) }];
      if (tier.reserved_count > 0) {
        if (tier.is_open) {
          list.push({
            label: copy.close,
            icon: "lock",
            disabled: busy,
            onSelect: () => void closeTier(tier),
            destructive: { title: copy.closeTitle(tier.name), description: copy.closeBody, confirmLabel: copy.close },
          });
        }
      } else {
        list.push({
          label: common.delete,
          icon: "trash",
          disabled: busy,
          onSelect: () => void deleteTier(tier),
          destructive: { title: copy.deleteTitle(tier.name), description: copy.deleteBody, confirmLabel: common.delete },
        });
      }
      return list;
    };

    return (
      <div className="space-y-6">
        <SectionHeader title={copy.title} action={tiers.items.length > 0 ? addTier : undefined} />

        <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
        <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

        {tiers.error ? null : tiers.items.length === 0 ? (
          <EmptyState icon="ticket" title={copy.empty} action={addTier} />
        ) : (
          <div className="overflow-clip rounded-card border border-border-default bg-surface-panel">
            <table className="org-table org-table--stack">
              <caption className="sr-only">{copy.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.colName}</th>
                  <th scope="col">{copy.colStatus}</th>
                  <th scope="col" className="w-[36%]">
                    {copy.colCapacity}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{copy.colActions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tiers.items.map((tier) => {
                  const reserved = tier.reserved_count ?? 0;
                  const ratio = tier.quota > 0 ? Math.min(1, reserved / tier.quota) : 0;
                  const full = reserved >= tier.quota;
                  return (
                    <tr key={tier.id} data-testid="tier-row">
                      <td>
                        <p className="break-words font-semibold text-text-primary">
                          <bdi>{tier.name}</bdi>
                        </p>
                        {tier.description && (
                          <p className="mt-0.5 text-caption text-text-secondary">
                            <bdi>{tier.description}</bdi>
                          </p>
                        )}
                        {(tier.sales_starts_at || tier.sales_ends_at) && (
                          <p className="mt-1 flex items-center gap-1 text-caption text-text-secondary" data-testid="tier-sales-window">
                            <Icon name="clock" size={13} className="shrink-0" />
                            <span>
                              {copy.window} {tier.sales_starts_at ? copy.from(at(tier.sales_starts_at)) : ""}{" "}
                              {tier.sales_ends_at ? copy.until(at(tier.sales_ends_at)) : ""}
                            </span>
                          </p>
                        )}
                      </td>
                      <td data-label={copy.colStatus}>
                        <StatusChip status={full ? "full" : tier.is_open ? "open" : "closed"} size="sm" />
                      </td>
                      <td data-label={copy.colCapacity} className="org-cell-wide">
                        <div className="space-y-2">
                          <div className="flex items-baseline justify-between gap-3 text-caption text-text-muted">
                            <span className="tabular">{copy.reserved(num(reserved), num(tier.quota))}</span>
                            <span className="tabular">{formatPercent(ratio, locale)}</span>
                          </div>
                          <Meter value={ratio * 100} label={tier.name} tone={full ? "full" : tier.is_open ? "default" : "muted"} />
                        </div>
                      </td>
                      <td className="text-end">
                        {canEdit && <RowActions visible={1} menuLabel={copy.moreActions(tier.name)} actions={actions(tier)} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-6">
        <EventSectionGate listsLoaded={lists.loaded}>{body}</EventSectionGate>
      </div>
      <TierFormDialog
        mode="create"
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          tiers.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: copy.created(created.name) });
        }}
      />
      <TierFormDialog
        mode="edit"
        tier={editingTier}
        onClose={() => setEditingTier(null)}
        onSaved={(saved) => {
          tiers.setItems((prev) => prev.map((tr) => (tr.id === saved.id ? saved : tr)));
          setEditingTier(null);
          setNotice({ tone: "ok", text: copy.saved(saved.name) });
        }}
      />
    </>
  );
}
