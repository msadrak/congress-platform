import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatApiError, getApiClient, type PublicEvent as PublicEventType } from "../api/client";

export default function PublicEvent() {
  const { slug } = useParams<{ slug: string }>();
  const [event, setEvent] = useState<PublicEventType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const loadEvent = async () => {
      setLoading(true);
      setError(null);
      const client = getApiClient(null);
      const { data, error: err } = await client.GET("/api/public/events/{slug}", {
        params: { path: { slug } },
      });
      if (err) {
        setError(formatApiError(err));
      } else if (data) {
        setEvent(data);
      }
      setLoading(false);
    };
    loadEvent();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="text-sm text-neutral-500 animate-pulse">
          Loading event information...
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-4">
          <div className="text-3xl">🔍</div>
          <h1 className="text-xl font-bold text-neutral-900">Event Not Found</h1>
          <p className="text-sm text-neutral-600">
            {error ?? "The event you are looking for does not exist or has been removed."}
          </p>
          <Link
            to="/"
            className="inline-block text-xs font-semibold text-emerald-700 hover:text-emerald-800 uppercase tracking-wider"
          >
            ← Back to Homepage
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-bold text-sm tracking-tight text-neutral-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            Congress Platform
          </Link>
          <span className="text-xs text-neutral-500">Official Event Portal</span>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* Event Header Banner */}
        <section className="bg-white rounded-2xl p-6 sm:p-8 border border-neutral-200 shadow-sm space-y-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              Registration Open
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
              {event.name}
            </h1>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs text-neutral-600">
            <div className="flex items-center gap-2 bg-neutral-50 p-3 rounded-lg border border-neutral-100">
              <span className="text-base">📅</span>
              <div>
                <p className="font-semibold text-neutral-800">Date & Time</p>
                <p>
                  {new Date(event.starts_at).toLocaleDateString(undefined, {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-neutral-50 p-3 rounded-lg border border-neutral-100">
              <span className="text-base">📍</span>
              <div>
                <p className="font-semibold text-neutral-800">Venue</p>
                <p>{event.location}</p>
              </div>
            </div>
          </div>

          {event.description && (
            <div className="pt-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-500 mb-1">
                About the Event
              </h2>
              <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
                {event.description}
              </p>
            </div>
          )}
        </section>

        {/* Ticket Tiers Section */}
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-neutral-900">
              Available Ticket Tiers
            </h2>
            <p className="text-xs text-neutral-500">
              Admission to this congress is free. Review available tiers below.
            </p>
          </div>

          {event.ticket_tiers.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl border border-neutral-200 text-center text-sm text-neutral-500">
              No ticket tiers are currently open for registration.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {event.ticket_tiers.map((tier) => (
                <div
                  key={tier.id}
                  className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold text-neutral-900 text-lg">
                        {tier.name}
                      </h3>
                      <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                        FREE
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600 leading-relaxed">
                      {tier.description || "Grants general entry to the congress sessions and exhibition areas."}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-500 font-medium">
                    <span>Capacity: {tier.quota.toLocaleString()} tickets</span>
                    <span className="text-emerald-700 font-semibold">100% Free</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 mt-12 text-center text-xs text-neutral-500">
        Congress Management Platform • Powered by FastAPI & React
      </footer>
    </div>
  );
}
