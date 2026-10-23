import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { ORGANIZER_KEY_STORAGE, createApiClient, registerUnauthorizedHandler, type EventOut, type OrganizerSessionOut } from "../api/client";
import { formatLocalizedDate, useAttendeeLocale, type TranslationDictionary } from "../lib/i18n";
import {
  EVENT_SETUP_SECTIONS,
  eventOperationNumber,
  eventSectionFromPath,
  eventTimeStatus,
  eventWorkspacePath,
  type EventTimeStatus,
} from "../lib/organizerWorkspace";
import { SkipLink } from "../components/ui/SkipLink";
import { Icon, type IconName } from "../components/ui/Icon";
import { AitebAttribution, ArcMotif } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { OrganizerKeyGate } from "../components/organizer/OrganizerKeyGate";
import { usePageTitle } from "../hooks/usePageTitle";
import { EventStatusBadge } from "../components/organizer/WorkspaceUi";
import { eventAccentStyle } from "../lib/eventAccent";
import { PARTICIPANTS_COPY } from "../lib/participants";
import { CONSOLE_COPY, ROLE_COPY, roleAtLeast } from "../lib/organizerConsole";
import "../styles/organizer.css";

export type ActiveEvent = Pick<EventOut, "id" | "name" | "slug" | "starts_at" | "ends_at">;

export interface OrganizerOutletContext {
  apiKey: string | null;
  /**
   * Reports a 401 for the exact key that was sent; any other key or failure is left alone. Requests
   * through `createApiClient({ kind: "organizer" })` already report it (registerUnauthorizedHandler),
   * so only raw `fetch` calls need this.
   */
  onKeyRejected: (sentKey: string) => void;
  /** A page reports the event it has successfully loaded so the workspace can name it. */
  reportEvent: (event: ActiveEvent) => void;
  /** Who is signed in (API key as owner, or a member with a role); null until /api/organizer/me answers. */
  session: OrganizerSessionOut | null;
  locale: "fa" | "en";
  t: TranslationDictionary;
  isRtl: boolean;
  dir: "rtl" | "ltr";
}

const SECTION_ICONS: Record<(typeof EVENT_SETUP_SECTIONS)[number]["key"], IconName> = {
  overview: "grid",
  program: "calendar",
  venue: "pin",
  tiers: "ticket",
  "check-in": "gate",
  booths: "booth",
  operators: "users",
  page: "web",
  panel: "smartphone",
  sms: "mail",
};

export default function OrganizerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams<{ eventId?: string }>();
  const { locale, setLocale, t, isRtl, dir } = useAttendeeLocale();

  const [apiKey, setApiKey] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(ORGANIZER_KEY_STORAGE);
    }
    return null;
  });
  const [inputKey, setInputKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [keyRejected, setKeyRejected] = useState(false);
  // The gate reopens on the method that was refused: an API key, or (a JWT) a member session.
  const [rejectedWasKey, setRejectedWasKey] = useState(false);
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [now] = useState(() => Date.now());
  // The session belongs to the credential it was loaded with; a stale answer for another one is never shown.
  const [loadedSession, setLoadedSession] = useState<{ token: string; session: OrganizerSessionOut } | null>(null);
  const session = loadedSession && loadedSession.token === apiKey ? loadedSession.session : null;
  const section = eventSectionFromPath(location.pathname);
  const isDesk = section === "desk";

  useEffect(() => {
    // The desk runs on its own operator access: the organizer credential is not sent from there.
    if (!apiKey || isDesk) return;
    let alive = true;
    // A 401 reaches handleKeyRejected through the API client (registerUnauthorizedHandler).
    void createApiClient({ kind: "organizer", token: apiKey })
      .GET("/api/organizer/me")
      .then(({ data }) => {
        if (alive && data) setLoadedSession({ token: apiKey, session: data });
      });
    return () => {
      alive = false;
    };
  }, [apiKey, isDesk]);

  const handleSession = (token: string) => {
    sessionStorage.setItem(ORGANIZER_KEY_STORAGE, token);
    setApiKey(token);
    setError(null);
    setKeyRejected(false);
  };

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setError(t.apiKeyRequired);
      return;
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem(ORGANIZER_KEY_STORAGE, trimmed);
    }
    setApiKey(trimmed);
    setInputKey("");
    setError(null);
    setKeyRejected(false);
  };

  const handleLogout = () => {
    // A member's sign-out also ends the session on the server (every copy of the token stops working).
    if (apiKey && session?.kind === "member") {
      void createApiClient({ kind: "organizer", token: apiKey }).POST("/api/organizer/logout").catch(() => undefined);
    }
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(ORGANIZER_KEY_STORAGE);
    }
    setApiKey(null);
    navigate("/organizer");
  };

  // Stable identity: pages list it as an effect dependency and must not refetch on re-render.
  const handleKeyRejected = useCallback((sentKey: string) => {
    // A late 401 for an earlier key must not delete a newer organizer session.
    if (sessionStorage.getItem(ORGANIZER_KEY_STORAGE) !== sentKey) return;
    sessionStorage.removeItem(ORGANIZER_KEY_STORAGE);
    setApiKey((current) => (current === sentKey ? null : current));
    setKeyRejected(true);
    setRejectedWasKey(sentKey.split(".").length !== 3);
  }, []);

  // Every organizer-key request answered 401 lands here, whichever page sent it.
  useEffect(() => registerUnauthorizedHandler("organizer", handleKeyRejected), [handleKeyRejected]);

  const reportEvent = useCallback((reported: ActiveEvent) => {
    setActiveEvent({
      id: reported.id,
      name: reported.name,
      slug: reported.slug,
      starts_at: reported.starts_at,
      ends_at: reported.ends_at,
    });
  }, []);

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  const sectionNavRef = useRef<HTMLElement>(null);
  // Below 1024 px the section strip scrolls sideways: keep the current section centred in view.
  useEffect(() => {
    const nav = sectionNavRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const linkBox = current.getBoundingClientRect();
    nav.scrollBy({ left: linkBox.left + linkBox.width / 2 - (navBox.left + navBox.width / 2) });
  }, [section, eventId, apiKey]);
  // A name reported for another event is never shown for this one.
  const contextEvent = eventId && activeEvent?.id === eventId ? activeEvent : null;
  const timeStatus: EventTimeStatus | null = contextEvent
    ? eventTimeStatus(contextEvent.starts_at, contextEvent.ends_at, now)
    : null;
  const setupLabels: Record<(typeof EVENT_SETUP_SECTIONS)[number]["key"], string> = {
    overview: t.tabOverview,
    program: t.tabProgram,
    venue: t.tabVenue,
    tiers: t.tabTiers,
    "check-in": t.tabPoints,
    booths: t.tabBooths,
    operators: t.tabOperators,
    page: isRtl ? "صفحهٔ عمومی" : "Public page",
    panel: t.tabPanel,
    sms: isRtl ? "پیامک" : "SMS",
  };

  const showGate = !apiKey && !isDesk;
  // The layout names the tab for every section (a section's own effect would run first and be overwritten):
  // "<section> · <event>", the console name until the event is known, and the console alone at the key gate.
  const consoleCopy = CONSOLE_COPY[locale];
  const consolePage = location.pathname.replace(/\/$/, "");
  const sectionLabel =
    section === "analytics"
      ? t.breadcrumbAnalytics
      : section === "desk"
        ? t.breadcrumbDesk
        : section === "participants"
          ? PARTICIPANTS_COPY[locale].navLabel
          : section
            ? setupLabels[section]
            : consolePage === "/organizer/members"
              ? consoleCopy.membersNav
              : consolePage === "/organizer/activity"
                ? consoleCopy.activityNav
                : t.breadcrumbEvents;
  const canManage = roleAtLeast(session?.role, "manager");
  usePageTitle(showGate ? t.organizerConsole : sectionLabel, showGate ? null : (contextEvent?.name ?? t.organizerConsole));
  const languageLabel = isRtl ? "Switch language to English" : "تغییر زبان به فارسی";

  if (showGate) {
    return (
      <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
        <SkipLink targetId="organizer-main-content">
          {isRtl ? "پرش به محتوای اصلی مدیریت" : "Skip to main organizer workspace content"}
        </SkipLink>
        <main id="organizer-main-content" tabIndex={-1} className="focus:outline-none">
          <OrganizerKeyGate
            locale={locale}
            t={t}
            isRtl={isRtl}
            inputKey={inputKey}
            onInputKeyChange={setInputKey}
            error={error}
            keyRejected={keyRejected}
            initialMode={keyRejected && rejectedWasKey ? "key" : "mobile"}
            onSubmit={handleSaveKey}
            onSession={handleSession}
            onToggleLocale={toggleLocale}
          />
        </main>
      </div>
    );
  }

  const navItem = (key: string, to: string, label: string, icon: IconName, index: number, active: boolean, title?: string) => (
    <Link key={key} to={to} aria-current={active ? "page" : undefined} className="org-nav-link" title={title}>
      <span className="org-nav-index" aria-hidden="true">
        {String(index).padStart(2, "0")}
      </span>
      <span className="org-nav-icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      {label}
    </Link>
  );

  return (
    <div dir={dir} lang={locale} className="org-shell bg-surface-page font-sans text-text-primary">
      <SkipLink targetId="organizer-main-content">
        {isRtl ? "پرش به محتوای اصلی مدیریت" : "Skip to main organizer workspace content"}
      </SkipLink>

      {/* Ink rail: compact header below 1024 px, sidebar above. One DOM, two layouts (organizer.css). */}
      <aside className="org-rail" aria-label={t.organizerConsole} style={eventAccentStyle(contextEvent?.slug)}>
        <div aria-hidden="true" className="bg-meridian-ink pointer-events-none absolute inset-0 -z-10 opacity-60" />

        {/* Brand */}
        <div className="org-rail__brand px-4 py-3 sm:px-6 lg:px-5 lg:pb-5 lg:pt-6">
          <Link
            to="/organizer"
            className="inline-flex min-h-[44px] max-w-full items-center gap-3 rounded-lg"
            aria-label={t.organizerConsole}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] ring-1 ring-white/15">
              <ArcMotif className="size-[22px]" weight={9} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-white">{t.organizerConsole}</span>
              <span className="hidden truncate text-[0.6875rem] text-ink-300 sm:block">
                {isRtl ? "مدیریت چندمستأجره همایش‌ها" : "Multi-tenant event management"}
              </span>
            </span>
          </Link>
        </div>

        {/* Event context */}
        {eventId && (
          <div className="org-rail__context px-4 pb-1 sm:px-6 lg:px-5 lg:pb-4">
            <Link
              to="/organizer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md text-xs font-semibold text-ink-300 transition-colors hover:text-white"
            >
              <Icon name="arrow-left" size={16} />
              {t.breadcrumbEvents}
            </Link>
            <div className="mt-1 flex items-start gap-3 lg:mt-2.5 lg:block">
              {contextEvent && (
                <div className="relative hidden h-16 overflow-hidden rounded-xl ring-1 ring-white/10 lg:block lg:[border-start-end-radius:24px]">
                  <CongressSignature seed={contextEvent.slug} tone="ink" className="h-full w-full" />
                </div>
              )}
              <div className="min-w-0 flex-1 lg:mt-3">
                <p
                  data-testid="active-event"
                  className="truncate text-base font-semibold leading-snug text-white lg:line-clamp-3 lg:whitespace-normal lg:text-[1.0625rem] lg:[overflow-wrap:anywhere]"
                >
                  {contextEvent ? <bdi>{contextEvent.name}</bdi> : "…"}
                </p>
                {contextEvent && timeStatus && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ink-300 lg:mt-2.5">
                    <EventStatusBadge status={timeStatus} isRtl={isRtl} />
                    <span className="hidden items-start gap-1.5 sm:inline-flex lg:flex lg:w-full">
                      <Icon name="calendar" size={14} className="mt-px shrink-0" />
                      <span>
                        {formatLocalizedDate(contextEvent.starts_at, locale)} – {formatLocalizedDate(contextEvent.ends_at, locale)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              {contextEvent && (
                <a
                  href={`/e/${encodeURIComponent(contextEvent.slug)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-aiteb-orchid transition-colors hover:text-white lg:mt-1 lg:min-h-[36px]"
                >
                  <span className="sr-only sm:not-sr-only lg:not-sr-only">{t.openPublicPageAction}</span>
                  <Icon name="arrow-up-right" size={16} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Section navigation */}
        <div className="org-rail__nav px-2 pb-1 sm:px-4 lg:px-3 lg:pb-4">
          {eventId ? (
            <nav ref={sectionNavRef} aria-label={isRtl ? "فضای کاری همایش" : "Event workspace"} className="org-nav lg:border-t lg:border-white/10 lg:pt-4">
              {EVENT_SETUP_SECTIONS.map((s, i) =>
                navItem(s.key, eventWorkspacePath(eventId, s.path), setupLabels[s.key], SECTION_ICONS[s.key], i + 1, section === s.key),
              )}
              <span className="org-nav-divider" aria-hidden="true" />
              {navItem("participants", eventWorkspacePath(eventId, "/participants"), PARTICIPANTS_COPY[locale].navLabel, "users", eventOperationNumber("participants"), section === "participants")}
              {navItem("analytics", eventWorkspacePath(eventId, "/analytics"), t.breadcrumbAnalytics, "chart", eventOperationNumber("analytics"), section === "analytics")}
              {navItem(
                "desk",
                eventWorkspacePath(eventId, "/desk"),
                t.breadcrumbDesk,
                "id-card",
                eventOperationNumber("desk"),
                isDesk,
                isRtl ? "میز پذیرش با دسترسی مستقل اپراتور" : "Reception uses its own operator access",
              )}
            </nav>
          ) : (
            <nav
              ref={sectionNavRef}
              aria-label={isRtl ? "کنسول مدیریت" : "Organizer console"}
              className={`org-nav lg:flex lg:border-t lg:border-white/10 lg:pt-4 ${canManage ? "" : "hidden"}`}
            >
              {navItem("events", "/organizer", t.breadcrumbEvents, "congress", 1, consolePage === "/organizer")}
              {canManage && navItem("members", "/organizer/members", consoleCopy.membersNav, "users", 2, consolePage === "/organizer/members")}
              {canManage && navItem("activity", "/organizer/activity", consoleCopy.activityNav, "activity", 3, consolePage === "/organizer/activity")}
            </nav>
          )}
        </div>

        {/* Session controls */}
        <div className="org-rail__controls flex items-center gap-1 pe-2 sm:pe-4 lg:flex-col lg:items-stretch lg:gap-2 lg:border-t lg:border-white/10 lg:p-4">
          {apiKey && (
            <div className="hidden items-center gap-2.5 rounded-lg bg-white/[0.05] px-3 py-2 ring-1 ring-white/10 lg:flex" data-testid="console-identity">
              <span className="relative grid size-7 place-items-center rounded-md bg-white/[0.07] text-aiteb-orchid">
                <Icon name={session?.kind === "member" ? "user" : "key"} size={15} />
              </span>
              {session?.kind === "member" && session.member ? (
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-xs font-semibold text-ink-100">
                    <bdi>{session.member.display_name}</bdi>
                  </span>
                  <span className="block truncate text-[0.6875rem] text-ink-400">
                    {ROLE_COPY[locale][session.role].label} · <bdi>{session.organizer.name}</bdi>
                  </span>
                </span>
              ) : (
                <span className="min-w-0 leading-tight">
                  <span className="block text-[0.6875rem] text-ink-400">{isRtl ? "حالت مدیر" : "Organizer key"}</span>
                  <bdi dir="ltr" className="block font-mono text-xs text-ink-100">
                    ••••{apiKey.slice(-4)}
                  </bdi>
                </span>
              )}
              <span aria-hidden="true" className="ms-auto size-1.5 rounded-full bg-status-success-solid" />
            </div>
          )}
          <div className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-1.5">
            <button
              type="button"
              onClick={toggleLocale}
              aria-label={languageLabel}
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg px-2.5 text-xs font-semibold text-ink-200 transition-colors hover:bg-white/[0.07] hover:text-white lg:justify-start lg:px-3"
            >
              <Icon name="globe" size={18} />
              <span className="hidden sm:inline">{t.languageToggle}</span>
            </button>
            {apiKey && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold text-ink-200 transition-colors hover:bg-white/[0.07] hover:text-white lg:justify-start lg:px-3"
              >
                <Icon name="logout" size={18} />
                <span className="sr-only sm:not-sr-only">{t.clearKeyAction}</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Workspace column */}
      <div className="flex min-w-0 flex-col">
        <main
          id="organizer-main-content"
          tabIndex={-1}
          className={`mx-auto w-full flex-1 px-4 focus:outline-none sm:px-6 lg:px-10 ${
            section === "page" ? "max-w-[112rem] pb-6 sm:pb-8 lg:pb-10" : "max-w-[78rem] py-6 sm:py-8 lg:py-10"
          }`}
        >
          <Outlet context={{ apiKey, onKeyRejected: handleKeyRejected, reportEvent, session, locale, t, isRtl, dir } satisfies OrganizerOutletContext} />
        </main>

        <footer className="border-t border-border-default">
          <div className="mx-auto flex w-full max-w-[78rem] flex-col gap-3 px-4 py-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
            <AitebAttribution locale={locale} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>{isRtl ? "دسترسی تفکیک‌شده برای هر سازمان برگزارکننده" : "Tenant-isolated access for each organizing body"}</span>
              <Link to="/" className="inline-flex min-h-[36px] items-center font-semibold text-action-primary hover:underline">
                {t.platformHome}
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
