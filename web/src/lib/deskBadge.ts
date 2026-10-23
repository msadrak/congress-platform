/** Badge printing at the reception desk: what the print button says, from the attendee card's print record. */

export type BadgePrintState = "never" | "printed" | "stale";

/** `never` printed, `printed` and still current, or `stale`: the registration or QR changed since the last print. */
export function badgePrintState(card: { print_count: number; needs_reprint: boolean }): BadgePrintState {
  if (card.print_count === 0) return "never";
  return card.needs_reprint ? "stale" : "printed";
}

const ADMIT_REASONS: Record<string, { fa: string; en: string }> = {
  ALREADY_ADMITTED: { fa: "این بلیت در این نقطه پیش‌تر وارد شده است (یک‌بار مصرف).", en: "Already admitted at this point (single use)." },
  CAPACITY_REACHED: { fa: "ظرفیت این نقطه پر شده است.", en: "This point is at capacity." },
  TIER_NOT_ALLOWED: { fa: "نوع بلیت این شرکت‌کننده به این نقطه راه ندارد.", en: "This attendee's ticket tier is not allowed here." },
  TICKET_INACTIVE: { fa: "این بلیت فعال نیست.", en: "This ticket is not active." },
  INVALID_TICKET: { fa: "کد QR این بلیت معتبر نیست.", en: "This ticket's QR code is not valid." },
  EVENT_MISMATCH: { fa: "این بلیت برای همایش دیگری است.", en: "This ticket belongs to another congress." },
  SCAN_ID_CONFLICT: { fa: "این ثبت با ورود دیگری تداخل دارد؛ دوباره تلاش کنید.", en: "This admission clashed with another one; try again." },
};

/** Why the gate rules refused a desk admission, in the reader's language (the raw code when unknown). */
export function admitReasonText(reason: string | null | undefined, locale: "fa" | "en"): string {
  if (!reason) return "";
  return ADMIT_REASONS[reason]?.[locale] ?? reason;
}

/** The badge's affiliation line: title and organization from the registration, whichever are set. */
export function badgeAffiliation(title: string, organization: string): string {
  return [title.trim(), organization.trim()].filter(Boolean).join(" · ");
}
