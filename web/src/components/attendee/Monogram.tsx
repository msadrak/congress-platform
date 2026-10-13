import type { CSSProperties } from "react";
import { eventAccent } from "../../lib/eventAccent";

const HONORIFICS: Record<string, true> = { "دکتر": true, "مهندس": true, "استاد": true, "پروفسور": true };

/** Up to two initials, skipping honorifics such as "Dr." / "دکتر". Persian initials are kept unjoined. */
function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => w && !w.endsWith(".") && !Object.hasOwn(HONORIFICS, w));
  const source = words.length > 0 ? words : name.trim().split(/\s+/).filter(Boolean);
  const letters = source.slice(0, 2).map((w) => Array.from(w)[0]?.toLocaleUpperCase() ?? "");
  if (letters.length === 0 || !letters[0]) return "?";
  // ZWNJ stops two Arabic-script letters from joining into a ligature.
  return letters.join(/[\u0600-\u06FF]/.test(letters.join("")) ? "\u200C" : "");
}

interface MonogramProps {
  name: string;
  /** Stable seed for the tint (e.g. a user or connection id); defaults to the name. */
  seed?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZES = {
  sm: "size-10 text-sm",
  md: "size-12 text-base",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
} as const;

/** Initials disc with a crossing-arcs ring, tinted from a stable seed. Decorative. */
export function Monogram({ name, seed, size = "md", className = "" }: MonogramProps) {
  const accent = eventAccent(seed ?? name);
  const style = { "--mono-accent": accent.accent, "--mono-soft": accent.soft, "--mono-glow": accent.glow } as CSSProperties;
  return (
    <span aria-hidden="true" style={style} className={`at-monogram ${SIZES[size]} ${className}`.trim()}>
      <span className="at-monogram-face">{initialsOf(name)}</span>
    </span>
  );
}
