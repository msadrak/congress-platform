import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  type PublicBoothOut,
} from "../api/client";
import { PublicLayout } from "../layouts/PublicLayout";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

export default function PublicBooth() {
  const { slug, boothId } = useParams<{ slug: string; boothId: string }>();

  const [booth, setBooth] = useState<PublicBoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookmarking, setBookmarking] = useState(false);
  const [bookmarkFeedback, setBookmarkFeedback] = useState<string | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const bookmarkContext = useRef<{ active: boolean } | null>(null);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  useEffect(() => {
    if (!slug || !boothId) return;
    let active = true;

    const loadBooth = async () => {
      setLoading(true);
      setBooth(null);
      setError(null);
      setBookmarkFeedback(null);
      try {
        const client = createApiClient({ kind: "anonymous" });
        const { data, error: err } = await client.GET(
          "/api/public/events/{slug}/booths/{booth_id}",
          { params: { path: { slug, booth_id: boothId } } }
        );
        if (!active) return;
        if (err) setError(formatApiError(err));
        else if (data) setBooth(data);
      } catch {
        if (active) setError("Unable to load the booth profile. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadBooth();
    return () => { active = false; };
  }, [slug, boothId]);

  useEffect(() => {
    const context = { active: true };
    bookmarkContext.current = context;
    const loadBookmarks = async () => {
      setIsBookmarked(false);
      setBookmarking(false);
      setBookmarkLoading(Boolean(token));
      if (!token || !slug || !boothId) return;
      try {
        const client = createApiClient({ kind: "user", token });
        const { data, error: err, response } = await client.GET("/api/attendees/me/bookmarks/booths");
        if (!context.active || localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) return;
        if (err) {
          if (response.status === 401) localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
          setBookmarkFeedback(`${response.status}: ${formatApiError(err)}`);
        } else if (data) {
          setIsBookmarked(data.some((saved) => saved.booth_id === boothId && saved.event_slug === slug));
        }
      } catch {
        if (context.active && localStorage.getItem(ATTENDEE_TOKEN_STORAGE) === token) setBookmarkFeedback("Unable to load your saved booths. Please try again.");
      } finally {
        if (context.active) setBookmarkLoading(false);
      }
    };
    void loadBookmarks();
    return () => { context.active = false; };
  }, [slug, boothId, token]);

  const handleToggleBookmark = async () => {
    if (!boothId || !booth || bookmarkLoading || bookmarking) return;
    if (!token) {
      setBookmarkFeedback("Please sign in or register an attendee pass to save bookmarks to your portal.");
      return;
    }
    // The rendered token can outlive the stored session (e.g. another tab signed in or out).
    if (localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) {
      setBookmarkFeedback("Your attendee session changed in another tab. Please reload this page.");
      return;
    }

    const context = bookmarkContext.current;
    if (!context?.active) return;
    setBookmarking(true);
    setBookmarkFeedback(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const options = { params: { path: { booth_id: boothId } } };
      const { data, error: err, response } = isBookmarked
        ? await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", options)
        : await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", options);
      if (!context.active || localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== token) return;
      if (err) {
        if (response.status === 401) localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
        setBookmarkFeedback(`${response.status}: ${formatApiError(err)}`);
      } else if (data) {
        setIsBookmarked(data.bookmarked);
        setBookmarkFeedback(data.bookmarked ? "✓ Saved to My Bookmarked Booths!" : "Removed from your saved booths.");
      }
    } catch {
      if (context.active && localStorage.getItem(ATTENDEE_TOKEN_STORAGE) === token) setBookmarkFeedback("Unable to update your bookmark. Please try again.");
    } finally {
      if (context.active) setBookmarking(false);
    }
  };

  // Loading skeleton
  if (loading) {
    return (
      <PublicLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="space-y-6 animate-pulse">
            <div className="w-32 h-5 bg-surface-panel-subtle rounded-md" />
            <div className="p-8 rounded-2xl bg-surface-panel border border-border-default space-y-4">
              <div className="w-24 h-6 bg-surface-panel-subtle rounded-full" />
              <div className="w-2/3 h-10 bg-surface-panel-subtle rounded-xl" />
              <div className="w-1/3 h-5 bg-surface-panel-subtle rounded-md" />
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Error / Not Found state
  if (error || !booth) {
    return (
      <PublicLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 flex items-center justify-center">
          <div className="max-w-md w-full bg-surface-panel p-8 sm:p-10 rounded-2xl border border-border-default shadow-xs text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-action-subtle text-action-primary mx-auto flex items-center justify-center font-bold text-lg">
              🏢
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-text-primary tracking-tight">
                Booth Profile Not Found
              </h1>
              <p className="text-sm text-text-secondary leading-relaxed">
                {error ?? "The exhibition booth profile you requested does not exist or has been removed."}
              </p>
            </div>
            <div className="pt-2">
              <LinkButton
                to={slug ? `/e/${slug}` : "/"}
                variant="secondary"
                size="md"
              >
                {slug ? "← Back to Event Page" : "← Platform Home"}
              </LinkButton>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-6">
        {/* Navigation Breadcrumb */}
        <nav aria-label="Event Breadcrumb">
          <Link
            to={`/e/${slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-action-primary hover:text-action-hover focus-visible:outline-focus-ring"
          >
            <span aria-hidden="true">←</span> Back to {booth.event_name}
          </Link>
        </nav>

        {/* Company Profile Hero Card */}
        <Card className="border-border-default shadow-xs overflow-hidden">
          <div className="p-6 sm:p-10 space-y-6">
            {/* Top Identity Row */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
              <div className="space-y-2 max-w-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="brand" size="md">
                    Exhibitor Booth
                  </Badge>
                  <span className="text-xs text-text-muted">•</span>
                  <span className="text-xs text-text-muted font-medium">
                    {booth.event_name}
                  </span>
                </div>

                <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-text-primary">
                  {booth.name}
                </h1>

                <div className="flex items-center gap-2 text-xs sm:text-sm text-text-secondary font-medium pt-0.5">
                  <span className="text-action-primary">📍</span>
                  <span>Stand Location: {booth.location || "Main Exhibition Floor"}</span>
                </div>
              </div>

              {/* Bookmark Action Button */}
              <div className="shrink-0">
                <Button
                  type="button"
                  variant={isBookmarked ? "secondary" : "primary"}
                  size="md"
                  disabled={bookmarking || bookmarkLoading}
                  onClick={handleToggleBookmark}
                  className="gap-2"
                >
                  <span aria-hidden="true">{isBookmarked ? "★" : "☆"}</span>
                  <span>{isBookmarked ? "Saved in Passes" : "Bookmark Booth"}</span>
                </Button>
              </div>
            </div>

            {/* Bookmark Feedback Message */}
            {bookmarkFeedback && (
              <div
                role="status"
                className="p-3 rounded-xl bg-action-subtle text-action-primary border border-action-subtle-border text-xs leading-relaxed animate-in fade-in"
              >
                {bookmarkFeedback}
              </div>
            )}
            {/* Action Bar: Brochure & Official Website */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              {booth.brochure_url && /^https?:\/\//i.test(booth.brochure_url) ? (
                <a
                  href={booth.brochure_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 p-3.5 rounded-xl bg-action-primary hover:bg-action-hover text-white text-xs sm:text-sm font-semibold transition-colors shadow-xs focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <span aria-hidden="true">📄</span>
                  <span>View / Download Digital Brochure ↗</span>
                </a>
              ) : (
                <div className="p-3.5 rounded-xl bg-surface-page border border-border-default text-xs text-text-muted text-center font-medium flex items-center justify-center">
                  Digital brochure not yet published
                </div>
              )}

              {booth.website_url && /^https?:\/\//i.test(booth.website_url) ? (
                <a
                  href={booth.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 p-3.5 rounded-xl bg-surface-panel hover:bg-surface-page border border-border-default text-text-primary text-xs sm:text-sm font-semibold transition-colors shadow-xs focus-visible:outline-2 focus-visible:outline-focus-ring"
                >
                  <span aria-hidden="true">🌐</span>
                  <span>Visit Company Website ↗</span>
                </a>
              ) : null}
            </div>

            {/* Company Description */}
            <div className="pt-6 border-t border-border-default space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                About the Exhibitor
              </h2>
              {booth.description ? (
                <p className="text-sm sm:text-base text-text-secondary leading-relaxed whitespace-pre-line">
                  {booth.description}
                </p>
              ) : (
                <p className="text-sm text-text-muted italic">
                  Visit this exhibitor at {booth.location || "the exhibition area"} during conference break sessions to explore their products and services.
                </p>
              )}
            </div>
            {/* Standee QR Information Note (Issue #21 context) */}
            <div className="p-4 rounded-xl bg-surface-page border border-border-subtle text-xs text-text-muted space-y-1">
              <span className="font-semibold text-text-primary block">
                Visiting this booth on-site?
              </span>
              <p>
                Present your attendee digital pass to booth representatives to share contact credentials and download company brochures directly.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </PublicLayout>
  );
}
