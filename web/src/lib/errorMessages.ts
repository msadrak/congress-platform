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
    // Exhibitors and networking
    BOOTH_NOT_FOUND: "این غرفه یافت نشد.",
    BOOTH_STAFF_REQUIRED: "شما نمایندهٔ این غرفه نیستید یا دسترسی شما برداشته شده است.",
    BOOTH_STAFF_NOT_FOUND: "این نماینده دیگر عضو غرفه نیست. فهرست را به‌روز کنید.",
    BOOTH_QR_NOT_FOUND: "این کیوآر کد متعلق به هیچ غرفه‌ای نیست.",
    BOOTH_QR_RATE_LIMITED: "تلاش‌های ناموفق زیادی انجام شد. کمی بعد دوباره تلاش کنید.",
    BOOTH_OTHER_EVENT: "این غرفه متعلق به همایش دیگری است.",
    ACTIVE_TICKET_REQUIRED: "برای این کار به کارت ورود فعال همین همایش نیاز دارید.",
    LEAD_NOT_FOUND: "این لید یافت نشد. فهرست را به‌روز کنید.",
    LEAD_DELETED: "این لید حذف شده است؛ برای ویرایش ابتدا آن را بازگردانید.",
    CURSOR_INVALID: "صفحه‌بندی فهرست نامعتبر است. فهرست را از ابتدا بارگذاری کنید.",
    EVENT_ID_REQUIRED: "همایشی که در آن اسکن می‌کنید مشخص نیست. صفحهٔ همایش را باز کنید و دوباره اسکن کنید.",
    BADGE_NOT_FOUND: "این کیوآر کد، کارت ورود شرکت‌کننده نیست.",
    BADGE_INACTIVE: "این کارت ورود دیگر معتبر نیست.",
    BADGE_OTHER_EVENT: "این کارت متعلق به همایش دیگری است و ذخیره نشد.",
    BADGE_OWN: "نمی‌توانید کارت ورود خودتان را اسکن کنید.",
    CONNECTION_NOT_FOUND: "این ارتباط یافت نشد. فهرست را به‌روز کنید.",
    CONNECTION_SCAN_RATE_LIMITED: "اسکن‌های زیادی انجام شد. کمی بعد دوباره تلاش کنید.",
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
    // Exhibitors and networking
    BOOTH_NOT_FOUND: "This booth could not be found.",
    BOOTH_STAFF_REQUIRED: "You are not a representative of this booth, or your access was removed.",
    BOOTH_STAFF_NOT_FOUND: "This representative is no longer at the booth. Refresh the list.",
    BOOTH_QR_NOT_FOUND: "This QR code does not belong to a booth.",
    BOOTH_QR_RATE_LIMITED: "Too many failed attempts. Try again in a little while.",
    BOOTH_OTHER_EVENT: "This booth belongs to another congress.",
    ACTIVE_TICKET_REQUIRED: "You need an active pass for this congress to do that.",
    LEAD_NOT_FOUND: "This lead could not be found. Refresh the list.",
    LEAD_DELETED: "This lead was deleted; restore it before editing.",
    CURSOR_INVALID: "The list position is no longer valid. Reload the list from the start.",
    EVENT_ID_REQUIRED: "The congress you are scanning in is unknown. Open the congress page and scan again.",
    BADGE_NOT_FOUND: "This QR code is not an attendee pass.",
    BADGE_INACTIVE: "This pass is no longer valid.",
    BADGE_OTHER_EVENT: "This badge belongs to another congress and was not saved.",
    BADGE_OWN: "You cannot scan your own pass.",
    CONNECTION_NOT_FOUND: "This connection could not be found. Refresh the list.",
    CONNECTION_SCAN_RATE_LIMITED: "Too many scans. Try again in a little while.",
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
