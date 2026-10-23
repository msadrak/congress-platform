import { useId, useRef, type KeyboardEvent } from "react";
import { boothCopy } from "../../copy/booth";
import { Icon } from "../ui/Icon";
import { LEAD_RATINGS, RATING_META, asRating, type LeadRating } from "./rating";

interface RatingControlProps {
  label: string;
  /** `null` = nothing chosen yet. */
  value: LeadRating | null;
  onChange: (rating: LeadRating) => void;
  locale: "fa" | "en";
  /** `compact` for the one-tap chips under a capture result. */
  size?: "md" | "compact";
  disabled?: boolean;
}

/**
 * High / Medium / Low as three toggle buttons (`aria-pressed`) inside a labelled group, with arrow-key movement
 * along the reading direction, Home and End.
 */
export function RatingControl({ label, value, onChange, locale, size = "md", disabled = false }: RatingControlProps) {
  const labelId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const words = boothCopy[locale].rating;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    let next = -1;
    if (event.key === forward || event.key === "ArrowDown") next = (index + 1) % LEAD_RATINGS.length;
    else if (event.key === back || event.key === "ArrowUp") next = (index - 1 + LEAD_RATINGS.length) % LEAD_RATINGS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = LEAD_RATINGS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
  };

  return (
    <div>
      <p id={labelId} className={size === "compact" ? "sr-only" : "ui-label"}>{label}</p>
      <div role="group" aria-labelledby={labelId} className="booth-rating-track grid grid-cols-3 gap-1.5 p-1.5">
        {LEAD_RATINGS.map((rating, index) => {
          const meta = RATING_META[rating];
          return (
            <button
              key={rating}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              aria-pressed={value === rating}
              disabled={disabled}
              onClick={() => onChange(rating)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`booth-rating-seg ${meta.tone} press flex h-12 min-w-0 items-center justify-center gap-2 rounded-control px-2 text-body-sm font-bold cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
            >
              <Icon name={meta.icon} size={18} className="booth-rating-seg__icon shrink-0" />
              <span className="truncate">{words[rating]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only rating marker for cards. */
export function RatingChip({ rating, locale }: { rating: string; locale: "fa" | "en" }) {
  const value = asRating(rating);
  const meta = RATING_META[value];
  return (
    <span
      className={`${meta.tone} inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--rating-border)] bg-[var(--rating-bg)] px-2.5 text-caption font-semibold whitespace-nowrap text-[var(--rating-fg)]`}
    >
      <Icon name={meta.icon} size={13} strokeWidth={2} />
      <span>{boothCopy[locale].rating[value]}</span>
    </span>
  );
}
