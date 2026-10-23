import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import QRCode from "react-qr-code";
import type { AccessEvent, AttendeeTicketDetail, PublicEvent } from "../../api/client";
import { attendeeCopy } from "../../copy/attendee";
import { homePhase } from "../../lib/congressPhase";
import type { AttendeeLocale, TranslationDictionary } from "../../lib/i18n";
import { congressPath } from "../../lib/congressContext";
import { mapSearchLinks } from "../../lib/eventLinks";
import { CongressSignature } from "../brand/CongressSignature";
import { downloadCalendarFile } from "../public/calendarDownload";
import { MapLinks } from "../public/EventActions";
import { Badge } from "../ui/Badge";
import { LinkButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Icon, type IconName } from "../ui/Icon";
import { MetaList } from "../ui/MetaList";
import { Notice } from "../ui/Notice";
import { PageHeader, SectionHeader } from "../ui/PageHeader";
import { LoadingBlock } from "../ui/PortalState";
import { contactsPhrase } from "./attendeeCopy";
import { NowNextSessions, UpcomingSessions } from "./CongressSchedule";
import { formatDateRange } from "./congressTime";
import { InlineSignIn } from "./InlineSignIn";
import type { PanelLabels, PanelPage } from "./panelContent";
import { PhaseBadge } from "./PhaseBadge";
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

export type HomePersonal = { status: "signed-out" } | { status: "loading" } | { status: "ready"; overview: HomeOverview };

interface CongressHomeViewProps {
  event: PublicEvent;
  /** @deprecated No longer read (the cover moved to the public page); the organizer's preview still passes it. */
  page?: PanelPage;
  labels: PanelLabels;
  locale: AttendeeLocale;
  /** @deprecated No longer read; the organizer's preview still passes it. */
  t?: TranslationDictionary;
  personal: HomePersonal;
  /** The booth directory (live, or fed with preview data); rendered when the exhibitors section is visible. The index is unused. */
  booths: (index: string) => ReactNode;
}

function OfflineNote({ text }: { text: string }) {
  return (
    <Notice tone="warning" icon="wifi-off">
      {text}
    </Notice>
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

/** Before the congress: the calendar file and the directions. */
function Checklist({ event, locale }: { event: PublicEvent; locale: AttendeeLocale }) {
  const c = attendeeCopy[locale].home;
  const [calendarDone, setCalendarDone] = useState(false);
  const hasAddress = mapSearchLinks(event.location).length > 0;
  return (
    <Card className="space-y-2 p-4 sm:p-5">
      <h3 className="px-1 text-sm font-semibold text-text-secondary">{c.checklistTitle}</h3>
      <ul className="divide-y divide-border-subtle">
        <li className="py-1">
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
          <li className="py-1">
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
      </ul>
    </Card>
  );
}

/** Every pass for the congress: type, holder and whether it is valid. */
function PassList({ passes, locale }: { passes: HomePass[]; locale: AttendeeLocale }) {
  const c = attendeeCopy[locale].home;
  return (
    <ul className="space-y-3">
      {passes.map((pass) => (
        <li key={pass.id} className="space-y-3 rounded-control bg-surface-panel-subtle p-4">
          <MetaList
            columns={2}
            items={[
              { label: c.tier, value: pass.ticket_tier_name },
              { label: c.holder, value: pass.attendee_name },
            ]}
          />
          <Badge variant={pass.status === "active" ? "success" : "neutral"} size="sm" dot>
            {pass.status === "active" ? c.statusActive : c.statusInactive}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function NoPass({ locale, offline, offerReserve, slug }: { locale: AttendeeLocale; offline: boolean; offerReserve: boolean; slug: string }) {
  const c = attendeeCopy[locale].home;
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
        <LinkButton to={`/e/${slug}`} variant="primary" size="lg" icon="ticket" className="self-stretch sm:self-start">
          {c.reservePass}
        </LinkButton>
      )}
    </>
  );
}

/** During the congress: the pass QR right at the top; a tap opens the full pass. */
function LivePass({ passes, slug, locale, offline }: { passes: HomePass[]; slug: string; locale: AttendeeLocale; offline: boolean }) {
  const c = attendeeCopy[locale].home;
  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {passes.map((pass) => (
        <li key={pass.id}>
          <Link
            to={congressPath(slug, "my-ticket")}
            aria-label={`${c.showPass}: ${pass.ticket_tier_name}`}
            className="press group flex flex-col items-center gap-4 rounded-card bg-surface-ink p-4 text-center text-white shadow-lift transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid sm:p-5"
          >
            <span className="shrink-0 rounded-xl bg-white p-3">
              <QRCode
                value={pass.qr_secret}
                size={256}
                level="M"
                viewBox="0 0 256 256"
                aria-hidden="true"
                className="block h-56 w-56 min-[380px]:h-64 min-[380px]:w-64"
              />
            </span>
            <span className="min-w-0 space-y-2">
              <span className="block text-xs font-semibold text-ink-300">{c.passAtGate}</span>
              <span className="block text-lg font-semibold leading-snug break-words">{pass.ticket_tier_name}</span>
              <span className="block text-sm text-ink-200 break-words">{pass.attendee_name}</span>
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
 * before → the phase chip, the pass and a checklist; during → the pass QR first, then now/next and booths;
 * after → thanks and a summary. Shared by the attendee page and the organizer's panel preview.
 */
export function CongressHomeView({ event, labels, locale, personal, booths }: CongressHomeViewProps) {
  const c = attendeeCopy[locale].home;
  const slug = event.slug;
  const now = useNow(30_000);
  const phase = homePhase(event.starts_at, event.ends_at, event.timezone, now);
  const programTo = `${congressPath(slug, "details")}#program`;

  const header = (
    <PageHeader
      title={<bdi>{event.name}</bdi>}
      meta={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} timeZone={event.timezone} />
          <bdi>{formatDateRange(event.starts_at, event.ends_at, locale, event.timezone)}</bdi>
          {event.location && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="pin" size={14} className="shrink-0 text-ink-400" />
              <bdi className="break-words">{event.location}</bdi>
            </span>
          )}
        </span>
      }
    />
  );

  const program = (
    <section aria-labelledby="mc-schedule-title" className="space-y-4">
      <SectionHeader id="mc-schedule-title" title={<bdi>{phase?.kind === "after" ? c.programTitleAfter : labels.scheduleTitle}</bdi>} />
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
        {header}
        <InlineSignIn locale={locale} title={c.signInTitle} body={c.signInBody} />
        {program}
        {labels.showBooths && booths("")}
      </>
    );
  }

  if (personal.status === "loading") {
    return (
      <>
        {header}
        <LoadingBlock label={attendeeCopy[locale].shell.tabs["my-congress"]} />
      </>
    );
  }

  const { overview } = personal;
  const passes = overview.tickets;
  const activePasses = passes.filter((p) => p.status === "active");
  const contacts = overview.connectionCount;

  const network = (lead: string | null) => (
    <Card tone="lavender" className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
      <section aria-labelledby="mc-network-title" className="space-y-3">
        <h2 id="mc-network-title" className="text-title-sm font-bold text-text-primary">
          {c.networkTitle}
        </h2>
        {contacts === null ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Icon name="wifi-off" size={18} className="text-ink-400" />
            {c.notOffline}
          </p>
        ) : (
          <p className={`font-semibold tracking-[-0.02em] text-text-primary ${contacts === 0 ? "text-lg" : "text-2xl text-event-accent"}`}>{contactsPhrase(contacts, locale)}</p>
        )}
        {lead && <p className="max-w-md text-sm leading-relaxed text-text-secondary">{lead}</p>}
      </section>
      <div className="flex flex-col gap-3 sm:flex-row">
        {phase?.kind !== "after" && (
          <LinkButton to={`${congressPath(slug, "my-network")}?scan=1`} variant="primary" size="lg" icon="scan" className="self-stretch sm:self-start">
            {c.scanColleague}
          </LinkButton>
        )}
        <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="lg" icon="users" className="self-stretch sm:self-start">
          {c.openNetwork}
        </LinkButton>
      </div>
    </Card>
  );

  let body: ReactNode;
  if (phase?.kind === "during") {
    body = (
      <>
        <section aria-labelledby="mc-pass-title" className="space-y-4">
          {/* The congress's name is the page's heading; the chip says which day it is ("Live now · Day 2 of 3"). */}
          <h1 id="mc-pass-title" className="sr-only">
            {event.name}
          </h1>
          <PhaseBadge startsAt={event.starts_at} endsAt={event.ends_at} locale={locale} timeZone={event.timezone} />
          {activePasses.length > 0 ? (
            <LivePass passes={activePasses} slug={slug} locale={locale} offline={overview.fromCache} />
          ) : (
            <Card className="flex flex-col gap-4 p-5">
              <NoPass slug={slug} locale={locale} offline={overview.fromCache} offerReserve={labels.showPasses} />
            </Card>
          )}
        </section>
        {program}
        {labels.showBooths && booths("")}
        {network(null)}
      </>
    );
  } else if (phase?.kind === "after") {
    body = (
      <>
        {header}
        <Card className="space-y-5 p-5 sm:p-6">
          <section aria-labelledby="mc-thanks-title" className="space-y-5">
            <div className="space-y-2">
              <h2 id="mc-thanks-title" className="text-title-sm font-bold text-text-primary text-balance">
                {c.thanksTitle(event.name)}
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{c.thanksBody}</p>
            </div>
            <MetaList
              columns={2}
              items={[
                { label: c.summaryContacts, value: contacts === null ? c.notOffline : contactsPhrase(contacts, locale) },
                ...(passes.length > 0 ? [{ label: c.summaryPasses, value: passes.map((p) => p.ticket_tier_name).join(c.listSeparator) }] : []),
              ]}
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <LinkButton to={congressPath(slug, "my-network")} variant="primary" size="lg" icon="users" className="self-stretch sm:self-start">
                {c.openNetwork}
              </LinkButton>
              <LinkButton to={programTo} variant="secondary" size="lg" icon="list" className="self-stretch sm:self-start">
                {c.programTitleAfter}
              </LinkButton>
            </div>
          </section>
        </Card>
        {labels.showBooths && booths("")}
      </>
    );
  } else {
    body = (
      <>
        {header}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card className="space-y-4 p-5 sm:p-6">
            <section aria-labelledby="mc-pass-title" className="flex flex-col gap-4">
              <h2 id="mc-pass-title" className="text-title-sm font-bold text-text-primary">
                {passes.length > 1 ? c.passTitleMany : c.passTitle}
              </h2>
              {passes.length > 0 ? (
                <>
                  <PassList passes={passes} locale={locale} />
                  {overview.fromCache && <OfflineNote text={c.offline} />}
                  {activePasses.length > 0 && (
                    <LinkButton to={congressPath(slug, "my-ticket")} variant="primary" size="lg" icon="qr" className="self-stretch sm:self-start">
                      {c.showPass}
                    </LinkButton>
                  )}
                </>
              ) : (
                <NoPass slug={slug} locale={locale} offline={overview.fromCache} offerReserve={labels.showPasses} />
              )}
            </section>
          </Card>
          <Checklist event={event} locale={locale} />
        </div>
        {program}
        {network(contacts === 0 ? c.networkLeadBefore : null)}
        {labels.showBooths && booths("")}
      </>
    );
  }

  return (
    <>
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
                  className="group flex min-h-14 items-center gap-3 rounded-card border border-border-default bg-surface-panel p-2 pe-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
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
