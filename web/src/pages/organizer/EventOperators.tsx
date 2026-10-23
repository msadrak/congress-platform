import { useState } from "react";
import QRCode from "react-qr-code";
import { formatApiError, localizedApiError, type DeskOperatorOut } from "../../api/client";
import { formatLocalizedDate } from "../../lib/i18n";
import { formatMobile } from "../../lib/mobile";
import { eventSectionNumber } from "../../lib/organizerWorkspace";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Icon } from "../../components/ui/Icon";
import { EmptyState, FormAlert, SectionHeader } from "../../components/organizer/WorkspaceUi";
import { OperatorFormDialog } from "../../components/organizer/OperatorFormDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { AddButton, EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadDeskOperators, sectionLoad, useEventList } from "./eventLists";

/** `/organizer/events/:eventId/operators`: who may run the Front Desk, and revoking that access. */
export default function EventOperators() {
  const { event, error, eventId, apiKey, client, onKeyRejected, locale, t, isRtl } = useEventWorkspace();
  const operators = useEventList(loadDeskOperators);
  const lists = sectionLoad([operators]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DeskOperatorOut | null>(null);
  const [revokingOperatorId, setRevokingOperatorId] = useState<string | null>(null);
  const [restoringOperatorId, setRestoringOperatorId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!event || error || !lists.loaded) return <EventSectionGate listsLoaded={lists.loaded} />;

  const handleRevokeOperator = async (operatorId: string) => {
    if (!eventId) return;
    if (!apiKey || !client) return;
    setRevokingOperatorId(operatorId);
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators/{operator_id}/revoke", {
      params: { path: { event_id: eventId, operator_id: operatorId } },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setRevokingOperatorId(null);
    if (err) {
      setNotice({ tone: "error", text: isRtl ? "لغو دسترسی انجام نشد؛ دوباره تلاش کنید." : `Could not revoke access: ${formatApiError(err)}` });
    } else if (data) {
      operators.setItems((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      setNotice({ tone: "ok", text: isRtl ? `دسترسی ${data.operator_name} لغو شد.` : `Access revoked for ${data.operator_name}.` });
    }
  };

  const handleRestoreOperator = async (operatorId: string) => {
    if (!eventId || !apiKey || !client) return;
    setRestoringOperatorId(operatorId);
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators/{operator_id}/restore", {
      params: { path: { event_id: eventId, operator_id: operatorId } },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setRestoringOperatorId(null);
    if (err) {
      setNotice({ tone: "error", text: localizedApiError(err, locale) });
    } else if (data) {
      operators.setItems((prev) => prev.map((o) => (o.id === data.id ? data : o)));
      setNotice({
        tone: "ok",
        text: isRtl
          ? `دسترسی ${data.operator_name} بازگردانده شد و پیامک دعوت دوباره فرستاده شد.`
          : `Access restored for ${data.operator_name}; the invitation SMS was sent again.`,
      });
    }
  };

  // The independent reception station for this congress: operators open it and sign in with an SMS code.
  const receptionUrl = `${window.location.origin}/reception/${eventId}`;
  const copyReceptionUrl = async () => {
    try {
      await navigator.clipboard.writeText(receptionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice({ tone: "error", text: isRtl ? "کپی ممکن نشد؛ نشانی را دستی انتخاب کنید." : "Could not copy; select the address by hand." });
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const addOperator = <AddButton label={t.addOperatorButton} onClick={() => setIsAddOpen(true)} />;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("operators")} eyebrow={<bdi>{event.name}</bdi>} title={t.operatorsHeading} description={t.operatorsDesc} action={addOperator} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

      <section aria-labelledby="reception-link-heading" data-testid="reception-link" className="flex flex-col gap-5 rounded-2xl border border-border-default bg-surface-panel p-5 shadow-soft sm:flex-row sm:items-center">
        <div className="shrink-0 self-center rounded-xl bg-white p-2.5 ring-1 ring-border-default">
          <QRCode value={receptionUrl} size={112} level="M" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" className="size-28" aria-label={isRtl ? "کد QR نشانی میز پذیرش" : "Reception address QR code"} />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <h2 id="reception-link-heading" className="text-sm font-semibold text-text-primary">{isRtl ? "نشانی میز پذیرش این همایش" : "This congress's reception address"}</h2>
          <p className="text-xs leading-relaxed text-text-secondary">
            {isRtl
              ? "اپراتورها این نشانی را باز می‌کنند (یا کد QR را اسکن می‌کنند) و با کد پیامکی به شمارهٔ خود وارد می‌شوند. هنگام افزودن اپراتور، همین نشانی برایش پیامک می‌شود."
              : "Operators open this address (or scan the QR code) and sign in with an SMS code to their number. Adding an operator texts them this address."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all rounded-lg bg-surface-panel-subtle px-2.5 py-1.5 font-mono text-xs text-text-primary"><bdi dir="ltr">{receptionUrl}</bdi></code>
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyReceptionUrl()}>
              <Icon name={copied ? "check" : "copy"} size={15} />
              <span>{copied ? (isRtl ? "کپی شد" : "Copied") : isRtl ? "کپی نشانی" : "Copy link"}</span>
            </Button>
          </div>
          <p className="sr-only" role="status">{copied ? (isRtl ? "نشانی میز پذیرش کپی شد." : "Reception address copied.") : ""}</p>
        </div>
      </section>
      <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />

      {operators.error ? (
        <FormAlert>{t.sectionLoadFailed}</FormAlert>
      ) : operators.items.length === 0 ? (
        <EmptyState icon="users" title={t.noOperatorsTitle} action={addOperator} />
      ) : (
        <div className="overflow-clip rounded-2xl border border-border-default bg-surface-panel shadow-soft">
          <table className="org-table org-table--stack">
            <caption className="sr-only">{t.operatorsHeading}</caption>
            <thead>
              <tr>
                <th scope="col">{t.operatorNameLabel}</th>
                <th scope="col">{isRtl ? "وضعیت" : "Status"}</th>
                <th scope="col">{isRtl ? "ثبت دسترسی" : "Assigned"}</th>
                <th scope="col">
                  <span className="sr-only">{isRtl ? "عملیات" : "Actions"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {operators.items.map((op) => (
                <tr key={op.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold ${
                          op.is_revoked ? "bg-surface-panel-inset text-text-muted" : "bg-aiteb-lavender text-aiteb-indigo"
                        }`}
                      >
                        {op.operator_name.trim().charAt(0).toUpperCase() || "•"}
                      </span>
                      <div className="min-w-0">
                        <h3 className={`break-words text-sm font-semibold ${op.is_revoked ? "text-text-secondary" : "text-text-primary"}`}>
                          <bdi>{op.operator_name}</bdi>
                        </h3>
                        {op.mobile && (
                          <p className="break-all font-mono text-xs text-text-muted">
                            <bdi dir="ltr">{formatMobile(op.mobile, locale)}</bdi>
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td data-label={isRtl ? "وضعیت" : "Status"}>
                    <Badge variant={op.is_revoked ? "neutral" : "success"} size="sm" dot={!op.is_revoked}>
                      {op.is_revoked ? t.operatorStatusRevoked : t.operatorStatusActive}
                    </Badge>
                  </td>
                  <td data-label={isRtl ? "ثبت دسترسی" : "Assigned"} className="text-xs text-text-secondary">
                    <span>{formatLocalizedDate(op.created_at, locale)}</span>
                  </td>
                  <td className="text-end">
                    {!op.is_revoked ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={revokingOperatorId === op.id}
                        aria-busy={revokingOperatorId === op.id}
                        onClick={() => setRevokeTarget(op)}
                        className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                      >
                        <Icon name="lock" size={16} />
                        <span>{revokingOperatorId === op.id ? t.revokingAction : t.revokeOperatorAction}</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={restoringOperatorId === op.id}
                        aria-busy={restoringOperatorId === op.id}
                        onClick={() => void handleRestoreOperator(op.id)}
                      >
                        <Icon name="sync" size={16} />
                        <span>{isRtl ? "بازگرداندن دسترسی" : "Restore access"}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex max-w-3xl items-start gap-2.5 text-xs leading-relaxed text-text-muted">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0 text-aiteb-slate" />
        {isRtl
          ? "اپراتورها با شماره موبایل خود و کد پیامکی وارد میز پذیرش می‌شوند؛ رمز عبوری برای تحویل وجود ندارد. لغو دسترسی، نشست فعال آن‌ها را نیز بی‌اعتبار می‌کند."
          : "Operators sign in to the Front Desk with their mobile number and an SMS code; there is no password to hand over. Revoking access also ends any active session."}
      </p>

      <OperatorFormDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSaved={(saved) => {
          operators.setItems((prev) => {
            const exists = prev.some((o) => o.id === saved.id);
            return exists ? prev.map((o) => (o.id === saved.id ? saved : o)) : [...prev, saved];
          });
          setIsAddOpen(false);
          setNotice({
            tone: "ok",
            text: isRtl
              ? `${saved.operator_name} مجاز شد؛ نشانی میز پذیرش برایش پیامک شد و با کد پیامکی به شماره خود وارد می‌شود.`
              : `${saved.operator_name} is authorized: the reception address was texted to them, and they sign in with an SMS code sent to their number.`,
          });
        }}
      />

      {/* Confirmations render last so they always stack above any open form dialog. */}
      <ConfirmDialog
        isOpen={revokeTarget !== null}
        tone="danger"
        title={isRtl ? "لغو دسترسی اپراتور؟" : "Revoke operator access?"}
        description={
          revokeTarget
            ? isRtl
              ? `${revokeTarget.operator_name} دیگر نمی‌تواند وارد میز پذیرش شود و نشست‌های فعال او بی‌اعتبار می‌شود.`
              : `${revokeTarget.operator_name} will no longer be able to use the reception desk and any active session stops working.`
            : ""
        }
        confirmLabel={t.revokeOperatorAction}
        cancelLabel={cancelLabel}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          const target = revokeTarget;
          setRevokeTarget(null);
          if (target) void handleRevokeOperator(target.id);
        }}
      />
    </div>
  );
}
