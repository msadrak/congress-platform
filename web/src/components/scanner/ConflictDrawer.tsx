import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { TranslationDictionary } from "../../lib/i18n";
import type { QueuedScan } from "../../lib/scannerStorage";
import { Icon } from "../ui/Icon";
import { rejectionLabel, type ScannerCopy } from "./copy";

interface ConflictDrawerProps {
  conflicts: QueuedScan[];
  copy: ScannerCopy;
  t: TranslationDictionary;
  onClose: () => void;
  onAcknowledge: (scanId: string) => void;
}

/** Server-reconciliation conflicts: audit records, never deleted here. */
export function ConflictDrawer({ conflicts, copy, t, onClose, onAcknowledge }: ConflictDrawerProps) {
  const headingId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Modal behaviour: focus starts on Close, Tab stays inside the sheet, Escape closes, focus returns on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !sheetRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !sheetRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink-950/80 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
    >
      <div ref={sheetRef} className="scanner-sheet flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden border border-white/12 bg-ink-900 pb-safe shadow-[0_-30px_80px_-30px_rgb(0_0_0/0.9)] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-5">
          <div>
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#FF8BA8]">
              <Icon name="alert" size={14} />
              <span className="font-mono tabular" dir="ltr">{conflicts.length}</span>
            </p>
            <h2 id={headingId} className="mt-0.5 text-[1.0625rem] font-semibold text-white">{t.conflictsHeading}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="scanner-tool inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-ink-200 hover:bg-white/10 hover:text-white"
          >
            <Icon name="x" size={16} />
            {copy.close}
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          <p className="mb-3 text-[13px] leading-relaxed text-ink-300">{copy.conflictsBody}</p>
          <ul className="space-y-2.5">
            {conflicts.map((c) => (
              <li key={c.scan_id} className="rounded-xl border border-status-danger-solid/40 bg-ink-950/60 p-3.5">
                <p className="text-[14px] font-semibold text-white">
                  {c.attendee_name ?? (
                    <span className="font-mono" dir="ltr">
                      {c.qr_secret.slice(0, 8)}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] text-[#FFB3C4]">
                  {rejectionLabel(t, copy, c.rejection_reason)}{" "}
                  <span className="font-mono text-[11.5px] text-ink-400" dir="ltr">
                    {c.rejection_reason ?? "SERVER_REJECTED"}
                  </span>
                </p>
                <p className="mt-1.5 font-mono tabular text-[11.5px] text-ink-400" dir="ltr">
                  {copy.scannedAt} {new Date(c.scanned_at).toLocaleString()}
                  {c.reconciled_at ? ` · ${copy.reconciledAt} ${new Date(c.reconciled_at).toLocaleString()}` : ""}
                </p>
                <div className="mt-2.5">
                  {!c.conflict_acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledge(c.scan_id)}
                      className="scanner-tool inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.05] px-3 text-[13px] font-semibold text-ink-100 hover:bg-white/10"
                    >
                      <Icon name="check" size={15} />
                      {copy.acknowledge}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-400">
                      <Icon name="check" size={14} />
                      {copy.acknowledged}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
