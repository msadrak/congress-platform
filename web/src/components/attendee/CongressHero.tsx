import type { ReactNode } from "react";
import type { PublicEvent } from "../../api/client";
import { CongressSignature } from "../brand/CongressSignature";
import { PageImg } from "../public/page/PageImg";
import { Icon } from "../ui/Icon";
import type { AttendeeLocale } from "../../lib/i18n";
import { formatDateRange } from "./congressTime";
import type { PanelPage } from "./panelContent";
import { PhaseBadge } from "./PhaseBadge";

interface CongressHeroProps {
  event: Pick<PublicEvent, "name" | "slug" | "starts_at" | "ends_at" | "location"> & { timezone?: string };
  /** Published page: branding logo, hero cover and accent. */
  page: PanelPage;
  locale: AttendeeLocale;
  /** Small label above the title (the current destination). */
  eyebrow: string;
  children?: ReactNode;
}

/**
 * Ink congress cover: the organizer's cover photograph (under a legibility scrim) or the generative
 * signature artwork, the published logo, live status from real dates and editorial metadata.
 */
export function CongressHero({ event, page, locale, eyebrow, children }: CongressHeroProps) {
  const fa = locale === "fa";
  const { doc, images } = page;
  const logo = doc.branding.logo_asset_id ? (images[doc.branding.logo_asset_id] ?? null) : null;
  // Same rule as the public hero: the cover shows only in the cover/split layouts.
  const cover = doc.hero.layout !== "signature" && doc.hero.cover_asset_id ? (images[doc.hero.cover_asset_id] ?? null) : null;
  return (
    <section className="relative isolate overflow-hidden shape-arc-lg bg-surface-ink text-white shadow-lift">
      {cover ? (
        <>
          <PageImg image={cover} alt="" priority className="absolute inset-0 -z-20 size-full object-cover" />
          {/* Over a photograph the scrim never fully opens, so white text keeps its contrast. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-surface-ink via-surface-ink/80 to-surface-ink/45" />
          <div aria-hidden="true" className="at-hero-scrim absolute inset-0 -z-10 opacity-80" />
        </>
      ) : (
        <>
          <CongressSignature seed={event.slug} tone="ink" accent={doc.branding.accent} animate className="absolute inset-0 -z-20 size-full" />
          <div aria-hidden="true" className="at-hero-scrim absolute inset-0 -z-10" />
          <div aria-hidden="true" className="bg-meridian-ink absolute inset-0 -z-10 opacity-60" />
        </>
      )}

      <div className="relative flex min-h-[15rem] flex-col justify-between gap-8 p-6 sm:min-h-[18rem] sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            {logo && (
              <span className="grid h-11 min-w-11 max-w-[9.5rem] place-items-center rounded-xl bg-white px-2.5 py-1.5 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] [border-start-end-radius:18px]">
                {logo.url ? (
                  <img src={logo.url} alt="" width={logo.width} height={logo.height} decoding="async" className="max-h-8 w-auto max-w-full object-contain" />
                ) : (
                  <span aria-hidden="true" className="h-6 w-16 rounded bg-ink-100 motion-safe:animate-pulse" />
                )}
              </span>
            )}
            <span className="eyebrow text-ink-300">{eyebrow}</span>
          </div>
          <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} tone="ink" timeZone={event.timezone} />
        </div>

        <div className="space-y-5 motion-safe:animate-rise">
          <h1 className="max-w-3xl text-2xl font-semibold leading-[1.15] tracking-[-0.025em] text-white text-balance break-words sm:text-4xl lg:text-[2.625rem]">
            {event.name}
          </h1>
          <dl className="grid max-w-3xl gap-x-10 gap-y-4 border-t border-white/15 pt-5 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-300">
                <Icon name="calendar" size={15} />
                {fa ? "زمان برگزاری" : "When"}
              </dt>
              <dd className="font-semibold text-white">{formatDateRange(event.starts_at, event.ends_at, locale, event.timezone)}</dd>
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
