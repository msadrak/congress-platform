import { useState } from "react";
import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";
import { BiLabel } from "./ScannerChrome";

type Locale = "fa" | "en";

interface DiscardUnsyncedProps {
  locale: Locale;
  copy: ScannerCopy;
  pendingCount: number;
  /** Deletes the unsynced scans and resolves with how many were removed. */
  onDiscard: () => Promise<number>;
}

/**
 * Unsynced scans left on a device that can no longer upload them (blocked, unpaired). They are the only
 * copy, so they are kept until an operator explicitly discards them, behind a second confirmation.
 */
export function DiscardUnsynced({ locale, copy, pendingCount, onDiscard }: DiscardUnsyncedProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarded, setDiscarded] = useState<number | null>(null);

  if (pendingCount === 0) {
    return discarded !== null ? (
      <p role="status" className="text-[13px] leading-relaxed text-ink-300">
        {copy.discardDone(discarded)}
      </p>
    ) : null;
  }

  const discard = async () => {
    setBusy(true);
    try {
      setDiscarded(await onDiscard());
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <section aria-labelledby="scanner-discard-title" className="space-y-2.5 border-t border-white/10 pt-4">
      <h2 id="scanner-discard-title" className="flex items-center gap-2 text-[13px] font-semibold text-[#FFD08A]">
        <Icon name="layers" size={16} />
        {copy.discardTitle(pendingCount)}
      </h2>
      <p className="text-[13px] leading-relaxed text-ink-300">{copy.discardBody}</p>
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="scanner-tool inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-status-danger-solid/50 bg-transparent px-4 text-[13.5px] font-semibold text-[#FF8BA8] hover:bg-status-danger-solid/10"
        >
          <Icon name="x" size={16} />
          <BiLabel locale={locale} label={copy.discardAction} />
        </button>
      ) : (
        <div className="space-y-2.5 rounded-xl border border-status-danger-solid/60 bg-status-danger-solid/10 p-3">
          <p className="text-[13px] font-medium leading-relaxed text-[#FFC9D5]">{copy.discardConfirm(pendingCount)}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={discard}
              className="scanner-tool inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-status-danger-solid px-3 text-[13.5px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              <BiLabel locale={locale} label={copy.discardConfirmAction} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="scanner-tool inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-white/12 bg-white/[0.05] px-3 text-[13.5px] font-semibold text-ink-100 hover:bg-white/10 disabled:opacity-50"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
