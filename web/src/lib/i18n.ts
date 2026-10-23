/**
 * The locale store: `useLocale`/`setLocale` (which also sets `<html lang dir>`) and the locale formatting names.
 * Words live in `src/copy/<area>.ts`.
 */
import { useEffect, useSyncExternalStore } from "react";
export type AttendeeLocale = "fa" | "en";
export const ATTENDEE_LOCALE_STORAGE = "congress_attendee_locale";
// Formatting lives in `lib/format.ts` (the one formatter set); these names stay for existing callers.
import { codeFontClass, formatDate, formatNumber } from "./format.ts";
export { codeFontClass };

/**
 * «پنجشنبه ۲۳ مهر ۱۴۰۵» / "Thu 15 Oct 2026": `formatDate(…, "day", …)` on the clock of `timeZone` (the
 * reader's own when it is omitted or unknown). An unreadable date is returned as given.
 */
export function formatLocalizedDate(dateStr: string, locale: AttendeeLocale, timeZone?: string): string {
  return formatDate(dateStr, "day", locale, timeZone);
}

/** «۵٬۰۰۰»، «۰٫۵» for 'fa' and "5,000" for 'en': `formatNumber` in `lib/format.ts`. */
export function formatLocalizedNumber(num: number, locale: AttendeeLocale): string {
  return formatNumber(num, locale);
}
export interface LocaleState {
  locale: AttendeeLocale;
  setLocale: (newLocale: AttendeeLocale) => void;
  isRtl: boolean;
  dir: "rtl" | "ltr";
}

/*
 * One locale for the whole app. The reader's explicit choice is kept under one storage key and shared by every
 * screen; without one, the page on screen may name a default (a congress page speaks its congress's language),
 * and otherwise the app speaks Persian. `<html lang dir>` always follows the locale in use.
 */
/** The writing direction of each locale. */
export const LOCALE_DIR = { fa: "rtl", en: "ltr" } as const;
const DIRECTION = LOCALE_DIR;
const listeners = new Set<() => void>();
/** A choice the browser refused to store (private mode, blocked site data): it holds until the page reloads. */
let unsavedChoice: AttendeeLocale | null = null;
/** The language of the content on screen, while a page that has one is mounted. */
let pageDefault: AttendeeLocale | undefined;

function chosenLocale(): AttendeeLocale | null {
  if (unsavedChoice !== null) return unsavedChoice;
  try {
    const stored = localStorage.getItem(ATTENDEE_LOCALE_STORAGE);
    return stored === "fa" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

function changed(): void {
  if (typeof document !== "undefined") {
    const locale = chosenLocale() ?? pageDefault ?? "fa";
    document.documentElement.lang = locale;
    document.documentElement.dir = DIRECTION[locale];
  }
  for (const listener of listeners) listener();
}

/** The reader's choice, for every screen and every later visit. */
export function setLocale(newLocale: AttendeeLocale): void {
  try {
    localStorage.setItem(ATTENDEE_LOCALE_STORAGE, newLocale);
    unsavedChoice = null;
  } catch {
    unsavedChoice = newLocale;
  }
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const currentPageDefault = () => pageDefault;

changed();

/**
 * The app's locale. `contentDefault` is the language of the page's own content (a congress page), used when the
 * reader has not chosen one; while the page is mounted every other screen element follows it too.
 */
export function useLocale(contentDefault?: AttendeeLocale): LocaleState {
  const chosen = useSyncExternalStore(subscribe, chosenLocale, () => null);
  const fallback = useSyncExternalStore(subscribe, currentPageDefault, () => undefined);
  useEffect(() => {
    if (contentDefault === undefined) return;
    pageDefault = contentDefault;
    changed();
    return () => {
      if (pageDefault !== contentDefault) return;
      pageDefault = undefined;
      changed();
    };
  }, [contentDefault]);
  const locale = chosen ?? contentDefault ?? fallback ?? "fa";
  return { locale, setLocale, isRtl: locale === "fa", dir: DIRECTION[locale] };
}
