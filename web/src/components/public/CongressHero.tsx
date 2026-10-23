import type { ReactNode } from "react";
import type { PublicEvent } from "../../api/client";
import type { PageDoc, PageImage, PageImages } from "../../lib/pageDocument";
import { localized } from "../../lib/pageDocument";
import { bannerWidth, heroPresentation } from "../../lib/heroImage";
import { CongressSignature } from "../brand/CongressSignature";
import { buttonClassName } from "../ui/buttonStyles";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { indexLabel, num, proseDir, publicCopy, type PublicLocale } from "./copy";
import { calendarDays, congressTiming, formatDateRange, formatMoment, venueZoneNote } from "./format";
import { registrationSummary, tierAvailability, type RegistrationFields } from "../../lib/registrationWindow";
import { PageImg } from "./page/PageImg";
import { useNow } from "../attendee/useNow";
import { BELOW_HEADER_MIN_H } from "./viewport";

const STATUS_DOT = { open: "bg-[#3EE0A1]", opens: "bg-aiteb-orchid", full: "bg-status-warning-solid", closed: "bg-ink-400" } as const;

/** Tallest a banner may be: the rest of the hero (title, dates, buttons) still starts on the first screen. */
const BANNER_MAX_H = "min(60svh, 40rem)";
/** Cover on a phone: this much of the photograph stays clear above the text. */
const COVER_OPEN_BAND = "min(34svh, 18rem)";
/** An image frame breathes while its image is still on the way (PageImg `reveal` marks it data-loaded). */
const LOADING_PULSE = "motion-safe:has-[img[data-loaded=false]]:animate-pulse";

export type HeroEvent = Pick<PublicEvent, "name" | "slug" | "starts_at" | "ends_at" | "location" | "ticket_tiers"> &
  Omit<RegistrationFields, "ends_at"> & {
    /** The congress's IANA zone: dates and times are shown at the venue. */
    timezone?: string;
  };

interface CongressHeroProps {
  event: HeroEvent;
  locale: PublicLocale;
  /** The current time (ms), ticking in the page so "opens at" flips to "open" on its own. */
  now?: number;
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
 * Ink hero: the congress name leads, metadata set in columns. Four curated layouts: the generative
 * signature; a banner (the organizer's artwork whole, at its own proportions, above the title: posters
 * with text survive every screen); a full-bleed cover photograph under a legibility scrim, cropped around
 * its focal point, with an optional phone image; or a split with a framed image (above the title on small
 * screens). Each image layout renders exactly one hero <img>, revealed once decoded over a placeholder.
 * Status chips, dates and buttons always sit on ink, so organizer imagery cannot break their contrast.
 * Header plus hero fill at least one screen, and the type scale and vertical rhythm follow the viewport
 * height so title, meta and buttons fit above the fold where the layout allows.
 */
export function CongressHero({ event, locale, now: givenNow, hero, accent, images, logo, showPasses, exhibitionLabel }: CongressHeroProps) {
  const c = publicCopy[locale];
  const tick = useNow();
  const now = givenNow ?? tick;
  const tz = event.timezone;
  const timing = congressTiming(event.starts_at, event.ends_at, now, tz);
  // The registration window, tier sales windows, switches and quotas, decided as the reserve route does.
  const summary = registrationSummary(event, event.ticket_tiers, now);
  const status = summary.kind;
  const days = calendarDays(event.starts_at, event.ends_at, tz);
  const openTiers = event.ticket_tiers.filter((t) => tierAvailability(event, t, now).kind === "open").length;
  const zone = venueZoneNote(tz, event.starts_at);
  const { layout, image: cover, mobileImage, focus } = heroPresentation(hero, images);

  const title = localized(hero.title, locale) ?? event.name;
  const eyebrow = localized(hero.eyebrow, locale);
  const subtitle = localized(hero.subtitle, locale);
  const ctaLabel = localized(hero.cta_label, locale) ?? (status === "open" ? c.ctaReserve : c.ctaPasses);

  const statusLabel =
    summary.kind === "open"
      ? c.statusOpen
      : summary.kind === "opens"
        ? c.statusOpens(formatMoment(summary.at, locale, tz))
        : summary.kind === "full"
          ? c.statusFull
          : c.statusClosed;
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
    { label: c.metaDates, value: formatDateRange(event.starts_at, event.ends_at, locale, tz), note: c.dayCount(num(days, locale), days) },
    {
      label: c.metaSchedule,
      value: `${c.opens} ${formatMoment(event.starts_at, locale, tz)}`,
      note: `${c.closes} ${formatMoment(event.ends_at, locale, tz)}`,
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
        <span
          data-testid="registration-status"
          data-status={status}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold backdrop-blur-sm"
        >
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
    <section
      aria-labelledby="congress-title"
      data-hero-layout={layout}
      style={layout === "cover" ? { ["--pub-cover-band" as string]: COVER_OPEN_BAND } : undefined}
      className={`relative isolate flex flex-col overflow-hidden bg-surface-ink text-white ${BELOW_HEADER_MIN_H}`}
    >
      <CongressSignature
        seed={event.slug}
        accent={accent}
        tone="ink"
        animate
        className={`absolute inset-0 -z-30 size-full rtl:-scale-x-100 ${layout === "split" ? "opacity-60" : ""}`}
      />
      {layout === "cover" && cover ? (
        <>
          {/* The signature artwork underneath is the placeholder while the photograph loads. */}
          <PageImg
            image={cover}
            mobile={mobileImage}
            alt=""
            priority
            reveal
            // A phone image is composed for the phone: the focal point anchors the main image only.
            style={mobileImage ? { ["--hero-focus" as string]: focus } : { objectPosition: focus }}
            // Phones: the photograph fills the open band above the text and fades into the ink below it.
            className={`absolute inset-0 -z-20 size-full object-cover max-md:h-[calc(var(--pub-cover-band)+12rem)] ${
              mobileImage ? "md:[object-position:var(--hero-focus)]" : ""
            }`}
          />
          <div aria-hidden="true" className="pub-hero-scrim pub-hero-scrim--cover absolute inset-0 -z-10" />
        </>
      ) : (
        <>
          <div aria-hidden="true" className="pub-hero-grid absolute inset-0 -z-10 bg-meridian-ink" />
          <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />
        </>
      )}

      {/* Bottom padding clears the content sheet that overlaps the hero (pub-sheet: 2rem, 3.5rem from md). */}
      <div
        className={`mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-[clamp(1rem,3.5svh,3.5rem)] pb-[calc(2rem+clamp(1rem,3svh,2.5rem))] sm:px-6 md:pb-[calc(3.5rem+clamp(1rem,4svh,3rem))] lg:px-10 ${
          layout === "cover" ? "justify-end max-md:pt-[calc(var(--pub-cover-band)+1rem)] md:justify-center" : "justify-center"
        }`}
      >
        {layout === "banner" && cover ? (
          <>
            <figure
              className={`mx-auto mb-[clamp(1.25rem,4svh,2.5rem)] w-full overflow-hidden rounded-2xl bg-white/[0.06] shadow-pop ring-1 ring-white/12 sm:rounded-3xl ${LOADING_PULSE}`}
              style={{ maxWidth: bannerWidth(cover, BANNER_MAX_H) }}
            >
              <PageImg image={cover} alt="" priority reveal className="block h-auto w-full" />
            </figure>
            {heading}
          </>
        ) : layout === "split" && cover ? (
          <div className="grid grid-cols-1 items-center gap-6 sm:gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">{heading}</div>
            {/* Above the title on small screens (still the framed image, never a backdrop), beside it from lg. */}
            <figure className="relative order-first lg:order-none lg:col-span-5 motion-safe:animate-fade [animation-delay:160ms]">
              <div aria-hidden="true" className="absolute -inset-3 hidden rounded-[28px] border border-white/10 [border-start-end-radius:72px] lg:block" />
              <div
                className={`relative overflow-hidden rounded-2xl bg-white/[0.06] shadow-pop ring-1 ring-white/15 [border-start-end-radius:40px] lg:rounded-3xl lg:[border-start-end-radius:64px] ${LOADING_PULSE}`}
              >
                <PageImg
                  image={cover}
                  alt=""
                  priority
                  reveal
                  style={{ objectPosition: focus }}
                  className="block max-h-[min(22rem,36svh)] w-full object-cover lg:max-h-[min(30rem,46svh)]"
                />
              </div>
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
        {zone && (
          <p data-testid="venue-zone-note" className="mt-3 flex items-center gap-1.5 text-xs text-ink-300">
            <Icon name="clock" size={14} className="shrink-0 text-aiteb-orchid" />
            {c.zoneNote(zone)}
          </p>
        )}

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
