import type { CopyShape } from "./useCopy";

/** Words of the attendee and booth sign-in page (`pages/AttendeeSignIn.tsx`; copy SPEC §4.3). */
const fa = {
  title: "ورود به سامانه شرکت‌کنندگان",
  profileHeading: "تکمیل اطلاعات",
  signedInAs: "با این حساب وارد شده‌اید:",
  continue: "ادامه",
  continuing: "چند لحظه دیگر به مقصد می‌روید…",
  signOut: "شما نیستید؟ خروج",
  noAccount: "هنوز کارت ورود ندارید؟",
  reserve: "رزرو کارت ورود برای این همایش",
  congressMissing: "این همایش پیدا نشد. پس از ورود، کارت‌های ورود خودتان را می‌بینید.",
  noAccountGeneric: "کارت ورود ندارید؟ از صفحهٔ همایش ثبت‌نام کنید.",
  skip: "پرش به فرم ورود",
  toggleLabel: "Switch language to English",
  toggle: "English",
  boothTitle: "ورود به پنل غرفه",
  boothSubtitle: "با شماره‌ای وارد شوید که برگزارکننده برای غرفه ثبت کرده است.",
  portalAttendee: "همایش من",
  portalExhibitor: "پنل غرفه",
  when: "زمان برگزاری",
  where: "محل برگزاری",
} as const;

const en: CopyShape<typeof fa> = {
  // The attendee title keeps its words until the attendee specs (UX-ATT-SHELL, team2) move to «ورود» / "Sign in".
  title: "Sign in to your attendee portal",
  profileHeading: "Complete your profile",
  signedInAs: "You are signed in as",
  continue: "Continue",
  continuing: "Taking you there in a moment…",
  signOut: "Not you? Sign out",
  noAccount: "No pass yet?",
  reserve: "Reserve a pass for this congress",
  congressMissing: "That congress could not be found. After signing in you will see your passes instead.",
  noAccountGeneric: "No pass yet? Register on the congress page.",
  skip: "Skip to sign-in",
  toggleLabel: "تغییر زبان به فارسی",
  toggle: "فارسی",
  boothTitle: "Sign in to the booth panel",
  boothSubtitle: "Use the number the organizer registered for the booth.",
  portalAttendee: "My congress",
  portalExhibitor: "Booth panel",
  when: "When",
  where: "Where",
};

export const signInCopy = { fa, en };
