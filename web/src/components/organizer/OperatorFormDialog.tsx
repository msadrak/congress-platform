import React, { useState } from "react";
import { localizedApiError, type DeskOperatorOut } from "../../api/client";
import { commonCopy } from "../../copy/common";
import { organizerSetupCopy } from "../../copy/organizerSetup";
import { normalizeIranMobile } from "../../lib/mobile";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { TextInput } from "../ui/Input";
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

/** Add a reception desk operator by name and mobile number; the desk link is texted to them. */
export function OperatorFormDialog({ isOpen, onClose, onSaved }: OperatorFormDialogProps) {
  const { eventId, client, locale } = useEventWorkspace();
  const copy = organizerSetupCopy[locale].operatorForm;
  const common = commonCopy[locale];
  const [operatorName, setOperatorName] = useState("");
  const [operatorMobile, setOperatorMobile] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The field the last client-side check rejected; its message shows under that field.
  const [invalidField, setInvalidField] = useState<OperatorField | null>(null);
  const fieldError = (field: OperatorField) => (invalidField === field ? formError : null);

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setFormError(null);
      setInvalidField(null);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setInvalidField(null);
    const mobile = normalizeIranMobile(operatorMobile);
    if (!operatorName.trim()) {
      setInvalidField("name");
      setFormError(copy.nameRequired);
      return;
    }
    if (!mobile) {
      setInvalidField("mobile");
      setFormError(common.mobileInvalid);
      return;
    }
    if (!client) return;
    setSubmitting(true);
    // A 401 reaches the layout's key gate through the API client (registerUnauthorizedHandler).
    const { data, error: err, response } = await client.POST("/api/events/{event_id}/desk/operators", {
      params: { path: { event_id: eventId } },
      body: { operator_name: operatorName.trim(), mobile },
    });
    setSubmitting(false);
    if (!data) {
      setFormError(localizedApiError(err, locale, response.status));
      return;
    }
    setOperatorName("");
    setOperatorMobile("");
    onSaved(data);
  };

  return (
    <Dialog isOpen={isOpen} onClose={() => !submitting && onClose()} title={copy.title} description={copy.description} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label={copy.name} required error={fieldError("name")}>
          <TextInput required value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder={copy.namePlaceholder} />
        </Field>

        <Field label={copy.mobile} required error={fieldError("mobile")}>
          <TextInput
            type="tel"
            required
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            className="tabular"
            value={operatorMobile}
            onChange={(e) => setOperatorMobile(e.target.value)}
            placeholder="09xx xxx xxxx"
          />
        </Field>

        {formError && invalidField === null && <FormAlert>{formError}</FormAlert>}

        <DialogActions>
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {common.add}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
