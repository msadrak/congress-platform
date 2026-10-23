import React, { useEffect, useState } from "react";
import { localizedApiError, type BoothOut, type BoothStaffOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { formatMobile } from "../../lib/format";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/Input";
import { RowActions } from "../ui/RowActions";
import { DialogActions, Field, FormAlert, Notice } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

interface BoothStaffDialogProps {
  /** The booth whose representatives are shown; null keeps the dialog closed. Each opening starts afresh. */
  booth: BoothOut | null;
  onClose: () => void;
}

/**
 * A booth's representatives: who can sign in to its booth panel, removing one (confirmed first) and adding one
 * by mobile number, which texts them an invitation with the panel link. Changes need `canEdit`.
 */
export function BoothStaffDialog({ booth, onClose }: BoothStaffDialogProps) {
  const { eventId, client, locale, canEdit } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].boothStaff;
  const common = commonCopy[locale];
  const [staff, setStaff] = useState<BoothStaffOut[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [staffMobile, setStaffMobile] = useState("");
  const [staffName, setStaffName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [mobileInvalid, setMobileInvalid] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [shownBooth, setShownBooth] = useState<BoothOut | null>(null);
  if (booth !== shownBooth) {
    setShownBooth(booth);
    if (booth) {
      setStaff(null);
      setListError(null);
      setStaffMobile("");
      setStaffName("");
      setStaffError(null);
      setNotice(null);
    }
  }

  useEffect(() => {
    if (!booth || !client || !eventId) return;
    let alive = true;
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    void client
      .GET("/api/events/{event_id}/booths/{booth_id}/staff", { params: { path: { event_id: eventId, booth_id: booth.id } } })
      .then(({ data, error, response }) => {
        if (!alive) return;
        if (data) setStaff(data);
        else setListError(localizedApiError(error, locale, response.status));
      });
    return () => {
      alive = false;
    };
  }, [booth, client, eventId, locale]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!booth) return;
    setStaffError(null);
    setMobileInvalid(false);
    setNotice(null);
    const mobile = normalizeIranMobile(staffMobile);
    if (!mobile) {
      setMobileInvalid(true);
      setStaffError(common.mobileInvalid);
      return;
    }
    if (!client) return;
    setAssigning(true);
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/booths/{booth_id}/staff", {
      params: { path: { event_id: eventId, booth_id: booth.id } },
      body: { mobile, full_name: staffName.trim() },
    });
    setAssigning(false);
    if (!data) {
      setStaffError(localizedApiError(err, locale, response.status));
      return;
    }
    setStaffMobile("");
    setStaffName("");
    setStaff((current) => (current && !current.some((s) => s.id === data.id) ? [...current, data] : current));
    setNotice({ tone: "ok", text: copy.added(data.full_name || formatMobile(data.mobile ?? mobile, locale)) });
  };

  const removeStaff = async (member: BoothStaffOut) => {
    if (!client || !booth) return;
    setRemovingId(member.id);
    setNotice(null);
    const { error, response } = await client.DELETE("/api/events/{event_id}/booths/{booth_id}/staff/{staff_id}", {
      params: { path: { event_id: eventId, booth_id: booth.id, staff_id: member.id } },
    });
    setRemovingId(null);
    if (response.ok) {
      setStaff((current) => current?.filter((s) => s.id !== member.id) ?? current);
      setNotice({ tone: "ok", text: copy.removed(member.full_name) });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale, response.status) });
    }
  };

  const close = () => {
    if (!assigning) onClose();
  };

  return (
    <Dialog isOpen={Boolean(booth)} onClose={close} title={copy.title} description={booth ? copy.description(booth.name) : undefined} size="md">
      <div className="space-y-5">
        {notice && (
          <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={common.dismissMessage}>
            {notice.text}
          </Notice>
        )}

        <section aria-label={copy.listLabel}>
          {listError ? (
            <FormAlert>{listError}</FormAlert>
          ) : staff === null ? (
            <div className="skeleton h-14 rounded-control" aria-hidden="true" />
          ) : staff.length === 0 ? (
            <p className="rounded-control border border-dashed border-border-strong px-4 py-3 text-body-sm text-text-muted">{copy.none}</p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-control border border-border-default" data-testid="booth-staff-list">
              {staff.map((member) => (
                <li key={member.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Icon name="user" size={18} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-semibold text-text-primary">
                      <bdi>{member.full_name}</bdi>
                    </span>
                    {member.mobile && (
                      <bdi dir="ltr" className="tabular block text-caption text-text-muted">
                        {formatMobile(member.mobile, locale)}
                      </bdi>
                    )}
                  </span>
                  {canEdit && (
                    <RowActions
                      visible={0}
                      menuLabel={copy.moreActions(member.full_name)}
                      actions={[
                        {
                          label: copy.remove,
                          icon: "x-circle",
                          disabled: removingId === member.id,
                          onSelect: () => void removeStaff(member),
                          destructive: { title: copy.removeTitle(member.full_name), description: copy.removeBody, confirmLabel: copy.remove },
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {canEdit ? (
          <form onSubmit={handleAssign} className="space-y-4 border-t border-border-subtle pt-5" noValidate>
            <h3 className="text-body-sm font-bold text-text-primary">{copy.addTitle}</h3>
            <Field label={copy.name} optional>
              <TextInput autoComplete="off" maxLength={200} value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder={copy.namePlaceholder} />
            </Field>
            <Field label={copy.mobile} required hint={copy.mobileHint} error={mobileInvalid ? staffError : null}>
              <TextInput
                type="tel"
                required
                dir="ltr"
                inputMode="tel"
                autoComplete="off"
                className="tabular"
                value={staffMobile}
                onChange={(e) => setStaffMobile(e.target.value)}
                placeholder="09xx xxx xxxx"
              />
            </Field>

            {staffError && !mobileInvalid && <FormAlert>{staffError}</FormAlert>}

            <DialogActions>
              <Button type="button" variant="ghost" onClick={close}>
                {common.close}
              </Button>
              <Button type="submit" variant="primary" loading={assigning}>
                {copy.submit}
              </Button>
            </DialogActions>
          </form>
        ) : (
          <DialogActions>
            <Button type="button" variant="ghost" onClick={close}>
              {common.close}
            </Button>
          </DialogActions>
        )}
      </div>
    </Dialog>
  );
}
