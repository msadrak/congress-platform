import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Link, useOutletContext, useParams } from "react-router-dom";
import {
  formatApiError,
  getApiClient,
  type AttendeeDetailCard,
  type AttendeeSearchItem,
  type DeskRegistrationOut,
  type EventOut,
  type TicketTierOut,
} from "../api/client";

export default function OrganizerDesk() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey } = useOutletContext<{ apiKey: string }>();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Walk-in form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Minted pass modal state
  const [mintedPass, setMintedPass] = useState<DeskRegistrationOut | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AttendeeSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Selected attendee detail card (with scan history)
  const [selectedCard, setSelectedCard] = useState<AttendeeDetailCard | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const loadEventData = async () => {
      setLoading(true);
      const client = getApiClient(apiKey);
      const [evRes, tiersRes] = await Promise.all([
        client.GET("/api/events/{event_id}", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/ticket-tiers", {
          params: { path: { event_id: eventId } },
        }),
      ]);

      if (evRes.error) {
        setPageError(formatApiError(evRes.error));
      } else if (evRes.data) {
        setEvent(evRes.data);
      }

      if (tiersRes.data) {
        setTiers(tiersRes.data);
        if (tiersRes.data.length > 0) {
          setSelectedTierId(tiersRes.data[0].id);
        }
      }
      setLoading(false);
    };

    loadEventData();
  }, [eventId, apiKey]);

  // Search effect with debounce
  useEffect(() => {
    if (!eventId) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      const client = getApiClient(apiKey);
      const { data } = await client.GET("/api/events/{event_id}/attendees", {
        params: {
          path: { event_id: eventId },
          query: { q: searchQuery, limit: 30 },
        },
      });
      if (data) {
        setSearchResults(data);
      }
      setSearching(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [searchQuery, eventId, apiKey]);

  const handleRegisterWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !selectedTierId) return;
    setFormError(null);

    if (!fullName.trim()) {
      setFormError("Attendee full name is required.");
      return;
    }

    setSubmitting(true);
    const client = getApiClient(apiKey);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/desk-registrations",
      {
        params: { path: { event_id: eventId } },
        body: {
          full_name: fullName.trim(),
          email: email.trim() || undefined,
          organization: organization.trim(),
          title: title.trim(),
          ticket_tier_id: selectedTierId,
        },
      }
    );

    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      setMintedPass(data);
      // Reset form
      setFullName("");
      setEmail("");
      setOrganization("");
      setTitle("");
      // Refresh search results
      setSearchQuery("");
    }
  };

  const handleViewAttendeeCard = async (ticketId: string) => {
    if (!eventId) return;
    const client = getApiClient(apiKey);
    const { data } = await client.GET(
      "/api/events/{event_id}/attendees/{ticket_id}",
      {
        params: { path: { event_id: eventId, ticket_id: ticketId } },
      }
    );
    if (data) {
      setSelectedCard(data);
    }
  };

  const handleNextAttendee = () => {
    setMintedPass(null);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-neutral-500">
        Loading front-desk station...
      </div>
    );
  }

  if (pageError || !event) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
        {pageError ?? "Event not found."}
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-neutral-200">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Front-Desk Operations Active
            </span>
          </div>
          <h1 className="text-2xl font-extrabold text-neutral-900 tracking-tight">
            Check-In & Registration Desk
          </h1>
          <p className="text-xs text-neutral-500">
            {event.name} • {event.location}
          </p>
        </div>
        <Link
          to={`/organizer/events/${eventId}`}
          className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition self-start sm:self-auto"
        >
          ← Back to Event Settings
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Rapid Walk-In Registration */}
        <section className="lg:col-span-5 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-neutral-900">
              ⚡ Rapid Walk-In Registration
            </h2>
            <p className="text-xs text-neutral-500">
              Create an on-site pass immediately in under 1 second.
            </p>
          </div>

          <form onSubmit={handleRegisterWalkIn} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                Full Name *
              </label>
              <input
                ref={nameInputRef}
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Sara Alavi"
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                Email Address (Optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Leave blank if attendee has no email"
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Organization
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Hospital / University"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Fellow, Nurse"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                Admission Tier *
              </label>
              <select
                value={selectedTierId}
                onChange={(e) => setSelectedTierId(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
              >
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (Quota: {t.quota})
                  </option>
                ))}
              </select>
            </div>

            {formError && (
              <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm py-3 px-4 rounded-xl transition shadow-sm"
            >
              {submitting ? "Minting Pass..." : "✓ Register Walk-In & Generate Pass"}
            </button>
          </form>
        </section>

        {/* Right Column: Live Attendee Search & Lookup */}
        <section className="lg:col-span-7 bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-5">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-neutral-900">
              🔍 Attendee Search & Badge Lookup
            </h2>
            <p className="text-xs text-neutral-500">
              Find registered attendees by name, email, or affiliation.
            </p>
          </div>

          <div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email, or organization..."
              className="w-full px-4 py-2.5 border border-neutral-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 bg-neutral-50 focus:bg-white transition"
            />
          </div>

          {searching && (
            <div className="py-4 text-center text-xs text-neutral-400">
              Searching attendees...
            </div>
          )}

          {!searching && searchResults.length === 0 && (
            <div className="py-8 text-center text-xs text-neutral-400">
              {searchQuery ? "No matching attendees found." : "Type a query above to search attendees."}
            </div>
          )}

          {!searching && searchResults.length > 0 && (
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
              {searchResults.map((a) => (
                <div
                  key={a.ticket_id}
                  className="p-3.5 rounded-xl border border-neutral-200 hover:border-emerald-300 transition flex items-center justify-between gap-3 bg-neutral-50/50"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-neutral-900">
                        {a.attendee_name}
                      </p>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                        {a.ticket_tier_name}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">
                      {a.attendee_email}
                      {a.organization ? ` • ${a.organization}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-neutral-500 font-medium">
                      {a.checkin_count > 0 ? (
                        <span className="text-emerald-700 font-semibold">
                          ✓ {a.checkin_count} scan{a.checkin_count > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-neutral-400">Not checked in</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleViewAttendeeCard(a.ticket_id)}
                      className="text-xs bg-neutral-900 hover:bg-neutral-800 text-white font-medium px-2.5 py-1.5 rounded-lg transition"
                    >
                      View Pass →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Minted Pass Modal (Displayed immediately after walk-in registration) */}
      {mintedPass && (
        <div className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl border border-neutral-200 text-center space-y-4 animate-in zoom-in-95 duration-150">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full">
              ✓ Pass Minted Successfully
            </div>

            <div className="p-3 bg-white border-2 border-neutral-900 rounded-2xl inline-block shadow-inner mx-auto">
              <QRCode
                value={mintedPass.qr_secret}
                size={180}
                level="M"
                className="h-auto max-w-full"
              />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold text-neutral-900">
                {mintedPass.attendee_name}
              </h3>
              <p className="text-xs font-semibold text-emerald-700">
                {mintedPass.ticket_tier_name}
              </p>
              <p className="text-xs text-neutral-500">
                {mintedPass.attendee_email}
              </p>
              <p className="text-[11px] font-mono uppercase bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded inline-block mt-1">
                {mintedPass.qr_secret}
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold text-xs py-2.5 px-4 rounded-xl transition"
              >
                🖨️ Print Badge Pass
              </button>
              <button
                type="button"
                onClick={handleNextAttendee}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition"
              >
                Next Walk-In Attendee →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendee Detail Card Modal */}
      {selectedCard && (
        <div className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900">
                Attendee Credential Card
              </h3>
              <button
                type="button"
                onClick={() => setSelectedCard(null)}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-4 p-4 bg-neutral-50 rounded-xl border border-neutral-100">
              <div className="p-2 bg-white border border-neutral-300 rounded-lg shrink-0">
                <QRCode value={selectedCard.qr_secret} size={84} level="M" />
              </div>
              <div className="space-y-0.5 min-w-0">
                <h4 className="text-base font-bold text-neutral-900 truncate">
                  {selectedCard.attendee_name}
                </h4>
                <p className="text-xs font-semibold text-emerald-800">
                  {selectedCard.ticket_tier_name}
                </p>
                <p className="text-xs text-neutral-500 truncate">
                  {selectedCard.attendee_email}
                </p>
                {selectedCard.organization && (
                  <p className="text-[11px] text-neutral-600 truncate">
                    {selectedCard.organization}
                  </p>
                )}
              </div>
            </div>

            {/* Scan History */}
            <div className="space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                Admission History ({selectedCard.scan_history.length})
              </h5>
              {selectedCard.scan_history.length === 0 ? (
                <p className="text-xs text-neutral-400 py-3 text-center bg-neutral-50 rounded-lg">
                  No gate scans recorded yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {selectedCard.scan_history.map((scan, idx) => (
                    <div
                      key={idx}
                      className="text-xs p-2.5 rounded-lg border border-neutral-100 bg-white flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold text-neutral-800">
                          {scan.checkin_point_name}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {new Date(scan.scanned_at).toLocaleTimeString()} •{" "}
                          {new Date(scan.scanned_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                          scan.status === "ADMITTED"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {scan.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setSelectedCard(null)}
              className="w-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold text-xs py-2 px-4 rounded-xl transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
