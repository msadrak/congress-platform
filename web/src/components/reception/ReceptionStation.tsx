import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import {
  apiErrorCode,
  createApiClient,
  createDeskApiClient,
  localizedApiError,
  type AttendeeDetailCard,
  type AttendeeSearchItem,
  type CheckInPointOut,
  type DeskMeOut,
  type DeskRegistrationOut,
  type TicketTierOut,
} from "../../api/client";
import { commonCopy } from "../../copy/common";
import { deskCopy } from "../../copy/desk";
import { operatorCopy } from "../../copy/operator";
import { useHidScanner } from "../../hooks/useHidScanner";
import { useWakeLock } from "../../hooks/useWakeLock";
import { deskTimeZone, tierAvailable } from "../../lib/deskBadge";
import { badgeCode } from "../../lib/deskScan";
import { networkErrorMessage } from "../../lib/errorMessages";
import { eventAccentStyle } from "../../lib/eventAccent";
import { setLocale, type AttendeeLocale } from "../../lib/i18n";
import { recordOperatorLaunch } from "../../lib/launchTarget";
import { mobileSearchDigits, normalizeIranMobile } from "../../lib/mobile";
import { normalizeScannedCode } from "../../lib/scannerInput";
import { OperatorBar } from "../operator/OperatorBar";
import { OperatorGate } from "../operator/OperatorGate";
import { OperatorMenu, type OperatorMenuItem } from "../operator/OperatorMenu";
import { StatusPill } from "../operator/StatusPill";
import { QrCameraInput } from "../QrCameraInput";
import { Button, LinkButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog } from "../ui/Dialog";
import { Notice } from "../ui/Notice";
import { Toast } from "../ui/Toast";
import { AttendeeCard } from "./AttendeeCard";
import { SearchBar, SearchResults } from "./AttendeeSearch";
import type { DeskCardActions, ResendOutcome } from "./DeskActions";
import { DeskSignIn, OrganizerKeyRequired } from "./DeskAuthGate";
import { MintedDialog } from "./MintedDialog";
import { WalkInDialog, type WalkInDraft } from "./WalkInDialog";
import type { CardState, DeskAuthority, DuplicateState } from "./deskTypes";
import "../../styles/reception.css";

/** Inside organizer administration only: lets the user deliberately act as organizer. */
export interface OrganizerAccess {
  apiKey: string | null;
  onKeyRejected: (sentKey: string) => void;
  /** A manager or owner: the menu links to the desk operators page. */
  canManageOperators?: boolean;
}

export type DeskMode = "operator" | "organizer";

export interface ReceptionStationProps {
  eventId: string;
  /** null = the independent reception portal: desk credential only, no organizer mode, no organizer links. */
  organizer: OrganizerAccess | null;
  locale: AttendeeLocale;
}

const OTHER_LOCALE = { fa: "en", en: "fa" } as const;
const EMPTY_DRAFT: WalkInDraft = { fullName: "", mobile: "", organization: "", title: "", tierId: "" };
/** Keys of one barcode-gun scan arrive this close together (same as `useHidScanner`). */
const BURST_GAP_MS = 60;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** A dialog is open (one that is only playing its closing animation does not count). */
function dialogOpen(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((dialog) => !dialog.closest('[aria-hidden="true"]'));
}

/** Puts a text field back to `value` the way typing would, so React's controlled state follows. */
function restoreField(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The reception work surface: search, review, desk registration, print, admit. Authority is explicit and never falls back. */
export function ReceptionStation({ eventId, organizer, locale }: ReceptionStationProps) {
  const c = deskCopy[locale];
  const common = commonCopy[locale];
  const navigate = useNavigate();
  const standalone = organizer === null;
  const apiKey = organizer?.apiKey ?? null;
  const onKeyRejected = organizer?.onKeyRejected;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [deskToken, setDeskToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? sessionStorage.getItem(`congress_desk_token_${eventId}`) : null
  );
  // The selected mode, not storage precedence, decides which credential is sent. It starts as
  // operator mode, or organizer mode when only an organizer key exists (organizer administration
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

  // Desk registration draft: in memory only, kept across recoverable failures, closing the dialog and re-authentication.
  const [draft, setDraft] = useState<WalkInDraft>(EMPTY_DRAFT);
  const [nameError, setNameError] = useState(false);
  const [mobileError, setMobileError] = useState(false);
  const updateDraft = useCallback((patch: Partial<WalkInDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (patch.fullName !== undefined) setNameError(false);
    if (patch.mobile !== undefined) setMobileError(false);
  }, []);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Idempotency-Key of the registration being submitted: resent while the same entry is retried (a dropped connection
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
  const [badgeNotice, setBadgeNotice] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [checkinPoints, setCheckinPoints] = useState<CheckInPointOut[]>([]);
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const showToast = useCallback((text: string) => setToast((current) => ({ text, id: (current?.id ?? 0) + 1 })), []);

  // Offline: the browser says so, or the last desk request found no server at all.
  const browserOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [unreachable, setUnreachable] = useState(false);
  const offline = !browserOnline || unreachable;

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
    // Without the selected mode's credential nothing is dispatched; an entry gate is shown instead.
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
          .then(({ data }) => {
            if (isMounted) setCheckinPoints(Array.isArray(data) ? data : []);
          })
          .catch(() => undefined);
        const unauthorized = meRes.response.status === 401 || tiersRes.response.status === 401;
        if (unauthorized) rejectAuthority(authority);
        if (!isMounted || unauthorized) return;
        setUnreachable(false);
        if (meRes.error) {
          setPageError(localizedApiError(meRes.error, locale));
        } else if (meRes.data) {
          setOperatorProfile(meRes.data);
        }
        if (tiersRes.data) {
          const loaded = tiersRes.data;
          setTiers(loaded);
          if (loaded.length > 0) {
            const fallback = (loaded.find(tierAvailable) ?? loaded[0]).id;
            setDraft((current) => (current.tierId ? current : { ...current, tierId: fallback }));
          }
        }
      } catch {
        if (isMounted) setPageError(networkErrorMessage[locale]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    void loadEventData();
    return () => {
      isMounted = false;
    };
  }, [eventId, authority, reloadNonce, rejectAuthority, locale]);

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
          setUnreachable(false);
          if (data) {
            setSearchResults(data);
            setSearchFailed(false);
          } else if (response.status !== 401) {
            setSearchFailed(true);
          }
        }
      } catch {
        // A failed search keeps the previous results and says so; credentials are untouched.
        if (isMounted) {
          setSearchFailed(true);
          setUnreachable(true);
        }
      }
      if (isMounted) setSearching(false);
    }, 200);
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [searchQuery, eventId, authority, rejectAuthority, searchNonce]);

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
        is_archived: false,
        event_timezone: data.event_timezone,
      });
      return null;
    }
    if (response.status === 401 || response.status === 422) return c.loginCodeWrong;
    if (response.status === 403) return c.loginNotOperator;
    if (response.status === 404) return c.loginNoCongress;
    if (response.status === 429) return c.loginTooMany;
    return c.loginUnavailable;
  };

  const clearWorkspace = () => {
    setDraft((current) => ({ ...EMPTY_DRAFT, tierId: current.tierId }));
    setFormError(null);
    setDraftRecovered(false);
    setDuplicate({ status: "none" });
    setWalkInOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setReview({ status: "idle" });
    setMintedPass(null);
    walkInAttemptRef.current = null;
  };

  const handleDeskLogout = () => {
    setSignOutOpen(false);
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
      setNameError(true);
      return;
    }
    const sentMobile = draft.mobile.trim() ? normalizeIranMobile(draft.mobile) : null;
    if (draft.mobile.trim() && !sentMobile) {
      setMobileError(true);
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
      setUnreachable(false);
      if (err) {
        if (response.status === 401) return;
        setFormError(localizedApiError(err, locale));
        if (response.status === 409 && sentMobile) void lookupDuplicate(sent, sentMobile);
      } else if (data) {
        // Only a backend-confirmed issuance is presented as success.
        walkInAttemptRef.current = null;
        setWalkInOpen(false);
        setMintedPass(data);
        setDraft((current) => ({ ...EMPTY_DRAFT, tierId: current.tierId }));
        setSearchQuery("");
        setDraftRecovered(false);
        setSearchNonce((n) => n + 1);
        // Seats left on the pass types move with every issuance.
        void client.GET("/api/events/{event_id}/desk/tiers", { params: { path: { event_id: eventId } } }).then(({ data: fresh }) => {
          if (fresh && signatureRef.current === `${sent.kind}:${sent.token}`) setTiers(fresh);
        }).catch(() => undefined);
      }
    } catch {
      setFormError(c.connectionLost);
      setUnreachable(true);
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
      setUnreachable(false);
      if (data) {
        setReview({ status: "ready", card: data });
      } else {
        const message = response.status === 404 ? c.cardNotFound : response.status === 403 ? c.cardForbidden : c.cardLoadFailed;
        setReview({ status: "error", ticketId, message });
      }
    } catch {
      if (requestId === reviewRequest.current) {
        setUnreachable(true);
        setReview({ status: "error", ticketId, message: networkErrorMessage[locale] });
      }
    }
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
      setUnreachable(false);
      if (data !== undefined) return { data };
      return { message: localizedApiError(error, locale), code: apiErrorCode(error) };
    } catch {
      setUnreachable(true);
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
      void openReview(result.data.ticket_id);
    } else if (result.message) {
      setBadgeNotice(result.message);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // A gun burst never reaches here (useHidScanner takes it first); this is a typed or pasted badge code.
    const scanned = badgeCode(searchQuery);
    if (scanned) {
      e.preventDefault();
      void lookupBadge(scanned);
    } else if (searchResults[0]) {
      e.preventDefault();
      void openReview(searchResults[0].ticket_id);
    }
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
    return c.printNotRecorded(result.message ?? "");
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
    if (response.status === 409) return { kind: "error", message: c.resendNotPossible };
    return { kind: "error", message: localizedApiError(error, locale) };
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
      if ("data" in result) {
        showCard(result.data);
        return null;
      }
      return result.message;
    },
    cancel: async (ticketId, reason) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/cancel", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body: { reason, notify: true },
        })
      );
      if ("data" in result) {
        showCard(result.data);
        return null;
      }
      return result.message;
    },
    reissue: async (ticketId) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/reissue", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body: { notify: true },
        })
      );
      if ("data" in result) {
        showCard(result.data);
        return null;
      }
      return result.message;
    },
    transfer: async (ticketId, body) => {
      const result = await runDesk((client) =>
        client.POST("/api/events/{event_id}/attendees/{ticket_id}/transfer", {
          params: { path: { event_id: eventId, ticket_id: ticketId } },
          body,
        })
      );
      if ("data" in result) {
        showCard(result.data);
        return null;
      }
      return result.message;
    },
    resend: resendPassSms,
  };

  // «بعدی»: close the card (or the issued dialog), clear the search and put the cursor back in it.
  const handleNext = useCallback(() => {
    setMintedPass(null);
    reviewRequest.current++;
    setReview({ status: "idle" });
    setSearchQuery("");
    setBadgeNotice(null);
    // After a closing dialog has handed focus back; never steals it from a dialog opened meanwhile.
    setTimeout(() => {
      if (!document.activeElement?.closest('[aria-modal="true"]')) searchInputRef.current?.focus();
    }, 50);
  }, []);

  const openWalkIn = () => {
    setFormError(null);
    setWalkInOpen(true);
  };
  const registerFromSearch = () => {
    const q = searchQuery.trim();
    if (mobileSearchDigits(q)) updateDraft({ mobile: q });
    else updateDraft({ fullName: q });
    openWalkIn();
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

  // Organizer administration only, with an organizer key; the choice is explicit.
  const showModeSwitch = !standalone && Boolean(apiKey);
  // An archived congress: the desk can look attendees up, but changes nothing (the API answers 409 EVENT_ARCHIVED).
  const archived = Boolean(operatorProfile?.is_archived);
  const ready = Boolean(authority) && !loading && !pageError;

  // Barcode gun, wherever the focus is (search, card, a desk registration field): the scan opens that attendee's
  // card and never reaches a field or submits a form. The hook holds a burst back from its 4th key in a field,
  // so the first keys are typed before the burst is recognised; they are undone here.
  const burstStart = useRef<{ field: HTMLInputElement | HTMLTextAreaElement | null; value: string }>({ field: null, value: "" });
  useEffect(() => {
    if (!ready) return;
    let last = -Infinity;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
      const now = performance.now();
      if (now - last > BURST_GAP_MS) {
        const target = event.target;
        const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
        burstStart.current = { field, value: field?.value ?? "" };
      }
      last = now;
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [ready]);
  const onGunScan = (code: string) => {
    const { field, value } = burstStart.current;
    if (field?.isConnected && field.value !== value) restoreField(field, value);
    setWalkInOpen(false);
    setCameraOpen(false);
    void lookupBadge(code);
  };
  useHidScanner(onGunScan, ready);
  useWakeLock(ready);
  useEffect(() => {
    if (ready && standalone) recordOperatorLaunch("desk", `/reception/${eventId}`);
  }, [ready, standalone, eventId]);

  // "/" jumps to search from anywhere that is not a text field; Esc is «بعدی» unless a dialog or menu has it.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && !dialogOpen() && !document.querySelector('[role="menu"]')) {
        handleNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, handleNext]);

  if (loading && authority) {
    return (
      <div className="rx-station" role="status" aria-label={c.title}>
        <div className="h-14 border-b border-border-default bg-surface-panel" />
        <div className="space-y-3 p-4">
          <div className="skeleton h-14 rounded-control" />
          <div className="skeleton h-16 rounded-control" />
          <div className="skeleton h-16 rounded-control" />
        </div>
      </div>
    );
  }

  if (mode === "organizer" && !apiKey) {
    return <OrganizerKeyRequired locale={locale} onUseOperator={() => selectMode("operator")} />;
  }

  if (!authority) {
    return (
      <DeskSignIn
        locale={locale}
        standalone={standalone}
        onUseOrganizerKey={showModeSwitch ? () => selectMode("organizer") : null}
        sessionRejected={sessionRejected}
        hasDraft={hasDraft}
        verifyCode={verifyDeskCode}
      />
    );
  }

  if (pageError) {
    return (
      <OperatorGate
        locale={locale}
        kind="unavailable"
        title={pageError}
        body={null}
        action={
          <Button type="button" variant="primary" size="lg" isFullWidth icon="sync" onClick={() => setReloadNonce((n) => n + 1)}>
            {common.retry}
          </Button>
        }
        secondary={
          standalone ? undefined : (
            <LinkButton to="/organizer" variant="secondary" size="lg" isFullWidth>
              {c.congresses}
            </LinkButton>
          )
        }
      />
    );
  }

  const trimmedQuery = searchQuery.trim();
  const selectedTicketId = review.status === "idle" ? null : review.status === "ready" ? review.card.ticket_id : review.ticketId;
  const eventName = operatorProfile?.event_name;
  const op = operatorCopy[locale];
  const menuItems: OperatorMenuItem[] = [];
  if (showModeSwitch) {
    menuItems.push(
      mode === "operator"
        ? { id: "mode", label: c.organizerMode, icon: "key", disabled: submitting, onSelect: () => selectMode("organizer") }
        : { id: "mode", label: c.operatorMode, icon: "user", disabled: submitting, onSelect: () => selectMode("operator") }
    );
  }
  if (!standalone) menuItems.push({ id: "settings", label: c.congressSettings, icon: "sliders", onSelect: () => navigate(`/organizer/events/${eventId}`) });
  if (organizer?.canManageOperators) {
    menuItems.push({ id: "operators", label: c.deskOperators, icon: "users", onSelect: () => navigate(`/organizer/events/${eventId}/operators`) });
  }
  menuItems.push({ id: "language", label: op.menu.language, lang: op.menu.languageLang, icon: "globe", onSelect: () => setLocale(OTHER_LOCALE[locale]) });
  if (mode === "operator" && deskToken) menuItems.push({ id: "signout", label: op.menu.signOut, icon: "logout", danger: true, divider: true, onSelect: () => setSignOutOpen(true) });

  return (
    <div className="rx-station" style={eventAccentStyle(operatorProfile?.event_slug || eventId)}>
      <OperatorBar
        title={eventName || c.title}
        subtitle={operatorProfile?.operator_name}
        icon="id-card"
        status={
          archived ? (
            <StatusPill locale={locale} status="archived" detail={c.viewOnly} />
          ) : (
            <StatusPill locale={locale} status={offline ? "offline" : "online"} />
          )
        }
        menu={<OperatorMenu locale={locale} items={menuItems} header={operatorProfile?.operator_name} />}
      />

      <div className="rx-workspace">
        <div className="rx-list">
          <SearchBar
            inputRef={searchInputRef}
            query={searchQuery}
            onQueryChange={(query) => {
              setSearchQuery(query);
              if (!query) setBadgeNotice(null);
            }}
            onKeyDown={handleSearchKeyDown}
            searching={searching}
            searchFailed={searchFailed}
            onRetry={() => {
              setSearchFailed(false);
              setSearchNonce((n) => n + 1);
            }}
            onScanCamera={() => setCameraOpen(true)}
            onWalkIn={archived ? null : openWalkIn}
            badgeNotice={badgeNotice}
            locale={locale}
          />
          {draftRecovered && (
            <div className="px-4 pb-3">
              <Notice tone="info" onDismiss={() => setDraftRecovered(false)} dismissLabel={common.dismissMessage}>
                {c.draftRecovered}
              </Notice>
            </div>
          )}
          <SearchResults
            results={searchResults}
            trimmedQuery={trimmedQuery}
            searching={searching}
            selectedTicketId={selectedTicketId}
            onOpen={(ticketId) => void openReview(ticketId)}
            onRegisterWalkIn={archived ? null : registerFromSearch}
            locale={locale}
          />
        </div>

        <div className="rx-pane" data-open={review.status !== "idle"}>
          <AttendeeCard
            review={review}
            headingRef={reviewHeadingRef}
            eventName={eventName}
            printable={!mintedPass}
            onRetry={(ticketId) => void openReview(ticketId)}
            onNext={handleNext}
            onPrint={(card) => printBadge(card.ticket_id)}
            actions={archived ? null : cardActions}
            offline={offline}
            pointStorageKey={`congress_desk_point_${eventId}`}
            onNotice={showToast}
            locale={locale}
            timeZone={deskTimeZone(operatorProfile)}
          />
        </div>
      </div>

      {!archived && (
        <WalkInDialog
          isOpen={walkInOpen}
          onClose={() => setWalkInOpen(false)}
          draft={draft}
          onChange={updateDraft}
          tiers={tiers}
          submitting={submitting}
          nameError={nameError}
          mobileError={mobileError}
          formError={formError}
          duplicate={duplicate}
          onOpenExisting={(ticketId) => {
            setWalkInOpen(false);
            void openReview(ticketId);
          }}
          onSubmit={(e) => void handleRegisterWalkIn(e)}
          locale={locale}
        />
      )}

      <MintedDialog
        minted={mintedPass}
        eventName={eventName}
        onPrint={() => {
          if (!mintedPass) return;
          void printBadge(mintedPass.ticket_id).then((message) => {
            if (message) showToast(message);
          });
        }}
        onNext={handleNext}
        locale={locale}
      />

      <Dialog isOpen={cameraOpen} onClose={() => setCameraOpen(false)} title={c.cameraTitle} size="sm">
        <QrCameraInput locale={locale} disabled={!cameraOpen} autoStart onDecode={onCameraDecode} />
      </Dialog>

      <ConfirmDialog
        isOpen={signOutOpen}
        tone="danger"
        title={c.signOutTitle}
        description={hasDraft ? c.signOutBody : undefined}
        confirmLabel={op.menu.signOut}
        cancelLabel={common.cancel}
        onCancel={() => setSignOutOpen(false)}
        onConfirm={handleDeskLogout}
      />

      {toast && <Toast key={toast.id} message={toast.text} dismissLabel={common.close} onDismiss={() => setToast(null)} />}
    </div>
  );
}
