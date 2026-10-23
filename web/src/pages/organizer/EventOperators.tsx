import { useState } from "react";
import { formatApiError, type DeskOperatorOut } from "../../api/client";
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

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const addOperator = <AddButton label={t.addOperatorButton} onClick={() => setIsAddOpen(true)} />;

  return (
    <div className="space-y-8 sm:space-y-10">
      <SectionHeader index={eventSectionNumber("operators")} eyebrow={<bdi>{event.name}</bdi>} title={t.operatorsHeading} description={t.operatorsDesc} action={addOperator} />

      <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />
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
                      <span className="text-xs font-medium text-text-muted">{isRtl ? "لغو شده" : "Revoked"}</span>
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
              ? `${saved.operator_name} مجاز شد و با کد پیامکی به شماره خود وارد میز پذیرش می‌شود.`
              : `${saved.operator_name} is authorized and signs in to the Front Desk with an SMS code sent to their number.`,
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
