import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { useAttendeeLocale } from "../lib/i18n";
import { useCongressEvent } from "../lib/congressContext";
import { GUEST_AGENDA_OWNER } from "../lib/agenda";
import { getAuthenticatedUserId } from "../lib/ticketCache";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { LoadingBlock, StatusPanel } from "../components/ui/PortalState";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { CongressDetailsView } from "../components/attendee/CongressDetailsView";
import { panelLabels, publishedPage } from "../components/attendee/panelContent";

/** Public congress information, read anonymously; no attendee credential is sent. */
export default function CongressDetails() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { hash } = useLocation();
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;
  const congress = useCongressEvent(slug);
  const { token } = useAttendeeSession();
  // The personal agenda is kept per attendee on this device; signed out, a guest agenda.
  const agendaOwner = getAuthenticatedUserId(token) ?? GUEST_AGENDA_OWNER;
  const event = congress.status === "ready" ? congress.event : null;
  const page = useMemo(() => (event ? publishedPage(event) : null), [event]);
  const labels = useMemo(() => (page ? panelLabels(page.doc, locale) : null), [page, locale]);
  const ready = event !== null;

  // Deep links such as "#program" (from the home schedule) land on their section once it exists.
  useEffect(() => {
    if (ready && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);

  let content;
  if (congress.status === "missing") {
    content = (
      <div className="mx-auto max-w-3xl">
        <StatusPanel icon="search" title={isRtl ? "همایش پیدا نشد" : "Congress not found"}>
          <LinkButton to="/my-tickets" variant="secondary" size="md">
            {t.myPasses}
          </LinkButton>
        </StatusPanel>
      </div>
    );
  } else if (congress.status === "error") {
    content = (
      <div className="mx-auto max-w-3xl">
        <StatusPanel tone="danger" icon="alert" title={isRtl ? "اطلاعات همایش بارگذاری نشد" : "Could not load this congress"}>
          <p>{isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again."}</p>
          <Button type="button" variant="secondary" size="md" onClick={() => window.location.reload()}>
            <Icon name="sync" size={16} />
            {isRtl ? "تلاش دوباره" : "Try again"}
          </Button>
        </StatusPanel>
      </div>
    );
  } else if (!event || !page || !labels) {
    content = <LoadingBlock label={t.navCongressDetails} />;
  } else {
    content = <CongressDetailsView event={event} page={page} labels={labels} locale={locale} t={t} agendaOwner={agendaOwner} />;
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="details">
      <div className="mx-auto max-w-6xl space-y-10 px-4 pt-6 sm:space-y-14 sm:px-6 sm:pt-10">{content}</div>
    </AttendeeLayout>
  );
}
