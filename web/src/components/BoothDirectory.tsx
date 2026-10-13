import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, type PublicBoothSummary } from "../api/client";
import { congressPath } from "../lib/congressContext";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { signInPath } from "../lib/safeRedirect";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { SectionHeader } from "./attendee/SectionHeader";

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
  /** Pre-formatted section index shown beside the heading ("03" / "۰۳"). */
  index?: string;
}

/**
 * Public exhibition-booth directory for one congress. The list itself is read anonymously;
 * bookmark state and changes use explicit User authority and never gate the list.
 */
export function BoothDirectory({ slug, token, isRtl, index }: BoothDirectoryProps) {
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

  const counts =
    directory.status === "ready" && booths.length > 0 ? (
      <p className="flex items-center gap-2 text-xs font-medium text-text-muted tabular">
        <Icon name="booth" size={16} className="text-ink-400" />
        <span>
          {isRtl ? `${booths.length.toLocaleString("fa-IR")} غرفه` : `${booths.length} booth${booths.length === 1 ? "" : "s"}`}
          {savedIds && savedCount > 0 ? (
            <span className="text-event-accent">
              {isRtl ? `، ${savedCount.toLocaleString("fa-IR")} ذخیره‌شده` : ` · ${savedCount} saved`}
            </span>
          ) : null}
        </span>
      </p>
    ) : null;

  return (
    <section role="region" className="space-y-5" aria-labelledby="booth-directory-title">
      <SectionHeader
        index={index}
        id="booth-directory-title"
        title={title}
        description={isRtl ? "شرکت‌ها و غرفه‌های حاضر در نمایشگاه این همایش." : "Companies exhibiting at this congress."}
        aside={counts}
      />

      {directory.status === "loading" && (
        <div role="status" aria-label={title} className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-36 rounded-2xl" />
          ))}
        </div>
      )}

      {directory.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-sm text-status-danger-text">
          <p className="flex items-center gap-2">
            <Icon name="alert" size={18} />
            {isRtl ? "فهرست غرفه‌ها بارگذاری نشد." : "The booth directory could not be loaded."}
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={retry} className="min-h-11">
            <Icon name="sync" size={16} />
            {isRtl ? "تلاش دوباره" : "Try again"}
          </Button>
        </div>
      )}

      {directory.status === "ready" && booths.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border-strong bg-surface-panel/60 p-6 text-center text-sm text-text-secondary">
          {isRtl ? "هنوز غرفه‌ای برای این همایش ثبت نشده است." : "No booths have been listed for this congress yet."}
        </p>
      )}

      {directory.status === "ready" && booths.length > 0 && (
        <>
          {(booths.length > SEARCH_THRESHOLD || !signedIn) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {booths.length > SEARCH_THRESHOLD && (
                <div className="relative sm:max-w-sm sm:flex-1">
                  <label htmlFor="booth-search" className="sr-only">{isRtl ? "جستجوی غرفه" : "Search booths"}</label>
                  <Icon name="search" size={18} className="pointer-events-none absolute inset-y-0 start-3.5 my-auto text-ink-400" />
                  <input
                    id="booth-search"
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={isRtl ? "جستجوی غرفه یا محل…" : "Search booths or location…"}
                    className="ui-input ps-10"
                  />
                </div>
              )}
              {!signedIn && (
                <p className="flex items-center gap-2 text-xs text-text-muted">
                  <Icon name="bookmark" size={16} className="text-ink-400" />
                  <span>
                    {isRtl ? "برای ذخیره غرفه‌ها " : "To save booths, "}
                    <Link to={signInPath(slug, congressPath(slug, "my-congress"))} className="font-semibold text-action-primary underline-offset-4 hover:underline">
                      {isRtl ? "وارد شوید" : "sign in"}
                    </Link>
                    .
                  </span>
                </p>
              )}
            </div>
          )}

          {feedback && (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-status-danger-border bg-status-danger-bg px-3 py-2.5 text-xs text-status-danger-text">
              <Icon name="alert" size={16} />
              {feedback}
            </p>
          )}

          {filtered.length === 0 ? (
            <p role="status" className="text-sm text-text-secondary">
              {isRtl ? "غرفه‌ای با این جستجو پیدا نشد." : "No booths match your search."}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {filtered.map((b) => {
                const saved = savedIds?.has(b.id) ?? false;
                return (
                  <li
                    key={b.id}
                    className={`group relative flex flex-col rounded-2xl border bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] duration-300 hover:shadow-lift sm:p-5 ${
                      saved ? "border-event-accent/35" : "border-border-default hover:border-border-strong"
                    }`}
                  >
                    {saved && <span aria-hidden="true" className="absolute inset-y-4 start-0 w-[3px] rounded-e-full bg-[image:var(--grad-aiteb)]" />}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        {b.location && (
                          <p className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-panel-subtle px-2 py-1 text-[11px] font-medium text-text-secondary">
                            <Icon name="pin" size={13} className="text-ink-400" />
                            <span className="truncate font-mono">{b.location}</span>
                          </p>
                        )}
                        <p className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-text-primary break-words">{b.name}</p>
                      </div>
                      {signedIn && savedIds && (
                        <Button
                          type="button"
                          variant={saved ? "outline" : "secondary"}
                          size="sm"
                          className={`shrink-0 min-h-11 min-w-11 ${saved ? "bg-event-accent-soft text-event-accent border-event-accent/30" : ""}`}
                          aria-pressed={saved}
                          aria-label={
                            saved
                              ? isRtl ? `حذف ${b.name} از ذخیره‌شده‌ها` : `Remove ${b.name} from saved booths`
                              : isRtl ? `ذخیره ${b.name}` : `Save ${b.name}`
                          }
                          disabled={pending.has(b.id)}
                          onClick={() => void toggleSaved(b)}
                        >
                          <Icon name="bookmark" size={16} fill={saved ? "currentColor" : "none"} />
                          <span className="text-xs">{saved ? (isRtl ? "ذخیره شد" : "Saved") : isRtl ? "ذخیره" : "Save"}</span>
                        </Button>
                      )}
                    </div>
                    {b.description && <p dir="auto" className="mt-2 text-xs leading-relaxed text-text-secondary line-clamp-2 break-words">{b.description}</p>}
                    <Link
                      to={`/e/${encodeURIComponent(slug)}/booths/${b.id}`}
                      className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start pt-2 text-xs font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring rounded"
                    >
                      {isRtl ? "مشاهده غرفه" : "View booth"}
                      <Icon name="arrow-right" size={15} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
