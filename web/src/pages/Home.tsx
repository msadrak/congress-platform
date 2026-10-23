import type { ReactNode } from "react";
import { PublicLayout } from "../layouts/PublicLayout";
import { LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { AITEB_NAME, ArcMotif } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";

import { indexLabel, usePublicLocale, type PublicLocale } from "../components/public/copy";
import { homeCopy, type EnvironmentCopy } from "../components/public/homeCopy";
import { BELOW_HEADER_MIN_H } from "../components/public/viewport";
import { PublicEventList } from "../components/public/PublicEventList";
import { usePageTitle } from "../hooks/usePageTitle";

type HomeCopy = (typeof homeCopy)[PublicLocale];

/** Entry actions that exist for an environment; the rest show how access is granted. */
function environmentEntry(key: EnvironmentCopy["key"], h: HomeCopy): ReactNode {
  switch (key) {
    case "organizer":
      return (
        <LinkButton to="/organizer" variant="light" size="lg">
          {h.openOrganizer}
          <Icon name="arrow-right" size={18} />
        </LinkButton>
      );
    case "attendee":
      return (
        <div className="flex flex-wrap gap-2">
          <LinkButton to="/me" variant="secondary" size="md">
            {h.myPasses}
          </LinkButton>
        </div>
      );
    case "reception":
      return (
        <LinkButton to="/reception" variant="secondary" size="md">
          {h.openReception}
          <Icon name="arrow-right" size={16} />
        </LinkButton>
      );
    default:
      return null;
  }
}

export default function Home() {
  const { locale, setLocale } = usePublicLocale();
  const h = homeCopy[locale];
  const pad = (n: number) => indexLabel(n, locale);
  usePageTitle(locale === "fa" ? "سامانهٔ همایش" : "Congress platform");
  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale}>
      {/* 1. Hero: header plus hero fill one screen on desktop; type and rhythm follow the viewport height. */}
      <section className="relative isolate overflow-hidden border-b border-border-default bg-surface-panel">
        <div aria-hidden="true" className="pub-landing-glow absolute inset-0 -z-10" />
        <div aria-hidden="true" className="pub-landing-grid absolute inset-0 -z-10 bg-meridian" />
        <div
          className={`mx-auto grid max-w-7xl items-center gap-12 px-4 py-[clamp(1.5rem,4svh,3.5rem)] sm:px-6 lg:grid-cols-12 lg:gap-10 lg:px-10 lg:py-[clamp(1.5rem,5svh,4.5rem)] ${BELOW_HEADER_MIN_H}`}
        >
          <div className="space-y-5 lg:col-span-7 lg:space-y-6 motion-safe:animate-rise">
            <p className="eyebrow">
              <span>
                {h.eyebrowLead}{" "}
                <bdi dir="ltr" lang="en" className="normal-case">
                  {AITEB_NAME}
                </bdi>
              </span>
            </p>
            <h1 className="text-[clamp(2.25rem,min(4.2vw,6.5svh)+0.5rem,4.25rem)] font-[680] leading-[1.0] tracking-[-0.037em] max-sm:tracking-[-0.022em] text-text-primary text-balance rtl:font-[800] rtl:leading-[1.3] rtl:text-[clamp(2rem,min(3.8vw,5.5svh)+0.5rem,3.75rem)]">
              {h.titleLead} <span className="text-gradient-aiteb rtl:pb-2 rtl:[-webkit-box-decoration-break:clone]">{h.titleAccent}</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-text-secondary">
              {h.lead}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton to="/organizer" variant="primary" size="xl" className="press">
                {h.ctaOrganizer}
                <Icon name="arrow-right" size={20} />
              </LinkButton>
              {/* Attendees landing here from a pass link or search find their pass by mobile number. */}
              <LinkButton to="/sign-in" variant="secondary" size="xl">
                <Icon name="ticket" size={20} />
                {h.ctaAttendee}
              </LinkButton>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border-default pt-6 text-sm text-text-secondary">
              {h.highlights.map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <Icon name="check" size={16} className="text-aiteb-indigo" />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          {/* Instrument: the six environments of one congress */}
          <div className="lg:col-span-5 motion-safe:animate-pop [animation-delay:120ms]">
            <div className="relative isolate overflow-hidden bg-surface-ink p-6 text-white shadow-pop shape-arc-lg sm:p-8">
              <CongressSignature seed="aiteb-congress-platform" tone="ink" animate className="absolute inset-0 -z-20 size-full opacity-90" />
              <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-surface-ink via-surface-ink/85 to-surface-ink/30" />
              <p className="text-xs font-medium text-ink-300">{h.panelEyebrow}</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.02em]">{h.panelTitle}</p>
              <ol className="mt-6 divide-y divide-white/10 border-y border-white/10">
                {h.environments.map((env, i) => (
                  <li key={env.key} className="flex items-center gap-4 py-3">
                    <span className="w-6 font-mono text-xs text-aiteb-orchid tabular">{pad(i + 1)}</span>
                    <Icon name={env.icon} size={18} className="text-ink-300" />
                    <span className="flex-1 text-sm font-medium">{env.name}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-xs leading-relaxed text-ink-300">
                {h.panelNote}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Listed congresses (renders nothing while none is listed). */}
      <div id="congresses" className="hidden scroll-mt-20 bg-surface-page has-[section]:block">
        <div className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 sm:pt-28 lg:px-10">
          <PublicEventList locale={locale} />
        </div>
      </div>

      {/* 2. Role environments */}
      <section id="roles" aria-labelledby="roles-heading" className="scroll-mt-20 bg-surface-page py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="reveal grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="space-y-4 lg:col-span-7">
              <p className="flex items-center gap-3">
                <span className="pub-index">{pad(1)}</span>
                <span className="text-xs font-semibold text-text-muted">{h.rolesEyebrow}</span>
              </p>
              <h2 id="roles-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-5xl">
                {h.rolesTitle}
              </h2>
            </div>
            <p className="text-base leading-relaxed text-text-secondary lg:col-span-5">
              {h.rolesLead}
            </p>
          </div>

          <div className="reveal mt-12 grid overflow-hidden rounded-[28px] border border-border-default bg-border-default gap-px md:grid-cols-2 lg:grid-cols-3 [border-start-end-radius:56px]">
            {h.environments.map((env, i) => {
              const lead = i === 0;
              const entry = environmentEntry(env.key, h);
              return (
                <article
                  key={env.key}
                  className={`relative isolate flex flex-col gap-5 overflow-hidden p-6 sm:p-8 ${
                    lead ? "bg-surface-ink text-white md:col-span-2" : "bg-surface-panel"
                  } ${i === 5 ? "lg:col-span-2" : ""}`}
                >
                  {lead && (
                    <>
                      <CongressSignature seed="aiteb-organizer" tone="ink" className="absolute inset-0 -z-20 size-full opacity-80" />
                      <div aria-hidden="true" className="pub-hero-scrim absolute inset-0 -z-10" />
                    </>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <span
                      className={`grid size-12 place-items-center rounded-xl [border-start-end-radius:20px] ${
                        lead ? "bg-white/10 text-aiteb-orchid" : "bg-aiteb-lavender text-aiteb-indigo"
                      }`}
                    >
                      <Icon name={env.icon} size={24} />
                    </span>
                    <span className={`font-mono text-xs tabular ${lead ? "text-ink-300" : "text-text-muted"}`}>{pad(i + 1)}</span>
                  </div>
                  <div className="space-y-2">
                    <p className={`text-xs font-semibold ${lead ? "text-aiteb-orchid" : "text-aiteb-indigo"}`}>{env.audience}</p>
                    <h3 className={`text-2xl font-semibold tracking-[-0.02em] ${lead ? "text-white" : "text-text-primary"}`}>{env.name}</h3>
                  </div>
                  <p className={`max-w-xl text-sm leading-relaxed ${lead ? "text-ink-200" : "text-text-secondary"}`}>{env.body}</p>
                  <div className="mt-auto pt-2">
                    {entry ?? (
                      <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                        <Icon name="lock" size={14} className="mt-0.5" />
                        {"note" in env ? env.note : null}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
            <aside className="flex flex-col justify-between gap-6 bg-aiteb-lavender p-6 sm:p-8">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-aiteb-indigo">{h.registerTitle}</p>
                <p className="text-sm leading-relaxed text-text-secondary">{h.registerBody}</p>
              </div>
              <LinkButton to="/me" variant="outline" size="md" className="self-start">
                {h.viewMyPasses}
                <Icon name="arrow-right" size={16} />
              </LinkButton>
            </aside>
          </div>
        </div>
      </section>

      {/* 3. Lifecycle */}
      <section id="capabilities" aria-labelledby="capabilities-heading" className="scroll-mt-20 border-y border-border-default bg-surface-panel py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="reveal max-w-3xl space-y-4">
            <p className="flex items-center gap-3">
              <span className="pub-index">{pad(2)}</span>
              <span className="text-xs font-semibold text-text-muted">{h.lifecycleEyebrow}</span>
            </p>
            <h2 id="capabilities-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-5xl">
              {h.lifecycleTitle}
            </h2>
            <p className="text-base leading-relaxed text-text-secondary sm:text-lg">
              {h.lifecycleLead}
            </p>
          </div>

          <ol className="reveal relative mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
            <div aria-hidden="true" className="absolute inset-x-0 top-[22px] hidden h-px bg-[image:var(--grad-aiteb)] opacity-50 md:block" />
            {h.phases.map((p, i) => (
              <li key={p.phase} className="relative space-y-5">
                <div className="flex items-center gap-4">
                  <span className="relative grid size-11 place-items-center rounded-full border border-action-subtle-border bg-surface-panel font-mono text-sm text-aiteb-indigo shadow-soft">
                    {pad(i + 1)}
                  </span>
                  <span className="relative bg-surface-panel pe-3 text-xs font-semibold text-text-muted">{p.phase}</span>
                </div>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-text-primary">{p.title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{p.body}</p>
                <ul className="space-y-2.5 border-t border-border-subtle pt-5">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-sm text-text-secondary">
                      <Icon name="check" size={16} className="mt-0.5 text-aiteb-indigo" />
                      {pt}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4. Venue engineering */}
      <section id="architecture" aria-labelledby="architecture-heading" className="relative isolate scroll-mt-20 overflow-hidden bg-surface-ink py-20 text-white [--event-accent:var(--aiteb-orchid)] sm:py-28">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />
        <ArcMotif weight={5} className="pointer-events-none absolute -end-20 -top-24 -z-10 size-[16rem] opacity-25 sm:size-[22rem]" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="reveal max-w-3xl space-y-4">
            <p className="flex items-center gap-3">
              <span className="pub-index">{pad(3)}</span>
              <span className="text-xs font-semibold text-ink-300">{h.venueEyebrow}</span>
            </p>
            <h2 id="architecture-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
              {h.venueTitle}
            </h2>
            <p className="text-base leading-relaxed text-ink-200 sm:text-lg">
              {h.venueLead}
            </p>
          </div>
          <div className="reveal mt-14 grid border-t border-white/12 md:grid-cols-3">
            {h.principles.map((p, i) => (
              <div key={p.title} className={`space-y-3 border-b border-white/12 py-8 md:border-b-0 md:py-10 ${i > 0 ? "md:border-s md:ps-8" : ""} md:pe-8`}>
                <span className="font-mono text-xs text-aiteb-orchid tabular">{pad(i + 1)}</span>
                <h3 className="text-xl font-semibold tracking-[-0.015em]">{p.title}</h3>
                <p className="text-sm leading-relaxed text-ink-300">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Closing */}
      <section className="bg-surface-page py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="reveal flex flex-col items-start justify-between gap-8 border border-border-default bg-surface-panel p-6 shadow-soft shape-arc-lg sm:p-12 lg:flex-row lg:items-center">
            <div className="max-w-2xl space-y-3">
              <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-text-primary sm:text-4xl">
                {h.closingTitle}
              </h2>
              <p className="text-base leading-relaxed text-text-secondary">
                {h.closingLead}
              </p>
            </div>
            <LinkButton to="/organizer" variant="ink" size="xl" className="press w-full shrink-0 whitespace-normal sm:w-auto">
              {h.openOrganizer}
              <Icon name="arrow-right" size={20} />
            </LinkButton>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
