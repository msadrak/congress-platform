import type { ReactNode } from "react";
import { PublicLayout } from "../layouts/PublicLayout";
import { LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { ArcMotif } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";

interface Environment {
  name: string;
  audience: string;
  route: string;
  icon: IconName;
  body: string;
  entry?: ReactNode;
  note?: string;
}

/** The six product environments, described by what they actually do. */
const ENVIRONMENTS: Environment[] = [
  {
    name: "Organizer console",
    audience: "Organizers",
    route: "/organizer",
    icon: "sliders",
    body: "An API-key workspace per organization: congresses, ticket tiers and quotas, check-in points with single-use, multi-entry or capped admission policies, exhibition booths, booth staff and desk operators. Live attendance analytics with CSV export.",
    entry: (
      <LinkButton to="/organizer" variant="light" size="lg">
        Open Organizer Console
        <Icon name="arrow-right" size={18} />
      </LinkButton>
    ),
  },
  {
    name: "Public congress page",
    audience: "Everyone with the link",
    route: "/e/:slug",
    icon: "congress",
    body: "Each congress gets its own registration page: passes with live remaining capacity, free reservation in a minute and an index of exhibitors with their profiles and brochures.",
    note: "Shared privately by each organizer; there is no public event directory.",
  },
  {
    name: "Attendee portal",
    audience: "Attendees",
    route: "/c/:slug",
    icon: "ticket",
    body: "A personal QR pass that stays available offline, saved exhibition booths and direct contact exchange with fellow attendees, with standard vCard download.",
    entry: (
      <div className="flex flex-wrap gap-2">
        <LinkButton to="/my-tickets" variant="secondary" size="md">
          My Tickets & Passes
        </LinkButton>
        <LinkButton to="/my-network" variant="ghost" size="md">
          Networking Hub
        </LinkButton>
      </div>
    ),
  },
  {
    name: "Reception desk",
    audience: "Front-desk operators",
    route: "/reception",
    icon: "id-card",
    body: "Operator sign-in per congress, fast attendee search, pass review and printing, and walk-in registration that offers the existing pass instead of issuing a duplicate.",
    entry: (
      <LinkButton to="/reception" variant="secondary" size="md">
        Open Reception Desk
        <Icon name="arrow-right" size={16} />
      </LinkButton>
    ),
  },
  {
    name: "Gate scanner",
    audience: "Gate staff",
    route: "/scan/:pointId",
    icon: "scan",
    body: "A paired device per check-in point reading badges by camera or USB barcode reader. The gate manifest lives on the device and scans are buffered offline, then synced when the network returns.",
    note: "Devices are paired by the organizer for a single check-in point.",
  },
  {
    name: "Exhibitor workspace",
    audience: "Booth staff",
    route: "/booth/:id",
    icon: "booth",
    body: "Booth representatives capture attendee badges as leads, qualify them Hot, Warm or Cold, add tags and private notes, and export their own CSV. Each booth sees only its own leads.",
    note: "Booth staff receive private access links from the organizer.",
  },
];

const PHASES = [
  {
    phase: "Pre-event",
    title: "Setup & direct registration",
    body: "Organizers configure ticket tiers with strict quota caps, admission policies and the exhibition booth roster.",
    points: ["Private direct links for attendee registration", "Instant QR pass generation", "Exhibition booth profiles & brochures"],
  },
  {
    phase: "At the doors",
    title: "Gate scanning & front desk",
    body: "Attendance is verified at the gates by camera or handheld USB scanner while the front desk issues walk-in passes in seconds.",
    points: ["Local scan buffering for unstable venue networks", "Rapid walk-in search with printable passes", "Live analytics with 10-second refresh & CSV export"],
  },
  {
    phase: "On the floor",
    title: "Leads & peer networking",
    body: "Exhibitors qualify visitor leads with ratings and private notes; attendees exchange contacts directly through their badges.",
    points: ["Isolated exhibitor portals with CSV export", "Hot, Warm and Cold lead qualification", "Private notes & standard vCard (.vcf) download"],
  },
];

const PRINCIPLES = [
  {
    title: "High-contrast legibility",
    body: "Passes render as black modules on an opaque white plate with a verified quiet zone, so badges scan reliably under harsh hall lighting or on dimmed phone screens.",
  },
  {
    title: "Network-aware scan buffering",
    body: "Gate check-in evaluates the attendee manifest locally and buffers scans, keeping entry lines moving through temporary venue network dropouts.",
  },
  {
    title: "Strict multi-tenant separation",
    body: "Organizers are partitioned by their API credentials, and competing exhibitor teams are isolated so each company only ever sees its own captured leads.",
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

export default function Home() {
  return (
    <PublicLayout>
      {/* 1. Hero */}
      <section className="relative isolate overflow-hidden border-b border-border-default bg-surface-panel">
        <div aria-hidden="true" className="pub-landing-glow absolute inset-0 -z-10" />
        <div aria-hidden="true" className="pub-landing-grid absolute inset-0 -z-10 bg-meridian" />
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24 lg:grid-cols-12 lg:gap-10 lg:px-10 lg:pt-24 lg:pb-28">
          <div className="space-y-8 lg:col-span-7 motion-safe:animate-rise">
            <p className="eyebrow">Congress platform by AIteb</p>
            <h1 className="text-[clamp(2.5rem,5.6vw,4.75rem)] font-[680] leading-[1.0] tracking-[-0.037em] text-text-primary">
              The operating system for <span className="text-gradient-aiteb">academic & industry congresses</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-text-secondary sm:text-xl">
              Fast walk-in registration, reliable badge check-in, exhibition lead capture and attendee networking —
              engineered for the physical reality of busy conference venues.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <LinkButton to="/organizer" variant="primary" size="xl" className="press">
                Organizer Console
                <Icon name="arrow-right" size={20} />
              </LinkButton>
              <LinkButton to="/my-tickets" variant="secondary" size="xl">
                <Icon name="ticket" size={20} />
                Attendee Pass Portal
              </LinkButton>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border-default pt-6 text-sm text-text-secondary">
              {["Multi-tenant event workspaces", "High-contrast badge scanning", "Isolated exhibitor leads"].map((s) => (
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
              <p className="text-xs font-medium text-ink-300">One congress</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.02em]">Six connected environments</p>
              <ol className="mt-6 divide-y divide-white/10 border-y border-white/10">
                {ENVIRONMENTS.map((env, i) => (
                  <li key={env.name} className="flex items-center gap-4 py-3">
                    <span className="w-6 font-mono text-xs text-aiteb-orchid tabular">{pad(i + 1)}</span>
                    <Icon name={env.icon} size={18} className="text-ink-300" />
                    <span className="flex-1 text-sm font-medium">{env.name}</span>
                    <span className="hidden font-mono text-[11px] text-ink-400 sm:inline">{env.route}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-xs leading-relaxed text-ink-300">
                Organizer, attendee, reception, gate and exhibitor views share one source of truth per congress.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Role environments */}
      <section id="roles" aria-labelledby="roles-heading" className="scroll-mt-20 bg-surface-page py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <div className="reveal grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="space-y-4 lg:col-span-7">
              <p className="flex items-center gap-3">
                <span className="pub-index">01</span>
                <span className="text-xs font-semibold text-text-muted">Role entry</span>
              </p>
              <h2 id="roles-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-5xl">
                Six environments, one congress
              </h2>
            </div>
            <p className="text-base leading-relaxed text-text-secondary lg:col-span-5">
              Every role works in an interface calibrated for its task density, device and trust boundary — from the
              organizer’s desk to a phone at the gate.
            </p>
          </div>

          <div className="reveal mt-12 grid overflow-hidden rounded-[28px] border border-border-default bg-border-default gap-px md:grid-cols-2 lg:grid-cols-3 [border-start-end-radius:56px]">
            {ENVIRONMENTS.map((env, i) => {
              const lead = i === 0;
              return (
                <article
                  key={env.name}
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
                    <p className={`font-mono text-xs ${lead ? "text-ink-300" : "text-text-muted"}`}>{env.route}</p>
                  </div>
                  <p className={`max-w-xl text-sm leading-relaxed ${lead ? "text-ink-200" : "text-text-secondary"}`}>{env.body}</p>
                  <div className="mt-auto pt-2">
                    {env.entry ?? (
                      <p className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                        <Icon name="lock" size={14} className="mt-0.5" />
                        {env.note}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
            <aside className="flex flex-col justify-between gap-6 bg-aiteb-lavender p-6 sm:p-8">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-aiteb-indigo">Looking to register for a specific congress?</p>
                <p className="text-sm leading-relaxed text-text-secondary">
                  Registration is private to each congress. Open the link your organizer shared (for example{" "}
                  <code className="rounded border border-action-subtle-border bg-white px-1.5 py-0.5 text-xs text-aiteb-indigo">/e/:slug</code>)
                  to reserve a free pass.
                </p>
              </div>
              <LinkButton to="/my-tickets" variant="outline" size="md" className="self-start">
                View My Passes
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
              <span className="pub-index">02</span>
              <span className="text-xs font-semibold text-text-muted">Event lifecycle</span>
            </p>
            <h2 id="capabilities-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-5xl">
              Built for every phase of your congress
            </h2>
            <p className="text-base leading-relaxed text-text-secondary sm:text-lg">
              From tier configuration to gate throughput and exhibitor lead capture, each phase connects in one clean
              workflow.
            </p>
          </div>

          <ol className="reveal relative mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
            <div aria-hidden="true" className="absolute inset-x-0 top-[22px] hidden h-px bg-[image:var(--grad-aiteb)] opacity-50 md:block" />
            {PHASES.map((p, i) => (
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
              <span className="pub-index">03</span>
              <span className="text-xs font-semibold text-ink-300">Venue engineering</span>
            </p>
            <h2 id="architecture-heading" className="text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
              Engineered for the physical reality of conferences
            </h2>
            <p className="text-base leading-relaxed text-ink-200 sm:text-lg">
              Venues bring spotty wireless, harsh overhead lighting and strict competitor boundaries. The platform is
              designed around all three.
            </p>
          </div>
          <div className="reveal mt-14 grid border-t border-white/12 md:grid-cols-3">
            {PRINCIPLES.map((p, i) => (
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
                Ready to run your congress or symposium?
              </h2>
              <p className="text-base leading-relaxed text-text-secondary">
                Open the organizer console to set up your event, configure ticket quotas and follow live gate
                attendance.
              </p>
            </div>
            <LinkButton to="/organizer" variant="ink" size="xl" className="press w-full shrink-0 whitespace-normal sm:w-auto">
              Open Organizer Console
              <Icon name="arrow-right" size={20} />
            </LinkButton>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
