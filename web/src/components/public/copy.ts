import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";

export type PublicLocale = AttendeeLocale;

const PERSIAN_SCRIPT = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export const hasPersian = (text: string | null | undefined) => Boolean(text && PERSIAN_SCRIPT.test(text));

/** The language a congress is written in: Persian script means Persian, anything else English. */
export function contentLocale(...texts: (string | null | undefined)[]): PublicLocale {
  return texts.some(hasPersian) ? "fa" : "en";
}

/** Attributes for a block of organizer-written prose: it reads in its own direction. */
export function proseDir(text: string): { dir: "rtl" | "ltr"; lang: "fa" | "en" } {
  return hasPersian(text) ? { dir: "rtl", lang: "fa" } : { dir: "ltr", lang: "en" };
}

/**
 * For plain-string slots (dialog descriptions, aria labels): wraps text written in the other language in
 * Unicode first-strong isolates so it cannot reorder the sentence around it.
 */
export function isolateFor(text: string, locale: "fa" | "en"): string {
  return hasPersian(text) === (locale === "fa") ? text : `\u2068${text}\u2069`;
}

/**
 * Public page language: the app's one locale (`useLocale`). A visitor's explicit choice wins and is shared with the
 * portals; without one, a congress page speaks the language of its congress and the platform pages Persian.
 */
export { useLocale as usePublicLocale } from "../../lib/i18n";

export const num = (n: number, locale: PublicLocale) => formatLocalizedNumber(n, locale);

/** The public pages' strings live in `src/copy/public.ts`; re-exported here for the existing imports. */
export { publicCopy, type PublicCopy } from "../../copy/public";
