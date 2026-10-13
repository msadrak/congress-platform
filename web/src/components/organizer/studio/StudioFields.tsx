import { useId, type ReactNode } from "react";
import type { LocalizedText, PageLocale } from "../../../lib/pageDocument";
import { Button } from "../../ui/Button";
import { Icon, type IconName } from "../../ui/Icon";
import { useStudio } from "./studioContext";

const OTHER: Record<PageLocale, PageLocale> = { fa: "en", en: "fa" };

/**
 * One fa/en text slot, edited in the current content language. The note under it says what visitors
 * of this language will see when it is empty: the other language, or the platform/event default.
 */
export function LocalizedField({
  label,
  value,
  onChange,
  multiline = false,
  rows = 4,
  maxLength,
  emptyNote,
  hint,
}: {
  label: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
  multiline?: boolean;
  rows?: number;
  maxLength: number;
  /** What an empty slot falls back to when neither language is filled. */
  emptyNote?: string;
  hint?: ReactNode;
}) {
  const { copy, lang } = useStudio();
  const id = useId();
  const other = OTHER[lang];
  const current = value[lang];
  const otherFilled = value[other].trim().length > 0;
  const note = current.trim() ? null : otherFilled ? copy.fallbackNote(copy.languages[other]) : emptyNote ?? null;
  const common = {
    id,
    dir: lang === "fa" ? "rtl" : "ltr",
    lang,
    value: current,
    maxLength,
    className: `ui-input ${multiline ? "min-h-[7rem] resize-y leading-relaxed" : ""}`,
    onChange: (e: { target: { value: string } }) => onChange({ ...value, [lang]: e.target.value }),
  } as const;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="ui-label mb-0">
          {label}
        </label>
        <span className="flex items-center gap-1" aria-hidden="true">
          {(["fa", "en"] as const).map((l) => (
            <span
              key={l}
              title={value[l].trim() ? copy.languages[l] : copy.missing(copy.languages[l])}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                value[l].trim() ? "bg-aiteb-lavender text-aiteb-indigo" : "bg-surface-panel-subtle text-text-muted line-through decoration-text-muted/60"
              }`}
            >
              {l}
            </span>
          ))}
        </span>
      </div>
      {multiline ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
      {(note || hint) && (
        <p className="text-xs leading-relaxed text-text-muted">
          {note}
          {note && hint ? " " : null}
          {hint}
        </p>
      )}
    </div>
  );
}

/** A small set of named choices shown as a segmented control. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: IconName }>;
  onChange: (next: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className="ui-label">{label}</legend>
      <div className="grid gap-1 rounded-xl border border-border-default bg-surface-panel-subtle p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-[40px] cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-center text-xs font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
              value === option.value ? "bg-surface-panel text-text-primary shadow-soft" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="sr-only" />
            {option.icon && <Icon name={option.icon} size={15} />}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Image slot: thumbnail with its real proportions, choose/replace from the library, remove. */
export function ImageField({
  label,
  value,
  onChange,
  hint,
  aspect = "wide",
}: {
  label: string;
  value: string | null;
  onChange: (next: string | null) => void;
  hint?: ReactNode;
  aspect?: "wide" | "square" | "logo";
}) {
  const { copy, images, pickImage } = useStudio();
  const image = value ? images[value] : undefined;
  const frame = aspect === "logo" ? "h-20" : aspect === "square" ? "aspect-square w-28" : "aspect-[16/9]";
  return (
    <div className="space-y-1.5">
      <p className="ui-label">{label}</p>
      <div className="flex items-stretch gap-3">
        <div
          className={`relative grid shrink-0 place-items-center overflow-hidden rounded-xl border border-border-default bg-[repeating-conic-gradient(var(--surface-panel-subtle)_0%_25%,var(--surface-panel)_0%_50%)] bg-[length:16px_16px] ${frame} ${aspect === "wide" ? "w-40" : aspect === "logo" ? "w-32" : ""}`}
        >
          {image?.url ? (
            <img src={image.url} alt="" className={`size-full ${aspect === "logo" ? "object-contain p-2" : "object-cover"}`} />
          ) : value ? (
            <span className="size-full animate-pulse bg-surface-panel-subtle" />
          ) : (
            <Icon name="image" size={22} className="text-text-muted" />
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              const picked = await pickImage();
              if (picked) onChange(picked);
            }}
          >
            <Icon name="upload" size={15} />
            {value ? copy.media.replace : copy.media.choose}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Icon name="x" size={15} />
              {copy.media.remove}
            </Button>
          )}
          {image && (
            <span className="font-mono text-[11px] text-text-muted tabular" dir="ltr">
              {image.width}×{image.height}
            </span>
          )}
        </div>
      </div>
      {hint && <p className="text-xs leading-relaxed text-text-muted">{hint}</p>}
    </div>
  );
}

/** Repeatable items (FAQ entries, speakers …) with add / reorder / remove. */
export function ItemList<T>({
  items,
  onChange,
  max,
  create,
  summary,
  render,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  max: number;
  create: () => T;
  summary: (item: T, index: number) => string;
  render: (item: T, update: (next: T) => void) => ReactNode;
}) {
  const { copy } = useStudio();
  const move = (from: number, to: number) => {
    const next = items.slice();
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <p className="ui-label">{copy.fields.items}</p>
      <ol className="space-y-3">
        {items.map((item, i) => (
          <li key={i} className="rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-aiteb-indigo tabular">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{summary(item, i) || copy.untitled}</span>
              <IconButton icon="arrow-up" label={copy.moveUp} disabled={i === 0} onClick={() => move(i, i - 1)} />
              <IconButton icon="arrow-down" label={copy.moveDown} disabled={i === items.length - 1} onClick={() => move(i, i + 1)} />
              <IconButton icon="trash" label={copy.fields.removeItem} onClick={() => onChange(items.filter((_, j) => j !== i))} />
            </div>
            <div className="space-y-4">{render(item, (next) => onChange(items.map((current, j) => (j === i ? next : current))))}</div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" disabled={items.length >= max} onClick={() => onChange([...items, create()])}>
        <Icon name="plus" size={15} />
        {copy.fields.addItem}
      </Button>
    </div>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  pressed,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-35 ${
        tone === "danger" ? "text-text-muted hover:bg-status-danger-bg hover:text-status-danger-text" : "text-text-secondary hover:bg-surface-panel-subtle hover:text-text-primary"
      }`}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}
