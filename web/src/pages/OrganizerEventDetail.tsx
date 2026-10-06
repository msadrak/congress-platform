import { useEffect, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  formatApiError,
  getApiClient,
  type EventOut,
  type TicketTierOut,
} from "../api/client";

export default function OrganizerEventDetail() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey } = useOutletContext<{ apiKey: string }>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
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

  useEffect(() => {
    if (!eventId) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      const client = getApiClient(apiKey);

      const [eventRes, tiersRes] = await Promise.all([
        client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/ticket-tiers", {
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
    <div className="space-y-8">
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
