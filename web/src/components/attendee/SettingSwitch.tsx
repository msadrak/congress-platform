import { useId } from "react";
import { Icon } from "../ui/Icon";

interface SettingSwitchProps {
  label: string;
  description: string;
  checked: boolean;
  busy: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
}

/**
 * An on/off setting: `role="switch"` with its state in `aria-checked`. The knob starts at the reading
 * start and moves toward the end when on (right in English, left in Persian), with the state also in words.
 */
export function SettingSwitch({ label, description, checked, busy, onLabel, offLabel, onToggle }: SettingSwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border-subtle bg-surface-panel-subtle p-4">
      <div className="min-w-0 space-y-1">
        <p id={`${id}-label`} className="text-sm font-semibold text-text-primary">{label}</p>
        <p id={`${id}-desc`} className="text-xs leading-relaxed text-text-secondary">{description}</p>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-desc`}
          aria-busy={busy}
          disabled={busy}
          onClick={onToggle}
          className={`relative mt-0.5 h-8 w-14 rounded-full border transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60 cursor-pointer before:absolute before:-inset-2 before:content-[''] ${
            checked ? "border-transparent bg-[image:var(--grad-aiteb-deep)]" : "border-border-strong bg-surface-panel-inset"
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
        <span aria-hidden="true" className={`text-[11px] font-semibold ${checked ? "text-action-primary" : "text-text-muted"}`}>
          {checked ? onLabel : offLabel}
        </span>
      </div>
    </div>
  );
}
