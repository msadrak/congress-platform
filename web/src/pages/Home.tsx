import { useMemo } from "react";
import { PublicLayout } from "../layouts/PublicLayout";
import { LinkButton } from "../components/ui/Button";
import { usePublicLocale } from "../components/public/copy";
import { PublicEventList } from "../components/public/PublicEventList";
import { homeCopy } from "../copy/public";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { usePageTitle } from "../hooks/usePageTitle";
import { loadLinkPasses } from "../lib/linkPass";

/**
 * The platform home: one heading and line, the way to the organizer console and to the visitor's own passes,
 * then the listed congresses. Staff entries sit in the footer.
 */
export default function Home() {
  const { locale, setLocale } = usePublicLocale();
  const h = homeCopy[locale];
  const { signedIn } = useAttendeeSession();
  // A session or a pass opened from an SMS link on this device: the button names what is already there.
  const hasPasses = useMemo(() => signedIn || loadLinkPasses(undefined).length > 0, [signedIn]);
  usePageTitle(h.pageTitle);
  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale}>
      <section aria-labelledby="home-title" className="border-b border-border-default bg-surface-panel">
        <div className="mx-auto max-w-7xl space-y-5 px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
          <h1 id="home-title" className="text-title-lg font-bold tracking-tight text-text-primary sm:text-display">
            {h.title}
          </h1>
          <p className="max-w-xl text-body text-text-secondary">{h.lead}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <LinkButton to="/organizer" variant="primary" size="lg" iconEnd="arrow-right">
              {h.ctaOrganizer}
            </LinkButton>
            <LinkButton to="/me" variant="secondary" size="lg" icon="ticket" data-testid="home-passes">
              {hasPasses ? h.ctaMyPasses : h.ctaFindPass}
            </LinkButton>
          </div>
        </div>
      </section>

      <div id="congresses" className="scroll-mt-20 bg-surface-page">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14 lg:px-10">
          <PublicEventList locale={locale} emptyText={h.listEmpty} />
        </div>
      </div>
    </PublicLayout>
  );
}
