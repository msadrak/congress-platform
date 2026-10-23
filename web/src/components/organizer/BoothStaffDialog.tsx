import React, { useEffect, useState } from "react";
import { localizedApiError, type BoothOut, type BoothStaffOut } from "../../api/client";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { DialogActions, Field, FormAlert, Notice } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

interface BoothStaffDialogProps {
  /** The booth whose representatives are shown; null keeps the dialog closed. Each opening starts afresh. */
  booth: BoothOut | null;
  onClose: () => void;
}

/**
 * A booth's representatives: who can sign in to its lead portal, removing one (after a confirmation), and
 * assigning a new one by mobile number. An assignment texts the representative an invitation with the portal link.
 */
export function BoothStaffDialog({ booth, onClose }: BoothStaffDialogProps) {
  const { eventId, client, locale, t, isRtl, can } = useEventWorkspace();
  const canManage = can("manager");
  const [staff, setStaff] = useState<BoothStaffOut[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [staffMobile, setStaffMobile] = useState("");
  const [staffName, setStaffName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [mobileInvalid, setMobileInvalid] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<BoothStaffOut | null>(null);
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
      .then(({ data, error }) => {
        if (!alive) return;
        if (data) setStaff(data);
        else setListError(localizedApiError(error, locale));
      });
    return () => {
      alive = false;
    };
  }, [booth, client, eventId, locale]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !booth) return;
    setStaffError(null);
    setMobileInvalid(false);
    setNotice(null);
    const mobile = normalizeIranMobile(staffMobile);
    if (!mobile) {
      setMobileInvalid(true);
      setStaffError(isRtl ? "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹." : "Enter a valid Iranian mobile number, e.g. 0912 345 6789.");
      return;
    }
    if (!client) return;
    setAssigning(true);
    const { data, error: err } = await client.POST("/api/events/{event_id}/booths/{booth_id}/staff", {
      params: { path: { event_id: eventId, booth_id: booth.id } },
      body: { mobile, full_name: staffName.trim() },
    });
    setAssigning(false);
    if (err) {
      setStaffError(localizedApiError(err, locale));
    } else if (data) {
      setStaffMobile("");
      setStaffName("");
      setStaff((current) => (current && !current.some((s) => s.id === data.id) ? [...current, data] : current));
      setNotice({
        tone: "ok",
        text: isRtl
          ? "نماینده تخصیص یافت و پیامک دعوت با پیوند پورتال غرفه برایش فرستاده شد. او با کد پیامکی به همین شماره وارد می‌شود."
          : "Representative assigned and texted an invitation with the booth portal link. They sign in with an SMS code sent to this number.",
      });
    }
  };

  const removeStaff = async (member: BoothStaffOut) => {
    if (!client || !eventId || !booth) return;
    setRemovingId(member.id);
    setNotice(null);
    const { error, response } = await client.DELETE("/api/events/{event_id}/booths/{booth_id}/staff/{staff_id}", {
      params: { path: { event_id: eventId, booth_id: booth.id, staff_id: member.id } },
    });
    setRemovingId(null);
    if (response.ok) {
      setStaff((current) => current?.filter((s) => s.id !== member.id) ?? current);
      setNotice({
        tone: "ok",
        text: isRtl ? `دسترسی «${member.full_name}» به پورتال غرفه برداشته شد.` : `${member.full_name} no longer has access to the booth portal.`,
      });
    } else {
      setNotice({ tone: "error", text: localizedApiError(error, locale) });
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";
  const close = () => {
    if (!assigning) onClose();
  };

  return (
    <>
      <Dialog
        isOpen={Boolean(booth)}
        onClose={close}
        title={isRtl ? "نمایندگان غرفه" : "Booth representatives"}
        description={booth ? (isRtl ? `کسانی که به پورتال لیدهای «${booth.name}» دسترسی دارند.` : `Who can sign in to the lead portal of “${booth.name}”.`) : undefined}
        size="md"
      >
        <div className="space-y-5">
          {notice && (
            <Notice tone={notice.tone} onDismiss={() => setNotice(null)} dismissLabel={isRtl ? "بستن پیام" : "Dismiss message"}>
              {notice.text}
            </Notice>
          )}

          <section aria-label={isRtl ? "نمایندگان فعلی" : "Current representatives"}>
            {listError ? (
              <FormAlert>{listError}</FormAlert>
            ) : staff === null ? (
              <div className="skeleton h-14 rounded-xl" aria-hidden="true" />
            ) : staff.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-strong px-4 py-3 text-sm text-text-muted">
                {isRtl ? "هنوز نماینده‌ای به این غرفه تخصیص نیافته است." : "No representative is assigned to this booth yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-xl border border-border-default" data-testid="booth-staff-list">
                {staff.map((member) => (
                  <li key={member.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-aiteb-lavender text-aiteb-indigo">
                      <Icon name="user" size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-text-primary">
                        <bdi>{member.full_name}</bdi>
                      </span>
                      {member.mobile && (
                        <bdi dir="ltr" className="block font-mono text-xs text-text-muted">
                          {member.mobile}
                        </bdi>
                      )}
                    </span>
                    {canManage && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={removingId === member.id}
                        onClick={() => setRemoveTarget(member)}
                        aria-label={isRtl ? `برداشتن ${member.full_name}` : `Remove ${member.full_name}`}
                        className="!text-status-danger-text hover:!border-status-danger-border hover:!bg-status-danger-bg"
                      >
                        <Icon name="trash" size={15} />
                        <span>{isRtl ? "برداشتن" : "Remove"}</span>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canManage ? (
            <form onSubmit={handleAssign} className="space-y-4 border-t border-border-subtle pt-5" noValidate>
              <h3 className="text-sm font-bold text-text-primary">{t.assignStaffModalTitle}</h3>
              <Field label={isRtl ? "نام نماینده" : "Representative name"}>
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={200}
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder={isRtl ? "مثال: سارا کریمی" : "e.g. Sara Karimi"}
                  className="ui-input"
                />
              </Field>
              <Field
                label={t.staffMobileLabel}
                required
                hint={
                  isRtl
                    ? "با تخصیص، پیامک دعوت با پیوند پورتال غرفه به این شماره فرستاده می‌شود و صاحب آن با کد پیامکی وارد می‌شود. اگر از قبل حساب داشته باشد، همان حساب استفاده می‌شود."
                    : "Assigning texts an invitation with the booth portal link to this number; its holder signs in with an SMS code. An existing account keeps its own name."
                }
              >
                <input
                  type="tel"
                  required
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="off"
                  value={staffMobile}
                  onChange={(e) => setStaffMobile(e.target.value)}
                  aria-invalid={(staffError !== null && mobileInvalid) || undefined}
                  placeholder="09xx xxx xxxx"
                  className="ui-input font-mono"
                />
              </Field>

              {staffError && <FormAlert>{staffError}</FormAlert>}

              <DialogActions>
                <Button type="button" variant="ghost" size="md" onClick={close}>
                  {isRtl ? "بستن" : "Close"}
                </Button>
                <Button type="submit" variant="primary" size="md" disabled={assigning} aria-busy={assigning}>
                  {assigning ? t.savingAction : t.assignStaffAction}
                </Button>
              </DialogActions>
            </form>
          ) : (
            <DialogActions>
              <Button type="button" variant="ghost" size="md" onClick={close}>
                {isRtl ? "بستن" : "Close"}
              </Button>
            </DialogActions>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        isOpen={removeTarget !== null}
        tone="danger"
        title={isRtl ? "دسترسی این نماینده برداشته شود؟" : "Remove this representative?"}
        description={
          removeTarget
            ? isRtl
              ? `«${removeTarget.full_name}» از درخواست بعدی دیگر به پورتال، لیدها و خروجی‌های این غرفه دسترسی ندارد. لیدهایی که ثبت کرده نزد غرفه می‌ماند.`
              : `${removeTarget.full_name} loses access to this booth's portal, leads and exports from their next request. Leads they captured stay with the booth.`
            : ""
        }
        confirmLabel={isRtl ? "برداشتن دسترسی" : "Remove access"}
        cancelLabel={cancelLabel}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void removeStaff(target);
        }}
      />
    </>
  );
}
