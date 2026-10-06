import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  getApiClient,
  type AttendeeTicketDetail,
} from "../api/client";

const CACHED_TICKETS_STORAGE = "congress_cached_tickets";

export default function MyTickets() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Auth gate
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    // 1. Try to load cached tickets from localStorage immediately (instant offline access)
    const cached = localStorage.getItem(CACHED_TICKETS_STORAGE);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setTickets(parsed);
          setLoading(false);
        }
      } catch {
        // ignore parse error
      }
    }

    if (!token) {
      setLoading(false);
      return;
    }

    // 2. Refresh from live API if online
    const fetchTickets = async () => {
      const client = getApiClient(token);
      const { data, error: err } = await client.GET("/api/attendees/me/tickets");
      if (err) {
        if (!cached) {
          setError(formatApiError(err));
        }
      } else if (data) {
        setTickets(data);
        localStorage.setItem(CACHED_TICKETS_STORAGE, JSON.stringify(data));
      }
      setLoading(false);
    };

    fetchTickets();
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    localStorage.removeItem(CACHED_TICKETS_STORAGE);
    navigate("/");
  };

  if (!token && tickets.length === 0) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-4 shadow-sm">
          <div className="text-3xl">🎫</div>
          <h1 className="text-xl font-bold text-neutral-900">
            Sign In to View Your Tickets
          </h1>
          <p className="text-sm text-neutral-600">
            You must be logged in to access your digital tickets and entry passes.
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <Link
              to="/"
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm py-2.5 px-4 rounded-xl transition"
            >
              Browse Events to Register
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link
            to="/"
            className="font-bold text-sm tracking-tight text-neutral-900 flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            Congress Platform
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/my-network"
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-md transition"
            >
              My Network 🤝
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 px-2.5 py-1.5 rounded-md font-medium transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Offline banner if cellular / Wi-Fi disconnected */}
      {isOffline && (
        <div className="bg-amber-500 text-white text-xs font-semibold py-2 px-4 text-center">
          ⚠️ Offline Mode: Displaying saved local tickets. Your digital passes are safe to present.
        </div>
      )}

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">
              My Digital Passes
            </h1>
            <p className="text-xs text-neutral-500">
              Show this high-contrast QR code at check-in gates and hall entrances.
            </p>
          </div>
          <Link
            to="/"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
          >
            + Register for more events
          </Link>
        </div>

        {loading && tickets.length === 0 && (
          <div className="py-12 text-center text-sm text-neutral-500">
            Loading your tickets...
          </div>
        )}

        {error && tickets.length === 0 && (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
            {error}
          </div>
        )}

        {!loading && tickets.length === 0 && (
          <div className="bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-3">
            <p className="text-base font-semibold text-neutral-800">
              No tickets found
            </p>
            <p className="text-xs text-neutral-500">
              You haven't reserved tickets for any upcoming congresses.
            </p>
            <Link
              to="/"
              className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition"
            >
              Explore Congresses
            </Link>
          </div>
        )}

        {tickets.length > 0 && (
          <div className="space-y-6">
            {tickets.map((t) => (
              <div
                key={t.id}
                className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col md:flex-row"
              >
                {/* High-Contrast QR Code Card */}
                <div className="bg-white p-6 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-neutral-200 shrink-0 min-w-[240px]">
                  <div className="p-3 bg-white border-2 border-neutral-900 rounded-xl shadow-inner">
                    <QRCode
                      value={t.qr_secret}
                      size={180}
                      level="M"
                      className="h-auto max-w-full"
                    />
                  </div>
                  <div className="mt-3 text-center">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded">
                      {t.qr_secret}
                    </span>
                    <p className="text-[10px] text-neutral-400 mt-1">
                      Universal Entity QR Code
                    </p>
                  </div>
                </div>

                {/* Event & Attendee Details */}
                <div className="p-6 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                        {t.ticket_tier_name}
                      </span>
                      <span className="text-xs font-semibold text-emerald-700">
                        ✓ Active & Verified
                      </span>
                    </div>

                    <div>
                      <h2 className="text-xl font-bold text-neutral-900 leading-snug">
                        {t.event_name}
                      </h2>
                      <div className="text-xs text-neutral-600 space-y-0.5 pt-1">
                        <p>📍 {t.event_location}</p>
                        <p>
                          📅 {new Date(t.event_starts_at).toLocaleDateString()} to{" "}
                          {new Date(t.event_ends_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-neutral-100">
                      <p className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
                        Attendee
                      </p>
                      <p className="text-base font-bold text-neutral-900">
                        {t.attendee_name}
                      </p>
                      <p className="text-xs text-neutral-500">{t.attendee_email}</p>
                    </div>
                  </div>

                  <div className="pt-2 text-[11px] text-neutral-400 flex items-center justify-between">
                    <span>Issued {new Date(t.created_at).toLocaleDateString()}</span>
                    <span>Cached for offline presentation</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 text-center text-xs text-neutral-500 mt-12">
        Congress Platform Digital Pass System
      </footer>
    </div>
  );
}
