import { useEffect, useState, type ReactNode } from "react";
import { localizedApiError, type CheckInPointOut, type EventOut, type ScannerDeviceOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { formatNumber } from "../../lib/format";
import { Badge } from "../../components/ui/Badge";
import { Button, LinkButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { RowActions, type RowAction } from "../../components/ui/RowActions";
import { StatusChip } from "../../components/ui/StatusChip";
import { EmptyState, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { CheckInPointFormDialog } from "../../components/organizer/CheckInPointFormDialog";
import { ScannerPairingDialog } from "../../components/organizer/ScannerPairingDialog";
import { checkInPolicyMeta } from "../../components/organizer/checkInPolicy";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadCheckInPoints, loadSessions, loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/** Device counts of one point, or of the whole congress. */
interface DeviceHealth {
  active: number;
  stale: number;
  unsynced: number;
}

function deviceHealth(devices: readonly ScannerDeviceOut[]): DeviceHealth {
  const active = devices.filter((d) => !d.is_revoked);
  return {
    active: active.length,
    stale: active.filter((d) => d.stale).length,
    unsynced: active.reduce((sum, d) => sum + (d.unsynced_count ?? 0), 0),
  };
}

/**
 * `/organizer/events/:eventId/check-in`: check-in points and their entry rules, scanner devices and their health,
 * archive and delete. Roles (backend/app/roles.py): viewers read; staff open the scanner and manage devices;
 * managers change the points. An archived congress is read-only.
 */
export default function EventCheckIn() {
  const { event, client, locale, can, canEdit } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].checkIn;
  const common = commonCopy[locale];
  const points = useEventList(loadCheckInPoints);
  // Names the tiers a point admits, and offers them in the point form.
  const tiers = useEventList(loadTicketTiers);
  // Session doors name their session; the form offers the programme.
  const sessions = useEventList(loadSessions);
  const lists = sectionLoad([tiers, points, sessions]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<CheckInPointOut | null>(null);
  const [devicesPoint, setDevicesPoint] = useState<CheckInPointOut | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [devicesByPoint, setDevicesByPoint] = useState<Record<string, ScannerDeviceOut[]>>({});

  // Day actions (scanner, devices) need staff, on a congress that is not archived.
  const runsDay = event != null && event.archived_at == null && can("staff");
  const livePointIds = points.items
    .filter((p) => !p.archived_at)
    .map((p) => p.id)
    .join(",");

  // Device health of every live point, so a stale scanner shows without opening each point.
  useEffect(() => {
    if (!client || !runsDay || !livePointIds) return;
    let alive = true;
    for (const pointId of livePointIds.split(",")) {
      void client.GET("/api/checkin-points/{point_id}/devices", { params: { path: { point_id: pointId } } }).then(({ data }) => {
        if (alive && data) setDevicesByPoint((prev) => ({ ...prev, [pointId]: data }));
      });
    }
    return () => {
      alive = false;
    };
  }, [client, runsDay, livePointIds]);

  const num = (n: number) => formatNumber(n, locale);
  const replacePoint = (saved: CheckInPointOut) => points.setItems((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));

  const setArchived = async (ev: EventOut, pt: CheckInPointOut, archive: boolean) => {
    if (!client) return;
    setBusyId(pt.id);
    const path = { params: { path: { event_id: ev.id, point_id: pt.id } } };
    const { data, error: err, response } = archive
      ? await client.POST("/api/events/{event_id}/checkin-points/{point_id}/archive", path)
      : await client.POST("/api/events/{event_id}/checkin-points/{point_id}/unarchive", path);
    setBusyId(null);
    if (!data) {
      setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
      return;
    }
    replacePoint(data);
    setNotice({ tone: "ok", text: archive ? copy.archived(data.name) : copy.restored(data.name) });
  };

  const deletePoint = async (ev: EventOut, pt: CheckInPointOut) => {
    if (!client) return;
    setBusyId(pt.id);
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/checkin-points/{point_id}", {
      params: { path: { event_id: ev.id, point_id: pt.id } },
    });
    setBusyId(null);
    if (!response.ok) {
      setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
      return;
    }
    points.setItems((prev) => prev.filter((p) => p.id !== pt.id));
    setNotice({ tone: "ok", text: copy.deleted(pt.name) });
  };

  const downloadAttendance = async (ev: EventOut, pt: CheckInPointOut) => {
    if (!client || !pt.session_id) return;
    setBusyId(pt.id);
    const { data: blob, response, error: err } = await client.GET("/api/events/{event_id}/sessions/{session_id}/attendance-csv", {
      params: { path: { event_id: ev.id, session_id: pt.session_id } },
      parseAs: "blob",
    });
    setBusyId(null);
    if (!response.ok || !blob) {
      setNotice({ tone: "error", text: err ? localizedApiError(err, locale, response.status) : copy.exportFailed });
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${ev.slug}-session-attendance.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const showPoint = (pointId: string) => {
    const card = document.getElementById(`point-${pointId}`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    card?.focus({ preventScroll: true });
  };

  const body = (ev: EventOut) => {
    const tierNames = new Map(tiers.items.map((tr) => [tr.id, tr.name]));
    const pointNames = new Map(points.items.map((p) => [p.id, p.name]));
    const sessionTitles = new Map(sessions.items.map((s) => [s.id, s.title]));
    const active = points.items.filter((p) => !p.archived_at);
    const archived = points.items.filter((p) => p.archived_at);
    const addPoint = canEdit ? <AddButton label={copy.add} onClick={() => setIsCreateOpen(true)} /> : undefined;

    const loadedDevices = active.flatMap((p) => devicesByPoint[p.id] ?? []);
    const health = deviceHealth(loadedDevices);
    const firstStale = active.find((p) => (devicesByPoint[p.id] ?? []).some((d) => !d.is_revoked && d.stale));

    const card = (pt: CheckInPointOut) => {
      const policy = checkInPolicyMeta(pt.policy_type, locale);
      const isArchived = Boolean(pt.archived_at);
      const busy = busyId === pt.id;
      const allowed = (pt.allowed_tier_ids ?? []).map((id) => tierNames.get(id)).filter((nm): nm is string => Boolean(nm));
      const capped = pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity;
      const rules: { label: string; value: ReactNode }[] = [];
      if (allowed.length > 0) {
        rules.push({
          label: copy.tiers,
          value: (
            <span className="flex flex-wrap justify-end gap-1.5">
              {allowed.map((nm) => (
                <Badge key={nm} variant="neutral" size="sm">
                  <bdi>{nm}</bdi>
                </Badge>
              ))}
            </span>
          ),
        });
      }
      if (pt.requires_point_id) rules.push({ label: copy.requires, value: <bdi>{pointNames.get(pt.requires_point_id) ?? "—"}</bdi> });
      if (pt.session_id) rules.push({ label: copy.session, value: <bdi>{sessionTitles.get(pt.session_id) ?? "—"}</bdi> });

      const pointDevices = devicesByPoint[pt.id];
      const pointHealth = pointDevices ? deviceHealth(pointDevices) : null;
      const showDayActions = runsDay && !isArchived;

      const menu: RowAction[] = [];
      if (canEdit) {
        menu.push({ label: common.edit, icon: "note", onSelect: () => setEditingPoint(pt) });
        menu.push({
          label: isArchived ? copy.unarchive : copy.archive,
          icon: isArchived ? "sync" : "layers",
          disabled: busy,
          onSelect: () => void setArchived(ev, pt, !isArchived),
        });
      }
      if (can("manager") && pt.session_id) {
        menu.push({ label: copy.attendance, icon: "download", disabled: busy, onSelect: () => void downloadAttendance(ev, pt) });
      }
      if (canEdit) {
        menu.push({
          label: common.delete,
          icon: "trash",
          disabled: busy,
          onSelect: () => void deletePoint(ev, pt),
          destructive: { title: copy.deleteTitle(pt.name), description: copy.deleteBody, confirmLabel: common.delete },
        });
      }

      return (
        <article
          key={pt.id}
          id={`point-${pt.id}`}
          tabIndex={-1}
          aria-labelledby={`point-title-${pt.id}`}
          className="flex flex-col rounded-card border border-border-default bg-surface-panel shadow-soft focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <div className="flex-1 space-y-3 p-5">
            <div className="space-y-1">
              <h3 id={`point-title-${pt.id}`} className="break-words text-title-sm font-bold text-text-primary">
                <bdi>{pt.name}</bdi>
              </h3>
              <p className="flex items-center gap-1.5 text-body-sm text-text-secondary">
                <Icon name="pin" size={15} className="shrink-0 text-text-muted" />
                {pt.location ? <bdi className="min-w-0 break-words">{pt.location}</bdi> : <span className="text-text-muted">{copy.noLocation}</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {isArchived && <StatusChip status="archived" size="sm" />}
              <Badge variant="brand" size="sm" icon={<Icon name={policy.icon} size={12} />}>
                {policy.label}
              </Badge>
              {capped && (
                <Badge variant="neutral" size="sm">
                  {pt.tracks_occupancy ? copy.maxInside(num(pt.max_capacity ?? 0)) : copy.cap(num(pt.max_capacity ?? 0))}
                </Badge>
              )}
              {pt.reset_window === "DAY" && (
                <Badge variant="neutral" size="sm">
                  {copy.daily}
                </Badge>
              )}
              {pt.tracks_occupancy && !capped && (
                <Badge variant="neutral" size="sm">
                  {copy.occupancy}
                </Badge>
              )}
            </div>
            {rules.length > 0 && (
              <dl className="space-y-2 rounded-control bg-surface-panel-subtle px-4 py-3 text-caption">
                {rules.map((rule) => (
                  <div key={rule.label} className="flex items-center justify-between gap-3">
                    <dt className="font-semibold text-text-muted">{rule.label}</dt>
                    <dd className="text-end text-text-primary">{rule.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {showDayActions && pointHealth && (
              <p className="flex items-center gap-1.5 text-caption text-text-secondary" data-testid="point-devices">
                <Icon name="smartphone" size={14} className="shrink-0 text-text-muted" />
                {pointHealth.active === 0 ? copy.noDevices : copy.deviceCount(num(pointHealth.active))}
                {pointHealth.stale > 0 && (
                  <span className="inline-flex items-center gap-1 font-semibold text-status-warning-text">
                    · {copy.staleCount(num(pointHealth.stale))}
                    <Icon name="alert" size={13} />
                  </span>
                )}
              </p>
            )}
          </div>
          {(showDayActions || menu.length > 0) && (
            <div className="flex items-center justify-between gap-2 border-t border-border-subtle px-5 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {showDayActions && (
                  <>
                    <Button type="button" variant="secondary" size="sm" icon="smartphone" onClick={() => setDevicesPoint(pt)}>
                      {copy.devices}
                    </Button>
                    <LinkButton to={`/scan/${pt.id}`} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm" icon="scan" iconEnd="arrow-up-right">
                      {copy.openScanner}
                    </LinkButton>
                  </>
                )}
              </div>
              {menu.length > 0 && <RowActions visible={0} menuLabel={copy.moreActions(pt.name)} actions={menu} />}
            </div>
          )}
        </article>
      );
    };

    return (
      <div className="space-y-6">
        <SectionHeader title={copy.title} action={addPoint} />

        <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
        <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

        {runsDay && health.active > 0 && (
          <div
            data-testid="device-health"
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border px-4 py-2.5 text-body-sm ${
              health.stale > 0 ? "border-status-warning-border bg-status-warning-bg text-status-warning-text" : "border-border-default bg-surface-panel text-text-secondary"
            }`}
          >
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Icon name="smartphone" size={16} />
              {copy.health.label}
            </span>
            <span>{copy.health.active(num(health.active))}</span>
            {health.stale > 0 && firstStale && (
              <button
                type="button"
                onClick={() => showPoint(firstStale.id)}
                title={copy.health.showStale}
                className="inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4"
                data-testid="device-health-stale"
              >
                <Icon name="alert" size={14} />
                {copy.health.stale(num(health.stale))}
              </button>
            )}
            {health.unsynced > 0 && <span>{copy.health.unsynced(num(health.unsynced))}</span>}
          </div>
        )}

        {points.error ? null : active.length === 0 ? (
          <EmptyState icon="gate" title={copy.empty} action={addPoint} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">{active.map(card)}</div>
        )}

        {archived.length > 0 && (
          <section aria-labelledby="archived-points-title" className="space-y-3">
            <h2 id="archived-points-title">
              <button
                type="button"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className="inline-flex min-h-11 items-center gap-2 text-body-sm font-semibold text-text-secondary hover:text-text-primary"
              >
                <Icon name={showArchived ? "chevron-down" : "chevron-right"} size={16} />
                {copy.archivedGroup(num(archived.length))}
              </button>
            </h2>
            {showArchived && <div className="grid gap-4 xl:grid-cols-2">{archived.map(card)}</div>}
          </section>
        )}
      </div>
    );
  };

  return (
    <>
      <EventSectionGate listsLoaded={lists.loaded}>{body}</EventSectionGate>

      <CheckInPointFormDialog
        mode="create"
        isOpen={isCreateOpen}
        tiers={tiers.items}
        points={points.items}
        sessions={sessions.items}
        onClose={() => setIsCreateOpen(false)}
        onSaved={(created) => {
          points.setItems((prev) => [...prev, created]);
          setIsCreateOpen(false);
          setNotice({ tone: "ok", text: copy.created(created.name) });
        }}
      />
      <CheckInPointFormDialog
        mode="edit"
        point={editingPoint}
        tiers={tiers.items}
        points={points.items}
        sessions={sessions.items}
        onClose={() => setEditingPoint(null)}
        onSaved={(saved) => {
          replacePoint(saved);
          setEditingPoint(null);
          setNotice({ tone: "ok", text: copy.saved(saved.name) });
        }}
      />
      <ScannerPairingDialog
        point={devicesPoint}
        onClose={() => setDevicesPoint(null)}
        onDevicesChange={(pointId, list) => setDevicesByPoint((prev) => ({ ...prev, [pointId]: list }))}
      />
    </>
  );
}
