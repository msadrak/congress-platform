import React from "react";
import { latinDigits, localeDigits } from "../../lib/format";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { useUiCopy } from "./uiCopy";

/**
 * Text controls. One look (`.ui-input` / `.ui-select` / `.ui-textarea` in index.css): 48 px, radius 12,
 * a 3:1 border, a 2 px focus outline, a danger border when `aria-invalid`. Wrap them in `Field` for the
 * label, hint and error wiring. `size="lg"` (56 px, 18 px text) is for the desk command bar;
 * `tone="ink"` is for dark ink surfaces (inside `.surface-ink`).
 */
interface ControlLook {
  size?: "md" | "lg";
  tone?: "default" | "ink";
}

function lookClass({ size = "md", tone = "default" }: ControlLook): string {
  const sizeClass = size === "lg" ? "h-(--control-lg) text-title-sm" : "";
  const toneClass = tone === "ink" ? "bg-white/6 text-white placeholder:text-white/55" : "";
  return `${sizeClass} ${toneClass}`.trim();
}

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">, ControlLook {}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size, tone, className = "", type = "text", ...props },
  ref
) {
  return <input ref={ref} type={type} className={`ui-input ${lookClass({ size, tone })} ${className}`.trim()} {...props} />;
});

export interface NumberInputProps extends Omit<TextInputProps, "type" | "value" | "onChange" | "inputMode"> {
  value: number | undefined;
  /** The whole number typed, or undefined when the field is empty. */
  onValueChange: (value: number | undefined) => void;
  locale: "fa" | "en";
}

/**
 * A whole-number field (capacity, quota): shows Persian digits in the Persian interface and accepts Persian,
 * Arabic-Indic and Latin digits alike. A text input with the numeric keypad, since `type="number"` shows
 * Latin digits and rejects Persian ones.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onValueChange, locale, className = "", ...props },
  ref
) {
  return (
    <TextInput
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      className={`tabular ${className}`.trim()}
      value={value === undefined ? "" : localeDigits(String(value), locale)}
      onChange={(event) => {
        const digits = latinDigits(event.target.value).replace(/\D/g, "");
        onValueChange(digits ? Number.parseInt(digits, 10) : undefined);
      }}
      {...props}
    />
  );
});

/**
 * For machine codes only (keys, pairing codes, booth codes, verification codes): left-to-right, monospace,
 * no autocorrect. The placeholder stays in the sans font so a Persian hint never renders in mono.
 */
export const CodeInput = React.forwardRef<HTMLInputElement, TextInputProps>(function CodeInput(
  { size, tone, className = "", type = "text", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      dir="ltr"
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      className={`ui-input font-mono placeholder:font-sans placeholder-shown:[direction:inherit] ${lookClass({ size, tone })} ${className}`.trim()}
      {...props}
    />
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: "default" | "ink";
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ tone, className = "", ...props }, ref) {
  return <textarea ref={ref} className={`ui-textarea ${lookClass({ tone })} ${className}`.trim()} {...props} />;
});

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">, ControlLook {
  /** Classes for the positioning wrapper (width, margins); `className` styles the select itself. */
  wrapperClassName?: string;
}

/**
 * Native select with the chevron drawn at the logical end. A `dir` given to the select also applies to the
 * wrapper, so an LTR select inside a Persian page keeps its chevron on the side its padding reserves.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size, tone, className = "", wrapperClassName = "", dir, children, ...props },
  ref
) {
  return (
    <div dir={dir} className={`relative ${wrapperClassName}`.trim()}>
      <select ref={ref} dir={dir} className={`ui-select bg-none pe-10 ${lookClass({ size, tone })} ${className}`.trim()} {...props}>
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={18}
        className={`pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 ${tone === "ink" ? "text-white/70" : "text-text-muted"}`}
      />
    </div>
  );
});

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type">, ControlLook {
  /** Shows a clear button while the field has a value. */
  onClear?: () => void;
  /** Accessible name of the clear button; defaults to «پاک کردن جستجو» / "Clear search". */
  clearLabel?: string;
  wrapperClassName?: string;
}

/** Search field: search icon at the start, a clear button at the end, the "search" key on phone keyboards. */
export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { size, tone, className = "", wrapperClassName = "", onClear, clearLabel, value, ...props },
  ref
) {
  const { ref: wrapperRef, copy } = useUiCopy<HTMLDivElement>();
  const showClear = Boolean(onClear) && value !== undefined && String(value).length > 0;
  return (
    <div ref={wrapperRef} className={`relative ${wrapperClassName}`.trim()}>
      <Icon
        name="search"
        size={size === "lg" ? 22 : 18}
        className={`pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 ${tone === "ink" ? "text-white/70" : "text-text-muted"}`}
      />
      <input
        ref={ref}
        type="search"
        enterKeyHint="search"
        value={value}
        className={`ui-input ${size === "lg" ? "ps-12" : "ps-10"} ${showClear ? "pe-12" : ""} [&::-webkit-search-cancel-button]:appearance-none ${lookClass({ size, tone })} ${className}`.trim()}
        {...props}
      />
      {showClear && (
        <IconButton
          icon="x"
          size="sm"
          tone={tone}
          label={clearLabel ?? copy.clearSearch}
          onClick={onClear}
          className="absolute end-1 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  );
});
