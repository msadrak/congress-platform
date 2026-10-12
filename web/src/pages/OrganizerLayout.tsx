import React, { useCallback, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { ORGANIZER_KEY_STORAGE, type EventOut } from "../api/client";
import { formatLocalizedDate, useAttendeeLocale, type TranslationDictionary } from "../lib/i18n";
import {
  EVENT_SETUP_SECTIONS,
  eventSectionFromPath,
  eventTimeStatus,
  eventWorkspacePath,
  type EventTimeStatus,
} from "../lib/organizerWorkspace";
import { SkipLink } from "../components/ui/SkipLink";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";

export type ActiveEvent = Pick<EventOut, "id" | "name" | "slug" | "starts_at" | "ends_at">;

export interface OrganizerOutletContext {
  apiKey: string | null;
  /** Reports a 401 for the exact key that was sent; any other key or failure is left alone. */
  onKeyRejected: (sentKey: string) => void;
  /** A page reports the event it has successfully loaded so the workspace can name it. */
  reportEvent: (event: ActiveEvent) => void;
  locale: "fa" | "en";
  t: TranslationDictionary;
  isRtl: boolean;
  dir: "rtl" | "ltr";
}

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
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [now] = useState(() => Date.now());

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
  }, []);

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

  const section = eventSectionFromPath(location.pathname);
  const isDesk = section === "desk";
  // A name reported for another event is never shown for this one.
  const contextEvent = eventId && activeEvent?.id === eventId ? activeEvent : null;
  const timeStatus: EventTimeStatus | null = contextEvent
    ? eventTimeStatus(contextEvent.starts_at, contextEvent.ends_at, now)
    : null;
  const statusLabel: Record<EventTimeStatus, string> = {
    upcoming: isRtl ? "در پیش‌رو" : "Upcoming",
    "in-progress": isRtl ? "در حال برگزاری" : "In progress",
    ended: isRtl ? "پایان‌یافته" : "Ended",
  };
  const setupLabels: Record<(typeof EVENT_SETUP_SECTIONS)[number]["key"], string> = {
    overview: t.tabOverview,
    tiers: t.tabTiers,
    "check-in": t.tabPoints,
    booths: t.tabBooths,
    operators: t.tabOperators,
  };
  const navLinkClass = (active: boolean) =>
    `inline-flex items-center min-h-[44px] px-3 rounded-lg text-xs sm:text-[13px] font-semibold whitespace-nowrap shrink-0 border transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring ${
      active
        ? "bg-action-subtle text-action-primary border-action-subtle-border"
        : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-panel-subtle"
    }`;

  return (
    <div
      dir={dir}
      lang={locale}
      className={`min-h-screen bg-surface-page text-text-primary flex flex-col font-sans selection:bg-action-subtle selection:text-action-primary ${
        isRtl ? "text-start font-sans" : "text-start font-sans"
      }`}
    >
      <SkipLink targetId="organizer-main-content">
        {isRtl ? "پرش به محتوای اصلی مدیریت" : "Skip to main organizer workspace content"}
      </SkipLink>

      {/* Sticky Workspace Header */}
      <header className="sticky top-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand & Console Title */}
          <Link
            to="/organizer"
            className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-focus-ring"
            aria-label={t.organizerConsole}
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
            <div className="flex flex-col">
              <span className="font-bold text-sm sm:text-base tracking-tight text-text-primary leading-tight">
                {t.organizerConsole}
              </span>
              <span className="text-[11px] text-text-muted font-normal leading-none hidden sm:inline">
                {isRtl ? "مدیریت چندمستأجره همایش‌ها" : "Multi-Tenant Event Management"}
              </span>
            </div>
          </Link>

          {/* Controls: Language Switcher, Active Session & Logout */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleLocale}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-surface-panel-subtle hover:bg-surface-page text-text-secondary border border-border-default transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              🌐 {t.languageToggle}
            </button>

            {apiKey && (
              <div className="flex items-center gap-2">
                <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-panel-subtle border border-border-subtle text-[11px] font-mono text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span>{isRtl ? "حالت مدیر" : "Organizer"} ••••<bdi dir="ltr">{apiKey.slice(-4)}</bdi></span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="text-xs text-text-muted hover:text-text-primary"
                >
                  {t.clearKeyAction}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Active-event context and one workspace navigation for the selected event */}
        {apiKey && eventId && (
          <div className="border-t border-border-subtle bg-surface-panel">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 space-y-2">
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs min-w-0">
                <Link
                  to="/organizer"
                  className="inline-flex items-center min-h-[36px] font-semibold text-text-secondary hover:text-action-primary focus-visible:outline-2 focus-visible:outline-focus-ring rounded-md"
                >
                  {isRtl ? "→" : "←"} {t.breadcrumbEvents}
                </Link>
                {eventId && (
                  <>
                    <span aria-hidden="true" className="text-text-muted">/</span>
                    <span data-testid="active-event" className="font-bold text-text-primary truncate max-w-[60vw]">
                      {contextEvent ? contextEvent.name : "…"}
                    </span>
                    {contextEvent && timeStatus && (
                      <Badge variant={timeStatus === "in-progress" ? "success" : "neutral"} size="sm">
                        {statusLabel[timeStatus]}
                      </Badge>
                    )}
                    {contextEvent && (
                      <span className="hidden sm:inline text-text-muted">
                        {formatLocalizedDate(contextEvent.starts_at, locale)} – {formatLocalizedDate(contextEvent.ends_at, locale)}
                      </span>
                    )}
                    {contextEvent && (
                      <a
                        href={`/e/${encodeURIComponent(contextEvent.slug)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center min-h-[36px] font-semibold text-action-primary hover:underline"
                      >
                        {t.openPublicPageAction} <span aria-hidden="true">↗</span>
                      </a>
                    )}
                  </>
                )}
              </div>

              {eventId && (
                <nav
                  aria-label={isRtl ? "فضای کاری همایش" : "Event workspace"}
                  className="flex items-center gap-1 overflow-x-auto -mx-1 px-1"
                >
                  {EVENT_SETUP_SECTIONS.map((s) => (
                    <Link
                      key={s.key}
                      to={eventWorkspacePath(eventId, s.path)}
                      aria-current={section === s.key ? "page" : undefined}
                      className={navLinkClass(section === s.key)}
                    >
                      {setupLabels[s.key]}
                    </Link>
                  ))}
                  <span className="mx-1 h-5 w-px bg-border-default shrink-0" aria-hidden="true" />
                  <Link
                    to={eventWorkspacePath(eventId, "/analytics")}
                    aria-current={section === "analytics" ? "page" : undefined}
                    className={navLinkClass(section === "analytics")}
                  >
                    📊 {t.breadcrumbAnalytics}
                  </Link>
                  <span className="mx-1 h-5 w-px bg-border-default shrink-0" aria-hidden="true" />
                  <Link
                    to={eventWorkspacePath(eventId, "/desk")}
                    aria-current={isDesk ? "page" : undefined}
                    className={navLinkClass(isDesk)}
                    title={isRtl ? "میز پذیرش با دسترسی مستقل اپراتور" : "Reception uses its own operator access"}
                  >
                    🖨️ {t.breadcrumbDesk}
                  </Link>
                </nav>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main id="organizer-main-content" tabIndex={-1} className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 focus:outline-none">
        {!apiKey && !isDesk ? (
          /* High-Contrast Credential Gate Card */
          <div className="max-w-md mx-auto my-12 sm:my-20">
            <Card className="border-border-default shadow-xs overflow-hidden">
              <div className="p-6 sm:p-8 space-y-6">
                <div className="space-y-2 text-center sm:text-start">
                  <div className="w-12 h-12 rounded-xl bg-action-subtle text-action-primary flex items-center justify-center text-2xl mx-auto sm:mx-0 shadow-xs">
                    🔑
                  </div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                    {t.apiKeyGateTitle}
                  </h1>
                  <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                    {t.apiKeyGateDesc}
                  </p>
                </div>

                <form onSubmit={handleSaveKey} className="space-y-4">
                  <div>
                    <label
                      htmlFor="apiKeyInput"
                      className="block text-xs font-semibold text-text-primary mb-1"
                    >
                      {t.apiKeyLabel} <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="apiKeyInput"
                      type="password"
                      value={inputKey}
                      onChange={(e) => setInputKey(e.target.value)}
                      placeholder={t.apiKeyPlaceholder}
                      className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                    />
                  </div>

                  {(error || keyRejected) && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
                    >
                      {error ?? (isRtl ? "کلید API رد شد. لطفاً کلید معتبر وارد کنید." : "Your organizer API key was rejected. Please enter a valid key.")}
                    </div>
                  )}

                  <div className="pt-1">
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      isFullWidth
                    >
                      {t.apiKeySubmit} →
                    </Button>
                  </div>
                </form>

                {/* Session Storage Security Disclosure */}
                <div className="pt-4 border-t border-border-subtle text-[11px] text-text-muted leading-relaxed">
                  <p>
                    {isRtl
                      ? "نکته امنیتی: کلید دسترسی فقط در حافظه نشست موقت مرورگر (SessionStorage) ذخیره می‌شود و با بستن تب مرورگر پاک می‌گردد."
                      : "Security notice: Your API key is stored strictly within browser sessionStorage and automatically clears when the tab is closed."}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          <Outlet context={{ apiKey, onKeyRejected: handleKeyRejected, reportEvent, locale, t, isRtl, dir } satisfies OrganizerOutletContext} />
        )}
      </main>

      {/* Organizer Workspace Footer */}
      <footer className="border-t border-border-default bg-surface-panel text-text-secondary py-6 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-text-muted">
          <p>
            {isRtl
              ? "کنسول مدیریت همایش • معماری چندمستأجره با امنیت تفکیک سازمان‌ها"
              : "Congress Organizer Console • Multi-tenant event management with tenant-isolated database access."}
          </p>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-action-primary hover:underline font-medium">
              {t.platformHome}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
