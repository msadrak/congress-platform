import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, type PublicBoothSummary } from "../api/client";
import { congressPath } from "../lib/congressContext";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { signInPath } from "../lib/safeRedirect";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

type Directory =
  | { status: "loading" }
  | { status: "ready"; booths: PublicBoothSummary[] }
  | { status: "error" };

/** Saved-booth state is personal and optional: `null` means signed out or currently unavailable. */
type SavedIds = ReadonlySet<string> | null;

const SEARCH_THRESHOLD = 6;
const NO_BOOTHS: PublicBoothSummary[] = [];

interface BoothDirectoryProps {
  slug: string;
  /** The stored attendee token for personal bookmark state; null when signed out. */
  token: string | null;
  isRtl: boolean;
}

/**
 * Public exhibition-booth directory for one congress. The list itself is read anonymously;
 * bookmark state and changes use explicit User authority and never gate the list.
 */
export function BoothDirectory({ slug, token, isRtl }: BoothDirectoryProps) {
  const [directory, setDirectory] = useState<Directory>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [savedIds, setSavedIds] = useState<SavedIds>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}/booths", { params: { path: { slug } } })
      .then(({ data }) => {
        if (active) setDirectory(data ? { status: "ready", booths: data } : { status: "error" });
      })
      .catch(() => {
        if (active) setDirectory({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [slug, reloadKey]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/attendees/me/bookmarks/booths")
      .then(({ data, response }) => {
        if (!active || !isStoredAttendeeToken(token)) return;
        if (response.status === 401) {
          rejectAttendeeToken(token);
          setSessionLost(true);
        } else if (data) {
          setSavedIds(new Set(data.filter((b) => b.event_slug === slug).map((b) => b.booth_id)));
        }
      })
      .catch(() => {
        // Saved state stays unknown; the public list is unaffected.
      });
    return () => {
      active = false;
    };
  }, [slug, token]);

  const retry = () => {
    setDirectory({ status: "loading" });
    setReloadKey((k) => k + 1);
  };

  const toggleSaved = async (booth: PublicBoothSummary) => {
    if (!token || !savedIds || pending.has(booth.id)) return;
    if (!isStoredAttendeeToken(token)) {
      setSessionLost(true);
      return;
    }
    const wasSaved = savedIds.has(booth.id);
    setFeedback(null);
    setPending((prev) => new Set(prev).add(booth.id));
    try {
      const client = createApiClient({ kind: "user", token });
      const options = { params: { path: { booth_id: booth.id } } };
      const { data, response } = wasSaved
        ? await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", options)
        : await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", options);
      if (!isStoredAttendeeToken(token)) return;
      if (response.status === 401) {
        rejectAttendeeToken(token);
        setSessionLost(true);
        setSavedIds(null);
      } else if (data) {
        setSavedIds((prev) => {
          const next = new Set(prev ?? []);
          if (data.bookmarked) next.add(booth.id);
          else next.delete(booth.id);
          return next;
        });
      } else {
        setFeedback(isRtl ? "ذخیره‌سازی انجام نشد. دوباره تلاش کنید." : "Could not update your saved booths. Please try again.");
      }
    } catch {
      setFeedback(isRtl ? "اتصال برقرار نشد؛ تغییری ذخیره نشد." : "Connection failed; nothing was changed.");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(booth.id);
        return next;
      });
    }
  };

  const booths = directory.status === "ready" ? directory.booths : NO_BOOTHS;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return booths;
    return booths.filter((b) => `${b.name} ${b.location} ${b.description}`.toLowerCase().includes(needle));
  }, [booths, query]);

  const title = isRtl ? "غرفه‌های نمایشگاه" : "Exhibition booths";
  const signedIn = Boolean(token) && !sessionLost;
  const savedCount = savedIds?.size ?? 0;

  return (
    <Card role="region" className="p-5 border-border-default space-y-4" aria-labelledby="booth-directory-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="booth-directory-title" className="text-sm font-bold text-text-primary">🏢 {title}</h2>
        {directory.status === "ready" && booths.length > 0 && (
          <Badge variant="neutral" size="sm">
            {isRtl ? `${booths.length.toLocaleString("fa-IR")} غرفه` : `${booths.length} booth${booths.length === 1 ? "" : "s"}`}
            {savedIds && savedCount > 0 ? (isRtl ? `، ${savedCount.toLocaleString("fa-IR")} ذخیره‌شده` : ` · ${savedCount} saved`) : ""}
          </Badge>
        )}
      </div>

      {directory.status === "loading" && (
        <div role="status" aria-label={title} className="space-y-3 animate-pulse">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-surface-panel-subtle border border-border-subtle" />
          ))}
        </div>
      )}

      {directory.status === "error" && (
        <div role="alert" className="space-y-3 text-sm text-status-danger-text">
          <p>{isRtl ? "فهرست غرفه‌ها بارگذاری نشد." : "The booth directory could not be loaded."}</p>
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            {isRtl ? "تلاش دوباره" : "Try again"}
          </Button>
        </div>
      )}

      {directory.status === "ready" && booths.length === 0 && (
        <p className="text-sm text-text-secondary">
          {isRtl ? "هنوز غرفه‌ای برای این همایش ثبت نشده است." : "No booths have been listed for this congress yet."}
        </p>
      )}

      {directory.status === "ready" && booths.length > 0 && (
        <>
          {booths.length > SEARCH_THRESHOLD && (
            <div>
              <label htmlFor="booth-search" className="sr-only">{isRtl ? "جستجوی غرفه" : "Search booths"}</label>
              <input
                id="booth-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={isRtl ? "جستجوی غرفه یا محل…" : "Search booths or location…"}
                className="w-full px-3 py-2.5 min-h-[44px] bg-surface-panel border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>
          )}

          {!signedIn && (
            <p className="text-xs text-text-muted">
              {isRtl ? "برای ذخیره غرفه‌ها " : "To save booths, "}
              <Link to={signInPath(slug, congressPath(slug, "my-congress"))} className="font-semibold text-action-primary hover:underline">
                {isRtl ? "وارد شوید" : "sign in"}
              </Link>
              {isRtl ? "." : "."}
            </p>
          )}

          {feedback && <p role="alert" className="text-xs text-status-danger-text">{feedback}</p>}

          {filtered.length === 0 ? (
            <p role="status" className="text-sm text-text-secondary">
              {isRtl ? "غرفه‌ای با این جستجو پیدا نشد." : "No booths match your search."}
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {filtered.map((b) => {
                const saved = savedIds?.has(b.id) ?? false;
                return (
                  <li key={b.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold text-text-primary break-words">{b.name}</p>
                      {b.location && <p className="text-xs text-text-muted">📍 {b.location}</p>}
                      {b.description && <p className="text-xs text-text-secondary line-clamp-2 break-words">{b.description}</p>}
                      <Link
                        to={`/e/${encodeURIComponent(slug)}/booths/${b.id}`}
                        className="inline-flex items-center min-h-[44px] text-xs font-semibold text-action-primary hover:underline"
                      >
                        {isRtl ? "مشاهده غرفه" : "View booth"} {isRtl ? "←" : "→"}
                      </Link>
                    </div>
                    {signedIn && savedIds && (
                      <Button
                        type="button"
                        variant={saved ? "outline" : "secondary"}
                        size="sm"
                        className="shrink-0 min-h-[44px] min-w-[44px]"
                        aria-pressed={saved}
                        aria-label={
                          saved
                            ? isRtl ? `حذف ${b.name} از ذخیره‌شده‌ها` : `Remove ${b.name} from saved booths`
                            : isRtl ? `ذخیره ${b.name}` : `Save ${b.name}`
                        }
                        disabled={pending.has(b.id)}
                        onClick={() => void toggleSaved(b)}
                      >
                        <span aria-hidden="true">{saved ? "★" : "☆"}</span>
                        <span className="text-xs">{saved ? (isRtl ? "ذخیره شد" : "Saved") : isRtl ? "ذخیره" : "Save"}</span>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
