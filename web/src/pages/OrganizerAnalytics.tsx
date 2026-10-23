import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  localizedApiError,
  type AttendanceAnalyticsResponse,
  type CheckInPointOut,
  type EventOut,
  type HourlyScanCount,
  type TicketTierOut,
} from "../api/client";
import { bucketSeries, formatClock, formatDay, formatHour, todayIn, type SeriesPoint } from "../lib/analyticsTime";
import { networkErrorMessage } from "../lib/errorMessages";
import { formatLocalizedNumber, type AttendeeLocale } from "../lib/i18n";
import { eventOperationNumber } from "../lib/organizerWorkspace";
import { sessionAllows } from "../lib/organizerConsole";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, Meter, SectionHeader } from "../components/organizer/WorkspaceUi";

/** The dashboard refreshes this often while the tab is visible and auto-refresh is on. */
const POLL_MS = 30_000;
/** Until the first response names the event's zone (every event so far is in Tehran). */
const FALLBACK_TIMEZONE = "Asia/Tehran";
const NETWORK_ERROR = Symbol("network");

type CsvKind = "attendance" | "registrations";
type Translations = OrganizerOutletContext["t"];

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerAnalytics() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerAnalyticsContent key={eventId} />;
}

function OrganizerAnalyticsContent() {
  const { eventId } = useParams<{ eventId: string }>();
  // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
  const { apiKey, reportEvent, session, locale, t } = useOutletContext<OrganizerOutletContext>();
  // Row-level exports are a manager's (backend/app/roles.py).
  const canExport = sessionAllows(session, "manager");

  const [event, setEvent] = useState<EventOut | null>(null);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  // The response and the filters it answers: data for other filters is never shown as if it were current.
  const [analytics, setAnalytics] = useState<{ key: string; data: AttendanceAnalyticsResponse } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [reloads, setReloads] = useState(0);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");

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

  // The event, its points and its tiers: loaded once, they do not change while the dashboard polls.
  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!eventId || !apiKey) return;
    let active = true;
    const client = createApiClient({ kind: "organizer", token: apiKey });
    const path = { path: { event_id: eventId } };
    Promise.all([
      client.GET("/api/events/{event_id}", { params: path }),
      client.GET("/api/events/{event_id}/checkin-points", { params: path }),
      client.GET("/api/events/{event_id}/ticket-tiers", { params: path }),
    ])
      .then(([evRes, pointsRes, tiersRes]) => {
        // 401 invalidates only the key that was sent, even if this page has since unmounted.
        if (!active) return;
        if (evRes.data) setEvent(evRes.data);
        if (pointsRes.data) setPoints(pointsRes.data);
        if (tiersRes.data) setTiers(tiersRes.data);
      })
      .catch(() => {
        // The analytics request reports connectivity; the filters simply stay empty.
      });
    return () => {
      active = false;
    };
  }, [eventId, apiKey]);

  // The figures for the current filters. Only the newest request may write, so a slow answer for earlier
  // filters (or an older poll) never replaces a newer one.
  const latestRequest = useRef(0);
  const loadAnalytics = useCallback(async () => {
    if (!eventId || !apiKey) return;
    const request = ++latestRequest.current;
    const key = JSON.stringify([pointId, tierId, day]);
    const client = createApiClient({ kind: "organizer", token: apiKey });
    try {
      const res = await client.GET("/api/events/{event_id}/analytics/attendance", {
        params: {
          path: { event_id: eventId },
          query: { point_id: pointId || undefined, ticket_tier_id: tierId || undefined, day: day || undefined },
        },
      });
      // 401 invalidates only the key that was sent, even if the answer is no longer wanted.
      if (request !== latestRequest.current) return;
      if (res.data) {
        setAnalytics({ key, data: res.data });
        setError(null);
        setRefreshedAt(Date.now());
      } else {
        setError(res.error ?? { detail: `HTTP ${res.response.status}` });
      }
    } catch {
      if (request === latestRequest.current) setError(NETWORK_ERROR);
    }
  }, [eventId, apiKey, pointId, tierId, day]);

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

  // A late answer after leaving the page writes nothing.
  useEffect(
    () => () => {
      latestRequest.current = Number.NaN;
    },
    [],
  );

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const current = analytics?.key === filterKey ? analytics.data : null;
  // The zone and the day list stay known while a new filter is loading.
  const timezone = analytics?.data.timezone ?? FALLBACK_TIMEZONE;
  const days = analytics?.data.days ?? [];
  const today = todayIn(timezone);
  const errorText =
    error === null ? null : error === NETWORK_ERROR ? networkErrorMessage[locale] : localizedApiError(error, locale);

  const retry = () => {
    setError(null);
    setReloads((n) => n + 1);
  };

  const downloadCsv = async (kind: CsvKind) => {
    if (!eventId || !apiKey) return;
    setExporting(kind);
    setExportError(null);
    try {
      const client = createApiClient({ kind: "organizer", token: apiKey });
      // The same filters as the dashboard, so the file matches what is on screen.
      const options = {
        params: {
          path: { event_id: eventId },
          query: { point_id: pointId || undefined, ticket_tier_id: tierId || undefined, day: day || undefined },
        },
        parseAs: "blob" as const,
      };
      const { data: blob, response } =
        kind === "attendance"
          ? await client.GET("/api/events/{event_id}/analytics/export-csv", options)
          : await client.GET("/api/events/{event_id}/analytics/registrations-csv", options);
      if (!response.ok || !blob) {
        setExportError(t.csvExportFailed);
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event?.slug ?? eventId}-${kind}${day ? `-${day}` : ""}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setExportError(t.csvNetworkError);
    } finally {
      setExporting(null);
    }
  };

  const fmt = (n: number) => formatLocalizedNumber(n, locale);
  const numberLocale = locale === "fa" ? "fa-IR" : "en-US";
  const pct = (rate: number) =>
    new Intl.NumberFormat(numberLocale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rate / 100);
  const policyLabel: Record<string, string> = {
    SINGLE_USE: t.policySingleUse,
    MULTI_ENTRY: t.policyMultiEntry,
    TIER_RESTRICTED: t.policyTierRestricted,
    CAPACITY_CAPPED: t.policyCapacityCapped,
  };
  const statusLabel: Record<string, string> = { active: t.ticketsActiveLabel, cancelled: t.ticketsCancelledLabel };
  const polling = autoRefresh && visible;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader
        index={eventOperationNumber("analytics")}
        eyebrow={event?.name || t.organizerConsole}
        title={t.analyticsTitle}
        description={t.analyticsSubtitle}
        action={
          <>
            <Button type="button" variant={autoRefresh ? "outline" : "secondary"} size="md" onClick={() => {
                // Resuming refreshes at once; pausing sends nothing.
                if (!autoRefresh) setReloads((n) => n + 1);
                setAutoRefresh(!autoRefresh);
              }}>
              <Icon name={autoRefresh ? "pause" : "play"} size={16} />
              <span>{autoRefresh ? t.analyticsPauseAction : t.analyticsResumeAction}</span>
            </Button>
            {canExport && (
              <>
                <Button type="button" variant="outline" size="md" disabled={exporting !== null} onClick={() => void downloadCsv("registrations")}>
                  <Icon name="users" size={18} />
                  <span>{exporting === "registrations" ? t.exportingCsv : t.exportRegistrationsCsvAction}</span>
                </Button>
                <Button type="button" variant="primary" size="md" disabled={exporting !== null} onClick={() => void downloadCsv("attendance")}>
                  <Icon name="download" size={18} />
                  <span>{exporting === "attendance" ? t.exportingCsv : t.exportAttendanceCsvAction}</span>
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Refresh status, filters and the honest data caveat */}
      <div className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border-subtle px-4 py-3 sm:px-6">
          <span className="inline-flex items-center gap-2.5 text-xs font-semibold text-text-primary" data-testid="analytics-polling">
            {polling ? (
              <span className="org-live" aria-hidden="true">
                <span className="motion-safe:animate-pulse-ring" />
                <span />
              </span>
            ) : (
              <Icon name="pause" size={14} className="text-text-muted" />
            )}
            {!autoRefresh ? t.analyticsPollingPaused : visible ? t.analyticsPollingActive : t.analyticsPollingHidden}
          </span>
          {refreshedAt !== null && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              <Icon name="clock" size={14} />
              {t.lastRefreshedLabel}:{" "}
              <bdi dir="ltr" className="font-mono tabular" data-testid="analytics-refreshed-at">
                {formatClock(refreshedAt, timezone, locale)}
              </bdi>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <Icon name="globe" size={14} />
            {t.analyticsTimezoneNote}: <bdi dir="ltr">{timezone}</bdi>
          </span>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-6">
          <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-text-muted">
            <Icon name="filter" size={16} />
            {t.filtersLabel}
          </span>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="ui-select text-sm sm:w-auto sm:min-w-[12rem] sm:flex-1 lg:max-w-xs"
            aria-label={t.analyticsDayFilter}
          >
            <option value="">{t.allDaysFilter}</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDay(d, locale)}
                {d === today ? ` (${t.todayLabel})` : ""}
              </option>
            ))}
          </select>
          <select
            value={pointId}
            onChange={(e) => setPointId(e.target.value)}
            className="ui-select text-sm sm:w-auto sm:min-w-[12rem] sm:flex-1 lg:max-w-xs"
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
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="ui-select text-sm sm:w-auto sm:min-w-[12rem] sm:flex-1 lg:max-w-xs"
            aria-label={t.filterByTier}
          >
            <option value="">{t.allTiersFilter}</option>
            {tiers.map((tr) => (
              <option key={tr.id} value={tr.id}>
                {tr.name} ({fmt(tr.quota)})
              </option>
            ))}
          </select>
          {(pointId || tierId || day) && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setPointId("");
                setTierId("");
                setDay("");
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
            <p>{t.analyticsFiltersApply}</p>
          </div>
        </div>
      </div>

      {exportError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg px-4 py-3 text-sm leading-relaxed text-status-danger-text"
        >
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          <span>{exportError}</span>
        </div>
      )}

      {/* A failed refresh keeps the figures on screen but says they may be stale. */}
      {current && errorText && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm leading-relaxed text-status-warning-text"
        >
          <Icon name="alert" size={18} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {t.staleDataWarning} <bdi>{errorText}</bdi>
          </span>
          <Button type="button" variant="ghost" size="md" onClick={retry}>
            <Icon name="sync" size={16} />
            {t.analyticsRetryAction}
          </Button>
        </div>
      )}

      {!current && errorText ? (
        // Never zeros in place of figures that could not be loaded.
        <div role="alert" data-testid="analytics-error">
          <EmptyState
            icon="wifi-off"
            title={t.analyticsLoadFailedTitle}
            action={
              <Button type="button" variant="primary" size="md" onClick={retry}>
                <Icon name="sync" size={16} />
                {t.analyticsRetryAction}
              </Button>
            }
          >
            <bdi>{errorText}</bdi>
          </EmptyState>
        </div>
      ) : !current ? (
        <div className="space-y-6" aria-hidden="true" data-testid="analytics-loading">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="skeleton h-36 rounded-2xl" />
            <div className="skeleton h-36 rounded-2xl" />
            <div className="skeleton h-36 rounded-2xl" />
            <div className="skeleton h-36 rounded-2xl" />
          </div>
          <div className="skeleton h-56 rounded-2xl" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <section aria-label={t.analyticsTitle} className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex flex-col gap-3 p-5 sm:p-6">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.totalRegisteredKPI}
                <Icon name="ticket" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]" data-testid="kpi-registered">
                {fmt(current.total_tickets)}
              </span>
              <p className="text-xs leading-relaxed text-text-secondary">{t.totalRegisteredDesc}</p>
              {current.tickets_by_status.some((s) => s.status !== "active") && (
                <ul className="mt-auto flex flex-wrap gap-1.5">
                  {current.tickets_by_status
                    .filter((s) => s.status !== "active")
                    .map((s) => (
                      <li key={s.status}>
                        <Badge variant="neutral" size="sm">
                          {statusLabel[s.status] ?? s.status} <span className="tabular">{fmt(s.count)}</span>
                        </Badge>
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:border-s sm:border-t-0 sm:p-6">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.uniqueAdmittedKPI}
                <span className="rounded-full border border-action-subtle-border bg-action-subtle px-2 py-0.5 text-[0.6875rem] font-bold text-action-primary">
                  <bdi className="tabular">{pct(current.checkin_rate)}</bdi>
                </span>
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(current.unique_admitted)}</span>
              <Meter value={current.checkin_rate} label={t.checkinRateKPI} className="mt-auto" />
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:p-6 xl:border-s xl:border-t-0">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.totalScansKPI}
                <Icon name="scan" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]" data-testid="kpi-scans">
                {fmt(current.total_scans)}
              </span>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-status-success-text">
                  <span aria-hidden="true" className="size-2 rounded-full bg-status-success-solid" />
                  {fmt(current.total_admitted)} {t.admittedLabel}
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-status-danger-text">
                  <span aria-hidden="true" className="size-2 rounded-full bg-status-danger-solid" />
                  {fmt(current.total_rejected)} {t.rejectedLabel}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-border-subtle p-5 sm:border-s sm:p-6 xl:border-t-0">
              <span className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                {t.admissionsLabel}
                <Icon name="check-circle" size={18} className="text-aiteb-indigo/60" />
              </span>
              <span className="org-kpi-value text-[2.75rem] text-text-primary sm:text-[3.25rem]">{fmt(current.total_admitted)}</span>
              <p className="text-xs leading-relaxed text-text-secondary">{t.admissionsDesc}</p>
            </div>
          </section>

          {/* Scans per hour across the selected points */}
          <section aria-labelledby="event-hourly-title" className="space-y-4 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
            <h2 id="event-hourly-title" className="text-base font-bold text-text-primary">
              {t.eventHourlyTitle}
            </h2>
            <HourlyActivity id="event" buckets={current.hourly_scans} timezone={timezone} locale={locale} t={t} fmt={fmt} />
          </section>

          {/* Registrations per tier */}
          {current.tier_registrations.length > 0 && (
            <section aria-labelledby="tier-registrations-title" className="space-y-4 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:p-6">
              <h2 id="tier-registrations-title" className="text-base font-bold text-text-primary">
                {t.tierRegistrationsTitle}
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {current.tier_registrations.map((tier) => {
                  const fill = tier.quota > 0 ? (tier.active / tier.quota) * 100 : 0;
                  return (
                    <li key={tier.tier_id} className="space-y-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <bdi className="min-w-0 truncate font-semibold text-text-primary">{tier.tier_name}</bdi>
                        <span className="text-xs text-text-secondary">
                          <span className="tabular font-semibold text-text-primary">{fmt(tier.active)}</span> / {fmt(tier.quota)} {t.tierActiveOfQuota}
                          {tier.total > tier.active && (
                            <span className="text-text-muted">
                              {" "}
                              · {t.ticketsCancelledLabel} {fmt(tier.total - tier.active)}
                            </span>
                          )}
                        </span>
                      </div>
                      <Meter value={Math.min(100, fill)} label={`${tier.tier_name} ${t.tierActiveOfQuota}`} tone={fill >= 100 ? "full" : "default"} />
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Catering & Meal Redemption */}
          {current.catering_metrics.length > 0 && (
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
                {current.catering_metrics.map((cat) => (
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

          <GateBreakdown analytics={current} timezone={timezone} locale={locale} t={t} fmt={fmt} policyLabel={policyLabel} />
        </>
      )}
    </div>
  );
}

function GateBreakdown({
  analytics,
  timezone,
  locale,
  t,
  fmt,
  policyLabel,
}: {
  analytics: AttendanceAnalyticsResponse;
  timezone: string;
  locale: AttendeeLocale;
  t: Translations;
  fmt: (n: number) => string;
  policyLabel: Record<string, string>;
}) {
  const maxGateTotal = Math.max(1, ...analytics.gate_breakdown.map((g) => g.total_admitted + g.total_rejected));
  return (
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
            {analytics.gate_breakdown.map((gate) => (
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
                      {gate.location && (
                        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <Icon name="pin" size={14} className="shrink-0 text-text-muted" />
                          <bdi>{gate.location}</bdi>
                        </p>
                      )}
                    </div>
                    <Badge variant="neutral" size="sm">
                      {policyLabel[gate.policy_type] ?? gate.policy_type}
                    </Badge>
                  </div>

                  <dl className="grid grid-cols-3 divide-x divide-border-subtle rounded-xl border border-border-subtle bg-surface-page">
                    {([
                      [t.admissionsLabel, gate.admissions, "text-status-success-text"],
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
                  <p className="text-[0.6875rem] text-text-muted">{t.gateAdmissionsNote}</p>
                </div>

                <div className="mt-auto space-y-4 border-t border-border-subtle px-5 py-5 sm:px-6">
                  <span className="text-xs font-semibold text-text-muted">{t.hourlyDistributionLabel}</span>
                  <HourlyActivity id={gate.point_id} buckets={gate.hourly_scans} timezone={timezone} locale={locale} t={t} fmt={fmt} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** A column chart of scans per hour on the event's clock, with a data table as its accessible equivalent. */
function HourlyActivity({
  id,
  buckets,
  timezone,
  locale,
  t,
  fmt,
}: {
  id: string;
  buckets: HourlyScanCount[];
  timezone: string;
  locale: AttendeeLocale;
  t: Translations;
  fmt: (n: number) => string;
}) {
  const [showTable, setShowTable] = useState(false);
  if (buckets.length === 0) return <p className="py-6 text-center text-xs text-text-muted">{t.noHourlyScansLogged}</p>;

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
    <div className="space-y-3" data-testid={`hourly-${id}`}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowTable((prev) => !prev)}
          aria-pressed={showTable}
          className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-action-primary transition-colors hover:bg-action-subtle focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <Icon name={showTable ? "chart" : "grid"} size={14} />
          {t.hourlyTableToggle}
        </button>
      </div>
      {showTable ? (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border-subtle">
          <table className="org-table text-xs">
            <thead>
              <tr>
                <th scope="col">{t.hourColumn}</th>
                <th scope="col" className="text-end">
                  {t.admittedLabel}
                </th>
                <th scope="col" className="text-end">
                  {t.rejectedLabel}
                </th>
                <th scope="col" className="text-end">
                  {t.scansCountColumn}
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
                    <td className="!py-2.5 text-end font-mono tabular">{fmt(p.admitted)}</td>
                    <td className="!py-2.5 text-end font-mono tabular">{fmt(p.rejected)}</td>
                    <td className="!py-2.5 text-end font-mono font-semibold tabular">{fmt(p.count)}</td>
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
                {series.length <= 12 && p.count > 0 && <span className="font-mono text-[11px] font-semibold text-text-secondary">{fmt(p.count)}</span>}
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
              <span key={p.starts_at} className="min-w-0 flex-1 text-center font-mono text-[11px] text-text-muted">
                {i % labelStep === 0 ? hour(p).slice(0, -3) : ""}
              </span>
            ))}
          </div>
          <figcaption className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-text-muted">
            <span>
              {t.hourColumn}{" "}
              <bdi data-testid={`hourly-range-${id}`}>
                ({when(first)} – {when(last)})
              </bdi>
            </span>
            {peakPoint && (
              <span>
                {t.peakLabel}: <bdi className="font-semibold text-text-primary">{when(peakPoint)}</bdi> ·{" "}
                <span className="tabular font-semibold text-text-primary">{fmt(peakPoint.count)}</span>
              </span>
            )}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
