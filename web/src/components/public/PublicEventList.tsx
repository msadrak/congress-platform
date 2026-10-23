import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, localizedApiError, type PublicEventSummary } from "../../api/client";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Notice } from "../ui/Notice";
import { Bidi } from "./Bidi";
import { num, publicCopy, type PublicLocale } from "./copy";
import { congressTiming, formatDateRange } from "./format";
import { useNow } from "../attendee/useNow";

const PAGE_SIZE = 6;

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: PublicEventSummary[]; more: boolean; loadingMore: boolean; moreError: unknown | undefined }
  /** `error`: the failed response body, or null when there was no response at all. */
  | { status: "error"; error: unknown };

interface PublicEventListProps {
  locale: PublicLocale;
  /** `section`: the platform home's full-width band; `panel`: a compact block inside the attendee panel. */
  variant?: "section" | "panel";
  /** Heading id (several lists never share a page). */
  headingId?: string;
  /** Load only once the list scrolls into view (a visit that never reaches it asks nothing). */
  lazy?: boolean;
  /** Extra classes for the rendered section (e.g. its spacing); nothing is rendered while there is no list. */
  className?: string;
  /** Shown under the heading when nothing is listed; without it an empty list renders nothing. */
  emptyText?: string;
}

/** The API lists upcoming and running congresses first, then past ones: a page ending in a past one is the last page. */
function pageOf(items: readonly PublicEventSummary[], total: number, offset: number, now: number) {
  const upcoming = items.filter((e) => Date.parse(e.ends_at) > now);
  return { upcoming, more: upcoming.length === items.length && offset + items.length < total };
}

function timingLabel(event: PublicEventSummary, locale: PublicLocale, now: number): string {
  const c = publicCopy[locale];
  const timing = congressTiming(event.starts_at, event.ends_at, now, event.timezone);
  if (timing.kind === "live") return c.timingLive;
  if (timing.kind === "ended") return c.timingEnded;
  if (timing.days === 0) return c.timingToday;
  if (timing.days === 1) return c.timingTomorrow;
  return c.timingDays(num(timing.days, locale));
}

function EventCard({ event, locale, now }: { event: PublicEventSummary; locale: PublicLocale; now: number }) {
  const c = publicCopy[locale];
  const live = congressTiming(event.starts_at, event.ends_at, now, event.timezone).kind === "live";
  return (
    <Link
      to={`/e/${encodeURIComponent(event.slug)}`}
      aria-label={c.listOpen(event.name)}
      data-testid="public-event-card"
      className="group flex h-full items-center gap-4 rounded-card border border-border-default bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift"
    >
      <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-control bg-aiteb-lavender text-aiteb-indigo">
        <Icon name="congress" size={24} />
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block text-body font-semibold leading-snug text-text-primary break-words">
          <Bidi text={event.name} />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" size={14} className="text-ink-400" />
            {formatDateRange(event.starts_at, event.ends_at, locale, event.timezone)}
          </span>
          {event.location && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="pin" size={14} className="text-ink-400" />
              <span className="break-words">
                <Bidi text={event.location} />
              </span>
            </span>
          )}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold ${
            live ? "bg-status-success-bg text-status-success-text" : "bg-action-subtle text-action-primary"
          }`}
        >
          <Icon name={live ? "activity" : "clock"} size={13} />
          {timingLabel(event, locale, now)}
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 text-ink-400" />
    </Link>
  );
}

/**
 * The platform's public list of congresses (`GET /api/public/events`: those the organizer chose to list,
 * published, not archived), upcoming and running ones only, soonest first, a page at a time. Renders nothing
 * when there is none, so the page never shows an empty band.
 */
export function PublicEventList({ locale, variant = "section", headingId = "public-events-heading", lazy = false, className = "", emptyText }: PublicEventListProps) {
  const c = publicCopy[locale];
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState(!lazy);
  const sentinel = useRef<HTMLDivElement>(null);
  const now = useNow(60_000);

  // Below the fold: load once the visitor scrolls toward it (a landing visit that leaves at once asks nothing).
  useEffect(() => {
    if (wanted || !sentinel.current) return;
    if (typeof IntersectionObserver === "undefined") {
      // oxlint-disable-next-line react/set-state-in-effect -- no observer (very old browser): load at once.
      setWanted(true);
      return;
    }
    // The bottom inset keeps a sentinel that merely touches the viewport's lower edge from counting.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setWanted(true);
    }, { rootMargin: "0px 0px -2px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [wanted]);

  useEffect(() => {
    if (!wanted) return;
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect -- a retry starts from the loading state.
    setState({ status: "loading" });
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events", { params: { query: { limit: PAGE_SIZE, offset: 0 } } })
      .then(({ data, error, response }) => {
        if (!active) return;
        // An API without the list (older release) has nothing to list: no band, no error.
        if (!data && response.status === 404) return setState({ status: "ready", items: [], more: false, loadingMore: false, moreError: undefined });
        if (!data) return setState({ status: "error", error: error ?? null });
        const page = pageOf(data.items, data.total, 0, Date.now());
        setState({ status: "ready", items: page.upcoming, more: page.more, loadingMore: false, moreError: undefined });
      })
      .catch(() => {
        if (active) setState({ status: "error", error: null });
      });
    return () => {
      active = false;
    };
  }, [attempt, wanted]);

  const loadMore = async () => {
    if (state.status !== "ready" || state.loadingMore) return;
    const offset = state.items.length;
    setState({ ...state, loadingMore: true, moreError: undefined });
    const result = await createApiClient({ kind: "anonymous" })
      .GET("/api/public/events", { params: { query: { limit: PAGE_SIZE, offset } } })
      .catch(() => null);
    setState((current) => {
      if (current.status !== "ready") return current;
      if (!result?.data) return { ...current, loadingMore: false, moreError: result?.error ?? null };
      const page = pageOf(result.data.items, result.data.total, offset, Date.now());
      const known = new Set(current.items.map((e) => e.id));
      return { status: "ready", items: [...current.items, ...page.upcoming.filter((e) => !known.has(e.id))], more: page.more, loadingMore: false, moreError: undefined };
    });
  };

  if (!wanted) return <div ref={sentinel} aria-hidden="true" data-testid="public-event-list-sentinel" className="h-px" />;
  const empty = state.status === "ready" && state.items.length === 0;
  if (empty && !emptyText) return null;

  const panel = variant === "panel";
  const heading = (
    <h2 id={headingId} className={`${panel ? "text-title-sm" : "text-title"} font-bold text-text-primary`}>
      {c.listTitle}
    </h2>
  );

  let body;
  if (state.status === "loading") {
    body = (
      <div role="status" aria-label={c.listLoading} className="grid gap-3 sm:grid-cols-2">
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-24 rounded-card" />
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <Notice
        tone="danger"
        title={c.listFailed}
        action={
          <Button type="button" variant="secondary" size="sm" icon="sync" onClick={() => setAttempt((n) => n + 1)}>
            {c.retry}
          </Button>
        }
      >
        {state.error !== null && <p>{localizedApiError(state.error, locale)}</p>}
      </Notice>
    );
  } else if (empty) {
    body = <p className="text-body-sm text-text-secondary">{emptyText}</p>;
  } else {
    body = (
      <div className="space-y-4">
        <ul className={`grid gap-3 ${panel ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
          {state.items.map((event) => (
            <li key={event.id}>
              <EventCard event={event} locale={locale} now={now} />
            </li>
          ))}
        </ul>
        {state.moreError !== undefined && (
          <p role="alert" className="text-body-sm text-status-danger-text">
            {state.moreError === null ? c.listFailed : localizedApiError(state.moreError, locale)}
          </p>
        )}
        {state.more && (
          <Button type="button" variant="secondary" icon="plus" loading={state.loadingMore} onClick={() => void loadMore()}>
            {c.listMore}
          </Button>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} data-testid="public-event-list" className={`${panel ? "space-y-4" : "space-y-6"} ${className}`.trim()}>
      {heading}
      {body}
    </section>
  );
}
