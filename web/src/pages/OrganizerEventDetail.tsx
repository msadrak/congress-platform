import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  formatApiError,
  getApiClient,
  type CheckInPointOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";

type PolicyType =
  | "MULTI_ENTRY"
  | "SINGLE_USE"
  | "TIER_RESTRICTED"
  | "CAPACITY_CAPPED";

function isPolicyType(val: string): val is PolicyType {
  return (
    val === "MULTI_ENTRY" ||
    val === "SINGLE_USE" ||
    val === "TIER_RESTRICTED" ||
    val === "CAPACITY_CAPPED"
  );
}

export default function OrganizerEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey } = useOutletContext<{ apiKey: string }>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [points, setPoints] = useState<CheckInPointOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New tier form state
  const [showTierForm, setShowTierForm] = useState(false);
  const [tierName, setTierName] = useState("");
  const [tierDescription, setTierDescription] = useState("");
  const [tierQuota, setTierQuota] = useState(100);
  const [tierIsOpen, setTierIsOpen] = useState(true);
  const [submittingTier, setSubmittingTier] = useState(false);
  const [tierFormError, setTierFormError] = useState<string | null>(null);

  // New check-in point form state
  const [showPointForm, setShowPointForm] = useState(false);
  const [pointName, setPointName] = useState("");
  const [pointLocation, setPointLocation] = useState("");
  const [policyType, setPolicyType] = useState<PolicyType>("MULTI_ENTRY");
  const [allowedTiers, setAllowedTiers] = useState<string[]>([]);
  const [maxCapacity, setMaxCapacity] = useState<number | undefined>(undefined);
  const [submittingPoint, setSubmittingPoint] = useState(false);
  const [pointFormError, setPointFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      const client = getApiClient(apiKey);

      const [eventRes, tiersRes, pointsRes] = await Promise.all([
        client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/ticket-tiers", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/checkin-points", {
          params: { path: { event_id: eventId } },
        }),
      ]);

      if (eventRes.error) {
        setError(formatApiError(eventRes.error));
      } else if (eventRes.data) {
        setEvent(eventRes.data);
      }

      if (tiersRes.error) {
        setError((prev) => prev ?? formatApiError(tiersRes.error));
      } else if (tiersRes.data) {
        setTiers(tiersRes.data);
      }

      if (pointsRes.error) {
        setError((prev) => prev ?? formatApiError(pointsRes.error));
      } else if (pointsRes.data) {
        setPoints(pointsRes.data);
      }

      setLoading(false);
    };

    loadData();
  }, [eventId, apiKey]);

  const handleCreateTier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setTierFormError(null);

    if (!tierName.trim() || tierQuota < 1) {
      setTierFormError("Please enter a valid tier name and positive quota.");
      return;
    }

    setSubmittingTier(true);
    const client = getApiClient(apiKey);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/ticket-tiers",
      {
        params: { path: { event_id: eventId } },
        body: {
          name: tierName.trim(),
          description: tierDescription.trim(),
          quota: tierQuota,
          is_open: tierIsOpen,
        },
      }
    );

    setSubmittingTier(false);
    if (err) {
      setTierFormError(formatApiError(err));
    } else if (data) {
      setTiers((prev) => [...prev, data]);
      setTierName("");
      setTierDescription("");
      setTierQuota(100);
      setTierIsOpen(true);
      setShowTierForm(false);
    }
  };

  const handleCreatePoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setPointFormError(null);

    if (!pointName.trim()) {
      setPointFormError("Please provide a name for the check-in point.");
      return;
    }

    setSubmittingPoint(true);
    const client = getApiClient(apiKey);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/checkin-points",
      {
        params: { path: { event_id: eventId } },
        body: {
          name: pointName.trim(),
          location: pointLocation.trim(),
          policy_type: policyType,
          allowed_tier_ids: policyType === "TIER_RESTRICTED" ? allowedTiers : [],
          max_capacity: policyType === "CAPACITY_CAPPED" ? maxCapacity : undefined,
        },
      }
    );

    setSubmittingPoint(false);
    if (err) {
      setPointFormError(formatApiError(err));
    } else if (data) {
      setPoints((prev) => [...prev, data]);
      setPointName("");
      setPointLocation("");
      setPolicyType("MULTI_ENTRY");
      setAllowedTiers([]);
      setMaxCapacity(undefined);
      setShowPointForm(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-500">
        Loading event details...
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="space-y-4">
        <Link
          to="/organizer"
          className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          ← Back to Events
        </Link>
        <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
          {error ?? "Event not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 font-sans">
      {/* Header and Back Link */}
      <div className="space-y-2">
        <Link
          to="/organizer"
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 uppercase tracking-wider inline-block"
        >
          ← Back to All Events
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
              {event.name}
            </h1>
            <p className="text-sm text-neutral-500 pt-0.5">
              📍 {event.location} • 📅{" "}
              {new Date(event.starts_at).toLocaleDateString()} to{" "}
              {new Date(event.ends_at).toLocaleDateString()}
            </p>
          </div>
          <Link
            to={`/e/${event.slug}`}
            target="_blank"
            rel="noreferrer"
            className="self-start sm:self-auto bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold px-3 py-2 rounded-lg transition"
          >
            Public Page: /e/{event.slug} ↗
          </Link>
        </div>
        {event.description && (
          <p className="text-sm text-neutral-700 pt-2 bg-white p-4 rounded-xl border border-neutral-200">
            {event.description}
          </p>
        )}
      </div>

      {/* Check-In Points & Gate Policies Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">
              Check-In Points & Entry Gates
            </h2>
            <p className="text-xs text-neutral-500">
              Configure scanner gates, dining halls, and admission policy enforcement.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPointForm((prev) => !prev)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2 px-3.5 rounded-lg transition"
          >
            {showPointForm ? "Cancel" : "+ Add Check-In Point"}
          </button>
        </div>

        {/* Add Check-In Point Form */}
        {showPointForm && (
          <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900">
              New Check-In Point
            </h3>
            <form onSubmit={handleCreatePoint} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Point / Gate Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={pointName}
                    onChange={(e) => setPointName(e.target.value)}
                    placeholder="e.g. Main Gate Turnstiles, Lunch Catering"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={pointLocation}
                    onChange={(e) => setPointLocation(e.target.value)}
                    placeholder="e.g. Level 1 Entry, Ground Floor Food Court"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Admission Policy *
                  </label>
                  <select
                    value={policyType}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (isPolicyType(val)) {
                        setPolicyType(val);
                      }
                    }}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  >
                    <option value="MULTI_ENTRY">MULTI_ENTRY (Allows repeated entry & exit timestamps)</option>
                    <option value="SINGLE_USE">SINGLE_USE (Strictly prevents duplicate scans, e.g. Meals/Lunch)</option>
                    <option value="TIER_RESTRICTED">TIER_RESTRICTED (Restricts gate access to specific ticket tiers)</option>
                    <option value="CAPACITY_CAPPED">CAPACITY_CAPPED (Rejects entry when max capacity is reached)</option>
                  </select>
                </div>

                {policyType === "TIER_RESTRICTED" && (
                  <div className="sm:col-span-2 space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700">
                      Allowed Ticket Tiers
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {tiers.map((t) => (
                        <label key={t.id} className="flex items-center gap-2 text-xs text-neutral-800">
                          <input
                            type="checkbox"
                            checked={allowedTiers.includes(t.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setAllowedTiers((prev) => [...prev, t.id]);
                              } else {
                                setAllowedTiers((prev) => prev.filter((id) => id !== t.id));
                              }
                            }}
                            className="rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {policyType === "CAPACITY_CAPPED" && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                      Max Room Capacity
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={maxCapacity ?? ""}
                      onChange={(e) => setMaxCapacity(Number(e.target.value) || undefined)}
                      placeholder="e.g. 250"
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                    />
                  </div>
                )}
              </div>

              {pointFormError && (
                <p className="text-sm text-red-600 bg-red-50 p-2.5 rounded-md">
                  {pointFormError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPointForm(false)}
                  className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium hover:bg-neutral-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPoint}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm py-2 px-5 rounded-lg transition"
                >
                  {submittingPoint ? "Saving..." : "Create Check-In Point"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Check-In Points List */}
        {points.length === 0 ? (
          <div className="bg-white p-6 rounded-xl border border-neutral-200 text-center text-sm text-neutral-500">
            No check-in points configured yet. Add points to deploy entrance gates or catering checkpoints.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {points.map((p) => (
              <div
                key={p.id}
                className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm space-y-2 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-neutral-900 text-base">
                      {p.name}
                    </h4>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        p.policy_type === "SINGLE_USE"
                          ? "bg-amber-100 text-amber-800"
                          : p.policy_type === "TIER_RESTRICTED"
                          ? "bg-purple-100 text-purple-800"
                          : p.policy_type === "CAPACITY_CAPPED"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {p.policy_type}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 pt-0.5">
                    📍 {p.location || "General Area"}
                  </p>
                </div>
                <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-100 flex items-center justify-between">
                  <a
                    href={`/api/checkin-points/${p.id}/manifest`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 hover:text-emerald-800 font-semibold"
                  >
                    View Manifest JSON ↗
                  </a>
                  <span>ID: {p.id.slice(0, 8)}…</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ticket Tiers Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Ticket Tiers</h2>
            <p className="text-xs text-neutral-500">
              Configure free attendance categories and admission quotas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowTierForm((prev) => !prev)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2 px-3.5 rounded-lg transition"
          >
            {showTierForm ? "Cancel" : "+ Add Ticket Tier"}
          </button>
        </div>

        {/* Add Tier Form */}
        {showTierForm && (
          <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-neutral-900">
              New Ticket Tier
            </h3>
            <form onSubmit={handleCreateTier} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Tier Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={tierName}
                    onChange={(e) => setTierName(e.target.value)}
                    placeholder="e.g. General Admission, VIP, Student"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Capacity Quota *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={tierQuota}
                    onChange={(e) => setTierQuota(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={tierDescription}
                    onChange={(e) => setTierDescription(e.target.value)}
                    placeholder="Privileges, entry permissions, seating access..."
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
                  />
                </div>

                <div className="sm:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="tierIsOpen"
                    checked={tierIsOpen}
                    onChange={(e) => setTierIsOpen(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-neutral-300 focus:ring-emerald-500"
                  />
                  <label
                    htmlFor="tierIsOpen"
                    className="text-sm text-neutral-800 font-medium cursor-pointer"
                  >
                    Open for registration
                  </label>
                </div>
              </div>

              {tierFormError && (
                <p className="text-sm text-red-600 bg-red-50 p-2.5 rounded-md">
                  {tierFormError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTierForm(false)}
                  className="px-4 py-2 border border-neutral-300 rounded-lg text-sm font-medium hover:bg-neutral-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingTier}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm py-2 px-5 rounded-lg transition"
                >
                  {submittingTier ? "Saving..." : "Add Tier"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tiers List */}
        {tiers.length === 0 ? (
          <div className="bg-white p-6 rounded-xl border border-neutral-200 text-center text-sm text-neutral-500">
            No ticket tiers created yet. Click "+ Add Ticket Tier" to configure admission quotas.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tiers.map((tier) => (
              <div
                key={tier.id}
                className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm space-y-2 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-bold text-neutral-900 text-base">
                      {tier.name}
                    </h4>
                    <span
                      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full ${
                        tier.is_open
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {tier.is_open ? "Open" : "Closed"}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 pt-1">
                    {tier.description || "General admission access."}
                  </p>
                </div>
                <div className="text-xs font-semibold text-neutral-500 pt-2 border-t border-neutral-100 flex items-center justify-between">
                  <span>Quota: {tier.quota.toLocaleString()} tickets</span>
                  <span className="text-emerald-700 font-medium">Free ($0)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
