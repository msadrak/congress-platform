import type { ScanDirection } from "../../lib/scannerEngine";
import { Icon } from "../ui/Icon";
import type { ScannerCopy } from "./copy";

/**
 * Entry / Exit switch for a point that tracks occupancy. The mode is unmistakable: the active half is filled
 * (green for entry, amber for exit) and exit mode adds a banner, so an operator never records exits by accident.
 */
export function DirectionToggle({
  copy,
  direction,
  onChange,
  disabled,
}: {
  copy: ScannerCopy;
  direction: ScanDirection;
  onChange: (direction: ScanDirection) => void;
  disabled?: boolean;
}) {
  const option = (value: ScanDirection, label: string, active: string) => (
    <button
      type="button"
      aria-pressed={direction === value}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`scanner-tool inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition-colors disabled:opacity-50 ${
        direction === value ? active : "text-ink-300 hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <Icon name={value === "IN" ? "arrow-right" : "logout"} size={18} />
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <div role="group" aria-label={copy.directionLabel} className="flex gap-1 rounded-xl border border-white/12 bg-white/[0.03] p-1">
        {option("IN", copy.entryMode, "bg-[#0F7A55] text-white")}
        {option("OUT", copy.exitMode, "bg-[#B86E00] text-white")}
      </div>
      {direction === "OUT" && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-status-warning-solid/50 bg-[#2B1A02] px-3 py-2 text-[13.5px] font-semibold text-[#FFD08A]">
          <Icon name="logout" size={16} />
          {copy.exitModeBanner}
        </p>
      )}
    </div>
  );
}
