import type { ReactNode } from "react";
import type { PublicEvent } from "../../api/client";
import type { PageDoc, PageImage, PageImages } from "../../lib/pageDocument";
import { localized } from "../../lib/pageDocument";
import { bannerWidth, heroPresentation } from "../../lib/heroImage";
import { CongressSignature } from "../brand/CongressSignature";
import { LinkButton } from "../ui/Button";
import { buttonClassName } from "../ui/buttonStyles";
import { Icon } from "../ui/Icon";
import { Bidi } from "./Bidi";
import { num, proseDir, publicCopy, type PublicLocale } from "./copy";
import { calendarDays, congressTiming, formatDateRange, formatMoment, venueZoneLabel } from "./format";
import { registrationSummary, type RegistrationFields } from "../../lib/registrationWindow";
import { PageImg } from "./page/PageImg";
import { useNow } from "../attendee/useNow";
import { BELOW_HEADER_MIN_H } from "./viewport";

const STATUS_DOT = { open: "bg-status-success-solid", opens: "bg-aiteb-orchid", full: "bg-status-warning-solid", closed: "bg-ink-400" } as const;

/** Tallest a banner may be: the rest of the hero (title, dates, buttons) still starts on the first screen. */
const BANNER_MAX_H = "min(60svh, 40rem)";
/** Cover on a phone: this much of the photograph stays clear above the text. */
const COVER_OPEN_BAND = "min(34svh, 18rem)";
/** An image frame breathes while its image is still on the way (PageImg `reveal` marks it data-loaded). */
const LOADING_PULSE = "motion-safe:has-[img[data-loaded=false]]:animate-pulse";

/**
 * The hero's one primary action. `pass`: the visitor holds a pass (opens it); `reserve`: exactly one pass type is
 * open (one tap opens the reservation); `passes`: several are open (scrolls to them); `none`: nothing can be done now.
 */
export type HeroAction = { kind: "pass"; to: string } | { kind: "reserve"; onReserve: () => void } | { kind: "passes" } | { kind: "none" };

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
  /** The primary action; without it (the Page Studio preview) an open registration points at the passes. */
  action?: HeroAction;
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
export function CongressHero({ event, locale, now: givenNow, hero, accent, images, logo, showPasses, action: givenAction, exhibitionLabel }: CongressHeroProps) {
  const c = publicCopy[locale];
  const tick = useNow();
  const now = givenNow ?? tick;
  const tz = event.timezone;
  const timing = congressTiming(event.starts_at, event.ends_at, now, tz);
  // The registration window, tier sales windows, switches and quotas, decided as the reserve route does.
  const summary = registrationSummary(event, event.ticket_tiers, now);
  const status = summary.kind;
  const days = calendarDays(event.starts_at, event.ends_at, tz);
  const zone = venueZoneLabel(tz, event.starts_at, locale);
  const { layout, image: cover, mobileImage, focus } = heroPresentation(hero, images);

  const title = localized(hero.title, locale) ?? event.name;
  const eyebrow = localized(hero.eyebrow, locale);
  const subtitle = localized(hero.subtitle, locale);
  // The organizer's button text applies while a pass can be reserved; a held pass is always «کارت ورود من».
  const ctaLabel = localized(hero.cta_label, locale) ?? c.ctaReserve;
  const fallback: HeroAction = status === "open" && showPasses ? { kind: "passes" } : { kind: "none" };
  const action = givenAction ?? fallback;

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

  // Date and venue on every screen; the pass price from tablets up.
  const meta = [
    { label: c.metaDates, value: formatDateRange(event.starts_at, event.ends_at, locale, tz), note: c.dayCount(num(days, locale), days), wide: false },
    { label: c.metaVenue, value: <Bidi text={event.location} />, note: null, wide: false },
    { label: c.metaPasses, value: c.freeOfCharge, note: null, wide: true },
  ];

  const heading = (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {logo && (
          <span className="me-2 grid h-12 min-w-12 max-w-[11rem] place-items-center rounded-control bg-white px-2.5 py-1.5">
            <img src={logo.url} alt="" width={logo.width} height={logo.height} decoding="async" className="max-h-9 w-auto max-w-full object-contain" />
          </span>
        )}
        <span
          data-testid="registration-status"
          data-status={status}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/6 px-3 py-1.5 text-caption font-semibold backdrop-blur-sm"
        >
          <span aria-hidden="true" className="relative flex size-2">
            {status === "open" && <span className="absolute inset-0 rounded-full bg-status-success-solid motion-safe:animate-pulse-ring" />}
            <span className={`relative size-2 rounded-full ${STATUS_DOT[status]}`} />
          </span>
          {statusLabel}
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-ink/40 px-3 py-1.5 text-caption font-medium text-ink-200 backdrop-blur-sm">
          <Icon name={timing.kind === "live" ? "activity" : "calendar"} size={14} className="text-aiteb-orchid" />
          {timingLabel}
        </span>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {eyebrow && (
          <p className="text-meta font-semibold text-ink-300">
            <Bidi text={eyebrow} />
          </p>
        )}
        <h1 id="congress-title" className="pub-display max-w-[22ch] text-[clamp(2rem,min(4.5vw,6svh)+0.5rem,4.25rem)] text-white text-balance break-words">
          <Bidi text={title} />
        </h1>
        {subtitle && (
          <p {...proseDir(subtitle)} className="max-w-2xl whitespace-pre-line text-body leading-relaxed text-ink-100 sm:text-title-sm">
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
      className={`surface-ink relative isolate flex flex-col overflow-hidden bg-surface-ink text-white ${BELOW_HEADER_MIN_H}`}
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
        <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />
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
              className={`mx-auto mb-[clamp(1.25rem,4svh,2.5rem)] w-full overflow-hidden rounded-card bg-white/6 ring-1 ring-white/12 ${LOADING_PULSE}`}
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
            <figure className="order-first lg:order-none lg:col-span-5">
              <div className={`overflow-hidden rounded-card bg-white/6 ring-1 ring-white/15 ${LOADING_PULSE}`}>
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

        <dl className="mt-[clamp(1.25rem,4svh,3rem)] grid grid-cols-2 border-t border-white/12 sm:grid-cols-3">
          {meta.map((m, i) => (
            <div key={m.label} className={`min-w-0 py-3 pe-4 lg:py-4 lg:pe-8 ${i > 0 ? "border-s border-white/12 ps-4 lg:ps-8" : ""} ${m.wide ? "max-sm:hidden" : ""}`}>
              <dt className="text-caption font-medium text-ink-300">{m.label}</dt>
              <dd className="mt-1 text-body font-semibold leading-snug text-white break-words lg:text-title-sm">{m.value}</dd>
              {m.note && <dd className="mt-0.5 text-caption text-ink-300 sm:text-body-sm">{m.note}</dd>}
            </div>
          ))}
        </dl>
        {zone && (
          <p data-testid="venue-zone-note" className="mt-3 flex items-center gap-1.5 text-caption text-ink-300">
            <Icon name="clock" size={14} className="shrink-0 text-aiteb-orchid" />
            {c.zoneNote(zone)}
          </p>
        )}

        {(action.kind !== "none" || exhibitionLabel) && (
          <div className="mt-[clamp(1.25rem,3.5svh,2.5rem)] flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {action.kind === "pass" && (
              <LinkButton to={action.to} variant="primary" tone="ink" size="lg" icon="qr" data-testid="hero-cta" className="sm:min-w-[15rem]">
                {c.myPass}
              </LinkButton>
            )}
            {action.kind === "reserve" && (
              <button
                type="button"
                onClick={action.onReserve}
                data-testid="hero-cta"
                className={buttonClassName({ variant: "primary", tone: "ink", size: "lg", className: "sm:min-w-[15rem]" })}
              >
                <Bidi text={ctaLabel} />
                <Icon name="arrow-right" size={20} />
              </button>
            )}
            {action.kind === "passes" && (
              <a href="#passes" data-testid="hero-cta" className={buttonClassName({ variant: "primary", tone: "ink", size: "lg", className: "sm:min-w-[15rem]" })}>
                <Bidi text={ctaLabel} />
                <Icon name="arrow-right" size={20} />
              </a>
            )}
            {exhibitionLabel && (
              <a href="#exhibition" className={buttonClassName({ variant: "secondary", tone: "ink", size: "lg" })}>
                <Icon name="booth" size={18} />
                {exhibitionLabel}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
