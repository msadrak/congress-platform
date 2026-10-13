import { Icon } from "../ui/Icon";

export type DeskMode = "operator" | "organizer";

interface ModeSwitchProps {
  mode: DeskMode;
  isRtl: boolean;
  disabled: boolean;
  onSelect: (mode: DeskMode) => void;
  /** `ink` on the dark console band, `light` on the sign-in panel. */
  tone: "ink" | "light";
}

/** Organizer administration only: the deliberate choice of which credential the desk sends. */
export function ModeSwitch({ mode, isRtl, disabled, onSelect, tone }: ModeSwitchProps) {
  const ink = tone === "ink";
  return (
    <div role="group" aria-label={isRtl ? "حالت کاری" : "Working mode"} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span data-testid="desk-active-mode" className={`text-[11px] font-medium ${ink ? "text-ink-300" : "text-text-muted"}`}>
        {mode === "operator"
          ? isRtl ? "فعال: نشست اپراتور" : "Acting as: reception operator"
          : isRtl ? "فعال: حالت مدیر" : "Acting as: organizer"}
      </span>
      <span className={`inline-flex rounded-xl p-1 ring-1 ${ink ? "bg-white/[0.07] ring-white/12" : "bg-surface-panel-subtle ring-border-default"}`}>
        {(["operator", "organizer"] as const).map((option) => {
          const on = mode === option;
          const look = ink
            ? on ? "bg-white text-surface-ink" : "text-ink-200 hover:text-white"
            : on ? "bg-surface-panel text-text-primary shadow-soft ring-1 ring-border-default" : "text-text-secondary hover:text-text-primary";
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onSelect(option)}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 ${ink ? "focus-visible:outline-aiteb-orchid" : "focus-visible:outline-focus-ring"} ${look}`}
            >
              <Icon name={option === "operator" ? "user" : "key"} size={15} />
              <span>{option === "operator" ? (isRtl ? "نشست اپراتور" : "Operator session") : isRtl ? "حالت مدیر" : "Organizer mode"}</span>
            </button>
          );
        })}
      </span>
    </div>
  );
}
