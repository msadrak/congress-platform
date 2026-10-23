import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QRCode from "react-qr-code";
import type { AccessEvent, AttendeeTicketDetail, PublicEvent } from "../../api/client";
import { countdownParts, homePhase, type HomePhase } from "../../lib/congressPhase";
import { codeFontClass, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { congressPath } from "../../lib/congressContext";
import { mapSearchLinks } from "../../lib/eventLinks";
import { CongressSignature } from "../brand/CongressSignature";
import { downloadCalendarFile } from "../public/calendarDownload";
import { MapLinks } from "../public/EventActions";
import { Badge } from "../ui/Badge";
import { LinkButton } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { LoadingBlock, StatusPanel } from "../ui/PortalState";
import { contactsPhrase, homeCopy, n } from "./attendeeCopy";
import { CongressHero } from "./CongressHero";
import { NowNextSessions, UpcomingSessions } from "./CongressSchedule";
import { sectionIndex } from "./congressTime";
import type { PanelLabels, PanelPage } from "./panelContent";
import { useNow } from "./useNow";

export type HomePass = Pick<AttendeeTicketDetail, "id" | "ticket_tier_name" | "attendee_name" | "status" | "qr_secret">;

/** What the signed-in attendee holds for this congress. */
export interface HomeOverview {
  /** Every pass for this congress (usually one), active or not. */
  tickets: HomePass[];
  fromCache: boolean;
  connectionCount: number | null;
  otherCongresses: Pick<AccessEvent, "event_id" | "event_slug" | "event_name">[];
}

export type HomePersonal =
  | { status: "signed-out"; signInTo: string }
  | { status: "loading" }
  | { status: "ready"; overview: HomeOverview };

interface CongressHomeViewProps {
  event: PublicEvent;
  page: PanelPage;
  labels: PanelLabels;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  personal: HomePersonal;
  /** The booth directory (live, or fed with preview data); rendered when the exhibitors section is visible. */
  booths: (index: string) => ReactNode;
}

const card = "relative flex flex-col gap-5 overflow-hidden rounded-[var(--radius-xl)] border border-border-default bg-surface-panel p-6 shadow-soft sm:p-8 reveal";

function ModuleIndex({ value }: { value: string }) {
  return (
    <span aria-hidden="true" className={`flex items-center gap-2 ${codeFontClass(value)} text-xs font-medium text-text-muted tabular`}>
      {value}
      <span className="h-px w-6 bg-border-strong" />
    </span>
  );
}

function ModuleHeading({ index, id, children }: { index: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <ModuleIndex value={index} />
      <h2 id={id} className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">
        {children}
      </h2>
    </div>
  );
}

function OfflineNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 self-start rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs font-semibold text-status-warning-text">
      <Icon name="wifi-off" size={15} className="mt-px" />
      {text}
    </p>
  );
}

/** Before the congress: days / hours / minutes until the opening, in words beside the digits. */
function Countdown({ phase, locale }: { phase: Extract<HomePhase, { kind: "before" }>; locale: AttendeeLocale }) {
  const c = homeCopy[locale];
  const parts = countdownParts(phase.msLeft);
  const cells: [number, string][] = [
    [parts.days, c.units.days],
    [parts.hours, c.units.hours],
    [parts.minutes, c.units.minutes],
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface-ink p-5 text-white shadow-lift [border-start-end-radius:var(--radius-arc)] sm:p-6">
      <div aria-hidden="true" className="bg-meridian-ink absolute inset-0 opacity-60" />
      <p className="relative text-xs font-semibold text-ink-300">{phase.daysLeft === 0 ? c.countdownStartsToday : c.countdownTitle}</p>
      <p className="relative mt-3 grid grid-cols-3 gap-3" role="timer" aria-live="off">
        {cells.map(([value, unit]) => (
          <span key={unit} className="flex flex-col gap-1">
            <span className="text-4xl font-semibold leading-none tracking-[-0.04em] tabular sm:text-5xl">{n(value, locale)}</span>
            <span className="text-xs font-medium text-ink-300">{unit}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

const checklistRow =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-sm font-semibold text-text-primary transition-colors hover:bg-surface-panel-subtle cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function ChecklistIcon({ name, done = false }: { name: IconName; done?: boolean }) {
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-xl ${done ? "bg-status-success-bg text-status-success-text" : "bg-event-accent-soft text-event-accent"}`}>
      <Icon name={done ? "check" : name} size={18} />
    </span>
  );
}

/** Before the congress: calendar, directions and the add-to-home-screen hint. */
function Checklist({ event, locale }: { event: PublicEvent; locale: AttendeeLocale }) {
  const c = homeCopy[locale];
  const [calendarDone, setCalendarDone] = useState(false);
  const hasAddress = mapSearchLinks(event.location).length > 0;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text-secondary">{c.checklistTitle}</h3>
      <ul className="divide-y divide-border-subtle rounded-2xl border border-border-default">
        <li className="p-1">
          <button
            type="button"
            className={checklistRow}
            onClick={() => {
              downloadCalendarFile(event);
              setCalendarDone(true);
            }}
          >
            <ChecklistIcon name="calendar" done={calendarDone} />
            <span className="flex-1">{c.checklistCalendar}</span>
            {calendarDone && <span className="text-xs font-medium text-status-success-text">{c.checklistCalendarDone}</span>}
          </button>
        </li>
        {hasAddress && (
          <li className="p-1">
            <details className="group">
              <summary className={`${checklistRow} list-none [&::-webkit-details-marker]:hidden`}>
                <ChecklistIcon name="pin" />
                <span className="flex-1">{c.checklistDirections}</span>
                <Icon name="chevron-down" size={16} className="text-text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-3 px-3 pt-1 pb-3">
                <p dir="auto" className="text-sm text-text-secondary break-words">{event.location}</p>
                <MapLinks query={event.location} locale={locale} />
              </div>
            </details>
          </li>
        )}
        <li className="p-1">
          <details className="group">
            <summary className={`${checklistRow} list-none [&::-webkit-details-marker]:hidden`}>
              <ChecklistIcon name="smartphone" />
              <span className="flex-1">{c.checklistInstall}</span>
              <span className="text-xs font-medium text-action-primary">{c.installHow}</span>
            </summary>
            <div className="space-y-2 px-3 pt-1 pb-3 text-sm leading-relaxed text-text-secondary">
              <p className="font-medium text-text-primary">{c.installWhy}</p>
              <p>{c.installIos}</p>
              <p>{c.installAndroid}</p>
            </div>
          </details>
        </li>
      </ul>
    </div>
  );
}

/** Every pass for the congress: type, holder and whether it is valid. */
function PassList({ passes, locale, t }: { passes: HomePass[]; locale: AttendeeLocale; t: TranslationDictionary }) {
  const c = homeCopy[locale];
  return (
    <ul className="space-y-3">
      {passes.map((pass) => (
        <li key={pass.id} className="rounded-2xl border border-border-subtle bg-surface-panel-subtle p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="min-w-0 space-y-1">
              <dt className="text-xs font-medium text-text-muted">{t.tierLabel}</dt>
              <dd className="font-semibold text-text-primary break-words">{pass.ticket_tier_name}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-xs font-medium text-text-muted">{c.holder}</dt>
              <dd className="font-semibold text-text-primary break-words">{pass.attendee_name}</dd>
            </div>
          </dl>
          <p className="mt-3">
            <Badge variant={pass.status === "active" ? "success" : "neutral"} size="sm" dot>
              {pass.status === "active" ? c.statusActive : c.statusInactive}
            </Badge>
          </p>
        </li>
      ))}
    </ul>
  );
}

function NoPass({ slug, locale, offline, offerReserve }: { slug: string; locale: AttendeeLocale; offline: boolean; offerReserve: boolean }) {
  const c = homeCopy[locale];
  if (offline) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-secondary">
        <Icon name="wifi-off" size={18} className="text-ink-400" />
        {c.notOffline}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm leading-relaxed text-text-secondary">{c.noPass}</p>
      {offerReserve && (
        <LinkButton to={`/e/${slug}`} variant="primary" size="lg" className="self-stretch sm:self-start">
          <Icon name="ticket" size={18} />
          {c.reservePass}
        </LinkButton>
      )}
    </>
  );
}

/** During the congress: the pass QR right at the top; a tap opens the full pass. */
function LivePass({ passes, slug, locale, offline }: { passes: HomePass[]; slug: string; locale: AttendeeLocale; offline: boolean }) {
  const c = homeCopy[locale];
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {passes.map((pass) => (
        <li key={pass.id}>
          <Link
            to={congressPath(slug, "my-ticket")}
            aria-label={`${c.showPass}: ${pass.ticket_tier_name}`}
            className="press group flex items-center gap-4 rounded-2xl bg-surface-ink p-4 text-white shadow-lift transition-[filter] hover:brightness-110 [border-start-end-radius:var(--radius-arc)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid sm:p-5"
          >
            <span className="shrink-0 rounded-xl bg-white p-2.5">
              <QRCode value={pass.qr_secret} size={132} level="M" aria-hidden="true" />
            </span>
            <span className="min-w-0 space-y-2">
              <span className="block text-xs font-semibold text-ink-300">{c.passAtGate}</span>
              <span className="block text-lg font-semibold leading-snug break-words">{pass.ticket_tier_name}</span>
              <span className="block text-sm text-ink-200 break-words">{pass.attendee_name}</span>
              <span className="flex items-center gap-1.5 text-xs font-medium text-aiteb-orchid">
                {c.tapForPass}
                <Icon name="arrow-right" size={14} className="transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </span>
            </span>
          </Link>
        </li>
      ))}
      {offline && (
        <li className="sm:col-span-2">
          <OfflineNote text={c.offline} />
        </li>
      )}
    </ul>
  );
}

/**
 * Attendee home ("My Congress") as a state machine on the congress's dates in its own time zone:
 * before → countdown, passes and a checklist; during → the pass QR first, then now/next and booths;
 * after → thanks and a summary. Shared by the attendee page and the organizer's panel preview.
 */
export function CongressHomeView({ event, page, labels, locale, t, personal, booths }: CongressHomeViewProps) {
  const c = homeCopy[locale];
  const slug = event.slug;
  const now = useNow(30_000);
  const phase = homePhase(event.starts_at, event.ends_at, event.timezone, now);
  const idx = (value: number) => sectionIndex(value, locale);
  const hero = <CongressHero event={event} page={page} locale={locale} eyebrow={t.navMyCongress} />;
  const programTo = `${congressPath(slug, "details")}#program`;

  const program = (index: string) => (
    <section aria-labelledby="mc-schedule-title" className={card}>
      <ModuleHeading index={index} id="mc-schedule-title">
        <bdi>{phase?.kind === "after" ? c.programTitleAfter : labels.scheduleTitle}</bdi>
      </ModuleHeading>
      {phase?.kind === "during" ? (
        <NowNextSessions sessions={event.sessions} locale={locale} timeZone={event.timezone} fullScheduleTo={programTo} />
      ) : (
        <UpcomingSessions sessions={event.sessions} locale={locale} timeZone={event.timezone} fullScheduleTo={programTo} />
      )}
    </section>
  );

  if (personal.status === "signed-out") {
    return (
      <>
        {hero}
        <div className="mx-auto max-w-3xl">
          <StatusPanel icon="lock" title={c.signInTitle}>
            <p>{c.signInBody}</p>
            <LinkButton to={personal.signInTo} variant="primary" size="lg">
              {c.signIn}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          </StatusPanel>
        </div>
        {program(idx(1))}
        {labels.showBooths && booths(idx(2))}
      </>
    );
  }

  if (personal.status === "loading") {
    return (
      <>
        {hero}
        <LoadingBlock label={t.navMyCongress} />
      </>
    );
  }

  const { overview } = personal;
  const passes = overview.tickets;
  const activePasses = passes.filter((p) => p.status === "active");
  const contacts = overview.connectionCount;

  const network = (index: string, lead: string | null) => (
    <section
      aria-labelledby="mc-network-title"
      className="relative flex flex-col gap-6 overflow-hidden rounded-[var(--radius-xl)] border border-action-subtle-border bg-aiteb-lavender p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between reveal"
    >
      <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-70" />
      <div className="relative space-y-4">
        <ModuleHeading index={index} id="mc-network-title">
          {c.networkTitle}
        </ModuleHeading>
        {contacts === null ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Icon name="wifi-off" size={18} className="text-ink-400" />
            {c.notOffline}
          </p>
        ) : (
          <p className={`font-semibold tracking-[-0.02em] text-text-primary ${contacts === 0 ? "text-lg" : "text-2xl text-event-accent"}`}>{contactsPhrase(contacts, locale)}</p>
        )}
        {lead && <p className="max-w-md text-sm leading-relaxed text-text-secondary">{lead}</p>}
      </div>
      <div className="relative flex flex-col gap-3 sm:flex-row">
        {phase?.kind !== "after" && (
          <LinkButton to={`${congressPath(slug, "my-network")}?scan=1`} variant="primary" size="lg" className="self-stretch sm:self-start">
            <Icon name="scan" size={18} />
            {c.scanColleague}
          </LinkButton>
        )}
        <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="lg" className="self-stretch sm:self-start">
          <Icon name="users" size={18} />
          {c.openNetwork}
        </LinkButton>
      </div>
    </section>
  );

  const passCard = (index: string) => (
    <section aria-labelledby="mc-pass-title" className={`${card} shape-arc lg:col-span-6`}>
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
      <ModuleHeading index={index} id="mc-pass-title">
        {passes.length > 1 ? c.passesTitleMany : c.passesTitle}
      </ModuleHeading>
      {passes.length > 0 ? (
        <>
          <PassList passes={passes} locale={locale} t={t} />
          {overview.fromCache && <OfflineNote text={c.offline} />}
          {activePasses.length > 0 && (
            <LinkButton to={congressPath(slug, "my-ticket")} variant="ink" size="lg" className="mt-auto self-stretch sm:self-start">
              <Icon name="qr" size={18} />
              {c.showPass}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          )}
        </>
      ) : (
        <NoPass slug={slug} locale={locale} offline={overview.fromCache} offerReserve={labels.showPasses} />
      )}
    </section>
  );

  let body: ReactNode;
  if (phase?.kind === "during") {
    body = (
      <>
        <section aria-labelledby="mc-pass-title" className="space-y-4 reveal">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="mc-pass-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">
              {activePasses.length > 1 ? c.passesTitleMany : c.passesTitle}
            </h2>
            <Badge variant="success" size="sm" dot>
              {c.dayOf(n(phase.day, locale), n(phase.totalDays, locale))}
            </Badge>
          </div>
          {activePasses.length > 0 ? (
            <LivePass passes={activePasses} slug={slug} locale={locale} offline={overview.fromCache} />
          ) : (
            <div className="flex flex-col gap-4 rounded-2xl border border-border-default bg-surface-panel p-5">
              <NoPass slug={slug} locale={locale} offline={overview.fromCache} offerReserve={labels.showPasses} />
            </div>
          )}
        </section>
        {program(idx(1))}
        {labels.showBooths && booths(idx(2))}
        {network(idx(labels.showBooths ? 3 : 2), null)}
      </>
    );
  } else if (phase?.kind === "after") {
    body = (
      <>
        <section aria-labelledby="mc-thanks-title" className={`${card} shape-arc`}>
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
          <div className="space-y-2">
            <h2 id="mc-thanks-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary text-balance sm:text-2xl">
              {c.thanksTitle(event.name)}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{c.thanksBody}</p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-border-default bg-border-default sm:grid-cols-2">
            <div className="space-y-1.5 bg-surface-panel p-5">
              <dt className="text-xs font-medium text-text-muted">{c.summaryContacts}</dt>
              <dd className="text-lg font-semibold text-text-primary">{contacts === null ? c.notOffline : contactsPhrase(contacts, locale)}</dd>
            </div>
            {passes.length > 0 && (
              <div className="space-y-1.5 bg-surface-panel p-5">
                <dt className="text-xs font-medium text-text-muted">{c.summaryPasses}</dt>
                <dd className="text-lg font-semibold text-text-primary break-words">{passes.map((p) => p.ticket_tier_name).join("، ")}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-col gap-3 sm:flex-row">
            <LinkButton to={congressPath(slug, "my-network")} variant="primary" size="lg" className="self-stretch sm:self-start">
              <Icon name="users" size={18} />
              {c.openNetwork}
            </LinkButton>
            <LinkButton to={programTo} variant="secondary" size="lg" className="self-stretch sm:self-start">
              <Icon name="list" size={18} />
              {c.programTitleAfter}
            </LinkButton>
          </div>
        </section>
        {labels.showBooths && booths(idx(1))}
      </>
    );
  } else {
    body = (
      <>
        <div className="grid items-start gap-5 lg:grid-cols-12">
          {passCard(idx(1))}
          <section aria-labelledby="mc-countdown-title" className={`${card} lg:col-span-6`}>
            <h2 id="mc-countdown-title" className="sr-only">{c.countdownTitle}</h2>
            {phase?.kind === "before" && <Countdown phase={phase} locale={locale} />}
            <Checklist event={event} locale={locale} />
          </section>
        </div>
        {program(idx(2))}
        {network(idx(3), contacts === 0 ? c.networkLeadBefore : null)}
        {labels.showBooths && booths(idx(4))}
      </>
    );
  }

  return (
    <>
      {hero}
      {body}

      {/* Not reachable from the navigation: kept as a compact list, only when there is one. */}
      {overview.otherCongresses.length > 0 && (
        <section aria-labelledby="mc-other-title" className="space-y-3">
          <h2 id="mc-other-title" className="text-sm font-semibold text-text-secondary">{c.otherCongresses}</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overview.otherCongresses.map((e) => (
              <li key={e.event_id}>
                <Link
                  to={congressPath(e.event_slug, "my-congress")}
                  className="group flex min-h-14 items-center gap-3 rounded-2xl border border-border-default bg-surface-panel p-2 pe-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span aria-hidden="true" className="size-10 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:16px]">
                    <CongressSignature seed={e.event_slug} tone="ink" className="size-full" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{e.event_name}</span>
                  <Icon name="arrow-right" size={18} className="text-ink-400 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
