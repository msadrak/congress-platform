import type { TranslationDictionary } from "../../lib/i18n";
import type { QueuedScan } from "../../lib/scannerStorage";
import { Icon } from "../ui/Icon";
import { BiLabel } from "./ScannerChrome";
import { clockTime, rejectionLabel, type ScannerCopy } from "./copy";

type Locale = "fa" | "en";

interface BufferBarProps {
  locale: Locale;
  copy: ScannerCopy;
  pendingCount: number;
  isSyncing: boolean;
  onSync: () => void;
  onRefresh: () => void;
}

/** Offline buffer readout + the two manual sync controls. */
export function BufferBar({ locale, copy, pendingCount, isSyncing, onSync, onRefresh }: BufferBarProps) {
  return (
    <div className="scanner-panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3.5 sm:p-4">
      <p className="text-[13.5px] text-ink-300">
        <span>{copy.bufferLead}</span>{" "}
        <strong className={`font-mono tabular text-[1.25rem] font-semibold ${pendingCount > 0 ? "text-[#FFC266]" : "text-white"}`}>
          {pendingCount}
        </strong>{" "}
        <span>{copy.bufferTail}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={isSyncing || pendingCount === 0}
          onClick={onSync}
          className="scanner-tool inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-white/12 bg-white/[0.04] px-3 text-[13px] font-semibold text-ink-100 hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Icon name="arrow-up-right" size={16} />
          {isSyncing ? copy.syncingNow : <BiLabel locale={locale} label={copy.syncNow} />}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="scanner-tool inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-white/12 bg-white/[0.04] px-3 text-[13px] font-semibold text-ink-100 hover:bg-white/[0.09]"
        >
          <Icon name="sync" size={16} />
          <BiLabel locale={locale} label={copy.refreshCache} />
        </button>
      </div>
    </div>
  );
}

/** Precise audit log of the last scans at this gate. */
export function ScanLog({ scans, copy, t }: { scans: QueuedScan[]; copy: ScannerCopy; t: TranslationDictionary }) {
  return (
    <section className="scanner-panel overflow-hidden" aria-labelledby="scanner-log-title">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <h2 id="scanner-log-title" className="flex items-center gap-2 text-[13px] font-semibold text-ink-200">
          <span aria-hidden="true" className="scanner-index">03</span>
          {copy.logTitle}
        </h2>
      </div>
      {scans.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-400">{copy.logEmpty}</p>
      ) : (
        <ol className="max-h-[23rem] divide-y divide-white/[0.07] overflow-y-auto">
          {scans.map((s) => {
            const admitted = s.status === "ADMITTED";
            const conflict = s.sync_state === "CONFLICT";
            return (
              <li key={s.scan_id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-2.5">
                <span className="pt-0.5 font-mono tabular text-[12.5px] text-ink-300" dir="ltr">
                  {clockTime(s.scanned_at)}
                </span>
                <div className="min-w-0">
                  {s.attendee_name ? (
                    <p className="truncate text-[14px] font-medium text-white">{s.attendee_name}</p>
                  ) : (
                    <p className="truncate font-mono text-[12.5px] text-ink-300" dir="ltr">
                      {s.qr_secret.slice(0, 8)}…
                    </p>
                  )}
                  <p className="mt-0.5 flex items-center gap-1 text-[12.5px] font-semibold leading-snug">
                    <span className={`inline-flex items-center gap-1 ${admitted ? "text-[#5BE3AE]" : "text-[#FF8BA8]"}`}>
                      <Icon name={admitted ? "check" : "x"} size={13} strokeWidth={2.4} />
                      {admitted ? copy.admitted : copy.rejected}
                    </span>
                  </p>
                  {s.rejection_reason && (
                    <p className="mt-0.5 text-[12px] leading-snug text-ink-300">
                      {rejectionLabel(t, s.rejection_reason) ?? (
                        <span className="font-mono text-[11px]" dir="ltr">
                          {s.rejection_reason}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <span
                  className={`mt-0.5 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
                    conflict
                      ? "border-status-danger-solid/50 text-[#FF8BA8]"
                      : s.sync_state === "PROVISIONAL"
                        ? "border-status-warning-solid/50 text-[#FFC266]"
                        : "border-white/12 text-ink-300"
                  }`}
                >
                  {s.sync_state === "PROVISIONAL" && <Icon name="clock" size={11} />}
                  {s.sync_state === "CONFIRMED" && <Icon name="check" size={11} />}
                  {copy.sync[s.sync_state] ?? s.sync_state}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
