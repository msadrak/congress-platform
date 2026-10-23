/**
 * Localized text for the API's stable error codes (`{"detail": <English>, "code": <UPPER_SNAKE>}`, see
 * backend/app/errors.py). The UI decides by `code`, never by matching the English `detail`; a code that is
 * not listed here falls back to the server's text (`localizedApiError` in api/client.ts).
 */
import type { AttendeeLocale } from "./i18n";

export const errorMessages: Record<AttendeeLocale, Record<string, string>> = {
  fa: {
    EVENT_NOT_FOUND: "این همایش یافت نشد.",
    TIER_NOT_FOUND: "این کارت ورود دیگر ارائه نمی‌شود. لطفاً کارت دیگری انتخاب کنید.",
    TIER_CLOSED: "ثبت‌نام این نوع کارت ورود را برگزارکننده بسته است.",
    TIER_SOLD_OUT: "ظرفیت این نوع کارت ورود تکمیل شده است.",
    ALREADY_REGISTERED: "شما پیش‌تر برای این همایش کارت ورود دریافت کرده‌اید.",
    ANALYTICS_RANGE_INVALID: "آغاز بازهٔ زمانی نباید پس از پایان آن باشد.",
    PARTICIPANT_NOT_FOUND: "این شرکت‌کننده دیگر در این همایش ثبت‌نام ندارد. فهرست را به‌روز کنید.",
    TICKET_STATE_CONFLICT: "وضعیت این بلیت تغییر کرده است و این کار انجام نشد. فهرست را به‌روز کنید.",
    FULL_NAME_REQUIRED: "این شماره هنوز در سامانه حساب ندارد؛ نام و نام خانوادگی را وارد کنید.",
    ACCOUNT_CONFLICT: "ساخت حساب برای این شماره انجام نشد. دوباره تلاش کنید.",
    PARTICIPANT_HAS_HISTORY: "این شرکت‌کننده سابقهٔ ورود یا ثبت در غرفه دارد و حذف نمی‌شود؛ به‌جای آن بلیت را لغو کنید.",
    EVENT_STARTED: "همایش آغاز شده است؛ برای لغو ثبت‌نام با برگزارکننده تماس بگیرید.",
    TICKET_ALREADY_CANCELLED: "این بلیت پیش‌تر لغو شده است.",
    TICKET_NOT_FOUND: "این بلیت یافت نشد.",
    EVENT_ENDED: "این همایش به پایان رسیده و ثبت‌نام آن بسته است.",
    REGISTRATION_CLOSED: "ثبت‌نام این همایش بسته است.",
    REGISTRATION_NOT_OPEN: "ثبت‌نام این همایش هنوز آغاز نشده است.",
    TIER_SALES_NOT_OPEN: "فروش این نوع کارت ورود هنوز آغاز نشده است.",
    TIER_SALES_CLOSED: "مهلت فروش این نوع کارت ورود به پایان رسیده است.",
    EVENT_ARCHIVED: "این همایش بایگانی شده و قابل ویرایش نیست؛ برای تغییر، آن را از بایگانی خارج کنید.",
    EVENT_HAS_TICKETS: "این همایش بلیت صادرشده دارد و حذف نمی‌شود؛ به‌جای آن بایگانی‌اش کنید.",
    EVENT_HAS_RECORDS: "داده‌های این همایش مانع حذف آن است؛ به‌جای آن بایگانی‌اش کنید.",
    TIER_HAS_RESERVATIONS: "این نوع کارت ورود رزرو شده است و حذف نمی‌شود؛ به‌جای آن ثبت‌نامش را ببندید.",
    HALL_NAME_TAKEN: "سالنی با همین نام در این همایش وجود دارد.",
    HALL_IN_USE: "جلسه‌هایی در این سالن برگزار می‌شوند؛ پیش از حذف، آن‌ها را به سالن دیگری منتقل کنید.",
    PROGRAM_FILE_NOT_FOUND: "این فایل برنامه دیگر وجود ندارد؛ صفحه را تازه کنید.",
    PROGRAM_FILE_LABEL_REQUIRED: "برای فایل برنامه یک عنوان بنویسید.",
    PROGRAM_FILE_TYPE_UNSUPPORTED: "فقط فایل PDF یا تصویر PNG، JPEG یا WebP پذیرفته می‌شود.",
    PROGRAM_FILE_TOO_LARGE: "حجم فایل برنامه حداکثر ۸ مگابایت است.",
    PROGRAM_FILE_EMPTY: "فایل خالی است.",
    PROGRAM_FILE_LIMIT_REACHED: "هر همایش حداکثر ۲۰ فایل برنامه دارد؛ ابتدا یکی را حذف کنید.",
    PROGRAM_FILE_PDF_REJECTED: "این PDF پذیرفته نشد: یا PDF معتبر نیست یا اسکریپت، فایل پیوست یا فرم فعال دارد.",
    PROGRAM_FILE_IMAGE_REJECTED: "این تصویر خوانده نشد یا ابعادش بیش از حد مجاز است.",
  },
  en: {
    EVENT_NOT_FOUND: "This congress could not be found.",
    TIER_NOT_FOUND: "This pass is no longer offered. Please choose another pass.",
    TIER_CLOSED: "Registration for this pass has been closed by the organizer.",
    TIER_SOLD_OUT: "This pass is sold out.",
    ALREADY_REGISTERED: "You already hold a pass for this congress.",
    ANALYTICS_RANGE_INVALID: "The start of the time range must not be after its end.",
    PARTICIPANT_NOT_FOUND: "This participant is no longer registered for this congress. Refresh the list.",
    TICKET_STATE_CONFLICT: "This ticket's status has changed, so nothing was done. Refresh the list.",
    FULL_NAME_REQUIRED: "This number has no account yet: enter the person's full name.",
    ACCOUNT_CONFLICT: "An account for this number could not be created. Try again.",
    PARTICIPANT_HAS_HISTORY: "This participant has check-ins or booth leads and cannot be deleted; cancel the ticket instead.",
    EVENT_STARTED: "The congress has started; ask the organizer to cancel your registration.",
    TICKET_ALREADY_CANCELLED: "This ticket has already been cancelled.",
    TICKET_NOT_FOUND: "This ticket could not be found.",
    EVENT_ENDED: "This congress has ended; registration is closed.",
    REGISTRATION_CLOSED: "Registration for this congress is closed.",
    REGISTRATION_NOT_OPEN: "Registration for this congress has not opened yet.",
    TIER_SALES_NOT_OPEN: "Sales for this pass have not started yet.",
    TIER_SALES_CLOSED: "Sales for this pass have ended.",
    EVENT_ARCHIVED: "This congress is archived and read-only. Unarchive it to make changes.",
    EVENT_HAS_TICKETS: "This congress has issued tickets and cannot be deleted; archive it instead.",
    EVENT_HAS_RECORDS: "This congress still has records that prevent deleting it; archive it instead.",
    TIER_HAS_RESERVATIONS: "This pass has reservations and cannot be deleted; close its registration instead.",
    HALL_NAME_TAKEN: "This congress already has a hall with that name.",
    HALL_IN_USE: "Sessions are held in this hall; move them to another hall before deleting it.",
    PROGRAM_FILE_NOT_FOUND: "This schedule file no longer exists; refresh the page.",
    PROGRAM_FILE_LABEL_REQUIRED: "Give the schedule file a label.",
    PROGRAM_FILE_TYPE_UNSUPPORTED: "Upload a PDF, or a PNG, JPEG or WebP image.",
    PROGRAM_FILE_TOO_LARGE: "Schedule files are limited to 8 MB.",
    PROGRAM_FILE_EMPTY: "The file is empty.",
    PROGRAM_FILE_LIMIT_REACHED: "A congress can have at most 20 schedule files; delete one first.",
    PROGRAM_FILE_PDF_REJECTED: "This PDF was refused: it is not a valid PDF, or it has scripts, attachments or active forms.",
    PROGRAM_FILE_IMAGE_REJECTED: "This image could not be read or is too large in pixels.",
  },
};

/** No response at all (offline, DNS, connection reset): there is no code to look up. */
export const networkErrorMessage: Record<AttendeeLocale, string> = {
  fa: "اتصال به سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
  en: "Could not reach the server. Check your connection and try again.",
};

const RELOAD_AVAILABILITY: readonly string[] = [
  "TIER_SOLD_OUT",
  "TIER_CLOSED",
  "TIER_SALES_NOT_OPEN",
  "TIER_SALES_CLOSED",
  "REGISTRATION_CLOSED",
  "REGISTRATION_NOT_OPEN",
  "EVENT_ENDED",
];

/** The selected tier (or the event's registration) can no longer be reserved, so the page should reload live
 * availability. */
export function isTierUnavailable(code: string | undefined): boolean {
  return code !== undefined && RELOAD_AVAILABILITY.includes(code);
}
