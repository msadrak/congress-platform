import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, localizedApiError, type PublicEventSummary } from "../../api/client";
import { CongressSignature } from "../brand/CongressSignature";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
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
      className="press group flex h-full items-center gap-4 rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span aria-hidden="true" className="size-14 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:22px]">
        <CongressSignature seed={event.slug} tone="ink" className="size-full" />
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="block text-base font-semibold leading-snug tracking-[-0.01em] text-text-primary break-words">
          <Bidi text={event.name} />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
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
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            live ? "bg-status-success-bg text-status-success-text" : "bg-action-subtle text-action-primary"
          }`}
        >
          <Icon name={live ? "activity" : "clock"} size={13} />
          {timingLabel(event, locale, now)}
        </span>
      </span>
      <Icon name="arrow-right" size={18} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}

/**
 * The platform's public list of congresses (`GET /api/public/events`: those the organizer chose to list,
 * published, not archived), upcoming and running ones only, soonest first, a page at a time. Renders nothing
 * when there is none, so the page never shows an empty band.
 */
export function PublicEventList({ locale, variant = "section", headingId = "public-events-heading" }: PublicEventListProps) {
  const c = publicCopy[locale];
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const now = useNow(60_000);

  useEffect(() => {
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
  }, [attempt]);

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

  if (state.status === "ready" && state.items.length === 0) return null;

  const panel = variant === "panel";
  const heading = (
    <div className={panel ? "space-y-1" : "max-w-3xl space-y-4"}>
      {!panel && <p className="text-xs font-semibold text-text-muted">{c.listEyebrow}</p>}
      <h2
        id={headingId}
        className={
          panel
            ? "text-lg font-semibold tracking-[-0.02em] text-text-primary"
            : "text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-5xl rtl:leading-[1.3]"
        }
      >
        {c.listTitle}
      </h2>
      <p className={panel ? "text-sm text-text-secondary" : "text-base leading-relaxed text-text-secondary sm:text-lg"}>{c.listLead}</p>
    </div>
  );

  let body;
  if (state.status === "loading") {
    body = (
      <div role="status" aria-label={c.listLoading} className="grid gap-3 sm:grid-cols-2">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-5 text-sm text-status-danger-text">
        <p className="flex items-start gap-2.5 font-semibold">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
          {c.listFailed}
        </p>
        {state.error !== null && <p className="text-xs leading-relaxed">{localizedApiError(state.error, locale)}</p>}
        <Button type="button" variant="secondary" size="md" className="self-start" onClick={() => setAttempt((n) => n + 1)}>
          <Icon name="sync" size={16} />
          {c.retry}
        </Button>
      </div>
    );
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
          <p role="alert" className="text-sm text-status-danger-text">
            {state.moreError === null ? c.listFailed : localizedApiError(state.moreError, locale)}
          </p>
        )}
        {state.more && (
          <Button type="button" variant="secondary" size="md" disabled={state.loadingMore} aria-busy={state.loadingMore} onClick={() => void loadMore()}>
            <Icon name="plus" size={16} />
            {c.listMore}
          </Button>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} data-testid="public-event-list" className={panel ? "space-y-4" : "space-y-10"}>
      {heading}
      {body}
    </section>
  );
}
