import { formatNumber } from "../../lib/format.ts";
import { attendeeCopy } from "../../copy/attendee.ts";

/**
 * Number and count helpers for the attendee pages (their words are in `copy/attendee.ts`), and the booth words
 * that `BoothDirectory` and `PublicBooth` read until the booth package moves them. Pure (no React), so the count
 * phrases are unit tested under `node --test`.
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

export const boothCopy = {
  fa: {
    needsPass: "برای نشان کردن غرفه‌ها به کارت ورود فعال همین همایش نیاز دارید.",
    getPass: "دریافت کارت ورود",
    otherEvent: "این غرفه متعلق به همایش دیگری است.",
    updateFailed: "ذخیره‌سازی انجام نشد. دوباره تلاش کنید.",
    connectionFailed: "اتصال برقرار نشد؛ تغییری ذخیره نشد.",
    standeeTitle: "این غرفه را با یک لمس نشان کنید",
    standeeBody: "کد QR استند غرفه را اسکن کرده‌اید. غرفه به فهرست غرفه‌های نشان‌شدهٔ شما اضافه می‌شود.",
    standeeSave: "نشان کردن این غرفه",
    standeeSaving: "در حال ذخیره…",
    standeeSaved: (name: string) => `${name} به غرفه‌های نشان‌شدهٔ شما اضافه شد.`,
    standeeAlready: (name: string) => `${name} از قبل در غرفه‌های نشان‌شدهٔ شماست.`,
    standeeSignIn: "برای نشان کردن این غرفه وارد شوید",
    standeeSignInBody: "پس از ورود به همین صفحه برمی‌گردید و با یک لمس غرفه را نشان می‌کنید.",
    signInAction: "ورود با شمارهٔ موبایل",
  },
  en: {
    needsPass: "You need an active pass for this congress to save booths.",
    getPass: "Get a pass",
    otherEvent: "This booth belongs to another congress.",
    updateFailed: "Could not update your saved booths. Please try again.",
    connectionFailed: "Connection failed; nothing was changed.",
    standeeTitle: "Save this booth in one tap",
    standeeBody: "You scanned the booth's standee QR code. The booth is added to your saved booths.",
    standeeSave: "Save this booth",
    standeeSaving: "Saving…",
    standeeSaved: (name: string) => `${name} was added to your saved booths.`,
    standeeAlready: (name: string) => `${name} is already in your saved booths.`,
    standeeSignIn: "Sign in to save this booth",
    standeeSignInBody: "After signing in you come back to this page and save the booth in one tap.",
    signInAction: "Sign in with your mobile",
  },
} as const;
