import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, type PublicBoothSummary } from "../../api/client";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { num, publicCopy, type PublicLocale } from "./copy";

type Directory = { status: "loading" } | { status: "ready"; booths: PublicBoothSummary[] } | { status: "unavailable" };

const LATIN_CODE = /^[\x20-\x7E]+$/;

/**
 * Curated index of the congress exhibition, read anonymously from the public directory (or given by
 * the Page Studio preview, which reads it with the organizer key). If the directory cannot be read the
 * section quietly falls back to explanatory text: it never blocks registration or claims an error the
 * visitor cannot act on.
 */
export function BoothIndex({ slug, locale, booths }: { slug: string; locale: PublicLocale; booths?: PublicBoothSummary[] }) {
  const c = publicCopy[locale];
  const [fetched, setFetched] = useState<Directory>({ status: "loading" });
  const directory: Directory = booths ? { status: "ready", booths } : fetched;

  useEffect(() => {
    if (booths) return;
    let active = true;
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}/booths", { params: { path: { slug } } })
      .then(({ data }) => {
        if (active) setFetched(Array.isArray(data) ? { status: "ready", booths: data } : { status: "unavailable" });
      })
      .catch(() => {
        if (active) setFetched({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [slug, booths]);

  if (directory.status === "loading") {
    return (
      <div aria-hidden="true" className="space-y-px overflow-hidden rounded-2xl border border-border-default bg-border-subtle">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-6 bg-surface-panel px-5 py-6 sm:px-7">
            <div className="skeleton h-8 w-20" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-2/5" />
              <div className="skeleton h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (directory.status === "unavailable") {
    return <p className="max-w-2xl text-base leading-relaxed text-text-secondary">{c.exhibitionFallback}</p>;
  }

  if (directory.booths.length === 0) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-dashed border-border-strong bg-surface-panel px-6 py-8 text-text-secondary">
        <Icon name="booth" size={24} className="text-text-muted" />
        <p className="text-base">{c.exhibitionEmpty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-xs text-text-muted tabular">{c.exhibitionCount(num(directory.booths.length, locale), directory.booths.length)}</p>
      <ul className="overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft divide-y divide-border-subtle">
        {directory.booths.map((b) => {
          // A short Latin stand code ("A12") is set large as a placard; anything longer reads as text and wraps.
          const code = LATIN_CODE.test(b.location) && b.location.length <= 8;
          return (
            <li key={b.id}>
              <Link
                to={`/e/${encodeURIComponent(slug)}/booths/${b.id}`}
                className="pub-index-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-4 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:gap-x-8 sm:px-7 sm:py-6 focus-visible:outline-offset-[-2px]"
              >
                <span className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0.5">
                  <span className="shrink-0 text-[11px] font-semibold text-text-muted">{c.stand}</span>
                  <span
                    className={`min-w-0 text-event-accent break-words ${
                      code ? "font-mono text-sm font-medium sm:text-2xl sm:tracking-[-0.03em]" : "text-sm font-semibold sm:text-base sm:leading-snug"
                    }`}
                  >
                    <Bidi text={b.location || "—"} />
                  </span>
                </span>
                <span className="col-start-1 row-start-2 min-w-0 space-y-1 sm:col-start-2 sm:row-start-1">
                  <span className="block text-base sm:text-lg font-semibold tracking-[-0.015em] text-text-primary break-words"><Bidi text={b.name} /></span>
                  {b.description && <span className="block text-sm text-text-secondary line-clamp-2 sm:line-clamp-1"><Bidi text={b.description} /></span>}
                  {/^https?:\/\//i.test(b.brochure_url) && (
                    <span className="inline-flex items-center gap-1.5 pt-0.5 text-xs font-medium text-text-muted">
                      <Icon name="file" size={14} />
                      {c.brochure}
                    </span>
                  )}
                </span>
                <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-3 sm:col-start-3 sm:row-span-1">
                  <span className="sr-only lg:not-sr-only lg:text-sm lg:font-semibold lg:text-event-accent">{c.viewBooth}</span>
                  <span className="pub-index-arrow grid size-10 place-items-center rounded-full border border-border-default text-text-secondary">
                    <Icon name="arrow-up-right" size={18} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
