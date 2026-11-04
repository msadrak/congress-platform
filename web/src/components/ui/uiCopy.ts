import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Default strings for the shared primitives (fa + en). Callers pass their own wording where the
 * meaning is theirs (a ConfirmDialog verb, a field label); these cover only the generic chrome.
 */
export type UiLocale = "fa" | "en";

export type StatusKey =
  | "active"
  | "cancelled"
  | "archived"
  | "open"
  | "closed"
  | "full"
  | "notOpen"
  | "ended"
  | "published"
  | "unpublished"
  | "admitted"
  | "rejected"
  | "queued"
  | "online"
  | "offline"
  | "accessRemoved";

const fa = {
  close: "بستن",
  cancel: "انصراف",
  retry: "تلاش دوباره",
  back: "بازگشت",
  search: "جستجو",
  clearSearch: "پاک کردن جستجو",
  loading: "در حال بارگذاری…",
  optional: "(اختیاری)",
  moreActions: "گزینه‌های بیشتر",
  errorTitle: "بارگذاری نشد",
  errorBody: "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.",
  languageName: "فارسی",
  status: {
    active: "فعال",
    cancelled: "لغوشده",
    archived: "بایگانی‌شده",
    open: "باز",
    closed: "بسته",
    full: "ظرفیت تکمیل",
    notOpen: "هنوز باز نشده",
    ended: "مهلت تمام شد",
    published: "منتشرشده",
    unpublished: "منتشرنشده",
    admitted: "پذیرفته شد",
    rejected: "رد شد",
    queued: "در صف ارسال",
    online: "آنلاین",
    offline: "آفلاین",
    accessRemoved: "دسترسی لغو شده",
  } satisfies Record<StatusKey, string>,
};

type UiCopy = { [K in keyof typeof fa]: (typeof fa)[K] extends string ? string : Record<StatusKey, string> };

const en: UiCopy = {
  close: "Close",
  cancel: "Cancel",
  retry: "Try again",
  back: "Back",
  search: "Search",
  clearSearch: "Clear search",
  loading: "Loading…",
  optional: "(optional)",
  moreActions: "More actions",
  errorTitle: "Couldn't load",
  errorBody: "Can't connect. Check your internet and try again.",
  languageName: "English",
  status: {
    active: "Active",
    cancelled: "Cancelled",
    archived: "Archived",
    open: "Open",
    closed: "Closed",
    full: "Full",
    notOpen: "Not open yet",
    ended: "Ended",
    published: "Published",
    unpublished: "Not published",
    admitted: "Admitted",
    rejected: "Rejected",
    queued: "Waiting to send",
    online: "Online",
    offline: "Offline",
    accessRemoved: "Access removed",
  },
};

export const uiCopy: Record<UiLocale, UiCopy> = { fa, en };

/** The page language for an element: Persian inside any `dir="rtl"` container, else the document's. */
export function uiLocaleOf(element: Element | null): UiLocale {
  const dirHost = element?.closest("[dir]");
  if (dirHost) return dirHost.getAttribute("dir") === "rtl" ? "fa" : "en";
  if (typeof document === "undefined") return "fa";
  return document.documentElement.dir === "rtl" || document.documentElement.lang === "fa" ? "fa" : "en";
}

/**
 * Default copy in the language of the surrounding page. Portals set `dir` on their root, so the primitive
 * reads it from its own element before paint; no provider or extra prop is needed.
 */
export function useUiCopy<T extends Element>(): { ref: RefObject<T | null>; copy: UiCopy; locale: UiLocale } {
  const ref = useRef<T>(null);
  const [locale, setLocale] = useState<UiLocale>(() => uiLocaleOf(null));
  // No dependency list on purpose: re-read after every render, because a language switch re-renders the
  // portal with a new `dir`. It only sets state when the language actually changed, so it cannot loop.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const next = uiLocaleOf(ref.current);
    if (next !== locale) setLocale(next);
  });
  return { ref, copy: uiCopy[locale], locale };
}
