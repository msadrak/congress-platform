import type { ScannerCopy } from "../../copy/scanner";
import type { ScanDirection } from "../../lib/scannerEngine";
import { Icon } from "../ui/Icon";

/**
 * Entry / exit switch for a point that tracks occupancy. The mode is unmistakable: the active half is filled
 * (green for entry, amber for exit) and exit mode adds a line, so an operator never records exits by accident.
 */
export function DirectionToggle({
  copy,
  direction,
  onChange,
  disabled,
  inside,
}: {
  copy: ScannerCopy;
  direction: ScanDirection;
  onChange: (direction: ScanDirection) => void;
  disabled?: boolean;
  /** People inside now, as this device knows it. */
  inside: string;
}) {
  const option = (value: ScanDirection, label: string, active: string) => (
    <button
      type="button"
      aria-pressed={direction === value}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`inline-flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-control px-4 text-body font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 ${
        direction === value ? active : "text-ink-200 hover:bg-white/8 hover:text-white"
      }`}
    >
      <Icon name={value === "IN" ? "login" : "logout"} size={18} />
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div role="group" aria-label={copy.directionLabel} className="flex flex-1 gap-1 rounded-control border border-white/15 bg-white/5 p-1">
          {option("IN", copy.entryMode, "scanner-dir--in")}
          {option("OUT", copy.exitMode, "scanner-dir--out")}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-body-sm text-ink-200" data-testid="scanner-occupancy">
          <Icon name="users" size={16} />
          {inside}
        </span>
      </div>
      {direction === "OUT" && (
        <p role="status" className="flex items-center gap-2 text-body-sm font-semibold text-status-warning-bg">
          <Icon name="logout" size={16} />
          {copy.exitModeBanner}
        </p>
      )}
    </div>
  );
}
