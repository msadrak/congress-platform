import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ATTENDEE_TOKEN_STORAGE,
  createApiClient,
  formatApiError,
  type BoothOut,
  type LeadOut,
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
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";

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
  const [leads, setLeads] = useState<LeadOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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
      setLeads([]);
      setEditingLead(null);
      setAuthError(null);
    }
    if (!boothId) return;
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setAuthError(null);
      const client = createApiClient({ kind: "user", token });

      const [boothRes, leadsRes] = await Promise.all([
        client.GET("/api/booths/{booth_id}", {
          params: { path: { booth_id: boothId } },
        }),
        client.GET("/api/booths/{booth_id}/leads", {
          params: {
            path: { booth_id: boothId },
            query: {
              q: searchFilter || undefined,
              rating: (ratingFilter as "HOT" | "WARM" | "COLD") || undefined,
            },
          },
        }),
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
        setAuthError(formatApiError(boothRes.error));
      } else if (boothRes.data) {
        setBooth(boothRes.data);
      }

      if (leadsRes.data) {
        setLeads(leadsRes.data);
      }

      setLoading(false);
    };

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [boothId, token, searchFilter, ratingFilter]);

  const refreshLeads = async () => {
    if (!boothId || !token || !isStoredAttendeeToken(token)) return;
    const client = createApiClient({ kind: "user", token });
    const { data, response } = await client.GET("/api/booths/{booth_id}/leads", {
      params: {
        path: { booth_id: boothId },
        query: {
          q: searchFilter || undefined,
          rating: (ratingFilter as "HOT" | "WARM" | "COLD") || undefined,
        },
      },
    });
    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    if (data && stillCurrent) setLeads(data);
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ATTENDEE_TOKEN_STORAGE);
    }
    navigate("/");
  };

  const toggleLocale = () => {
    setLocale(locale === "fa" ? "en" : "fa");
  };

  const handleCaptureLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boothId || !token || !qrSecret.trim()) return;
    if (!isStoredAttendeeToken(token)) {
      setCaptureError(SESSION_CHANGED_MESSAGE);
      return;
    }

    setSubmittingCapture(true);
    setCaptureError(null);
    setCaptureFeedback(null);
    const client = createApiClient({ kind: "user", token });

    const { data, error: err, response } = await client.POST(
      "/api/booths/{booth_id}/leads/scan",
      {
        params: { path: { booth_id: boothId } },
        body: {
          qr_secret: qrSecret.trim(),
          rating: captureRating,
          notes: captureNotes.trim(),
          tags: captureTags,
        },
      }
    );

    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    setSubmittingCapture(false);
    if (!stillCurrent) return;
    if (err) {
      setCaptureError(formatApiError(err));
    } else if (data) {
      // Check status code: 201 Created vs 200 OK (duplicate update)
      const isDuplicateUpdate = response?.status === 200;
      setCaptureFeedback(isDuplicateUpdate ? t.leadUpdatedSuccess : t.leadCapturedSuccess);
      setQrSecret("");
      setCaptureNotes("");
      setCaptureTags([]);
      refreshLeads();
      setTimeout(() => {
        setIsCaptureModalOpen(false);
        setCaptureFeedback(null);
      }, 1200);
    }
  };

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
    const client = createApiClient({ kind: "user", token });

    const { data, error: err, response } = await client.PATCH(
      "/api/booths/{booth_id}/leads/{lead_id}",
      {
        params: {
          path: { booth_id: boothId, lead_id: editingLead.id },
        },
        body: {
          rating: editRating,
          tags: editTags,
          notes: editNotes.trim(),
        },
      }
    );

    const stillCurrent = isStoredAttendeeToken(token);
    if (response.status === 401) rejectAttendeeToken(token);
    setSavingLead(false);
    if (!stillCurrent) return;
    if (err) {
      setEditError(formatApiError(err));
    } else if (data) {
      setLeads((prev) =>
        prev.map((l) => (l.id === editingLead.id ? data : l))
      );
      setEditFeedback(t.qualificationSavedSuccess);
      setTimeout(() => {
        setEditingLead(null);
        setEditFeedback(null);
      }, 1000);
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
        setExportError("Failed to export leads. Please verify authorization.");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${booth.slug || "booth"}-leads.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch {
      setExportError("Network error while exporting CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to format rating badge
  const renderRatingBadge = (r: string) => {
    if (r === "HOT") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
          <span>🔥</span>
          <span>{t.ratingHot}</span>
        </span>
      );
    }
    if (r === "COLD") {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
          <span>❄️</span>
          <span>{t.ratingCold}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
        <span>⚡</span>
        <span>{t.ratingWarm}</span>
      </span>
    );
  };

  // Counts summary
  const hotCount = leads.filter((l) => l.rating === "HOT").length;
  const warmCount = leads.filter((l) => l.rating === "WARM").length;
  const coldCount = leads.filter((l) => l.rating === "COLD").length;

  // Unauthenticated view (fails closed)
  if (!token) {
    return (
      <div dir={dir} lang={locale} className="min-h-screen bg-surface-page flex items-center justify-center p-4 font-sans">
        <Card className="max-w-md w-full p-8 text-center space-y-5 border-border-default shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-3xl shadow-xs">
            🏢
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-text-primary tracking-tight">
              {t.unauthenticatedExhibitorTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {t.unauthenticatedExhibitorDesc}
            </p>
          </div>
          <div className="pt-2">
            <LinkButton to="/" variant="primary" size="lg" isFullWidth>
              {isRtl ? "ورود به سامانه همایش" : "Sign In to Platform"} →
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  // Loading skeleton
  if (loading && !booth) {
    return (
      <div dir={dir} lang={locale} className="min-h-screen bg-surface-page flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full p-8 rounded-2xl bg-surface-panel border border-border-default space-y-4 animate-pulse">
          <div className="w-24 h-6 bg-surface-panel-subtle rounded-full mx-auto" />
          <div className="w-3/4 h-8 bg-surface-panel-subtle rounded-xl mx-auto" />
          <div className="w-1/2 h-4 bg-surface-panel-subtle rounded-md mx-auto" />
        </div>
      </div>
    );
  }

  // Unauthorized (403 Forbidden) or Not Found view
  if (authError || !booth) {
    return (
      <div dir={dir} lang={locale} className="min-h-screen bg-surface-page flex items-center justify-center p-4 font-sans">
        <Card className="max-w-md w-full p-8 text-center space-y-5 border-border-default shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-status-danger-bg text-status-danger-text mx-auto flex items-center justify-center text-2xl font-bold shadow-xs">
            🚫
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-text-primary tracking-tight">
              {t.unauthorizedExhibitorTitle}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {authError ?? t.unauthorizedExhibitorDesc}
            </p>
          </div>
          <div className="pt-2">
            <LinkButton to="/" variant="secondary" size="md">
              {t.platformHome} →
            </LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      dir={dir}
      lang={locale}
      className={`min-h-screen bg-surface-page text-text-primary flex flex-col font-sans selection:bg-action-subtle selection:text-action-primary ${
        isRtl ? "text-start font-sans" : "text-start font-sans"
      }`}
    >
      <SkipLink targetId="exhibitor-main-content">
        {isRtl ? "پرش به محتوای اصلی پرتال غرفه" : "Skip to main booth lead content"}
      </SkipLink>

      {/* 1. Exhibitor Workspace Header */}
      <header className="sticky top-0 z-40 bg-surface-panel/95 backdrop-blur-xs border-b border-border-default">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Booth Brand & Location */}
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-lg bg-action-primary text-text-inverse flex items-center justify-center font-bold text-base shadow-xs shrink-0">
              🏢
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-sm sm:text-base tracking-tight text-text-primary leading-tight">
                {booth.name}
              </span>
              <span className="text-[11px] text-text-muted font-medium leading-none">
                📍 {booth.location || (isRtl ? "سالن اصلی نمایشگاه" : "Exhibition Floor")}
              </span>
            </div>
          </div>

          {/* Controls: Language, Staff Badge & Logout */}
          <div className="flex items-center gap-2.5">
            <Badge variant="brand" size="sm" className="hidden sm:inline-flex">
              {t.boothAuthorizedBadge}
            </Badge>

            <button
              type="button"
              onClick={toggleLocale}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-surface-panel-subtle hover:bg-surface-page text-text-secondary border border-border-default transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
              aria-label={isRtl ? "Switch language to English" : "تغییر زبان به فارسی"}
            >
              🌐 {t.languageToggle}
            </button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              {t.logout}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="exhibitor-main-content" tabIndex={-1} className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 focus:outline-none">
        {/* KPI Summary Bar & Capture Trigger */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-border-default">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-text-primary">
              {t.leadsListHeading}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary">
              {t.exhibitorPortalDesc}
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-2.5">
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => {
                setIsCaptureModalOpen(true);
                setCaptureError(null);
                setCaptureFeedback(null);
              }}
              className="gap-2 shadow-xs"
            >
              <span>+</span>
              <span>{t.captureLeadAction}</span>
            </Button>
          </div>
        </div>

        {/* Global Feedback Notifications */}
        {exportError && (
          <div role="alert" aria-live="assertive" className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">
            {exportError}
          </div>
        )}

        {/* Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-xl bg-surface-panel border border-border-default shadow-xs space-y-0.5">
            <span className="text-[11px] font-semibold text-text-muted block">
              {t.leadsCountLabel}
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-text-primary block">
              {formatLocalizedNumber(leads.length, locale)}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200/80 shadow-xs space-y-0.5">
            <span className="text-[11px] font-semibold text-rose-700 block">
              🔥 {t.ratingHot}
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-rose-900 block">
              {formatLocalizedNumber(hotCount, locale)}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 shadow-xs space-y-0.5">
            <span className="text-[11px] font-semibold text-amber-800 block">
              ⚡ {t.ratingWarm}
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-amber-950 block">
              {formatLocalizedNumber(warmCount, locale)}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-xs space-y-0.5">
            <span className="text-[11px] font-semibold text-slate-700 block">
              ❄️ {t.ratingCold}
            </span>
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900 block">
              {formatLocalizedNumber(coldCount, locale)}
            </span>
          </div>
        </div>

        {/* Search, Filter & Export Controls Bar */}
        <div className="p-4 sm:p-5 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Search Input */}
          <div className="flex-1 max-w-md relative">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder={t.searchLeadsPlaceholder}
              className="w-full px-3.5 py-2 bg-surface-page border border-border-default rounded-xl text-xs sm:text-sm text-text-primary placeholder:text-text-muted focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter("")}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Rating Filter Tabs & Export Button */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-surface-panel-subtle rounded-xl border border-border-subtle text-xs">
              <button
                type="button"
                onClick={() => setRatingFilter("")}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  ratingFilter === ""
                    ? "bg-surface-panel text-text-primary shadow-xs font-bold"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {t.ratingFilterAll}
              </button>
              <button
                type="button"
                onClick={() => setRatingFilter("HOT")}
                className={`px-2 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  ratingFilter === "HOT"
                    ? "bg-rose-100 text-rose-800 shadow-xs font-bold"
                    : "text-text-muted hover:text-rose-700"
                }`}
              >
                🔥 {isRtl ? "زیاد" : "Hot"}
              </button>
              <button
                type="button"
                onClick={() => setRatingFilter("WARM")}
                className={`px-2 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  ratingFilter === "WARM"
                    ? "bg-amber-100 text-amber-800 shadow-xs font-bold"
                    : "text-text-muted hover:text-amber-800"
                }`}
              >
                ⚡ {isRtl ? "متوسط" : "Warm"}
              </button>
              <button
                type="button"
                onClick={() => setRatingFilter("COLD")}
                className={`px-2 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                  ratingFilter === "COLD"
                    ? "bg-slate-200 text-slate-800 shadow-xs font-bold"
                    : "text-text-muted hover:text-slate-800"
                }`}
              >
                ❄️ {isRtl ? "کم" : "Cold"}
              </button>
            </div>

            {/* Export CSV Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isExporting || leads.length === 0}
              onClick={handleExportCsv}
              className="gap-1.5 shrink-0"
            >
              <span>📥</span>
              <span>{isExporting ? t.exportingCsvAction : t.exportCsvAction}</span>
            </Button>
          </div>
        </div>

        {/* 2. Leads Worklist */}
        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
            <div className="h-32 bg-surface-panel rounded-2xl border border-border-default" />
          </div>
        ) : leads.length === 0 ? (
          <Card className="p-8 sm:p-14 text-center space-y-4 border-border-default">
            <div className="w-14 h-14 rounded-2xl bg-action-subtle text-action-primary mx-auto flex items-center justify-center text-2xl font-bold shadow-xs">
              👥
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-text-primary">
                {searchFilter || ratingFilter ? t.noLeadsFilterMatch : t.noLeadsTitle}
              </h2>
              <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
                {searchFilter || ratingFilter
                  ? (isRtl ? "فیلترها را پاک کنید یا عبارت دیگری را جستجو نمایید." : "Clear active filters or try a different search keyword.")
                  : t.noLeadsDesc}
              </p>
            </div>
            {!searchFilter && !ratingFilter && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setIsCaptureModalOpen(true)}
                >
                  + {t.captureLeadAction}
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {leads.map((lead) => (
              <article
                key={lead.id}
                aria-labelledby={`lead-name-${lead.id}`}
                className="p-5 sm:p-6 rounded-2xl bg-surface-panel border border-border-default shadow-xs flex flex-col md:flex-row md:items-start md:justify-between gap-5 transition-all hover:border-border-strong"
              >
                <div className="space-y-2.5 max-w-2xl flex-1">
                  {/* Top Row: Rating Badge & Tier */}
                  <div className="flex flex-wrap items-center gap-2">
                    {renderRatingBadge(lead.rating)}
                    <span className="text-xs text-text-muted">•</span>
                    <Badge variant="neutral" size="sm">
                      {lead.ticket_tier_name}
                    </Badge>
                    <span className="text-xs text-text-muted">•</span>
                    <span className="text-[11px] text-text-muted">
                      {t.capturedAtLabel}: {formatLocalizedDate(lead.created_at, locale)}
                    </span>
                  </div>

                  {/* Lead Attendee Identity */}
                  <div>
                    <h2 id={`lead-name-${lead.id}`} className="text-base sm:text-lg font-bold text-text-primary tracking-tight">
                      {lead.attendee_name}
                    </h2>
                    {(lead.title || lead.organization) && (
                      <p className="text-xs text-text-secondary font-medium">
                        {lead.title}
                        {lead.title && lead.organization ? " • " : ""}
                        {lead.organization}
                      </p>
                    )}
                  </div>

                  {/* Contact Email (ADR 0011: Legitimate Exhibitor Lead Disclosure) */}
                  <div className="text-xs">
                    <a
                      href={`mailto:${lead.attendee_email}`}
                      className="text-action-primary hover:underline font-mono inline-flex items-center gap-1.5 focus-visible:outline-focus-ring"
                    >
                      <span aria-hidden="true">✉</span>
                      <bdi dir="ltr">{lead.attendee_email}</bdi>
                    </a>
                  </div>

                  {/* Follow-up Tags */}
                  {lead.tags && lead.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {lead.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-page border border-border-subtle text-text-secondary"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Private Qualification Notes */}
                  {lead.notes && (
                    <div className="p-3 rounded-xl bg-surface-page border border-border-subtle text-xs text-text-secondary leading-relaxed whitespace-pre-line">
                      <span className="font-semibold text-text-muted block text-[10px] uppercase tracking-wider mb-0.5">
                        {t.notesLabel}:
                      </span>
                      {lead.notes}
                    </div>
                  )}
                </div>

                {/* Qualify / Edit Action */}
                <div className="shrink-0 pt-2 md:pt-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => handleOpenEdit(lead)}
                    className="gap-1.5 w-full md:w-auto"
                  >
                    <span>✏️</span>
                    <span>{t.qualifyLeadButton}</span>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* 3. Accessible Capture Lead Modal */}
      <Dialog
        isOpen={isCaptureModalOpen}
        onClose={() => {
          if (!submittingCapture) {
            setIsCaptureModalOpen(false);
            setCaptureError(null);
            setCaptureFeedback(null);
          }
        }}
        title={t.captureLeadModalTitle}
        description={t.captureLeadModalDesc}
        size="md"
      >
        <form onSubmit={handleCaptureLead} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.badgeCodeLabel} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={qrSecret}
              onChange={(e) => setQrSecret(e.target.value)}
              placeholder={t.badgeCodePlaceholder}
              className="w-full px-3.5 py-2.5 bg-white border border-border-default rounded-xl text-sm font-mono text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
            <span className="text-[11px] text-text-muted mt-1 block">
              {t.badgeCodeHint}
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">
              {t.interestRatingLabel}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCaptureRating("HOT")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  captureRating === "HOT"
                    ? "bg-rose-100 text-rose-800 border-rose-300 shadow-xs"
                    : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                }`}
              >
                🔥 {isRtl ? "زیاد" : "Hot"}
              </button>
              <button
                type="button"
                onClick={() => setCaptureRating("WARM")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  captureRating === "WARM"
                    ? "bg-amber-100 text-amber-900 border-amber-300 shadow-xs"
                    : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                }`}
              >
                ⚡ {isRtl ? "متوسط" : "Warm"}
              </button>
              <button
                type="button"
                onClick={() => setCaptureRating("COLD")}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  captureRating === "COLD"
                    ? "bg-slate-200 text-slate-800 border-slate-300 shadow-xs"
                    : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                }`}
              >
                ❄️ {isRtl ? "کم" : "Cold"}
              </button>
            </div>
          </div>

          {/* Quick preset tags */}
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1.5">
              {t.followUpTagsLabel}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_TAG_KEYS.map((key) => {
                const tagLabel = t[key];
                const isSelected = captureTags.includes(tagLabel);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleToggleTag(tagLabel, captureTags, setCaptureTags)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-action-subtle text-action-primary border-action-subtle-border font-bold"
                        : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                    }`}
                  >
                    {isSelected ? "✓ " : "+ "}
                    {tagLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              {t.notesLabel}
            </label>
            <textarea
              rows={2}
              value={captureNotes}
              onChange={(e) => setCaptureNotes(e.target.value)}
              placeholder={t.notesPlaceholder}
              className="w-full p-2.5 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
            />
          </div>

          {captureFeedback && (
            <div role="status" className="p-3 rounded-xl bg-status-success-bg text-status-success-text border border-status-success-border text-xs">
              {captureFeedback}
            </div>
          )}

          {captureError && (
            <div role="alert" aria-live="assertive" className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">
              {captureError}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={submittingCapture}
              onClick={() => setIsCaptureModalOpen(false)}
            >
              {isRtl ? "انصراف" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submittingCapture}
            >
              {submittingCapture ? "..." : t.saveLeadAction}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* 4. Accessible Qualification Drawer / Modal */}
      <Dialog
        isOpen={Boolean(editingLead)}
        onClose={() => {
          if (!savingLead) setEditingLead(null);
        }}
        title={editingLead ? `${t.qualificationDrawerTitle}: ${editingLead.attendee_name}` : ""}
        description={t.qualificationDrawerDesc}
        size="md"
      >
        {editingLead && (
          <form onSubmit={handleSaveQualification} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1.5">
                {t.interestRatingLabel}
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setEditRating("HOT")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    editRating === "HOT"
                      ? "bg-rose-100 text-rose-800 border-rose-300 shadow-xs"
                      : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                  }`}
                >
                  🔥 {isRtl ? "زیاد" : "Hot"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditRating("WARM")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    editRating === "WARM"
                      ? "bg-amber-100 text-amber-900 border-amber-300 shadow-xs"
                      : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                  }`}
                >
                  ⚡ {isRtl ? "متوسط" : "Warm"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditRating("COLD")}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    editRating === "COLD"
                      ? "bg-slate-200 text-slate-800 border-slate-300 shadow-xs"
                      : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                  }`}
                >
                  ❄️ {isRtl ? "کم" : "Cold"}
                </button>
              </div>
            </div>

            {/* Tags management */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-text-primary">
                {t.followUpTagsLabel}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAG_KEYS.map((key) => {
                  const tagLabel = t[key];
                  const isSelected = editTags.includes(tagLabel);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleToggleTag(tagLabel, editTags, setEditTags)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-action-subtle text-action-primary border-action-subtle-border font-bold"
                          : "bg-surface-page text-text-secondary border-border-default hover:bg-surface-panel-subtle"
                      }`}
                    >
                      {isSelected ? "✓ " : "+ "}
                      {tagLabel}
                    </button>
                  );
                })}
              </div>

              {/* Custom tag input */}
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={handleAddCustomTag}
                placeholder={t.addCustomTagPlaceholder}
                className="w-full px-3 py-1.5 bg-surface-page border border-border-default rounded-lg text-xs text-text-primary placeholder:text-text-muted mt-1"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                {t.notesLabel}
              </label>
              <textarea
                rows={3}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder={t.notesPlaceholder}
                className="w-full p-2.5 bg-white border border-border-default rounded-xl text-xs sm:text-sm text-text-primary focus:border-action-primary focus:ring-1 focus:ring-action-primary"
              />
            </div>

            {editFeedback && (
              <div role="status" className="p-3 rounded-xl bg-status-success-bg text-status-success-text border border-status-success-border text-xs">
                {editFeedback}
              </div>
            )}

            {editError && (
              <div role="alert" aria-live="assertive" className="p-3.5 rounded-xl bg-status-danger-bg text-status-danger-text border border-status-danger-border text-xs leading-relaxed">
                {editError}
              </div>
            )}

            <div className="pt-2 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={savingLead}
                onClick={() => setEditingLead(null)}
              >
                {isRtl ? "انصراف" : "Cancel"}
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={savingLead}
              >
                {savingLead ? "..." : t.saveQualificationAction}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
