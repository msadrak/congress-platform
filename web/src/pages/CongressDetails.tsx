import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { attendeeCopy } from "../copy/attendee";
import { useLocale } from "../lib/i18n";
import { useCongressEvent } from "../lib/congressContext";
import { GUEST_AGENDA_OWNER } from "../lib/agenda";
import { getAuthenticatedUserId } from "../lib/ticketCache";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { LinkButton } from "../components/ui/Button";
import { LoadingBlock } from "../components/ui/PortalState";
import { ErrorState, StateBlock } from "../components/ui/StateBlock";
import { CongressDetailsView } from "../components/attendee/CongressDetailsView";

/** Public congress information, read anonymously; no attendee credential is sent. */
export default function CongressDetails() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { hash } = useLocation();
  const localeHook = useLocale();
  const { locale } = localeHook;
  const c = attendeeCopy[locale].program;
  const congress = useCongressEvent(slug);
  const { token } = useAttendeeSession();
  // The personal agenda is kept per attendee on this device; signed out, a guest agenda.
  const agendaOwner = getAuthenticatedUserId(token) ?? GUEST_AGENDA_OWNER;
  const ready = congress.status === "ready";

  // Deep links such as "#program" (from the home schedule) land on their section once it exists.
  useEffect(() => {
    if (ready && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);

  let content;
  if (congress.status === "missing") {
    content = (
      <StateBlock
        icon="search"
        title={c.notFoundTitle}
        body={c.notFoundBody}
        action={
          <LinkButton to="/me" variant="secondary">
            {c.back}
          </LinkButton>
        }
      />
    );
  } else if (congress.status === "error") {
    content = <ErrorState title={c.loadFailedTitle} body={c.loadFailedBody} onRetry={() => window.location.reload()} />;
  } else if (congress.status === "ready") {
    content = <CongressDetailsView event={congress.event} locale={locale} agendaOwner={agendaOwner} />;
  } else {
    content = <LoadingBlock label={c.title} />;
  }

  return (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="details">
      <div className="mx-auto max-w-6xl space-y-8 px-4 pt-5 sm:space-y-10 sm:px-6 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
}
