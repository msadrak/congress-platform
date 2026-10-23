import type { CopyShape } from "./useCopy";

/** Words of the Jalali / Gregorian date field (`components/ui/DateTimeField.tsx`). */
const fa = {
  day: "روز",
  month: "ماه",
  year: "سال",
  time: "ساعت",
  invalidDate: "این تاریخ وجود ندارد.",
  invalidTime: "ساعت را به شکل ۰۸:۳۰ بنویسید.",
};

const en: CopyShape<typeof fa> = {
  day: "Day",
  month: "Month",
  year: "Year",
  time: "Time",
  invalidDate: "This date does not exist.",
  invalidTime: "Enter the time as 08:30.",
};

export const dateFieldCopy = { fa, en };
