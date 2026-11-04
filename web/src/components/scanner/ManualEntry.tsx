import type { FormEvent } from "react";
import type { ScannerCopy } from "../../copy/scanner";
import { Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";

interface ManualEntryProps {
  copy: ScannerCopy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
  warning: string | null;
}

/** Typing a pass's QR content by hand: one button under the stage that opens the field. */
export function ManualEntry({ copy, open, onOpenChange, value, onChange, onSubmit, disabled, warning }: ManualEntryProps) {
  if (!open) {
    return (
      <Button type="button" variant="secondary" tone="ink" size="lg" icon="keyboard" isFullWidth onClick={() => onOpenChange(true)}>
        {copy.manualOpen}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor="scanner-manual-code" className="sr-only">
          {copy.manualLabel}
        </label>
        <input
          id="scanner-manual-code"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={copy.manualPlaceholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          inputMode="text"
          enterKeyHint="go"
          spellCheck={false}
          dir="ltr"
          className="scanner-input scanner-input--bidi min-w-0 flex-1 font-mono"
        />
        <Button type="submit" tone="ink" size="lg" disabled={!value.trim() || disabled}>
          {copy.manualSubmit}
        </Button>
        <IconButton icon="x" label={copy.manualClose} tone="ink" onClick={() => onOpenChange(false)} />
      </div>
      {warning && (
        <p role="status" className="flex items-start gap-2 text-body-sm text-status-warning-bg">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </p>
      )}
    </form>
  );
}
