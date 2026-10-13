import React, { useState, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { SkipLink } from "../components/ui/SkipLink";
import { LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { AitebAttribution, AitebLogo } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { eventAccentStyle } from "../lib/eventAccent";
import { signInPath } from "../lib/safeRedirect";
import { publicCopy, type PublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import "../styles/public.css";

interface PublicLayoutProps {
  children?: React.ReactNode;
  /** Page language (visitor choice, else the congress's own language, else Persian). */
  locale: PublicLocale;
  /** Switches the page language; the choice is remembered for the public pages and the portals. */
  onLocaleChange: (locale: PublicLocale) => void;
  /** Congress name once known; congress pages (/e/:slug…) show the congress identity in the shell. */
  congressName?: string;
}

const navLinkLight =
  "inline-flex items-center min-h-[40px] px-3 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle transition-colors";
const navLinkInk =
  "inline-flex items-center min-h-[40px] px-3 rounded-lg text-sm font-medium text-ink-200 hover:text-white hover:bg-white/8 transition-colors focus-visible:outline-aiteb-orchid";
const footerLink = "inline-flex min-h-[32px] items-center text-sm text-ink-300 hover:text-white transition-colors focus-visible:outline-aiteb-orchid";

export function PublicLayout({ children, locale, onLocaleChange, congressName }: PublicLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  // Event pages (/e/:slug…) sign in straight back to that congress's portal.
  const eventSlug = /^\/e\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  const signInTarget = eventSlug ? signInPath(eventSlug, `/c/${eventSlug}/my-congress`) : "/sign-in";
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
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors cursor-pointer ${
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
      style={congress ? eventAccentStyle(eventSlug) : undefined}
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
              aria-label={congressName ? c.congressHomeLabel(congressName) : undefined}
            >
              <span aria-hidden="true" className="relative size-9 shrink-0 overflow-hidden rounded-[10px] [border-start-end-radius:16px] ring-1 ring-white/15">
                <CongressSignature seed={eventSlug!} tone="ink" className="absolute inset-0 size-full scale-[1.6]" />
              </span>
              {congressName ? (
                <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-white"><Bidi text={congressName} /></span>
              ) : (
                <span aria-hidden="true" className="h-3.5 w-40 rounded-full bg-white/10" />
              )}
            </Link>

            <div className="flex shrink-0 items-center gap-1">
              <nav aria-label={c.mainNav} className="hidden md:flex items-center gap-1">
                <Link to="/my-tickets" className={navLinkInk}>
                  {c.myTickets}
                </Link>
                <Link to="/my-network" className={navLinkInk}>
                  {c.myNetwork}
                </Link>
              </nav>
              <span aria-hidden="true" className="hidden md:block mx-2 h-5 w-px bg-white/15" />
              {languageButton("ink", "max-sm:px-2.5 [&>span]:max-sm:hidden")}
              <LinkButton
                to={signInTarget}
                variant="light"
                size="sm"
                aria-label={c.attendeeSignIn}
                className="max-sm:px-3 focus-visible:outline-aiteb-orchid"
              >
                <Icon name="user" size={16} />
                <span className="sm:hidden">{c.signInShort}</span>
                <span className="max-sm:hidden">{c.attendeeSignIn}</span>
              </LinkButton>
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
                  { to: "/my-tickets", label: c.myTickets, icon: "ticket" as const },
                  { to: "/my-network", label: c.myNetwork, icon: "users" as const },
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
              <Link
                to="/organizer"
                onClick={closeMenu}
                className="mt-4 flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/12 text-sm font-semibold text-ink-200 hover:bg-white/8 hover:text-white focus-visible:outline-aiteb-orchid"
              >
                {c.organizerConsole}
                <Icon name="arrow-right" size={16} />
              </Link>
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
                    <span aria-hidden="true" className="relative size-10 shrink-0 overflow-hidden rounded-[10px] [border-start-end-radius:18px] ring-1 ring-white/15">
                      <CongressSignature seed={eventSlug!} tone="ink" className="absolute inset-0 size-full scale-[1.6]" />
                    </span>
                    <p className="text-base font-semibold text-white">{congressName ? <Bidi text={congressName} /> : "\u00a0"}</p>
                  </div>
                  <p className="max-w-md text-sm leading-relaxed">{c.footerCongressNote}</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold tracking-[-0.01em] text-white">{c.platformName}</p>
                  <p className="max-w-md text-sm leading-relaxed">{c.platformFooterBody}</p>
                  <p className="max-w-md text-xs leading-relaxed text-ink-400">
                    {c.platformFooterPrivateLead} (<span className="font-mono text-ink-300 ltr-isolate">/e/:event-slug</span>)
                    {c.platformFooterPrivateTail}
                  </p>
                </>
              )}
            </div>

            <div className="md:col-span-7 grid grid-cols-2 gap-8 sm:grid-cols-3">
              <div className="space-y-3">
                <p className="text-xs font-semibold text-white">{c.footerAttendees}</p>
                <ul className="space-y-1">
                  <li><Link to="/my-tickets" className={footerLink}>{c.footerPasses}</Link></li>
                  <li><Link to="/my-network" className={footerLink}>{c.footerNetwork}</Link></li>
                </ul>
              </div>
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
                  {congress && <li><Link to="/" className={footerLink}>{c.footerPlatformHome}</Link></li>}
                  <li><a href={congress ? "/#capabilities" : "#capabilities"} className={footerLink}>{c.footerCapabilities}</a></li>
                  <li><a href={congress ? "/#roles" : "#roles"} className={footerLink}>{c.footerRoles}</a></li>
                  <li><a href={congress ? "/#architecture" : "#architecture"} className={footerLink}>{c.footerArchitecture}</a></li>
                </ul>
              </div>
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
