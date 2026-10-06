import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  getApiClient,
  type PublicEvent as PublicEventType,
  type TicketTierOut,
} from "../api/client";

export default function PublicEvent() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [event, setEvent] = useState<PublicEventType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reservation modal state
  const [selectedTier, setSelectedTier] = useState<TicketTierOut | null>(null);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");

  // Registration form
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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

  const executeReservation = async (token: string, tierId: string) => {
    if (!event) return;
    const client = getApiClient(token);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/tickets/reserve",
      {
        params: { path: { event_id: event.id } },
        body: { ticket_tier_id: tierId },
      }
    );

    if (err) {
      setModalError(formatApiError(err));
      setSubmitting(false);
    } else if (data) {
      setSelectedTier(null);
      navigate("/my-tickets");
    }
  };

  const handleSelectTier = async (tier: TicketTierOut) => {
    setModalError(null);
    const existingToken = localStorage.getItem(ATTENDEE_TOKEN_STORAGE);
    if (existingToken) {
      // Already logged in: directly reserve
      setSubmitting(true);
      await executeReservation(existingToken, tier.id);
      setSubmitting(false);
    } else {
      // Need to register or log in first
      setSelectedTier(tier);
    }
  };

  const handleAuthAndReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTier || !event) return;
    setModalError(null);
    setSubmitting(true);

    const client = getApiClient(null);

    if (authMode === "register") {
      if (!fullName.trim() || !email.trim() || !password) {
        setModalError("Please complete all required fields.");
        setSubmitting(false);
        return;
      }

      const { data, error: err } = await client.POST("/api/auth/register", {
        body: {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          organization: organization.trim(),
          title: title.trim(),
        },
      });

      if (err) {
        setModalError(formatApiError(err));
        setSubmitting(false);
        return;
      }

      if (data) {
        localStorage.setItem(ATTENDEE_TOKEN_STORAGE, data.access_token);
        await executeReservation(data.access_token, selectedTier.id);
      }
    } else {
      // Login mode
      if (!email.trim() || !password) {
        setModalError("Please provide your email and password.");
        setSubmitting(false);
        return;
      }

      const { data, error: err } = await client.POST("/api/auth/login", {
        body: {
          email: email.trim(),
          password,
        },
      });

      if (err) {
        setModalError(formatApiError(err));
        setSubmitting(false);
        return;
      }

      if (data) {
        localStorage.setItem(ATTENDEE_TOKEN_STORAGE, data.access_token);
        await executeReservation(data.access_token, selectedTier.id);
      }
    }
  };

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
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
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
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="font-bold text-sm tracking-tight text-neutral-800 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            Congress Platform
          </Link>
          <Link
            to="/my-tickets"
            className="text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 px-3 py-1.5 rounded-lg transition"
          >
            My Passes 🎫
          </Link>
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
              Select your admission tier below to reserve your personal digital pass.
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

                  <div className="pt-3 border-t border-neutral-100 flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs text-neutral-500 font-medium">
                      <span>Quota: {tier.quota.toLocaleString()} passes</span>
                      <span className="text-emerald-700 font-semibold">100% Free</span>
                    </div>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleSelectTier(tier)}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs py-2.5 px-4 rounded-xl transition shadow-sm"
                    >
                      Reserve Free Pass →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Registration / Sign-In Modal */}
      {selectedTier && (
        <div className="fixed inset-0 z-50 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 sm:p-8 shadow-xl border border-neutral-200 space-y-5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">
                  {authMode === "register" ? "Register Attendee Pass" : "Sign In to Reserve"}
                </h3>
                <p className="text-xs text-neutral-500">
                  Tier: <span className="font-semibold text-emerald-700">{selectedTier.name}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTier(null)}
                className="text-neutral-400 hover:text-neutral-600 text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Tab switch */}
            <div className="flex border-b border-neutral-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("register");
                  setModalError(null);
                }}
                className={`flex-1 py-2 text-center border-b-2 transition ${
                  authMode === "register"
                    ? "border-emerald-600 text-emerald-700 font-bold"
                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                }`}
              >
                New Account
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("login");
                  setModalError(null);
                }}
                className={`flex-1 py-2 text-center border-b-2 transition ${
                  authMode === "login"
                    ? "border-emerald-600 text-emerald-700 font-bold"
                    : "border-transparent text-neutral-500 hover:text-neutral-700"
                }`}
              >
                I have an account
              </button>
            </div>

            <form onSubmit={handleAuthAndReserve} className="space-y-3.5">
              {authMode === "register" && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Dr. Mohammad Rezaei"
                    className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.com"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              {authMode === "register" && (
                <>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                      Organization / University
                    </label>
                    <input
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="e.g. Tehran University of Medical Sciences"
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                      Professional Title
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Associate Professor, Resident"
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                    />
                  </div>
                </>
              )}

              {modalError && (
                <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                  {modalError}
                </p>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm py-2.5 px-4 rounded-xl transition shadow-sm"
                >
                  {submitting
                    ? "Reserving..."
                    : authMode === "register"
                    ? "Complete Registration & Get Pass"
                    : "Sign In & Confirm Pass"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className="border-t border-neutral-200 bg-white py-6 mt-12 text-center text-xs text-neutral-500">
        Congress Management Platform • Official Attendee Registration
      </footer>
    </div>
  );
}
