const SLUG = "[A-Za-z0-9_-]+";
// Mirrors the five approved destinations in congressContext (kept literal: this is a security allow-list).
const DESTINATIONS = "my-congress|my-network|my-ticket|my-profile|details";

/** The only places a User sign-in may return to: attendee and exhibitor-booth routes of this app. */
const ALLOWED_PATHS: readonly RegExp[] = [
  new RegExp(`^/c/${SLUG}/(?:${DESTINATIONS})$`),
  new RegExp(`^/e/${SLUG}$`),
  new RegExp(`^/e/${SLUG}/booths/[A-Za-z0-9-]+$`),
  /^\/booth\/[A-Za-z0-9-]+$/,
  /^\/me$/,
  // Former addresses, redirected to /me.
  /^\/my-tickets$/,
  /^\/my-network$/,
];

const PLACEHOLDER_ORIGIN = "http://internal.invalid";

/** A public booth page; its standee QR adds `?b=<secret>` for the one-tap save after sign-in. */
const BOOTH_PAGE = new RegExp(`^/e/${SLUG}/booths/[A-Za-z0-9-]+$`);
/** The booth secret's shape (backend/app/routes/booths.py `_BOOTH_CODE`, case-insensitive). */
const BOOTH_CODE = /^[A-Za-z0-9]{8,64}$/;

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
 * path outside the allow-list are rejected; query and fragment are dropped, except a well-formed standee
 * code (`?b=`) on a public booth page.
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
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(url.pathname))) return fallback;
  // The one query kept: a well-formed standee code on a booth page, so the attendee returns to the one-tap save.
  const code = url.searchParams.get("b");
  if (code && BOOTH_PAGE.test(url.pathname) && BOOTH_CODE.test(code)) return `${url.pathname}?b=${code}`;
  return url.pathname;
}

/** Sign-in entry for a congress (or the generic sign-in) that returns to `next` afterwards. */
export function signInPath(slug: string | undefined, next: string): string {
  const base = slug ? `/c/${encodeURIComponent(slug)}/sign-in` : "/sign-in";
  return `${base}?next=${encodeURIComponent(next)}`;
}

/** Sign-in entry for one exhibitor booth that returns to that booth afterwards. */
export function boothSignInPath(boothId: string): string {
  return `/booth/${encodeURIComponent(boothId)}/sign-in?next=${encodeURIComponent(`/booth/${boothId}`)}`;
}
