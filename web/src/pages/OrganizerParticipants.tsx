import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { ApiResponseError, apiErrorCode, createApiClient, localizedApiError, type EventOut, type TicketTierOut } from "../api/client";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Icon } from "../components/ui/Icon";
import { DialogActions, EmptyState, Field, FormAlert, MetaItem, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";
import { formatLocalizedNumber } from "../lib/i18n";
import { formatMobile, normalizeIranMobile } from "../lib/mobile";
import { eventOperationNumber } from "../lib/organizerWorkspace";
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
import { createParticipantsApi, type ParticipantDetail, type ParticipantOut, type ParticipantPage } from "../lib/participantsApi";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type Action = "edit" | "cancel" | "reissue" | "transfer" | "delete";

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerParticipants() {
  const { eventId } = useParams<{ eventId: string }>();
  return <ParticipantsContent key={eventId} />;
}

function ParticipantsContent() {
  const { eventId = "" } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, reportEvent, locale } = useOutletContext<OrganizerOutletContext>();
  const copy = PARTICIPANTS_COPY[locale];

  const api = useMemo(() => (apiKey && eventId ? createParticipantsApi(apiKey, eventId) : null), [apiKey, eventId]);
  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);

  const [event, setEvent] = useState<EventOut | null>(null);
  const [tiers, setTiers] = useState<TicketTierOut[]>([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ParticipantListState>({ q: "", tierId: "", status: "", page: 0, pageSize: PAGE_SIZE });
  const [data, setData] = useState<ParticipantPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ParticipantDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: Action; participant: ParticipantOut } | null>(null);

  /** The error in the organizer's language; a rejected key sends them back to the key gate. */
  const errorText = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiResponseError) {
        if (error.status === 401 && apiKey) onKeyRejected(apiKey);
        return localizedApiError(error, locale);
      }
      return error instanceof TypeError ? copy.networkError : fallback;
    },
    [apiKey, onKeyRejected, locale, copy],
  );

  // Event (for the workspace header) and ticket types (for the filter), once per event and key.
  useEffect(() => {
    if (!client || !eventId) return;
    let active = true;
    void Promise.all([
      client.GET("/api/events/{event_id}", { params: { path: { event_id: eventId } } }),
      client.GET("/api/events/{event_id}/ticket-tiers", { params: { path: { event_id: eventId } } }),
    ])
      .then(([ev, tt]) => {
        if (ev.response.status === 401 && apiKey) onKeyRejected(apiKey);
        if (!active) return;
        if (ev.data) setEvent(ev.data);
        if (tt.data) setTiers(tt.data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, eventId, apiKey, onKeyRejected]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  // Typing settles before the list is asked again; a new search starts at the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((current) => (current.q === search ? current : { ...current, q: search, page: 0 }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const requestSeq = useRef(0);
  useEffect(() => {
    if (!api) return;
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
  }, [api, filters, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const openDetail = useCallback(
    (ticketId: string) => {
      if (!api) return;
      setSelectedId(ticketId);
      setDetail(null);
      setDetailError(null);
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

  const handleExport = async () => {
    if (!api) return;
    setExporting(true);
    try {
      const blob = await api.exportCsv(filters);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${event?.slug ?? "congress"}-participants.csv`;
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
  const clearFilters = () => {
    setSearch("");
    setFilters((current) => ({ ...current, q: "", tierId: "", status: "", page: 0 }));
  };
  const num = (n: number) => formatLocalizedNumber(n, locale);

  const header = (
    <SectionHeader
      index={eventOperationNumber("participants")}
      eyebrow={<bdi>{event?.name ?? ""}</bdi>}
      title={copy.title}
      description={copy.description}
      action={
        <Button type="button" variant="secondary" size="md" onClick={() => void handleExport()} disabled={exporting || !api} aria-busy={exporting}>
          <Icon name="download" size={16} />
          {exporting ? copy.exporting : copy.exportCsv}
        </Button>
      }
    />
  );

  const range = data ? pageRange(data.offset, data.items.length, data.total) : null;

  return (
    <div className="space-y-6">
      {header}

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={copy.dismiss}>
          {notice.text}
        </Notice>
      )}

      <div role="search" aria-label={copy.filters} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label={copy.searchLabel}>
          <span className="relative block">
            <Icon name="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={copy.searchPlaceholder}
              className="ui-input ps-9"
              data-testid="participants-search"
            />
          </span>
        </Field>
        <Field label={copy.tierFilter}>
          <select value={filters.tierId} onChange={(e) => setFilter({ tierId: e.target.value })} className="ui-select">
            <option value="">{copy.all}</option>
            {tiers.map((tier) => (
              <option key={tier.id} value={tier.id}>
                {tier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={copy.statusFilter}>
          <select
            value={filters.status}
            onChange={(e) => setFilter({ status: e.target.value as ParticipantStatusFilter })}
            className="ui-select"
          >
            <option value="">{copy.all}</option>
            <option value="active">{copy.statusActive}</option>
            <option value="cancelled">{copy.statusCancelled}</option>
          </select>
        </Field>
      </div>

      {loadError ? (
        <div className="space-y-3">
          <FormAlert>
            {copy.loadError} {loadError !== copy.loadError && <span>{loadError}</span>}
          </FormAlert>
          <Button type="button" variant="secondary" size="md" onClick={reload}>
            <Icon name="sync" size={16} />
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
              <Button type="button" variant="secondary" size="md" onClick={clearFilters}>
                {copy.clearFilters}
              </Button>
            }
          />
        ) : (
          <EmptyState icon="users" title={copy.emptyTitle}>
            {copy.emptyBody}
          </EmptyState>
        )
      ) : (
        <div className="space-y-3" aria-busy={loading}>
          <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
            <table className={`org-table org-table--stack ${loading ? "opacity-60" : ""}`} data-testid="participants-table">
              <caption className="sr-only">{copy.title}</caption>
              <thead>
                <tr>
                  <th scope="col">{copy.colName}</th>
                  <th scope="col">{copy.colMobile}</th>
                  <th scope="col">{copy.colTier}</th>
                  <th scope="col">{copy.colStatus}</th>
                  <th scope="col">{copy.colRegistered}</th>
                  <th scope="col">
                    <span className="sr-only">{copy.colActions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.ticket_id} data-testid="participant-row">
                    <td>
                      <button
                        type="button"
                        onClick={() => openDetail(p.ticket_id)}
                        className="min-h-[44px] cursor-pointer rounded-md text-start"
                      >
                        <span className="block break-words text-sm font-semibold text-text-primary hover:underline">
                          <bdi>{p.attendee_full_name}</bdi>
                        </span>
                        {(p.attendee_organization || p.attendee_title) && (
                          <span className="block break-words text-xs text-text-muted">
                            <bdi>{[p.attendee_title, p.attendee_organization].filter(Boolean).join(" · ")}</bdi>
                          </span>
                        )}
                      </button>
                    </td>
                    <td data-label={copy.colMobile} className="text-xs">
                      <MobileText participant={p} copy={copy} locale={locale} />
                    </td>
                    <td data-label={copy.colTier} className="text-sm">
                      <bdi>{p.ticket_tier_name}</bdi>
                    </td>
                    <td data-label={copy.colStatus}>
                      <StatusBadge status={p.status} copy={copy} />
                    </td>
                    <td data-label={copy.colRegistered} className="text-xs text-text-secondary">
                      <span>{formatDateTime(p.created_at, locale)}</span>
                    </td>
                    <td className="text-end">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setAction({ kind: "edit", participant: p })}
                          aria-label={`${copy.edit}: ${p.attendee_full_name}`}
                        >
                          <Icon name="note" size={15} />
                          {copy.edit}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openDetail(p.ticket_id)}
                          aria-label={`${copy.manage}: ${p.attendee_full_name}`}
                        >
                          {copy.manage}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {range && (
            <nav aria-label={copy.title} className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
              <span data-testid="participants-range">
                {fill(copy.range, { from: num(range.from), to: num(range.to), total: num(data.total) })}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!range.hasPrev || loading}
                  onClick={() => setFilters((c) => ({ ...c, page: c.page - 1 }))}
                >
                  {copy.prev}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!range.hasNext || loading}
                  onClick={() => setFilters((c) => ({ ...c, page: c.page + 1 }))}
                >
                  {copy.next}
                </Button>
              </span>
            </nav>
          )}
        </div>
      )}

      {/* Detail drawer: a side sheet on larger screens, a bottom sheet on phones. */}
      <Dialog
        isOpen={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={detail?.attendee_full_name ?? copy.detailTitle}
        description={detail ? copy.detailTitle : undefined}
        size="lg"
        className="sm:ms-auto sm:self-stretch"
      >
        {detailError ? (
          <div className="space-y-3">
            <FormAlert>{detailError}</FormAlert>
            <Button type="button" variant="secondary" size="md" onClick={() => selectedId && openDetail(selectedId)}>
              <Icon name="sync" size={16} />
              {copy.retry}
            </Button>
          </div>
        ) : !detail ? (
          <div role="status" aria-label={copy.loading} className="space-y-2">
            <div className="skeleton h-10" />
            <div className="skeleton h-32" />
          </div>
        ) : (
          <ParticipantDrawer participant={detail} copy={copy} locale={locale} onAction={(kind) => setAction({ kind, participant: detail })} />
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
      {api && action?.kind === "delete" && (
        <DeleteDialog
          participant={action.participant}
          copy={copy}
          onClose={() => setAction(null)}
          onSubmit={async () => {
            await api.remove(action.participant.ticket_id);
            actionDone(copy.deleted, null);
          }}
          onCancelInstead={() => setAction({ kind: "cancel", participant: action.participant })}
          errorText={errorText}
        />
      )}
    </div>
  );
}

function formatDateTime(iso: string, locale: "fa" | "en"): string {
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
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

function MobileText({ participant, copy, locale }: { participant: ParticipantOut; copy: ParticipantsCopy; locale: "fa" | "en" }) {
  if (participant.account_deleted) return <span className="text-text-muted">{copy.accountDeleted}</span>;
  if (!participant.mobile) return <span className="text-text-muted">{copy.noMobile}</span>;
  return (
    <bdi dir="ltr" className="font-mono">
      {formatMobile(participant.mobile, locale)}
    </bdi>
  );
}

function ParticipantDrawer({
  participant: p,
  copy,
  locale,
  onAction,
}: {
  participant: ParticipantDetail;
  copy: ParticipantsCopy;
  locale: "fa" | "en";
  onAction: (kind: Action) => void;
}) {
  const active = p.status === "active";
  const num = (n: number) => formatLocalizedNumber(n, locale);
  return (
    <div className="space-y-6" data-testid="participant-drawer">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={p.status} copy={copy} />
        <Badge variant="neutral" size="sm" icon={<Icon name="ticket" size={12} />}>
          <bdi>{p.ticket_tier_name}</bdi>
        </Badge>
      </div>
      {!active && <p className="text-sm text-text-secondary">{copy.passInactive}</p>}

      <dl className="grid grid-cols-2 gap-4">
        <MetaItem label={copy.colMobile}>
          <MobileText participant={p} copy={copy} locale={locale} />
        </MetaItem>
        <MetaItem label={copy.registeredAt}>{formatDateTime(p.created_at, locale)}</MetaItem>
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
        <MetaItem label={copy.checkins}>{num(p.checkin_count)}</MetaItem>
        <MetaItem label={copy.leads}>{num(p.lead_count)}</MetaItem>
        {p.issued_by && (
          <MetaItem label={copy.issuedBy}>
            <bdi>{p.issued_by}</bdi>
          </MetaItem>
        )}
        {p.reissued_at && <MetaItem label={copy.reissuedAt}>{formatDateTime(p.reissued_at, locale)}</MetaItem>}
        {p.cancelled_at && <MetaItem label={copy.cancelledAt}>{formatDateTime(p.cancelled_at, locale)}</MetaItem>}
        {p.cancelled_by && <MetaItem label={copy.cancelledBy}>{cancelledByLabel(p.cancelled_by, copy)}</MetaItem>}
        {p.cancelled_reason && (
          <MetaItem label={copy.cancelReason} className="col-span-2">
            <bdi>{cancelReasonLabel(p.cancelled_reason, copy)}</bdi>
          </MetaItem>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onAction("edit")}>
          <Icon name="note" size={15} />
          {copy.edit}
        </Button>
        {active && (
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => onAction("reissue")}>
              <Icon name="qr" size={15} />
              {copy.reissue}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => onAction("transfer")}>
              <Icon name="user-plus" size={15} />
              {copy.transfer}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onAction("cancel")}
              className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
            >
              <Icon name="x-circle" size={15} />
              {copy.cancelTicket}
            </Button>
          </>
        )}
        {p.can_delete && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onAction("delete")} className="!text-status-danger-text">
            <Icon name="trash" size={15} />
            {copy.delete}
          </Button>
        )}
      </div>
      {!p.can_delete && <p className="text-xs leading-relaxed text-text-muted">{copy.deleteBlocked}</p>}

      <section aria-labelledby="participant-scans" className="space-y-2">
        <h3 id="participant-scans" className="text-sm font-bold text-text-primary">
          {copy.scanHistory}
        </h3>
        {p.scan_history.length === 0 ? (
          <p className="text-sm text-text-muted">{copy.noScans}</p>
        ) : (
          <ol className="divide-y divide-border-subtle rounded-xl border border-border-default">
            {p.scan_history.map((scan, i) => (
              <li key={`${scan.scanned_at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <bdi className="font-semibold text-text-primary">{scan.checkin_point_name}</bdi>
                  <span className="block text-xs text-text-muted">{formatDateTime(scan.scanned_at, locale)}</span>
                </span>
                <span className="flex items-center gap-2">
                  {scan.rejection_reason && (
                    <bdi dir="ltr" className="font-mono text-[11px] text-text-muted">
                      {scan.rejection_reason}
                    </bdi>
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
      <Button type="button" variant="secondary" size="md" onClick={onCancel}>
        {copy.back}
      </Button>
      <Button type="submit" variant={tone} size="md" disabled={busy} aria-busy={busy}>
        {busy ? copy.saving : label}
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
        void run(() =>
          onSubmit({ attendee_full_name: fullName.trim(), attendee_organization: organization.trim(), attendee_title: jobTitle.trim() }),
        );
      }}
    >
      <>
        <Field label={copy.fullName} required hint={nameMissing ? <span className="text-status-danger-text">{copy.nameRequired}</span> : undefined}>
          <input
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setNameMissing(false);
            }}
            maxLength={200}
            aria-invalid={nameMissing || undefined}
            className="ui-input"
            autoComplete="off"
          />
        </Field>
        <Field label={copy.organization}>
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={200} className="ui-input" autoComplete="off" />
        </Field>
        <Field label={copy.jobTitle}>
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={100} className="ui-input" autoComplete="off" />
        </Field>
        {error && <FormAlert>{error.text}</FormAlert>}
        <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.save} />
      </>
    </ActionDialog>
  );
}

function NotifyToggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-[40px] cursor-pointer items-start gap-3 text-sm text-text-primary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-aiteb-indigo" />
      <span>{label}</span>
    </label>
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
      <>
        <Field label={copy.reason}>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="ui-textarea" />
        </Field>
        <NotifyToggle checked={notify} onChange={setNotify} label={copy.notify} />
        {error && <FormAlert>{error.text}</FormAlert>}
        <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmCancel} tone="danger" />
      </>
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
      <>
        <NotifyToggle checked={notify} onChange={setNotify} label={copy.notifyReissue} />
        {error && <FormAlert>{error.text}</FormAlert>}
        <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmReissue} />
      </>
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
      <>
        <Field
          label={copy.newMobile}
          required
          hint={problem === "mobileInvalid" ? <span className="text-status-danger-text">{copy.mobileInvalid}</span> : undefined}
        >
          <input
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem === "mobileInvalid" || undefined}
            className="ui-input"
            autoComplete="off"
            placeholder="09121234567"
          />
        </Field>
        <fieldset className="space-y-4">
          <legend className="ui-label">{nameRequired ? copy.transferNeedsName : copy.optionalDetails}</legend>
          <Field
            label={copy.fullName}
            required={nameRequired}
            hint={
              problem === "nameRequired" ? <span className="text-status-danger-text">{copy.nameRequired}</span> : nameRequired ? undefined : copy.transferNameHint
            }
          >
            <input
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                if (problem === "nameRequired") setProblem(null);
              }}
              maxLength={200}
              aria-invalid={problem === "nameRequired" || undefined}
              className="ui-input"
              autoComplete="off"
            />
          </Field>
          <Field label={copy.organization}>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} maxLength={200} className="ui-input" autoComplete="off" />
          </Field>
          <Field label={copy.jobTitle}>
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={100} className="ui-input" autoComplete="off" />
          </Field>
        </fieldset>
        {error && <FormAlert>{error.text}</FormAlert>}
        <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmTransfer} />
      </>
    </ActionDialog>
  );
}

function DeleteDialog({
  participant,
  copy,
  onClose,
  onSubmit,
  onCancelInstead,
  errorText,
}: ActionDialogProps & { participant: ParticipantOut; onSubmit: () => Promise<void>; onCancelInstead: () => void }) {
  const { busy, error, run } = useSubmit(errorText, copy.actionError);
  // The button is only offered while deleting is allowed; a scan or lead that arrived meanwhile answers 409.
  const blocked = error?.code === "PARTICIPANT_HAS_HISTORY";
  return (
    <ActionDialog
      title={copy.deleteTitle}
      description={copy.deleteDescription}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) void run(onSubmit);
      }}
    >
      <>
        {blocked ? (
          <>
            <FormAlert>{copy.deleteBlocked}</FormAlert>
            <DialogActions>
              <Button type="button" variant="secondary" size="md" onClick={onClose}>
                {copy.close}
              </Button>
              {participant.status === "active" && (
                <Button type="button" variant="danger" size="md" onClick={onCancelInstead}>
                  {copy.cancelTicket}
                </Button>
              )}
            </DialogActions>
          </>
        ) : (
          <>
            {error && <FormAlert>{error.text}</FormAlert>}
            <SubmitRow copy={copy} busy={busy} onCancel={onClose} label={copy.confirmDelete} tone="danger" />
          </>
        )}
      </>
    </ActionDialog>
  );
}
