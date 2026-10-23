import { useState } from "react";
import QRCode from "react-qr-code";
import { localizedApiError, type DeskOperatorOut, type EventOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { formatDate, formatMobile } from "../../lib/format";
import { eventWorkspacePath } from "../../lib/organizerWorkspace";
import { Button } from "../../components/ui/Button";
import { RowActions } from "../../components/ui/RowActions";
import { StatusChip } from "../../components/ui/StatusChip";
import { PageHeader } from "../../components/ui/PageHeader";
import { EmptyState } from "../../components/organizer/WorkspaceUi";
import { OperatorFormDialog } from "../../components/organizer/OperatorFormDialog";
import { useEventWorkspace } from "../../components/organizer/eventWorkspaceContext";
import { eventTimeZone } from "../../components/organizer/sessionTime";
import { EventSectionGate, SectionLoadError, SectionNotice, type SectionNoticeState } from "./EventSectionUi";
import { loadDeskOperators, sectionLoad, useEventList } from "./eventLists";

/**
 * `/organizer/events/:eventId/operators`: who runs the reception desk, reached from the desk (the navigation
 * highlights the desk here and the header links back to it). Staff hand out the desk address; managers add desk
 * operators and remove or restore their access. An archived congress is read-only.
 */
export default function EventOperators() {
  const { eventId, client, locale, can, canEdit } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].operators;
  const common = commonCopy[locale];
  // The operator list is for managers (backend/app/roles.py); staff only open the desk.
  const operators = useEventList(loadDeskOperators, can("manager"));
  const lists = sectionLoad([operators]);
  const [notice, setNotice] = useState<SectionNoticeState>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const replaceOperator = (saved: DeskOperatorOut) => operators.setItems((prev) => prev.map((o) => (o.id === saved.id ? saved : o)));

  const changeAccess = async (op: DeskOperatorOut, restore: boolean) => {
    if (!client) return;
    setBusyId(op.id);
    const path = { params: { path: { event_id: eventId, operator_id: op.id } } };
    const { data, error: err, response } = restore
      ? await client.POST("/api/events/{event_id}/desk/operators/{operator_id}/restore", path)
      : await client.POST("/api/events/{event_id}/desk/operators/{operator_id}/revoke", path);
    setBusyId(null);
    if (!data) {
      setNotice({ tone: "error", text: localizedApiError(err, locale, response.status) });
      return;
    }
    replaceOperator(data);
    setNotice({ tone: "ok", text: restore ? copy.restored(data.operator_name) : copy.revoked(data.operator_name) });
  };

  // The reception desk of this congress: operators open it and sign in with an SMS code.
  const receptionUrl = `${window.location.origin}/reception/${eventId}`;
  const copyReceptionUrl = async () => {
    try {
      await navigator.clipboard.writeText(receptionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setNotice({ tone: "error", text: copy.copyFailed });
    }
  };

  const body = (ev: EventOut) => {
    const live = ev.archived_at == null;
    const zone = eventTimeZone(ev);
    const addOperator = canEdit ? (
      <Button type="button" variant="primary" icon="plus" onClick={() => setIsAddOpen(true)}>
        {copy.add}
      </Button>
    ) : undefined;

    return (
      <div className="space-y-6">
        <PageHeader title={copy.title} back={{ to: eventWorkspacePath(eventId, "/desk"), label: copy.back }} actions={operators.items.length > 0 ? addOperator : undefined} />

        <SectionNotice notice={notice} onDismiss={() => setNotice(null)} />

        {live && can("staff") && (
          <section
            aria-labelledby="reception-link-heading"
            data-testid="reception-link"
            className="flex flex-col gap-5 rounded-card border border-border-default bg-surface-panel p-5 sm:flex-row sm:items-center"
          >
            <div className="shrink-0 self-center rounded-control bg-white p-2.5 ring-1 ring-border-default">
              <QRCode value={receptionUrl} size={112} level="M" viewBox="0 0 256 256" fgColor="#000000" bgColor="#FFFFFF" className="size-28" aria-label={copy.qrLabel} />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <h2 id="reception-link-heading" className="text-body-sm font-semibold text-text-primary">
                {copy.addressTitle}
              </h2>
              <p className="text-caption text-text-secondary">{copy.addressBody}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code dir="ltr" className="min-w-0 break-all rounded-md bg-surface-panel-subtle px-2.5 py-1.5 font-mono text-caption text-text-primary">
                  {receptionUrl}
                </code>
                <Button type="button" variant="secondary" size="sm" icon={copied ? "check" : "copy"} onClick={() => void copyReceptionUrl()}>
                  {copied ? common.copied : copy.copyAddress}
                </Button>
              </div>
              <p className="sr-only" role="status">
                {copied ? copy.copiedStatus : ""}
              </p>
            </div>
          </section>
        )}

        {can("manager") && (
          <section aria-label={copy.title} className="space-y-4">
            <SectionLoadError error={lists.error} loading={lists.loading} onRetry={lists.reload} />
            {operators.error ? null : operators.items.length === 0 ? (
              <EmptyState icon="users" title={copy.empty} action={addOperator} />
            ) : (
              <div className="overflow-clip rounded-card border border-border-default bg-surface-panel">
                <table className="org-table org-table--stack">
                  <caption className="sr-only">{copy.title}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{copy.colName}</th>
                      <th scope="col">{copy.colStatus}</th>
                      <th scope="col">{copy.colAdded}</th>
                      <th scope="col">
                        <span className="sr-only">{copy.colActions}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {operators.items.map((op) => (
                      <tr key={op.id}>
                        <td>
                          <p className={`break-words text-body-sm font-semibold ${op.is_revoked ? "text-text-secondary" : "text-text-primary"}`}>
                            <bdi>{op.operator_name}</bdi>
                          </p>
                          {op.mobile && (
                            <p className="tabular text-caption text-text-muted">
                              <bdi dir="ltr">{formatMobile(op.mobile, locale)}</bdi>
                            </p>
                          )}
                        </td>
                        <td data-label={copy.colStatus}>
                          <StatusChip status={op.is_revoked ? "accessRemoved" : "active"} size="sm" />
                        </td>
                        <td data-label={copy.colAdded} className="text-caption text-text-secondary">
                          {formatDate(op.created_at, "long", locale, zone)}
                        </td>
                        <td className="text-end">
                          {canEdit && (
                            <RowActions
                              visible={op.is_revoked ? 1 : 0}
                              menuLabel={copy.moreActions(op.operator_name)}
                              actions={[
                                op.is_revoked
                                  ? { label: copy.restore, icon: "sync", disabled: busyId === op.id, onSelect: () => void changeAccess(op, true) }
                                  : {
                                      label: copy.revoke,
                                      icon: "lock",
                                      disabled: busyId === op.id,
                                      onSelect: () => void changeAccess(op, false),
                                      destructive: { title: copy.revokeTitle(op.operator_name), description: copy.revokeBody, confirmLabel: copy.revoke },
                                    },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="space-y-6">
        <EventSectionGate listsLoaded={lists.loaded}>{body}</EventSectionGate>
      </div>
      <OperatorFormDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onSaved={(saved) => {
          operators.setItems((prev) => (prev.some((o) => o.id === saved.id) ? prev.map((o) => (o.id === saved.id ? saved : o)) : [...prev, saved]));
          setIsAddOpen(false);
          setNotice({ tone: "ok", text: copy.added(saved.operator_name) });
        }}
      />
    </>
  );
}
