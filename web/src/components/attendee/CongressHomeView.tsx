import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AccessEvent, AttendeeTicketDetail, PublicEvent } from "../../api/client";
import { codeFontClass, formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { congressPath } from "../../lib/congressContext";
import { CongressSignature } from "../brand/CongressSignature";
import { LinkButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { LoadingBlock, StatusPanel } from "../ui/PortalState";
import { CongressHero } from "./CongressHero";
import { UpcomingSessions } from "./CongressSchedule";
import { sectionIndex } from "./congressTime";
import type { PanelLabels, PanelPage } from "./panelContent";

/** What the signed-in attendee holds for this congress. */
export interface HomeOverview {
  tickets: Pick<AttendeeTicketDetail, "id" | "ticket_tier_name" | "attendee_name">[];
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

function ModuleIndex({ value }: { value: string }) {
  return (
    <span aria-hidden="true" className={`flex items-center gap-2 ${codeFontClass(value)} text-xs font-medium text-text-muted tabular`}>
      {value}
      <span className="h-px w-6 bg-border-strong" />
    </span>
  );
}

/**
 * Attendee home ("My Congress"): hero, then 01 pass, 02 program, 03 network, 04 booths, in that order on
 * every breakpoint. Shared by the attendee page and the organizer's panel preview.
 */
export function CongressHomeView({ event, page, labels, locale, t, personal, booths }: CongressHomeViewProps) {
  const isRtl = locale === "fa";
  const slug = event.slug;
  const idx = (n: number) => sectionIndex(n, locale);
  const hero = <CongressHero event={event} page={page} locale={locale} eyebrow={t.navMyCongress} />;

  const schedule = (index: string) => (
    <section
      aria-labelledby="mc-schedule-title"
      className="flex flex-col gap-5 rounded-[var(--radius-xl)] border border-border-default bg-surface-panel p-6 shadow-soft sm:p-8 reveal"
    >
      <div className="space-y-2">
        <ModuleIndex value={index} />
        <h2 id="mc-schedule-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">
          <bdi>{labels.scheduleTitle}</bdi>
        </h2>
      </div>
      <UpcomingSessions sessions={event.sessions} locale={locale} fullScheduleTo={`${congressPath(slug, "details")}#program`} />
    </section>
  );

  if (personal.status === "signed-out") {
    return (
      <>
        {hero}
        <div className="mx-auto max-w-3xl">
          <StatusPanel icon="lock" title={t.unauthenticatedTitle}>
            <p>{isRtl ? "برای دیدن بلیت و ارتباطات این همایش وارد شوید." : "Sign in to see your pass and connections for this congress."}</p>
            <LinkButton to={personal.signInTo} variant="primary" size="lg">
              {t.loginAction}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          </StatusPanel>
        </div>
        {schedule(idx(1))}
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
  const pass = overview.tickets[0];

  return (
    <>
      {hero}

      <div className="grid items-start gap-5 lg:grid-cols-12">
        {/* 01 · Pass */}
        <section
          aria-labelledby="mc-pass-title"
          className="relative flex flex-col gap-6 overflow-hidden shape-arc border border-border-default bg-surface-panel p-6 shadow-soft sm:p-8 lg:col-span-6 reveal"
        >
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-[image:var(--grad-aiteb)]" />
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <ModuleIndex value={idx(1)} />
              <h2 id="mc-pass-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">{t.navMyTicket}</h2>
            </div>
            <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl [border-start-end-radius:22px] bg-surface-ink text-white shadow-lift">
              <Icon name="qr" size={26} />
            </span>
          </div>

          {pass ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border-subtle pt-5 text-sm">
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs font-medium text-text-muted">{t.tierLabel}</dt>
                  <dd className="font-semibold text-text-primary break-words">{pass.ticket_tier_name}</dd>
                </div>
                <div className="min-w-0 space-y-1">
                  <dt className="text-xs font-medium text-text-muted">{isRtl ? "دارنده کارت" : "Pass holder"}</dt>
                  <dd className="font-semibold text-text-primary break-words">{pass.attendee_name}</dd>
                </div>
              </dl>
              {overview.fromCache && (
                <p className="flex items-start gap-2 self-start rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs font-semibold text-status-warning-text">
                  <Icon name="wifi-off" size={15} className="mt-px" />
                  {t.offlineNotice}
                </p>
              )}
              <LinkButton to={congressPath(slug, "my-ticket")} variant="ink" size="lg" className="mt-auto self-stretch sm:self-start">
                <Icon name="qr" size={18} />
                {isRtl ? "نمایش کارت ورود و کد QR" : "Show pass & QR code"}
                <Icon name="arrow-right" size={18} />
              </LinkButton>
            </>
          ) : overview.fromCache ? (
            <p className="flex items-center gap-2 border-t border-border-subtle pt-5 text-sm text-text-secondary">
              <Icon name="wifi-off" size={18} className="text-ink-400" />
              {isRtl ? "در حالت آفلاین در دسترس نیست." : "Not available offline."}
            </p>
          ) : (
            <>
              <p className="border-t border-border-subtle pt-5 text-sm leading-relaxed text-text-secondary">
                {isRtl ? "برای این همایش بلیتی ندارید." : "You have no pass for this congress yet."}
              </p>
              {labels.showPasses && (
                <LinkButton to={`/e/${slug}`} variant="primary" size="lg" className="mt-auto self-stretch sm:self-start">
                  <Icon name="ticket" size={18} />
                  {isRtl ? "رزرو کارت ورود" : "Reserve a pass"}
                </LinkButton>
              )}
            </>
          )}
        </section>

        {/* 02 · Program: right after the pass in the reading order on every breakpoint */}
        <div className="lg:col-span-6">{schedule(idx(2))}</div>
      </div>

      {/* 03 · Network */}
      <section
        aria-labelledby="mc-network-title"
        className="relative flex flex-col gap-6 overflow-hidden rounded-[var(--radius-xl)] border border-action-subtle-border bg-aiteb-lavender p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between reveal"
      >
        <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-70" />
        <div className="relative space-y-5">
          <div className="space-y-2">
            <ModuleIndex value={idx(3)} />
            <h2 id="mc-network-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">{t.navMyNetwork}</h2>
          </div>
          {overview.connectionCount === null ? (
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Icon name="wifi-off" size={18} className="text-ink-400" />
              {isRtl ? "در حالت آفلاین در دسترس نیست." : "Not available offline."}
            </p>
          ) : (
            <p className="flex items-end gap-3">
              <span className="text-6xl font-semibold leading-none tracking-[-0.04em] text-event-accent tabular">
                {formatLocalizedNumber(overview.connectionCount, locale)}
              </span>
              <span className="pb-1.5 text-sm leading-snug text-text-secondary">
                {isRtl ? "ارتباط در این همایش" : `connection${overview.connectionCount === 1 ? "" : "s"} at this congress`}
              </span>
            </p>
          )}
        </div>
        <div className="relative flex flex-col gap-3 sm:flex-row">
          <LinkButton to={`${congressPath(slug, "my-network")}?scan=1`} variant="primary" size="lg" className="self-stretch sm:self-start">
            <Icon name="scan" size={18} />
            {isRtl ? "اسکن کد QR همکار" : "Scan a colleague's QR code"}
          </LinkButton>
          <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="lg" className="self-stretch sm:self-start">
            <Icon name="users" size={18} />
            {isRtl ? "باز کردن شبکه من" : "Open My Network"}
          </LinkButton>
        </div>
      </section>

      {/* 04 · Booths */}
      {labels.showBooths && booths(idx(4))}

      {/* Not reachable from the navigation: kept as a compact list, only when there is one. */}
      {overview.otherCongresses.length > 0 && (
        <section aria-labelledby="mc-other-title" className="space-y-3">
          <h2 id="mc-other-title" className="text-sm font-semibold text-text-secondary">{isRtl ? "همایش‌های دیگر شما" : "Your other congresses"}</h2>
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
