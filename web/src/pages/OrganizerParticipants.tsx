import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiResponseError,
  apiErrorCode,
  localizedApiError,
  type EventOut,
  type ParticipantDetail,
  type ParticipantOut,
  type ParticipantPage,
  type TicketTierOut,
} from "../api/client";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { Badge } from "../components/ui/Badge";
import { Button, LinkButton } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Dialog } from "../components/ui/Dialog";
import { SearchInput, Select, TextInput, Textarea } from "../components/ui/Input";
import { RowActions, type RowAction } from "../components/ui/RowActions";
import { Switch } from "../components/ui/Switch";
import { DialogActions, EmptyState, Field, FormAlert, MetaItem, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";
import { organizerDataCopy } from "../copy/organizerData";
import { formatDate, formatNumber } from "../lib/format";
import { formatMobile, normalizeIranMobile } from "../lib/mobile";
import { eventWorkspacePath } from "../lib/organizerWorkspace";
import {
  PARTICIPANTS_COPY,
  cancelReasonLabel,
  cancelledByLabel,
  clampPage,
  fill,
  pageRange,
  transferProblem,
  type ParticipantListState,
  type ParticipantStatusFilter,
  type ParticipantsCopy,
} from "../lib/participants";
import { createParticipantsApi } from "../lib/participantsApi";
import { EventSectionGate } from "./organizer/EventSectionUi";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type Action = "edit" | "cancel" | "reissue" | "transfer";
type Locale = "fa" | "en";

// The event workspace remounts per event, so a late response for event A can never write into event B's state.
export default function OrganizerParticipants() {
  return <EventSectionGate>{(event) => <ParticipantsSection event={event} />}</EventSectionGate>;
}

function ParticipantsSection({ event }: { event: EventOut }) {
  // A 401 on the organizer key reaches the layout's handler from every request below (registerUnauthorizedHandler).
  const { eventId, client, apiKey, locale, can, canEdit } = useEventWorkspace();
  // Changing a pass needs a manager on a congress that is not archived; the export is a manager's (backend/app/roles.py).
  const canExport = can("manager");
  // The list itself carries personal data: staff and up (a viewer is answered ROLE_FORBIDDEN).
  const canLookUp = can("staff");
  const copy = PARTICIPANTS_COPY[locale];
  const timeZone = event.timezone;

  const api = useMemo(() => (apiKey && eventId ? createParticipantsApi(apiKey, eventId) : null), [apiKey, eventId]);

  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ParticipantListState>({ q: "", tierId: "", status: "", page: 0, pageSize: PAGE_SIZE });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<ParticipantPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: Action; participant: ParticipantOut } | null>(null);

  /** The error in the organizer's language. */
  const errorText = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiResponseError) return localizedApiError(error, locale, error.status);
      return error instanceof TypeError ? copy.networkError : fallback;
    },
    [locale, copy],
  );

  // Pass types (for the filter), once per event and key.
  useEffect(() => {
    if (!client || !eventId || !canLookUp) return;
    let active = true;
    void client.GET("/api/events/{event_id}/ticket-tiers", { params: { path: { event_id: eventId } } }).then(({ data: loaded }) => {
      if (active && loaded) setTiers(loaded);
    });
    return () => {
      active = false;
    };
  }, [client, eventId, canLookUp]);

  // Typing settles before the list is asked again; a new search starts at the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.q === search ? current : { ...current, q: search, page: 0 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const requestSeq = useRef(0);
  useEffect(() => {
    if (!api || !canLookUp) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    api
      .list(filters)
      .then((page) => {
        if (seq !== requestSeq.current) return;
        // The list shrank under the current page (a delete, a filter elsewhere): step back to the last page.
        const clamped = clampPage(filters.page, filters.pageSize, page.total);
        if (clamped !== filters.page) {
          setFilters((current) => ({ ...current, page: clamped }));
          return;
        }
        setData(page);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (seq !== requestSeq.current) return;
        setLoadError(errorText(error, copy.loadError));
        setLoading(false);
      });
    // The copy language does not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, canLookUp, filters, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const openDetail = useCallback(
    (ticketId: string) => {
      if (!api) return;
      setSelectedId(ticketId);
      setDetail(null);
      setDetailError(null);
      setDrawerError(null);
      api
        .get(ticketId)
        .then(setDetail)
        .catch((error: unknown) => setDetailError(errorText(error, copy.detailLoadError)));
    },
    [api, errorText, copy],
  );

  /** An action finished: show the result, refresh the list and, when the drawer is open, its participant. */
  const actionDone = useCallback(
    (message: string, updated: ParticipantDetail | null) => {
      setAction(null);
      setNotice({ tone: "ok", text: message });
      if (selectedId) {
        if (updated) {
          setSelectedId(updated.ticket_id);
          setDetail(updated);
        } else {
          setSelectedId(null);
          setDetail(null);
        }
      }
      reload();
    },
    [selectedId, reload],
  );

  const removeRegistration = async (participant: ParticipantDetail) => {
    if (!api) return;
    setDrawerError(null);
    try {
      await api.remove(participant.ticket_id);
      actionDone(copy.deleted, null);
    } catch (error) {
      // A scan or lead that arrived meanwhile answers PARTICIPANT_HAS_HISTORY: "cancel the pass instead".
      setDrawerError(errorText(error, copy.actionError));
    }
  };

  const handleExport = async () => {
    if (!api) return;
    setExporting(true);
    try {
      const blob = await api.exportCsv(filters);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event.slug}-participants.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, copy.csvError) });
    } finally {
      setExporting(false);
    }
  };

  const setFilter = (patch: Partial<ParticipantListState>) => setFilters((current) => ({ ...current, ...patch, page: 0 }));
  const filtered = Boolean(filters.q.trim() || filters.tierId || filters.status);
  const activeFilters = (filters.tierId ? 1 : 0) + (filters.status ? 1 : 0);
  const clearFilters = () => {
    setSearch("");
    setFilters((current) => ({ ...current, q: "", tierId: "", status: "", page: 0 }));
  };
  const num = (n: number) => formatNumber(n, locale);
  // Filters and export only once there is something to filter.
  const hasRows = data !== null && (data.total > 0 || filtered);

  if (!canLookUp) {
    return (
      <div className="space-y-6">
        <SectionHeader title={copy.title} />
        <EmptyState
          icon="lock"
          title={copy.lockedTitle}
          action={
            <LinkButton to={eventWorkspacePath(eventId, "/analytics")} variant="secondary" icon="chart">
              {copy.openStatistics}
            </LinkButton>
          }
        />
      </div>
    );
  }

  const exportAction = canExport && data !== null && data.total > 0 && (
    <>
      <Button type="button" variant="secondary" icon="download" loading={exporting} onClick={() => void handleExport()} className="max-sm:hidden">
        {exporting ? copy.exporting : copy.exportCsv}
      </Button>
      <RowActions
        className="sm:hidden"
        visible={0}
        menuLabel={copy.more}
        actions={[{ label: copy.exportCsv, icon: "download", disabled: exporting, onSelect: () => void handleExport() }]}
      />
    </>
  );

  const tierSelect = (
    <Select value={filters.tierId} onChange={(e) => setFilter({ tierId: e.target.value })}>
      <option value="">{copy.all}</option>
      {tiers.map((tier) => (
        <option key={tier.id} value={tier.id}>
          {tier.name}
        </option>
      ))}
    </Select>
  );
  const statusSelect = (
    <Select value={filters.status} onChange={(e) => setFilter({ status: e.target.value as ParticipantStatusFilter })}>
      <option value="">{copy.all}</option>
      <option value="active">{copy.statusActive}</option>
      <option value="cancelled">{copy.statusCancelled}</option>
    </Select>
  );
  const range = data ? pageRange(data.offset, data.items.length, data.total) : null;

  return (
    <div className="space-y-5">
      <SectionHeader title={copy.title} action={exportAction || undefined} />

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={copy.dismiss}>
          {notice.text}
        </Notice>
      )}

      {hasRows && (
        <div role="search" aria-label={copy.filters} className="flex items-end gap-3">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            aria-label={copy.searchLabel}
            placeholder={copy.searchPlaceholder}
            wrapperClassName="min-w-0 flex-1 sm:max-w-md"
            data-testid="participants-search"
          />
          <Field label={copy.tierFilter} className="w-48 max-sm:hidden">
            {tierSelect}
          </Field>
          <Field label={copy.statusFilter} className="w-40 max-sm:hidden">
            {statusSelect}
          </Field>
          <Button type="button" variant="secondary" icon="filter" className="sm:hidden" onClick={() => setFiltersOpen(true)} data-testid="participants-filter-button">
            {activeFilters > 0 ? `${copy.filtersButton} (${num(activeFilters)})` : copy.filtersButton}
          </Button>
        </div>
      )}

      {loadError ? (
        <div className="space-y-3">
          <FormAlert>
            {copy.loadError} {loadError !== copy.loadError && <bdi>{loadError}</bdi>}
          </FormAlert>
          <Button type="button" variant="secondary" icon="sync" onClick={reload}>
            {copy.retry}
          </Button>
        </div>
      ) : !data ? (
        <div role="status" aria-label={copy.loading} className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-14" />
          ))}
        </div>
      ) : data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon="search"
            title={copy.noResults}
            action={
              <Button type="button" variant="secondary" onClick={clearFilters}>
                {copy.clearFilters}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon="users"
            title={copy.emptyTitle}
            action={
              <LinkButton to={eventWorkspacePath(eventId, "/desk")} variant="secondary" icon="id-card">
                {copy.openDesk}
              </LinkButton>
            }
          />
        )
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          <div className="overflow-clip rounded-card border border-border-default bg-surface-panel shadow-soft">
            <table className={`org-table org-table--stack ${loading ? "opacity-60" : ""}`} data-testid="participants-table">
              <caption className="sr-only">{copy.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.colName}</th>
                  <th scope="col">{copy.colMobile}</th>
                  <th scope="col">{copy.colTier}</th>
                  <th scope="col">{copy.colStatus}</th>
                  <th scope="col" className="text-end">
                    {copy.colCheckins}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  // The whole row opens the drawer; the name button gives keyboard users the same way in.
                  <tr key={p.ticket_id} data-testid="participant-row" onClick={() => openDetail(p.ticket_id)} className="cursor-pointer">
                    <td>
                      <div className="flex items-start justify-between gap-3">
                        <button type="button" className="min-h-11 min-w-0 cursor-pointer rounded-md text-start">
                          <span className="block break-words text-body-sm font-semibold text-text-primary">
                            <bdi>{p.attendee_full_name}</bdi>
                          </span>
                          {(p.attendee_organization || p.attendee_title) && (
                            <span className="block break-words text-caption text-text-muted">
                              <bdi>{[p.attendee_title, p.attendee_organization].filter(Boolean).join(" · ")}</bdi>
                            </span>
                          )}
                        </button>
                        <span className="md:hidden">
                          <StatusBadge status={p.status} copy={copy} />
                        </span>
                      </div>
                      {/* Phones: one meta line instead of a labelled line per column. */}
                      <p className="flex flex-wrap gap-x-2 text-caption text-text-secondary md:hidden">
                        <MobileText participant={p} copy={copy} locale={locale} />
                        <span aria-hidden="true">·</span>
                        <bdi>{p.ticket_tier_name}</bdi>
                        <span aria-hidden="true">·</span>
                        <span>{fill(copy.checkinsCount, { count: num(p.checkin_count) })}</span>
                      </p>
                    </td>
                    <td data-label={copy.colMobile} className="text-caption max-md:hidden">
                      <MobileText participant={p} copy={copy} locale={locale} />
                    </td>
                    <td data-label={copy.colTier} className="text-body-sm max-md:hidden">
                      <bdi>{p.ticket_tier_name}</bdi>
                    </td>
                    <td data-label={copy.colStatus} className="max-md:hidden">
                      <StatusBadge status={p.status} copy={copy} />
                    </td>
                    <td data-label={copy.colCheckins} className="tabular text-end text-body-sm max-md:hidden" data-testid="participant-checkins">
                      {num(p.checkin_count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {range && (range.hasPrev || range.hasNext || data.total > 0) && (
            <nav aria-label={copy.pager} className="flex flex-wrap items-center justify-between gap-3 text-body-sm text-text-secondary">
              <span data-testid="participants-range">{fill(copy.range, { from: num(range.from), to: num(range.to), total: num(data.total) })}</span>
              {(range.hasPrev || range.hasNext) && (
                <span className="flex gap-2">
                  <Button type="button" variant="secondary" size="sm" disabled={!range.hasPrev || loading} onClick={() => setFilters((c) => ({ ...c, page: c.page - 1 }))}>
                    {copy.prev}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" disabled={!range.hasNext || loading} onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}>
                    {copy.next}
                  </Button>
                </span>
              )}
            </nav>
          )}
        </div>
      )}

      {/* Phones: the two filters live in a sheet behind the «فیلتر» button. */}
      <Dialog
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={copy.filtersTitle}
        size="sm"
        footer={
          <div className="flex flex-col-reverse gap-2">
            {activeFilters > 0 && (
              <Button type="button" variant="ghost" onClick={() => setFilters((c) => ({ ...c, tierId: "", status: "", page: 0 }))}>
                {copy.clearFilters}
              </Button>
            )}
            <Button type="button" variant="primary" isFullWidth onClick={() => setFiltersOpen(false)}>
              {copy.showResults}
            </Button>
          </div>
        }
      >
        <div className="space-y-4" data-testid="participants-filter-sheet">
          <Field label={copy.tierFilter}>{tierSelect}</Field>
          <Field label={copy.statusFilter}>{statusSelect}</Field>
        </div>
      </Dialog>

      {/* Detail drawer: a side sheet on larger screens, a bottom sheet on phones. */}
      <Dialog
        isOpen={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={detail?.attendee_full_name ?? copy.detailTitle}
        size="lg"
        className="sm:ms-auto sm:self-stretch"
      >
        {detailError ? (
          <div className="space-y-3">
            <FormAlert>{detailError}</FormAlert>
            <Button type="button" variant="secondary" icon="sync" onClick={() => selectedId && openDetail(selectedId)}>
              {copy.retry}
            </Button>
          </div>
        ) : !detail ? (
          <div role="status" aria-label={copy.loading} className="space-y-2">
            <div className="skeleton h-10" />
            <div className="skeleton h-32" />
          </div>
        ) : (
          <ParticipantDrawer
            participant={detail}
            copy={copy}
            locale={locale}
            timeZone={timeZone}
            canEdit={canEdit}
            error={drawerError}
            onAction={(kind) => setAction({ kind, participant: detail })}
            onDelete={() => void removeRegistration(detail)}
          />
        )}
      </Dialog>

      {api && action?.kind === "edit" && (
        <EditDialog
          participant={action.participant}
          copy={copy}
          onClose={() => setAction(null)}
          onSubmit={async (body) => actionDone(copy.saved, await api.update(action.participant.ticket_id, body))}
          errorText={errorText}
        />
      )}
      {api && action?.kind === "cancel" && (
        <CancelDialog
          copy={copy}
          onClose={() => setAction(null)}
          onSubmit={async (body) => actionDone(copy.cancelled, await api.cancel(action.participant.ticket_id, body))}
          errorText={errorText}
        />
      )}
      {api && action?.kind === "reissue" && (
        <ReissueDialog
          copy={copy}
          onClose={() => setAction(null)}
          onSubmit={async (notify) => actionDone(copy.reissued, await api.reissue(action.participant.ticket_id, notify))}
          errorText={errorText}
        />
      )}
      {api && action?.kind === "transfer" && (
        <TransferDialog
          copy={copy}
          onClose={() => setAction(null)}
          onSubmit={async (body) => {
            const moved = await api.transfer(action.participant.ticket_id, body);
            actionDone(fill(copy.transferred, { name: moved.attendee_full_name }), moved);
          }}
          errorText={errorText}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, copy }: { status: ParticipantOut["status"]; copy: ParticipantsCopy }) {
  return status === "active" ? (
    <Badge variant="success" size="sm" dot>
      {copy.statusActive}
    </Badge>
  ) : (
    <Badge variant="neutral" size="sm">
      {copy.statusCancelled}
    </Badge>
  );
}

function MobileText({ participant, copy, locale }: { participant: ParticipantOut; copy: ParticipantsCopy; locale: Locale }) {
  if (participant.account_deleted) return <span className="text-text-muted">{copy.accountDeleted}</span>;
  if (!participant.mobile) return <span className="text-text-muted">{copy.noMobile}</span>;
  return (
    <bdi dir="ltr" className="tabular">
      {formatMobile(participant.mobile, locale)}
    </bdi>
  );
}

/** A refused scan in the organizer's words; the code stays in the tooltip for support. */
function scanReasonLabel(reason: string, locale: Locale): string {
  const reasons: Record<string, string> = organizerDataCopy[locale].scanReasons;
  if (reason.startsWith("LOCAL_REJECTED:")) return reasons.OFFLINE;
  return reasons[reason] ?? reasons.other;
}

function ParticipantDrawer({
  participant: p,
  copy,
  locale,
  timeZone,
  canEdit,
  error,
  onAction,
  onDelete,
}: {
  participant: ParticipantDetail;
  copy: ParticipantsCopy;
  locale: Locale;
  timeZone: string;
  /** The signed-in role may change passes on this (not archived) congress; otherwise the drawer only shows them. */
  canEdit: boolean;
  error: string | null;
  onAction: (kind: Action) => void;
  onDelete: () => void;
}) {
  const active = p.status === "active";
  const when = (iso: string) => formatDate(iso, "dayTime", locale, timeZone);
  const actions: RowAction[] = [
    { label: copy.edit, icon: "note", onSelect: () => onAction("edit") },
    ...(active
      ? ([
          { label: copy.reissue, icon: "qr", onSelect: () => onAction("reissue") },
          { label: copy.transfer, icon: "user-plus", onSelect: () => onAction("transfer") },
          { label: copy.cancelTicket, icon: "x-circle", onSelect: () => onAction("cancel") },
        ] satisfies RowAction[])
      : []),
    ...(p.can_delete
      ? ([
          {
            label: copy.delete,
            icon: "trash",
            onSelect: onDelete,
            destructive: { title: copy.deleteTitle, description: copy.deleteDescription, confirmLabel: copy.confirmDelete },
          },
        ] satisfies RowAction[])
      : []),
  ];
  return (
    <div className="space-y-6" data-testid="participant-drawer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={p.status} copy={copy} />
          <Badge variant="neutral" size="sm" icon={<Icon name="ticket" size={12} />}>
            <bdi>{p.ticket_tier_name}</bdi>
          </Badge>
        </div>
        {canEdit && <RowActions actions={actions} visible={2} menuLabel={copy.more} />}
      </div>
      {!active && <p className="text-body-sm text-text-secondary">{copy.passInactive}</p>}
      {error && <FormAlert>{error}</FormAlert>}

      <dl className="grid grid-cols-2 gap-4">
        <MetaItem label={copy.colMobile}>
          <MobileText participant={p} copy={copy} locale={locale} />
        </MetaItem>
        <MetaItem label={copy.registeredAt}>{when(p.created_at)}</MetaItem>
        {p.attendee_organization && (
          <MetaItem label={copy.organization}>
            <bdi>{p.attendee_organization}</bdi>
          </MetaItem>
        )}
        {p.attendee_title && (
          <MetaItem label={copy.jobTitle}>
            <bdi>{p.attendee_title}</bdi>
          </MetaItem>
        )}
        <MetaItem label={copy.checkins}>{formatNumber(p.checkin_count, locale)}</MetaItem>
        <MetaItem label={copy.leads}>{formatNumber(p.lead_count, locale)}</MetaItem>
        {p.issued_by && (
          <MetaItem label={copy.issuedBy}>
            <bdi>{p.issued_by}</bdi>
          </MetaItem>
        )}
        {p.reissued_at && <MetaItem label={copy.reissuedAt}>{when(p.reissued_at)}</MetaItem>}
        {p.cancelled_at && <MetaItem label={copy.cancelledAt}>{when(p.cancelled_at)}</MetaItem>}
        {p.cancelled_by && <MetaItem label={copy.cancelledBy}>{cancelledByLabel(p.cancelled_by, copy)}</MetaItem>}
        {p.cancelled_reason && (
          <MetaItem label={copy.cancelReason} className="col-span-2">
            <bdi>{cancelReasonLabel(p.cancelled_reason, copy)}</bdi>
          </MetaItem>
        )}
      </dl>

      <section aria-labelledby="participant-scans" className="space-y-2">
        <h3 id="participant-scans" className="text-body-sm font-bold text-text-primary">
          {copy.scanHistory}
        </h3>
        {p.scan_history.length === 0 ? (
          <p className="text-body-sm text-text-muted">{copy.noScans}</p>
        ) : (
          <ol className="divide-y divide-border-subtle rounded-control border border-border-default">
            {p.scan_history.map((scan, i) => (
              <li key={`${scan.scanned_at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-body-sm">
                <span className="min-w-0">
                  <bdi className="font-semibold text-text-primary">{scan.checkin_point_name}</bdi>
                  <span className="block text-caption text-text-muted">{when(scan.scanned_at)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {scan.rejection_reason && (
                    <span className="text-caption text-text-muted" title={scan.rejection_reason}>
                      {scanReasonLabel(scan.rejection_reason, locale)}
                    </span>
                  )}
                  <Badge variant={scan.status === "ADMITTED" ? "success" : "danger"} size="sm">
                    {scan.status === "ADMITTED" ? copy.scanAdmitted : copy.scanRejected}
                  </Badge>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Shared submit plumbing for the action dialogs: busy state and a localized error kept inside the dialog. */
function useSubmit(errorText: (error: unknown, fallback: string) => string, fallback: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code: string | undefined } | null>(null);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (failure) {
      setError({ text: errorText(failure, fallback), code: apiErrorCode(failure) });
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

interface ActionDialogProps {
  copy: ParticipantsCopy;
  onClose: () => void;
  errorText: (error: unknown, fallback: string) => string;
}

function ActionDialog({
  title,
  description,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <Dialog isOpen onClose={onClose} title={title} description={description} size="md">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {children}
      </form>
    </Dialog>
  );
}

function SubmitRow({
  copy,
  busy,
  label,
  onCancel,
  tone = "primary",
}: {
  copy: ParticipantsCopy;
  busy: boolean;
  label: string;
  onCancel: () => void;
  tone?: "primary" | "danger";
}) {
  return (
    <DialogActions>
      <Button type="button" variant="secondary" onClick={onCancel}>
        {copy.back}
      </Button>
      <Button type="submit" variant={tone} loading={busy}>
        {label}
      </Button>
    </DialogActions>
  );
}

function EditDialog({
  participant,
  copy,
  onClose,
  onSubmit,
  errorText,
}: ActionDialogProps & {
  participant: ParticipantOut;
  onSubmit: (body: { attendee_full_name: string; attendee_organization: string; attendee_title: string }) => Promise<void>;
}) {
  const [fullName, setFullName] = useState(participant.attendee_full_name);
  const [organization, setOrganization] = useState(participant.attendee_organization);
  const [jobTitle, setJobTitle] = useState(participant.attendee_title);
  const [nameMissing, setNameMissing] = useState(false);
  const { busy, error, run } = useSubmit(errorText, copy.actionError);
  return (
    <ActionDialog
      title={copy.editTitle}
      description={copy.editDescription}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!fullName.trim()) {
          setNameMissing(true);
          return;
        }
        void run(() => onSubmit({ attendee_full_name: fullName.trim(), attendee_organization: organization.trim(), attendee_title: jobTitle.trim() }));
      }}
    >
      <Field label={copy.fullName} required error={nameMissing ? copy.nameRequired : undefined}>
        <TextInput
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setNameMissing(false);
          }}
          maxLength={200}
          autoComplete="off"
        />
      </Field>
      <Field label={copy.organization}>
        <TextInput value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={200} autoComplete="off" />
      </Field>
      <Field label={copy.jobTitle}>
        <TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={100} autoComplete="off" />
      </Field>
      {error && <FormAlert>{error.text}</FormAlert>}
      <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.save} />
    </ActionDialog>
  );
}

function CancelDialog({ copy, onClose, onSubmit, errorText }: ActionDialogProps & { onSubmit: (body: { reason: string; notify: boolean }) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const { busy, error, run } = useSubmit(errorText, copy.actionError);
  return (
    <ActionDialog
      title={copy.cancelTitle}
      description={copy.cancelDescription}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onSubmit({ reason: reason.trim(), notify }));
      }}
    >
      <Field label={copy.reason} optional>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Field>
      <Switch label={copy.notify} checked={notify} onChange={setNotify} />
      {error && <FormAlert>{error.text}</FormAlert>}
      <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmCancel} tone="danger" />
    </ActionDialog>
  );
}

function ReissueDialog({ copy, onClose, onSubmit, errorText }: ActionDialogProps & { onSubmit: (notify: boolean) => Promise<void> }) {
  const [notify, setNotify] = useState(true);
  const { busy, error, run } = useSubmit(errorText, copy.actionError);
  return (
    <ActionDialog
      title={copy.reissueTitle}
      description={copy.reissueDescription}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => onSubmit(notify));
      }}
    >
      <Switch label={copy.notifyReissue} checked={notify} onChange={setNotify} />
      {error && <FormAlert>{error.text}</FormAlert>}
      <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmReissue} />
    </ActionDialog>
  );
}

function TransferDialog({
  copy,
  onClose,
  onSubmit,
  errorText,
}: ActionDialogProps & { onSubmit: (body: { mobile: string; full_name?: string; organization?: string; title?: string }) => Promise<void> }) {
  const [mobile, setMobile] = useState("");
  const [fullName, setFullName] = useState("");
  const [organization, setOrganization] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  // The server answers FULL_NAME_REQUIRED when the number has no account yet: then the name becomes required.
  const [nameRequired, setNameRequired] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof transferProblem>>(null);
  const { busy, error, run } = useSubmit(errorText, copy.actionError);

  return (
    <ActionDialog
      title={copy.transferTitle}
      description={copy.transferDescription}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        const found = transferProblem({ mobile, fullName }, nameRequired);
        setProblem(found);
        if (found) return;
        const optional = (value: string) => (value.trim() ? value.trim() : undefined);
        void run(async () => {
          try {
            await onSubmit({
              mobile: normalizeIranMobile(mobile) ?? mobile,
              full_name: optional(fullName),
              organization: optional(organization),
              title: optional(jobTitle),
            });
          } catch (failure) {
            if (apiErrorCode(failure) !== "FULL_NAME_REQUIRED") throw failure;
            setNameRequired(true);
            setProblem("nameRequired");
          }
        });
      }}
    >
      <Field label={copy.newMobile} required error={problem === "mobileInvalid" ? copy.mobileInvalid : undefined}>
        <TextInput
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={mobile}
          onChange={(e) => {
            setMobile(e.target.value);
            setProblem(null);
          }}
          autoComplete="off"
          placeholder="09121234567"
        />
      </Field>
      <fieldset className="space-y-4">
        <legend className="ui-label">{nameRequired ? copy.transferNeedsName : copy.optionalDetails}</legend>
        <Field
          label={copy.fullName}
          required={nameRequired}
          optional={!nameRequired}
          error={problem === "nameRequired" ? copy.nameRequired : undefined}
          hint={nameRequired ? undefined : copy.transferNameHint}
        >
          <TextInput
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (problem === "nameRequired") setProblem(null);
            }}
            maxLength={200}
            autoComplete="off"
          />
        </Field>
        <Field label={copy.organization} optional>
          <TextInput value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={200} autoComplete="off" />
        </Field>
        <Field label={copy.jobTitle} optional>
          <TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={100} autoComplete="off" />
        </Field>
      </fieldset>
      {error && <FormAlert>{error.text}</FormAlert>}
      <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmTransfer} />
    </ActionDialog>
  );
}
