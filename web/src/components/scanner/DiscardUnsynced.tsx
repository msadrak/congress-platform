import { useState } from "react";
import type { ScannerCopy } from "../../copy/scanner";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

interface DiscardUnsyncedProps {
  copy: ScannerCopy;
  pendingCount: number;
  /** Deletes the unsent scans and resolves with how many were removed. */
  onDiscard: () => Promise<number>;
}

/**
 * Unsent scans left on a device that can no longer upload them (blocked, unpaired). They are the only copy, so they
 * stay until an operator explicitly deletes them, behind a confirmation.
 */
export function DiscardUnsynced({ copy, pendingCount, onDiscard }: DiscardUnsyncedProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarded, setDiscarded] = useState<number | null>(null);

  if (pendingCount === 0) {
    return discarded !== null ? <p role="status">{copy.discardDone(discarded)}</p> : null;
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
    <section className="space-y-2 rounded-control border border-status-warning-solid/50 p-3" data-testid="scanner-unsent">
      <p className="font-semibold text-status-warning-bg">{copy.discardTitle(pendingCount)}</p>
      <p className="text-ink-200">{copy.discardBody}</p>
      <Button type="button" variant="ghost" tone="ink" size="sm" icon="trash" onClick={() => setConfirming(true)}>
        {copy.discardAction}
      </Button>
      <ConfirmDialog
        isOpen={confirming}
        title={copy.discardConfirm(pendingCount)}
        description={copy.discardBody}
        confirmLabel={copy.discardConfirmAction}
        tone="danger"
        busy={busy}
        onConfirm={() => void discard()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
