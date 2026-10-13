import React, { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  type PublicEvent as PublicEventType,
} from "../api/client";
import { isStoredAttendeeToken, rejectAttendeeToken } from "../lib/attendeeSession";
import { PublicLayout } from "../layouts/PublicLayout";
import { translations } from "../lib/i18n";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon, type IconName } from "../components/ui/Icon";
import { CongressSignature } from "../components/brand/CongressSignature";
import { contentLocale, num, publicCopy } from "../components/public/copy";
import { CongressHero } from "../components/public/CongressHero";
import { EditorialSection } from "../components/public/EditorialSection";
import { PassStub } from "../components/public/PassStub";
import { BoothIndex } from "../components/public/BoothIndex";

export default function PublicEvent() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const formId = useId();
  const [event, setEvent] = useState<PublicEventType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected tier for reservation
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  // Modal states
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
  const [alreadyHasTicket, setAlreadyHasTicket] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const pageContext = useRef<{ active: boolean } | null>(null);

  useEffect(() => {
    if (!slug) return;
    const context = { active: true };
    pageContext.current = context;
    const loadEvent = async () => {
      setLoading(true);
      setError(null);
      setEvent(null);
      setSelectedTierId(null);
      setIsAuthModalOpen(false);
      setIsSuccessModalOpen(false);
      setAlreadyHasTicket(false);
      setModalError(null);
      setSubmitting(false);
      const client = createApiClient({ kind: "anonymous" });
      const { data, error: err } = await client.GET("/api/public/events/{slug}", {
        params: { path: { slug } },
      });
      if (!context.active) return;
      if (err) {
        setError(formatApiError(err));
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
      setLoading(false);
    };
    loadEvent();
    return () => {
      context.active = false;
    };
  }, [slug]);

  const locale = event ? contentLocale(event.name) : "en";
  const c = publicCopy[locale];
  const t = translations[locale];
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
      setAuthMode("login");
      setModalError(publicCopy[contentLocale(event.name)].errSessionChanged);
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
        setAuthMode("login");
        setModalError(publicCopy[contentLocale(event.name)].errSessionExpired);
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
          const clientFresh = createApiClient({ kind: "anonymous" });
          clientFresh.GET("/api/public/events/{slug}", {
            params: { path: { slug: event.slug } },
          }).then(({ data: freshData }) => {
            if (context.active && freshData) setEvent((current) => current?.slug === freshData.slug ? freshData : current);
          });
        }
        setModalError(formatted);
      }
      setSubmitting(false);
    } else if (data) {
      setIsAuthModalOpen(false);
      setSubmitting(false);
      setIsSuccessModalOpen(true);
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

  const handleAuthAndReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTier || !event) return;
    const context = pageContext.current;
    if (!context?.active) return;
    setModalError(null);
    setSubmitting(true);

    const client = createApiClient({ kind: "anonymous" });

    // Edge case 1: If account was created on previous attempt but reservation failed,
    // reuse the stored token directly rather than re-registering and triggering a 409 conflict
    const existingToken =
      typeof window !== "undefined"
        ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
        : null;
    if (existingToken && authMode === "register") {
      await executeReservation(existingToken, selectedTier.id);
      return;
    }

    if (authMode === "register") {
      if (!fullName.trim() || !email.trim() || !password) {
        setModalError(publicCopy[contentLocale(event.name)].errRequired);
        setSubmitting(false);
        return;
      }

      const { data, error: err } = await client.POST("/api/auth/register", {
        body: {
          email: email.trim(),
          password,
          full_name: fullName.trim(),
          organization: organization.trim(),
          title: title.trim(),
        },
      });
      if (!context.active) return;
      if (err) {
        setModalError(formatApiError(err));
        setSubmitting(false);
        return;
      }

      if (data) {
        localStorage.setItem(ATTENDEE_TOKEN_STORAGE, data.access_token);
        await executeReservation(data.access_token, selectedTier.id);
      }
    } else {
      // Login mode
      if (!email.trim() || !password) {
        setModalError(publicCopy[contentLocale(event.name)].errLoginRequired);
        setSubmitting(false);
        return;
      }

      const { data, error: err } = await client.POST("/api/auth/login", {
        body: {
          email: email.trim(),
          password,
        },
      });
      if (!context.active) return;

      if (err) {
        setModalError(formatApiError(err));
        setSubmitting(false);
        return;
      }

      if (data) {
        localStorage.setItem(ATTENDEE_TOKEN_STORAGE, data.access_token);
        await executeReservation(data.access_token, selectedTier.id);
      }
    }
  };

  // Loading skeleton state
  if (loading) {
    return (
      <PublicLayout>
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
  if (error || !event) {
    return (
      <PublicLayout congressName="">
        <section className="relative isolate overflow-hidden">
          <CongressSignature seed={slug ?? "congress"} tone="light" className="absolute inset-0 -z-10 size-full opacity-70" />
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-b from-surface-page/30 via-surface-page/85 to-surface-page" />
          <div className="mx-auto max-w-xl space-y-7 px-4 py-24 text-center sm:py-36">
            <span className="mx-auto grid size-16 place-items-center bg-surface-panel text-aiteb-indigo shadow-lift shape-arc">
              <Icon name="search" size={28} />
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-text-primary sm:text-4xl">{c.notFoundTitle}</h1>
              <p className="text-base leading-relaxed text-text-secondary">{error ?? c.notFoundBody}</p>
            </div>
            <LinkButton to="/" variant="secondary" size="lg">
              <Icon name="arrow-left" size={18} />
              {c.returnHome}
            </LinkButton>
          </div>
        </section>
      </PublicLayout>
    );
  }

  const reserveLabel = submitting
    ? c.processing
    : selectedTierState === "SOLD_OUT"
      ? t.reserveButtonSoldOut
      : selectedTierState === "CLOSED"
        ? t.reserveButtonClosed
        : c.reserve;
  const selectedRemaining = Math.max(0, selectedTierQuota - selectedTierReserved);
  const tabClass = (active: boolean) =>
    `min-h-[44px] rounded-lg px-3 text-sm font-semibold transition-[background-color,color,box-shadow] cursor-pointer ${
      active ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"
    }`;
  const required = (
    <span aria-hidden="true" className="text-status-danger-text">
      *
    </span>
  );

  return (
    <PublicLayout locale={locale} congressName={event.name}>
      <CongressHero event={event} locale={locale} />

      <div className="pub-sheet">
        <div className="mx-auto max-w-7xl space-y-20 px-4 pt-14 pb-20 sm:space-y-28 sm:px-6 sm:pt-20 sm:pb-28 lg:px-10">
          {/* 01 About */}
          <EditorialSection id="about" headingId="about-heading" index={1} eyebrow={c.sectionAboutEyebrow} title={c.sectionAbout} locale={locale}>
            {event.description ? (
              <p className="max-w-3xl whitespace-pre-line text-xl leading-[1.6] tracking-[-0.01em] text-text-primary sm:text-2xl sm:leading-[1.55] rtl:leading-[1.95]">
                {event.description}
              </p>
            ) : (
              <p className="text-base text-text-muted">{c.noDescription}</p>
            )}
          </EditorialSection>

          {/* 02 What the pass includes */}
          <EditorialSection id="includes" headingId="features-heading" index={2} eyebrow={c.sectionIncludesEyebrow} title={c.sectionIncludes} locale={locale}>
            <ul className="grid border-t border-border-default sm:grid-cols-2">
              {c.includes.map((item, i) => (
                <li
                  key={item.title}
                  className={`flex gap-4 border-b border-border-default py-6 sm:py-8 ${i % 2 === 0 ? "sm:pe-8" : "sm:border-s sm:ps-8"}`}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-event-accent-soft text-event-accent [border-start-end-radius:18px]">
                    <Icon name={item.icon as IconName} size={22} />
                  </span>
                  <div className="space-y-1.5">
                    <h3 className="text-base font-semibold text-text-primary">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-text-secondary">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </EditorialSection>

          {/* 03 Passes */}
          <EditorialSection
            id="passes"
            headingId="passes-heading"
            index={3}
            layout="stack"
            eyebrow={c.sectionPassesEyebrow}
            title={c.sectionPasses}
            lead={c.passesLead}
            locale={locale}
            aside={
              <Badge variant="accent" size="md" icon={<Icon name="ticket" size={14} />} className="self-start lg:self-auto">
                {c.freeAdmission}
              </Badge>
            }
          >
            <div className="space-y-6">
              {event.ticket_tiers.length === 0 ? (
                <div className="flex items-start gap-4 rounded-2xl border border-dashed border-border-strong bg-surface-panel p-6 sm:p-8">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-panel-subtle text-text-muted">
                    <Icon name="lock" size={22} />
                  </span>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-text-primary">{c.noTiersTitle}</p>
                    <p className="text-sm text-text-secondary">{c.noTiersBody}</p>
                  </div>
                </div>
              ) : (
                <fieldset className="grid gap-5 md:grid-cols-2">
                  <legend className="sr-only">{c.tierLegend}</legend>
                  {event.ticket_tiers.map((tier, i) => (
                    <PassStub
                      key={tier.id}
                      tier={tier}
                      index={i}
                      locale={locale}
                      selected={tier.id === selectedTierId}
                      onSelect={() => setSelectedTierId(tier.id)}
                    />
                  ))}
                </fieldset>
              )}

              {/* Already has ticket banner */}
              {alreadyHasTicket && (
                <div
                  role="alert"
                  className="flex flex-col gap-4 rounded-2xl border border-action-subtle-border bg-aiteb-lavender p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-panel text-aiteb-indigo shadow-soft">
                      <Icon name="ticket" size={20} />
                    </span>
                    <div className="space-y-0.5">
                      <p className="text-sm font-bold text-aiteb-indigo">{c.activePassTitle}</p>
                      <p className="text-sm text-text-secondary">{c.activePassBody}</p>
                    </div>
                  </div>
                  <LinkButton to={`/c/${event.slug}/my-ticket`} variant="primary" size="md">
                    {c.viewMyPass}
                    <Icon name="arrow-right" size={16} />
                  </LinkButton>
                </div>
              )}

              {/* Reservation dock: sticks to the viewport bottom while the passes are on screen. */}
              <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:static">
                <div className="flex flex-col gap-4 bg-surface-ink p-4 text-white shadow-pop shape-arc sm:flex-row sm:items-center sm:gap-6 sm:p-5">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <span aria-hidden="true" className="relative hidden size-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15 [border-start-end-radius:20px] sm:block">
                      <CongressSignature seed={event.slug} tone="ink" className="absolute inset-0 size-full scale-150" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-ink-300">{c.selectedPass}</p>
                      <p className="truncate text-base font-semibold">{selectedTier?.name ?? c.noTiersTitle}</p>
                      {selectedTier && isSelectedTierAvailable && (
                        <p className="text-xs text-ink-300">
                          {c.freeAdmission} · {t.tierCapacityRemaining} <span className="tabular text-white">{num(selectedRemaining, locale)}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="light"
                    size="lg"
                    className="w-full sm:w-auto sm:min-w-[14rem] focus-visible:outline-aiteb-orchid"
                    disabled={submitting || event.ticket_tiers.length === 0 || !isSelectedTierAvailable}
                    onClick={handleStartReservation}
                  >
                    {reserveLabel}
                    {!submitting && isSelectedTierAvailable && <Icon name="arrow-right" size={18} />}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1.5 text-center text-sm text-text-muted lg:flex-row lg:justify-center lg:gap-3">
                <span className="inline-flex items-center gap-2">
                  <Icon name="device" size={16} />
                  {c.digitalNote}
                </span>
                <span aria-hidden="true" className="hidden lg:inline">
                  ·
                </span>
                <span>
                  {c.alreadyRegistered}{" "}
                  <Link to="/my-tickets" className="font-semibold text-event-accent hover:underline">
                    {c.viewExisting}
                  </Link>
                </span>
              </div>
            </div>
          </EditorialSection>

          {/* 04 Exhibition */}
          <EditorialSection
            id="exhibition"
            headingId="exhibition-heading"
            index={4}
            eyebrow={c.sectionExhibitionEyebrow}
            title={c.sectionExhibition}
            lead={c.exhibitionLead}
            locale={locale}
          >
            <BoothIndex key={event.slug} slug={event.slug} locale={locale} />
          </EditorialSection>
        </div>
      </div>

      {/* Accessible Registration / Authentication Dialog */}
      <Dialog
        isOpen={isAuthModalOpen}
        onClose={() => {
          if (!submitting) {
            setIsAuthModalOpen(false);
            setModalError(null);
          }
        }}
        title={authMode === "register" ? c.dialogRegisterTitle : c.dialogLoginTitle}
        description={selectedTier ? c.dialogDescription(selectedTier.name) : undefined}
        size="md"
      >
        <div className="space-y-6">
          {/* Auth Mode Toggle Tabs */}
          <div role="tablist" aria-label={c.modeLabel} className="grid grid-cols-2 gap-1 rounded-xl border border-border-default bg-surface-panel-subtle p-1">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "register"}
              onClick={() => {
                setAuthMode("register");
                setModalError(null);
              }}
              className={tabClass(authMode === "register")}
            >
              {c.modeRegister}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "login"}
              onClick={() => {
                setAuthMode("login");
                setModalError(null);
              }}
              className={tabClass(authMode === "login")}
            >
              {c.modeLogin}
            </button>
          </div>

          <form onSubmit={handleAuthAndReserve} className="space-y-4">
            {authMode === "register" && (
              <div>
                <label htmlFor={`${formId}-name`} className="ui-label">
                  {c.fullName} {required}
                </label>
                <input
                  id={`${formId}-name`}
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={c.fullNamePlaceholder}
                  className="ui-input"
                />
              </div>
            )}

            <div>
              <label htmlFor={`${formId}-email`} className="ui-label">
                {c.email} {required}
              </label>
              <input
                id={`${formId}-email`}
                type="email"
                required
                dir="ltr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={c.emailPlaceholder}
                className="ui-input rtl:text-right"
              />
            </div>

            <div>
              <label htmlFor={`${formId}-password`} className="ui-label">
                {c.password} {required}
              </label>
              <input
                id={`${formId}-password`}
                type="password"
                required
                minLength={8}
                dir="ltr"
                autoComplete={authMode === "register" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={c.passwordPlaceholder}
                className="ui-input rtl:text-right"
              />
            </div>

            {authMode === "register" && (
              <div className="grid grid-cols-1 gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2">
                <p className="-mb-1 text-xs font-medium text-text-muted sm:col-span-2">{c.optional}</p>
                <div>
                  <label htmlFor={`${formId}-org`} className="ui-label">
                    {c.organization}
                  </label>
                  <input
                    id={`${formId}-org`}
                    type="text"
                    autoComplete="organization"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder={c.organizationPlaceholder}
                    className="ui-input"
                  />
                </div>
                <div>
                  <label htmlFor={`${formId}-title`} className="ui-label">
                    {c.title}
                  </label>
                  <input
                    id={`${formId}-title`}
                    type="text"
                    autoComplete="organization-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={c.titlePlaceholder}
                    className="ui-input"
                  />
                </div>
              </div>
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

            <div className="pt-2">
              <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting}>
                {submitting ? c.submitting : authMode === "register" ? c.submitRegister : c.submitLogin}
                {!submitting && <Icon name="arrow-right" size={18} />}
              </Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* Accessible Success Confirmation Dialog */}
      <Dialog
        isOpen={isSuccessModalOpen}
        onClose={() => {
          setIsSuccessModalOpen(false);
          navigate("/my-tickets");
        }}
        title={c.successTitle}
        description={c.successDescription}
        size="sm"
      >
        <div className="space-y-6">
          <div className="relative isolate overflow-hidden rounded-2xl bg-surface-ink p-5 text-white [border-start-end-radius:var(--radius-arc)]">
            <CongressSignature seed={event.slug} tone="ink" className="absolute inset-0 -z-10 size-full opacity-80 rtl:-scale-x-100" />
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-t from-surface-ink via-surface-ink/80 to-surface-ink/20" />
            <span className="grid size-11 place-items-center rounded-full bg-[#3EE0A1] text-surface-ink motion-safe:animate-pop">
              <Icon name="check" size={22} strokeWidth={2.4} />
            </span>
            <h3 className="mt-6 text-lg font-semibold leading-snug">{event.name}</h3>
            <p className="mt-1 text-sm text-ink-200">
              {c.successTier}: <span className="font-semibold text-white">{selectedTier?.name}</span>
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
