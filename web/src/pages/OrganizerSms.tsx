import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  createApiClient,
  formatApiError,
  type EventOut,
  type SmsMessageOut,
  type SmsPanelOut,
} from "../api/client";
import type { OrganizerOutletContext } from "./OrganizerLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../components/organizer/WorkspaceUi";
import { SmsTemplateEditor } from "../components/sms/SmsTemplateEditor";
import { eventSectionNumber } from "../lib/organizerWorkspace";

const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  sent: "success",
  pending: "warning",
  failed: "danger",
  unknown: "neutral",
};

// Remount per event so a late response for event A can never write into event B's state.
export default function OrganizerSms() {
  const { eventId } = useParams<{ eventId: string }>();
  return <OrganizerSmsContent key={eventId} />;
}

function OrganizerSmsContent() {
  const { eventId } = useParams<{ eventId: string }>();
  const { apiKey, onKeyRejected, reportEvent, locale, isRtl } = useOutletContext<OrganizerOutletContext>();

  const [event, setEvent] = useState<EventOut | null>(null);
  const [panel, setPanel] = useState<SmsPanelOut | null>(null);
  const [messages, setMessages] = useState<SmsMessageOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const client = useMemo(() => (apiKey ? createApiClient({ kind: "organizer", token: apiKey }) : null), [apiKey]);
  const rejected = useCallback((status: number) => {
    if (status === 401 && apiKey) onKeyRejected(apiKey);
  }, [apiKey, onKeyRejected]);

  const loadMessages = useCallback(async () => {
    if (!client || !eventId) return;
    const { data, response } = await client.GET("/api/events/{event_id}/sms/messages", {
      params: { path: { event_id: eventId }, query: { limit: 50 } },
    });
    rejected(response.status);
    if (data) setMessages(data);
  }, [client, eventId, rejected]);

  useEffect(() => {
    // Without an organizer key nothing is dispatched; the layout shows the key gate.
    if (!client || !eventId) return;
    let active = true;
    (async () => {
      const [ev, sms, log] = await Promise.all([
        client.GET("/api/events/{event_id}", { params: { path: { event_id: eventId } } }),
        client.GET("/api/events/{event_id}/sms", { params: { path: { event_id: eventId } } }),
        client.GET("/api/events/{event_id}/sms/messages", { params: { path: { event_id: eventId }, query: { limit: 50 } } }),
      ]);
      [ev, sms, log].forEach((r) => rejected(r.response.status));
      if (!active) return;
      if (ev.data) setEvent(ev.data);
      if (sms.data) setPanel(sms.data);
      else setLoadError(sms.error ? formatApiError(sms.error) : null);
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
  }, [client, eventId, rejected]);

  useEffect(() => {
    if (event) reportEvent(event);
  }, [event, reportEvent]);

  const template = panel?.templates.find((t) => t.kind === "ticket_confirmation") ?? null;

  const kindLabel = (kind: string) =>
    kind === "ticket_confirmation" ? (isRtl ? "تأیید ثبت‌نام" : "Ticket confirmation") : kind === "ticket_resend" ? (isRtl ? "ارسال دوباره از پذیرش" : "Resent from reception") : kind === "test" ? (isRtl ? "آزمایشی" : "Test") : kind;
  const statusLabel = (status: string) =>
    ({
      sent: isRtl ? "ارسال شد" : "Sent",
      pending: isRtl ? "در صف" : "Queued",
      failed: isRtl ? "ناموفق" : "Failed",
      unknown: isRtl ? "نامشخص" : "Unknown",
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
          panel.delivery === "console"
            ? "border-status-warning-border bg-status-warning-bg text-status-warning-text"
            : "border-status-success-border bg-status-success-bg text-status-success-text"
        }`}
      >
        <Icon name={panel.delivery === "console" ? "alert" : "check-circle"} size={18} className="mt-0.5 shrink-0" />
        {panel.delivery === "console"
          ? isRtl
            ? "حالت آزمایشی: پیامکی واقعاً ارسال نمی‌شود (مدیر سامانه آن را در پنل سامانه تنظیم می‌کند)."
            : "Test mode: no SMS is actually sent (the platform administrator sets this in the platform console)."
          : isRtl
            ? "پیامک‌ها از طریق sms.ir و خط خدماتی سامانه ارسال می‌شوند."
            : "Messages are delivered through sms.ir from the platform's service line."}
      </p>

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
            ? "متن ورود (کد یک‌بارمصرف) برای همه همایش‌ها یکسان است و مدیر سامانه آن را در پنل سامانه تنظیم می‌کند. حداکثر ۱۰ پیامک آزمایشی در ساعت."
            : "The sign-in code message is the same for every congress and is set by the platform administrator in the platform console. Up to 10 test messages per hour."
        }
        onSave={async (body) => {
          const { data, error, response } = await client.PUT("/api/events/{event_id}/sms/templates/{kind}", { params: { path }, body: { body } });
          rejected(response.status);
          return { data, error: error ? formatApiError(error) : undefined };
        }}
        onReset={async () => {
          const { data, error, response } = await client.DELETE("/api/events/{event_id}/sms/templates/{kind}", { params: { path } });
          rejected(response.status);
          return { data, error: error ? formatApiError(error) : undefined };
        }}
        onTest={async (mobile, body) => {
          const { data, error, response } = await client.POST("/api/events/{event_id}/sms/test", {
            params: { path: { event_id: eventId } },
            body: { mobile, kind: "ticket_confirmation", body },
          });
          rejected(response.status);
          if (response.status === 429) return { error: isRtl ? "پیامک آزمایشی زیادی ارسال شد؛ کمی بعد دوباره تلاش کنید." : "Too many test messages; try again later." };
          return { data, error: error ? formatApiError(error) : undefined };
        }}
        onTested={() => void loadMessages()}
      />

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
                <Badge variant={STATUS_BADGE[m.status] ?? "neutral"} size="sm">{statusLabel(m.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
