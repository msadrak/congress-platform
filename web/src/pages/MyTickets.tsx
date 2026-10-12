import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  formatApiError,
  type AttendeeTicketDetail,
  type BookmarkedBoothOut,
} from "../api/client";
import {
  loadOwnerScopedTickets,
  saveOwnerScopedTickets,
} from "../lib/ticketCache";
import {
  isStoredAttendeeToken,
  rejectAttendeeToken,
  SESSION_CHANGED_MESSAGE,
} from "../lib/attendeeSession";
import {
  useAttendeeLocale,
  formatLocalizedDate,
} from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { Badge } from "../components/ui/Badge";
import { LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";

export default function MyTickets() {
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;

  const { slug } = useParams<{ slug?: string }>();
  const [allTickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [activeTicketIndex, setActiveTicketIndex] = useState(0);
  const [allBookmarks, setBookmarkedBooths] = useState<BookmarkedBoothOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isCachedPass, setIsCachedPass] = useState(false);
  const [removingBoothId, setRemovingBoothId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [sessionRejected, setSessionRejected] = useState(false);

  // Inside a congress portal only that congress's passes and saved booths are shown.
  const tickets = slug ? allTickets.filter((tkt) => tkt.event_slug === slug) : allTickets;
  const bookmarkedBooths = slug ? allBookmarks.filter((b) => b.event_slug === slug) : allBookmarks;

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSessionRejected(false);

    // 1. Stage A: Load owner-scoped cached tickets immediately (fails closed if unauthenticated)
    if (token) {
      const cacheResult = loadOwnerScopedTickets(token);
      const hasCache = cacheResult.status === "valid" && cacheResult.tickets.length > 0;
      // A different session must never inherit the previous owner's passes or bookmarks.
      setTickets(hasCache ? cacheResult.tickets : []);
      setIsCachedPass(hasCache);
      setBookmarkedBooths([]);
      setActiveTicketIndex(0);
      setError(null);
      setLoading(!hasCache);
    } else {
      setTickets([]);
      setIsCachedPass(false);
      setLoading(false);
      return;
    }

    // 2. Fetch live data if online
    const fetchData = async () => {
      const client = createApiClient({ kind: "user", token });
      const [ticketsRes, boothsRes] = await Promise.all([
        client.GET("/api/attendees/me/tickets"),
        client.GET("/api/attendees/me/bookmarks/booths"),
      ]);

      if (!active) return;
      // The stored session changed while the request was in flight: ignore this response and
      // never delete the newer session. The re-render re-reads the current token.
      if (!isStoredAttendeeToken(token)) {
        setLoading(false);
        return;
      }

      if (ticketsRes.error) {
        const currentCache = loadOwnerScopedTickets(token);
        const hasCache = currentCache.status === "valid" && currentCache.tickets.length > 0;
        if (ticketsRes.response.status === 401) {
          // Keep the owner's cached pass on screen, labelled non-authoritative; with nothing to
          // show, invalidate exactly this credential and fall back to the sign-in view.
          if (hasCache) setSessionRejected(true);
          else rejectAttendeeToken(token);
        }
        if (!hasCache) {
          setError(formatApiError(ticketsRes.error));
        }
      } else if (ticketsRes.data) {
        setTickets(ticketsRes.data);
        setIsCachedPass(false);
        saveOwnerScopedTickets(token, ticketsRes.data);
      }

      if (boothsRes.data) {
        setBookmarkedBooths(boothsRes.data);
      }

      setLoading(false);
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [token]);

  const handleRemoveBookmark = async (boothId: string) => {
    // A rejected session is kept only to present the labelled offline pass; it authorizes nothing.
    if (!token || sessionRejected) return;
    if (!isStoredAttendeeToken(token)) {
      setFeedbackMessage(SESSION_CHANGED_MESSAGE);
      return;
    }
    setRemovingBoothId(boothId);
    setFeedbackMessage(null);
    const client = createApiClient({ kind: "user", token });
    const { error: err, response } = await client.DELETE(
      "/api/attendees/me/bookmarks/booths/{booth_id}",
      { params: { path: { booth_id: boothId } } }
    );
    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    if (!err && stillCurrent) {
      setBookmarkedBooths((prev) => prev.filter((b) => b.booth_id !== boothId));
      setFeedbackMessage(t.bookmarkRemovedFeedback);
    }
    setRemovingBoothId(null);
  };

  const handlePrintBadge = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
        <div className="max-w-md mx-auto px-4 py-20 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-3xl shadow-xs">
            🎫
          </div>
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
              {t.unauthenticatedTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {t.unauthenticatedDesc}
            </p>
          </div>
          <div className="pt-2">
            <LinkButton to={signInPath(slug, slug ? congressPath(slug, "my-ticket") : "/my-tickets")} variant="primary" size="lg" isFullWidth>
              {t.loginAction} →
            </LinkButton>
          </div>
        </div>
      </AttendeeLayout>
    );
  }

  // Loading skeleton
  if (loading && tickets.length === 0) {
    return (
      <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 space-y-6 animate-pulse">
          <div className="w-48 h-8 bg-surface-panel-subtle rounded-xl" />
          <div className="h-96 bg-surface-panel rounded-2xl border border-border-default" />
        </div>
      </AttendeeLayout>
    );
  }

  // Active ticket
  const currentTicket: AttendeeTicketDetail | undefined = tickets[activeTicketIndex] ?? tickets[0];

  return (
    <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {/* Network / Offline & Cache Status Banner */}
        {(isOffline || isCachedPass) && (
          <div
            role="status"
            className="p-3.5 sm:p-4 rounded-xl bg-status-warning-bg text-status-warning-text border border-status-warning-border flex items-start gap-3 text-xs leading-relaxed"
          >
            <span className="text-base shrink-0">⚠️</span>
            <div className="space-y-0.5">
              <span className="font-bold block">{t.offlineNotice}</span>
              <p>{t.offlineNoticeDesc}</p>
            </div>
          </div>
        )}

        {sessionRejected && (
          <div
            role="alert"
            className="p-3.5 sm:p-4 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed space-y-1"
          >
            <span className="font-bold block">{isRtl ? "نشست شما معتبر نیست" : "Your session is no longer valid"}</span>
            <p>
              {isRtl
                ? "این بلیط از نسخه ذخیره‌شده نمایش داده می‌شود و ممکن است به‌روز نباشد. برای تازه‌سازی دوباره وارد شوید."
                : "This pass is shown from your saved offline copy and may be out of date. Sign in again to refresh it."}
            </p>
            <LinkButton to={signInPath(slug, slug ? congressPath(slug, "my-ticket") : "/my-tickets")} variant="secondary" size="sm">
              {t.loginAction} →
            </LinkButton>
          </div>
        )}

        {/* Global Feedback Message */}
        {feedbackMessage && (
          <div
            role="status"
            className="p-3 rounded-xl bg-action-subtle text-action-primary border border-action-subtle-border text-xs animate-in fade-in"
          >
            {feedbackMessage}
          </div>
        )}

        {/* Error Alert */}
        {error && tickets.length === 0 && (
          <div
            role="alert"
            className="p-4 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
          >
            {error}
          </div>
        )}

        {/* Multi-Ticket Tab Switcher if attendee holds passes for multiple events */}
        {tickets.length > 1 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold text-text-muted block">
              {isRtl ? "انتخاب بلیط فعال:" : "Select Active Pass:"}
            </span>
            <div className="flex flex-wrap gap-2">
              {tickets.map((tkt, idx) => (
                <button
                  key={tkt.id}
                  type="button"
                  onClick={() => setActiveTicketIndex(idx)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                    idx === activeTicketIndex
                      ? "bg-action-primary text-text-inverse border-action-primary shadow-xs"
                      : "bg-surface-panel hover:bg-surface-page text-text-secondary border-border-default"
                  }`}
                >
                  {tkt.event_name || `Ticket #${idx + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {!slug && currentTicket && (
          <LinkButton to={congressPath(currentTicket.event_slug, "my-congress")} variant="secondary" size="md" isFullWidth>
            🏛️ {t.openCongressPortal}: {currentTicket.event_name}
          </LinkButton>
        )}

        {/* No Tickets View */}
        {tickets.length === 0 && !loading ? (
          <Card className="p-8 sm:p-12 text-center space-y-5 border-border-default">
            <div className="w-14 h-14 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-2xl font-bold">
              🎫
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg sm:text-xl font-bold text-text-primary">
                {t.noTicketsTitle}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                {t.noTicketsDesc}
              </p>
            </div>
            <div className="pt-2">
              <LinkButton to={slug ? `/e/${slug}` : "/"} variant="secondary" size="md">
                {t.browseEventsLink}
              </LinkButton>
            </div>
          </Card>
        ) : currentTicket ? (
          /* Primary Digital Attendee Pass Card (Printable, High-Contrast) */
          <article
            aria-labelledby="ticket-title"
            className="rounded-3xl bg-surface-panel border border-border-default shadow-sm overflow-hidden divide-y divide-border-subtle print:shadow-none print:border-slate-800"
          >
            {/* Top Pass Header */}
            <div className="p-6 sm:p-8 bg-surface-panel space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge variant="brand" size="md">
                  {t.digitalPassTitle}
                </Badge>
                <div className="flex items-center gap-2">
                  <Badge variant="success" size="md">
                    {t.activeBadge}
                  </Badge>
                  <button
                    type="button"
                    onClick={handlePrintBadge}
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-panel-subtle transition-colors text-xs print:hidden cursor-pointer"
                    title={isRtl ? "چاپ کارت ورود" : "Print Pass"}
                    aria-label={isRtl ? "چاپ کارت ورود" : "Print Pass"}
                  >
                    🖨️
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <h1 id="ticket-title" className="text-xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
                  {currentTicket.event_name}
                </h1>
                <p className="text-xs sm:text-sm text-text-secondary">
                  {t.ticketSubtitle}
                </p>
              </div>
            </div>

            {/* High-Contrast Scannable QR Core */}
            <div className="p-6 sm:p-8 bg-surface-page flex flex-col items-center justify-center text-center space-y-4">
              {/* Opaque White Plate with Guaranteed Quiet Zone */}
              <div className="p-4 sm:p-6 bg-white rounded-2xl border-2 border-border-default shadow-xs inline-block">
                <QRCode
                  value={currentTicket.qr_secret}
                  size={200}
                  level="H"
                  viewBox="0 0 256 256"
                  fgColor="#0F172A"
                  bgColor="#FFFFFF"
                  className="w-48 h-48 sm:w-56 sm:h-56 select-none"
                />
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider block">
                  {t.ticketIdLabel}
                </span>
                {/* LTR Bi-Directional text isolation for reference code */}
                <span className="text-xs font-mono font-bold text-text-primary bg-surface-panel px-2.5 py-1 rounded-md border border-border-subtle inline-block">
                  <bdi dir="ltr">{currentTicket.id.slice(0, 13).toUpperCase()}</bdi>
                </span>
              </div>
            </div>

            {/* Pass Metadata Grid */}
            <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm bg-surface-panel">
              <div className="space-y-1 p-3.5 rounded-xl bg-surface-page border border-border-subtle">
                <span className="text-[11px] font-medium text-text-muted block">
                  {t.tierLabel}
                </span>
                <span className="font-bold text-text-primary block">
                  {currentTicket.ticket_tier_name}
                </span>
                <span className="text-[11px] font-semibold text-action-primary block">
                  100% Free Pass
                </span>
              </div>

              <div className="space-y-1 p-3.5 rounded-xl bg-surface-page border border-border-subtle">
                <span className="text-[11px] font-medium text-text-muted block">
                  {isRtl ? "تاریخ ثبت بلیط" : "Issued Date"}
                </span>
                <span className="font-bold text-text-primary block">
                  {formatLocalizedDate(currentTicket.created_at, locale)}
                </span>
                <span className="text-[11px] text-text-muted block">
                  {t.syncedNotice}
                </span>
              </div>
            </div>
          </article>
        ) : null}

        {/* Saved Exhibition Booths Section */}
        <section aria-labelledby="saved-booths-heading" className="space-y-4 pt-6 border-t border-border-default">
          <div className="space-y-1">
            <h2 id="saved-booths-heading" className="text-lg sm:text-xl font-bold tracking-tight text-text-primary">
              {t.savedBoothsHeading}
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary">
              {t.savedBoothsDesc}
            </p>
          </div>

          {bookmarkedBooths.length === 0 ? (
            <div className="p-6 rounded-2xl bg-surface-panel border border-border-default text-center text-xs text-text-muted">
              {t.noSavedBooths}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {bookmarkedBooths.map((booth) => (
                <div
                  key={booth.booth_id}
                  className="p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-action-primary">
                        {booth.event_name}
                      </span>
                      <button
                        type="button"
                        disabled={removingBoothId === booth.booth_id}
                        onClick={() => handleRemoveBookmark(booth.booth_id)}
                        className="text-text-muted hover:text-status-danger-text text-xs transition-colors p-1 cursor-pointer"
                        title={t.removeBookmarkAction}
                        aria-label={`${t.removeBookmarkAction}: ${booth.name}`}
                      >
                        ✕
                      </button>
                    </div>
                    <h3 className="font-bold text-base text-text-primary tracking-tight">
                      {booth.name}
                    </h3>
                    <p className="text-xs text-text-secondary">
                      📍 {booth.location || (isRtl ? "سالن اصلی نمایشگاه" : "Main Exhibition Area")}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-border-subtle flex items-center justify-between">
                    <Link
                      to={`/e/${booth.event_slug}/booths/${booth.booth_id}`}
                      className="text-xs font-semibold text-action-primary hover:underline focus-visible:outline-focus-ring"
                    >
                      {t.viewBoothAction} {isRtl ? "←" : "→"}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AttendeeLayout>
  );
}
