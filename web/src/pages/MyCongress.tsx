import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  type AttendeeTicketDetail,
  type AccessEvent,
} from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { formatLocalizedNumber, useAttendeeLocale } from "../lib/i18n";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { loadOwnerScopedTickets } from "../lib/ticketCache";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { BoothDirectory } from "../components/BoothDirectory";
import { CongressHero } from "../components/attendee/CongressHero";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { sectionIndex } from "../components/attendee/congressTime";

interface Overview {
  tickets: AttendeeTicketDetail[];
  fromCache: boolean;
  connectionCount: number | null;
  otherCongresses: AccessEvent[];
}

function ModuleIndex({ value }: { value: string }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-2 font-mono text-xs font-medium text-text-muted tabular">
      {value}
      <span className="h-px w-6 bg-border-strong" />
    </span>
  );
}

export default function MyCongress() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;
  const congress = useCongressEvent(slug);
  const token = typeof window !== "undefined" ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE) : null;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  const eventId = congress.status === "ready" ? congress.event.id : null;

  useEffect(() => {
    if (!token || !eventId) return;
    let active = true;
    const load = async () => {
      const client = createApiClient({ kind: "user", token });
      try {
        const [ticketsRes, networkRes, accessRes] = await Promise.all([
          client.GET("/api/attendees/me/tickets"),
          client.GET("/api/attendees/me/network"),
          client.GET("/api/me/access"),
        ]);
        if (!active || !isStoredAttendeeToken(token)) return;
        if ([ticketsRes, networkRes, accessRes].some((r) => r.response.status === 401)) {
          rejectAttendeeToken(token);
          setFailed(true);
          return;
        }
        const cache = loadOwnerScopedTickets(token);
        const tickets = ticketsRes.data ?? (cache.status === "valid" ? cache.tickets : []);
        setOverview({
          tickets: tickets.filter((tkt) => tkt.event_slug === slug),
          fromCache: !ticketsRes.data,
          connectionCount: networkRes.data ? networkRes.data.filter((c) => c.event_id === eventId).length : null,
          otherCongresses: (accessRes.data?.events ?? []).filter((e) => e.event_slug !== slug && e.roles.includes("ATTENDEE")),
        });
      } catch {
        // Network failure: the owner-scoped offline pass can still be presented.
        if (!active) return;
        const cache = loadOwnerScopedTickets(token);
        if (cache.status !== "valid") {
          setFailed(true);
          return;
        }
        setOverview({
          tickets: cache.tickets.filter((tkt) => tkt.event_slug === slug),
          fromCache: true,
          connectionCount: null,
          otherCongresses: [],
        });
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [token, eventId, slug]);

  const shell = (content: ReactNode) => (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-congress">
      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-5 sm:space-y-16 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
  const narrow = (content: ReactNode) => shell(<div className="mx-auto max-w-3xl pt-6">{content}</div>);

  if (congress.status === "missing") {
    return narrow(<StatusPanel icon="search" title={isRtl ? "همایش پیدا نشد" : "Congress not found"} />);
  }
  if (congress.status === "error") {
    return narrow(
      <StatusPanel tone="danger" icon="alert" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
        <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
      </StatusPanel>
    );
  }
  if (congress.status === "loading") return shell(<LoadingBlock label={t.navMyCongress} />);

  const event = congress.event;
  const hero = <CongressHero event={event} locale={locale} eyebrow={t.navMyCongress} />;
  const idx = (n: number) => sectionIndex(n, locale);

  if (!token || failed) {
    return shell(
      <>
        {hero}
        <div className="mx-auto max-w-3xl">
          <StatusPanel icon="lock" title={t.unauthenticatedTitle}>
            <p>{isRtl ? "برای دیدن بلیط و ارتباطات این همایش وارد شوید." : "Sign in to see your pass and connections for this congress."}</p>
            <LinkButton to={signInPath(slug, congressPath(slug, "my-congress"))} variant="primary" size="lg">
              {t.loginAction}
              <Icon name="arrow-right" size={18} />
            </LinkButton>
          </StatusPanel>
        </div>
        <BoothDirectory slug={slug} token={null} isRtl={isRtl} index={idx(1)} />
      </>
    );
  }

  if (!overview) return shell(<>{hero}<LoadingBlock label={t.navMyCongress} /></>);

  const pass = overview.tickets[0];
  const more: { to: string; icon: IconName; label: string; hint: string }[] = [
    {
      to: congressPath(slug, "details"),
      icon: "info",
      label: t.navCongressDetails,
      hint: isRtl ? "زمان، مکان، توضیحات و انواع کارت ورود" : "Dates, venue, description and pass types",
    },
    {
      to: congressPath(slug, "my-profile"),
      icon: "user",
      label: t.navMyProfile,
      hint: isRtl ? "اطلاعات حساب و حریم خصوصی تماس" : "Your account and contact privacy",
    },
  ];

  return shell(
    <>
      {hero}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* 01 · Pass */}
        <section
          aria-labelledby="mc-pass-title"
          className="relative flex flex-col gap-6 overflow-hidden shape-arc border border-border-default bg-surface-panel p-6 shadow-soft sm:p-8 lg:col-span-7 reveal"
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
                {isRtl ? "نمایش کارت ورود و کیوآر" : "Show pass & QR"}
                <Icon name="arrow-right" size={18} />
              </LinkButton>
            </>
          ) : (
            <>
              <p className="border-t border-border-subtle pt-5 text-sm leading-relaxed text-text-secondary">
                {isRtl ? "برای این همایش بلیطی ندارید." : "You have no pass for this congress yet."}
              </p>
              <LinkButton to={`/e/${slug}`} variant="primary" size="lg" className="mt-auto self-stretch sm:self-start">
                <Icon name="ticket" size={18} />
                {isRtl ? "رزرو کارت ورود" : "Reserve a pass"}
              </LinkButton>
            </>
          )}
        </section>

        {/* 02 · Network */}
        <section
          aria-labelledby="mc-network-title"
          className="relative flex flex-col gap-6 overflow-hidden rounded-[var(--radius-xl)] border border-action-subtle-border bg-aiteb-lavender p-6 sm:p-8 lg:col-span-5 reveal"
        >
          <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-70" />
          <div className="relative space-y-2">
            <ModuleIndex value={idx(2)} />
            <h2 id="mc-network-title" className="text-xl font-semibold tracking-[-0.02em] text-text-primary sm:text-2xl">{t.navMyNetwork}</h2>
          </div>
          <div className="relative">
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
                  {isRtl
                    ? "ارتباط در این همایش"
                    : `connection${overview.connectionCount === 1 ? "" : "s"} at this congress`}
                </span>
              </p>
            )}
          </div>
          <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="lg" className="relative mt-auto self-stretch sm:self-start">
            <Icon name="users" size={18} />
            {isRtl ? "باز کردن شبکه من" : "Open My Network"}
          </LinkButton>
        </section>
      </div>

      <BoothDirectory slug={slug} token={token} isRtl={isRtl} index={idx(3)} />

      <section aria-labelledby="mc-more-title" className="space-y-5">
        <SectionHeader index={idx(4)} id="mc-more-title" title={isRtl ? "بیشتر" : "More"} />
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <ul className="divide-y divide-border-default border-y border-border-default">
            {more.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="group flex min-h-[72px] items-center gap-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring rounded-lg"
                >
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-panel text-event-accent shadow-soft ring-1 ring-border-default">
                    <Icon name={item.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-text-primary">{item.label}</span>
                    <span className="block text-xs text-text-muted">{item.hint}</span>
                  </span>
                  <Icon name="arrow-right" size={18} className="text-ink-400 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1 group-hover:text-text-primary" />
                </Link>
              </li>
            ))}
          </ul>

          {overview.otherCongresses.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-text-secondary">{isRtl ? "همایش‌های دیگر شما" : "Your other congresses"}</h2>
              <ul className="space-y-2">
                {overview.otherCongresses.map((e) => (
                  <li key={e.event_id}>
                    <Link
                      to={congressPath(e.event_slug, "my-congress")}
                      className="group flex min-h-16 items-center gap-3 rounded-2xl border border-border-default bg-surface-panel p-2 pe-4 shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <span aria-hidden="true" className="size-12 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:18px]">
                        <CongressSignature seed={e.event_slug} tone="ink" className="size-full" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{e.event_name}</span>
                      <Icon name="arrow-right" size={18} className="text-ink-400 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
