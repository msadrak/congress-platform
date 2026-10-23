import { useCallback, useEffect, useState } from "react";
import { localizedApiError, type EventOut, type SmsMessageOut, type SmsPanelOut } from "../api/client";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { ErrorState } from "../components/ui/StateBlock";
import { EmptyState, FormAlert, Notice, SectionHeader } from "../components/organizer/WorkspaceUi";
import { useEventWorkspace } from "../components/organizer/eventWorkspaceContext";
import { SmsTemplateEditor } from "../components/sms/SmsTemplateEditor";
import { commonCopy } from "../copy/common";
import { organizerDataCopy } from "../copy/organizerData";
import { formatDate } from "../lib/format";
import { formatMobile } from "../lib/mobile";
import { EventSectionGate } from "./organizer/EventSectionUi";

const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sent: "success",
  pending: "warning",
  sending: "warning",
  failed: "danger",
  unknown: "neutral",
  resolved: "neutral",
};

/** Messages per page of the log; a shorter page is the last one. */
const LOG_PAGE = 50;

type Locale = "fa" | "en";
type SmsCopy = (typeof organizerDataCopy)[Locale]["sms"];

/** The stored kind in words; a kind this screen does not know yet reads «پیامک», never the raw key. */
function kindLabel(kind: string, copy: SmsCopy): string {
  const kinds: Record<string, string> = copy.kinds;
  return kinds[kind] ?? kinds.other;
}

function statusLabel(status: string, copy: SmsCopy): string {
  const statuses: Record<string, string> = copy.statuses;
  return statuses[status] ?? statuses.unknown;
}

/** Why a message was not delivered, without the gateway's own text (kept in the tooltip for support). */
function failureLabel(message: SmsMessageOut, copy: SmsCopy): string {
  const error = message.last_error ?? "";
  if (error === "ACCOUNT_DELETED") return copy.errors.accountDeleted;
  if (error === "TICKET_CANCELLED" || error === "PASS_REVOKED") return copy.errors.passInactive;
  if (message.status === "unknown") return copy.errors.noAnswer;
  return copy.errors.gateway;
}

// The event workspace remounts per event, so a late response for event A can never write into event B's state.
export default function OrganizerSms() {
  return <EventSectionGate>{(event) => <SmsSection event={event} />}</EventSectionGate>;
}

function SmsSection({ event }: { event: EventOut }) {
  // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
  const { eventId, client, locale, can, canEdit } = useEventWorkspace();
  // The delivery log is a manager's (backend/app/roles.py); changing the text and sending also needs a congress
  // that is not archived.
  const canManage = can("manager");
  const copy = organizerDataCopy[locale].sms;
  const common = commonCopy[locale];
  const when = (iso: string) => formatDate(iso, "dayTime", locale, event.timezone);

  const [panel, setPanel] = useState<SmsPanelOut | null>(null);
  const [messages, setMessages] = useState<SmsMessageOut[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  // The failure is kept as the API answered it and localized when shown, so a language switch re-words it.
  const [loadFailure, setLoadFailure] = useState<{ body: unknown; status: number } | null>(null);
  const [reloads, setReloads] = useState(0);
  const [pendingRetry, setPendingRetry] = useState<SmsMessageOut | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    if (!client || !canManage) return;
    const { data, error, response } = await client.GET("/api/events/{event_id}/sms/messages", {
      params: { path: { event_id: eventId }, query: { limit: LOG_PAGE } },
    });
    if (data) {
      setMessages(data);
      setHasOlder(data.length === LOG_PAGE);
      setActionError(null);
    } else setActionError(localizedApiError(error, locale, response.status));
  }, [client, eventId, canManage, locale]);

  /** The next page of older messages, after the last one shown. */
  const loadOlder = async () => {
    const last = messages.at(-1);
    if (!client || !canManage || !last || loadingOlder) return;
    setLoadingOlder(true);
    setActionError(null);
    const { data, error, response } = await client.GET("/api/events/{event_id}/sms/messages", {
      params: { path: { event_id: eventId }, query: { limit: LOG_PAGE, before: last.id } },
    });
    if (data) {
      setMessages((current) => [...current, ...data.filter((m) => !current.some((c) => c.id === m.id))]);
      setHasOlder(data.length === LOG_PAGE);
    } else setActionError(localizedApiError(error, locale, response.status));
    setLoadingOlder(false);
  };

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!client) return;
    let active = true;
    // The workspace client answers a network failure as an error result, so the load always ends.
    (async () => {
      setLoading(true);
      setLoadFailure(null);
      const [sms, log] = await Promise.all([
        client.GET("/api/events/{event_id}/sms", { params: { path: { event_id: eventId } } }),
        canManage
          ? client.GET("/api/events/{event_id}/sms/messages", { params: { path: { event_id: eventId }, query: { limit: LOG_PAGE } } })
          : Promise.resolve(null),
      ]);
      if (!active) return;
      if (sms.data) setPanel(sms.data);
      else setLoadFailure({ body: sms.error, status: sms.response.status });
      if (log?.data) {
        setMessages(log.data);
        setHasOlder(log.data.length === LOG_PAGE);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [client, eventId, canManage, reloads]);

  const template = panel?.templates.find((t) => t.kind === "ticket_confirmation") ?? null;

  /** Retry (queue again) or resolve one message; the row is replaced with the server's answer. */
  const act = async (message: SmsMessageOut, action: "retry" | "resolve", confirmDuplicate = false) => {
    if (!client || actionBusy) return;
    setActionBusy(message.id);
    setActionError(null);
    const path = { event_id: eventId, message_id: message.id };
    const { data, error, response } =
      action === "retry"
        ? await client.POST("/api/events/{event_id}/sms/messages/{message_id}/retry", {
            params: { path },
            body: { confirm_duplicate: confirmDuplicate },
          })
        : await client.POST("/api/events/{event_id}/sms/messages/{message_id}/resolve", { params: { path } });
    if (data) setMessages((current) => current.map((m) => (m.id === data.id ? data : m)));
    else setActionError(localizedApiError(error, locale, response.status));
    setActionBusy(null);
  };

  if (loading && !panel) {
    return (
      <div role="status" aria-label={common.loading} className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-64" />
      </div>
    );
  }
  if (!panel || !template || !client) {
    return (
      <div className="space-y-6">
        <SectionHeader title={copy.title} />
        <ErrorState title={copy.loadFailed} onRetry={() => setReloads((n) => n + 1)} retryLabel={common.retry}>
          {loadFailure && <p>{localizedApiError(loadFailure.body, locale, loadFailure.status)}</p>}
        </ErrorState>
      </div>
    );
  }
  const path = { event_id: eventId, kind: "ticket_confirmation" as const };

  return (
    <div className="space-y-6">
      <SectionHeader title={copy.title} />

      {/* Only a problem is worth a banner: live delivery says nothing. */}
      {panel.delivery !== "smsir" && (
        <div data-testid="sms-delivery">
          <Notice tone="warning">{panel.delivery === "console" ? copy.deliveryConsole : copy.deliveryUnconfigured}</Notice>
        </div>
      )}

      {canManage && canEdit ? (
        <SmsTemplateEditor
          template={template}
          sample={panel.sample}
          locale={locale}
          audience="organizer"
          title={copy.templateTitle}
          customLabel={copy.customLabel}
          defaultLabel={copy.defaultLabel}
          resetDescription={copy.resetDescription}
          savedMessage={copy.savedMessage}
          testHint={copy.testHint}
          onSave={async (body) => {
            const { data, error, response } = await client.PUT("/api/events/{event_id}/sms/templates/{kind}", { params: { path }, body: { body } });
            return { data, error: error ? localizedApiError(error, locale, response.status) : undefined };
          }}
          onReset={async () => {
            const { data, error, response } = await client.DELETE("/api/events/{event_id}/sms/templates/{kind}", { params: { path } });
            return { data, error: error ? localizedApiError(error, locale, response.status) : undefined };
          }}
          onTest={async (mobile, body) => {
            const { data, error, response } = await client.POST("/api/events/{event_id}/sms/test", {
              params: { path: { event_id: eventId } },
              body: { mobile, kind: "ticket_confirmation", body },
            });
            return { data, error: error ? localizedApiError(error, locale, response.status) : undefined };
          }}
          onTested={() => void loadMessages()}
        />
      ) : (
        <section aria-labelledby="sms-template-readonly" className="space-y-3 rounded-card border border-border-default bg-surface-panel p-5 shadow-soft">
          <h2 id="sms-template-readonly" className="text-title-sm font-bold text-text-primary">
            {copy.templateTitle}
          </h2>
          <p dir="auto" className="whitespace-pre-line rounded-control bg-surface-panel-subtle p-3 text-body-sm text-text-primary">
            {template.body}
          </p>
        </section>
      )}

      {canManage && (
        <section aria-labelledby="sms-log-title" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sms-log-title" className="text-title-sm font-bold text-text-primary">
              {copy.logTitle}
            </h2>
            <Button type="button" variant="ghost" size="sm" icon="sync" onClick={() => void loadMessages()}>
              {copy.refresh}
            </Button>
          </div>
          {actionError && <FormAlert>{actionError}</FormAlert>}
          {messages.length === 0 ? (
            <EmptyState icon="mail" title={copy.logEmpty} />
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-default bg-surface-panel" data-testid="sms-log">
              {messages.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm">
                      <span className="font-semibold text-text-primary">{kindLabel(m.kind, copy)}</span>
                      <bdi dir="ltr" className="tabular text-caption text-text-secondary">
                        {formatMobile(m.mobile, locale)}
                      </bdi>
                      <span className="text-caption text-text-muted">{when(m.created_at)}</span>
                    </p>
                    {m.body && <p dir="auto" className="line-clamp-2 whitespace-pre-wrap break-words text-caption text-text-muted">{m.body}</p>}
                    {m.last_error && m.status !== "sent" && m.status !== "resolved" && (
                      <p className="text-caption text-status-danger-text" title={m.last_error} data-testid="sms-failure">
                        {failureLabel(m, copy)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge variant={STATUS_BADGE[m.status] ?? "neutral"} size="sm">
                      {statusLabel(m.status, copy)}
                    </Badge>
                    {/* Whether the attendee opened the pass link in this confirmation (ADR 0015). */}
                    {m.kind === "ticket_confirmation" &&
                      (m.link_opened_at ? (
                        <Badge variant="info" size="sm" icon={<Icon name="eye" size={12} />} title={when(m.link_opened_at)} data-testid="sms-link-opened">
                          {copy.linkOpened}
                        </Badge>
                      ) : (
                        <span className="text-caption text-text-muted">{copy.linkNotOpened}</span>
                      ))}
                    {canEdit && (m.can_retry || m.can_resolve) && (
                      <div className="flex flex-wrap justify-end gap-1.5" data-testid="sms-message-actions">
                        {m.can_retry && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            icon="sync"
                            loading={actionBusy === m.id}
                            disabled={actionBusy !== null}
                            onClick={() => (m.status === "unknown" ? setPendingRetry(m) : void act(m, "retry"))}
                          >
                            {copy.retry}
                          </Button>
                        )}
                        {m.can_resolve && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            icon="check-circle"
                            disabled={actionBusy !== null}
                            title={copy.resolveHint}
                            onClick={() => void act(m, "resolve")}
                          >
                            {copy.resolve}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {hasOlder && messages.length > 0 && (
            <div className="flex justify-center">
              <Button type="button" variant="secondary" size="sm" loading={loadingOlder} onClick={() => void loadOlder()}>
                {copy.olderMessages}
              </Button>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        isOpen={pendingRetry !== null}
        tone="danger"
        title={copy.retryTitle}
        description={copy.retryDescription}
        confirmLabel={copy.retry}
        cancelLabel={common.cancel}
        onCancel={() => setPendingRetry(null)}
        onConfirm={() => {
          const message = pendingRetry;
          setPendingRetry(null);
          if (message) void act(message, "retry", true);
        }}
      />
    </div>
  );
}
