/** Badge printing and admission at the reception desk: print state, refusal reasons, the badge's affiliation line. */
import { deskCopy } from "../copy/desk.ts";

export type BadgePrintState = "never" | "printed" | "stale";

/**
 * The congress clock the desk shows times on. The desk API does not send the congress's own zone yet
 * (`DeskMeOut` has none), and every congress so far runs on Tehran time.
 */
export const DESK_TIME_ZONE = "Asia/Tehran";

/** `never` printed, `printed` and still current, or `stale`: the registration or QR changed since the last print. */
export function badgePrintState(card: { print_count: number; needs_reprint: boolean }): BadgePrintState {
  if (card.print_count === 0) return "never";
  return card.needs_reprint ? "stale" : "printed";
}

/** Why the gate rules refused a desk admission, in the reader's language (the raw code when unknown). */
export function admitReasonText(reason: string | null | undefined, locale: "fa" | "en"): string {
  if (!reason) return "";
  const reasons: Record<string, string> = deskCopy[locale].admitReason;
  return reasons[reason] ?? reason;
}

/** A pass type the desk can issue now: open, with a seat left (the API refuses the others). */
export function tierAvailable(tier: { is_open: boolean; reserved_count: number; quota: number }): boolean {
  return tier.is_open && tier.reserved_count < tier.quota;
}

/** The badge's affiliation line: title and organization from the registration, whichever are set. */
export function badgeAffiliation(title: string, organization: string): string {
  return [title.trim(), organization.trim()].filter(Boolean).join(" · ");
}
