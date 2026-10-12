const SLUG = "[A-Za-z0-9_-]+";
// Mirrors the five approved destinations in congressContext (kept literal: this is a security allow-list).
const DESTINATIONS = "my-congress|my-network|my-ticket|my-profile|details";

/** The only places an attendee sign-in may return to: attendee-facing routes of this app. */
const ALLOWED_PATHS: readonly RegExp[] = [
  new RegExp(`^/c/${SLUG}/(?:${DESTINATIONS})$`),
  new RegExp(`^/e/${SLUG}$`),
  new RegExp(`^/e/${SLUG}/booths/[A-Za-z0-9-]+$`),
  /^\/my-tickets$/,
  /^\/my-network$/,
];

const PLACEHOLDER_ORIGIN = "http://internal.invalid";

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Resolve a caller-supplied `next` value to an in-app attendee path, or `fallback`.
 * Absolute URLs, protocol-relative and backslash forms, control characters, traversal and any
 * path outside the allow-list are rejected; query and fragment are dropped.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw.length > 300 || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || hasControlCharacter(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  return ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname)) ? url.pathname : fallback;
}

/** Sign-in entry for a congress (or the generic sign-in) that returns to `next` afterwards. */
export function signInPath(slug: string | undefined, next: string): string {
  const base = slug ? `/c/${encodeURIComponent(slug)}/sign-in` : "/sign-in";
  return `${base}?next=${encodeURIComponent(next)}`;
}
