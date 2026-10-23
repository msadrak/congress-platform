import { formatNumber } from "../lib/format";
import type { CopyShape } from "./useCopy";

/*
 * Words of the gate scanner (`/scan/:pointId`; docs/ux-review/copy/SPEC.md §4.6, ops/SPEC.md §3.1–3.2). Shared
 * operator words (status pill, ⋮ menu, verdict titles, setup screens) come from `copy/operator.ts`. A verdict reason
 * is at most 8 words: the operator reads it at arm's length. Counts are formatted here, in the locale's digits.
 */
const n = (count: number) => formatNumber(count, "fa");

const fa = {
  product: "اسکنر نقطهٔ ورود",
  loading: "در حال بارگذاری…",
  policy: {
    MULTI_ENTRY: "ورود مجدد مجاز",
    SINGLE_USE: "فقط یک بار ورود",
    TIER_RESTRICTED: "فقط انواع کارت ورود مجاز",
    CAPACITY_CAPPED: "ظرفیت محدود",
  },
  dailyWindow: "هر روز یک بار",
  /** Status pill detail while the offline time runs out («۱:۴۵ مانده»). */
  offlineLeft: (hours: number, minutes: number) => `${n(hours)}:${n(minutes).padStart(2, "۰")} مانده`,
  syncFailures: (count: number) => `${n(count)} ارسال ناموفق`,

  // ⋮ menu
  refreshList: "تازه‌سازی فهرست",
  sendQueue: "ارسال صف",
  recentScans: "آخرین اسکن‌ها",

  // Stage
  ready: "آمادهٔ اسکن",
  cameraOn: "روشن کردن دوربین",
  cameraOff: "خاموش کردن دوربین",
  cameraLive: "دوربین روشن است",
  cameraBlocked: "دوربین مسدود است. از بارکدخوان یا ورود دستی استفاده کنید.",
  cameraNotFound: "دوربینی پیدا نشد. از بارکدخوان یا ورود دستی استفاده کنید.",
  cameraUnavailable: "دوربین روشن نشد. از بارکدخوان یا ورود دستی استفاده کنید.",
  cameraInsecure: "دوربین فقط روی اتصال امن کار می‌کند. از بارکدخوان یا ورود دستی استفاده کنید.",

  // Manual entry
  manualOpen: "ورود دستی کد",
  manualClose: "بستن ورود دستی",
  manualLabel: "محتوای کد QR",
  manualPlaceholder: "محتوای کد QR را بچسبانید",
  manualSubmit: "بررسی",
  trackingIdWarning: "این شمارهٔ پیگیری است، نه کد QR. کارت را اسکن کنید.",

  // Verdicts (titles come from copy/operator.ts)
  exitOffline: "خروج (آفلاین)",
  reason: {
    ALREADY_ADMITTED: "قبلاً وارد شده است",
    CAPACITY_REACHED: "ظرفیت تکمیل است",
    TIER_NOT_ALLOWED: "این نوع کارت ورود اینجا مجاز نیست",
    INVALID_TICKET: "کد QR نامعتبر است",
    NOT_IN_LOCAL_MANIFEST: "در فهرست نیست؛ به میز پذیرش بفرستید",
    CAPACITY_UNAVAILABLE_OFFLINE: "آفلاین؛ ظرفیت نامعلوم است. با سرپرست هماهنگ کنید",
    SCAN_ID_CONFLICT: "تداخل با اسکن نقطهٔ دیگر",
    TICKET_INACTIVE: "کارت ورود لغو شده است",
    EVENT_MISMATCH: "کارت همایش دیگری است",
    NOT_INSIDE: "داخل نیست؛ خروج ثبت نشد",
    EXIT_NOT_TRACKED: "این نقطه خروج ثبت نمی‌کند",
    REQUIRED_POINT_NOT_VISITED: "اول باید از نقطهٔ پیش‌نیاز وارد شود",
    POINT_ARCHIVED: "نقطهٔ ورود بایگانی شده است",
  },
  /** A rejection this device decided and the server recorded as such. */
  localRejected: (reason: string) => `رد در همین دستگاه: ${reason}`,

  // Scan log
  noName: "بی‌نام",
  logEmpty: "هنوز اسکنی ثبت نشده است.",
  admitted: "مجاز",
  rejected: "رد شد",
  exitRecorded: "خروج",
  sync: {
    PROVISIONAL: "در صف",
    CONFIRMED: "تأیید سرور",
    LOCAL_REJECTED: "ثبت شد",
    CONFLICT: "تداخل",
  },

  // Entry / exit (points that track occupancy)
  directionLabel: "حالت اسکن",
  entryMode: "ورود",
  exitMode: "خروج",
  exitModeBanner: "حالت خروج: اسکن‌ها خروج ثبت می‌کنند",
  inside: (count: number) => `داخل: ${n(count)}`,

  // Conflicts
  conflictsTitle: "تداخل‌های نیازمند بررسی",
  conflictsBody: "سرور این اسکن‌ها را رد کرد (مثلاً ورود از نقطهٔ دیگر).",
  scannedAt: (time: string) => `اسکن: ${time}`,
  acknowledge: "بررسی شد",
  acknowledged: "بررسی‌شده",

  // Scanning paused
  windowTokenExpired: "کد اتصال منقضی شده؛ پیوند تازه بگیرید.",
  windowStale: "فهرست قدیمی است؛ به اینترنت وصل شوید.",
  windowPaused: "زمان کار آفلاین تمام شد؛ اسکن متوقف است.",
  storageFailedTitle: "این اسکن ثبت نشد. ورود ندهید.",
  storageFailedBody: "صفحه را دوباره باز کنید یا از دستگاه دیگری استفاده کنید.",
  reload: "بارگذاری دوباره",

  // Pairing and setup screens
  scanPairing: "اسکن کد QR اتصال",
  pasteCode: "چسباندن کد",
  pasteLabel: "کد اتصال",
  pastePlaceholder: "کد اتصال را اینجا بچسبانید",
  pair: "اتصال",
  pairWrongPoint: "این کد QR برای نقطهٔ ورود دیگری است.",
  pairNotLink: "این کد QR اتصال نیست.",
  unavailableTitle: "نقطهٔ ورود در دسترس نیست",
  otherTabTitle: "این نقطه در زبانهٔ دیگری باز است",
  otherTabBody: "زبانهٔ دیگر را ببندید.",
  pointLabel: "نقطهٔ ورود",
  initStorageUnavailable: "حافظهٔ اسکنر روی این دستگاه در دسترس نیست.",
  initStorageBlocked: "زبانه‌های دیگر اسکنر را ببندید و صفحه را دوباره باز کنید.",
  initConnectFailed: "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.",
  initManifestMissing: "فهرست این نقطهٔ ورود پیدا نشد.",
  initNoToken: "این دستگاه هنوز متصل نیست.",

  // Unpair
  unpairQuestion: "اتصال این دستگاه قطع شود؟",
  unpairBody: "قطع اتصال، این دستگاه را از کار می‌اندازد.",
  unpairOffline: "آفلاین هستید؛ فقط روی همین دستگاه قطع می‌شود.",
  unpairUnsent: (count: number) => `${n(count)} اسکن ارسال‌نشده اول ارسال می‌شود.`,
  unpairConfirm: "قطع اتصال",
  unpairedTitle: "اتصال قطع شد",
  deactivatedTitle: "قطع اتصال کامل نشد",
  deactivatedDefault: "این دستگاه متوقف است.",
  unpairNotConfirmed: "روی این دستگاه قطع شد، اما سرور هنوز تأیید نکرده است. دستگاه را به سرپرست بدهید.",
  unpairUnsynced: (count: number) => `${n(count)} اسکن ارسال‌نشده روی این دستگاه است. اول به اینترنت وصل شوید.`,
  remaining: (count: number) => `${n(count)} اسکن ارسال‌نشده.`,
  reconnectFirst: "اول به اینترنت وصل شوید.",
  retryUnpair: "تلاش دوباره",

  // Unsent scans left on a blocked device
  discardTitle: (count: number) => `${n(count)} اسکن ارسال‌نشده`,
  discardBody: "فقط روی همین دستگاه‌اند. فقط با تأیید سرپرست حذف کنید.",
  discardAction: "حذف اسکن‌ها",
  discardConfirm: (count: number) => `${n(count)} اسکن برای همیشه حذف شود؟`,
  discardConfirmAction: "حذف",
  discardDone: (count: number) => `${n(count)} اسکن ارسال‌نشده حذف شد.`,
} as const;

const en: CopyShape<typeof fa> = {
  product: "Check-in scanner",
  loading: "Loading…",
  policy: {
    MULTI_ENTRY: "Re-entry allowed",
    SINGLE_USE: "One entry per pass",
    TIER_RESTRICTED: "Selected pass types only",
    CAPACITY_CAPPED: "Capacity limited",
  },
  dailyWindow: "Once per day",
  offlineLeft: (hours, minutes) => `${hours}:${String(minutes).padStart(2, "0")} left`,
  syncFailures: (count) => `${count} failed ${count === 1 ? "send" : "sends"}`,

  refreshList: "Refresh list",
  sendQueue: "Send queue",
  recentScans: "Recent scans",

  ready: "Ready to scan",
  cameraOn: "Turn on camera",
  cameraOff: "Turn off camera",
  cameraLive: "Camera on",
  cameraBlocked: "Camera blocked. Use a barcode scanner or manual entry.",
  cameraNotFound: "No camera found. Use a barcode scanner or manual entry.",
  cameraUnavailable: "Camera didn't start. Use a barcode scanner or manual entry.",
  cameraInsecure: "Camera needs a secure connection. Use a barcode scanner or manual entry.",

  manualOpen: "Enter code manually",
  manualClose: "Close manual entry",
  manualLabel: "QR content",
  manualPlaceholder: "Paste the QR content",
  manualSubmit: "Check",
  trackingIdWarning: "That's a reference number, not the QR code. Scan the pass.",

  exitOffline: "Exit (offline)",
  reason: {
    ALREADY_ADMITTED: "Already admitted",
    CAPACITY_REACHED: "Full",
    TIER_NOT_ALLOWED: "Pass type not allowed here",
    INVALID_TICKET: "Invalid QR code",
    NOT_IN_LOCAL_MANIFEST: "Not on the list; send to the desk",
    CAPACITY_UNAVAILABLE_OFFLINE: "Offline: capacity unknown; ask a supervisor",
    SCAN_ID_CONFLICT: "Conflicts with another point",
    TICKET_INACTIVE: "Pass cancelled",
    EVENT_MISMATCH: "Other congress",
    NOT_INSIDE: "Not inside",
    EXIT_NOT_TRACKED: "This point doesn't record exits",
    REQUIRED_POINT_NOT_VISITED: "Must enter the required point first",
    POINT_ARCHIVED: "Point archived",
  },
  localRejected: (reason) => `Rejected on this device: ${reason}`,

  noName: "No name",
  logEmpty: "No scans yet.",
  admitted: "Admitted",
  rejected: "Rejected",
  exitRecorded: "Exit",
  sync: {
    PROVISIONAL: "Queued",
    CONFIRMED: "Server OK",
    LOCAL_REJECTED: "Logged",
    CONFLICT: "Conflict",
  },

  directionLabel: "Scan mode",
  entryMode: "Entry",
  exitMode: "Exit",
  exitModeBanner: "Exit mode: scans record people leaving",
  inside: (count) => `Inside: ${count}`,

  conflictsTitle: "Conflicts to review",
  conflictsBody: "The server rejected these scans (e.g. entered elsewhere).",
  scannedAt: (time) => `Scanned ${time}`,
  acknowledge: "Mark reviewed",
  acknowledged: "Reviewed",

  windowTokenExpired: "Pairing expired; get a new link.",
  windowStale: "List is old; connect to refresh.",
  windowPaused: "Offline time is up; scanning paused.",
  storageFailedTitle: "Scan not saved. Do not admit.",
  storageFailedBody: "Reload, or use another device.",
  reload: "Reload",

  scanPairing: "Scan pairing QR code",
  pasteCode: "Paste code",
  pasteLabel: "Pairing code",
  pastePlaceholder: "Paste the pairing code",
  pair: "Pair",
  pairWrongPoint: "This QR code is for another check-in point.",
  pairNotLink: "This isn't a pairing QR code.",
  unavailableTitle: "Check-in point unavailable",
  otherTabTitle: "Open in another tab",
  otherTabBody: "Close the other tab.",
  pointLabel: "Check-in point",
  initStorageUnavailable: "Scanner storage is unavailable on this device.",
  initStorageBlocked: "Close other scanner tabs, then reload.",
  initConnectFailed: "Can't connect. Check your internet and try again.",
  initManifestMissing: "This check-in point's list was not found.",
  initNoToken: "This device is not paired yet.",

  unpairQuestion: "Unpair this device?",
  unpairBody: "Unpairing stops this device.",
  unpairOffline: "You're offline: this only stops this device.",
  unpairUnsent: (count) => `${count} unsent ${count === 1 ? "scan is" : "scans are"} sent first.`,
  unpairConfirm: "Unpair",
  unpairedTitle: "Unpaired",
  deactivatedTitle: "Unpair not finished",
  deactivatedDefault: "This device is stopped.",
  unpairNotConfirmed: "Stopped here, not yet confirmed by the server. Hand the device to a supervisor.",
  unpairUnsynced: (count) => `${count} ${count === 1 ? "scan" : "scans"} not sent. Connect first.`,
  remaining: (count) => `${count} ${count === 1 ? "scan" : "scans"} not sent.`,
  reconnectFirst: "Connect to the internet first.",
  retryUnpair: "Try again",

  discardTitle: (count) => `${count} ${count === 1 ? "scan" : "scans"} not sent`,
  discardBody: "They exist only here. Delete only if a supervisor agrees.",
  discardAction: "Delete scans",
  discardConfirm: (count) => `Delete ${count} ${count === 1 ? "scan" : "scans"} for good?`,
  discardConfirmAction: "Delete",
  discardDone: (count) => `${count} unsent ${count === 1 ? "scan" : "scans"} deleted.`,
};

export const scannerCopy = { fa, en };
export type ScannerCopy = CopyShape<typeof fa>;
