import { useMemo, useState } from "react";
import { createApiClient, type LeadOut } from "../../api/client";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { formatLocalizedDate, formatLocalizedNumber, translations, type AttendeeLocale } from "../../lib/i18n";
import { asciiDigits } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BoothSpinner } from "./BoothSpinner";
import { LeadCard } from "./LeadCard";
import { LEAD_RATINGS, RATING_META, type LeadRating } from "./rating";

interface LeadListProps {
  boothId: string;
  boothSlug: string;
  token: string;
  locale: AttendeeLocale;
  /** All of this booth's leads; the search and rating filters below only narrow what is shown. */
  allLeads: LeadOut[];
  ratingCounts: Record<LeadRating, number>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onQualify: (lead: LeadOut) => void;
  onCapture: () => void;
}

/** The booth's lead worklist: search, rating filter, CSV export and the lead cards. */
export function LeadList({ boothId, boothSlug, token, locale, allLeads, ratingCounts, loading, failed, onRetry, onQualify, onCapture }: LeadListProps) {
  const t = translations[locale];
  const isRtl = locale === "fa";
  const [searchFilter, setSearchFilter] = useState("");
  const [ratingFilter, setRatingFilter] = useState<"" | LeadRating>("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

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

  const handleExportCsv = async () => {
    if (!isStoredAttendeeToken(token)) {
      setExportError(sessionChangedMessage(locale));
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
      // No download or completion feedback for a session that has since changed or expired.
      if (attendeeResponseState(token, response.status) !== "current") return;
      if (!response.ok || !blob) {
        setExportError(isRtl ? "فهرست لیدها دریافت نشد. دوباره تلاش کنید؛ اگر تکرار شد دوباره وارد شوید." : "Couldn't export the lead list. Try again; if it keeps failing, sign in again.");
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${boothSlug || "booth"}-leads.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      setExportNotice(isRtl ? `دریافت ${link.download} آغاز شد (همهٔ لیدهای این غرفه).` : `Download of ${link.download} started (all leads of this booth).`);
    } catch {
      setExportError(isRtl ? "خطای شبکه هنگام دریافت CSV." : "Network error while exporting CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const filtersActive = Boolean(searchFilter || ratingFilter);
  const filterChips: { value: "" | LeadRating; label: string; count: number }[] = [
    { value: "", label: t.ratingFilterAll, count: allLeads.length },
    ...LEAD_RATINGS.map((rating) => ({ value: rating, label: RATING_META[rating].label[locale], count: ratingCounts[rating] })),
  ];

  return (
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
            aria-busy={isExporting}
            onClick={handleExportCsv}
            className="shrink-0"
          >
            {isExporting ? <BoothSpinner /> : <Icon name="download" size={17} />}
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
                <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[12px] tabular ${on ? (meta ? "bg-white text-[var(--rating-fg)]" : "bg-white/20") : "bg-surface-panel-subtle text-text-muted"}`}>
                  {formatLocalizedNumber(chip.count, locale)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Always mounted, so the export result is announced; the card below is visual only. */}
      <p role="status" className="sr-only">{exportNotice ?? ""}</p>

      {exportNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg p-3.5 text-[13px] leading-relaxed text-status-success-text">
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

      {failed && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] text-status-danger-text">
          <span className="flex items-center gap-2.5">
            <Icon name="alert" size={18} className="shrink-0" />
            <span>{isRtl ? "فهرست لیدها بارگذاری نشد." : "The lead list could not be loaded."}</span>
          </span>
          <Button type="button" size="md" variant="secondary" onClick={onRetry}>
            <Icon name="sync" size={16} />
            <span>{isRtl ? "تلاش مجدد" : "Retry"}</span>
          </Button>
        </div>
      )}

      {filtersActive && !loading && (
        <p role="status" className="px-1 text-[13px] text-text-muted">
          {isRtl
            ? `نمایش ${formatLocalizedNumber(leads.length, locale)} از ${formatLocalizedNumber(allLeads.length, locale)} لید`
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
            <Button type="button" variant="primary" size="md" onClick={onCapture} className="mt-6">
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
              onQualify={() => onQualify(lead)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
