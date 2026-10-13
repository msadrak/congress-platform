import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  type PublicEvent as PublicEventType,
} from "../api/client";
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
      setAuthMode("login");
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
        setAuthMode("login");
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
        setModalError(c.errRequired);
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
        setModalError(c.errLoginRequired);
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
  if (error || !event) {
    return (
      <PublicLayout locale={locale} onLocaleChange={setLocale} congressName="">
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

  const required = (
    <span aria-hidden="true" className="text-status-danger-text">
      *
    </span>
  );
  const tabClass = (active: boolean) =>
    `min-h-[44px] rounded-lg px-3 text-sm font-semibold transition-[background-color,color,box-shadow] cursor-pointer ${
      active ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"
    }`;
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
        title={authMode === "register" ? c.dialogRegisterTitle : c.dialogLoginTitle}
        description={selectedTier ? c.dialogDescription(isolateFor(selectedTier.name, locale)) : undefined}
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
