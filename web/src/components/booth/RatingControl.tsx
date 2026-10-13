import { useId, useRef, type KeyboardEvent } from "react";
import { Icon } from "../ui/Icon";
import { LEAD_RATINGS, RATING_META, asRating, type LeadRating } from "./rating";

interface RatingControlProps {
  label: string;
  /** `null` = nothing chosen yet (capture form: the rating is only sent once the operator picks one). */
  value: LeadRating | null;
  onChange: (rating: LeadRating) => void;
  locale: "fa" | "en";
  hint?: string;
}

/**
 * HOT / WARM / COLD segmented control. Toggle buttons (`aria-pressed`) inside a labelled group, with
 * arrow-key movement along the reading direction, Home and End.
 */
export function RatingControl({ label, value, onChange, locale, hint }: RatingControlProps) {
  const labelId = useId();
  const hintId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

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
      <p id={labelId} className="ui-label">{label}</p>
      <div role="group" aria-labelledby={labelId} aria-describedby={hint ? hintId : undefined} className="booth-rating-track grid grid-cols-3 gap-1.5 p-1.5">
        {LEAD_RATINGS.map((rating, index) => {
          const meta = RATING_META[rating];
          const selected = value === rating;
          return (
            <button
              key={rating}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(rating)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`booth-rating-seg ${meta.tone} press group relative flex min-h-[76px] min-w-0 flex-col items-center justify-start gap-1 rounded-[12px] px-1.5 pb-2.5 pt-3 text-center cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring`}
            >
              <span aria-hidden="true" className="booth-rating-seg__icon grid size-8 place-items-center rounded-full">
                <Icon name={meta.icon} size={18} />
              </span>
              <span className="text-[13px] font-bold leading-tight">{meta.label[locale]}</span>
              <span className="booth-rating-seg__hint text-[11px] leading-tight max-[359px]:hidden">{meta.hint[locale]}</span>
              {selected && (
                <span aria-hidden="true" className="absolute top-1.5 end-1.5 grid size-4 place-items-center rounded-full bg-white text-[var(--rating-solid)] motion-safe:animate-pop">
                  <Icon name="check" size={11} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Read-only rating marker for cards and summaries. */
export function RatingChip({ rating, locale, size = "md" }: { rating: string; locale: "fa" | "en"; size?: "sm" | "md" }) {
  const meta = RATING_META[asRating(rating)];
  return (
    <span
      className={`${meta.tone} inline-flex items-center gap-1.5 rounded-full border border-[var(--rating-border)] bg-[var(--rating-bg)] font-semibold text-[var(--rating-fg)] whitespace-nowrap ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
    >
      <Icon name={meta.icon} size={size === "sm" ? 12 : 14} strokeWidth={2} />
      <span>{meta.label[locale]}</span>
    </span>
  );
}
