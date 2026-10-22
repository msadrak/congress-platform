import { formatLocalizedNumber, type TranslationDictionary } from "../../lib/i18n";
import type { LocalScanResult } from "../../lib/scannerEngine";

/**
 * Presentation copy for the gate scanner. Operational strings that the scanner's logic, its e2e specs or
 * supervisors rely on in English (e.g. "Unpair This Scanner", "Device Deauthorized") stay in English and are
 * paired with the Persian label in `fa` (see `BiLabel`).
 */
export const scannerCopy = {
  fa: {
    product: "اسکنر گیت",
    /** Two-digit section index in the locale's digits ("۰۱"). */
    sectionIndex: (n: number) => formatLocalizedNumber(n, "fa").padStart(2, "۰"),
    loading: "در حال بارگذاری فهرست گیت…",
    policy: {
      MULTI_ENTRY: "ورود مجدد مجاز",
      SINGLE_USE: "فقط یک بار ورود",
      TIER_RESTRICTED: "فقط رده‌های مجاز",
      CAPACITY_CAPPED: "ظرفیت محدود",
    } as Record<string, string>,
    defaultLocation: "درب اصلی",
    inCache: "کارت در حافظه",
    link: "اتصال",
    online: "آنلاین",
    offline: "آفلاین",
    syncing: "همگام‌سازی…",
    manifest: "فهرست",
    manifestSynced: "فهرست همگام شد",
    manifestCached: "فهرست ذخیره‌شده",
    windowLeadLabel: "پنجره آفلاین:",
    windowLeftTail: "مانده",
    queue: "صف",
    queued: "در صف",
    syncFailures: (n: number) => `${n} تلاش ناموفق همگام‌سازی`,
    soundOn: "صدای اسکن روشن",
    soundOff: "صدای اسکن خاموش",
    soundMute: "قطع صدای اعلان اسکن",
    soundUnmute: "فعال‌سازی صدای اعلان اسکن",
    tokenPlaceholder: "توکن دستگاه را اینجا بچسبانید — Paste device scanner token...",
    // Stage
    stageLabel: "هدف اسکن",
    listeningTitle: "آماده دریافت بارکدخوان سخت‌افزاری",
    listeningBody: "بارکدخوان USB یا بلوتوث را به سمت کارت نشانه بگیرید؛ یا دوربین دستگاه را فعال کنید.",
    enableCamera: "فعال‌سازی دوربین دستگاه",
    cameraLive: "دوربین فعال است",
    cameraOff: "خاموش کردن دوربین",
    cameraBlocked:
      "دوربین برای این سایت مسدود است. آن را در تنظیمات سایت مرورگر مجاز کنید یا از بارکدخوان یا ورود دستی پایین صفحه استفاده کنید.",
    cameraNotFound: "هیچ دوربینی روی این دستگاه پیدا نشد. می‌توانید از بارکدخوان USB یا ورود دستی استفاده کنید.",
    cameraUnavailable: "امکان راه‌اندازی دوربین وجود ندارد. می‌توانید از بارکدخوان یا ورود دستی استفاده کنید.",
    cameraInsecure: "دوربین فقط روی اتصال امن (https) کار می‌کند. از بارکدخوان یا ورود دستی پایین صفحه استفاده کنید.",
    // Manual entry
    manualTitle: "ورود دستی",
    manualLabel: "رمز کیوآر کارت",
    manualHint:
      "برای ورود دستی، مقدار رمزشده داخل بارکد (QR Secret) لازم است. شناسه رهگیری عمومی بلیت (Tracking ID) کلید ورود معتبر نیست.",
    manualPlaceholder: "کد کیوآر کارت را اینجا بچسبانید",
    trackingIdWarning:
      "شناسه وارد شده شماره رهگیری بلیت است، نه رمز کیوآرکد. کارت را مقابل دوربین بگیرید یا مقدار QR Secret را وارد کنید.",
    // Results
    duplicateTitle: "تکراری — ورود ممنوع",
    // Buffer
    bufferLead: "صف آفلاین:",
    bufferTail: "اسکن در صف ارسال",
    syncNow: { fa: "ارسال صف", en: "Sync Queue Now" },
    syncingNow: "در حال ارسال…",
    refreshCache: { fa: "تازه‌سازی فهرست", en: "Refresh Cache" },
    // Log
    logTitle: "آخرین اسکن‌های این گیت",
    logEmpty: "آماده پذیرش. هنوز اسکنی ثبت نشده است.",
    admitted: "مجاز",
    rejected: "رد شد",
    sync: {
      PROVISIONAL: "در صف",
      CONFIRMED: "تأیید سرور",
      LOCAL_REJECTED: "ثبت شد",
      CONFLICT: "تداخل",
    } as Record<string, string>,
    // Device settings
    settingsTitle: "تنظیمات دستگاه",
    settingsBody:
      "قطع اتصال، این مرورگر را فوراً غیرفعال می‌کند. در حالت آنلاین، ابطال اعتبار در سرور فقط پس از تطبیق اسکن‌های صف انجام می‌شود؛ در حالت آفلاین یا در صورت خطا، ابطال در انتظار می‌ماند و اعتبار و سوابق بازیابی حفظ می‌شوند.",
    unpair: { fa: "قطع اتصال این اسکنر", en: "Unpair This Scanner" },
    confirmUnpair: { fa: "تأیید قطع اتصال", en: "Confirm Unpair" },
    unpairing: "در حال قطع اتصال…",
    cancel: "انصراف",
    unpairQuestion: "اتصال این دستگاه قطع شود؟ پذیرش ورود بلافاصله متوقف می‌شود.",
    unpairPending: (n: number) => `${n} اسکن همگام‌نشده باید پیش از ابطال در سرور بازیابی شود.`,
    unpairRetained: "اعتبار تا تأیید ابطال توسط سرور نگه داشته می‌شود.",
    unpairOffline: "شما آفلاین هستید؛ این اقدام فقط این مرورگر را غیرفعال می‌کند و سرور ممکن است هنوز این اعتبار را بپذیرد.",
    unpairNoticeOffline:
      "اسکنر فقط روی این مرورگر غیرفعال شد. ابطال در سرور در انتظار است و سرور ممکن است هنوز این اعتبار را بپذیرد. دستگاه را نزد سرپرست نگه دارید و برای تکمیل، دوباره متصل شوید.",
    unpairNoticeNoCredential:
      "اسکنر به‌صورت محلی غیرفعال شد، اما اعتبار دستگاه برای ابطال در دسترس نیست. از برگزارکننده بخواهید دستگاه را ابطال کند.",
    unpairNoticeUnsynced: (n: number) =>
      `اسکنر به‌صورت محلی غیرفعال شد. ${formatLocalizedNumber(n, "fa")} اسکن همگام‌نشده روی این دستگاه قابل بازیابی است؛ ابطال در سرور انجام نشد. پیش از تلاش دوباره، متصل شوید یا از سرپرست بخواهید آن‌ها را بازیابی کند.`,
    unpairNoticeNotConfirmed: (status: number) =>
      `اسکنر به‌صورت محلی غیرفعال شد، اما ابطال در سرور تأیید نشد (HTTP ${status}). اعتبار برای تلاش دوباره نگه داشته می‌شود و سرور ممکن است هنوز آن را بپذیرد. اگر تلاش دوباره ناموفق بود، از برگزارکننده بخواهید آن را ابطال کند.`,
    unpairNoticeConfirmed:
      "ابطال در سرور تأیید شد. سوابق اسکن و تداخل برای بازیابی مجاز سرپرست حفظ می‌شوند؛ برای دسترسی به آن‌ها، دستگاه را با توکن تازه جفت کنید.",
    unpairNoticeFailed:
      "اسکنر به‌صورت محلی غیرفعال شد، اما ابطال در سرور تأیید نشد. اعتبار و سوابق اسکن نگه داشته می‌شوند؛ دوباره متصل شوید و تلاش کنید یا از برگزارکننده بخواهید آن را ابطال کند.",
    // Conflicts
    conflictsBody:
      "سرور این اسکن‌ها را رد کرده است (مثلاً پذیرش در گیت دیگر). سوابق برای ممیزی حفظ می‌شوند؛ تأیید فقط آن‌ها را بازبینی‌شده علامت می‌زند.",
    close: "بستن",
    scannedAt: "اسکن",
    reconciledAt: "تطبیق",
    acknowledge: "تأیید و رفع هشدار",
    acknowledged: "بازبینی شد",
    // Banners
    pausedTitle: { fa: "اسکن متوقف شد", en: "Scanning paused" },
    windowExpired: { fa: "پنجره آفلاین تمام شد؛ پذیرش جدید متوقف است", en: "Offline window expired — new admissions paused" },
    windowTokenExpired: "اعتبار اسکنر منقضی شده است. دوباره متصل شوید و با توکن تازه جفت کنید.",
    windowStale: "فهرست ذخیره‌شده قدیمی‌تر از ۲۴ ساعت است. برای تازه‌سازی دوباره متصل شوید.",
    preserved: (n: number) => `${n} اسکن همگام‌نشده حفظ شده است.`,
    // Setup / pairing
    setupEyebrow: "جفت‌سازی دستگاه",
    point: "نقطه کنترل",
    pairTitle: "اتصال این اسکنر به گیت",
    pairBody:
      "این دستگاه هنوز اعتبار اسکنر ندارد. توکن اختصاصی دستگاه را از سرپرست بگیرید و وارد کنید. اطلاعات شرکت‌کنندگان فقط پس از احراز هویت بارگذاری می‌شود.",
    unavailableTitle: "نقطه کنترل در دسترس نیست",
    unavailableBody: "اتصال به سرور رویداد برقرار نشد. اتصال را بررسی کنید و دوباره تلاش کنید، یا دستگاه را دوباره جفت کنید.",
    revokedTitle: "دستگاه از دسترسی خارج شد",
    revokedBody: (n: number) =>
      `برگزارکننده این دستگاه را ابطال کرده است. توکن تازه از سرپرست بگیرید و دوباره جفت کنید. ${n} اسکن همگام‌نشده برای بازیابی روی این دستگاه حفظ شده است.`,
    forbiddenTitle: "نقطه کنترل اشتباه است",
    forbiddenBody: "این توکن برای این نقطه کنترل یا رویداد مجاز نیست. نشانی گیت را با سرپرست بررسی کنید و با توکن درست جفت کنید.",
    expiredTitle: "اعتبار منقضی شده است",
    expiredBody: "اعتبار اسکنر منقضی شده است. توکن تازه از سرپرست بگیرید و دوباره جفت کنید.",
    systemDetail: "جزئیات سیستم",
    pairLabel: { fa: "جفت‌سازی دستگاه اسکنر", en: "Pair Scanner Device" },
    authorize: { fa: "احراز هویت این دستگاه", en: "Authorize This Device" },
    tokenNote: "توکن پنهان نمایش داده می‌شود و فقط روی همین دستگاه ذخیره می‌شود.",
    retry: "تلاش دوباره برای اتصال",
    backToOrganizer: "بازگشت به کنسول برگزارکننده",
    // Deactivated
    deactivated: { fa: "اسکنر غیرفعال شد", en: "Scanner Deactivated" },
    deactivatedDefault:
      "این مرورگر به‌صورت محلی غیرفعال است و ابطال در سرور تأیید نشده است. هیچ داده شرکت‌کننده یا پذیرشی اینجا در دسترس نیست؛ سوابق اسکن و تداخل برای بازیابی سرپرست حفظ می‌شوند.",
    remaining: (n: number) => `${n} اسکن همگام‌نشده روی این دستگاه باقی است.`,
    reconnectFirst: "پیش از تلاش دوباره برای ابطال، به شبکه متصل شوید.",
    retryRevoke: "تلاش دوباره برای ابطال در سرور",
    revoking: "در حال ابطال…",
    repairLabel: "جفت‌سازی دوباره توسط سرپرست",
    repairPlaceholder: "توکن تازه صادرشده اسکنر را وارد کنید…",
    repairAction: "جفت‌سازی با توکن تازه",
  },
  en: {
    product: "Gate Scanner",
    sectionIndex: (n: number) => String(n).padStart(2, "0"),
    loading: "Loading gate manifest snapshot…",
    policy: {
      MULTI_ENTRY: "Re-entry allowed",
      SINGLE_USE: "One entry per ticket",
      TIER_RESTRICTED: "Selected tiers only",
      CAPACITY_CAPPED: "Capacity limited",
    } as Record<string, string>,
    defaultLocation: "General Access",
    inCache: "in cache",
    link: "Link",
    online: "Online",
    offline: "Offline",
    syncing: "Syncing…",
    manifest: "Manifest",
    manifestSynced: "Manifest synced",
    manifestCached: "Manifest cached",
    windowLeadLabel: "offline window",
    windowLeftTail: "left",
    queue: "Queue",
    queued: "queued",
    syncFailures: (n: number) => `${n} failed sync attempt(s)`,
    soundOn: "Scan sound on",
    soundOff: "Scan sound off",
    soundMute: "Mute audio chimes",
    soundUnmute: "Enable audio chimes",
    tokenPlaceholder: "Paste device scanner token...",
    stageLabel: "Scan target",
    listeningTitle: "Hardware Scanner Listening",
    listeningBody: "Aim any USB or Bluetooth 2D barcode gun at an attendee badge, or enable the device camera.",
    enableCamera: "Enable Device Camera",
    cameraLive: "Camera active",
    cameraOff: "Turn off camera",
    cameraBlocked:
      "Camera is blocked for this site. Allow it in the browser's site settings, or use a USB scanner or manual entry below.",
    cameraNotFound: "No camera found on this device. You can use a USB scanner or manual entry.",
    cameraUnavailable: "Unable to start camera preview. Please use a barcode scanner or manual code entry.",
    cameraInsecure: "Camera needs a secure (https) connection. Use a USB scanner or manual entry below.",
    manualTitle: "Manual entry",
    manualLabel: "Ticket QR secret",
    manualHint:
      "Manual admission requires the cryptographic QR Secret payload. Public Ticket Tracking IDs cannot authorize entry.",
    manualPlaceholder: "Paste the badge's QR code",
    trackingIdWarning:
      "This is a Ticket Reference/Tracking ID. The gate scanner requires the cryptographic QR Secret payload.",
    duplicateTitle: "Duplicate — do not admit",
    bufferLead: "Offline Buffer:",
    bufferTail: "scans queued",
    syncNow: { fa: "ارسال صف", en: "Sync Queue Now" },
    syncingNow: "Syncing…",
    refreshCache: { fa: "تازه‌سازی فهرست", en: "Refresh Cache" },
    logTitle: "Recent Scans at this Gate",
    logEmpty: "Ready for attendees. No scans recorded yet.",
    admitted: "Admitted",
    rejected: "Rejected",
    sync: {
      PROVISIONAL: "queued",
      CONFIRMED: "server ok",
      LOCAL_REJECTED: "logged",
      CONFLICT: "conflict",
    } as Record<string, string>,
    settingsTitle: "Device Settings",
    settingsBody:
      "Unpairing disables this browser immediately. Online unpairing revokes the server credential only after queued scans are reconciled; offline or failed revocation remains visibly pending and retains the credential and recovery records.",
    unpair: { fa: "قطع اتصال این اسکنر", en: "Unpair This Scanner" },
    confirmUnpair: { fa: "تأیید قطع اتصال", en: "Confirm Unpair" },
    unpairing: "Unpairing…",
    cancel: "Cancel",
    unpairQuestion: "Unpair this device? Admissions stop immediately.",
    unpairPending: (n: number) => `${n} unsynced scan(s) must be recovered before server revocation.`,
    unpairRetained: "The credential is retained until the server confirms revocation.",
    unpairOffline: "You are offline, so this action can only disable this browser; the server may still accept the credential.",
    unpairNoticeOffline:
      "Scanner disabled on this browser only. Server revocation is pending; the server may still accept this credential. Keep this device with its supervisor and reconnect to finish.",
    unpairNoticeNoCredential:
      "Scanner is disabled locally, but no device credential is available to revoke it. Ask an organizer to revoke the device.",
    unpairNoticeUnsynced: (n: number) =>
      `Scanner is disabled locally. ${n} unsynced scan(s) remain recoverable on this device; server revocation was not attempted. Reconnect or ask a supervisor to recover them before retrying.`,
    unpairNoticeNotConfirmed: (status: number) =>
      `Scanner is disabled locally, but server revocation was not confirmed (HTTP ${status}). The credential is retained for retry; the server may still accept it. Ask an organizer to revoke it if retry fails.`,
    unpairNoticeConfirmed:
      "Server revocation confirmed. Scan and conflict records remain stored for authorized supervisor recovery; pair a fresh device token to access them.",
    unpairNoticeFailed:
      "Scanner is disabled locally, but server revocation could not be confirmed. The credential and scan records are retained; reconnect and retry or ask an organizer to revoke it.",
    conflictsBody:
      "The server rejected these scans (e.g. admitted at another gate). Records are preserved for audit — acknowledging only marks them reviewed.",
    close: "Close",
    scannedAt: "Scanned",
    reconciledAt: "reconciled",
    acknowledge: "Acknowledge Conflict",
    acknowledged: "Acknowledged",
    pausedTitle: { fa: "اسکن متوقف شد", en: "Scanning paused" },
    windowExpired: { fa: "پنجره آفلاین تمام شد؛ پذیرش جدید متوقف است", en: "Offline window expired — new admissions paused" },
    windowTokenExpired: "The scanner credential has expired. Reconnect and re-pair for a fresh token.",
    windowStale: "The cached manifest is older than 24h. Reconnect to refresh it.",
    preserved: (n: number) => `${n} unsynced scan(s) preserved.`,
    setupEyebrow: "Device pairing",
    point: "Check-in point",
    pairTitle: "Connect this scanner to its gate",
    pairBody:
      "This device has no scanner credential yet. Ask a supervisor for the device token and enter it below. Attendee data loads only after the device is authorized.",
    unavailableTitle: "Check-In Point Unavailable",
    unavailableBody: "",
    revokedTitle: "Device Deauthorized",
    revokedBody: (n: number) =>
      `This device was revoked by the organizer. Ask a supervisor for a fresh scanner token, then re-pair below. ${n} unsynced scan(s) preserved on this device for recovery.`,
    forbiddenTitle: "Wrong Check-In Point",
    forbiddenBody:
      "This token is not authorized for this check-in point or event. Confirm the gate URL with a supervisor, then re-pair with the correct token.",
    expiredTitle: "Credential Expired",
    expiredBody: "The scanner credential has expired. Ask a supervisor for a fresh token, then re-pair below.",
    systemDetail: "System detail",
    pairLabel: { fa: "جفت‌سازی دستگاه اسکنر", en: "Pair Scanner Device" },
    authorize: { fa: "احراز هویت این دستگاه", en: "Authorize This Device" },
    tokenNote: "The token is masked and stored only on this device.",
    retry: "Retry Connection",
    backToOrganizer: "Back to Organizer Console",
    deactivated: { fa: "اسکنر غیرفعال شد", en: "Scanner Deactivated" },
    deactivatedDefault:
      "This browser is locally disabled. Server revocation is not confirmed. No attendee data or admissions are available here; scan and conflict records remain stored for supervisor recovery.",
    remaining: (n: number) => `${n} unsynced scan(s) remain on this device.`,
    reconnectFirst: "Reconnect before retrying server revocation.",
    retryRevoke: "Retry Server Revocation",
    revoking: "Revoking…",
    repairLabel: "Supervisor Re-pair",
    repairPlaceholder: "Paste a newly issued scanner token...",
    repairAction: "Pair Fresh Supervisor Token",
  },
};

export type ScannerCopy = (typeof scannerCopy)["en"];

/** Human wording for rejection codes the scanner knows; null for codes it has no wording for. */
export function rejectionLabel(t: TranslationDictionary, reason: string | null | undefined): string | null {
  switch (reason) {
    case "ALREADY_ADMITTED":
      return t.reasonAlreadyAdmitted;
    case "CAPACITY_REACHED":
      return t.reasonCapacityReached;
    case "TIER_NOT_ALLOWED":
      return t.reasonTierNotAllowed;
    case "SCAN_ID_CONFLICT":
      return t.reasonScanConflict;
    case "NOT_IN_LOCAL_MANIFEST":
      return t.reasonNotInManifest;
    case "CAPACITY_UNAVAILABLE_OFFLINE":
      return t.reasonCapacityOffline;
    case "INVALID_TICKET":
      return t.reasonInvalidTicket;
    default:
      return null;
  }
}

/** 24h wall-clock time for logs and readouts, digits kept Latin and monospaced. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

export type TakeoverKind = "admitted" | "provisional" | "duplicate" | "rejected";

/** Verdict family for the result takeover; a duplicate is a rejection with its own look and wording. */
export function takeoverKind(result: LocalScanResult): TakeoverKind {
  if (result.status === "ADMITTED") return result.is_provisional ? "provisional" : "admitted";
  return result.rejection_reason === "ALREADY_ADMITTED" ? "duplicate" : "rejected";
}
