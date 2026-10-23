import React, { useState } from "react";
import { localizedApiError, type DeskOperatorOut } from "../../api/client";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { DialogActions, Field, FormAlert } from "./WorkspaceUi";
import { useEventWorkspace } from "./eventWorkspaceContext";

type OperatorField = "name" | "mobile";

interface OperatorFormDialogProps {
  /** Opening clears the last error; what was typed survives closing until an operator is authorized. */
  isOpen: boolean;
  onClose: () => void;
  /** The authorized (or re-authorized) operator; the caller updates its list, closes and announces it. */
  onSaved: (operator: DeskOperatorOut) => void;
}

/** Authorize a Front Desk operator by name and mobile number. */
export function OperatorFormDialog({ isOpen, onClose, onSaved }: OperatorFormDialogProps) {
  const { eventId, apiKey, client, onKeyRejected, locale, t, isRtl } = useEventWorkspace();
  const [operatorName, setOperatorName] = useState("");
  const [operatorMobile, setOperatorMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; marked only while the form's error is shown.
  const [invalidField, setInvalidField] = useState<OperatorField | null>(null);
  const fieldInvalid = (field: OperatorField) => (formError !== null && invalidField === field) || undefined;

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setFormError(null);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;
    setFormError(null);
    setInvalidField(null);
    const mobile = normalizeIranMobile(operatorMobile);
    if (!operatorName.trim()) {
      setInvalidField("name");
      setFormError(isRtl ? "نام اپراتور را وارد کنید." : "Enter the operator's name.");
      return;
    }
    if (!mobile) {
      setInvalidField("mobile");
      setFormError(isRtl ? "یک شماره موبایل معتبر وارد کنید؛ مثلاً ۰۹۱۲ ۳۴۵ ۶۷۸۹." : "Enter a valid mobile number, e.g. 0912 345 6789.");
      return;
    }
    if (!apiKey || !client) return;
    setSubmitting(true);
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators", {
      params: { path: { event_id: eventId } },
      body: {
        operator_name: operatorName.trim(),
        mobile,
      },
    });
    if (response.status === 401) onKeyRejected(apiKey);
    setSubmitting(false);
    if (err) {
      setFormError(localizedApiError(err, locale));
    } else if (data) {
      setOperatorName("");
      setOperatorMobile("");
      onSaved(data);
    }
  };

  const cancelLabel = isRtl ? "انصراف" : "Cancel";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!submitting) {
          onClose();
          setFormError(null);
        }
      }}
      title={t.addOperatorModalTitle}
      description={t.addOperatorModalDesc}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label={t.operatorNameLabel} required>
          <input
            type="text"
            required
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            aria-invalid={fieldInvalid("name")}
            placeholder={isRtl ? "مثال: مریم باقری (مسئول گیت پذیرش)" : "e.g. Maryam Bagheri"}
            className="ui-input"
          />
        </Field>

        <Field
          label={t.operatorMobileLabel}
          required
          hint={isRtl ? "اپراتور با کد پیامکی به همین شماره وارد میز پذیرش می‌شود." : "The operator signs in to the Front Desk with an SMS code sent to this number."}
        >
          <input
            type="tel"
            required
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            value={operatorMobile}
            onChange={(e) => setOperatorMobile(e.target.value)}
            aria-invalid={fieldInvalid("mobile")}
            placeholder="09xx xxx xxxx"
            className="ui-input font-mono"
          />
        </Field>

        {formError && <FormAlert>{formError}</FormAlert>}

        <DialogActions>
          <Button type="button" variant="ghost" size="md" disabled={submitting} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={submitting} aria-busy={submitting}>
            {submitting ? t.creatingAction : isRtl ? "صدور دسترسی اپراتور" : "Authorize Operator"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
