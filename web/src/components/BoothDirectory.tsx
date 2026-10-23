import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiErrorCode, createApiClient, localizedApiError, type PublicBoothSummary } from "../api/client";
import { congressPath, useRevalidateOnFocus } from "../lib/congressContext";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { signInPath } from "../lib/safeRedirect";
import { searchText } from "./public/format";
import { codeFontClass, formatNumber } from "../lib/format";
import { boothDirectoryCopy } from "../copy/public";
import { BoothLogo } from "./BoothLogo";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";
import { Notice } from "./ui/Notice";
import { SearchInput } from "./ui/Input";
import { SectionHeader } from "./ui/PageHeader";

export type BoothList =
  | { status: "loading" }
  | { status: "ready"; booths: PublicBoothSummary[] }
  | { status: "error" };

/** Saved-booth state is personal and optional: `null` means signed out or currently unavailable. */
type SavedIds = ReadonlySet<string> | null;

const SEARCH_THRESHOLD = 6;
const NO_BOOTHS: PublicBoothSummary[] = [];
const NOTHING_PENDING: ReadonlySet<string> = new Set();

/** Why a save did not happen; `register` adds a link to the congress page to get a pass. */
export interface BoothFeedback {
  text: string;
  register?: boolean;
}

const normalizeSearch = searchText;
/** The page language from the hosts' `isRtl` prop. */
const localeFor = (rtl: boolean): "fa" | "en" => (rtl ? "fa" : "en");

interface BoothDirectoryProps {
  slug: string;
  /** The congress id: a save is bound to it (the server refuses a booth from another congress). */
  eventId: string;
  /** The stored attendee token for personal bookmark state; null when signed out. */
  token: string | null;
  isRtl: boolean;
  /** Ignored: section indexes are gone. The attendee home (UX-ATT-SHELL, team2) still passes it. */
  index?: string;
  /** Heading and lede from the published page's exhibitors section. */
  title: string;
  lead: string;
}

/**
 * Public exhibition-booth directory for one congress. The list itself is read anonymously (and re-read
 * when the attendee returns to the tab); bookmark state and changes use explicit User authority and never
 * gate the list.
 */
export function BoothDirectory({ slug, eventId, token, isRtl, title, lead }: BoothDirectoryProps) {
  const copy = boothDirectoryCopy[localeFor(isRtl)];
  const [directory, setDirectory] = useState<BoothList>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [savedIds, setSavedIds] = useState<SavedIds>(null);
  const [sessionLost, setSessionLost] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(NOTHING_PENDING);
  const [feedback, setFeedback] = useState<BoothFeedback | null>(null);

  useEffect(() => {
    let active = true;
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}/booths", { params: { path: { slug } } })
      .then(({ data }) => {
        // A failed refresh keeps the list already on screen.
        if (active) setDirectory((prev) => (data ? { status: "ready", booths: data } : prev.status === "ready" ? prev : { status: "error" }));
      })
      .catch(() => {
        if (active) setDirectory((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      });
    return () => {
      active = false;
    };
  }, [slug, reloadKey]);

  useRevalidateOnFocus(useCallback(() => setReloadKey((k) => k + 1), []));

  useEffect(() => {
    if (!token) return;
    let active = true;
    createApiClient({ kind: "user", token })
      .GET("/api/attendees/me/bookmarks/booths")
      .then(({ data, response }) => {
        if (!active) return;
        const session = attendeeResponseState(token, response.status);
        if (session === "changed") return;
        if (session === "expired") {
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
      const path = { booth_id: booth.id };
      const { data, error, response } = wasSaved
        ? await client.DELETE("/api/attendees/me/bookmarks/booths/{booth_id}", { params: { path } })
        : await client.POST("/api/attendees/me/bookmarks/booths/{booth_id}", { params: { path, query: { event_id: eventId } } });
      const session = attendeeResponseState(token, response.status);
      if (session === "changed") return;
      if (session === "expired") {
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
        const code = apiErrorCode(error);
        if (code === "ACTIVE_TICKET_REQUIRED") setFeedback({ text: copy.needsPass, register: true });
        else if (code === "BOOTH_OTHER_EVENT") setFeedback({ text: copy.otherEvent });
        else if (code) setFeedback({ text: localizedApiError(error, localeFor(isRtl)) });
        else setFeedback({ text: copy.updateFailed });
      }
    } catch {
      setFeedback({ text: copy.connectionFailed });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(booth.id);
        return next;
      });
    }
  };

  return (
    <BoothDirectoryView
      slug={slug}
      isRtl={isRtl}
      title={title}
      lead={lead}
      directory={directory}
      onRetry={retry}
      signedIn={Boolean(token) && !sessionLost}
      savedIds={savedIds}
      pending={pending}
      onToggleSaved={(booth) => void toggleSaved(booth)}
      feedback={feedback}
    />
  );
}

interface BoothDirectoryViewProps {
  slug: string;
  isRtl: boolean;
  title: string;
  lead: string;
  directory: BoothList;
  onRetry: () => void;
  /** Signed out: a sign-in hint replaces the save buttons. */
  signedIn: boolean;
  /** Saved booths; null while unknown (no save buttons are offered). */
  savedIds: SavedIds;
  pending?: ReadonlySet<string>;
  onToggleSaved: (booth: PublicBoothSummary) => void;
  feedback?: BoothFeedback | null;
}

/** The directory as drawn; used by the attendee home and by the organizer's panel preview. */
export function BoothDirectoryView({
  slug,
  isRtl,
  title,
  lead,
  directory,
  onRetry,
  signedIn,
  savedIds,
  pending = NOTHING_PENDING,
  onToggleSaved,
  feedback = null,
}: BoothDirectoryViewProps) {
  const [query, setQuery] = useState("");
  const booths = directory.status === "ready" ? directory.booths : NO_BOOTHS;
  const searching = query.trim() !== "";
  const filtered = useMemo(() => {
    const needle = normalizeSearch(query.trim());
    if (!needle) return booths;
    return booths.filter((b) => normalizeSearch(`${b.name} ${b.location} ${b.description}`).includes(needle));
  }, [booths, query]);

  const locale = localeFor(isRtl);
  const copy = boothDirectoryCopy[locale];
  const savedCount = savedIds?.size ?? 0;
  const fmt = (n: number) => formatNumber(n, locale);
  const resultCount = copy.resultCount(fmt(filtered.length), fmt(booths.length), booths.length);

  const counts =
    directory.status === "ready" && booths.length > 0 ? (
      <p className="flex items-center gap-2 text-xs font-medium text-text-muted tabular">
        <Icon name="booth" size={16} className="text-ink-400" />
        <span>
          {searching ? resultCount : copy.boothCount(fmt(booths.length), booths.length)}
          {savedIds && savedCount > 0 ? <span className="text-event-accent">{copy.savedCount(fmt(savedCount))}</span> : null}
        </span>
      </p>
    ) : null;

  return (
    <section role="region" className="space-y-5" aria-labelledby="booth-directory-title">
      <SectionHeader id="booth-directory-title" title={<bdi>{title}</bdi>} description={<bdi>{lead}</bdi>} action={counts} />

      {directory.status === "loading" && (
        <div role="status" aria-label={title} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-36 rounded-card" />
          ))}
        </div>
      )}

      {directory.status === "error" && (
        <Notice
          tone="danger"
          action={
            <Button type="button" variant="secondary" size="sm" icon="sync" onClick={onRetry}>
              {copy.retry}
            </Button>
          }
        >
          {copy.loadFailed}
        </Notice>
      )}

      {directory.status === "ready" && booths.length === 0 && (
        <p className="rounded-card border border-dashed border-border-strong bg-surface-panel/60 p-6 text-center text-body-sm text-text-secondary">
          {copy.empty}
        </p>
      )}

      {directory.status === "ready" && booths.length > 0 && (
        <>
          {(booths.length > SEARCH_THRESHOLD || !signedIn) && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {booths.length > SEARCH_THRESHOLD && (
                <SearchInput
                  id="booth-search"
                  aria-label={copy.searchLabel}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  clearLabel={copy.clearSearch}
                  placeholder={copy.searchPlaceholder}
                  wrapperClassName="sm:max-w-sm sm:flex-1"
                />
              )}
              {!signedIn && (
                <p className="flex items-center gap-2 text-caption text-text-muted">
                  <Icon name="bookmark" size={16} className="text-ink-400" />
                  <span>
                    {copy.signInLead}
                    <Link to={signInPath(slug, congressPath(slug, "my-congress"))} className="inline-flex min-h-11 items-center rounded font-semibold text-action-primary underline-offset-4 hover:underline">
                      {copy.signIn}
                    </Link>
                    .
                  </span>
                </p>
              )}
            </div>
          )}

          {feedback && (
            <Notice
              tone="danger"
              action={
                feedback.register ? (
                  <Link to={`/e/${encodeURIComponent(slug)}`} className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-4">
                    {copy.getPass}
                    <Icon name="arrow-right" size={14} />
                  </Link>
                ) : undefined
              }
            >
              {feedback.text}
            </Notice>
          )}

          {booths.length > SEARCH_THRESHOLD && (
            <p role="status" className="sr-only">
              {searching ? resultCount : ""}
            </p>
          )}

          {filtered.length === 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body-sm text-text-secondary">{copy.noMatch}</p>
              <Button type="button" variant="ghost" size="sm" icon="x" onClick={() => setQuery("")}>
                {copy.clearSearch}
              </Button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {filtered.map((b) => {
                const saved = savedIds?.has(b.id) ?? false;
                return (
                  <li
                    key={b.id}
                    className={`group relative flex min-w-0 flex-col rounded-card border bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] duration-300 hover:shadow-lift sm:p-5 ${
                      saved ? "border-event-accent/35" : "border-border-default hover:border-border-strong"
                    }`}
                  >
                    {saved && <span aria-hidden="true" className="absolute inset-y-4 start-0 w-[3px] rounded-e-full bg-event-accent" />}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <BoothLogo src={b.logo_url} alt={b.name} size="row" lazy />
                        <div className="min-w-0 space-y-1.5">
                          {b.location && (
                            <p className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-panel-subtle px-2 py-1 text-caption font-medium text-text-secondary">
                              <Icon name="pin" size={13} className="text-ink-400" />
                              <span className={`truncate ${codeFontClass(b.location)}`}>{b.location}</span>
                            </p>
                          )}
                          <p dir="auto" className="text-body font-semibold leading-snug text-text-primary break-words">{b.name}</p>
                        </div>
                      </div>
                      {signedIn && savedIds && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          className={`shrink-0 min-w-11 ${saved ? "bg-event-accent-soft text-event-accent border-event-accent/30" : ""}`}
                          aria-label={saved ? copy.removeNamed(b.name) : copy.saveNamed(b.name)}
                          disabled={pending.has(b.id)}
                          onClick={() => onToggleSaved(b)}
                        >
                          <Icon name="bookmark" size={16} fill={saved ? "currentColor" : "none"} />
                          <span className="text-caption">{saved ? copy.saved : copy.save}</span>
                        </Button>
                      )}
                    </div>
                    {b.description && <p dir="auto" className="mt-2 text-xs leading-relaxed text-text-secondary line-clamp-2 break-words">{b.description}</p>}
                    <Link
                      to={`/e/${encodeURIComponent(slug)}/booths/${b.id}`}
                      className="mt-auto inline-flex min-h-11 items-center gap-1.5 self-start pt-2 text-caption font-semibold text-action-primary underline-offset-4 hover:underline rounded"
                    >
                      {copy.viewBooth}
                      <Icon name="chevron-right" size={15} />
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
