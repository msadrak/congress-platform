import type { CSSProperties } from "react";

/**
 * Per-congress accent identity. Congresses carry no imagery or colours in the API, so each one gets
 * a stable accent from a small AIteb-derived set, chosen deterministically from its slug.
 */
export interface EventAccent {
  name: "indigo" | "magenta" | "azure" | "violet" | "orchid";
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

export function eventAccent(seed: string | undefined): EventAccent {
  if (!seed) return ACCENTS[0];
  return ACCENTS[hashSeed(seed) % ACCENTS.length];
}

/** CSS variables consumed by `text-event-accent`, `bg-event-accent-soft`, etc. */
export function eventAccentStyle(seed: string | undefined): CSSProperties {
  const a = eventAccent(seed);
  return {
    "--event-accent": a.accent,
    "--event-accent-soft": a.soft,
    "--event-accent-glow": a.glow,
  } as CSSProperties;
}
