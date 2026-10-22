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
  formatLocalizedNumber,
} from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { Monogram } from "../components/attendee/Monogram";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { SignInPrompt } from "../components/attendee/SignInPrompt";
import { formatDateRange } from "../components/attendee/congressTime";

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
    // oxlint-disable-next-line react/set-state-in-effect -- owner-isolation reset keyed on the localStorage token (external, not React state); it must commit together with the cache swap and refetch for the new session.
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

  const signInTarget = signInPath(slug, slug ? congressPath(slug, "my-ticket") : "/my-tickets");

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
        <SignInPrompt
          seed={slug}
          icon="ticket"
          title={t.unauthenticatedTitle}
          description={t.unauthenticatedDesc}
          actionLabel={t.loginAction}
          to={signInTarget}
        />
      </AttendeeLayout>
    );
  }

  // Loading skeleton
  if (loading && tickets.length === 0) {
    return (
      <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
        <div role="status" aria-label={t.navMyTicket} className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-8">
          <div className="mx-auto w-full max-w-[440px] space-y-4 lg:mx-0">
            <div className="skeleton h-40 shape-arc-lg" />
            <div className="skeleton mx-auto size-60 rounded-[20px]" />
            <div className="skeleton h-28 rounded-2xl" />
          </div>
        </div>
      </AttendeeLayout>
    );
  }

  // Active ticket
  const currentTicket: AttendeeTicketDetail | undefined = tickets[activeTicketIndex] ?? tickets[0];
  const issuedLabel = isRtl ? "تاریخ ثبت بلیط" : "Issued Date";
  const holderLabel = isRtl ? "دارنده کارت" : "Pass holder";
  const printLabel = isRtl ? "چاپ کارت ورود" : "Print Pass";
  const guide: { icon: "qr" | "wifi-off" | "print"; title: string; body: string }[] = [
    {
      icon: "qr",
      title: isRtl ? "در گیت ورود" : "At the gate",
      body: isRtl
        ? "نور صفحه را زیاد کنید و کیوآر را صاف و بی‌حرکت زیر اسکنر نگه دارید."
        : "Turn your screen brightness up and hold the QR flat and still under the scanner.",
    },
    { icon: "wifi-off", title: isRtl ? "بدون اینترنت" : "Works offline", body: t.offlineNoticeDesc },
    {
      icon: "print",
      title: isRtl ? "نسخه کاغذی" : "Paper backup",
      body: isRtl
        ? "با نماد چاپ روی کارت، نسخه‌ای کاغذی با همان کیوآر تهیه کنید."
        : "Use the print icon on the pass for a paper copy carrying the same QR.",
    },
  ];

  return (
    <AttendeeLayout activeTab="tickets" localeProps={localeHook} eventSlug={slug} destination="my-ticket">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pt-5 sm:px-6 sm:pt-8">
        {/* Network / Offline & Cache Status Banner */}
        {(isOffline || isCachedPass) && (
          <div
            role="status"
            className="at-print-collapse flex items-start gap-3 rounded-2xl border border-status-warning-border bg-status-warning-bg p-4 text-xs leading-relaxed text-status-warning-text"
          >
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70">
              <Icon name="wifi-off" size={18} />
            </span>
            <div className="space-y-0.5">
              <span className="block text-sm font-semibold">{t.offlineNotice}</span>
              <p>{t.offlineNoticeDesc}</p>
            </div>
          </div>
        )}

        {sessionRejected && (
          <div
            role="alert"
            className="at-print-collapse flex flex-col gap-3 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs leading-relaxed text-status-danger-text sm:flex-row sm:items-center"
          >
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/70">
              <Icon name="key" size={18} />
            </span>
            <div className="flex-1 space-y-0.5">
              <span className="block text-sm font-semibold">{isRtl ? "نشست شما معتبر نیست" : "Your session is no longer valid"}</span>
              <p>
                {isRtl
                  ? "این بلیط از نسخه ذخیره‌شده نمایش داده می‌شود و ممکن است به‌روز نباشد. برای تازه‌سازی دوباره وارد شوید."
                  : "This pass is shown from your saved offline copy and may be out of date. Sign in again to refresh it."}
              </p>
            </div>
            <LinkButton to={signInTarget} variant="secondary" size="md" className="self-start sm:self-center">
              {t.loginAction}
              <Icon name="arrow-right" size={16} />
            </LinkButton>
          </div>
        )}

        {/* Global Feedback Message */}
        {feedbackMessage && (
          <div
            role="status"
            className="at-print-collapse flex items-center gap-2.5 rounded-2xl border border-action-subtle-border bg-action-subtle px-4 py-3 text-xs font-medium text-action-primary motion-safe:animate-fade"
          >
            <Icon name="check-circle" size={18} />
            {feedbackMessage}
          </div>
        )}

        {/* Error Alert */}
        {error && tickets.length === 0 && (
          <div
            role="alert"
            className="at-print-collapse flex items-start gap-2.5 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs leading-relaxed text-status-danger-text"
          >
            <Icon name="alert" size={18} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Multi-Ticket Switcher if attendee holds passes for multiple events */}
        {tickets.length > 1 && (
          <div className="at-print-collapse space-y-2.5">
            <span className="block text-xs font-semibold text-text-muted">
              {isRtl ? "انتخاب بلیط فعال:" : "Select Active Pass:"}
            </span>
            <div className="flex flex-wrap gap-2">
              {tickets.map((tkt, idx) => {
                const selected = idx === activeTicketIndex;
                return (
                  <button
                    key={tkt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setActiveTicketIndex(idx)}
                    className={`press inline-flex min-h-11 items-center gap-2.5 rounded-full border py-1.5 ps-1.5 pe-4 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                      selected
                        ? "border-transparent bg-surface-ink text-white shadow-lift"
                        : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
                    }`}
                  >
                    <span aria-hidden="true" className="size-8 shrink-0 overflow-hidden rounded-full">
                      <CongressSignature seed={tkt.event_slug} tone="ink" className="size-full" />
                    </span>
                    {tkt.event_name || `Ticket #${idx + 1}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!slug && currentTicket && (
          <Link
            to={congressPath(currentTicket.event_slug, "my-congress")}
            className="at-print-collapse press group flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-border-default bg-surface-panel px-4 py-3 text-sm font-semibold text-text-primary shadow-soft transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="size-9 shrink-0 overflow-hidden rounded-lg [border-start-end-radius:14px]">
                <CongressSignature seed={currentTicket.event_slug} tone="ink" className="size-full" />
              </span>
              <span className="min-w-0">{t.openCongressPortal}: {currentTicket.event_name}</span>
            </span>
            <Icon name="arrow-right" size={18} className="shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
          </Link>
        )}

        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-16">
          {/* No Tickets View */}
          {tickets.length === 0 && !loading ? (
            <div className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel p-8 text-center shadow-soft sm:p-10">
              <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-60" />
              <div className="relative space-y-5">
                <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-2xl [border-start-end-radius:26px] bg-surface-ink text-white shadow-lift">
                  <Icon name="ticket" size={28} />
                </span>
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{t.noTicketsTitle}</h2>
                  <p className="text-sm leading-relaxed text-text-secondary">{t.noTicketsDesc}</p>
                </div>
                <LinkButton to={slug ? `/e/${slug}` : "/"} variant="secondary" size="md">
                  {t.browseEventsLink}
                  <Icon name="arrow-right" size={16} />
                </LinkButton>
              </div>
            </div>
          ) : currentTicket ? (
            /* Digital credential: ink pass with arc corner, perforated stub; prints black on white */
            <article
              aria-labelledby="ticket-title"
              className="print-pass at-pass mx-auto w-full max-w-[440px] overflow-hidden shape-arc-lg shadow-pop lg:mx-0"
            >
              <div aria-hidden="true" className="at-print-hide pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 overflow-hidden">
                <CongressSignature seed={currentTicket.event_slug} tone="ink" className="size-full" />
                <div className="absolute inset-0 bg-linear-to-b from-surface-ink/30 via-surface-ink/70 to-surface-ink" />
              </div>
              <div aria-hidden="true" className="at-print-hide h-[3px] bg-[image:var(--grad-aiteb)]" />

              {/* Pass head */}
              <div className="space-y-5 px-6 pt-6 sm:px-7 sm:pt-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-300">{t.digitalPassTitle}</span>
                  <button
                    type="button"
                    onClick={handlePrintBadge}
                    className="at-print-hide press -me-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-300 transition-colors hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid print:hidden"
                    title={printLabel}
                    aria-label={printLabel}
                  >
                    <Icon name="print" size={20} />
                  </button>
                </div>

                <div className="space-y-2.5">
                  <h1 id="ticket-title" className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-white text-balance sm:text-[1.75rem]">
                    {currentTicket.event_name}
                  </h1>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="calendar" size={14} />
                      {formatDateRange(currentTicket.event_starts_at, currentTicket.event_ends_at, locale)}
                    </span>
                    {currentTicket.event_location && (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Icon name="pin" size={14} />
                        <span className="break-words">{currentTicket.event_location}</span>
                      </span>
                    )}
                  </p>
                </div>

                <span className="at-pass-chip inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15">
                  <span aria-hidden="true" className="at-pass-chip-dot size-2 rounded-full bg-status-success-solid shadow-[0_0_0_3px_rgb(11_155_104/0.25)]" />
                  {t.activeBadge}
                </span>
              </div>

              {/* High-contrast scannable QR: black modules on a pure white plate with a quiet zone */}
              <div className="flex flex-col items-center gap-4 px-6 pt-7 pb-8 sm:px-7">
                <div className="at-qr-plate p-6">
                  <QRCode
                    value={currentTicket.qr_secret}
                    size={200}
                    level="H"
                    viewBox="0 0 256 256"
                    fgColor="#000000"
                    bgColor="#FFFFFF"
                    className="block h-48 w-48 select-none min-[380px]:h-56 min-[380px]:w-56"
                  />
                </div>
                <p className="max-w-[34ch] text-center text-xs leading-relaxed text-ink-300">{t.ticketSubtitle}</p>
              </div>

              <div aria-hidden="true" className="at-perf" />

              {/* Stub: holder, tier, reference */}
              <div className="grid grid-cols-2 gap-x-5 gap-y-5 px-6 pt-6 pb-7 sm:px-7">
                <div className="col-span-2 flex items-center gap-3">
                  <Monogram name={currentTicket.attendee_name} seed={currentTicket.id} size="md" className="at-print-hide" />
                  <div className="min-w-0">
                    <span className="block text-[11px] font-medium text-ink-400">{holderLabel}</span>
                    <span className="block truncate text-lg font-semibold tracking-[-0.02em] text-white">{currentTicket.attendee_name}</span>
                  </div>
                </div>
                <div className="min-w-0 space-y-1 border-t border-white/10 pt-4">
                  <span className="block text-[11px] font-medium text-ink-400">{t.tierLabel}</span>
                  <span className="block text-sm font-semibold text-white break-words">{currentTicket.ticket_tier_name}</span>
                </div>
                <div className="min-w-0 space-y-1 border-t border-white/10 pt-4">
                  <span className="block text-[11px] font-medium text-ink-400">{issuedLabel}</span>
                  <span className="block text-sm font-semibold text-white">{formatLocalizedDate(currentTicket.created_at, locale)}</span>
                </div>
                <div className="col-span-2 flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="space-y-1">
                    <span className="block text-[11px] font-medium text-ink-400">{t.ticketIdLabel}</span>
                    {/* LTR bidi isolation for the reference code */}
                    <span className="block font-mono text-sm font-semibold tracking-[0.08em] text-white">
                      <bdi dir="ltr">{currentTicket.id.slice(0, 13).toUpperCase()}</bdi>
                    </span>
                  </div>
                  {!isCachedPass && !sessionRejected && (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
                      <Icon name="check-circle" size={14} className="text-status-success-solid" />
                      {t.syncedNotice}
                    </span>
                  )}
                </div>
              </div>
            </article>
          ) : (
            <div />
          )}

          <div className="at-print-collapse space-y-12 lg:pt-2">
          {currentTicket && (
            <section aria-labelledby="pass-guide-heading" className="space-y-5">
              <SectionHeader id="pass-guide-heading" title={isRtl ? "استفاده از کارت ورود" : "Using your pass"} />
              <ol className="grid gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {guide.map((step, i) => (
                  <li key={step.icon} className="flex gap-3.5 sm:flex-col lg:flex-row xl:flex-col">
                    <span aria-hidden="true" className="relative grid size-11 shrink-0 place-items-center rounded-xl [border-start-end-radius:18px] bg-surface-ink text-white">
                      <Icon name={step.icon} size={20} />
                      <span className="absolute -top-1.5 -end-1.5 grid size-5 place-items-center rounded-full bg-surface-page font-mono text-[10px] font-semibold text-text-secondary ring-1 ring-border-default">
                        {formatLocalizedNumber(i + 1, locale)}
                      </span>
                    </span>
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-text-primary">{step.title}</h3>
                      <p className="text-xs leading-relaxed text-text-secondary">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Saved Exhibition Booths Section */}
          <section aria-labelledby="saved-booths-heading" className="space-y-5">
            <SectionHeader id="saved-booths-heading" title={t.savedBoothsHeading} description={t.savedBoothsDesc} />

            {bookmarkedBooths.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong p-5 text-sm text-text-muted">
                <Icon name="bookmark" size={20} className="text-ink-300" />
                {t.noSavedBooths}
              </div>
            ) : (
              <ul className="divide-y divide-border-default border-y border-border-default">
                {bookmarkedBooths.map((booth) => (
                  <li key={booth.booth_id} className="flex items-start gap-4 py-4">
                    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-event-accent-soft text-event-accent">
                      <Icon name="bookmark" size={18} fill="currentColor" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      {!slug && <span className="block text-[11px] font-semibold text-event-accent">{booth.event_name}</span>}
                      <h3 className="text-base font-semibold tracking-[-0.01em] text-text-primary break-words">{booth.name}</h3>
                      {booth.location && (
                        <p className="flex items-center gap-1.5 text-xs text-text-muted">
                          <Icon name="pin" size={14} className="text-ink-400" />
                          {booth.location}
                        </p>
                      )}
                      <Link
                        to={`/e/${booth.event_slug}/booths/${booth.booth_id}`}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-action-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
                      >
                        {t.viewBoothAction}
                        <Icon name="arrow-right" size={15} />
                      </Link>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={removingBoothId === booth.booth_id}
                      onClick={() => handleRemoveBookmark(booth.booth_id)}
                      className="min-h-11 min-w-11 shrink-0 rounded-full px-0 hover:text-status-danger-text"
                      title={t.removeBookmarkAction}
                      aria-label={`${t.removeBookmarkAction}: ${booth.name}`}
                    >
                      <Icon name="x" size={18} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>
        </div>
      </div>
    </AttendeeLayout>
  );
}
