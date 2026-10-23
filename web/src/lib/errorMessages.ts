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
  },
  en: {
    EVENT_NOT_FOUND: "This congress could not be found.",
    TIER_NOT_FOUND: "This pass is no longer offered. Please choose another pass.",
    TIER_CLOSED: "Registration for this pass has been closed by the organizer.",
    TIER_SOLD_OUT: "This pass is sold out.",
    ALREADY_REGISTERED: "You already hold a pass for this congress.",
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
