import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  localizedApiError,
  type EventOut,
  type SmsMessageOut,
  type SmsPanelOut,
} from "../api/client";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Icon } from "../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { SmsTemplateEditor } from "../components/sms/SmsTemplateEditor";
import { networkErrorMessage } from "../lib/errorMessages";
import { eventSectionNumber } from "../lib/organizerWorkspace";
import { sessionAllows } from "../components/organizer/roleAccess";

const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sent: "success",
  pending: "warning",
  sending: "warning",
  failed: "danger",
  unknown: "neutral",
  resolved: "neutral",
};

/** A message action awaiting the organizer's confirmation: retrying an unknown message may deliver it twice. */
type PendingRetry = SmsMessageOut | null;

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerSms() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerSmsContent key={eventId} />;
}

function OrganizerSmsContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, reportEvent, session, locale, isRtl } = useOutletContext<OrganizerOutletContext>();
  // Templates, test sends and the delivery log are a manager's (backend/app/roles.py).
  const canManage = sessionAllows(session, "manager");

  const [event, setEvent] = useState<EventOut | null>(null);
  const [panel, setPanel] = useState<SmsPanelOut | null>(null);
  const [messages, setMessages] = useState<SmsMessageOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingRetry>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);

  const loadMessages = useCallback(async () => {
    if (!client || !eventId || !canManage) return;
    const { data } = await client.GET("/api/events/{event_id}/sms/messages", {
      params: { path: { event_id: eventId }, query: { limit: 50 } },
    });
    if (data) setMessages(data);
  }, [client, eventId, canManage]);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!client || !eventId) return;
    let active = true;
    (async () => {
      const [ev, sms, log] = await Promise.all([
        client.GET("/api/events/{event_id}", { params: { path: { event_id: eventId } } }),
        client.GET("/api/events/{event_id}/sms", { params: { path: { event_id: eventId } } }),
        canManage
          ? client.GET("/api/events/{event_id}/sms/messages", { params: { path: { event_id: eventId }, query: { limit: 50 } } })
          : Promise.resolve({ data: undefined }),
      ]);
      if (!active) return;
      if (ev.data) setEvent(ev.data);
      if (sms.data) setPanel(sms.data);
      else setLoadError(sms.error ? localizedApiError(sms.error, locale) : null);
      if (log.data) setMessages(log.data);
      setLoading(false);
    })().catch(() => {
      if (active) {
        setLoadError(isRtl ? "اتصال به سرور برقرار نشد." : "Could not reach the server.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
    // Load once per event and key; the copy language does not trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, eventId]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const template = panel?.templates.find((t) => t.kind === "ticket_confirmation") ?? null;

  /** Retry (queue again) or resolve one message; the row is replaced with the server's answer. */
  const act = async (message: SmsMessageOut, action: "retry" | "resolve", confirmDuplicate = false) => {
    if (!client || !eventId || actionBusy) return;
    setActionBusy(message.id);
    setActionError(null);
    try {
      const path = { event_id: eventId, message_id: message.id };
      const { data, error } =
        action === "retry"
          ? await client.POST("/api/events/{event_id}/sms/messages/{message_id}/retry", {
              params: { path },
              body: { confirm_duplicate: confirmDuplicate },
            })
          : await client.POST("/api/events/{event_id}/sms/messages/{message_id}/resolve", { params: { path } });
      if (data) setMessages((current) => current.map((m) => (m.id === data.id ? data : m)));
      else setActionError(localizedApiError(error, locale));
    } catch {
      setActionError(networkErrorMessage[locale]);
    } finally {
      setActionBusy(null);
    }
  };

  const kindLabels: Record<string, string> = isRtl
    ? {
        ticket_confirmation: "تأیید ثبت‌نام",
        ticket_resend: "ارسال دوباره از پذیرش",
        ticket_cancelled: "لغو بلیت",
        ticket_reissued: "صدور دوبارهٔ کارت ورود",
        staff_invite: "دعوت نمایندهٔ غرفه",
        test: "آزمایشی",
      }
    : {
        ticket_confirmation: "Ticket confirmation",
        ticket_resend: "Resent from reception",
        ticket_cancelled: "Ticket cancelled",
        ticket_reissued: "Pass reissued",
        staff_invite: "Booth representative invitation",
        test: "Test",
      };
  const kindLabel = (kind: string) => kindLabels[kind] ?? kind;
  const statusLabel = (status: string) =>
    ({
      sent: isRtl ? "ارسال شد" : "Sent",
      pending: isRtl ? "در صف" : "Queued",
      sending: isRtl ? "در حال ارسال" : "Sending",
      failed: isRtl ? "ناموفق" : "Failed",
      unknown: isRtl ? "نامشخص" : "Unknown",
      resolved: isRtl ? "حل‌شده" : "Resolved",
    })[status] ?? status;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale === "fa" ? "fa-IR-u-ca-persian" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  if (loading) {
    return (
      <div role="status" aria-label={isRtl ? "در حال بارگذاری" : "Loading"} className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-64" />
      </div>
    );
  }
  if (loadError || !panel || !template || !client || !eventId) {
    return <FormAlert>{loadError ?? (isRtl ? "تنظیمات پیامک بارگذاری نشد." : "The SMS settings could not be loaded.")}</FormAlert>;
  }
  const path = { event_id: eventId, kind: "ticket_confirmation" as const };

  return (
    <div className="space-y-8">
      <SectionHeader
        index={eventSectionNumber("sms")}
        eyebrow={<bdi>{event?.name ?? ""}</bdi>}
        title={isRtl ? "پیامک" : "SMS"}
        description={
          isRtl
            ? "متن پیامکی که پس از رزرو یا ثبت حضوری برای شرکت‌کننده ارسال می‌شود. پیامک‌ها از خط خدماتی سامانه ارسال می‌شوند."
            : "The text attendees receive after they reserve a pass or are registered at the desk. Messages are sent from the platform's service line."
        }
      />

      <p
        role="note"
        data-testid="sms-delivery"
        className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
          panel.delivery === "smsir"
            ? "border-status-success-border bg-status-success-bg text-status-success-text"
            : panel.delivery === "console"
              ? "border-status-warning-border bg-status-warning-bg text-status-warning-text"
              : "border-status-danger-border bg-status-danger-bg text-status-danger-text"
        }`}
      >
        <Icon name={panel.delivery === "smsir" ? "check-circle" : "alert"} size={18} className="mt-0.5 shrink-0" />
        {panel.delivery === "console"
          ? isRtl
            ? "حالت آزمایشی: پیامکی واقعاً ارسال نمی‌شود (مدیر سامانه آن را در پنل سامانه تنظیم می‌کند)."
            : "Test mode: no SMS is actually sent (the platform administrator sets this in the platform console)."
          : panel.delivery === "smsir"
            ? isRtl
              ? "پیامک‌ها از طریق sms.ir و خط خدماتی سامانه ارسال می‌شوند."
              : "Messages are delivered through sms.ir from the platform's service line."
            : isRtl
              ? "ارسال پیامک هنوز راه‌اندازی نشده است: پیامک‌های تأیید در صف می‌مانند و پس از راه‌اندازی توسط مدیر سامانه ارسال می‌شوند."
              : "SMS delivery is not set up yet: confirmations wait in the queue and go out once the platform administrator configures it."}
      </p>

      {!canManage && template && (
        <section aria-labelledby="sms-template-readonly" className="space-y-3 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft">
          <h2 id="sms-template-readonly" className="text-base font-bold text-text-primary">
            {isRtl ? "پیامک تأیید ثبت‌نام" : "Ticket confirmation SMS"}
          </h2>
          <p dir="auto" className="whitespace-pre-line rounded-xl bg-surface-panel-subtle p-3 text-sm text-text-primary">
            {template.body}
          </p>
          <p className="text-xs text-text-muted">
            {isRtl
              ? "تغییر متن، پیامک آزمایشی و گزارش ارسال‌ها در اختیار مدیران سازمان است."
              : "Changing the text, test messages and the delivery log are for the organization's managers."}
          </p>
        </section>
      )}

      {canManage && (
        <SmsTemplateEditor
          template={template}
          sample={panel.sample}
          locale={locale}
          title={isRtl ? "پیامک تأیید ثبت‌نام" : "Ticket confirmation SMS"}
          customLabel={isRtl ? "متن اختصاصی این همایش" : "Custom for this congress"}
          defaultLabel={isRtl ? "متن پیش‌فرض" : "Default text"}
          resetDescription={
            isRtl
              ? "متن اختصاصی این همایش حذف می‌شود و پیامک‌های بعدی با متن پیش‌فرض سامانه ارسال می‌شوند."
              : "This congress's own text is removed; new confirmations use the platform's default text."
          }
          savedMessage={isRtl ? "متن پیامک ذخیره شد. پیامک‌های بعدی با این متن ارسال می‌شوند." : "Saved. New confirmations use this text."}
          note={
            isRtl
              ? "متن ورود (کد یک‌بارمصرف) برای همه همایش‌ها یکسان است و مدیر سامانه آن را در پنل سامانه تنظیم می‌کند. پیامک آزمایشی فقط به اپراتورهای پذیرش، کارکنان غرفه‌ها یا دارندگان کارت ورود همین همایش فرستاده می‌شود؛ حداکثر ۱۰ پیامک در ساعت."
              : "The sign-in code message is the same for every congress and is set by the platform administrator in the platform console. Test messages go only to this congress's desk operators, booth staff or pass holders; up to 10 per hour."
          }
          onSave={async (body) => {
            const { data, error } = await client.PUT("/api/events/{event_id}/sms/templates/{kind}", { params: { path }, body: { body } });
            return { data, error: error ? localizedApiError(error, locale) : undefined };
          }}
          onReset={async () => {
            const { data, error } = await client.DELETE("/api/events/{event_id}/sms/templates/{kind}", { params: { path } });
            return { data, error: error ? localizedApiError(error, locale) : undefined };
          }}
          onTest={async (mobile, body) => {
            const { data, error } = await client.POST("/api/events/{event_id}/sms/test", {
              params: { path: { event_id: eventId } },
              body: { mobile, kind: "ticket_confirmation", body },
            });
            return { data, error: error ? localizedApiError(error, locale) : undefined };
          }}
          onTested={() => void loadMessages()}
        />
      )}

      {canManage && (
        <section aria-labelledby="sms-log-title" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="sms-log-title" className="text-base font-bold text-text-primary">
              {isRtl ? "پیامک‌های اخیر این همایش" : "Recent messages for this congress"}
            </h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => void loadMessages()}>
              <Icon name="sync" size={15} />
              {isRtl ? "به‌روزرسانی" : "Refresh"}
            </Button>
          </div>
          {actionError && <FormAlert>{actionError}</FormAlert>}
          {messages.length === 0 ? (
            <EmptyState icon="mail" title={isRtl ? "هنوز پیامکی برای این همایش ارسال نشده است." : "No message has been sent for this congress yet."} />
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-default bg-surface-panel">
              {messages.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold text-text-primary">{kindLabel(m.kind)}</span>
                      <bdi dir="ltr" className="font-mono text-xs text-text-secondary">{m.mobile}</bdi>
                      <span className="text-xs text-text-muted">{when(m.created_at)}</span>
                    </p>
                    {m.body && <p dir="auto" className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-text-muted">{m.body}</p>}
                    {m.last_error && m.status !== "sent" && (
                      <p className="text-xs text-status-danger-text"><bdi dir="ltr">{m.last_error}</bdi></p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <Badge variant={STATUS_BADGE[m.status] ?? "neutral"} size="sm">{statusLabel(m.status)}</Badge>
                    {/* Whether the attendee opened the pass link in this confirmation (ADR 0015). */}
                    {m.kind === "ticket_confirmation" && (
                      m.link_opened_at ? (
                        <Badge
                          variant="info"
                          size="sm"
                          icon={<Icon name="eye" size={12} />}
                          title={when(m.link_opened_at)}
                          data-testid="sms-link-opened"
                        >
                          {isRtl ? "پیوند باز شد" : "Link opened"}
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-text-muted">{isRtl ? "پیوند هنوز باز نشده" : "Link not opened yet"}</span>
                      )
                    )}
                    {(m.can_retry || m.can_resolve) && (
                      <div className="flex flex-wrap justify-end gap-1.5" data-testid="sms-message-actions">
                        {m.can_retry && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-busy={actionBusy === m.id}
                            disabled={actionBusy !== null}
                            onClick={() => (m.status === "unknown" ? setPendingRetry(m) : void act(m, "retry"))}
                          >
                            <Icon name="sync" size={14} />
                            {isRtl ? "ارسال دوباره" : "Send again"}
                          </Button>
                        )}
                        {m.can_resolve && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={actionBusy !== null}
                            title={isRtl ? "پیامک رسیده است؛ دیگر ارسال نشود" : "It arrived; do not send it again"}
                            onClick={() => void act(m, "resolve")}
                          >
                            <Icon name="check-circle" size={14} />
                            {isRtl ? "حل‌شده" : "Mark resolved"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        isOpen={pendingRetry !== null}
        tone="danger"
        title={isRtl ? "پیامک دوباره ارسال شود؟" : "Send this message again?"}
        description={
          isRtl
            ? "وضعیت تحویل این پیامک نامعلوم است و شاید پیش‌تر به شرکت‌کننده رسیده باشد. با ارسال دوباره ممکن است آن را دو بار دریافت کند."
            : "This message's delivery is unknown: it may already have reached the attendee. Sending it again may deliver it twice."
        }
        confirmLabel={isRtl ? "ارسال دوباره" : "Send again"}
        cancelLabel={isRtl ? "انصراف" : "Cancel"}
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
