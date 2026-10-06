import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  getApiClient,
  type ConnectionOut,
} from "../api/client";

export default function MyNetwork() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<ConnectionOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Scan modal state
  const [showScanModal, setShowScanModal] = useState(false);
  const [peerQrSecret, setPeerQrSecret] = useState("");
  const [initialNotes, setInitialNotes] = useState("");
  const [submittingScan, setSubmittingScan] = useState(false);
  const [scanModalError, setScanModalError] = useState<string | null>(null);

  // Editing notes state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotesText, setEditNotesText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  const loadConnections = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = getApiClient(token);
    const { data, error: err } = await client.GET("/api/attendees/me/network");
    if (err) {
      setError(formatApiError(err));
    } else if (data) {
      setConnections(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConnections();
  }, [token]);

  const handleLogout = () => {
    localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    navigate("/");
  };

  const handleConnectPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !peerQrSecret.trim()) return;

    setSubmittingScan(true);
    setScanModalError(null);
    const client = getApiClient(token);
    const { data, error: err } = await client.POST(
      "/api/attendees/me/network/scan",
      {
        body: {
          qr_secret: peerQrSecret.trim(),
          private_notes: initialNotes.trim(),
        },
      }
    );

    setSubmittingScan(false);
    if (err) {
      setScanModalError(formatApiError(err));
    } else if (data) {
      setPeerQrSecret("");
      setInitialNotes("");
      setShowScanModal(false);
      loadConnections();
    }
  };

  const handleSaveNotes = async (connectionId: string) => {
    if (!token) return;
    setSavingNote(true);
    const client = getApiClient(token);
    const { data, error: err } = await client.PATCH(
      "/api/attendees/me/network/{connection_id}",
      {
        params: { path: { connection_id: connectionId } },
        body: { private_notes: editNotesText.trim() },
      }
    );
    setSavingNote(false);
    if (err) {
      setError(formatApiError(err));
    } else if (data) {
      setConnections((prev) =>
        prev.map((c) => (c.id === connectionId ? data : c))
      );
      setEditingId(null);
    }
  };

  const handleDownloadVcard = (connectionId: string, fullName: string) => {
    if (!token) return;
    fetch(`/api/attendees/me/network/${connectionId}/vcard`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.blob())
      .then((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const cleanName = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        link.download = `${cleanName || "contact"}.vcf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-4 shadow-sm">
          <div className="text-3xl">🤝</div>
          <h1 className="text-xl font-bold text-neutral-900">
            Sign In to Access Your Network
          </h1>
          <p className="text-sm text-neutral-600">
            You must be logged in to view your conference contacts and exchange business cards.
          </p>
          <Link
            to="/"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm py-2.5 px-4 rounded-xl transition"
          >
            Go to Event Homepage
          </Link>
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
              to="/my-tickets"
              className="text-xs font-semibold text-neutral-600 hover:text-neutral-900"
            >
              My Passes 🎫
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

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">
              🤝 My Conference Network
            </h1>
            <p className="text-xs text-neutral-500">
              Scan delegate badges to connect and export directly to your phone contacts (.vcf).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowScanModal(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold py-2.5 px-4 rounded-xl transition shadow-xs flex items-center gap-2 self-start sm:self-auto"
          >
            <span>📷 Scan Badge to Connect</span>
          </button>
        </div>

        {loading && (
          <div className="py-12 text-center text-sm text-neutral-500">
            Loading your network connections...
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm">
            {error}
          </div>
        )}

        {!loading && connections.length === 0 && (
          <div className="bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-3">
            <p className="text-base font-semibold text-neutral-800">
              No connections established yet
            </p>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              Meet someone at a session? Tap "Scan Badge to Connect" and scan their personal QR code to exchange business cards.
            </p>
            <button
              type="button"
              onClick={() => setShowScanModal(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition"
            >
              Scan First Badge
            </button>
          </div>
        )}

        {connections.length > 0 && (
          <div className="space-y-4">
            {connections.map((c) => (
              <div
                key={c.id}
                className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-neutral-900">
                      {c.full_name}
                    </h3>
                    <p className="text-xs font-semibold text-emerald-800">
                      {c.title || "Delegate"}
                      {c.organization ? ` • ${c.organization}` : ""}
                    </p>
                    <p className="text-xs text-neutral-500">{c.email}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownloadVcard(c.id, c.full_name)}
                      className="bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold px-3 py-2 rounded-xl transition flex items-center gap-1.5 shadow-xs"
                      title="Download vCard to phone contacts"
                    >
                      <span>📇 Add to Phone (.vcf)</span>
                    </button>
                  </div>
                </div>

                {/* Private Notes Section */}
                <div className="pt-3 border-t border-neutral-100 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="font-semibold uppercase tracking-wider">
                      Private Notes (Only visible to you)
                    </span>
                    {editingId !== c.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditNotesText(c.private_notes);
                        }}
                        className="text-emerald-700 hover:text-emerald-800 font-semibold"
                      >
                        {c.private_notes ? "Edit Note" : "+ Add Note"}
                      </button>
                    )}
                  </div>

                  {editingId === c.id ? (
                    <div className="space-y-2 pt-1">
                      <textarea
                        rows={2}
                        value={editNotesText}
                        onChange={(e) => setEditNotesText(e.target.value)}
                        placeholder="e.g. Met after keynote, discuss joint research next month..."
                        className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 text-xs border border-neutral-300 rounded-lg text-neutral-600 hover:bg-neutral-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={savingNote}
                          onClick={() => handleSaveNotes(c.id)}
                          className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition"
                        >
                          {savingNote ? "Saving..." : "Save Note"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-700 italic">
                      {c.private_notes || "No private notes added yet."}
                    </p>
                  )}
                </div>

                <div className="text-[10px] text-neutral-400">
                  Connected on {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Connect Scan Modal */}
      {showScanModal && (
        <div className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900">
                Connect with Delegate
              </h3>
              <button
                type="button"
                onClick={() => setShowScanModal(false)}
                className="text-neutral-400 hover:text-neutral-600 p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-neutral-500">
              Scan or enter the delegate's personal QR secret to exchange business cards.
            </p>

            <form onSubmit={handleConnectPeer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Peer QR Secret *
                </label>
                <input
                  type="text"
                  required
                  value={peerQrSecret}
                  onChange={(e) => setPeerQrSecret(e.target.value)}
                  placeholder="e.g. 26-character QR secret"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-700 mb-1">
                  Private Note
                </label>
                <textarea
                  rows={2}
                  value={initialNotes}
                  onChange={(e) => setInitialNotes(e.target.value)}
                  placeholder="Where did you meet? What did you discuss?"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>

              {scanModalError && (
                <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">
                  {scanModalError}
                </p>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submittingScan}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm py-2.5 px-4 rounded-xl transition shadow-xs"
                >
                  {submittingScan ? "Connecting..." : "✓ Add to My Network"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
