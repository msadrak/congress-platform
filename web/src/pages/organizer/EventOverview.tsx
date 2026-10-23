import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { AttendanceAnalyticsResponse, CheckInPointOut, EventOut, PageStateOut, TicketTierOut } from "../../api/client";
import { formatDateRange, formatNumber, formatPercent } from "../../lib/format";
import { eventTimeStatus, eventWorkspacePath } from "../../lib/organizerWorkspace";
import { organizerCopy } from "../../copy/organizer";
import { commonCopy } from "../../copy/common";
import { Badge } from "../../components/ui/Badge";
import { LinkButton } from "../../components/ui/Button";
import { Icon, type IconName } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { FormAlert, Meter } from "../../components/organizer/WorkspaceUi";
import { EventEditDialog } from "../../components/organizer/EventEditDialog";
import { useEventWorkspace, type OrganizerClient } from "../../components/organizer/eventWorkspaceContext";
import { EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { EventSettingsPanel } from "./EventSettingsPanel";
import { loadCheckInPoints, loadDeskOperators, loadSessions, loadTicketTiers, sectionLoad, useEventList } from "./eventLists";

/** How often the live figures refresh while the congress is in progress. */
const LIVE_REFRESH_MS = 30_000;

interface LiveFigures {
  analytics: AttendanceAnalyticsResponse | null;
  /** Paired scanners that are stale or hold scans not sent yet; null when the role can't read devices. */
  scannersToCheck: number | null;
  /** Failed confirmation SMS among the latest messages; null when the role can't read them. */
  failedSms: number | null;
  failed: boolean;
}

async function loadLive(client: OrganizerClient, eventId: string, points: CheckInPointOut[], staff: boolean, manager: boolean): Promise<LiveFigures> {
  const path = { event_id: eventId };
  const [analytics, devices, sms] = await Promise.all([
    client.GET("/api/events/{event_id}/analytics/attendance", { params: { path } }),
    staff ? Promise.all(points.map((p) => client.GET("/api/checkin-points/{point_id}/devices", { params: { path: { point_id: p.id } } }))) : null,
    manager ? client.GET("/api/events/{event_id}/sms/messages", { params: { path, query: { limit: 100 } } }) : null,
  ]);
  const deviceLists = devices?.map((d) => d.data ?? []) ?? null;
  return {
    analytics: analytics.data ?? null,
    scannersToCheck: deviceLists
      ? deviceLists.flat().filter((d) => !d.is_revoked && (d.stale || (d.unsynced_count ?? 0) > 0)).length
      : null,
    failedSms: sms?.data ? sms.data.filter((m) => m.status === "failed").length : null,
    failed: !analytics.data,
  };
}

/**
 * `/organizer/events/:eventId`: the congress-day dashboard. In progress (or over): live tiles for admitted,
 * registered, inside now and scanners to check, plus failed SMS when there are any. Before it starts: the setup
 * checklist. Then capacity and the settings card, the one place to edit the congress.
 */
export default function EventOverview() {
  const { can } = useEventWorkspace();
  const canManage = can("manager");
  const tiers = useEventList(loadTicketTiers);
  const points = useEventList(loadCheckInPoints);
  // Desk operators are a manager's list: a lower role neither loads nor counts them.
  const operators = useEventList(loadDeskOperators, canManage);
  const sessions = useEventList(loadSessions);
  const lists = sectionLoad([tiers, points, operators, sessions]);

  return (
    <EventSectionGate listsLoaded={lists.loaded}>
      {(event) => (
        <OverviewBody
          event={event}
          tiers={tiers.items}
          points={points.items}
          activeOperators={operators.items.filter((o) => !o.is_revoked).length}
          sessions={sessions.items.length}
          lists={lists}
        />
      )}
    </EventSectionGate>
  );
}

interface OverviewBodyProps {
  event: EventOut;
  tiers: TicketTierOut[];
  points: CheckInPointOut[];
  activeOperators: number;
  sessions: number;
  lists: ReturnType<typeof sectionLoad>;
}

function OverviewBody({ event, tiers, points, activeOperators, sessions, lists }: OverviewBodyProps) {
  const { eventId, client, apiKey, replaceEvent, locale, can, canEdit } = useEventWorkspace();
  const copy = organizerCopy[locale];
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [editing, setEditing] = useState<EventOut | null>(null);
  // Fixed at mount so the derived status never flickers between renders.
  const [now] = useState(() => Date.now());
  const status = eventTimeStatus(event.starts_at, event.ends_at, now);
  const upcoming = status === "upcoming";
  const archived = event.archived_at != null;
  const [page, setPage] = useState<PageStateOut | null>(null);
  const [live, setLive] = useState<LiveFigures | null>(null);
  const staff = can("staff");
  const manager = can("manager");

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void client.GET("/api/events/{event_id}/page", { params: { path: { event_id: eventId } } }).then(({ data }) => {
      if (alive && data) setPage(data);
    });
    return () => {
      alive = false;
    };
  }, [client, eventId]);

  useEffect(() => {
    if (!client || upcoming) return;
    let alive = true;
    const refresh = () =>
      void loadLive(client, eventId, points, staff, manager).then((figures) => {
        if (alive) setLive(figures);
      });
    refresh();
    const timer = status === "in-progress" ? window.setInterval(refresh, LIVE_REFRESH_MS) : undefined;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [client, eventId, points, staff, manager, upcoming, status]);

  const n = (value: number) => formatNumber(value, locale);
  const published = page?.is_published ?? false;
  const totalReserved = tiers.reduce((sum, x) => sum + x.reserved_count, 0);
  const totalQuota = tiers.reduce((sum, x) => sum + x.quota, 0);
  const capacity = totalQuota > 0 ? Math.min(1, totalReserved / totalQuota) : 0;
  const path = (to: string) => eventWorkspacePath(event.id, to);

  const primary =
    !archived && status === "in-progress" && staff ? (
      <LinkButton to={path("/desk")} variant="primary" icon="id-card">
        {copy.overview.openDesk}
      </LinkButton>
    ) : upcoming && canEdit && page && !published ? (
      <LinkButton to={path("/page")} variant="primary" icon="web">
        {copy.overview.publishPage}
      </LinkButton>
    ) : null;
  const publicLink =
    published && !archived ? (
      <a
        href={`/e/${encodeURIComponent(event.slug)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-body-sm font-semibold text-action-primary hover:bg-surface-panel-subtle"
      >
        {copy.shell.publicPage}
        <Icon name="arrow-up-right" size={18} />
      </a>
    ) : null;

  const tile = (key: string, label: string, value: number | null, to: string, icon: IconName, tone: "default" | "warning" = "default") => (
    <li key={key}>
      <Link
        to={path(to)}
        data-testid="live-tile"
        className={`flex h-full min-w-0 flex-col gap-2 rounded-card border bg-surface-panel p-4 shadow-soft hover:border-border-strong sm:p-5 ${
          tone === "warning" ? "border-status-warning-border" : "border-border-default"
        }`}
      >
        <span className="flex items-center justify-between gap-2 text-meta font-semibold text-text-secondary">
          {label}
          <Icon name={icon} size={18} className="shrink-0 text-text-muted" />
        </span>
        <span className="org-kpi-value text-title-lg text-text-primary">{value === null ? "–" : n(value)}</span>
      </Link>
    </li>
  );

  const insideNow = live?.analytics ? Math.max(0, ...live.analytics.gate_breakdown.map((g) => g.current_occupancy)) : null;
  const checklist: { key: string; label: string; done: boolean; to: string; action: string }[] = [
    { key: "program", label: copy.overview.checklistItems.program, done: sessions > 0, to: "/program", action: commonCopy[locale].add },
    { key: "tiers", label: copy.overview.checklistItems.tiers, done: tiers.length > 0, to: "/tiers", action: commonCopy[locale].add },
    { key: "points", label: copy.overview.checklistItems.points, done: points.length > 0, to: "/check-in", action: commonCopy[locale].add },
    { key: "page", label: copy.overview.checklistItems.page, done: published, to: "/page", action: copy.overview.publish },
    ...(manager ? [{ key: "operators", label: copy.overview.checklistItems.operators, done: activeOperators > 0, to: "/operators", action: commonCopy[locale].add }] : []),
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        title={copy.overview.title}
        meta={formatDateRange(event.starts_at, event.ends_at, locale, event.timezone)}
        actions={
          primary || publicLink ? (
            <>
              {publicLink}
              {primary}
            </>
          ) : undefined
        }
      />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {upcoming ? (
        <section aria-labelledby="overview-checklist" className="rounded-card border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6" data-testid="setup-checklist">
          <h2 id="overview-checklist" className="text-title-sm font-bold text-text-primary">
            {copy.overview.checklist}
          </h2>
          <ul className="mt-3 divide-y divide-border-subtle">
            {checklist.map((row) => (
              <li key={row.key} className="flex min-h-12 items-center gap-3 py-2">
                <Icon
                  name={row.done ? "check-circle" : "x-circle"}
                  size={20}
                  className={`shrink-0 ${row.done ? "text-status-success-text" : "text-text-muted"}`}
                />
                <span className="min-w-0 flex-1 text-body-sm font-medium text-text-primary">{row.label}</span>
                {row.done ? (
                  <span className="text-meta text-status-success-text">{copy.overview.done}</span>
                ) : canEdit ? (
                  <LinkButton to={path(row.to)} variant="secondary" size="sm">
                    {row.action}
                  </LinkButton>
                ) : (
                  <span className="text-meta text-text-muted">{copy.overview.notYet}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-label={copy.overview.liveLabel} className="space-y-3">
          {live?.failed && <FormAlert>{copy.overview.liveFailed}</FormAlert>}
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tile("admitted", copy.overview.admitted, live?.analytics?.unique_admitted ?? null, "/analytics", "check-circle")}
            {tile("registered", copy.overview.registered, live?.analytics?.total_tickets ?? null, "/analytics", "ticket")}
            {tile("inside", copy.overview.inside, insideNow, "/analytics", "users")}
            {staff &&
              tile("scanners", copy.overview.scanners, live?.scannersToCheck ?? null, "/check-in", "device", (live?.scannersToCheck ?? 0) > 0 ? "warning" : "default")}
          </ul>
          {(live?.failedSms ?? 0) > 0 && (
            <Link
              to={path("/sms")}
              data-testid="failed-sms"
              className="flex min-h-12 items-center gap-2 rounded-control border border-status-danger-border bg-status-danger-bg px-4 text-body-sm font-semibold text-status-danger-text"
            >
              <Icon name="mail" size={18} />
              <span className="flex-1">{copy.overview.failedSms(n(live?.failedSms ?? 0))}</span>
              <Icon name="arrow-right" size={18} />
            </Link>
          )}
        </section>
      )}

      <section aria-labelledby="capacity-title" className="rounded-card border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
        <h2 id="capacity-title" className="text-title-sm font-bold text-text-primary">
          {copy.overview.capacity}
        </h2>
        {tiers.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-secondary">{copy.overview.noTiers}</p>
        ) : (
          <>
            <div className="mt-3 space-y-2">
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm text-text-secondary">
                <span>{copy.overview.reservedOf(n(totalReserved), n(totalQuota))}</span>
                <span className="tabular">
                  {formatPercent(capacity, locale)} · {copy.overview.open(n(Math.max(0, totalQuota - totalReserved)))}
                </span>
              </p>
              <Meter value={capacity * 100} label={copy.overview.capacity} size="lg" tone={capacity >= 1 ? "full" : "default"} />
            </div>
            <ul className="mt-4 divide-y divide-border-subtle">
              {tiers.map((tier) => {
                const pct = tier.quota > 0 ? Math.min(100, Math.round(((tier.reserved_count ?? 0) / tier.quota) * 100)) : 0;
                return (
                  <li key={tier.id} className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-3 text-body-sm">
                      <bdi className="min-w-0 break-words font-semibold text-text-primary">{tier.name}</bdi>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant={tier.is_open ? "success" : "neutral"} size="sm">
                          {tier.is_open ? commonCopy[locale].status.open : commonCopy[locale].status.closed}
                        </Badge>
                        <bdi dir="ltr" className="tabular font-semibold text-text-primary">
                          {n(tier.reserved_count)} / {n(tier.quota)}
                        </bdi>
                      </span>
                    </div>
                    <Meter value={pct} label={tier.name} tone={pct >= 100 ? "full" : tier.is_open ? "default" : "muted"} />
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <EventSettingsPanel event={event} reservedCount={totalReserved} onEdit={() => setEditing(event)} onNotice={setNotice} />

      <EventEditDialog
        event={editing}
        apiKey={apiKey}
        locale={locale}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          replaceEvent(saved);
          setEditing(null);
          setNotice({ tone: "ok", text: copy.form.saved });
        }}
      />
    </div>
  );
}
