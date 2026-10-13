import { useId } from "react";

interface ArcStrokeProps {
  className?: string;
  /** `up` bows upwards (under a label), `down` bows downwards (over an icon). */
  bow?: "up" | "down";
}

/**
 * A short brand-gradient arc: the active-destination marker of the Attendee Portal navigation.
 * It stretches to its box while keeping a constant stroke weight.
 */
export function ArcStroke({ className = "", bow = "up" }: ArcStrokeProps) {
  const uid = useId().replace(/:/g, "");
  const d = bow === "up" ? "M2 10 Q24 0 46 10" : "M2 2 Q24 12 46 2";
  return (
    <svg viewBox="0 0 48 12" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false" className={className}>
      <defs>
        <linearGradient id={`at-arc-${uid}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF97FF" />
          <stop offset="1" stopColor="#5B3FF5" />
        </linearGradient>
      </defs>
      <path d={d} stroke={`url(#at-arc-${uid})`} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
