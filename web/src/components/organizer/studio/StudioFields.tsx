import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { focusPosition } from "../../../lib/heroImage";
import { applyFormat, type FormatAction } from "../../../lib/markdownEdit";
import { HIGHLIGHT_ICONS, type HighlightIcon, type LocalizedText, type PageImage, type PageLocale, type VideoProvider } from "../../../lib/pageDocument";
import { normalizeLink, parseVideoUrl, videoPageUrl } from "../../../lib/pageLinks";
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
  markdown = false,
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
  /** Prose with Markdown-lite: a formatting toolbar above the text area (and Ctrl/Cmd+B, I). */
  markdown?: boolean;
}) {
  const { copy, lang } = useStudio();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const format = (action: FormatAction) => {
    const el = area.current;
    if (!el) return;
    const next = applyFormat({ value: el.value, start: el.selectionStart, end: el.selectionEnd }, action, copy.toolbar.linkPlaceholder);
    if (next.value.length > maxLength) return;
    onChange({ ...value, [lang]: next.value });
    // After React has written the new value: put the caret (or selection) where the action leaves it.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  };
  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const action = ({ b: "bold", i: "italic", k: "link" } as const)[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    format(action);
  };
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
              className={`rounded px-1.5 py-0.5 font-mono text-caption font-semibold uppercase ${
                value[l].trim() ? "bg-aiteb-lavender text-aiteb-indigo" : "bg-surface-panel-subtle text-text-muted line-through decoration-text-muted/60"
              }`}
            >
              {l}
            </span>
          ))}
        </span>
      </div>
      {markdown && multiline && <FormatToolbar controls={id} onAction={format} />}
      {multiline ? <textarea ref={area} rows={rows} onKeyDown={markdown ? shortcut : undefined} {...common} /> : <input type="text" {...common} />}
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
  aspect?: "wide" | "square" | "portrait" | "logo";
}) {
  const { copy, images, pickImage } = useStudio();
  const image = value ? images[value] : undefined;
  const frame =
    aspect === "logo" ? "h-20" : aspect === "square" ? "aspect-square w-28" : aspect === "portrait" ? "aspect-[4/5] w-24" : "aspect-[16/9]";
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
            <span className="font-mono text-caption text-text-muted tabular" dir="ltr">
              {image.width}×{image.height}
            </span>
          )}
        </div>
      </div>
      {hint && <p className="text-xs leading-relaxed text-text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Where a cropped image is anchored: click or drag on the whole image (keyboard: the two sliders), with
 * live crops at a wide-screen and a phone proportion. Values are percentages (CSS object-position).
 */
export function FocalPointField({
  label,
  hint,
  image,
  x,
  y,
  onChange,
  phone = true,
}: {
  label: string;
  hint?: ReactNode;
  image: PageImage;
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  /** Show the phone crop (false when phones get an image of their own). */
  phone?: boolean;
}) {
  const { copy } = useStudio();
  const b = copy.brand;
  const id = useId();
  const position = focusPosition(x, y);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const percent = (offset: number, size: number) => Math.min(100, Math.max(0, Math.round((offset / size) * 100)));
    onChange(percent(event.clientX - box.left, box.width), percent(event.clientY - box.top, box.height));
  };
  const slider = (axis: "x" | "y") => (
    <label className="flex items-center gap-3 text-xs font-medium text-text-secondary">
      <span className="w-16 shrink-0">{axis === "x" ? b.focalX : b.focalY}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={axis === "x" ? x : y}
        onChange={(e) => (axis === "x" ? onChange(Number(e.target.value), y) : onChange(x, Number(e.target.value)))}
        className="min-w-0 flex-1 accent-aiteb-indigo"
        aria-describedby={`${id}-hint`}
      />
      <output className="w-10 shrink-0 text-end font-mono tabular" dir="ltr">
        {axis === "x" ? x : y}%
      </output>
    </label>
  );
  return (
    <fieldset className="space-y-3">
      <legend className="ui-label">{label}</legend>
      {image.url ? (
        <div
          aria-hidden="true"
          data-testid="focal-picker"
          className="relative mx-auto w-full max-w-[20rem] cursor-crosshair touch-none overflow-hidden rounded-xl border border-border-default"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e);
          }}
        >
          <img src={image.url} alt="" draggable={false} width={image.width} height={image.height} className="block h-auto w-full select-none" />
          <span
            className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgb(0_0_0/0.45),0_4px_12px_rgb(0_0_0/0.35)]"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="absolute inset-[9px] rounded-full bg-white" />
          </span>
        </div>
      ) : (
        <span className="block aspect-[16/9] w-full max-w-[20rem] animate-pulse rounded-xl bg-surface-panel-subtle" />
      )}
      <div className="space-y-1.5">
        {slider("x")}
        {slider("y")}
      </div>
      {image.url && (
        <div className="flex items-end gap-3">
          <figure className="w-44 min-w-0 space-y-1">
            <img src={image.url} alt="" className="aspect-[16/10] w-full rounded-lg object-cover ring-1 ring-border-default" style={{ objectPosition: position }} />
            <figcaption className="text-caption text-text-muted">{b.previewWide}</figcaption>
          </figure>
          {phone && (
            <figure className="w-12 shrink-0 space-y-1">
              <img src={image.url} alt="" className="aspect-[9/19] w-full rounded-lg object-cover ring-1 ring-border-default" style={{ objectPosition: position }} />
              <figcaption className="text-caption text-text-muted">{b.previewPhone}</figcaption>
            </figure>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
        <Button type="button" variant="ghost" size="sm" disabled={x === 50 && y === 50} onClick={() => onChange(50, 50)}>
          {b.focalReset}
        </Button>
      </div>
    </fieldset>
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
  // Stable row keys, so a moved item keeps its DOM node (and the focused reorder button) instead of
  // the slot it left. Items keep their key by identity (moves, removals), else by position (edits).
  // Recomputed during render from the previous render's state (React's "adjust state on prop change").
  const [slots, setSlots] = useState<{ items: readonly T[]; keys: string[]; next: number }>(() => ({
    items,
    keys: items.map((_, i) => `item-${i + 1}`),
    next: items.length,
  }));
  let current = slots;
  if (slots.items !== items) {
    const used = new Set<number>();
    const byIdentity = items.map((item) => {
      const j = slots.items.findIndex((p, idx) => p === item && !used.has(idx));
      if (j < 0) return null;
      used.add(j);
      return slots.keys[j];
    });
    const reused = byIdentity.map((key, i) => {
      if (key !== null) return key;
      if (i < slots.items.length && !used.has(i)) {
        used.add(i);
        return slots.keys[i];
      }
      return null;
    });
    const fresh = reused.flatMap((key, i) => (key === null ? [i] : []));
    const keys = reused.map((key, i) => key ?? `item-${slots.next + fresh.indexOf(i) + 1}`);
    current = { items, keys, next: slots.next + fresh.length };
    setSlots(current);
  }
  const keys = current.keys;
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
          <li key={keys[i]} className="rounded-2xl border border-border-default bg-surface-panel p-4 shadow-soft">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-caption font-semibold text-aiteb-indigo tabular">{String(i + 1).padStart(2, "0")}</span>
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
      {items.length >= max && <p className="text-xs text-text-muted">{copy.fields.itemLimit}</p>}
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

const TOOLBAR: ReadonlyArray<{ action: FormatAction; icon: IconName } | "gap"> = [
  { action: "bold", icon: "bold" },
  { action: "italic", icon: "italic" },
  { action: "highlight", icon: "highlight" },
  "gap",
  { action: "heading", icon: "heading" },
  { action: "subheading", icon: "type" },
  { action: "bullets", icon: "list" },
  { action: "numbered", icon: "list-ordered" },
  { action: "quote", icon: "quote" },
  "gap",
  { action: "link", icon: "link" },
  { action: "divider", icon: "minus" },
];

/** Buttons that write the Markdown-lite syntax for the organizer (they never have to learn it). */
function FormatToolbar({ controls, onAction }: { controls: string; onAction: (action: FormatAction) => void }) {
  const { copy } = useStudio();
  return (
    <div role="toolbar" aria-label={copy.toolbar.label} aria-controls={controls} className="flex flex-wrap items-center gap-0.5 rounded-xl border border-border-default bg-surface-panel-subtle p-1">
      {TOOLBAR.map((item, i) =>
        item === "gap" ? (
          <span key={i} aria-hidden="true" className="mx-1 h-5 w-px bg-border-default" />
        ) : (
          <button
            key={item.action}
            type="button"
            title={copy.toolbar[item.action]}
            aria-label={copy.toolbar[item.action]}
            // Keep the text selection: a pressed button must not take focus from the text area first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAction(item.action)}
            className="grid size-8 cursor-pointer place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-panel hover:text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <Icon name={item.icon} size={16} />
          </button>
        ),
      )}
    </div>
  );
}

/**
 * A link a visitor can follow. Accepts what organizers naturally paste or type (`t.me/name`, an e-mail
 * address, a phone number in Persian digits) and stores the normalised address; until the text is a valid
 * link nothing is stored and the field says why, so a save never fails on it.
 */
export function LinkField({
  label,
  value,
  onChange,
  hint,
  placeholder = "https://",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: ReactNode;
  placeholder?: string;
}) {
  const { copy } = useStudio();
  const id = useId();
  const [draft, setDraft] = useState(value);
  // Follow outside changes (reload, another item) without overwriting what is being typed.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if ((normalizeLink(draft) ?? "") !== value) setDraft(value);
  }
  const invalid = draft.trim().length > 0 && normalizeLink(draft) === null;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="ui-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        placeholder={placeholder}
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-note`}
        className="ui-input text-start"
        onChange={(e) => {
          setDraft(e.target.value);
          const next = e.target.value.trim() ? normalizeLink(e.target.value) : "";
          onChange(next ?? "");
        }}
        onBlur={() => {
          const next = normalizeLink(draft);
          if (next) setDraft(next);
        }}
      />
      <p id={`${id}-note`} className={`text-xs leading-relaxed ${invalid ? "font-semibold text-status-danger-text" : "text-text-muted"}`}>
        {invalid ? copy.fields.urlInvalid : hint}
      </p>
    </div>
  );
}

/** A YouTube or Aparat address, reduced to provider + id as soon as it is recognisable. */
export function VideoUrlField({
  provider,
  videoId,
  onChange,
}: {
  provider: VideoProvider;
  videoId: string;
  onChange: (next: { provider: VideoProvider; video_id: string }) => void;
}) {
  const { copy } = useStudio();
  const f = copy.fields;
  const id = useId();
  const stored = videoId ? videoPageUrl(provider, videoId) : "";
  const [draft, setDraft] = useState(stored);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    const parsed = parseVideoUrl(draft);
    if ((parsed ? videoPageUrl(parsed.provider, parsed.id) : "") !== stored) setDraft(stored);
  }
  const parsed = parseVideoUrl(draft);
  const invalid = draft.trim().length > 0 && !parsed;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="ui-label">
        {f.videoUrl}
      </label>
      <input
        id={id}
        type="text"
        inputMode="url"
        dir="ltr"
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        placeholder="https://www.aparat.com/v/…"
        value={draft}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-note`}
        className="ui-input text-start"
        onChange={(e) => {
          setDraft(e.target.value);
          const next = parseVideoUrl(e.target.value);
          onChange(next ? { provider: next.provider, video_id: next.id } : { provider, video_id: "" });
        }}
      />
      <p id={`${id}-note`} className={`text-xs leading-relaxed ${invalid ? "font-semibold text-status-danger-text" : "text-text-muted"}`}>
        {invalid ? f.videoUrlInvalid : parsed ? f.videoFound(copy.videoProviders[parsed.provider]) : f.videoUrlHint}
        {!invalid && parsed?.provider === "youtube" && <> {f.videoIranNote}</>}
      </p>
    </div>
  );
}

/** The curated icon set as a radio grid; `allowNone` adds an empty choice first. */
export function IconPicker({
  value,
  onChange,
  allowNone = false,
}: {
  value: HighlightIcon | null;
  onChange: (next: HighlightIcon | null) => void;
  allowNone?: boolean;
}) {
  const { copy } = useStudio();
  const name = useId();
  const options: Array<HighlightIcon | null> = allowNone ? [null, ...HIGHLIGHT_ICONS] : [...HIGHLIGHT_ICONS];
  return (
    <fieldset>
      <legend className="ui-label">{copy.fields.icon}</legend>
      <div className="grid grid-cols-8 gap-1">
        {options.map((icon) => (
          <label
            key={icon ?? "none"}
            title={icon ?? copy.style.none}
            className={`grid aspect-square cursor-pointer place-items-center rounded-lg border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring ${
              value === icon ? "border-aiteb-indigo bg-aiteb-lavender text-aiteb-indigo" : "border-transparent text-text-secondary hover:bg-surface-panel-subtle"
            }`}
          >
            <input type="radio" name={name} className="sr-only" checked={value === icon} onChange={() => onChange(icon)} aria-label={icon ?? copy.style.none} />
            {icon ? <Icon name={icon as IconName} size={17} /> : <Icon name="x" size={15} className="opacity-50" />}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
