import { useCallback, useState } from "react";
import { createApiClient, type LeadOut } from "../../api/client";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { formatLocalizedDate, formatLocalizedNumber, translations, type AttendeeLocale } from "../../lib/i18n";
import { LEAD_SEARCH_MAX_LENGTH, accessBlockOf, hasLeadFilters, isEventArchived, totalOf, type AccessBlock } from "../../lib/leadList";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { BoothSpinner } from "./BoothSpinner";
import { LeadCard, type LeadCardLabels } from "./LeadCard";
import { PendingSyncPanel } from "./PendingSyncPanel";
import { UndoToast } from "./UndoToast";
import { boothText, codedMessage } from "./boothText";
import { LEAD_RATINGS, RATING_META, type LeadRating } from "./rating";
import type { LeadCounts, LeadListState } from "./useLeadList";
import type { LeadQueueState } from "./useLeadQueue";

interface LeadListProps {
  boothId: string;
  boothSlug: string;
  token: string;
  locale: AttendeeLocale;
  list: LeadListState;
  counts: LeadCounts;
  queue: LeadQueueState;
  /** Announced after queued scans were sent. */
  syncNotice: string | null;
  /** The stored session changed in another tab (kept by the portal across the reload). */
  sessionNotice: string | null;
  onQualify: (lead: LeadOut) => void;
  onCapture: () => void;
  onAccessBlocked: (block: AccessBlock) => void;
  /** The congress is archived (learned from a 409 EVENT_ARCHIVED): reads and export only. */
  archived: boolean;
  /** 409 EVENT_ARCHIVED: the congress is closed; its leads are read-only. */
  onArchived: () => void;
  /** The stored session changed in another tab: the portal re-renders for the current one. */
  onSessionChanged: () => void;
}

type Client = ReturnType<typeof createApiClient>;

/**
 * The booth's lead worklist and trash: server-side search and rating filter, paging by cursor, delete with undo,
 * restore, CSV export (optionally with deleted leads) and the scans still waiting on this device.
 */
export function LeadList({ boothId, boothSlug, token, locale, list, counts, queue, syncNotice, sessionNotice, onQualify, onCapture, onAccessBlocked, onArchived, onSessionChanged, archived }: LeadListProps) {
  const t = translations[locale];
  const text = boothText(locale);
  const isRtl = locale === "fa";
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<LeadOut | null>(null);
  const [undoing, setUndoing] = useState(false);

  const trash = list.query.view === "deleted";
  const activeTotal = counts.known ? totalOf(counts.counts) : list.appliedQuery.view === "active" ? list.total : 0;
  const filtersActive = hasLeadFilters(list.appliedQuery);
  const exportable = activeTotal > 0 || (includeDeleted && counts.deleted > 0);

  /** Runs one lead mutation with the shared session, access and error handling; resolves the confirmed body. */
  const mutate = async <T,>(
    request: (api: Client) => Promise<{ data?: T; error?: unknown; response: Response }>,
    failure: string,
  ): Promise<{ ok: true; data: T | undefined } | { ok: false }> => {
    if (!isStoredAttendeeToken(token)) {
      setActionError(sessionChangedMessage(locale));
      onSessionChanged();
      return { ok: false };
    }
    try {
      const res = await request(createApiClient({ kind: "user", token }));
      if (attendeeResponseState(token, res.response.status) !== "current") return { ok: false };
      if (res.response.ok) return { ok: true, data: res.data };
      const block = accessBlockOf(res.response.status, res.error);
      if (block) {
        onAccessBlocked(block);
        return { ok: false };
      }
      if (isEventArchived(res.response.status, res.error)) onArchived();
      setActionError(codedMessage(res.error, locale) ?? failure);
    } catch {
      setActionError(failure);
    }
    return { ok: false };
  };

  const deleteLead = async (lead: LeadOut) => {
    setBusyId(lead.id);
    setActionError(null);
    setNotice(null);
    const res = await mutate(
      (api) => api.DELETE("/api/booths/{booth_id}/leads/{lead_id}", { params: { path: { booth_id: boothId, lead_id: lead.id } } }),
      text.deleteFailed,
    );
    setBusyId(null);
    if (!res.ok) return;
    list.dropLead(lead.id);
    counts.refresh();
    setUndoing(false);
    setToast(lead);
  };

  const restoreLead = async (lead: LeadOut, fromUndo: boolean) => {
    if (fromUndo) setUndoing(true);
    else setBusyId(lead.id);
    setActionError(null);
    const res = await mutate(
      (api) => api.POST("/api/booths/{booth_id}/leads/{lead_id}/restore", { params: { path: { booth_id: boothId, lead_id: lead.id } } }),
      text.restoreFailed,
    );
    setBusyId(null);
    setUndoing(false);
    if (!res.ok) return;
    setToast(null);
    // Back in the worklist at its own place (newest first); out of the trash view.
    if (fromUndo) list.reload();
    else list.dropLead(lead.id);
    counts.refresh();
    setNotice(text.leadRestored(lead.attendee_name));
  };

  const dismissToast = useCallback(() => setToast(null), []);

  const handleExportCsv = async () => {
    if (!isStoredAttendeeToken(token)) {
      setExportError(sessionChangedMessage(locale));
      onSessionChanged();
      return;
    }
    setIsExporting(true);
    setExportError(null);
    setNotice(null);
    try {
      const client = createApiClient({ kind: "user", token });
      const { data: blob, error, response } = await client.GET("/api/booths/{booth_id}/leads/export-csv", {
        params: { path: { booth_id: boothId }, ...(includeDeleted ? { query: { include_deleted: true } } : {}) },
        parseAs: "blob",
      });
      // No download or completion feedback for a session that has since changed or expired.
      if (attendeeResponseState(token, response.status) !== "current") return;
      const block = accessBlockOf(response.status, error);
      if (block) {
        onAccessBlocked(block);
        return;
      }
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
      setNotice(includeDeleted ? text.exportStartedWithDeleted(link.download) : text.exportStarted(link.download));
    } catch {
      setExportError(isRtl ? "خطای شبکه هنگام دریافت CSV." : "Network error while exporting CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const filterChips: { value: "" | LeadRating; label: string; count: number | null }[] = [
    { value: "", label: t.ratingFilterAll, count: trash ? null : activeTotal },
    ...LEAD_RATINGS.map((rating) => ({ value: rating, label: RATING_META[rating].label[locale], count: trash ? null : counts.counts[rating] })),
  ];
  const viewTabs = [
    { value: "active" as const, label: text.leadsTab, icon: "users" as const, count: counts.known ? activeTotal : null },
    { value: "deleted" as const, label: text.trashTab, icon: "trash" as const, count: counts.known ? counts.deleted : null },
  ];
  const labels: LeadCardLabels = {
    captured: t.capturedAtLabel,
    tier: t.tierColumnLabel,
    mobile: isRtl ? "موبایل" : "Mobile",
    call: isRtl ? "تماس با" : "Call",
    text: isRtl ? "پیامک" : "Text",
    notes: t.notesLabel,
    qualify: t.qualifyLeadButton,
    contactShared: text.contactShared,
    contactNotShared: text.contactNotShared,
    contactNotSharedHint: text.contactNotSharedHint,
    delete: text.deleteLead,
    deleteOf: text.deleteLeadOf,
    restore: text.restoreLead,
    restoreOf: text.restoreLeadOf,
    deletedAt: text.deletedAt,
  };
  const shownNotice = notice ?? syncNotice;
  const remaining = Math.max(0, list.total - list.items.length);

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
          <div className="flex w-full shrink-0 flex-col items-stretch gap-1.5 sm:w-auto sm:items-end">
            <Button
              type="button"
              variant="outline"
              size="md"
              disabled={isExporting || !exportable || !queue.online}
              aria-busy={isExporting}
              onClick={handleExportCsv}
            >
              {isExporting ? <BoothSpinner /> : <Icon name="download" size={17} />}
              <span>{isExporting ? t.exportingCsvAction : t.exportCsvAction}</span>
            </Button>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 px-1 text-[13px] text-text-secondary">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="size-[18px] shrink-0 accent-action-primary"
              />
              <span>{text.includeDeleted}</span>
            </label>
          </div>
        </div>

        <div role="group" aria-label={text.viewLabel} className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-panel-subtle p-1 sm:inline-grid">
          {viewTabs.map((tab) => {
            const on = list.query.view === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={on}
                onClick={() => list.setView(tab.value)}
                className={`press inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  on ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <Icon name={tab.icon} size={15} />
                <span>{tab.label}</span>
                {tab.count !== null && <span className="tabular text-text-muted">{formatLocalizedNumber(tab.count, locale)}</span>}
              </button>
            );
          })}
        </div>

        <div className="relative mt-4">
          <Icon name="search" size={18} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            enterKeyHint="search"
            value={list.query.q}
            maxLength={LEAD_SEARCH_MAX_LENGTH}
            onChange={(e) => list.setSearch(e.target.value)}
            placeholder={t.searchLeadsPlaceholder}
            aria-label={t.searchLeadsPlaceholder}
            className="ui-input ps-11 pe-12"
          />
          {list.query.q && (
            <button
              type="button"
              onClick={() => list.setSearch("")}
              aria-label={isRtl ? "پاک کردن جستجو" : "Clear search"}
              className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring cursor-pointer"
            >
              <Icon name="x" size={17} />
            </button>
          )}
        </div>

        <div role="group" aria-label={isRtl ? "فیلتر سطح تمایل" : "Filter by rating"} className="mt-3 flex flex-wrap gap-1.5">
          {filterChips.map((chip) => {
            const on = list.query.rating === chip.value;
            const meta = chip.value ? RATING_META[chip.value] : null;
            return (
              <button
                key={chip.value || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => list.setRating(chip.value)}
                className={`${meta?.tone ?? ""} press inline-flex min-h-[44px] items-center gap-2 rounded-full border ps-3 ${chip.count === null ? "pe-3" : "pe-1.5"} text-[13px] font-semibold transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  on
                    ? meta
                      ? "border-transparent bg-[var(--rating-solid)] text-white"
                      : "border-transparent bg-surface-ink text-white"
                    : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {meta && <Icon name={meta.icon} size={15} className={on ? "" : "text-[var(--rating-solid)]"} />}
                <span>{chip.label}</span>
                {chip.count !== null && (
                  <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[12px] tabular ${on ? (meta ? "bg-white text-[var(--rating-fg)]" : "bg-white/20") : "bg-surface-panel-subtle text-text-muted"}`}>
                    {formatLocalizedNumber(chip.count, locale)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {!queue.online && (
        <div data-testid="offline-banner" className="flex items-start gap-2.5 rounded-xl border border-status-warning-border bg-status-warning-bg p-3.5 text-[13px] leading-relaxed text-status-warning-text">
          <Icon name="wifi-off" size={18} className="shrink-0" />
          <span>{text.offlineBanner}</span>
        </div>
      )}
      {queue.storageError && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] leading-relaxed text-status-danger-text">
          <Icon name="alert" size={18} className="shrink-0" />
          <span>{text.storageUnavailable}</span>
        </div>
      )}

      {archived && (
        <div data-testid="archived-notice" role="status" className="flex items-start gap-2.5 rounded-xl border border-status-info-border bg-status-info-bg p-3.5 text-[13px] leading-relaxed text-status-info-text">
          <Icon name="lock" size={18} className="shrink-0" />
          <span>
            <strong className="block font-semibold">{text.archivedTitle}</strong>
            {text.archivedNotice}
          </span>
        </div>
      )}

      <PendingSyncPanel queue={queue} locale={locale} />

      {/* Always mounted, so results are announced; the cards below are visual only. */}
      <p role="status" className="sr-only">{shownNotice ?? ""}</p>

      {shownNotice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-status-success-border bg-status-success-bg p-3.5 text-[13px] leading-relaxed text-status-success-text">
          <Icon name="check-circle" size={18} className="shrink-0" />
          <span className="min-w-0 break-words">{shownNotice}</span>
        </div>
      )}

      {(exportError || actionError || sessionNotice) && (
        <div role="alert" aria-live="assertive" className="flex items-start gap-2.5 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] leading-relaxed text-status-danger-text">
          <Icon name="alert" size={18} className="shrink-0" />
          <span>{actionError ?? exportError ?? sessionNotice}</span>
        </div>
      )}

      {trash && <p className="px-1 text-[13px] leading-relaxed text-text-muted">{text.trashNote}</p>}

      {list.status === "error" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-status-danger-border bg-status-danger-bg p-3.5 text-[13px] text-status-danger-text">
          <span className="flex min-w-0 items-center gap-2.5">
            <Icon name="alert" size={18} className="shrink-0" />
            <span className="min-w-0 break-words">{list.error ? `${text.listFailed} ${list.error}` : text.listFailed}</span>
          </span>
          <Button type="button" size="md" variant="secondary" onClick={list.reload}>
            <Icon name="sync" size={16} />
            <span>{text.retry}</span>
          </Button>
        </div>
      )}

      {list.status === "ready" && list.total > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 px-1 text-[13px] text-text-muted">
          <span>{text.showingOf(formatLocalizedNumber(list.items.length, locale), formatLocalizedNumber(list.total, locale))}</span>
          {filtersActive && !trash && counts.known && <span>· {text.boothTotal(formatLocalizedNumber(activeTotal, locale))}</span>}
          {list.refreshing && <span className="inline-flex items-center gap-1.5"><BoothSpinner />{text.searching}</span>}
        </p>
      )}

      {list.status === "loading" ? (
        <div className="space-y-3" aria-busy="true">
          <div className="skeleton h-44 rounded-2xl" />
          <div className="skeleton h-44 rounded-2xl" />
        </div>
      ) : list.status === "error" ? null : list.items.length === 0 ? (
        <div aria-busy={list.refreshing} className="relative overflow-hidden border border-dashed border-border-strong bg-surface-panel px-6 py-12 text-center shape-arc sm:py-16">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-aiteb-lavender text-aiteb-indigo">
            <Icon name={trash ? "trash" : filtersActive ? "filter" : "users"} size={26} />
          </span>
          <h3 className="mx-auto mt-4 max-w-md text-lg font-bold text-text-primary">
            {filtersActive ? t.noLeadsFilterMatch : trash ? text.trashEmptyTitle : t.noLeadsTitle}
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
            {filtersActive
              ? (isRtl ? "فیلترها را پاک کنید یا عبارت دیگری را جستجو نمایید." : "Clear active filters or try a different search keyword.")
              : trash ? text.trashEmptyDesc : t.noLeadsDesc}
          </p>
          {!filtersActive && !trash && !archived && (
            <Button type="button" variant="primary" size="md" onClick={onCapture} className="mt-6">
              <Icon name="scan" size={18} />
              <span>{t.captureLeadAction}</span>
            </Button>
          )}
        </div>
      ) : (
        <div aria-busy={list.refreshing} className={`grid grid-cols-1 gap-3 transition-opacity ${list.refreshing ? "opacity-60" : ""}`}>
          {list.items.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              locale={locale}
              capturedAt={formatLocalizedDate(lead.created_at, locale)}
              deletedAt={lead.deleted_at ? formatLocalizedDate(lead.deleted_at, locale) : undefined}
              labels={labels}
              busy={busyId === lead.id}
              actionsDisabled={!queue.online || archived}
              onQualify={lead.deleted_at || archived ? undefined : () => onQualify(lead)}
              onDelete={lead.deleted_at ? undefined : () => void deleteLead(lead)}
              onRestore={lead.deleted_at ? () => void restoreLead(lead, false) : undefined}
            />
          ))}
        </div>
      )}

      {list.status === "ready" && list.hasMore && (
        <div className="flex flex-col items-center gap-2 pt-1">
          {list.loadMoreError !== null && (
            <p role="alert" className="text-center text-[13px] text-status-danger-text">{list.loadMoreError || text.loadMoreFailed}</p>
          )}
          <Button type="button" variant="secondary" size="lg" disabled={list.loadingMore || !queue.online} aria-busy={list.loadingMore} onClick={list.loadMore} className="w-full sm:w-auto">
            {list.loadingMore ? <BoothSpinner /> : <Icon name="chevron-down" size={18} />}
            <span>{list.loadingMore ? text.loadingMore : text.loadMore}</span>
            {!list.loadingMore && <span className="tabular text-text-muted">({formatLocalizedNumber(remaining, locale)})</span>}
          </Button>
        </div>
      )}

      {toast && (
        <UndoToast
          message={text.leadDeleted(toast.attendee_name)}
          undoLabel={text.undo}
          dismissLabel={text.dismiss}
          undoing={undoing}
          onUndo={() => void restoreLead(toast, true)}
          onDismiss={dismissToast}
        />
      )}
    </section>
  );
}
