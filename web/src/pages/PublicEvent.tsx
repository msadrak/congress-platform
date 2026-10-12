import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  formatApiError,
  createApiClient,
  getApiClient,
  type PublicEvent as PublicEventType,
} from "../api/client";
import { PublicLayout } from "../layouts/PublicLayout";
import { useAttendeeLocale, formatLocalizedDate, formatLocalizedNumber } from "../lib/i18n";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
export default function PublicEvent() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { locale, t, isRtl } = useAttendeeLocale();
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
    const client = getApiClient(token);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/tickets/reserve",
      {
        params: { path: { event_id: event.id } },
        body: { ticket_tier_id: tierId },
      }
    );
    if (!context.active) return;

    if (err) {
      const formatted = formatApiError(err);
      const lower = formatted.toLowerCase();

      // Edge case 2: Expired or invalid token
      if (
        lower.includes("could not validate credentials") ||
        lower.includes("signature has expired") ||
        lower.includes("not authenticated") ||
        lower.includes("unauthorized")
      ) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
        }
        setAlreadyHasTicket(false);
        setAuthMode("login");
        setModalError("Your session has expired. Please sign in to reserve your pass.");
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
        setModalError("Please complete all required fields.");
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
        setModalError("Please provide your email address and password.");
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="max-w-3xl space-y-6 animate-pulse">
            <div className="w-28 h-6 bg-surface-panel-subtle rounded-full" />
            <div className="w-3/4 h-10 sm:h-14 bg-surface-panel-subtle rounded-xl" />
            <div className="w-full h-24 bg-surface-panel-subtle rounded-xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
              <div className="h-20 bg-surface-panel-subtle rounded-xl" />
              <div className="h-20 bg-surface-panel-subtle rounded-xl" />
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Error / Not Found state
  if (error || !event) {
    return (
      <PublicLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 flex items-center justify-center">
          <div className="max-w-md w-full bg-surface-panel p-8 sm:p-10 rounded-2xl border border-border-default shadow-xs text-center space-y-5">
            <div className="w-12 h-12 rounded-full bg-action-subtle text-action-primary mx-auto flex items-center justify-center font-bold text-lg">
              🔍
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold text-text-primary tracking-tight">
                Event Not Found
              </h1>
              <p className="text-sm text-text-secondary leading-relaxed">
                {error ?? "The event you are looking for does not exist or has been removed."}
              </p>
            </div>
            <div className="pt-2">
              <LinkButton to="/" variant="secondary" size="md">
                ← Return to Platform Home
              </LinkButton>
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }
  const startDateFormatted = formatLocalizedDate(event.starts_at, locale);
  const startTimeFormatted = new Date(event.starts_at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const endTimeFormatted = new Date(event.ends_at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <PublicLayout>
      {/* Event Hero Banner */}
      <section className="bg-surface-panel border-b border-border-default pt-10 pb-12 sm:pt-16 sm:pb-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl space-y-6">
            {/* Status & Category Bar */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant="brand" size="md">
                Official Congress Registration
              </Badge>
              <Badge variant="success" size="md">
                Registration Open
              </Badge>
              <span className="text-xs text-text-muted hidden sm:inline">•</span>
              <span className="text-xs font-mono text-text-muted hidden sm:inline">
                /e/{event.slug}
              </span>
            </div>

            {/* Event Title (H1) */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-text-primary leading-[1.12]">
              {event.name}
            </h1>

            {/* Fast Facts Bar: Date, Time & Venue */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 max-w-2xl text-xs sm:text-sm">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-page border border-border-default">
                <span className="w-8 h-8 rounded-lg bg-action-subtle text-action-primary flex items-center justify-center shrink-0 font-bold text-sm">
                  📅
                </span>
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-text-primary block">
                    Dates & Schedule
                  </span>
                  <span className="text-text-secondary block font-medium">
                    {startDateFormatted}
                  </span>
                  <span className="text-xs text-text-muted block">
                    {startTimeFormatted} – {endTimeFormatted}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-surface-page border border-border-default">
                <span className="w-8 h-8 rounded-lg bg-action-subtle text-action-primary flex items-center justify-center shrink-0 font-bold text-sm">
                  📍
                </span>
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-text-primary block">
                    Congress Venue
                  </span>
                  <span className="text-text-secondary block font-medium">
                    {event.location}
                  </span>
                  <span className="text-xs text-text-muted block">
                    On-Site Attendance
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Two-Column Layout (1024px split) */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Event Description & Overview (7 cols) */}
          <div className="lg:col-span-7 space-y-10">
            {/* Already has ticket banner */}
            {alreadyHasTicket && (
              <div
                role="alert"
                className="p-4 sm:p-5 rounded-xl bg-action-subtle border border-action-subtle-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-action-primary block">
                    Active Pass Detected
                  </span>
                  <p className="text-xs sm:text-sm text-text-secondary">
                    You already hold an active attendee pass for this congress.
                  </p>
                </div>
                <LinkButton to="/my-tickets" variant="primary" size="sm">
                  View My Pass →
                </LinkButton>
              </div>
            )}

            {/* About / Description */}
            <section aria-labelledby="about-heading" className="space-y-4">
              <h2
                id="about-heading"
                className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary"
              >
                About this Congress
              </h2>
              {event.description ? (
                <div className="prose prose-slate max-w-none text-sm sm:text-base text-text-secondary leading-relaxed whitespace-pre-line space-y-3">
                  {event.description}
                </div>
              ) : (
                <p className="text-sm text-text-muted italic">
                  No additional event description provided by the organizers.
                </p>
              )}
            </section>

            {/* Event Highlights & Features */}
            <section aria-labelledby="features-heading" className="space-y-4 pt-6 border-t border-border-default">
              <h2
                id="features-heading"
                className="text-lg sm:text-xl font-bold tracking-tight text-text-primary"
              >
                What Your Pass Includes
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-surface-panel border border-border-default space-y-1.5">
                  <div className="text-xs font-bold text-text-primary flex items-center gap-2">
                    <span className="text-action-primary">✓</span> Digital QR Pass
                  </div>
                  <p className="text-xs text-text-secondary leading-normal">
                    Instant high-contrast badge for seamless check-in at venue gates.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-surface-panel border border-border-default space-y-1.5">
                  <div className="text-xs font-bold text-text-primary flex items-center gap-2">
                    <span className="text-action-primary">✓</span> Exhibition Access
                  </div>
                  <p className="text-xs text-text-secondary leading-normal">
                    Discover participating company booths and download digital brochures.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-surface-panel border border-border-default space-y-1.5">
                  <div className="text-xs font-bold text-text-primary flex items-center gap-2">
                    <span className="text-action-primary">✓</span> Peer Networking
                  </div>
                  <p className="text-xs text-text-secondary leading-normal">
                    Connect with fellow delegates and download vCards directly.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-surface-panel border border-border-default space-y-1.5">
                  <div className="text-xs font-bold text-text-primary flex items-center gap-2">
                    <span className="text-action-primary">✓</span> Offline Pass Access
                  </div>
                  <p className="text-xs text-text-secondary leading-normal">
                    Passes stay saved in your personal device browser for fast entry.
                  </p>
                </div>
              </div>
            </section>

            {/* Exhibition Notice */}
            <section aria-labelledby="exhibition-heading" className="p-5 rounded-2xl bg-surface-panel-subtle border border-border-default space-y-2">
              <h2
                id="exhibition-heading"
                className="text-sm font-bold text-text-primary flex items-center gap-2"
              >
                <span>🏢</span> Commercial Exhibition & Sponsorship
              </h2>
              <p className="text-xs text-text-secondary leading-relaxed">
                This event hosts commercial exhibitors and industry sponsors. Attendees can visit digital booth profiles via direct booth links (<code className="font-mono text-xs bg-white px-1 rounded border border-border-subtle">/e/{event.slug}/booths/:id</code>) and save digital brochures.
              </p>
            </section>
          </div>

          {/* Right Column: Ticket Tiers & Registration Card (5 cols) */}
          <aside className="lg:col-span-5 lg:sticky lg:top-24 space-y-6">
            <Card className="border-border-default shadow-sm overflow-hidden">
              <div className="p-5 sm:p-6 bg-surface-panel border-b border-border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-text-primary tracking-tight">
                    Select Your Pass
                  </h2>
                  <Badge variant="brand" size="sm">
                    Free Admission
                  </Badge>
                </div>
                <p className="text-xs text-text-secondary">
                  Choose your ticket tier below. Registration takes less than a minute.
                </p>
              </div>

              <CardContent className="p-5 sm:p-6 space-y-4">
                {event.ticket_tiers.length === 0 ? (
                  <div className="p-6 text-center rounded-xl bg-surface-page border border-border-subtle text-xs text-text-muted space-y-2">
                    <p className="font-semibold text-text-primary">
                      Registration is currently closed
                    </p>
                    <p>No ticket tiers are open for registration at this time.</p>
                  </div>
                ) : (
                  <fieldset className="space-y-3">
                    <legend className="sr-only">Available Ticket Tiers</legend>
                    {event.ticket_tiers.map((tier) => {
                      const isSelected = tier.id === selectedTierId;
                      const reserved = tier.reserved_count ?? 0;
                      const remaining = Math.max(0, tier.quota - reserved);

                      const tierState =
                        reserved >= tier.quota
                          ? "SOLD_OUT"
                          : !tier.is_open
                          ? "CLOSED"
                          : "AVAILABLE";

                      const isAvailable = tierState === "AVAILABLE";

                      return (
                        <label
                          key={tier.id}
                          className={`block p-4 rounded-xl border transition-all relative select-none ${
                            !isAvailable
                              ? "bg-neutral-50/80 border-border-default opacity-85 cursor-not-allowed"
                              : isSelected
                              ? "bg-action-subtle/50 border-action-primary ring-1 ring-action-primary shadow-xs cursor-pointer"
                              : "bg-surface-panel hover:bg-surface-page border-border-default cursor-pointer"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              <input
                                type="radio"
                                name="ticket_tier"
                                value={tier.id}
                                checked={isSelected}
                                disabled={!isAvailable}
                                onChange={() => {
                                  if (isAvailable) setSelectedTierId(tier.id);
                                }}
                                className="mt-0.5 text-action-primary focus:ring-action-primary disabled:opacity-40"
                              />
                              <div className="space-y-1">
                                <span className={`font-bold text-sm block leading-tight ${!isAvailable ? "text-text-secondary" : "text-text-primary"}`}>
                                  {tier.name}
                                </span>
                                <span className="text-xs text-text-secondary block leading-relaxed">
                                  {tier.description ||
                                    (isRtl ? "پذیرش عمومی همایش برای کلیه نشست‌ها." : "General admission pass for all sessions and exhibits.")}
                                </span>
                              </div>
                            </div>

                            {/* Authoritative State Badge */}
                            <div className="shrink-0">
                              {tierState === "AVAILABLE" && (
                                <Badge variant="success" size="sm">
                                  {isRtl ? "رایگان" : "FREE"}
                                </Badge>
                              )}
                              {tierState === "SOLD_OUT" && (
                                <Badge variant="neutral" size="sm" className="bg-amber-100 text-amber-900 border-amber-300">
                                  {t.tierStatusSoldOut || (isRtl ? "تکمیل ظرفیت" : "Sold Out")}
                                </Badge>
                              )}
                              {tierState === "CLOSED" && (
                                <Badge variant="neutral" size="sm" className="bg-neutral-200 text-neutral-800 border-neutral-300">
                                  {t.tierStatusRegistrationClosed || (isRtl ? "ثبت‌نام بسته است" : "Registration Closed")}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 pt-2.5 border-t border-border-subtle flex items-center justify-between text-[11px] text-text-muted">
                            <span>
                              {tierState === "AVAILABLE" && (
                                <>
                                  {t.tierCapacityRemaining || (isRtl ? "ظرفیت باقی‌مانده:" : "Seats remaining:")}{" "}
                                  <strong className="text-text-primary">{formatLocalizedNumber(remaining, locale)}</strong>{" "}
                                  / {formatLocalizedNumber(tier.quota, locale)}
                                </>
                              )}
                              {tierState === "SOLD_OUT" && (
                                <span className="text-amber-800 font-medium">
                                  {t.tierCapacitySoldOutNotice || (isRtl ? "ظرفیت این رده تکمیل شده است." : "Quota has been reached.")}
                                </span>
                              )}
                              {tierState === "CLOSED" && (
                                <span className="text-text-muted font-medium">
                                  {t.tierClosedNotice || (isRtl ? "ثبت‌نام این رده توسط برگزارکننده بسته شده است." : "Registration is closed.")}
                                </span>
                              )}
                            </span>
                            <span className="font-medium text-action-primary">100% Free Pass</span>
                          </div>
                        </label>
                      );
                    })}
                  </fieldset>
                )}

                {/* Primary Action Button */}
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    isFullWidth
                    disabled={submitting || event.ticket_tiers.length === 0 || !isSelectedTierAvailable}
                    onClick={handleStartReservation}
                  >
                    {submitting
                      ? (isRtl ? "در حال ثبت نهایی..." : "Processing Reservation...")
                      : selectedTierState === "SOLD_OUT"
                      ? (t.reserveButtonSoldOut || (isRtl ? "تکمیل ظرفیت" : "Sold Out"))
                      : selectedTierState === "CLOSED"
                      ? (t.reserveButtonClosed || (isRtl ? "ثبت‌نام این رده بسته است" : "Registration Closed"))
                      : (t.reserveButtonAvailable || (isRtl ? "رزرو رایگان بلیت →" : "Reserve Free Pass →"))}
                  </Button>
                </div>

                <div className="text-center pt-2 text-[11px] text-text-muted space-y-1">
                  <p>
                    Passes are digital and scannable directly on your smartphone.
                  </p>
                  <p>
                    Already registered?{" "}
                    <Link
                      to="/my-tickets"
                      className="text-action-primary font-medium hover:underline focus-visible:outline-focus-ring"
                    >
                      View existing tickets
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </aside>
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
        title={authMode === "register" ? "Complete Your Registration" : "Sign In to Reserve"}
        description={
          selectedTier
            ? `Reserving pass for ${selectedTier.name} • 100% Free`
            : undefined
        }
        size="md"
      >
        <div className="space-y-5">
          {/* Auth Mode Toggle Tabs */}
          <div
            role="tablist"
            aria-label="Account Access Mode"
            className="flex border-b border-border-default text-xs font-semibold"
          >
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "register"}
              onClick={() => {
                setAuthMode("register");
                setModalError(null);
              }}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors cursor-pointer ${
                authMode === "register"
                  ? "border-action-primary text-action-primary font-bold"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              New Attendee
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "login"}
              onClick={() => {
                setAuthMode("login");
                setModalError(null);
              }}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors cursor-pointer ${
                authMode === "login"
                  ? "border-action-primary text-action-primary font-bold"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              I Have an Account
            </button>
          </div>

          <form onSubmit={handleAuthAndReserve} className="space-y-4">
            {authMode === "register" && (
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Dr. Sarah Jenkins"
                  className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@institution.org"
                className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Password <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            {authMode === "register" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-primary mb-1">
                    Organization / University
                  </label>
                  <input
                    type="text"
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="e.g. Medical Center"
                    className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-primary mb-1">
                    Professional Title
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Research Fellow"
                    className="w-full px-3 py-2 bg-white border border-border-default rounded-lg text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                  />
                </div>
              </div>
            )}

            {modalError && (
              <div
                role="alert"
                aria-live="assertive"
                className="p-3 rounded-lg bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
              >
                {modalError}
              </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isFullWidth
                disabled={submitting}
              >
                {submitting
                  ? "Reserving Pass..."
                  : authMode === "register"
                  ? "Confirm Registration & Get Pass →"
                  : "Sign In & Confirm Pass →"}
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
        title="Pass Reserved Successfully!"
        description="Your congress registration has been confirmed."
        size="sm"
      >
        <div className="text-center space-y-5 py-2">
          <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center text-2xl font-bold">
            ✓
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-text-primary">
              {event.name}
            </h3>
            <p className="text-xs text-text-secondary">
              Tier: <span className="font-semibold text-action-primary">{selectedTier?.name}</span>
            </p>
            <p className="text-xs text-text-muted pt-1">
              Your digital pass and QR code have been minted and added to your attendee portal.
            </p>
          </div>
          <div className="pt-2 flex flex-col gap-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              isFullWidth
              onClick={() => {
                setIsSuccessModalOpen(false);
                navigate("/my-tickets");
              }}
            >
              Open My Tickets & QR Pass →
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              isFullWidth
              onClick={() => setIsSuccessModalOpen(false)}
            >
              Stay on Event Page
            </Button>
          </div>
        </div>
      </Dialog>
    </PublicLayout>
  );
}
