/**
 * Words of the organizer console's shared scaffold: the event section gate (loading, failure, not found,
 * archived), the section notice, the event status chip and the role picker. Section-specific wording stays in
 * each section's own module. Role names and their one-line meanings come from `ROLE_COPY` (lib/organizerConsole).
 */
import type { EventTimeStatus } from "../lib/organizerWorkspace";

export type OrganizerSharedLocale = "fa" | "en";

export interface OrganizerSharedCopy {
  eventStatus: Record<EventTimeStatus, string>;
  /** The congress could not be loaded (server error, refusal or no connection). */
  loadFailedTitle: string;
  loadFailedBody: string;
  /** Announced while the section loads. */
  loading: string;
  /** The congress does not exist (404) or is not this organizer's. */
  notFoundTitle: string;
  notFoundBody: string;
  /** Archived congress: shown above every section, which is then read-only. */
  archivedBanner: string;
  unarchive: string;
  dismissMessage: string;
  role: {
    legend: string;
    /** Title of the confirmation; `name` is the member's name when known. */
    confirmTitle: (role: string, name?: string) => string;
    confirmAction: string;
  };
}

const fa: OrganizerSharedCopy = {
  eventStatus: { upcoming: "در پیش‌رو", "in-progress": "در حال برگزاری", ended: "پایان‌یافته" },
  loadFailedTitle: "خطا در بارگذاری همایش",
  loadFailedBody: "اطلاعات این همایش دریافت نشد. دوباره تلاش کنید.",
  loading: "در حال بارگذاری…",
  notFoundTitle: "این همایش پیدا نشد",
  notFoundBody: "شاید حذف شده باشد یا به سازمان دیگری تعلق داشته باشد.",
  archivedBanner: "بایگانی‌شده — فقط مشاهده",
  unarchive: "خارج کردن از بایگانی",
  dismissMessage: "بستن پیام",
  role: {
    legend: "نقش",
    confirmTitle: (role, name) => (name ? `نقش «${name}» به «${role}» تغییر کند؟` : `نقش به «${role}» تغییر کند؟`),
    confirmAction: "تغییر نقش",
  },
};

const en: OrganizerSharedCopy = {
  eventStatus: { upcoming: "Upcoming", "in-progress": "In progress", ended: "Ended" },
  loadFailedTitle: "Failed to Load Event",
  loadFailedBody: "This congress could not be loaded. Try again.",
  loading: "Loading…",
  notFoundTitle: "Congress not found",
  notFoundBody: "It may have been deleted, or it belongs to another organization.",
  archivedBanner: "Archived — view only",
  unarchive: "Unarchive",
  dismissMessage: "Dismiss message",
  role: {
    legend: "Role",
    confirmTitle: (role, name) => (name ? `Change ${name}'s role to ${role}?` : `Change the role to ${role}?`),
    confirmAction: "Change role",
  },
};

export const organizerSharedCopy: Record<OrganizerSharedLocale, OrganizerSharedCopy> = { fa, en };
