import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { createApiClient, type AttendeeTicketDetail } from "../api/client";
import { passCopy } from "../copy/pass";
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
import { MobileOtpForm } from "../components/auth/MobileOtpForm";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Notice } from "../components/ui/Notice";
import { DigitalPassCard, type PassCardTicket } from "../components/attendee/DigitalPassCard";
import { QrFullscreen } from "../components/attendee/QrFullscreen";
import { InstallHint } from "../components/attendee/InstallHint";

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
  const copy = passCopy[locale].page;
  const cancelCopy = passCopy[locale].cancel;
  const { slug = "" } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { token, signIn } = useAttendeeSession();

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
        setNotice({ text: cancelCopy.done, tone: "success" });
      } else {
        setNotice({ text: readableApiError(error, locale) ?? cancelCopy.failed, tone: "danger" });
      }
    } catch {
      setNotice({ text: cancelCopy.offline, tone: "danger" });
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
  // The one status line, under the card and only when there is something to say: a notice, a session that ended, or
  // an offline copy. Online and up to date says nothing.
  const statusLine = (line: ReactNode, testId = "pass-status-line") =>
    line ? <div data-testid={testId} className="at-print-collapse">{line}</div> : null;
  const noticeLine = notice ? (
    <Notice tone={notice.tone} icon={notice.tone === "success" ? "check-circle" : "alert"}>
      {notice.text}
    </Notice>
  ) : null;
  const noticeBlock = statusLine(noticeLine, "pass-notice");

  // Opened from the SMS link without signing in: that pass, read-only, then one line to sign in for the rest.
  const linkPass = !token ? (linkPasses[linkPassIndex] ?? linkPasses[0]) : undefined;
  if (linkPass) {
    const card = linkPassCard(linkPass);
    return shell(
      <>
        {linkPasses.length > 1 && (
          <PassSwitcher
            title={copy.choosePass}
            labels={passSwitchLabels(linkPasses.map(linkPassCard), formatDate, formatNumber)}
            selected={linkPasses.indexOf(linkPass)}
            onSelect={setLinkPassIndex}
          />
        )}
        <DigitalPassCard ticket={card} locale={locale} onPrint={handlePrint} onExpand={openQr} />
        <div className="at-print-collapse text-center">
          <LinkButton to={signInPath(slug, congressPath(slug, "my-congress"))} variant="ghost" size="sm">
            {t.linkPassSignInAction}
            <Icon name="arrow-right" size={14} />
          </LinkButton>
        </div>
        <InstallHint locale={locale} />
        {qrView(card)}
      </>,
    );
  }

  // Signed out (fails closed): the phone form is on the page, so the way to the pass is one step.
  if (!token) {
    return shell(
      <section className="space-y-5 pt-2">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-text-primary text-balance">{copy.signInTitle}</h1>
        <MobileOtpForm locale={locale} onSignedIn={(auth) => signIn(auth.access_token)} />
      </section>,
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

  // A failed load is never presented as "no pass". With no response at all and nothing saved here yet, the first load
  // needs a connection.
  if (loadError && nothingYet) {
    const offline = loadError.body === null;
    const detail = offline ? null : readableApiError(loadError.body, locale);
    return shell(
      <div role="alert" data-testid="pass-load-error" className="space-y-4 rounded-2xl border border-status-danger-border bg-status-danger-bg p-5 text-status-danger-text">
        <div className="flex items-start gap-3">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-semibold">{offline ? copy.connectOnce : copy.loadFailed}</p>
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
    <Notice
      tone="danger"
      icon="key"
      action={
        <LinkButton to={signInPath(slug, congressPath(slug, "my-ticket"))} variant="ghost" size="sm">
          {copy.signIn}
          <Icon name="arrow-right" size={14} />
        </LinkButton>
      }
    >
      {copy.sessionExpired}
    </Notice>
  ) : null;

  if (!current) {
    const cancelled = cancelledPasses[0];
    return shell(
      <>
        {cancelled && <DigitalPassCard ticket={cancelled} locale={locale} />}
        {noticeBlock ?? statusLine(sessionLine)}
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

  const offlineLine =
    isOffline || (isCachedPass && !refreshing) ? (
      <Notice tone="warning" icon="wifi-off">
        {t.offlineNotice}
      </Notice>
    ) : null;

  return shell(
    <>
      {activePasses.length > 1 && (
        <PassSwitcher
          title={copy.choosePass}
          labels={passSwitchLabels(activePasses, formatDate, formatNumber)}
          selected={activePasses.indexOf(current)}
          onSelect={(i) => setSelectedId(activePasses[i]?.id ?? null)}
        />
      )}
      <DigitalPassCard ticket={current} locale={locale} onPrint={handlePrint} onExpand={openQr} />
      {noticeBlock ?? statusLine(sessionLine ?? offlineLine)}
      <InstallHint locale={locale} />
      {verified && canSelfCancel(current) && (
        <div className="at-print-collapse border-t border-border-default pt-2 text-center">
          <Button type="button" variant="ghost" size="sm" disabled={cancelling} onClick={() => setConfirmingCancel(true)}>
            {cancelling ? cancelCopy.busy : cancelCopy.action}
          </Button>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmingCancel}
        title={cancelCopy.title}
        description={cancelCopy.body}
        confirmLabel={cancelCopy.action}
        cancelLabel={cancelCopy.keep}
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
