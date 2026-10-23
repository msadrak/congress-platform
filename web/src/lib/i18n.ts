/**
 * The locale store (`useLocale`/`setLocale`, which also sets `<html lang dir>`) and the last legacy dictionary
 * keys, still read by the attendee screens (UX-ATT-SHELL, team2) and the link pass. New words go into
 * `src/copy/<area>.ts`; this dictionary only shrinks.
 */
import { useEffect, useSyncExternalStore } from "react";
export type AttendeeLocale = "fa" | "en";
export type TranslationDictionary = (typeof translations)["fa"];
export const ATTENDEE_LOCALE_STORAGE = "congress_attendee_locale";
export const translations = {
  fa: {
    // Navigation & Shell
    myPasses: "کارت‌های ورود من",
    logout: "خروج از حساب",
    login: "ورود",
    attendeePortal: "سامانه اختصاصی شرکت‌کنندگان",
    navMyCongress: "همایش من",
    navMyTicket: "کارت ورود من",
    navMyProfile: "پروفایل من",
    navCongressDetails: "جزئیات همایش",
    languageToggle: "English",
    // Ticket Pass Portal
    tierLabel: "نوع کارت ورود",
    venueLabel: "محل برگزاری",
    offlineNotice: "آفلاین: نمایش کارت ورود ذخیره‌شده",
    unauthenticatedTitle: "ورود",
    unauthenticatedDesc: "برای دیدن کارت ورود وارد شوید.",
    loginAction: "ورود به حساب کاربری",
    // Unknown address
    notFoundTitle: "صفحه پیدا نشد",
    notFoundDesc: "نشانی این صفحه درست نیست یا دیگر وجود ندارد. اگر از پیوند پیامک آمده‌اید، وارد حساب خود شوید تا کارت ورودتان را ببینید.",
    notFoundBack: "بازگشت",
    notFoundSignIn: "ورود شرکت‌کنندگان",
    // Bookmarked Booths
    savedBoothsHeading: "غرفه‌های ذخیره‌شده",
    savedBoothsDesc: "غرفه‌هایی که برای بازدید ذخیره کرده‌اید.",
    viewBoothAction: "مشاهده پروفایل غرفه",
    removeBookmarkAction: "حذف از ذخیره‌ها",
    bookmarkRemovedFeedback: "غرفه از ذخیره‌ها حذف شد.",
    networkHeading: "ارتباطات و همراهان من در همایش",
    // ── SMS short link / one-tap pass (ADR 0015). Terms: GLOSSARY.md "Persian UI terms" (tests/glossary.test.ts).
    linkOpeningLabel: "در حال باز کردن کارت ورود…",
    linkPassSignInAction: "برای شبکه‌سازی وارد شوید",
    linkExpiredTitle: "این پیوند دیگر معتبر نیست",
    linkExpiredDesc: "برای دیدن کارت ورود وارد شوید یا تازه‌ترین پیامک را باز کنید.",
    linkInvalidTitle: "این پیوند معتبر نیست",
    linkInvalidDesc: "پیوند را کامل و بدون تغییر از پیامک باز کنید، یا برای دیدن کارت ورود وارد شوید.",
    linkThrottledTitle: "تلاش‌های زیادی انجام شد",
    linkThrottledDesc: "چند دقیقه دیگر دوباره تلاش کنید، یا برای دیدن کارت ورود وارد شوید.",
    linkOfflineTitle: "اتصال برقرار نشد",
    linkOfflineDesc: "اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.",
    linkRetryAction: "تلاش دوباره",
    linkSignInAction: "ورود و دیدن کارت ورود",
  },
  en: {
    // Navigation & Shell
    myPasses: "My Passes",
    logout: "Log Out",
    login: "Log In",
    attendeePortal: "Attendee Portal",
    navMyCongress: "My Congress",
    navMyTicket: "My Ticket",
    navMyProfile: "My Profile",
    navCongressDetails: "Congress Details",
    languageToggle: "فارسی",
    // Ticket Pass Portal
    tierLabel: "Pass type",
    venueLabel: "Venue Location",
    offlineNotice: "Offline: showing your saved pass",
    unauthenticatedTitle: "Sign In to Attendee Portal",
    unauthenticatedDesc: "You must be signed in to access your digital tickets and peer connections.",
    loginAction: "Sign In",
    // Unknown address
    notFoundTitle: "Page not found",
    notFoundDesc: "This address is wrong or no longer exists. If you came from an SMS link, sign in to see your pass.",
    notFoundBack: "Go back",
    notFoundSignIn: "Attendee sign-in",
    // Bookmarked Booths
    savedBoothsHeading: "Saved Exhibition Booths",
    savedBoothsDesc: "Commercial exhibitors and sponsors you have bookmarked during the event.",
    viewBoothAction: "View Booth Profile",
    removeBookmarkAction: "Remove Bookmark",
    bookmarkRemovedFeedback: "Booth removed from your saved list.",
    networkHeading: "My Professional Connections",
    // ── SMS short link / one-tap pass (ADR 0015).
    linkOpeningLabel: "Opening your pass…",
    linkPassSignInAction: "Sign in for networking",
    linkExpiredTitle: "This link is no longer valid",
    linkExpiredDesc: "Sign in to see your pass, or open your latest SMS.",
    linkInvalidTitle: "This link is not valid",
    linkInvalidDesc: "Open the link from the SMS exactly as it was sent, or sign in to see your pass.",
    linkThrottledTitle: "Too many attempts",
    linkThrottledDesc: "Try again in a few minutes, or sign in to see your pass.",
    linkOfflineTitle: "Couldn't connect",
    linkOfflineDesc: "Check your internet connection and try again.",
    linkRetryAction: "Try again",
    linkSignInAction: "Sign in to see your pass",
  },
};
// Formatting lives in `lib/format.ts` (the one formatter set); these names stay for existing callers.
import { codeFontClass, formatDate, formatNumber } from "./format.ts";
export { codeFontClass };

/**
 * «پنجشنبه ۲۳ مهر ۱۴۰۵» / "Thu, Oct 15, 2026": `formatDate(…, "day", …)` on the clock of `timeZone` (the
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
export interface AttendeeLocaleContext extends LocaleState {
  t: (typeof translations)["fa"];
}

/*
 * One locale for the whole app. The reader's explicit choice is kept under one storage key and shared by every
 * screen; without one, the page on screen may name a default (a congress page speaks its congress's language),
 * and otherwise the app speaks Persian. `<html lang dir>` always follows the locale in use.
 */
const DIRECTION = { fa: "rtl", en: "ltr" } as const;
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

/** The app's locale with the legacy dictionary (`t`). */
export function useAttendeeLocale(): AttendeeLocaleContext {
  const state = useLocale();
  return { ...state, t: translations[state.locale] };
}
