import { useNavigate } from "react-router-dom";
import { Button, LinkButton } from "../components/ui/Button";
import { StatusPanel } from "../components/ui/PortalState";
import { AitebAttribution } from "../components/brand/Aiteb";
import { useAttendeeLocale } from "../lib/i18n";
import { usePageTitle } from "../hooks/usePageTitle";

/**
 * Any address the app does not know. Most visitors are attendees following a link, so the way on is
 * back or the attendee sign-in, never the platform overview.
 */
export default function NotFound() {
  const { locale, t, dir } = useAttendeeLocale();
  const navigate = useNavigate();
  usePageTitle(t.notFoundTitle);
  // Opened straight from a link there is nothing to go back to; sign-in is the way on.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate("/sign-in"));

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-surface-page text-text-primary font-sans text-start flex flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6">
        <StatusPanel icon="search" title={t.notFoundTitle}>
          <p>{t.notFoundDesc}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {/* `arrow-left` is "back" in both directions: the icon mirrors itself in RTL. */}
            <Button type="button" variant="secondary" icon="arrow-left" onClick={goBack} data-testid="not-found-back">
              {t.notFoundBack}
            </Button>
            <LinkButton to="/sign-in" icon="ticket">
              {t.notFoundSignIn}
            </LinkButton>
          </div>
        </StatusPanel>
        <div className="flex justify-center">
          <AitebAttribution locale={locale} />
        </div>
      </main>
    </div>
  );
}
