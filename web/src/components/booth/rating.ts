import type { IconName } from "../ui/Icon";

export type LeadRating = "HOT" | "WARM" | "COLD";

export const LEAD_RATINGS: readonly LeadRating[] = ["HOT", "WARM", "COLD"];

interface RatingMeta {
  icon: IconName;
  /** Portal CSS class that sets the `--rating-*` colour variables (styles/exhibitor.css). */
  tone: string;
}

/** Icon and colour of each rating; the words are in `boothCopy[locale].rating`. */
export const RATING_META: Record<LeadRating, RatingMeta> = {
  HOT: { icon: "flame", tone: "lead-rating-hot" },
  WARM: { icon: "sun", tone: "lead-rating-warm" },
  COLD: { icon: "snow", tone: "lead-rating-cold" },
};

/** Leads carry free-form rating strings on the wire; anything unknown reads as the server default. */
export function asRating(value: string | null | undefined): LeadRating {
  return value === "HOT" || value === "COLD" ? value : "WARM";
}
