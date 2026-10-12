import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type AttendanceAnalyticsResponse,
  type CheckInPointOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";
import { formatLocalizedNumber } from "../lib/i18n";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

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
      <div className="space-y-6 animate-pulse">
        <div className="w-64 h-8 bg-surface-panel-subtle rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
          <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
          <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 1. Header & Live Telemetry Status Bar */}
      <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand" size="sm">
                {event?.name || t.organizerConsole}
              </Badge>
              <span className="text-xs text-text-muted">•</span>
              <span className="text-xs text-text-muted font-medium">
                {autoRefresh ? `🟢 ${t.analyticsPollingActive}` : `⏸️ ${t.analyticsPollingPaused}`}
              </span>
              {lastRefreshedAt && (
                <>
                  <span className="text-xs text-text-muted">•</span>
                  <span className="text-xs font-mono text-text-muted">
                    {t.lastRefreshedLabel}: <bdi dir="ltr">{lastRefreshedAt}</bdi>
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
              {t.analyticsTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {t.analyticsSubtitle}
            </p>
          </div>

          {/* Action Cluster (Refresh Toggle, CSV Export, Return) */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant={autoRefresh ? "outline" : "secondary"}
              size="sm"
              onClick={() => setAutoRefresh((prev) => !prev)}
              className="gap-1.5"
            >
              <span>{autoRefresh ? "⏸️" : "▶️"}</span>
              <span>{autoRefresh ? (isRtl ? "توقف استعلام" : "Pause") : (isRtl ? "شروع استعلام" : "Resume")}</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isExporting}
              onClick={handleDownloadCsv}
              className="gap-1.5 shadow-xs"
            >
              <span>📥</span>
              <span>{isExporting ? t.exportingCsv : t.exportAttendanceCsvAction}</span>
            </Button>
          </div>
        </div>

        {/* Honest Offline Synchronization Caveat */}
        <div className="p-3.5 rounded-xl bg-surface-panel-subtle border border-border-subtle text-xs text-text-muted leading-relaxed space-y-1.5">
          <p>{t.offlineSyncDisclaimer}</p>
          <p>
            {isRtl
              ? "فیلترها فقط نمای روی صفحه را تغییر می‌دهند؛ فایل CSV شامل همهٔ ورودهای این همایش است."
              : "Filters change this view only; the CSV export always covers every scan for this event."}
          </p>
        </div>
      </div>

      {/* Global Error Banner */}
      {(error || exportError) && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
        >
          {error ? t.staleDataWarning : exportError}
        </div>
      )}

      {/* 2. Filter Bar */}
      <div className="p-4 sm:p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-wrap items-center gap-4">
        <div className="text-xs font-bold uppercase tracking-wider text-text-muted shrink-0">
          {isRtl ? "فیلترها:" : "Filters:"}
        </div>

        {/* Point Filter */}
        <div className="flex-1 min-w-[200px] max-w-xs">
          <select
            value={selectedPointId}
            onChange={(e) => setSelectedPointId(e.target.value)}
            className="w-full px-3 py-2 bg-surface-page border border-border-default rounded-xl text-xs text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            aria-label={t.filterByPoint}
          >
            <option value="">{t.allPointsFilter}</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.policy_type})
              </option>
            ))}
          </select>
        </div>

        {/* Tier Filter */}
        <div className="flex-1 min-w-[200px] max-w-xs">
          <select
            value={selectedTierId}
            onChange={(e) => setSelectedTierId(e.target.value)}
            className="w-full px-3 py-2 bg-surface-page border border-border-default rounded-xl text-xs text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            aria-label={t.filterByTier}
          >
            <option value="">{t.allTiersFilter}</option>
            {tiers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name} ({tr.quota})
              </option>
            ))}
          </select>
        </div>

        {/* Clear Filters Button */}
        {(selectedPointId || selectedTierId) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedPointId("");
              setSelectedTierId("");
            }}
            className="text-xs text-status-danger-text hover:bg-status-danger-bg shrink-0"
          >
            ✕ {t.clearFiltersAction}
          </Button>
        )}
      </div>

      {analytics && (
        <>
          {/* 3. Primary KPI Cards Grid (4 Cards) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {/* KPI 1: Total Registered Passes */}
            <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-2">
              <span className="text-xs font-semibold text-text-muted block">
                {t.totalRegisteredKPI}
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-text-primary block tracking-tight">
                {formatLocalizedNumber(analytics.total_tickets, locale)}
              </span>
              <p className="text-[11px] text-text-secondary leading-normal">
                {t.totalRegisteredDesc}
              </p>
            </div>

            {/* KPI 2: Unique Admitted Attendees */}
            <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text-muted block">
                  {t.uniqueAdmittedKPI}
                </span>
                <span className="text-[11px] font-bold text-action-primary bg-action-subtle px-2 py-0.5 rounded-full border border-action-subtle-border">
                  <bdi dir="ltr">{analytics.checkin_rate.toFixed(1)}%</bdi>
                </span>
              </div>
              <span className="text-2xl sm:text-3xl font-extrabold text-text-primary block tracking-tight">
                {formatLocalizedNumber(analytics.unique_admitted, locale)}
              </span>
              {/* Semantic Progress Bar */}
              <div
                role="progressbar"
                aria-valuenow={Math.round(analytics.checkin_rate)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full bg-surface-panel-subtle rounded-full h-2 overflow-hidden border border-border-subtle"
              >
                <div
                  className="bg-action-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(analytics.checkin_rate, 100)}%` }}
                />
              </div>
            </div>

            {/* KPI 3: Total Scan Operations */}
            <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-2">
              <span className="text-xs font-semibold text-text-muted block">
                {t.totalScansKPI}
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-text-primary block tracking-tight">
                {formatLocalizedNumber(analytics.total_scans, locale)}
              </span>
              <div className="flex items-center gap-3 text-xs pt-0.5">
                <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  ✓ {formatLocalizedNumber(analytics.total_admitted, locale)} {t.admittedLabel}
                </span>
                <span className="font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                  ✕ {formatLocalizedNumber(analytics.total_rejected, locale)} {t.rejectedLabel}
                </span>
              </div>
            </div>

            {/* KPI 4: Cumulative Admissions (Factually Labeled, Never Live Occupancy) */}
            <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-2">
              <span className="text-xs font-semibold text-text-muted block">
                {t.cumulativeAdmittedLabel}
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-text-primary block tracking-tight">
                {formatLocalizedNumber(analytics.total_admitted, locale)}
              </span>
              <p className="text-[11px] text-text-secondary leading-normal">
                {isRtl
                  ? "مجموع اسکن‌های معتبر ثبت‌شده در تمامی گیت‌ها (بدون احتساب خروج)"
                  : "Sum of valid entries across all points (exits not tracked)"}
              </p>
            </div>
          </section>

          {/* 4. Catering & Meal Redemption Section */}
          {analytics.catering_metrics.length > 0 && (
            <section aria-labelledby="catering-section-title" className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="brand" size="sm">
                    SINGLE_USE
                  </Badge>
                  <h2 id="catering-section-title" className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                    🍽️ {t.cateringSectionTitle}
                  </h2>
                </div>
                <p className="text-xs sm:text-sm text-text-secondary">
                  {t.cateringSectionDesc}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analytics.catering_metrics.map((cat) => (
                  <div
                    key={cat.point_id}
                    className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-base text-text-primary">
                        {cat.point_name}
                      </h3>
                      <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                        <bdi dir="ltr">{cat.redemption_rate.toFixed(1)}%</bdi> {t.cateringRedemptionRate}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-extrabold text-text-primary">
                        {formatLocalizedNumber(cat.meals_served, locale)}
                      </span>
                      <span className="text-xs text-text-muted">
                        / {formatLocalizedNumber(cat.total_attendees, locale)} {t.cateringMealsServed}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div
                      role="progressbar"
                      aria-valuenow={Math.round(cat.redemption_rate)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="w-full bg-surface-panel-subtle rounded-full h-2 overflow-hidden border border-border-subtle"
                    >
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(cat.redemption_rate, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 5. Gate-by-Gate Throughput & Hourly Activity */}
          <section aria-labelledby="gate-throughput-title" className="space-y-4">
            <div className="space-y-1">
              <h2 id="gate-throughput-title" className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
                🚪 {t.gateThroughputSectionTitle}
              </h2>
            </div>

            {analytics.gate_breakdown.length === 0 ? (
              <Card className="p-8 text-center text-xs text-text-muted border-border-default">
                {t.noGatesMatchFilter}
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {analytics.gate_breakdown.map((gate) => (
                  <article
                    key={gate.point_id}
                    aria-labelledby={`gate-heading-${gate.point_id}`}
                    className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 id={`gate-heading-${gate.point_id}`} className="font-bold text-base text-text-primary">
                          {gate.point_name}
                        </h3>
                        <Badge variant="neutral" size="sm">
                          {gate.policy_type}
                        </Badge>
                      </div>

                      <p className="text-xs text-text-secondary">
                        📍 {gate.location || (isRtl ? "موقعیت نامشخص" : "General Venue Area")}
                      </p>

                      {/* Triple Metrics Breakdown */}
                      <div className="grid grid-cols-3 gap-2 text-center pt-1">
                        <div className="p-2.5 rounded-xl bg-surface-page border border-border-subtle">
                          <span className="text-[10px] font-bold text-text-muted uppercase block">
                            {t.admittedLabel}
                          </span>
                          <span className="text-base font-extrabold text-emerald-700 block">
                            {formatLocalizedNumber(gate.total_admitted, locale)}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-surface-page border border-border-subtle">
                          <span className="text-[10px] font-bold text-text-muted uppercase block">
                            {t.rejectedLabel}
                          </span>
                          <span className="text-base font-extrabold text-rose-700 block">
                            {formatLocalizedNumber(gate.total_rejected, locale)}
                          </span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-surface-page border border-border-subtle">
                          <span className="text-[10px] font-bold text-text-muted uppercase block">
                            {t.cumulativeAdmittedLabel}
                          </span>
                          <span className="text-base font-extrabold text-text-primary block">
                            {formatLocalizedNumber(gate.current_occupancy, locale)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Hourly Activity Visualization & Accessible Data Table */}
                    <div className="pt-3 border-t border-border-subtle space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-text-muted uppercase tracking-wider text-[11px]">
                          {t.hourlyDistributionLabel}
                        </span>
                        {gate.hourly_scans.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleHourlyTable(gate.point_id)}
                            className="text-action-primary hover:underline font-medium text-[11px] cursor-pointer"
                          >
                            {showHourlyTable[gate.point_id]
                              ? (isRtl ? "نمایش نمودار" : "View Bar Chart")
                              : t.hourlyTableToggle}
                          </button>
                        )}
                      </div>

                      {gate.hourly_scans.length === 0 ? (
                        <p className="text-xs text-text-muted py-2 text-center">
                          {t.noHourlyScansLogged}
                        </p>
                      ) : showHourlyTable[gate.point_id] ? (
                        /* Accessible Data Table Alternative */
                        <div className="overflow-x-auto rounded-xl border border-border-subtle">
                          <table className="w-full text-xs text-start">
                            <thead className="bg-surface-panel-subtle text-text-muted font-bold">
                              <tr>
                                <th scope="col" className="p-2 text-start">{t.hourColumn}</th>
                                <th scope="col" className="p-2 text-end">{t.scansCountColumn}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border-subtle">
                              {gate.hourly_scans.map((h) => (
                                <tr key={h.hour} className="hover:bg-surface-page">
                                  <td className="p-2 font-mono"><bdi dir="ltr">{h.hour}</bdi></td>
                                  <td className="p-2 text-end font-bold font-mono">
                                    {formatLocalizedNumber(h.count, locale)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        /* Semantic SVG/HTML Bar Chart */
                        <div className="space-y-1.5 pt-1">
                          {gate.hourly_scans.map((h) => {
                            const maxInGate = Math.max(
                              ...gate.hourly_scans.map((item) => item.count),
                              1
                            );
                            const pct = (h.count / maxInGate) * 100;
                            return (
                              <div
                                key={h.hour}
                                className="flex items-center gap-2.5 text-xs"
                              >
                                <span className="font-mono text-text-muted w-14 shrink-0 text-start text-[11px]">
                                  <bdi dir="ltr">{h.hour}</bdi>
                                </span>
                                <div className="flex-1 bg-surface-panel-subtle rounded-full h-2.5 overflow-hidden border border-border-subtle">
                                  <div
                                    className="bg-action-primary h-2.5 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.max(pct, 4)}%` }}
                                  />
                                </div>
                                <span className="font-bold text-text-primary w-10 text-end text-[11px] font-mono">
                                  {formatLocalizedNumber(h.count, locale)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
