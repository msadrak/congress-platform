import type { PublicEvent } from "../../api/client";
import { CongressSignature } from "../brand/CongressSignature";
import { buttonClassName } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { num, publicCopy, type PublicLocale } from "./copy";
import { calendarDays, congressTiming, formatDateRange, formatMoment, registrationStatus, tierState } from "./format";

const STATUS_DOT = { open: "bg-[#3EE0A1]", full: "bg-status-warning-solid", closed: "bg-ink-400" } as const;

/** Ink hero: the congress name leads over its generative signature, metadata set in columns. */
export function CongressHero({ event, locale }: { event: PublicEvent; locale: PublicLocale }) {
  const c = publicCopy[locale];
  const status = registrationStatus(event.ticket_tiers);
  const timing = congressTiming(event.starts_at, event.ends_at);
  const days = calendarDays(event.starts_at, event.ends_at);
  const openTiers = event.ticket_tiers.filter((t) => tierState(t) === "AVAILABLE").length;

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
    { label: c.metaVenue, value: event.location, note: c.onSite, wide: true },
    {
      label: c.metaPasses,
      value: openTiers > 0 ? c.passesOpen(num(openTiers, locale), num(event.ticket_tiers.length, locale)) : c.passesNone,
      note: c.freeOfCharge,
      wide: false,
    },
  ];

  return (
    <section aria-labelledby="congress-title" className="relative isolate overflow-hidden bg-surface-ink text-white">
      <CongressSignature seed={event.slug} tone="ink" animate className="absolute inset-0 -z-20 size-full rtl:-scale-x-100" />
      <div aria-hidden="true" className="pub-hero-grid absolute inset-0 -z-10 bg-meridian-ink" />
      <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />

      <div className="mx-auto flex max-w-7xl flex-col px-4 pt-10 pb-24 sm:px-6 sm:pt-16 sm:pb-32 lg:min-h-[640px] lg:px-10 lg:pt-20 lg:pb-36">
        <div className="motion-safe:animate-rise space-y-6 sm:space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold">
              <span aria-hidden="true" className="relative flex size-2">
                {status === "open" && <span className="absolute inset-0 rounded-full bg-[#3EE0A1] motion-safe:animate-pulse-ring" />}
                <span className={`relative size-2 rounded-full ${STATUS_DOT[status]}`} />
              </span>
              {statusLabel}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-ink-200">
              <Icon name={timing.kind === "live" ? "activity" : "calendar"} size={14} className="text-aiteb-orchid" />
              {timingLabel}
            </span>
          </div>

          <div className="space-y-4">
            <p className="eyebrow text-ink-300">{c.officialRegistration}</p>
            <h1
              id="congress-title"
              className="pub-display max-w-[16ch] text-[clamp(2.4rem,8.4vw,6.75rem)] text-white break-words"
            >
              {event.name}
            </h1>
          </div>
        </div>

        <dl className="mt-10 grid grid-cols-2 border-t border-white/12 sm:mt-14 lg:grid-cols-4 motion-safe:animate-fade [animation-delay:240ms]">
          {meta.map((m, i) => (
            <div
              key={m.label}
              className={`min-w-0 border-b border-white/12 py-5 pe-4 lg:border-b-0 lg:pe-8 ${
                m.wide ? "col-span-2 lg:col-span-1" : ""
              } ${i > 0 ? "lg:border-s lg:ps-8" : ""} ${i === 1 ? "border-s border-white/12 ps-4 lg:ps-8" : ""}`}
            >
              <dt className="flex items-center gap-2 text-[11px] font-medium text-ink-300">
                <span className="font-mono text-aiteb-orchid tabular">{num(i + 1, locale).padStart(2, locale === "fa" ? "۰" : "0")}</span>
                {m.label}
              </dt>
              <dd className="mt-2 text-base font-semibold leading-snug text-white sm:text-lg break-words">{m.value}</dd>
              <dd className="mt-1 text-xs text-ink-300 sm:text-sm">{m.note}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center">
          <a href="#passes" className={buttonClassName({ variant: "light", size: "xl", className: "press sm:min-w-[15rem] focus-visible:outline-aiteb-orchid" })}>
            {status === "open" ? c.ctaReserve : c.ctaPasses}
            <Icon name="arrow-right" size={20} />
          </a>
          <a
            href="#exhibition"
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-white/15 px-6 text-[15px] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.06] focus-visible:outline-aiteb-orchid"
          >
            <Icon name="booth" size={18} className="text-aiteb-orchid" />
            {c.ctaExhibition}
          </a>
        </div>
      </div>
    </section>
  );
}
