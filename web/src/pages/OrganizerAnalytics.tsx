import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type AttendanceAnalyticsResponse,
  type CheckInPointOut,
  type EventOut,
  type HourlyScanCount,
  type TicketTierOut,
} from "../api/client";
import { formatLocalizedNumber } from "../lib/i18n";
import { eventOperationNumber } from "../lib/organizerWorkspace";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, Meter, SectionHeader } from "../components/organizer/WorkspaceUi";

/**
 * Hourly buckets come back sparse ("HH:00", only hours with scans). For the chart the gaps between
 * the first and last reported hour are filled with their true value, zero; unknown formats pass through.
 */
function hourlySeries(scans: HourlyScanCount[]): HourlyScanCount[] {
  const byHour = new Map<number, number>();
  for (const h of scans) {
    const hour = /^(\d{1,2}):/.exec(h.hour);
    if (!hour) return scans;
    byHour.set(Number(hour[1]), (byHour.get(Number(hour[1])) ?? 0) + h.count);
  }
  if (byHour.size === 0) return scans;
  const hours = [...byHour.keys()];
  const first = Math.min(...hours);
  const last = Math.max(...hours);
  return Array.from({ length: last - first + 1 }, (_, i) => ({
    hour: `${String(first + i).padStart(2, "0")}:00`,
    count: byHour.get(first + i) ?? 0,
  }));
}

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerAnalytics() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerAnalyticsContent key={eventId} />;
}

function OrganizerAnalyticsContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, reportEvent, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [analytics, setAnalytics] = useState<AttendanceAnalyticsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  // Filters
  const [selectedPointId, setSelectedPointId] = useState<string>("");
  const [selectedTierId, setSelectedTierId] = useState<string>("");

  // Table toggle for accessible hourly data
  const [showHourlyTable, setShowHourlyTable] = useState<Record<string, boolean>>({});

  // CSV Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!eventId || !apiKey) return;
    let isMounted = true;

    const loadData = async (silent = false) => {
      if (!silent) setLoading(true);

      const client = createApiClient({ kind: "organizer", token: apiKey });
      const [evRes, pointsRes, tiersRes, analyticsRes] = await Promise.all([
        client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/checkin-points", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/ticket-tiers", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/analytics/attendance", {
          params: {
            path: { event_id: eventId },
            query: {
              point_id: selectedPointId || undefined,
              ticket_tier_id: selectedTierId || undefined,
            },
          },
        }),
      ]);

      // 401 invalidates only the key that was sent, even if this page has since unmounted.
      if ([evRes, pointsRes, tiersRes, analyticsRes].some((res) => res.response.status === 401)) {
        onKeyRejected(apiKey);
      }
      if (!isMounted) return;

      if (evRes.data) setEvent(evRes.data);
      if (pointsRes.data) setPoints(pointsRes.data);
      if (tiersRes.data) setTiers(tiersRes.data);

      if (analyticsRes.error) {
        setError(formatApiError(analyticsRes.error));
      } else if (analyticsRes.data) {
        setAnalytics(analyticsRes.data);
        setError(null);
        setLastRefreshedAt(new Date().toLocaleTimeString(locale === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }

      if (!silent) setLoading(false);
    };

    loadData();

    // 10s Background Polling
    const interval = autoRefresh
      ? setInterval(() => {
          loadData(true);
        }, 10000)
      : undefined;

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [eventId, apiKey, onKeyRejected, selectedPointId, selectedTierId, autoRefresh, locale]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const handleDownloadCsv = async () => {
    if (!eventId || !event || !apiKey) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const client = createApiClient({ kind: "organizer", token: apiKey });
      const { data: blob, response } = await client.GET("/api/events/{event_id}/analytics/export-csv", {
        params: { path: { event_id: eventId } },
        parseAs: "blob",
      });
      if (response.status === 401) onKeyRejected(apiKey);
      if (!response.ok || !blob) {
        setExportError(isRtl ? "دریافت فایل CSV انجام نشد." : "Failed to export attendance CSV.");
        setIsExporting(false);
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event.slug}-attendance.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setExportError(isRtl ? "خطای شبکه هنگام دریافت CSV." : "Network error while exporting CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const toggleHourlyTable = (pointId: string) => {
    setShowHourlyTable((prev) => ({
      ...prev,
      [pointId]: !prev[pointId],
    }));
  };

  if (loading && !analytics) {
    return (
      <div className="space-y-6" aria-hidden="true">
        <div className="skeleton h-24 w-full max-w-xl rounded-2xl" />
        <div className="skeleton h-20 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
      </div>
    );
  }

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const numberLocale = locale === "fa" ? "fa-IR" : "en-US";
  const pct = (rate: number) =>
    new Intl.NumberFormat(numberLocale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rate / 100);
  const twoDigits = new Intl.NumberFormat(numberLocale, { minimumIntegerDigits: 2, useGrouping: false });
  /** "08:00" in the page's digits. */
  const hourText = (hour: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(hour);
    return match ? `${twoDigits.format(Number(match[1]))}:${twoDigits.format(Number(match[2]))}` : hour;
  };
  const policyLabel: Record<string, string> = {
    SINGLE_USE: t.policySingleUse,
    MULTI_ENTRY: t.policyMultiEntry,
    TIER_RESTRICTED: t.policyTierRestricted,
    CAPACITY_CAPPED: t.policyCapacityCapped,
  };
  const maxGateTotal = Math.max(1, ...(analytics?.gate_breakdown ?? []).map((g) => g.total_admitted + g.total_rejected));

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader
        index={eventOperationNumber("analytics")}
        eyebrow={event?.name || t.organizerConsole}
        title={t.analyticsTitle}
        description={t.analyticsSubtitle}
        action={
          <>
            <Button type="button" variant={autoRefresh ? "outline" : "secondary"} size="md" onClick={() => setAutoRefresh((prev) => !prev)}>
              <Icon name={autoRefresh ? "pause" : "play"} size={16} />
              <span>{autoRefresh ? (isRtl ? "توقف استعلام" : "Pause") : isRtl ? "شروع استعلام" : "Resume"}</span>
            </Button>
            <Button type="button" variant="primary" size="md" disabled={isExporting} onClick={handleDownloadCsv}>
              <Icon name="download" size={18} />
              <span>{isExporting ? t.exportingCsv : t.exportAttendanceCsvAction}</span>
            </Button>
          </>
        }
      />

      {/* Telemetry status, filters and the honest data caveat */}
      <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border-subtle px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2.5 text-xs font-semibold text-text-primary">
            {autoRefresh ? (
              <span className="org-live" aria-hidden="true">
                <span className="motion-safe:animate-pulse-ring" />
                <span />
              </span>
            ) : (
              <Icon name="pause" size={14} className="text-text-muted" />
            )}
            {autoRefresh ? t.analyticsPollingActive : t.analyticsPollingPaused}
          </span>
          {lastRefreshedAt && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              <Icon name="clock" size={14} />
              {t.lastRefreshedLabel}: <bdi dir="ltr" className="font-mono tabular">{lastRefreshedAt}</bdi>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
          <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-text-muted">
            <Icon name="filter" size={16} />
            {isRtl ? "فیلترها:" : "Filters:"}
          </span>
          <select
            value={selectedPointId}
            onChange={(e) => setSelectedPointId(e.target.value)}
            className="ui-select text-sm sm:w-auto sm:min-w-[14rem] sm:flex-1 lg:max-w-xs"
            aria-label={t.filterByPoint}
          >
            <option value="">{t.allPointsFilter}</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({policyLabel[p.policy_type] ?? p.policy_type})
              </option>
            ))}
          </select>
          <select
            value={selectedTierId}
            onChange={(e) => setSelectedTierId(e.target.value)}
            className="ui-select text-sm sm:w-auto sm:min-w-[14rem] sm:flex-1 lg:max-w-xs"
            aria-label={t.filterByTier}
          >
            <option value="">{t.allTiersFilter}</option>
            {tiers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name} ({fmt(tr.quota)})
              </option>
            ))}
          </select>
          {(selectedPointId || selectedTierId) && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setSelectedPointId("");
                setSelectedTierId("");
              }}
              className="shrink-0 text-status-danger-text hover:bg-status-danger-bg"
            >
              <Icon name="x" size={16} />
              {t.clearFiltersAction}
            </Button>
          )}
        </div>

        <div className="flex items-start gap-3 bg-surface-panel-subtle px-4 py-3.5 text-xs leading-relaxed text-text-muted sm:px-6">
          <Icon name="info" size={16} className="mt-0.5 shrink-0 text-aiteb-slate" />
          <div className="space-y-1">
            <p>{t.offlineSyncDisclaimer}</p>
            <p>
              {isRtl
                ? "فیلترها فقط نمای روی صفحه را تغییر می‌دهند؛ فایل CSV شامل همهٔ ورودهای این همایش است."
                : "Filters change this view only; the CSV export always covers every scan for this event."}
            </p>
          </div>
        </div>
      </div>

      {/* Global Error Banner */}
      {(error || exportError) && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-4 py-3 text-sm leading-relaxed text-status-danger-text"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{error ? t.staleDataWarning : exportError}</span>
        </div>
      )}

      {analytics && (
        <>
          {/* KPI strip */}
          <section aria-label={isRtl ? "شاخص‌های کلیدی" : "Key figures"} className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-3 p-5 sm:p-6">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.totalRegisteredKPI}
                <Icon name="ticket" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(analytics.total_tickets)}</span>
              <p className="text-xs leading-relaxed text-text-secondary">{t.totalRegisteredDesc}</p>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:border-s sm:border-t-0 sm:p-6">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.uniqueAdmittedKPI}
                <span className="rounded-full border border-action-subtle-border bg-action-subtle px-2 py-0.5 text-[0.6875rem] font-bold text-action-primary">
                  <bdi className="tabular">{pct(analytics.checkin_rate)}</bdi>
                </span>
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(analytics.unique_admitted)}</span>
              <Meter value={analytics.checkin_rate} label={t.checkinRateKPI} className="mt-auto" />
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:p-6 xl:border-s xl:border-t-0">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.totalScansKPI}
                <Icon name="scan" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(analytics.total_scans)}</span>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-status-success-text">
                  <span aria-hidden="true" className="size-2 rounded-full bg-status-success-solid" />
                  {fmt(analytics.total_admitted)} {t.admittedLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-status-danger-text">
                  <span aria-hidden="true" className="size-2 rounded-full bg-status-danger-solid" />
                  {fmt(analytics.total_rejected)} {t.rejectedLabel}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:border-s sm:p-6 xl:border-t-0">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.cumulativeAdmittedLabel}
                <Icon name="check-circle" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(analytics.total_admitted)}</span>
              <p className="text-xs leading-relaxed text-text-secondary">
                {isRtl ? "مجموع اسکن‌های معتبر ثبت‌شده در تمامی گیت‌ها (بدون احتساب خروج)" : "Sum of valid entries across all points (exits not tracked)"}
              </p>
            </div>
          </section>

          {/* Catering & Meal Redemption */}
          {analytics.catering_metrics.length > 0 && (
            <section aria-labelledby="catering-section-title" className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-status-warning-bg text-status-warning-text">
                  <Icon name="utensils" size={20} />
                </span>
                <div className="space-y-1">
                  <h2 id="catering-section-title" className="text-xl font-[660] tracking-[-0.02em] text-text-primary">
                    {t.cateringSectionTitle}
                  </h2>
                  <p className="text-sm text-text-secondary">{t.cateringSectionDesc}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {analytics.catering_metrics.map((cat) => (
                  <div key={cat.point_id} className="space-y-4 shape-arc border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 break-words text-base font-bold text-text-primary">
                        <bdi>{cat.point_name}</bdi>
                      </h3>
                      <Badge variant="warning" size="sm">
                        <bdi className="tabular">{pct(cat.redemption_rate)}</bdi> {t.cateringRedemptionRate}
                      </Badge>
                    </div>
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="org-kpi-value text-[2.5rem] text-text-primary">{fmt(cat.meals_served)}</span>
                      <span className="text-sm text-text-muted">
                        / {fmt(cat.total_attendees)} {t.cateringMealsServed}
                      </span>
                    </p>
                    <Meter value={cat.redemption_rate} label={`${cat.point_name} ${t.cateringRedemptionRate}`} size="lg" tone={cat.redemption_rate >= 100 ? "full" : "default"} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Gate-by-Gate Throughput & Hourly Activity */}
          <section aria-labelledby="gate-throughput-title" className="space-y-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                <Icon name="gate" size={20} />
              </span>
              <h2 id="gate-throughput-title" className="pt-1.5 text-xl font-[660] tracking-[-0.02em] text-text-primary">
                {t.gateThroughputSectionTitle}
              </h2>
            </div>

            {analytics.gate_breakdown.length === 0 ? (
              <EmptyState icon="gate" title={t.noGatesMatchFilter} />
            ) : (
              <>
                {/* Gate comparison: each bar is the gate's scans relative to the busiest gate */}
                <div className="space-y-5 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="org-throughput__admit h-2.5 w-6 rounded-full" />
                      {t.admittedLabel}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="org-throughput__reject h-2.5 w-6 rounded-full" />
                      {t.rejectedLabel}
                    </span>
                  </div>
                  <ul className="space-y-4">
                    {analytics.gate_breakdown.map((gate) => {
                      const total = gate.total_admitted + gate.total_rejected;
                      return (
                        <li key={gate.point_id} className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                          <bdi className="min-w-0 truncate text-sm font-semibold text-text-primary">{gate.point_name}</bdi>
                          <div className="org-throughput" aria-hidden="true">
                            <span className="org-throughput__admit" style={{ inlineSize: `${(gate.total_admitted / maxGateTotal) * 100}%` }} />
                            <span className="org-throughput__reject" style={{ inlineSize: `${(gate.total_rejected / maxGateTotal) * 100}%` }} />
                          </div>
                          <span className="text-xs text-text-secondary sm:text-end">
                            <span className="tabular font-semibold text-status-success-text">{fmt(gate.total_admitted)}</span>
                            <span className="text-text-muted"> / </span>
                            <span className="tabular font-semibold text-status-danger-text">{fmt(gate.total_rejected)}</span>
                            <span className="sr-only">
                              {" "}
                              ({t.admittedLabel} / {t.rejectedLabel}, {fmt(total)})
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  {analytics.gate_breakdown.map((gate) => {
                    const series = hourlySeries(gate.hourly_scans);
                    const peak = Math.max(1, ...series.map((item) => item.count));
                    const peakHour = series.find((item) => item.count === peak);
                    const labelStep = Math.max(1, Math.ceil(series.length / 8));
                    return (
                      <article
                        key={gate.point_id}
                        aria-labelledby={`gate-heading-${gate.point_id}`}
                        className="flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft"
                      >
                        <div className="space-y-4 p-5 sm:p-6">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <h3 id={`gate-heading-${gate.point_id}`} className="break-words text-base font-bold text-text-primary">
                                <bdi>{gate.point_name}</bdi>
                              </h3>
                              <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                                <Icon name="pin" size={14} className="shrink-0 text-text-muted" />
                                <bdi>{gate.location || (isRtl ? "موقعیت نامشخص" : "General Venue Area")}</bdi>
                              </p>
                            </div>
                            <Badge variant="neutral" size="sm">
                              {policyLabel[gate.policy_type] ?? gate.policy_type}
                            </Badge>
                          </div>

                          <dl className="grid grid-cols-3 divide-x divide-border-subtle rounded-xl border border-border-subtle bg-surface-page">
                            {([
                              [t.admittedLabel, gate.total_admitted, "text-status-success-text"],
                              [t.rejectedLabel, gate.total_rejected, "text-status-danger-text"],
                              [t.gateScansLabel, gate.total_admitted + gate.total_rejected, "text-text-primary"],
                            ] as const).map(([label, value, tone]) => (
                              <div key={label} className="min-w-0 px-3 py-2.5">
                                <dt className="truncate text-[0.6875rem] font-semibold text-text-muted" title={label}>
                                  {label}
                                </dt>
                                <dd className={`org-kpi-value mt-1.5 text-xl ${tone}`}>{fmt(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>

                        {/* Hourly Activity Visualization & Accessible Data Table */}
                        <div className="mt-auto space-y-4 border-t border-border-subtle px-5 py-5 sm:px-6">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-text-muted">{t.hourlyDistributionLabel}</span>
                            {gate.hourly_scans.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleHourlyTable(gate.point_id)}
                                aria-pressed={Boolean(showHourlyTable[gate.point_id])}
                                className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-action-primary transition-colors hover:bg-action-subtle focus-visible:outline-2 focus-visible:outline-focus-ring"
                              >
                                <Icon name={showHourlyTable[gate.point_id] ? "chart" : "grid"} size={14} />
                                {showHourlyTable[gate.point_id] ? (isRtl ? "نمایش نمودار" : "View Bar Chart") : t.hourlyTableToggle}
                              </button>
                            )}
                          </div>

                          {gate.hourly_scans.length === 0 ? (
                            <p className="py-6 text-center text-xs text-text-muted">{t.noHourlyScansLogged}</p>
                          ) : showHourlyTable[gate.point_id] ? (
                            /* Accessible Data Table Alternative */
                            <div className="max-h-72 overflow-y-auto rounded-xl border border-border-subtle">
                              <table className="org-table text-xs">
                                <thead>
                                  <tr>
                                    <th scope="col">{t.hourColumn}</th>
                                    <th scope="col" className="text-end">
                                      {t.scansCountColumn}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {gate.hourly_scans.map((h) => (
                                    <tr key={h.hour}>
                                      <td className="!py-2.5 font-mono">
                                        <bdi dir="ltr">{hourText(h.hour)}</bdi>
                                      </td>
                                      <td className="!py-2.5 text-end font-mono font-semibold tabular">{fmt(h.count)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            /* Column chart; the data table above is its accessible equivalent */
                            <figure className="space-y-2">
                              <div className="org-columns" dir="ltr" aria-hidden="true">
                                {series.map((h) => (
                                  <div key={h.hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${hourText(h.hour)} · ${fmt(h.count)}`}>
                                    {series.length <= 12 && h.count > 0 && (
                                      <span className="font-mono text-[11px] font-semibold text-text-secondary">{fmt(h.count)}</span>
                                    )}
                                    <div
                                      className="org-column w-full max-w-7"
                                      data-empty={h.count === 0 ? "true" : undefined}
                                      style={{ blockSize: h.count === 0 ? "2px" : `${Math.max(4, (h.count / peak) * 82)}%` }}
                                    />
                                  </div>
                                ))}
                              </div>
                              <div dir="ltr" className="flex gap-1" aria-hidden="true">
                                {series.map((h, i) => (
                                  <span key={h.hour} className="min-w-0 flex-1 text-center font-mono text-[11px] text-text-muted">
                                    {i % labelStep === 0 ? fmt(Number(h.hour.slice(0, 2))) : ""}
                                  </span>
                                ))}
                              </div>
                              <figcaption className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-text-muted">
                                <span>
                                  {isRtl ? "ساعت" : "Hour of day"} <bdi dir="ltr" className="font-mono">({hourText(series[0]?.hour ?? "")} – {hourText(series[series.length - 1]?.hour ?? "")})</bdi>
                                </span>
                                {peakHour && (
                                  <span>
                                    {isRtl ? "اوج:" : "Peak:"} <bdi dir="ltr" className="font-mono font-semibold text-text-primary">{hourText(peakHour.hour)}</bdi> ·{" "}
                                    <span className="tabular font-semibold text-text-primary">{fmt(peakHour.count)}</span>
                                  </span>
                                )}
                              </figcaption>
                            </figure>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
