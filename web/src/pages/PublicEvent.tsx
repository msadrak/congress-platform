import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  type AuthResponse,
  type PublicEvent as PublicEventType,
} from "../api/client";
import { MobileOtpForm } from "../components/auth/MobileOtpForm";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { PublicLayout } from "../layouts/PublicLayout";
import { normalizeDocument, standardDocument, type PageImages } from "../lib/pageDocument";
import { usePageMeta } from "../lib/pageMeta";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { contentLocale, isolateFor, publicCopy, usePublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import { CongressPage } from "../components/public/page/CongressPage";
import { PassesPanel } from "../components/public/page/PassesPanel";

export default function PublicEvent() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<PublicEventType | null>(null);
  const [loading, setLoading] = useState(true);
  /** Why the page could not be shown: the congress does not exist (404) or loading failed. */
  const [loadError, setLoadError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Selected tier for reservation
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  // Modal states
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [alreadyHasTicket, setAlreadyHasTicket] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const pageContext = useRef<{ active: boolean } | null>(null);

  useEffect(() => {
    if (!slug) return;
    const context = { active: true };
    pageContext.current = context;
    const loadEvent = async () => {
      setLoading(true);
      setLoadError(null);
      setEvent(null);
      setSelectedTierId(null);
      setIsAuthModalOpen(false);
      setIsSuccessModalOpen(false);
      setAlreadyHasTicket(false);
      setModalError(null);
      setSubmitting(false);
      const client = createApiClient({ kind: "anonymous" });
      try {
        const { data, error: err, response } = await client.GET("/api/public/events/{slug}", {
          params: { path: { slug } },
        });
        if (!context.active) return;
        if (err) {
          setLoadError(response.status === 404 ? "notFound" : "failed");
        } else if (data) {
          setEvent(data);
          if (data.ticket_tiers && data.ticket_tiers.length > 0) {
            // Select first available tier with open registration and remaining quota
            const firstAvailable = data.ticket_tiers.find(
              (t) => t.is_open && (t.reserved_count ?? 0) < t.quota
            );
            setSelectedTierId(firstAvailable ? firstAvailable.id : data.ticket_tiers[0].id);
          }
        }
      } catch {
        if (context.active) setLoadError("failed");
      }
      if (context.active) setLoading(false);
    };
    loadEvent();
    return () => {
      context.active = false;
    };
  }, [slug, reloadKey]);

  const refreshEvent = (eventSlug: string, context: { active: boolean }) => {
    createApiClient({ kind: "anonymous" })
      .GET("/api/public/events/{slug}", { params: { path: { slug: eventSlug } } })
      .then(({ data: freshData }) => {
        if (context.active && freshData) setEvent((current) => current?.slug === freshData.slug ? freshData : current);
      })
      .catch(() => undefined);
  };

  // A payload without a page (older API, test fixtures) renders the standard layout.
  const doc = useMemo(() => (event?.page ? normalizeDocument(event.page.document) : standardDocument()), [event]);
  const images = useMemo<PageImages>(
    () => Object.fromEntries((event?.page?.assets ?? []).map((a) => [a.id, { url: a.url, width: a.width, height: a.height }])),
    [event],
  );
  const contentDefault = !event ? undefined : doc.primary_locale !== "auto" ? doc.primary_locale : contentLocale(event.name);
  const { locale, setLocale } = usePublicLocale(contentDefault);
  const c = publicCopy[locale];
  usePageMeta(event ? { doc, images, locale, eventName: event.name } : null);
  const selectedTier =
    event?.ticket_tiers.find((t) => t.id === selectedTierId) ??
    (event?.ticket_tiers.length ? event.ticket_tiers[0] : null);

  const selectedTierReserved = selectedTier ? (selectedTier.reserved_count ?? 0) : 0;
  const selectedTierQuota = selectedTier ? selectedTier.quota : 0;
  const selectedTierState = selectedTier
    ? selectedTierReserved >= selectedTierQuota
      ? "SOLD_OUT"
      : !selectedTier.is_open
      ? "CLOSED"
      : "AVAILABLE"
    : "CLOSED";
  const isSelectedTierAvailable = selectedTierState === "AVAILABLE";

  const executeReservation = async (token: string, tierId: string) => {
    if (!event) return;
    const context = pageContext.current;
    if (!context?.active) return;
    // The token can be stale (another tab changed the stored session): never reserve with it.
    if (!isStoredAttendeeToken(token)) {
      setAlreadyHasTicket(false);
      setModalError(c.errSessionChanged);
      setIsAuthModalOpen(true);
      setSubmitting(false);
      return;
    }
    const client = createApiClient({ kind: "user", token });
    const { data, error: err, response } = await client.POST(
      "/api/events/{event_id}/tickets/reserve",
      {
        params: { path: { event_id: event.id } },
        body: { ticket_tier_id: tierId },
      }
    );
    if (!context.active) return;
    // A response for a session that has since changed must not show success or error for the new one.
    if (!isStoredAttendeeToken(token)) {
      if (response.status === 401) rejectAttendeeToken(token);
      setSubmitting(false);
      return;
    }

    if (err) {
      const formatted = formatApiError(err);
      const lower = formatted.toLowerCase();

      // Edge case 2: 401 for the exact token that was sent
      if (response.status === 401) {
        rejectAttendeeToken(token);
        setAlreadyHasTicket(false);
        setModalError(c.errSessionExpired);
        setIsAuthModalOpen(true);
        setSubmitting(false);
        return;
      }

      // Edge case 4: Duplicate registration conflict
      if (
        lower.includes("already holds a ticket") ||
        lower.includes("already registered")
      ) {
        setAlreadyHasTicket(true);
        setIsAuthModalOpen(false);
        setModalError(null);
      } else {
        // Edge case 3: Tier became unavailable / sold out / closed
        if (
          lower.includes("sold out") ||
          lower.includes("exhausted") ||
          lower.includes("closed")
        ) {
          // Reload event data to reflect latest tier availability
          refreshEvent(event.slug, context);
        }
        setModalError(formatted);
      }
      setSubmitting(false);
    } else if (data) {
      setIsAuthModalOpen(false);
      setSubmitting(false);
      setAlreadyHasTicket(true);
      setIsSuccessModalOpen(true);
      refreshEvent(event.slug, context);
    }
  };

  const handleStartReservation = async () => {
    if (!selectedTier || !event || !isSelectedTierAvailable) return;
    setModalError(null);

    const existingToken =
      typeof window !== "undefined"
        ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
        : null;

    if (existingToken) {
      // User is already logged in: reserve directly
      setSubmitting(true);
      await executeReservation(existingToken, selectedTier.id);
    } else {
      // Needs authentication: open accessible dialog
      setIsAuthModalOpen(true);
    }
  };

  // Signed in (or signed up) by SMS code inside the dialog: keep the session, then reserve the chosen pass.
  const handleSignedInAndReserve = async (auth: AuthResponse) => {
    if (!selectedTier || !event) return;
    if (!pageContext.current?.active) return;
    localStorage.setItem(ATTENDEE_TOKEN_STORAGE, auth.access_token);
    setModalError(null);
    setSubmitting(true);
    await executeReservation(auth.access_token, selectedTier.id);
  };

  // Loading skeleton state
  if (loading) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale}>
        {/* Fills the viewport so the footer never sits in view and jumps when content arrives (CLS). */}
        <section role="status" aria-label={c.loading} className="relative min-h-[100svh] overflow-hidden bg-surface-ink">
          <div aria-hidden="true" className="absolute inset-0 bg-meridian-ink opacity-70" />
          <div className="relative mx-auto max-w-7xl space-y-10 px-4 pt-12 pb-28 sm:px-6 sm:pt-20 lg:min-h-[640px] lg:px-10 motion-safe:animate-pulse">
            <div className="flex gap-2">
              <div className="h-7 w-36 rounded-full bg-white/10" />
              <div className="h-7 w-28 rounded-full bg-white/[0.06]" />
            </div>
            <div className="max-w-4xl space-y-4">
              <div className="h-3 w-48 rounded-full bg-white/10" />
              <div className="h-14 w-full rounded-2xl bg-white/10 sm:h-20" />
              <div className="h-14 w-2/3 rounded-2xl bg-white/10 sm:h-20" />
            </div>
            <div className="grid grid-cols-2 gap-6 border-t border-white/10 pt-6 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-16 rounded bg-white/10" />
                  <div className="h-5 w-3/4 rounded bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  // Error / Not Found state
  if (loadError || !event) {
    const notFound = loadError !== "failed";
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale} congressName="">
        <section className="relative isolate overflow-hidden">
          <CongressSignature seed={slug ?? "congress"} tone="light" className="absolute inset-0 -z-10 size-full opacity-70" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-surface-page/30 via-surface-page/85 to-surface-page" />
          <div className="mx-auto max-w-xl space-y-7 px-4 py-24 text-center sm:py-36">
            <span className="mx-auto grid size-16 place-items-center bg-surface-panel text-aiteb-indigo shadow-lift shape-arc">
              <Icon name={notFound ? "search" : "alert"} size={28} />
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-text-primary sm:text-4xl">{notFound ? c.notFoundTitle : c.eventLoadFailedTitle}</h1>
              <p className="text-base leading-relaxed text-text-secondary">{notFound ? c.notFoundBody : c.eventLoadFailed}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {!notFound && (
                <Button type="button" variant="secondary" size="lg" onClick={() => setReloadKey((k) => k + 1)}>
                  <Icon name="sync" size={18} />
                  {c.retry}
                </Button>
              )}
              <LinkButton to="/" variant={notFound ? "secondary" : "ghost"} size="lg">
                <Icon name="arrow-left" size={18} />
                {c.returnHome}
              </LinkButton>
            </div>
          </div>
        </section>
      </PublicLayout>
    );
  }

  const logo = doc.branding.logo_asset_id ? images[doc.branding.logo_asset_id] ?? null : null;

  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale} congressName={event.name} brand={{ accent: doc.branding.accent, logo }}>
      <CongressPage
        event={event}
        doc={doc}
        images={images}
        locale={locale}
        passes={
          <PassesPanel
            slug={event.slug}
            tiers={event.ticket_tiers}
            locale={locale}
            accent={doc.branding.accent}
            selectedTierId={selectedTierId}
            onSelectTier={setSelectedTierId}
            onReserve={handleStartReservation}
            submitting={submitting}
            alreadyHasTicket={alreadyHasTicket}
          />
        }
      />

      {/* Accessible Registration / Authentication Dialog */}
      <Dialog
        isOpen={isAuthModalOpen}
        onClose={() => {
          if (!submitting) {
            setIsAuthModalOpen(false);
            setModalError(null);
          }
        }}
        title={c.dialogSignInTitle}
        description={selectedTier ? c.dialogDescription(isolateFor(selectedTier.name, locale)) : undefined}
        size="md"
      >
        <div className="space-y-5">
          {submitting ? (
            <p role="status" className="flex items-center gap-2.5 rounded-xl bg-surface-panel-subtle p-3.5 text-sm text-text-secondary">
              <Icon name="ticket" size={18} className="shrink-0 text-aiteb-indigo" />
              {c.submitting}
            </p>
          ) : (
            <MobileOtpForm locale={locale} onSignedIn={(auth) => void handleSignedInAndReserve(auth)} verifyLabel={c.submitVerify} />
          )}

          {modalError && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm leading-relaxed text-status-danger-text"
            >
              <Icon name="alert" size={18} className="mt-0.5" />
              <span>{modalError}</span>
            </div>
          )}
        </div>
      </Dialog>

      {/* Accessible Success Confirmation Dialog */}
      <Dialog
        isOpen={isSuccessModalOpen}
        onClose={() => setIsSuccessModalOpen(false)}
        title={c.successTitle}
        description={c.successDescription}
        size="sm"
      >
        <div className="space-y-6">
          <div className="relative isolate overflow-hidden rounded-2xl bg-surface-ink p-5 text-white [border-start-end-radius:var(--radius-arc)]">
            <CongressSignature seed={event.slug} accent={doc.branding.accent} tone="ink" className="absolute inset-0 -z-10 size-full opacity-80 rtl:-scale-x-100" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-surface-ink via-surface-ink/80 to-surface-ink/20" />
            <span className="grid size-11 place-items-center rounded-full bg-[#3EE0A1] text-surface-ink motion-safe:animate-pop">
              <Icon name="check" size={22} strokeWidth={2.4} />
            </span>
            <h3 className="mt-6 text-lg font-semibold leading-snug"><Bidi text={event.name} /></h3>
            <p className="mt-1 text-sm text-ink-200">
              {c.successTier}: <span className="font-semibold text-white">{selectedTier && <Bidi text={selectedTier.name} />}</span>
            </p>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">{c.successBody}</p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              isFullWidth
              onClick={() => {
                setIsSuccessModalOpen(false);
                navigate("/my-tickets");
              }}
            >
              {c.successOpen}
            </Button>
            <Button type="button" variant="ghost" size="md" isFullWidth onClick={() => setIsSuccessModalOpen(false)}>
              {c.successStay}
            </Button>
          </div>
        </div>
      </Dialog>
    </PublicLayout>
  );
}
