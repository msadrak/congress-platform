/**
 * `Retry-After` handling for rate-limited requests (429). Pure, so the countdown can be tested without a DOM.
 * The header is either delay-seconds or an HTTP-date (RFC 9110 §10.2.3); anything else means "unknown".
 */

/** Never lock the form for longer than a day, whatever the header says. */
export const MAX_RETRY_SECONDS = 24 * 60 * 60;
/** Used when the header is missing or unreadable. */
export const DEFAULT_RETRY_SECONDS = 60;

/**
 * Whole seconds to wait, between 1 s and one day; null when the header is missing or unreadable.
 * `now` is the client clock in ms (an HTTP-date is compared against it).
 */
export function parseRetryAfter(header: string | null | undefined, now: number): number | null {
  const value = header?.trim();
  if (!value) return null;
  let seconds: number;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    seconds = Number(value);
  } else {
    // Every HTTP-date form starts with the day name; this keeps Date.parse from reading "-5" as a year.
    const at = /^[A-Za-z]{3}/.test(value) ? Date.parse(value) : Number.NaN;
    if (Number.isNaN(at)) return null;
    seconds = (at - now) / 1000;
  }
  if (!Number.isFinite(seconds)) return null;
  return Math.min(MAX_RETRY_SECONDS, Math.max(1, Math.ceil(seconds)));
}

/** The moment (ms) the request may be retried, falling back to `DEFAULT_RETRY_SECONDS`. */
export function retryDeadline(header: string | null | undefined, now: number): number {
  return now + (parseRetryAfter(header, now) ?? DEFAULT_RETRY_SECONDS) * 1000;
}

/** Whole seconds until `deadline`, never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** `m:ss` (or `h:mm:ss` from an hour up) in the reader's digits, e.g. `1:27` or `۱:۲۷`. */
export function formatCountdown(seconds: number, locale: "fa" | "en"): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const ascii = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return locale === "fa" ? ascii.replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d))) : ascii;
}
