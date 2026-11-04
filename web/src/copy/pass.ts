import type { CopyShape } from "./useCopy";

/*
 * The pass: the pass page (`pages/MyTickets.tsx`), the card and the full-screen QR (`components/attendee/`).
 * Wording: docs/ux-review/copy/SPEC.md §4.3; terms: GLOSSARY.md. The «کارت ورود» is the attendee's pass; the cancel
 * action is «لغو ثبت‌نام». Read it as `passCopy[locale]`, or `useCopy(passCopy, locale)` in a component.
 */
const fa = {
  /** The card. */
  card: {
    title: "کارت ورود دیجیتال به همایش",
    passId: "شناسه کارت ورود",
    issued: "تاریخ صدور",
    valid: "معتبر",
    cancelled: "لغو شده",
    cancelledQr: "کد QR این کارت ورود دیگر کار نمی‌کند.",
    print: "چاپ کارت ورود",
    /** The QR is a button: this is its name. */
    expandQr: "نمایش تمام‌صفحه کد QR",
  },
  fullscreen: {
    label: "کد QR کارت ورود، تمام‌صفحه",
    close: "برای بستن، صفحه را لمس کنید",
  },
  /** The page around the card. */
  page: {
    signInTitle: "ورود برای دیدن کارت ورود",
    signIn: "ورود",
    sessionExpired: "زمان ورود شما تمام شده؛ کارت ذخیره‌شده نمایش داده می‌شود.",
    loadFailed: "کارت ورود بارگذاری نشد",
    loadFailedBody: "اتصال را بررسی کنید و دوباره تلاش کنید.",
    /** No response at all and nothing saved on this device yet. */
    connectOnce: "برای بار اول به اینترنت نیاز دارید",
    retry: "تلاش دوباره",
    choosePass: "کارت‌های ورود شما",
    noPassTitle: "برای این همایش کارت ورود ندارید",
    noPassBody: "برای شرکت در همایش، از صفحه همایش کارت ورود رزرو کنید.",
    reserve: "رزرو کارت ورود",
    cancelledTitle: "این کارت ورود لغو شده است",
    cancelledBody: "کد QR آن دیگر در ورودی پذیرفته نمی‌شود. اگر می‌خواهید در همایش شرکت کنید، دوباره کارت ورود رزرو کنید.",
    loading: "کارت ورود من",
    offline: "آفلاین: نمایش کارت ورود ذخیره‌شده",
    /** Under a pass opened from an SMS link. */
    linkSignIn: "برای شبکه‌سازی وارد شوید",
  },
  /** Cancelling one's own registration. */
  cancel: {
    action: "لغو ثبت‌نام",
    busy: "در حال لغو…",
    title: "ثبت‌نام لغو شود؟",
    body: "کد QR این کارت ورود دیگر کار نمی‌کند و جای شما آزاد می‌شود. برگشت‌پذیر نیست.",
    keep: "انصراف",
    done: "ثبت‌نام شما لغو شد.",
    failed: "لغو انجام نشد؛ دوباره تلاش کنید.",
    offline: "اتصال برقرار نشد؛ ثبت‌نام لغو نشد.",
  },
};

const en: CopyShape<typeof fa> = {
  card: {
    title: "Digital Congress Entry Pass",
    passId: "Pass ID",
    issued: "Issued",
    valid: "Valid",
    cancelled: "Cancelled",
    cancelledQr: "This pass's QR code no longer works.",
    print: "Print Pass",
    expandQr: "Show the QR code full screen",
  },
  fullscreen: {
    label: "Pass QR code, full screen",
    close: "Tap anywhere to close",
  },
  page: {
    signInTitle: "Sign in to see your pass",
    signIn: "Sign in",
    sessionExpired: "Signed out; showing the saved pass.",
    loadFailed: "Couldn't load your pass",
    loadFailedBody: "Check your connection and try again.",
    connectOnce: "Connect once to load your pass",
    retry: "Try again",
    choosePass: "Your passes",
    noPassTitle: "You have no pass for this congress",
    noPassBody: "To attend, reserve a pass on the congress page.",
    reserve: "Reserve a pass",
    cancelledTitle: "This pass has been cancelled",
    cancelledBody: "Its QR code is no longer accepted at the entrance. To attend the congress, reserve a pass again.",
    loading: "My pass",
    offline: "Offline: showing your saved pass",
    linkSignIn: "Sign in for networking",
  },
  cancel: {
    action: "Cancel registration",
    busy: "Cancelling…",
    title: "Cancel registration?",
    body: "The QR code stops working and your place is released. This can't be undone.",
    keep: "Keep",
    done: "Your registration has been cancelled.",
    failed: "Couldn't cancel — try again.",
    offline: "Couldn't connect; your registration was not cancelled.",
  },
};

export const passCopy = { fa, en };
