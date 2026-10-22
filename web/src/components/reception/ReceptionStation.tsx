import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { eventAccentStyle } from "../../lib/eventAccent";
import { formatMobile, mobileSearchDigits, normalizeIranMobile } from "../../lib/mobile";
import { MobileOtpForm } from "../auth/MobileOtpForm";
import { formatLocalizedDate, formatLocalizedNumber, type AttendeeLocale, type TranslationDictionary } from "../../lib/i18n";
import { ArcMotif } from "../brand/Aiteb";
import { CongressSignature } from "../brand/CongressSignature";
import { Badge } from "../ui/Badge";
import { Button, LinkButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { ModeSwitch, type DeskMode } from "./ModeSwitch";
import { Kbd, ReceptionPass, TicketStatusChip } from "./ReceptionPass";
import { ResendPassSms, type ResendOutcome } from "./ResendPassSms";
import "../../styles/reception.css";

type DeskAuthority = Extract<ApiAuthority, { kind: "desk" | "organizer" }>;

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
  | { status: "looking"; mobile: string }
  | { status: "found"; mobile: string; candidates: AttendeeSearchItem[] }
  | { status: "missing"; mobile: string }
  | { status: "failed"; mobile: string };

/** The reception work surface: search, review, walk-in issuance, print. Authority is explicit and never falls back. */
export function ReceptionStation({ eventId, organizer, locale, t, isRtl }: ReceptionStationProps) {
  const standalone = organizer === null;
  const apiKey = organizer?.apiKey ?? null;
  const onKeyRejected = organizer?.onKeyRejected;
  const ids = { name: useId(), mobile: useId(), org: useId(), title: useId(), tier: useId(), search: useId() };
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

  // Walk-in draft: in memory only, kept across recoverable failures and re-authentication.
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
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

  const hasDraft = Boolean(fullName.trim() || mobile.trim() || organization.trim() || title.trim());

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
    // Without the selected mode's credential nothing is dispatched; an entry gate is shown instead
    // (the loading skeleton is gated on `authority` during render, so no reset is needed here).
    if (!authority) return;
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

  // Desk sign-in: the operator's mobile number and SMS code (purpose "desk"); returns the message to show, or null.
  const verifyDeskCode = async (operatorMobile: string, code: string): Promise<string | null> => {
    const { data, response } = await createApiClient({ kind: "anonymous" }).POST("/api/events/{event_id}/desk/login", {
      params: { path: { event_id: eventId } },
      body: { mobile: operatorMobile, code },
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
      return null;
    }
    if (response.status === 401 || response.status === 422) {
      return isRtl
        ? "کد نادرست است یا منقضی شده. اگر پیامکی نرسید، این شماره اپراتور فعال پذیرش نیست."
        : "The code is wrong or has expired. If no SMS arrived, this number is not an active reception operator.";
    }
    if (response.status === 403) {
      return isRtl ? "این شماره به میز پذیرش این همایش اختصاص ندارد یا دسترسی آن لغو شده است." : "This number is not assigned to this congress's reception, or its access was revoked.";
    }
    if (response.status === 404) return isRtl ? "همایش پیدا نشد." : "Congress not found.";
    if (response.status === 429) return isRtl ? "تلاش‌های زیادی انجام شد. کمی بعد دوباره تلاش کنید." : "Too many attempts. Please try again shortly.";
    return isRtl ? "ورود اکنون ممکن نیست. کمی بعد دوباره تلاش کنید." : "Sign-in is unavailable right now. Please try again shortly.";
  };

  const clearWorkspace = () => {
    setFullName("");
    setMobile("");
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
    const sentMobile = mobile.trim() ? normalizeIranMobile(mobile) : null;
    if (mobile.trim() && !sentMobile) {
      setFormError(isRtl ? "شماره موبایل معتبر نیست؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹، یا آن را خالی بگذارید." : "The mobile number is not valid (e.g. 0912 345 6789); correct it or leave it empty.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const sent = authority;
    try {
      const client = createDeskApiClient(sent, eventId);
      const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk-registrations", {
        params: { path: { event_id: eventId } },
        body: {
          full_name: fullName.trim(),
          mobile: sentMobile,
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
        if (response.status === 409 && sentMobile) void lookupDuplicate(sent, sentMobile);
      } else if (data) {
        // Only a backend-confirmed issuance is presented as success.
        setMintedPass(data);
        setFullName("");
        setMobile("");
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

  // 409 recovery: offer the existing ticket only for an exact normalized mobile match; never auto-select or resubmit.
  const lookupDuplicate = async (sent: DeskAuthority, normalizedMobile: string) => {
    setDuplicate({ status: "looking", mobile: normalizedMobile });
    try {
      const { data, response } = await createDeskApiClient(sent, eventId).GET("/api/events/{event_id}/attendees", {
        params: { path: { event_id: eventId }, query: { q: normalizedMobile, limit: 30 } },
      });
      if (response.status === 401) {
        rejectAuthority(sent);
        return;
      }
      if (signatureRef.current !== `${sent.kind}:${sent.token}`) return;
      if (!data) {
        setDuplicate({ status: "failed", mobile: normalizedMobile });
        return;
      }
      const exact = data.filter((a) => a.attendee_mobile === normalizedMobile);
      setDuplicate(exact.length > 0 ? { status: "found", mobile: normalizedMobile, candidates: exact } : { status: "missing", mobile: normalizedMobile });
    } catch {
      setDuplicate({ status: "failed", mobile: normalizedMobile });
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

  // Each press is a real SMS from the service line; the API spaces presses out per attendee (429 + Retry-After).
  const resendPassSms = async (ticketId: string): Promise<ResendOutcome> => {
    if (!authority) return { kind: "unauthorized" };
    const sent = authority;
    const { data, error, response } = await createDeskApiClient(sent, eventId).POST("/api/events/{event_id}/attendees/{ticket_id}/resend-sms", {
      params: { path: { event_id: eventId, ticket_id: ticketId } },
    });
    if (response.status === 401) {
      rejectAuthority(sent);
      return { kind: "unauthorized" };
    }
    if (data) return { kind: "result", data };
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      return { kind: "throttled", retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60 };
    }
    if (response.status === 409) {
      return { kind: "error", message: isRtl ? "این کارت فعال نیست یا شماره موبایلی برای آن ثبت نشده است." : "This pass is not active, or it has no mobile number." };
    }
    return { kind: "error", message: formatApiError(error) };
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
    if (mobileSearchDigits(q)) setMobile(q);
    else setFullName(q);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  };

  // Switching credential mode keeps the open pass when the same event stays loaded (operator → organizer).
  const selectMode = (next: DeskMode) => {
    if (next === mode) return;
    const keepReview = mode === "operator" && next === "organizer";
    setMode(next);
    if (!keepReview) {
      setSearchResults([]);
      setReview({ status: "idle" });
    }
    setOperatorProfile(null);
    setPageError(null);
  };

  const accentStyle = eventAccentStyle(operatorProfile?.event_slug || eventId);
  const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
  // Only offered inside Organizer administration with an organizer key; the choice is explicit.
  const showModeSwitch = !standalone && Boolean(apiKey);

  if (loading && authority) {
    return (
      <div className="rx-station space-y-5" role="status" aria-label={t.deskTitle}>
        <div className="skeleton h-36 shape-arc-lg" />
        <div className="skeleton h-[72px] rounded-[18px]" />
        <div className="rx-grid">
          <div className="rx-area-results skeleton h-80 rounded-2xl" />
          <div className="rx-area-detail skeleton h-96 shape-arc-lg" />
          <div className="rx-area-walkin skeleton h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (mode === "organizer" && !apiKey) {
    return (
      <div className="mx-auto my-10 max-w-md sm:my-16">
        <div className="relative overflow-hidden shape-arc-lg border border-border-default bg-surface-panel p-8 text-center shadow-soft sm:p-10">
          <ArcMotif className="pointer-events-none absolute -top-8 -end-8 size-32 opacity-25" weight={4} />
          <div className="relative space-y-5">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
              <Icon name="key" size={26} />
            </span>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{isRtl ? "برای حالت مدیر به کلید سازمان نیاز است" : "Organizer mode needs your organizer key"}</h1>
            <div className="flex flex-col gap-2.5">
              <LinkButton to="/organizer" variant="primary" size="lg">
                <Icon name="key" size={18} />
                <span>{isRtl ? "ورود با کلید سازمان" : "Enter organizer key"}</span>
              </LinkButton>
              <Button type="button" variant="secondary" size="lg" onClick={() => selectMode("operator")}>
                <Icon name="user" size={18} />
                <span>{isRtl ? "استفاده از نشست اپراتور" : "Use an operator session"}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!authority) {
    const steps = isRtl
      ? ["جستجوی شرکت‌کننده با نام یا شماره موبایل", "بررسی و چاپ کارت ورود", "صدور کارت برای ثبت‌نام حضوری"]
      : ["Find an attendee by name or mobile number", "Review and print their pass", "Issue a pass to a walk-in guest"];
    return (
      <div className="rx-station mx-auto max-w-4xl sm:my-6">
        <div className="grid overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-lift md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <aside className="relative isolate overflow-hidden bg-surface-ink p-6 text-white sm:p-8 md:p-10">
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />
            <ArcMotif className="pointer-events-none absolute -bottom-12 -end-10 -z-10 size-56 opacity-80 md:size-72" weight={4} />
            <div className="space-y-5 md:space-y-8">
              <p className="eyebrow text-ink-300">{t.openDeskAction}</p>
              <p className="text-2xl font-semibold leading-tight tracking-[-0.03em] md:text-[2rem]">
                {isRtl ? "پیدا کنید، بررسی کنید، چاپ کنید." : "Find. Review. Print."}
              </p>
              <ol className="hidden space-y-3.5 text-sm text-ink-200 sm:block">
                {steps.map((step, i) => (
                  <li key={step} className="flex items-baseline gap-3">
                    <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-orchid">0{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <div className="space-y-6 p-6 sm:p-8 md:p-10">
            {showModeSwitch && <ModeSwitch mode={mode} isRtl={isRtl} disabled={submitting} onSelect={selectMode} tone="light" />}
            <div className="space-y-2">
              <span aria-hidden="true" className="mb-4 grid size-11 place-items-center rounded-xl bg-aiteb-lavender text-aiteb-indigo">
                <Icon name="lock" size={20} />
              </span>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-text-primary sm:text-[1.75rem]">{t.deskLoginTitle}</h1>
              <p className="text-sm leading-relaxed text-text-secondary">{t.deskLoginSubtitle}</p>
            </div>

            {sessionRejected && (
              <div role="alert" aria-live="assertive" className="flex items-start gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-sm leading-relaxed text-status-danger-text">
                <Icon name="alert" size={18} className="mt-0.5" />
                <span>
                  {isRtl ? "دسترسی اپراتور لغو شده یا نشست کاری منقضی گردیده است." : "Operator access revoked or session expired."}
                  {hasDraft && (
                    <span className="mt-1 block text-xs">
                      {isRtl ? "اطلاعات واردشده برای ثبت حضوری حفظ شده و پس از ورود خودکار ارسال نمی‌شود." : "Your unsent walk-in entry is kept and is not submitted automatically after you sign in."}
                    </span>
                  )}
                </span>
              </div>
            )}

            <MobileOtpForm locale={locale} purpose="desk" verifyDesk={verifyDeskCode} verifyLabel={t.deskLoginButton} />
            {!standalone && (
              <div className="border-t border-border-subtle pt-4 text-center">
                <Link to="/organizer" className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-action-primary hover:underline ${focusRing}`}>
                  <Icon name="arrow-left" size={16} />
                  <span>{isRtl ? "ورود با کلید مدیر ارشد" : "Back to Organizer Console"}</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="mx-auto my-8 max-w-lg sm:my-14">
        <div className="shape-arc-lg border border-status-danger-border bg-surface-panel p-8 text-center shadow-soft sm:p-10">
          <div className="space-y-5">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-status-danger-bg text-status-danger-text">
              <Icon name="alert" size={26} />
            </span>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-text-primary">{pageError}</h1>
            <div className="flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Button type="button" variant="primary" size="lg" onClick={() => setReloadNonce((n) => n + 1)}>
                <Icon name="sync" size={18} />
                <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
              </Button>
              {!standalone && <LinkButton to="/organizer" variant="secondary" size="lg">{t.breadcrumbEvents}</LinkButton>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const trimmedQuery = searchQuery.trim();
  const selectedTicketId = review.status === "idle" ? null : review.status === "ready" ? review.card.ticket_id : review.ticketId;
  const issuedByLabel = t.issuedByLabel.replace(/[:：]\s*$/, "");
  const eventName = operatorProfile?.event_name;
  const ticketStatusLabels: Record<string, string> = {
    active: t.ticketStatusActive,
    cancelled: isRtl ? "لغوشده" : "Cancelled",
    revoked: isRtl ? "باطل‌شده" : "Revoked",
  };

  return (
    <div className="rx-station space-y-5 sm:space-y-6" style={accentStyle}>
      {/* Console: congress, operator and authority context */}
      <header className="relative isolate overflow-hidden shape-arc-lg bg-surface-ink text-white">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />
        {operatorProfile?.event_slug && (
          <CongressSignature
            seed={operatorProfile.event_slug}
            tone="ink"
            className="absolute inset-y-0 end-0 -z-10 h-full w-[70%] opacity-55 [mask-image:linear-gradient(to_left,black_25%,transparent)] rtl:[mask-image:linear-gradient(to_right,black_25%,transparent)]"
          />
        )}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 p-5 sm:p-7">
          <div className="min-w-0 flex-[1_1_22rem] space-y-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span className="inline-flex items-center gap-2 font-semibold text-white">
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-[#3BD69B] motion-safe:animate-pulse-ring" />
                  <span className="relative size-2 rounded-full bg-[#3BD69B]" />
                </span>
                {t.openDeskAction}
              </span>
              {operatorProfile && (
                <span className="font-mono text-ink-300">
                  <bdi dir="ltr">/e/{operatorProfile.event_slug}</bdi>
                </span>
              )}
            </div>
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.03em] break-words sm:text-[2.1rem]" data-testid="reception-event">
              {operatorProfile?.event_name || t.deskTitle}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-ink-300">{t.deskSubtitle}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            {operatorProfile && (
              <span data-testid="reception-operator" className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-white/[0.08] py-1.5 ps-1.5 pe-4 text-sm font-semibold ring-1 ring-white/15">
                <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-white text-surface-ink">
                  <Icon name="user" size={16} />
                </span>
                <span>{operatorProfile.operator_name}</span>
              </span>
            )}
            {showModeSwitch && <ModeSwitch mode={mode} isRtl={isRtl} disabled={submitting} onSelect={selectMode} tone="ink" />}
            {mode === "operator" && deskToken && (
              <button
                type="button"
                onClick={handleDeskLogout}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold text-ink-200 ring-1 ring-white/15 transition-colors duration-100 hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
              >
                <Icon name="logout" size={16} />
                <span>{t.deskLogoutAction}</span>
              </button>
            )}
            {!standalone && (
              <LinkButton to={`/organizer/events/${eventId}`} variant="light" size="md">
                <span>{isRtl ? "تنظیمات همایش" : "Event Settings"}</span>
                <Icon name="arrow-right" size={16} />
              </LinkButton>
            )}
          </div>
        </div>
      </header>

      {draftRecovered && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-status-info-border bg-status-info-bg py-2.5 ps-4 pe-2 text-sm leading-relaxed text-status-info-text">
          <Icon name="info" size={18} className="mt-1" />
          <span className="flex-1 py-0.5">{isRtl ? "ورود مجدد انجام شد. اطلاعات ثبت حضوری حفظ شده است؛ تا زمانی که خودتان ارسال نکنید چیزی ثبت نمی‌شود." : "Signed in again. Your walk-in entry was kept; nothing is submitted until you press the button."}</span>
          <button type="button" onClick={() => setDraftRecovered(false)} aria-label={isRtl ? "بستن پیام" : "Dismiss message"} className={`grid size-10 shrink-0 place-items-center rounded-lg hover:bg-white/70 cursor-pointer ${focusRing}`}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {/* 01 — Command bar */}
      <section aria-labelledby="search-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <h2 id="search-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-secondary">
            <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">01</span>
            <span>{t.searchAttendeeHeading}</span>
          </h2>
          <p className="hidden items-center gap-3 text-xs text-text-muted sm:flex">
            <span className="inline-flex items-center gap-1.5"><Kbd>/</Kbd>{isRtl ? "جستجو" : "Search"}</span>
            <span className="inline-flex items-center gap-1.5"><Kbd>Enter</Kbd>{isRtl ? "باز کردن" : "Open"}</span>
            <span className="inline-flex items-center gap-1.5"><Kbd>Esc</Kbd>{isRtl ? "پاک کردن" : "Clear"}</span>
          </p>
        </div>

        <div className="relative">
          <label htmlFor={ids.search} className="sr-only">{t.searchAttendeeHeading}</label>
          <Icon name="search" size={24} className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 text-aiteb-indigo" />
          <input
            id={ids.search}
            ref={searchInputRef}
            type="search"
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchQuery("");
              if (e.key === "Enter" && searchResults[0]) {
                e.preventDefault();
                void openReview(searchResults[0].ticket_id);
              }
            }}
            placeholder={t.searchAttendeePlaceholder}
            className="rx-command-input"
          />
          <div className="absolute end-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
            {searching && (
              <span role="status" className="grid size-8 place-items-center text-text-muted">
                <Icon name="sync" size={18} className="motion-safe:animate-spin" />
                <span className="sr-only">{isRtl ? "در حال جستجو..." : "Searching..."}</span>
              </span>
            )}
            {searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                aria-label={isRtl ? "پاک کردن جستجو" : "Clear search"}
                className={`grid size-11 place-items-center rounded-xl text-text-muted hover:bg-surface-panel-subtle hover:text-text-primary cursor-pointer ${focusRing}`}
              >
                <Icon name="x" size={20} />
              </button>
            ) : (
              <span aria-hidden="true" className="me-2 hidden sm:inline-flex"><Kbd>/</Kbd></span>
            )}
          </div>
        </div>

        {searchFailed && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg py-2 ps-3.5 pe-2 text-sm text-status-danger-text">
            <span className="flex items-center gap-2.5"><Icon name="wifi-off" size={18} />{isRtl ? "جستجو انجام نشد؛ نتایج زیر ممکن است قدیمی باشند." : "Search failed; the list below may be out of date."}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setSearchFailed(false); setSearchNonce((n) => n + 1); }}>
              {isRtl ? "تلاش مجدد" : "Retry"}
            </Button>
          </div>
        )}
      </section>

      <div className="rx-grid">
        {/* 02 — Results */}
        <section aria-labelledby="results-heading" className="rx-area-results min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
            <h2 id="results-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
              <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">02</span>
              <span>{trimmedQuery ? (isRtl ? "نتایج جستجو" : "Matches") : isRtl ? "شرکت‌کنندگان" : "Attendees"}</span>
            </h2>
            {searchResults.length > 0 && (
              <span className="rounded-full bg-surface-panel-subtle px-2 py-0.5 font-mono text-[11px] text-text-secondary tabular">{formatLocalizedNumber(searchResults.length, locale)}</span>
            )}
          </div>
          <p className="sr-only" role="status">
            {trimmedQuery && !searching
              ? isRtl
                ? `${formatLocalizedNumber(searchResults.length, locale)} نتیجه`
                : `${searchResults.length} ${searchResults.length === 1 ? "match" : "matches"}`
              : ""}
          </p>
          <div className="rx-results-scroll">
            {searchResults.length === 0 && trimmedQuery ? (
              <div className="space-y-4 px-5 py-9 text-center">
                <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-surface-panel-subtle text-text-muted">
                  <Icon name="search" size={20} />
                </span>
                <p className="text-sm text-text-secondary">{t.noAttendeeFound}</p>
                <Button type="button" variant="outline" size="md" onClick={registerFromSearch} className="h-auto max-w-full whitespace-normal">
                  <Icon name="user-plus" size={18} />
                  <span className="break-words">{isRtl ? `ثبت «${trimmedQuery}» به‌عنوان ثبت حضوری` : `Register “${trimmedQuery}” as walk-in`}</span>
                </Button>
              </div>
            ) : searchResults.length === 0 ? (
              <p className="px-5 py-9 text-center text-sm text-text-muted">
                {isRtl ? "نام یا شماره موبایل شرکت‌کننده را جستجو کنید." : "Type a name or mobile number to find an attendee."}
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {searchResults.map((att) => {
                  const affiliation = [att.title, att.organization].filter(Boolean).join(" · ");
                  return (
                    <li key={att.ticket_id}>
                      <button
                        type="button"
                        onClick={() => void openReview(att.ticket_id)}
                        aria-label={isRtl ? `بررسی ${att.attendee_name}` : `Review ${att.attendee_name}`}
                        aria-current={selectedTicketId === att.ticket_id ? "true" : undefined}
                        className="rx-row flex min-h-[68px] w-full items-start justify-between gap-3 px-4 py-3.5 text-start hover:bg-surface-panel-subtle cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring sm:px-5"
                      >
                        <span className="min-w-0 space-y-1">
                          <span className="block text-[15px] font-semibold leading-snug text-text-primary break-words">{att.attendee_name}</span>
                          {att.attendee_mobile && (
                            <span className="block truncate font-mono text-xs text-text-secondary">
                              <bdi dir="ltr">{formatMobile(att.attendee_mobile, locale)}</bdi>
                            </span>
                          )}
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                            <span className="rounded-md bg-event-accent-soft px-1.5 py-0.5 font-semibold text-event-accent">{att.ticket_tier_name}</span>
                            {affiliation && <span className="min-w-0 break-words">{affiliation}</span>}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <TicketStatusChip status={att.status} label={ticketStatusLabels[att.status] ?? att.status} />
                          <span className="text-[11px] text-text-muted tabular">
                            {isRtl ? "تردد:" : "Check-ins:"} {formatLocalizedNumber(att.checkin_count, locale)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Selected attendee */}
        <div className="rx-area-detail min-w-0">
          {review.status === "idle" ? (
            <div className="rx-detail-idle flex-col items-center justify-center gap-4 shape-arc-lg border border-dashed border-border-strong bg-surface-panel/50 p-8 text-center">
              <span aria-hidden="true" className="grid size-16 place-items-center rounded-2xl bg-surface-panel text-event-accent shadow-soft ring-1 ring-border-default">
                <Icon name="id-card" size={30} strokeWidth={1.5} />
              </span>
              <p className="text-base font-semibold text-text-primary">{isRtl ? "شرکت‌کننده‌ای انتخاب نشده است" : "No attendee selected"}</p>
              <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
                {isRtl ? "یک نفر را از فهرست انتخاب کنید تا کارت ورود و سوابق تردد او اینجا نمایش داده شود." : "Choose someone from the list to see their pass and gate history here."}
              </p>
            </div>
          ) : (
            <section aria-labelledby="review-heading" className="@container overflow-hidden shape-arc-lg border border-border-default bg-surface-panel shadow-lift">
              <div aria-hidden="true" className="h-[3px] bg-[image:var(--grad-aiteb)]" />
              {review.status === "loading" && (
                <div role="status" className="space-y-5 p-5 sm:p-6">
                  <p className="text-sm text-text-muted">{isRtl ? "در حال بارگذاری کارت..." : "Loading pass..."}</p>
                  <div className="skeleton h-8 w-2/3" />
                  <div className="grid gap-5 @xl:grid-cols-2">
                    <div className="skeleton h-72 shape-arc" />
                    <div className="space-y-3">
                      <div className="skeleton h-5" />
                      <div className="skeleton h-5 w-4/5" />
                      <div className="skeleton h-5 w-3/5" />
                    </div>
                  </div>
                </div>
              )}
              {review.status === "error" && (
                <div role="alert" className="space-y-5 p-6 sm:p-8">
                  <span aria-hidden="true" className="grid size-12 place-items-center rounded-2xl bg-status-danger-bg text-status-danger-text">
                    <Icon name="alert" size={24} />
                  </span>
                  <h2 id="review-heading" className="text-lg font-semibold text-status-danger-text">{review.message}</h2>
                  <div className="flex flex-wrap gap-2.5">
                    <Button type="button" variant="primary" size="lg" onClick={() => void openReview(review.ticketId)}>
                      <Icon name="sync" size={18} />
                      <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
                    </Button>
                    <Button type="button" variant="secondary" size="lg" onClick={closeReview}>{isRtl ? "بستن" : "Close"}</Button>
                  </div>
                </div>
              )}
              {review.status === "ready" && (
                <>
                  <div className="space-y-5 p-4 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                      <div className="min-w-0 space-y-1.5">
                        <p className="eyebrow">{isRtl ? "شرکت‌کننده انتخاب‌شده" : "Selected attendee"}</p>
                        <h2 id="review-heading" ref={reviewHeadingRef} tabIndex={-1} className="text-2xl font-semibold leading-tight tracking-[-0.03em] text-text-primary break-words focus:outline-none sm:text-[1.75rem]">
                          {review.card.attendee_name}
                        </h2>
                        <p className="text-sm text-text-secondary">
                          <span className="font-semibold text-event-accent">{review.card.ticket_tier_name}</span>
                          {review.card.title && <span> · {review.card.title}</span>}
                        </p>
                      </div>
                      <TicketStatusChip status={review.card.status} label={ticketStatusLabels[review.card.status] ?? review.card.status} size="md" />
                    </div>

                    <div className="grid grid-cols-1 items-start gap-5 @xl:grid-cols-2">
                      <div className="rounded-2xl bg-surface-panel-subtle p-2 @sm:p-4">
                        <ReceptionPass
                          pass={{ qr: review.card.qr_secret, name: review.card.attendee_name, tier: review.card.ticket_tier_name, org: review.card.organization, ticketId: review.card.ticket_id }}
                          isRtl={isRtl}
                          eventName={eventName}
                          printable={!mintedPass}
                        />
                      </div>
                      <div className="min-w-0 space-y-5">
                        <dl className="divide-y divide-border-subtle border-y border-border-subtle text-sm">
                          {review.card.attendee_mobile && (
                            <div className="grid gap-0.5 py-2.5">
                              <dt className="text-xs text-text-muted">{isRtl ? "موبایل" : "Mobile"}</dt>
                              <dd className="truncate font-mono text-[13px] text-text-primary"><bdi dir="ltr">{formatMobile(review.card.attendee_mobile, locale)}</bdi></dd>
                            </div>
                          )}
                          {review.card.organization && (
                            <div className="grid gap-0.5 py-2.5">
                              <dt className="text-xs text-text-muted">{isRtl ? "سازمان" : "Organization"}</dt>
                              <dd className="text-text-primary break-words">{review.card.organization}</dd>
                            </div>
                          )}
                          {review.card.issued_by && (
                            <div className="grid gap-0.5 py-2.5">
                              <dt className="text-xs text-text-muted">{issuedByLabel}</dt>
                              <dd className="font-semibold text-text-primary">{review.card.issued_by}</dd>
                            </div>
                          )}
                          <div className="grid gap-0.5 py-2.5">
                            <dt className="text-xs text-text-muted">{isRtl ? "تاریخ ثبت" : "Registered"}</dt>
                            <dd className="text-text-primary tabular">{formatLocalizedDate(review.card.created_at, locale)}</dd>
                          </div>
                        </dl>

                        <div className="space-y-2.5">
                          <h3 className="flex items-center justify-between gap-2 text-xs font-semibold text-text-muted">
                            <span className="flex items-center gap-2"><Icon name="gate" size={15} />{isRtl ? "سوابق تردد و اسکن‌های گیت" : "Check-In Scan History"}</span>
                            <span className="font-mono tabular">{formatLocalizedNumber(review.card.scan_history.length, locale)}</span>
                          </h3>
                          {review.card.scan_history.length === 0 ? (
                            <p className="rounded-xl border border-dashed border-border-default px-3 py-4 text-center text-xs text-text-muted">{isRtl ? "هنوز هیچ ترددی برای این کارت ثبت نشده است." : "No gate scans recorded yet."}</p>
                          ) : (
                            <ol className="max-h-48 overflow-y-auto">
                              {review.card.scan_history.map((scan, i) => (
                                <li key={`${scan.checkin_point_name}-${scan.scanned_at}-${i}`} className="relative ms-1 flex items-center justify-between gap-3 border-s border-border-default py-2 ps-4 text-xs">
                                  <span aria-hidden="true" className={`absolute -start-[4.5px] top-1/2 size-2 -translate-y-1/2 rounded-full ring-2 ring-surface-panel ${scan.status === "ADMITTED" ? "bg-status-success-solid" : "bg-status-danger-solid"}`} />
                                  <span className="min-w-0">
                                    <span className="block font-semibold text-text-primary break-words">{scan.checkin_point_name}</span>
                                    <span className="text-[11px] text-text-muted tabular">{formatLocalizedDate(scan.scanned_at, locale)}</span>
                                  </span>
                                  <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">
                                    {scan.status === "ADMITTED" ? (isRtl ? "ورود" : "Admitted") : isRtl ? "رد شد" : "Refused"}
                                  </Badge>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 border-t border-border-subtle bg-surface-panel-subtle/70 p-4 sm:p-5 print:hidden">
                    <div className="flex flex-col-reverse gap-2.5 @md:flex-row">
                      <Button type="button" variant="secondary" size="lg" className="whitespace-normal @md:flex-1" onClick={() => window.print()}>
                        <Icon name="print" size={19} />
                        <span>{t.printPassAction}</span>
                      </Button>
                      <Button type="button" variant="primary" size="lg" className="whitespace-normal @md:flex-[1.35]" onClick={handleNextAttendee}>
                        <span>{t.nextAttendeeAction}</span>
                        <Icon name="arrow-right" size={19} />
                      </Button>
                    </div>
                    {review.card.attendee_mobile && review.card.status === "active" && (
                      <ResendPassSms
                        key={review.card.ticket_id}
                        mobile={review.card.attendee_mobile}
                        locale={locale}
                        isRtl={isRtl}
                        onResend={() => resendPassSms(review.card.ticket_id)}
                      />
                    )}
                    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
                      <Icon name="info" size={14} className="mt-px" />
                      <span>{isRtl ? "چاپ از مرورگر انجام می‌شود و کارت جدیدی صادر نمی‌کند. ورود به همایش را همچنان اسکنر گیت ثبت می‌کند." : "Printing uses the browser and issues nothing new. Admission is still recorded by the gate scanner."}</span>
                    </p>
                  </div>
                </>
              )}
            </section>
          )}
        </div>

        {/* 03 — Walk-in registration */}
        <section aria-labelledby="walkin-heading" className="rx-area-walkin min-w-0 overflow-hidden rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          <div className="space-y-1.5 border-b border-border-subtle px-5 py-4 sm:px-6">
            <h2 id="walkin-heading" className="flex items-center gap-2.5 text-sm font-semibold text-text-primary">
              <span aria-hidden="true" className="font-mono text-[11px] text-aiteb-indigo">03</span>
              <span>{t.walkInRegistrationHeading}</span>
            </h2>
            <p className="text-xs leading-relaxed text-text-secondary">{isRtl ? "صدور آنی کارت ورود برای کسی که هنوز ثبت‌نام نکرده است." : "Issue a pass for someone who has not registered yet."}</p>
          </div>

          <form onSubmit={handleRegisterWalkIn} className="@container space-y-4 p-5 sm:p-6" noValidate>
            <div>
              <label htmlFor={ids.name} className="ui-label">{isRtl ? "نام و نام خانوادگی شرکت‌کننده" : "Full Name"} <span aria-hidden="true" className="text-status-danger-solid">*</span></label>
              <input id={ids.name} ref={nameInputRef} type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={isRtl ? "مثال: دکتر مهدی احمدی" : "e.g. Dr. Mahdi Ahmadi"} className="ui-input" />
            </div>
            <div>
              <label htmlFor={ids.mobile} className="ui-label">{isRtl ? "شماره موبایل (اختیاری)" : "Mobile Number (Optional)"}</label>
              <input id={ids.mobile} type="tel" dir="ltr" inputMode="tel" autoComplete="off" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="09xx xxx xxxx" className="ui-input font-mono" />
              <p className="mt-1.5 text-xs text-text-muted">
                {isRtl ? "با شماره موبایل، لینک کارت ورود پیامک می‌شود و شرکت‌کننده بعداً می‌تواند وارد شود." : "With a number, the pass link is sent by SMS and the attendee can sign in later."}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              <div>
                <label htmlFor={ids.org} className="ui-label">{isRtl ? "سازمان / دانشگاه" : "Organization"}</label>
                <input id={ids.org} type="text" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder={isRtl ? "دانشگاه علوم پزشکی" : "University / Hospital"} className="ui-input" />
              </div>
              <div>
                <label htmlFor={ids.title} className="ui-label">{isRtl ? "عنوان حرفه‌ای" : "Title"}</label>
                <input id={ids.title} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isRtl ? "متخصص، پژوهشگر" : "Specialist, Researcher"} className="ui-input" />
              </div>
            </div>
            <div>
              <label htmlFor={ids.tier} className="ui-label">{t.tierLabel} <span aria-hidden="true" className="text-status-danger-solid">*</span></label>
              <select id={ids.tier} value={selectedTierId} onChange={(e) => setSelectedTierId(e.target.value)} className="ui-select">
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({t.tierQuotaTotal}: {formatLocalizedNumber(tier.quota, locale)})
                  </option>
                ))}
              </select>
              {tiers.length === 0 && <p className="mt-1.5 text-xs text-text-muted">{isRtl ? "هنوز رده بلیطی برای این همایش تعریف نشده است." : "No ticket tier is defined for this congress yet."}</p>}
            </div>

            {formError && (
              <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] leading-relaxed text-status-danger-text">
                <Icon name="alert" size={17} className="mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {duplicate.status !== "none" && (
              <div role="status" className="space-y-3 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5 text-[13px] leading-relaxed text-status-warning-text">
                {duplicate.status === "looking" && <p className="flex items-center gap-2"><Icon name="sync" size={16} className="motion-safe:animate-spin" />{isRtl ? "در حال جستجوی کارت موجود..." : "Looking for the existing pass..."}</p>}
                {duplicate.status === "failed" && <p>{isRtl ? "کارت موجود پیدا نشد (خطای جستجو). با جستجوی دستی بررسی کنید." : "The existing pass could not be looked up. Check with the search box."}</p>}
                {duplicate.status === "missing" && <p>{isRtl ? "کارت دقیقاً مطابق این شماره پیدا نشد. با جستجوی دستی بررسی کنید." : "No pass with exactly this mobile number was found. Check with the search box."}</p>}
                {duplicate.status === "found" && (
                  <>
                    <p className="flex items-start gap-2"><Icon name="ticket" size={16} className="mt-0.5" /><span>{isRtl ? "این شماره قبلاً کارت دارد. برای بررسی کارت موجود، آن را انتخاب کنید:" : "This mobile number already has a pass. Choose it to review the existing pass:"}</span></p>
                    {duplicate.candidates.map((c) => (
                      <Button key={c.ticket_id} type="button" variant="secondary" size="md" isFullWidth className="h-auto justify-between whitespace-normal text-start" onClick={() => void openReview(c.ticket_id)}>
                        <span className="min-w-0 break-words">{isRtl ? `بررسی کارت ${c.attendee_name}` : `Review existing pass: ${c.attendee_name}`}</span>
                        <Icon name="arrow-right" size={16} />
                      </Button>
                    ))}
                  </>
                )}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" isFullWidth disabled={submitting || tiers.length === 0} aria-busy={submitting}>
              <Icon name={submitting ? "sync" : "ticket"} size={18} className={submitting ? "motion-safe:animate-spin" : ""} />
              <span>{submitting ? t.mintingBadge : t.mintBadgeAction}</span>
            </Button>
          </form>
        </section>
      </div>

      {/* Backend-confirmed issuance */}
      <Dialog isOpen={Boolean(mintedPass)} onClose={handleNextAttendee} title={t.ticketIssuedSuccess.replace(/^✓\s*/, "")} description={isRtl ? "کارت ورود با موفقیت صادر شد. می‌توانید کارت را چاپ کرده یا به شرکت‌کننده تحویل دهید." : "Pass minted successfully."} size="sm">
        {mintedPass && (
          <div className="space-y-4" style={accentStyle}>
            <p className="flex items-center gap-2.5 text-sm font-semibold text-status-success-text">
              <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-status-success-text text-white">
                <Icon name="check" size={15} strokeWidth={2.5} />
              </span>
              <span>{isRtl ? "صادر شد و آماده چاپ است" : "Issued and ready to print"}</span>
            </p>
            <div className="rounded-2xl bg-surface-panel-subtle p-4">
              <ReceptionPass
                pass={{ qr: mintedPass.qr_secret, name: mintedPass.attendee_name, tier: mintedPass.ticket_tier_name, org: mintedPass.organization, ticketId: mintedPass.ticket_id }}
                isRtl={isRtl}
                eventName={eventName}
                printable
              />
            </div>
            {mintedPass.attendee_mobile && (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-text-secondary print:hidden">
                <Icon name="mail" size={15} className="mt-px shrink-0" />
                <span>
                  {isRtl ? "لینک کارت به این شماره پیامک می‌شود: " : "The pass link is being sent by SMS to "}
                  <bdi dir="ltr" className="font-mono">{formatMobile(mintedPass.attendee_mobile, locale)}</bdi>
                </span>
              </p>
            )}
            <div className="grid gap-2.5 print:hidden">
              <Button type="button" variant="secondary" size="lg" isFullWidth onClick={() => window.print()}>
                <Icon name="print" size={18} />
                <span>{t.printPassAction}</span>
              </Button>
              {mintedPass.attendee_mobile && (
                <ResendPassSms
                  key={mintedPass.ticket_id}
                  mobile={mintedPass.attendee_mobile}
                  locale={locale}
                  isRtl={isRtl}
                  onResend={() => resendPassSms(mintedPass.ticket_id)}
                />
              )}
              <Button type="button" variant="primary" size="lg" isFullWidth onClick={handleNextAttendee} className="whitespace-normal">
                <span>{t.nextAttendeeAction}</span>
                <Icon name="arrow-right" size={18} />
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
