import React, { useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAttendeeLocale, type AttendeeLocaleContext } from "../lib/i18n";
import { SkipLink } from "../components/ui/SkipLink";
import { Icon, type IconName } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { ArcStroke } from "../components/attendee/ArcStroke";
import { clearOwnerScopedTickets } from "../lib/ticketCache";
import { eventAccentStyle } from "../lib/eventAccent";
import { ATTENDEE_TOKEN_STORAGE } from "../api/client";
import { signInPath } from "../lib/safeRedirect";
import {
  ATTENDEE_DESTINATIONS,
  congressPath,
  useCongressEvent,
  type AttendeeDestination,
} from "../lib/congressContext";
import "../styles/attendee.css";

interface AttendeeLayoutProps {
  children?: React.ReactNode;
  activeTab?: "tickets" | "network";
  localeProps?: AttendeeLocaleContext;
  /** When set, the layout is the five-destination Attendee Portal shell for this congress. */
  eventSlug?: string;
  destination?: AttendeeDestination;
}

const DESTINATION_ICONS: Record<AttendeeDestination, IconName> = {
  "my-congress": "congress",
  "my-network": "users",
  "my-ticket": "ticket",
  "my-profile": "user",
  details: "info",
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const headerAction = `press inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${focusRing}`;

/** Another tab signing in or out changes the stored token; this tab only hears it as a `storage` event. */
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Desktop navigation: quiet text tabs, the active one underlined by a brand arc. */
function TopNav({ slug, active, labels, navLabel }: {
  slug: string;
  active?: AttendeeDestination;
  labels: Record<AttendeeDestination, string>;
  navLabel: string;
}) {
  return (
    <nav
      aria-label={navLabel}
      className="hidden md:flex md:col-span-2 md:row-start-2 items-stretch gap-1 -mx-3"
    >
      {ATTENDEE_DESTINATIONS.map((d) => {
        const isActive = active === d;
        return (
          <Link
            key={d}
            to={congressPath(slug, d)}
            aria-current={isActive ? "page" : undefined}
            className={`group relative inline-flex min-h-12 items-center gap-2 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors ${focusRing} ${
              isActive ? "text-text-primary" : "text-text-muted hover:text-text-primary"
            }`}
          >
            <Icon
              name={DESTINATION_ICONS[d]}
              size={18}
              className={isActive ? "text-event-accent" : "text-ink-400 transition-colors group-hover:text-text-secondary"}
            />
            {labels[d]}
            {isActive && <ArcStroke className="pointer-events-none absolute inset-x-2 -bottom-px h-2.5 w-[calc(100%-1rem)]" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile navigation: a floating ink dock, safe-area aware, with an arc marker over the active destination. */
function Dock({ slug, active, labels, navLabel }: {
  slug: string;
  active?: AttendeeDestination;
  labels: Record<AttendeeDestination, string>;
  navLabel: string;
}) {
  return (
    <nav aria-label={navLabel} className="at-dock md:hidden fixed inset-x-0 bottom-0 z-40 print:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5 gap-0.5 rounded-[24px] bg-surface-ink p-1.5 shadow-pop ring-1 ring-white/10">
        {ATTENDEE_DESTINATIONS.map((d) => {
          const isActive = active === d;
          return (
            <li key={d} className="min-w-0">
              <Link
                to={congressPath(slug, d)}
                aria-current={isActive ? "page" : undefined}
                className={`press relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-[18px] px-0.5 pt-1.5 pb-1 text-center text-[11px] font-semibold leading-[1.15] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aiteb-orchid ${
                  isActive ? "bg-white/[0.08] text-white" : "text-ink-300 hover:text-white"
                }`}
              >
                {isActive && <ArcStroke bow="down" className="pointer-events-none absolute top-0.5 left-1/2 h-2 w-8 -translate-x-1/2" />}
                <Icon name={DESTINATION_ICONS[d]} size={21} strokeWidth={isActive ? 2 : 1.75} />
                <span className="w-full break-words">{labels[d]}</span>
              </Link>
            </li>
          );
        })}
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
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  // Re-read on every render and on another tab's change, so the header never offers "log out" to nobody.
  const signedIn = useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem(ATTENDEE_TOKEN_STORAGE) !== null,
    () => false,
  );
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
    setConfirmingLogout(false);
    // Back to this congress's sign-in: the platform home is not an attendee page.
    navigate(eventSlug ? `/c/${encodeURIComponent(eventSlug)}/sign-in` : "/sign-in");
  };

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  const congressName = eventSlug ? (congress.status === "ready" ? congress.event.name : null) : null;
  // The accent chosen in Page Studio (published) colours the whole panel; "auto" derives it from the slug.
  const accent = congress.status === "ready" ? congress.event.page?.document.branding?.accent : undefined;
  const legacyTabs: { key: "tickets" | "network"; to: string; icon: IconName; label: string }[] = [
    { key: "tickets", to: "/my-tickets", icon: "ticket", label: t.myPasses },
    { key: "network", to: "/my-network", icon: "users", label: t.myNetwork },
  ];

  return (
    <div
      dir={dir}
      lang={locale}
      style={eventSlug ? eventAccentStyle(eventSlug, accent) : undefined}
      className="at-shell min-h-screen bg-surface-page text-text-primary flex flex-col font-sans text-start"
    >
      <SkipLink targetId="attendee-main-content">
        {isRtl ? "پرش به محتوای اصلی" : "Skip to main content"}
      </SkipLink>

      <header className="at-print-collapse sticky top-0 z-40 border-b border-border-default bg-surface-page pt-safe">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 sm:px-6">
          {/* Congress identity */}
          <Link
            to={eventSlug ? congressPath(eventSlug, "my-congress") : "/my-tickets"}
            className={`flex h-16 min-w-0 items-center gap-3 rounded-xl ${focusRing}`}
          >
            <span className="relative size-10 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:18px] bg-surface-ink shadow-soft ring-1 ring-ink-900/10">
              {eventSlug ? (
                <CongressSignature seed={eventSlug} tone="ink" accent={accent} className="size-full" />
              ) : (
                <span className="grid size-full place-items-center text-white">
                  <Icon name="ticket" size={20} />
                </span>
              )}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[11px] font-semibold leading-tight text-text-muted">{t.attendeePortal}</span>
              <span dir="auto" className="max-w-full self-start truncate text-sm font-bold leading-tight tracking-[-0.01em] text-text-primary sm:text-[15px]">
                {eventSlug
                  ? (congressName ?? <span className="skeleton inline-block h-3.5 w-36 align-middle" />)
                  : isRtl ? "کارت‌های ورود و شبکه من" : "Passes & network"}
              </span>
            </span>
          </Link>

          {eventSlug && <TopNav slug={eventSlug} active={destination} labels={shellLabels} navLabel={t.attendeePortal} />}

          {/* Controls: language & log in / log out */}
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={toggleLocale}
              className={`press inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${focusRing}`}
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              <Icon name="globe" size={18} />
              <span lang={isRtl ? "en" : "fa"} className="max-[379px]:sr-only">{t.languageToggle}</span>
            </button>
            <span aria-hidden="true" className="h-5 w-px bg-border-default" />
            {signedIn ? (
              <button type="button" onClick={() => setConfirmingLogout(true)} className={headerAction}>
                <Icon name="logout" size={18} />
                <span className="sr-only sm:not-sr-only">{t.logout}</span>
              </button>
            ) : (
              <Link to={signInPath(eventSlug, location.pathname)} className={headerAction}>
                <Icon name="user" size={18} />
                <span className="sr-only sm:not-sr-only">{t.login}</span>
              </Link>
            )}
          </div>
        </div>

        {/* Legacy (congress-less) pages: passes & network tabs */}
        {!eventSlug && (
          <nav aria-label={t.attendeePortal} className="mx-auto flex max-w-6xl gap-1 px-4 sm:px-6">
            {legacyTabs.map((tab) => {
              const isActive = currentTab === tab.key;
              return (
                <Link
                  key={tab.key}
                  to={tab.to}
                  aria-current={isActive ? "page" : undefined}
                  className={`group relative inline-flex min-h-12 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors ${focusRing} ${
                    isActive ? "text-text-primary" : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  <Icon name={tab.icon} size={18} className={isActive ? "text-aiteb-indigo" : "text-ink-400"} />
                  {tab.label}
                  {isActive && <ArcStroke className="pointer-events-none absolute inset-x-2 -bottom-px h-2.5 w-[calc(100%-1rem)]" />}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <main id="attendee-main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className={`at-print-collapse mt-16 border-t border-border-default bg-surface-panel ${eventSlug ? "pb-32 md:pb-0" : ""}`}>
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="max-w-xl space-y-2">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
              <Icon name="shield" size={16} className="mt-0.5 text-aiteb-slate" />
              <span>
                {isRtl
                  ? "کارت ورود دیجیتال • نگهداری در حافظه امن دستگاه جهت استفاده آفلاین در گیت‌های بازرسی"
                  : "Digital Pass Portal • Stored under owner-scoped local storage for offline venue access."}
              </span>
            </p>
            <p className="ps-6 text-[11px] leading-relaxed text-text-muted">
              {isRtl
                ? "هشدار امنیتی: حافظه موقت مرورگر شامل شناسه محرمانه کیوآرکد است. از ورود در رایانه‌های عمومی و اشتراکی خودداری فرمایید."
                : "Privacy Advisory: Browser storage contains your reusable QR credential. Log out when using shared computers."}
            </p>
          </div>
          <div className="flex flex-col items-start gap-4 md:items-end">
            <AitebAttribution locale={locale} />
          </div>
        </div>
      </footer>
      {eventSlug && <Dock slug={eventSlug} active={destination} labels={shellLabels} navLabel={t.attendeePortal} />}
      <ConfirmDialog
        isOpen={confirmingLogout}
        title={isRtl ? "خروج از حساب در این دستگاه؟" : "Log out on this device?"}
        description={
          isRtl
            ? "کارت ورود ذخیره‌شده برای استفاده آفلاین از این دستگاه حذف می‌شود."
            : "Your saved offline pass will be removed from this device."
        }
        confirmLabel={isRtl ? "خروج" : "Log out"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
        tone="danger"
        onConfirm={handleLogout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </div>
  );
}
