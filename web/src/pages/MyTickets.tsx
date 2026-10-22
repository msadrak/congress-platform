import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  sessionChangedMessage,
} from "../lib/attendeeSession";
import {
  useAttendeeLocale,
  formatLocalizedNumber,
} from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { DigitalPassCard } from "../components/attendee/DigitalPassCard";
import { SectionHeader } from "../components/attendee/SectionHeader";
import { SignInPrompt } from "../components/attendee/SignInPrompt";

export default function MyTickets() {
  const localeHook = useAttendeeLocale();
  const { locale, t, isRtl } = localeHook;

  const { slug } = useParams<{ slug?: string }>();
  const [allTickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [activeTicketIndex, setActiveTicketIndex] = useState(0);
  const [bookmarkedBooths, setBookmarkedBooths] = useState<BookmarkedBoothOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isCachedPass, setIsCachedPass] = useState(false);
  // A live fetch is in flight: a cached pass on screen is not yet a sign of being offline.
  const [refreshing, setRefreshing] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [removingBoothId, setRemovingBoothId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "danger";
    /** The booth just removed, with its list position, offered back through Undo. */
    undo?: { booth: BookmarkedBoothOut; index: number };
  } | null>(null);
  const [sessionRejected, setSessionRejected] = useState(false);

  // Inside a congress portal only that congress's passes are shown, and only the card itself; saved
  // booths and the pass guide belong to the cross-congress `/my-tickets` page.
  const tickets = slug ? allTickets.filter((tkt) => tkt.event_slug === slug) : allTickets;

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
      setFetchFailed(false);
      setLoading(!hasCache);
      setRefreshing(true);
    } else {
      setTickets([]);
      setIsCachedPass(false);
      setLoading(false);
      return;
    }

    // 2. Fetch live data if online
    const fetchData = async () => {
      const client = createApiClient({ kind: "user", token });
      // Saved booths are listed only on the cross-congress page.
      const [ticketsRes, boothsRes] = await Promise.all([
        client.GET("/api/attendees/me/tickets"),
        slug ? null : client.GET("/api/attendees/me/bookmarks/booths"),
      ]);

      if (!active) return;
      // The stored session changed while the request was in flight: ignore this response and
      // never delete the newer session. The re-render re-reads the current token.
      if (!isStoredAttendeeToken(token)) return;

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

      if (boothsRes?.data) {
        setBookmarkedBooths(boothsRes.data);
      }
    };

    fetchData()
      .catch(() => {
        if (active) setFetchFailed(true);
      })
      .finally(() => {
        if (!active) return;
        setRefreshing(false);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, slug]);

  const handleRemoveBookmark = async (boothId: string) => {
    // A rejected session is kept only to present the labelled offline pass; it authorizes nothing.
    if (!token || sessionRejected) return;
    if (!isStoredAttendeeToken(token)) {
      setFeedback({ text: sessionChangedMessage(locale), tone: "danger" });
      return;
    }
    const index = bookmarkedBooths.findIndex((b) => b.booth_id === boothId);
    const booth = bookmarkedBooths[index];
    if (!booth) return;
    setRemovingBoothId(boothId);
    setFeedback(null);
    const client = createApiClient({ kind: "user", token });
    let failed = false;
    try {
      const { error: err, response } = await client.DELETE(
        "/api/attendees/me/bookmarks/booths/{booth_id}",
        { params: { path: { booth_id: boothId } } }
      );
      if (response.status === 401) rejectAttendeeToken(token);
      failed = Boolean(err);
    } catch {
      failed = true;
    }
    if (isStoredAttendeeToken(token)) {
      if (failed) {
        setFeedback({ text: isRtl ? "حذف نشد؛ دوباره تلاش کنید." : "Couldn't remove — try again.", tone: "danger" });
      } else {
        setBookmarkedBooths((prev) => prev.filter((b) => b.booth_id !== boothId));
        setFeedback({ text: t.bookmarkRemovedFeedback, tone: "success", undo: { booth, index } });
      }
    }
    setRemovingBoothId(null);
  };

  const handleUndoRemove = async (undo: { booth: BookmarkedBoothOut; index: number }) => {
    if (!token || sessionRejected) return;
    if (!isStoredAttendeeToken(token)) {
      setFeedback({ text: sessionChangedMessage(locale), tone: "danger" });
      return;
    }
    setRemovingBoothId(undo.booth.booth_id);
    const client = createApiClient({ kind: "user", token });
    let failed = false;
    try {
      const { error: err, response } = await client.POST(
        "/api/attendees/me/bookmarks/booths/{booth_id}",
        { params: { path: { booth_id: undo.booth.booth_id } } }
      );
      if (response.status === 401) rejectAttendeeToken(token);
      failed = Boolean(err);
    } catch {
      failed = true;
    }
    if (isStoredAttendeeToken(token)) {
      if (failed) {
        setFeedback({ text: isRtl ? "بازگردانده نشد؛ دوباره تلاش کنید." : "Couldn't restore — try again.", tone: "danger", undo });
      } else {
        setBookmarkedBooths((prev) =>
          prev.some((b) => b.booth_id === undo.booth.booth_id)
            ? prev
            : [...prev.slice(0, undo.index), undo.booth, ...prev.slice(undo.index)]
        );
        setFeedback(null);
      }
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
  const passArea =
    tickets.length === 0 && !loading ? (
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
      <DigitalPassCard
        ticket={currentTicket}
        locale={locale}
        t={t}
        verified={!isCachedPass && !sessionRejected}
        onPrint={handlePrintBadge}
      />
    ) : null;
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
      <div className={slug ? "mx-auto max-w-[480px] space-y-5 px-4 pt-5 sm:pt-8" : "mx-auto max-w-6xl space-y-6 px-4 pt-5 sm:px-6 sm:pt-8"}>
        {/* Network / Offline & Cache Status Banner */}
        {(isOffline || (isCachedPass && !refreshing)) && (
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
        {feedback && (
          <div
            role={feedback.tone === "danger" ? "alert" : "status"}
            className={`at-print-collapse flex flex-wrap items-center gap-2.5 rounded-2xl border px-4 py-3 text-xs font-medium motion-safe:animate-fade ${
              feedback.tone === "danger"
                ? "border-status-danger-border bg-status-danger-bg text-status-danger-text"
                : "border-action-subtle-border bg-action-subtle text-action-primary"
            }`}
          >
            <Icon name={feedback.tone === "danger" ? "alert" : "check-circle"} size={18} />
            <span className="flex-1">{feedback.text}</span>
            {feedback.undo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={removingBoothId === feedback.undo.booth.booth_id}
                onClick={() => feedback.undo && handleUndoRemove(feedback.undo)}
                className="min-h-11"
              >
                {isRtl ? "بازگرداندن" : "Undo"}
              </Button>
            )}
          </div>
        )}

        {/* Error Alert */}
        {(error || fetchFailed) && tickets.length === 0 && (
          <div
            role="alert"
            className="at-print-collapse flex flex-wrap items-start gap-2.5 rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs leading-relaxed text-status-danger-text"
          >
            <Icon name="alert" size={18} className="shrink-0" />
            <span className="min-w-0 flex-1">
              {error ?? (isRtl ? "اتصال را بررسی کنید و دوباره تلاش کنید." : "Check your connection and try again.")}
            </span>
            <Button type="button" variant="secondary" size="md" onClick={() => window.location.reload()}>
              <Icon name="sync" size={16} />
              {isRtl ? "تلاش دوباره" : "Try again"}
            </Button>
          </div>
        )}

        {/* Pass switcher: several passes (for different congresses, or several for this one) */}
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
                    {(slug ? tkt.ticket_tier_name : tkt.event_name) ||
                      (isRtl ? `بلیط ${formatLocalizedNumber(idx + 1, locale)}` : `Ticket ${idx + 1}`)}
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

        {slug ? (
          passArea
        ) : (
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-16">
          {passArea ?? <div />}

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
                      <span className="block text-[11px] font-semibold text-event-accent">{booth.event_name}</span>
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
        )}
      </div>
    </AttendeeLayout>
  );
}
