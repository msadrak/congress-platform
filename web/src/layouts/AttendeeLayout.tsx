import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAttendeeLocale, type AttendeeLocaleContext } from "../lib/i18n";
import { SkipLink } from "../components/ui/SkipLink";
import { Icon, type IconName } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { ArcStroke } from "../components/attendee/ArcStroke";
import { eventAccentStyle } from "../lib/eventAccent";
import type { AccentName } from "../lib/pageDocument";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { usePageTitle } from "../hooks/usePageTitle";
import { signInPath } from "../lib/safeRedirect";
import { loadOwnerScopedTickets } from "../lib/ticketCache";
import { loadLinkPasses } from "../lib/linkPass";
import { groupCongresses, knownCongressName, type CongressCard } from "../lib/attendeePasses";
import { congressPath, useCongressEvent, type AttendeeDestination } from "../lib/congressContext";
import "../styles/attendee.css";

interface AttendeeLayoutProps {
  children?: React.ReactNode;
  /** @deprecated The congress-less pass and network pages became `/me`; ignored. */
  activeTab?: "tickets" | "network";
  localeProps?: AttendeeLocaleContext;
  /** When set, the layout is the congress panel shell (four tabs, profile and congress switcher) for this congress. */
  eventSlug?: string;
  destination?: AttendeeDestination;
}

/** The panel's four tabs, in order; the profile opens from the avatar in the header. */
const PANEL_TABS = ["my-congress", "details", "my-network", "my-ticket"] as const;
type PanelTab = (typeof PANEL_TABS)[number];

const TAB_ICONS: Record<PanelTab, IconName> = {
  "my-congress": "congress",
  details: "calendar",
  "my-network": "users",
  "my-ticket": "ticket",
};

const SHELL_COPY = {
  fa: {
    tabs: { "my-congress": "همایش من", details: "برنامه", "my-network": "شبکه", "my-ticket": "کارت ورود" } satisfies Record<PanelTab, string>,
    myCongresses: "همایش‌های من",
    switchCongress: "تغییر همایش",
    allCongresses: "همه همایش‌های من",
    skip: "پرش به محتوای اصلی",
    footer: "کارت ورود برای استفاده بدون اینترنت روی همین دستگاه می‌ماند؛ در دستگاه مشترک پس از استفاده خارج شوید.",
    logoutTitle: "خروج از حساب در این دستگاه؟",
    logoutBody: "کارت ورود ذخیره‌شده برای استفاده آفلاین از این دستگاه حذف می‌شود.",
    logoutConfirm: "خروج",
    cancel: "انصراف",
    languageLabel: "Switch language to English",
  },
  en: {
    tabs: { "my-congress": "My congress", details: "Program", "my-network": "Network", "my-ticket": "Pass" } satisfies Record<PanelTab, string>,
    myCongresses: "My congresses",
    switchCongress: "Switch congress",
    allCongresses: "All my congresses",
    skip: "Skip to main content",
    footer: "Your pass stays on this device for offline use; log out after using a shared device.",
    logoutTitle: "Log out on this device?",
    logoutBody: "Your saved offline pass will be removed from this device.",
    logoutConfirm: "Log out",
    cancel: "Cancel",
    languageLabel: "تغییر زبان به فارسی",
  },
} as const;

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const headerAction = `press inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${focusRing}`;

/** Desktop navigation: quiet text tabs, the active one underlined by a brand arc. */
function TopNav({ slug, active, labels, navLabel }: {
  slug: string;
  active?: AttendeeDestination;
  labels: Record<PanelTab, string>;
  navLabel: string;
}) {
  return (
    <nav aria-label={navLabel} className="hidden md:flex md:col-span-2 md:row-start-2 items-stretch gap-1 -mx-3">
      {PANEL_TABS.map((d) => {
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
              name={TAB_ICONS[d]}
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

/** Mobile navigation: a floating ink dock, safe-area aware, with an arc marker over the active tab. */
function Dock({ slug, active, labels, navLabel }: {
  slug: string;
  active?: AttendeeDestination;
  labels: Record<PanelTab, string>;
  navLabel: string;
}) {
  return (
    <nav aria-label={navLabel} className="at-dock md:hidden fixed inset-x-0 bottom-0 z-40 print:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4 gap-0.5 rounded-[24px] bg-surface-ink p-1.5 shadow-pop ring-1 ring-white/10">
        {PANEL_TABS.map((d) => {
          const isActive = active === d;
          return (
            <li key={d} className="min-w-0">
              <Link
                to={congressPath(slug, d)}
                aria-current={isActive ? "page" : undefined}
                className={`press relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-[18px] px-0.5 pt-1.5 pb-1 text-center text-xs font-semibold leading-none whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-aiteb-orchid ${
                  isActive ? "bg-white/[0.08] text-white" : "text-ink-300 hover:text-white"
                }`}
              >
                {isActive && <ArcStroke bow="down" className="pointer-events-none absolute top-0.5 left-1/2 h-2 w-8 -translate-x-1/2" />}
                <Icon name={TAB_ICONS[d]} size={21} strokeWidth={isActive ? 2 : 1.75} />
                <span className="max-w-full overflow-hidden text-ellipsis">{labels[d]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The header's congress identity; opens a menu to `/me` and the attendee's other congresses. */
/** Congresses known on this device: the owner's cached passes, or link passes while signed out. */
function knownOnDevice(token: string | null) {
  const cache = token ? loadOwnerScopedTickets(token) : null;
  return { tickets: cache?.status === "valid" ? cache.tickets : [], links: token ? [] : loadLinkPasses(undefined) };
}

function CongressSwitcher({ slug, name, accent, kicker, loadOthers, copy }: {
  slug: string;
  name: React.ReactNode;
  accent?: AccentName | "auto";
  kicker: string;
  /** Read when the menu opens, so passes saved since the page opened are listed. */
  loadOthers: () => CongressCard[];
  copy: (typeof SHELL_COPY)[keyof typeof SHELL_COPY];
}) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<CongressCard[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="congress-switcher"
        aria-label={copy.switchCongress}
        onClick={() => {
          if (!open) setOthers(loadOthers());
          setOpen(!open);
        }}
        className={`flex h-16 min-w-0 max-w-full items-center gap-3 rounded-xl text-start cursor-pointer ${focusRing}`}
      >
        <span className="relative size-10 shrink-0 overflow-hidden rounded-xl [border-start-end-radius:18px] bg-surface-ink shadow-soft ring-1 ring-ink-900/10">
          <CongressSignature seed={slug} tone="ink" accent={accent} className="size-full" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[11px] font-semibold leading-tight text-text-muted">{kicker}</span>
          <span dir="auto" className="line-clamp-2 max-w-full self-start break-words text-[13px] font-bold leading-tight tracking-[-0.01em] text-text-primary sm:line-clamp-1 sm:text-[15px]">
            {name}
          </span>
        </span>
        <Icon name="chevron-down" size={16} className={`shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id="congress-switcher"
          className="absolute start-0 top-full z-50 mt-1 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border-default bg-surface-panel p-1.5 shadow-pop motion-safe:animate-fade"
        >
          <ul className="space-y-0.5">
            {others.map((c) => (
              <li key={c.slug}>
                <Link
                  to={congressPath(c.slug, "my-congress")}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-text-primary hover:bg-surface-panel-subtle ${focusRing}`}
                >
                  <span aria-hidden="true" className="size-8 shrink-0 overflow-hidden rounded-lg [border-start-end-radius:12px]">
                    <CongressSignature seed={c.slug} tone="ink" className="size-full" />
                  </span>
                  <span dir="auto" className="min-w-0 truncate">{c.name}</span>
                </Link>
              </li>
            ))}
            <li className={others.length > 0 ? "border-t border-border-default pt-0.5" : ""}>
              <Link
                to="/me"
                className={`flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-action-primary hover:bg-surface-panel-subtle ${focusRing}`}
              >
                <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-action-subtle">
                  <Icon name="grid" size={16} />
                </span>
                {copy.allCongresses}
              </Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export function AttendeeLayout({ children, localeProps, eventSlug, destination }: AttendeeLayoutProps) {
  const localHook = useAttendeeLocale();
  const { locale, setLocale, t, isRtl, dir } = localeProps || localHook;
  const copy = SHELL_COPY[locale];
  const location = useLocation();
  const navigate = useNavigate();
  const congress = useCongressEvent(eventSlug);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  // Re-read on this tab's and another tab's change, so the header never offers "log out" to nobody.
  const { token, signedIn, signOut } = useAttendeeSession();

  // The offline header: the congress name never waits on a request that cannot succeed.
  const known = useMemo(() => knownOnDevice(token), [token]);
  const loadOthers = () => {
    const { tickets, links } = knownOnDevice(token);
    const groups = groupCongresses(tickets, links);
    return [...groups.live, ...groups.upcoming, ...groups.past].filter((c) => c.slug !== eventSlug);
  };

  const handleLogout = () => {
    signOut();
    setConfirmingLogout(false);
    // Back to this congress's sign-in: the platform home is not an attendee page.
    navigate(eventSlug ? `/c/${encodeURIComponent(eventSlug)}/sign-in` : "/sign-in");
  };

  const congressName = eventSlug
    ? congress.status === "ready"
      ? congress.event.name
      : knownCongressName(eventSlug, known.tickets, known.links)
    : null;
  const pageLabel = destination
    ? destination === "my-profile"
      ? t.navMyProfile
      : copy.tabs[destination]
    : copy.myCongresses;
  usePageTitle(pageLabel, congressName);
  // The accent chosen in Page Studio (published) colours the whole panel; "auto" derives it from the slug.
  const accent = congress.status === "ready" ? congress.event.page?.document.branding?.accent : undefined;
  const profileActive = destination === "my-profile";

  return (
    <div
      dir={dir}
      lang={locale}
      style={eventSlug ? eventAccentStyle(eventSlug, accent) : undefined}
      className="at-shell min-h-screen bg-surface-page text-text-primary flex flex-col font-sans text-start"
    >
      <SkipLink targetId="attendee-main-content">{copy.skip}</SkipLink>

      <header className="at-print-collapse sticky top-0 z-40 border-b border-border-default bg-surface-page pt-safe">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 sm:px-6">
          {eventSlug ? (
            <CongressSwitcher
              slug={eventSlug}
              accent={accent}
              kicker={copy.myCongresses}
              name={congressName ?? <span className="skeleton inline-block h-3.5 w-36 align-middle" />}
              loadOthers={loadOthers}
              copy={copy}
            />
          ) : (
            <Link to="/me" className={`flex h-16 min-w-0 items-center gap-3 rounded-xl ${focusRing}`}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl [border-start-end-radius:18px] bg-surface-ink text-white shadow-soft">
                <Icon name="ticket" size={20} />
              </span>
              <span className="truncate text-sm font-bold tracking-[-0.01em] text-text-primary sm:text-[15px]">{copy.myCongresses}</span>
            </Link>
          )}

          {eventSlug && <TopNav slug={eventSlug} active={destination} labels={copy.tabs} navLabel={t.attendeePortal} />}

          {/* Controls: language, profile, log in / log out */}
          <div className="flex items-center justify-end gap-0.5">
            <button
              type="button"
              onClick={() => setLocale(locale === "fa" ? "en" : "fa")}
              className={`press inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${focusRing}`}
              aria-label={copy.languageLabel}
            >
              <Icon name="globe" size={18} />
              <span lang={isRtl ? "en" : "fa"} className="max-sm:sr-only">{t.languageToggle}</span>
            </button>
            {eventSlug && signedIn && (
              <Link
                to={congressPath(eventSlug, "my-profile")}
                aria-label={t.navMyProfile}
                title={t.navMyProfile}
                aria-current={profileActive ? "page" : undefined}
                data-testid="profile-entry"
                className={`press grid size-11 place-items-center rounded-full ${focusRing}`}
              >
                <span
                  className={`grid size-9 place-items-center rounded-full ring-2 transition-colors ${
                    profileActive ? "bg-event-accent text-white ring-event-accent/30" : "bg-event-accent-soft text-event-accent ring-transparent hover:ring-event-accent/30"
                  }`}
                >
                  <Icon name="user" size={18} />
                </span>
              </Link>
            )}
            <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border-default max-sm:hidden" />
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
      </header>

      <main id="attendee-main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className={`at-print-collapse mt-16 border-t border-border-default bg-surface-panel ${eventSlug ? "pb-32 md:pb-0" : ""}`}>
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary">
            <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-aiteb-slate" />
            <span>{copy.footer}</span>
          </p>
          <AitebAttribution locale={locale} />
        </div>
      </footer>
      {eventSlug && <Dock slug={eventSlug} active={destination} labels={copy.tabs} navLabel={t.attendeePortal} />}
      <ConfirmDialog
        isOpen={confirmingLogout}
        title={copy.logoutTitle}
        description={copy.logoutBody}
        confirmLabel={copy.logoutConfirm}
        cancelLabel={copy.cancel}
        tone="danger"
        onConfirm={handleLogout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </div>
  );
}
