import type { FormEvent } from "react";
import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";

interface ManualEntryProps {
  copy: ScannerCopy;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  placeholder: string;
  submitLabel: string;
  disabled: boolean;
  warning: string | null;
}

export function ManualEntry({ copy, value, onChange, onSubmit, placeholder, submitLabel, disabled, warning }: ManualEntryProps) {
  return (
    <form onSubmit={onSubmit} className="scanner-panel p-3.5 sm:p-4">
      <label htmlFor="scanner-manual-code" className="mb-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-ink-300">
        <span aria-hidden="true" className="scanner-index">{copy.sectionIndex(2)}</span>
        {copy.manualTitle}
        <span aria-hidden="true" className="h-px flex-1 bg-white/10" />
        <span className="text-ink-400">{copy.manualLabel}</span>
      </label>
      <div className="flex flex-col gap-2 min-[400px]:flex-row">
        <input
          id="scanner-manual-code"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          enterKeyHint="go"
          spellCheck={false}
          dir="ltr"
          className="scanner-input scanner-input--bidi min-w-0 flex-1 font-mono"
        />
        <button
          type="submit"
          disabled={!value.trim() || disabled}
          className="scanner-tool press inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-400/50 bg-aiteb-indigo px-5 text-[15px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_10px_24px_-12px_rgb(61_53_223/0.9)] hover:bg-brand-500 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.06] disabled:text-ink-400 disabled:shadow-none"
        >
          <Icon name="arrow-right" size={18} />
          {submitLabel}
        </button>
      </div>
      {warning ? (
        <p role="status" className="mt-2.5 flex items-start gap-2 rounded-lg border border-status-warning-solid/50 bg-status-warning-solid/10 p-2.5 text-[13px] leading-relaxed text-[#FFD08A]">
          <Icon name="alert" size={16} className="mt-0.5" />
          <span>{warning}</span>
        </p>
      ) : (
        <p className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-400">
          <Icon name="info" size={15} className="mt-0.5" />
          <span>{copy.manualHint}</span>
        </p>
      )}
    </form>
  );
}
