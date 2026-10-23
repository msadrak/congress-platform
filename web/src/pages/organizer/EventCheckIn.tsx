import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { localizedApiError, type CheckInPointOut } from "../../api/client";
import { formatLocalizedNumber } from "../../lib/i18n";
import { eventSectionNumber } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Icon, type IconName } from "../../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { CheckInPointFormDialog } from "../../components/organizer/CheckInPointFormDialog";
import { ScannerPairingDialog } from "../../components/organizer/ScannerPairingDialog";
import { checkInPolicyMeta } from "../../components/organizer/checkInPolicy";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadCheckInPoints, loadSessions, loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/**
 * `/organizer/events/:eventId/check-in`: check-in points, their gate rules (policy, tier filter, window, occupancy,
 * required point, session door), scanner pairing, archive and delete.
 */
export default function EventCheckIn() {
  const { event, error, apiKey, client, onKeyRejected, locale, t, isRtl } = useEventWorkspace();
  const points = useEventList(loadCheckInPoints);
  // Names the tiers a point admits, and offers them in the point form.
  const tiers = useEventList(loadTicketTiers);
  // Session doors name their session; the form offers the programme.
  const sessions = useEventList(loadSessions);
  const lists = sectionLoad([tiers, points, sessions]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<CheckInPointOut | null>(null);
  // Scanner device pairing (token issue, QR pairing link, device list)
  const [pairingPoint, setPairingPoint] = useState<CheckInPointOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CheckInPointOut | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const tierNames = new Map(tiers.items.map((tr) => [tr.id, tr.name]));
  const pointNames = new Map(points.items.map((p) => [p.id, p.name]));
  const sessionTitles = new Map(sessions.items.map((s) => [s.id, s.title]));
  const policyMeta = checkInPolicyMeta(t);
  const addPoint = <AddButton label={t.createPointButton} onClick={() => setIsCreateOpen(true)} />;
  const active = points.items.filter((p) => !p.archived_at);
  const archived = points.items.filter((p) => p.archived_at);

  const replacePoint = (saved: CheckInPointOut) => points.setItems((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));

  const setArchived = async (pt: CheckInPointOut, archive: boolean) => {
    if (!client || !apiKey || !event) return;
    setBusyId(pt.id);
    const path = { params: { path: { event_id: event.id, point_id: pt.id } } };
    const { data, error: err, response } = archive
      ? await client.POST("/api/events/{event_id}/checkin-points/{point_id}/archive", path)
      : await client.POST("/api/events/{event_id}/checkin-points/{point_id}/unarchive", path);
    if (response.status === 401) onKeyRejected(apiKey);
    setBusyId(null);
    if (err || !data) {
      setNotice({ tone: "error", text: localizedApiError(err, locale) });
      return;
    }
    replacePoint(data);
    setNotice({
      tone: "ok",
      text: archive
        ? isRtl
          ? `نقطه ورود «${data.name}» بایگانی شد؛ اسکنرهایش متوقف شدند و آمارش حفظ می‌شود.`
          : `Check-in point “${data.name}” archived: its scanners stop and its analytics are kept.`
        : isRtl
          ? `نقطه ورود «${data.name}» از بایگانی خارج شد.`
          : `Check-in point “${data.name}” restored.`,
    });
  };

  const deletePoint = async (pt: CheckInPointOut) => {
    if (!client || !apiKey || !event) return;
    setBusyId(pt.id);
    const { error: err, response } = await client.DELETE("/api/events/{event_id}/checkin-points/{point_id}", {
      params: { path: { event_id: event.id, point_id: pt.id } },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setBusyId(null);
    if (!response.ok) {
      setNotice({ tone: "error", text: localizedApiError(err, locale) });
      return;
    }
    points.setItems((prev) => prev.filter((p) => p.id !== pt.id));
    setNotice({ tone: "ok", text: isRtl ? `نقطه ورود «${pt.name}» حذف شد.` : `Check-in point “${pt.name}” deleted.` });
  };

  const downloadAttendance = async (pt: CheckInPointOut) => {
    if (!client || !apiKey || !event || !pt.session_id) return;
    setBusyId(pt.id);
    try {
      const { data: blob, response, error: err } = await client.GET(
        "/api/events/{event_id}/sessions/{session_id}/attendance-csv",
        { params: { path: { event_id: event.id, session_id: pt.session_id } }, parseAs: "blob" }
      );
      if (response.status === 401) onKeyRejected(apiKey);
      if (!response.ok || !blob) {
        setNotice({ tone: "error", text: err ? localizedApiError(err, locale) : t.csvExportFailed });
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event.slug}-session-attendance.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setNotice({ tone: "error", text: t.csvNetworkError });
    } finally {
      setBusyId(null);
    }
  };

  const card = (pt: CheckInPointOut, i: number) => {
    const policy = policyMeta[pt.policy_type] ?? { label: pt.policy_type, desc: "", icon: "gate" as IconName };
    const allowed = (pt.allowed_tier_ids ?? []).map((id) => tierNames.get(id) ?? id.slice(0, 8));
    const isArchived = Boolean(pt.archived_at);
    const busy = busyId === pt.id;
    const rules: { label: string; value: ReactNode }[] = [];
    if (allowed.length > 0) {
      rules.push({
        label: t.allowedTiersLabel,
        value: (
          <span className="flex flex-wrap gap-1.5">
            {allowed.map((nm) => (
              <Badge key={nm} variant="neutral" size="sm">
                {nm}
              </Badge>
            ))}
          </span>
        ),
      });
    }
    if (pt.policy_type === "CAPACITY_CAPPED" && pt.max_capacity) {
      rules.push({
        label: pt.tracks_occupancy ? (isRtl ? "سقف افراد داخل" : "Max inside") : isRtl ? "سقف ظرفیت" : "Capacity limit",
        value: <span className="org-kpi-value text-base text-text-primary">{fmt(pt.max_capacity)}</span>,
      });
    }
    if (pt.reset_window === "DAY") rules.push({ label: isRtl ? "بازهٔ تکرار" : "Reset window", value: isRtl ? "هر روز" : "Each day" });
    if (pt.tracks_occupancy) rules.push({ label: isRtl ? "ورود و خروج" : "Entry and exit", value: isRtl ? "ثبت می‌شود" : "Tracked" });
    if (pt.requires_point_id) {
      rules.push({ label: isRtl ? "نقطه ورود پیش‌نیاز" : "Requires", value: <bdi>{pointNames.get(pt.requires_point_id) ?? "—"}</bdi> });
    }
    if (pt.session_id) {
      rules.push({ label: isRtl ? "درِ جلسه" : "Session door", value: <bdi>{sessionTitles.get(pt.session_id) ?? "—"}</bdi> });
    }
    return (
      <article
        key={pt.id}
        aria-labelledby={`point-title-${pt.id}`}
        className={`flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft ${isArchived ? "opacity-80" : ""}`}
      >
        <div className="flex-1 space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-mono text-[0.6875rem] text-text-muted">
              <Icon name="gate" size={16} className="text-aiteb-indigo" />
              <span aria-hidden="true">G-{String(i + 1).padStart(2, "0")}</span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {isArchived && (
                <Badge variant="neutral" size="sm">
                  {isRtl ? "بایگانی" : "Archived"}
                </Badge>
              )}
              <Badge variant="brand" size="sm" icon={<Icon name={policy.icon} size={12} />}>
                {policy.label}
              </Badge>
            </span>
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
          {rules.length > 0 && (
            <dl className="space-y-2 rounded-xl bg-surface-panel-subtle px-4 py-3 text-xs">
              {rules.map((rule) => (
                <div key={rule.label} className="flex items-center justify-between gap-3">
                  <dt className="font-semibold text-text-muted">{rule.label}</dt>
                  <dd className="text-end text-text-primary">{rule.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-panel-subtle/60 px-5 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {!isArchived && (
              <>
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
              </>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditingPoint(pt)}>
              <Icon name="note" size={16} />
              <span>{t.editPointAction || (isRtl ? "ویرایش" : "Edit")}</span>
            </Button>
            {pt.session_id && (
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void downloadAttendance(pt)}>
                <Icon name="download" size={16} />
                <span>{isRtl ? "حضور جلسه (CSV)" : "Attendance CSV"}</span>
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void setArchived(pt, !isArchived)}>
              <Icon name={isArchived ? "sync" : "layers"} size={16} />
              <span>{isArchived ? (isRtl ? "خروج از بایگانی" : "Unarchive") : isRtl ? "بایگانی" : "Archive"}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDeleteTarget(pt)}
              aria-label={isRtl ? `حذف ${pt.name}` : `Delete ${pt.name}`}
            >
              <Icon name="trash" size={16} />
              <span>{isRtl ? "حذف" : "Delete"}</span>
            </Button>
          </div>
          <span className="font-mono text-[0.6875rem] text-text-muted">
            {isRtl ? "شناسه: " : "ID: "}
            <bdi dir="ltr">{pt.id.slice(0, 8)}</bdi>
          </span>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("check-in")} eyebrow={<bdi>{event.name}</bdi>} title={t.pointsHeading} description={t.pointsDesc} action={addPoint} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {points.error ? (
        <FormAlert>{t.sectionLoadFailed}</FormAlert>
      ) : active.length === 0 ? (
        <EmptyState icon="gate" title={t.noPointsTitle} action={addPoint} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">{active.map((pt, i) => card(pt, i))}</div>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="archived-points-title" className="space-y-3">
          <h2 id="archived-points-title">
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary"
            >
              <Icon name={showArchived ? "chevron-down" : isRtl ? "chevron-left" : "chevron-right"} size={16} />
              {isRtl ? `نقطه‌های ورود بایگانی‌شده (${fmt(archived.length)})` : `Archived points (${archived.length})`}
            </button>
          </h2>
          {showArchived && <div className="grid gap-4 xl:grid-cols-2">{archived.map((pt, i) => card(pt, active.length + i))}</div>}
        </section>
      )}

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
          setNotice({ tone: "ok", text: isRtl ? `نقطه ورود «${created.name}» ایجاد شد.` : `Check-in point “${created.name}” created.` });
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
          setNotice({ tone: "ok", text: isRtl ? `نقطه ورود «${saved.name}» ذخیره شد.` : `Check-in point “${saved.name}” saved.` });
        }}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        tone="danger"
        title={isRtl ? "حذف این نقطه ورود؟" : "Delete this check-in point?"}
        description={
          isRtl
            ? "فقط نقطه ورودی که هیچ اسکنی ندارد حذف می‌شود و دستگاه‌های متصلش هم حذف می‌شوند. نقطه ورود دارای اسکن را بایگانی کنید."
            : "Only a point without scans can be deleted; its paired devices go with it. Archive a point that has scans."
        }
        confirmLabel={isRtl ? "حذف نقطه ورود" : "Delete point"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void deletePoint(target);
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
