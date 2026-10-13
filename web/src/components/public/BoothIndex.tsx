import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createApiClient, type PublicBoothSummary } from "../../api/client";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { num, publicCopy, type PublicLocale } from "./copy";

type Directory = { status: "loading" } | { status: "ready"; booths: PublicBoothSummary[] } | { status: "unavailable" };

const LATIN_CODE = /^[\x20-\x7E]+$/;

/**
 * Curated index of the congress exhibition, read anonymously from the public directory. If the
 * directory cannot be read the section quietly falls back to explanatory text: it never blocks
 * registration or claims an error the visitor cannot act on.
 */
export function BoothIndex({ slug, locale }: { slug: string; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const [directory, setDirectory] = useState<Directory>({ status: "loading" });

  useEffect(() => {
    let active = true;
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}/booths", { params: { path: { slug } } })
      .then(({ data }) => {
        if (active) setDirectory(Array.isArray(data) ? { status: "ready", booths: data } : { status: "unavailable" });
      })
      .catch(() => {
        if (active) setDirectory({ status: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [slug]);

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
          const latinCode = LATIN_CODE.test(b.location);
          return (
            <li key={b.id}>
              <Link
                to={`/e/${encodeURIComponent(slug)}/booths/${b.id}`}
                className="pub-index-row grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto] items-center gap-4 px-5 py-5 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:gap-8 sm:px-7 sm:py-6 focus-visible:outline-offset-[-2px]"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold text-text-muted">{c.stand}</span>
                  <span
                    className={`block truncate text-event-accent ${
                      latinCode ? "font-mono text-lg sm:text-2xl font-medium tracking-[-0.03em]" : "text-base sm:text-xl font-bold"
                    }`}
                  >
                    {b.location || "—"}
                  </span>
                </span>
                <span className="min-w-0 space-y-1">
                  <span className="block text-base sm:text-lg font-semibold tracking-[-0.015em] text-text-primary break-words"><Bidi text={b.name} /></span>
                  {b.description && <span className="block text-sm text-text-secondary line-clamp-2 sm:line-clamp-1"><Bidi text={b.description} /></span>}
                  {/^https?:\/\//i.test(b.brochure_url) && (
                    <span className="inline-flex items-center gap-1.5 pt-0.5 text-xs font-medium text-text-muted">
                      <Icon name="file" size={14} />
                      {c.brochure}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
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
