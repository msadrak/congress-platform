import { useEffect, useId, useRef, useState } from "react";
import { mapSearchLinks } from "../../lib/eventLinks";
import { downloadCalendarFile, publicEventUrl, type CalendarEvent } from "./calendarDownload";
import { Icon } from "../ui/Icon";
import { publicCopy, type PublicLocale } from "./copy";


// On phones the three actions are equal tiles (icon over label) so they always fit one row.
const tile = "max-sm:w-full max-sm:flex-col max-sm:justify-center max-sm:gap-1 max-sm:rounded-2xl max-sm:px-2 max-sm:py-2.5 max-sm:text-xs";
const pill =
  "press inline-flex min-h-11 items-center gap-2 rounded-full border border-border-default bg-surface-panel px-4 text-sm font-semibold text-text-primary shadow-soft transition-colors hover:border-border-strong hover:bg-surface-panel-subtle cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Map-app links for the congress address, as a compact list (used by the actions row and the venue). */
export function MapLinks({ query, locale }: { query: string; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const links = mapSearchLinks(query);
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((link) => (
        <li key={link.provider}>
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={pill}>
            <Icon name="pin" size={16} className="text-event-accent" />
            {c.mapProviders[link.provider]}
            <span className="sr-only">{c.opensNewTab}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Quiet row under the hero: add the congress to a calendar, share its page (Web Share API, else the
 * link is copied and confirmed by a toast), and open the venue in a map app.
 */
export function EventActions({ event, locale }: { event: CalendarEvent; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const [toast, setToast] = useState<{ text: string; url?: string } | null>(null);
  const [mapsOpen, setMapsOpen] = useState(false);
  const mapsId = useId();
  const mapsRef = useRef<HTMLDivElement>(null);
  const hasAddress = mapSearchLinks(event.location).length > 0;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.url ? 8000 : 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!mapsOpen) return;
    const close = (e: Event) => {
      const outside = e.target instanceof Node && !mapsRef.current?.contains(e.target);
      if (e instanceof KeyboardEvent ? e.key === "Escape" : outside) setMapsOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [mapsOpen]);

  const share = async () => {
    const url = publicEventUrl(event.slug);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: event.name, text: c.shareText(event.name), url });
        return;
      } catch (error) {
        // The visitor closed the share sheet: nothing to report.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast({ text: c.linkCopied });
    } catch {
      setToast({ text: c.copyFailed, url });
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8 lg:px-10">
      <div role="group" aria-label={c.actionsLabel} className={`grid gap-2 sm:flex sm:flex-wrap sm:items-start ${hasAddress ? "grid-cols-3" : "grid-cols-2"}`}>
        <button type="button" className={`${pill} ${tile}`} onClick={() => downloadCalendarFile(event)}>
          <Icon name="calendar" size={18} className="text-event-accent" />
          {c.addToCalendar}
        </button>
        <button type="button" className={`${pill} ${tile}`} onClick={() => void share()}>
          <Icon name="share" size={18} className="text-event-accent" />
          {c.share}
        </button>
        {hasAddress && (
          <div ref={mapsRef} className="relative">
            <button
              type="button"
              className={`${pill} ${tile}`}
              aria-expanded={mapsOpen}
              aria-controls={mapsId}
              onClick={() => setMapsOpen((open) => !open)}
            >
              <Icon name="pin" size={18} className="text-event-accent" />
              {c.directions}
              <Icon name="chevron-down" size={16} className={`text-text-muted transition-transform max-sm:hidden ${mapsOpen ? "rotate-180" : ""}`} />
            </button>
            {mapsOpen && (
              <div
                id={mapsId}
                className="absolute end-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-border-default bg-surface-panel p-3 shadow-lift motion-safe:animate-fade"
              >
                <p className="px-1 pb-2 text-xs font-semibold text-text-muted">{c.directionsTitle}</p>
                <MapLinks query={event.location} locale={locale} />
              </div>
            )}
          </div>
        )}
      </div>
      {/* Always mounted, so screen readers announce the confirmation when it appears. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-50 flex justify-center px-4">
        {toast && (
          <p className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-surface-ink px-4 py-2.5 text-sm font-medium text-white shadow-pop motion-safe:animate-pop">
            <Icon name={toast.url ? "link" : "check"} size={16} className="shrink-0 text-aiteb-orchid" />
            <span>{toast.text}</span>
            {toast.url && <span className="min-w-0 select-all truncate font-mono text-xs ltr-isolate">{toast.url}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
