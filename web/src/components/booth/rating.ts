import type { IconName } from "../ui/Icon";

export type LeadRating = "HOT" | "WARM" | "COLD";

export const LEAD_RATINGS: readonly LeadRating[] = ["HOT", "WARM", "COLD"];

interface RatingMeta {
  icon: IconName;
  /** Portal CSS class that sets the `--rating-*` colour variables (styles/exhibitor.css). */
  tone: string;
  label: { en: string; fa: string };
  hint: { en: string; fa: string };
}

export const RATING_META: Record<LeadRating, RatingMeta> = {
  HOT: {
    icon: "flame",
    tone: "lead-rating-hot",
    label: { en: "Hot", fa: "علاقه زیاد" },
    hint: { en: "Immediate opportunity", fa: "فرصت فوری" },
  },
  WARM: {
    icon: "sun",
    tone: "lead-rating-warm",
    label: { en: "Warm", fa: "علاقه متوسط" },
    hint: { en: "Qualified prospect", fa: "مشتری بالقوه" },
  },
  COLD: {
    icon: "snow",
    tone: "lead-rating-cold",
    label: { en: "Cold", fa: "علاقه کم" },
    hint: { en: "General inquiry", fa: "پرسش عمومی" },
  },
};

/** Leads carry free-form rating strings on the wire; anything unknown reads as the server default. */
export function asRating(value: string | null | undefined): LeadRating {
  return value === "HOT" || value === "COLD" ? value : "WARM";
}

/** Up to two initials for the lead monogram (Latin or Persian). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  const first = Array.from(parts[0])[0] ?? "";
  const second = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}
