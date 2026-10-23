import type { AttendeeLocale } from "../lib/i18n";
import type { InstallPersona } from "../lib/installPrompt";

/** Words of the one "add to home screen" row and its iOS sheet (`components/attendee/InstallHint.tsx`), per persona. */
interface PersonaCopy {
  title: string;
  /** Under the title when the browser can install the app itself. */
  body: string;
  /** Under the title on iOS, where the steps are in the sheet. */
  iosBody?: string;
  action: string;
  /** The last of the three steps: what to do inside the installed app. */
  lastStep: string;
}

export const installCopy: Record<InstallPersona, Record<AttendeeLocale, PersonaCopy>> = {
  attendee: {
    fa: {
      title: "افزودن کارت ورود به صفحهٔ اصلی",
      body: "کارت ورود بدون اینترنت هم باز می‌شود.",
      action: "افزودن",
      lastStep: "یک بار آن را باز کنید و با شماره موبایل وارد شوید",
    },
    en: {
      title: "Add your pass to the home screen",
      body: "Your pass opens even offline.",
      action: "Add",
      lastStep: "Open it once and sign in with your mobile",
    },
  },
  scanner: {
    fa: {
      title: "نصب اسکنر روی صفحهٔ اصلی",
      body: "اسکنر با یک لمس باز می‌شود.",
      iosBody: "ابتدا برنامه را به صفحهٔ اصلی اضافه کنید، سپس کد QR اتصال را داخل برنامه اسکن کنید.",
      action: "نصب",
      lastStep: "یک بار آن را باز کنید و کد QR اتصال را اسکن کنید",
    },
    en: {
      title: "Install the scanner on your home screen",
      body: "Open the scanner in one tap.",
      iosBody: "Add the app to your home screen first, then scan the pairing QR code inside the app.",
      action: "Install",
      lastStep: "Open it once and scan the pairing QR code",
    },
  },
  booth: {
    fa: {
      title: "نصب پنل غرفه روی صفحهٔ اصلی",
      body: "پنل غرفه با یک لمس باز می‌شود.",
      action: "نصب",
      lastStep: "یک بار آن را باز کنید و با شماره موبایل وارد شوید",
    },
    en: {
      title: "Install the booth panel on your home screen",
      body: "Open your booth panel in one tap.",
      action: "Install",
      lastStep: "Open it once and sign in with your mobile",
    },
  },
};

export const installSharedCopy = {
  fa: { how: "چطور؟", dismiss: "بعداً", share: "دکمهٔ اشتراک‌گذاری را بزنید", addToHome: "افزودن به صفحهٔ اصلی" },
  en: { how: "How?", dismiss: "Not now", share: "Tap Share", addToHome: "Add to Home Screen" },
} as const;
