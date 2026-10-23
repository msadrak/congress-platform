import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { createApiClient, type AttendeeTicketDetail } from "../api/client";
import { loadOwnerScopedTickets, saveOwnerScopedTickets } from "../lib/ticketCache";
import { isStoredAttendeeToken, keepPassOnExpiredSession, sessionChangedMessage } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { formatLocalizedDate, formatLocalizedNumber, useAttendeeLocale } from "../lib/i18n";
import { AttendeeLayout } from "../layouts/AttendeeLayout";
import { congressPath } from "../lib/congressContext";
import { signInPath } from "../lib/safeRedirect";
import { readableApiError } from "../lib/attendeeErrors";
import { isLinkPass, linkPassCard, loadLinkPasses, type LinkPass } from "../lib/linkPass";
import { canSelfCancel, isCancelledStatus, passSwitchLabels, passesForCongress } from "../lib/attendeePasses";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DigitalPassCard, type PassCardTicket } from "../components/attendee/DigitalPassCard";
import { QrFullscreen } from "../components/attendee/QrFullscreen";
import { InstallHint } from "../components/attendee/InstallHint";
import { SignInPrompt } from "../components/attendee/SignInPrompt";

const COPY = {
  fa: {
    online: "به‌روز و آماده نشان دادن در ورودی",
    refreshing: "در حال به‌روزرسانی کارت ورود…",
    sessionExpired: "نشست شما معتبر نیست؛ نسخه ذخیره‌شده نمایش داده می‌شود.",
    loadFailed: "کارت ورود بارگذاری نشد",
    loadFailedBody: "اتصال را بررسی کنید و دوباره تلاش کنید.",
    retry: "تلاش دوباره",
    noPassTitle: "برای این همایش کارت ورود ندارید",
    noPassBody: "برای شرکت در همایش، از صفحه همایش کارت ورود رزرو کنید.",
    reserve: "رزرو کارت ورود",
    cancelledTitle: "این کارت ورود لغو شده است",
    cancelledBody: "کد QR آن دیگر در ورودی پذیرفته نمی‌شود. اگر می‌خواهید در همایش شرکت کنید، دوباره کارت ورود رزرو کنید.",
    choosePass: "کارت‌های ورود شما",
    selfCancel: "لغو ثبت‌نام",
    selfCancelHint: "تا پیش از آغاز همایش می‌توانید ثبت‌نام خود را لغو کنید.",
    cancelling: "در حال لغو…",
    confirmTitle: "ثبت‌نام لغو شود؟",
    confirmBody: (event: string) =>
      `ثبت‌نام شما در «${event}» لغو می‌شود، کد QR این کارت ورود دیگر در ورودی کار نمی‌کند و جای شما آزاد می‌شود. این کار برگشت‌پذیر نیست؛ برای شرکت دوباره باید از نو ثبت‌نام کنید.`,
    confirmAction: "بله، لغو شود",
    keepAction: "نه، نگه دار",
    cancelDone: "ثبت‌نام شما لغو شد.",
    cancelFailed: "لغو انجام نشد؛ دوباره تلاش کنید.",
    cancelOffline: "اتصال برقرار نشد؛ ثبت‌نام لغو نشد.",
  },
  en: {
    online: "Up to date and ready to show at the entrance",
    refreshing: "Updating your pass…",
    sessionExpired: "Your session is no longer valid — showing your saved copy.",
    loadFailed: "Couldn't load your pass",
    loadFailedBody: "Check your connection and try again.",
    retry: "Try again",
    noPassTitle: "You have no pass for this congress",
    noPassBody: "To attend, reserve a pass on the congress page.",
    reserve: "Reserve a pass",
    cancelledTitle: "This pass has been cancelled",
    cancelledBody: "Its QR code is no longer accepted at the entrance. To attend the congress, reserve a pass again.",
    choosePass: "Your passes",
    selfCancel: "Cancel registration",
    selfCancelHint: "You can cancel your registration until the congress starts.",
    cancelling: "Cancelling…",
    confirmTitle: "Cancel your registration?",
    confirmBody: (event: string) =>
      `Your registration for “${event}” is cancelled, this pass's QR code stops working at the entrance and your place is released. This can't be undone; to attend you would need to register again.`,
    confirmAction: "Yes, cancel it",
    keepAction: "Keep my pass",
    cancelDone: "Your registration has been cancelled.",
    cancelFailed: "Couldn't cancel — try again.",
    cancelOffline: "Couldn't connect; your registration was not cancelled.",
  },
} as const;

type LineTone = "success" | "neutral" | "warning" | "danger" | "info";
const LINE_TONES: Record<LineTone, string> = {
  success: "border-status-success-border bg-status-success-bg text-status-success-text",
  neutral: "border-border-default bg-surface-panel text-text-secondary",
  warning: "border-status-warning-border bg-status-warning-bg text-status-warning-text",
  danger: "border-status-danger-border bg-status-danger-bg text-status-danger-text",
  info: "border-action-subtle-border bg-action-subtle text-action-primary",
};

/** The pass page's one status line: online, offline copy, session expired or opened from the SMS link. */
function StatusLine({ tone, icon, text, action, testId }: { tone: LineTone; icon: IconName; text: string; action?: ReactNode; testId?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-testid={testId ?? "pass-status-line"}
      className={`at-print-collapse flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl border px-3.5 py-2.5 text-xs font-semibold leading-relaxed ${LINE_TONES[tone]}`}
    >
      <Icon name={icon} size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      {action}
    </div>
  );
}

/** Several passes for one congress: a switcher with distinct labels (tier and issue date). */
function PassSwitcher({ labels, selected, onSelect, title }: { labels: string[]; selected: number; onSelect: (i: number) => void; title: string }) {
  return (
    <div role="group" aria-label={title} className="at-print-collapse flex flex-wrap gap-2">
      {labels.map((label, idx) => (
        <button
          key={`${label}-${idx}`}
          type="button"
          aria-pressed={idx === selected}
          onClick={() => onSelect(idx)}
          className={`press inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
            idx === selected
              ? "border-transparent bg-surface-ink text-white shadow-lift"
              : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
          }`}
        >
          <Icon name="ticket" size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}

function hasQrFlag(state: unknown): boolean {
  return typeof state === "object" && state !== null && "qrFullscreen" in state && state.qrFullscreen === true;
}

/** `/c/:slug/my-ticket`: this congress's pass, QR first. */
export default function MyTickets() {
  const localeHook = useAttendeeLocale();
  const { locale, t } = localeHook;
  const copy = COPY[locale];
  const { slug = "" } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { token } = useAttendeeSession();

  const [allTickets, setTickets] = useState<AttendeeTicketDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The failed response body (worded at render time), or `null` when no response arrived at all.
  const [loadError, setLoadError] = useState<{ body: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isCachedPass, setIsCachedPass] = useState(false);
  // A live fetch is in flight: a cached pass on screen is not yet a sign of being offline.
  const [refreshing, setRefreshing] = useState(false);
  const [sessionRejected, setSessionRejected] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  // Passes opened from the SMS short link (ADR 0015), kept on this device without a sign-in. Shown only while
  // nobody is signed in; history state carries the pass when the browser cannot store it.
  const [linkPasses] = useState<LinkPass[]>(() => {
    const stored = loadLinkPasses(slug);
    if (stored.length > 0) return stored;
    const state: unknown = location.state;
    const handed = typeof state === "object" && state !== null && "linkPass" in state ? state.linkPass : null;
    return isLinkPass(handed) && handed.event.slug === slug ? [handed] : [];
  });
  const [linkPassIndex, setLinkPassIndex] = useState(0);

  // The full-screen QR lives in its own history entry, so the back button closes it.
  const qrOpen = hasQrFlag(location.state);
  const openedQrHere = useRef(false);
  const openQr = () => {
    openedQrHere.current = true;
    const base = typeof location.state === "object" && location.state !== null ? location.state : {};
    navigate(location.pathname, { state: { ...base, qrFullscreen: true } });
  };
  const closeQr = useCallback(() => {
    if (openedQrHere.current) {
      openedQrHere.current = false;
      navigate(-1);
      return;
    }
    // Restored with the page (reload): leave the entry in place, just closed.
    const base = typeof location.state === "object" && location.state !== null ? location.state : {};
    navigate(location.pathname, { replace: true, state: { ...base, qrFullscreen: false } });
  }, [location.pathname, location.state, navigate]);

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
    if (!token) {
      setTickets([]);
      setIsCachedPass(false);
      setLoading(false);
      return;
    }
    // Stage A: the owner-scoped cached passes at once (fails closed without a session).
    const cacheResult = loadOwnerScopedTickets(token);
    const cached = cacheResult.status === "valid" ? cacheResult.tickets : [];
    const hasCachedPass = cached.some((tkt) => tkt.event_slug === slug);
    // A different session must never inherit the previous owner's passes.
    setTickets(cached);
    setIsCachedPass(hasCachedPass);
    setLoadError(null);
    setLoading(!hasCachedPass);
    setRefreshing(true);

    // Stage B: the live list, cancelled passes included so a cancellation is explained rather than hidden.
    // This page decides a 401 itself: the session policy's one exception (keepPassOnExpiredSession).
    const client = createApiClient({ kind: "user", token }, { onUnauthorized: null });
    client
      .GET("/api/attendees/me/tickets", { params: { query: { include_cancelled: true } } })
      .then((res) => {
        if (!active) return;
        // The stored session changed while the request was in flight: ignore this response and never delete
        // the newer session. The re-render re-reads the current token.
        if (!isStoredAttendeeToken(token)) return;
        if (res.data) {
          setTickets(res.data);
          setIsCachedPass(false);
          // The offline cache holds working passes only (other pages read it as such).
          saveOwnerScopedTickets(token, res.data.filter((tkt) => !isCancelledStatus(tkt.status)));
          return;
        }
        if (res.response.status === 401) {
          // Keep the owner's cached pass on screen, labelled; with nothing to show the session is rejected
          // (token and passes) and the sign-in view returns.
          if (keepPassOnExpiredSession(token, hasCachedPass)) setSessionRejected(true);
          return;
        }
        if (!hasCachedPass) setLoadError({ body: res.error });
      })
      .catch(() => {
        if (active && !hasCachedPass) setLoadError({ body: null });
      })
      .finally(() => {
        if (!active) return;
        setRefreshing(false);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, slug, attempt]);

  const { active: activePasses, cancelled: cancelledPasses } = passesForCongress(allTickets, slug);
  const current = activePasses.find((tkt) => tkt.id === selectedId) ?? activePasses[0];
  const verified = !isCachedPass && !sessionRejected && !refreshing;
  const formatDate = (iso: string) => formatLocalizedDate(iso, locale);
  const formatNumber = (n: number) => formatLocalizedNumber(n, locale);

  const handlePrint = () => window.print();

  const cancelPass = async (ticket: AttendeeTicketDetail) => {
    if (!token || sessionRejected) return;
    if (!isStoredAttendeeToken(token)) {
      setNotice({ text: sessionChangedMessage(locale), tone: "danger" });
      return;
    }
    setCancelling(true);
    setNotice(null);
    try {
      const { data, error } = await createApiClient({ kind: "user", token }).POST("/api/attendees/me/tickets/{ticket_id}/cancel", {
        params: { path: { ticket_id: ticket.id } },
      });
      if (!isStoredAttendeeToken(token)) return;
      if (data) {
        const next = allTickets.map((tkt) => (tkt.id === data.id ? data : tkt));
        setTickets(next);
        saveOwnerScopedTickets(token, next.filter((tkt) => !isCancelledStatus(tkt.status)));
        setNotice({ text: copy.cancelDone, tone: "success" });
      } else {
        setNotice({ text: readableApiError(error, locale) ?? copy.cancelFailed, tone: "danger" });
      }
    } catch {
      setNotice({ text: copy.cancelOffline, tone: "danger" });
    } finally {
      setCancelling(false);
    }
  };

  const shell = (content: ReactNode) => (
    <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-ticket">
      <div className="mx-auto max-w-[480px] space-y-4 px-4 pt-4 sm:pt-8">{content}</div>
    </AttendeeLayout>
  );
  const qrView = (pass: PassCardTicket) =>
    qrOpen && !isCancelledStatus(pass.status ?? "active") ? (
      <QrFullscreen value={pass.qr_secret} holder={pass.attendee_name} tier={pass.ticket_tier_name} locale={locale} onClose={closeQr} />
    ) : null;
  const noticeLine = notice ? (
    <StatusLine tone={notice.tone} icon={notice.tone === "success" ? "check-circle" : "alert"} text={notice.text} testId="pass-notice" />
  ) : null;

  // Opened from the SMS link without signing in: that pass, read-only, with a way to sign in for the rest.
  const linkPass = !token ? (linkPasses[linkPassIndex] ?? linkPasses[0]) : undefined;
  if (linkPass) {
    const card = linkPassCard(linkPass);
    return shell(
      <>
        <StatusLine
          tone="info"
          icon="link"
          text={t.linkPassNote}
          testId="link-pass-note"
          action={
            <LinkButton to={signInPath(slug, congressPath(slug, "my-congress"))} variant="ghost" size="sm" className="min-h-9 !px-2">
              {t.linkPassSignInAction}
              <Icon name="arrow-right" size={14} />
            </LinkButton>
          }
        />
        {linkPasses.length > 1 && (
          <PassSwitcher
            title={copy.choosePass}
            labels={passSwitchLabels(linkPasses.map(linkPassCard), formatDate, formatNumber)}
            selected={linkPasses.indexOf(linkPass)}
            onSelect={setLinkPassIndex}
          />
        )}
        <DigitalPassCard ticket={card} locale={locale} t={t} onPrint={handlePrint} onExpand={openQr} />
        <InstallHint locale={locale} />
        {qrView(card)}
      </>,
    );
  }

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <AttendeeLayout localeProps={localeHook} eventSlug={slug} destination="my-ticket">
        <SignInPrompt
          seed={slug}
          icon="ticket"
          title={t.unauthenticatedTitle}
          description={t.unauthenticatedDesc}
          actionLabel={t.loginAction}
          to={signInPath(slug, congressPath(slug, "my-ticket"))}
        />
      </AttendeeLayout>
    );
  }

  const nothingYet = activePasses.length === 0 && cancelledPasses.length === 0;
  if (loading && nothingYet) {
    return shell(
      <div role="status" aria-label={t.navMyTicket} aria-busy="true" className="space-y-4">
        <div className="skeleton mx-auto aspect-square w-72 rounded-[20px]" />
        <div className="skeleton mx-auto h-6 w-48 rounded-full" />
        <div className="skeleton h-28 rounded-2xl" />
      </div>,
    );
  }

  // A failed load is never presented as "no pass".
  if (loadError && nothingYet) {
    const detail = loadError.body === null ? null : readableApiError(loadError.body, locale);
    return shell(
      <div role="alert" data-testid="pass-load-error" className="space-y-4 rounded-2xl border border-status-danger-border bg-status-danger-bg p-5 text-status-danger-text">
        <div className="flex items-start gap-3">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">{copy.loadFailed}</p>
            <p className="text-xs leading-relaxed">{detail ?? copy.loadFailedBody}</p>
          </div>
        </div>
        <Button type="button" variant="secondary" size="md" onClick={() => setAttempt((n) => n + 1)}>
          <Icon name="sync" size={16} />
          {copy.retry}
        </Button>
      </div>,
    );
  }

  const sessionLine = sessionRejected ? (
    <StatusLine
      tone="danger"
      icon="key"
      text={copy.sessionExpired}
      action={
        <LinkButton to={signInPath(slug, congressPath(slug, "my-ticket"))} variant="ghost" size="sm" className="min-h-9 !px-2">
          {t.loginAction}
          <Icon name="arrow-right" size={14} />
        </LinkButton>
      }
    />
  ) : null;

  if (!current) {
    const cancelled = cancelledPasses[0];
    return shell(
      <>
        {noticeLine ?? sessionLine}
        {cancelled && <DigitalPassCard ticket={cancelled} locale={locale} t={t} />}
        <div
          data-testid={cancelled ? "pass-cancelled" : "pass-empty"}
          className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel p-6 text-center shadow-soft sm:p-8"
        >
          <div aria-hidden="true" className="bg-meridian absolute inset-0 opacity-60" />
          <div className="relative space-y-4">
            {!cancelled && (
              <span aria-hidden="true" className="mx-auto grid size-14 place-items-center rounded-2xl [border-start-end-radius:24px] bg-surface-ink text-white shadow-lift">
                <Icon name="ticket" size={26} />
              </span>
            )}
            <div className="space-y-2">
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-primary">{cancelled ? copy.cancelledTitle : copy.noPassTitle}</h2>
              <p className="text-sm leading-relaxed text-text-secondary">{cancelled ? copy.cancelledBody : copy.noPassBody}</p>
            </div>
            <LinkButton to={`/e/${encodeURIComponent(slug)}`} variant="primary" size="md">
              <Icon name="ticket" size={16} />
              {copy.reserve}
            </LinkButton>
          </div>
        </div>
      </>,
    );
  }

  // One status line, most important first.
  const line =
    noticeLine ??
    sessionLine ??
    (isOffline || (isCachedPass && !refreshing) ? (
      <StatusLine tone="warning" icon="wifi-off" text={t.offlineNotice} />
    ) : refreshing ? (
      <StatusLine tone="neutral" icon="sync" text={copy.refreshing} />
    ) : (
      <StatusLine tone="success" icon="check-circle" text={copy.online} />
    ));

  return shell(
    <>
      {line}
      {activePasses.length > 1 && (
        <PassSwitcher
          title={copy.choosePass}
          labels={passSwitchLabels(activePasses, formatDate, formatNumber)}
          selected={activePasses.indexOf(current)}
          onSelect={(i) => setSelectedId(activePasses[i]?.id ?? null)}
        />
      )}
      <DigitalPassCard ticket={current} locale={locale} t={t} onPrint={handlePrint} onExpand={openQr} />
      <InstallHint locale={locale} />
      {verified && canSelfCancel(current) && (
        <div className="at-print-collapse flex flex-col items-center gap-1 pt-2 text-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cancelling}
            onClick={() => setConfirmingCancel(true)}
            className="min-h-11 text-status-danger-text hover:bg-status-danger-bg"
          >
            <Icon name="x-circle" size={16} />
            {cancelling ? copy.cancelling : copy.selfCancel}
          </Button>
          <p className="text-xs text-text-muted">{copy.selfCancelHint}</p>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmingCancel}
        title={copy.confirmTitle}
        description={copy.confirmBody(current.event_name)}
        confirmLabel={copy.confirmAction}
        cancelLabel={copy.keepAction}
        tone="danger"
        onConfirm={() => {
          setConfirmingCancel(false);
          void cancelPass(current);
        }}
        onCancel={() => setConfirmingCancel(false)}
      />
      {qrView(current)}
    </>,
  );
}
