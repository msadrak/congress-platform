import { useId, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface SwitchProps {
  label: ReactNode;
  /** One optional line under the label. */
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Saving: the switch reports `aria-busy` and ignores input. */
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * An on/off setting: `role="switch"` with its state in `aria-checked`. The knob starts at the reading start
 * and moves toward the end when on (right in English, left in Persian). The whole row is the touch target.
 */
export function Switch({ label, description, checked, onChange, busy = false, disabled = false, className = "" }: SwitchProps) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`.trim()}>
      <div className="min-w-0 space-y-1">
        <p id={`${id}-label`} className="text-body-sm font-semibold text-text-primary">
          {label}
        </p>
        {description && (
          <p id={`${id}-desc`} className="text-caption leading-relaxed text-text-secondary">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-14 shrink-0 cursor-pointer rounded-full border transition-colors motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 before:absolute before:-inset-2 before:content-[''] ${
          checked ? "border-transparent bg-action-primary" : "border-(--border-input) bg-surface-panel-inset"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 start-1 grid size-6 place-items-center rounded-full bg-white shadow-soft transition-transform motion-reduce:transition-none ${
            checked ? "translate-x-6 rtl:-translate-x-6" : ""
          }`}
        >
          <Icon name={checked ? "check" : "minus"} size={12} strokeWidth={2.5} className={checked ? "text-aiteb-indigo" : "text-ink-400"} />
        </span>
      </button>
    </div>
  );
}
