import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  getApiClient,
  type BoothOut,
  type LeadOut,
} from "../api/client";

export default function ExhibitorPortal() {
  const { boothId } = useParams<{ boothId: string }>();
  const navigate = useNavigate();

  const [booth, setBooth] = useState<BoothOut | null>(null);
  const [leads, setLeads] = useState<LeadOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Scan lead form state
  const [qrSecret, setQrSecret] = useState("");
  const [rating, setRating] = useState<"HOT" | "WARM" | "COLD">("HOT");
  const [notes, setNotes] = useState("");
  const [submittingScan, setSubmittingScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Recently scanned lead highlight
  const [lastScannedLead, setLastScannedLead] = useState<LeadOut | null>(null);

  // Search filter
  const [searchFilter, setSearchFilter] = useState("");

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  const loadData = async () => {
    if (!boothId) return;
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setAuthError(null);
    const client = getApiClient(token);

    const [boothRes, leadsRes] = await Promise.all([
      client.GET("/api/booths/{booth_id}", {
        params: { path: { booth_id: boothId } },
      }),
      client.GET("/api/booths/{booth_id}/leads", {
        params: { path: { booth_id: boothId } },
      }),
    ]);

    if (boothRes.error) {
      setAuthError(formatApiError(boothRes.error));
    } else if (boothRes.data) {
      setBooth(boothRes.data);
    }

    if (leadsRes.data) {
      setLeads(leadsRes.data);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [boothId, token]);

  const handleScanLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boothId || !token || !qrSecret.trim()) return;

    setSubmittingScan(true);
    setScanError(null);
    const client = getApiClient(token);

    const { data, error: err } = await client.POST(
      "/api/booths/{booth_id}/leads/scan",
      {
        params: { path: { booth_id: boothId } },
        body: {
          qr_secret: qrSecret.trim(),
          rating,
          notes: notes.trim(),
          tags: rating === "HOT" ? ["Immediate Follow-Up"] : [],
        },
      }
    );

    setSubmittingScan(false);
    if (err) {
      setScanError(formatApiError(err));
    } else if (data) {
      setLastScannedLead(data);
      setQrSecret("");
      setNotes("");
      loadData();
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-neutral-800 p-8 rounded-2xl border border-neutral-700 text-center space-y-4 shadow-xl">
          <div className="text-3xl">🏢</div>
          <h1 className="text-xl font-bold">Exhibitor Staff Sign In</h1>
          <p className="text-xs text-neutral-400">
            Please log in with your staff account to access this company's lead capture portal.
          </p>
          <Link
            to="/"
            className="inline-block w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition"
          >
            Go to Platform Sign In
          </Link>
        </div>
      </div>
    );
  }

  if (loading && !booth) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4 font-sans">
        <div className="text-sm text-neutral-400 animate-pulse">
          Loading booth lead portal...
        </div>
      </div>
    );
  }

  if (authError || !booth) {
    return (
      <div className="min-h-screen bg-neutral-900 text-white flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-neutral-800 p-8 rounded-2xl border border-neutral-700 text-center space-y-4 shadow-xl">
          <div className="text-3xl">🚫</div>
          <h1 className="text-xl font-bold">Commercial Access Restricted</h1>
          <p className="text-xs text-neutral-400">
            {authError ?? "You are not authorized to view or capture leads for this booth."}
          </p>
          <Link
            to="/"
            className="inline-block text-xs text-neutral-400 hover:text-white pt-2"
          >
            ← Return to Homepage
          </Link>
        </div>
      </div>
    );
  }

  const filteredLeads = leads.filter(
    (l) =>
      l.attendee_name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      l.attendee_email.toLowerCase().includes(searchFilter.toLowerCase()) ||
      l.organization.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans">
      {/* Top Header */}
      <header className="bg-neutral-900 border-b border-neutral-800 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              <h1 className="font-extrabold text-base tracking-tight text-white">
                {booth.name}
              </h1>
              <span className="text-[10px] font-bold uppercase bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full">
                Lead Portal
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">
              📍 {booth.location || "Exhibition Floor"} • {leads.length} leads captured
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
                navigate("/");
              }}
              className="text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3 py-1.5 rounded-lg transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 space-y-8">
        {/* Lead Scanner Card */}
        <section className="bg-neutral-900 p-6 rounded-3xl border border-neutral-800 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>⚡</span> Scan Attendee Visitor Badge
              </h2>
              <p className="text-xs text-neutral-400">
                Scan delegate QR code to immediately capture their contact card.
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-full">
              Ready for Scans
            </span>
          </div>

          <form onSubmit={handleScanLead} className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                  Attendee QR Secret *
                </label>
                <input
                  type="text"
                  required
                  value={qrSecret}
                  onChange={(e) => setQrSecret(e.target.value)}
                  placeholder="Scan or paste 26-char QR secret"
                  className="w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-sm font-mono focus:ring-2 focus:ring-emerald-500 text-white"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                  Interest Level
                </label>
                <select
                  value={rating}
                  onChange={(e) => setRating(e.target.value as "HOT" | "WARM" | "COLD")}
                  className="w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 text-white"
                >
                  <option value="HOT">🔥 HOT (High Priority)</option>
                  <option value="WARM">☀️ WARM (Interested)</option>
                  <option value="COLD">❄️ COLD (General)</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={submittingScan}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs py-3 px-4 rounded-xl transition shadow-lg flex items-center justify-center gap-1.5"
                >
                  {submittingScan ? "Capturing..." : "✓ Capture Lead"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">
                Quick Qualification Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Needs quote for 3 units, follow up with CEO..."
                className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-xl text-xs text-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {scanError && (
              <p className="text-xs text-red-300 bg-red-950/80 p-2.5 rounded-xl border border-red-800">
                {scanError}
              </p>
            )}
          </form>

          {/* Last Scanned Lead Disclosure Card */}
          {lastScannedLead && (
            <div className="mt-4 p-4 bg-emerald-950/40 border border-emerald-800/80 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                    ✓ Lead Captured:
                  </span>
                  <p className="text-base font-bold text-white">
                    {lastScannedLead.attendee_name}
                  </p>
                </div>
                <p className="text-xs text-neutral-300">
                  {lastScannedLead.title || "Delegate"} • {lastScannedLead.organization || "No org"}
                </p>
                <p className="text-xs text-emerald-300 font-mono">
                  {lastScannedLead.attendee_email}
                </p>
              </div>

              <span
                className={`text-xs font-black uppercase px-2.5 py-1 rounded-full self-start sm:self-auto ${
                  lastScannedLead.rating === "HOT"
                    ? "bg-red-500 text-white"
                    : lastScannedLead.rating === "WARM"
                    ? "bg-amber-500 text-white"
                    : "bg-blue-500 text-white"
                }`}
              >
                {lastScannedLead.rating} LEAD
              </span>
            </div>
          )}
        </section>

        {/* Captured Leads Table */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-white">
                Captured Booth Leads ({leads.length})
              </h2>
              <p className="text-xs text-neutral-400">
                All visitor badges scanned at your exhibition booth.
              </p>
            </div>

            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search leads..."
              className="text-xs bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-white focus:ring-2 focus:ring-emerald-500 w-full sm:w-60"
            />
          </div>

          {filteredLeads.length === 0 ? (
            <div className="bg-neutral-900 p-8 rounded-2xl border border-neutral-800 text-center text-xs text-neutral-500">
              {searchFilter
                ? "No leads matching your search filter."
                : "No leads captured yet. Scan visitor badges above to start building your sales pipeline."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLeads.map((l) => (
                <div
                  key={l.id}
                  className="bg-neutral-900 p-4 rounded-2xl border border-neutral-800 space-y-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-white">
                        {l.attendee_name}
                      </h3>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          l.rating === "HOT"
                            ? "bg-red-950 text-red-300 border border-red-800"
                            : l.rating === "WARM"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : "bg-blue-950 text-blue-300 border border-blue-800"
                        }`}
                      >
                        {l.rating}
                      </span>
                    </div>

                    <p className="text-xs text-neutral-300">
                      {l.title ? `${l.title} • ` : ""}
                      {l.organization}
                    </p>
                    <p className="text-xs text-emerald-400 font-mono">
                      {l.attendee_email}
                    </p>

                    {l.notes && (
                      <p className="text-xs text-neutral-400 italic pt-1">
                        "{l.notes}"
                      </p>
                    )}
                  </div>

                  <div className="text-[10px] text-neutral-500 shrink-0 sm:text-right">
                    <span>Captured {new Date(l.created_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
