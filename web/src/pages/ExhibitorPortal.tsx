import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  formatApiError,
  type BoothOut,
  type LeadOut,
  type LeadScanInput,
  type LeadScanRequest,
} from "../api/client";
import {
  isStoredAttendeeToken,
  rejectAttendeeToken,
  SESSION_CHANGED_MESSAGE,
} from "../lib/attendeeSession";
import {
  useAttendeeLocale,
  formatLocalizedDate,
  formatLocalizedNumber,
} from "../lib/i18n";
import { SkipLink } from "../components/ui/SkipLink";
import { QrCameraInput } from "../components/booth/QrCameraInput";
import { boothSignInPath } from "../lib/safeRedirect";
import { clearOwnerScopedTickets } from "../lib/ticketCache";
import { eventAccentStyle } from "../lib/eventAccent";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { AitebAttribution } from "../components/brand/Aiteb";
import { CongressSignature } from "../components/brand/CongressSignature";
import { BoothGate } from "../components/booth/BoothGate";
import { LeadCard, LeadMonogram } from "../components/booth/LeadCard";
import { asciiDigits, formatMobile, telHref } from "../lib/mobile";
import { RatingChip, RatingControl } from "../components/booth/RatingControl";
import { TagPicker } from "../components/booth/TagPicker";
import { LEAD_RATINGS, RATING_META, asRating, type LeadRating } from "../components/booth/rating";
import "../styles/exhibitor.css";

const PRESET_TAG_KEYS = [
  "tagSendQuote",
  "tagScheduleDemo",
  "tagDecisionMaker",
  "tagProductSample",
  "tagGeneralInquiry",
  "tagUrgentFollowUp",
] as const;

// Remount per booth so a late response for booth A can never write into booth B's state.
export default function ExhibitorPortal() {
  const { boothId } = useParams<{ boothId: string }>();
  return <ExhibitorPortalContent key={boothId} />;
}

function ExhibitorPortalContent() {
  const { boothId } = useParams<{ boothId: string }>();
  const navigate = useNavigate();
  const { locale, setLocale, t, isRtl, dir } = useAttendeeLocale();

  const [booth, setBooth] = useState<BoothOut | null>(null);
  // All of this booth's leads; the search and rating filters below only narrow what is shown, so
  // the counts always describe the whole booth.
  const [allLeads, setAllLeads] = useState<LeadOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [leadsFailed, setLeadsFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [eventContext, setEventContext] = useState<{ name: string; slug: string } | null>(null);
  // Result of the last capture: who was captured, and whether the lead already existed.
  const [capturedLead, setCapturedLead] = useState<{ lead: LeadOut; existed: boolean } | null>(null);
  const [touched, setTouched] = useState({ rating: false, tags: false });
  const captureInFlight = useRef(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Search & filter state
  const [searchFilter, setSearchFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState<string>("");

  // Capture Lead Modal state
  const [isCaptureModalOpen, setIsCaptureModalOpen] = useState(false);
  const [qrSecret, setQrSecret] = useState("");
  const [captureRating, setCaptureRating] = useState<"HOT" | "WARM" | "COLD">("WARM");
  const [captureTags, setCaptureTags] = useState<string[]>([]);
  const [captureNotes, setCaptureNotes] = useState("");
  const [submittingCapture, setSubmittingCapture] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);

  // Qualification Drawer / Edit Modal state
  const [editingLead, setEditingLead] = useState<LeadOut | null>(null);
  const [editRating, setEditRating] = useState<"HOT" | "WARM" | "COLD">("WARM");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState("");
  const [customTagInput, setCustomTagInput] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState<string | null>(null);

  // CSV Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ATTENDEE_TOKEN_STORAGE)
      : null;

  const sessionRef = useRef<string | null>(token);

  useEffect(() => {
    let isMounted = true;
    // Another account must never inherit the previous staff member's booth view or leads.
    if (sessionRef.current !== token) {
      sessionRef.current = token;
      setBooth(null);
      setAllLeads([]);
      setEventContext(null);
      setCapturedLead(null);
      setEditingLead(null);
      setAuthError(null);
    }
    if (!boothId) return;
    // Without a token the render returns the sign-in gate before `loading` is ever read, and the
    // fetch below sets `loading` itself once a token exists, so no reset is needed here.
    if (!token) return;

    const fetchData = async () => {
      setLoading(true);
      setAuthError(null);
      setLoadFailed(false);
      setLeadsFailed(false);
      try {
        const client = createApiClient({ kind: "user", token });
        const [boothRes, leadsRes, accessRes] = await Promise.all([
          client.GET("/api/booths/{booth_id}", { params: { path: { booth_id: boothId } } }),
          client.GET("/api/booths/{booth_id}/leads", { params: { path: { booth_id: boothId } } }),
          client.GET("/api/me/access"),
        ]);

        if (!isMounted) return;
        // The stored session changed while the request was in flight: ignore this response and
        // never delete the newer session. The re-render re-reads the current token.
        if (!isStoredAttendeeToken(token)) {
          setLoading(false);
          return;
        }
        if (boothRes.response.status === 401 || leadsRes.response.status === 401) {
          rejectAttendeeToken(token);
        }

        if (boothRes.error) {
          if (boothRes.response.status >= 500) setLoadFailed(true);
          else setAuthError(formatApiError(boothRes.error));
        } else if (boothRes.data) {
          setBooth(boothRes.data);
          const mine = accessRes.data?.events.find((e) => e.booth_ids.includes(boothId));
          setEventContext(mine ? { name: mine.event_name, slug: mine.event_slug } : null);
        }

        if (leadsRes.data) {
          setAllLeads(leadsRes.data);
        } else if (!boothRes.error && leadsRes.response.status !== 401) {
          // The booth itself is fine; only its lead list is unavailable. Nothing stale is shown.
          setLeadsFailed(true);
        }
      } catch {
        if (isMounted) setLoadFailed(true);
      }
      if (isMounted) setLoading(false);
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [boothId, token, reloadNonce]);

  const refreshLeads = async () => {
    if (!boothId || !token || !isStoredAttendeeToken(token)) return;
    try {
      const client = createApiClient({ kind: "user", token });
      const { data, response } = await client.GET("/api/booths/{booth_id}/leads", {
        params: { path: { booth_id: boothId } },
      });
      const stillCurrent = isStoredAttendeeToken(token);
      if (response.status === 401) rejectAttendeeToken(token);
      if (data && stillCurrent) setAllLeads(data);
    } catch {
      // The list keeps its last confirmed state.
    }
  };

  const leads = useMemo(() => {
    // Persian digits and spaces typed into the search still find a stored 09xxxxxxxxx number.
    const needle = asciiDigits(searchFilter.trim().toLowerCase());
    const digits = needle.replace(/[\s-]/g, "");
    return allLeads.filter((l) => {
      if (ratingFilter && l.rating !== ratingFilter) return false;
      if (!needle) return true;
      if (/^\d{4,}$/.test(digits) && l.attendee_mobile?.includes(digits)) return true;
      return [l.attendee_name, l.organization, l.title, l.notes, ...(l.tags ?? [])].join(" ").toLowerCase().includes(needle);
    });
  }, [allLeads, searchFilter, ratingFilter]);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      clearOwnerScopedTickets(localStorage.getItem(ATTENDEE_TOKEN_STORAGE));
      localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    }
    navigate(boothId ? boothSignInPath(boothId) : "/");
  };

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  const resetCapture = () => {
    setQrSecret("");
    setCaptureRating("WARM");
    setCaptureTags([]);
    setCaptureNotes("");
    setTouched({ rating: false, tags: false });
    setCaptureError(null);
    setCaptureFeedback(null);
    setCapturedLead(null);
  };

  const handleCaptureLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boothId || !token || !qrSecret.trim() || captureInFlight.current) return;
    if (!isStoredAttendeeToken(token)) {
      setCaptureError(SESSION_CHANGED_MESSAGE);
      return;
    }

    captureInFlight.current = true;
    setSubmittingCapture(true);
    setCaptureError(null);
    setCaptureFeedback(null);
    try {
      const client = createApiClient({ kind: "user", token });
      // Only qualification the operator actually chose is sent, so scanning an attendee who is
      // already a lead never resets their rating or tags.
      const input: LeadScanInput = {
        qr_secret: qrSecret.trim(),
        ...(touched.rating ? { rating: captureRating } : {}),
        ...(touched.tags ? { tags: captureTags } : {}),
        ...(captureNotes.trim() ? { notes: captureNotes.trim() } : {}),
      };
      const { data, error: err, response } = await client.POST("/api/booths/{booth_id}/leads/scan", {
        params: { path: { booth_id: boothId } },
        // Defaulted fields are optional on the wire; the generated type wrongly requires them.
        body: input as LeadScanRequest,
      });

      const stillCurrent = isStoredAttendeeToken(token);
      if (response.status === 401) rejectAttendeeToken(token);
      if (!stillCurrent) return;
      if (err) {
        setCaptureError(
          response.status === 404
            ? isRtl ? "این کد کارت شرکت‌کننده معتبر نیست." : "That badge code is not valid."
            : response.status === 400
              ? isRtl ? "این کارت متعلق به همایش دیگری است." : "That badge belongs to a different congress."
              : response.status === 403
                ? isRtl ? "شما اجازهٔ ثبت مشتری برای این غرفه را ندارید." : "You are not authorized to capture leads for this booth."
                : formatApiError(err)
        );
      } else if (data) {
        // 201 = new lead, 200 = this attendee was already a lead of this booth.
        const existed = response.status === 200;
        setCapturedLead({ lead: data, existed });
        setCaptureFeedback(existed ? t.leadUpdatedSuccess : t.leadCapturedSuccess);
        setQrSecret("");
        void refreshLeads();
      }
    } catch {
      // The request may or may not have reached the server. Nothing is retried automatically;
      // scanning the same badge again is safe (it updates the same lead), but check the list first.
      setCaptureError(
        isRtl
          ? "اتصال قطع شد و مشخص نیست مشتری ثبت شده یا نه. فهرست مشتریان را بررسی کنید؛ اسکن دوباره همین کارت فقط همان مشتری را به‌روز می‌کند."
          : "The connection dropped, so it is not known whether the lead was saved. Check the lead list; scanning the same badge again only updates the same lead."
      );
    } finally {
      captureInFlight.current = false;
      setSubmittingCapture(false);
    }
  };

  useEffect(() => {
    if (!isCaptureModalOpen || capturedLead) return;
    // A keyboard-wedge (USB/HID) scanner types into the focused field and presses Enter.
    const timer = setTimeout(() => codeInputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [isCaptureModalOpen, capturedLead]);

  const handleOpenEdit = (lead: LeadOut) => {
    setEditingLead(lead);
    setEditRating(
      lead.rating === "HOT" || lead.rating === "COLD" ? lead.rating : "WARM"
    );
    setEditTags(lead.tags || []);
    setEditNotes(lead.notes || "");
    setCustomTagInput("");
    setEditError(null);
    setEditFeedback(null);
  };

  const handleSaveQualification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boothId || !token || !editingLead) return;
    if (!isStoredAttendeeToken(token)) {
      setEditError(SESSION_CHANGED_MESSAGE);
      return;
    }

    setSavingLead(true);
    setEditError(null);
    setEditFeedback(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const { data, error: err, response } = await client.PATCH("/api/booths/{booth_id}/leads/{lead_id}", {
        params: { path: { booth_id: boothId, lead_id: editingLead.id } },
        body: { rating: editRating, tags: editTags, notes: editNotes.trim() },
      });

      const stillCurrent = isStoredAttendeeToken(token);
      if (response.status === 401) rejectAttendeeToken(token);
      if (!stillCurrent) return;
      if (err) {
        setEditError(formatApiError(err));
      } else if (data) {
        setAllLeads((prev) => prev.map((l) => (l.id === editingLead.id ? data : l)));
        setCapturedLead((prev) => (prev && prev.lead.id === data.id ? { ...prev, lead: data } : prev));
        setEditFeedback(t.qualificationSavedSuccess);
        setTimeout(() => {
          setEditingLead(null);
          setEditFeedback(null);
        }, 1000);
      }
    } catch {
      // The same values can be saved again safely; the form keeps what was typed.
      setEditError(isRtl ? "اتصال قطع شد؛ تغییرات ذخیره نشد. اطلاعات واردشده حفظ شده است، دوباره ذخیره کنید." : "The connection dropped; your changes were not confirmed. Your entry is kept, save again.");
    } finally {
      setSavingLead(false);
    }
  };

  const handleToggleTag = (tag: string, currentTags: string[], setter: (tags: string[]) => void) => {
    if (currentTags.includes(tag)) {
      setter(currentTags.filter((t) => t !== tag));
    } else {
      setter([...currentTags, tag]);
    }
  };

  const handleAddCustomTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = customTagInput.trim();
      if (trimmed && !editTags.includes(trimmed)) {
        setEditTags((prev) => [...prev, trimmed]);
        setCustomTagInput("");
      }
    }
  };

  const handleExportCsv = async () => {
    if (!boothId || !booth || !token) return;
    if (!isStoredAttendeeToken(token)) {
      setExportError(SESSION_CHANGED_MESSAGE);
      return;
    }
    setIsExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const { data: blob, response } = await client.GET("/api/booths/{booth_id}/leads/export-csv", {
        params: { path: { booth_id: boothId } },
        parseAs: "blob",
      });
      const stillCurrent = isStoredAttendeeToken(token);
      if (response.status === 401) rejectAttendeeToken(token);
      // No download or completion feedback for a session that has since changed.
      if (!stillCurrent) return;
      if (!response.ok || !blob) {
        setExportError(isRtl ? "دریافت CSV انجام نشد. دسترسی خود را بررسی کنید." : "Failed to export leads. Please verify authorization.");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${booth.slug || "booth"}-leads.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setExportNotice(isRtl ? `دریافت ${link.download} آغاز شد (همهٔ مشتریان این غرفه).` : `Download of ${link.download} started (all leads of this booth).`);
    } catch {
      setExportError(isRtl ? "خطای شبکه هنگام دریافت CSV." : "Network error while exporting CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  // Counts always describe the whole booth, never the filtered view.
  const ratingCounts: Record<LeadRating, number> = { HOT: 0, WARM: 0, COLD: 0 };
  for (const lead of allLeads) {
    if (lead.rating === "HOT" || lead.rating === "WARM" || lead.rating === "COLD") ratingCounts[lead.rating] += 1;
  }
  const tagPresets = PRESET_TAG_KEYS.map((key) => t[key]);
  const workspaceLabel = isRtl ? "پیشخوان غرفه" : "Booth workspace";
  const spinner = <span aria-hidden="true" className="size-4 rounded-full border-2 border-current border-e-transparent animate-spin" />;

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="key"
        eyebrow={workspaceLabel}
        title={t.unauthenticatedExhibitorTitle}
        actions={
          <LinkButton to={boothId ? boothSignInPath(boothId) : "/"} variant="primary" size="lg" isFullWidth>
            <span>{isRtl ? "ورود به حساب غرفه" : "Sign In to Booth Workspace"}</span>
            <Icon name="arrow-right" size={18} />
          </LinkButton>
        }
      >
        <p>{t.unauthenticatedExhibitorDesc}</p>
      </BoothGate>
    );
  }

  // Loading skeleton
  if (loading && !booth) {
    return (
      <div dir={dir} lang={locale} aria-busy="true" className="min-h-dvh bg-surface-page font-sans">
        <div className="bg-surface-ink bg-meridian-ink">
          <div className="mx-auto max-w-6xl space-y-4 px-4 pb-20 pt-6 sm:px-6 lg:px-8">
            <div className="h-8 w-40 rounded-lg bg-white/10" />
            <div className="h-11 w-3/4 max-w-lg rounded-xl bg-white/10" />
            <div className="h-14 w-64 max-w-full rounded-xl bg-white/[0.06]" />
          </div>
        </div>
        <div className="mx-auto -mt-10 max-w-6xl space-y-4 px-4 sm:px-6 lg:px-8">
          <div className="skeleton h-40 shape-arc" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="wifi-off"
        tone="warning"
        eyebrow={workspaceLabel}
        title={isRtl ? "بارگذاری غرفه انجام نشد" : "The booth could not be loaded"}
        actions={
          <Button type="button" variant="primary" size="lg" isFullWidth onClick={() => setReloadNonce((n) => n + 1)}>
            <Icon name="sync" size={18} />
            <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
          </Button>
        }
      >
        <p>{isRtl ? "اتصال یا سرور مشکل دارد. نشست شما حفظ شده است." : "There is a connection or server problem. You are still signed in."}</p>
      </BoothGate>
    );
  }

  // Unauthorized (403 Forbidden) or Not Found view
  if (authError || !booth) {
    return (
      <BoothGate
        locale={locale}
        dir={dir}
        icon="lock"
        tone="danger"
        eyebrow={workspaceLabel}
        title={t.unauthorizedExhibitorTitle}
        actions={
          <>
            {boothId && (
              <LinkButton to={boothSignInPath(boothId)} variant="primary" size="lg" isFullWidth>
                {isRtl ? "ورود با حساب دیگر" : "Sign in with a different account"}
              </LinkButton>
            )}
            <LinkButton to="/" variant="ghost" size="md" isFullWidth>
              <span>{t.platformHome}</span>
              <Icon name="arrow-right" size={16} />
            </LinkButton>
          </>
        }
      >
        <p>{authError ?? t.unauthorizedExhibitorDesc}</p>
      </BoothGate>
    );
  }

  const filtersActive = Boolean(searchFilter || ratingFilter);
  const editingRole = editingLead ? [editingLead.title, editingLead.organization].filter(Boolean).join(" · ") : "";
  const capturedRole = capturedLead ? [capturedLead.lead.title, capturedLead.lead.organization].filter(Boolean).join(" · ") : "";
  const inkControl =
    "press inline-flex min-h-[44px] items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold text-white/85 ring-1 ring-white/15 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid cursor-pointer";
  const filterChips: { value: "" | LeadRating; label: string; count: number }[] = [
    { value: "", label: t.ratingFilterAll, count: allLeads.length },
    ...LEAD_RATINGS.map((rating) => ({ value: rating, label: RATING_META[rating].label[locale], count: ratingCounts[rating] })),
  ];

  return (
    <div
      dir={dir}
      lang={locale}
      style={eventAccentStyle(eventContext?.slug ?? booth.event_id)}
      className="booth-portal flex min-h-dvh flex-col bg-surface-page font-sans text-text-primary"
    >
      <SkipLink targetId="exhibitor-main-content">
        {isRtl ? "پرش به محتوای اصلی پرتال غرفه" : "Skip to main booth lead content"}
      </SkipLink>

      {/* 1. Booth identity on ink: congress, booth placard, authority, lead ledger */}
      <header className="relative isolate overflow-hidden bg-surface-ink text-white">
        <CongressSignature
          seed={eventContext?.slug ?? booth.id}
          tone="ink"
          className="pointer-events-none absolute inset-0 -z-10 size-full opacity-80 rtl:-scale-x-100"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-surface-ink via-surface-ink/85 to-surface-ink/20 rtl:bg-linear-to-l" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-meridian-ink" />

        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:px-8">
          <p className="flex min-w-0 items-center gap-2.5 text-[13px] font-semibold text-white/90">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-[var(--event-accent-glow)] ring-1 ring-white/15">
              <Icon name="booth" size={18} />
            </span>
            <span className="truncate">{workspaceLabel}</span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={toggleLocale}
              className={inkControl}
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              <Icon name="globe" size={17} />
              <span>{t.languageToggle}</span>
            </button>
            <button type="button" onClick={handleLogout} className={inkControl}>
              <Icon name="logout" size={17} />
              <span className="max-sm:sr-only">{t.logout}</span>
            </button>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-14 pt-6 sm:px-6 md:gap-8 md:pb-20 md:pt-9 lg:grid-cols-12 lg:items-end lg:gap-10 lg:px-8 lg:pt-12">
          <div className="min-w-0 lg:col-span-7 motion-safe:animate-rise">
            {eventContext && (
              <p data-testid="booth-event" className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--event-accent-glow)] shadow-[0_0_0_4px_rgb(255_255_255/0.08)]" />
                <span className="min-w-0 break-words">{eventContext.name}</span>
              </p>
            )}
            <h1 className="mt-3 text-[2.1rem] font-bold leading-[1.06] tracking-[-0.03em] text-white break-words sm:text-5xl lg:text-[3.5rem]">
              {booth.name}
            </h1>

            <div className="booth-placard mt-6 grid max-w-full grid-cols-[auto_minmax(0,1fr)] sm:inline-grid">
              <div className="booth-placard__cell px-4 py-2.5">
                <p className="booth-ink-label">{isRtl ? "جایگاه" : "Stand"}</p>
                <p className="mt-1 text-[15px] font-semibold text-white">
                  {booth.location || (isRtl ? "سالن اصلی نمایشگاه" : "Exhibition Floor")}
                </p>
              </div>
              <div className="booth-placard__cell min-w-0 px-4 py-2.5">
                <p className="booth-ink-label">{isRtl ? "کد غرفه" : "Booth code"}</p>
                <p className="ltr-isolate mt-1 break-all font-mono text-[14px] text-white/90">{booth.slug}</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
              <span className="inline-flex items-center gap-1.5 text-white/75">
                <Icon name="shield" size={16} className="text-[var(--event-accent-glow)]" />
                {t.boothAuthorizedBadge}
              </span>
              {eventContext && boothId && (
                <Link
                  to={`/e/${encodeURIComponent(eventContext.slug)}/booths/${encodeURIComponent(boothId)}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid"
                >
                  <span>{isRtl ? "پروفایل عمومی غرفه" : "Public booth profile"}</span>
                  <Icon name="arrow-up-right" size={15} />
                </Link>
              )}
            </div>
          </div>

          {/* Lead ledger: real counts of this booth */}
          <div className="min-w-0 lg:col-span-5">
            <div className="border-t border-white/15 pt-4 lg:rounded-2xl lg:border lg:border-white/12 lg:bg-surface-ink/80 lg:p-6">
              <div className="flex items-end gap-3">
                <p className="text-[2.75rem] font-bold leading-none tracking-[-0.04em] text-white tabular sm:text-5xl">
                  {formatLocalizedNumber(allLeads.length, locale)}
                </p>
                <p className="pb-1 text-sm font-medium text-white/70">{t.leadsCountLabel}</p>
              </div>
              <div aria-hidden="true" className="booth-dist mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/10">
                {LEAD_RATINGS.map((rating) =>
                  ratingCounts[rating] > 0 ? (
                    <span key={rating} className={`${RATING_META[rating].tone} bg-[var(--rating-glow)]`} style={{ flexGrow: ratingCounts[rating] }} />
                  ) : null
                )}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2">
                {LEAD_RATINGS.map((rating) => (
                  <div key={rating} className={`${RATING_META[rating].tone} min-w-0`}>
                    <dt className="flex items-center gap-1.5 text-[12px] font-medium text-white/65">
                      <Icon name={RATING_META[rating].icon} size={14} className="shrink-0 text-[var(--rating-glow)]" />
                      <span className="truncate">{RATING_META[rating].label[locale]}</span>
                    </dt>
                    <dd className="mt-1 text-xl font-bold text-white tabular">{formatLocalizedNumber(ratingCounts[rating], locale)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="exhibitor-main-content" tabIndex={-1} className="relative mx-auto -mt-8 w-full max-w-6xl flex-1 px-4 focus:outline-none sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">
          {/* 2. Capture station (phones use the bottom dock instead) */}
          <section aria-labelledby="capture-heading" className="hidden md:block lg:sticky lg:top-6 lg:col-span-4">
            <div className="overflow-hidden border border-border-default bg-surface-panel shadow-lift shape-arc-lg">
              <div className="p-6">
                <p className="eyebrow">
                  <span className="font-mono">01</span>
                  <span>{isRtl ? "ثبت لید" : "Capture"}</span>
                </p>
                <h2 id="capture-heading" className="mt-3 text-xl font-bold leading-snug tracking-[-0.02em] text-text-primary">
                  {isRtl ? "کارت بازدیدکنندهٔ بعدی را اسکن کنید" : "Scan the next visitor's badge"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                  {isRtl
                    ? "با دوربین، بارکدخوان یا تایپ کد. اسکن دوبارهٔ یک کارت فقط همان لید را به‌روز می‌کند."
                    : "Camera, barcode reader or typed code. Scanning a badge again only updates the same lead."}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="xl"
                  isFullWidth
                  onClick={() => {
                    setIsCaptureModalOpen(true);
                    resetCapture();
                  }}
                  className="mt-6"
                >
                  <Icon name="scan" size={22} />
                  <span className="whitespace-normal">{t.captureLeadAction}</span>
                </Button>
              </div>
              <p className="flex items-start gap-2.5 border-t border-border-subtle bg-surface-panel-subtle px-6 py-3.5 text-xs leading-relaxed text-text-muted">
                <Icon name="keyboard" size={16} className="mt-px shrink-0" />
                <span>
                  {isRtl
                    ? "بارکدخوان USB پس از باز شدن پنجرهٔ ثبت، کد را مستقیم در کادر کد وارد می‌کند."
                    : "Once capture is open, a USB barcode reader types straight into the code field."}
                </span>
              </p>
            </div>
          </section>

          {/* 3. Leads worklist */}
          <section aria-labelledby="leads-heading" className="min-w-0 space-y-4 lg:col-span-8">
            <div className="rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft sm:p-6">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-6">
                <div className="min-w-0 sm:flex-1">
                  <p className="eyebrow">
                    <span className="font-mono">02</span>
                    <span>{isRtl ? "لیدها" : "Leads"}</span>
                  </p>
                  <h2 id="leads-heading" className="mt-2.5 text-xl font-bold tracking-[-0.02em] text-text-primary sm:text-2xl">
                    {t.leadsListHeading}
                  </h2>
                  <p className="mt-1 text-sm text-text-secondary">{t.exhibitorPortalDesc}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  disabled={isExporting || allLeads.length === 0}
                  onClick={handleExportCsv}
                  className="shrink-0"
                >
                  {isExporting ? spinner : <Icon name="download" size={17} />}
                  <span>{isExporting ? t.exportingCsvAction : t.exportCsvAction}</span>
                </Button>
              </div>

              <div className="relative mt-5">
                <Icon name="search" size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder={t.searchLeadsPlaceholder}
                  aria-label={t.searchLeadsPlaceholder}
                  className="ui-input ps-11 pe-12"
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter("")}
                    aria-label={isRtl ? "پاک کردن جستجو" : "Clear search"}
                    className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
                  >
                    <Icon name="x" size={17} />
                  </button>
                )}
              </div>

              <div role="group" aria-label={isRtl ? "فیلتر سطح تمایل" : "Filter by rating"} className="mt-3 flex flex-wrap gap-1.5">
                {filterChips.map((chip) => {
                  const on = ratingFilter === chip.value;
                  const meta = chip.value ? RATING_META[chip.value] : null;
                  return (
                    <button
                      key={chip.value || "all"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRatingFilter(chip.value)}
                      className={`${meta?.tone ?? ""} press inline-flex min-h-[44px] items-center gap-2 rounded-full border ps-3 pe-1.5 text-[13px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                        on
                          ? meta
                            ? "border-transparent bg-[var(--rating-solid)] text-white"
                            : "border-transparent bg-surface-ink text-white"
                          : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
                      }`}
                    >
                      {meta && <Icon name={meta.icon} size={15} className={on ? "" : "text-[var(--rating-solid)]"} />}
                      <span>{chip.label}</span>
                      <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[12px] tabular ${on ? "bg-white/20" : "bg-surface-panel-subtle text-text-muted"}`}>
                        {formatLocalizedNumber(chip.count, locale)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {exportNotice && (
              <div role="status" className="flex items-start gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg p-3.5 text-[13px] leading-relaxed text-status-success-text">
                <Icon name="check-circle" size={18} className="shrink-0" />
                <span className="min-w-0 break-words">{exportNotice}</span>
              </div>
            )}

            {exportError && (
              <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] leading-relaxed text-status-danger-text">
                <Icon name="alert" size={18} className="shrink-0" />
                <span>{exportError}</span>
              </div>
            )}

            {leadsFailed && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] text-status-danger-text">
                <span className="flex items-center gap-2.5">
                  <Icon name="alert" size={18} className="shrink-0" />
                  <span>{isRtl ? "فهرست مشتریان بارگذاری نشد." : "The lead list could not be loaded."}</span>
                </span>
                <Button type="button" size="md" variant="secondary" onClick={() => setReloadNonce((n) => n + 1)}>
                  <Icon name="sync" size={16} />
                  <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
                </Button>
              </div>
            )}

            {filtersActive && !loading && (
              <p role="status" className="px-1 text-[13px] text-text-muted">
                {isRtl
                  ? `نمایش ${formatLocalizedNumber(leads.length, locale)} از ${formatLocalizedNumber(allLeads.length, locale)} مشتری`
                  : `Showing ${leads.length} of ${allLeads.length} leads`}
              </p>
            )}

            {loading ? (
              <div className="space-y-3" aria-busy="true">
                <div className="skeleton h-44 rounded-2xl" />
                <div className="skeleton h-44 rounded-2xl" />
              </div>
            ) : leads.length === 0 ? (
              <div className="relative overflow-hidden border border-dashed border-border-strong bg-surface-panel px-6 py-12 text-center shape-arc sm:py-16">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
                  <Icon name={filtersActive ? "filter" : "users"} size={26} />
                </span>
                <h3 className="mx-auto mt-4 max-w-md text-lg font-bold text-text-primary">
                  {filtersActive ? t.noLeadsFilterMatch : t.noLeadsTitle}
                </h3>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
                  {filtersActive
                    ? (isRtl ? "فیلترها را پاک کنید یا عبارت دیگری را جستجو نمایید." : "Clear active filters or try a different search keyword.")
                    : t.noLeadsDesc}
                </p>
                {!filtersActive && (
                  <Button type="button" variant="primary" size="md" onClick={() => setIsCaptureModalOpen(true)} className="mt-6">
                    <Icon name="scan" size={18} />
                    <span>{t.captureLeadAction}</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    locale={locale}
                    capturedAt={formatLocalizedDate(lead.created_at, locale)}
                    labels={{
                      captured: t.capturedAtLabel,
                      tier: t.tierColumnLabel,
                      mobile: isRtl ? "موبایل" : "Mobile",
                      call: isRtl ? "تماس با" : "Call",
                      text: isRtl ? "پیامک" : "Text",
                      notes: t.notesLabel,
                      qualify: t.qualifyLeadButton,
                    }}
                    onQualify={() => handleOpenEdit(lead)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      <footer className="mx-auto mt-14 w-full max-w-6xl px-4 pb-32 sm:px-6 md:pb-10 lg:px-8">
        <div className="rule-arc" />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-5 text-xs text-text-muted">
          <span className="flex items-center gap-2">
            <Icon name="lock" size={14} />
            <span>{isRtl ? "لیدها فقط برای کارکنان همین غرفه قابل مشاهده‌اند." : "Leads are visible only to this booth's staff."}</span>
          </span>
          <AitebAttribution locale={locale} />
        </div>
      </footer>

      {/* 4. Capture dialog: camera / manual code, optional quick qualification, confirmation */}
      <Dialog
        isOpen={isCaptureModalOpen}
        onClose={() => {
          if (!submittingCapture) {
            setIsCaptureModalOpen(false);
            resetCapture();
          }
        }}
        title={t.captureLeadModalTitle}
        description={t.captureLeadModalDesc}
        size="lg"
      >
        {capturedLead && (
          <div
            className={`${capturedLead.existed ? "booth-confirm-existing" : "booth-confirm-new"} space-y-4`}
            data-testid="capture-result"
          >
            <div role="status" className="rounded-2xl border border-[var(--confirm-border)] bg-[var(--confirm-bg)] p-4 sm:p-5">
              <div className="flex items-start gap-3.5">
                <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--confirm-solid)] text-white shadow-[0_10px_24px_-12px_var(--confirm-solid)] motion-safe:animate-pop">
                  <Icon name={capturedLead.existed ? "layers" : "check"} size={24} strokeWidth={2.25} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="booth-meta-label text-[var(--confirm-fg)]">
                    {capturedLead.existed ? (isRtl ? "لید تکراری" : "Existing lead") : (isRtl ? "لید جدید" : "New lead")}
                  </p>
                  <p className="mt-1 text-base font-bold leading-snug text-text-primary">{captureFeedback?.replace(/^✓\s*/, "")}</p>
                  {capturedLead.existed && (
                    <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                      {isRtl ? "این شرکت‌کننده قبلاً مشتری این غرفه بود؛ سطح علاقه و برچسب‌های قبلی حفظ شد." : "This attendee was already a lead of this booth; their rating and tags were kept."}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3.5 rounded-2xl border border-border-default bg-surface-panel p-4">
              <LeadMonogram name={capturedLead.lead.attendee_name} rating={capturedLead.lead.rating} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold leading-snug tracking-[-0.01em] text-text-primary break-words">{capturedLead.lead.attendee_name}</p>
                {capturedRole && <p className="mt-0.5 text-[13px] text-text-secondary break-words">{capturedRole}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <RatingChip rating={capturedLead.lead.rating} locale={locale} size="sm" />
                  <Badge variant="neutral" size="sm">{capturedLead.lead.ticket_tier_name}</Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="secondary" size="lg" onClick={() => handleOpenEdit(capturedLead.lead)}>
                <Icon name="sliders" size={18} />
                <span>{t.qualifyLeadButton}</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={() => {
                  resetCapture();
                  setTimeout(() => codeInputRef.current?.focus(), 60);
                }}
              >
                <span>{isRtl ? "شرکت‌کننده بعدی" : "Next attendee"}</span>
                <Icon name="arrow-right" size={18} />
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="md"
              isFullWidth
              onClick={() => {
                setIsCaptureModalOpen(false);
                resetCapture();
              }}
            >
              {isRtl ? "پایان" : "Done"}
            </Button>
          </div>
        )}
        {!capturedLead && (
          <form onSubmit={handleCaptureLead} className="space-y-5">
            <QrCameraInput
              isRtl={isRtl}
              disabled={submittingCapture}
              onDecode={(value) => {
                setQrSecret(value);
                setCaptureError(null);
              }}
            />

            <div aria-hidden="true" className="flex items-center gap-3 text-xs font-medium text-text-muted">
              <span className="h-px flex-1 bg-border-default" />
              <span>{isRtl ? "یا کد را وارد کنید" : "or enter the code"}</span>
              <span className="h-px flex-1 bg-border-default" />
            </div>

            <div>
              <label htmlFor="booth-badge-code" className="ui-label">
                {t.badgeCodeLabel} <span aria-hidden="true" className="text-status-danger-solid">*</span>
              </label>
              <div className="relative">
                <Icon name="keyboard" size={19} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  id="booth-badge-code"
                  ref={codeInputRef}
                  type="text"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={qrSecret}
                  onChange={(e) => setQrSecret(e.target.value)}
                  placeholder={t.badgeCodePlaceholder}
                  className="ui-input min-h-[54px] ps-11 font-mono text-[17px] placeholder:font-sans placeholder:text-base"
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{t.badgeCodeHint}</p>
            </div>

            <div className="space-y-5 rounded-2xl border border-border-subtle bg-surface-page p-4">
              <p className="booth-meta-label flex items-center gap-2">
                <Icon name="sliders" size={14} />
                <span>{isRtl ? "ارزیابی سریع (اختیاری)" : "Quick qualification (optional)"}</span>
              </p>
              <RatingControl
                label={t.interestRatingLabel}
                value={touched.rating ? captureRating : null}
                onChange={(rating) => {
                  setCaptureRating(rating);
                  setTouched((p) => ({ ...p, rating: true }));
                }}
                locale={locale}
                hint={
                  isRtl
                    ? "اگر انتخاب نکنید، لید جدید «علاقه متوسط» ثبت می‌شود و لید موجود سطح قبلی خود را نگه می‌دارد."
                    : "Leave unset and a new lead starts as Warm, while an existing lead keeps its rating."
                }
              />
              <TagPicker
                label={t.followUpTagsLabel}
                presets={tagPresets}
                selected={captureTags}
                onToggle={(tag) => {
                  handleToggleTag(tag, captureTags, setCaptureTags);
                  setTouched((p) => ({ ...p, tags: true }));
                }}
              />
              <div>
                <label htmlFor="booth-capture-notes" className="ui-label">{t.notesLabel}</label>
                <textarea
                  id="booth-capture-notes"
                  rows={2}
                  value={captureNotes}
                  onChange={(e) => setCaptureNotes(e.target.value)}
                  placeholder={t.notesPlaceholder}
                  className="ui-textarea min-h-[4.5rem]"
                />
              </div>
            </div>
            <div className="sticky -bottom-6 z-10 -mx-5 -mb-6 border-t border-border-subtle bg-surface-panel px-5 pb-5 pt-3 sm:-bottom-7 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-6">
              {captureError && (
                <div role="alert" aria-live="assertive" className="mb-3 flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-[13px] leading-relaxed text-status-danger-text motion-safe:animate-pop">
                  <Icon name="alert" size={18} className="shrink-0" />
                  <span>{captureError}</span>
                </div>
              )}
              <div className="flex gap-2 sm:justify-end">
                {/* Phones dismiss with the header close button; the bar keeps the one action that matters. */}
                <Button type="button" variant="ghost" size="lg" disabled={submittingCapture} onClick={() => setIsCaptureModalOpen(false)} className="shrink-0 max-sm:hidden">
                  {isRtl ? "انصراف" : "Cancel"}
                </Button>
                <Button type="submit" variant="primary" size="lg" disabled={submittingCapture} className="min-w-0 flex-1 sm:flex-none sm:min-w-[15rem]">
                  {submittingCapture ? spinner : <Icon name="user-plus" size={19} className="shrink-0" />}
                  <span className="whitespace-normal leading-tight">{submittingCapture ? (isRtl ? "در حال ثبت…" : "Recording…") : t.saveLeadAction}</span>
                </Button>
              </div>
            </div>
          </form>
        )}
      </Dialog>

      {/* 5. Lead detail + qualification */}
      <Dialog
        isOpen={Boolean(editingLead)}
        onClose={() => {
          if (!savingLead) setEditingLead(null);
        }}
        title={editingLead ? `${t.qualificationDrawerTitle}: ${editingLead.attendee_name}` : ""}
        description={t.qualificationDrawerDesc}
        size="lg"
      >
        {editingLead && (
          <form onSubmit={handleSaveQualification} className="space-y-5">
            <div className={`${RATING_META[asRating(editingLead.rating)].tone} flex items-start gap-3.5 rounded-2xl border border-border-default bg-surface-page p-4`}>
              <LeadMonogram name={editingLead.attendee_name} rating={editingLead.rating} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-bold leading-snug text-text-primary break-words">{editingLead.attendee_name}</p>
                    {editingRole && <p className="mt-0.5 text-[13px] text-text-secondary break-words">{editingRole}</p>}
                  </div>
                  <RatingChip rating={editingLead.rating} locale={locale} size="sm" />
                </div>
                {editingLead.attendee_mobile && (
                  <a
                    href={telHref(editingLead.attendee_mobile)}
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-[13px] font-medium text-action-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <Icon name="phone" size={15} className="shrink-0" />
                    <bdi dir="ltr" className="min-w-0 break-all font-mono text-[12.5px]">{formatMobile(editingLead.attendee_mobile, locale)}</bdi>
                  </a>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3">
                  <div className="min-w-0">
                    <dt className="booth-meta-label">{t.capturedAtLabel}</dt>
                    <dd className="mt-0.5 text-[13px] text-text-primary">{formatLocalizedDate(editingLead.created_at, locale)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="booth-meta-label">{t.tierColumnLabel}</dt>
                    <dd className="mt-0.5 text-[13px] text-text-primary break-words">{editingLead.ticket_tier_name}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <RatingControl label={t.interestRatingLabel} value={editRating} onChange={setEditRating} locale={locale} />

            <TagPicker
              label={t.followUpTagsLabel}
              presets={tagPresets}
              selected={editTags}
              onToggle={(tag) => handleToggleTag(tag, editTags, setEditTags)}
            >
              <div className="relative mt-2.5">
                <Icon name="tag" size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={handleAddCustomTag}
                  placeholder={t.addCustomTagPlaceholder}
                  aria-label={t.addCustomTagPlaceholder}
                  className="ui-input ps-11"
                />
              </div>
            </TagPicker>

            <div>
              <label htmlFor="booth-edit-notes" className="ui-label">{t.notesLabel}</label>
              <textarea
                id="booth-edit-notes"
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t.notesPlaceholder}
                className="ui-textarea"
              />
            </div>
            <div className="sticky -bottom-6 z-10 -mx-5 -mb-6 border-t border-border-subtle bg-surface-panel px-5 pb-5 pt-3 sm:-bottom-7 sm:-mx-7 sm:-mb-7 sm:px-7 sm:pb-6">
              {editFeedback && (
                <div role="status" className="mb-3 flex items-center gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg p-3 text-[13px] font-semibold text-status-success-text motion-safe:animate-pop">
                  <Icon name="check-circle" size={18} className="shrink-0" />
                  <span>{editFeedback}</span>
                </div>
              )}
              {editError && (
                <div role="alert" aria-live="assertive" className="mb-3 flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3 text-[13px] leading-relaxed text-status-danger-text motion-safe:animate-pop">
                  <Icon name="alert" size={18} className="shrink-0" />
                  <span>{editError}</span>
                </div>
              )}
              <div className="flex gap-2 sm:justify-end">
                <Button type="button" variant="ghost" size="lg" disabled={savingLead} onClick={() => setEditingLead(null)} className="shrink-0 max-sm:hidden">
                  {isRtl ? "انصراف" : "Cancel"}
                </Button>
                <Button type="submit" variant="primary" size="lg" disabled={savingLead} className="min-w-0 flex-1 sm:flex-none sm:min-w-[15rem]">
                  {savingLead ? spinner : <Icon name="check" size={19} className="shrink-0" />}
                  <span className="whitespace-normal leading-tight">{savingLead ? (isRtl ? "در حال ذخیره…" : "Saving…") : t.saveQualificationAction}</span>
                </Button>
              </div>
            </div>
          </form>
        )}
      </Dialog>

      {/* Phones and small tablets at the booth: the primary action stays one tap away. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-surface-ink px-4 pb-safe md:hidden">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[image:var(--grad-aiteb)] opacity-70" />
        <div className="py-3">
          <Button
            type="button"
            variant="light"
            size="xl"
            isFullWidth
            onClick={() => {
              setIsCaptureModalOpen(true);
              resetCapture();
            }}
          >
            <Icon name="scan" size={22} className="text-aiteb-indigo" />
            <span className="truncate">{t.captureLeadAction}</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
