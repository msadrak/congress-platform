import { formatNumber } from "../../lib/format.ts";
import { attendeeCopy } from "../../copy/attendee.ts";

/**
 * Number and count helpers for the attendee pages (their words are in `copy/attendee.ts`). Pure (no React), so
 * the count phrases are unit tested under `node --test`.
 */
export type CopyLocale = "fa" | "en";

/** Digits in the reader's script ("12" / "۱۲"). */
export const n = (value: number, locale: CopyLocale) => formatNumber(value, locale);

/** A count as words: zero is a sentence ("No contacts yet"), never a bare «۰». */
export function contactsPhrase(count: number, locale: CopyLocale): string {
  const c = attendeeCopy[locale].network;
  if (count === 0) return c.contactsNone;
  return `${n(count, locale)} ${count === 1 ? c.contactOne : c.contactMany}`;
}
