import { useNavigate } from "react-router-dom";
import { Button, LinkButton } from "../components/ui/Button";
import { StateBlock } from "../components/ui/StateBlock";
import { AitebAttribution } from "../components/brand/Aiteb";
import { linkPassCopy } from "../copy/linkPass";
import { useLocale } from "../lib/i18n";
import { usePageTitle } from "../hooks/usePageTitle";

/**
 * Any address the app does not know. Most visitors are attendees following a link, so the way on is
 * back or the attendee sign-in, never the platform overview.
 */
export default function NotFound() {
  const { locale, dir } = useLocale();
  const c = linkPassCopy[locale].notFound;
  const navigate = useNavigate();
  usePageTitle(c.title);
  // Opened straight from a link there is nothing to go back to; sign-in is the way on.
  const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate("/sign-in"));

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-surface-page text-text-primary font-sans text-start flex flex-col">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-4 py-12 sm:px-6">
        <div role="status">
          <StateBlock icon="search" headingLevel={1} title={c.title}>
            <p>{c.body}</p>
            <div className="flex flex-wrap justify-center gap-3">
              {/* `arrow-left` is "back" in both directions: the icon mirrors itself in RTL. */}
              <Button type="button" variant="secondary" icon="arrow-left" onClick={goBack} data-testid="not-found-back">
                {c.back}
              </Button>
              <LinkButton to="/sign-in" icon="ticket">
                {c.signIn}
              </LinkButton>
            </div>
          </StateBlock>
        </div>
        <div className="flex justify-center">
          <AitebAttribution locale={locale} />
        </div>
      </main>
    </div>
  );
}
