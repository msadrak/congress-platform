/**
 * Addresses organizers paste into Page Studio: video pages (YouTube, Aparat) reduced to a provider and an id,
 * and community/contact links normalised to a safe http(s), mailto: or tel: address with a guessed kind.
 * The backend (`app/page_document.py`) checks the same shapes again; the page builds embed addresses itself.
 */
import { latinDigits } from "./format.ts";
import type { LinkKind, VideoProvider } from "./pageDocument";

const VIDEO_ID: Record<VideoProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  aparat: /^[A-Za-z0-9]{3,24}$/,
};

export const isVideoId = (provider: VideoProvider, id: string) => VIDEO_ID[provider].test(id);

function parseUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

const host = (url: URL) => url.hostname.toLowerCase().replace(/^(www|m)\./, "");

/**
 * A YouTube or Aparat video from whatever the organizer pasted: a watch/share/shorts/embed address or the
 * bare Aparat page. Null when it is not a recognisable video.
 */
export function parseVideoUrl(input: string): { provider: VideoProvider; id: string } | null {
  const url = parseUrl(input);
  if (!url) return null;
  const h = host(url);
  const segments = url.pathname.split("/").filter(Boolean);
  let provider: VideoProvider | null = null;
  let id: string | null | undefined = null;
  if (h === "youtu.be") {
    provider = "youtube";
    id = segments[0];
  } else if (h === "youtube.com" || h === "music.youtube.com" || h === "youtube-nocookie.com") {
    provider = "youtube";
    id = url.searchParams.get("v") ?? (["embed", "shorts", "live", "v"].includes(segments[0]) ? segments[1] : null);
  } else if (h === "aparat.com") {
    provider = "aparat";
    // /v/{hash}[/title], or the embed page /video/video/embed/videohash/{hash}/vt/frame
    const hashAt = segments.indexOf("videohash");
    id = segments[0] === "v" ? segments[1] : hashAt >= 0 ? segments[hashAt + 1] : null;
  }
  return provider && id && isVideoId(provider, id) ? { provider, id } : null;
}

/** The player address (privacy-enhanced for YouTube), started by the visitor's own press. */
export function videoEmbedUrl(provider: VideoProvider, id: string): string {
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`
    : `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame?autoplay=true`;
}

/** The video's own page, for visitors whose network blocks the player. */
export function videoPageUrl(provider: VideoProvider, id: string): string {
  return provider === "youtube" ? `https://www.youtube.com/watch?v=${id}` : `https://www.aparat.com/v/${id}`;
}

const EMAIL = /^[^@\s/?#]+@[^@\s/?#]+\.[^@\s/?#]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{2,30}$/;

/**
 * What the organizer typed, as an address a visitor can follow: `t.me/x` → `https://t.me/x`, an e-mail
 * address → `mailto:`, a phone number (Persian digits too) → `tel:`. Null when it cannot be one.
 */
export function normalizeLink(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const latin = latinDigits(raw);
  if (/^mailto:/i.test(raw)) return EMAIL.test(raw.slice(7)) ? `mailto:${raw.slice(7)}` : null;
  if (/^tel:/i.test(raw)) return PHONE.test(latin.slice(4)) ? `tel:${latin.slice(4)}` : null;
  if (EMAIL.test(raw)) return `mailto:${raw}`;
  if (PHONE.test(latin)) return `tel:${latin}`;
  if (/\s/.test(raw)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  const url = parseUrl(raw);
  if (!url || !url.hostname.includes(".")) return null;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** A stored link that is safe to put in `href` (the server already checked it; this guards old or odd data). */
export function safeLinkHref(value: string): string | null {
  if (/^(mailto|tel):/i.test(value)) return value.replace(/\s+/g, "");
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

const KIND_HOSTS: ReadonlyArray<[LinkKind, readonly string[]]> = [
  ["telegram", ["t.me", "telegram.me", "telegram.org"]],
  ["instagram", ["instagram.com", "instagr.am"]],
  ["whatsapp", ["wa.me", "whatsapp.com", "chat.whatsapp.com"]],
  ["eitaa", ["eitaa.com", "eitaa.ir"]],
  ["bale", ["ble.ir", "bale.ai"]],
  ["rubika", ["rubika.ir"]],
  ["linkedin", ["linkedin.com", "lnkd.in"]],
  ["x", ["x.com", "twitter.com"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["aparat", ["aparat.com"]],
];

/** The kind of a normalised link, so the right icon and default label appear without the organizer choosing. */
export function detectLinkKind(link: string): LinkKind {
  if (link.startsWith("mailto:")) return "email";
  if (link.startsWith("tel:")) return "phone";
  const url = parseUrl(link);
  if (!url) return "website";
  const h = host(url);
  for (const [kind, hosts] of KIND_HOSTS) {
    if (hosts.some((known) => h === known || h.endsWith(`.${known}`))) return kind;
  }
  return "website";
}

/** What a link shows when the organizer wrote no label: the handle, address or number itself. */
export function linkDisplay(link: string): string {
  if (/^(mailto|tel):/i.test(link)) return link.slice(link.indexOf(":") + 1);
  const url = parseUrl(link);
  if (!url) return link;
  const path = url.pathname.replace(/\/+$/, "");
  return `${host(url)}${path}`;
}
