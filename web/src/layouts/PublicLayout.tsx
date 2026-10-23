import React, { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { SkipLink } from "../components/ui/SkipLink";
import { LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { AitebAttribution, AitebLogo } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { useAttendeeToken } from "../lib/attendeeSession";
import { eventAccentStyle } from "../lib/eventAccent";
import { signInPath } from "../lib/safeRedirect";
import { publicCopy, type PublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import type { AccentChoice, PageImage } from "../lib/pageDocument";
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
  brand?: { accent?: AccentChoice; logo?: PageImage | null };
}

/** The congress mark in the shell: the organizer's logo on a white tile, else the generative signature. */
function CongressMark({ slug, brand, size }: { slug: string; brand?: PublicLayoutProps["brand"]; size: "header" | "footer" }) {
  const box = size === "header" ? "size-9 rounded-[10px] [border-start-end-radius:16px]" : "size-10 rounded-[10px] [border-start-end-radius:18px]";
  if (brand?.logo) {
    return (
      <span aria-hidden="true" className={`grid shrink-0 place-items-center overflow-hidden bg-white p-1 ring-1 ring-white/15 ${box}`}>
        <img src={brand.logo.url} alt="" width={brand.logo.width} height={brand.logo.height} decoding="async" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`relative shrink-0 overflow-hidden ring-1 ring-white/15 ${box}`}>
      <CongressSignature seed={slug} accent={brand?.accent} tone="ink" className="absolute inset-0 size-full scale-[1.6]" />
    </span>
  );
}

const navLinkLight =
  "inline-flex items-center min-h-[40px] px-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle transition-colors";
const navLinkInk =
  "inline-flex items-center min-h-[40px] px-3 rounded-lg text-sm font-medium text-ink-200 hover:text-white hover:bg-white/8 transition-colors focus-visible:outline-aiteb-orchid";
const footerLink = "inline-flex min-h-[32px] max-sm:min-h-11 items-center text-sm text-ink-300 hover:text-white transition-colors focus-visible:outline-aiteb-orchid";

export function PublicLayout({ children, locale, onLocaleChange, congressName, congressSlug, brand }: PublicLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  // Event pages (/e/:slug…) sign in straight back to that congress's portal.
  const eventSlug = congressSlug ?? /^\/e\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  const signInTarget = eventSlug ? signInPath(eventSlug, `/c/${eventSlug}/my-congress`) : "/sign-in";
  const signedIn = useAttendeeToken() !== null;
  // Inside a congress the attendee links open that congress's own pass and network.
  const passPath = eventSlug ? `/c/${eventSlug}/my-ticket` : "/my-tickets";
  const networkPath = eventSlug ? `/c/${eventSlug}/my-network` : "/my-network";
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMobileMenuOpen(false);
  }
  // Handle escape key to close mobile menu
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  const c = publicCopy[locale];
  const isRtl = locale === "fa";
  const congress = Boolean(eventSlug);
  const closeMenu = () => setMobileMenuOpen(false);
  const nextLocale: PublicLocale = isRtl ? "en" : "fa";
  const languageButton = (tone: "ink" | "light", extra = "") => (
    <button
      type="button"
      onClick={() => onLocaleChange(nextLocale)}
      aria-label={c.switchLanguageLabel}
      lang={nextLocale}
      className={`inline-flex min-h-[40px] max-sm:min-h-11 max-sm:min-w-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors cursor-pointer ${
        tone === "ink"
          ? "text-ink-200 hover:text-white hover:bg-white/8 focus-visible:outline-aiteb-orchid"
          : "text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle focus-visible:outline-2 focus-visible:outline-focus-ring"
      } ${extra}`}
    >
      <Icon name="globe" size={18} />
      <span>{c.switchLanguage}</span>
    </button>
  );

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      lang={locale}
      style={congress ? eventAccentStyle(eventSlug, brand?.accent) : undefined}
      className="min-h-screen bg-surface-page text-text-primary flex flex-col font-sans"
    >
      <SkipLink targetId="main-content">{isRtl ? "رفتن به محتوای اصلی" : "Skip to main content"}</SkipLink>

      {congress ? (
        /* ── Congress shell: the congress identity leads; the platform stays in the background. ── */
        <header className="sticky top-0 z-40 bg-surface-ink/95 text-white backdrop-blur-md border-b border-white/8 pt-safe">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-3">
            <Link
              to={`/e/${eventSlug}`}
              className="group flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-aiteb-orchid"
              aria-label={c.congressHomeLabel(congressName || eventSlug!)}
            >
              <CongressMark slug={eventSlug!} brand={brand} size="header" />
              {congressName ? (
                <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-white"><Bidi text={congressName} /></span>
              ) : congressName === undefined ? (
                <span aria-hidden="true" className="h-3.5 w-40 rounded-full bg-white/10" />
              ) : null}
            </Link>

            <div className="flex shrink-0 items-center gap-1">
              {signedIn && (
                <>
                  <nav aria-label={c.mainNav} className="hidden md:flex items-center gap-1">
                    <Link to={networkPath} className={navLinkInk}>
                      {c.myNetwork}
                    </Link>
                  </nav>
                  <span aria-hidden="true" className="hidden md:block mx-2 h-5 w-px bg-white/15" />
                </>
              )}
              {languageButton("ink", "max-sm:px-2.5 [&>span]:max-sm:hidden")}
              {signedIn ? (
                <LinkButton to={passPath} variant="light" size="sm" className="max-sm:px-3">
                  <Icon name="ticket" size={16} />
                  {c.myPass}
                </LinkButton>
              ) : (
                <LinkButton
                  to={signInTarget}
                  variant="light"
                  size="sm"
                  aria-label={c.attendeeSignIn}
                  className="max-sm:px-3"
                >
                  <Icon name="user" size={16} />
                  <span className="sm:hidden">{c.signInShort}</span>
                  <span className="max-sm:hidden">{c.attendeeSignIn}</span>
                </LinkButton>
              )}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden ms-1 grid size-11 place-items-center rounded-xl text-ink-200 hover:text-white hover:bg-white/8 focus-visible:outline-aiteb-orchid cursor-pointer"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-nav"
                aria-label={mobileMenuOpen ? c.closeMenu : c.openMenu}
              >
                <Icon name={mobileMenuOpen ? "x" : "menu"} size={22} />
              </button>
            </div>
          </div>

          {mobileMenuOpen && (
            <nav
              id="mobile-nav"
              aria-label={c.mobileNav}
              className="md:hidden border-t border-white/8 bg-surface-ink px-4 pt-3 pb-6 motion-safe:animate-fade"
            >
              <ul className="divide-y divide-white/8">
                {[
                  signedIn
                    ? { to: passPath, label: c.myPass, icon: "ticket" as const }
                    : { to: signInTarget, label: c.attendeeSignIn, icon: "user" as const },
                  { to: networkPath, label: c.myNetwork, icon: "users" as const },
                ].map((item) => (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      onClick={closeMenu}
                      className="flex min-h-[52px] items-center gap-3 text-base font-medium text-white focus-visible:outline-aiteb-orchid"
                    >
                      <Icon name={item.icon} size={20} className="text-aiteb-orchid" />
                      <span className="flex-1">{item.label}</span>
                      <Icon name="chevron-right" size={18} className="text-ink-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </header>
      ) : (
        /* ── Platform shell: AIteb identity, platform navigation. ── */
        <header className="sticky top-0 z-40 bg-surface-panel/90 backdrop-blur-md border-b border-border-default pt-safe">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center justify-between gap-4">
            <Link
              to="/"
              className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              aria-label={c.platformHomeLabel}
            >
              <AitebLogo alt="" className="h-8 w-auto" />
              <span aria-hidden="true" className="hidden sm:block h-6 w-px bg-border-default" />
              <span className="hidden sm:block text-sm font-semibold tracking-[-0.01em] text-text-primary">{c.platformName}</span>
            </Link>

            <nav aria-label={c.mainNav} className="hidden lg:flex items-center gap-1">
              <a href="#capabilities" className={navLinkLight}>
                {c.navCapabilities}
              </a>
              <a href="#roles" className={navLinkLight}>
                {c.navRoles}
              </a>
              <a href="#architecture" className={navLinkLight}>
                {c.navArchitecture}
              </a>
              <span aria-hidden="true" className="mx-2 h-5 w-px bg-border-default" />
              <Link to="/my-tickets" className={navLinkLight}>
                {c.myTickets}
              </Link>
              <Link to="/my-network" className={navLinkLight}>
                {c.myNetwork}
              </Link>
            </nav>

            <div className="flex items-center gap-2">
              {languageButton("light", "max-sm:px-2.5 [&>span]:max-sm:hidden")}
              <LinkButton to={signInTarget} variant="outline" size="sm" className="max-sm:hidden">
                {c.attendeeSignIn}
              </LinkButton>
              <LinkButton to="/organizer" variant="ink" size="sm" className="max-sm:hidden">
                {c.organizerConsole}
                <Icon name="arrow-right" size={16} />
              </LinkButton>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden grid size-11 place-items-center rounded-xl text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-nav"
                aria-label={mobileMenuOpen ? c.closeMenu : c.openMenu}
              >
                <Icon name={mobileMenuOpen ? "x" : "menu"} size={22} />
              </button>
            </div>
          </div>

          {mobileMenuOpen && (
            <nav
              id="mobile-nav"
              aria-label={c.mobileNav}
              className="lg:hidden border-t border-border-default bg-surface-panel px-4 pt-2 pb-6 shadow-lift motion-safe:animate-fade"
            >
              <ul className="divide-y divide-border-subtle">
                {[
                  { href: "#capabilities", label: c.menuCapabilities },
                  { href: "#roles", label: c.menuRoles },
                  { href: "#architecture", label: c.menuArchitecture },
                ].map((item) => (
                  <li key={item.href}>
                    <a href={item.href} onClick={closeMenu} className="flex min-h-[52px] items-center justify-between text-base font-medium text-text-primary">
                      {item.label}
                      <Icon name="chevron-down" size={18} className="text-text-muted" />
                    </a>
                  </li>
                ))}
                {[
                  { to: "/my-tickets", label: c.menuPasses },
                  { to: "/my-network", label: c.myNetwork },
                  { to: signInTarget, label: c.attendeeSignIn },
                ].map((item) => (
                  <li key={item.label}>
                    <Link to={item.to} onClick={closeMenu} className="flex min-h-[52px] items-center justify-between text-base font-medium text-text-primary">
                      {item.label}
                      <Icon name="chevron-right" size={18} className="text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              <LinkButton to="/organizer" variant="ink" size="lg" isFullWidth onClick={closeMenu} className="mt-4">
                {c.organizerConsole}
                <Icon name="arrow-right" size={18} />
              </LinkButton>
            </nav>
          )}
        </header>
      )}

      {/* Main Content Area */}
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children ?? <Outlet />}
      </main>

      {/* Footer */}
      <footer className="relative overflow-hidden bg-surface-ink text-ink-300">
        <div aria-hidden="true" className="absolute inset-0 bg-meridian-ink opacity-60" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[image:var(--grad-aiteb)] opacity-70" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 pt-14 pb-10 sm:pt-16">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-8">
            <div className="md:col-span-5 space-y-4">
              {congress ? (
                <>
                  <div className="flex items-center gap-3">
                    <CongressMark slug={eventSlug!} brand={brand} size="footer" />
                    <p className="text-base font-semibold text-white">{congressName ? <Bidi text={congressName} /> : "\u00a0"}</p>
                  </div>
                  <p className="max-w-md text-sm leading-relaxed">{c.footerCongressNote}</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold tracking-[-0.01em] text-white">{c.platformName}</p>
                  <p className="max-w-md text-sm leading-relaxed">{c.platformFooterBody}</p>
                  <p className="max-w-md text-xs leading-relaxed text-ink-400">
                    {c.platformFooterPrivateLead}
                    {c.platformFooterPrivateTail}
                  </p>
                </>
              )}
            </div>

            <div className="md:col-span-7 grid grid-cols-2 gap-8 sm:grid-cols-3">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-white">{c.footerAttendees}</p>
                <ul className="space-y-1">
                  {congress ? (
                    <li><Link to={signedIn ? passPath : signInTarget} className={footerLink}>{signedIn ? c.myPass : c.attendeeSignIn}</Link></li>
                  ) : (
                    <li><Link to="/my-tickets" className={footerLink}>{c.footerPasses}</Link></li>
                  )}
                  <li><Link to={networkPath} className={footerLink}>{c.footerNetwork}</Link></li>
                </ul>
              </div>
              {/* Staff and platform entries stay on the platform home; attendee pages never show them. */}
              {!congress && (
                <>
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-white">{c.footerStaff}</p>
                  <ul className="space-y-1">
                    <li><Link to="/organizer" className={footerLink}>{c.organizerConsole}</Link></li>
                    <li><Link to="/reception" className={footerLink}>{c.footerReception}</Link></li>
                  </ul>
                </div>
                <div className="space-y-3 col-span-2 sm:col-span-1">
                  <p className="text-xs font-semibold text-white">{c.footerPlatform}</p>
                  <ul className="space-y-1">
                    <li><a href="#capabilities" className={footerLink}>{c.footerCapabilities}</a></li>
                    <li><a href="#roles" className={footerLink}>{c.footerRoles}</a></li>
                    <li><a href="#architecture" className={footerLink}>{c.footerArchitecture}</a></li>
                  </ul>
                </div>
                </>
              )}
            </div>
          </div>

          <div className="mt-12 flex flex-col-reverse gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <AitebAttribution locale={locale} tone="dark" />
            <p className="text-xs text-ink-400">{congress ? c.footerPrivate : c.platformTagline}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
