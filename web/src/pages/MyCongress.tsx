import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { useAttendeeLocale } from "../lib/i18n";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { congressPath, useCongressEvent, useRevalidateOnFocus } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { BoothDirectory } from "../components/BoothDirectory";
import { CongressHomeView, type HomeOverview, type HomePersonal } from "../components/attendee/CongressHomeView";
import { panelLabels, publishedPage } from "../components/attendee/panelContent";

export default function MyCongress() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;
  const congress = useCongressEvent(slug);
  const { token } = useAttendeeSession();
  const [overview, setOverview] = useState<HomeOverview | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped when the attendee returns to the tab: passes (tier names included) and counts are re-read.
  const [refreshKey, setRefreshKey] = useState(0);
  useRevalidateOnFocus(useCallback(() => setRefreshKey((k) => k + 1), []));

  const event = congress.status === "ready" ? congress.event : null;
  const eventId = event?.id ?? null;
  const page = useMemo(() => (event ? publishedPage(event) : null), [event]);
  const labels = useMemo(() => (page ? panelLabels(page.doc, locale) : null), [page, locale]);

  useEffect(() => {
    if (!token || !eventId) return;
    let active = true;
    const load = async () => {
      const client = createApiClient({ kind: "user", token });
      try {
        // The contact count comes from the paginated search (one row and its `total`), scoped to this congress.
        const [ticketsRes, networkRes, accessRes] = await Promise.all([
          client.GET("/api/attendees/me/tickets"),
          client.GET("/api/attendees/me/network/search", { params: { query: { event_id: eventId, limit: 1 } } }),
          client.GET("/api/me/access"),
        ]);
        if (!active) return;
        const states = [ticketsRes, networkRes, accessRes].map((r) => attendeeResponseState(token, r.response.status));
        if (states.includes("expired")) {
          // The API client already removed the token and this owner's cached passes.
          setOverview(null);
          setFailed(true);
          return;
        }
        if (!isStoredAttendeeToken(token)) return;
        const cache = loadOwnerScopedTickets(token);
        if (ticketsRes.data) saveOwnerScopedTickets(token, ticketsRes.data);
        const tickets = ticketsRes.data ?? (cache.status === "valid" ? cache.tickets : []);
        setOverview({
          // Every pass for this congress, not only the first.
          tickets: tickets.filter((tkt) => tkt.event_slug === slug),
          fromCache: !ticketsRes.data,
          connectionCount: networkRes.data ? networkRes.data.total : null,
          otherCongresses: (accessRes.data?.events ?? []).filter((e) => e.event_slug !== slug && e.roles.includes("ATTENDEE")),
        });
      } catch {
        // Network failure: the owner-scoped offline pass can still be presented. Without one the
        // attendee is still signed in, just offline, so the home view says what is unavailable.
        if (!active) return;
        const cache = loadOwnerScopedTickets(token);
        if (cache.status !== "valid") {
          // A failed refresh keeps the current overview.
          setOverview((current) => current ?? { tickets: [], fromCache: true, connectionCount: null, otherCongresses: [] });
          return;
        }
        setOverview((current) => ({
          tickets: cache.tickets.filter((tkt) => tkt.event_slug === slug),
          fromCache: true,
          connectionCount: current?.connectionCount ?? null,
          otherCongresses: current?.otherCongresses ?? [],
        }));
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [token, eventId, slug, refreshKey]);

  const shell = (content: ReactNode) => (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-congress">
      <div className="mx-auto max-w-6xl space-y-12 px-4 pt-5 sm:space-y-16 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
  const narrow = (content: ReactNode) => shell(<div className="mx-auto max-w-3xl pt-6">{content}</div>);

  if (congress.status === "missing") {
    return narrow(
      <StatusPanel icon="search" title={isRtl ? "همایش پیدا نشد" : "Congress not found"}>
        <LinkButton to="/my-tickets" variant="secondary" size="md">
          {t.myPasses}
        </LinkButton>
      </StatusPanel>
    );
  }
  if (congress.status === "error") {
    return narrow(
      <StatusPanel tone="danger" icon="alert" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
        <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
        <Button type="button" variant="secondary" size="md" onClick={() => window.location.reload()}>
          <Icon name="sync" size={16} />
          {isRtl ? "تلاش دوباره" : "Try again"}
        </Button>
      </StatusPanel>
    );
  }
  if (!event || !page || !labels) return shell(<LoadingBlock label={t.navMyCongress} />);

  const signedOut = !token || (failed && !overview);
  const personal: HomePersonal = signedOut
    ? { status: "signed-out", signInTo: signInPath(slug, congressPath(slug, "my-congress")) }
    : overview
      ? { status: "ready", overview }
      : { status: "loading" };

  return shell(
    <CongressHomeView
      event={event}
      page={page}
      labels={labels}
      locale={locale}
      t={t}
      personal={personal}
      booths={(index) => (
        <BoothDirectory
          slug={slug}
          eventId={event.id}
          token={signedOut ? null : token}
          isRtl={isRtl}
          index={index}
          title={labels.boothsTitle}
          lead={labels.boothsLead}
        />
      )}
    />
  );
}
