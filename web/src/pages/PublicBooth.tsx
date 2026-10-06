import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  getApiClient,
  type PublicBoothOut,
} from "../api/client";

export default function PublicBooth() {
  const { slug, boothId } = useParams<{ slug: string; boothId: string }>();

  const [booth, setBooth] = useState<PublicBoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookmarking, setBookmarking] = useState(false);
  const [bookmarkMessage, setBookmarkMessage] = useState<string | null>(null);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  useEffect(() => {
    if (!slug || !boothId) return;

    const loadBooth = async () => {
      setLoading(true);
      setError(null);
      const client = getApiClient(token);
      const { data, error: err } = await client.GET(
        "/api/public/events/{slug}/booths/{booth_id}",
        {
          params: { path: { slug, booth_id: boothId } },
        }
      );

      if (err) {
        setError(formatApiError(err));
      } else if (data) {
        setBooth(data);
      }
      setLoading(false);
    };

    loadBooth();
  }, [slug, boothId, token]);

  const handleToggleBookmark = async () => {
    if (!boothId || !booth) return;
    if (!token) {
      setBookmarkMessage("Please sign in or reserve an attendee pass to save bookmarks.");
      return;
    }

    setBookmarking(true);
    setBookmarkMessage(null);
    const client = getApiClient(token);

    if (booth.is_bookmarked) {
      // Unbookmark
      const { data } = await client.DELETE(
        "/api/attendees/me/bookmarks/booths/{booth_id}",
        {
          params: { path: { booth_id: boothId } },
        }
      );
      if (data) {
        setBooth((prev) => (prev ? { ...prev, is_bookmarked: false } : null));
        setBookmarkMessage("Removed from My Visited Booths.");
      }
    } else {
      // Bookmark
      const { data } = await client.POST(
        "/api/attendees/me/bookmarks/booths/{booth_id}",
        {
          params: { path: { booth_id: boothId } },
        }
      );
      if (data) {
        setBooth((prev) => (prev ? { ...prev, is_bookmarked: true } : null));
        setBookmarkMessage("✓ Saved to My Visited Booths!");
      }
    }
    setBookmarking(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
        <div className="text-sm text-neutral-500 animate-pulse">
          Loading company profile...
        </div>
      </div>
    );
  }

  if (error || !booth) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-neutral-200 text-center space-y-4 shadow-sm">
          <div className="text-3xl">🏢</div>
          <h1 className="text-xl font-bold text-neutral-900">Booth Not Found</h1>
          <p className="text-sm text-neutral-600">
            {error ?? "The exhibition booth you are looking for does not exist."}
          </p>
          <Link
            to={slug ? `/e/${slug}` : "/"}
            className="inline-block text-xs font-semibold text-emerald-700 hover:text-emerald-800 uppercase tracking-wider"
          >
            ← Back to Event
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
            to={`/e/${slug}`}
            className="font-bold text-sm tracking-tight text-neutral-800 flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
            {booth.event_name}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/my-tickets"
              className="text-xs font-semibold text-neutral-600 hover:text-neutral-900"
            >
              My Passes 🎫
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-1">
          <Link
            to={`/e/${slug}`}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
          >
            ← Back to {booth.event_name} Overview
          </Link>
        </div>

        {/* Company Profile Hero Card */}
        <section className="bg-white rounded-3xl p-6 sm:p-8 border border-neutral-200 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Official Commercial Sponsor
              </div>
              <h1 className="text-2xl sm:text-3xl font-black text-neutral-900 tracking-tight">
                {booth.name}
              </h1>
              <p className="text-sm text-neutral-500 font-medium">
                📍 {booth.location || "Exhibition Floor"}
              </p>
            </div>

            {/* Bookmark button */}
            <button
              type="button"
              disabled={bookmarking}
              onClick={handleToggleBookmark}
              className={`self-start sm:self-auto px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-xs border ${
                booth.is_bookmarked
                  ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                  : "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800"
              }`}
            >
              <span>{booth.is_bookmarked ? "⭐ Bookmarked" : "☆ Bookmark Booth"}</span>
            </button>
          </div>

          {bookmarkMessage && (
            <p className="text-xs p-2.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 animate-in fade-in">
              {bookmarkMessage}
            </p>
          )}

          {/* Action Links Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {booth.brochure_url ? (
              <a
                href={booth.brochure_url}
                target="_blank"
                rel="noreferrer"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-3 px-4 rounded-xl transition shadow-sm text-center flex items-center justify-center gap-2"
              >
                <span>📄 View / Download Digital Brochure</span>
              </a>
            ) : (
              <div className="bg-neutral-100 text-neutral-400 text-xs py-3 px-4 rounded-xl text-center font-medium">
                Digital brochure coming soon
              </div>
            )}

            {booth.website_url ? (
              <a
                href={booth.website_url}
                target="_blank"
                rel="noreferrer"
                className="bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-semibold text-xs py-3 px-4 rounded-xl transition text-center flex items-center justify-center gap-2 border border-neutral-200"
              >
                <span>🌐 Visit Official Website ↗</span>
              </a>
            ) : null}
          </div>

          {/* Company Overview Description */}
          {booth.description ? (
            <div className="pt-4 border-t border-neutral-100 space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                About the Company & Exhibition
              </h2>
              <p className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line">
                {booth.description}
              </p>
            </div>
          ) : (
            <div className="pt-4 border-t border-neutral-100 text-xs text-neutral-400 italic">
              Visit this sponsor at {booth.location || "the exhibition area"} to learn more about their products and services.
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white py-6 mt-12 text-center text-xs text-neutral-500">
        Congress Platform • Paperless Digital Exhibition Experience
      </footer>
    </div>
  );
}
