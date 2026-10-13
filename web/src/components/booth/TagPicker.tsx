import { useId, type ReactNode } from "react";
import { Icon } from "../ui/Icon";

interface TagPickerProps {
  label: string;
  /** Localised preset follow-up actions. */
  presets: string[];
  selected: string[];
  onToggle: (tag: string) => void;
  /** Extra controls under the chips (custom-tag field). */
  children?: ReactNode;
}

/** Follow-up tag toggles; tags outside the presets (typed earlier) are listed as selected chips too. */
export function TagPicker({ label, presets, selected, onToggle, children }: TagPickerProps) {
  const labelId = useId();
  const extra = selected.filter((tag) => !presets.includes(tag));
  return (
    <div>
      <p id={labelId} className="ui-label">{label}</p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {[...presets, ...extra].map((tag) => {
          const on = selected.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(tag)}
              className={`press inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
                on
                  ? "border-aiteb-indigo bg-aiteb-indigo text-white shadow-[0_6px_14px_-8px_rgb(32_0_205/0.8)]"
                  : "border-border-default bg-surface-panel text-text-secondary hover:border-border-strong hover:text-text-primary"
              }`}
            >
              <Icon name={on ? "check" : "plus"} size={14} strokeWidth={2.25} className={on ? "" : "text-text-muted"} />
              <span className="min-w-0 truncate">{tag}</span>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
