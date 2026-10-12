import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAttendeeLocale, type AttendeeLocaleContext } from "../lib/i18n";
import { SkipLink } from "../components/ui/SkipLink";
import { Button } from "../components/ui/Button";
import { clearOwnerScopedTickets } from "../lib/ticketCache";
import { ATTENDEE_TOKEN_STORAGE } from "../api/client";
import {
  ATTENDEE_DESTINATIONS,
  congressPath,
  useCongressEvent,
  type AttendeeDestination,
} from "../lib/congressContext";

interface AttendeeLayoutProps {
  children?: React.ReactNode;
  activeTab?: "tickets" | "network";
  localeProps?: AttendeeLocaleContext;
  /** When set, the layout is the five-destination Attendee Portal shell for this congress. */
  eventSlug?: string;
  destination?: AttendeeDestination;
}

const DESTINATION_ICONS: Record<AttendeeDestination, string> = {
  "my-congress": "🏛️",
  "my-network": "🤝",
  "my-ticket": "🎫",
  "my-profile": "👤",
  details: "ℹ️",
};

function ShellNav({ slug, active, labels, variant }: {
  slug: string;
  active?: AttendeeDestination;
  labels: Record<AttendeeDestination, string>;
  variant: "top" | "bottom";
}) {
  if (variant === "top") {
    return (
      <nav aria-label={labels["my-congress"]} className="hidden md:flex items-center gap-1 p-1 bg-surface-panel-subtle rounded-xl border border-border-subtle">
        {ATTENDEE_DESTINATIONS.map((d) => (
          <Link
            key={d}
            to={congressPath(slug, d)}
            aria-current={active === d ? "page" : undefined}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
              active === d ? "bg-surface-panel text-action-primary shadow-xs border border-border-subtle" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {labels[d]}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav
      aria-label={labels["my-congress"]}
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-t border-border-default pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5">
        {ATTENDEE_DESTINATIONS.map((d) => (
          <li key={d} className="min-w-0">
            <Link
              to={congressPath(slug, d)}
              aria-current={active === d ? "page" : undefined}
              className={`min-h-14 px-0.5 py-1.5 flex flex-col items-center justify-center gap-0.5 text-[10px] leading-tight font-semibold text-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring ${
                active === d ? "text-action-primary" : "text-text-secondary"
              }`}
            >
              <span aria-hidden="true" className={`text-lg leading-none rounded-full px-3 py-0.5 ${active === d ? "bg-action-subtle" : ""}`}>
                {DESTINATION_ICONS[d]}
              </span>
              <span className="w-full break-words">{labels[d]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AttendeeLayout({ children, activeTab, localeProps, eventSlug, destination }: AttendeeLayoutProps) {
  const localHook = useAttendeeLocale();
  const { locale, setLocale, t, isRtl, dir } = localeProps || localHook;
  const location = useLocation();
  const navigate = useNavigate();
  const congress = useCongressEvent(eventSlug);
  const shellLabels: Record<AttendeeDestination, string> = {
    "my-congress": t.navMyCongress,
    "my-network": t.navMyNetwork,
    "my-ticket": t.navMyTicket,
    "my-profile": t.navMyProfile,
    details: t.navCongressDetails,
  };

  const currentTab = activeTab || (location.pathname.includes("/my-network") ? "network" : "tickets");

  const handleLogout = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE) : null;
    clearOwnerScopedTickets(token);
    if (typeof window !== "undefined") {
      localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    }
    navigate("/");
  };

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  return (
    <div
      dir={dir}
      lang={locale}
      className={`min-h-screen bg-surface-page text-text-primary flex flex-col font-sans selection:bg-action-subtle selection:text-action-primary ${
        isRtl ? "text-start font-sans" : "text-start font-sans"
      }`}
    >
      <SkipLink targetId="attendee-main-content">
        {isRtl ? "پرش به محتوای اصلی کارت ورود" : "Skip to main attendee pass content"}
      </SkipLink>

      {/* Attendee Portal Header */}
      <header className="sticky top-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-b border-border-default">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand & Attendee Portal Identity */}
          <Link
            to={eventSlug ? congressPath(eventSlug, "my-congress") : "/my-tickets"}
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-focus-ring"
            aria-label={t.digitalPassTitle}
          >
            <span className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-base shadow-xs shrink-0">
              <svg
                className="w-4 h-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </span>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm sm:text-base tracking-tight text-text-primary leading-tight">
                {t.attendeePortal}
              </span>
              <span className={`text-[11px] text-text-muted font-normal leading-tight truncate max-w-[45vw] ${eventSlug ? "" : "hidden sm:inline"}`}>
                {eventSlug
                  ? (congress.status === "ready" ? congress.event.name : "…")
                  : isRtl ? "سامانه شرکت‌کنندگان" : "Attendee Pass & Network"}
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Tabs */}
          {eventSlug ? <ShellNav slug={eventSlug} active={destination} labels={shellLabels} variant="top" /> : (
          <nav aria-label={t.attendeePortal} className="hidden sm:flex items-center gap-1.5 p-1 bg-surface-panel-subtle rounded-xl border border-border-subtle">
            <Link
              to="/my-tickets"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-focus-ring ${
                currentTab === "tickets"
                  ? "bg-surface-panel text-action-primary shadow-xs border border-border-subtle"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              🎫 {t.myPasses}
            </Link>
            <Link
              to="/my-network"
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all focus-visible:outline-2 focus-visible:outline-focus-ring ${
                currentTab === "network"
                  ? "bg-surface-panel text-action-primary shadow-xs border border-border-subtle"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              🤝 {t.myNetwork}
            </Link>
          </nav>
          )}

          {/* Controls: Language Switcher & Logout */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-surface-panel-subtle hover:bg-surface-page text-text-secondary border border-border-default transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              🌐 {t.languageToggle}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              {t.logout}
            </Button>
          </div>
        </div>

        {/* Mobile Sub-Navigation Bar */}
        {!eventSlug && (
        <div className="sm:hidden border-t border-border-subtle bg-surface-panel px-4 py-2 flex items-center justify-around gap-2">
          <Link
            to="/my-tickets"
            className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-colors ${
              currentTab === "tickets"
                ? "bg-action-subtle text-action-primary border border-action-subtle-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            🎫 {t.myPasses}
          </Link>
          <Link
            to="/my-network"
            className={`flex-1 py-2 text-center text-xs font-bold rounded-lg transition-colors ${
              currentTab === "network"
                ? "bg-action-subtle text-action-primary border border-action-subtle-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            🤝 {t.myNetwork}
          </Link>
        </div>
        )}
      </header>

      {/* Main Attendee Content Area */}
      <main id="attendee-main-content" tabIndex={-1} className={`flex-1 focus:outline-none ${eventSlug ? "pb-24 md:pb-0" : ""}`}>
        {children}
      </main>

      {/* Dedicated Attendee Security & Trust Footer */}
      <footer className={`border-t border-border-default bg-surface-panel text-text-secondary py-8 mt-12 ${eventSlug ? "mb-20 md:mb-0" : ""}`}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-4 text-center sm:text-start">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-muted">
            <p>
              {isRtl
                ? "کارت ورود دیجیتال • نگهداری در حافظه امن دستگاه جهت استفاده آفلاین در گیت‌های بازرسی"
                : "Digital Pass Portal • Stored under owner-scoped local storage for offline venue access."}
            </p>
            <Link to="/" className="text-action-primary hover:underline font-medium">
              {t.platformHome} →
            </Link>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed">
            {isRtl
              ? "هشدار امنیتی: حافظه موقت مرورگر شامل شناسه محرمانه کیوآرکد است. از ورود در رایانه‌های عمومی و اشتراکی خودداری فرمایید."
              : "Privacy Advisory: Browser storage contains your reusable QR credential. Log out when using shared computers."}
          </p>
        </div>
      </footer>
      {eventSlug && <ShellNav slug={eventSlug} active={destination} labels={shellLabels} variant="bottom" />}
    </div>
  );
}
