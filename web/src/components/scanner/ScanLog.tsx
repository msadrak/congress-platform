import type { ScannerCopy } from "../../copy/scanner";
import type { QueuedScan } from "../../lib/scannerStorage";
import { Icon } from "../ui/Icon";
import { clockTime, rejectionLabel } from "./copy";

interface ScanLogProps {
  scans: QueuedScan[];
  copy: ScannerCopy;
  locale: "fa" | "en";
  /** The congress's time zone: times are read on its clock. */
  timeZone?: string | null;
}

/** The last scans at this point, newest first: time, person, outcome and whether the server has it. */
export function ScanLog({ scans, copy, locale, timeZone }: ScanLogProps) {
  if (scans.length === 0) return <p className="px-4 py-6 text-center text-body-sm text-ink-200">{copy.logEmpty}</p>;
  return (
    <ol className="divide-y divide-white/10">
      {scans.map((s) => {
        const admitted = s.status === "ADMITTED";
        const exit = s.direction === "OUT";
        const reason = s.rejection_reason ? rejectionLabel(copy, s.rejection_reason) : null;
        return (
          <li key={s.scan_id} className="flex items-start gap-3 px-4 py-2.5">
            <span className="shrink-0 pt-0.5 text-body-sm tabular-nums text-ink-200">{clockTime(s.scanned_at, locale, timeZone)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium">{s.attendee_name ? <bdi>{s.attendee_name}</bdi> : copy.noName}</p>
              <p className={`flex items-center gap-1 text-body-sm font-semibold ${admitted ? "text-status-success-bg" : "text-status-danger-bg"}`}>
                <Icon name={admitted ? (exit ? "logout" : "check") : "x"} size={14} strokeWidth={2.4} />
                {admitted ? (exit ? copy.exitRecorded : copy.admitted) : copy.rejected}
                {reason && <span className="truncate font-normal text-ink-200">· {reason}</span>}
              </p>
            </div>
            <span
              className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-caption font-semibold ${
                s.sync_state === "CONFLICT"
                  ? "border-status-danger-solid/60 text-status-danger-bg"
                  : s.sync_state === "PROVISIONAL"
                    ? "border-status-warning-solid/60 text-status-warning-bg"
                    : "border-white/15 text-ink-200"
              }`}
            >
              {s.sync_state === "PROVISIONAL" && <Icon name="upload" size={12} />}
              {s.sync_state === "CONFIRMED" && <Icon name="check" size={12} />}
              {copy.sync[s.sync_state]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
