import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Link } from "react-router-dom";
import {
  createApiClient,
  createDeskApiClient,
  formatApiError,
  type ApiAuthority,
  type AttendeeDetailCard,
  type AttendeeSearchItem,
  type DeskMeOut,
  type DeskRegistrationOut,
  type TicketTierOut,
} from "../../api/client";
import { formatLocalizedDate, formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { Badge } from "../ui/Badge";
import { Button, LinkButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Dialog } from "../ui/Dialog";

type DeskAuthority = Extract<ApiAuthority, { kind: "desk" | "organizer" }>;
type DeskMode = "operator" | "organizer";

/** Inside Organizer administration only: lets the user deliberately act as Organizer. */
export interface OrganizerAccess {
  apiKey: string | null;
  onKeyRejected: (sentKey: string) => void;
}

export interface ReceptionStationProps {
  eventId: string;
  /** null = the independent Reception Portal: Desk credential only, no Organizer mode, no Organizer links. */
  organizer: OrganizerAccess | null;
  locale: AttendeeLocale;
  t: TranslationDictionary;
  isRtl: boolean;
}

type CardState =
  | { status: "idle" }
  | { status: "loading"; ticketId: string }
  | { status: "ready"; card: AttendeeDetailCard }
  | { status: "error"; ticketId: string; message: string };

type DuplicateState =
  | { status: "none" }
  | { status: "looking"; email: string }
  | { status: "found"; email: string; candidates: AttendeeSearchItem[] }
  | { status: "missing"; email: string }
  | { status: "failed"; email: string };

const inputClass =
  "w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary";

/** The reception work surface: search, review, walk-in issuance, print. Authority is explicit and never falls back. */
export function ReceptionStation({ eventId, organizer, locale, t, isRtl }: ReceptionStationProps) {
  const standalone = organizer === null;
  const apiKey = organizer?.apiKey ?? null;
  const onKeyRejected = organizer?.onKeyRejected;
  const ids = { name: useId(), email: useId(), org: useId(), title: useId(), tier: useId(), search: useId(), loginEmail: useId(), loginPassword: useId() };
  const nameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [deskToken, setDeskToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(`congress_desk_token_${eventId}`) : null
  );
  // The selected mode, not storage precedence, decides which credential is sent. It starts as
  // operator mode, or organizer mode when only an organizer key exists (Organizer administration
  // only), and is changed only by the user. The independent portal is always operator mode.
  const [mode, setMode] = useState<DeskMode>(() => (!standalone && !deskToken && apiKey ? "organizer" : "operator"));
  const [sessionRejected, setSessionRejected] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const authority = useMemo<DeskAuthority | null>(() => {
    if (mode === "organizer") return apiKey ? { kind: "organizer", token: apiKey } : null;
    return deskToken ? { kind: "desk", token: deskToken, eventId } : null;
  }, [mode, apiKey, deskToken, eventId]);
  const signature = authority ? `${authority.kind}:${authority.token}` : "";
  const signatureRef = useRef(signature);
  useEffect(() => {
    signatureRef.current = signature;
  }, [signature]);

  const [operatorProfile, setOperatorProfile] = useState<DeskMeOut | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Walk-in draft: in memory only, kept across recoverable failures and re-authentication.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [title, setTitle] = useState("");
  const [selectedTierId, setSelectedTierId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateState>({ status: "none" });
  const [mintedPass, setMintedPass] = useState<DeskRegistrationOut | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AttendeeSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);
  const [review, setReview] = useState<CardState>({ status: "idle" });
  const reviewRequest = useRef(0);

  const hasDraft = Boolean(fullName.trim() || email.trim() || organization.trim() || title.trim());

  // 401 invalidates only the exact credential that was sent; a newer session or the other mode's
  // credential is never touched. 403/404/5xx/network failures never reach this function.
  const rejectAuthority = useCallback(
    (sent: DeskAuthority) => {
      if (sent.kind === "organizer") {
        onKeyRejected?.(sent.token);
        return;
      }
      const storageKey = `congress_desk_token_${eventId}`;
      if (sessionStorage.getItem(storageKey) !== sent.token) return;
      sessionStorage.removeItem(storageKey);
      setDeskToken((current) => (current === sent.token ? null : current));
      // Retrieved attendee data and QR codes are hidden on authority loss; the typed draft is kept.
      setOperatorProfile(null);
      setSearchResults([]);
      setReview({ status: "idle" });
      setMintedPass(null);
      setDuplicate({ status: "none" });
      setSessionRejected(true);
    },
    [eventId, onKeyRejected]
  );

  useEffect(() => {
    let isMounted = true;
    // Without the selected mode's credential nothing is dispatched; an entry gate is shown instead.
    if (!authority) {
      setLoading(false);
      return;
    }
    const loadEventData = async () => {
      setLoading(true);
      setPageError(null);
      try {
        const client = createDeskApiClient(authority, eventId);
        const [meRes, tiersRes] = await Promise.all([
          client.GET("/api/events/{event_id}/desk/me", { params: { path: { event_id: eventId } } }),
          client.GET("/api/events/{event_id}/desk/tiers", { params: { path: { event_id: eventId } } }),
        ]);
        const unauthorized = meRes.response.status === 401 || tiersRes.response.status === 401;
        if (unauthorized) rejectAuthority(authority);
        if (!isMounted || unauthorized) return;
        if (meRes.error) {
          setPageError(formatApiError(meRes.error));
        } else if (meRes.data) {
          setOperatorProfile(meRes.data);
        }
        if (tiersRes.data) {
          setTiers(tiersRes.data);
          if (tiersRes.data.length > 0) {
            const firstOpen = tiersRes.data.find((tier) => tier.is_open);
            setSelectedTierId((current) => current || (firstOpen ? firstOpen.id : tiersRes.data[0].id));
          }
        }
      } catch {
        if (isMounted) setPageError(isRtl ? "خطای شبکه. اتصال را بررسی و دوباره تلاش کنید." : "Network error. Please check the connection and retry.");
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void loadEventData();
    return () => {
      isMounted = false;
    };
  }, [eventId, authority, reloadNonce, rejectAuthority, isRtl]);

  // Debounced event-scoped search; a response for an older query, session or event is dropped.
  useEffect(() => {
    if (!authority) return;
    let isMounted = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const client = createDeskApiClient(authority, eventId);
        const { data, response } = await client.GET("/api/events/{event_id}/attendees", {
          params: { path: { event_id: eventId }, query: { q: searchQuery, limit: 30 } },
        });
        if (response.status === 401) rejectAuthority(authority);
        if (isMounted) {
          if (data) {
            setSearchResults(data);
            setSearchFailed(false);
          } else if (response.status !== 401) {
            setSearchFailed(true);
          }
        }
      } catch {
        // A failed search keeps the previous results and says so; credentials are untouched.
        if (isMounted) setSearchFailed(true);
      }
      if (isMounted) setSearching(false);
    }, 200);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, eventId, authority, rejectAuthority, searchNonce]);

  // "/" jumps to search from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (review.status === "ready") reviewHeadingRef.current?.focus();
  }, [review.status]);

  const handleDeskLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loggingIn) return;
    setLoginError(null);
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError(isRtl ? "لطفاً ایمیل و کلمه عبور را وارد نمایید." : "Please enter email and password.");
      return;
    }
    setLoggingIn(true);
    try {
      const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/events/{event_id}/desk/login", {
        params: { path: { event_id: eventId } },
        body: { email: loginEmail.trim().toLowerCase(), password: loginPassword },
      });
      if (data) {
        sessionStorage.setItem(`congress_desk_token_${eventId}`, data.access_token);
        setDeskToken(data.access_token);
        setMode("operator");
        if (sessionRejected && hasDraft) setDraftRecovered(true);
        setSessionRejected(false);
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
      } else if (response.status === 401) {
        setLoginError(isRtl ? "ایمیل یا کلمه عبور نادرست است." : "Invalid email or password");
      } else if (response.status === 403) {
        setLoginError(isRtl ? "این حساب به میز پذیرش این همایش اختصاص ندارد یا دسترسی آن لغو شده است." : "This account is not assigned to this congress's reception, or its access was revoked.");
      } else if (response.status === 404) {
        setLoginError(isRtl ? "همایش پیدا نشد." : "Congress not found.");
      } else {
        setLoginError(isRtl ? "ورود اکنون ممکن نیست. کمی بعد دوباره تلاش کنید." : "Sign-in is unavailable right now. Please try again shortly.");
      }
    } catch {
      setLoginError(isRtl ? "اتصال برقرار نشد. اینترنت را بررسی و دوباره تلاش کنید." : "Could not reach the server. Check the connection and try again.");
    }
    setLoggingIn(false);
  };

  const clearWorkspace = () => {
    setFullName("");
    setEmail("");
    setOrganization("");
    setTitle("");
    setFormError(null);
    setDraftRecovered(false);
    setDuplicate({ status: "none" });
    setSearchQuery("");
    setSearchResults([]);
    setReview({ status: "idle" });
    setMintedPass(null);
  };

  const handleDeskLogout = () => {
    sessionStorage.removeItem(`congress_desk_token_${eventId}`);
    setDeskToken(null);
    setOperatorProfile(null);
    setSessionRejected(false);
    clearWorkspace();
  };

  const handleRegisterWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTierId || !authority || submittingRef.current) return;
    setFormError(null);
    setDuplicate({ status: "none" });
    if (!fullName.trim()) {
      setFormError(isRtl ? "نام و نام خانوادگی شرکت‌کننده الزامی است." : "Attendee full name is required.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const sent = authority;
    const sentEmail = email.trim().toLowerCase();
    try {
      const client = createDeskApiClient(sent, eventId);
      const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk-registrations", {
        params: { path: { event_id: eventId } },
        body: {
          full_name: fullName.trim(),
          email: email.trim() || undefined,
          organization: organization.trim(),
          title: title.trim(),
          ticket_tier_id: selectedTierId,
        },
      });
      if (response.status === 401) rejectAuthority(sent);
      if (signatureRef.current !== `${sent.kind}:${sent.token}` && response.status !== 401) return;
      if (err) {
        if (response.status === 401) return;
        setFormError(formatApiError(err));
        if (response.status === 409 && sentEmail) void lookupDuplicate(sent, sentEmail);
      } else if (data) {
        // Only a backend-confirmed issuance is presented as success.
        setMintedPass(data);
        setFullName("");
        setEmail("");
        setOrganization("");
        setTitle("");
        setSearchQuery("");
        setDraftRecovered(false);
        setSearchNonce((n) => n + 1);
      }
    } catch {
      setFormError(
        isRtl
          ? "اتصال قطع شد؛ مشخص نیست کارت صادر شده یا نه. پیش از تلاش دوباره، نام را در جستجو بررسی کنید. اطلاعات واردشده حفظ شده است."
          : "The connection dropped, so it is not known whether the pass was issued. Search for this attendee before trying again. Your entry is kept."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // 409 recovery: offer the existing ticket only for an exact normalized email match; never auto-select or resubmit.
  const lookupDuplicate = async (sent: DeskAuthority, normalizedEmail: string) => {
    setDuplicate({ status: "looking", email: normalizedEmail });
    try {
      const { data, response } = await createDeskApiClient(sent, eventId).GET("/api/events/{event_id}/attendees", {
        params: { path: { event_id: eventId }, query: { q: normalizedEmail, limit: 30 } },
      });
      if (response.status === 401) {
        rejectAuthority(sent);
        return;
      }
      if (signatureRef.current !== `${sent.kind}:${sent.token}`) return;
      if (!data) {
        setDuplicate({ status: "failed", email: normalizedEmail });
        return;
      }
      const exact = data.filter((a) => a.attendee_email.trim().toLowerCase() === normalizedEmail);
      setDuplicate(exact.length > 0 ? { status: "found", email: normalizedEmail, candidates: exact } : { status: "missing", email: normalizedEmail });
    } catch {
      setDuplicate({ status: "failed", email: normalizedEmail });
    }
  };

  const openReview = async (ticketId: string) => {
    if (!authority) return;
    const sent = authority;
    const requestId = ++reviewRequest.current;
    setReview({ status: "loading", ticketId });
    try {
      const { data, response } = await createDeskApiClient(sent, eventId).GET("/api/events/{event_id}/attendees/{ticket_id}", {
        params: { path: { event_id: eventId, ticket_id: ticketId } },
      });
      if (response.status === 401) {
        rejectAuthority(sent);
        return;
      }
      // A card for another request, mode or session is never shown.
      if (requestId !== reviewRequest.current || signatureRef.current !== `${sent.kind}:${sent.token}`) return;
      if (data) {
        setReview({ status: "ready", card: data });
      } else {
        const message =
          response.status === 404
            ? isRtl ? "این کارت در این همایش پیدا نشد." : "This ticket was not found in this congress."
            : response.status === 403
              ? isRtl ? "دسترسی شما به این همایش مجاز نیست." : "You are not authorized for this congress."
              : isRtl ? "بارگذاری کارت انجام نشد. دوباره تلاش کنید." : "The ticket could not be loaded. Please try again.";
        setReview({ status: "error", ticketId, message });
      }
    } catch {
      if (requestId === reviewRequest.current) {
        setReview({
          status: "error",
          ticketId,
          message: isRtl ? "اتصال برقرار نشد. دوباره تلاش کنید." : "Could not reach the server. Please try again.",
        });
      }
    }
  };

  const closeReview = () => {
    reviewRequest.current++;
    setReview({ status: "idle" });
    searchInputRef.current?.focus();
  };

  const handleNextAttendee = () => {
    setMintedPass(null);
    reviewRequest.current++;
    setReview({ status: "idle" });
    setSearchQuery("");
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const registerFromSearch = () => {
    const q = searchQuery.trim();
    if (q.includes("@")) setEmail(q);
    else setFullName(q);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  const selectMode = (next: DeskMode) => {
    if (next === mode) return;
    setMode(next);
    setSearchResults([]);
    setReview({ status: "idle" });
    setOperatorProfile(null);
    setPageError(null);
  };

  // Only offered inside Organizer administration with an organizer key; the choice is explicit.
  const modeSwitch =
    !standalone && apiKey ? (
      <div role="group" aria-label={isRtl ? "حالت کاری" : "Working mode"} className="flex flex-wrap items-center gap-1.5">
        <span data-testid="desk-active-mode" className="text-[11px] text-text-muted me-1">
          {mode === "operator"
            ? isRtl ? "فعال: نشست اپراتور" : "Acting as: reception operator"
            : isRtl ? "فعال: حالت مدیر" : "Acting as: organizer"}
        </span>
        <Button type="button" size="sm" variant={mode === "operator" ? "primary" : "secondary"} aria-pressed={mode === "operator"} disabled={submitting} onClick={() => selectMode("operator")}>
          {isRtl ? "نشست اپراتور" : "Operator session"}
        </Button>
        <Button type="button" size="sm" variant={mode === "organizer" ? "primary" : "secondary"} aria-pressed={mode === "organizer"} disabled={submitting} onClick={() => selectMode("organizer")}>
          {isRtl ? "حالت مدیر" : "Organizer mode"}
        </Button>
      </div>
    ) : null;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" role="status" aria-label={t.deskTitle}>
        <div className="w-64 h-8 bg-surface-panel-subtle rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 h-96 bg-surface-panel rounded-2xl border border-border-default" />
          <div className="lg:col-span-5 h-96 bg-surface-panel rounded-2xl border border-border-default" />
        </div>
      </div>
    );
  }

  if (mode === "organizer" && !apiKey) {
    return (
      <Card className="max-w-md mx-auto my-10 sm:my-16 p-8 text-center space-y-4 border-border-default">
        <div className="text-3xl">🔑</div>
        <h1 className="text-xl font-bold text-text-primary">{isRtl ? "برای حالت مدیر به کلید سازمان نیاز است" : "Organizer mode needs your organizer key"}</h1>
        <div className="flex flex-col gap-2">
          <LinkButton to="/organizer" variant="primary" size="md">{isRtl ? "ورود با کلید سازمان" : "Enter organizer key"}</LinkButton>
          <Button type="button" variant="secondary" size="md" onClick={() => selectMode("operator")}>
            {isRtl ? "استفاده از نشست اپراتور" : "Use an operator session"}
          </Button>
        </div>
      </Card>
    );
  }

  if (!authority) {
    return (
      <div className="max-w-md mx-auto my-6 sm:my-14">
        <Card className="border-border-default shadow-xs overflow-hidden">
          <div className="p-6 sm:p-8 space-y-6">
            {modeSwitch}
            <div className="space-y-2 text-center sm:text-start">
              <div className="w-12 h-12 rounded-xl bg-action-subtle text-action-primary flex items-center justify-center text-2xl mx-auto sm:mx-0 shadow-xs">🖨️</div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">{t.deskLoginTitle}</h1>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">{t.deskLoginSubtitle}</p>
            </div>

            {(loginError || sessionRejected) && (
              <div role="alert" aria-live="assertive" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">
                {loginError ?? (isRtl ? "دسترسی اپراتور لغو شده یا نشست کاری منقضی گردیده است." : "Operator access revoked or session expired.")}
                {!loginError && hasDraft && (
                  <span className="block mt-1">
                    {isRtl ? "اطلاعات واردشده برای ثبت حضوری حفظ شده و پس از ورود خودکار ارسال نمی‌شود." : "Your unsent walk-in entry is kept and is not submitted automatically after you sign in."}
                  </span>
                )}
              </div>
            )}

            <form onSubmit={handleDeskLogin} className="space-y-4">
              <div>
                <label htmlFor={ids.loginEmail} className="block text-sm font-semibold text-text-primary mb-1">
                  {t.deskLoginEmailLabel} <span className="text-red-500">*</span>
                </label>
                <input id={ids.loginEmail} type="email" required autoComplete="username" inputMode="email" dir="ltr" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="operator@example.com" className={`${inputClass} font-mono min-h-[48px]`} />
              </div>
              <div>
                <label htmlFor={ids.loginPassword} className="block text-sm font-semibold text-text-primary mb-1">
                  {t.deskLoginPasswordLabel} <span className="text-red-500">*</span>
                </label>
                <input id={ids.loginPassword} type="password" required autoComplete="current-password" dir="ltr" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" className={`${inputClass} font-mono min-h-[48px]`} />
              </div>
              <Button type="submit" variant="primary" size="lg" isFullWidth disabled={loggingIn} aria-busy={loggingIn}>
                {loggingIn ? "..." : t.deskLoginButton}
              </Button>
              {!standalone && (
                <div className="pt-3 border-t border-border-subtle text-center">
                  <Link to="/organizer" className="text-xs text-action-primary hover:underline font-medium">{isRtl ? "← ورود با کلید مدیر ارشد" : "← Back to Organizer Console"}</Link>
                </div>
              )}
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
        <h1 className="text-xl font-bold text-text-primary">{pageError}</h1>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
          <Button type="button" variant="primary" size="md" onClick={() => setReloadNonce((n) => n + 1)}>
            {isRtl ? "تلاش مجدد" : "Retry"}
          </Button>
          {!standalone && <LinkButton to="/organizer" variant="secondary" size="md">{t.breadcrumbEvents}</LinkButton>}
        </div>
      </Card>
    );
  }

  const passBlock = (pass: { qr: string; name: string; tier: string; org: string; ticketId: string }) => (
    <div className="print-pass text-center space-y-3">
      <div className="p-4 bg-white rounded-2xl border-2 border-slate-900 shadow-xs inline-block">
        <QRCode value={pass.qr} size={176} level="H" viewBox="0 0 256 256" fgColor="#0F172A" bgColor="#FFFFFF" className="w-44 h-44 select-none" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-bold text-text-primary">{pass.name}</h3>
        <p className="text-xs text-text-secondary font-medium">
          {pass.tier} • {pass.org || (isRtl ? "شرکت‌کننده آزاد" : "Independent Attendee")}
        </p>
        <span className="text-[11px] font-mono text-text-muted block pt-1">
          <bdi dir="ltr">Pass ID: #{pass.ticketId.slice(0, 8).toUpperCase()}</bdi>
        </span>
      </div>
    </div>
  );

  const trimmedQuery = searchQuery.trim();

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Event and operator context */}
      <div className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
              <Badge variant="brand" size="sm">{t.openDeskAction}</Badge>
              {operatorProfile && (
                <Badge variant="neutral" size="sm" className="font-mono">
                  <bdi dir="ltr">/e/{operatorProfile.event_slug}</bdi>
                </Badge>
              )}
              {operatorProfile && (
                <Badge variant="success" size="sm" className="gap-1" data-testid="reception-operator">
                  <span aria-hidden="true">👤</span>
                  <span>{operatorProfile.operator_name}</span>
                </Badge>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary break-words" data-testid="reception-event">
              {operatorProfile?.event_name || t.deskTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary">{t.deskSubtitle}</p>
          </div>
          <div className="shrink-0 flex flex-wrap items-center gap-2.5">
            {modeSwitch}
            {mode === "operator" && deskToken && (
              <Button type="button" variant="ghost" size="sm" onClick={handleDeskLogout} className="text-xs text-text-muted hover:text-red-600">
                {t.deskLogoutAction} ✕
              </Button>
            )}
            {!standalone && (
              <LinkButton to={`/organizer/events/${eventId}`} variant="secondary" size="sm">
                {isRtl ? "تنظیمات همایش" : "Event Settings"} {isRtl ? "←" : "→"}
              </LinkButton>
            )}
          </div>
        </div>
      </div>

      {draftRecovered && (
        <div role="status" className="p-3.5 rounded-xl bg-status-info-bg text-status-info-text border border-status-info-border text-xs leading-relaxed flex items-start justify-between gap-3">
          <span>{isRtl ? "ورود مجدد انجام شد. اطلاعات ثبت حضوری حفظ شده است؛ تا زمانی که خودتان ارسال نکنید چیزی ثبت نمی‌شود." : "Signed in again. Your walk-in entry was kept; nothing is submitted until you press the button."}</span>
          <button type="button" onClick={() => setDraftRecovered(false)} aria-label={isRtl ? "بستن پیام" : "Dismiss message"} className="shrink-0 min-h-[24px] min-w-[24px] font-bold cursor-pointer">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Search → review */}
        <div className="lg:col-span-7 space-y-6 min-w-0">
          <section aria-labelledby="search-heading" className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="search-heading" className="text-base sm:text-lg font-bold text-text-primary">🔍 {t.searchAttendeeHeading}</h2>
              {searching && <span className="text-xs text-text-muted animate-pulse" role="status">{isRtl ? "در حال جستجو..." : "Searching..."}</span>}
            </div>

            <div className="relative">
              <label htmlFor={ids.search} className="sr-only">{t.searchAttendeeHeading}</label>
              <input
                id={ids.search}
                ref={searchInputRef}
                type="search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchQuery("");
                }}
                placeholder={t.searchAttendeePlaceholder}
                className="w-full ps-4 pe-10 py-3.5 min-h-[52px] [&::-webkit-search-cancel-button]:appearance-none bg-surface-page border border-border-default rounded-xl text-base text-text-primary placeholder:text-text-muted focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
              {searchQuery && (
                <button type="button" onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }} aria-label={isRtl ? "پاک کردن جستجو" : "Clear search"} className="absolute end-2 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] text-text-muted hover:text-text-primary cursor-pointer">✕</button>
              )}
            </div>
            <p className="text-[11px] text-text-muted">{isRtl ? "برای رفتن به جستجو کلید / را بزنید." : "Press / to jump to search."}</p>

            {searchFailed && (
              <div role="alert" className="p-3 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs flex items-center justify-between gap-3">
                <span>{isRtl ? "جستجو انجام نشد؛ نتایج زیر ممکن است قدیمی باشند." : "Search failed; the list below may be out of date."}</span>
                <Button type="button" size="sm" variant="secondary" onClick={() => { setSearchFailed(false); setSearchNonce((n) => n + 1); }}>
                  {isRtl ? "تلاش مجدد" : "Retry"}
                </Button>
              </div>
            )}

            <div className="max-h-[420px] overflow-y-auto space-y-2.5" aria-live="polite">
              {searchResults.length === 0 && trimmedQuery ? (
                <div className="p-6 text-center text-sm text-text-muted rounded-xl bg-surface-page border border-border-subtle space-y-3">
                  <p>{t.noAttendeeFound}</p>
                  <Button type="button" variant="secondary" size="md" onClick={registerFromSearch}>
                    {isRtl ? `ثبت «${trimmedQuery}» به‌عنوان ثبت حضوری` : `Register “${trimmedQuery}” as walk-in`}
                  </Button>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="p-6 text-center text-sm text-text-muted rounded-xl bg-surface-page border border-border-subtle">
                  {isRtl ? "نام یا ایمیل شرکت‌کننده را جستجو کنید." : "Type a name or email to find an attendee."}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {searchResults.map((att) => (
                    <li key={att.ticket_id}>
                      <button
                        type="button"
                        onClick={() => void openReview(att.ticket_id)}
                        aria-label={isRtl ? `بررسی ${att.attendee_name}` : `Review ${att.attendee_name}`}
                        className={`w-full text-start p-3.5 sm:p-4 rounded-xl border transition-colors flex items-start justify-between gap-3 cursor-pointer min-h-[64px] focus-visible:outline-2 focus-visible:outline-focus-ring ${
                          review.status !== "idle" && (review.status === "ready" ? review.card.ticket_id : review.ticketId) === att.ticket_id
                            ? "bg-action-subtle border-action-primary"
                            : "bg-surface-page border-border-default hover:border-border-strong"
                        }`}
                      >
                        <span className="space-y-1 min-w-0">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm sm:text-base text-text-primary break-words">{att.attendee_name}</span>
                            <Badge variant="neutral" size="sm">{att.ticket_tier_name}</Badge>
                          </span>
                          <span className="block text-xs text-text-secondary">
                            {att.attendee_email && <bdi dir="ltr" className="font-mono">{att.attendee_email}</bdi>}
                            {(att.organization || att.title) && <span className="block">{[att.title, att.organization].filter(Boolean).join(" • ")}</span>}
                          </span>
                        </span>
                        <span className="shrink-0 flex flex-col items-end gap-1">
                          <Badge variant={att.status === "active" ? "success" : "danger"} size="sm">
                            {att.status === "active" ? t.ticketStatusActive : att.status}
                          </Badge>
                          <span className="text-[11px] text-text-muted">
                            {isRtl ? "تردد:" : "Check-ins:"} {formatLocalizedNumber(att.checkin_count, locale)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {review.status !== "idle" && (
            <section aria-labelledby="review-heading" className="p-5 sm:p-6 rounded-2xl bg-surface-panel border-2 border-action-primary shadow-xs space-y-5" aria-live="polite">
              {review.status === "loading" && <p role="status" className="text-sm text-text-muted animate-pulse">{isRtl ? "در حال بارگذاری کارت..." : "Loading pass..."}</p>}
              {review.status === "error" && (
                <div role="alert" className="space-y-3">
                  <h2 id="review-heading" className="text-base font-bold text-status-danger-text">{review.message}</h2>
                  <div className="flex gap-2">
                    <Button type="button" variant="primary" size="md" onClick={() => void openReview(review.ticketId)}>{isRtl ? "تلاش مجدد" : "Retry"}</Button>
                    <Button type="button" variant="secondary" size="md" onClick={closeReview}>{isRtl ? "بستن" : "Close"}</Button>
                  </div>
                </div>
              )}
              {review.status === "ready" && (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id="review-heading" ref={reviewHeadingRef} tabIndex={-1} className="text-xl font-extrabold text-text-primary break-words focus:outline-none">{review.card.attendee_name}</h2>
                      <p className="text-xs text-text-secondary">{review.card.ticket_tier_name}</p>
                    </div>
                    <Badge variant={review.card.status === "active" ? "success" : "danger"} size="md">
                      {review.card.status === "active" ? t.ticketStatusActive : review.card.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
                    {passBlock({ qr: review.card.qr_secret, name: review.card.attendee_name, tier: review.card.ticket_tier_name, org: review.card.organization, ticketId: review.card.ticket_id })}
                    <div className="space-y-4">
                      <dl className="p-4 rounded-xl bg-surface-page border border-border-subtle space-y-1.5 text-xs">
                        {review.card.attendee_email && (
                          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">{isRtl ? "ایمیل:" : "Email:"}</dt><dd className="font-mono"><bdi dir="ltr">{review.card.attendee_email}</bdi></dd></div>
                        )}
                        {review.card.organization && (
                          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">{isRtl ? "سازمان:" : "Organization:"}</dt><dd>{review.card.organization}</dd></div>
                        )}
                        {review.card.issued_by && (
                          <div className="flex items-center justify-between gap-3"><dt className="text-text-muted">{t.issuedByLabel}</dt><dd className="font-semibold text-text-primary">{review.card.issued_by}</dd></div>
                        )}
                      </dl>
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">{isRtl ? "سوابق تردد و اسکن‌های گیت" : "Check-In Scan History"}</h3>
                        {review.card.scan_history.length === 0 ? (
                          <p className="p-3 rounded-xl bg-surface-page border border-border-subtle text-xs text-text-muted text-center">{isRtl ? "هنوز هیچ ترددی برای این کارت ثبت نشده است." : "No gate scans recorded yet."}</p>
                        ) : (
                          <ul className="space-y-2 max-h-40 overflow-y-auto">
                            {review.card.scan_history.map((scan, i) => (
                              <li key={`${scan.checkin_point_name}-${scan.scanned_at}-${i}`} className="p-2.5 rounded-xl bg-surface-page border border-border-subtle flex items-center justify-between gap-2 text-xs">
                                <span>
                                  <span className="font-bold text-text-primary block">{scan.checkin_point_name}</span>
                                  <span className="text-[11px] text-text-muted">{formatLocalizedDate(scan.scanned_at, locale)}</span>
                                </span>
                                <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">{scan.status}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-1 print:hidden">
                    <Button type="button" variant="secondary" size="lg" className="gap-2 flex-1" onClick={() => window.print()}>
                      <span aria-hidden="true">🖨️</span><span>{t.printPassAction}</span>
                    </Button>
                    <Button type="button" variant="primary" size="lg" className="gap-2 flex-1" onClick={handleNextAttendee}>
                      <span>{t.nextAttendeeAction}</span><span aria-hidden="true">{isRtl ? "←" : "→"}</span>
                    </Button>
                  </div>
                  <p className="text-[11px] text-text-muted">
                    {isRtl ? "چاپ از مرورگر انجام می‌شود و کارت جدیدی صادر نمی‌کند. ورود به همایش را همچنان اسکنر گیت ثبت می‌کند." : "Printing uses the browser and issues nothing new. Admission is still recorded by the gate scanner."}
                  </p>
                </>
              )}
            </section>
          )}
        </div>

        {/* Walk-in registration */}
        <section aria-labelledby="walkin-heading" className="lg:col-span-5 p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs space-y-5">
          <div className="space-y-1 pb-3 border-b border-border-subtle">
            <h2 id="walkin-heading" className="text-base sm:text-lg font-bold text-text-primary flex items-center gap-2"><span aria-hidden="true">⚡</span><span>{t.walkInRegistrationHeading}</span></h2>
            <p className="text-xs text-text-secondary leading-relaxed">{isRtl ? "صدور آنی کارت ورود برای کسی که هنوز ثبت‌نام نکرده است." : "Issue a pass for someone who has not registered yet."}</p>
          </div>

          <form onSubmit={handleRegisterWalkIn} className="space-y-3.5" noValidate>
            <div>
              <label htmlFor={ids.name} className="block text-xs font-semibold text-text-primary mb-1">{isRtl ? "نام و نام خانوادگی شرکت‌کننده" : "Full Name"} <span className="text-red-500">*</span></label>
              <input id={ids.name} ref={nameInputRef} type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={isRtl ? "مثال: دکتر مهدی احمدی" : "e.g. Dr. Mahdi Ahmadi"} className={inputClass} />
            </div>
            <div>
              <label htmlFor={ids.email} className="block text-xs font-semibold text-text-primary mb-1">{isRtl ? "آدرس ایمیل (اختیاری)" : "Email Address (Optional)"}</label>
              <input id={ids.email} type="email" dir="ltr" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@institution.com" className={`${inputClass} font-mono`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={ids.org} className="block text-xs font-semibold text-text-primary mb-1">{isRtl ? "سازمان / دانشگاه" : "Organization"}</label>
                <input id={ids.org} type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder={isRtl ? "دانشگاه علوم پزشکی" : "University / Hospital"} className={inputClass} />
              </div>
              <div>
                <label htmlFor={ids.title} className="block text-xs font-semibold text-text-primary mb-1">{isRtl ? "عنوان حرفه‌ای" : "Title"}</label>
                <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isRtl ? "متخصص، پژوهشگر" : "Specialist, Researcher"} className={inputClass} />
              </div>
            </div>
            <div>
              <label htmlFor={ids.tier} className="block text-xs font-semibold text-text-primary mb-1">{t.tierLabel} <span className="text-red-500">*</span></label>
              <select id={ids.tier} value={selectedTierId} onChange={(e) => setSelectedTierId(e.target.value)} className={`${inputClass} min-h-[44px]`}>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({t.tierQuotaTotal}: {formatLocalizedNumber(tier.quota, locale)})
                  </option>
                ))}
              </select>
              {tiers.length === 0 && <p className="mt-1.5 text-xs text-text-muted">{isRtl ? "هنوز رده بلیطی برای این همایش تعریف نشده است." : "No ticket tier is defined for this congress yet."}</p>}
            </div>

            {formError && (
              <div role="alert" aria-live="assertive" className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">{formError}</div>
            )}

            {duplicate.status !== "none" && (
              <div role="status" className="p-3.5 rounded-xl bg-status-warning-bg text-status-warning-text border border-status-warning-border text-xs leading-relaxed space-y-2">
                {duplicate.status === "looking" && <p>{isRtl ? "در حال جستجوی کارت موجود..." : "Looking for the existing pass..."}</p>}
                {duplicate.status === "failed" && <p>{isRtl ? "کارت موجود پیدا نشد (خطای جستجو). با جستجوی دستی بررسی کنید." : "The existing pass could not be looked up. Check with the search box."}</p>}
                {duplicate.status === "missing" && <p>{isRtl ? "کارت دقیقاً مطابق این ایمیل پیدا نشد. با جستجوی دستی بررسی کنید." : "No pass with exactly this email was found. Check with the search box."}</p>}
                {duplicate.status === "found" && (
                  <>
                    <p>{isRtl ? "این ایمیل قبلاً کارت دارد. برای بررسی کارت موجود، آن را انتخاب کنید:" : "This email already has a pass. Choose it to review the existing pass:"}</p>
                    {duplicate.candidates.map((c) => (
                      <Button key={c.ticket_id} type="button" variant="secondary" size="md" isFullWidth onClick={() => void openReview(c.ticket_id)}>
                        {isRtl ? `بررسی کارت ${c.attendee_name}` : `Review existing pass: ${c.attendee_name}`}
                      </Button>
                    ))}
                  </>
                )}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting || tiers.length === 0} aria-busy={submitting} className="shadow-xs font-bold">
              {submitting ? t.mintingBadge : `${t.mintBadgeAction} →`}
            </Button>
          </form>
        </section>
      </div>

      {/* Backend-confirmed issuance */}
      <Dialog isOpen={Boolean(mintedPass)} onClose={handleNextAttendee} title={t.ticketIssuedSuccess} description={isRtl ? "کارت ورود با موفقیت صادر شد. می‌توانید کارت را چاپ کرده یا به شرکت‌کننده تحویل دهید." : "Pass minted successfully."} size="sm">
        {mintedPass && (
          <div className="space-y-4 py-2">
            {passBlock({ qr: mintedPass.qr_secret, name: mintedPass.attendee_name, tier: mintedPass.ticket_tier_name, org: mintedPass.organization, ticketId: mintedPass.ticket_id })}
            <div className="pt-2 flex flex-col gap-2 print:hidden">
              <Button type="button" variant="secondary" size="md" isFullWidth onClick={() => window.print()} className="gap-2">
                <span aria-hidden="true">🖨️</span><span>{t.printPassAction}</span>
              </Button>
              <Button type="button" variant="primary" size="md" isFullWidth onClick={handleNextAttendee} className="gap-1.5">
                <span>{t.nextAttendeeAction}</span><span aria-hidden="true">{isRtl ? "←" : "→"}</span>
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
