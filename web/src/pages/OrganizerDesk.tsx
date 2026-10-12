import React, { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useOutletContext, useParams } from "react-router-dom";
import {
  formatApiError,
  createApiClient,
  getApiClient,
  type AttendeeDetailCard,
  type AttendeeSearchItem,
  type DeskMeOut,
  type DeskRegistrationOut,
  type TicketTierOut,
} from "../api/client";
import { formatLocalizedDate, formatLocalizedNumber } from "../lib/i18n";
import { Link } from "react-router-dom";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";

export default function OrganizerDesk() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, locale, t, isRtl } = useOutletContext<OrganizerOutletContext>();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Front desk operator authentication state
  const [deskToken, setDeskToken] = useState<string | null>(() => {
    if (typeof window !== "undefined" && eventId) {
      return sessionStorage.getItem(`congress_desk_token_${eventId}`);
    }
    return null;
  });
  const activeAuthToken = apiKey || deskToken;

  const [operatorProfile, setOperatorProfile] = useState<DeskMeOut | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Minted pass modal state
  const [mintedPass, setMintedPass] = useState<DeskRegistrationOut | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AttendeeSearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Selected attendee detail card (with scan history)
  const [selectedCard, setSelectedCard] = useState<AttendeeDetailCard | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!eventId) return;

    const loadEventData = async () => {
      if (!activeAuthToken) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const client = getApiClient(activeAuthToken);
      const [meRes, tiersRes] = await Promise.all([
        client.GET("/api/events/{event_id}/desk/me", {
          params: { path: { event_id: eventId } },
        }),
        client.GET("/api/events/{event_id}/desk/tiers", {
          params: { path: { event_id: eventId } },
        }),
      ]);

      if (!isMounted) return;

      if (meRes.error) {
        if (deskToken) {
          sessionStorage.removeItem(`congress_desk_token_${eventId}`);
          setDeskToken(null);
          setLoginError(isRtl ? "دسترسی اپراتور لغو شده یا نشست کاری منقضی گردیده است." : "Operator access revoked or session expired.");
        } else {
          setPageError(formatApiError(meRes.error));
        }
      } else if (meRes.data) {
        setOperatorProfile(meRes.data);
      }

      if (tiersRes.data) {
        setTiers(tiersRes.data);
        if (tiersRes.data.length > 0) {
          const firstOpen = tiersRes.data.find((t) => t.is_open);
          setSelectedTierId(firstOpen ? firstOpen.id : tiersRes.data[0].id);
        }
      }
      setLoading(false);
    };

    loadEventData();
    return () => {
      isMounted = false;
    };
  }, [eventId, activeAuthToken]);

  // Search effect with 200ms debounce
  useEffect(() => {
    if (!eventId || !activeAuthToken) return;
    let isMounted = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      const client = getApiClient(activeAuthToken);
      const { data } = await client.GET("/api/events/{event_id}/attendees", {
        params: {
          path: { event_id: eventId },
          query: { q: searchQuery, limit: 30 },
        },
      });
      if (isMounted && data) {
        setSearchResults(data);
      }
      if (isMounted) setSearching(false);
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, eventId, activeAuthToken]);

  const handleDeskLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setLoginError(null);
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError(isRtl ? "لطفاً ایمیل و کلمه عبور را وارد نمایید." : "Please enter email and password.");
      return;
    }

    setLoggingIn(true);
    const client = createApiClient({ kind: "anonymous" });
    const { data, error: err } = await client.POST("/api/events/{event_id}/desk/login", {
      params: { path: { event_id: eventId } },
      body: {
        email: loginEmail.trim().toLowerCase(),
        password: loginPassword,
      },
    });

    setLoggingIn(false);
    if (err) {
      setLoginError(formatApiError(err));
    } else if (data) {
      sessionStorage.setItem(`congress_desk_token_${eventId}`, data.access_token);
      setDeskToken(data.access_token);
      setOperatorProfile({
        operator_id: data.operator.id,
        operator_name: data.operator.operator_name,
        event_id: data.event_id,
        event_name: data.event_name,
        event_slug: data.event_slug,
        is_organizer_admin: false,
      });
      setLoginEmail("");
      setLoginPassword("");
    }
  };

  const handleDeskLogout = () => {
    if (eventId && typeof window !== "undefined") {
      sessionStorage.removeItem(`congress_desk_token_${eventId}`);
    }
    setDeskToken(null);
    setOperatorProfile(null);
    setSearchResults([]);
  };

  const handleRegisterWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !selectedTierId) return;
    setFormError(null);

    if (!fullName.trim()) {
      setFormError(isRtl ? "نام و نام خانوادگی شرکت‌کننده الزامی است." : "Attendee full name is required.");
      return;
    }

    setSubmitting(true);
    const client = getApiClient(activeAuthToken);
    const { data, error: err } = await client.POST(
      "/api/events/{event_id}/desk-registrations",
      {
        params: { path: { event_id: eventId } },
        body: {
          full_name: fullName.trim(),
          email: email.trim() || undefined,
          organization: organization.trim(),
          title: title.trim(),
          ticket_tier_id: selectedTierId,
        },
      }
    );

    setSubmitting(false);
    if (err) {
      setFormError(formatApiError(err));
    } else if (data) {
      setMintedPass(data);
      setFullName("");
      setEmail("");
      setOrganization("");
      setTitle("");
      setSearchQuery("");
    }
  };

  const handleViewAttendeeCard = async (ticketId: string) => {
    if (!eventId) return;
    const client = getApiClient(activeAuthToken);
    const { data } = await client.GET(
      "/api/events/{event_id}/attendees/{ticket_id}",
      {
        params: { path: { event_id: eventId, ticket_id: ticketId } },
      }
    );
    if (data) {
      setSelectedCard(data);
    }
  };

  const handleNextAttendee = () => {
    setMintedPass(null);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="w-64 h-8 bg-surface-panel-subtle rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-5 h-96 bg-surface-panel rounded-2xl border border-border-default" />
          <div className="lg:col-span-7 h-96 bg-surface-panel rounded-2xl border border-border-default" />
        </div>
      </div>
    );
  }

  if (!activeAuthToken) {
    return (
      <div className="max-w-md mx-auto my-10 sm:my-16">
        <Card className="border-border-default shadow-xs overflow-hidden">
          <div className="p-6 sm:p-8 space-y-6">
            <div className="space-y-2 text-center sm:text-start">
              <div className="w-12 h-12 rounded-xl bg-action-subtle text-action-primary flex items-center justify-center text-2xl mx-auto sm:mx-0 shadow-xs">
                🖨️
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {t.deskLoginTitle}
              </h1>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                {t.deskLoginSubtitle}
              </p>
            </div>

            <form onSubmit={handleDeskLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.deskLoginEmailLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="operator@example.com"
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {t.deskLoginPasswordLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
                />
              </div>

              {loginError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed"
                >
                  {loginError}
                </div>
              )}

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isFullWidth
                  disabled={loggingIn}
                >
                  {loggingIn ? "..." : t.deskLoginButton}
                </Button>
              </div>

              <div className="pt-3 border-t border-border-subtle text-center">
                <Link
                  to="/organizer"
                  className="text-xs text-action-primary hover:underline font-medium"
                >
                  {isRtl ? "← ورود با کلید مدیر ارشد" : "← Back to Organizer Console"}
                </Link>
              </div>
            </form>
          </div>
        </Card>
      </div>
    );
  }

  if (pageError) {
    return (
      <Card className="p-8 sm:p-12 text-center space-y-4 border-border-default">
        <div className="text-3xl">⚠️</div>
        <h1 className="text-xl font-bold text-text-primary">
          {pageError}
        </h1>
        <LinkButton to="/organizer" variant="secondary" size="md">
          {t.breadcrumbEvents}
        </LinkButton>
      </Card>
    );
  }
  return (
    <div className="space-y-8">
      {/* 1. Header Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-surface-panel border border-border-default shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              <Badge variant="brand" size="sm">
                {t.openDeskAction}
              </Badge>
              {operatorProfile && (
                <Badge variant="neutral" size="sm" className="bg-neutral-100 text-neutral-800 font-mono">
                  <bdi dir="ltr">/e/{operatorProfile.event_slug}</bdi>
                </Badge>
              )}
              {operatorProfile && (
                <Badge variant="success" size="sm" className="gap-1">
                  <span>👤</span>
                  <span>{operatorProfile.operator_name}</span>
                </Badge>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
              {operatorProfile?.event_name || t.deskTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary">
              {t.deskSubtitle}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-2.5">
            {deskToken && !apiKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeskLogout}
                className="text-xs text-text-muted hover:text-red-600"
              >
                {t.deskLogoutAction} ✕
              </Button>
            )}
            <LinkButton
              to={`/organizer/events/${eventId}`}
              variant="secondary"
              size="sm"
            >
              {isRtl ? "تنظیمات همایش" : "Event Settings"} {isRtl ? "←" : "→"}
            </LinkButton>
          </div>
        </div>
      </div>
      {/* 2. Operational Two-Column Split (Walk-In Form on left 5 cols, Search on right 7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Rapid Walk-In Registration */}
        <section aria-labelledby="walkin-heading" className="lg:col-span-5 p-6 sm:p-7 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-5">
          <div className="space-y-1 pb-3 border-b border-border-subtle">
            <h2 id="walkin-heading" className="text-base sm:text-lg font-bold text-text-primary flex items-center gap-2">
              <span>⚡</span>
              <span>{t.walkInRegistrationHeading}</span>
            </h2>
            <p className="text-xs text-text-secondary leading-relaxed">
              {isRtl
                ? "صدور آنی کارت ورود بدون اتلاف وقت در کمتر از چند ثانیه."
                : "Create and mint an attendee pass immediately."}
            </p>
          </div>

          <form onSubmit={handleRegisterWalkIn} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {isRtl ? "نام و نام خانوادگی شرکت‌کننده" : "Full Name"} <span className="text-red-500">*</span>
              </label>
              <input
                ref={nameInputRef}
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={isRtl ? "مثال: دکتر مهدی احمدی" : "e.g. Dr. Mahdi Ahmadi"}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {isRtl ? "آدرس ایمیل (اختیاری)" : "Email Address (Optional)"}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@institution.com"
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary font-mono"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {isRtl ? "سازمان / دانشگاه" : "Organization"}
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder={isRtl ? "دانشگاه علوم پزشکی" : "University / Hospital"}
                  className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">
                  {isRtl ? "عنوان حرفه‌ای" : "Title"}
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isRtl ? "متخصص، پژوهشگر" : "Specialist, Researcher"}
                  className="w-full px-3.5 py-2 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.tierLabel} <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedTierId}
                onChange={(e) => setSelectedTierId(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              >
                {tiers.map((tkt) => (
                  <option key={tkt.id} value={tkt.id}>
                    {tkt.name} ({t.tierQuotaTotal}: {formatLocalizedNumber(tkt.quota, locale)})
                  </option>
                ))}
              </select>
            </div>

            {formError && (
              <div role="alert" aria-live="assertive" className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">
                {formError}
              </div>
            )}

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                isFullWidth
                disabled={submitting || tiers.length === 0}
                className="shadow-xs font-bold"
              >
                {submitting ? t.mintingBadge : `${t.mintBadgeAction} →`}
              </Button>
            </div>
          </form>
        </section>

        {/* Right Column: Rapid Live Attendee Search */}
        <section aria-labelledby="search-heading" className="lg:col-span-7 p-6 sm:p-7 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-4">
          <div className="space-y-1 pb-2 border-b border-border-subtle">
            <h2 id="search-heading" className="text-base sm:text-lg font-bold text-text-primary flex items-center justify-between">
              <span>🔍 {t.searchAttendeeHeading}</span>
              {searching && (
                <span className="text-xs font-normal text-text-muted animate-pulse">
                  {isRtl ? "در حال جستجو..." : "Searching..."}
                </span>
              )}
            </h2>
            <p className="text-xs text-text-secondary">
              {isRtl
                ? "جستجوی بلادرنگ شرکت‌کنندگان از پیش ثبت‌نام‌شده جهت صدور کارت یا بررسی تاریخچه تردد."
                : "Live lookup by name or email with 200ms debounce."}
            </p>
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchAttendeePlaceholder}
              className="w-full px-4 py-2.5 bg-surface-page border border-border-default rounded-xl text-xs sm:text-sm text-text-primary placeholder:text-text-muted focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Search Results Worklist */}
          <div className="max-h-[500px] overflow-y-auto space-y-2.5 pt-1">
            {searchResults.length === 0 && searchQuery.trim() ? (
              <div className="p-8 text-center text-xs text-text-muted rounded-xl bg-surface-page border border-border-subtle">
                {t.noAttendeeFound}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted rounded-xl bg-surface-page border border-border-subtle">
                {isRtl
                  ? "برای مشاهده نتایج، نام یا ایمیل شرکت‌کننده را جستجو فرمایید."
                  : "Type a name or email to search existing attendees."}
              </div>
            ) : (
              searchResults.map((att) => (
                <div
                  key={att.ticket_id}
                  className="p-3.5 sm:p-4 rounded-xl bg-surface-page border border-border-default hover:border-border-strong transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-text-primary">
                        {att.attendee_name}
                      </span>
                      <Badge variant="neutral" size="sm">
                        {att.ticket_tier_name}
                      </Badge>
                    </div>

                    <div className="text-xs text-text-secondary flex flex-wrap gap-x-3 gap-y-0.5">
                      {att.attendee_email && (
                        <span className="font-mono text-text-muted">
                          <bdi dir="ltr">{att.attendee_email}</bdi>
                        </span>
                      )}
                      {(att.organization || att.title) && (
                        <span>
                          {att.title} {att.title && att.organization ? "•" : ""} {att.organization}
                        </span>
                      )}
                    </div>
                    {att.issued_by && (
                      <span className="text-[11px] text-text-muted block">
                        {t.issuedByLabel} <strong className="text-text-primary">{att.issued_by}</strong>
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleViewAttendeeCard(att.ticket_id)}
                      className="text-xs"
                    >
                      <span>🪪</span>
                      <span>{isRtl ? "کارت و سوابق" : "Badge & History"}</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* 3. Accessible Minted Pass Modal */}
      <Dialog
        isOpen={Boolean(mintedPass)}
        onClose={handleNextAttendee}
        title={t.ticketIssuedSuccess}
        description={isRtl ? "کارت ورود با موفقیت صادر شد. می‌توانید کارت را چاپ کرده یا به شرکت‌کننده تحویل دهید." : "Pass minted successfully."}
        size="sm"
      >
        {mintedPass && (
          <div className="text-center space-y-4 py-2">
            {/* Printable Pass Container */}
            <div className="p-4 sm:p-6 bg-white rounded-2xl border-2 border-slate-900 shadow-xs inline-block">
              <QRCode
                value={mintedPass.qr_secret}
                size={180}
                level="H"
                viewBox="0 0 256 256"
                fgColor="#0F172A"
                bgColor="#FFFFFF"
                className="w-44 h-44 select-none"
              />
            </div>

            <div className="space-y-1 text-center">
              <h3 className="text-lg font-bold text-text-primary">
                {mintedPass.attendee_name}
              </h3>
              <p className="text-xs text-text-secondary font-medium">
                {mintedPass.ticket_tier_name} • {mintedPass.organization || (isRtl ? "شرکت‌کننده آزاد" : "Independent Attendee")}
              </p>
              <span className="text-[11px] font-mono text-text-muted block pt-1">
                <bdi dir="ltr">Pass ID: #{mintedPass.ticket_id.slice(0, 8).toUpperCase()}</bdi>
              </span>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                isFullWidth
                onClick={() => window.print()}
                className="gap-2"
              >
                <span>🖨️</span>
                <span>{t.printPassAction}</span>
              </Button>

              <Button
                type="button"
                variant="primary"
                size="md"
                isFullWidth
                onClick={handleNextAttendee}
                className="gap-1.5"
              >
                <span>{t.nextAttendeeAction}</span>
                <span>{isRtl ? "←" : "→"}</span>
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* 4. Accessible Attendee Detail & History Modal */}
      <Dialog
        isOpen={Boolean(selectedCard)}
        onClose={() => setSelectedCard(null)}
        title={selectedCard?.attendee_name || ""}
        description={selectedCard?.ticket_tier_name || ""}
        size="md"
      >
        {selectedCard && (
          <div className="space-y-5 py-1">
            <div className="p-4 rounded-xl bg-surface-page border border-border-subtle space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text-muted">{isRtl ? "وضعیت بلیط:" : "Ticket Status:"}</span>
                <Badge variant={selectedCard.status === "active" ? "success" : "neutral"} size="sm">
                  {selectedCard.status === "active" ? t.ticketStatusActive : selectedCard.status}
                </Badge>
              </div>
              {selectedCard.attendee_email && (
                <div className="flex items-center justify-between font-mono">
                  <span className="text-text-muted">{isRtl ? "ایمیل:" : "Email:"}</span>
                  <bdi dir="ltr">{selectedCard.attendee_email}</bdi>
                </div>
              )}
              {selectedCard.organization && (
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{isRtl ? "سازمان:" : "Organization:"}</span>
                  <span>{selectedCard.organization}</span>
                </div>
              )}
              {selectedCard.issued_by && (
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t.issuedByLabel}</span>
                  <span className="font-semibold text-text-primary">{selectedCard.issued_by}</span>
                </div>
              )}
            </div>

            {/* Check-In Scan History */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                {isRtl ? "سوابق تردد و اسکن‌های گیت" : "Check-In Scan History"}
              </h3>
              {selectedCard.scan_history.length === 0 ? (
                <div className="p-4 rounded-xl bg-surface-page border border-border-subtle text-xs text-text-muted text-center">
                  {isRtl ? "هنوز هیچ ترددی برای این کارت ثبت نشده است." : "No gate scans recorded yet."}
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedCard.scan_history.map((scan, sIdx) => (
                    <div
                      key={`${scan.checkin_point_name}-${scan.scanned_at}-${sIdx}`}
                      className="p-3 rounded-xl bg-surface-page border border-border-subtle flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <span className="font-bold text-text-primary block">
                          {scan.checkin_point_name}
                        </span>
                        <span className="text-[11px] text-text-muted block">
                          {formatLocalizedDate(scan.scanned_at, locale)}
                        </span>
                      </div>
                      <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">
                        {scan.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                isFullWidth
                onClick={() => setSelectedCard(null)}
              >
                {isRtl ? "بستن" : "Close"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
