import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { useUiCopy } from "./uiCopy";

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** A question: «… حذف شود؟» / "Delete …?" */
  title: string;
  /** At most one sentence: the consequence. */
  description?: string;
  /** The verb that repeats the title («حذف», "Delete"). Required: there is no generic «تأیید». */
  confirmLabel: string;
  /** Defaults to «انصراف» / "Cancel". */
  cancelLabel?: string;
  /** Destructive confirmations use the danger treatment. */
  tone?: "default" | "danger";
  /** The confirmed work is running: the confirm button shows a spinner and ignores clicks. */
  busy?: boolean;
  /** Optional extra input between the question and the buttons, e.g. an optional reason. */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Explicit confirmation for a consequential change; Cancel is focused first. */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { ref, copy } = useUiCopy<HTMLSpanElement>();
  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title={title} description={description} size="sm">
      <span ref={ref} hidden />
      {children && <div className="mb-5">{children}</div>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
          {cancelLabel ?? copy.cancel}
        </Button>
        <Button type="button" variant={tone === "danger" ? "danger" : "primary"} size="md" loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
