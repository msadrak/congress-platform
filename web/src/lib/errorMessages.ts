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
    ROLE_FORBIDDEN: "نقش شما در این سازمان اجازهٔ این کار را نمی‌دهد. از مالک یا مدیر سازمان بخواهید.",
    NOT_A_MEMBER: "این شماره عضو هیچ سازمان برگزارکننده‌ای نیست. از مالک سازمان بخواهید شما را اضافه کند.",
    SIGN_IN_EXPIRED: "زمان ورود به پایان رسید. کد تازه بگیرید.",
    MEMBER_EXISTS: "این شماره هم‌اکنون عضو این سازمان است.",
    MEMBER_REVOKED: "این عضو حذف شده است؛ برای بازگرداندن، دوباره او را دعوت کنید.",
    LAST_OWNER: "پیش از حذف یا تغییر نقش آخرین مالک، مالک دیگری اضافه کنید.",
    BAD_CURSOR: "ادامهٔ فهرست بارگیری نشد. صفحه را دوباره باز کنید.",
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
    ROLE_FORBIDDEN: "Your role in this organization does not allow this. Ask an owner or manager.",
    NOT_A_MEMBER: "This number is not a member of any organizer. Ask the organization's owner to add you.",
    SIGN_IN_EXPIRED: "The sign-in expired. Request a new code.",
    MEMBER_EXISTS: "This number is already a member of this organization.",
    MEMBER_REVOKED: "This member was removed; invite them again to restore access.",
    LAST_OWNER: "Add another owner before removing or demoting the last one.",
    BAD_CURSOR: "The rest of the list could not be loaded. Reopen the page.",
  },
};

/** No response at all (offline, DNS, connection reset): there is no code to look up. */
export const networkErrorMessage: Record<AttendeeLocale, string> = {
  fa: "اتصال به سرور برقرار نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
  en: "Could not reach the server. Check your connection and try again.",
};

/** The selected tier can no longer be reserved, so the page should reload live availability. */
export function isTierUnavailable(code: string | undefined): boolean {
  return code === "TIER_SOLD_OUT" || code === "TIER_CLOSED";
}
