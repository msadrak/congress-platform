import { NETWORK_FAILURE_CODE, apiErrorCode } from "../../api/client";
import { errorMessages, networkErrorMessage } from "../../lib/errorMessages";
import { formatLocalizedNumber, type AttendeeLocale } from "../../lib/i18n";
import type { QueueFailure } from "../../lib/leadQueue";

/**
 * Booth workspace wording added with the paged lead list, the trash and offline capture. Persian glossary:
 * «کارت ورود» (badge), «نوع کارت ورود» (ticket type), «کد QR»; tests/glossary.test.ts lists the banned spellings.
 */
const fa = {
  leadsTab: "لیدها",
  trashTab: "سطل بازیافت",
  viewLabel: "نمای فهرست",
  showingOf: (shown: string, total: string) => `نمایش ${shown} از ${total} لید`,
  boothTotal: (total: string) => `${total} لید در کل غرفه`,
  loadMore: "نمایش لیدهای بیشتر",
  loadingMore: "در حال بارگذاری…",
  loadMoreFailed: "لیدهای بیشتر بارگذاری نشد. دوباره تلاش کنید.",
  searching: "در حال جستجو…",
  listFailed: "فهرست لیدها بارگذاری نشد.",
  retry: "تلاش مجدد",
  deleteLead: "حذف",
  deleteLeadOf: (name: string) => `حذف لید ${name}`,
  restoreLead: "بازگردانی",
  restoreLeadOf: (name: string) => `بازگردانی لید ${name}`,
  deletedAt: "زمان حذف",
  leadDeleted: (name: string) => `لید ${name} به سطل بازیافت رفت.`,
  undo: "بازگرداندن",
  dismiss: "بستن",
  leadRestored: (name: string) => `لید ${name} بازگردانده شد.`,
  deleteFailed: "حذف لید انجام نشد. دوباره تلاش کنید.",
  restoreFailed: "بازگردانی لید انجام نشد. دوباره تلاش کنید.",
  trashEmptyTitle: "سطل بازیافت خالی است",
  trashEmptyDesc: "لیدهای حذف‌شده اینجا می‌مانند تا آن‌ها را بازگردانید. اسکن دوبارهٔ کارت ورود همان شرکت‌کننده هم لیدش را بازمی‌گرداند.",
  trashNote: "لیدهای این بخش در فهرست و فایل CSV نمی‌آیند، مگر گزینهٔ «همراه با لیدهای حذف‌شده» را بزنید.",
  includeDeleted: "همراه با لیدهای حذف‌شده",
  exportStarted: (file: string) => `دریافت ${file} آغاز شد (همهٔ لیدهای این غرفه).`,
  exportStartedWithDeleted: (file: string) => `دریافت ${file} آغاز شد (همهٔ لیدهای این غرفه، همراه با لیدهای حذف‌شده).`,
  contactShared: "شماره با رضایت شرکت‌کننده",
  contactNotShared: "بدون رضایت برای اشتراک شماره",
  contactNotSharedHint: "این شرکت‌کننده اجازهٔ نمایش شماره‌اش به غرفه‌ها را نداده است.",
  // Offline capture
  offlineBanner: "اتصال اینترنت قطع است. لیدهای تازه روی همین دستگاه ذخیره و پس از وصل شدن خودکار ارسال می‌شوند.",
  pendingHeading: "در انتظار ارسال",
  pendingCount: (n: string) => `${n} اسکن روی این دستگاه منتظر ارسال است`,
  pendingDesc: "این اسکن‌ها هنوز به سرور نرسیده‌اند و فقط روی همین دستگاه هستند.",
  syncNow: "ارسال اکنون",
  syncing: "در حال ارسال…",
  waiting: "منتظر اتصال",
  retryAt: (time: string) => `تلاش دوباره ساعت ${time}`,
  queuedAt: "زمان اسکن",
  badgeCode: "کد کارت ورود",
  retryItem: "تلاش دوباره",
  discardItem: "کنار گذاشتن",
  discardItemOf: (code: string) => `کنار گذاشتن اسکن ${code}`,
  failInvalidBadge: "این کد QR کارت ورود معتبر نیست؛ لید ثبت نشد.",
  failOtherEvent: "این کارت ورود متعلق به همایش دیگری است؛ لید ثبت نشد.",
  failRefused: (status: string) => `سرور این اسکن را نپذیرفت (کد ${status}).`,
  storageUnavailable: "این دستگاه نمی‌تواند اسکن‌ها را برای ارسال بعدی نگه دارد (حالت خصوصی مرورگر یا فضای پر). تا وصل شدن اینترنت، کد را جایی یادداشت کنید.",
  syncedCount: (n: string) => `${n} لید ذخیره‌شده در دستگاه ارسال شد.`,
  queuedTitle: "روی این دستگاه ذخیره شد",
  queuedDesc: "اتصال برقرار نیست؛ این اسکن پس از وصل شدن خودکار ارسال می‌شود. در فهرست «در انتظار ارسال» آن را می‌بینید.",
  saveOffline: "ذخیره روی دستگاه و ارسال بعدی",
  queueFailed: "ذخیره روی دستگاه ممکن نشد.",
  // Access removed
  removedTitle: "دسترسی شما به این غرفه برداشته شد",
  removedDesc: "برگزارکننده یا مدیر غرفه شما را از نمایندگان این غرفه حذف کرده است. لیدهای غرفه دیگر برای شما نمایش داده نمی‌شوند.",
  removedPending: (n: string) => `${n} اسکن ارسال‌نشده روی این دستگاه مانده است؛ اگر دوباره به غرفه افزوده شوید، ارسال می‌شود.`,
  removedAsk: "اگر فکر می‌کنید اشتباهی رخ داده، با مدیر غرفه یا برگزارکنندهٔ همایش تماس بگیرید.",
  otherBooths: "غرفه‌های دیگر شما",
  // Organizer suspended by the platform (403 BOOTH_ACCESS_SUSPENDED)
  suspendedTitle: "دسترسی به این غرفه موقتاً متوقف شده است",
  suspendedDesc: "دسترسی برگزارکنندهٔ این همایش از سوی سامانه متوقف شده است؛ تا رفع آن، پیشخوان غرفه و لیدهای آن در دسترس نیست.",
  suspendedPending: (n: string) => `${n} اسکن ارسال‌نشده روی این دستگاه مانده است و پس از رفع توقف ارسال می‌شود.`,
  suspendedAsk: "برای پیگیری با برگزارکنندهٔ همایش تماس بگیرید.",
  suspendedError: "دسترسی به این غرفه موقتاً متوقف شده است. با برگزارکنندهٔ همایش تماس بگیرید.",
  // Archived congress (409 EVENT_ARCHIVED on lead changes)
  archivedTitle: "این همایش بسته شده است",
  archivedNotice: "همایش بایگانی شده است. لیدها را همچنان می‌توانید ببینید، جستجو کنید و در قالب CSV دریافت کنید، اما ثبت، ویرایش، حذف یا بازگردانی لید دیگر ممکن نیست.",
  archivedError: "این همایش بسته شده است؛ ثبت یا تغییر لید دیگر ممکن نیست.",
  failEventArchived: "همایش بسته شده است؛ این اسکن ارسال نمی‌شود. اگر برگزارکننده همایش را دوباره باز کند، می‌توانید دوباره تلاش کنید.",
  badgeInvalid: "این کد QR کارت ورود معتبر نیست.",
  badgeOtherEvent: "این کارت ورود متعلق به همایش دیگری است.",
  scanFailed: "ثبت لید انجام نشد. دوباره تلاش کنید.",
  saveFailed: "تغییرات ذخیره نشد. اطلاعات واردشده حفظ شده است؛ دوباره ذخیره کنید.",
};

type BoothText = typeof fa;

const en: BoothText = {
  leadsTab: "Leads",
  trashTab: "Trash",
  viewLabel: "List view",
  showingOf: (shown, total) => `Showing ${shown} of ${total} leads`,
  boothTotal: (total) => `${total} in this booth`,
  loadMore: "Load more leads",
  loadingMore: "Loading…",
  loadMoreFailed: "More leads could not be loaded. Try again.",
  searching: "Searching…",
  listFailed: "The lead list could not be loaded.",
  retry: "Retry",
  deleteLead: "Delete",
  deleteLeadOf: (name) => `Delete lead ${name}`,
  restoreLead: "Restore",
  restoreLeadOf: (name) => `Restore lead ${name}`,
  deletedAt: "Deleted",
  leadDeleted: (name) => `${name} moved to the trash.`,
  undo: "Undo",
  dismiss: "Dismiss",
  leadRestored: (name) => `${name} was restored.`,
  deleteFailed: "The lead could not be deleted. Try again.",
  restoreFailed: "The lead could not be restored. Try again.",
  trashEmptyTitle: "The trash is empty",
  trashEmptyDesc: "Deleted leads stay here until you restore them. Scanning the same attendee's badge again also brings their lead back.",
  trashNote: "Leads in the trash are left out of the list and the CSV export unless you choose “Include deleted leads”.",
  includeDeleted: "Include deleted leads",
  exportStarted: (file) => `Download of ${file} started (all leads of this booth).`,
  exportStartedWithDeleted: (file) => `Download of ${file} started (all leads of this booth, including deleted leads).`,
  contactShared: "Contact shared",
  contactNotShared: "No consent to share",
  contactNotSharedHint: "This attendee has not allowed booths to see their mobile number.",
  offlineBanner: "You are offline. New leads are saved on this device and sent automatically once you are back online.",
  pendingHeading: "Pending sync",
  pendingCount: (n) => `${n} scan(s) on this device waiting to be sent`,
  pendingDesc: "These scans have not reached the server yet and exist only on this device.",
  syncNow: "Sync now",
  syncing: "Sending…",
  waiting: "Waiting for a connection",
  retryAt: (time) => `Next try at ${time}`,
  queuedAt: "Scanned",
  badgeCode: "Badge code",
  retryItem: "Try again",
  discardItem: "Discard",
  discardItemOf: (code) => `Discard scan ${code}`,
  failInvalidBadge: "This badge code is not valid; no lead was saved.",
  failOtherEvent: "This badge belongs to a different congress; no lead was saved.",
  failRefused: (status) => `The server refused this scan (status ${status}).`,
  storageUnavailable: "This device cannot keep scans for later (private browsing or storage full). Note the code down until you are back online.",
  syncedCount: (n) => `${n} lead(s) saved on this device were sent.`,
  queuedTitle: "Saved on this device",
  queuedDesc: "There is no connection; this scan is sent automatically once you are back online. It is listed under “Pending sync”.",
  saveOffline: "Save on this device and send later",
  queueFailed: "The scan could not be saved on this device.",
  removedTitle: "Your access to this booth was removed",
  removedDesc: "The organizer or the booth's manager removed you from this booth's staff. Its leads are no longer shown to you.",
  removedPending: (n) => `${n} unsent scan(s) remain on this device; they are sent if you are added to the booth again.`,
  removedAsk: "If you think this is a mistake, contact the booth manager or the congress organizer.",
  otherBooths: "Your other booths",
  suspendedTitle: "Access to this booth is suspended",
  suspendedDesc: "The platform has suspended this congress's organizer, so the booth workspace and its leads are unavailable until that is lifted.",
  suspendedPending: (n) => `${n} unsent scan(s) remain on this device; they are sent once the suspension is lifted.`,
  suspendedAsk: "Contact the congress organizer for details.",
  suspendedError: "Access to this booth is suspended. Contact the congress organizer.",
  archivedTitle: "This congress is closed",
  archivedNotice: "The congress has been archived. You can still view, search and export your leads as CSV, but capturing, editing, deleting or restoring leads is no longer possible.",
  archivedError: "This congress is closed; leads can no longer be captured or changed.",
  failEventArchived: "The congress is closed, so this scan is not sent. You can try again if the organizer reopens the congress.",
  badgeInvalid: "That badge code is not valid.",
  badgeOtherEvent: "That badge belongs to a different congress.",
  scanFailed: "The lead could not be saved. Try again.",
  saveFailed: "Your changes were not saved. Your entry is kept; save again.",
};

export function boothText(locale: AttendeeLocale): BoothText {
  return locale === "fa" ? fa : en;
}

/**
 * The reader's-language message of an API error with a known stable code (`errorMessages`), or null. Booth screens
 * show their own localized sentence instead of null, so the server's English `detail` never reaches a reader.
 */
export function codedMessage(error: unknown, locale: AttendeeLocale): string | null {
  const code = apiErrorCode(error);
  if (code === NETWORK_FAILURE_CODE) return networkErrorMessage[locale];
  // The shared wording of these two is written for organizers; exhibitors read their own.
  if (code === "EVENT_ARCHIVED") return boothText(locale).archivedError;
  if (code === "BOOTH_ACCESS_SUSPENDED") return boothText(locale).suspendedError;
  return code !== undefined && Object.hasOwn(errorMessages[locale], code) ? errorMessages[locale][code] : null;
}

/** A queued scan's refusal in the reader's language: coded API errors through the shared map, the scan's own 404/400 here. */
export function queueFailureText(failure: QueueFailure, locale: AttendeeLocale): string {
  const text = boothText(locale);
  if (failure.kind === "invalid_badge") return text.failInvalidBadge;
  if (failure.kind === "other_event") return text.failOtherEvent;
  if (failure.kind === "event_archived") return text.failEventArchived;
  const status = formatLocalizedNumber(failure.status, locale);
  // Only a code with a localized message is shown as such; the English `detail` never reaches the reader.
  if (failure.code && Object.hasOwn(errorMessages[locale], failure.code)) return errorMessages[locale][failure.code];
  return text.failRefused(status);
}
