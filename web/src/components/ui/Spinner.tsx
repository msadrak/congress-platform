export type SpinnerSize = 16 | 24 | 40;

/**
 * Indeterminate spinner. Always decorative (`aria-hidden`): the caller shows or announces the status text.
 * Under reduced motion it turns slowly instead of stopping, so the state still reads as "working".
 */
export function Spinner({ size = 24, className = "" }: { size?: SpinnerSize; className?: string }) {
  const stroke = size === 40 ? 3.5 : size === 24 ? 2.5 : 2;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`shrink-0 animate-spin motion-reduce:[animation-duration:2.4s] ${className}`.trim()}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${circumference * 0.3} ${circumference}`}
      />
    </svg>
  );
}
