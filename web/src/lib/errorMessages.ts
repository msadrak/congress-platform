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
    OPERATOR_ALREADY_ASSIGNED: "این شماره پیش‌تر اپراتور پذیرش این همایش است.",
    IDEMPOTENCY_KEY_REUSED: "این ثبت با اطلاعات دیگری فرستاده شده بود. اطلاعات را بررسی و دوباره ثبت کنید.",
    IDEMPOTENCY_KEY_IN_PROGRESS: "ثبت قبلی هنوز در حال انجام است. چند لحظه بعد دوباره تلاش کنید.",
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
    OPERATOR_ALREADY_ASSIGNED: "This number is already a reception operator for this congress.",
    IDEMPOTENCY_KEY_REUSED: "This submission was already sent with different details. Check the entry and submit again.",
    IDEMPOTENCY_KEY_IN_PROGRESS: "The previous submission is still being processed. Try again in a moment.",
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
