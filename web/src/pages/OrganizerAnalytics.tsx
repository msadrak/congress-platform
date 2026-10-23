import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  isNetworkFailure,
  localizedApiError,
  type AttendanceAnalyticsResponse,
  type CheckInPointOut,
  type EventOut,
  type HourlyScanCount,
  type TicketTierOut,
} from "../api/client";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { Select } from "../components/ui/Input";
import { ErrorState } from "../components/ui/StateBlock";
import { EmptyState, Field, Meter, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";
import { organizerDataCopy } from "../copy/organizerData";
import { bucketSeries, formatClock, formatDay, formatHour, todayIn, type SeriesPoint } from "../lib/analyticsTime";
import { formatNumber, formatPercent, timeZoneLabel } from "../lib/format";
import { createRequestGate } from "../lib/requestGate";
import { EventSectionGate } from "./organizer/EventSectionUi";

/** The dashboard refreshes this often while the tab is visible and auto-refresh is on. */
const POLL_MS = 30_000;

type CsvKind = "attendance" | "registrations";
type Locale = "fa" | "en";
type AnalyticsCopy = (typeof organizerDataCopy)[Locale]["analytics"];

// The event workspace remounts per event, so a late response for event A can never write into event B's state.
export default function OrganizerAnalytics() {
  return <EventSectionGate>{(event) => <AnalyticsSection event={event} />}</EventSectionGate>;
}

function AnalyticsSection({ event }: { event: EventOut }) {
  // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
  const { eventId, client, locale, can } = useEventWorkspace();
  const copy = organizerDataCopy[locale].analytics;

  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  // The response and the filters it answers: data for other filters is never shown as if it were current.
  const [analytics, setAnalytics] = useState<{ key: string; data: AttendanceAnalyticsResponse } | null>(null);
  // Kept as the API answered and localized when shown, so a language switch re-words it.
  const [failure, setFailure] = useState<{ body: unknown; status: number; offline: boolean } | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [reloads, setReloads] = useState(0);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [pointId, setPointId] = useState("");
  const [tierId, setTierId] = useState("");
  const [day, setDay] = useState("");
  const filterKey = JSON.stringify([pointId, tierId, day]);

  const [exporting, setExporting] = useState<CsvKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The points and pass types for the filters: loaded once, they do not change while the dashboard polls.
  useEffect(() => {
    if (!client) return;
    let active = true;
    const path = { path: { event_id: eventId } };
    void Promise.all([
      client.GET("/api/events/{event_id}/checkin-points", { params: path }),
      client.GET("/api/events/{event_id}/ticket-tiers", { params: path }),
    ]).then(([pointsRes, tiersRes]) => {
      // The analytics request reports connectivity; the filters simply stay empty.
      if (!active) return;
      if (pointsRes.data) setPoints(pointsRes.data);
      if (tiersRes.data) setTiers(tiersRes.data);
    });
    return () => {
      active = false;
    };
  }, [client, eventId]);

  // The figures for the current filters. Only the newest request may write, so a slow answer for earlier
  // filters (or an older poll) never replaces a newer one.
  const [requests] = useState(createRequestGate);
  const loadAnalytics = useCallback(async () => {
    if (!client) return;
    const request = requests.begin();
    const key = JSON.stringify([pointId, tierId, day]);
    // The workspace client answers a network failure as an error result.
    const res = await client.GET("/api/events/{event_id}/analytics/attendance", {
      params: {
        path: { event_id: eventId },
        query: { point_id: pointId || undefined, ticket_tier_id: tierId || undefined, day: day || undefined },
      },
    });
    if (!requests.isLatest(request)) return;
    if (res.data) {
      setAnalytics({ key, data: res.data });
      setFailure(null);
      setRefreshedAt(Date.now());
    } else {
      setFailure({ body: res.error, status: res.response.status, offline: isNetworkFailure(res.response) });
    }
  }, [client, eventId, pointId, tierId, day, requests]);

  // Fetched when the filters change, on retry, and on coming back to a hidden tab; never while hidden.
  useEffect(() => {
    if (!visible) return;
    // oxlint-disable-next-line react/set-state-in-effect -- loadAnalytics only sets state after the request resolves; the effect syncs the server's figures for these filters.
    void loadAnalytics();
  }, [loadAnalytics, visible, reloads]);

  // Polled every POLL_MS only while the tab is visible and auto-refresh is on.
  useEffect(() => {
    if (!visible || !autoRefresh) return;
    const interval = window.setInterval(() => void loadAnalytics(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [loadAnalytics, visible, autoRefresh]);

  // A late answer after leaving the page writes nothing. The gate reopens for the next request, so StrictMode's
  // development remount (cleanup, then the effects again) still shows its figures.
  useEffect(() => () => requests.invalidate(), [requests]);

  const current = analytics?.key === filterKey ? analytics.data : null;
  // The zone and the day list stay known while a new filter is loading.
  const timezone = analytics?.data.timezone ?? event.timezone;
  const days = analytics?.data.days ?? [];
  const today = todayIn(timezone);
  const errorText = failure ? localizedApiError(failure.body, locale, failure.status) : null;

  const retry = () => {
    setFailure(null);
    setReloads((n) => n + 1);
  };

  const downloadCsv = async (kind: CsvKind) => {
    if (!client) return;
    setExporting(kind);
    setExportError(null);
    // The same filters as the dashboard, so the file matches what is on screen.
    const options = {
      params: {
        path: { event_id: eventId },
        query: { point_id: pointId || undefined, ticket_tier_id: tierId || undefined, day: day || undefined },
      },
      parseAs: "blob" as const,
    };
    const { data: blob, error, response } =
      kind === "attendance"
        ? await client.GET("/api/events/{event_id}/analytics/export-csv", options)
        : await client.GET("/api/events/{event_id}/analytics/registrations-csv", options);
    setExporting(null);
    if (!response.ok || !blob) {
      setExportError(error ? localizedApiError(error, locale, response.status) : copy.exportFailed);
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${event.slug}-${kind}${day ? `-${day}` : ""}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  };

  const fmt = (n: number) => formatNumber(n, locale);
  const pct = (rate: number) => formatPercent(rate / 100, locale, 1);
  // Row-level exports need the manager role (backend/app/roles.py); viewers and staff would get 403.
  const canExport = can("manager");
  const policies: Record<string, string> = copy.policies;
  const policyLabel = (policy: string) => policies[policy] ?? policy;
  const polling = autoRefresh && visible;
  const filtered = Boolean(pointId || tierId || day);
  const activeFilters = [pointId, tierId, day].filter(Boolean).length;
  const clearFilters = () => {
    setPointId("");
    setTierId("");
    setDay("");
  };

  const filterFields = (
    <>
      <Field label={copy.day}>
        <Select value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="">{copy.allDays}</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {formatDay(d, locale)}
              {d === today ? ` (${copy.today})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={copy.point}>
        <Select value={pointId} onChange={(e) => setPointId(e.target.value)}>
          <option value="">{copy.allPoints}</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({policyLabel(p.policy_type)})
            </option>
          ))}
        </Select>
      </Field>
      <Field label={copy.tier}>
        <Select value={tierId} onChange={(e) => setTierId(e.target.value)}>
          <option value="">{copy.allTiers}</option>
          {tiers.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );

  return (
    <div className="space-y-5">
      <SectionHeader
        title={copy.title}
        action={
          <div className="flex items-center gap-2">
            <IconButton
              icon={autoRefresh ? "pause" : "play"}
              label={autoRefresh ? copy.pause : copy.resume}
              variant="secondary"
              aria-pressed={!autoRefresh}
              onClick={() => {
                // Resuming refreshes at once; pausing sends nothing.
                if (!autoRefresh) setReloads((n) => n + 1);
                setAutoRefresh(!autoRefresh);
              }}
            />
            {canExport && <ExportMenu copy={copy} busy={exporting !== null} onExport={(kind) => void downloadCsv(kind)} />}
          </div>
        }
      />

      {/* Refresh state and the congress clock; on phones the filters wait behind «فیلتر». */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-text-muted">
        <span className="inline-flex items-center gap-2 font-semibold text-text-primary" data-testid="analytics-polling">
          {polling ? (
            <span className="org-live" aria-hidden="true">
              <span className="motion-safe:animate-pulse-ring" />
              <span />
            </span>
          ) : (
            <Icon name="pause" size={14} className="text-text-muted" />
          )}
          {!autoRefresh ? copy.pollingPaused : visible ? copy.pollingLive : copy.pollingHidden}
        </span>
        {refreshedAt !== null && (
          <span className="inline-flex items-center gap-1.5">
            <Icon name="clock" size={14} />
            {copy.lastRefreshed}{" "}
            <bdi dir="ltr" className="tabular" data-testid="analytics-refreshed-at">
              {formatClock(refreshedAt, timezone, locale)}
            </bdi>
          </span>
        )}
        <Badge variant="neutral" size="sm" icon={<Icon name="globe" size={12} />}>
          <bdi title={timezone} data-testid="analytics-timezone">
            {timeZoneLabel(timezone, locale)}
          </bdi>
        </Badge>
        <Button type="button" variant="secondary" size="sm" icon="filter" className="ms-auto sm:hidden" onClick={() => setFiltersOpen(true)} data-testid="analytics-filter-button">
          {activeFilters > 0 ? `${copy.filters} (${fmt(activeFilters)})` : copy.filters}
        </Button>
      </div>

      <div role="search" aria-label={copy.filtersTitle} className="flex flex-wrap items-end gap-3 max-sm:hidden [&>*]:w-56">
        {filterFields}
        {filtered && (
          <Button type="button" variant="ghost" icon="x" className="!w-auto" onClick={clearFilters}>
            {copy.clearFilters}
          </Button>
        )}
      </div>

      {exportError && <Notice tone="danger">{exportError}</Notice>}

      {/* A failed refresh keeps the figures on screen but says they may be stale. */}
      {current && errorText && (
        <Notice
          tone="warning"
          action={
            <Button type="button" variant="ghost" size="sm" icon="sync" onClick={retry}>
              {copy.retry}
            </Button>
          }
        >
          <span role="alert">
            {copy.staleData} <bdi>{errorText}</bdi>
          </span>
        </Notice>
      )}

      {!current && errorText ? (
        // Never zeros in place of figures that could not be loaded.
        <div data-testid="analytics-error">
          <ErrorState title={copy.loadFailedTitle} offline={failure?.offline} onRetry={retry} retryLabel={copy.retry}>
            <bdi>{errorText}</bdi>
          </ErrorState>
        </div>
      ) : !current ? (
        <div className="space-y-5" aria-hidden="true" data-testid="analytics-loading">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-28 rounded-card" />
            ))}
          </div>
          <div className="skeleton h-56 rounded-card" />
        </div>
      ) : (
        <>
          <section aria-label={copy.kpis} className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="analytics-kpis">
            <Kpi label={copy.registered} icon="ticket" value={fmt(current.total_tickets)} testId="kpi-registered">
              {current.tickets_by_status
                .filter((s) => s.status === "cancelled")
                .map((s) => (
                  <span key={s.status}>
                    {copy.cancelled} <span className="tabular">{fmt(s.count)}</span>
                  </span>
                ))}
            </Kpi>
            <Kpi label={copy.peopleAdmitted} icon="users" value={fmt(current.unique_admitted)}>
              <span className="flex items-center gap-2">
                <Meter value={current.checkin_rate} label={copy.attendanceRate} className="flex-1" />
                <bdi className="tabular font-semibold text-action-primary">{pct(current.checkin_rate)}</bdi>
              </span>
            </Kpi>
            <Kpi label={copy.allScans} icon="scan" value={fmt(current.total_scans)} testId="kpi-scans">
              <span className="font-semibold text-status-success-text">
                {fmt(current.total_admitted)} {copy.admitted}
              </span>
              {" · "}
              <span className="font-semibold text-status-danger-text">
                {fmt(current.total_rejected)} {copy.rejected}
              </span>
            </Kpi>
            <Kpi label={copy.entries} icon="check-circle" value={fmt(current.total_admitted)}>
              {copy.entriesHint}
            </Kpi>
          </section>

          <Card titleId="event-hourly-title" title={copy.hourlyTitle}>
            <HourlyActivity id="event" buckets={current.hourly_scans} timezone={timezone} locale={locale} copy={copy} fmt={fmt} />
          </Card>

          {current.tier_registrations.length > 0 && (
            <Card titleId="tier-registrations-title" title={copy.tierTitle}>
              <ul className="grid gap-4 md:grid-cols-2">
                {current.tier_registrations.map((tier) => {
                  const fill = tier.quota > 0 ? (tier.active / tier.quota) * 100 : 0;
                  return (
                    <li key={tier.tier_id} className="space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
                        <bdi className="min-w-0 truncate font-semibold text-text-primary">{tier.tier_name}</bdi>
                        <span className="tabular text-caption text-text-secondary">
                          {copy.ofQuota(fmt(tier.active), fmt(tier.quota))}
                          {tier.total > tier.active && (
                            <span className="text-text-muted">
                              {" · "}
                              {copy.cancelled} {fmt(tier.total - tier.active)}
                            </span>
                          )}
                        </span>
                      </div>
                      <Meter value={Math.min(100, fill)} label={tier.tier_name} tone={fill >= 100 ? "full" : "default"} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {current.catering_metrics.length > 0 && (
            <Card titleId="catering-section-title" title={copy.catering}>
              <ul className="grid gap-4 md:grid-cols-2">
                {current.catering_metrics.map((cat) => (
                  <li key={cat.point_id} className="space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
                      <bdi className="min-w-0 truncate font-semibold text-text-primary">{cat.point_name}</bdi>
                      <span className="tabular text-caption text-text-secondary">
                        {copy.mealsOf(fmt(cat.meals_served), fmt(cat.total_attendees))} · {pct(cat.redemption_rate)} {copy.redeemed}
                      </span>
                    </div>
                    <Meter value={cat.redemption_rate} label={cat.point_name} tone={cat.redemption_rate >= 100 ? "full" : "default"} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <GateBreakdown analytics={current} timezone={timezone} locale={locale} copy={copy} fmt={fmt} policyLabel={policyLabel} />
        </>
      )}

      {/* Phones: the filters in a sheet. */}
      <Dialog
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={copy.filtersTitle}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2">
            {filtered && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                {copy.clearFilters}
              </Button>
            )}
            <Button type="button" variant="primary" isFullWidth onClick={() => setFiltersOpen(false)}>
              {copy.showResults}
            </Button>
          </div>
        }
      >
        <div className="space-y-4" data-testid="analytics-filter-sheet">
          {filterFields}
        </div>
      </Dialog>
    </div>
  );
}

/** The two CSV exports behind one «خروجی اکسل ▾» button (managers only). */
function ExportMenu({ copy, busy, onExport }: { copy: AnalyticsCopy; busy: boolean; onExport: (kind: CsvKind) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const items: { kind: CsvKind; label: string }[] = [
    { kind: "attendance", label: copy.exportEntries },
    { kind: "registrations", label: copy.exportRegistrations },
  ];
  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="secondary"
        icon="download"
        iconEnd="chevron-down"
        loading={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {copy.export}
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={copy.export}
          className="absolute end-0 top-full z-30 mt-1 min-w-48 rounded-control border border-border-default bg-surface-panel p-1.5 shadow-pop motion-safe:animate-pop"
        >
          {items.map((item, i) => (
            <button
              key={item.kind}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExport(item.kind);
              }}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-start text-body-sm font-medium text-text-primary hover:bg-surface-panel-subtle focus-visible:bg-surface-panel-subtle"
            >
              <Icon name={item.kind === "attendance" ? "scan" : "users"} size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, icon, value, testId, children }: { label: string; icon: "ticket" | "users" | "scan" | "check-circle"; value: string; testId?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft">
      <span className="flex items-center justify-between gap-2 text-caption font-semibold text-text-muted">
        {label}
        <Icon name={icon} size={16} className="text-text-muted" />
      </span>
      <span className="org-kpi-value text-title-lg text-text-primary" data-testid={testId}>
        {value}
      </span>
      {children && <span className="mt-auto text-caption leading-relaxed text-text-secondary">{children}</span>}
    </div>
  );
}

function Card({ title, titleId, children }: { title: string; titleId: string; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-5">
      <h2 id={titleId} className="text-title-sm font-bold text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

function GateBreakdown({
  analytics,
  timezone,
  locale,
  copy,
  fmt,
  policyLabel,
}: {
  analytics: AttendanceAnalyticsResponse;
  timezone: string;
  locale: Locale;
  copy: AnalyticsCopy;
  fmt: (n: number) => string;
  policyLabel: (policy: string) => string;
}) {
  const maxGateTotal = Math.max(1, ...analytics.gate_breakdown.map((g) => g.total_admitted + g.total_rejected));
  return (
    <section aria-labelledby="gate-throughput-title" className="space-y-3">
      <h2 id="gate-throughput-title" className="text-title-sm font-bold text-text-primary">
        {copy.gatesTitle}
      </h2>

      {analytics.gate_breakdown.length === 0 ? (
        <EmptyState icon="gate" title={copy.noGates} />
      ) : (
        <>
          {/* Point comparison: each bar is the point's scans relative to the busiest point */}
          <div className="space-y-4 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-5">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-text-muted">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="org-throughput__admit h-2.5 w-6 rounded-full" />
                {copy.admitted}
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="org-throughput__reject h-2.5 w-6 rounded-full" />
                {copy.rejected}
              </span>
            </div>
            <ul className="space-y-3">
              {analytics.gate_breakdown.map((gate) => (
                <li key={gate.point_id} className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <bdi className="min-w-0 truncate text-body-sm font-semibold text-text-primary">{gate.point_name}</bdi>
                  <div className="org-throughput" aria-hidden="true">
                    <span className="org-throughput__admit" style={{ inlineSize: `${(gate.total_admitted / maxGateTotal) * 100}%` }} />
                    <span className="org-throughput__reject" style={{ inlineSize: `${(gate.total_rejected / maxGateTotal) * 100}%` }} />
                  </div>
                  <span className="tabular text-caption text-text-secondary sm:text-end">
                    <span className="font-semibold text-status-success-text">
                      {fmt(gate.total_admitted)} <span className="sr-only">{copy.admitted}</span>
                    </span>
                    <span className="text-text-muted"> / </span>
                    <span className="font-semibold text-status-danger-text">
                      {fmt(gate.total_rejected)} <span className="sr-only">{copy.rejected}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {analytics.gate_breakdown.map((gate) => (
              <article
                key={gate.point_id}
                aria-labelledby={`gate-heading-${gate.point_id}`}
                className="space-y-4 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 id={`gate-heading-${gate.point_id}`} className="break-words text-body font-bold text-text-primary">
                      <bdi>{gate.point_name}</bdi>
                    </h3>
                    {gate.location && (
                      <p className="flex items-center gap-1.5 text-caption text-text-secondary">
                        <Icon name="pin" size={14} className="shrink-0 text-text-muted" />
                        <bdi>{gate.location}</bdi>
                      </p>
                    )}
                  </div>
                  <Badge variant="neutral" size="sm">
                    {policyLabel(gate.policy_type)}
                  </Badge>
                </div>
                <dl className="grid grid-cols-3 gap-3">
                  {(
                    [
                      [copy.entries, gate.admissions, "text-status-success-text"],
                      [copy.rejected, gate.total_rejected, "text-status-danger-text"],
                      [copy.allScans, gate.total_admitted + gate.total_rejected, "text-text-primary"],
                    ] as const
                  ).map(([label, value, tone]) => (
                    <div key={label} className="min-w-0">
                      <dt className="truncate text-caption font-semibold text-text-muted" title={label}>
                        {label}
                      </dt>
                      <dd className={`org-kpi-value mt-1 text-title-sm ${tone}`}>{fmt(value)}</dd>
                    </div>
                  ))}
                </dl>
                <HourlyActivity id={gate.point_id} buckets={gate.hourly_scans} timezone={timezone} locale={locale} copy={copy} fmt={fmt} />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** A column chart of scans per hour on the congress clock, with a data table as its accessible equivalent. */
function HourlyActivity({
  id,
  buckets,
  timezone,
  locale,
  copy,
  fmt,
}: {
  id: string;
  buckets: HourlyScanCount[];
  timezone: string;
  locale: Locale;
  copy: AnalyticsCopy;
  fmt: (n: number) => string;
}) {
  const [showTable, setShowTable] = useState(false);
  if (buckets.length === 0) return <p className="py-6 text-center text-caption text-text-muted">{copy.noHourly}</p>;

  const series = bucketSeries(buckets, timezone);
  const multiDay = new Set(series.map((p) => p.day)).size > 1;
  const peak = Math.max(1, ...series.map((p) => p.count));
  const peakPoint = series.find((p) => p.count === peak);
  const labelStep = Math.max(1, Math.ceil(series.length / 8));
  const hour = (p: SeriesPoint) => formatHour(p.starts_at, timezone, locale);
  const when = (p: SeriesPoint) => (multiDay ? `${formatDay(p.day, locale)} ${hour(p)}` : hour(p));
  const first = series[0];
  const last = series[series.length - 1];

  return (
    <div className="space-y-2" data-testid={`hourly-${id}`}>
      {showTable ? (
        <div className="max-h-72 overflow-y-auto rounded-control border border-border-subtle">
          <table className="org-table text-caption">
            <thead>
              <tr>
                <th scope="col">{copy.hour}</th>
                <th scope="col" className="text-end">
                  {copy.admitted}
                </th>
                <th scope="col" className="text-end">
                  {copy.rejected}
                </th>
                <th scope="col" className="text-end">
                  {copy.scans}
                </th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((p) => p.count > 0)
                .map((p) => (
                  <tr key={p.starts_at}>
                    <td className="!py-2.5">
                      <bdi>{when(p)}</bdi>
                    </td>
                    <td className="tabular !py-2.5 text-end">{fmt(p.admitted)}</td>
                    <td className="tabular !py-2.5 text-end">{fmt(p.rejected)}</td>
                    <td className="tabular !py-2.5 text-end font-semibold">{fmt(p.count)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <figure className="space-y-2">
          <div className="org-columns" dir="ltr" aria-hidden="true">
            {series.map((p) => (
              <div key={p.starts_at} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${when(p)} · ${fmt(p.count)}`}>
                {series.length <= 12 && p.count > 0 && <span className="tabular text-caption font-semibold text-text-secondary">{fmt(p.count)}</span>}
                <div
                  className="org-column w-full max-w-7"
                  data-empty={p.count === 0 ? "true" : undefined}
                  style={{ blockSize: p.count === 0 ? "2px" : `${Math.max(4, (p.count / peak) * 82)}%` }}
                />
              </div>
            ))}
          </div>
          <div dir="ltr" className="flex gap-1" aria-hidden="true">
            {series.map((p, i) => (
              <span key={p.starts_at} className="tabular min-w-0 flex-1 text-center text-caption text-text-muted">
                {i % labelStep === 0 ? hour(p).slice(0, -3) : ""}
              </span>
            ))}
          </div>
          <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-text-muted">
            <span>
              {copy.hour}{" "}
              <bdi data-testid={`hourly-range-${id}`}>
                ({when(first)} – {when(last)})
              </bdi>
            </span>
            {peakPoint && (
              <span>
                {copy.peak}: <bdi className="font-semibold text-text-primary">{when(peakPoint)}</bdi> ·{" "}
                <span className="tabular font-semibold text-text-primary">{fmt(peakPoint.count)}</span>
              </span>
            )}
          </figcaption>
        </figure>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" icon={showTable ? "chart" : "grid"} aria-pressed={showTable} onClick={() => setShowTable((prev) => !prev)}>
          {copy.showTable}
        </Button>
      </div>
    </div>
  );
}
