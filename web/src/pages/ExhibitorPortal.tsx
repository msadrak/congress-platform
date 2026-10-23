import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createApiClient, localizedApiError, type BoothOut, type LeadOut } from "../api/client";
import { attendeeResponseState } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAttendeeLocale, formatLocalizedNumber } from "../lib/i18n";
import { totalOf } from "../lib/leadList";
import { SkipLink } from "../components/ui/SkipLink";
import { boothSignInPath } from "../lib/safeRedirect";
import { eventAccentStyle } from "../lib/eventAccent";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { BoothGate } from "../components/booth/BoothGate";
import { CaptureDialog } from "../components/booth/CaptureDialog";
import { LeadList } from "../components/booth/LeadList";
import { QualifyDialog } from "../components/booth/QualifyDialog";
import { boothText } from "../components/booth/boothText";
import { useLeadCounts, useLeadList } from "../components/booth/useLeadList";
import { useLeadQueue } from "../components/booth/useLeadQueue";
import { LEAD_RATINGS, RATING_META } from "../components/booth/rating";
import "../styles/exhibitor.css";

const PRESET_TAG_KEYS = [
  "tagSendQuote",
  "tagScheduleDemo",
  "tagDecisionMaker",
  "tagProductSample",
  "tagGeneralInquiry",
  "tagUrgentFollowUp",
] as const;

// Remount per booth so a late response for booth A can never write into booth B's state.
export default function ExhibitorPortal() {
  const { boothId } = useParams<{ boothId: string }>();
  return <ExhibitorPortalContent key={boothId} />;
}

function ExhibitorPortalContent() {
  const { boothId } = useParams<{ boothId: string }>();
  const navigate = useNavigate();
  const { locale, setLocale, t, isRtl, dir } = useAttendeeLocale();
  const text = boothText(locale);

  const [booth, setBooth] = useState<BoothOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [eventContext, setEventContext] = useState<{ name: string; slug: string } | null>(null);
  // 403 BOOTH_STAFF_REQUIRED after the booth had loaded: this account was removed from the booth's staff.
  // Final for this page: nothing is fetched or sent any more.
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [otherBooths, setOtherBooths] = useState<BoothOut[]>([]);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Capture dialog: remounted for every opening, so each capture starts clean.
  const [isCaptureOpen, setIsCaptureOpen] = useState(false);
  const [captureSession, setCaptureSession] = useState(0);
  // Qualification dialog
  const [editingLead, setEditingLead] = useState<LeadOut | null>(null);

  const { token, signOut } = useAttendeeSession();

  const sessionRef = useRef<string | null>(token);
  const revoke = useCallback(() => setAccessRevoked(true), []);
  const live = !accessRevoked && Boolean(token);

  const list = useLeadList({ boothId, token, locale, enabled: live, onAccessRevoked: revoke });
  const counts = useLeadCounts({ boothId, token, enabled: live, onAccessRevoked: revoke });
  const { reload: reloadList } = list;
  const { refresh: refreshCounts } = counts;
  const queue = useLeadQueue({
    boothId,
    token,
    enabled: live,
    onAccessRevoked: revoke,
    onSynced: (synced) => {
      setSyncNotice(text.syncedCount(formatLocalizedNumber(synced.length, locale)));
      reloadList();
      refreshCounts();
    },
  });

  useEffect(() => {
    let isMounted = true;
    // Another account must never inherit the previous staff member's booth view or leads.
    if (sessionRef.current !== token) {
      sessionRef.current = token;
      setBooth(null);
      setEventContext(null);
      setIsCaptureOpen(false);
      setEditingLead(null);
      setAuthError(null);
      setAccessRevoked(false);
      setSyncNotice(null);
    }
    if (!boothId) return;
    // Without a token the render returns the sign-in gate before `loading` is ever read, and the
    // fetch below sets `loading` itself once a token exists, so no reset is needed here.
    if (!token) return;

    const fetchData = async () => {
      setLoading(true);
      setAuthError(null);
      setLoadFailed(false);
      try {
        const client = createApiClient({ kind: "user", token });
        const [boothRes, accessRes] = await Promise.all([
          client.GET("/api/booths/{booth_id}", { params: { path: { booth_id: boothId } } }),
          client.GET("/api/me/access"),
        ]);

        if (!isMounted) return;
        // The stored session changed, or a 401 removed it, while the request was in flight: ignore
        // this response and never delete a newer session. The re-render reads the current token.
        if (attendeeResponseState(token, boothRes.response.status) !== "current") {
          setLoading(false);
          return;
        }

        if (boothRes.error) {
          if (boothRes.response.status >= 500) setLoadFailed(true);
          else setAuthError(localizedApiError(boothRes.error, locale));
        } else if (boothRes.data) {
          setBooth(boothRes.data);
          const mine = accessRes.data?.events.find((e) => e.booth_ids.includes(boothId));
          setEventContext(mine ? { name: mine.event_name, slug: mine.event_slug } : null);
        }
      } catch {
        if (isMounted) setLoadFailed(true);
      }
      if (isMounted) setLoading(false);
    };

    fetchData();
    return () => {
      isMounted = false;
    };
    // `locale` only words an error message; switching language does not refetch.
  }, [boothId, token, reloadNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Removed from this booth: offer the booths this account still staffs (one request, no retry).
  useEffect(() => {
    if (!accessRevoked || !token) return;
    let current = true;
    void createApiClient({ kind: "user", token })
      .GET("/api/booths/me")
      .then((res) => {
        if (current && res.data) setOtherBooths(res.data.filter((b) => b.id !== boothId));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [accessRevoked, token, boothId]);

  const handleLogout = () => {
    signOut();
    navigate(boothId ? boothSignInPath(boothId) : "/");
  };

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  const openCapture = () => {
    setCaptureSession((n) => n + 1);
    setIsCaptureOpen(true);
  };

  // Counts always describe the whole booth, never the filtered view.
  const ratingCounts = counts.counts;
  const boothTotal = counts.known ? totalOf(ratingCounts) : list.appliedQuery.view === "active" && !list.appliedQuery.q && !list.appliedQuery.rating ? list.total : 0;
  const tagPresets = PRESET_TAG_KEYS.map((key) => t[key]);
  const workspaceLabel = isRtl ? "پیشخوان غرفه" : "Booth workspace";
  usePageTitle(workspaceLabel, booth?.name);


  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="key"
        eyebrow={workspaceLabel}
        title={t.unauthenticatedExhibitorTitle}
        actions={
          <LinkButton to={boothId ? boothSignInPath(boothId) : "/"} variant="primary" size="lg" isFullWidth>
            <span>{isRtl ? "ورود به حساب غرفه" : "Sign In to Booth Workspace"}</span>
            <Icon name="arrow-right" size={18} />
          </LinkButton>
        }
      >
        <p>{t.unauthenticatedExhibitorDesc}</p>
      </BoothGate>
    );
  }

  // Loading skeleton
  if (loading && !booth) {
    return (
      <div dir={dir} lang={locale} aria-busy="true" className="min-h-dvh bg-surface-page font-sans">
        <div className="bg-surface-ink bg-meridian-ink">
          <div className="mx-auto max-w-6xl space-y-4 px-4 pb-20 pt-6 sm:px-6 lg:px-8">
            <div className="h-8 w-40 rounded-lg bg-white/10" />
            <div className="h-11 w-3/4 max-w-lg rounded-xl bg-white/10" />
            <div className="h-14 w-64 max-w-full rounded-xl bg-white/[0.06]" />
          </div>
        </div>
        <div className="mx-auto -mt-10 max-w-6xl space-y-4 px-4 sm:px-6 lg:px-8">
          <div className="skeleton h-40 shape-arc" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="wifi-off"
        tone="warning"
        eyebrow={workspaceLabel}
        title={isRtl ? "بارگذاری غرفه انجام نشد" : "The booth could not be loaded"}
        actions={
          <Button type="button" variant="primary" size="lg" isFullWidth onClick={() => setReloadNonce((n) => n + 1)}>
            <Icon name="sync" size={18} />
            <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
          </Button>
        }
      >
        <p>{isRtl ? "اتصال یا سرور مشکل دارد. نشست شما حفظ شده است." : "There is a connection or server problem. You are still signed in."}</p>
      </BoothGate>
    );
  }

  // Unauthorized (403 Forbidden) or Not Found view
  if (authError || !booth) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="lock"
        tone="danger"
        eyebrow={workspaceLabel}
        title={t.unauthorizedExhibitorTitle}
        actions={
          <>
            {boothId && (
              <LinkButton to={boothSignInPath(boothId)} variant="primary" size="lg" isFullWidth>
                {isRtl ? "ورود با حساب دیگر" : "Sign in with a different account"}
              </LinkButton>
            )}
            <LinkButton to="/" variant="ghost" size="md" isFullWidth>
              <span>{t.platformHome}</span>
              <Icon name="arrow-right" size={16} />
            </LinkButton>
          </>
        }
      >
        <p>{authError ?? t.unauthorizedExhibitorDesc}</p>
      </BoothGate>
    );
  }

  if (accessRevoked) {
    const unsent = queue.scans.length;
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="lock"
        tone="danger"
        eyebrow={workspaceLabel}
        title={text.removedTitle}
        actions={
          <>
            {otherBooths.map((other) => (
              <LinkButton key={other.id} to={`/booth/${encodeURIComponent(other.id)}`} variant="secondary" size="lg" isFullWidth>
                <Icon name="booth" size={17} />
                <span className="truncate">{other.name}</span>
              </LinkButton>
            ))}
            {boothId && (
              <LinkButton to={boothSignInPath(boothId)} variant={otherBooths.length ? "ghost" : "primary"} size="lg" isFullWidth>
                {isRtl ? "ورود با حساب دیگر" : "Sign in with a different account"}
              </LinkButton>
            )}
            <LinkButton to="/" variant="ghost" size="md" isFullWidth>
              <span>{t.platformHome}</span>
              <Icon name="arrow-right" size={16} />
            </LinkButton>
          </>
        }
      >
        <div data-testid="access-removed" className="space-y-3">
          <p>{text.removedDesc}</p>
          {unsent > 0 && <p className="font-medium text-status-warning-text">{text.removedPending(formatLocalizedNumber(unsent, locale))}</p>}
          <p>{text.removedAsk}</p>
          {otherBooths.length > 0 && <p className="font-semibold text-text-primary">{text.otherBooths}</p>}
        </div>
      </BoothGate>
    );
  }


  const inkControl =
    "press inline-flex min-h-[44px] items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold text-white/85 ring-1 ring-white/15 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid cursor-pointer";


  return (
    <div
      dir={dir}
      lang={locale}
      style={eventAccentStyle(eventContext?.slug ?? booth.event_id)}
      className="booth-portal flex min-h-dvh flex-col bg-surface-page font-sans text-text-primary"
    >
      <SkipLink targetId="exhibitor-main-content">
        {isRtl ? "پرش به محتوای اصلی پرتال غرفه" : "Skip to main booth lead content"}
      </SkipLink>

      {/* 1. Booth identity on ink: congress, booth placard, authority, lead ledger */}
      <header className="relative isolate overflow-hidden bg-surface-ink text-white">
        <CongressSignature
          seed={eventContext?.slug ?? booth.id}
          tone="ink"
          className="pointer-events-none absolute inset-0 -z-10 size-full opacity-80 rtl:-scale-x-100"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-surface-ink via-surface-ink/85 to-surface-ink/20 rtl:bg-linear-to-l" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />

        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
          <p className="flex min-w-0 items-center gap-2.5 text-[13px] font-semibold text-white/90">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-[var(--event-accent-glow)] ring-1 ring-white/15">
              <Icon name="booth" size={18} />
            </span>
            <span className="truncate">{workspaceLabel}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLocale}
              className={inkControl}
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              <Icon name="globe" size={17} />
              <span>{t.languageToggle}</span>
            </button>
            <button type="button" onClick={handleLogout} className={inkControl}>
              <Icon name="logout" size={17} />
              <span className="max-sm:sr-only">{t.logout}</span>
            </button>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-14 pt-6 sm:px-6 md:gap-8 md:pb-20 md:pt-9 lg:grid-cols-12 lg:items-end lg:gap-10 lg:px-8 lg:pt-12">
          <div className="min-w-0 lg:col-span-7 motion-safe:animate-rise">
            {eventContext && (
              <p data-testid="booth-event" className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--event-accent-glow)] shadow-[0_0_0_4px_rgb(255_255_255/0.08)]" />
                <span className="min-w-0 break-words">{eventContext.name}</span>
              </p>
            )}
            <h1 className="mt-3 text-[2.1rem] font-bold leading-[1.06] tracking-[-0.03em] text-white break-words sm:text-5xl lg:text-[3.5rem]">
              {booth.name}
            </h1>

            <div className="booth-placard mt-6 grid max-w-full grid-cols-[auto_minmax(0,1fr)] sm:inline-grid">
              <div className="booth-placard__cell px-4 py-2.5">
                <p className="booth-ink-label">{isRtl ? "جایگاه" : "Stand"}</p>
                <p className="mt-1 text-[15px] font-semibold text-white">
                  {booth.location || (isRtl ? "سالن اصلی نمایشگاه" : "Exhibition Floor")}
                </p>
              </div>
              <div className="booth-placard__cell min-w-0 px-4 py-2.5">
                <p className="booth-ink-label">{isRtl ? "کد غرفه" : "Booth code"}</p>
                <p className="ltr-isolate mt-1 break-all font-mono text-[14px] text-white/90">{booth.slug}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-white/75">
                <Icon name="shield" size={16} className="text-[var(--event-accent-glow)]" />
                {t.boothAuthorizedBadge}
              </span>
              {eventContext && boothId && (
                <Link
                  to={`/e/${encodeURIComponent(eventContext.slug)}/booths/${encodeURIComponent(boothId)}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
                >
                  <span>{isRtl ? "پروفایل عمومی غرفه" : "Public booth profile"}</span>
                  <Icon name="arrow-up-right" size={15} />
                </Link>
              )}
            </div>
          </div>

          {/* Lead ledger: real counts of this booth */}
          <div className="min-w-0 lg:col-span-5">
            <div className="border-t border-white/15 pt-4 lg:rounded-2xl lg:border lg:border-white/12 lg:bg-surface-ink/80 lg:p-6">
              <div className="flex items-end gap-3">
                <p className="text-[2.75rem] font-bold leading-none tracking-[-0.04em] text-white tabular sm:text-5xl">
                  {formatLocalizedNumber(boothTotal, locale)}
                </p>
                <p className="pb-1 text-sm font-medium text-white/70">{t.leadsCountLabel}</p>
              </div>
              <div aria-hidden="true" className="booth-dist mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/10">
                {LEAD_RATINGS.map((rating) =>
                  ratingCounts[rating] > 0 ? (
                    <span key={rating} className={`${RATING_META[rating].tone} bg-[var(--rating-glow)]`} style={{ flexGrow: ratingCounts[rating] }} />
                  ) : null
                )}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2">
                {LEAD_RATINGS.map((rating) => (
                  <div key={rating} className={`${RATING_META[rating].tone} min-w-0`}>
                    <dt className="flex items-center gap-1.5 text-[12px] font-medium text-white/65">
                      <Icon name={RATING_META[rating].icon} size={14} className="shrink-0 text-[var(--rating-glow)]" />
                      <span className="truncate">{RATING_META[rating].label[locale]}</span>
                    </dt>
                    <dd className="mt-1 text-xl font-bold text-white tabular">{formatLocalizedNumber(ratingCounts[rating], locale)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="exhibitor-main-content" tabIndex={-1} className="relative mx-auto -mt-8 w-full max-w-6xl flex-1 px-4 focus:outline-none sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">
          {/* 2. Capture station (phones use the bottom dock instead) */}
          <section aria-labelledby="capture-heading" className="hidden md:block lg:sticky lg:top-6 lg:col-span-4">
            <div className="overflow-hidden border border-border-default bg-surface-panel shadow-lift shape-arc-lg">
              <div className="p-6">
                <p className="eyebrow">
                  <span className="font-mono">01</span>
                  <span>{isRtl ? "ثبت لید" : "Capture"}</span>
                </p>
                <h2 id="capture-heading" className="mt-3 text-xl font-bold leading-snug tracking-[-0.02em] text-text-primary">
                  {isRtl ? "کارت ورود بازدیدکنندهٔ بعدی را اسکن کنید" : "Scan the next visitor's badge"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {isRtl
                    ? "با دوربین، بارکدخوان یا تایپ کد QR. اسکن دوبارهٔ یک کارت ورود فقط همان لید را به‌روز می‌کند."
                    : "Camera, barcode reader or typed code. Scanning a badge again only updates the same lead."}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="xl"
                  isFullWidth
                  onClick={openCapture}
                  className="mt-6"
                >
                  <Icon name="scan" size={22} />
                  <span className="whitespace-normal">{t.captureLeadAction}</span>
                </Button>
              </div>
              <p className="flex items-start gap-2.5 border-t border-border-subtle bg-surface-panel-subtle px-6 py-3.5 text-xs leading-relaxed text-text-muted">
                <Icon name="keyboard" size={16} className="mt-px shrink-0" />
                <span>
                  {isRtl
                    ? "بارکدخوان USB پس از باز شدن پنجرهٔ ثبت، کد را مستقیم در کادر کد وارد می‌کند."
                    : "Once capture is open, a USB barcode reader types straight into the code field."}
                </span>
              </p>
            </div>
          </section>

          {/* 3. Leads worklist */}
          <LeadList
            boothId={booth.id}
            boothSlug={booth.slug}
            token={token}
            locale={locale}
            list={list}
            counts={counts}
            queue={queue}
            syncNotice={syncNotice}
            onQualify={setEditingLead}
            onCapture={openCapture}
            onAccessRevoked={revoke}
          />
        </div>
      </main>

      <footer className="mx-auto mt-14 w-full max-w-6xl px-4 pb-32 sm:px-6 md:pb-10 lg:px-8">
        <div className="rule-arc" />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-5 text-xs text-text-muted">
          <span className="flex items-center gap-2">
            <Icon name="lock" size={14} />
            <span>{isRtl ? "لیدها فقط برای کارکنان همین غرفه قابل مشاهده‌اند." : "Leads are visible only to this booth's staff."}</span>
          </span>
          <AitebAttribution locale={locale} />
        </div>
      </footer>


      {/* 4. Capture dialog: camera / manual code, optional quick qualification, confirmation */}
      <CaptureDialog
        key={captureSession}
        isOpen={isCaptureOpen}
        onClose={() => setIsCaptureOpen(false)}
        boothId={booth.id}
        token={token}
        locale={locale}
        tagPresets={tagPresets}
        onCaptured={() => {
          setSyncNotice(null);
          reloadList();
          refreshCounts();
        }}
        onQualify={(lead) => {
          setIsCaptureOpen(false);
          setEditingLead(lead);
        }}
        onQueue={queue.enqueue}
        onAccessRevoked={revoke}
      />

      {/* 5. Lead detail + qualification */}
      <QualifyDialog
        lead={editingLead}
        onClose={() => setEditingLead(null)}
        boothId={booth.id}
        token={token}
        locale={locale}
        tagPresets={tagPresets}
        onSaved={(saved) => {
          setEditingLead(saved);
          list.applyLead(saved);
          refreshCounts();
        }}
        onAccessRevoked={revoke}
      />


      {/* Phones and small tablets at the booth: the primary action stays one tap away. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-surface-ink px-4 pb-safe md:hidden">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[image:var(--grad-aiteb)] opacity-70" />
        <div className="py-3">
          <Button
            type="button"
            variant="light"
            size="xl"
            isFullWidth
            onClick={openCapture}
          >
            <Icon name="scan" size={22} className="text-aiteb-indigo" />
            <span className="truncate">{t.captureLeadAction}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
