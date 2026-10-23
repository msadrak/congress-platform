import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { createApiClient } from "../api/client";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { useAttendeeLocale } from "../lib/i18n";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { useCongressEvent, useRevalidateOnFocus } from "../lib/congressContext";
import { attendeeCopy } from "../copy/attendee";
import { LinkButton } from "../components/ui/Button";
import { LoadingBlock } from "../components/ui/PortalState";
import { ErrorState, StateBlock } from "../components/ui/StateBlock";
import { BoothDirectory } from "../components/BoothDirectory";
import { CongressHomeView, type HomeOverview, type HomePersonal } from "../components/attendee/CongressHomeView";
import { panelLabels, publishedPage } from "../components/attendee/panelContent";

export default function MyCongress() {
  const { slug = "" } = useParams<{ slug: string }>();
  const localeHook = useAttendeeLocale();
  const { locale, isRtl } = localeHook;
  const copy = attendeeCopy[locale];
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
      <div className="mx-auto max-w-6xl space-y-8 px-4 pt-5 sm:space-y-10 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
  const narrow = (content: ReactNode) => shell(<div className="mx-auto max-w-3xl pt-6">{content}</div>);

  if (congress.status === "missing") {
    return narrow(
      <StateBlock
        icon="search"
        title={copy.program.notFoundTitle}
        body={copy.program.notFoundBody}
        action={
          <LinkButton to="/me" variant="secondary">
            {copy.program.back}
          </LinkButton>
        }
      />
    );
  }
  if (congress.status === "error") {
    return narrow(<ErrorState title={copy.program.loadFailedTitle} body={copy.program.loadFailedBody} onRetry={() => window.location.reload()} />);
  }
  if (!event || !page || !labels) return shell(<LoadingBlock label={copy.shell.tabs["my-congress"]} />);

  const signedOut = !token || (failed && !overview);
  const personal: HomePersonal = signedOut
    ? { status: "signed-out" }
    : overview
      ? { status: "ready", overview }
      : { status: "loading" };

  return shell(
    <CongressHomeView
      event={event}
      labels={labels}
      locale={locale}
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
