import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  type AttendeeTicketDetail,
  type AccessEvent,
} from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { Badge } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { LinkButton } from "../components/ui/Button";
import { formatLocalizedDate, formatLocalizedNumber, useAttendeeLocale } from "../lib/i18n";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { loadOwnerScopedTickets } from "../lib/ticketCache";
import { congressPath, useCongressEvent } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { BoothDirectory } from "../components/BoothDirectory";

interface Overview {
  tickets: AttendeeTicketDetail[];
  fromCache: boolean;
  connectionCount: number | null;
  otherCongresses: AccessEvent[];
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
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">{content}</div>
    </AttendeeLayout>
  );

  if (congress.status === "missing") {
    return shell(<StatusPanel icon="search" title={isRtl ? "همایش پیدا نشد" : "Congress not found"} />);
  }
  if (congress.status === "error") {
    return shell(
      <StatusPanel tone="danger" icon="alert" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
        <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
      </StatusPanel>
    );
  }
  if (congress.status === "loading") return shell(<LoadingBlock label={t.navMyCongress} />);

  const event = congress.event;
  const hero = (
    <Card className="p-6 sm:p-8 border-border-default space-y-3">
      <Badge variant="brand" size="sm">{t.navMyCongress}</Badge>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">{event.name}</h1>
      <p className="text-sm text-text-secondary">
        📅 {formatLocalizedDate(event.starts_at, locale)} — {formatLocalizedDate(event.ends_at, locale)}
      </p>
      <p className="text-sm text-text-secondary">📍 {event.location}</p>
    </Card>
  );

  if (!token || failed) {
    return shell(
      <>
        {hero}
        <StatusPanel icon="lock" title={t.unauthenticatedTitle}>
          <p>{isRtl ? "برای دیدن بلیط و ارتباطات این همایش وارد شوید." : "Sign in to see your pass and connections for this congress."}</p>
          <LinkButton to={signInPath(slug, congressPath(slug, "my-congress"))} variant="primary" size="md">{t.loginAction} →</LinkButton>
        </StatusPanel>
        <BoothDirectory slug={slug} token={null} isRtl={isRtl} />
      </>
    );
  }

  if (!overview) return shell(<>{hero}<LoadingBlock label={t.navMyCongress} /></>);

  const pass = overview.tickets[0];
  const tile = "p-5 border-border-default flex flex-col gap-3";
  return shell(
    <>
      {hero}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className={tile}>
          <h2 className="text-sm font-bold text-text-primary">🎫 {t.navMyTicket}</h2>
          {pass ? (
            <>
              <p className="text-sm text-text-secondary">
                {pass.ticket_tier_name} · <span className="font-semibold text-text-primary">{pass.attendee_name}</span>
              </p>
              {overview.fromCache && <Badge variant="warning" size="sm">{t.offlineNotice}</Badge>}
              <LinkButton to={congressPath(slug, "my-ticket")} variant="primary" size="md">
                {isRtl ? "نمایش کارت ورود و کیوآر" : "Show pass & QR"}
              </LinkButton>
            </>
          ) : (
            <>
              <p className="text-sm text-text-secondary">
                {isRtl ? "برای این همایش بلیطی ندارید." : "You have no pass for this congress yet."}
              </p>
              <LinkButton to={`/e/${slug}`} variant="secondary" size="md">
                {isRtl ? "رزرو کارت ورود" : "Reserve a pass"}
              </LinkButton>
            </>
          )}
        </Card>

        <Card className={tile}>
          <h2 className="text-sm font-bold text-text-primary">🤝 {t.navMyNetwork}</h2>
          <p className="text-sm text-text-secondary">
            {overview.connectionCount === null
              ? (isRtl ? "در حالت آفلاین در دسترس نیست." : "Not available offline.")
              : isRtl
                ? `${formatLocalizedNumber(overview.connectionCount, locale)} ارتباط در این همایش`
                : `${overview.connectionCount} connection${overview.connectionCount === 1 ? "" : "s"} at this congress`}
          </p>
          <LinkButton to={congressPath(slug, "my-network")} variant="secondary" size="md">
            {isRtl ? "باز کردن شبکه من" : "Open My Network"}
          </LinkButton>
        </Card>
      </div>

      <BoothDirectory slug={slug} token={token} isRtl={isRtl} />

      <div className="grid gap-4 sm:grid-cols-2">
        <LinkButton to={congressPath(slug, "details")} variant="secondary" size="md">ℹ️ {t.navCongressDetails}</LinkButton>
        <LinkButton to={congressPath(slug, "my-profile")} variant="secondary" size="md">👤 {t.navMyProfile}</LinkButton>
      </div>

      {overview.otherCongresses.length > 0 && (
        <Card className="p-5 border-border-default space-y-2">
          <h2 className="text-sm font-bold text-text-primary">{isRtl ? "همایش‌های دیگر شما" : "Your other congresses"}</h2>
          <ul className="space-y-1">
            {overview.otherCongresses.map((e) => (
              <li key={e.event_id}>
                <Link to={congressPath(e.event_slug, "my-congress")} className="inline-flex py-2 text-sm font-semibold text-action-primary hover:underline">
                  {e.event_name} {isRtl ? "←" : "→"}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
