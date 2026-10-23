/**
 * Where an unknown Attendee Portal address (`/c/:slug/<rest>`) lands instead of a blank page.
 *
 * Confirmation SMS used to shorten the pass link like any other value, so messages already sent carry
 * e.g. `/c/<slug>/my-tic…`: any non-empty start of `my-ticket` (once the trailing ellipsis, dots and
 * other punctuation are dropped) opens the pass. Every other address opens the congress home.
 */

const PASS = "my-ticket";
// What a cut or copy-pasted link leaves at its end: "…", "...", ".", "/", spaces and other punctuation.
const TRAILING_NOISE = /[\s\p{P}\p{S}]+$/u;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function congressFallbackPath(slug: string, rest: string): string {
  const wanted = decoded(rest).replace(TRAILING_NOISE, "").toLowerCase();
  const destination = wanted && PASS.startsWith(wanted) ? PASS : "my-congress";
  return `/c/${encodeURIComponent(slug)}/${destination}`;
}
