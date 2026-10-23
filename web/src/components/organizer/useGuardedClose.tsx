import { useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";

/**
 * Closing a form dialog that holds unsaved edits asks first ("Discard changes?"); a clean form closes at once.
 * Render `discardDialog` after the form's own dialog so it stacks above it (and answers Escape first).
 */
export function useGuardedClose(dirty: boolean, close: () => void, isRtl: boolean) {
  const [asking, setAsking] = useState(false);
  const requestClose = () => {
    if (dirty) setAsking(true);
    else close();
  };
  const discardDialog = (
    <ConfirmDialog
      isOpen={asking}
      tone="danger"
      title={isRtl ? "تغییرات ذخیره نشده کنار گذاشته شود؟" : "Discard unsaved changes?"}
      description={
        isRtl
          ? "تغییراتی که در این فرم داده‌اید هنوز ذخیره نشده‌اند و با بستن آن از بین می‌روند."
          : "The changes you made in this form have not been saved and will be lost if you close it."
      }
      confirmLabel={isRtl ? "کنار گذاشتن تغییرات" : "Discard changes"}
      cancelLabel={isRtl ? "ادامهٔ ویرایش" : "Keep editing"}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        setAsking(false);
        close();
      }}
    />
  );
  return { requestClose, discardDialog };
}
