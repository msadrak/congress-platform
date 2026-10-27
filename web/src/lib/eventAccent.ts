import type { CSSProperties } from "react";

/**
 * Per-congress accent identity from a small AIteb-derived set. Each accent is text-safe on white, so an
 * organizer's choice (Page Studio) can never break contrast; without a choice, the slug picks one.
 */
export interface EventAccent {
  /** "custom": the organizer's own colour (Page Studio), already darkened to be legible on white. */
  name: "indigo" | "magenta" | "azure" | "violet" | "orchid" | "custom";
  /** Text-safe on white (WCAG AA for normal text). */
  accent: string;
  /** Tinted surface behind accent text. */
  soft: string;
  /** Luminous companion used on dark surfaces and in artwork. */
  glow: string;
}

const ACCENTS: readonly EventAccent[] = [
  { name: "indigo", accent: "#2000CD", soft: "#F2F0FE", glow: "#8770FF" },
  { name: "magenta", accent: "#B8017A", soft: "#FDEEF7", glow: "#FF97FF" },
  { name: "azure", accent: "#2236D4", soft: "#EEF1FF", glow: "#7F8CFF" },
  { name: "violet", accent: "#5122D6", soft: "#F1ECFF", glow: "#B1A4FF" },
  { name: "orchid", accent: "#8E1BA8", soft: "#FAEEFD", glow: "#FF97FF" },
];

export function hashSeed(seed: string): number {
  // FNV-1a, stable across sessions and browsers.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) for generative artwork. */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A curated accent by name, "auto" (picked by the slug), or a custom `#RRGGBB`. */
export type AccentSpec = Exclude<EventAccent["name"], "custom"> | "auto" | `#${string}`;

const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** `hex` moved towards `other` by `amount` (0 … 1). */
function mix(hex: string, other: [number, number, number], amount: number): string {
  const from = rgb(hex);
  return toHex(from.map((c, i) => c + (other[i] - c) * amount) as [number, number, number]);
}

/** WCAG contrast ratio of `#RRGGBB` against white (mirrors `backend/app/page_document.py`). */
export function contrastOnWhite(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/** Accent text needs AA for normal text on white and on its own light tint. */
export const MIN_ACCENT_CONTRAST = 4.5;

/**
 * The organizer's colour, darkened just enough to be legible on white (unchanged when it already is), so a
 * light brand colour such as yellow still works as link and heading colour. Null for anything but `#RRGGBB`.
 */
export function legibleAccent(hex: string): string | null {
  if (!HEX.test(hex)) return null;
  // A hair above the minimum: the server recomputes with the same formula and must never disagree.
  const target = MIN_ACCENT_CONTRAST + 0.05;
  if (contrastOnWhite(hex) >= target) return hex.toUpperCase();
  for (let step = 1; step <= 100; step++) {
    const darker = mix(hex, [0, 0, 0], step / 100);
    if (contrastOnWhite(darker) >= target) return darker;
  }
  return "#000000";
}

function customAccent(hex: string): EventAccent {
  const accent = legibleAccent(hex) ?? ACCENTS[0].accent;
  return { name: "custom", accent, soft: mix(accent, [255, 255, 255], 0.92), glow: mix(accent, [255, 255, 255], 0.45) };
}

export function eventAccent(seed: string | undefined, choice?: AccentSpec | null): EventAccent {
  if (choice?.startsWith("#")) return customAccent(choice);
  if (choice && choice !== "auto") return ACCENTS.find((a) => a.name === choice) ?? ACCENTS[0];
  if (!seed) return ACCENTS[0];
  return ACCENTS[hashSeed(seed) % ACCENTS.length];
}

/** The selectable accents, in display order. */
export const EVENT_ACCENTS: readonly EventAccent[] = ACCENTS;

/**
 * CSS variables consumed by `text-event-accent`, `bg-event-accent-soft`, etc. The Tailwind colour tokens are set
 * too: `@theme` declares `--color-event-accent: var(--event-accent)` on the root, where it is resolved once, so
 * overriding only `--event-accent` on a wrapper would never reach the utilities.
 */
export function eventAccentStyle(seed: string | undefined, choice?: AccentSpec | null): CSSProperties {
  const a = eventAccent(seed, choice);
  return {
    "--event-accent": a.accent,
    "--event-accent-soft": a.soft,
    "--event-accent-glow": a.glow,
    "--color-event-accent": a.accent,
    "--color-event-accent-soft": a.soft,
  } as CSSProperties;
}
