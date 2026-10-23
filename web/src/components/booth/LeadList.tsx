import { useCallback, useState, type ReactNode } from "react";
import { createApiClient, type LeadOut } from "../../api/client";
import { boothCopy } from "../../copy/booth";
import { commonCopy } from "../../copy/common";
import { attendeeResponseState, isStoredAttendeeToken, sessionChangedMessage } from "../../lib/attendeeSession";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import { LEAD_SEARCH_MAX_LENGTH, accessBlockOf, hasLeadFilters, isEventArchived, totalOf, type AccessBlock } from "../../lib/leadList";
import { Toast } from "../ui/Toast";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { SearchInput } from "../ui/Input";
import { Notice } from "../ui/Notice";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Spinner } from "../ui/Spinner";
import { EmptyState, ErrorState } from "../ui/StateBlock";
import { LeadCard } from "./LeadCard";
import { PendingSyncPanel } from "./PendingSyncPanel";
import { codedMessage } from "./boothText";
import { LEAD_RATINGS, RATING_META, type LeadRating } from "./rating";
import type { LeadCounts, LeadListState } from "./useLeadList";
import type { LeadQueueState } from "./useLeadQueue";

interface LeadListProps {
  boothId: string;
  token: string;
  locale: AttendeeLocale;
  list: LeadListState;
  counts: LeadCounts;
  queue: LeadQueueState;
  /** The congress is archived: reads and export only. */
  archived: boolean;
  /** One short success line for the toast (export started, queued scans sent); the portal owns it. */
  notice: string | null;
  onNotice: (message: string | null) => void;
  /** An error the portal hit (export, a changed session), shown above the list. */
  error: string | null;
  /** Rows under the list controls, e.g. the install hint after the first capture. */
  children?: ReactNode;
  onQualify: (lead: LeadOut) => void;
  onAccessBlocked: (block: AccessBlock) => void;
  /** 409 EVENT_ARCHIVED: the congress is closed; its leads are read-only. */
  onArchived: () => void;
  /** The stored session changed in another tab: the portal re-renders for the current one. */
  onSessionChanged: () => void;
}

type Client = ReturnType<typeof createApiClient>;

/**
 * The booth's leads and trash: sticky view tabs, server search and rating chips with booth-wide counts, the
 * waiting offline scans, the cards with delete and undo, restore, and paging by cursor.
 */
export function LeadList({
  boothId,
  token,
  locale,
  list,
  counts,
  queue,
  archived,
  notice,
  onNotice,
  error,
  children,
  onQualify,
  onAccessBlocked,
  onArchived,
  onSessionChanged,
}: LeadListProps) {
  const text = boothCopy[locale];
  const common = commonCopy[locale];
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undoLead, setUndoLead] = useState<LeadOut | null>(null);
  const [undoing, setUndoing] = useState(false);

  const trash = list.query.view === "deleted";
  const activeTotal = counts.known ? totalOf(counts.counts) : list.appliedQuery.view === "active" ? list.total : 0;
  const filtersActive = hasLeadFilters(list.appliedQuery);

  /** Runs one lead mutation with the shared session, access and error handling. */
  const mutate = async (request: (api: Client) => Promise<{ error?: unknown; response: Response }>, failure: string): Promise<boolean> => {
    if (!isStoredAttendeeToken(token)) {
      setActionError(sessionChangedMessage(locale));
      onSessionChanged();
      return false;
    }
    try {
      const res = await request(createApiClient({ kind: "user", token }));
      if (attendeeResponseState(token, res.response.status) !== "current") return false;
      if (res.response.ok) return true;
      const block = accessBlockOf(res.response.status, res.error);
      if (block) {
        onAccessBlocked(block);
        return false;
      }
      if (isEventArchived(res.response.status, res.error)) onArchived();
      setActionError(codedMessage(res.error, locale) ?? failure);
    } catch {
      setActionError(failure);
    }
    return false;
  };

  const deleteLead = async (lead: LeadOut) => {
    setBusyId(lead.id);
    setActionError(null);
    onNotice(null);
    const ok = await mutate(
      (api) => api.DELETE("/api/booths/{booth_id}/leads/{lead_id}", { params: { path: { booth_id: boothId, lead_id: lead.id } } }),
      text.deleteFailed,
    );
    setBusyId(null);
    if (!ok) return;
    list.dropLead(lead.id);
    counts.refresh();
    setUndoing(false);
    setUndoLead(lead);
  };

  const restoreLead = async (lead: LeadOut, fromUndo: boolean) => {
    if (fromUndo) setUndoing(true);
    else setBusyId(lead.id);
    setActionError(null);
    const ok = await mutate(
      (api) => api.POST("/api/booths/{booth_id}/leads/{lead_id}/restore", { params: { path: { booth_id: boothId, lead_id: lead.id } } }),
      text.restoreFailed,
    );
    setBusyId(null);
    setUndoing(false);
    if (!ok) return;
    setUndoLead(null);
    // Back in the worklist at its own place (newest first); out of the trash view.
    if (fromUndo) list.reload();
    else list.dropLead(lead.id);
    counts.refresh();
    onNotice(text.leadRestored(lead.attendee_name));
  };

  const dismissUndo = useCallback(() => setUndoLead(null), []);
  const dismissNotice = useCallback(() => onNotice(null), [onNotice]);

  const count = (value: number | null) => (value === null ? null : <span className="tabular text-text-muted">{formatLocalizedNumber(value, locale)}</span>);
  const shownError = actionError ?? error;

  return (
    <section aria-label={text.leadsTab} className="min-w-0">
      <div className="booth-toolbar -mx-4 space-y-2 border-b border-border-subtle bg-surface-page/95 px-4 pt-3 pb-3 backdrop-blur-sm">
        <SegmentedControl
          label={text.viewLabel}
          value={list.query.view}
          onChange={list.setView}
          options={[
            { value: "active", icon: "users", label: <>{text.leadsTab} {count(counts.known ? activeTotal : null)}</> },
            { value: "deleted", icon: "trash", label: <>{text.trashTab} {count(counts.known ? counts.deleted : null)}</> },
          ]}
        />
        <SearchInput
          value={list.query.q}
          maxLength={LEAD_SEARCH_MAX_LENGTH}
          onChange={(e) => list.setSearch(e.target.value)}
          onClear={() => list.setSearch("")}
          clearLabel={common.clearSearch}
          placeholder={text.searchPlaceholder}
          aria-label={text.searchPlaceholder}
        />
        <div role="group" aria-label={text.ratingFilter} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
          {(["", ...LEAD_RATINGS] as const).map((value: "" | LeadRating) => {
            const on = list.query.rating === value;
            const meta = value ? RATING_META[value] : null;
            const n = trash ? null : value ? counts.counts[value] : activeTotal;
            return (
              <button
                key={value || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => list.setRating(value)}
                className={`${meta?.tone ?? ""} press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-body-sm font-semibold whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                  on
                    ? meta
                      ? "border-transparent bg-[var(--rating-solid)] text-white"
                      : "border-transparent bg-surface-ink text-white"
                    : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
                }`}
              >
                {meta && <Icon name={meta.icon} size={15} className={on ? "" : "text-[var(--rating-solid)]"} />}
                <span>{value ? text.rating[value] : text.ratingAll}</span>
                {n !== null && <span className={`tabular ${on ? "text-white/80" : "text-text-muted"}`}>{formatLocalizedNumber(n, locale)}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3 pt-3">
        <PendingSyncPanel queue={queue} locale={locale} />
        {!queue.online && (
          <Notice tone="warning" icon="wifi-off">
            <span data-testid="offline-banner">{text.offlineNotice}</span>
          </Notice>
        )}
        {queue.storageError && <Notice tone="danger">{text.storageUnavailable}</Notice>}
        {archived && (
          <Notice tone="info" icon="lock">
            <span data-testid="archived-notice">{text.archivedNotice}</span>
          </Notice>
        )}
        {shownError && <Notice tone="danger">{shownError}</Notice>}
        {children}

        {list.status === "ready" && list.total > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 px-1 text-body-sm text-text-muted">
            <span>{text.showingOf(formatLocalizedNumber(list.items.length, locale), formatLocalizedNumber(list.total, locale))}</span>
            {filtersActive && !trash && counts.known && <span>{text.boothTotal(formatLocalizedNumber(activeTotal, locale))}</span>}
            {list.refreshing && (
              <span className="inline-flex items-center gap-1.5">
                <Spinner size={16} />
                {text.searching}
              </span>
            )}
          </p>
        )}

        {list.status === "loading" ? (
          <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
            <div className="skeleton h-32 rounded-card" />
            <div className="skeleton h-32 rounded-card" />
          </div>
        ) : list.status === "error" ? (
          <ErrorState title={text.listFailed} body={list.error || undefined} onRetry={list.reload} retryLabel={common.retry} />
        ) : list.items.length === 0 ? (
          <div aria-busy={list.refreshing}>
            <EmptyState
              icon={trash ? "trash" : filtersActive ? "filter" : "users"}
              title={filtersActive ? text.noMatchTitle : trash ? text.trashEmptyTitle : text.noLeadsTitle}
              body={filtersActive ? undefined : trash ? text.trashEmptyDesc : archived ? undefined : text.noLeadsDesc}
            />
          </div>
        ) : (
          <div aria-busy={list.refreshing} className={`grid grid-cols-1 gap-3 transition-opacity lg:grid-cols-2 ${list.refreshing ? "opacity-60" : ""}`}>
            {list.items.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                locale={locale}
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
            {list.loadMoreError !== null && <Notice tone="danger">{list.loadMoreError || text.loadMoreFailed}</Notice>}
            <Button
              type="button"
              variant="secondary"
              icon="chevron-down"
              loading={list.loadingMore}
              disabled={!queue.online}
              onClick={list.loadMore}
              className="w-full sm:w-auto"
            >
              {text.loadMore} {count(Math.max(0, list.total - list.items.length))}
            </Button>
          </div>
        )}
      </div>

      {undoLead ? (
        <Toast
          key={undoLead.id}
          testId="undo-toast"
          icon="trash"
          message={text.leadDeleted(undoLead.attendee_name)}
          dismissLabel={common.close}
          onDismiss={dismissUndo}
          action={{ label: text.undo, busy: undoing, onClick: () => void restoreLead(undoLead, true) }}
        />
      ) : (
        notice && <Toast key={notice} message={notice} dismissLabel={common.close} onDismiss={dismissNotice} />
      )}
    </section>
  );
}
