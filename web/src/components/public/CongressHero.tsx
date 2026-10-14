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
  showExhibition: boolean;
}

/**
 * Ink hero: the congress name leads, metadata set in columns. Three curated layouts: the generative
 * signature, a full-bleed cover photograph under a legibility scrim, or a split with a framed image.
 * Status chips, dates and buttons always sit on ink, so organizer imagery cannot break their contrast.
 */
export function CongressHero({ event, locale, hero, accent, images, logo, showPasses, showExhibition }: CongressHeroProps) {
  const c = publicCopy[locale];
  const status = registrationStatus(event.ticket_tiers);
  const timing = congressTiming(event.starts_at, event.ends_at);
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
    { label: c.metaDates, value: formatDateRange(event.starts_at, event.ends_at, locale), note: c.dayCount(num(days, locale), days), wide: false },
    {
      label: c.metaSchedule,
      value: `${c.opens} ${formatMoment(event.starts_at, locale)}`,
      note: `${c.closes} ${formatMoment(event.ends_at, locale)}`,
      wide: false,
    },
    { label: c.metaVenue, value: <Bidi text={event.location} />, note: c.onSite, wide: true },
    {
      label: c.metaPasses,
      value: openTiers > 0 ? c.passesOpen(num(openTiers, locale), num(event.ticket_tiers.length, locale)) : c.passesNone,
      note: c.freeOfCharge,
      wide: false,
    },
  ];

  const heading = (
    <div className="motion-safe:animate-rise space-y-6 sm:space-y-8">
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

      <div className="space-y-4">
        <p className="eyebrow text-ink-300">{eyebrow ? <Bidi text={eyebrow} /> : c.officialRegistration}</p>
        <h1 id="congress-title" className="pub-display max-w-[16ch] text-[clamp(2.4rem,8.4vw,6.75rem)] text-white break-words">
          <Bidi text={title} />
        </h1>
        {subtitle && (
          <p {...proseDir(subtitle)} className="max-w-2xl whitespace-pre-line text-lg leading-relaxed text-ink-100 sm:text-xl rtl:leading-[1.9]">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <section aria-labelledby="congress-title" className="relative isolate overflow-hidden bg-surface-ink text-white">
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
          <div aria-hidden="true" className="pub-hero-grid absolute inset-0 -z-10 bg-meridian-ink" />
          <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />
        </>
      )}

      <div className="mx-auto flex max-w-7xl flex-col px-4 pt-10 pb-24 sm:px-6 sm:pt-16 sm:pb-32 lg:min-h-[640px] lg:px-10 lg:pt-20 lg:pb-36">
        {layout === "split" && cover ? (
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">{heading}</div>
            <figure className="relative lg:col-span-5 motion-safe:animate-fade [animation-delay:160ms]">
              <div aria-hidden="true" className="absolute -inset-3 rounded-[28px] border border-white/10 [border-start-end-radius:72px]" />
              <PageImg
                image={cover}
                alt=""
                priority
                className="relative max-h-[30rem] w-full rounded-3xl object-cover shadow-pop ring-1 ring-white/15 [border-start-end-radius:64px]"
              />
            </figure>
          </div>
        ) : (
          heading
        )}

        <dl className="mt-10 grid grid-cols-2 border-t border-white/12 sm:mt-14 lg:grid-cols-4 motion-safe:animate-fade [animation-delay:240ms]">
          {meta.map((m, i) => (
            <div
              key={m.label}
              className={`min-w-0 border-b border-white/12 py-5 pe-4 lg:border-b-0 lg:pe-8 ${
                m.wide ? "col-span-2 lg:col-span-1" : ""
              } ${i > 0 ? "lg:border-s lg:ps-8" : ""} ${i === 1 ? "border-s border-white/12 ps-4 lg:ps-8" : ""}`}
            >
              <dt className="flex items-center gap-2 text-[11px] font-medium text-ink-300">
                <span className="font-mono text-aiteb-orchid tabular">{indexLabel(i + 1, locale)}</span>
                {m.label}
              </dt>
              <dd className="mt-2 text-base font-semibold leading-snug text-white sm:text-lg break-words">{m.value}</dd>
              <dd className="mt-1 text-xs text-ink-300 sm:text-sm">{m.note}</dd>
            </div>
          ))}
        </dl>

        {(showPasses || showExhibition) && (
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center">
            {showPasses && (
              <a href="#passes" className={buttonClassName({ variant: "light", size: "xl", className: "press sm:min-w-[15rem] focus-visible:outline-aiteb-orchid" })}>
                <Bidi text={ctaLabel} />
                <Icon name="arrow-right" size={20} />
              </a>
            )}
            {showExhibition && (
              <a
                href="#exhibition"
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-surface-ink/30 px-6 text-[15px] font-semibold text-white backdrop-blur-sm transition-colors hover:border-white/30 hover:bg-white/[0.06] focus-visible:outline-aiteb-orchid"
              >
                <Icon name="booth" size={18} className="text-aiteb-orchid" />
                {c.ctaExhibition}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
