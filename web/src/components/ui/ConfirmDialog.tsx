import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Destructive confirmations use the danger treatment. */
  tone?: "default" | "danger";
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title={title} description={description} size="sm">
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={tone === "danger" ? "danger" : "primary"} size="md" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
