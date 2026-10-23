import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { ORGANIZER_KEY_STORAGE, createApiClient, registerUnauthorizedHandler, type EventOut, type OrganizerSessionOut } from "../api/client";
import { useAttendeeLocale, type TranslationDictionary } from "../lib/i18n";
import { formatDateRange } from "../lib/format";
import { EVENT_NAV_GROUPS, eventSectionFromPath, eventTimeStatus, eventWorkspacePath, type EventWorkspaceSection } from "../lib/organizerWorkspace";
import { ROLE_COPY, isOrganizerRole } from "../lib/organizerConsole";
import { organizerCopy } from "../copy/organizer";
import { commonCopy } from "../copy/common";
import { SkipLink } from "../components/ui/SkipLink";
import { Icon, type IconName } from "../components/ui/Icon";
import { Badge } from "../components/ui/Badge";
import { RowActions } from "../components/ui/RowActions";
import { AitebLogo } from "../components/brand/Aiteb";
import { OperatorMenu, type OperatorMenuItem } from "../components/operator/OperatorMenu";
import { OrganizerKeyGate } from "../components/organizer/OrganizerKeyGate";
import { EventStatusBadge } from "../components/organizer/WorkspaceUi";
import { sessionAllows } from "../components/organizer/roleAccess";
import { usePageTitle } from "../hooks/usePageTitle";
import "../styles/organizer.css";

export type ActiveEvent = Pick<EventOut, "id" | "name" | "slug" | "starts_at" | "ends_at"> & Partial<Pick<EventOut, "archived_at" | "timezone">>;

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
  /** Who is signed in (organizer key as owner, or a member with a role); null until /api/organizer/me answers. */
  session: OrganizerSessionOut | null;
  locale: "fa" | "en";
  t: TranslationDictionary;
  isRtl: boolean;
  dir: "rtl" | "ltr";
}

const OTHER_LOCALE = { fa: "en", en: "fa" } as const;

const SECTION_ICONS: Record<EventWorkspaceSection, IconName> = {
  overview: "grid",
  participants: "users",
  "check-in": "gate",
  desk: "id-card",
  analytics: "chart",
  program: "calendar",
  tiers: "ticket",
  booths: "booth",
  page: "web",
  sms: "mail",
};

/**
 * The organizer console frame. At 1280 px and up an ink rail holds the brand, the congress, the grouped
 * navigation and a 56 px account row; from 1024 to 1279 px the rail shrinks to icons and a top bar names the
 * congress; below 1024 px a 56 px top bar and a scrolling tab strip (congress-day sections first) replace it.
 */
export default function OrganizerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams<{ eventId?: string }>();
  const { locale, setLocale, t, isRtl, dir } = useAttendeeLocale();
  const copy = organizerCopy[locale];

  const [apiKey, setApiKey] = useState<string | null>(() => (typeof window !== "undefined" ? sessionStorage.getItem(ORGANIZER_KEY_STORAGE) : null));
  const [keyRejected, setKeyRejected] = useState(false);
  // The gate reopens on the method that was refused: an organizer key, or (a JWT) a member session.
  const [rejectedWasKey, setRejectedWasKey] = useState(false);
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [now] = useState(() => Date.now());
  // The session belongs to the credential it was loaded with; a stale answer for another one is never shown.
  const [loadedSession, setLoadedSession] = useState<{ token: string; session: OrganizerSessionOut } | null>(null);
  const session = loadedSession && loadedSession.token === apiKey ? loadedSession.session : null;
  const section = eventSectionFromPath(location.pathname);
  const isDesk = /^\/organizer\/events\/[^/]+\/desk\/?$/.test(location.pathname);

  useEffect(() => {
    // The desk runs on its own operator access: the organizer credential is not sent from there.
    if (!apiKey || isDesk) return;
    let alive = true;
    // A 401 reaches handleKeyRejected through the API client; no connection resolves to an error result.
    void createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" })
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
    setKeyRejected(false);
  };

  const handleLogout = () => {
    // A member's sign-out also ends the session on the server (every copy of the token stops working).
    if (apiKey && session?.kind === "member") {
      void createApiClient({ kind: "organizer", token: apiKey }, { networkErrors: "result" }).POST("/api/organizer/logout");
    }
    sessionStorage.removeItem(ORGANIZER_KEY_STORAGE);
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
    setActiveEvent((previous) => {
      const same = previous?.id === reported.id;
      return {
        id: reported.id,
        name: reported.name,
        slug: reported.slug,
        starts_at: reported.starts_at,
        ends_at: reported.ends_at,
        // A page that reports only the basics never clears what the workspace already knows.
        archived_at: "archived_at" in reported ? reported.archived_at : same ? previous.archived_at : null,
        timezone: reported.timezone ?? (same ? previous.timezone : undefined),
      };
    });
  }, []);

  const toggleLocale = () => setLocale(OTHER_LOCALE[locale]);

  const sectionNavRef = useRef<HTMLElement>(null);
  // Below 1024 px the section strip scrolls sideways: keep the current section in view.
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
  const archived = contextEvent?.archived_at != null;
  const showGate = !apiKey && !isDesk;
  const consolePage = location.pathname.replace(/\/$/, "");
  const canManage = sessionAllows(session, "manager") && session !== null;
  const sectionLabel = section
    ? copy.shell.sections[section]
    : consolePage === "/organizer/members"
      ? copy.shell.members
      : consolePage === "/organizer/activity"
        ? copy.shell.activity
        : copy.shell.congresses;
  // The layout names the tab for every section: "<section> · <congress>", the console name around it.
  usePageTitle(showGate ? copy.shell.consoleName : sectionLabel, showGate ? null : (contextEvent?.name ?? copy.shell.consoleName));

  if (showGate) {
    return (
      <div dir={dir} lang={locale} className="min-h-dvh bg-surface-page font-sans text-text-primary">
        <SkipLink targetId="organizer-main-content">{copy.shell.skipToContent}</SkipLink>
        <main id="organizer-main-content" tabIndex={-1} className="focus:outline-none">
          <OrganizerKeyGate
            locale={locale}
            keyRejected={keyRejected}
            initialMode={keyRejected && rejectedWasKey ? "key" : "mobile"}
            onSession={handleSession}
            onToggleLocale={toggleLocale}
          />
        </main>
      </div>
    );
  }

  const navLink = (key: string, to: string, label: string, icon: IconName, active: boolean) => (
    <Link key={key} to={to} aria-current={active ? "page" : undefined} className="org-nav-link" title={label}>
      <Icon name={icon} size={18} className="org-nav-icon" />
      <span className="org-nav-label">{label}</span>
    </Link>
  );

  const identityName =
    session?.kind === "member" && session.member ? session.member.display_name : session ? copy.shell.keySession : null;
  const identityMeta = session && isOrganizerRole(session.role) ? `${ROLE_COPY[locale][session.role].label} · ${session.organizer?.name ?? ""}` : null;
  const languageItem = { label: commonCopy[locale].languageToggle, icon: "globe" as const, onSelect: toggleLocale };
  const signOutItem = { label: copy.shell.signOut, icon: "logout" as const, onSelect: handleLogout };
  const publicHref = contextEvent ? `/e/${encodeURIComponent(contextEvent.slug)}` : null;
  const menuItems: OperatorMenuItem[] = [
    ...(publicHref && !archived
      ? [{ id: "public", label: copy.shell.publicPage, icon: "arrow-up-right" as const, onSelect: () => window.open(publicHref, "_blank", "noopener") }]
      : []),
    { id: "language", label: commonCopy[locale].languageToggle, icon: "globe", lang: OTHER_LOCALE[locale], onSelect: toggleLocale },
    { id: "sign-out", label: copy.shell.signOut, icon: "logout", onSelect: handleLogout, divider: true },
  ];
  const menuHeader = identityName ? (
    <>
      <bdi className="block font-semibold text-text-primary">{identityName}</bdi>
      {identityMeta && <bdi className="block text-xs">{identityMeta}</bdi>}
    </>
  ) : undefined;

  const statusChips = contextEvent && (
    <span className="flex flex-wrap items-center gap-1.5">
      {archived ? (
        <Badge variant="warning" size="sm" icon={<Icon name="lock" size={12} />}>
          {copy.shell.archived}
        </Badge>
      ) : (
        <EventStatusBadge status={eventTimeStatus(contextEvent.starts_at, contextEvent.ends_at, now)} isRtl={isRtl} />
      )}
    </span>
  );

  return (
    <div dir={dir} lang={locale} className="org-shell bg-surface-page font-sans text-text-primary">
      <SkipLink targetId="organizer-main-content">{copy.shell.skipToContent}</SkipLink>

      {/* Top bar below 1280 px: the congress (or the console) and the ⋯ menu below 1024 px. */}
      <header className={`org-topbar surface-ink ${eventId ? "org-topbar--event" : ""}`} data-testid="organizer-topbar">
        {eventId ? (
          <Link to="/organizer" className="org-topbar__icon" aria-label={copy.shell.congresses} title={copy.shell.congresses}>
            <Icon name="arrow-left" size={20} />
          </Link>
        ) : (
          <Link to="/organizer" className="org-topbar__icon" aria-label={copy.shell.consoleName}>
            <AitebLogo variant="mark" alt="" className="size-7" />
          </Link>
        )}
        <p className="org-topbar__title">
          {eventId ? contextEvent ? <bdi>{contextEvent.name}</bdi> : "…" : copy.shell.consoleName}
        </p>
        {eventId && <span className="org-topbar__chips">{statusChips}</span>}
        <div className="lg:hidden">
          <OperatorMenu locale={locale} items={menuItems} header={menuHeader} tone="ink" />
        </div>
      </header>

      {/* Ink rail from 1024 px; below that only its navigation shows, as the tab strip under the top bar. */}
      <aside className="org-rail surface-ink" aria-label={copy.shell.consoleName}>
        <Link to="/organizer" className="org-rail__brand" title={copy.shell.consoleName}>
          <AitebLogo variant="mark" alt="" className="size-8 shrink-0" />
          <span className="org-rail__brand-name">{copy.shell.consoleName}</span>
        </Link>

        {eventId && (
          <div className="org-rail__event">
            <Link to="/organizer" className="org-rail__back">
              <Icon name="arrow-left" size={16} />
              {copy.shell.congresses}
            </Link>
            <p data-testid="active-event" className="org-rail__event-name">
              {contextEvent ? <bdi>{contextEvent.name}</bdi> : "…"}
            </p>
            {contextEvent && (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-300">
                {statusChips}
                <span>{formatDateRange(contextEvent.starts_at, contextEvent.ends_at, locale, contextEvent.timezone)}</span>
              </div>
            )}
          </div>
        )}

        {eventId ? (
          <nav ref={sectionNavRef} aria-label={copy.shell.sectionsNav} className="org-nav">
            {EVENT_NAV_GROUPS.map((group) => {
              const items = group.items.filter((s) => sessionAllows(session, s.role));
              if (items.length === 0) return null;
              const labelId = `org-nav-${group.key}`;
              const hasLabel = group.key === "day" || group.key === "setup";
              return (
                <div key={group.key} role="group" aria-labelledby={hasLabel ? labelId : undefined} className="org-nav-group">
                  {hasLabel && (
                    <span id={labelId} className="org-nav-group-label">
                      {copy.shell.groups[group.key]}
                    </span>
                  )}
                  {items.map((s) => navLink(s.key, eventWorkspacePath(eventId, s.path), copy.shell.sections[s.key], SECTION_ICONS[s.key], section === s.key))}
                </div>
              );
            })}
          </nav>
        ) : (
          <nav ref={sectionNavRef} aria-label={copy.shell.consoleNav} className={`org-nav ${canManage ? "" : "org-nav--single"}`}>
            {navLink("events", "/organizer", copy.shell.congresses, "congress", consolePage === "/organizer")}
            {canManage && navLink("members", "/organizer/members", copy.shell.members, "users", consolePage === "/organizer/members")}
            {canManage && navLink("activity", "/organizer/activity", copy.shell.activity, "activity", consolePage === "/organizer/activity")}
          </nav>
        )}

        {/* One 56 px row: who is signed in, with language and sign-out in its menu. */}
        <div className="org-rail__account" data-testid="console-identity">
          <span className="org-rail__account-icon" aria-hidden="true">
            <Icon name={session?.kind === "member" ? "user" : "key"} size={16} />
          </span>
          <span className="org-rail__account-text">
            {identityName && <bdi className="block truncate text-xs font-semibold text-ink-100">{identityName}</bdi>}
            {identityMeta && <bdi className="block truncate text-caption text-ink-300">{identityMeta}</bdi>}
          </span>
          <RowActions visible={0} menuLabel={copy.shell.accountMenu} actions={[languageItem, signOutItem]} className="org-rail__account-menu" />
        </div>
      </aside>

      <main
        id="organizer-main-content"
        tabIndex={-1}
        className={`org-main mx-auto w-full min-w-0 px-4 focus:outline-none sm:px-6 lg:px-10 ${
          section === "page" ? "max-w-[112rem] pb-6 sm:pb-8 lg:pb-10" : "max-w-[78rem] py-6 sm:py-8 lg:py-10"
        }`}
      >
        <Outlet context={{ apiKey, onKeyRejected: handleKeyRejected, reportEvent, session, locale, t, isRtl, dir } satisfies OrganizerOutletContext} />
      </main>
    </div>
  );
}

