import React, { useState } from "react";
import { formatApiError, type BoothOut } from "../../api/client";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

interface BoothStaffDialogProps {
  /** The booth receiving a representative; null keeps the dialog closed. Each opening starts empty. */
  booth: BoothOut | null;
  onClose: () => void;
  /** The representative was assigned; the caller closes the dialog and announces it. */
  onAssigned: () => void;
}

/** Assign a booth representative by mobile number; they sign in to the booth portal with an SMS code. */
export function BoothStaffDialog({ booth, onClose, onAssigned }: BoothStaffDialogProps) {
  const { eventId, apiKey, client, onKeyRejected, t, isRtl } = useEventWorkspace();
  const [staffMobile, setStaffMobile] = useState("");
  const [staffName, setStaffName] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [mobileInvalid, setMobileInvalid] = useState(false);

  const [shownBooth, setShownBooth] = useState<BoothOut | null>(null);
  if (booth !== shownBooth) {
    setShownBooth(booth);
    if (booth) {
      setStaffMobile("");
      setStaffName("");
      setStaffError(null);
    }
  }

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !booth) return;
    setStaffError(null);
    setMobileInvalid(false);
    const mobile = normalizeIranMobile(staffMobile);
    if (!mobile) {
      setMobileInvalid(true);
      setStaffError(isRtl ? "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹." : "Enter a valid Iranian mobile number, e.g. 0912 345 6789.");
      return;
    }

    if (!apiKey || !client) return;
    setAssigning(true);
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/booths/{booth_id}/staff", {
      params: { path: { event_id: eventId, booth_id: booth.id } },
      body: { mobile, full_name: staffName.trim() },
    });

    if (response.status === 401) onKeyRejected(apiKey);
    setAssigning(false);
    if (err) {
      setStaffError(formatApiError(err));
    } else if (data) {
      setStaffMobile("");
      setStaffName("");
      onAssigned();
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";

  return (
    <Dialog
      isOpen={Boolean(booth)}
      onClose={() => {
        if (!assigning) onClose();
      }}
      title={t.assignStaffModalTitle}
      description={booth ? `${t.assignStaffModalDesc} (${booth.name})` : undefined}
      size="sm"
    >
      <form onSubmit={handleAssign} className="space-y-4" noValidate>
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
              ? "صاحب این شماره با کد پیامکی وارد پورتال لیدهای غرفه می‌شود. اگر از قبل حساب داشته باشد، همان حساب استفاده می‌شود."
              : "The holder of this number signs in to the booth's lead portal with an SMS code. An existing account keeps its own name."
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
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={assigning} aria-busy={assigning}>
            {assigning ? t.savingAction : t.assignStaffAction}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
