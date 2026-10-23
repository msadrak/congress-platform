import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { rovingTarget } from "./rovingKeys";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** `lang` of the label, e.g. "en" for «English» in a language switch. */
  lang?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group (or use `labelledBy`). */
  label?: string;
  labelledBy?: string;
  /** `md` 48 px (default); `lg` 56 px for the scanner and the desk. */
  size?: "md" | "lg";
  tone?: "default" | "ink";
  className?: string;
}

/**
 * One choice out of a few, shown side by side: a radiogroup with roving focus. Arrow keys move and select
 * (following the visual order in RTL), Home/End jump to the ends; Tab leaves the group.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  size = "md",
  tone = "default",
  className = "",
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled);
  const ink = tone === "ink";

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const target = rovingTarget({ key: event.key, index, disabled: options.map((o) => Boolean(o.disabled)), rtl });
    if (target === null) return;
    event.preventDefault();
    refs.current[target]?.focus();
    if (options[target].value !== value) onChange(options[target].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`grid auto-cols-fr grid-flow-col gap-1 rounded-control border p-1 ${size === "lg" ? "h-(--control-lg)" : "h-(--control-md)"} ${
        ink ? "border-white/15 bg-white/8" : "border-border-default bg-surface-panel-subtle"
      } ${className}`.trim()}
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            disabled={option.disabled}
            lang={option.lang}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-3 font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
              size === "lg" ? "text-body" : "text-body-sm"
            } ${
              selected
                ? ink
                  ? "bg-white text-surface-ink"
                  : "bg-surface-panel text-text-primary shadow-soft"
                : ink
                  ? "text-white/75 hover:text-white"
                  : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {option.icon && <Icon name={option.icon} size={size === "lg" ? 20 : 18} />}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
