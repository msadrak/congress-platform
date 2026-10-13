/**
 * "Starts in 3 days" / "Ends tomorrow" / "Concluded 2 weeks ago", derived only from the event's own
 * dates. Wording avoids repeating the status badge label shown next to it.
 */
export function eventTiming(startsAt: string, endsAt: string, now: number, locale: "fa" | "en"): string {
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (Number.isNaN(starts) || Number.isNaN(ends)) return "";
  const rtf = new Intl.RelativeTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { numeric: "auto" });
  const diffMs = (now < starts ? starts : ends) - now;
  const days = diffMs / 86_400_000;
  const abs = Math.abs(days);
  const relative =
    abs >= 365
      ? rtf.format(Math.round(days / 365), "year")
      : abs >= 60
        ? rtf.format(Math.round(days / 30), "month")
        : abs >= 14
          ? rtf.format(Math.round(days / 7), "week")
          : abs >= 1
            ? rtf.format(Math.round(days), "day")
            : rtf.format(Math.round(diffMs / 3_600_000), "hour");
  const fa = locale === "fa";
  if (now < starts) return fa ? `آغاز ${relative}` : `Starts ${relative}`;
  if (now <= ends) return fa ? `پایان ${relative}` : `Ends ${relative}`;
  return fa ? `${relative} به پایان رسید` : `Concluded ${relative}`;
}
