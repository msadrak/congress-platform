import { useEffect } from "react";
import { Icon } from "../ui/Icon";

interface UndoToastProps {
  message: string;
  undoLabel: string;
  dismissLabel: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** The undo stays offered this long, then the toast leaves by itself. */
  timeoutMs?: number;
  undoing?: boolean;
}

/**
 * The one-step undo after a lead is moved to the trash. Sits above the phone dock; announced politely, and its
 * timer restarts whenever a new message replaces it.
 */
export function UndoToast({ message, undoLabel, dismissLabel, onUndo, onDismiss, timeoutMs = 8000, undoing = false }: UndoToastProps) {
  useEffect(() => {
    if (undoing) return;
    const timer = window.setTimeout(onDismiss, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [message, timeoutMs, onDismiss, undoing]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 md:bottom-6">
      <div
        role="status"
        data-testid="undo-toast"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-surface-ink py-2 ps-4 pe-2 text-[13px] text-white shadow-lift motion-safe:animate-rise"
      >
        <Icon name="trash" size={17} className="shrink-0 text-white/70" />
        <span className="min-w-0 flex-1 break-words">{message}</span>
        <button
          type="button"
          onClick={onUndo}
          disabled={undoing}
          aria-busy={undoing}
          className="min-h-[44px] shrink-0 rounded-xl px-3 font-bold text-[var(--event-accent-glow,#c9b8ff)] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid disabled:opacity-60 cursor-pointer"
        >
          {undoLabel}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid cursor-pointer"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
