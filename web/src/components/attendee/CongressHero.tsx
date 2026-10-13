import type { ReactNode } from "react";
import type { PublicEvent } from "../../api/client";
import { CongressSignature } from "../brand/CongressSignature";
import { Icon } from "../ui/Icon";
import type { AttendeeLocale } from "../../lib/i18n";
import { formatDateRange } from "./congressTime";
import { PhaseBadge } from "./PhaseBadge";

interface CongressHeroProps {
  event: PublicEvent;
  locale: AttendeeLocale;
  /** Small label above the title (the current destination). */
  eyebrow: string;
  children?: ReactNode;
}

/** Ink congress cover: generative signature artwork, live status from real dates, editorial metadata. */
export function CongressHero({ event, locale, eyebrow, children }: CongressHeroProps) {
  const fa = locale === "fa";
  return (
    <section className="relative isolate overflow-hidden shape-arc-lg bg-surface-ink text-white shadow-lift">
      <CongressSignature seed={event.slug} tone="ink" animate className="absolute inset-0 -z-20 size-full" />
      <div aria-hidden="true" className="at-hero-scrim absolute inset-0 -z-10" />
      <div aria-hidden="true" className="bg-meridian-ink absolute inset-0 -z-10 opacity-60" />

      <div className="relative flex min-h-[19rem] flex-col justify-between gap-10 p-6 sm:min-h-[22rem] sm:p-10 lg:p-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="eyebrow text-ink-300">{eyebrow}</span>
          <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} tone="ink" />
        </div>

        <div className="space-y-6 motion-safe:animate-rise">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-white text-balance sm:text-5xl lg:text-[3.5rem]">
            {event.name}
          </h1>
          <dl className="grid max-w-3xl gap-x-10 gap-y-4 border-t border-white/15 pt-5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-300">
                <Icon name="calendar" size={15} />
                {fa ? "زمان برگزاری" : "When"}
              </dt>
              <dd className="font-semibold text-white">{formatDateRange(event.starts_at, event.ends_at, locale)}</dd>
            </div>
            {event.location && (
              <div className="min-w-0 space-y-1">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-300">
                  <Icon name="pin" size={15} />
                  {fa ? "محل برگزاری" : "Where"}
                </dt>
                <dd className="font-semibold text-white break-words">{event.location}</dd>
              </div>
            )}
          </dl>
          {children}
        </div>
      </div>
    </section>
  );
}
