import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  apiErrorCode,
  createApiClient,
  createDeskApiClient,
  formatApiError,
  localizedApiError,
  type AttendeeDetailCard,
  type AttendeeSearchItem,
  type CheckInPointOut,
  type DeskMeOut,
  type DeskRegistrationOut,
  type TicketTierOut,
} from "../../api/client";
import { badgeCode, KeyBurst } from "../../lib/deskScan";
import { eventAccentStyle } from "../../lib/eventAccent";
import { networkErrorMessage } from "../../lib/errorMessages";
import { mobileSearchDigits, normalizeIranMobile } from "../../lib/mobile";
import { normalizeScannedCode } from "../../lib/scannerInput";
import type { AttendeeLocale, TranslationDictionary } from "../../lib/i18n";
import { CongressSignature } from "../brand/CongressSignature";
import { QrCameraInput } from "../QrCameraInput";
import { Button, LinkButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { AttendeeCard } from "./AttendeeCard";
import { SearchBar, SearchResults } from "./AttendeeSearch";
import type { DeskCardActions } from "./DeskActions";
import { DeskSignIn, OrganizerKeyRequired } from "./DeskAuthGate";
import { MintedDialog } from "./MintedDialog";
import { ModeSwitch, type DeskMode } from "./ModeSwitch";
import type { ResendOutcome } from "./ResendPassSms";
import { WalkInForm, type WalkInDraft } from "./WalkInForm";
import { deskFocusRing, type CardState, type DeskAuthority, type DuplicateState } from "./deskTypes";
import "../../styles/reception.css";

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

const EMPTY_DRAFT: WalkInDraft = { fullName: "", mobile: "", organization: "", title: "", tierId: "" };

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
  const [draft, setDraft] = useState<WalkInDraft>(EMPTY_DRAFT);
  const updateDraft = useCallback((patch: Partial<WalkInDraft>) => setDraft((current) => ({ ...current, ...patch })), []);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Idempotency-Key of the walk-in being submitted: resent while the same entry is retried (a dropped connection
  // then returns the pass already issued instead of a second one), replaced when the entry changes or succeeds.
  const walkInAttemptRef = useRef<{ key: string; entry: string } | null>(null);
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
  // Badge scans: a barcode gun typing into the search box, or the camera.
  const keyBurstRef = useRef(new KeyBurst());
  const [badgeNotice, setBadgeNotice] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [checkinPoints, setCheckinPoints] = useState<CheckInPointOut[]>([]);

  const hasDraft = Boolean(draft.fullName.trim() || draft.mobile.trim() || draft.organization.trim() || draft.title.trim());

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
        // Where the desk can admit; optional (no points, or an older API, hides "admit at").
        void client
          .GET("/api/events/{event_id}/desk/checkin-points", { params: { path: { event_id: eventId } } })
          .then(({ data }) => { if (isMounted) setCheckinPoints(Array.isArray(data) ? data : []); })
          .catch(() => undefined);
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
            const fallback = firstOpen ? firstOpen.id : tiersRes.data[0].id;
            setDraft((current) => (current.tierId ? current : { ...current, tierId: fallback }));
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
    setDraft((current) => ({ ...EMPTY_DRAFT, tierId: current.tierId }));
    setFormError(null);
    setDraftRecovered(false);
    setDuplicate({ status: "none" });
    setSearchQuery("");
    setSearchResults([]);
    setReview({ status: "idle" });
    setMintedPass(null);
    walkInAttemptRef.current = null;
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
    if (!draft.tierId || !authority || submittingRef.current) return;
    setFormError(null);
    setDuplicate({ status: "none" });
    if (!draft.fullName.trim()) {
      setFormError(isRtl ? "نام و نام خانوادگی شرکت‌کننده الزامی است." : "Attendee full name is required.");
      return;
    }
    const sentMobile = draft.mobile.trim() ? normalizeIranMobile(draft.mobile) : null;
    if (draft.mobile.trim() && !sentMobile) {
      setFormError(isRtl ? "شماره موبایل معتبر نیست؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹، یا آن را خالی بگذارید." : "The mobile number is not valid (e.g. 0912 345 6789); correct it or leave it empty.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const sent = authority;
    const body = {
      full_name: draft.fullName.trim(),
      mobile: sentMobile,
      organization: draft.organization.trim(),
      title: draft.title.trim(),
      ticket_tier_id: draft.tierId,
    };
    const entry = JSON.stringify([sent.kind, body]);
    if (walkInAttemptRef.current?.entry !== entry) walkInAttemptRef.current = { key: crypto.randomUUID(), entry };
    const idempotencyKey = walkInAttemptRef.current.key;
    try {
      const client = createDeskApiClient(sent, eventId);
      const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk-registrations", {
        params: { path: { event_id: eventId }, header: { "Idempotency-Key": idempotencyKey } },
        body,
      });
      if (response.status === 401) rejectAuthority(sent);
      if (signatureRef.current !== `${sent.kind}:${sent.token}` && response.status !== 401) return;
      if (err) {
        if (response.status === 401) return;
        setFormError(localizedApiError(err, locale));
        if (response.status === 409 && sentMobile) void lookupDuplicate(sent, sentMobile);
      } else if (data) {
        // Only a backend-confirmed issuance is presented as success.
        walkInAttemptRef.current = null;
        setMintedPass(data);
        setDraft((current) => ({ ...EMPTY_DRAFT, tierId: current.tierId }));
        setSearchQuery("");
        setDraftRecovered(false);
        setSearchNonce((n) => n + 1);
      }
    } catch {
      setFormError(
        isRtl
          ? "اتصال قطع شد؛ مشخص نیست کارت صادر شده یا نه. اطلاعات واردشده حفظ شده است؛ ثبت دوباره همین اطلاعات کارت تکراری صادر نمی‌کند."
          : "The connection dropped, so it is not known whether the pass was issued. Your entry is kept: submitting it again unchanged will not issue a second pass."
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

  // One desk write or lookup with the current authority: 401 drops exactly that credential, a reply for another
  // session is ignored, and failures come back as the message to show (null: nothing to show).
  type DeskReply<T> = { data?: T; error?: unknown; response: Response };
  const runDesk = async <T,>(
    call: (client: ReturnType<typeof createDeskApiClient>) => Promise<DeskReply<T>>
  ): Promise<{ data: T } | { message: string | null; code?: string }> => {
    if (!authority) return { message: null };
    const sent = authority;
    try {
      const { data, error, response } = await call(createDeskApiClient(sent, eventId));
      if (response.status === 401) {
        rejectAuthority(sent);
        return { message: null };
      }
      if (signatureRef.current !== `${sent.kind}:${sent.token}`) return { message: null };
      if (data !== undefined) return { data };
      return { message: localizedApiError(error, locale), code: apiErrorCode(error) };
    } catch {
      return { message: networkErrorMessage[locale] };
    }
  };

  const showCard = (card: AttendeeDetailCard) => {
    reviewRequest.current++;
    setReview({ status: "ready", card });
    setSearchNonce((n) => n + 1);
  };

  // Re-reads the open card in place (no loading state), when it is still the one on screen.
  const refreshCard = async (ticketId: string) => {
    const requestId = reviewRequest.current;
    const result = await runDesk((client) =>
      client.GET("/api/events/{event_id}/attendees/{ticket_id}", { params: { path: { event_id: eventId, ticket_id: ticketId } } })
    );
    if (!("data" in result) || requestId !== reviewRequest.current) return;
    const card = result.data;
    setReview((current) => (current.status === "ready" && current.card.ticket_id === ticketId ? { status: "ready", card } : current));
  };

  // A scanned badge (gun or camera): resolved by its QR code, never searched as a name.
  const lookupBadge = async (code: string) => {
    setBadgeNotice(null);
    const result = await runDesk((client) =>
      client.POST("/api/events/{event_id}/attendees/qr-lookup", { params: { path: { event_id: eventId } }, body: { qr: code } })
    );
    if ("data" in result) {
      setSearchQuery("");
      keyBurstRef.current.reset();
      void openReview(result.data.ticket_id);
    } else if (result.message) {
      setBadgeNotice(result.message);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      keyBurstRef.current.reset();
      setBadgeNotice(null);
      setSearchQuery("");
      return;
    }
    if (e.key === "Enter") {
      const scanned = keyBurstRef.current.enter(performance.now()) ?? badgeCode(searchQuery);
      if (scanned) {
        e.preventDefault();
        void lookupBadge(scanned);
      } else if (searchResults[0]) {
        e.preventDefault();
        void openReview(searchResults[0].ticket_id);
      }
      return;
    }
    keyBurstRef.current.key(e.nativeEvent, performance.now());
  };

  const onCameraDecode = (value: string) => {
    setCameraOpen(false);
    void lookupBadge(badgeCode(value) ?? normalizeScannedCode(value));
  };

  // The print is recorded first (first print or reprint, for the "needs reprint" flag), then printed. A failed
  // record never blocks the badge: the attendee is at the desk.
  const printBadge = async (ticketId: string): Promise<string | null> => {
    const result = await runDesk((client) =>
      client.POST("/api/events/{event_id}/attendees/{ticket_id}/prints", { params: { path: { event_id: eventId, ticket_id: ticketId } } })
    );
    if (!("data" in result) && result.message === null) return null; // session lost
    window.print();
    if ("data" in result) {
      const printed = result.data;
      setReview((current) =>
        current.status === "ready" && current.card.ticket_id === ticketId
          ? { status: "ready", card: { ...current.card, print_count: printed.print_count, last_printed_at: printed.printed_at, needs_reprint: false } }
          : current
      );
      return null;
    }
    return isRtl ? `چاپ ثبت نشد: ${result.message}` : `The print was not recorded: ${result.message}`;
  };

  const cardActions: DeskCardActions = {
    checkinPoints,
    admit: async (ticketId, pointId) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/admit", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body: { checkin_point_id: pointId, scan_id: crypto.randomUUID() },
        })
      );
      if (!("data" in result)) return { error: result.message };
      void refreshCard(ticketId); // the new history line, without reloading the card
      setSearchNonce((n) => n + 1);
      return { verdict: result.data };
    },
    edit: async (ticketId, body) => {
      const result = await runDesk((client) =>
        client.PATCH("/api/events/{event_id}/attendees/{ticket_id}", { params: { path: { event_id: eventId, ticket_id: ticketId } }, body })
      );
      if ("data" in result) { showCard(result.data); return null; }
      return result.message;
    },
    cancel: async (ticketId, reason) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/cancel", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body: { reason, notify: true },
        })
      );
      if ("data" in result) { showCard(result.data); return null; }
      return result.message;
    },
    reissue: async (ticketId) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/reissue", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body: { notify: true },
        })
      );
      if ("data" in result) { showCard(result.data); return null; }
      return result.message;
    },
    transfer: async (ticketId, body) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/transfer", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body,
        })
      );
      if ("data" in result) { showCard(result.data); return null; }
      return result.message;
    },
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
    if (mobileSearchDigits(q)) updateDraft({ mobile: q });
    else updateDraft({ fullName: q });
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
    return <OrganizerKeyRequired isRtl={isRtl} onUseOperator={() => selectMode("operator")} />;
  }

  if (!authority) {
    return (
      <DeskSignIn
        locale={locale}
        t={t}
        isRtl={isRtl}
        standalone={standalone}
        modeSwitch={showModeSwitch ? { mode, disabled: submitting, onSelect: selectMode } : null}
        sessionRejected={sessionRejected}
        hasDraft={hasDraft}
        verifyCode={verifyDeskCode}
      />
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
          <button type="button" onClick={() => setDraftRecovered(false)} aria-label={isRtl ? "بستن پیام" : "Dismiss message"} className={`grid size-10 shrink-0 place-items-center rounded-lg hover:bg-white/70 cursor-pointer ${deskFocusRing}`}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <SearchBar
        inputId={ids.search}
        inputRef={searchInputRef}
        query={searchQuery}
        onQueryChange={(query) => { setSearchQuery(query); if (!query) setBadgeNotice(null); }}
        onKeyDown={handleSearchKeyDown}
        searching={searching}
        searchFailed={searchFailed}
        onRetry={() => { setSearchFailed(false); setSearchNonce((n) => n + 1); }}
        onScanCamera={() => setCameraOpen(true)}
        badgeNotice={badgeNotice}
        t={t}
        isRtl={isRtl}
      />

      <div className="rx-grid">
        <SearchResults
          results={searchResults}
          trimmedQuery={trimmedQuery}
          searching={searching}
          selectedTicketId={selectedTicketId}
          onOpen={(ticketId) => void openReview(ticketId)}
          onRegisterWalkIn={registerFromSearch}
          statusLabels={ticketStatusLabels}
          locale={locale}
          t={t}
          isRtl={isRtl}
        />

        <div className="rx-area-detail min-w-0">
          <AttendeeCard
            review={review}
            headingRef={reviewHeadingRef}
            eventName={eventName}
            printable={!mintedPass}
            onRetry={(ticketId) => void openReview(ticketId)}
            onClose={closeReview}
            onPrint={(card) => printBadge(card.ticket_id)}
            onNext={handleNextAttendee}
            onResend={resendPassSms}
            actions={cardActions}
            statusLabels={ticketStatusLabels}
            locale={locale}
            t={t}
            isRtl={isRtl}
          />
        </div>

        <WalkInForm
          ids={ids}
          nameInputRef={nameInputRef}
          draft={draft}
          onChange={updateDraft}
          tiers={tiers}
          submitting={submitting}
          formError={formError}
          duplicate={duplicate}
          onOpenExisting={(ticketId) => void openReview(ticketId)}
          onSubmit={handleRegisterWalkIn}
          locale={locale}
          t={t}
          isRtl={isRtl}
        />
      </div>

      <MintedDialog
        minted={mintedPass}
        accentStyle={accentStyle}
        eventName={eventName}
        onPrint={() => { if (mintedPass) void printBadge(mintedPass.ticket_id); }}
        onNext={handleNextAttendee}
        onResend={resendPassSms}
        locale={locale}
        t={t}
        isRtl={isRtl}
      />

      <Dialog
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        title={isRtl ? "اسکن کد QR کارت ورود" : "Scan the badge's QR code"}
        description={isRtl ? "کد QR کارت ورود را جلوی دوربین بگیرید." : "Hold the badge's QR code in front of the camera."}
        size="sm"
      >
        <QrCameraInput isRtl={isRtl} disabled={!cameraOpen} onDecode={onCameraDecode} />
      </Dialog>
    </div>
  );
}
