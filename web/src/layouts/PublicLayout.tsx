import React from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { SkipLink } from "../components/ui/SkipLink";
import { LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { LanguageToggle } from "../components/ui/LanguageToggle";
import { AitebAttribution, AitebLogo } from "../components/brand/Aiteb";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { eventAccentStyle, type AccentSpec } from "../lib/eventAccent";
import { signInPath } from "../lib/safeRedirect";
import { publicCopy, type PublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import type { PageImage } from "../lib/pageDocument";
import "../styles/public.css";

interface PublicLayoutProps {
  children?: React.ReactNode;
  /** Page language (visitor choice, else the congress's own language, else Persian). */
  locale: PublicLocale;
  /** Switches the page language; the choice is remembered for the public pages and the portals. */
  onLocaleChange: (locale: PublicLocale) => void;
  /** Congress name once known; congress pages (/e/:slug…) show the congress identity in the shell. */
  congressName?: string;
  /** Congress shown outside `/e/:slug` (the Page Studio preview). Defaults to the slug in the URL. */
  congressSlug?: string;
  /** Organizer branding from the published (or previewed) page. */
  brand?: { accent?: AccentSpec; logo?: PageImage | null };
}

/** The congress mark in the shell: the organizer's logo on a white tile, else a plain congress tile. */
function CongressMark({ brand }: { brand?: PublicLayoutProps["brand"] }) {
  if (brand?.logo) {
    return (
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-control bg-white p-1">
        <img src={brand.logo.url} alt="" width={brand.logo.width} height={brand.logo.height} decoding="async" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-control bg-white/10 text-white">
      <Icon name="congress" size={20} />
    </span>
  );
}

const DIRECTION = { fa: "rtl", en: "ltr" } as const;

const footerLink = "inline-flex min-h-11 items-center text-body-sm text-ink-200 hover:text-white transition-colors";

/**
 * The shell of the public pages. A congress page (`/e/:slug…`) leads with the congress: its mark and name, the
 * language switch and one attendee button. The platform home carries the platform name and the language switch.
 */
export function PublicLayout({ children, locale, onLocaleChange, congressName, congressSlug, brand }: PublicLayoutProps) {
  const location = useLocation();
  // Event pages (/e/:slug…) sign in straight back to that congress's portal.
  const eventSlug = congressSlug ?? /^\/e\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  const signInTarget = eventSlug ? signInPath(eventSlug, `/c/${eventSlug}/my-congress`) : "/sign-in";
  const { signedIn } = useAttendeeSession();
  // Inside a congress the attendee button opens that congress's own pass.
  const passPath = eventSlug ? `/c/${eventSlug}/my-ticket` : "/me";

  const c = publicCopy[locale];
  const dir = DIRECTION[locale];
  const congress = Boolean(eventSlug);

  return (
    <div
      dir={dir}
      lang={locale}
      style={congress ? eventAccentStyle(eventSlug, brand?.accent) : undefined}
      className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans"
    >
      <SkipLink targetId="main-content">{c.skipToContent}</SkipLink>

      {congress ? (
        <header className="surface-ink sticky top-0 z-40 border-b border-white/8 bg-surface-ink/95 pt-safe text-white backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
            <Link
              to={`/e/${eventSlug}`}
              className="flex min-w-0 items-center gap-3 rounded-control"
              aria-label={c.congressHomeLabel(congressName || eventSlug!)}
            >
              <CongressMark brand={brand} />
              {congressName ? (
                <span className="min-w-0 truncate text-body-sm font-semibold text-white">
                  <Bidi text={congressName} />
                </span>
              ) : congressName === undefined ? (
                <span aria-hidden="true" className="h-3.5 w-40 rounded-full bg-white/10" />
              ) : null}
            </Link>

            <div className="flex shrink-0 items-center gap-1">
              <LanguageToggle locale={locale} onChange={onLocaleChange} tone="ink" />
              {signedIn ? (
                <LinkButton to={passPath} variant="secondary" tone="ink" size="sm" icon="ticket">
                  {c.myPass}
                </LinkButton>
              ) : (
                <LinkButton to={signInTarget} variant="secondary" tone="ink" size="sm" icon="user" aria-label={c.attendeeSignIn}>
                  <span className="sm:hidden">{c.signInShort}</span>
                  <span className="max-sm:hidden">{c.attendeeSignIn}</span>
                </LinkButton>
              )}
            </div>
          </div>
        </header>
      ) : (
        <header className="sticky top-0 z-40 border-b border-border-default bg-surface-panel/90 pt-safe backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
            <Link to="/" className="flex items-center gap-3 rounded-control" aria-label={c.platformHomeLabel}>
              <AitebLogo alt="" className="h-8 w-auto" />
              <span aria-hidden="true" className="hidden h-6 w-px bg-border-default sm:block" />
              <span className="hidden text-body-sm font-semibold text-text-primary sm:block">{c.platformName}</span>
            </Link>
            <LanguageToggle locale={locale} onChange={onLocaleChange} />
          </div>
        </header>
      )}

      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children ?? <Outlet />}
      </main>

      <footer className="surface-ink bg-surface-ink text-ink-200">
        <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 sm:px-6 lg:px-10">
          {congress ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <p className="text-body font-semibold text-white">{congressName ? <Bidi text={congressName} /> : " "}</p>
                <p className="text-body-sm">{c.footerCongressNote}</p>
              </div>
              <Link to={signedIn ? passPath : signInTarget} className={footerLink}>
                {signedIn ? c.myPass : c.findMyPass}
              </Link>
            </div>
          ) : (
            <nav aria-label={c.footerNav} className="grid grid-cols-2 gap-8 sm:max-w-md">
              <div>
                <p className="text-caption font-semibold text-white">{c.footerAttendees}</p>
                <ul>
                  <li><Link to="/me" className={footerLink}>{c.footerPasses}</Link></li>
                </ul>
              </div>
              <div>
                <p className="text-caption font-semibold text-white">{c.footerStaff}</p>
                <ul>
                  <li><Link to="/organizer" className={footerLink}>{c.organizerConsole}</Link></li>
                  <li><Link to="/reception" className={footerLink}>{c.footerReception}</Link></li>
                </ul>
              </div>
            </nav>
          )}
          <div className="border-t border-white/10 pt-6">
            <AitebAttribution locale={locale} tone="dark" />
          </div>
        </div>
      </footer>
    </div>
  );
}
