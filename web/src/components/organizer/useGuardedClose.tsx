import { useState } from "react";
import { organizerCopy } from "../../copy/organizer";
import type { AttendeeLocale } from "../../lib/i18n";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/**
 * Closing a form dialog that holds unsaved edits asks first ("Discard changes?"); a clean form closes at once.
 * Render `discardDialog` after the form's own dialog so it stacks above it (and answers Escape first).
 */
export function useGuardedClose(dirty: boolean, close: () => void, locale: AttendeeLocale) {
  const copy = organizerCopy[locale].form;
  const [asking, setAsking] = useState(false);
  const requestClose = () => {
    if (dirty) setAsking(true);
    else close();
  };
  const discardDialog = (
    <ConfirmDialog
      isOpen={asking}
      tone="danger"
      title={copy.discardTitle}
      description={copy.discardBody}
      confirmLabel={copy.discard}
      cancelLabel={copy.keepEditing}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        close();
      }}
    />
  );
  return { requestClose, discardDialog };
}
