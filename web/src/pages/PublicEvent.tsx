import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import QRCode from "react-qr-code";
import {
  apiErrorCode,
  createApiClient,
  localizedApiError,
  type AuthResponse,
  type PublicEvent as PublicEventType,
  type TicketOut,
  type TicketTierOut,
} from "../api/client";
import { MobileOtpForm, type OtpStep } from "../components/auth/MobileOtpForm";
import { attendeeResponseState, isStoredAttendeeToken } from "../lib/attendeeSession";
import { useAttendeeSession } from "../hooks/useAttendeeSession";
import { errorMessages, isTierUnavailable, networkErrorMessage } from "../lib/errorMessages";
import { PublicLayout } from "../layouts/PublicLayout";
import { accentOf, isSectionVisible, normalizeDocument, standardDocument, type PageImages } from "../lib/pageDocument";
import { usePageMeta } from "../lib/pageMeta";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { Notice } from "../components/ui/Notice";
import { StateBlock } from "../components/ui/StateBlock";
import type { HeroAction } from "../components/public/CongressHero";
import { contentLocale, isolateFor, publicCopy, usePublicLocale } from "../components/public/copy";
import { Bidi } from "../components/public/Bidi";
import { downloadCalendarFile } from "../components/public/calendarDownload";
import { useHeldPass } from "../components/public/useHeldPass";
import { CongressPage } from "../components/public/page/CongressPage";
import { programFilesOf } from "../lib/programFiles";
import { PassesPanel } from "../components/public/page/PassesPanel";
import { useNow } from "../components/attendee/useNow";
import { tierAvailability } from "../lib/registrationWindow";

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
  /** The pass just reserved (its QR code is previewed in the success sheet). */
  const [reserved, setReserved] = useState<TicketOut | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  /** The sign-in step inside the reservation dialog: its title follows it. */
  const [dialogStep, setDialogStep] = useState<OtpStep>("mobile");
  /** The pass type being reserved (the hero's one-tap reservation picks it before the state updates). */
  const reservingTier = useRef<TicketTierOut | null>(null);
  const pageContext = useRef<{ active: boolean } | null>(null);
  const { token: storedToken, signIn } = useAttendeeSession();

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
      setReserved(null);
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
            // Select the first tier reservable now (registration and sales windows, switch, quota).
            const at = Date.now();
            const firstAvailable = data.ticket_tiers.find((t) => tierAvailability(data, t, at).kind === "open");
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
  const heldPass = useHeldPass(event?.slug, storedToken);
  usePageMeta(event ? { doc, images, locale, eventName: event.name } : null);
  const selectedTier =
    event?.ticket_tiers.find((t) => t.id === selectedTierId) ??
    (event?.ticket_tiers.length ? event.ticket_tiers[0] : null);

  // Registration windows open and close on their own: the page re-renders every 30 s to follow them.
  const now = useNow();
  // Never open the sign-in sheet for a reservation the API would refuse (window, sales, switch, quota).
  const reservableNow = (tier: TicketTierOut | null, at: number) => Boolean(event && tier && tierAvailability(event, tier, at).kind === "open");

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
    const result = await client
      .POST("/api/events/{event_id}/tickets/reserve", {
        params: { path: { event_id: event.id } },
        body: { ticket_tier_id: tierId },
      })
      .catch(() => null);
    if (result === null) {
      // Network failure: no response to interpret, but the attendee must see that nothing was reserved.
      if (context.active) {
        setModalError(networkErrorMessage[locale]);
        setSubmitting(false);
      }
      return;
    }
    const { data, error: err, response } = result;
    if (!context.active) return;
    const session = attendeeResponseState(token, response.status);
    // A response for a session that has since changed must not show success or error for the new one.
    if (session === "changed") {
      setSubmitting(false);
      return;
    }

    if (err) {
      // Edge case 2: 401 for the exact token that was sent (the API client already removed it)
      if (session === "expired") {
        setAlreadyHasTicket(false);
        setModalError(c.errSessionExpired);
        setIsAuthModalOpen(true);
        setSubmitting(false);
        return;
      }

      // Decided by the API's stable error code, never by its English text.
      const code = apiErrorCode(err);
      // Edge case 4: Duplicate registration conflict
      if (code === "ALREADY_REGISTERED") {
        setAlreadyHasTicket(true);
        setIsAuthModalOpen(false);
        setModalError(null);
      } else {
        // Edge case 3: Tier became unavailable / sold out / closed: reload the latest tier availability
        if (isTierUnavailable(code)) refreshEvent(event.slug, context);
        // A code without Persian text (or no code) must not show the server's English to a Persian reader.
        const known = code !== undefined && Object.hasOwn(errorMessages[locale], code);
        setModalError(known || locale === "en" ? localizedApiError(err, locale) : c.reserveFailed);
      }
      setSubmitting(false);
    } else if (data) {
      setIsAuthModalOpen(false);
      setSubmitting(false);
      setAlreadyHasTicket(true);
      setReserved(data);
      setIsSuccessModalOpen(true);
      refreshEvent(event.slug, context);
    }
  };

  const startReservation = async (tier: TicketTierOut | null) => {
    if (!tier || !event || !reservableNow(tier, Date.now())) return;
    reservingTier.current = tier;
    setSelectedTierId(tier.id);
    setModalError(null);

    if (storedToken) {
      // User is already logged in: reserve directly
      setSubmitting(true);
      await executeReservation(storedToken, tier.id);
    } else {
      // Needs authentication: open accessible dialog
      setDialogStep("mobile");
      setIsAuthModalOpen(true);
    }
  };

  // Signed in (or signed up) by SMS code inside the dialog: keep the session, then reserve the chosen pass.
  const handleSignedInAndReserve = async (auth: AuthResponse) => {
    const tier = reservingTier.current ?? selectedTier;
    if (!tier || !event) return;
    if (!pageContext.current?.active) return;
    signIn(auth.access_token);
    setModalError(null);
    setSubmitting(true);
    await executeReservation(auth.access_token, tier.id);
  };

  // Loading skeleton state
  if (loading) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale}>
        {/* Fills the viewport so the footer never sits in view and jumps when content arrives (CLS). */}
        <section role="status" aria-label={c.loading} className="relative min-h-[100svh] overflow-hidden bg-surface-ink">
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
        <div className="mx-auto max-w-xl px-4 py-16 sm:py-24">
          <StateBlock
            kind={notFound ? "empty" : "error"}
            icon={notFound ? "search" : undefined}
            headingLevel={1}
            title={notFound ? c.notFoundTitle : c.eventLoadFailedTitle}
            body={notFound ? c.notFoundBody : c.eventLoadFailed}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                {!notFound && (
                  <Button type="button" variant="secondary" icon="sync" onClick={() => setReloadKey((k) => k + 1)}>
                    {c.retry}
                  </Button>
                )}
                <LinkButton to="/sign-in" variant={notFound ? "primary" : "ghost"} icon="ticket">
                  {c.findMyPass}
                </LinkButton>
              </div>
            }
          />
        </div>
      </PublicLayout>
    );
  }

  const held = alreadyHasTicket || heldPass;
  const passPath = `/c/${encodeURIComponent(event.slug)}/my-ticket`;
  const openTiers = event.ticket_tiers.filter((t) => tierAvailability(event, t, now).kind === "open");
  // One primary action in the hero: the held pass, a one-tap reservation of the only open pass type, the
  // passes section when several are open, and nothing while registration cannot be used.
  const heroAction: HeroAction = held
    ? { kind: "pass", to: passPath }
    : !isSectionVisible(doc, "passes") || openTiers.length === 0
      ? { kind: "none" }
      : openTiers.length === 1
        ? { kind: "reserve", onReserve: () => void startReservation(openTiers[0]) }
        : { kind: "passes" };
  const logo = doc.branding.logo_asset_id ? images[doc.branding.logo_asset_id] ?? null : null;

  return (
    <PublicLayout locale={locale} onLocaleChange={setLocale} congressName={event.name} brand={{ accent: accentOf(doc.branding), logo }}>
      <CongressPage
        event={event}
        doc={doc}
        images={images}
        locale={locale}
        programFiles={programFilesOf(event)}
        now={now}
        heroAction={heroAction}
        passes={
          <PassesPanel
            slug={event.slug}
            tiers={event.ticket_tiers}
            locale={locale}
            registration={event}
            timeZone={event.timezone}
            now={now}
            selectedTierId={selectedTierId}
            onSelectTier={(id) => {
              setSelectedTierId(id);
              setModalError(null);
            }}
            onReserve={() => void startReservation(selectedTier)}
            submitting={submitting}
            alreadyHasTicket={held}
            signedIn={Boolean(storedToken)}
            // Signed-in attendees reserve without the dialog, so its errors must show beside the dock.
            error={isAuthModalOpen ? null : modalError}
          />
        }
      />

      {/* Reservation: sign in by SMS code, then the pass is reserved. */}
      <Dialog
        isOpen={isAuthModalOpen}
        onClose={() => {
          if (!submitting) {
            setIsAuthModalOpen(false);
            setModalError(null);
          }
        }}
        title={dialogStep === "profile" ? c.profileTitle : c.reserveTitle(selectedTier ? isolateFor(selectedTier.name, locale) : "")}
        size="md"
      >
        <div className="space-y-5">
          {submitting ? (
            <p role="status" className="flex items-center gap-2.5 rounded-control bg-surface-panel-subtle p-3.5 text-body-sm text-text-secondary">
              <Icon name="ticket" size={18} className="shrink-0 text-aiteb-indigo" />
              {c.processing}
            </p>
          ) : (
            <MobileOtpForm
              locale={locale}
              onSignedIn={(auth) => void handleSignedInAndReserve(auth)}
              onStepChange={setDialogStep}
              verifyLabel={c.submitVerify}
              showMobileHint={false}
              profileLead={null}
              profileSubmitLabel={c.profileSubmit}
              stickySubmit="dialog"
            />
          )}
          {modalError && <Notice tone="danger">{modalError}</Notice>}
        </div>
      </Dialog>

      {/* The reserved pass: its QR code, then open it or add the congress to a calendar. */}
      <Dialog isOpen={isSuccessModalOpen} onClose={() => setIsSuccessModalOpen(false)} title={c.successTitle} size="sm">
        <div className="space-y-5" data-testid="reserve-success">
          <div className="surface-ink flex items-center gap-4 rounded-card bg-surface-ink p-5 text-white">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-body font-semibold leading-snug break-words">
                <Bidi text={event.name} />
              </p>
              <p className="text-body-sm text-ink-200">
                {c.successTier}: <span className="font-semibold text-white">{selectedTier && <Bidi text={reserved?.ticket_tier_name || selectedTier.name} />}</span>
              </p>
            </div>
            {reserved?.qr_secret && (
              <div role="img" aria-label={c.successQrLabel} className="shrink-0 rounded-control bg-white p-2">
                <QRCode value={reserved.qr_secret} size={96} level="M" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" className="size-24" />
              </div>
            )}
          </div>
          <p className="flex items-start gap-2 text-body-sm text-text-secondary">
            <Icon name="phone" size={16} className="mt-0.5 shrink-0 text-event-accent" />
            {c.successSms}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              isFullWidth
              icon="qr"
              onClick={() => {
                setIsSuccessModalOpen(false);
                navigate(passPath);
              }}
            >
              {c.viewMyPass}
            </Button>
            <Button type="button" variant="ghost" isFullWidth icon="calendar" onClick={() => downloadCalendarFile(event)}>
              {c.addToCalendar}
            </Button>
          </div>
        </div>
      </Dialog>
    </PublicLayout>
  );
}
