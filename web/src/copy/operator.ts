/**
 * Shared words of the three on-site operator tools (scanner, reception desk, booth panel): the status pill, the
 * ⋮ menu, the verdict banner and the setup / blocked screens. Tool-specific wording stays in each tool's own module.
 * Numbers arrive already formatted (`formatLocalizedNumber`), so Persian shows Persian digits.
 */

export type OperatorLocale = "fa" | "en";

/** One state of the connection / data pill in the operator bar. */
export type OperatorStatus = "online" | "offline" | "syncing" | "queued" | "conflicts" | "archived" | "update";

/** Outcome shown by the verdict banner (scanner verdict, desk admit, booth capture result). */
export type VerdictTone = "admitted" | "admitted-offline" | "exit" | "duplicate" | "rejected" | "info";

/** Setup or blocked screen of an operator tool. */
export type OperatorGateKind =
  | "unpaired"
  | "revoked"
  | "wrongGate"
  | "expired"
  | "suspended"
  | "removed"
  | "archived"
  | "signIn"
  | "unavailable";

export interface OperatorCopy {
  status: {
    online: string;
    offline: string;
    syncing: string;
    archived: string;
    update: string;
    /** Joins a state and its detail. Not «·» in Persian, where it reads as the digit zero «۰». */
    separator: string;
    /** `shown` is the formatted count; `count` picks the plural. */
    queued: (shown: string, count: number) => string;
    conflicts: (shown: string, count: number) => string;
  };
  verdict: Record<VerdictTone, string>;
  gate: Record<OperatorGateKind, { title: string; body: string }>;
  details: string;
  menu: {
    open: string;
    language: string;
    /** `lang` of the language item, which is written in the language it switches to. */
    languageLang: OperatorLocale;
    soundOn: string;
    soundOff: string;
    install: string;
    update: string;
    updateAfterQueue: string;
    signOut: string;
    unpair: string;
    version: string;
  };
  close: string;
}

const fa: OperatorCopy = {
  status: {
    online: "آنلاین",
    offline: "آفلاین",
    syncing: "در حال ارسال…",
    archived: "بایگانی‌شده",
    update: "نسخهٔ تازه",
    separator: "، ",
    queued: (shown) => `${shown} در صف`,
    conflicts: (shown) => `${shown} تداخل`,
  },
  verdict: {
    admitted: "مجاز",
    "admitted-offline": "مجاز (آفلاین)",
    exit: "خروج",
    duplicate: "تکراری",
    rejected: "رد شد",
    info: "توجه",
  },
  gate: {
    unpaired: { title: "اتصال به نقطهٔ ورود", body: "کد QR اتصال را از برگزارکننده بگیرید." },
    revoked: { title: "دسترسی دستگاه لغو شد", body: "کد QR اتصال تازه بگیرید." },
    wrongGate: { title: "نقطهٔ ورود اشتباه است", body: "این کد اتصال برای نقطهٔ دیگری است." },
    expired: { title: "کد اتصال منقضی شده", body: "پیوند تازه از برگزارکننده بگیرید." },
    suspended: { title: "دسترسی موقتاً متوقف است", body: "با برگزارکننده تماس بگیرید." },
    removed: { title: "دسترسی شما برداشته شد", body: "اگر اشتباه است، با برگزارکننده تماس بگیرید." },
    archived: { title: "همایش بایگانی شده", body: "فقط مشاهده ممکن است." },
    signIn: { title: "ورود لازم است", body: "با شماره‌ای که برگزارکننده ثبت کرده وارد شوید." },
    unavailable: { title: "اتصال برقرار نشد", body: "اینترنت را بررسی کنید و دوباره تلاش کنید." },
  },
  details: "جزئیات فنی",
  menu: {
    open: "منو",
    language: "English",
    languageLang: "en",
    soundOn: "روشن کردن صدا",
    soundOff: "خاموش کردن صدا",
    install: "نصب برنامه",
    update: "بارگذاری نسخهٔ تازه",
    updateAfterQueue: "پس از ارسال صف",
    signOut: "خروج",
    unpair: "قطع اتصال دستگاه",
    version: "نسخه",
  },
  close: "بستن",
};

const en: OperatorCopy = {
  status: {
    online: "Online",
    offline: "Offline",
    syncing: "Sending…",
    archived: "Archived",
    update: "New version",
    separator: " · ",
    queued: (shown) => `${shown} queued`,
    conflicts: (shown, count) => `${shown} ${count === 1 ? "conflict" : "conflicts"}`,
  },
  verdict: {
    admitted: "Admitted",
    "admitted-offline": "Admitted (offline)",
    exit: "Exit",
    duplicate: "Duplicate",
    rejected: "Rejected",
    info: "Note",
  },
  gate: {
    unpaired: { title: "Pair this device", body: "Get the pairing QR code from the organizer." },
    revoked: { title: "Device access removed", body: "Get a new pairing QR code." },
    wrongGate: { title: "Wrong check-in point", body: "This code is for another point." },
    expired: { title: "Pairing expired", body: "Get a new link from the organizer." },
    suspended: { title: "Access paused", body: "Contact the organizer." },
    removed: { title: "Your access was removed", body: "Contact the organizer if this is a mistake." },
    archived: { title: "Congress archived", body: "View only." },
    signIn: { title: "Sign in to continue", body: "Use the number the organizer added." },
    unavailable: { title: "Can't reach the server", body: "Check your internet and try again." },
  },
  details: "Technical details",
  menu: {
    open: "Menu",
    language: "فارسی",
    languageLang: "fa",
    soundOn: "Turn sound on",
    soundOff: "Turn sound off",
    install: "Install app",
    update: "Reload new version",
    updateAfterQueue: "After the queue is sent",
    signOut: "Sign out",
    unpair: "Unpair this device",
    version: "Version",
  },
  close: "Close",
};

export const operatorCopy: Record<OperatorLocale, OperatorCopy> = { fa, en };
