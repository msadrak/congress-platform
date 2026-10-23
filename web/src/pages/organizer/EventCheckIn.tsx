import { useState } from "react";
import { Link } from "react-router-dom";
import type { CheckInPointOut } from "../../api/client";
import { formatLocalizedNumber } from "../../lib/i18n";
import { eventSectionNumber } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Icon, type IconName } from "../../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { CheckInPointFormDialog } from "../../components/organizer/CheckInPointFormDialog";
import { ScannerPairingDialog } from "../../components/organizer/ScannerPairingDialog";
import { checkInPolicyMeta } from "../../components/organizer/checkInPolicy";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadCheckInPoints, loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/** `/organizer/events/:eventId/check-in`: check-in points, their admission policies and scanner pairing. */
export default function EventCheckIn() {
  const { event, error, apiKey, onKeyRejected, locale, t, isRtl } = useEventWorkspace();
  const points = useEventList(loadCheckInPoints);
  // Names the tiers a restricted point admits, and offers them in the point form.
  const tiers = useEventList(loadTicketTiers);
  const lists = sectionLoad([tiers, points]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<CheckInPointOut | null>(null);
  // Scanner device pairing (token issue, QR pairing link, device list)
  const [pairingPoint, setPairingPoint] = useState<CheckInPointOut | null>(null);

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const tierNames = new Map(tiers.items.map((tr) => [tr.id, tr.name]));
  const policyMeta = checkInPolicyMeta(t);
  const addPoint = <AddButton label={t.createPointButton} onClick={() => setIsCreateOpen(true)} />;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("check-in")} eyebrow={<bdi>{event.name}</bdi>} title={t.pointsHeading} description={t.pointsDesc} action={addPoint} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {points.error ? (
        <FormAlert>{t.sectionLoadFailed}</FormAlert>
      ) : points.items.length === 0 ? (
        <EmptyState icon="gate" title={t.noPointsTitle} action={addPoint} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {points.items.map((pt, i) => {
            const policy = policyMeta[pt.policy_type] ?? { label: pt.policy_type, desc: "", icon: "gate" as IconName };
            const allowed = (pt.allowed_tier_ids ?? []).map((id) => tierNames.get(id) ?? id.slice(0, 8));
            return (
              <article
                key={pt.id}
                aria-labelledby={`point-title-${pt.id}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft"
              >
                <div className="flex-1 space-y-4 p-5 sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-mono text-[0.6875rem] text-text-muted">
                      <Icon name="gate" size={16} className="text-aiteb-indigo" />
                      <span aria-hidden="true">G-{String(i + 1).padStart(2, "0")}</span>
                    </span>
                    <Badge variant="brand" size="sm" icon={<Icon name={policy.icon} size={12} />}>
                      {policy.label}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <h3 id={`point-title-${pt.id}`} className="break-words text-lg font-bold tracking-tight text-text-primary">
                      <bdi>{pt.name}</bdi>
                    </h3>
                    <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                      <Icon name="pin" size={15} className="shrink-0 text-text-muted" />
                      {pt.location ? (
                        <bdi className="min-w-0 break-words">{pt.location}</bdi>
                      ) : (
                        <span className="text-text-muted">{isRtl ? "بدون مکان" : "No location"}</span>
                      )}
                    </p>
                  </div>
                  {policy.desc && <p className="text-xs leading-relaxed text-text-muted">{policy.desc}</p>}
                  {(pt.policy_type === "TIER_RESTRICTED" || (pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity)) && (
                    <dl className="space-y-2 rounded-xl bg-surface-panel-subtle px-4 py-3 text-xs">
                      {pt.policy_type === "TIER_RESTRICTED" && (
                        <div>
                          <dt className="font-semibold text-text-muted">{t.allowedTiersLabel}</dt>
                          <dd className="mt-1.5 flex flex-wrap gap-1.5">
                            {allowed.length === 0 ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              allowed.map((nm) => (
                                <Badge key={nm} variant="neutral" size="sm">
                                  {nm}
                                </Badge>
                              ))
                            )}
                          </dd>
                        </div>
                      )}
                      {pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="font-semibold text-text-muted">{isRtl ? "سقف ظرفیت" : "Capacity limit"}</dt>
                          <dd className="org-kpi-value text-base text-text-primary">{fmt(pt.max_capacity)}</dd>
                        </div>
                      ) : null}
                    </dl>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-3.5 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/scan/${pt.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-surface-ink px-3 text-[13px] font-semibold text-white transition-colors hover:bg-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <Icon name="scan" size={16} />
                      <span>{t.openScannerAction}</span>
                      <Icon name="arrow-up-right" size={14} className="opacity-70" />
                    </Link>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setPairingPoint(pt)}>
                      <Icon name="smartphone" size={16} />
                      <span>{isRtl ? "اتصال دستگاه" : "Pair device"}</span>
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditingPoint(pt)}>
                      <Icon name="note" size={16} />
                      <span>{t.editPointAction || (isRtl ? "ویرایش" : "Edit")}</span>
                    </Button>
                  </div>
                  <span className="font-mono text-[0.6875rem] text-text-muted">
                    {isRtl ? "شناسه: " : "ID: "}
                    <bdi dir="ltr">{pt.id.slice(0, 8)}</bdi>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <CheckInPointFormDialog
        mode="create"
        isOpen={isCreateOpen}
        tiers={tiers.items}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          points.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: isRtl ? `گیت «${created.name}» ایجاد شد.` : `Check-in point “${created.name}” created.` });
        }}
      />
      <CheckInPointFormDialog
        mode="edit"
        point={editingPoint}
        tiers={tiers.items}
        onClose={() => setEditingPoint(null)}
        onSaved={(saved) => {
          points.setItems((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
          setEditingPoint(null);
          setNotice({ tone: "ok", text: isRtl ? `گیت «${saved.name}» ذخیره شد.` : `Check-in point “${saved.name}” saved.` });
        }}
      />

      {apiKey && (
        <ScannerPairingDialog
          point={pairingPoint}
          apiKey={apiKey}
          locale={locale}
          isRtl={isRtl}
          onKeyRejected={onKeyRejected}
          onClose={() => setPairingPoint(null)}
        />
      )}
    </div>
  );
}
