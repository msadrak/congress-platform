import type { ScannerCopy } from "../../copy/scanner";
import { formatDate } from "../../lib/format";
import type { QueuedScan } from "../../lib/scannerStorage";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { rejectionLabel } from "./copy";

interface ConflictDrawerProps {
  isOpen: boolean;
  conflicts: QueuedScan[];
  copy: ScannerCopy;
  locale: "fa" | "en";
  timeZone?: string | null;
  onClose: () => void;
  onAcknowledge: (scanId: string) => void;
}

/** Scans the server overruled after reconnecting: audit records, never deleted here, only marked reviewed. */
export function ConflictDrawer({ isOpen, conflicts, copy, locale, timeZone, onClose, onAcknowledge }: ConflictDrawerProps) {
  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={copy.conflictsTitle} description={copy.conflictsBody} tone="ink">
      <ul className="space-y-2.5">
        {conflicts.map((c) => (
          <li key={c.scan_id} className="space-y-1 rounded-control border border-status-danger-solid/50 p-3">
            <p className="text-body font-semibold">{c.attendee_name ? <bdi>{c.attendee_name}</bdi> : copy.noName}</p>
            {rejectionLabel(copy, c.rejection_reason) && <p className="text-body-sm text-status-danger-bg">{rejectionLabel(copy, c.rejection_reason)}</p>}
            <p className="text-caption text-ink-200">{copy.scannedAt(formatDate(c.scanned_at, "dayTime", locale, timeZone))}</p>
            {!c.conflict_acknowledged ? (
              <Button type="button" variant="secondary" tone="ink" size="sm" icon="check" onClick={() => onAcknowledge(c.scan_id)}>
                {copy.acknowledge}
              </Button>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-body-sm text-ink-200">
                <Icon name="check" size={14} />
                {copy.acknowledged}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
