import type { CopyShape } from "./useCopy";

/** The SMS short link `/t/:code` (`pages/LinkPassEntry.tsx`, ADR 0015) and the unknown-address page (`pages/NotFound.tsx`). */
const fa = {
  opening: "در حال باز کردن کارت ورود…",
  expiredTitle: "این پیوند دیگر معتبر نیست",
  expiredBody: "برای دیدن کارت ورود وارد شوید یا تازه‌ترین پیامک را باز کنید.",
  invalidTitle: "این پیوند معتبر نیست",
  invalidBody: "پیوند را کامل و بدون تغییر از پیامک باز کنید، یا برای دیدن کارت ورود وارد شوید.",
  throttledTitle: "تلاش‌های زیادی انجام شد",
  throttledBody: "چند دقیقه دیگر دوباره تلاش کنید، یا برای دیدن کارت ورود وارد شوید.",
  offlineTitle: "اتصال برقرار نشد",
  offlineBody: "اتصال اینترنت را بررسی کنید و دوباره تلاش کنید.",
  retry: "تلاش دوباره",
  signIn: "ورود و دیدن کارت ورود",
  notFound: {
    title: "صفحه پیدا نشد",
    body: "نشانی این صفحه درست نیست یا دیگر وجود ندارد. اگر از پیوند پیامک آمده‌اید، وارد حساب خود شوید تا کارت ورودتان را ببینید.",
    back: "بازگشت",
    signIn: "ورود شرکت‌کنندگان",
  },
} as const;

const en: CopyShape<typeof fa> = {
  opening: "Opening your pass…",
  expiredTitle: "This link is no longer valid",
  expiredBody: "Sign in to see your pass, or open your latest SMS.",
  invalidTitle: "This link is not valid",
  invalidBody: "Open the link from the SMS exactly as it was sent, or sign in to see your pass.",
  throttledTitle: "Too many attempts",
  throttledBody: "Try again in a few minutes, or sign in to see your pass.",
  offlineTitle: "Couldn't connect",
  offlineBody: "Check your internet connection and try again.",
  retry: "Try again",
  signIn: "Sign in to see your pass",
  notFound: {
    title: "Page not found",
    body: "This address is wrong or no longer exists. If you came from an SMS link, sign in to see your pass.",
    back: "Go back",
    signIn: "Attendee sign-in",
  },
};

export const linkPassCopy = { fa, en };
