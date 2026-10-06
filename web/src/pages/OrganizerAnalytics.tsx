import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  formatApiError,
  getApiClient,
  type AttendanceAnalyticsResponse,
  type CheckInPointOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";

export default function OrganizerAnalytics() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey } = useOutletContext<{ apiKey: string }>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [analytics, setAnalytics] = useState<AttendanceAnalyticsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filters
  const [selectedPointId, setSelectedPointId] = useState<string>("");
  const [selectedTierId, setSelectedTierId] = useState<string>("");

  const loadData = async (silent = false) => {
    if (!eventId) return;
    if (!silent) setLoading(true);

    const client = getApiClient(apiKey);
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

    if (evRes.data) setEvent(evRes.data);
    if (pointsRes.data) setPoints(pointsRes.data);
    if (tiersRes.data) setTiers(tiersRes.data);

    if (analyticsRes.error) {
      setError(formatApiError(analyticsRes.error));
    } else if (analyticsRes.data) {
      setAnalytics(analyticsRes.data);
      setError(null);
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [eventId, apiKey, selectedPointId, selectedTierId]);

  // Auto-refresh interval (10s)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, eventId, apiKey, selectedPointId, selectedTierId]);

  const handleDownloadCsv = () => {
    if (!eventId || !event) return;
    const url = `/api/events/${eventId}/analytics/export-csv`;
    // Trigger download with organizer bearer token via fetch
    fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
      .then((res) => res.blob())
      .then((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${event.slug}-attendance.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
  };

  if (loading && !analytics) {
    return (
      <div className="py-16 text-center text-sm text-neutral-500 font-sans">
        Loading live attendance metrics...
      </div>
    );
  }

  if (error && !analytics) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm font-sans">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Live Real-Time Telemetry
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Attendance & Gate Analytics
          </h1>
          <p className="text-xs text-neutral-500">
            {event?.name} • Live Gate KPIs and Capacity Monitoring
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1.5 border ${
              autoRefresh
                ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                : "bg-neutral-100 text-neutral-600 border-neutral-300"
            }`}
          >
            <span>{autoRefresh ? "🟢 Live (10s)" : "⏸️ Paused"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            className="bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-xs flex items-center gap-1.5"
          >
            <span>📥 Download CSV</span>
          </button>

          <Link
            to={`/organizer/events/${eventId}`}
            className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition"
          >
            ← Back
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-xs flex flex-wrap items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Filters:
        </span>

        <select
          value={selectedPointId}
          onChange={(e) => setSelectedPointId(e.target.value)}
          className="text-xs bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-1.5 text-neutral-800 focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Check-In Points</option>
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.policy_type})
            </option>
          ))}
        </select>

        <select
          value={selectedTierId}
          onChange={(e) => setSelectedTierId(e.target.value)}
          className="text-xs bg-neutral-50 border border-neutral-300 rounded-lg px-2.5 py-1.5 text-neutral-800 focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">All Ticket Tiers</option>
          {tiers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        {(selectedPointId || selectedTierId) && (
          <button
            type="button"
            onClick={() => {
              setSelectedPointId("");
              setSelectedTierId("");
            }}
            className="text-xs text-red-600 hover:text-red-800 font-semibold underline underline-offset-2 ml-auto"
          >
            Clear Filters
          </button>
        )}
      </div>

      {analytics && (
        <>
          {/* Top KPI Cards */}
          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Total Registered Attendees
              </p>
              <p className="text-3xl font-black text-neutral-900">
                {analytics.total_tickets.toLocaleString()}
              </p>
              <p className="text-[11px] text-neutral-400">
                Total passes reserved across all open tiers
              </p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                  Unique Attendees Admitted
                </p>
                <span className="text-xs font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {analytics.checkin_rate.toFixed(1)}% Checked In
                </span>
              </div>
              <p className="text-3xl font-black text-neutral-900">
                {analytics.unique_admitted.toLocaleString()}
              </p>
              {/* Progress bar */}
              <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-600 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(analytics.checkin_rate, 100)}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">
                Total Scan Operations
              </p>
              <p className="text-3xl font-black text-neutral-900">
                {analytics.total_scans.toLocaleString()}
              </p>
              <p className="text-xs text-neutral-500">
                <span className="text-emerald-700 font-semibold">
                  ✓ {analytics.total_admitted} Admitted
                </span>{" "}
                •{" "}
                <span className="text-red-600 font-semibold">
                  ✕ {analytics.total_rejected} Rejected
                </span>
              </p>
            </div>
          </section>

          {/* Catering Meal Redemption Widget */}
          {analytics.catering_metrics.length > 0 && (
            <section className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-neutral-900">
                    🍽️ Catering & Meal Redemption Metrics
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Single-use checkpoint meal tracking (strictly 1 meal per attendee).
                  </p>
                </div>
                <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                  Single-Use Enforcement Active
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {analytics.catering_metrics.map((cat) => (
                  <div
                    key={cat.point_id}
                    className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-sm text-neutral-900">
                        {cat.point_name}
                      </h3>
                      <span className="text-xs font-bold text-emerald-700">
                        {cat.redemption_rate.toFixed(1)}% Served
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-black text-neutral-900">
                        {cat.meals_served.toLocaleString()}
                      </span>
                      <span className="text-xs text-neutral-500">
                        / {cat.total_attendees.toLocaleString()} total attendees
                      </span>
                    </div>

                    <div className="w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(cat.redemption_rate, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Gate-by-Gate Throughput Breakdown */}
          <section className="space-y-4">
            <h2 className="text-base font-bold text-neutral-900">
              🚪 Gate-by-Gate Throughput & Hourly Trends
            </h2>

            {analytics.gate_breakdown.length === 0 ? (
              <div className="bg-white p-8 rounded-2xl border border-neutral-200 text-center text-xs text-neutral-400">
                No check-in points found matching the selected filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {analytics.gate_breakdown.map((gate) => (
                  <div
                    key={gate.point_id}
                    className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-neutral-900 text-base">
                          {gate.point_name}
                        </h3>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            gate.policy_type === "SINGLE_USE"
                              ? "bg-amber-100 text-amber-800"
                              : gate.policy_type === "TIER_RESTRICTED"
                              ? "bg-purple-100 text-purple-800"
                              : gate.policy_type === "CAPACITY_CAPPED"
                              ? "bg-rose-100 text-rose-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {gate.policy_type}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500">
                        📍 {gate.location || "General Area"}
                      </p>

                      <div className="pt-2 grid grid-cols-3 gap-2 text-center">
                        <div className="bg-neutral-50 p-2 rounded-lg border border-neutral-100">
                          <p className="text-[10px] uppercase font-bold text-neutral-400">
                            Admitted
                          </p>
                          <p className="text-base font-extrabold text-emerald-700">
                            {gate.total_admitted}
                          </p>
                        </div>
                        <div className="bg-neutral-50 p-2 rounded-lg border border-neutral-100">
                          <p className="text-[10px] uppercase font-bold text-neutral-400">
                            Rejected
                          </p>
                          <p className="text-base font-extrabold text-red-600">
                            {gate.total_rejected}
                          </p>
                        </div>
                        <div className="bg-neutral-50 p-2 rounded-lg border border-neutral-100">
                          <p className="text-[10px] uppercase font-bold text-neutral-400">
                            Occupancy
                          </p>
                          <p className="text-base font-extrabold text-neutral-800">
                            {gate.current_occupancy}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Hourly Distribution Visual Bars */}
                    <div className="pt-2 border-t border-neutral-100 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Hourly Scan Distribution
                      </p>
                      {gate.hourly_scans.length === 0 ? (
                        <p className="text-[11px] text-neutral-400 py-1">
                          No scans logged during this window.
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {gate.hourly_scans.map((h) => {
                            const maxInGate = Math.max(
                              ...gate.hourly_scans.map((item) => item.count),
                              1
                            );
                            const pct = (h.count / maxInGate) * 100;
                            return (
                              <div
                                key={h.hour}
                                className="flex items-center gap-2 text-[11px]"
                              >
                                <span className="font-mono text-neutral-500 w-12 shrink-0">
                                  {h.hour}
                                </span>
                                <div className="flex-1 bg-neutral-100 rounded-full h-2 overflow-hidden">
                                  <div
                                    className="bg-emerald-600 h-2 rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="font-bold text-neutral-700 w-8 text-right">
                                  {h.count}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
