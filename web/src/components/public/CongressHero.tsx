import type { ReactNode } from "react";
import type { PublicEvent } from "../../api/client";
import type { PageDoc, PageImage, PageImages } from "../../lib/pageDocument";
import { localized } from "../../lib/pageDocument";
import { CongressSignature } from "../brand/CongressSignature";
import { buttonClassName } from "../ui/buttonStyles";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { indexLabel, num, proseDir, publicCopy, type PublicLocale } from "./copy";
import { calendarDays, congressTiming, formatDateRange, formatMoment, registrationStatus, tierState } from "./format";
import { PageImg } from "./page/PageImg";
import { BELOW_HEADER_MIN_H } from "./viewport";

const STATUS_DOT = { open: "bg-[#3EE0A1]", full: "bg-status-warning-solid", closed: "bg-ink-400" } as const;

export type HeroEvent = Pick<PublicEvent, "name" | "slug" | "starts_at" | "ends_at" | "location" | "ticket_tiers">;

interface CongressHeroProps {
  event: HeroEvent;
  locale: PublicLocale;
  /** Page Studio hero; the default (signature layout, no overrides) is the original hero. */
  hero: PageDoc["hero"];
  accent: PageDoc["branding"]["accent"];
  images: PageImages;
  logo: PageImage | null;
  /** In-page targets that are actually on the page (hidden sections get no button). */
  showPasses: boolean;
  /** Button text for the exhibitors section (the organizer's own section title when set); null when hidden. */
  exhibitionLabel: ReactNode | null;
}

/**
 * Ink hero: the congress name leads, metadata set in columns. Three curated layouts: the generative
 * signature, a full-bleed cover photograph under a legibility scrim, or a split with a framed image.
 * Status chips, dates and buttons always sit on ink, so organizer imagery cannot break their contrast.
 * Header plus hero fill one screen: the section is at least the viewport below the header, and the type
 * scale and vertical rhythm follow the viewport height so title, meta and buttons fit above the fold.
 */
export function CongressHero({ event, locale, hero, accent, images, logo, showPasses, exhibitionLabel }: CongressHeroProps) {
  const c = publicCopy[locale];
  const timing = congressTiming(event.starts_at, event.ends_at);
  // A congress that has ended takes no more registrations, whatever its passes say.
  const status = timing.kind === "ended" ? "closed" : registrationStatus(event.ticket_tiers);
  const days = calendarDays(event.starts_at, event.ends_at);
  const openTiers = event.ticket_tiers.filter((t) => tierState(t) === "AVAILABLE").length;
  const cover = hero.cover_asset_id ? images[hero.cover_asset_id] ?? null : null;
  const layout = hero.layout !== "signature" && cover ? hero.layout : "signature";

  const title = localized(hero.title, locale) ?? event.name;
  const eyebrow = localized(hero.eyebrow, locale);
  const subtitle = localized(hero.subtitle, locale);
  const ctaLabel = localized(hero.cta_label, locale) ?? (status === "open" ? c.ctaReserve : c.ctaPasses);

  const statusLabel = status === "open" ? c.statusOpen : status === "full" ? c.statusFull : c.statusClosed;
  const timingLabel =
    timing.kind === "live"
      ? c.timingLive
      : timing.kind === "ended"
        ? c.timingEnded
        : timing.days === 0
          ? c.timingToday
          : timing.days === 1
            ? c.timingTomorrow
            : c.timingDays(num(timing.days, locale));

  const meta = [
    { label: c.metaDates, value: formatDateRange(event.starts_at, event.ends_at, locale), note: c.dayCount(num(days, locale), days) },
    {
      label: c.metaSchedule,
      value: `${c.opens} ${formatMoment(event.starts_at, locale)}`,
      note: `${c.closes} ${formatMoment(event.ends_at, locale)}`,
    },
    { label: c.metaVenue, value: <Bidi text={event.location} />, note: c.onSite },
    {
      label: c.metaPasses,
      value: openTiers > 0 ? c.passesOpen(num(openTiers, locale), num(event.ticket_tiers.length, locale)) : c.passesNone,
      note: c.freeOfCharge,
    },
  ];

  const heading = (
    <div className="motion-safe:animate-rise space-y-4 lg:space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {logo && (
          <span className="me-2 grid h-12 min-w-12 max-w-[11rem] place-items-center rounded-xl bg-white px-2.5 py-1.5 shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] [border-start-end-radius:20px]">
            <img src={logo.url} alt="" width={logo.width} height={logo.height} decoding="async" className="max-h-9 w-auto max-w-full object-contain" />
          </span>
        )}
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold backdrop-blur-sm">
          <span aria-hidden="true" className="relative flex size-2">
            {status === "open" && <span className="absolute inset-0 rounded-full bg-[#3EE0A1] motion-safe:animate-pulse-ring" />}
            <span className={`relative size-2 rounded-full ${STATUS_DOT[status]}`} />
          </span>
          {statusLabel}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-ink/40 px-3 py-1.5 text-xs font-medium text-ink-200 backdrop-blur-sm">
          <Icon name={timing.kind === "live" ? "activity" : "calendar"} size={14} className="text-aiteb-orchid" />
          {timingLabel}
        </span>
      </div>

      <div className="space-y-3 sm:space-y-4">
        <p className="eyebrow text-ink-300">{eyebrow ? <Bidi text={eyebrow} /> : c.officialRegistration}</p>
        <h1 id="congress-title" className="pub-display max-w-[22ch] text-[clamp(2rem,min(4.5vw,6svh)+0.5rem,4.25rem)] text-white text-balance break-words">
          <Bidi text={title} />
        </h1>
        {subtitle && (
          <p {...proseDir(subtitle)} className="max-w-2xl whitespace-pre-line text-base leading-relaxed text-ink-100 sm:text-lg rtl:leading-[1.85]">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="congress-title" className={`relative isolate flex flex-col overflow-hidden bg-surface-ink text-white ${BELOW_HEADER_MIN_H}`}>
      {layout === "cover" && cover ? (
        <>
          <PageImg image={cover} alt="" priority className="absolute inset-0 -z-20 size-full object-cover" />
          <div aria-hidden="true" className="pub-hero-scrim pub-hero-scrim--cover absolute inset-0 -z-10" />
        </>
      ) : (
        <>
          <CongressSignature
            seed={event.slug}
            accent={accent}
            tone="ink"
            animate
            className={`absolute inset-0 -z-20 size-full rtl:-scale-x-100 ${layout === "split" ? "opacity-60" : ""}`}
          />
          {/* Below lg the split image becomes the backdrop, so the hero still fits one screen. */}
          {layout === "split" && cover && <PageImg image={cover} alt="" priority className="absolute inset-0 -z-20 size-full object-cover lg:hidden" />}
          <div aria-hidden="true" className="pub-hero-grid absolute inset-0 -z-10 bg-meridian-ink" />
          <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />
        </>
      )}

      {/* Bottom padding clears the content sheet that overlaps the hero (pub-sheet: 2rem, 3.5rem from md). */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 pt-[clamp(1rem,3.5svh,3.5rem)] pb-[calc(2rem+clamp(1rem,3svh,2.5rem))] sm:px-6 md:pb-[calc(3.5rem+clamp(1rem,4svh,3rem))] lg:px-10">
        {layout === "split" && cover ? (
          <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">{heading}</div>
            <figure className="relative hidden lg:col-span-5 lg:block motion-safe:animate-fade [animation-delay:160ms]">
              <div aria-hidden="true" className="absolute -inset-3 rounded-[28px] border border-white/10 [border-start-end-radius:72px]" />
              <PageImg
                image={cover}
                alt=""
                priority
                className="relative max-h-[min(30rem,46svh)] w-full rounded-3xl object-cover shadow-pop ring-1 ring-white/15 [border-start-end-radius:64px]"
              />
            </figure>
          </div>
        ) : (
          heading
        )}

        <dl className="mt-[clamp(1.25rem,4svh,3rem)] grid grid-cols-2 border-t border-white/12 lg:grid-cols-4 motion-safe:animate-fade [animation-delay:240ms]">
          {meta.map((m, i) => (
            <div
              key={m.label}
              className={`min-w-0 border-b border-white/12 py-3 pe-4 lg:border-b-0 lg:py-4 lg:pe-8 ${i % 2 === 1 ? "border-s ps-4" : ""} ${
                i > 0 ? "lg:border-s lg:ps-8" : ""
              }`}
            >
              <dt className="flex items-center gap-2 text-[11px] font-medium text-ink-300">
                <span className="font-mono text-aiteb-orchid tabular">{indexLabel(i + 1, locale)}</span>
                {m.label}
              </dt>
              <dd className="mt-1.5 text-[15px] font-semibold leading-snug text-white sm:text-base lg:text-lg break-words">{m.value}</dd>
              <dd className="mt-0.5 text-xs text-ink-300 sm:text-sm">{m.note}</dd>
            </div>
          ))}
        </dl>

        {(showPasses || exhibitionLabel) && (
          <div className="mt-[clamp(1.25rem,3.5svh,2.5rem)] flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {showPasses && (
              <a
                href="#passes"
                className={buttonClassName({
                  variant: "light",
                  size: "xl",
                  className: "press max-sm:min-h-[52px] max-sm:py-3 sm:min-w-[15rem]",
                })}
              >
                <Bidi text={ctaLabel} />
                <Icon name="arrow-right" size={20} />
              </a>
            )}
            {exhibitionLabel && (
              <a
                href="#exhibition"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-surface-ink/30 px-6 text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/[0.06] focus-visible:outline-aiteb-orchid"
              >
                <Icon name="booth" size={18} className="text-aiteb-orchid" />
                {exhibitionLabel}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
