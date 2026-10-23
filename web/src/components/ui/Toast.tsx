import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** While true the toast stays and the button shows it is working. */
  busy?: boolean;
}

export interface ToastProps {
  /** One line, ≤ 60 characters, no icon prefix in the text. */
  message: string;
  /** Accessible name of the ✕ button («بستن» / "Close"). */
  dismissLabel: string;
  onDismiss: () => void;
  /** Optional single action, e.g. undo. */
  action?: ToastAction;
  icon?: IconName;
  /** Defaults to 4 s, or 8 s with an action. Paused while the pointer or focus is on the toast. */
  timeoutMs?: number;
  testId?: string;
}

/**
 * A one-line notice at the bottom centre, above the phone dock and the safe area, announced politely. It leaves by
 * itself; the timer restarts when the message changes (give it a new `key` to restart it for the same text).
 */
export function Toast({ message, dismissLabel, onDismiss, action, icon, timeoutMs, testId = "toast" }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  const busy = action?.busy ?? false;
  const delay = timeoutMs ?? (action ? 8000 : 4000);
  useEffect(() => {
    if (busy || paused) return;
    const timer = window.setTimeout(() => dismissRef.current(), delay);
    return () => window.clearTimeout(timer);
  }, [message, delay, busy, paused]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 pb-safe md:bottom-6">
      <div
        role="status"
        aria-live="polite"
        data-testid={testId}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-surface-ink py-1.5 ps-4 pe-1.5 text-sm text-white shadow-lift motion-safe:animate-rise"
      >
        {icon && <Icon name={icon} size={17} className="text-white/70" />}
        <span className="min-w-0 flex-1 truncate" title={message}>
          {message}
        </span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            disabled={busy}
            aria-busy={busy || undefined}
            className="min-h-11 shrink-0 rounded-xl px-3 font-bold text-aiteb-orchid hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-aiteb-orchid disabled:opacity-60 cursor-pointer"
          >
            {action.label}
          </button>
        )}
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
